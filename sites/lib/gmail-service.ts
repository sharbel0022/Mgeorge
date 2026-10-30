import {env} from 'cloudflare:workers';
import {Buffer} from 'node:buffer';
import {db,identity,response,readWorkspace} from './server';
import {uid,now,emptyState,applyCommand} from './domain';
import {parseMoney} from './domain';
import {validateInvoiceValues} from './invoice-fields.js';
import {processingSettings,processingStatus,processDocuments,processingAction,registerProcessedInvoice} from './document-processing';
import {encrypt,decrypt,storageReady} from './banking/store';
import {digest,randomToken,cookieValue} from './banking/security';
import {hasGmailSendScope,gmailAccount,isGmailConfigured,gmailAuthorizationUrl,exchangeGmailCode,gmailProfile,fetchGmailInvoiceDocuments,revokeGmailTokens} from './gmail-adapter.js';

type GmailLease={assert:()=>Promise<void>;write:(statements:any[])=>Promise<any[]>};
const POSTPROCESS_WARNING='Gmail-underlagen är sparade. Efterkontrollen behöver köras igen via betalningskontrollen.';
const SYNC_METADATA_WARNING='Bearbetningsresultatet är sparat. Gmail-körningens slutstatus kunde inte bekräftas; kontrollera status igen.';
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
  // Never log provider responses, request URLs, cookies or credentials.
  const codes=['account_mismatch','renewal_required','rate_limited','missing_scope','access_denied','invalid_client','provider_error','connection_error','invalid_response','invalid_tokens','unexpected_redirect','oauth_return_invalid','oauth_return_used','missing_refresh_token','gmail_lease_lost'];
  const code=codes.includes(cause?.code||'')?cause.code:'unexpected';
  if(cause?.gmailStage)console.warn('gmail_oauth_failure',JSON.stringify({stage:cause.gmailStage,code}));
  if(cause?.message==='AUTH_REQUIRED')return response({error:'Logga in med ChatGPT för att öppna Gmail-anslutningen.',signIn:'/signin-with-chatgpt?return_to=%2Fgmail'},401);
  if(cause?.message==='ORIGIN_DENIED')return response({error:'Åtgärden måste startas från MG Fakturakoll.'},403);
  if(cause?.safe||codes.includes(cause?.code||''))return response({error:cause.message,...(cause.retryAfter?{retry_after:cause.retryBlocked?'9999-12-31T23:59:59.999Z':new Date(Date.now()+cause.retryAfter*1000).toISOString()}:{} )},cause.code==='rate_limited'?429:409);
  return response({error:'Gmail-åtgärden kunde inte slutföras. Kontrollera anslutningen och försök igen.'},409);
}
export async function gmailStatus(summary=false){
  const user=await identity();
  const processing=await processingStatus(user.userId);
  const connection=await db().prepare('SELECT email,tokens,last_synced,status,last_attempt,retry_after,sync_failures FROM gmail_connections WHERE owner=?').bind(user.userId).first<any>();
  if(connection)connection.blocked=connection.status==='blocked'||connection.sync_failures>=3;
  const send_enabled=connection?hasGmailSendScope(await decrypt<any>(user.userId,'gmail-tokens',connection.tokens)):false;if(connection)delete connection.tokens;
  const completed=await db().prepare("SELECT created_at,status FROM gmail_runs WHERE owner=? AND status IN ('completed','completed_pending') ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(user.userId).first<{created_at:string;status:string}>();
  if(connection)connection.postprocess_warning=completed?.status==='completed_pending'?POSTPROCESS_WARNING:null;
  const last_successful_fetch=completed?.created_at||connection?.last_synced||'';
  const configured=isGmailConfigured()&&storageReady(),at=Date.now(),successAt=Date.parse(last_successful_fetch);
  const scheduleMinutes=Number(processing.schedule_minutes);
  const intervalMinutes=Number.isFinite(scheduleMinutes)&&scheduleMinutes>0?Math.min(1440,Math.max(15,scheduleMinutes)):60;
  const staleAfterMinutes=intervalMinutes*2;
  let state='recent',reason='En lyckad Gmail-hämtning har verifierats nyligen.';
  if(connection?.blocked){state='blocked';reason='Hämtningen är stoppad efter upprepade avbrott eller fel. Kontrollera anslutningen.';}
  else if(!connection||connection.status!=='connected'){state='disconnected';reason='Gmail behöver anslutas igen.';}
  else if(!processing.enabled){state='paused';reason='Automatisk dokumenthantering är pausad.';}
  else if(!configured||!processing.scheduler_configured){state='not_configured';reason='Schemalagd hämtning är inte konfigurerad.';}
  else if(Date.parse(connection.retry_after||'')>at){state='waiting';reason='Gmail kräver väntetid före nästa försök.';}
  else if(!Number.isFinite(successAt)||successAt>at){state='not_verified';reason='Det finns ännu ingen verifierad lyckad hämtning.';}
  else if(at-successAt>staleAfterMinutes*60000){state='stale';reason='Ingen färsk lyckad hämtning. Kontrollera det externa schemat och anslutningen.';}
  else if(Date.parse(connection.last_attempt||'')>successAt){state='pending';reason='Det senaste försöket har ännu ingen verifierad slutförd hämtning.';}
  // A configured interval is not evidence that the external schedule is active.
  // Only the scheduling platform can verify that; this endpoint reports observed fetches.
  const sync_health={state,reason,interval_minutes:intervalMinutes,stale_after_minutes:staleAfterMinutes,schedule_verified:false};
  const next_eligible_sync=connection&&!connection.blocked?new Date(Math.max(at,Date.parse(connection.last_attempt||'')+15*60000||0,Date.parse(connection.retry_after||'')||0)).toISOString():null;
  const status={configured,email:gmailAccount(),send_enabled,connection,processing,last_successful_fetch,sync_health,background_ready:state==='recent',scheduler_configured:processing.scheduler_configured,next_eligible_sync};
  if(summary)return response(status);
  const candidates=await db().prepare("SELECT s.document_id,s.metadata,s.status,s.extraction,s.created_at,d.filename,d.mime,j.state processing_state,j.extraction processing_extraction,j.error_code,j.invoice_id,j.automatic FROM gmail_sources s JOIN documents d ON d.id=s.document_id AND d.owner=s.owner LEFT JOIN document_jobs j ON j.owner=s.owner AND j.document_id=s.document_id WHERE s.owner=? AND s.status<>'rejected' ORDER BY s.created_at DESC LIMIT 200").bind(user.userId).all();
  const runs=await db().prepare('SELECT found,imported,duplicates,status,created_at FROM gmail_runs WHERE owner=? ORDER BY created_at DESC LIMIT 10').bind(user.userId).all();
  const workspace=await readWorkspace(user.userId);
  const documents=candidates.results.map((c:any)=>({...c,invoice_id:c.invoice_id||workspace.state.invoices.find(i=>i.documentId===c.document_id)?.id||''}));
  return response({...status,candidates:documents,runs:runs.results});
}
export async function gmailConnect(req:Request){
  const user=await identity(req);const options=await req.json() as {send?:boolean};
  if(!isGmailConfigured()||!storageReady())return response({error:'Administratören behöver aktivera Gmail API, registrera Googles webbklient och ange Google Client ID och Client Secret i Sites skyddade driftinställningar. Den befintliga krypteringsnyckeln måste vara tillgänglig.'},409);
  const state=randomToken(),cookie=randomToken();
  await db().prepare('DELETE FROM gmail_flows WHERE expires_at<? OR (owner=? AND consumed=0)').bind(now(),user.userId).run();
  await db().prepare('INSERT INTO gmail_flows(state_hash,owner,cookie_hash,expires_at,request_send) VALUES(?,?,?,?,?)').bind(await digest(state),user.userId,await digest(cookie),new Date(Date.now()+900000).toISOString(),options.send===true?1:0).run();
  return Response.json({url:gmailAuthorizationUrl(state,new URL(req.url).origin,{send:options.send===true})},{headers:{'Cache-Control':'no-store','Set-Cookie':`mg_gmail_flow=${cookie}; Path=/api/gmail; HttpOnly; Secure; SameSite=Lax; Max-Age=900`}});
}
export async function gmailCallback(req:Request){
  let stage='validate_return';
  try{
  const user=await identity();const url=new URL(req.url),state=url.searchParams.get('state')||'';
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
    try{await gmailProfile(tokens);if(flow.request_send&&!hasGmailSendScope(tokens))throw Object.assign(Error('Godkänn Gmail-utskick genom ett nytt Google-medgivande.'),{safe:true});}catch(e){await revokeGmailTokens(tokens).catch(()=>{});throw e;}
    if(!tokens.refresh_token)throw Object.assign(Error('Google gav ingen bestående åtkomst. Starta anslutningen igen och godkänn Gmail-behörigheterna.'),{code:'missing_refresh_token'});
    stage='encrypt_tokens';
    const sealed=await encrypt(user.userId,'gmail-tokens',tokens);
    stage='save_connection';
    await lease.write([db().prepare("INSERT INTO gmail_connections(owner,email,tokens) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET email=excluded.email,tokens=excluded.tokens,status='connected',retry_after='',sync_failures=0").bind(user.userId,gmailAccount(),sealed)]);result='connected';
  });
  return new Response(null,{status:302,headers:{Location:`/gmail?status=${result}`,'Cache-Control':'no-store','Set-Cookie':'mg_gmail_flow=; Path=/api/gmail; HttpOnly; Secure; SameSite=Lax; Max-Age=0'}});
  }catch(error){if(error instanceof Error)Object.assign(error,{gmailStage:stage});throw error;}
}
export async function gmailSync(req?:Request,scheduled=false,invoiceReference=''){
  if(invoiceReference&&!/^[\p{L}\p{N} /-]{1,100}$/u.test(invoiceReference))throw Error('Ogiltig fakturareferens.');
  const user=await identity(req);
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
    const c=await db().prepare('SELECT * FROM gmail_connections WHERE owner=?').bind(user.userId).first<any>();if(!c)return response({error:'Koppla Gmail först.'},409);
    if(scheduled&&c.sync_failures>=3)return syncResponse({status:'blocked',error:'Automatisk Gmail-hämtning är stoppad efter tre avbrutna eller misslyckade försök. Kontrollera anslutningen och gör en manuell hämtning.',processing:settings?.enabled?await processDocuments(user.userId):await processingStatus(user.userId)});
    if(Date.parse(c.retry_after||'')>Date.now())return syncResponse({status:'not_due',error:'Gmail har begränsat hämtningen. Vänta till nästa tillåtna försök.',retry_after:c.retry_after,processing:settings?.enabled?await processDocuments(user.userId):await processingStatus(user.userId)},scheduled?200:429);
    if(scheduled&&Date.now()-Date.parse(c.last_attempt||'')<900000)return syncResponse({status:'not_due',processing:settings?.enabled?await processDocuments(user.userId):await processingStatus(user.userId)});
    await lease.write([db().prepare('UPDATE gmail_connections SET last_attempt=?,sync_failures=sync_failures+? WHERE owner=?').bind(now(),scheduled?1:0,user.userId)]);
    const started=c.started_at||now();
    const sources=await db().prepare('SELECT source_id FROM gmail_sources WHERE owner=?').bind(user.userId).all<{source_id:string}>();
    let tokens:any;
    try{
      tokens=await decrypt<any>(user.userId,'gmail-tokens',c.tokens);
      const result=await fetchGmailInvoiceDocuments(tokens,{maxMessages:10,knownIds:sources.results.map(s=>s.source_id),query:invoiceReference?`in:anywhere has:attachment "${invoiceReference}"`:'',after:invoiceReference?'':c.last_synced?.slice(0,10)||'',pageToken:invoiceReference?'':c.page_token||''});
      await lease.assert();
      await lease.write([db().prepare("UPDATE gmail_connections SET tokens=?,retry_after='' WHERE owner=?").bind(await encrypt(user.userId,'gmail-tokens',result.tokens),user.userId)]);
      let imported=0,duplicates=result.duplicate;
      for(const doc of result.documents){
        const bytes=Buffer.from(doc.content_base64,'base64'),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
        const existing=await db().prepare('SELECT id FROM documents WHERE owner=? AND sha256=?').bind(user.userId,hash).first<{id:string}>();
        const id=existing?.id||uid();
        if(!existing){
          if(!env.BUCKET)throw Error('storage');await lease.assert();await env.BUCKET.put(`${user.userId}/${id}`,bytes,{httpMetadata:{contentType:doc.mime_type}});
          try{await lease.write([db().prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').bind(id,user.userId,doc.name,doc.mime_type,bytes.length,hash,now())]);}
          catch(error){
            // A lost D1 response can have committed. Preserve the object unless
            // a fresh read confirms that no document references this upload.
            try{if(!await db().prepare('SELECT id FROM documents WHERE owner=? AND id=?').bind(user.userId,id).first())await env.BUCKET.delete(`${user.userId}/${id}`);}catch{}
            throw error;
          }imported++;
        }else duplicates++;
        const meta={...doc.metadata,direction:doc.direction,subject:doc.subject,from:doc.metadata.from,to:doc.metadata.to,received_at:doc.received_at};
        const prior=await db().prepare('SELECT status FROM gmail_sources WHERE owner=? AND document_id=? LIMIT 1').bind(user.userId,id).first<{status:string}>();
        await lease.write([db().prepare('INSERT OR IGNORE INTO gmail_sources(owner,source_id,document_id,metadata,status,created_at) VALUES(?,?,?,?,?,?)').bind(user.userId,doc.source_id,id,JSON.stringify(meta),prior?.status||'needs_review',now())]);
      }
      // Rejected immutable parts are retained, so a broken file cannot starve pagination.
      for(const sourceId of result.rejected_source_ids||[])await lease.write([db().prepare("INSERT OR IGNORE INTO gmail_sources(owner,source_id,document_id,metadata,status,created_at) VALUES(?,?,'','{}','rejected',?)").bind(user.userId,sourceId,now())]);
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
      const retryAfter=e.code==='rate_limited'?(e.retryBlocked?'9999-12-31T23:59:59.999Z':new Date(Date.now()+Math.max(900,e.retryAfter||900)*1000).toISOString()):c.retry_after||'';
      const failed=[db().prepare('UPDATE gmail_connections SET status=?,retry_after=?,sync_failures=CASE WHEN ? THEN 3 ELSE sync_failures END WHERE owner=?').bind(e.code==='renewal_required'?'renewal_required':e.retryBlocked||scheduled&&c.sync_failures+1>=3?'blocked':'error',retryAfter,e.retryBlocked?1:0,user.userId),db().prepare("INSERT INTO gmail_runs(id,owner,status,created_at) VALUES(?,?,'error',?)").bind(uid(),user.userId,now())];
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
