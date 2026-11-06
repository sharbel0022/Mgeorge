import {env} from 'cloudflare:workers';
import {Buffer} from 'node:buffer';
import {db,identity,response,readWorkspace,companyGmailAccount} from './server';
import {uid,now,emptyState,applyCommand} from './domain';
import {parseMoney} from './domain';
import {validateInvoiceValues} from './invoice-fields.js';
import {processingSettings,processingStatus,processDocuments,processingAction,registerProcessedInvoice} from './document-processing';
import {encrypt,decrypt,storageReady} from './banking/store';
import {digest,randomToken,cookieValue} from './banking/security';
import {hasGmailSendScope,isGmailConfigured,gmailAuthorizationUrl,exchangeGmailCode,gmailProfile,fetchGmailInvoiceDocuments,revokeGmailTokens} from './gmail-adapter.js';

type GmailLease={assert:()=>Promise<void>;write:(statements:any[])=>Promise<any[]>};
const POSTPROCESS_WARNING='Gmail-underlagen är sparade. Efterkontrollen behöver återupptas. Kör Gmail-hämtningen igen när väntetiden har gått ut.';
const SYNC_METADATA_WARNING='Bearbetningsresultatet är sparat. Gmail-körningens slutstatus kunde inte bekräftas; kontrollera status igen.';
const AUTOMATION_OBSERVATION_WARNING='Anropets körningskvitto kunde inte sparas. Kontrollera status igen.';
const permanentGmailErrors=new Set(['renewal_required','missing_scope','access_denied','invalid_client','account_mismatch','invalid_tokens']);
const transientGmailErrors=new Set(['rate_limited','provider_error','connection_error']);
const attachmentRejectionCodes=new Set(['attachment_too_large','attachment_unreadable','attachment_format_invalid','message_metadata_invalid']);
async function attachmentRejections(owner:string){
  // Count rejected imports, not documents explicitly rejected by a reviewer.
  // Older rows have no reason; keep that uncertainty visible and return no filenames.
  const rows=await db().prepare("SELECT json_extract(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,'$.rejection_code') code,COUNT(*) count FROM gmail_sources WHERE owner=? AND document_id='' AND status='rejected' GROUP BY code").bind(owner).all<{code:string;count:number}>();
  const counts=new Map<string,number>();
  for(const row of rows.results){const code=attachmentRejectionCodes.has(row.code)?row.code:'unclassified';counts.set(code,(counts.get(code)||0)+Number(row.count));}
  const reasons=[...counts].sort(([a],[b])=>a.localeCompare(b)).map(([code,count])=>({code,count}));
  return {total:reasons.reduce((sum,row)=>sum+row.count,0),reasons};
}
type GmailAutomationReceipt={run_id:string;invoked_at:string;completed_at:string;outcome:string;persisted:boolean};
const automaticFailureReceipts=new WeakMap<object,GmailAutomationReceipt>();
async function automaticEvent(owner:string,runId:string,phase:'invoked'|'result',outcome='',at=now()){
  // Append-only, owner-scoped operational evidence in the existing audit log.
  // No scheduler identity can be inferred from an invocation of this endpoint.
  await db().prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) VALUES(?,?,COALESCE((SELECT revision FROM workspaces WHERE owner=?),0),?,?,?)').bind(uid(),owner,owner,`gmail.automatic.${phase}`,JSON.stringify({run_id:runId,...(outcome?{outcome}:{})}),at).run();
}
async function automaticObservation(owner:string){
  const invoked=await db().prepare("SELECT detail,created_at FROM audit_events WHERE owner=? AND action='gmail.automatic.invoked' ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(owner).first<{detail:string;created_at:string}>();
  let runId='';try{runId=JSON.parse(invoked?.detail||'{}').run_id||'';}catch{}
  const result=runId?await db().prepare("SELECT detail,created_at FROM audit_events WHERE owner=? AND action='gmail.automatic.result' AND json_extract(CASE WHEN json_valid(detail) THEN detail ELSE '{}' END,'$.run_id')=? ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(owner,runId).first<{detail:string;created_at:string}>():null;
  const completed=await db().prepare("SELECT created_at FROM audit_events WHERE owner=? AND action='gmail.automatic.result' AND json_extract(CASE WHEN json_valid(detail) THEN detail ELSE '{}' END,'$.outcome') IN ('completed','completed_pending') ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(owner).first<{created_at:string}>();
  let outcome=invoked?'running_or_interrupted':null;try{if(result)outcome=JSON.parse(result.detail).outcome||outcome;}catch{}
  return {last_run_id:runId||null,last_invoked_at:invoked?.created_at||null,last_finished_at:result?.created_at||null,last_completed_at:completed?.created_at||null,last_outcome:outcome,source:'system_entrypoint',external_schedule_verified:false};
}
async function lock<T>(owner:string,fn:(lease:GmailLease)=>Promise<T>){
  const token=uid(),at=now(),until=new Date(Date.now()+300000).toISOString();
  const r=await db().prepare('INSERT INTO gmail_locks(owner,token,expires_at) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE gmail_locks.expires_at<?').bind(owner,token,until,at).run();
  if(r.meta.changes!==1)throw Error('En Gmail-hämtning pågår redan. Försök igen om en stund.');
  const lost=()=>Object.assign(Error('Gmail-körningens lås har löpt ut. Det försenade svaret sparades inte.'),{code:'gmail_lease_lost',safe:true});
  const lease:GmailLease={
    async assert(){if(!await db().prepare("SELECT owner FROM gmail_locks WHERE owner=? AND token=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(owner,token).first())throw lost();},
    async write(statements){
      // D1 batches are atomic. A missing/expired/replaced token produces NULL,
      // violating the existing NOT NULL constraint before any mutation can run.
      // The SQL clock checks expiry after acquiring the database write lock.
      const fence=db().prepare("INSERT INTO gmail_locks(owner,token,expires_at) VALUES(?,(SELECT token FROM gmail_locks WHERE owner=? AND token=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')),?) ON CONFLICT(owner) DO UPDATE SET token=excluded.token").bind(owner,owner,token,until);
      try{return await db().batch([fence,...statements]);}catch(error){await lease.assert();throw error;}
    }
  };
  try{return await fn(lease);}finally{await db().prepare('DELETE FROM gmail_locks WHERE owner=? AND token=?').bind(owner,token).run();}
}
export function gmailFailure(error?:unknown){
  const cause=error as {message?:string,code?:string,safe?:boolean,gmailStage?:string,retryAfter?:number,retryBlocked?:boolean};
  const receipt=error&&typeof error==='object'?automaticFailureReceipts.get(error):undefined;
  const failureResponse=(body:Record<string,unknown>,status:number)=>response({...body,...(receipt?{automation_receipt:receipt}:{})},status);
  // Never log provider responses, request URLs, cookies or credentials.
  const codes=['account_mismatch','renewal_required','rate_limited','missing_scope','access_denied','invalid_client','provider_error','connection_error','invalid_response','invalid_tokens','unexpected_redirect','oauth_return_invalid','oauth_return_used','missing_refresh_token','gmail_lease_lost'];
  const code=codes.includes(cause?.code||'')?cause.code:'unexpected';
  if(cause?.gmailStage)console.warn('gmail_oauth_failure',JSON.stringify({stage:cause.gmailStage,code}));
  if(cause?.message==='AUTH_REQUIRED')return failureResponse({error:'Logga in med ChatGPT för att öppna Gmail-anslutningen.',signIn:'/signin-with-chatgpt?return_to=%2Fgmail'},401);
  if(cause?.message==='ORIGIN_DENIED')return failureResponse({error:'Åtgärden måste startas från MG Fakturakoll.'},403);
  if(cause?.message==='COMPANY_MAILBOX_UNVERIFIED')return failureResponse({error:'Företagets Gmail-konto behöver registreras med en verifierad ägarrelation innan det kan anslutas eller hämtas.',code:'COMPANY_MAILBOX_UNVERIFIED'},409);
  if(cause?.safe||codes.includes(cause?.code||''))return failureResponse({error:cause.message,...(cause.retryAfter?{retry_after:cause.retryBlocked?'9999-12-31T23:59:59.999Z':new Date(Date.now()+cause.retryAfter*1000).toISOString()}:{} )},cause.code==='rate_limited'?429:409);
  return failureResponse({error:'Gmail-åtgärden kunde inte slutföras. Kontrollera anslutningen och försök igen.'},409);
}
export async function gmailStatus(summary=false,documentId=''){
  const user=await identity();
  const account=await companyGmailAccount(user.userId,{required:false});
  const processing=await processingStatus(user.userId);
  const connection=await db().prepare('SELECT email,tokens,last_synced,status,last_attempt,retry_after,sync_failures FROM gmail_connections WHERE owner=?').bind(user.userId).first<any>();
  if(connection)connection.blocked=connection.status==='blocked'||connection.sync_failures>=3;
  const send_enabled=connection&&account&&connection.email.toLowerCase()===account?hasGmailSendScope(await decrypt<any>(user.userId,'gmail-tokens',connection.tokens)):false;if(connection)delete connection.tokens;
  const completed=await db().prepare("SELECT created_at,status FROM gmail_runs WHERE owner=? AND status IN ('completed','completed_pending') ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(user.userId).first<{created_at:string;status:string}>();
  if(connection)connection.postprocess_warning=completed?.status==='completed_pending'?POSTPROCESS_WARNING:null;
  const last_successful_fetch=completed?.created_at||connection?.last_synced||'';
  const configured=!!account&&isGmailConfigured()&&storageReady(),at=Date.now(),successAt=Date.parse(last_successful_fetch);
  const scheduleMinutes=Number(processing.schedule_minutes);
  const intervalMinutes=Number.isFinite(scheduleMinutes)&&scheduleMinutes>0?Math.min(1440,Math.max(15,scheduleMinutes)):60;
  const staleAfterMinutes=intervalMinutes*2;
  let state='recent',reason='En lyckad Gmail-hämtning har verifierats nyligen.';
  if(connection?.blocked){state='blocked';reason='Hämtningen är stoppad efter upprepade avbrott eller fel. Kontrollera anslutningen.';}
  else if(!connection||!['connected','retry_wait'].includes(connection.status)){state='disconnected';reason='Gmail behöver anslutas igen.';}
  else if(!processing.enabled){state='paused';reason='Automatisk dokumenthantering är pausad.';}
  else if(!configured||!processing.scheduler_configured){state='not_configured';reason='Schemalagd hämtning är inte konfigurerad.';}
  else if(Date.parse(connection.retry_after||'')>at){state='waiting';reason='Gmail kräver väntetid före nästa försök.';}
  else if(!Number.isFinite(successAt)||successAt>at){state='not_verified';reason='Det finns ännu ingen verifierad lyckad hämtning.';}
  else if(at-successAt>staleAfterMinutes*60000){state='stale';reason='Ingen färsk lyckad hämtning. Kontrollera det externa schemat och anslutningen.';}
  else if(Date.parse(connection.last_attempt||'')>successAt){state='pending';reason='Det senaste försöket har ännu ingen verifierad slutförd hämtning.';}
  // A configured interval is not evidence that the external schedule is active.
  // Only the scheduling platform can verify that; this endpoint reports observed fetches.
  const sync_health={state,reason,interval_minutes:intervalMinutes,stale_after_minutes:staleAfterMinutes,schedule_verified:false};
  const next_eligible_sync=connection&&!connection.blocked&&!permanentGmailErrors.has(connection.status)?new Date(Math.max(at,Date.parse(connection.last_attempt||'')+15*60000||0,Date.parse(connection.retry_after||'')||0)).toISOString():null;
  // Historical freshness is not permission to attempt a new fetch. In
  // particular, stale/not-yet-verified work can be due. This read-only snapshot
  // does not bypass the sync entrypoint's current authorization or SQL lease.
  const activeLock=await db().prepare("SELECT expires_at FROM gmail_locks WHERE owner=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(user.userId).first<{expires_at:string}>();
  const lockDeadline=Date.parse(activeLock?.expires_at||'');
  const knownLockDeadline=Number.isFinite(lockDeadline)&&new Date(lockDeadline).toISOString()===activeLock?.expires_at;
  const eligibilityReason=!configured?'not_configured':!connection?'disconnected'
    :connection.email.toLowerCase()!==account?'mailbox_mismatch':!processing.enabled?'paused'
    :permanentGmailErrors.has(connection.status)?'reconnect_required':connection.blocked?'blocked'
    :!['connected','retry_wait','error'].includes(connection.status)?'disconnected':activeLock?(knownLockDeadline?'running':'lock_expiry_unknown')
    :Date.parse(connection.retry_after||'')>at?'retry_after'
    :Date.parse(connection.last_attempt||'')+15*60000>at?'minimum_interval':'eligible';
  const sync_eligibility={eligible:eligibilityReason==='eligible',reason:eligibilityReason,
    next_eligible_at:eligibilityReason==='running'?new Date(Math.max(lockDeadline,Date.parse(next_eligible_sync!))).toISOString()
      :['eligible','retry_after','minimum_interval'].includes(eligibilityReason)?next_eligible_sync:null};
  const schedule_observation=await automaticObservation(user.userId);
  const attachment_rejections=await attachmentRejections(user.userId);
  // A manual fetch and an OCR heartbeat prove only their own stages. Keep a
  // combined readiness flag conservative until the external schedule itself
  // has evidence; document identifiers and extraction values never enter it.
  const pendingOcr=Number(processing.counts?.waiting_ocr||0);
  const ocrAvailable=processing.cloud_ocr_configured&&processing.cloud_worker_recent||processing.worker_online;
  const backgroundReasons=[...(state==='recent'?[]:['gmail_fetch_'+state]),
    ...(!schedule_observation.external_schedule_verified?['external_schedule_unverified']:[]),
    ...(pendingOcr>0&&!ocrAvailable?['ocr_worker_unavailable']:[]),
    ...(completed?.status==='completed_pending'||Number(processing.aftercheck_pending)>0?['postprocessing_pending']:[])];
  const background_health={state:backgroundReasons.length?'needs_attention':'ready',reasons:backgroundReasons};
  const status={configured,email:account,send_enabled:!!send_enabled,connection,processing,last_successful_fetch,sync_health,schedule_observation,attachment_rejections,fetch_ready:state==='recent',sync_eligibility,background_ready:backgroundReasons.length===0,background_health,scheduler_configured:processing.scheduler_configured,next_eligible_sync};
  if(summary)return response(status);
  const focusedDocumentId=typeof documentId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(documentId)?documentId:'';
  // Bound unique documents, not repeated message sources. A dashboard link
  // can include an older owned document without expanding the response cap.
  // Rank before filtering rejection so an older source cannot revive it.
  const candidates=await db().prepare(`WITH ranked_sources AS (
    SELECT s.document_id,s.metadata,s.status,s.extraction,s.created_at,d.filename,d.mime,j.state processing_state,j.extraction processing_extraction,j.error_code,j.invoice_id,j.automatic,
      ROW_NUMBER() OVER (PARTITION BY s.document_id ORDER BY s.created_at DESC,s.source_id DESC) source_rank
    FROM gmail_sources s JOIN documents d ON d.id=s.document_id AND d.owner=s.owner
    LEFT JOIN document_jobs j ON j.owner=s.owner AND j.document_id=s.document_id WHERE s.owner=?
  ) SELECT document_id,metadata,status,extraction,created_at,filename,mime,processing_state,processing_extraction,error_code,invoice_id,automatic
    FROM ranked_sources WHERE source_rank=1 AND status<>'rejected'
    ORDER BY (document_id=?) DESC,created_at DESC,document_id DESC LIMIT 200`).bind(user.userId,focusedDocumentId).all();
  const runs=await db().prepare('SELECT found,imported,duplicates,status,created_at FROM gmail_runs WHERE owner=? ORDER BY created_at DESC LIMIT 10').bind(user.userId).all();
  const workspace=await readWorkspace(user.userId);
  const documents=candidates.results.map((c:any)=>({...c,invoice_id:c.invoice_id||workspace.state.invoices.find(i=>i.documentId===c.document_id)?.id||''}));
  return response({...status,candidates:documents,runs:runs.results});
}
export async function gmailConnect(req:Request){
  const user=await identity(req),account=await companyGmailAccount(user.userId);const options=await req.json() as {send?:boolean};
  if(!isGmailConfigured()||!storageReady())return response({error:'Administratören behöver aktivera Gmail API, registrera Googles webbklient och ange Google Client ID och Client Secret i Sites skyddade driftinställningar. Den befintliga krypteringsnyckeln måste vara tillgänglig.'},409);
  const state=randomToken(),cookie=randomToken();
  await db().prepare('DELETE FROM gmail_flows WHERE owner=? AND (expires_at<? OR consumed=0)').bind(user.userId,now()).run();
  await db().prepare('INSERT INTO gmail_flows(state_hash,owner,cookie_hash,expires_at,request_send) VALUES(?,?,?,?,?)').bind(await digest(state),user.userId,await digest(cookie),new Date(Date.now()+900000).toISOString(),options.send===true?1:0).run();
  return Response.json({url:gmailAuthorizationUrl(state,new URL(req.url).origin,{send:options.send===true,account})},{headers:{'Cache-Control':'no-store','Set-Cookie':`mg_gmail_flow=${cookie}; Path=/api/gmail; HttpOnly; Secure; SameSite=Lax; Max-Age=900`}});
}
export async function gmailCallback(req:Request){
  let stage='validate_return';
  try{
  const user=await identity(),account=await companyGmailAccount(user.userId);const url=new URL(req.url),state=url.searchParams.get('state')||'';
  const invalidReturn=()=>Object.assign(Error('Ogiltig retur från Google. Starta anslutningen igen i samma webbläsare och slutför den inom 15 minuter.'),{code:'oauth_return_invalid'});
  if(['state','code','error'].some(k=>url.searchParams.getAll(k).length>1))throw invalidReturn();
  const flow=await db().prepare('SELECT * FROM gmail_flows WHERE state_hash=? AND owner=? AND consumed=0 AND expires_at>?').bind(await digest(state),user.userId,now()).first<any>();
  if(!flow||flow.cookie_hash!==await digest(cookieValue(req,'mg_gmail_flow')))throw invalidReturn();
  const taken=await db().prepare('UPDATE gmail_flows SET consumed=1 WHERE state_hash=? AND consumed=0').bind(flow.state_hash).run();if(taken.meta.changes!==1)throw Object.assign(Error('Returen från Google har redan använts. Starta anslutningen igen.'),{code:'oauth_return_used'});
  let result='cancelled';
  if(!url.searchParams.has('error'))await lock(user.userId,async lease=>{
    stage='exchange_code';
    const tokens=await exchangeGmailCode(url.searchParams.get('code'),url.origin);
    await lease.assert();
    stage='verify_account';
    try{await gmailProfile(tokens,account);if(flow.request_send&&!hasGmailSendScope(tokens))throw Object.assign(Error('Godkänn Gmail-utskick genom ett nytt Google-medgivande.'),{safe:true});}catch(e){await revokeGmailTokens(tokens).catch(()=>{});throw e;}
    if(!tokens.refresh_token)throw Object.assign(Error('Google gav ingen bestående åtkomst. Starta anslutningen igen och godkänn Gmail-behörigheterna.'),{code:'missing_refresh_token'});
    stage='encrypt_tokens';
    const sealed=await encrypt(user.userId,'gmail-tokens',tokens);
    stage='save_connection';
    await lease.write([db().prepare("INSERT INTO gmail_connections(owner,email,tokens) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET email=excluded.email,tokens=excluded.tokens,status='connected',retry_after='',sync_failures=0").bind(user.userId,account,sealed)]);result='connected';
  });
  return new Response(null,{status:302,headers:{Location:`/gmail?status=${result}`,'Cache-Control':'no-store','Set-Cookie':'mg_gmail_flow=; Path=/api/gmail; HttpOnly; Secure; SameSite=Lax; Max-Age=0'}});
  }catch(error){if(error instanceof Error)Object.assign(error,{gmailStage:stage});throw error;}
}
export async function gmailSync(req?:Request,scheduled=false,invoiceReference=''){
  if(!scheduled)return gmailSyncRequest(req,false,invoiceReference);
  const user=await identity(req),runId=uid();await companyGmailAccount(user.userId);
  const invokedAt=now();
  try{await automaticEvent(user.userId,runId,'invoked','',invokedAt);}
  catch(error){
    if(error&&typeof error==='object')automaticFailureReceipts.set(error,{run_id:runId,invoked_at:invokedAt,completed_at:now(),outcome:'error',persisted:false});
    throw error;
  }
  try{
    const result=await gmailSyncRequest(req,true,invoiceReference);
    const body=await result.clone().json() as Record<string,any>;
    const outcome=result.ok?(body.status|| (body.warning?'completed_pending':'completed')):'error';
    const receipt:GmailAutomationReceipt={run_id:runId,invoked_at:invokedAt,completed_at:now(),outcome,persisted:true};
    try{await automaticEvent(user.userId,runId,'result',outcome,receipt.completed_at);}
    catch{receipt.persisted=false;}
    return response({...body,automation_receipt:receipt,...(!receipt.persisted?{observation_warning:AUTOMATION_OBSERVATION_WARNING}:{})},result.status);
  }catch(error){
    const receipt:GmailAutomationReceipt={run_id:runId,invoked_at:invokedAt,completed_at:now(),outcome:'error',persisted:true};
    try{await automaticEvent(user.userId,runId,'result','error',receipt.completed_at);}
    catch{receipt.persisted=false;}
    if(error&&typeof error==='object')automaticFailureReceipts.set(error,receipt);
    throw error;
  }
}
async function gmailSyncRequest(req?:Request,scheduled=false,invoiceReference=''){
  if(invoiceReference&&!/^[\p{L}\p{N} /-]{1,100}$/u.test(invoiceReference))throw Error('Ogiltig fakturareferens.');
  const user=await identity(req),account=await companyGmailAccount(user.userId);
  const settings=await processingSettings(user);
  const accepted=(processing:any)=>Number.isSafeInteger(processing?.processed)&&processing.processed>0;
  let cleanupFallback:Response|undefined;
  const syncResponse=(body:Record<string,any>,status=200)=>{
    const result=response(body,status);
    // Capture only a successfully constructed return with a locally confirmed
    // processDocuments count. The sole later await is lock cleanup; no earlier
    // fetch, lease or processing failure may be disguised by this fallback.
    if(accepted(body.processing))cleanupFallback=response({...body,status_unknown:true,metadata_warning:SYNC_METADATA_WARNING},status);
    return result;
  };
  try{return await lock(user.userId,async lease=>{
    const c=await db().prepare('SELECT * FROM gmail_connections WHERE owner=?').bind(user.userId).first<any>();if(!c)return response({error:'Koppla Gmail först.'},409);if(c.email.toLowerCase()!==account)throw Error('COMPANY_MAILBOX_UNVERIFIED');
    if(scheduled&&!settings?.enabled)return syncResponse({status:'paused',processing:await processingStatus(user.userId)},invoiceReference?409:200);
    if(scheduled&&permanentGmailErrors.has(c.status))return syncResponse({status:'reconnect_required',error:'Gmail-anslutningen behöver kontrolleras och anslutas igen.',processing:settings?.enabled?await processDocuments(user.userId):await processingStatus(user.userId)});
    if(scheduled&&c.sync_failures>=3)return syncResponse({status:'blocked',error:'Automatisk Gmail-hämtning är stoppad efter tre avbrutna eller misslyckade försök. Kontrollera anslutningen och gör en manuell hämtning.',processing:settings?.enabled?await processDocuments(user.userId):await processingStatus(user.userId)});
    if(Date.parse(c.retry_after||'')>Date.now())return syncResponse({status:'not_due',error:'Gmail har begränsat hämtningen. Vänta till nästa tillåtna försök.',retry_after:c.retry_after,processing:settings?.enabled?await processDocuments(user.userId):await processingStatus(user.userId)},scheduled?200:429);
    if(scheduled&&Date.now()-Date.parse(c.last_attempt||'')<900000)return syncResponse({status:'not_due',processing:settings?.enabled?await processDocuments(user.userId):await processingStatus(user.userId)});
    await lease.write([db().prepare('UPDATE gmail_connections SET last_attempt=?,sync_failures=sync_failures+? WHERE owner=?').bind(now(),scheduled?1:0,user.userId)]);
    const started=c.started_at||now();
    let tokens:any;
    try{
      tokens=await decrypt<any>(user.userId,'gmail-tokens',c.tokens);
      const result=await fetchGmailInvoiceDocuments(tokens,{account,maxMessages:10,lookupSources:async(sourceIds:string[])=>{
        const sources=await db().prepare(`SELECT source_id FROM gmail_sources WHERE owner=? AND source_id IN (${sourceIds.map(()=>'?').join(',')})`).bind(user.userId,...sourceIds).all<{source_id:string}>();
        return {knownIds:sources.results.map(source=>source.source_id),rejectedIds:[]};
      },query:invoiceReference?`in:anywhere has:attachment "${invoiceReference}"`:'',after:invoiceReference?'':c.last_synced?.slice(0,10)||'',pageToken:invoiceReference?'':c.page_token||''});
      await lease.assert();
      await lease.write([db().prepare("UPDATE gmail_connections SET tokens=?,retry_after='' WHERE owner=?").bind(await encrypt(user.userId,'gmail-tokens',result.tokens),user.userId)]);
      let imported=0,duplicates=result.duplicate;
      for(const doc of result.documents){
        const bytes=Buffer.from(doc.content_base64,'base64'),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
        const existing=await db().prepare('SELECT id FROM documents WHERE owner=? AND sha256=?').bind(user.userId,hash).first<{id:string}>();
        let id=existing?.id||uid();
        if(!existing){
          if(!env.BUCKET)throw Error('storage');await lease.assert();await env.BUCKET.put(`${user.userId}/${id}`,bytes,{httpMetadata:{contentType:doc.mime_type}});
          // Gmail's lease does not cover manual uploads. The SQL statement
          // makes the owner/hash choice while holding the database write lock.
          try{await lease.write([db().prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM documents WHERE owner=? AND sha256=?)').bind(id,user.userId,doc.name,doc.mime_type,bytes.length,hash,now(),user.userId,hash)]);}
          catch(error){
            // A lost D1 response can have committed. Preserve the object unless
            // a fresh read confirms that no document references this upload.
            try{if(!await db().prepare('SELECT id FROM documents WHERE owner=? AND id=?').bind(user.userId,id).first())await env.BUCKET.delete(`${user.userId}/${id}`);}catch{}
            throw error;
          }
          const retained=await db().prepare('SELECT id FROM documents WHERE owner=? AND sha256=? LIMIT 1').bind(user.userId,hash).first<{id:string}>();
          if(!retained)throw Error('D1_ERROR: document insertion outcome unavailable');
          if(retained.id===id)imported++;
          else{
            // Only our own conclusively unused upload can be cleaned up. A
            // failed read/delete keeps the extra bytes, never the winner's.
            try{if(!await db().prepare('SELECT id FROM documents WHERE owner=? AND id=?').bind(user.userId,id).first())await env.BUCKET.delete(`${user.userId}/${id}`);}catch{}
            id=retained.id;duplicates++;
          }
        }else duplicates++;
        const meta={...doc.metadata,direction:doc.direction,subject:doc.subject,from:doc.metadata.from,to:doc.metadata.to,received_at:doc.received_at};
        // A concurrent review can commit after the original/hash lookup. Read
        // the terminal decision inside this insertion, under D1's write lock.
        await lease.write([db().prepare("INSERT OR IGNORE INTO gmail_sources(owner,source_id,document_id,metadata,status,created_at) SELECT ?,?,?,?,COALESCE((SELECT status FROM gmail_sources WHERE owner=? AND document_id=? ORDER BY CASE status WHEN 'registered' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END,created_at,source_id LIMIT 1),'needs_review'),?").bind(user.userId,doc.source_id,id,JSON.stringify(meta),user.userId,id,now())]);
      }
      // Rejected immutable parts are retained, so a broken file cannot starve pagination.
      for(const sourceId of result.rejected_source_ids||[]){
        const code=result.warnings?.find(w=>w.source_id===sourceId)?.code||'unclassified';
        const metadata=JSON.stringify({rejection_code:attachmentRejectionCodes.has(code)?code:'unclassified'});
        await lease.write([db().prepare("INSERT OR IGNORE INTO gmail_sources(owner,source_id,document_id,metadata,status,created_at) VALUES(?,?,'',?,'rejected',?)").bind(user.userId,sourceId,metadata,now())]);
      }
      const runId=uid();
      const completed=[db().prepare('INSERT INTO gmail_runs(id,owner,found,imported,duplicates,status,created_at) VALUES(?,?,?,?,?,?,?)').bind(runId,user.userId,result.received,imported,duplicates,'completed_pending',now())];
      completed.push(db().prepare("UPDATE gmail_connections SET sync_failures=0,status='connected' WHERE owner=?").bind(user.userId));
      if(!invoiceReference)completed.unshift(db().prepare("UPDATE gmail_connections SET last_synced=?,page_token=?,started_at=?,status='connected' WHERE owner=?").bind(result.truncated?c.last_synced:started,result.next_page_token||'',result.truncated?started:'',user.userId));
      await lease.write(completed);
      let processing,warning,metadataWarning;
      try{await lease.assert();await (await import('./customer-messages')).reconcileAndPrepare(user.userId);processing=settings?.enabled?await processDocuments(user.userId):await processingStatus(user.userId);await lease.write([db().prepare("UPDATE gmail_runs SET status='completed' WHERE owner=? AND id=? AND status='completed_pending'").bind(user.userId,runId)]);}
      catch{warning=POSTPROCESS_WARNING;if(accepted(processing))metadataWarning=SYNC_METADATA_WARNING;else processing={status:'pending'};}
      return syncResponse({imported,duplicates,found:result.received,more:result.truncated,processing,...(warning?{warning}:{}),...(metadataWarning?{status_unknown:true,metadata_warning:metadataWarning}:{})});
    }catch(e:any){
      await lease.assert();
      const failures=Math.min(3,Number(c.sync_failures||0)+1),transient=transientGmailErrors.has(e.code);
      const backoff=900000*2**(failures-1)+Math.floor(Math.random()*1000);
      const serverDelay=Number.isFinite(e.retryAfter)&&e.retryAfter>0?e.retryAfter*1000:0;
      const retryAfter=e.retryBlocked?'9999-12-31T23:59:59.999Z':transient?new Date(Date.now()+Math.max(backoff,serverDelay)).toISOString():c.retry_after||'';
      const status=permanentGmailErrors.has(e.code)?e.code:e.retryBlocked||failures>=3?'blocked':transient?'retry_wait':'error';
      const failed=[db().prepare('UPDATE gmail_connections SET status=?,retry_after=?,sync_failures=? WHERE owner=?').bind(status,retryAfter,e.retryBlocked?3:failures,user.userId),db().prepare("INSERT INTO gmail_runs(id,owner,status,created_at) VALUES(?,?,'error',?)").bind(uid(),user.userId,now())];
      if(tokens)failed.unshift(db().prepare('UPDATE gmail_connections SET tokens=? WHERE owner=?').bind(await encrypt(user.userId,'gmail-tokens',tokens),user.userId));
      await lease.write(failed);throw e;
    }
  });}catch(error){if(cleanupFallback)return cleanupFallback;throw error;}
}
export async function gmailDisconnect(req:Request){
  const user=await identity(req);return lock(user.userId,async lease=>{
    const c=await db().prepare('SELECT tokens FROM gmail_connections WHERE owner=?').bind(user.userId).first<any>();
    if(c){const tokens=await decrypt(user.userId,'gmail-tokens',c.tokens);await lease.assert();await revokeGmailTokens(tokens);}
    await lease.write([db().prepare('DELETE FROM gmail_connections WHERE owner=?').bind(user.userId)]);return response({removed:true});
  });
}
export async function gmailReview(req:Request){
  const user=await identity(req);const raw=await req.text();if(raw.length>60000)throw Error('size');const body=JSON.parse(raw);
  const source=await db().prepare('SELECT * FROM gmail_sources WHERE owner=? AND document_id=? LIMIT 1').bind(user.userId,body.document_id).first<any>();if(!source)throw Error('source');
  // Opening a preview is a read, including older clients that still submit
  // their local parse. Retain new evidence only with an explicit decision.
  if(body.confirm!==true&&body.reject!==true)return response({saved:false});
  if(source.status==='needs_review'&&body.extraction&&JSON.stringify(body.extraction).length<30000){
    const extractionId=uid(),extraction=JSON.stringify(body.extraction);
    await db().batch([
      db().prepare("INSERT INTO document_extractions(id,owner,document_id,result,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM gmail_sources WHERE owner=? AND document_id=? AND status='needs_review') AND NOT EXISTS(SELECT 1 FROM gmail_sources WHERE owner=? AND document_id=? AND (extraction<>'{}' OR status='registered'))").bind(extractionId,user.userId,body.document_id,extraction,now(),user.userId,body.document_id,user.userId,body.document_id),
      db().prepare("UPDATE gmail_sources SET extraction=? WHERE owner=? AND document_id=? AND extraction='{}' AND EXISTS(SELECT 1 FROM document_extractions WHERE owner=? AND document_id=? AND id=?)").bind(extraction,user.userId,body.document_id,user.userId,body.document_id,extractionId),
    ]);
  }
  if(body.reject===true){
    if(source.status==='registered')throw Error('Fakturan är redan registrerad.');
    const changed=await db().batch([
      db().prepare("UPDATE gmail_sources SET status='rejected' WHERE owner=? AND document_id=? AND status='needs_review'").bind(user.userId,body.document_id),
      db().prepare("UPDATE document_jobs SET state='rejected',lease='',lease_until='',updated_at=? WHERE owner=? AND document_id=? AND EXISTS(SELECT 1 FROM gmail_sources s WHERE s.owner=document_jobs.owner AND s.document_id=document_jobs.document_id AND s.status='rejected') AND NOT EXISTS(SELECT 1 FROM gmail_sources s WHERE s.owner=document_jobs.owner AND s.document_id=document_jobs.document_id AND s.status='registered')").bind(now(),user.userId,body.document_id),
    ]);
    return response({rejected:changed[0].meta.changes>0||source.status==='rejected'});
  }
  const invoice={...body.invoice};
  const fields=body.fields||{};
  return response(await registerProcessedInvoice(user.userId,body.document_id,invoice,{...fields,vat_cents:fields.vat_cents?parseMoney(fields.vat_cents):null,net_cents:fields.net_cents?parseMoney(fields.net_cents):null}));
}
export {processingAction};
