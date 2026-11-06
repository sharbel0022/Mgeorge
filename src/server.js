import {nodeSaasBankRuntime} from './saas-bank-runtime.js';
import {createNodeOpenPaymentsCompanySyncRuntime,readNodeOpenPaymentsCompanySyncStatus} from './openpayments-company-bank-sync.js';
/**
 * MG FAKTURAKOLL – SERVER / API
 * ANSVAR: Tar emot HTTP-anrop från gränssnittet, kontrollerar session och behörighet, skickar arbetet vidare till databas- och integrationsmodulerna samt svarar med JSON. Även schemalagd synkronisering startas här.
 * FLÖDE: Webbläsare → server.js → db.js / gmail.js / bank.js → JSON till webbläsaren.
 * LÄS VIDARE: docs/KODGUIDE.md för genomgång av moduler och funktioner.
 */

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {createLoginRateLimiter} from './login-rate-limit.js';
import {createCompanyRuntime,readCompanyDatabaseBoundary} from './company-runtime.js';
import {assertCompanyContext,companyCacheKey} from '../sites/lib/company-contract.js';
import { openDatabase, bankEvidenceBlocksAbsence, assertNoLegacyBankImports, audit, listInvoices, listTransactions, invoiceStatus, storeTransactions, allocate, deleteAllocation, matchingSuggestions, getSettings, saveSettings, listImports, recordImport, listDocuments, storeDocument, documentMetadata, defaultSettings, today } from './db.js';
import { digest, token, secureEqual, sessionCookie, clearCookie, encryptObject, decryptObject, passwordHash, verifyPassword, cipherKey } from './security.js';
import { parseBankFile, normalizeBankApiTransaction } from './importers.js';
import {dailyBackup} from './backup.js';
import {createNodeBankgiroIngest} from './bankgiro-ingest.js';
import {resolveBankgiroSource} from '../sites/lib/bankgiro-source-registry.js';
import {publicBankgiroStatus} from '../sites/lib/bankgiro-source.js';
import {createIntegrationJobs} from './integration-jobs.js';
import {runScheduledCompanyBankSync,isCompanyBankSyncDatabase} from './company-bank-sync.js';
export {createNodeCompanyBankSyncRuntime,registerCompanyBankSyncRuntime,nodeCompanyBankAccountKey} from './company-bank-sync.js';
import { isConfigured, configStatus, consentApplicationFingerprint, assertApplicationReady, validateAuthorizationUrl, bankingRequest, findSwedbank, startConsentBody, fetchBookedTransactions } from './bank.js';
import {ConsentError,consentDiagnostic,configureBankCompanyContext,bankCompanyContext,requestedBankConsent,consentMetadata,assertConsentContext,validatedLiveAccountDetails,companyAccountGrant,assertCorporateAccountAccess,publicConsent,validateCallbackParameters,validateEnableConsent} from './bank-consent.js';
import {bankSyncCoverage,planBankSync,completeBankSync} from './bank-sync-state.js';
import { gmailAccount, withGmailAccount, isGmailConfigured, gmailAuthorizationUrl, exchangeGmailCode, gmailProfile, fetchGmailInvoiceDocuments, revokeGmailTokens } from './gmail.js';
import {analyzeDocument,approveDocument} from './invoice-review.js';
import {runDocumentProcess} from './invoice-extraction.js';
import {runReconciliation,verifyPayer,analyzeReconciliation,reconciliationData} from './reconciliation.js';
import {readReconciliationPreview} from './reconciliation-preview.js';
import {discoverManualMultiple,previewManualMultiple,commitManualMultiple,readManualMultipleReceipt,decorateManualMultipleAllocations} from './manual-multiple-allocation.js';
import {prepareMessages,listMessages,verifyContact,editMessage,rejectMessage,reviewMessage,approveAndSend} from './customer-messages.js';
import {prepareGmailSend,hasGmailSendScope} from './gmail.js';
import {createPaymentControl,planBankControl} from './payment-control.js';
import {buildPaymentOverview,invoiceAnalysis} from './payment-overview.js';
import {bankSpecificationCandidates,confirmBankSpecificationLink,revokeBankSpecificationLink,bankSpecificationPresentation,bankApiOriginal} from './bankgiro-links.js';

function assertLegacyBankRuntime(){if(isCompanyBankSyncDatabase(db))throw Object.assign(bad(409,'Företagets bankhämtning och avstämning kräver den registrerade företagsanslutningen.'),{code:'company_sync_required'});}
function reconcileAndPrepare(){assertLegacyBankRuntime();const suggestions=runReconciliation(db);prepareMessages(db);return suggestions;}

function config(){
  const origin=(process.env.APP_ORIGIN||'http://localhost:3000').replace(/\/$/,'');
  const parsed=new URL(origin);
  if(parsed.origin!==origin||(!origin.startsWith('https:')&&!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)))throw Error('APP_ORIGIN måste vara en HTTPS-origin (lokalt tillåts HTTP)');
  if(!/^[a-f0-9]{64}$/i.test(process.env.SESSION_SECRET||''))throw Error('SESSION_SECRET måste vara 64 hextecken');
  cipherKey();
  const secure=parsed.protocol==='https:';
  if(secure&&(process.env.MG_ADMIN_PASSWORD||'').length<16)throw Error('HTTPS-drift kräver MG_ADMIN_PASSWORD med minst 16 tecken');
  return {origin,secure,adminHash:secure?passwordHash(process.env.MG_ADMIN_PASSWORD):'',port:Number(process.env.PORT||3000)};
}
const check=config();
const controlDb=openDatabase();
const loginLimiter=createLoginRateLimiter(controlDb);
const companyRuntime=createCompanyRuntime({controlDb,legacyDatabasePath:process.env.DB_PATH||'./data/mgeorge.sqlite',companyDirectory:process.env.MG_COMPANY_DIRECTORY,legacyPrincipal:check.secure?'administrator':'local-admin'});
const db=companyRuntime.db;
configureBankCompanyContext(()=>companyRuntime.current());
const integrationJobs=companyRuntime.service('integrationJobs');
function companyMailbox(context){
 if(!context||context.storageOwner===(check.secure?'administrator':'local-admin'))return (process.env.GMAIL_ACCOUNT||'mg.vitvaror@gmail.com').trim().toLowerCase();
 let accounts;try{accounts=JSON.parse(process.env.MG_COMPANY_GMAIL_ACCOUNTS||'{}');}catch{throw bad(503,'Företagets Gmail-konfiguration är ogiltig.');}
 if(!accounts||typeof accounts!=='object'||Array.isArray(accounts))throw bad(503,'Företagets Gmail-konfiguration är ogiltig.');
 return Object.hasOwn(accounts,context.companyId)?accounts[context.companyId]:'';
}
async function bankgiroIngest(owner){
 const source=await resolveBankgiroSource(owner,{configuration:process.env.BANKGIRO_SOURCE_CONFIG,secrets:process.env});
 const context=companyRuntime.current(),binding=source?.registration??source?.revocation;
 // A trusted transport owner alone is insufficient: its verified company must
 // match this immutable data partition before any queue, lease or provider call.
 // Removing a registry entry carries only its owner and revision; this can
 // revoke that owner's stored grants but can never authorize provider access.
 const removedRegistration=source?.revocation&&!source?.registration&&!Object.hasOwn(source.revocation,'companyId');
 if(context&&binding&&(owner!==context.storageOwner||binding.owner!==context.storageOwner||binding.companyId!==context.companyId&&!removedRegistration)){
  const status=async()=>({enabled:false,sourceId:null,mode:'production',state:'BLOCKED',reason:'COMPANY_BOUNDARY_MISMATCH',cursor:null,nextPollAt:null,missingReportIds:[],counts:{PENDING:0,RETRY:0,IMPORTED:0,REVIEW:0,DUPLICATE:0,BLOCKED:0},jobs:[],lastError:'COMPANY_BOUNDARY_MISMATCH',authorization:{status:'BLOCKED',verifiedAt:null,validUntil:null},lastSuccessAt:null,lastFailureAt:null,lastFailureCode:null});
  return {status,run:status};
 }
 return createNodeBankgiroIngest(db,{source});
}
export async function runScheduledBankgiro(){
  return forScheduledCompanies(async()=>{
  if(isCompanyBankSyncDatabase(db))return;
  const owner=companyRuntime.current()?.storageOwner||(check.secure?'administrator':'local-admin');
  return (await bankgiroIngest(owner)).run(owner);
  });
}
const baseHeaders={
  'Content-Security-Policy':"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'X-Frame-Options':'DENY','Cache-Control':'no-store','Permissions-Policy':'camera=(), microphone=(), geolocation=()'
};
if(check.secure)baseHeaders['Strict-Transport-Security']='max-age=31536000';
function companyHeaders(){const context=companyRuntime.current();if(!context)return {};companyRuntime.assert();return {'X-Company-Id':context.companyId,'X-Company-Context-Version':String(context.contextVersion),Vary:'Cookie, X-Company-Id, X-Company-Context-Version'};}
function json(res,status,data,headers={}){res.writeHead(status,{...baseHeaders,...companyHeaders(),'Content-Type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(data));}
function redirect(res,url,cookie){res.writeHead(302,{...baseHeaders,...companyHeaders(),Location:url,...(cookie?{'Set-Cookie':cookie}:{})});res.end();}
function bad(status,message){return Object.assign(new Error(message),{status});}
function requiredString(x,label,max=240){if(typeof x!=='string'||!x.trim()||x.length>max)throw bad(400,`${label} krävs (max ${max} tecken)`);return x.trim();}
function optionalString(x,max=1000){return String(x??'').trim().slice(0,max);}
function duplicateInvoice(direction,invoice_number,party,excludeId=''){
  const identity=s=>String(s).normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('sv-SE');
  return db.prepare('SELECT id,invoice_number,party FROM invoices WHERE direction=? AND id<>?').all(direction,excludeId).some(i=>identity(i.invoice_number)===identity(invoice_number)&&identity(i.party)===identity(party));
}
function validateDate(s,required=false){if(!s&&!required)return ''; if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(Date.parse(s+'T00:00:00Z'))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw bad(400,'Ange ett giltigt datum som ÅÅÅÅ-MM-DD');return s;}
async function readBody(req,{authenticated=true,maxBytes=22_000_000}={}){
  if(Number(req.headers['content-length'])>maxBytes)throw bad(413,'Förfrågan är för stor');
  const chunks=[];let length=0;
  for await (const chunk of req){length+=chunk.length;if(length>maxBytes)throw bad(413,'Förfrågan är för stor');chunks.push(chunk);}
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw bad(400,'Ogiltig JSON');}
  // Reading a streamed body yields: the initiating session may now be revoked.
  if(authenticated)assertSessionStillAuthorized(req);
  if(authenticated&&!req.allowCompanySelection&&body&&typeof body==='object'&&['companyId','company_id','tenantId','storageOwner'].some(key=>Object.hasOwn(body,key)))throw bad(400,'Företagskontext väljs i företagsväljaren, inte i affärsdata.');
  return body;
}
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').filter(x=>x.includes('=')).map(x=>{const i=x.indexOf('=');let value='';try{value=decodeURIComponent(x.slice(i+1).trim());}catch{}return [x.slice(0,i).trim(),value];}));}
// Local OS access represents one company administrator. HTTPS requires login.
// HTTPS sessions are persisted only after successful administrator login.
/** Skapar eller återanvänder webbläsarsessionen som binder OAuth- och bankreturer till rätt användare. Detta är inte samma sak som bankens egen inloggning. */
function ensureBrowserSession(req,res){
  const existing=cookies(req).mg_session;
  const found=existing&&controlDb.prepare('SELECT principal FROM sessions WHERE id_hash=? AND expires_at>?').get(digest(existing),Date.now());
  if(found){
    req.principal=check.secure?found.principal:'local-admin';
    if(!check.secure&&found.principal==='')controlDb.prepare('UPDATE sessions SET principal=? WHERE id_hash=?').run('local-admin',digest(existing));
    return;
  }
  // Denied requests and failed logins must not grow the persistent session
  // table. HTTPS OAuth already requires a successfully authenticated session.
  if(check.secure){req.principal='';return;}
  const session=token();
  controlDb.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
  req.principal='local-admin';
  controlDb.prepare('INSERT INTO sessions(id_hash,expires_at,principal) VALUES(?,?,?)').run(digest(session),Date.now()+8*3600000,req.principal);
  req.headers.cookie=(req.headers.cookie?req.headers.cookie+'; ':'')+'mg_session='+encodeURIComponent(session);
  // Replace an expired session cookie when computing the OAuth browser binding.
  req.browserSession=session;
  res.setHeader('Set-Cookie',sessionCookie(session,check.secure));
}
/** Kontrollerar varifrån ändringsanropet kommer för att motverka CSRF och otillåtna webbplatser. */
function checkOrigin(req){
  const origin=req.headers.origin;
  if(origin!==check.origin)throw bad(403,'Begäran måste komma från MG:s egen hemsida');
  if(!String(req.headers['content-type']||'').startsWith('application/json'))throw bad(415,'Content-Type måste vara application/json');
}
function serveStatic(req,res,path){
  const companyModules={'/company-client.js':'company-client.js','/company-contract.js':'company-contract.js','/invoice-reference-policy.js':'invoice-reference-policy.js'};
  if(Object.hasOwn(companyModules,path)){const contents=readFileSync(new URL('../sites/lib/'+companyModules[path],import.meta.url));res.writeHead(200,{...baseHeaders,'Content-Type':'text/javascript; charset=utf-8'});return res.end(contents);}
  const legalPages={'/integritetspolicy':'integritetspolicy.html','/integritetspolicy/':'integritetspolicy.html','/integritetspolicy.html':'integritetspolicy.html','/anvandarvillkor':'anvandarvillkor.html','/anvandarvillkor/':'anvandarvillkor.html','/anvandarvillkor.html':'anvandarvillkor.html'};
  if(Object.hasOwn(legalPages,path)){
    const contents=readFileSync(resolve('public',legalPages[path]));
    // These standalone information documents contain their own fixed stylesheet.
    res.writeHead(200,{...baseHeaders,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"});return res.end(contents);
  }
  if(!['/','/index.html','/app.js','/workspace-search.js','/manual-multiple-client.js','/review.js','/messages.js','/style.css','/payment-control.js','/payment-control.css'].includes(path)){json(res,404,{error:'Sidan finns inte'});return;}
  const actual=path==='/'?'/index.html':path;
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[extname(actual)];
  const contents=readFileSync(resolve('public'+actual));
  res.writeHead(200,{...baseHeaders,'Content-Type':mime});res.end(contents);
}
function addInvoice(body){
  const direction=body.direction;
  if(!['customer','supplier'].includes(direction))throw bad(400,'Välj kund eller leverantör');
  const total=Number(body.total_cents);
  if(!Number.isSafeInteger(total)||total<=0)throw bad(400,'Ange korrekt belopp');
  const invoice_number=requiredString(body.invoice_number,'Fakturanummer',80),party=requiredString(body.party,'Företag/person');
  const kind=body.kind||'invoice';if(!['invoice','credit'].includes(kind))throw bad(400,'Välj faktura eller kreditfaktura');
  if(duplicateInvoice(direction,invoice_number,party))throw bad(409,'Fakturan finns redan för den här kunden eller leverantören');
  const vat=body.vat_cents==null||body.vat_cents===''?null:Number(body.vat_cents);if(vat!==null&&(!Number.isSafeInteger(vat)||vat<0||vat>total))throw bad(400,'Ange korrekt momsbelopp');
  const document=body.document_id?db.prepare('SELECT id,invoice_id FROM documents WHERE id=?').get(body.document_id):null;
  if(body.document_id&&!document)throw bad(404,'Originalunderlaget saknas');
  if(document?.invoice_id)throw bad(409,'Underlaget är redan kopplat till en faktura');
  const id=randomUUID();
  const issued=validateDate(body.issued_at),due=validateDate(body.due_at);
  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,email,issued_at,due_at,total_cents,currency,reference,note,bankgiro,vat_cents,kind) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      id,direction,invoice_number,party,optionalString(body.email,240),issued,due,total,'SEK',optionalString(body.reference,120),optionalString(body.note,1500),optionalString(body.bankgiro,80),vat,kind);
    if(document)db.prepare("UPDATE documents SET invoice_id=?,status='registered' WHERE id=?").run(id,document.id);
    audit(db,'invoice_created',{id,direction,invoice_number,document_id:document?.id,kind});db.exec('COMMIT');return {id};
  }catch(e){db.exec('ROLLBACK');throw e;}
}
function addBankTransaction(body){
  const amount=Number(body.amount_cents);
  if(!Number.isSafeInteger(amount)||amount===0)throw bad(400,'Beloppet kan inte vara noll');
  const items=[{account:requiredString(body.account,'Konto',120),booked_at:validateDate(body.booked_at,true),amount_cents:amount,currency:'SEK',payer:optionalString(body.payer,240),reference:optionalString(body.reference,240),bank_reference:optionalString(body.bank_reference,240),description:optionalString(body.description,500)}];
  return storeTransactions(db,items,'manual');
}
function maskAccount(s){return s?String(s).replace(/.(?=.{4})/g,'•'):'';}
function sessionHash(req){return digest(req.browserSession||cookies(req).mg_session||'');}
function assertSessionIdentity(req){
  const current=controlDb.prepare('SELECT principal FROM sessions WHERE id_hash=? AND expires_at>?').get(sessionHash(req),Date.now());
  if(!current||current.principal!==(req.actorId||req.principal))throw bad(401,'Sessionen har avslutats. Logga in och försök igen.');
}
function assertSessionStillAuthorized(req){assertSessionIdentity(req);companyRuntime.assert(req.companyAction||'read');}
function filePayload(body){
  const name=requiredString(body.name,'Filnamn',240);
  if(typeof body.content_base64!=='string'||!body.content_base64||body.content_base64.length>20_000_000||!/^[A-Za-z0-9+/]*={0,2}$/.test(body.content_base64))throw bad(400,'Fil saknas eller är för stor');
  const bytes=Buffer.from(body.content_base64,'base64');if(!bytes.length||bytes.length>15_000_000)throw bad(413,'Max 15 MB per fil');
  let mime_type='';
  if(bytes.subarray(0,5).toString()==='%PDF-'&&/\.pdf$/i.test(name))mime_type='application/pdf';
  else if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&/\.png$/i.test(name))mime_type='image/png';
  else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&/\.jpe?g$/i.test(name))mime_type='image/jpeg';
  else if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'&&/\.webp$/i.test(name))mime_type='image/webp';
  if(!mime_type)throw bad(400,'Välj en giltig PDF-, PNG-, JPEG- eller WebP-fil');
  return {name,mime_type,bytes};
}
function importBankFile(body,req){
  let account=optionalString(body.account,120)||'Swedbank';
  if(body.connection_id){
    const connection=ownedConnection(req,body.connection_id);
    assertCorporateAccountAccess(connection,req.principal,connection.selected_account_uid,body.companyId);
    const selected=decryptObject(connection.accounts_json).find(a=>a.uid===connection.selected_account_uid);
    if(!selected||(body.account_uid&&body.account_uid!==selected.uid))throw bad(400,'Välj bankanslutningens godkända konto');
    account=stableAccountIdentity(selected,connection.bank_name);
  }
  try{return parseBankFile(body.name,body.content_base64,account);}catch(e){throw bad(400,e.message);}
}
function retainBankgiroReview(body,items,req){
  assertSessionStillAuthorized(req);
  const content=Buffer.from(body.content_base64,'base64'),sha256=digest(content),mime_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  db.exec('BEGIN IMMEDIATE');
  try{
    const previous=db.prepare("SELECT id FROM import_jobs WHERE source='bank_file' AND content_sha256=? AND mime_type=? AND (owner='' OR owner=?) LIMIT 1").get(sha256,mime_type,req.principal);
    const import_id=previous?.id||recordImport(db,{source:'bank_file',name:optionalString(body.name,240),found:items.length,review:items.length,status:'needs_review',error:items[0]?.review_reason||'',content,mime_type});
    db.prepare("UPDATE import_jobs SET owner=? WHERE id=? AND owner=''").run(req.principal,import_id);
    if(!previous)audit(db,'bankgiro_xlsx_review_saved',{import_id,sha256,found:items.length,financial_records_created:0,owner:req.principal});
    db.exec('COMMIT');
    return {import_id,imported:0,duplicate:previous?1:0,review:items.length,review_only:true,status:'needs_review'};
  }catch(error){db.exec('ROLLBACK');throw error;}
}
const gmailReconnectStatuses=new Set(['renewal_required','access_denied','missing_scope','invalid_client','account_mismatch','invalid_tokens']);
function gmailStatus(){
  const connection=db.prepare('SELECT id,email,status,last_synced,last_error FROM gmail_connections ORDER BY created_at DESC LIMIT 1').get();
  const credentials=connection&&db.prepare('SELECT encrypted_tokens FROM gmail_connections WHERE id=?').get(connection.id);
  const send_enabled=!!credentials&&hasGmailSendScope(decryptObject(credentials.encrypted_tokens));
  const interval=getSettings(db).gmail_sync_interval_minutes,job=integrationJobs.state('gmail'),lastAttempt=Math.max(connection?.last_synced?utcTimestamp(connection.last_synced):0,job?.last_attempt||0);
  const imports=db.prepare("SELECT COALESCE(SUM(found),0) AS messages,COALESCE(SUM(imported),0) AS documents,COALESCE(SUM(duplicate),0) AS duplicates FROM import_jobs WHERE source='gmail'").get();
  return {configured:isGmailConfigured(),send_enabled,email:gmailAccount(),status:connection?.status||'not_connected',last_synced:connection?.last_synced||'',next_sync:connection&&!gmailReconnectStatuses.has(connection.status)&&connection.status!=='blocked'&&interval&&(!job||job.failures<3)?new Date(Math.max(Date.now(),lastAttempt+interval*60000,job?.next_attempt||0)).toISOString():null,syncing:integrationJobs.running('gmail'),job:integrationJobs.summary().find(j=>j.name==='gmail')||null,counts:imports,connection};
}
const bankLeases=companyRuntime.service('bankLeases');
const bankPostprocessWarning='Bankhändelserna är sparade. Efterkontrollen behöver köras igen via betalningskontrollen.';
const bankSyncing={
  has:id=>bankLeases.has(id)||integrationJobs.running('bank:'+id),
  add(id,options){if(bankLeases.has(id))throw bad(409,'En bankåtgärd pågår redan');const lease=integrationJobs.claim('bank:'+id,options);lease.deadline=Math.min(Date.now()+240000,integrationJobs.state('bank:'+id).lease_until-30000);bankLeases.set(id,lease);return lease;},
  assert(id){const lease=bankLeases.get(id);if(!lease)throw bad(409,'Bankåtgärdens lås saknas');lease.assert();},
  delete(id){const lease=bankLeases.get(id);try{lease?.release();}finally{bankLeases.delete(id);}}
};
/** Förnyar Gmail-behörighet vid behov och laddar ned nya fakturaunderlag från företagets konto. */
async function syncGmail(req=null,{analyze=true,controlAuthorize=null,scheduled=false,interval=0}={}){
  const authorize=()=>{if(req)assertSessionStillAuthorized(req);controlAuthorize?.();};
  const waiting=integrationJobs.state('gmail');
  const retryState=db.prepare('SELECT status FROM gmail_connections ORDER BY created_at DESC LIMIT 1').get()?.status;
  if(waiting?.failures>=3&&(retryState==='blocked'||waiting.last_error.startsWith('Gmail angav')))throw Object.assign(bad(409,waiting.last_error),{code:'integration_blocked'});
  if(waiting?.next_attempt>Date.now()&&(retryState==='retry_wait'||waiting.last_error.startsWith('Gmail har begränsat')))throw Object.assign(bad(429,'Gmail väntar på nästa tillåtna hämtningsförsök.'),{code:'rate_limited',retryAfter:Math.ceil((waiting.next_attempt-Date.now())/1000)});
  const lease=integrationJobs.claim('gmail',{scheduled,interval});
  const connection=db.prepare('SELECT * FROM gmail_connections ORDER BY created_at DESC LIMIT 1').get();
  if(!connection){lease.release();throw bad(409,'Koppla Gmail först');}
  const startedAt=connection.sync_started_at||new Date().toISOString();
  let currentTokens;
  try{
    currentTokens=decryptObject(connection.encrypted_tokens);
    const result=await fetchGmailInvoiceDocuments(currentTokens,{after:connection.last_synced?.slice(0,10)||undefined,lookupSources:sourceIds=>{
      // The runtime database proxy preserves the active company's boundary.
      authorize();lease.assert();
      const placeholders=sourceIds.map(()=>'?').join(',');
      const rows=db.prepare(`SELECT source_id,'known' kind FROM document_sources WHERE source_id IN (${placeholders}) UNION ALL SELECT source_id,'rejected' kind FROM gmail_rejected_sources WHERE source_id IN (${placeholders})`).all(...sourceIds,...sourceIds);
      return {knownIds:rows.filter(row=>row.kind==='known').map(row=>row.source_id),rejectedIds:rows.filter(row=>row.kind==='rejected').map(row=>row.source_id)};
    },maxMessages:50,pageToken:connection.page_token||'',authorize:()=>{authorize();lease.renew();}});
    let imported=0,duplicate=result.duplicate||0;
    // Originals, token rotation and the checkpoint share the lease-fenced write.
    lease.write(()=>{
      authorize();
      db.prepare('UPDATE gmail_connections SET encrypted_tokens=? WHERE id=?').run(encryptObject(result.tokens),connection.id);
      for(const doc of result.documents){
        const payload=filePayload(doc);
        const stored=storeDocument(db,{...payload,source:'gmail',source_id:doc.source_id,metadata:{...doc.metadata,direction:doc.direction,party:doc.party,email:doc.email,subject:doc.subject,received_at:doc.received_at}});
        if(stored.duplicate)duplicate++;else imported++;
      }
      const reject=db.prepare('INSERT OR IGNORE INTO gmail_rejected_sources(source_id,reason) VALUES(?,?)');
      for(const sourceId of result.rejected_source_ids||[]){
        const reason=result.warnings?.find(w=>w.source_id===sourceId)?.message||'Bilagan kunde inte godkännas som fakturaunderlag';
        reject.run(sourceId,reason);
      }
      db.prepare("UPDATE gmail_connections SET encrypted_tokens=?,last_synced=?,page_token=?,sync_started_at=?,status='connected',last_error='' WHERE id=?").run(encryptObject(result.tokens),result.truncated?connection.last_synced:startedAt,result.next_page_token||'',result.truncated?startedAt:'',connection.id);
    });
    // Originals/checkpoints are durable before interpretation; failed OCR stays
    // in the review queue and can be retried without downloading the mail again.
    if(analyze)for(const doc of db.prepare("SELECT id FROM documents WHERE source='gmail' AND invoice_id IS NULL AND status='needs_review' AND extraction='{}' LIMIT 10").all())await analyzeDocument(db,doc.id,{authorize:()=>{authorize();lease.renew();}});
    lease.assert();
    const summary={received:result.received??result.documents.length+(result.skipped||0),imported,duplicate,review:imported,skipped:result.skipped||0,truncated:!!result.truncated,warnings:result.warnings||[]};
    lease.write(()=>{authorize();recordImport(db,{source:'gmail',name:connection.email,found:summary.received,imported,duplicate,review:imported});audit(db,'gmail_synced',summary);});
    // Company banking has its own consent- and policy-fenced reconciliation.
    // Its unavailable legacy writer must not turn a durable Gmail import into
    // a failed download or suppress independent invoice ingestion.
    if(!isCompanyBankSyncDatabase(db))reconcileAndPrepare();
    lease.success();return summary;
  }catch(e){
    authorize();
    const renewal=e.code==='renewal_required'||/invalid_grant|förnya|återkall|401|expired|behöver.*koppla/i.test(e.message);
    const permanent=renewal?'renewal_required':gmailReconnectStatuses.has(e.code)?e.code:'';
    const transient=['rate_limited','provider_error','connection_error'].includes(e.code);
    const attempts=Math.max(1,Math.min(3,integrationJobs.state('gmail')?.failures||1));
    const backoff=900000*2**(attempts-1)+Math.floor(Math.random()*1000);
    const serverDelay=Number.isFinite(e.retryAfter)&&e.retryAfter>0?e.retryAfter*1000:0;
    lease.write(()=>{
    if(currentTokens)db.prepare('UPDATE gmail_connections SET encrypted_tokens=? WHERE id=?').run(encryptObject(currentTokens),connection.id);
    db.prepare('UPDATE gmail_connections SET status=?,last_error=? WHERE id=?').run(permanent||(e.retryBlocked?'blocked':transient?'retry_wait':'error'),renewal?'Gmail-anslutningen behöver förnyas':'Det gick inte att hämta från Gmail',connection.id);
    recordImport(db,{source:'gmail',name:connection.email,status:'error',error:renewal?'Gmail-anslutningen behöver förnyas':'Gmail-hämtningen misslyckades'});
    lease.fail(e.status===429?e.message:renewal?'Gmail-anslutningen behöver förnyas':'Gmail-hämtningen behöver kontrolleras',transient?Math.max(backoff,serverDelay):0,e.retryBlocked===true,permanent||e.code);
    });
    if(e.status)throw e;throw bad(502,renewal?'Gmail-anslutningen behöver förnyas – koppla Gmail igen':'Det gick inte att hämta från Gmail. Kontrollera anslutningen och försök igen.');
  }finally{lease.release();}
}
function ownedConnection(req,id){
  const connection=db.prepare('SELECT * FROM bank_connections WHERE id=? AND owner=?').get(requiredString(id,'Anslutnings-ID'),req.principal);
  if(!connection)throw bad(404,'Bankanslutningen saknas eller tillhör en annan användare');
  return connection;
}
function finishBankFlow(stateHash,status,reason='',connectionId=''){
  db.prepare("UPDATE bank_states SET consumed=1,status=?,terminal_reason=?,connection_id=? WHERE state_hash=? AND status IN ('pending','consuming')").run(status,reason,connectionId,stateHash);
}
function flowContext(record,actorId){
  // Persisted legacy connections remain compatible, but old redirects must
  // restart so they cannot create another metadata-free connection after rollout.
  if(!record.context_json)throw new ConsentError('CONSENT_FLOW_EXPIRED',409);
  let context;try{context=JSON.parse(record.context_json);}catch{throw new ConsentError('INVALID_CALLBACK',403);}
  if(context?.version!==1||context.mode!=='company'||context.flowId!==record.flow_id||context.renewConnectionId!==record.renew_connection_id||context.intent!==(record.renew_connection_id?'renew':'connect'))throw new ConsentError('INVALID_CALLBACK',403);
  assertConsentContext(context,actorId);
  if(context.applicationFingerprint!==consentApplicationFingerprint())throw new ConsentError('CONSENT_APPLICATION_CHANGED',409);
  return context;
}
function bankSessionInUse(sessionId){
  for(const connection of db.prepare('SELECT encrypted_session FROM bank_connections').all()){
    try{if(decryptObject(connection.encrypted_session).session_id===sessionId)return true;}
    catch{return true;} // Do not revoke a session whose ownership is uncertain.
  }
  return false;
}
function assertCurrentBankConnection(connection){
  const stored=db.prepare('SELECT * FROM bank_connections WHERE id=? AND owner=?').get(connection.id,connection.owner);
  if(!stored||stored.encrypted_session!==connection.encrypted_session||stored.accounts_json!==connection.accounts_json||stored.consent_json!==connection.consent_json||stored.selected_account_uid!==connection.selected_account_uid)throw Object.assign(bad(409,'Bankanslutningen har ändrats. Läs in den igen.'),{code:'connection_changed'});
  return stored;
}
function stableAccountIdentity(account,bank){
  const number=account.account_id?.iban?.replace(/\s/g,'').toUpperCase()||account.account_id?.other?.identification;
  // Keep the canonical account number compatible with earlier file/API imports.
  if(number)return number;
  if(account.identification_hash)return `${bank}:SE:hash:${account.identification_hash}`;
  throw bad(502,'Banken saknar beständig kontoidentitet. Kontakta systemadministratören.');
}
async function verifyBankSession(connection,deadline){
  const data=await bankingRequest('/sessions/'+encodeURIComponent(decryptObject(connection.encrypted_session).session_id),{...(deadline===undefined?{}:{deadline})});
  const metadata=consentMetadata(connection);
  if(metadata){
    const saved=decryptObject(connection.accounts_json);
    const grant=validateEnableConsent({session:{accounts:saved,aspsp:{name:connection.bank_name,country:'SE'},psu_type:'business',access:{valid_until:connection.valid_until,transactions:true}},checked:data,bankName:connection.bank_name,requestedValidUntil:connection.valid_until,requestedScopes:metadata.requestedScopes});
    if(!grant.accountUids.includes(connection.selected_account_uid))throw new ConsentError('BANK_ACCOUNT_SCOPE_INVALID',409);
    const current=validatedLiveAccountDetails(saved,data,connection.bank_name);
    const authority=assertCorporateAccountAccess({...connection,accounts_json:encryptObject(current),valid_until:grant.validUntil});
    return Math.min(Date.parse(grant.validUntil),Date.parse(authority.validUntil));
  }
  const expiresAt=typeof data.access?.valid_until==='string'?Date.parse(data.access.valid_until):NaN;
  if(data.status!=='AUTHORIZED'||!Array.isArray(data.accounts)||!data.accounts.includes(connection.selected_account_uid)||
    data.aspsp?.name!==connection.bank_name||data.aspsp?.country!=='SE'||data.psu_type!=='business'||
    data.access?.transactions!==undefined&&data.access.transactions!==true||
    !Number.isFinite(expiresAt)||expiresAt<=Date.now())throw Object.assign(bad(409,'Bankanslutningen behöver förnyas – koppla igen'),{code:'renewal_required'});
  return expiresAt;
}
/** Hämtar bankhändelser för vald anslutning, kontrollerar bankens svar och sparar endast giltiga poster med dubblettskydd. */
async function syncBank(connection,{account_uid,date_from,date_to,scheduled=false,interval=0}={},operationLocked=false){
  assertLegacyBankRuntime();
  const authorize=()=>{
    assertLegacyBankRuntime();
    if(connection.request_session_hash){
      const active=db.prepare('SELECT principal FROM sessions WHERE id_hash=? AND expires_at>?').get(connection.request_session_hash,Date.now());
      if(!active||active.principal!==connection.owner)throw bad(401,'Sessionen har avslutats. Logga in igen.');
    }
    connection.controlAuthorize?.();
  };
  if(!operationLocked&&bankSyncing.has(connection.id))throw bad(409,'En bankåtgärd pågår redan');
  if(connection.status==='revocation_pending')throw new ConsentError('BANK_DISCONNECT_PENDING',409,'Frånkopplingen behöver slutföras innan bankuppgifter kan hämtas.');
  assertCorporateAccountAccess(connection);
  if(!connection.owner||!connection.selected_account_uid)throw bad(409,'Välj först ett godkänt företagskonto');
  if(!Number.isFinite(Date.parse(connection.valid_until))||Date.parse(connection.valid_until)<=Date.now()||connection.status==='renewal_required'){
    throw bad(409,'Bankanslutningen behöver förnyas – koppla igen');
  }
  if(connection.retry_after>Date.now())throw Object.assign(bad(429,'Bankens anropsgräns är nådd. Försök igen senare.'),{retryAfter:Math.ceil((connection.retry_after-Date.now())/1000)});
  if(account_uid&&account_uid!==connection.selected_account_uid)throw bad(400,'Välj konto innan hämtningen');
  const selected=decryptObject(connection.accounts_json).find(a=>a.uid===connection.selected_account_uid);if(!selected)throw bad(400,'Välj ett godkänt konto');
  const account=stableAccountIdentity(selected,connection.bank_name),plan=planBankSync(decryptObject(connection.encrypted_session),account,connection.last_synced,{date_from,date_to}),{from,to}=plan;
  assertNoLegacyBankImports(db);
  const lease=operationLocked?bankLeases.get(connection.id):bankSyncing.add(connection.id,{scheduled,interval});
  let consentExpiresAt=Date.parse(connection.valid_until);
  const consentAuthorize=()=>{
    authorize();
    assertCorporateAccountAccess(connection);
    if(!Number.isFinite(consentExpiresAt)||consentExpiresAt<=Date.now())throw Object.assign(bad(409,'Bankanslutningen behöver förnyas – koppla igen'),{code:'renewal_required'});
  };
  const bankAuthorize=()=>{lease.assert();consentAuthorize();};
  try{
    bankSyncing.assert(connection.id);
    // Account/session selection may have changed while this caller waited to run.
    const stored=db.prepare('SELECT * FROM bank_connections WHERE id=? AND owner=?').get(connection.id,connection.owner);
    if(!stored||stored.accounts_json!==connection.accounts_json||stored.encrypted_session!==connection.encrypted_session||stored.selected_account_uid!==connection.selected_account_uid)throw Object.assign(bad(409,'Bankanslutningen har ändrats. Läs in den igen.'),{code:'connection_changed'});
    if(stored.retry_after>Date.now())throw Object.assign(bad(429,'Bankens anropsgräns är nådd. Försök igen senare.'),{retryAfter:Math.ceil((stored.retry_after-Date.now())/1000)});
    if(stored.status==='renewal_required'||!Number.isFinite(Date.parse(stored.valid_until))||Date.parse(stored.valid_until)<=Date.now())throw Object.assign(bad(409,'Bankanslutningen behöver förnyas – koppla igen'),{code:'renewal_required'});
    bankAuthorize();
    // The current provider consent may expire before the original connection.
    // Keep its narrower bound through every page and the final import guard.
    consentExpiresAt=Math.min(consentExpiresAt,Date.parse(stored.valid_until),await verifyBankSession(connection,lease.deadline));
    bankAuthorize();
    const raw=await fetchBookedTransactions(selected.uid,{dateFrom:from,dateTo:to,authorize:bankAuthorize,deadline:lease.deadline});
    bankAuthorize();
    // Login revocation during a slow provider request must not authorize a write.
    authorize();
    const transactions=raw.map(x=>normalizeBankApiTransaction(x,account));
    if(transactions.some(x=>!x||x.booked_at<from||x.booked_at>to))throw Object.assign(bad(502,'Bankens svar innehöll bokförda händelser som inte kunde bevaras inom det begärda datumintervallet. Inga händelser från hämtningen har importerats.'),{code:'incomplete_bank_response'});
    const completed=completeBankSync(plan);
    const result=storeTransactions(db,transactions,'enablebanking',null,bankAuthorize,imported=>{
      bankAuthorize();
      db.prepare("UPDATE bank_connections SET encrypted_session=?,last_synced=?,status='connected',last_error=?,retry_after=0 WHERE id=?").run(encryptObject(completed.session),completed.coverage.complete?new Date().toISOString():connection.last_synced,bankPostprocessWarning,connection.id);
      audit(db,'bank_synced',{connection_id:connection.id,from,to,received:raw.length,imported:imported.imported,duplicate:imported.duplicate});
    },work=>lease.write(()=>{
      const result=work();
      lease.success();
      // Completion is terminal. Recheck consent without reopening its write
      // permission; lease.write performs the final ownership/fence assertion.
      consentAuthorize();
      return result;
    }));
    // The import is committed. Keep its pending warning if the independent
    // after-check fails or this worker loses its lease after the commit.
    const warnings=[];let aftercheck,released=false;
    try{
      lease.release();released=true;
      // Follow-up uses the same coordinator as a credential/control operation.
      // It cannot create a second fetch attempt or reuse a completed writer.
      aftercheck=integrationJobs.claim('bank:'+connection.id,{recordAttempt:false});
      aftercheck.assert();authorize();reconcileAndPrepare();
      aftercheck.write(()=>{authorize();db.prepare("UPDATE bank_connections SET last_error='' WHERE id=?").run(connection.id);});
      aftercheck.success();
    }catch{warnings.push(bankPostprocessWarning);}
    finally{
      try{aftercheck?.release();if(!released)lease.release();}
      catch{if(!warnings.length)warnings.push(bankPostprocessWarning);}
      // Both writers are terminal or released. Avoid a redundant outer release
      // turning an already committed import into a failed HTTP response.
      bankLeases.delete(connection.id);
    }
    return {...result,received:raw.length,sync_coverage:completed.coverage,...(warnings.length?{warnings}:{})};
  }catch(e){
    authorize();
    if(e.code==='connection_changed'||e.status===401&&!e.providerStatus)throw e;
    const consent=consentDiagnostic(e);
    const renewal=e.code==='renewal_required'||['BANK_CONSENT_EXPIRED','BANK_CONSENT_INVALID','BANK_ACCOUNT_SCOPE_INVALID','BANK_TRANSACTION_SCOPE_REQUIRED','CORPORATE_AUTHORIZATION_REQUIRED'].includes(consent?.code);
    const cooldown=e.status===429||e.code==='bank_unavailable'&&e.status===503&&Number.isFinite(e.retryAfter)&&e.retryAfter>0;
    const safeBankFailure=!!consent||['invalid_date_range','transaction_period_unavailable','page_limit','transaction_limit','bank_timeout','incomplete_bank_response','bank_sync_window_limit','application_access_denied'].includes(e.code);
    const message=consent?.message??(renewal?'Bankanslutningen behöver förnyas – koppla igen':e.status===429?'Bankens anropsgräns är nådd. Försök igen senare.':safeBankFailure||cooldown?e.message:'Det gick inte att hämta bankhändelser. Kontrollera anslutningen och försök igen.');
    lease.write(()=>{db.prepare('UPDATE bank_connections SET status=?,last_error=?,retry_after=? WHERE id=?').run(renewal?'renewal_required':'error',message,cooldown?Date.now()+Math.max(60,e.retryAfter||60)*1000:0,connection.id);
    recordImport(db,{source:'enablebanking',name:connection.bank_name,status:'error',error:message});
    lease.fail(message,cooldown?Math.max(60,e.retryAfter||60)*1000:0,e.retryBlocked===true,consent?.code??e.code);
    });
    throw Object.assign(bad(renewal?409:consent?.status??(cooldown||safeBankFailure?e.status:502),message),{safe:true,retryAfter:e.retryAfter,...(safeBankFailure?{code:consent?.code??e.code}:{})});
  }
  finally{if(!operationLocked)bankSyncing.delete(connection.id);}
}
const schedulerState=companyRuntime.service('schedulerState');
const backupStatus=companyRuntime.service('backupStatus');
function scheduledBackup(){
 return forScheduledCompanies(async()=>{
 if(!backupStatus.enabled||backupStatus.day===today()||Date.now()<backupStatus.retry_after)return;
 const context=companyRuntime.current(),directory=context?join(process.env.MG_BACKUP_DIRECTORY,digest(context.companyId)):process.env.MG_BACKUP_DIRECTORY;
 try{companyRuntime.assert('restore');const result=dailyBackup(companyRuntime.databasePath(context),directory,process.env.MG_BACKUP_KEY,new Date(),context?{expectedCompanyId:context.companyId}:undefined);backupStatus.day=result.day;backupStatus.last_verified=new Date().toISOString();backupStatus.error='';}
 catch{backupStatus.retry_after=Date.now()+15*60_000;backupStatus.error='Säkerhetskopian kunde inte skapas eller återställningskontrolleras. Kontrollera backupkonfigurationen.';}
 });
}
async function forScheduledCompanies(operation){
 if(companyRuntime.current())return operation();
 let result;
 for(const context of companyRuntime.scheduledContexts()){
  try{result=await companyRuntime.runJob(context,()=>withGmailAccount(companyMailbox(context),operation));}catch{/* A revoked/suspended company cannot stop another company's independent scheduler. */}
 }
 if(!companyRuntime.legacyBound())result=await companyRuntime.run(null,()=>withGmailAccount(companyMailbox(null),operation));
 return result;
}
function utcTimestamp(value){return Date.parse(value.includes('T')?value:value.replace(' ','T')+'Z')||0;}
/** Kontrollerar om inställda synkroniseringsjobb är förfallna. Jobben körs bara medan denna Node-server kör. */
export async function runScheduledSync(){
 return forScheduledCompanies(runCompanyScheduledSync);
}
function saasSyncRegistration(context){
 if(!context||process.env.SAAS_BANK_ENABLED!=='true')return null;
 let registrations;try{registrations=JSON.parse(process.env.SAAS_OPENPAYMENTS_REGISTRATIONS||'[]');}catch{throw new ConsentError('SAAS_BANK_CONFIGURATION_INVALID',503);}
 if(!Array.isArray(registrations))throw new ConsentError('SAAS_BANK_CONFIGURATION_INVALID',503);
 return registrations.find(row=>row.companyId===context.companyId&&row.actorId===context.actorId&&row.verified===true)??null;
}
async function openPaymentsSyncRuntime(req=null,{scheduled=false}={}){
 const context=req?.companyContext??companyRuntime.current(),registration=saasSyncRegistration(context);
 if(!registration)return null;
 const automatic={enabled:registration.automaticEnabled===true,operatorVerified:registration.operatorVerified===true,evidenceId:registration.operatorEvidenceId};
 if(scheduled&&!(automatic.enabled&&automatic.operatorVerified&&automatic.evidenceId))return null;
 const assertCurrent=req?()=>assertSessionStillAuthorized(req):()=>companyRuntime.assert('manage_integrations');
 const snapshot=await nodeSaasBankRuntime({db,controlDb,context,assertCurrent,sessionHash:req?sessionHash(req):'internal-authorized-sync',origin:check.origin}).snapshot();
 if(snapshot.connection?.status!=='active'||!snapshot.accounts.some(account=>account.selected&&account.importable)){
  if(scheduled)return null;
  throw new ConsentError('BANK_CONSENT_INVALID',409);
 }
 return createNodeOpenPaymentsCompanySyncRuntime({db,controlDb,context,assertCurrent,evidenceId:registration.syncEvidenceId||registration.ratePolicy?.evidenceId,existingDataCompanyId:readCompanyDatabaseBoundary(db)?.companyId,origin:check.origin,automatic});
}
async function runCompanyScheduledSync(){
  const settings=getSettings(db),interval=settings.sync_interval_minutes,gmailInterval=settings.gmail_sync_interval_minutes;
  if(schedulerState.running)return;
  schedulerState.running=true;schedulerState.last_error='';
  const due=(key,last,minutes)=>integrationJobs.due(key,last?utcTimestamp(last):0,minutes*60000);
  try{
    const companies=await runScheduledCompanyBankSync();
    try{
      const openPayments=await openPaymentsSyncRuntime(null,{scheduled:true});
      if(openPayments){const result=await openPayments.scheduled();companies.results.push(...result.results);}
    }catch{schedulerState.last_error='Företagets bankhämtning behöver kontrolleras';}
    if(companies.results.some(result=>result.status!=='success'))schedulerState.last_error='Företagets bankhämtning behöver kontrolleras';
    const companyBanking=isCompanyBankSyncDatabase(db);
    if(!interval&&!gmailInterval){if(companies.results.length)schedulerState.last_run=new Date().toISOString();return;}
    const mail=db.prepare("SELECT * FROM gmail_connections WHERE status NOT IN ('renewal_required','access_denied','missing_scope','invalid_client','account_mismatch','invalid_tokens','blocked') ORDER BY created_at DESC LIMIT 1").get();
    if(mail&&gmailInterval&&isGmailConfigured()&&due('gmail',mail.last_synced,gmailInterval)){
      try{await syncGmail(null,{scheduled:true,interval:gmailInterval*60000});}catch{schedulerState.last_error='Gmail-hämtningen behöver kontrolleras';}
    }
    if(!companyBanking&&interval&&isConfigured())for(const connection of db.prepare("SELECT * FROM bank_connections WHERE status IN ('connected','error') AND owner<>'' AND selected_account_uid<>''").all()){
      if(!due('bank:'+connection.id,connection.last_synced,interval))continue;
      try{await syncBank(connection,{scheduled:true,interval:interval*60000});}catch{schedulerState.last_error='Bankhämtningen behöver kontrolleras';}
    }
    if(!companyBanking)reconcileAndPrepare();
    schedulerState.last_run=new Date().toISOString();
  }finally{schedulerState.running=false;}
}
/** The overview only reads stored evidence. It never sends mail or creates matches. */
function paymentOverview(){
  const evidence=reconciliationData(db);
  const data=buildPaymentOverview({invoices:evidence.invoices,transactions:evidence.transactions,documents:listDocuments(db),messages:listMessages(db),suggestions:analyzeReconciliation(evidence)});
  return data;
}
// Only existing service functions are used. Paused schedules and registration
// preferences are never changed by this manual, bounded control run.
function makePaymentControl(){return createPaymentControl(db,{
  summarize:()=>{const {counts,totals}=paymentOverview();return {counts,totals};},
  adapters:{
    gmail:async({authorize})=>{
      const status=gmailStatus();
      if(!status.configured||!status.connection)return {state:'blocked',note:'Anslut Gmail i Inställningar. Befintliga fakturor kontrolleras ändå.'};
      if(status.status==='renewal_required')return {state:'blocked',note:'Gmail behöver förnyas. Befintliga underlag finns kvar.'};
      const checkpoint=db.prepare('SELECT page_token FROM gmail_connections WHERE id=?').get(status.connection.id);
      if(!checkpoint?.page_token&&status.last_synced&&Date.now()-utcTimestamp(status.last_synced)<15*60000)
        return {state:'cached',note:'Gmail hämtades nyligen. Redan sparade underlag används.'};
      // No new OAuth flow is started here. An existing consent is required.
      const result=await syncGmail(null,{analyze:false,controlAuthorize:authorize});
      return {state:result.truncated?'waiting':'done',count:result.imported,note:`${result.imported} nya underlag, ${result.duplicate} dubbletter.${result.truncated?' Fler mejl återstår; starta en ny kontroll senare.':''}`};
    },
    bank:async({owner,authorize})=>{
      if(!isConfigured())return {state:'blocked',note:'Bankanslutningen behöver konfigureras. Importerade bankunderlag används tills vidare.'};
      const all=db.prepare('SELECT * FROM bank_connections WHERE owner=?').all(owner);
      const plan=planBankControl(all);
      if(!all.some(c=>['connected','error'].includes(c.status)&&c.selected_account_uid&&Date.parse(c.valid_until)>Date.now()))return {state:'blocked',note:'Anslut eller förnya banken och välj företagskonto. Sparade bankhändelser bevaras.'};
      let imported=0,waiting=plan.waiting;
      for(const connection of plan.selected){
        authorize();
        db.prepare('UPDATE bank_connections SET control_attempt_at=? WHERE id=? AND owner=?').run(Date.now(),connection.id,owner);
        try{const result=await syncBank({...connection,controlAuthorize:authorize});authorize();imported+=result.imported||0;}
        catch(error){if([401,403].includes(error.status))throw error;waiting=true;}
      }
      return {state:waiting?'waiting':!plan.selected.length?'cached':'done',count:imported,
        note:waiting?'Någon bankhämtning väntar eller behöver åtgärdas. Kontrollera Bankanslutning; sparade händelser används.':
          !plan.selected.length?'Bankuppgifterna hämtades nyligen. Sparat underlag används.':`${imported} nya bankhändelser. Bankgirodetaljer kan fortfarande behöva kompletteras.`};
    },
    documents:async({authorize})=>{
      // Bound a run; never re-run OCR on an already interpreted document by default.
      const ids=db.prepare("SELECT id FROM documents WHERE invoice_id IS NULL AND status='needs_review' AND extraction='{}' ORDER BY created_at,id LIMIT 2").all();
      for(const {id} of ids){authorize();await analyzeDocument(db,id,{authorize});}
      const left=db.prepare("SELECT COUNT(*) AS n FROM documents WHERE invoice_id IS NULL AND status='needs_review' AND extraction='{}'").get().n;
      return {state:left?'waiting':'done',count:ids.length,note:left?`${ids.length} underlag bearbetade. ${left} väntar till nästa kontroll.`:
        ids.length?`${ids.length} underlag bearbetade. Osäkra uppgifter finns i Att granska.`:'Alla sparade underlag har passerat tolkningen. Osäkra fält kräver granskning.'};
    },
    reconcile:async({authorize})=>{authorize();const result=runReconciliation(db);return {state:'done',count:result.length,note:'Befintliga säkerhetsregler tillämpades. Osäkra betalningar och samlingsposter kräver granskning.'};},
    messages:async({authorize})=>{authorize();prepareMessages(db);const count=listMessages(db).filter(m=>m.status==='draft').length;return {state:'done',count,note:`${count} utkast att läsa. Inga mejl har skickats.`};}
  }
});}
const paymentControl=companyRuntime.service('paymentControl');
companyRuntime.configureServices(()=>({
 integrationJobs:createIntegrationJobs(db),paymentControl:makePaymentControl(),bankLeases:new Map(),
 schedulerState:{running:false,last_run:'',last_error:''},
 backupStatus:{enabled:!!process.env.MG_BACKUP_DIRECTORY,last_verified:'',day:'',error:'',retry_after:0}
}));
companyRuntime.services();

function companySelector(req,url){
 const select=(header,query)=>{
  if(url.searchParams.getAll(query).length>1||Array.isArray(req.headers[header]))throw bad(400,'Företagskontexten är tvetydig.');
  const h=req.headers[header],q=url.searchParams.get(query);
  if(h!==undefined&&q!==null&&h!==q)throw bad(400,'Företagskontexten är tvetydig.');
  return h??q??undefined;
 };
 const companyId=select('x-company-id','companyId'),version=select('x-company-context-version','companyContextVersion');
 if(version!==undefined&&(!/^[1-9]\d*$/.test(version)||!Number.isSafeInteger(Number(version))))throw bad(400,'Företagskontextens version är ogiltig.');
 url.searchParams.delete('companyId');url.searchParams.delete('companyContextVersion');
 return {companyId,contextVersion:version===undefined?undefined:Number(version)};
}
function companyAction(method,path){
 if(/^\/api\/companies\/[^/]+\/bank\//.test(path))return method==='GET'&&!path.endsWith('/callback')?'read':'manage_integrations';
 if(method==='GET'&&!['/api/bank/callback','/api/gmail/callback'].includes(path))return 'read';
 if(path==='/api/settings')return 'manage_company';
 if(path.startsWith('/api/bank/')||path.startsWith('/api/gmail/')||path==='/api/bankgiro/source/run'||path==='/api/payment-control/run')return 'manage_integrations';
 return 'write';
}
function oauthCompanyPin(req){return JSON.stringify({version:'company-oauth-context-v1',actorId:req.actorId,storageOwner:req.principal,context:req.companyContext});}
function callbackCompanyContext(req,url,path,current){
 if(req.method!=='GET'||!['/api/bank/callback','/api/gmail/callback'].includes(path))return current;
 if(['state','code','error'].some(key=>url.searchParams.getAll(key).length>1))throw bad(403,'Ogiltig OAuth-retur');
 const state=url.searchParams.get('state')||'',table=path==='/api/bank/callback'?'bank_states':'gmail_states';
 if(!state||state.length>256)throw bad(403,'Ogiltig OAuth-retur');
 // Read the one-use flow only through this actor's current data boundary. A
 // flow in another partition cannot select that partition from a public state.
 const record=companyRuntime.run(current,()=>db.prepare(`SELECT company_context_json,session_hash,expires_at,consumed FROM ${table} WHERE state_hash=?`).get(digest(state)),{actorId:req.actorId,authorize:()=>assertSessionIdentity(req)});
 if(!record||record.consumed||record.expires_at<=Date.now()||!secureEqual(record.session_hash,sessionHash(req)))throw bad(403,'Ogiltig eller för gammal OAuth-retur');
 const stale=()=>{throw Object.assign(bad(409,'Företagskontexten har ändrats. Starta anslutningen igen.'),{code:'COMPANY_CONTEXT_STALE'});};
 let pin;try{pin=JSON.parse(record.company_context_json);}catch{stale();}
 if(pin?.version!=='company-oauth-context-v1'||pin.actorId!==req.actorId||pin.storageOwner!==(current?.storageOwner??req.actorId))stale();
 if(pin.context===null){if(current!==null)stale();return null;}
 let context;try{context=assertCompanyContext(pin.context);}catch{stale();}
 if(!current||context.actorId!==pin.actorId||context.storageOwner!==pin.storageOwner||companyCacheKey(context)!==companyCacheKey(current))stale();
 // Dispatch with the retained snapshot. Live membership, selection and session
 // fences remain in force after provider awaits and at every business write.
 return context;
}

/** Huvudroutern: matchar HTTP-metod och URL, kontrollerar åtkomst och anropar rätt modul. */
async function route(req,res){
  // The listener remains loopback-only; public HTTPS uses a secured reverse proxy.
  const hostname=new URL('http://'+req.headers.host).hostname;
  if(!(check.secure?[new URL(check.origin).hostname]:['localhost','127.0.0.1','[::1]']).includes(hostname))throw bad(403,'Ogiltig värd för MG Fakturakoll');
  const url=new URL(req.url,check.origin);const path=url.pathname;
  if(path==='/api/health'&&req.method==='GET')return json(res,200,{ok:true,app:'Mgeorge Fakturakoll'});
  if(!path.startsWith('/api/'))return serveStatic(req,res,path);
  const callback=(['/api/bank/callback','/api/gmail/callback'].includes(path)||/^\/api\/companies\/[^/]+\/bank\/callback$/.test(path))&&req.method==='GET';
  if(!callback&&((req.headers.origin&&req.headers.origin!==check.origin)||req.headers['sec-fetch-site']==='cross-site'))throw bad(403,'Begäran måste komma från MG:s egen hemsida');
  ensureBrowserSession(req,res);
  req.actorId=req.principal;
  if(path==='/api/me'&&req.method==='GET'){
   if(!req.actorId)return json(res,200,{authenticated:false,login_required:check.secure,company:'MG Fakturakoll',role:null});
   let context;try{context=companyRuntime.resolve({actorId:req.actorId});}catch(error){if(error.code!=='company_access_denied')throw error;return json(res,200,{authenticated:true,login_required:check.secure,company:'MG Fakturakoll',role:null});}
   return companyRuntime.run(context,()=>json(res,200,{authenticated:true,login_required:check.secure,company:getSettings(db).company_name,role:context?.role||'administrator',companyContext:context}),{actorId:req.actorId,authorize:()=>assertSessionIdentity(req)});
  }
  if(req.method!=='GET')checkOrigin(req);
  if(path==='/api/login'&&req.method==='POST'&&check.secure){
    // Refuse an exhausted account before reading another client body.
    loginLimiter.check();
    // Login is unauthenticated and never uploads originals. Do not give it the
    // 22 MB document-import budget before the existing password/rate checks.
    const b=await readBody(req,{authenticated:false,maxBytes:8_192});
    const now=Date.now();
    loginLimiter.reserve();
    if(typeof b.password!=='string'||b.password.length>1024||!verifyPassword(b.password,check.adminHash)){
      throw bad(401,'Felaktigt lösenord');
    }
    loginLimiter.clear();controlDb.prepare('DELETE FROM sessions WHERE id_hash=? OR expires_at<=?').run(sessionHash(req),now);
    const value=token();controlDb.prepare('INSERT INTO sessions(id_hash,expires_at,principal) VALUES(?,?,?)').run(digest(value),now+8*3600000,'administrator');
    return json(res,200,{authenticated:true},{'Set-Cookie':sessionCookie(value,true)});
  }
  if(!req.principal)throw bad(401,'Logga in för att läsa företagets uppgifter');
  if(path==='/api/logout'&&req.method==='POST'){
   controlDb.prepare('DELETE FROM bank_states WHERE session_hash=?').run(sessionHash(req));controlDb.prepare('DELETE FROM gmail_states WHERE session_hash=?').run(sessionHash(req));
   controlDb.prepare('DELETE FROM sessions WHERE id_hash=?').run(sessionHash(req));return json(res,200,{authenticated:false},{'Set-Cookie':clearCookie(check.secure)});
  }
  if(path==='/api/companies'&&req.method==='GET'){assertSessionIdentity(req);return json(res,200,companyRuntime.listCompanies(req.actorId));}
  if(path==='/api/companies/active'&&req.method==='POST'){
   req.allowCompanySelection=true;const body=await readBody(req);
   if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(key=>!['companyId','contextVersion'].includes(key)))throw bad(400,'Ogiltigt företagsval.');
   const context=companyRuntime.selectActiveCompany({actorId:req.actorId,companyId:body.companyId,contextVersion:body.contextVersion});
   return json(res,200,{context});
  }
  const selected=companyRuntime.resolve({actorId:req.actorId,...companySelector(req,url)});
  const context=callbackCompanyContext(req,url,path,selected);
  req.companyContext=context;req.companyAction=companyAction(req.method,path);
  req.principal=context?.storageOwner||req.actorId;
  return companyRuntime.run(context,()=>withGmailAccount(companyMailbox(context),()=>{companyRuntime.assert(req.companyAction);return companyRoute(req,res,url,path);}),{actorId:req.actorId,authorize:()=>assertSessionIdentity(req)});
}
async function companyRoute(req,res,url,path){
  const saas=/^\/api\/companies\/([^/]+)\/bank(?:\/(.*))?$/.exec(path);
  if(saas){
    if(!req.companyContext||decodeURIComponent(saas[1])!==req.companyContext.companyId)throw new ConsentError('COMPANY_ACCESS_DENIED',403);
    const runtime=nodeSaasBankRuntime({db,controlDb,context:req.companyContext,assertCurrent:()=>assertSessionStillAuthorized(req),sessionHash:sessionHash(req),origin:check.origin,requestKey:req.headers['idempotency-key']});
    const action=saas[2]||'';
    if(req.method==='GET'&&action==='')return json(res,200,await runtime.snapshot());
    if(req.method==='GET'&&action==='sync'){
      if([...url.searchParams.keys()].some(key=>!['accountId','companyId','companyContextVersion'].includes(key))||url.searchParams.getAll('accountId').length!==1)throw bad(400,'Välj ett konto.');
      return json(res,200,await readNodeOpenPaymentsCompanySyncStatus({db,controlDb,context:req.companyContext,assertCurrent:()=>assertSessionStillAuthorized(req),accountId:url.searchParams.get('accountId'),environment:process.env}));
    }
    if(req.method==='GET'&&action==='callback'){
      const body={};for(const [key,value]of url.searchParams){if(Object.hasOwn(body,key))throw new ConsentError('INVALID_CALLBACK',403);body[key]=value;}
      return json(res,200,await runtime.callback(body));
    }
    const handoff=/^authorizations\/([^/]+)\/redirect$/.exec(action);
    if(req.method==='GET'&&handoff)return redirect(res,await runtime.redirect(handoff[1]));
    const methods={connect:'start',renew:'renew',accounts:'select',disconnect:'revoke'};
    if(req.method==='POST'&&action==='sync'){
      const body=await readBody(req);
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['accountId','connectionId','expectedRevision'].includes(key))||typeof body.accountId!=='string'||typeof body.connectionId!=='string'||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<1)throw bad(400,'Ogiltig synkbegäran.');
      const sync=await openPaymentsSyncRuntime(req);if(!sync)throw new ConsentError('SAAS_BANK_DISABLED',409);
      return json(res,200,await sync.manual(body.accountId,{connectionId:body.connectionId,expectedRevision:body.expectedRevision}));
    }
    if(req.method==='POST'&&methods[action]){
      const body=await readBody(req),result=await runtime[methods[action]](body);
      if(action==='accounts'&&body.accountIds?.length){const sync=await openPaymentsSyncRuntime(req);if(sync){const results=[];for(const accountId of body.accountIds)results.push(await sync.manual(accountId,{expectedRevision:result.revision}));return json(res,200,{...result,syncResults:results});}}
      return json(res,200,result);
    }
    throw bad(404,'Bankåtgärden saknas');
  }

  if(path==='/api/bankgiro/source/status'&&req.method==='GET')return json(res,200,publicBankgiroStatus(await (await bankgiroIngest(req.principal)).status(req.principal)));
  if(path==='/api/bankgiro/source/run'&&req.method==='POST'){
    assertLegacyBankRuntime();
    const body=await readBody(req);
    if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).length)throw bad(400,'Bankgirohämtningen accepterar ingen ägare eller källkonfiguration.');
    const ingest=await bankgiroIngest(req.principal);assertSessionStillAuthorized(req);
    return json(res,200,publicBankgiroStatus(await ingest.run(req.principal)));
  }
  if(path==='/api/reconciliation/preview'&&req.method==='GET'){
    if([...url.searchParams.keys()].some(key=>key!=='transactionId')||url.searchParams.getAll('transactionId').length>1)throw bad(400,'Förhandsgranskningen accepterar bara en bankhändelseidentifierare.');
    const preview=await readReconciliationPreview(db,{owner:req.principal,transactionId:url.searchParams.get('transactionId')??undefined});
    assertSessionStillAuthorized(req);
    return json(res,200,preview);
  }
  if(path==='/api/payment-control/overview'&&req.method==='GET')return json(res,200,{...paymentOverview(),run:paymentControl.latest(req.principal),last_successful_control:db.prepare("SELECT finished_at FROM payment_control_runs WHERE owner=? AND status='complete' ORDER BY finished_at DESC LIMIT 1").get(req.principal)?.finished_at||''});
  if(path==='/api/payment-control/run'&&req.method==='POST'){
    const body=await readBody(req);
    if(Object.keys(body).some(key=>key!=='request_id'))throw bad(400,'Kontrollen accepterar bara en begäransidentifierare.');
    const result=paymentControl.start(req.principal,body.request_id,()=>assertSessionStillAuthorized(req));
    audit(db,'payment_control_requested',{id:result.job.id,reused:result.reused,principal:req.principal});
    return json(res,result.job.status==='running'?202:200,result);
  }
  if(/^\/api\/payment-control\/runs\/[^/]+$/.test(path)&&req.method==='GET'){
    return json(res,200,{job:paymentControl.get(req.principal,decodeURIComponent(path.split('/').pop()))});
  }
  if(path==='/api/dashboard'&&req.method==='GET')return json(res,200,invoiceStatus(db));
  if(path==='/api/settings'&&req.method==='GET'){
    const jobs=integrationJobs.summary(),alarm=jobs.find(j=>j.last_error&&!j.running);
    return json(res,200,{...getSettings(db),scheduler_available:true,scheduler:{...schedulerState,last_error:schedulerState.last_error||(alarm?`${alarm.name}: ${alarm.blocked?'Automatisk hämtning stoppad efter tre försök. ':''}${alarm.last_error}`:''),jobs},backup:backupStatus,user_mode:'single_administrator'});
  }
  if(path==='/api/settings'&&req.method==='PATCH'){
    const b=await readBody(req),settings=getSettings(db);
    const limits={company_name:240,organization_number:40,email:240,phone:80,address:500,bankgiro:80};
    for(const [key,max] of Object.entries(limits))if(b[key]!==undefined)settings[key]=key==='company_name'?requiredString(b[key],'Företagsnamn',max):optionalString(b[key],max);
    if(Object.hasOwn(b,'invoice_reference_policies'))settings.invoice_reference_policies=b.invoice_reference_policies;
    for(const key of ['notifications_due','notifications_review','auto_register_known'])if(b[key]!==undefined){if(typeof b[key]!=='boolean')throw bad(400,'Aviseringsinställningen måste vara på eller av');settings[key]=b[key];}
    if(b.reminders_enabled===true)throw bad(409,'Automatiskt utskick av påminnelser är inte aktiverat. Du kan skapa och kontrollera utkast.');
    if(b.sync_interval_minutes!==undefined){if(![0,15,30,60,240,1440].includes(b.sync_interval_minutes))throw bad(400,'Välj ett giltigt hämtningsintervall');settings.sync_interval_minutes=b.sync_interval_minutes;}
    if(b.gmail_sync_interval_minutes!==undefined){if(![0,15,30,60,240,1440].includes(b.gmail_sync_interval_minutes))throw bad(400,'Välj ett giltigt Gmail-intervall');settings.gmail_sync_interval_minutes=b.gmail_sync_interval_minutes;}
    return json(res,200,{...saveSettings(db,settings),scheduler_available:true,user_mode:'single_administrator'});
  }
  if(path==='/api/invoices'&&req.method==='GET')return json(res,200,{items:reconciliationData(db).invoices});
  if(path==='/api/invoices'&&req.method==='POST')return json(res,201,addInvoice(await readBody(req)));
  if(/^\/api\/invoices\/[^/]+$/.test(path)&&req.method==='GET'){
    const evidence=reconciliationData(db),id=decodeURIComponent(path.split('/').pop()),invoice=evidence.invoices.find(i=>i.id===id);if(!invoice)throw bad(404,'Fakturan saknas');
    const transactions=listTransactions(db),allocations=decorateManualMultipleAllocations(db,db.prepare('SELECT * FROM allocations WHERE invoice_id=? ORDER BY confirmed_at DESC').all(id)).map(a=>({...a,transaction:transactions.find(t=>t.id===a.transaction_id)}));
    return json(res,200,{invoice,allocations,documents:listDocuments(db).filter(d=>d.invoice_id===id),analysis:invoiceAnalysis(invoice,analyzeReconciliation(evidence).filter(s=>s.invoice_id===id))});
  }
  if(path==='/api/invoices'&&req.method==='PATCH'){
    const b=await readBody(req);const prev=db.prepare('SELECT * FROM invoices WHERE id=?').get(b.id);
    if(!prev)throw bad(404,'Faktura saknas');
    if(duplicateInvoice(prev.direction,prev.invoice_number,requiredString(b.party??prev.party,'Företag/person'),prev.id))throw bad(409,'Ändringen skulle skapa en dubblett av en befintlig faktura');
    if(b.total_cents!==undefined&&Number(b.total_cents)!==prev.total_cents)throw bad(409,'Beloppet kan inte ändras efter registrering; skapa korrigeringsfaktura');
    if(b.reconciled===true&&(b.confirm!==true||!optionalString(b.reconciliation_note,1500)))throw bad(400,'Bekräfta kontrollen och ange vilket bankunderlag du har kontrollerat');
    const document=b.document_id?db.prepare('SELECT id,invoice_id FROM documents WHERE id=?').get(b.document_id):null;
    if(b.document_id&&!document)throw bad(404,'Originalunderlaget saknas');if(document?.invoice_id&&document.invoice_id!==b.id)throw bad(409,'Underlaget hör till en annan faktura');
    const due_at=validateDate(b.due_at??prev.due_at),issued_at=validateDate(b.issued_at??prev.issued_at);
    db.exec('BEGIN IMMEDIATE');
    try{
      if(b.reconciled===true&&bankEvidenceBlocksAbsence(db))throw bad(409,'Motstridiga bankunderlag måste granskas innan utebliven betalning kan bekräftas.');
      const info=db.prepare('UPDATE invoices SET party=?,email=?,issued_at=?,due_at=?,note=?,reference=?,bankgiro=?,reconciled_at=?,reconciliation_note=? WHERE id=?').run(requiredString(b.party??prev.party,'Företag/person'),optionalString(b.email??prev.email,240),issued_at,due_at,optionalString(b.note??prev.note,1500),optionalString(b.reference??prev.reference,120),optionalString(b.bankgiro??prev.bankgiro,80),b.reconciled===true?new Date().toISOString():b.reconciled===false?'':prev.reconciled_at,b.reconciled===true?optionalString(b.reconciliation_note,1500):prev.reconciliation_note,b.id);
      if(document)db.prepare("UPDATE documents SET invoice_id=?,status='registered' WHERE id=?").run(b.id,document.id);
      const updated=db.prepare('SELECT * FROM invoices WHERE id=?').get(b.id),changes={};
      for(const key of ['party','email','issued_at','due_at','note','reference','bankgiro','reconciled_at','reconciliation_note'])if(prev[key]!==updated[key])changes[key]={before:prev[key],after:updated[key]};
      audit(db,b.reconciled===true?'invoice_reconciled':'invoice_updated',{id:b.id,changes,document_id:document?.id});db.exec('COMMIT');return json(res,200,{updated:info.changes>0});
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  if(path==='/api/bank-transactions'&&req.method==='GET'){
    const suggestions=matchingSuggestions(db);return json(res,200,{items:listTransactions(db).map(t=>({...t,specification_link:bankSpecificationPresentation(db,t.id,req.principal),status:t.status==='unmatched'&&suggestions.some(s=>s.transaction_id===t.id)?'suggested':t.status}))});
  }
  if(path==='/api/bank-specifications'&&req.method==='GET')return json(res,200,bankSpecificationCandidates(db,requiredString(url.searchParams.get('transaction_id'),'Bankhändelse'),req.principal));
  if(path==='/api/bank-specification-links'&&req.method==='POST')return json(res,200,confirmBankSpecificationLink(db,await readBody(req),req.principal,()=>assertSessionStillAuthorized(req)));
  if(/^\/api\/bank-specification-links\/[^/]+\/revoke$/.test(path)&&req.method==='POST')return json(res,200,revokeBankSpecificationLink(db,decodeURIComponent(path.split('/')[3]),await readBody(req),req.principal,()=>assertSessionStillAuthorized(req)));
  if(/^\/api\/bank-transactions\/[^/]+\/original$/.test(path)&&req.method==='GET'){
    const original=bankApiOriginal(db,decodeURIComponent(path.split('/')[3]),req.principal),bytes=Buffer.from(JSON.stringify(original));
    res.writeHead(200,{...baseHeaders,...companyHeaders(),'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="bankoriginal.json"','Content-Length':bytes.length});return res.end(bytes);
  }
  if(path==='/api/bank-transactions'&&req.method==='POST')return json(res,201,addBankTransaction(await readBody(req)));
  if(path==='/api/bank-transactions'&&req.method==='PATCH'){
    const b=await readBody(req),t=listTransactions(db).find(t=>t.id===b.id);if(!t)throw bad(404,'Bankhändelsen saknas');
    if(b.excluded!==undefined&&typeof b.excluded!=='boolean')throw bad(400,'Ange om bankhändelsen ska undantas');
    if(b.excluded===true&&t.allocated_cents>0)throw bad(409,'Ångra befintliga matchningar innan händelsen undantas');
    if(b.excluded===true&&!optionalString(b.reason,500))throw bad(400,'Ange varför händelsen ska undantas');
    if(b.payer!==undefined||b.reference!==undefined)throw bad(409,'Originaluppgifterna från banken ska bevaras. Importera kompletterande underlag i stället.');
    db.prepare('UPDATE bank_transactions SET excluded=?,exclusion_reason=? WHERE id=?').run(b.excluded===undefined?t.excluded:b.excluded?1:0,b.excluded===true?optionalString(b.reason,500):'',b.id);
    audit(db,b.excluded?'transaction_excluded':'transaction_restored',{id:b.id,reason:optionalString(b.reason,500)});return json(res,200,{updated:true});
  }
  if(path==='/api/suggestions'&&req.method==='GET'){
    const customers=new Set(listInvoices(db).filter(i=>i.direction==='customer'&&i.kind!=='credit').map(i=>i.id));
    const items=analyzeReconciliation(reconciliationData(db)).filter(s=>s.invoice_id&&s.amount_cents>0).map(s=>({...s,confidence:s.safe?'high':'medium'}));
    return json(res,200,{items:[...items,...matchingSuggestions(db).filter(s=>!customers.has(s.invoice_id))]});
  }
  if(path==='/api/reconciliation'&&req.method==='POST')return json(res,200,{items:reconcileAndPrepare()});
  if(path==='/api/customer-messages'&&req.method==='GET')return json(res,200,{items:listMessages(db)});
  if(path==='/api/customer-contacts'&&req.method==='POST'){
    const body=await readBody(req);assertSessionStillAuthorized(req);
    verifyContact(db,body,req.actorId);reconcileAndPrepare();return json(res,200,{ok:true});
  }
  if(path==='/api/payer-links'&&req.method==='POST'){
    const body=await readBody(req);assertSessionStillAuthorized(req);
    verifyPayer(db,body,req.actorId);reconcileAndPrepare();return json(res,200,{ok:true});
  }
  if(/^\/api\/customer-messages\/[^/]+\/(edit|reject|review|send)$/.test(path)&&req.method==='POST'){
    const id=decodeURIComponent(path.split('/')[3]),action=path.split('/')[4],b=await readBody(req);
    assertSessionStillAuthorized(req);
    if(action==='edit'){editMessage(db,id,b,req.actorId);return json(res,200,{ok:true});}
    if(action==='reject'){rejectMessage(db,id,b.version,req.actorId);return json(res,200,{ok:true});}
    if(action==='review')return json(res,200,reviewMessage(db,id,b.version,req.actorId,sessionHash(req)));
    const result=await approveAndSend(db,id,b,req.actorId,sessionHash(req),{authorize:()=>assertSessionStillAuthorized(req),prepare:async()=>{
      const c=db.prepare("SELECT * FROM gmail_connections WHERE status='connected' ORDER BY created_at DESC LIMIT 1").get();
      if(!c||c.email.toLowerCase()!==gmailAccount())throw bad(409,'Koppla företagets Gmail-konto först.');
      const tokens=decryptObject(c.encrypted_tokens),deliver=await prepareGmailSend(tokens,{authorize:()=>assertSessionStillAuthorized(req)});
      assertSessionStillAuthorized(req);
      const current=db.prepare("SELECT * FROM gmail_connections WHERE id=? AND status='connected'").get(c.id);
      if(!current||current.email!==c.email)throw bad(409,'Gmail-anslutningen har ändrats.');
      db.prepare('UPDATE gmail_connections SET encrypted_tokens=? WHERE id=?').run(encryptObject(tokens),c.id);
      return deliver;
    }});
    return json(res,200,result);
  }
  if(path==='/api/imports'&&req.method==='GET')return json(res,200,{items:listImports(db)});
  if(/^\/api\/imports\/[^/]+\/original$/.test(path)&&req.method==='GET'){
    const item=db.prepare("SELECT name,content,mime_type,content_sha256 FROM import_jobs WHERE id=? AND (owner='' OR owner=?)").get(decodeURIComponent(path.split('/')[3]),req.principal);
    if(!item?.content)throw bad(404,'Originalfilen saknas');
    if(!item.content_sha256||digest(item.content)!==item.content_sha256)throw bad(409,'Originalfilens SHA-256 kan inte verifieras.');
    res.writeHead(200,{...baseHeaders,...companyHeaders(),'Content-Type':item.mime_type||'application/octet-stream','Content-Disposition':`attachment; filename="bankunderlag${item.mime_type==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'?'.xlsx':item.mime_type==='application/xml'?'.xml':'.csv'}"`,'Content-Length':item.content.length,'Content-Security-Policy':"sandbox; default-src 'none'"});return res.end(Buffer.from(item.content));
  }
  if(path==='/api/import/preview'&&req.method==='POST'){
    const b=await readBody(req);const items=importBankFile(b,req);
    const warnings=[...new Set(items.flatMap(x=>x.warnings||[]))];
    return json(res,200,{count:items.length,items,warnings,review:items.filter(i=>i.review_only||i.is_aggregate||!i.payer&&!i.reference).length,review_only:items.some(i=>i.review_only)});
  }
  if(path==='/api/import/commit'&&req.method==='POST'){
    const b=await readBody(req);if(b.confirm!==true)throw bad(400,'Bekräfta importen');
    const items=importBankFile(b,req);
    if(items.some(item=>item.review_only))return json(res,200,retainBankgiroReview(b,items,req));
    return json(res,200,storeTransactions(db,items,'file:'+optionalString(b.name,120),{content:Buffer.from(b.content_base64,'base64'),mime_type:/\.xml$/i.test(b.name)?'application/xml':'text/csv; charset=utf-8'}));
  }
  if(path==='/api/documents'&&req.method==='GET')return json(res,200,{items:listDocuments(db)});
  if(path==='/api/documents'&&req.method==='POST'){
    const b=await readBody(req),payload=filePayload(b);
    if(b.invoice_id&&!db.prepare('SELECT id FROM invoices WHERE id=?').get(b.invoice_id))throw bad(404,'Fakturan saknas');
    const stored=storeDocument(db,{...payload,invoice_id:b.invoice_id||null});
    if(!stored.invoice_id&&!stored.duplicate){await analyzeDocument(db,stored.id,{authorize:()=>assertSessionStillAuthorized(req)});Object.assign(stored,listDocuments(db).find(d=>d.id===stored.id));}
    assertSessionStillAuthorized(req);
    recordImport(db,{source:'document',name:payload.name,found:1,imported:stored.duplicate?0:1,duplicate:stored.duplicate?1:0,review:stored.duplicate||b.invoice_id?0:1});
    return json(res,stored.duplicate?200:201,stored);
  }
  if(path==='/api/documents'&&req.method==='PATCH'){
    const b=await readBody(req),doc=db.prepare('SELECT * FROM documents WHERE id=?').get(b.id);if(!doc)throw bad(404,'Underlaget saknas');
    if(doc.invoice_id)throw bad(409,'Underlaget är kopplat till en registrerad faktura');
    if(!['dismissed','needs_review'].includes(b.status))throw bad(400,'Välj om underlaget ska granskas eller undantas');
    if(b.status==='dismissed'&&!optionalString(b.reason,500))throw bad(400,'Ange varför underlaget ska undantas');
    const metadata={...JSON.parse(doc.metadata),dismissal_reason:b.status==='dismissed'?optionalString(b.reason,500):''};
    db.prepare('UPDATE documents SET status=?,metadata=? WHERE id=?').run(b.status,JSON.stringify(metadata),b.id);audit(db,b.status==='dismissed'?'document_dismissed':'document_restored',{id:b.id,reason:optionalString(b.reason,500)});return json(res,200,{updated:true});
  }
  if(/^\/api\/documents\/[^/]+\/(analyze|approve)$/.test(path)&&req.method==='POST'){
    const id=decodeURIComponent(path.split('/')[3]),body=await readBody(req);
    assertSessionStillAuthorized(req);
    if(path.endsWith('/analyze'))return json(res,200,await analyzeDocument(db,id,{authorize:()=>assertSessionStillAuthorized(req)}));
    return json(res,200,approveDocument(db,id,body));
  }
  if(/^\/api\/documents\/[^/]+\/preview$/.test(path)&&req.method==='GET'){
    const doc=db.prepare('SELECT * FROM documents WHERE id=?').get(decodeURIComponent(path.split('/')[3]));if(!doc)throw bad(404,'Underlaget saknas');
    let bytes=Buffer.from(doc.content),mime=doc.mime_type;
    if(mime==='application/pdf'){const result=await runDocumentProcess(bytes,mime,true);if(!result.preview)throw bad(422,'Förhandsvisningen kunde inte skapas. Ladda ned originalet.');bytes=Buffer.from(result.preview);mime='image/png';assertSessionStillAuthorized(req);}
    res.writeHead(200,{...baseHeaders,...companyHeaders(),'Content-Type':mime,'Content-Disposition':'inline','Content-Security-Policy':"sandbox; default-src 'none'; frame-ancestors 'self'",'X-Frame-Options':'SAMEORIGIN'});return res.end(bytes);
  }
  if(/^\/api\/documents\/[^/]+$/.test(path)&&req.method==='GET'){
    const id=decodeURIComponent(path.split('/').pop()),doc=db.prepare('SELECT * FROM documents WHERE id=?').get(id);if(!doc)throw bad(404,'Originalunderlaget saknas');
    const safeName=doc.name.replace(/[^A-Za-z0-9._-]/g,'_');
    res.writeHead(200,{...baseHeaders,...companyHeaders(),'Content-Type':doc.mime_type,'Content-Disposition':`attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(doc.name)}`,'Content-Length':doc.content.length,'Content-Security-Policy':"sandbox; default-src 'none'"});return res.end(Buffer.from(doc.content));
  }
  if(path==='/api/allocations'&&req.method==='GET')return json(res,200,{items:decorateManualMultipleAllocations(db,db.prepare('SELECT * FROM allocations ORDER BY confirmed_at DESC').all())});
  if(path==='/api/manual-allocations'&&req.method==='GET'){
    const keys=[...url.searchParams.keys()];if(keys.length!==1||!['transactionId','requestId'].includes(keys[0]))throw bad(400,'Välj en bankhändelse eller en kvittoidentifierare.');
    const result=keys[0]==='requestId'?readManualMultipleReceipt(db,{owner:req.principal,requestId:url.searchParams.get('requestId')}):await discoverManualMultiple(db,{owner:req.principal,transactionId:url.searchParams.get('transactionId')});
    assertSessionStillAuthorized(req);return json(res,200,result);
  }
  if(path==='/api/manual-allocations/preview'&&req.method==='POST'){
    const result=await previewManualMultiple(db,{owner:req.principal,request:await readBody(req)});assertSessionStillAuthorized(req);return json(res,200,result);
  }
  if(path==='/api/manual-allocations'&&req.method==='POST'){
    const result=await commitManualMultiple(db,{owner:req.principal,request:await readBody(req),assertCurrent:()=>assertSessionStillAuthorized(req)});return json(res,result.replayed?200:201,result);
  }
  if(path==='/api/allocations'&&req.method==='POST'){
    const b=await readBody(req);if(b.confirm!==true)throw bad(400,'Matchning måste bekräftas manuellt');
    const invoiceId=requiredString(b.invoice_id,'Faktura-ID'),transactionId=requiredString(b.transaction_id,'Bankhändelse-ID');
    db.exec('BEGIN IMMEDIATE');
    try{
      assertSessionStillAuthorized(req);
      const transaction=reconciliationData(db,{owner:req.principal}).transactions.find(t=>t.id===transactionId);
      if(!transaction?.original_verified)throw bad(409,'Ett bevarat och verifierbart bankoriginal krävs före en ny fakturaallokering.');
      if(transaction.account_consent_issue)throw bad(409,transaction.account_consent_issue);
      allocate(db,invoiceId,transactionId,Number(b.amount_cents),{transactionOpen:true});db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');if(e.status)throw e;throw bad(400,/UNIQUE/.test(e.message)?'Den här matchningen finns redan':e.message);}
    return json(res,201,{ok:true});
  }
  if(path==='/api/allocations'&&req.method==='DELETE'){
    const b=await readBody(req);return json(res,200,{removed:deleteAllocation(db,requiredString(b.id,'Matchnings-ID'))});
  }
  if(path==='/api/audit'&&req.method==='GET')return json(res,200,{items:db.prepare('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 100').all()});
  if(path==='/api/export'&&req.method==='GET'){
    const evidence=reconciliationData(db);
    companyRuntime.recordDataExport();
    return json(res,200,{exported_at:new Date().toISOString(),settings:getSettings(db),invoices:evidence.invoices,transactions:listTransactions(db),allocations:db.prepare('SELECT * FROM allocations').all(),imports:listImports(db),documents:listDocuments(db),customer_messages:listMessages(db),message_approvals:db.prepare('SELECT * FROM message_approvals').all(),message_deliveries:db.prepare('SELECT * FROM message_deliveries').all(),verified_contacts:db.prepare('SELECT * FROM verified_contacts').all(),payer_links:db.prepare('SELECT * FROM payer_links').all(),bank_specification_links:db.prepare('SELECT * FROM bank_specification_links').all(),reconciliation_findings:db.prepare('SELECT * FROM reconciliation_findings').all(),audit:db.prepare('SELECT * FROM audit_events ORDER BY created_at DESC').all()},{'Content-Disposition':'attachment; filename="mg-fakturakoll-export.json"'});
  }
  // AIS only: reads account data, never creates, approves or executes payments.
  if(path==='/api/bank/status'&&req.method==='GET'){
    if(url.searchParams.getAll('companyId').length>1)throw new ConsentError('COMPANY_ACCESS_DENIED',403);
    const company=bankCompanyContext(req.principal,url.searchParams.get('companyId')??undefined,'read');
    const activation=configStatus();
    const connections=db.prepare('SELECT * FROM bank_connections WHERE owner=? ORDER BY created_at DESC,rowid DESC').all(req.principal);
    // Status is a read for every company role. Project terminal reasons without
    // changing retained flow evidence or granting viewers database writes.
    // Browser sessions live in the control database, not a company partition.
    const observedAt=Date.now(),liveSession=controlDb.prepare('SELECT 1 FROM sessions WHERE id_hash=? AND expires_at>?');
    const flows=db.prepare('SELECT * FROM bank_states WHERE owner=? ORDER BY rowid DESC LIMIT 20').all(req.principal).map(flow=>{
      let status=flow.status,reason=flow.terminal_reason||null;
      if(flow.expires_at<=observedAt&&['pending','consuming'].includes(status)){status='expired';reason='CONSENT_FLOW_EXPIRED';}
      else if(status==='pending'&&!liveSession.get(flow.session_hash,observedAt)){status='session_lost';reason='SESSION_ENDED';}
      return {id:flow.flow_id||null,companyId:company.companyId,status,reason,expiresAt:new Date(flow.expires_at).toISOString(),connectionId:flow.connection_id||null};
    });
    return json(res,200,{configured:activation.configured,activation,environment:activation.environment,company:{id:company.companyId,canManageBank:['owner','admin'].includes(company.role),membershipMode:companyRuntime.current()?'company':'legacy_workspace'},consentFlow:flows[0]??null,consentFlows:flows,connections:connections.map(x=>{
      let accounts=[],sync_coverage=null,status=x.status==='revocation_pending'?x.status:!Number.isFinite(Date.parse(x.valid_until))||Date.parse(x.valid_until)<=Date.now()?'renewal_required':x.status;
      let consent;
      try{
        consent=publicConsent(x,req.principal);
        const saved=decryptObject(x.accounts_json),selected=saved.find(a=>a.uid===x.selected_account_uid);
        const allowed=consent.mode==='legacy'?saved:saved.filter(a=>consent.corporateAuthorization.status==='verified'&&consent.corporateAuthorization.accountUids.includes(a.uid));
        accounts=allowed.filter(a=>a.currency==='SEK').map(a=>({uid:a.uid,name:a.name,currency:a.currency,account_hint:maskAccount(a.account_id?.iban||a.account_id?.other?.identification)}));
        if(selected)sync_coverage=bankSyncCoverage(decryptObject(x.encrypted_session),stableAccountIdentity(selected,x.bank_name),x.last_synced);
        if(!['renewal_required','revocation_pending'].includes(status)&&consent.mode==='company'&&consent.corporateAuthorization.status!=='verified')status='corporate_authorization_required';
        else if(status==='corporate_authorization_required')status='pending_account';
      }catch{status='error';}
      return {id:x.id,bank_name:x.bank_name,valid_until:x.valid_until,last_synced:x.last_synced,selected_account_uid:x.selected_account_uid,last_error:x.last_error,retry_after:x.retry_after,status,accounts,sync_coverage,consent};
    })});
  }
  if(path==='/api/bank/connect'&&req.method==='POST'){
    const b=await readBody(req),{context:company,requiredScopes}=requestedBankConsent(req.principal,b),activation=configStatus();
    if(!activation.configured)throw Object.assign(bad(409,activation.message),{code:activation.code});
    const renewal=b.renew_connection_id?ownedConnection(req,b.renew_connection_id):null;
    if(renewal?.status==='revocation_pending')throw new ConsentError('BANK_DISCONNECT_PENDING',409,'Slutför frånkopplingen innan du kopplar banken igen.');
    if(renewal){assertConsentContext(consentMetadata(renewal),req.principal,company.companyId);if(b.bankName&&b.bankName!==renewal.bank_name)throw new ConsentError('BUSINESS_BANK_UNAVAILABLE',409);}
    if(renewal&&bankSyncing.has(renewal.id))throw bad(409,'Vänta tills bankhämtningen har avslutats');
    // A local flag cannot assert vendor approval: check the actual registered app.
    await assertApplicationReady(check.origin);
    assertSessionStillAuthorized(req);
    const banks=await findSwedbank(),requestedBank=b.bankName||renewal?.bank_name;const bank=requestedBank?banks.find(x=>x.name===requestedBank):banks.find(x=>x.name==='Swedbank')||banks[0];
    assertSessionStillAuthorized(req);
    if(!bank)throw new ConsentError('BUSINESS_BANK_UNAVAILABLE',409);
    const state=token(),flowId=randomUUID(),body=startConsentBody(bank,state,check.origin);
    const context={version:1,mode:'company',companyId:company.companyId,actorId:company.actorId,membershipVersion:company.membershipVersion,provider:'enablebanking',intent:renewal?'renew':'connect',flowId,requiredScopes,requestedValidUntil:body.access.valid_until,renewConnectionId:renewal?.id||'',previousSessionHash:renewal?digest(renewal.encrypted_session):'',applicationFingerprint:consentApplicationFingerprint()};
    db.prepare('INSERT INTO bank_states(state_hash,expires_at,session_hash,owner,renew_connection_id,bank_name,context_json,flow_id,company_context_json) VALUES(?,?,?,?,?,?,?,?,?)').run(digest(state),Date.now()+15*60000,sessionHash(req),req.principal,renewal?.id||'',bank.name,JSON.stringify(context),flowId,oauthCompanyPin(req));
    try{
      const auth=await bankingRequest('/auth',{method:'POST',body});
      assertSessionStillAuthorized(req);
      const authUrl=validateAuthorizationUrl(auth.url);
      audit(db,'bank_consent_started',{bank:bank.name,company_id:company.companyId,flow_id:flowId,intent:context.intent});return json(res,200,{url:String(authUrl),environment:activation.environment,companyId:company.companyId,flowId,requiredScopes,authorization:'provider_redirect',pkce:'not_exposed_by_adapter'});
    }catch(e){finishBankFlow(digest(state),'failed',e.code||'authorization_failed');throw e;}
  }
  // Callback intentionally uses GET and SameSite=Lax cookie from interactive browser navigation.
  if(path==='/api/bank/callback'&&req.method==='GET'){
    let callback;try{callback=validateCallbackParameters(url.searchParams);}catch{throw new ConsentError('INVALID_CALLBACK',403);}
    const stateHash=digest(callback.state),record=db.prepare('SELECT * FROM bank_states WHERE state_hash=?').get(stateHash);
    if(!record||record.consumed||record.expires_at<=Date.now()||record.owner!==req.principal||!secureEqual(record.session_hash,sessionHash(req)))throw bad(403,'Ogiltig eller för gammal bankretur');
    const consumed=db.prepare("UPDATE bank_states SET consumed=1,status='consuming' WHERE state_hash=? AND consumed=0 AND status='pending' AND expires_at>? AND owner=? AND session_hash=?").run(stateHash,Date.now(),req.principal,sessionHash(req));
    if(!consumed.changes)throw bad(403,'Bankreturen har redan använts');
    let renewalLock='',session,previousRemote='',committed=false;
    try{
      const context=flowContext(record,req.principal),company=bankCompanyContext(req.principal,context.companyId);
      if(callback.error){finishBankFlow(stateHash,callback.outcome,callback.error);audit(db,'bank_consent_'+callback.outcome,{flow_id:record.flow_id});return redirect(res,'/?tab=connections&status='+callback.outcome);}
      const id=record.renew_connection_id||randomUUID();
      let old;
      if(record.renew_connection_id){
        old=ownedConnection(req,id);
        if(bankSyncing.has(old.id))throw bad(409,'Vänta tills bankhämtningen har avslutats och förnya sedan igen');
        bankSyncing.add(old.id,{recordAttempt:false});renewalLock=old.id;
        if(context.previousSessionHash!==digest(old.encrypted_session))throw new ConsentError('CONSENT_RENEWAL_CONFLICT',409);
        if(old.status==='revocation_pending')throw new ConsentError('BANK_DISCONNECT_PENDING',409);
        previousRemote=decryptObject(old.encrypted_session).session_id;
      }
      const authorize=()=>{
        assertSessionStillAuthorized(req);flowContext(record,req.principal);
        const current=db.prepare('SELECT status,expires_at,context_json FROM bank_states WHERE state_hash=?').get(stateHash);
        if(!current||current.status!=='consuming'||current.expires_at<=Date.now()||current.context_json!==record.context_json)throw new ConsentError('CONSENT_FLOW_EXPIRED',409);
        if(old){bankLeases.get(old.id).assert();assertCurrentBankConnection(old);}
      };
      authorize();
      session=await bankingRequest('/sessions',{method:'POST',body:{code:callback.code}});
      authorize();
      if(typeof session.session_id==='string'&&bankSessionInUse(session.session_id))throw Object.assign(bad(502,'Banken återanvände ett befintligt medgivande. Starta ett nytt försök.'),{code:'BANK_SESSION_REUSED'});
      if(typeof session.session_id!=='string'||!session.session_id||session.session_id.length>256||/[\s\u0000-\u001f\u007f]/.test(session.session_id)||!Array.isArray(session.accounts)||!session.accounts.some(a=>a?.currency==='SEK'))throw bad(502,'Banken returnerade inget tillgängligt företagskonto i SEK med giltigt medgivande');
      const checked=await bankingRequest('/sessions/'+encodeURIComponent(session.session_id));authorize();
      const grant=validateEnableConsent({session,checked,bankName:record.bank_name,requestedValidUntil:context.requestedValidUntil,requestedScopes:context.requiredScopes});
      const accounts=validatedLiveAccountDetails(session.accounts,checked,record.bank_name);
      for(const account of accounts.filter(a=>a.currency==='SEK'))stableAccountIdentity(account,record.bank_name);
      const corporate=companyAccountGrant(company,record.bank_name,accounts,grant.validUntil);
      if(old&&corporate.authority.status!=='verified')throw new ConsentError('CORPORATE_AUTHORIZATION_REQUIRED',409);
      let validUntil=corporate.authority.status==='verified'?corporate.authority.validUntil:grant.validUntil;
      const consent={version:'bank-consent-v1',mode:'company',companyId:company.companyId,actorId:company.actorId,membershipVersion:company.membershipVersion,provider:'enablebanking',intent:context.intent,requestedScopes:context.requiredScopes,grantedScopes:grant.grantedScopes,missingScopes:grant.missingScopes,requestedValidUntil:context.requestedValidUntil,validUntil,corporateAuthorization:corporate.authority};
      const status=corporate.authority.status!=='verified'?'corporate_authorization_required':'pending_account';
      const previousSession=old?decryptObject(old.encrypted_session):{};
      if(old&&previousSession.session_id!==session.session_id){
        // The provider may revoke successfully while its reply is lost. Fence
        // the old row before the call so it cannot remain apparently usable.
        bankLeases.get(old.id).write(()=>{authorize();db.prepare("UPDATE bank_connections SET status='renewal_required',last_error=? WHERE id=? AND owner=?").run('Det tidigare medgivandet ersätts. Slutför förnyelsen innan fler bankhändelser hämtas.',old.id,req.principal);});
        try{await bankingRequest('/sessions/'+encodeURIComponent(previousSession.session_id),{method:'DELETE'});}catch(e){if(![404,410].includes(e.providerStatus)&&e.code!=='renewal_required')throw bad(502,'Det tidigare medgivandet kunde inte avslutas. Förnya anslutningen igen.');}
        authorize();
      }
      const write=()=>{
        authorize();
        // Two fresh callbacks can pass the earlier ownership read while both
        // await GET /sessions. Recheck under SQLite's write lock before saving.
        if(bankSessionInUse(session.session_id))throw Object.assign(bad(502,'Banken återanvände ett befintligt medgivande. Starta ett nytt försök.'),{code:'BANK_SESSION_REUSED'});
        if(Date.parse(validUntil)<=Date.now())throw new ConsentError('BANK_CONSENT_EXPIRED',409);
        if(corporate.authority.status==='verified'){
          const current=companyAccountGrant(company,record.bank_name,accounts,validUntil);
          if(current.authority.status!=='verified')throw new ConsentError('CORPORATE_AUTHORIZATION_REQUIRED',409);
          validUntil=current.authority.validUntil;consent.validUntil=validUntil;consent.corporateAuthorization=current.authority;
        }
        if(old)db.prepare("UPDATE bank_connections SET encrypted_session=?,accounts_json=?,valid_until=?,consent_json=?,selected_account_uid='',status=?,last_error='',retry_after=0 WHERE id=? AND owner=?").run(encryptObject({...previousSession,session_id:session.session_id}),encryptObject(accounts),validUntil,JSON.stringify(consent),status,id,req.principal);
        else db.prepare('INSERT INTO bank_connections(id,provider,bank_name,encrypted_session,accounts_json,valid_until,owner,status,consent_json) VALUES(?,?,?,?,?,?,?,?,?)').run(id,'enablebanking',record.bank_name,encryptObject({session_id:session.session_id}),encryptObject(accounts),validUntil,req.principal,status,JSON.stringify(consent));
        finishBankFlow(stateHash,status==='pending_account'?'pending_confirmation':status,'',id);
        audit(db,'bank_accounts_authorized',{bank:record.bank_name,accounts:accounts.length,connection_id:id,company_id:company.companyId});
        if(old)bankLeases.get(old.id).success();
      };
      if(old)bankLeases.get(old.id).write(write);else{db.exec('BEGIN IMMEDIATE');try{write();db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
      committed=true;
      return redirect(res,'/?tab=connections&status='+(status==='pending_account'?'select_account':status));
    }catch(e){
      finishBankFlow(stateHash,'failed',e.code||'authorization_failed');
      if(!committed&&typeof session?.session_id==='string'&&session.session_id&&session.session_id!==previousRemote&&!bankSessionInUse(session.session_id))try{await bankingRequest('/sessions/'+encodeURIComponent(session.session_id),{method:'DELETE'});}catch{}
      throw e;
    }finally{if(renewalLock)bankSyncing.delete(renewalLock);}
  }
  if(path==='/api/bank/accounts'&&req.method==='POST'){
    assertLegacyBankRuntime();
    const b=await readBody(req),connection=ownedConnection(req,b.connection_id);
    assertConsentContext(consentMetadata(connection),req.principal,b.companyId);
    if(connection.status==='revocation_pending')throw new ConsentError('BANK_DISCONNECT_PENDING',409,'Slutför frånkopplingen innan du väljer ett konto.');
    if(bankSyncing.has(connection.id))throw bad(409,'Vänta tills bankåtgärden har avslutats');
    bankSyncing.add(connection.id);
    try{
    if(connection.retry_after>Date.now())throw Object.assign(bad(429,'Bankens anropsgräns är nådd. Försök igen senare.'),{retryAfter:Math.ceil((connection.retry_after-Date.now())/1000)});
    if(!Number.isFinite(Date.parse(connection.valid_until))||Date.parse(connection.valid_until)<=Date.now()||connection.status==='renewal_required')throw bad(409,'Bankanslutningen behöver förnyas – koppla igen');
    const account=decryptObject(connection.accounts_json).find(a=>a.uid===b.account_uid);
    if(!account||account.currency!=='SEK')throw bad(400,'Välj ett godkänt företagskonto');
    assertCorporateAccountAccess(connection,req.principal,account.uid,b.companyId);
    stableAccountIdentity(account,connection.bank_name);
    const expiresAt=await verifyBankSession({...connection,selected_account_uid:account.uid},bankLeases.get(connection.id).deadline);
    bankLeases.get(connection.id).write(()=>{assertLegacyBankRuntime();assertSessionStillAuthorized(req);
    assertCurrentBankConnection(connection);assertCorporateAccountAccess(connection,req.principal,account.uid,b.companyId);
    if(expiresAt<=Date.now())throw new ConsentError('BANK_CONSENT_EXPIRED',409);
    const changed=connection.selected_account_uid!==account.uid;
    db.prepare("UPDATE bank_connections SET selected_account_uid=?,last_synced=?,valid_until=?,status='connected',last_error='' WHERE id=? AND owner=?").run(account.uid,changed?'':connection.last_synced,new Date(Math.min(Date.parse(connection.valid_until),expiresAt)).toISOString(),connection.id,req.principal);
    db.prepare("UPDATE bank_states SET status='connected',terminal_reason='' WHERE connection_id=? AND owner=? AND status IN ('pending_confirmation','corporate_authorization_required')").run(connection.id,req.principal);
    audit(db,'bank_account_selected',{connection_id:connection.id});
    });
    try{return json(res,200,await syncBank({...ownedConnection(req,connection.id),request_session_hash:sessionHash(req)},{},true));}
    catch(e){if(e.status===401&&!e.providerStatus)throw e;return json(res,200,{imported:0,duplicate:0,initial_sync_error:e.message});}
    }catch(e){
      assertSessionStillAuthorized(req);
      bankLeases.get(connection.id).write(()=>{
      if(e.status===429||e.code==='bank_unavailable'&&e.status===503&&Number.isFinite(e.retryAfter)&&e.retryAfter>0)db.prepare('UPDATE bank_connections SET retry_after=?,last_error=? WHERE id=?').run(Date.now()+Math.max(60,e.retryAfter||60)*1000,'Bankhämtningen behöver vänta till nästa tillåtna försök.',connection.id);
      if(e.code==='renewal_required')db.prepare("UPDATE bank_connections SET status='renewal_required',last_error=? WHERE id=?").run('Bankanslutningen behöver förnyas – koppla igen',connection.id);
      });
      throw e;
    }finally{bankSyncing.delete(connection.id);}
  }
  if(path==='/api/bank/sync'&&req.method==='POST'){
    const b=await readBody(req),connection=ownedConnection(req,b.connection_id);
    assertConsentContext(consentMetadata(connection),req.principal,b.companyId);
    return json(res,200,await syncBank({...connection,request_session_hash:sessionHash(req)},b));
  }
  if(path==='/api/bank/connections'&&req.method==='DELETE'){
    const b=await readBody(req),connection=ownedConnection(req,b.id);
    assertConsentContext(consentMetadata(connection),req.principal,b.companyId);
    if(bankSyncing.has(connection.id))throw bad(409,'Vänta tills bankhämtningen har avslutats');
    bankSyncing.add(connection.id,{recordAttempt:false});
    try{
    bankLeases.get(connection.id).write(()=>{assertSessionStillAuthorized(req);assertCurrentBankConnection(connection);db.prepare("UPDATE bank_connections SET status='revocation_pending',last_error=? WHERE id=? AND owner=?").run('Frånkopplingen väntar på bekräftelse från banktjänsten.',connection.id,req.principal);});
    // Confirm the provider session closed; its API only closes bank consent if
    // possible, so never claim that the bank's own revocation was confirmed.
    try{await bankingRequest('/sessions/'+encodeURIComponent(decryptObject(connection.encrypted_session).session_id),{method:'DELETE'});}catch(e){if(![404,410].includes(e.providerStatus)&&e.code!=='renewal_required')throw bad(502,'Banken kunde inte återkalla åtkomsten. Försök igen eller återkalla medgivandet hos banken.');}
    bankLeases.get(connection.id).write(()=>{assertSessionStillAuthorized(req);assertCurrentBankConnection(connection);db.prepare('DELETE FROM bank_connections WHERE id=? AND owner=?').run(connection.id,req.principal);
    db.prepare("UPDATE bank_states SET consumed=1,status='disconnected',terminal_reason='CONNECTION_DISCONNECTED' WHERE owner=? AND ((renew_connection_id=? AND status='pending') OR (connection_id=? AND status IN ('pending_confirmation','corporate_authorization_required','connected')))").run(req.principal,connection.id,connection.id);
    audit(db,'bank_disconnected',{id:connection.id,provider_session_revoked:true,bank_revocation_confirmed:false});bankLeases.get(connection.id).success();});return json(res,200,{removed:true,providerSessionRevoked:true,bankRevocationConfirmed:false});
    }finally{bankSyncing.delete(connection.id);}
  }
  if(path==='/api/gmail/status'&&req.method==='GET')return json(res,200,gmailStatus());
  if(path==='/api/gmail/connect'&&req.method==='POST'){
    const options=await readBody(req);
    if(integrationJobs.running('gmail'))throw bad(409,'Vänta tills Gmail-hämtningen har avslutats');
    if(!isGmailConfigured())throw bad(409,'En administratör behöver först aktivera Google OAuth i serverns inställningar');
    const state=token();db.prepare('DELETE FROM gmail_states WHERE expires_at<=? OR (session_hash=? AND consumed=0)').run(Date.now(),sessionHash(req));db.prepare('INSERT INTO gmail_states(state_hash,expires_at,session_hash,company_context_json) VALUES(?,?,?,?)').run(digest(state),Date.now()+15*60000,sessionHash(req),oauthCompanyPin(req));
    db.prepare('UPDATE gmail_states SET request_send=? WHERE state_hash=?').run(options.send===true?1:0,digest(state));
    return json(res,200,{url:gmailAuthorizationUrl(state,check.origin,{send:options.send===true})});
  }
  if(path==='/api/gmail/callback'&&req.method==='GET'){
    if(['state','code','error'].some(k=>url.searchParams.getAll(k).length>1))throw bad(403,'Ogiltig Gmail-retur');
    const state=url.searchParams.get('state')||'',record=db.prepare('SELECT * FROM gmail_states WHERE state_hash=?').get(digest(state));
    if(!state||!record||record.consumed||record.expires_at<Date.now()||!secureEqual(record.session_hash,sessionHash(req)))throw bad(403,'Ogiltig eller för gammal Gmail-retur');
    if(!db.prepare('UPDATE gmail_states SET consumed=1 WHERE state_hash=? AND consumed=0').run(digest(state)).changes)throw bad(403,'Gmail-returen har redan använts');
    if(url.searchParams.has('error'))return redirect(res,'/?tab=import&gmail=cancelled');
    const code=url.searchParams.get('code');if(!code)throw bad(400,'Googles engångskod saknas');
    let tokens;const lease=integrationJobs.claim('gmail',{recordAttempt:false});
    try{
      tokens=await exchangeGmailCode(code,check.origin,{authorize:()=>assertSessionStillAuthorized(req)});assertSessionStillAuthorized(req);const profile=await gmailProfile(tokens,{authorize:()=>assertSessionStillAuthorized(req)});
      if(record.request_send&&!hasGmailSendScope(tokens))throw bad(409,'Google gav inte utskicksbehörighet. Koppla igen och godkänn gmail.send.');
      assertSessionStillAuthorized(req);lease.assert();
      if(!tokens.refresh_token){
        const existing=db.prepare('SELECT * FROM gmail_connections WHERE email=? ORDER BY created_at DESC LIMIT 1').get(profile.emailAddress);
        if(existing)tokens.refresh_token=decryptObject(existing.encrypted_tokens).refresh_token||'';
        if(!tokens.refresh_token)throw bad(409,'Google gav ingen bestående läsåtkomst. Koppla Gmail igen och godkänn åtkomsten.');
      }
      db.exec('BEGIN IMMEDIATE');
      try{
        lease.assert();assertSessionStillAuthorized(req);
        db.prepare('DELETE FROM gmail_connections').run();db.prepare('INSERT INTO gmail_connections(id,email,encrypted_tokens) VALUES(?,?,?)').run(randomUUID(),profile.emailAddress,encryptObject(tokens));audit(db,'gmail_connected',{email:profile.emailAddress});db.exec('COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e;}
      lease.success();return redirect(res,'/?tab=import&gmail=connected');
    }catch(e){if(e.code==='account_mismatch'&&tokens){try{await revokeGmailTokens(tokens);}catch{}}if(e.status)throw e;throw bad(502,'Gmail kunde inte kopplas. Kontrollera att rätt företagskonto valdes och försök igen.');}finally{lease.release();}
  }
  if(path==='/api/gmail/sync'&&req.method==='POST')return json(res,200,await syncGmail(req));
  if(path==='/api/gmail/connection'&&req.method==='DELETE'){
    const lease=integrationJobs.claim('gmail',{recordAttempt:false});
    try{const connection=db.prepare('SELECT * FROM gmail_connections ORDER BY created_at DESC LIMIT 1').get();
    if(connection){try{await revokeGmailTokens(decryptObject(connection.encrypted_tokens));}catch{throw bad(502,'Google kunde inte återkalla åtkomsten. Försök igen eller återkalla åtkomsten i Google-kontot.');}lease.write(()=>{assertSessionStillAuthorized(req);db.prepare('DELETE FROM gmail_connections WHERE id=?').run(connection.id);audit(db,'gmail_disconnected',{email:connection.email});lease.success();});}
    return json(res,200,{removed:!!connection});}finally{lease.release();}
  }
  throw bad(404,'Okänd begäran');
}
const server=http.createServer((req,res)=>route(req,res).catch(err=>{
  const status=err.status||(err instanceof TypeError?400:500);
  if(status>=500)console.error('Serverfel',status); // No provider payloads, request URLs, keys or tokens.
  if(!res.headersSent)json(res,status,{error:status>=500&&!err.safe&&!err.code?'Ett serverfel inträffade':err.message,...(err.code?{code:err.code}:{})},{...(err.retryAfter?{'Retry-After':String(err.retryAfter)}:{}),...(err.code==='COMPANY_CONTEXT_STALE'?{'X-Company-Context-Stale':'1'}:{})});else res.end();
}));
let schedulerTimer;
if(process.env.NODE_ENV!=='test'){
  server.listen(check.port,'127.0.0.1',()=>console.log(`MG Fakturakoll: ${check.origin}`));
  scheduledBackup();
  schedulerTimer=setInterval(()=>{scheduledBackup();runScheduledBankgiro().catch(()=>{schedulerState.last_error='Bankgirohämtningen behöver kontrolleras';});runScheduledSync().catch(()=>{schedulerState.last_error='Automatisk hämtning kunde inte slutföras';});},60000);schedulerTimer.unref();
}
server.on('close',()=>{if(schedulerTimer)clearInterval(schedulerTimer);companyRuntime.close();});
export {server,db,companyRuntime};
