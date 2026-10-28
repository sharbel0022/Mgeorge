import {env} from 'cloudflare:workers';
import {db,identity,readWorkspace,response} from './server';
import {applyCommand,emptyState,now,uid,type Invoice} from './domain';
import {digest,randomToken} from './banking/security';
import {fieldNames,interpretInvoice,validateInvoiceValues,validOrganization} from './invoice-fields.js';
import {serverPdfText} from './server-pdf';

type Row=Record<string,any>;
const config=env as unknown as Record<string,string>;
const cloudOcrConfigured=()=>config.DOCUMENT_CLOUD_OCR_ENABLED==='true'&&/^[A-Za-z0-9_-]{43}$/.test(config.DOCUMENT_CLOUD_WORKER_TOKEN||'')&&config.DOCUMENT_CLOUD_WORKER_TOKEN!==config.DOCUMENT_WORKER_TOKEN;
const safe=(message:string)=>Object.assign(Error(message),{safe:true,status:409});
const normalize=(s:unknown)=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const mailbox=(s:unknown)=>String(s||'').match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0].toLowerCase()||'';
export const counterpartyKey=(direction:string,party:string,org:string)=>JSON.stringify([direction,normalize(org),normalize(party)]);
export const documentInvoiceKey=(i:Row)=>JSON.stringify([i.direction,normalize(i.organizationNumber||i.party),normalize(i.number)]);
const sourceFor=(owner:string,id:string)=>db().prepare('SELECT * FROM gmail_sources WHERE owner=? AND document_id=? ORDER BY created_at LIMIT 1').bind(owner,id).first<Row>();
const activeSource="EXISTS(SELECT 1 FROM gmail_sources s WHERE s.owner=document_jobs.owner AND s.document_id=document_jobs.document_id AND s.status='needs_review')";

export async function processingSettings(user?:{userId:string,email:string}){
  user ||= await identity();
  const email=(user.email||'').toLowerCase();
  const permitted=!!email&&config.DOCUMENT_AUTOMATION_ENABLED==='true'&&email.toLowerCase()===String(config.DOCUMENT_OWNER_EMAIL||'').toLowerCase();
  await db().prepare('INSERT OR IGNORE INTO document_automation(owner,email,enabled,updated_at) VALUES(?,?,?,?)').bind(user.userId,email,permitted?1:0,now()).run();
  return await db().prepare('SELECT * FROM document_automation WHERE owner=?').bind(user.userId).first<Row>();
}
export async function processingStatus(owner:string){
  const settings=await db().prepare('SELECT enabled,auto_register,worker_seen,cloud_worker_seen,cloud_worker_completed,last_cloud_run FROM document_automation WHERE owner=?').bind(owner).first<Row>();
  const counts=await db().prepare("SELECT state,COUNT(*) count FROM document_jobs WHERE owner=? AND EXISTS(SELECT 1 FROM gmail_sources s WHERE s.owner=document_jobs.owner AND s.document_id=document_jobs.document_id AND s.status<>'rejected') GROUP BY state").bind(owner).all<Row>();
  const registered=await db().prepare("SELECT COUNT(DISTINCT document_id) count FROM gmail_sources WHERE owner=? AND status='registered'").bind(owner).first<Row>();
  const messages=await db().prepare("SELECT COUNT(*) count FROM customer_messages WHERE owner=? AND status='draft'").bind(owner).first<Row>();
  const cloud=cloudOcrConfigured(),cloudSeen=settings?.cloud_worker_seen||'';
  return {enabled:settings?.enabled===1,auto_register:settings?.auto_register===1,worker_last_seen:settings?.worker_seen||'',worker_online:!!settings?.worker_seen&&Date.now()-Date.parse(settings.worker_seen)<180000,cloud_ocr_configured:cloud,cloud_worker_last_seen:cloudSeen,cloud_worker_recent:cloud&&!!cloudSeen&&Date.now()-Date.parse(cloudSeen)<45*60000,cloud_last_completed:settings?.cloud_worker_completed||'',last_processed:settings?.last_cloud_run||'',counts:Object.fromEntries(counts.results.map(r=>[r.state,r.count])),registered:registered?.count||0,messages_waiting:messages?.count||0,scheduler_configured:config.DOCUMENT_SCHEDULER_CONFIGURED==='true',schedule_minutes:Number(config.DOCUMENT_SCHEDULE_MINUTES)||60,ocr_mode:cloud?'cloud':'local_computer',limits:{file_bytes:15000000,pdf_cloud_bytes:5000000,pages:10,local_concurrency:1,cloud_concurrency:1}};
}
export async function enqueueDocuments(owner:string){
  const at=now();
  await db().prepare("UPDATE document_jobs SET state='failed',error_code='lease_expired',lease='',lease_until='',updated_at=? WHERE owner=? AND state='processing' AND attempts>=3 AND lease_until<?").bind(at,owner,at).run();
  await db().prepare(`INSERT OR IGNORE INTO document_jobs(owner,document_id,state,engine,available_at,updated_at) SELECT DISTINCT d.owner,d.id,CASE WHEN d.mime='application/pdf' AND d.size<=5000000 THEN 'queued' ELSE 'waiting_ocr' END,CASE WHEN d.mime='application/pdf' AND d.size<=5000000 THEN 'cloud' ELSE 'local' END,?,? FROM documents d JOIN gmail_sources s ON s.owner=d.owner AND s.document_id=d.id WHERE d.owner=? AND s.status='needs_review' AND NOT EXISTS(SELECT 1 FROM gmail_sources x WHERE x.owner=d.owner AND x.document_id=d.id AND x.status='registered')`).bind(at,at,owner).run();
}
async function claim(owner:string,engine:string,runner='server'):Promise<Row|null>{
  const at=now(),wanted=engine==='cloud'?'queued':'waiting_ocr';
  const job=await db().prepare(`SELECT document_jobs.*,d.mime,d.size,d.sha256 FROM document_jobs JOIN documents d ON d.owner=document_jobs.owner AND d.id=document_jobs.document_id WHERE document_jobs.owner=? AND engine=? AND attempts<3 AND available_at<=? AND (state=? OR (state='processing' AND lease_until<?)) AND ${activeSource} ORDER BY available_at,document_id LIMIT 1`).bind(owner,engine,at,wanted,at).first<Row>();
  if(!job)return null;
  const lease=randomToken(),until=new Date(Date.now()+(runner==='cloud'?300000:180000)).toISOString();
  const r=await db().prepare(`UPDATE document_jobs SET state='processing',attempts=attempts+1,lease=?,lease_until=?,lease_runner=?,updated_at=? WHERE owner=? AND document_id=? AND engine=? AND attempts=? AND attempts<3 AND available_at<=? AND (state=? OR (state='processing' AND lease_until<?)) AND ${activeSource}`).bind(lease,until,runner,at,owner,job.document_id,engine,job.attempts,at,wanted,at).run();
  return r.meta.changes===1?{...job,lease,lease_until:until,lease_runner:runner,attempts:job.attempts+1}:null;
}
async function failJob(owner:string,job:Row,code:string){
  const retry=job.attempts<3;
  await db().prepare("UPDATE document_jobs SET state=?,error_code=?,available_at=?,lease='',lease_until='',updated_at=? WHERE owner=? AND document_id=? AND lease=? AND state='processing'").bind(retry?(job.engine==='local'?'waiting_ocr':'queued'):'failed',code,new Date(Date.now()+Math.min(job.attempts*60000,180000)).toISOString(),now(),owner,job.document_id,job.lease).run();
}
export async function registerProcessedInvoice(owner:string,documentId:string,raw:Row,fields:Row,options:{automatic?:boolean,lease?:string,trust?:Row}={}){
  for(let attempt=0;attempt<3;attempt++){
    const source=await sourceFor(owner,documentId);if(!source||!['needs_review','registered'].includes(source.status))throw safe('Underlaget kan inte registreras i detta läge.');
    if(source.status==='registered')return {registered:true,duplicate:true};
    const old=await readWorkspace(owner),invoice:Row={...raw,documentId,reviewed:true,source:'Gmail: '+JSON.parse(source.metadata).subject};delete invoice.id;
    const checks={issued_at:invoice.issued,due_at:invoice.due,total_cents:invoice.total,organization_number:fields.organization_number||null,currency:fields.currency,vat_cents:fields.vat_cents,net_cents:fields.net_cents};
    const issues=validateInvoiceValues(checks);if(fields.currency!=='SEK'||!invoice.due||!['receivable','payable'].includes(invoice.direction))issues.push('Kontrollera datum, valuta och fakturatyp.');
    if(issues.length)throw safe(issues.join(' '));
    if(invoice.kind&&invoice.kind!=='invoice')throw safe('Dokumentet är inte en vanlig faktura.');
    invoice.organizationNumber=fields.organization_number||'';invoice.vat=checks.vat_cents??null;invoice.net=checks.net_cents??null;
    const key=documentInvoiceKey(invoice),same=old.state.invoices.filter(i=>!i.voided&&documentInvoiceKey(i)===key);
    if(same.length)throw safe(same.some(i=>i.total!==invoice.total)?'Samma faktura finns med ett annat belopp. Kontrollera originalposten.':'Fakturan finns redan registrerad. Ingen ny skuld har skapats.');
    const result=applyCommand(old.state,{type:'invoice.save',invoice});
    if(JSON.stringify(result.state).length>1800000)throw safe('Registret behöver utökad lagring.');
    const saved=result.state.invoices.find(i=>i.documentId===documentId)!;
    const at=now(),receipt=uid();
    await db().prepare('INSERT OR IGNORE INTO workspaces(owner,revision,payload,updated_at) VALUES(?,0,?,?)').bind(owner,JSON.stringify(emptyState()),at).run();
    const guard=options.automatic?` AND EXISTS(SELECT 1 FROM document_jobs j WHERE j.owner=? AND j.document_id=? AND j.state='processing' AND j.lease=? AND j.lease_until>?) AND EXISTS(SELECT 1 FROM invoice_counterparties c WHERE c.owner=? AND c.identity=? AND c.version=?) AND EXISTS(SELECT 1 FROM document_automation a WHERE a.owner=? AND a.enabled=1 AND a.auto_register=1)`:'';
    const binds=options.automatic?[owner,documentId,options.lease,at,owner,options.trust!.identity,options.trust!.version,owner]:[];
    let batch;
    try{batch=await db().batch([
      db().prepare(`INSERT INTO document_registrations(owner,document_id,identity,invoice_id,attempt,total,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspaces WHERE owner=? AND revision=?) AND EXISTS(SELECT 1 FROM gmail_sources WHERE owner=? AND document_id=? AND status='needs_review')${guard}`).bind(owner,documentId,key,saved.id,receipt,invoice.total,at,owner,old.revision,owner,documentId,...binds),
      db().prepare('UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE owner=? AND revision=? AND EXISTS(SELECT 1 FROM document_registrations WHERE owner=? AND document_id=? AND attempt=?)').bind(JSON.stringify(result.state),at,owner,old.revision,owner,documentId,receipt),
      db().prepare("UPDATE gmail_sources SET status='registered' WHERE owner=? AND document_id=? AND EXISTS(SELECT 1 FROM document_registrations WHERE owner=? AND document_id=? AND attempt=?)").bind(owner,documentId,owner,documentId,receipt),
      db().prepare("UPDATE document_jobs SET state='registered',invoice_id=?,automatic=?,lease='',lease_until='',updated_at=? WHERE owner=? AND document_id=? AND EXISTS(SELECT 1 FROM document_registrations WHERE owner=? AND document_id=? AND attempt=?)").bind(saved.id,options.automatic?1:0,at,owner,documentId,owner,documentId,receipt),
      db().prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM document_registrations WHERE owner=? AND document_id=? AND attempt=?)').bind(uid(),owner,old.revision+1,options.automatic?'gmail.invoice.automatic':'gmail.invoice.review',JSON.stringify({invoice,fields,extraction:JSON.parse(source.extraction),message:result.message}),at,owner,documentId,receipt),
    ]);}catch(e){if((await sourceFor(owner,documentId))?.status==='registered')return {registered:true,duplicate:true};throw e;}
    if(batch[1].meta.changes===1){await (await import('./customer-messages')).reconcileAndPrepare(owner);return {registered:true,invoice_id:saved.id,automatic:!!options.automatic};}
    if(options.automatic)throw safe('Underlaget ändrades under bearbetningen. Ny kontroll behövs.');
  }
  throw safe('Uppgifterna ändrades samtidigt. Försök igen.');
}
async function finish(owner:string,job:Row,result:{text:string,method:string,confidence:number}){
  const source=await sourceFor(owner,job.document_id);if(source?.status!=='needs_review')return {ignored:true};
  const meta=JSON.parse(source.metadata),extraction=interpretInvoice(result.text,{direction:meta.direction,direction_confident:meta.direction_confident&&!meta.forwarded,method:result.method,ocrConfidence:result.confidence,filename:meta.original_filename||'',subject:meta.subject||''});
  Object.assign(extraction,{processing:{runner:job.lease_runner||'local',sha256:job.sha256,version:'document-worker-v3'}});
  const v=Object.fromEntries(fieldNames.map((k:string)=>[k,(extraction.fields as any)[k].value]));
  const key=counterpartyKey(v.direction,v.party,v.organization_number),email=mailbox(v.direction==='customer'?meta.to:meta.from);
  const trust=await db().prepare('SELECT * FROM invoice_counterparties WHERE owner=? AND identity=? AND email=?').bind(owner,key,email).first<Row>();
  if(trust){
    if(v.bankgiro!==trust.bankgiro||trust.currency!==v.currency){extraction.issues.push('Betalningskonto eller valuta avviker från den verifierade motparten.');if(extraction.level==='green')extraction.level='yellow';}
    else if(result.method==='pdf'&&v.currency==='SEK'&&trust.bankgiro&&extraction.fields.currency.confidence===.7){
      (extraction.fields as Row).currency={...extraction.fields.currency,confidence:.94,warning:null,evidence:'kr; samma valuta och Bankgiro som uttryckligen verifierad motpart'};
      const required=['invoice_number','party','organization_number','issued_at','due_at','total_cents','direction','currency'];
      if(!extraction.issues.length&&required.every(k=>(extraction.fields as any)[k].value!=null&&(extraction.fields as any)[k].confidence>=.9))extraction.level='green';
    }
  }
  if(v.vat_cents==null||v.net_cents==null){extraction.issues.push('Moms och nettobelopp behöver kontrolleras före automatisk registrering.');if(extraction.level==='green')extraction.level='yellow';}
  if(!trust){extraction.issues.push('Motparten behöver verifieras för automatisk registrering.');if(extraction.level==='green')extraction.level='yellow';}
  const w=await readWorkspace(owner),invoice={direction:v.direction==='customer'?'receivable':'payable',party:v.party,number:v.invoice_number,organizationNumber:v.organization_number,total:v.total_cents};
  const duplicate=w.state.invoices.some(i=>!i.voided&&documentInvoiceKey(i)===documentInvoiceKey(invoice));
  if(duplicate){extraction.issues.push('Fakturan verkar redan registrerad. Ingen ny skuld skapas.');extraction.level='yellow';}
  const at=now(),state=duplicate?'duplicate':'needs_review',serialized=JSON.stringify(extraction);
  const saved=await db().batch([
    db().prepare(`UPDATE document_jobs SET extraction=?,error_code='',updated_at=? WHERE owner=? AND document_id=? AND state='processing' AND lease=? AND lease_until>? AND ${activeSource}`).bind(serialized,at,owner,job.document_id,job.lease,at),
    db().prepare("INSERT INTO document_extractions(id,owner,document_id,result,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM document_jobs WHERE owner=? AND document_id=? AND lease=? AND updated_at=?)").bind(uid(),owner,job.document_id,serialized,at,owner,job.document_id,job.lease,at),
    db().prepare("UPDATE gmail_sources SET extraction=? WHERE owner=? AND document_id=? AND extraction='{}' AND EXISTS(SELECT 1 FROM document_jobs WHERE owner=? AND document_id=? AND lease=? AND updated_at=?)").bind(serialized,owner,job.document_id,owner,job.document_id,job.lease,at),
  ]);
  if(saved[0].meta.changes!==1)return {ignored:true};
  const settings=await db().prepare('SELECT * FROM document_automation WHERE owner=?').bind(owner).first<Row>();
  if(!duplicate&&trust&&extraction.level==='green'&&settings?.enabled&&settings.auto_register){
    try{return await registerProcessedInvoice(owner,job.document_id,{...invoice,issued:v.issued_at,due:v.due_at,ocr:v.reference||'',bankgiro:v.bankgiro||'',email:'',kind:v.kind},{organization_number:v.organization_number,currency:v.currency,vat_cents:v.vat_cents,net_cents:v.net_cents},{automatic:true,lease:job.lease,trust});}
    catch(e){extraction.level='yellow';extraction.issues.push('Automatisk registrering stoppades. Kontrollera underlaget.');}
  }
  const finalState=duplicate?'duplicate':extraction.level==='green'?'ready':state;
  const finalAt=now();
  const finalized=await db().prepare(`UPDATE document_jobs SET state=?,extraction=?,lease='',lease_until='',updated_at=? WHERE owner=? AND document_id=? AND lease=? AND lease_until>? AND state='processing' AND ${activeSource}`).bind(finalState,JSON.stringify(extraction),finalAt,owner,job.document_id,job.lease,finalAt).run();
  if(finalized.meta.changes!==1)return {ignored:true};
  return {state:finalState,level:extraction.level};
}
export async function processDocuments(owner:string,limit=2){
  await enqueueDocuments(owner);let processed=0;
  for(let n=0;n<limit;n++){
    const job=await claim(owner,'cloud');if(!job)break;
    try{
      const object=await env.BUCKET?.get(`${owner}/${job.document_id}`);if(!object||object.size>5000000)throw Error('local_ocr_required');
      const result=await serverPdfText(new Uint8Array(await object.arrayBuffer())),completed=await finish(owner,job,result);if(!('ignored' in completed))processed++;
    }catch(e){
      const code=e instanceof Error?e.message:'';
      if(['local_ocr_required','parse_timeout'].includes(code))await db().prepare("UPDATE document_jobs SET state='waiting_ocr',engine='local',attempts=0,lease='',lease_until='',updated_at=? WHERE owner=? AND document_id=? AND lease=?").bind(now(),owner,job.document_id,job.lease).run();
      else await failJob(owner,job,['page_limit','text_limit'].includes(code)?code:'pdf_unreadable');
    }
  }
  await db().prepare('UPDATE document_automation SET last_cloud_run=?,updated_at=? WHERE owner=?').bind(now(),now(),owner).run();
  return {processed,...await processingStatus(owner)};
}
export async function processingAction(req:Request,action:string){
  const user=await identity(req);await processingSettings(user);
  if(action==='process')return response(await processDocuments(user.userId));
  const body=await req.json() as Row;
  if(action==='automation'){
    if(typeof body.enabled!=='boolean'||typeof body.auto_register!=='boolean')throw safe('Välj automationsinställningar.');
    await db().prepare('UPDATE document_automation SET enabled=?,auto_register=?,updated_at=? WHERE owner=?').bind(body.enabled?1:0,body.auto_register?1:0,now(),user.userId).run();return response(await processingStatus(user.userId));
  }
  if(action==='retry'){
    await db().prepare(`UPDATE document_jobs SET state=CASE WHEN engine='local' THEN 'waiting_ocr' ELSE 'queued' END,attempts=0,available_at=?,lease='',lease_until='',updated_at=? WHERE owner=? AND document_id=? AND state IN ('failed','needs_review','duplicate') AND ${activeSource}`).bind(now(),now(),user.userId,body.document_id).run();return response({ok:true});
  }
  if(action==='trust'){
    const w=await readWorkspace(user.userId),i=w.state.invoices.find(i=>i.id===body.invoice_id&&i.reviewed&&!i.voided&&i.documentId);
    if(!i||!validOrganization(i.organizationNumber)||body.confirm!==true||typeof body.evidence!=='string'||body.evidence.trim().length<10||body.evidence.length>1000)throw safe('Verifiera en registrerad motpart med giltigt organisationsnummer och underlag.');
    const source=await sourceFor(user.userId,i.documentId);if(!source)throw safe('Gmail-underlaget saknas.');const meta=JSON.parse(source.metadata),direction=i.direction==='receivable'?'customer':'supplier',email=mailbox(direction==='customer'?meta.to:meta.from);if(!email||!meta.direction_confident||meta.forwarded)throw safe('Mejlets riktning och motpart behöver kontrolleras.');
    const key=counterpartyKey(direction,i.party,i.organizationNumber!);
    await db().batch([
      db().prepare('INSERT INTO invoice_counterparties(owner,identity,email,bankgiro,currency,evidence,verified_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner,identity) DO UPDATE SET email=excluded.email,bankgiro=excluded.bankgiro,currency=excluded.currency,evidence=excluded.evidence,version=invoice_counterparties.version+1,verified_at=excluded.verified_at').bind(user.userId,key,email,i.bankgiro,'SEK',body.evidence.trim(),now()),
      db().prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) VALUES(?,?,?,?,?,?)').bind(uid(),user.userId,w.revision,'document.counterparty.verified',JSON.stringify({invoice_id:i.id,identity:key,evidence:body.evidence}),now()),
    ]);return response({ok:true});
  }
  throw safe('Okänd dokumentåtgärd.');
}
async function workerOwner(req:Request){
  const mode=req.headers.get('x-mg-ocr-runner')||'local';
  if(!['cloud','local'].includes(mode)||mode==='cloud'&&!cloudOcrConfigured())throw Error('WORKER_AUTH');
  const token=req.headers.get('authorization')?.replace(/^Bearer /,'')||'',secret=(mode==='cloud'?config.DOCUMENT_CLOUD_WORKER_TOKEN:config.DOCUMENT_WORKER_TOKEN)||'';
  if(!/^[A-Za-z0-9_-]{43}$/.test(secret)||token.length!==secret.length||await digest(token)!==await digest(secret))throw Error('WORKER_AUTH');
  const rows=await db().prepare('SELECT owner FROM document_automation WHERE lower(email)=lower(?) AND enabled=1 LIMIT 2').bind(config.DOCUMENT_OWNER_EMAIL||'').all<Row>();
  if(rows.results.length!==1)throw Error('WORKER_AUTH');
  const owner=rows.results[0].owner as string;
  await db().prepare(mode==='cloud'?'UPDATE document_automation SET cloud_worker_seen=? WHERE owner=?':'UPDATE document_automation SET worker_seen=? WHERE owner=?').bind(now(),owner).run();return {owner,mode};
}
export async function workerAction(req:Request,action:string){
  const {owner,mode}=await workerOwner(req);
  if(action==='process'&&req.method==='POST'&&mode==='cloud'){
    const result=await processDocuments(owner,2);
    return response({processed:result.processed,waiting:Number(result.counts.waiting_ocr||0),failed:Number(result.counts.failed||0)});
  }
  if(action==='lease'&&req.method==='POST'){
    await enqueueDocuments(owner);const job=await claim(owner,'local',mode);if(!job)return response({job:null});
    return response({job:{id:job.document_id,lease:job.lease,mime:job.mime,size:job.size,sha256:job.sha256}});
  }
  if(action==='document'&&req.method==='GET'){
    const id=new URL(req.url).searchParams.get('id'),lease=req.headers.get('x-mg-ocr-lease');
    const j=await db().prepare(`SELECT document_jobs.* FROM document_jobs WHERE owner=? AND document_id=? AND lease=? AND lease_until>? AND lease_runner=? AND state='processing' AND engine='local' AND ${activeSource}`).bind(owner,id,lease,now(),mode).first<Row>();
    if(!j)return response({error:'Jobbet är inte längre tillgängligt.'},409);
    const file=await env.BUCKET?.get(`${owner}/${id}`);if(!file||file.size>15000000)return response({error:'Filen kan inte behandlas.'},413);
    return new Response(file.body,{headers:{'Content-Type':'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Length':String(file.size)}});
  }
  if(action==='complete'&&req.method==='POST'){
    const raw=await req.text();if(raw.length>350000)return response({error:'För stort resultat.'},413);const body=JSON.parse(raw);
    const job=await db().prepare(`SELECT document_jobs.*,d.sha256 FROM document_jobs JOIN documents d ON d.owner=document_jobs.owner AND d.id=document_jobs.document_id WHERE document_jobs.owner=? AND document_id=? AND lease=? AND lease_until>? AND lease_runner=? AND state='processing' AND engine='local' AND ${activeSource}`).bind(owner,body.id,body.lease,now(),mode).first<Row>();
    if(!job)return response({error:'Jobbet har ändrats eller gått ut.'},409);
    if(body.sha256!==job.sha256||typeof body.text!=='string'||body.text.length>150000||!['pdf','ocr'].includes(body.method)||!Number.isFinite(body.confidence)||body.confidence<0||body.confidence>100)return response({error:'Ogiltigt OCR-resultat.'},400);
    if(body.error===true){await failJob(owner,job,mode==='cloud'?'cloud_ocr_failed':'local_ocr_failed');return response({ok:true});}
    const result=await finish(owner,job,body);
    if(mode==='cloud'&&!('ignored' in result))await db().prepare('UPDATE document_automation SET cloud_worker_completed=? WHERE owner=?').bind(now(),owner).run();
    return response(result);
  }
  return response({error:'Okänd åtgärd.'},404);
}
