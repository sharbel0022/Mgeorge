import {env} from 'cloudflare:workers';
import {db,identity,readWorkspace,response,companyWorkerIdentity,companyWorkerConfigured} from './server';
import {applyCommand,emptyState,invoiceReferenceDecision,now,uid,type Invoice} from './domain';
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
// Keep invoice-number separators. Versioned keys avoid collisions with earlier
// persisted keys that removed separators; the current workspace still supplies
// duplicate checks for those historical registrations.
export const documentInvoiceKey=(i:Row)=>JSON.stringify(['invoice-v2',i.direction,normalize(i.organizationNumber||i.party),String(i.number||'').normalize('NFKC').trim().toUpperCase()]);
const sourceFor=(owner:string,id:string)=>db().prepare('SELECT * FROM gmail_sources WHERE owner=? AND document_id=? ORDER BY created_at LIMIT 1').bind(owner,id).first<Row>();
const referenceOriginal=(extraction:Row):Invoice['referenceOriginal']=>{
  const fields=extraction.fields||extraction.values||{},value=(key:string)=>fields[key]?.provenance?.kind==='openai_document_claim'?undefined:fields[key]&&typeof fields[key]==='object'&&'value' in fields[key]?fields[key].value:fields[key];
  return Object.fromEntries([['invoice_number',value('invoice_number')],['reference',value('reference')],['issuer_name',extraction.details?.supplier?.name]].filter(([,value])=>value!=null));
};
const activeSource="EXISTS(SELECT 1 FROM gmail_sources s WHERE s.owner=document_jobs.owner AND s.document_id=document_jobs.document_id AND s.status='needs_review')";
const idleEngine="NOT EXISTS(SELECT 1 FROM document_jobs busy WHERE busy.owner=document_jobs.owner AND busy.engine=document_jobs.engine AND busy.state='processing' AND busy.lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now'))";
// A receipt is unique to this owner, original and lease. Never retain the live
// lease credential in interpretation history; a fresh lease has a new run ID.
const documentRunId=(owner:string,job:Row)=>digest(JSON.stringify(['document-job-v1',owner,job.document_id,job.lease]));
const unrecordedLease=`state='processing' AND lease=? AND lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${activeSource} AND COALESCE(json_extract(CASE WHEN json_valid(extraction) THEN extraction ELSE '{}' END,'$.processing.run_id'),'')<>?`;
const AFTERCHECK_WARNING='Fakturan är registrerad. Efterkontrollen behöver köras igen via betalningskontrollen.';
const METADATA_WARNING='Bearbetningsresultatet är sparat. Körningens tidsstämpel kunde inte uppdateras.';
const PROCESSING_STATUS_WARNING='Bearbetningsresultatet är sparat. Aktuell köstatus kunde inte fastställas; kontrollera status igen.';

async function registeredOutcome(owner:string,documentId:string,details:Row={}){
  // Registration has already committed. A failed status read must not turn it
  // back into a failed registration or invite a second invoice/OCR attempt.
  try{
    const receipt=await db().prepare('SELECT r.invoice_id,j.error_code FROM document_registrations r LEFT JOIN document_jobs j ON j.owner=r.owner AND j.document_id=r.document_id AND j.invoice_id=r.invoice_id WHERE r.owner=? AND r.document_id=?').bind(owner,documentId).first<Row>();
    const pending=receipt?.error_code==='registration_aftercheck_pending';
    return {registered:true,...details,...(receipt?.invoice_id?{invoice_id:receipt.invoice_id}:{}),aftercheck_pending:pending,...(pending?{warning:AFTERCHECK_WARNING}:{})};
  }catch{return {registered:true,...details,aftercheck_pending:true,warning:AFTERCHECK_WARNING};}
}

const originalIntegrityFailures=new WeakSet<object>();
const originalIntegrity=()=>{const error=Error('original_integrity');originalIntegrityFailures.add(error);return error;};
async function originalBytes(owner:string,job:Row,limit=15000000){
  if(!Number.isSafeInteger(job.size)||job.size<1||job.size>limit||!/^[a-f0-9]{64}$/.test(job.sha256||''))throw originalIntegrity();
  try{
    const object=await env.BUCKET?.get(`${owner}/${job.document_id}`);
    if(!object||object.size!==job.size)throw originalIntegrity();
    const bytes=new Uint8Array(await object.arrayBuffer());
    const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
    if(bytes.length!==job.size||sha256!==job.sha256)throw originalIntegrity();
    return bytes;
  }catch(error){
    if(originalIntegrityFailures.has(error as object))throw error;
    // Do not inspect provider exceptions or confuse unavailable bytes with
    // proven corruption. Only this function can brand an integrity failure.
    throw Error('original_unavailable');
  }
}

export async function processingSettings(user?:{userId:string,email:string}){
  user ||= await identity();
  const email=(user.email||'').toLowerCase();
  const permitted=!!email&&config.DOCUMENT_AUTOMATION_ENABLED==='true'&&email.toLowerCase()===String(config.DOCUMENT_OWNER_EMAIL||'').toLowerCase();
  await db().prepare('INSERT OR IGNORE INTO document_automation(owner,email,enabled,updated_at) VALUES(?,?,?,?)').bind(user.userId,email,permitted?1:0,now()).run();
  return await db().prepare('SELECT * FROM document_automation WHERE owner=?').bind(user.userId).first<Row>();
}
async function reviewReasons(owner:string,total:number){
  // Aggregate inside D1: callers receive neither document IDs nor extracted
  // values. These are overlapping observations from the saved interpretation,
  // not a new original/identity check or permission to register an invoice.
  const limit=500,hasFields="json_type(extraction,'$.fields')='object'";
  const value=(key:string)=>`json_extract(extraction,'$.fields.${key}.value')`;
  const missing=(key:string)=>`NULLIF(TRIM(CAST(${value(key)} AS TEXT)),'') IS NULL`;
  const issue=(text:string)=>`EXISTS(SELECT 1 FROM json_each(extraction,'$.issues') WHERE value='${text}')`;
  const conditions:Record<string,string>={
    uninterpreted:`NOT COALESCE(${hasFields},0)`,
    missing_invoice_number:`${hasFields} AND ${missing('invoice_number')}`,
    missing_party:`${hasFields} AND ${missing('party')}`,
    missing_dates:`${hasFields} AND (${missing('issued_at')} OR ${missing('due_at')})`,
    missing_organization:`${hasFields} AND ${missing('organization_number')}`,
    missing_amount:`${hasFields} AND (${missing('total_cents')} OR json_type(extraction,'$.fields.total_cents.value')<>'integer' OR ${value('total_cents')}<=0)`,
    missing_vat_or_net:`${hasFields} AND (${missing('vat_cents')} OR ${missing('net_cents')})`,
    unverified_counterparty:issue('Motparten behöver verifieras för automatisk registrering.'),
    possible_duplicate:`state='duplicate' OR ${issue('Fakturan verkar redan registrerad. Ingen ny skuld skapas.')}`,
    arithmetic_conflict:"EXISTS(SELECT 1 FROM json_each(extraction,'$.issues') WHERE type='text' AND (value LIKE 'Momsberäkningen%' OR value LIKE 'Radpris, moms%' OR value LIKE 'Radens momssats%' OR value LIKE 'Motstridiga artikelrader%'))",
    identity_conflict:"EXISTS(SELECT 1 FROM json_each(extraction,'$.issues') WHERE type='text' AND (value LIKE '%originalets identiteter.%' OR value LIKE 'Motstridiga värden för organisationsnummer;%' OR value LIKE 'Motstridiga värden för kund eller leverantör;%'))",
    table_incomplete:"json_extract(extraction,'$.details.table_status')='incomplete'",
    interrupted_after_extraction:"error_code='processing_interrupted_after_extraction'",
    low_confidence:`${hasFields} AND (`+['invoice_number','party','organization_number','issued_at','due_at','total_cents','direction','currency'].map(key=>`${value(key)} IS NOT NULL AND COALESCE(json_extract(extraction,'$.fields.${key}.confidence'),0)<0.9`).map(term=>`(${term})`).join(' OR ')+')',
  };
  const keys=Object.keys(conditions);
  const row=await db().prepare(`WITH scoped AS (
    SELECT state,error_code,CASE WHEN length(extraction)<=50000 AND json_valid(extraction) THEN extraction ELSE '{}' END extraction
    FROM document_jobs WHERE owner=? AND state IN ('needs_review','duplicate','failed') AND EXISTS(SELECT 1 FROM gmail_sources s WHERE s.owner=document_jobs.owner AND s.document_id=document_jobs.document_id AND s.status<>'rejected') ORDER BY document_id LIMIT ?
  ), flags AS (SELECT ${keys.map(key=>`CASE WHEN ${conditions[key]} THEN 1 ELSE 0 END ${key}`).join(',')} FROM scoped)
  SELECT COUNT(*) analyzed,${keys.map(key=>`COALESCE(SUM(${key}),0) ${key}`).join(',')},COALESCE(SUM(CASE WHEN ${keys.join('+')}=0 THEN 1 ELSE 0 END),0) other_review FROM flags`).bind(owner,limit).first<Row>();
  return {basis:'stored_extraction',total,analyzed:Number(row?.analyzed||0),limit,truncated:total>Number(row?.analyzed||0),counts:Object.fromEntries([...keys,'other_review'].map(key=>[key,Number(row?.[key]||0)]))};
}
async function queueObservations(owner:string,at:number,enabled:boolean,ocrWorkerRecent:boolean){
  const observedAt=new Date(at).toISOString(),windowStart=new Date(at-86400000).toISOString();
  // EXISTS keeps repeated Gmail observations from multiplying work. These are
  // due jobs, not a claim that a worker or an external scheduler is running.
  // A completed document needs both a durable extraction and a terminal job;
  // retries/history rows and accepted-but-interrupted continuations count once
  // or not at all, never as additional throughput.
  const row=await db().prepare(`WITH clock AS (SELECT ? at,? window_start), completed AS (
    SELECT DISTINCT e.document_id FROM document_extractions e CROSS JOIN clock
    WHERE e.owner=? AND julianday(e.created_at)>=julianday(clock.window_start) AND julianday(e.created_at)<=julianday(clock.at)
  ), scoped AS (
    SELECT j.*,d.created_at original_created_at,c.document_id IS NOT NULL accepted_in_window,EXISTS(SELECT 1 FROM gmail_sources s WHERE s.owner=j.owner AND s.document_id=j.document_id AND s.status='needs_review') active_source
    FROM document_jobs j JOIN documents d ON d.owner=j.owner AND d.id=j.document_id
    LEFT JOIN completed c ON c.document_id=j.document_id
    WHERE j.owner=? AND EXISTS(SELECT 1 FROM gmail_sources s WHERE s.owner=j.owner AND s.document_id=j.document_id AND s.status<>'rejected')
  ), flags AS (
    SELECT scoped.*,clock.*,state IN ('queued','waiting_ocr','processing') AND active_source pending,
      state='processing' AND julianday(lease_until)>julianday(clock.at) live_lease
    FROM scoped CROSS JOIN clock
  ) SELECT
    COALESCE(SUM(pending),0) pending,
    COALESCE(SUM(CASE WHEN active_source AND state='queued' AND engine='cloud' AND attempts<3 AND julianday(available_at)<=julianday(at) THEN 1 ELSE 0 END),0) ready_pdf,
    COALESCE(SUM(CASE WHEN active_source AND state='waiting_ocr' AND engine='local' AND attempts<3 AND julianday(available_at)<=julianday(at) THEN 1 ELSE 0 END),0) ready_ocr,
    COALESCE(SUM(CASE WHEN active_source AND state IN ('queued','waiting_ocr') AND attempts<3 AND julianday(available_at)>julianday(at) THEN 1 ELSE 0 END),0) deferred,
    COALESCE(SUM(CASE WHEN pending AND live_lease THEN 1 ELSE 0 END),0) active,
    COALESCE(SUM(CASE WHEN pending AND state='processing' AND attempts<3 AND julianday(lease_until)<=julianday(at) THEN 1 ELSE 0 END),0) expired_leases,
    COALESCE(SUM(CASE WHEN active_source AND (pending OR state='failed') AND attempts>=3 AND NOT COALESCE(live_lease,0) THEN 1 ELSE 0 END),0) exhausted,
    COALESCE(SUM(CASE WHEN active_source AND state='failed' THEN 1 ELSE 0 END),0) failed,
    MIN(CASE WHEN pending AND julianday(original_created_at)<=julianday(at) THEN original_created_at END) oldest_pending_at,
    MIN(CASE WHEN active_source AND state IN ('queued','waiting_ocr') AND attempts<3 AND julianday(available_at)>julianday(at) THEN available_at END) next_retry_at,
    COALESCE(SUM(CASE WHEN error_code IN ('original_unavailable','original_unavailable_review') THEN 1 ELSE 0 END),0) transport_failures,
    COALESCE(SUM(CASE WHEN error_code IN ('cloud_ocr_failed','local_ocr_failed','pdf_unreadable','page_limit','text_limit') THEN 1 ELSE 0 END),0) ocr_failures,
    COALESCE(SUM(CASE WHEN error_code='original_integrity' THEN 1 ELSE 0 END),0) integrity_failures,
    COALESCE(SUM(CASE WHEN error_code IN ('processing_interrupted_after_extraction','lease_expired','result_receipt_missing') THEN 1 ELSE 0 END),0) interrupted_failures,
    COALESCE(SUM(CASE WHEN state IN ('needs_review','duplicate') AND error_code='' THEN 1 ELSE 0 END),0) document_review,
    COALESCE(SUM(CASE WHEN state IN ('ready','needs_review','duplicate','registered') AND accepted_in_window THEN 1 ELSE 0 END),0) completed_documents
    FROM flags`).bind(observedAt,windowStart,owner,owner).first<Row>();
  const counts=Object.fromEntries(['pending','ready_pdf','ready_ocr','deferred','active','expired_leases','exhausted','failed'].map(key=>[key,Number(row?.[key]||0)]));
  return {
    queue_health:{basis:'current_jobs',observed_at:observedAt,...counts,oldest_pending_at:row?.oldest_pending_at||null,next_retry_at:row?.next_retry_at||null,ocr_worker_unavailable:enabled&&counts.ready_ocr>0&&!ocrWorkerRecent},
    failure_summary:{basis:'current_jobs',transport:Number(row?.transport_failures||0),ocr:Number(row?.ocr_failures||0),integrity:Number(row?.integrity_failures||0),interrupted:Number(row?.interrupted_failures||0),document_review:Number(row?.document_review||0)},
    throughput:{basis:'accepted_extractions_with_terminal_job',window_start:windowStart,window_end:observedAt,completed_documents:Number(row?.completed_documents||0)},
  };
}
export async function processingStatus(owner:string){
  const settings=await db().prepare('SELECT enabled,auto_register,worker_seen,cloud_worker_seen,cloud_worker_completed,last_cloud_run FROM document_automation WHERE owner=?').bind(owner).first<Row>();
  const counts=await db().prepare("SELECT state,COUNT(*) count FROM document_jobs WHERE owner=? AND EXISTS(SELECT 1 FROM gmail_sources s WHERE s.owner=document_jobs.owner AND s.document_id=document_jobs.document_id AND s.status<>'rejected') GROUP BY state").bind(owner).all<Row>();
  const registered=await db().prepare("SELECT COUNT(DISTINCT document_id) count FROM gmail_sources WHERE owner=? AND status='registered'").bind(owner).first<Row>();
  const pending=await db().prepare("SELECT COUNT(*) count FROM document_jobs j JOIN document_registrations r ON r.owner=j.owner AND r.document_id=j.document_id AND r.invoice_id=j.invoice_id WHERE j.owner=? AND j.state='registered' AND j.error_code='registration_aftercheck_pending'").bind(owner).first<Row>();
  const messages=await db().prepare("SELECT COUNT(*) count FROM customer_messages WHERE owner=? AND status='draft'").bind(owner).first<Row>();
  const cloud=(await companyWorkerConfigured(owner))??cloudOcrConfigured(),cloudSeen=settings?.cloud_worker_seen||'',at=Date.now();
  const recent=(seen:string,window:number)=>{const age=at-Date.parse(seen);return Number.isFinite(age)&&age>=0&&age<window;};
  const review=await reviewReasons(owner,counts.results.filter(r=>['needs_review','duplicate','failed'].includes(r.state)).reduce((sum,r)=>sum+Number(r.count),0));
  const observations=await queueObservations(owner,at,settings?.enabled===1,!!(cloud&&recent(cloudSeen,45*60000)||recent(settings?.worker_seen||'',180000)));
  return {enabled:settings?.enabled===1,auto_register:settings?.auto_register===1,worker_last_seen:settings?.worker_seen||'',worker_online:recent(settings?.worker_seen||'',180000),cloud_ocr_configured:cloud,cloud_worker_last_seen:cloudSeen,cloud_worker_recent:cloud&&recent(cloudSeen,45*60000),cloud_last_completed:settings?.cloud_worker_completed||'',last_processed:settings?.last_cloud_run||'',counts:Object.fromEntries(counts.results.map(r=>[r.state,r.count])),registered:registered?.count||0,aftercheck_pending:pending?.count||0,review_reasons:review,...observations,messages_waiting:messages?.count||0,scheduler_configured:config.DOCUMENT_SCHEDULER_CONFIGURED==='true',schedule_minutes:Number(config.DOCUMENT_SCHEDULE_MINUTES)||60,ocr_mode:cloud?'cloud':'local_computer',limits:{file_bytes:15000000,pdf_cloud_bytes:5000000,pages:10,local_concurrency:1,cloud_concurrency:1}};
}
const extractionRecord=(value:string):Row=>{try{return JSON.parse(value)||{};}catch{return {};}};
const receiptFor=(owner:string,documentId:string,runId:string,sha256:string,runner:string)=>db().prepare(`SELECT id,created_at FROM document_extractions
  WHERE owner=? AND document_id=?
  AND json_extract(CASE WHEN json_valid(result) THEN result ELSE '{}' END,'$.processing.run_id')=?
  AND json_extract(CASE WHEN json_valid(result) THEN result ELSE '{}' END,'$.processing.sha256')=?
  AND json_extract(CASE WHEN json_valid(result) THEN result ELSE '{}' END,'$.processing.runner')=?
  ORDER BY created_at,id LIMIT 1`).bind(owner,documentId,runId,sha256,runner).first<Row>();
const reviewExtraction=(serialized:string,reason:string)=>{
  const extraction=extractionRecord(serialized);
  if(extraction.level!=='green')return serialized;
  return JSON.stringify({...extraction,level:'yellow',issues:[...(Array.isArray(extraction.issues)?extraction.issues:[]),reason]});
};
async function recoverInterruptedExtraction(owner:string,job:Row):Promise<'handled'|'deferred'|void>{
  const extraction=extractionRecord(job.extraction),runId=await documentRunId(owner,job);
  if(extraction.processing?.run_id!==runId)return;
  const receipt=await receiptFor(owner,job.document_id,runId,extraction.processing.sha256,job.lease_runner||'local');
  let state='needs_review',code='processing_interrupted_after_extraction',savedExtraction=reviewExtraction(job.extraction,'Bearbetningen avbröts efter sparad tolkning. Kontrollera underlaget.');
  try{
    if(!receipt||extraction.processing.sha256!==job.sha256)throw originalIntegrity();
    await originalBytes(owner,job);
  }catch(error){
    if(originalIntegrityFailures.has(error as object)){
      state='failed';code=receipt?'original_integrity':'result_receipt_missing';
      savedExtraction=reviewExtraction(job.extraction,'Originalunderlagets integritet behöver kontrolleras.');
    }else{
      // Bound automatic storage recovery by the immutable acceptance time.
      // Delays survive restarts; a retained result never consumes another OCR
      // attempt. After one day it remains available for explicit human review.
      const acceptedAt=Date.parse(receipt!.created_at),age=Date.now()-acceptedAt;
      if(Number.isFinite(age)&&age>=0&&age<86400000){
        const at=now(),available=new Date(Date.now()+60000).toISOString();
        await db().prepare(`UPDATE document_jobs SET error_code='original_unavailable',available_at=?,updated_at=?
          WHERE owner=? AND document_id=? AND state='processing' AND attempts=? AND lease=? AND extraction=?
          AND lease_until=? AND lease_until<strftime('%Y-%m-%dT%H:%M:%fZ','now') AND available_at=? AND ${activeSource}
          AND NOT EXISTS(SELECT 1 FROM document_registrations r WHERE r.owner=document_jobs.owner AND r.document_id=document_jobs.document_id)`)
          .bind(available,at,owner,job.document_id,job.attempts,job.lease,job.extraction,job.lease_until,job.available_at).run();
        return 'deferred';
      }
      code='original_unavailable_review';
      savedExtraction=reviewExtraction(job.extraction,'Originalunderlaget är tillfälligt otillgängligt. Kontrollera det före registrering.');
    }
  }
  await db().prepare(`UPDATE document_jobs SET state=?,error_code=?,extraction=?,lease='',lease_until='',updated_at=?
      WHERE owner=? AND document_id=? AND state='processing' AND attempts=? AND lease=? AND extraction=?
      AND lease_until=? AND lease_until<strftime('%Y-%m-%dT%H:%M:%fZ','now') AND available_at=? AND ${activeSource}
      AND (? IS NULL OR EXISTS(SELECT 1 FROM document_extractions e WHERE e.owner=document_jobs.owner AND e.document_id=document_jobs.document_id AND e.id=?))
      AND ((? IS NULL AND NOT EXISTS(SELECT 1 FROM documents d WHERE d.owner=document_jobs.owner AND d.id=document_jobs.document_id))
        OR EXISTS(SELECT 1 FROM documents d WHERE d.owner=document_jobs.owner AND d.id=document_jobs.document_id AND d.sha256=? AND d.size=?))
      AND NOT EXISTS(SELECT 1 FROM document_registrations r WHERE r.owner=document_jobs.owner AND r.document_id=document_jobs.document_id)`)
      .bind(state,code,savedExtraction,now(),owner,job.document_id,job.attempts,job.lease,job.extraction,job.lease_until,job.available_at,receipt?.id??null,receipt?.id??null,job.sha256??null,job.sha256??null,job.size??null).run();
  // A lost snapshot is not an unrecorded expired attempt. Reevaluate it on
  // the next pass; never fall through to the generic exhaustion transition.
  return 'handled';
}
async function recoverInterruptedExtractions(owner:string,at:string){
  // Every attempt can commit before losing its continuation. Bound each pass
  // to two rows and leave unchecked receipts intact for the next pass.
  const jobs=await db().prepare(`SELECT document_jobs.*,d.size,d.sha256 FROM document_jobs LEFT JOIN documents d ON d.owner=document_jobs.owner AND d.id=document_jobs.document_id
    WHERE document_jobs.owner=? AND state='processing' AND lease_until<? AND available_at<=?
    AND ${activeSource}
    AND (attempts>=3 OR json_extract(CASE WHEN json_valid(extraction) THEN extraction ELSE '{}' END,'$.processing.run_id') IS NOT NULL)
    AND NOT EXISTS(SELECT 1 FROM document_registrations r WHERE r.owner=document_jobs.owner AND r.document_id=document_jobs.document_id)
    ORDER BY lease_until,document_id LIMIT 2`).bind(owner,at,at).all<Row>();
  for(const job of jobs.results){
    if(await recoverInterruptedExtraction(owner,job))continue;
    await db().prepare(`UPDATE document_jobs SET state='failed',error_code='lease_expired',lease='',lease_until='',updated_at=?
      WHERE owner=? AND document_id=? AND state='processing' AND attempts=? AND attempts>=3 AND lease=? AND extraction=?
      AND lease_until=? AND lease_until<strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND NOT EXISTS(SELECT 1 FROM document_registrations r WHERE r.owner=document_jobs.owner AND r.document_id=document_jobs.document_id)`)
      .bind(now(),owner,job.document_id,job.attempts,job.lease,job.extraction,job.lease_until).run();
  }
}
export async function enqueueDocuments(owner:string){
  const at=now();
  await recoverInterruptedExtractions(owner,at);
  await db().prepare(`INSERT OR IGNORE INTO document_jobs(owner,document_id,state,engine,available_at,updated_at) SELECT DISTINCT d.owner,d.id,CASE WHEN d.mime='application/pdf' AND d.size<=5000000 THEN 'queued' ELSE 'waiting_ocr' END,CASE WHEN d.mime='application/pdf' AND d.size<=5000000 THEN 'cloud' ELSE 'local' END,?,? FROM documents d JOIN gmail_sources s ON s.owner=d.owner AND s.document_id=d.id WHERE d.owner=? AND s.status='needs_review' AND NOT EXISTS(SELECT 1 FROM gmail_sources x WHERE x.owner=d.owner AND x.document_id=d.id AND x.status='registered')`).bind(at,at,owner).run();
}
async function claim(owner:string,engine:string,runner='server'):Promise<Row|null>{
  const at=now(),wanted=engine==='cloud'?'queued':'waiting_ocr';
  const job=await db().prepare(`SELECT document_jobs.*,d.mime,d.size,d.sha256 FROM document_jobs JOIN documents d ON d.owner=document_jobs.owner AND d.id=document_jobs.document_id WHERE document_jobs.owner=? AND engine=? AND attempts<3 AND available_at<=? AND (state=? OR (state='processing' AND lease_until<?)) AND ${activeSource} AND ${idleEngine} ORDER BY available_at,document_id LIMIT 1`).bind(owner,engine,at,wanted,at).first<Row>();
  if(!job)return null;
  // The bounded recovery pass may not have reached this receipt. Never give
  // accepted output a fresh run identity. An explicit review retry has an
  // empty lease and therefore a different run ID.
  if(job.state==='processing'&&extractionRecord(job.extraction).processing?.run_id===await documentRunId(owner,job)){
    await recoverInterruptedExtraction(owner,job);
    return null;
  }
  const lease=randomToken(),until=new Date(Date.now()+(runner==='cloud'?300000:180000)).toISOString();
  // A per-document compare-and-swap prevents duplicate work on that original;
  // the engine guard also bounds overlapping runners on different originals.
  // Recheck it under the write lock, using the database clock for live leases.
  const r=await db().prepare(`UPDATE document_jobs SET state='processing',attempts=attempts+1,lease=?,lease_until=?,lease_runner=?,updated_at=? WHERE owner=? AND document_id=? AND engine=? AND attempts=? AND attempts<3 AND extraction=? AND lease=? AND available_at<=? AND (state=? OR (state='processing' AND lease_until<?)) AND ${activeSource} AND ${idleEngine}`).bind(lease,until,runner,at,owner,job.document_id,engine,job.attempts,job.extraction,job.lease,at,wanted,at).run();
  return r.meta.changes===1?{...job,lease,lease_until:until,lease_runner:runner,attempts:job.attempts+1}:null;
}
async function failJob(owner:string,job:Row,code:string){
  const retry=job.attempts<3;
  const saved=await db().prepare(`UPDATE document_jobs SET state=?,error_code=?,available_at=?,lease='',lease_until='',updated_at=? WHERE owner=? AND document_id=? AND ${unrecordedLease}`).bind(retry?(job.engine==='local'?'waiting_ocr':'queued'):'failed',code,new Date(Date.now()+Math.min(job.attempts*60000,180000)).toISOString(),now(),owner,job.document_id,job.lease,await documentRunId(owner,job)).run();
  return saved.meta.changes===1;
}
export async function registerProcessedInvoice(owner:string,documentId:string,raw:Row,fields:Row,options:{automatic?:boolean,lease?:string,trust?:Row,sha256?:string}={}){
  for(let attempt=0;attempt<3;attempt++){
    const source=await sourceFor(owner,documentId);if(!source||!['needs_review','registered'].includes(source.status))throw safe('Underlaget kan inte registreras i detta läge.');
    if(source.status==='registered')return registeredOutcome(owner,documentId,{duplicate:true});
    const document=await db().prepare('SELECT size,sha256 FROM documents WHERE owner=? AND id=?').bind(owner,documentId).first<Row>();
    try{
      if(!document||options.automatic&&options.sha256!==document.sha256)throw Error('original_integrity');
      await originalBytes(owner,{...document,document_id:documentId});
    }catch{throw safe('Originalunderlaget kunde inte integritetskontrolleras. Kontrollera originalet före registrering.');}
    const old=await readWorkspace(owner),invoice:Row={...raw,documentId,reviewed:true,source:'Gmail: '+JSON.parse(source.metadata).subject};delete invoice.id;delete invoice.referenceOriginal;
    // Capture the current original interpretation independently of editable
    // review fields. A current worker extraction supersedes older Gmail data.
    const job=await db().prepare('SELECT extraction FROM document_jobs WHERE owner=? AND document_id=?').bind(owner,documentId).first<Row>();
    const currentExtraction=JSON.parse(job?.extraction||'{}'),extraction=Object.keys(currentExtraction).length?currentExtraction:JSON.parse(source.extraction);
    if(options.automatic&&extraction.ai?.requiresHumanReview===true)throw safe('AI-förslaget kräver granskning mot originalet före registrering.');
    if(invoiceReferenceDecision(old.state,invoice as Invoice).applies){
      invoice.referenceOriginal=referenceOriginal(extraction);
      const policy=invoiceReferenceDecision(old.state,invoice as Invoice);
      if(options.automatic&&policy.status==='BLOCKED')throw safe(policy.reason);
    }
    const checks={issued_at:invoice.issued,due_at:invoice.due,total_cents:invoice.total,organization_number:fields.organization_number||null,currency:fields.currency,vat_cents:fields.vat_cents,net_cents:fields.net_cents};
    const issues=validateInvoiceValues(checks);if(fields.currency!=='SEK'||!invoice.due||!['receivable','payable'].includes(invoice.direction))issues.push('Kontrollera datum, valuta och fakturatyp.');
    if(issues.length)throw safe(issues.join(' '));
    if(invoice.kind&&invoice.kind!=='invoice')throw safe('Dokumentet är inte en vanlig faktura.');
    invoice.organizationNumber=fields.organization_number||'';invoice.vat=checks.vat_cents??null;invoice.net=checks.net_cents??null;
    const key=documentInvoiceKey(invoice),same=old.state.invoices.filter(i=>!i.voided&&documentInvoiceKey(i)===key);
    if(same.length){
      // Another confirmation can commit while this request verifies the
      // original. Only that same document's committed receipt is a replay.
      const receipt=await db().prepare("SELECT r.invoice_id FROM document_registrations r WHERE r.owner=? AND r.document_id=? AND EXISTS(SELECT 1 FROM gmail_sources s WHERE s.owner=r.owner AND s.document_id=r.document_id AND s.status='registered')").bind(owner,documentId).first<Row>();
      if(receipt&&same.some(i=>i.id===receipt.invoice_id&&i.documentId===documentId))return registeredOutcome(owner,documentId,{duplicate:true,invoice_id:receipt.invoice_id});
      throw safe(same.some(i=>i.total!==invoice.total)?'Samma faktura finns med ett annat belopp. Kontrollera originalposten.':'Fakturan finns redan registrerad. Ingen ny skuld har skapats.');
    }
    const result=applyCommand(old.state,{type:'invoice.save',invoice});
    if(JSON.stringify(result.state).length>1800000)throw safe('Registret behöver utökad lagring.');
    const saved=result.state.invoices.find(i=>i.documentId===documentId)!;
    const at=now(),receipt=uid();
    await db().prepare('INSERT OR IGNORE INTO workspaces(owner,revision,payload,updated_at) VALUES(?,0,?,?)').bind(owner,JSON.stringify(emptyState()),at).run();
    const guard=` AND EXISTS(SELECT 1 FROM documents d WHERE d.owner=? AND d.id=? AND d.sha256=? AND d.size=?) AND EXISTS(SELECT 1 FROM gmail_sources s WHERE s.owner=? AND s.source_id=? AND s.document_id=? AND s.extraction=?)`+(job?` AND EXISTS(SELECT 1 FROM document_jobs j WHERE j.owner=? AND j.document_id=? AND j.extraction=?)`:` AND NOT EXISTS(SELECT 1 FROM document_jobs j WHERE j.owner=? AND j.document_id=?)`)+(options.automatic?` AND EXISTS(SELECT 1 FROM document_jobs j WHERE j.owner=? AND j.document_id=? AND j.state='processing' AND j.lease=? AND j.lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND EXISTS(SELECT 1 FROM invoice_counterparties c WHERE c.owner=? AND c.identity=? AND c.version=?) AND EXISTS(SELECT 1 FROM document_automation a WHERE a.owner=? AND a.enabled=1 AND a.auto_register=1)`:'');
    const binds=[owner,documentId,document!.sha256,document!.size,owner,source.source_id,documentId,source.extraction,owner,documentId,...(job?[job.extraction]:[]),...(options.automatic?[owner,documentId,options.lease,owner,options.trust!.identity,options.trust!.version,owner]:[])];
    let batch;
    try{batch=await db().batch([
      db().prepare(`INSERT INTO document_registrations(owner,document_id,identity,invoice_id,attempt,total,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspaces WHERE owner=? AND revision=?) AND EXISTS(SELECT 1 FROM gmail_sources WHERE owner=? AND document_id=? AND status='needs_review')${guard}`).bind(owner,documentId,key,saved.id,receipt,invoice.total,at,owner,old.revision,owner,documentId,...binds),
      db().prepare('UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE owner=? AND revision=? AND EXISTS(SELECT 1 FROM document_registrations WHERE owner=? AND document_id=? AND attempt=?)').bind(JSON.stringify(result.state),at,owner,old.revision,owner,documentId,receipt),
      db().prepare("UPDATE gmail_sources SET status='registered' WHERE owner=? AND document_id=? AND EXISTS(SELECT 1 FROM document_registrations WHERE owner=? AND document_id=? AND attempt=?)").bind(owner,documentId,owner,documentId,receipt),
      // Persist after-check recovery in the same transaction as the invoice,
      // including a manual registration made before any OCR job was enqueued.
      db().prepare("INSERT INTO document_jobs(owner,document_id,state,available_at,extraction,error_code,invoice_id,automatic,updated_at) SELECT ?,?,'registered',?,?,'registration_aftercheck_pending',?,?,? WHERE EXISTS(SELECT 1 FROM document_registrations WHERE owner=? AND document_id=? AND attempt=?) ON CONFLICT(owner,document_id) DO UPDATE SET state='registered',invoice_id=excluded.invoice_id,automatic=excluded.automatic,error_code=excluded.error_code,lease='',lease_until='',updated_at=excluded.updated_at").bind(owner,documentId,at,source.extraction,saved.id,options.automatic?1:0,at,owner,documentId,receipt),
      db().prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM document_registrations WHERE owner=? AND document_id=? AND attempt=?)').bind(uid(),owner,old.revision+1,options.automatic?'gmail.invoice.automatic':'gmail.invoice.review',JSON.stringify({invoice,fields,extraction:JSON.parse(source.extraction),message:result.message}),at,owner,documentId,receipt),
    ]);}catch(e){if((await sourceFor(owner,documentId))?.status==='registered')return registeredOutcome(owner,documentId,{duplicate:true});throw e;}
    if(batch[1].meta.changes===1){
      const committed={invoice_id:saved.id,automatic:!!options.automatic};
      try{await (await import('./customer-messages')).reconcileAndPrepare(owner);}
      catch{return {registered:true,...committed,aftercheck_pending:true,warning:AFTERCHECK_WARNING};}
      return registeredOutcome(owner,documentId,committed);
    }
    if(options.automatic)throw safe('Underlaget ändrades under bearbetningen. Ny kontroll behövs.');
  }
  throw safe('Uppgifterna ändrades samtidigt. Försök igen.');
}
async function finish(owner:string,job:Row,result:{text:string,method:string,confidence:number,ocrEvidence?:any}){
  const source=await sourceFor(owner,job.document_id);if(source?.status!=='needs_review')return {ignored:true};
  const meta=JSON.parse(source.metadata);let extraction:Row=interpretInvoice(result.text,{direction:meta.direction,direction_confident:meta.direction_confident&&!meta.forwarded,method:result.method,ocrConfidence:result.confidence,filename:meta.original_filename||'',subject:meta.subject||'',ocrEvidence:result.ocrEvidence,ocrInputSha256:job.sha256});
  if(config.OPENAI_INVOICES_ENABLED==='true'){
    const {enrichSitesInvoice}=await import('./openai-invoices/sites.js');
    extraction=await enrichSitesInvoice({database:db(),owner,job,baseline:extraction,environment:config,loadBytes:()=>originalBytes(owner,job,5000000)});
  }
  const runId=await documentRunId(owner,job);
  Object.assign(extraction,{processing:{runner:job.lease_runner||'local',sha256:job.sha256,version:'document-worker-v3',run_id:runId}});
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
  const w=await readWorkspace(owner),invoice={direction:v.direction==='customer'?'receivable' as const:'payable' as const,party:v.party,number:v.invoice_number,ocr:v.reference||'',organizationNumber:v.organization_number,total:v.total_cents,referenceOriginal:referenceOriginal(extraction)};
  const referencePolicy=invoiceReferenceDecision(w.state,invoice);Object.assign(extraction,{referencePolicy});
  if(referencePolicy.applies&&referencePolicy.status==='BLOCKED'){extraction.issues.push(referencePolicy.reason);extraction.level='yellow';}
  const duplicate=w.state.invoices.some(i=>!i.voided&&documentInvoiceKey(i)===documentInvoiceKey(invoice));
  if(duplicate){extraction.issues.push('Fakturan verkar redan registrerad. Ingen ny skuld skapas.');extraction.level='yellow';}
  const at=now(),state=duplicate?'duplicate':'needs_review',serialized=JSON.stringify(extraction),extractionId=uid();
  // A unique history row is the receipt for this atomic save. Validate the
  // lease, previously unrecorded run and original snapshot under the write
  // lock. Overlapping responses cannot replace the first accepted evidence,
  // including when its continuation fails or the deadline passes in the batch.
  const saved=await db().batch([
    db().prepare(`INSERT INTO document_extractions(id,owner,document_id,result,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM document_jobs WHERE owner=? AND document_id=? AND ${unrecordedLease}) AND EXISTS(SELECT 1 FROM documents WHERE owner=? AND id=? AND sha256=? AND size=?)`).bind(extractionId,owner,job.document_id,serialized,at,owner,job.document_id,job.lease,runId,owner,job.document_id,job.sha256,job.size),
    db().prepare("UPDATE document_jobs SET extraction=?,error_code='',updated_at=? WHERE owner=? AND document_id=? AND EXISTS(SELECT 1 FROM document_extractions WHERE owner=? AND document_id=? AND id=?)").bind(serialized,at,owner,job.document_id,owner,job.document_id,extractionId),
    db().prepare("UPDATE gmail_sources SET extraction=? WHERE owner=? AND document_id=? AND extraction='{}' AND EXISTS(SELECT 1 FROM document_extractions WHERE owner=? AND document_id=? AND id=?)").bind(serialized,owner,job.document_id,owner,job.document_id,extractionId),
  ]);
  if(saved[0].meta.changes!==1)return {ignored:true};
  const settings=await db().prepare('SELECT * FROM document_automation WHERE owner=?').bind(owner).first<Row>();
  if(!duplicate&&trust&&extraction.level==='green'&&extraction.ai?.requiresHumanReview!==true&&settings?.enabled&&settings.auto_register){
    try{return await registerProcessedInvoice(owner,job.document_id,{...invoice,issued:v.issued_at,due:v.due_at,ocr:v.reference||'',bankgiro:v.bankgiro||'',email:'',kind:v.kind},{organization_number:v.organization_number,currency:v.currency,vat_cents:v.vat_cents,net_cents:v.net_cents},{automatic:true,lease:job.lease,trust,sha256:job.sha256});}
    catch(e){extraction.level='yellow';extraction.issues.push('Automatisk registrering stoppades. Kontrollera underlaget.');}
  }
  const finalState=duplicate?'duplicate':extraction.level==='green'?'ready':state;
  const finalAt=now();
  const finalized=await db().prepare(`UPDATE document_jobs SET state=?,extraction=?,lease='',lease_until='',updated_at=? WHERE owner=? AND document_id=? AND lease=? AND lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND state='processing' AND ${activeSource}`).bind(finalState,JSON.stringify(extraction),finalAt,owner,job.document_id,job.lease).run();
  if(finalized.meta.changes!==1)return {ignored:true};
  return {state:finalState,level:extraction.level};
}
async function finalizeProcessing(owner:string,processed:number,interruption?:{error:unknown}){
  // The count records only finish() outcomes already accepted by the database.
  // Every later failure converges here. Unknown status has no synthetic queue
  // totals or timestamps, and no more awaits can erase the accepted outcome.
  const unknown=()=>({processed,status_unknown:true as const,metadata_warning:PROCESSING_STATUS_WARNING});
  if(interruption){if(processed===0)throw interruption.error;return unknown();}
  let metadataWarning='';
  try{await db().prepare('UPDATE document_automation SET last_cloud_run=?,updated_at=? WHERE owner=?').bind(now(),now(),owner).run();}
  catch(error){if(processed===0)throw error;metadataWarning=METADATA_WARNING;}
  try{return {processed,...await processingStatus(owner),status_unknown:false as const,...(metadataWarning?{metadata_warning:metadataWarning}:{})};}
  catch(error){if(processed===0)throw error;return unknown();}
}
export async function processDocuments(owner:string,limit=2){
  let processed=0;
  try{
    await enqueueDocuments(owner);
    for(let n=0;n<limit;n++){
      const job=await claim(owner,'cloud');if(!job)break;
      try{
        const bytes=await originalBytes(owner,job,5000000);
        const result=await serverPdfText(bytes),completed=await finish(owner,job,result);if(!('ignored' in completed))processed++;
      }catch(e){
        const code=e instanceof Error?e.message:'';
        if(['local_ocr_required','parse_timeout'].includes(code))await db().prepare(`UPDATE document_jobs SET state='waiting_ocr',engine='local',attempts=0,lease='',lease_until='',updated_at=? WHERE owner=? AND document_id=? AND ${unrecordedLease}`).bind(now(),owner,job.document_id,job.lease,await documentRunId(owner,job)).run();
        else await failJob(owner,job,['page_limit','text_limit','original_integrity','original_unavailable'].includes(code)?code:'pdf_unreadable');
      }
    }
  }catch(error){return finalizeProcessing(owner,processed,{error});}
  return finalizeProcessing(owner,processed);
}
export async function retryInvoiceDocument(owner:string,documentId:unknown):Promise<{ok:true,requeued:boolean}>{
  if(typeof documentId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(documentId))throw safe('Välj ett giltigt underlag.');
  const result=await db().prepare(`UPDATE document_jobs SET state=CASE WHEN engine='local' THEN 'waiting_ocr' ELSE 'queued' END,attempts=0,available_at=?,lease='',lease_until='',updated_at=? WHERE owner=? AND document_id=? AND state IN ('failed','needs_review','duplicate') AND ${activeSource}`).bind(now(),now(),owner,documentId).run();
  return {ok:true,requeued:result.meta.changes===1};
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
    return response(await retryInvoiceDocument(user.userId,body.document_id));
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
  const scoped=await companyWorkerIdentity(req);
  if(scoped){await db().prepare(scoped.mode==='cloud'?'UPDATE document_automation SET cloud_worker_seen=? WHERE owner=?':'UPDATE document_automation SET worker_seen=? WHERE owner=?').bind(now(),scoped.owner).run();return scoped;}
  const mode=req.headers.get('x-mg-ocr-runner')||'local';
  if(!['cloud','local'].includes(mode)||mode==='cloud'&&!cloudOcrConfigured())throw Error('WORKER_AUTH');
  const token=req.headers.get('authorization')?.replace(/^Bearer /,'')||'',secret=(mode==='cloud'?config.DOCUMENT_CLOUD_WORKER_TOKEN:config.DOCUMENT_WORKER_TOKEN)||'';
  if(!/^[A-Za-z0-9_-]{43}$/.test(secret)||token.length!==secret.length||await digest(token)!==await digest(secret))throw Error('WORKER_AUTH');
  const rows=await db().prepare('SELECT owner FROM document_automation WHERE lower(email)=lower(?) AND enabled=1 LIMIT 2').bind(config.DOCUMENT_OWNER_EMAIL||'').all<Row>();
  if(rows.results.length!==1)throw Error('WORKER_AUTH');
  const owner=rows.results[0].owner as string;
  await db().prepare(mode==='cloud'?'UPDATE document_automation SET cloud_worker_seen=? WHERE owner=?':'UPDATE document_automation SET worker_seen=? WHERE owner=?').bind(now(),owner).run();return {owner,mode};
}
async function workerIdentityBody(req:Request):Promise<string|null>{
  const reader=req.body?.getReader();if(!reader)return '';
  const bytes=new Uint8Array(4096);let size=0;
  try{
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      if(size+value.byteLength>bytes.length){
        // Cancellation is cleanup, never an unbounded provider wait.
        void reader.cancel().catch(()=>{});return null;
      }
      bytes.set(value,size);size+=value.byteLength;
    }
  }finally{reader.releaseLock();}
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size));
}
export async function workerAction(req:Request,action:string){
  const {owner,mode}=await workerOwner(req);
  if(action==='process'&&req.method==='POST'&&mode==='cloud'){
    const result=await processDocuments(owner,2);
    if(result.status_unknown)return response(result);
    return response({processed:result.processed,waiting:Number(result.counts.waiting_ocr||0),failed:Number(result.counts.failed||0),...(result.aftercheck_pending?{aftercheck_pending:result.aftercheck_pending}:{}),...(result.metadata_warning?{metadata_warning:result.metadata_warning}:{})});
  }
  if(action==='lease'&&req.method==='POST'){
    await enqueueDocuments(owner);const job=await claim(owner,'local',mode);if(!job)return response({job:null});
    return response({job:{id:job.document_id,lease:job.lease,mime:job.mime,size:job.size,sha256:job.sha256,protocol:2,run_id:await documentRunId(owner,job),lease_until:job.lease_until}});
  }
  if((action==='heartbeat'||action==='receipt')&&req.method==='POST'){
    let body:Row;
    try{
      const raw=await workerIdentityBody(req);
      if(raw===null)return response({error:'För stor begäran.'},413);
      body=JSON.parse(raw);
    }catch{return response({error:'Ogiltigt jobb.'},400);}
    if(!body||typeof body.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(body.id)||typeof body.lease!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.lease)||typeof body.sha256!=='string'||!/^[a-f0-9]{64}$/.test(body.sha256))return response({error:'Ogiltigt jobb.'},400);
    const job=await db().prepare(`SELECT document_jobs.*,d.sha256,d.size FROM document_jobs JOIN documents d ON d.owner=document_jobs.owner AND d.id=document_jobs.document_id WHERE document_jobs.owner=? AND document_id=? AND engine='local'`).bind(owner,body.id).first<Row>();
    if(!job||job.sha256!==body.sha256)return response({error:'Jobbet har ändrats eller gått ut.'},409);
    const runId=await documentRunId(owner,{document_id:body.id,lease:body.lease}),identity={id:body.id,sha256:body.sha256,run_id:runId};
    if(action==='receipt'){
      const receipt=await receiptFor(owner,body.id,runId,body.sha256,mode);
      if(receipt){
        const current=extractionRecord(job.extraction).processing;
        const settled=current?.run_id===runId&&current.sha256===body.sha256&&current.runner===mode&&['ready','needs_review','duplicate','registered'].includes(job.state);
        return response({accepted:true,settled,state:job.state,...identity,accepted_at:receipt.created_at,...(settled&&job.state==='registered'?{aftercheck_pending:job.error_code==='registration_aftercheck_pending'}:{})});
      }
    }
    const live=await db().prepare(`SELECT updated_at,lease_until FROM document_jobs WHERE owner=? AND document_id=? AND lease_runner=? AND ${unrecordedLease}
      AND EXISTS(SELECT 1 FROM documents d WHERE d.owner=document_jobs.owner AND d.id=document_jobs.document_id AND d.sha256=? AND d.size=?)`)
      .bind(owner,body.id,mode,body.lease,runId,body.sha256,job.size).first<Row>();
    if(!live)return response({error:'Jobbet har ändrats eller gått ut.'},409);
    if(action==='receipt')return response({accepted:false,retryable:true,...identity});
    // updated_at is the claim time until a result is accepted. Heartbeats only
    // change lease_until, never that anchor or the attempt count.
    const at=Date.now(),horizon=Date.parse(live.updated_at)+600000;
    if(!Number.isFinite(horizon)||horizon<=at)return response({error:'Jobbets tidsgräns har nåtts.'},409);
    const until=new Date(Math.min(horizon,Math.max(Date.parse(live.lease_until),at+(mode==='cloud'?300000:180000)))).toISOString();
    const renewed=await db().prepare(`UPDATE document_jobs SET lease_until=? WHERE owner=? AND document_id=? AND lease_runner=? AND updated_at=? AND lease_until=? AND ${unrecordedLease}
      AND julianday(updated_at,'+10 minutes')>julianday('now')
      AND EXISTS(SELECT 1 FROM documents d WHERE d.owner=document_jobs.owner AND d.id=document_jobs.document_id AND d.sha256=? AND d.size=?)`)
      .bind(until,owner,body.id,mode,live.updated_at,live.lease_until,body.lease,runId,body.sha256,job.size).run();
    if(renewed.meta.changes!==1)return response({error:'Jobbet har ändrats eller gått ut.'},409);
    return response({ok:true,run_id:runId,lease_until:until});
  }
  if(action==='document'&&req.method==='GET'){
    const id=new URL(req.url).searchParams.get('id'),lease=req.headers.get('x-mg-ocr-lease');
    const j=await db().prepare(`SELECT document_jobs.* FROM document_jobs WHERE owner=? AND document_id=? AND lease=? AND lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND lease_runner=? AND state='processing' AND engine='local' AND ${activeSource}`).bind(owner,id,lease,mode).first<Row>();
    if(!j)return response({error:'Jobbet är inte längre tillgängligt.'},409);
    const file=await env.BUCKET?.get(`${owner}/${id}`);if(!file||file.size>15000000)return response({error:'Filen kan inte behandlas.'},413);
    return new Response(file.body,{headers:{'Content-Type':'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Length':String(file.size)}});
  }
  if(action==='complete'&&req.method==='POST'){
    const raw=await req.text();if(raw.length>350000)return response({error:'För stort resultat.'},413);const body=JSON.parse(raw);
    const job=await db().prepare(`SELECT document_jobs.*,d.sha256,d.size,d.mime FROM document_jobs JOIN documents d ON d.owner=document_jobs.owner AND d.id=document_jobs.document_id WHERE document_jobs.owner=? AND document_id=? AND lease=? AND lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND lease_runner=? AND state='processing' AND engine='local' AND ${activeSource}`).bind(owner,body.id,body.lease,mode).first<Row>();
    if(!job)return response({error:'Jobbet har ändrats eller gått ut.'},409);
    if(body.sha256!==job.sha256||typeof body.text!=='string'||body.text.length>150000||!['pdf','ocr'].includes(body.method)||!Number.isFinite(body.confidence)||body.confidence<0||body.confidence>100)return response({error:'Ogiltigt OCR-resultat.'},400);
    if(body.error===true)return response(await failJob(owner,job,mode==='cloud'?'cloud_ocr_failed':'local_ocr_failed')?{ok:true}:{ignored:true});
    // The worker's digest describes the bytes it read earlier. Recheck the
    // retained original before accepting its text or using it for registration.
    try{await originalBytes(owner,job);}catch(error){
      if(!originalIntegrityFailures.has(error as object))return Response.json({error:'Originalunderlaget är tillfälligt otillgängligt.',code:'original_unavailable'},{status:503,headers:{'Retry-After':'60','Cache-Control':'no-store'}});
      if(!await failJob(owner,job,'original_integrity'))return response({ignored:true});
      return response({error:'Originalunderlaget kunde inte integritetskontrolleras. Kontrollera originalet före ny tolkning.'},409);
    }
    // This endpoint leases OCR work, including PDFs that server extraction
    // could not read. A worker's method claim cannot prove native PDF text:
    // only serverPdfText's original-byte processing grants that provenance.
    // Keep legacy PDF worker completions compatible, under the OCR cap.
    const result=await finish(owner,job,{text:body.text,method:'ocr',confidence:body.confidence,ocrEvidence:body.ocrEvidence});
    if(mode==='cloud'&&!('ignored' in result)){
      try{await db().prepare('UPDATE document_automation SET cloud_worker_completed=? WHERE owner=?').bind(now(),owner).run();}
      catch{return response({...result,metadata_warning:METADATA_WARNING});}
    }
    return response(result);
  }
  return response({error:'Okänd åtgärd.'},404);
}
