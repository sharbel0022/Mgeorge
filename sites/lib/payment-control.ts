import {db,identity,readWorkspace,response} from './server';
import {reconciliationPreviewWithOriginals} from './reconciliation-evidence';
import {now,uid} from './domain';
import {gmailSync} from './gmail-service';
import {processDocuments,processingSettings,processingStatus} from './document-processing';
import {syncControl as syncBank} from './banking/service';
import {reconcileAndPrepare,messageList} from './customer-messages';
import {buildPaymentOverview} from './payment-overview';

type Row=Record<string,any>;
type Step={key:string;title:string;state:string;note:string;attempts:number;count?:number;next_at?:string;started_at?:string;finished_at?:string};
type StepResult={state:'done'|'cached'|'waiting'|'blocked'|'error';note:string;count?:number;next_at?:string};
const definitions=[['gmail','Hämta fakturaunderlag'],['documents','Tolka och kontrollera fakturor'],['bank','Hämta bankhändelser'],['reconcile','Stäm av betalningar'],['drafts','Förbered mejlutkast']];
const LEASE_MS=10*60_000,COOLDOWN_MS=60_000;
const bad=(message:string,status=400)=>Object.assign(Error(message),{status,safe:true});
const publicJob=(r:Row|null)=>r?{id:r.id,status:r.status,steps:JSON.parse(r.steps) as Step[],started_at:r.started_at,finished_at:r.finished_at,updated_at:r.updated_at}:null;
const latest=(owner:string)=>db().prepare('SELECT * FROM payment_control_runs WHERE owner=? ORDER BY started_at DESC,rowid DESC LIMIT 1').bind(owner).first<Row>();
async function ownRun(owner:string,id:string){const row=await db().prepare('SELECT * FROM payment_control_runs WHERE owner=? AND id=?').bind(owner,id).first<Row>();if(!row)throw bad('Kontrollen finns inte i din arbetsyta.',404);return row;}
async function audit(owner:string,id:string,action:string){await db().prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) VALUES(?,?,0,?,?,?)').bind(uid(),owner,action,JSON.stringify({run_id:id}),now()).run();}

export async function startControl(owner:string,requestId:string){
  if(!owner)throw bad('Inloggning krävs.',401);
  if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(requestId))throw bad('Ogiltigt begärande-ID.');
  const at=now(),id=uid(),cutoff=new Date(Date.now()-COOLDOWN_MS).toISOString(),steps:Step[]=definitions.map(([key,title])=>({key,title,state:'queued',note:'',attempts:0}));
  const saved=await db().batch([
    db().prepare("INSERT OR IGNORE INTO payment_control_runs(id,owner,status,steps,started_at,updated_at) SELECT ?,?,'running',?,?,? WHERE NOT EXISTS(SELECT 1 FROM payment_control_requests WHERE owner=? AND request_id=?) AND NOT EXISTS(SELECT 1 FROM payment_control_runs WHERE owner=? AND (status='running' OR started_at>?))").bind(id,owner,JSON.stringify(steps),at,at,owner,requestId,owner,cutoff),
    db().prepare('INSERT OR IGNORE INTO payment_control_requests(owner,request_id,run_id,created_at) SELECT ?,?,id,? FROM payment_control_runs WHERE owner=? ORDER BY started_at DESC,rowid DESC LIMIT 1').bind(owner,requestId,at,owner),
  ]);
  const row=await db().prepare('SELECT r.* FROM payment_control_runs r JOIN payment_control_requests q ON q.owner=r.owner AND q.run_id=r.id WHERE q.owner=? AND q.request_id=?').bind(owner,requestId).first<Row>();
  if(!row)throw bad('Kontrollen kunde inte startas. Försök igen.',409);
  if(saved[0].meta.changes===1)await audit(owner,row.id,'payment_control.started');
  return {job:publicJob(row),reused:saved[0].meta.changes!==1};
}

async function executeStep(owner:string,key:string,req:Request):Promise<StepResult>{
  if(key==='gmail'){
    const c=await db().prepare('SELECT status,last_attempt,last_synced,page_token FROM gmail_connections WHERE owner=?').bind(owner).first<Row>();
    if(!c||c.status==='renewal_required')return {state:'blocked',note:'Anslut eller förnya Gmail i Inställningar. Sparade underlag används ändå.'};
    const next=Date.parse(c.last_attempt||'')+15*60_000;
    const success=await db().prepare("SELECT created_at FROM gmail_runs WHERE owner=? AND status='completed' ORDER BY created_at DESC LIMIT 1").bind(owner).first<Row>();
    if(Number.isFinite(next)&&next>Date.now()){const cached=c.status==='connected'&&!!success&&Date.parse(success.created_at)>=Date.parse(c.last_attempt)&&!c.page_token;return {state:cached?'cached':'waiting',note:cached?'Nyligen hämtat Gmail-underlag används. Ingen ny extern hämtning gjordes.':c.page_token?'Fler Gmail-underlag väntar på nästa tillåtna hämtning.':'Senaste Gmail-hämtningen är inte bekräftad som lyckad. Vänta på nästa tillåtna försök.',next_at:new Date(next).toISOString()};}
    const r=await gmailSync(req),body=await r.json() as Row;
    if(!r.ok)return {state:'blocked',note:'Gmail-hämtningen kunde inte slutföras. Kontrollera anslutningen i Inställningar.'};
    if(body.status_unknown===true||body.processing?.status_unknown===true){const processed=body.processing?.processed;return {state:'blocked',...(Number.isSafeInteger(body.imported)&&body.imported>=0?{count:body.imported}:{}),note:(Number.isSafeInteger(processed)&&processed>0?`${processed} underlag är bearbetade och sparade. `:'')+'Gmail-körningens slutstatus kunde inte bekräftas; kontrollera status igen. Avstämning och utkast kan fortsätta.'};}
    return {state:body.more?'waiting':'done',count:Number(body.imported)||0,note:body.more?'En begränsad omgång hämtades. Fler underlag väntar på nästa tillåtna hämtning.':'Nya Gmail-underlag hämtades med befintligt medgivande.'};
  }
  if(key==='documents'){
    const user=await identity(req),settings=await processingSettings(user);
    if(!settings?.enabled)return {state:'blocked',note:'Dokumentautomatiken är pausad. Kö och original bevaras; ändra inställningen först om bearbetning önskas.'};
    const result=await processDocuments(owner,2);
    if(result.status_unknown)return {state:'blocked',count:result.processed,note:'Bearbetade underlag är sparade. Aktuell köstatus kunde inte fastställas; kontrollera status igen. Avstämning och utkast kan fortsätta.'};
    const counts=result.counts;
    const waiting=Number(counts.queued||0)+Number(counts.waiting_ocr||0)+Number(counts.processing||0);
    return {state:waiting?'waiting':Number(counts.failed||0)>0?'blocked':'done',count:result.processed,note:waiting?`Sparad dokumentkö återstår. ${counts.waiting_ocr||0} väntar på ${result.cloud_ocr_configured?'moln-OCR':'lokal OCR'}${result.cloud_ocr_configured?(result.cloud_worker_recent?'':'; ingen molnkörning nyligen'):(result.worker_online?'':'; OCR-datorn är frånkopplad')}. Osäkra fält kräver granskning.`:Number(counts.failed||0)>0?'Dokument kunde inte tolkas. Originalen finns kvar för granskning.':'Sparade underlag har behandlats. Osäkra fält och dubbletter kräver fortfarande granskning.'};
  }
  if(key==='bank'){
    const c=await db().prepare('SELECT status,environment,last_error,valid_until,last_synced_at,selected_accounts,auto_last_attempt_at,auto_next_at,control_last_attempt_at FROM bank_connections WHERE owner=?').bind(owner).first<Row>();
    if(!c||c.status!=='connected'||!Number.isFinite(Date.parse(c.valid_until))||Date.parse(c.valid_until)<=Date.now()||!JSON.parse(c.selected_accounts||'[]').length)return {state:'blocked',note:'En giltig bankanslutning med valt konto behövs. Sparade bankhändelser kontrolleras ändå.'};
    // Preserve the existing six-hour bank cadence, including an already reserved retry.
    if(c.environment!=='PRODUCTION')return {state:'blocked',note:'Banken är i testläge. Testhämtningar räknas inte som verifierat produktionsunderlag.'};
    const next=Math.max(Date.parse(c.last_synced_at||'')+6*3600_000||0,Date.parse(c.auto_next_at||'')||0,Date.parse(c.auto_last_attempt_at||'')+6*3600_000||0,Date.parse(c.control_last_attempt_at||'')+6*3600_000||0);
    const success=await db().prepare('SELECT created_at FROM bank_sync_runs WHERE owner=? AND connection_id=(SELECT id FROM bank_connections WHERE owner=?) AND test=0 ORDER BY created_at DESC LIMIT 1').bind(owner,owner).first<Row>();
    if(next>Date.now()){const cached=!!c.last_synced_at&&!!success&&!c.last_error&&(!c.auto_last_attempt_at||Date.parse(success.created_at)>=Date.parse(c.auto_last_attempt_at))&&(!c.control_last_attempt_at||Date.parse(success.created_at)>=Date.parse(c.control_last_attempt_at));return {state:cached?'cached':'waiting',next_at:new Date(next).toISOString(),note:cached?'Sparat bankunderlag används inom bankens väntetid. Ingen ny bankhämtning gjordes.':'Senaste bankhämtningen kunde inte slutföras. Sparade händelser används medan nästa tillåtna försök inväntas.'};}
    const r=await syncBank(req),body=await r.json() as Row;
    if(body.due===false)return {state:'waiting',next_at:body.nextAttemptAt,note:'En annan bankåtgärd har reserverat väntetiden. Sparat underlag används tills nästa tillåtna försök.'};
    if(!r.ok)return {state:r.status===429?'waiting':'blocked',note:'Bankhämtningen kunde inte slutföras. Kontrollera bankstatus och nästa tillåtna försök.'};
    return {state:body.test?'blocked':'done',count:Number(body.imported)||0,note:body.test?'Banken är i testläge. Testhändelser räknas inte som riktiga betalningar.':'Bokförda bankhändelser hämtades. Samlingsposter kräver individuella betalningsspecifikationer.'};
  }
  if(key==='reconcile'){const result=await reconcileAndPrepare(owner);return {state:'done',count:result.automatic,note:'Befintliga konservativa betalningsregler tillämpades. Osäkra kopplingar kräver ditt beslut.'};}
  if(key==='drafts'){await reconcileAndPrepare(owner);const messages=await messageList(owner);return {state:'done',count:messages.items.filter(m=>m.status==='draft').length,note:'Aktuella svenska utkast förbereddes. Varje mejl kräver separat granskning och godkännande. Inga mejl skickades.'};}
  throw bad('Okänt kontrollsteg.');
}

/** Exactly one bounded persisted step per request. A later request can reclaim a lost lease. */
export async function advanceControl(owner:string,id:string,req:Request){
  const row=await ownRun(owner,id);if(row.status!=='running')return {job:publicJob(row)};
  const at=now(),lease=uid(),until=new Date(Date.now()+LEASE_MS).toISOString();
  const claimed=await db().prepare("UPDATE payment_control_runs SET lease=?,lease_until=?,updated_at=? WHERE owner=? AND id=? AND status='running' AND (lease='' OR lease_until<?)").bind(lease,until,at,owner,id,at).run();
  if(claimed.meta.changes!==1)return {job:publicJob(await ownRun(owner,id))};
  const claimedRow=await ownRun(owner,id),steps=JSON.parse(claimedRow.steps) as Step[],step=steps.find(s=>['queued','running'].includes(s.state));
  if(step){
    step.state='running';step.attempts++;step.started_at=at;step.note='Kontrollsteget pågår.';
    // Lease expiry must be checked after D1 acquires its write lock, not at
    // the earlier time when this worker prepared the statement.
    const running=await db().prepare("UPDATE payment_control_runs SET steps=? WHERE owner=? AND id=? AND lease=? AND lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND status='running'").bind(JSON.stringify(steps),owner,id,lease).run();
    if(running.meta.changes!==1)return {job:publicJob(await ownRun(owner,id))};
    let result:StepResult;
    try{
      // Identity is rechecked immediately before every step and after its adapter.
      const user=await identity(req);if(user.userId!==owner)throw bad('Behörigheten har ändrats.',403);
      result=step.attempts>3?{state:'error',note:'Steget avbröts flera gånger. Starta en ny kontroll för ett nytt försök.'}:await executeStep(owner,step.key,req);
      const current=await identity(req);if(current.userId!==owner)throw bad('Behörigheten har ändrats.',403);
    }catch(error){
      const code=(error as Row)?.code;
      result={state:code==='rate_limited'||(error as Row)?.status===429?'waiting':'error',note:step.key==='gmail'?'Gmail-kontrollen kunde inte slutföras. Kontrollera anslutningen och försök senare.':step.key==='bank'?'Bankkontrollen kunde inte slutföras. Sparat underlag finns kvar; kontrollera anslutningen och försök senare.':'Kontrollsteget kunde inte slutföras. Sparade underlag finns kvar för granskning.'};
    }
    step.state=result.state;step.note=result.note;step.finished_at=now();
    if(typeof result.count==='number'&&Number.isSafeInteger(result.count)&&result.count>=0)step.count=result.count;
    if(result.next_at)step.next_at=result.next_at;
  }
  const remaining=steps.some(s=>['queued','running'].includes(s.state)),status=remaining?'running':steps.every(s=>['done','cached'].includes(s.state))?'complete':'partial';
  const saved=await db().prepare("UPDATE payment_control_runs SET steps=?,status=?,finished_at=?,lease='',lease_until='',updated_at=? WHERE owner=? AND id=? AND lease=? AND lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND status='running'").bind(JSON.stringify(steps),status,remaining?'':now(),now(),owner,id,lease).run();
  if(saved.meta.changes===1&&!remaining)await audit(owner,id,'payment_control.'+status);
  return {job:publicJob(await ownRun(owner,id))};
}

export async function controlOverview(owner:string){
  const workspace=await readWorkspace(owner);
  const [documents,messages,gmail,bank,ocr,run,successful,gmailFetch]=await Promise.all([
    db().prepare("SELECT DISTINCT s.document_id,s.status,s.metadata,s.extraction,d.filename,d.mime,j.extraction AS processing_extraction,j.state,j.invoice_id FROM gmail_sources s JOIN documents d ON d.owner=s.owner AND d.id=s.document_id LEFT JOIN document_jobs j ON j.owner=s.owner AND j.document_id=s.document_id WHERE s.owner=? AND s.status<>'rejected'").bind(owner).all<Row>(),messageList(owner),
    db().prepare('SELECT status,last_synced,last_attempt,page_token FROM gmail_connections WHERE owner=?').bind(owner).first<Row>(),
    db().prepare('SELECT status,valid_until,last_synced_at,auto_sync_enabled,auto_next_at,last_error FROM bank_connections WHERE owner=?').bind(owner).first<Row>(),processingStatus(owner),latest(owner),
    db().prepare("SELECT finished_at FROM payment_control_runs WHERE owner=? AND status='complete' ORDER BY finished_at DESC LIMIT 1").bind(owner).first<Row>(),
    db().prepare("SELECT created_at FROM gmail_runs WHERE owner=? AND status='completed' ORDER BY created_at DESC LIMIT 1").bind(owner).first<Row>(),
  ]);
  return {...buildPaymentOverview(workspace.state,documents.results.map(d=>({...d,invoice_id:d.invoice_id||workspace.state.invoices.find(i=>i.documentId===d.document_id)?.id})),messages.items),run:publicJob(run),last_successful_control:successful?.finished_at||'',connections:{gmail:{connected:gmail?.status==='connected',status:gmail?.status||'disconnected',last_synced:gmailFetch?.created_at||gmail?.last_synced||'',full_sync_watermark:gmail?.last_synced||'',history_incomplete:!!gmail?.page_token,scheduler_configured:ocr.scheduler_configured===true,processing_enabled:ocr.enabled===true,new_documents:new Set(documents.results.filter(d=>d.status==='needs_review'&&!d.invoice_id&&!workspace.state.invoices.some(i=>i.documentId===d.document_id)).map(d=>d.document_id)).size},bank:{connected:bank?.status==='connected'&&Date.parse(bank.valid_until)>Date.now(),status:bank?.status==='connected'&&(!Number.isFinite(Date.parse(bank.valid_until))||Date.parse(bank.valid_until)<=Date.now())?'expired':bank?.status||'disconnected',last_synced:bank?.last_synced_at||'',automatic_enabled:bank?.auto_sync_enabled===1,next_attempt:bank?.auto_next_at||'',has_error:!!bank?.last_error},ocr:{connected:ocr.cloud_ocr_configured?ocr.cloud_worker_recent:ocr.worker_online,cloud_configured:ocr.cloud_ocr_configured,mode:ocr.ocr_mode,last_completed:ocr.cloud_last_completed,enabled:ocr.enabled,waiting:Number(ocr.counts.waiting_ocr||0),processed:Math.max(ocr.registered,['registered','ready','needs_review','duplicate'].reduce((n,key)=>n+Number(ocr.counts[key]||0),0)),failed:Number(ocr.counts.failed||0),last_seen:ocr.cloud_ocr_configured?ocr.cloud_worker_last_seen:ocr.worker_last_seen}}};
}

export async function paymentControlAction(req:Request,action:string){
  const user=await identity(req),owner=user.userId;
  if(req.method==='GET'){
    if(action==='overview')return response(await controlOverview(owner));
    if(action==='preview')return response(await reconciliationPreviewWithOriginals(owner,(await readWorkspace(owner)).state));
    if(action==='status')return response({job:publicJob(await ownRun(owner,new URL(req.url).searchParams.get('id')||''))});
    return response({error:'Okänd kontrollåtgärd.'},404);
  }
  if(req.method!=='POST')return response({error:'Metoden är inte tillåten.'},405);
  if(!req.headers.get('content-type')?.startsWith('application/json'))throw bad('Förfrågan måste innehålla JSON.',415);
  const raw=await req.text();if(raw.length>1000)throw bad('För stor förfrågan.',413);
  let body:Row;try{body=JSON.parse(raw);}catch{throw bad('Ogiltig JSON.');}
  if(!body||Array.isArray(body)||typeof body!=='object')throw bad('Ogiltig förfrågan.');
  if(action==='run'&&Object.keys(body).length===1&&'request_id' in body)return response(await startControl(owner,body.request_id),202);
  if(action==='advance'&&Object.keys(body).length===1&&typeof body.id==='string')return response(await advanceControl(owner,body.id,req));
  throw bad('Kontrollen accepterar endast sitt begärande-ID eller körnings-ID.');
}
export function controlFailure(error:unknown){const e=error as Row;if(e?.message==='AUTH_REQUIRED')return response({error:'Logga in med ChatGPT för att kontrollera betalningarna.'},401);if(e?.message==='ORIGIN_DENIED')return response({error:'Åtgärden måste startas från MG Fakturakoll.'},403);return response({error:e?.safe?e.message:'Betalningskontrollen kunde inte slutföras. Dina sparade uppgifter finns kvar.'},e?.safe?e.status||400:500);}


