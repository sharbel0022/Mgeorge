import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase, assertNoLegacyBankImports, audit, listInvoices, listTransactions, invoiceStatus, storeTransactions, allocate, deleteAllocation, matchingSuggestions, getSettings, saveSettings, listImports, recordImport, listDocuments, storeDocument, documentMetadata, defaultSettings, today } from './db.js';
import { digest, token, secureEqual, sessionCookie, clearCookie, encryptObject, decryptObject, passwordHash, verifyPassword, cipherKey } from './security.js';
import { parseBankFile, normalizeBankApiTransaction } from './importers.js';
import { isConfigured, configStatus, assertApplicationReady, validateAuthorizationUrl, bankingRequest, findSwedbank, startConsentBody, fetchBookedTransactions } from './bank.js';
import { gmailAccount, isGmailConfigured, gmailAuthorizationUrl, exchangeGmailCode, gmailProfile, fetchGmailInvoiceDocuments, revokeGmailTokens } from './gmail.js';

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
const db=openDatabase();
const baseHeaders={
  'Content-Security-Policy':"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'X-Frame-Options':'DENY','Cache-Control':'no-store','Permissions-Policy':'camera=(), microphone=(), geolocation=()'
};
if(check.secure)baseHeaders['Strict-Transport-Security']='max-age=31536000';
function json(res,status,data,headers={}){res.writeHead(status,{...baseHeaders,'Content-Type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(data));}
function redirect(res,url,cookie){res.writeHead(302,{...baseHeaders,Location:url,...(cookie?{'Set-Cookie':cookie}:{})});res.end();}
function bad(status,message){return Object.assign(new Error(message),{status});}
function requiredString(x,label,max=240){if(typeof x!=='string'||!x.trim()||x.length>max)throw bad(400,`${label} krävs (max ${max} tecken)`);return x.trim();}
function optionalString(x,max=1000){return String(x??'').trim().slice(0,max);}
function duplicateInvoice(direction,invoice_number,party,excludeId=''){
  const identity=s=>String(s).normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('sv-SE');
  return db.prepare('SELECT id,invoice_number,party FROM invoices WHERE direction=? AND id<>?').all(direction,excludeId).some(i=>identity(i.invoice_number)===identity(invoice_number)&&identity(i.party)===identity(party));
}
function validateDate(s,required=false){if(!s&&!required)return ''; if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(Date.parse(s+'T00:00:00Z'))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw bad(400,'Ange ett giltigt datum som ÅÅÅÅ-MM-DD');return s;}
async function readBody(req){
  const chunks=[];let length=0;
  for await (const chunk of req){length+=chunk.length;if(length>22_000_000)throw bad(413,'Filen är för stor');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw bad(400,'Ogiltig JSON');}
}
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').filter(x=>x.includes('=')).map(x=>{const i=x.indexOf('=');let value='';try{value=decodeURIComponent(x.slice(i+1).trim());}catch{}return [x.slice(0,i).trim(),value];}));}
// Local OS access represents one company administrator. HTTPS requires login.
// Anonymous sessions can bind a browser, but never authorize public bank data.
function ensureBrowserSession(req,res){
  const existing=cookies(req).mg_session;
  const found=existing&&db.prepare('SELECT principal FROM sessions WHERE id_hash=? AND expires_at>?').get(digest(existing),Date.now());
  if(found){
    req.principal=check.secure?found.principal:'local-admin';
    if(!check.secure&&found.principal==='')db.prepare('UPDATE sessions SET principal=? WHERE id_hash=?').run('local-admin',digest(existing));
    return;
  }
  const session=token();
  db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
  req.principal=check.secure?'':'local-admin';
  db.prepare('INSERT INTO sessions(id_hash,expires_at,principal) VALUES(?,?,?)').run(digest(session),Date.now()+8*3600000,req.principal);
  req.headers.cookie=(req.headers.cookie?req.headers.cookie+'; ':'')+'mg_session='+encodeURIComponent(session);
  // Replace an expired session cookie when computing the OAuth browser binding.
  req.browserSession=session;
  res.setHeader('Set-Cookie',sessionCookie(session,check.secure));
}
const loginAttempts=new Map();
function checkOrigin(req){
  const origin=req.headers.origin;
  if(origin!==check.origin)throw bad(403,'Begäran måste komma från MG:s egen hemsida');
  if(!String(req.headers['content-type']||'').startsWith('application/json'))throw bad(415,'Content-Type måste vara application/json');
}
function serveStatic(req,res,path){
  const legalPages={'/integritetspolicy':'integritetspolicy.html','/integritetspolicy/':'integritetspolicy.html','/integritetspolicy.html':'integritetspolicy.html','/anvandarvillkor':'anvandarvillkor.html','/anvandarvillkor/':'anvandarvillkor.html','/anvandarvillkor.html':'anvandarvillkor.html'};
  if(Object.hasOwn(legalPages,path)){
    const contents=readFileSync(resolve('public',legalPages[path]));
    // These standalone information documents contain their own fixed stylesheet.
    res.writeHead(200,{...baseHeaders,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"});return res.end(contents);
  }
  if(!['/','/index.html','/app.js','/style.css'].includes(path)){json(res,404,{error:'Sidan finns inte'});return;}
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
function assertSessionStillAuthorized(req){
  const current=db.prepare('SELECT principal FROM sessions WHERE id_hash=? AND expires_at>?').get(sessionHash(req),Date.now());
  if(!current||current.principal!==req.principal)throw bad(401,'Sessionen har avslutats. Logga in och försök igen.');
}
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
    const selected=decryptObject(connection.accounts_json).find(a=>a.uid===connection.selected_account_uid);
    if(!selected||(body.account_uid&&body.account_uid!==selected.uid))throw bad(400,'Välj bankanslutningens godkända konto');
    account=stableAccountIdentity(selected,connection.bank_name);
  }
  try{return parseBankFile(body.name,body.content_base64,account);}catch(e){throw bad(400,e.message);}
}
function gmailStatus(){
  const connection=db.prepare('SELECT id,email,status,last_synced,last_error FROM gmail_connections ORDER BY created_at DESC LIMIT 1').get();
  return {configured:isGmailConfigured(),email:gmailAccount(),status:connection?.status||'not_connected',last_synced:connection?.last_synced||'',connection};
}
let gmailSyncing=false,bankSyncing=new Set();
async function syncGmail(){
  if(gmailSyncing)throw bad(409,'En Gmail-hämtning pågår redan');
  const connection=db.prepare('SELECT * FROM gmail_connections ORDER BY created_at DESC LIMIT 1').get();
  if(!connection)throw bad(409,'Koppla Gmail först');
  gmailSyncing=true;
  const startedAt=connection.sync_started_at||new Date().toISOString();
  try{
    const knownIds=db.prepare("SELECT source_id FROM documents WHERE source='gmail' AND source_id IS NOT NULL").all().map(x=>x.source_id);
    const rejectedIds=db.prepare('SELECT source_id FROM gmail_rejected_sources').all().map(x=>x.source_id);
    const result=await fetchGmailInvoiceDocuments(decryptObject(connection.encrypted_tokens),{after:connection.last_synced?.slice(0,10)||undefined,knownIds,rejectedIds,maxMessages:50,pageToken:connection.page_token||''});
    let imported=0,duplicate=result.duplicate||0;
    for(const doc of result.documents){
      const payload=filePayload(doc);
      const stored=storeDocument(db,{...payload,source:'gmail',source_id:doc.source_id,metadata:{...doc.metadata,direction:doc.direction,party:doc.party,email:doc.email,subject:doc.subject,received_at:doc.received_at}});
      if(stored.duplicate)duplicate++;else imported++;
    }
    // Only advance the checkpoint after a complete page; capped batches are replayed safely.
    db.exec('BEGIN IMMEDIATE');
    try{
      const reject=db.prepare('INSERT OR IGNORE INTO gmail_rejected_sources(source_id,reason) VALUES(?,?)');
      for(const sourceId of result.rejected_source_ids||[]){
        const reason=result.warnings?.find(w=>w.source_id===sourceId)?.message||'Bilagan kunde inte godkännas som fakturaunderlag';
        reject.run(sourceId,reason);
      }
      db.prepare("UPDATE gmail_connections SET encrypted_tokens=?,last_synced=?,page_token=?,sync_started_at=?,status='connected',last_error='' WHERE id=?").run(encryptObject(result.tokens),result.truncated?connection.last_synced:startedAt,result.next_page_token||'',result.truncated?startedAt:'',connection.id);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    const summary={received:result.received??result.documents.length+(result.skipped||0),imported,duplicate,review:imported,skipped:result.skipped||0,truncated:!!result.truncated,warnings:result.warnings||[]};
    recordImport(db,{source:'gmail',name:connection.email,found:summary.received,imported,duplicate,review:imported});audit(db,'gmail_synced',summary);return summary;
  }catch(e){
    const renewal=e.code==='renewal_required'||/invalid_grant|förnya|återkall|401|expired|behöver.*koppla/i.test(e.message);
    db.prepare('UPDATE gmail_connections SET status=?,last_error=? WHERE id=?').run(renewal?'renewal_required':'error',renewal?'Gmail-anslutningen behöver förnyas':'Det gick inte att hämta från Gmail',connection.id);
    recordImport(db,{source:'gmail',name:connection.email,status:'error',error:renewal?'Gmail-anslutningen behöver förnyas':'Gmail-hämtningen misslyckades'});
    if(e.status)throw e;throw bad(502,renewal?'Gmail-anslutningen behöver förnyas – koppla Gmail igen':'Det gick inte att hämta från Gmail. Kontrollera anslutningen och försök igen.');
  }finally{gmailSyncing=false;}
}
function ownedConnection(req,id){
  const connection=db.prepare('SELECT * FROM bank_connections WHERE id=? AND owner=?').get(requiredString(id,'Anslutnings-ID'),req.principal);
  if(!connection)throw bad(404,'Bankanslutningen saknas eller tillhör en annan användare');
  return connection;
}
function stableAccountIdentity(account,bank){
  const number=account.account_id?.iban?.replace(/\s/g,'').toUpperCase()||account.account_id?.other?.identification;
  // Keep the canonical account number compatible with earlier file/API imports.
  if(number)return number;
  if(account.identification_hash)return `${bank}:SE:hash:${account.identification_hash}`;
  throw bad(502,'Banken saknar beständig kontoidentitet. Kontakta systemadministratören.');
}
async function verifyBankSession(connection){
  const data=await bankingRequest('/sessions/'+encodeURIComponent(decryptObject(connection.encrypted_session).session_id));
  if(data.status!=='AUTHORIZED'||!Array.isArray(data.accounts)||!data.accounts.includes(connection.selected_account_uid))throw Object.assign(bad(409,'Bankanslutningen behöver förnyas – koppla igen'),{code:'renewal_required'});
}
async function syncBank(connection,{account_uid,date_from,date_to}={},operationLocked=false){
  if(!operationLocked&&bankSyncing.has(connection.id))throw bad(409,'En bankåtgärd pågår redan');
  if(!connection.owner||!connection.selected_account_uid)throw bad(409,'Välj först ett godkänt företagskonto');
  if(!Number.isFinite(Date.parse(connection.valid_until))||Date.parse(connection.valid_until)<=Date.now()){
    db.prepare("UPDATE bank_connections SET status='renewal_required' WHERE id=?").run(connection.id);throw bad(409,'Bankanslutningen behöver förnyas – koppla igen');
  }
  if(connection.retry_after>Date.now())throw Object.assign(bad(429,'Bankens anropsgräns är nådd. Försök igen senare.'),{retryAfter:Math.ceil((connection.retry_after-Date.now())/1000)});
  if(account_uid&&account_uid!==connection.selected_account_uid)throw bad(400,'Välj konto innan hämtningen');
  const selected=decryptObject(connection.accounts_json).find(a=>a.uid===connection.selected_account_uid);if(!selected)throw bad(400,'Välj ett godkänt konto');
  date_from||=new Date(Date.parse(today()+'T12:00:00Z')-29*86400000).toISOString().slice(0,10);date_to||=today();
  const from=validateDate(date_from,true),to=validateDate(date_to,true);if(from>to||Math.abs(Date.parse(to)-Date.parse(from))>91*86400000)throw bad(400,'Välj ett datumintervall på högst 91 dagar');
  assertNoLegacyBankImports(db);
  if(!operationLocked)bankSyncing.add(connection.id);
  try{
    await verifyBankSession(connection);
    const raw=await fetchBookedTransactions(selected.uid,{dateFrom:from,dateTo:to});
    // Login revocation during a slow provider request must not authorize a write.
    if(connection.request_session_hash){
      const active=db.prepare('SELECT principal FROM sessions WHERE id_hash=? AND expires_at>?').get(connection.request_session_hash,Date.now());
      if(!active||active.principal!==connection.owner)throw bad(401,'Sessionen har avslutats. Logga in igen.');
    }
    const account=stableAccountIdentity(selected,connection.bank_name);
    const transactions=raw.map(x=>normalizeBankApiTransaction(x,account)).filter(x=>x&&x.booked_at>=from&&x.booked_at<=to);
    const result=storeTransactions(db,transactions,'enablebanking');db.prepare("UPDATE bank_connections SET last_synced=CURRENT_TIMESTAMP,status='connected',last_error='',retry_after=0 WHERE id=?").run(connection.id);
    audit(db,'bank_synced',{connection_id:connection.id,from,to,received:raw.length,imported:result.imported,duplicate:result.duplicate});
    return {...result,received:raw.length};
  }catch(e){
    if(e.status===401&&!e.providerStatus)throw e;
    const renewal=e.code==='renewal_required'||[401,404,410].includes(e.providerStatus);
    const message=renewal?'Bankanslutningen behöver förnyas – koppla igen':e.status===429?'Bankens anropsgräns är nådd. Försök igen senare.':'Det gick inte att hämta bankhändelser. Kontrollera anslutningen och försök igen.';
    db.prepare('UPDATE bank_connections SET status=?,last_error=?,retry_after=? WHERE id=?').run(renewal?'renewal_required':'error',message,e.status===429?Date.now()+Math.max(60,e.retryAfter||60)*1000:0,connection.id);
    recordImport(db,{source:'enablebanking',name:connection.bank_name,status:'error',error:message});
    throw Object.assign(bad(renewal?409:e.status===429?429:502,message),{safe:true,retryAfter:e.retryAfter});
  }
  finally{if(!operationLocked)bankSyncing.delete(connection.id);}
}
const schedulerState={running:false,last_run:'',last_error:''};
const backgroundAttempts=new Map();
function utcTimestamp(value){return Date.parse(value.includes('T')?value:value.replace(' ','T')+'Z')||0;}
export async function runScheduledSync(){
  const interval=getSettings(db).sync_interval_minutes;
  if(!interval||schedulerState.running)return;
  schedulerState.running=true;schedulerState.last_error='';
  const due=(key,last)=>Date.now()-Math.max(last?utcTimestamp(last):0,backgroundAttempts.get(key)||0)>=interval*60000;
  try{
    const mail=db.prepare("SELECT * FROM gmail_connections WHERE status NOT IN ('renewal_required') ORDER BY created_at DESC LIMIT 1").get();
    if(mail&&isGmailConfigured()&&due('gmail',mail.last_synced)){
      backgroundAttempts.set('gmail',Date.now());try{await syncGmail();}catch{schedulerState.last_error='Gmail-hämtningen behöver kontrolleras';}
    }
    if(isConfigured())for(const connection of db.prepare("SELECT * FROM bank_connections WHERE status IN ('connected','error') AND owner<>'' AND selected_account_uid<>''").all()){
      if(!due(connection.id,connection.last_synced))continue;
      backgroundAttempts.set(connection.id,Date.now());
      const fromDate=connection.last_synced?new Date(utcTimestamp(connection.last_synced)-86400000):new Date(Date.parse(today()+'T12:00:00Z')-29*86400000);
      // Clamp resumed jobs to the provider's supported maximum interval.
      const from=new Date(Math.max(fromDate.getTime(),Date.now()-90*86400000)).toISOString().slice(0,10);
      try{await syncBank(connection,{date_from:from,date_to:today()});}catch{schedulerState.last_error='Bankhämtningen behöver kontrolleras';}
    }
    schedulerState.last_run=new Date().toISOString();
  }finally{schedulerState.running=false;}
}
async function route(req,res){
  // The listener remains loopback-only; public HTTPS uses a secured reverse proxy.
  const hostname=new URL('http://'+req.headers.host).hostname;
  if(!(check.secure?[new URL(check.origin).hostname]:['localhost','127.0.0.1','[::1]']).includes(hostname))throw bad(403,'Ogiltig värd för MG Fakturakoll');
  const url=new URL(req.url,check.origin);const path=url.pathname;
  if(path==='/api/health'&&req.method==='GET')return json(res,200,{ok:true,app:'Mgeorge Fakturakoll'});
  if(!path.startsWith('/api/'))return serveStatic(req,res,path);
  const callback=['/api/bank/callback','/api/gmail/callback'].includes(path)&&req.method==='GET';
  if(!callback&&((req.headers.origin&&req.headers.origin!==check.origin)||req.headers['sec-fetch-site']==='cross-site'))throw bad(403,'Begäran måste komma från MG:s egen hemsida');
  ensureBrowserSession(req,res);
  if(path==='/api/me'&&req.method==='GET')return json(res,200,{authenticated:!!req.principal,login_required:check.secure,company:req.principal?getSettings(db).company_name:'MG Fakturakoll',role:req.principal?'administrator':null});
  if(req.method!=='GET')checkOrigin(req);
  if(path==='/api/login'&&req.method==='POST'&&check.secure){
    const now=Date.now(),address=req.socket.remoteAddress;
    const attempt=loginAttempts.get(address);
    if(attempt&&attempt.until>now&&attempt.count>=5)throw bad(429,'För många inloggningsförsök. Försök igen om 15 minuter.');
    const b=await readBody(req);
    if(typeof b.password!=='string'||b.password.length>1024||!verifyPassword(b.password,check.adminHash)){
      loginAttempts.set(address,{count:attempt?.until>now?attempt.count+1:1,until:attempt?.until>now?attempt.until:now+900000});throw bad(401,'Felaktigt lösenord');
    }
    loginAttempts.delete(address);db.prepare('DELETE FROM sessions WHERE id_hash=?').run(sessionHash(req));
    const value=token();db.prepare('INSERT INTO sessions(id_hash,expires_at,principal) VALUES(?,?,?)').run(digest(value),now+8*3600000,'administrator');
    return json(res,200,{authenticated:true},{'Set-Cookie':sessionCookie(value,true)});
  }
  if(!req.principal)throw bad(401,'Logga in för att läsa företagets uppgifter');
  if(req.principal!==(check.secure?'administrator':'local-admin'))throw bad(403,'Användaren saknar behörighet till företagets arbetsyta');
  if(path==='/api/logout'&&req.method==='POST'){
    db.prepare('DELETE FROM bank_states WHERE session_hash=?').run(sessionHash(req));db.prepare('DELETE FROM gmail_states WHERE session_hash=?').run(sessionHash(req));
    db.prepare('DELETE FROM sessions WHERE id_hash=?').run(sessionHash(req));return json(res,200,{authenticated:false},{'Set-Cookie':clearCookie(check.secure)});
  }
  if(path==='/api/dashboard'&&req.method==='GET')return json(res,200,invoiceStatus(db));
  if(path==='/api/settings'&&req.method==='GET')return json(res,200,{...getSettings(db),scheduler_available:true,scheduler:schedulerState,user_mode:'single_administrator'});
  if(path==='/api/settings'&&req.method==='PATCH'){
    const b=await readBody(req),settings=getSettings(db);
    const limits={company_name:240,organization_number:40,email:240,phone:80,address:500,bankgiro:80};
    for(const [key,max] of Object.entries(limits))if(b[key]!==undefined)settings[key]=key==='company_name'?requiredString(b[key],'Företagsnamn',max):optionalString(b[key],max);
    for(const key of ['notifications_due','notifications_review'])if(b[key]!==undefined){if(typeof b[key]!=='boolean')throw bad(400,'Aviseringsinställningen måste vara på eller av');settings[key]=b[key];}
    if(b.reminders_enabled===true)throw bad(409,'Automatiskt utskick av påminnelser är inte aktiverat. Du kan skapa och kontrollera utkast.');
    if(b.sync_interval_minutes!==undefined){if(![0,15,30,60,240,1440].includes(b.sync_interval_minutes))throw bad(400,'Välj ett giltigt hämtningsintervall');settings.sync_interval_minutes=b.sync_interval_minutes;}
    return json(res,200,{...saveSettings(db,settings),scheduler_available:true,user_mode:'single_administrator'});
  }
  if(path==='/api/invoices'&&req.method==='GET')return json(res,200,{items:listInvoices(db)});
  if(path==='/api/invoices'&&req.method==='POST')return json(res,201,addInvoice(await readBody(req)));
  if(/^\/api\/invoices\/[^/]+$/.test(path)&&req.method==='GET'){
    const id=decodeURIComponent(path.split('/').pop()),invoice=listInvoices(db).find(i=>i.id===id);if(!invoice)throw bad(404,'Fakturan saknas');
    const transactions=listTransactions(db),allocations=db.prepare('SELECT * FROM allocations WHERE invoice_id=? ORDER BY confirmed_at DESC').all(id).map(a=>({...a,transaction:transactions.find(t=>t.id===a.transaction_id)}));
    return json(res,200,{invoice,allocations,documents:listDocuments(db).filter(d=>d.invoice_id===id)});
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
      const info=db.prepare('UPDATE invoices SET party=?,email=?,issued_at=?,due_at=?,note=?,reference=?,bankgiro=?,reconciled_at=?,reconciliation_note=? WHERE id=?').run(requiredString(b.party??prev.party,'Företag/person'),optionalString(b.email??prev.email,240),issued_at,due_at,optionalString(b.note??prev.note,1500),optionalString(b.reference??prev.reference,120),optionalString(b.bankgiro??prev.bankgiro,80),b.reconciled===true?new Date().toISOString():b.reconciled===false?'':prev.reconciled_at,b.reconciled===true?optionalString(b.reconciliation_note,1500):prev.reconciliation_note,b.id);
      if(document)db.prepare("UPDATE documents SET invoice_id=?,status='registered' WHERE id=?").run(b.id,document.id);
      const updated=db.prepare('SELECT * FROM invoices WHERE id=?').get(b.id),changes={};
      for(const key of ['party','email','issued_at','due_at','note','reference','bankgiro','reconciled_at','reconciliation_note'])if(prev[key]!==updated[key])changes[key]={before:prev[key],after:updated[key]};
      audit(db,b.reconciled===true?'invoice_reconciled':'invoice_updated',{id:b.id,changes,document_id:document?.id});db.exec('COMMIT');return json(res,200,{updated:info.changes>0});
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  if(path==='/api/bank-transactions'&&req.method==='GET'){
    const suggestions=matchingSuggestions(db);return json(res,200,{items:listTransactions(db).map(t=>({...t,status:t.status==='unmatched'&&suggestions.some(s=>s.transaction_id===t.id)?'suggested':t.status}))});
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
  if(path==='/api/suggestions'&&req.method==='GET')return json(res,200,{items:matchingSuggestions(db)});
  if(path==='/api/imports'&&req.method==='GET')return json(res,200,{items:listImports(db)});
  if(/^\/api\/imports\/[^/]+\/original$/.test(path)&&req.method==='GET'){
    const item=db.prepare('SELECT name,content,mime_type FROM import_jobs WHERE id=?').get(decodeURIComponent(path.split('/')[3]));
    if(!item?.content)throw bad(404,'Originalfilen saknas');
    res.writeHead(200,{...baseHeaders,'Content-Type':item.mime_type||'application/octet-stream','Content-Disposition':`attachment; filename="bankunderlag${item.mime_type==='application/xml'?'.xml':'.csv'}"`,'Content-Length':item.content.length,'Content-Security-Policy':"sandbox; default-src 'none'"});return res.end(Buffer.from(item.content));
  }
  if(path==='/api/import/preview'&&req.method==='POST'){
    const b=await readBody(req);const items=importBankFile(b,req);
    const warnings=[...new Set(items.flatMap(x=>x.warnings||[]))];
    return json(res,200,{count:items.length,items,warnings,review:items.filter(i=>i.is_aggregate||!i.payer&&!i.reference).length});
  }
  if(path==='/api/import/commit'&&req.method==='POST'){
    const b=await readBody(req);if(b.confirm!==true)throw bad(400,'Bekräfta importen');
    const items=importBankFile(b,req);
    return json(res,200,storeTransactions(db,items,'file:'+optionalString(b.name,120),{content:Buffer.from(b.content_base64,'base64'),mime_type:/\.xml$/i.test(b.name)?'application/xml':'text/csv; charset=utf-8'}));
  }
  if(path==='/api/documents'&&req.method==='GET')return json(res,200,{items:listDocuments(db)});
  if(path==='/api/documents'&&req.method==='POST'){
    const b=await readBody(req),payload=filePayload(b);
    if(b.invoice_id&&!db.prepare('SELECT id FROM invoices WHERE id=?').get(b.invoice_id))throw bad(404,'Fakturan saknas');
    const stored=storeDocument(db,{...payload,invoice_id:b.invoice_id||null});
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
  if(/^\/api\/documents\/[^/]+$/.test(path)&&req.method==='GET'){
    const id=decodeURIComponent(path.split('/').pop()),doc=db.prepare('SELECT * FROM documents WHERE id=?').get(id);if(!doc)throw bad(404,'Originalunderlaget saknas');
    const safeName=doc.name.replace(/[^A-Za-z0-9._-]/g,'_');
    res.writeHead(200,{...baseHeaders,'Content-Type':doc.mime_type,'Content-Disposition':`attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(doc.name)}`,'Content-Length':doc.content.length,'Content-Security-Policy':"sandbox; default-src 'none'"});return res.end(Buffer.from(doc.content));
  }
  if(path==='/api/allocations'&&req.method==='GET')return json(res,200,{items:db.prepare('SELECT * FROM allocations ORDER BY confirmed_at DESC').all()});
  if(path==='/api/allocations'&&req.method==='POST'){
    const b=await readBody(req);if(b.confirm!==true)throw bad(400,'Matchning måste bekräftas manuellt');
    try{allocate(db,requiredString(b.invoice_id,'Faktura-ID'),requiredString(b.transaction_id,'Bankhändelse-ID'),Number(b.amount_cents));}catch(e){if(e.status)throw e;throw bad(400,/UNIQUE/.test(e.message)?'Den här matchningen finns redan':e.message);}
    return json(res,201,{ok:true});
  }
  if(path==='/api/allocations'&&req.method==='DELETE'){
    const b=await readBody(req);return json(res,200,{removed:deleteAllocation(db,requiredString(b.id,'Matchnings-ID'))});
  }
  if(path==='/api/audit'&&req.method==='GET')return json(res,200,{items:db.prepare('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 100').all()});
  if(path==='/api/export'&&req.method==='GET'){
    audit(db,'data_exported',{});
    return json(res,200,{exported_at:new Date().toISOString(),settings:getSettings(db),invoices:listInvoices(db),transactions:listTransactions(db),allocations:db.prepare('SELECT * FROM allocations').all(),imports:listImports(db),documents:listDocuments(db),audit:db.prepare('SELECT * FROM audit_events ORDER BY created_at DESC').all()},{'Content-Disposition':'attachment; filename="mg-fakturakoll-export.json"'});
  }
  // AIS only: reads account data, never creates, approves or executes payments.
  if(path==='/api/bank/status'&&req.method==='GET'){
    const activation=configStatus();
    const connections=db.prepare('SELECT id,bank_name,accounts_json,valid_until,last_synced,status,selected_account_uid,last_error,retry_after FROM bank_connections WHERE owner=? ORDER BY created_at DESC').all(req.principal);
    return json(res,200,{configured:activation.configured,activation,environment:activation.environment,connections:connections.map(x=>{
      let accounts=[],status=!Number.isFinite(Date.parse(x.valid_until))||Date.parse(x.valid_until)<=Date.now()?'renewal_required':x.status;
      try{accounts=decryptObject(x.accounts_json).map(a=>({uid:a.uid,name:a.name,currency:a.currency,account_hint:maskAccount(a.account_id?.iban||a.account_id?.other?.identification)}));}catch{status='error';}
      return {...x,status,accounts,accounts_json:undefined};
    })});
  }
  if(path==='/api/bank/connect'&&req.method==='POST'){
    const b=await readBody(req),activation=configStatus();
    if(!activation.configured)throw Object.assign(bad(409,activation.message),{code:activation.code});
    const renewal=b.renew_connection_id?ownedConnection(req,b.renew_connection_id):null;
    if(renewal&&bankSyncing.has(renewal.id))throw bad(409,'Vänta tills bankhämtningen har avslutats');
    // A local flag cannot assert vendor approval: check the actual registered app.
    await assertApplicationReady(check.origin);
    const banks=await findSwedbank();const bank=banks.find(x=>x.name==='Swedbank')||banks[0];
    if(!bank)throw bad(409,'Swedbank Företag är inte tillgänglig för denna applikation. Kontakta systemadministratören och Enable Banking.');
    const state=token();db.prepare('DELETE FROM bank_states WHERE expires_at<=? OR (session_hash=? AND consumed=0)').run(Date.now(),sessionHash(req));
    db.prepare('INSERT INTO bank_states(state_hash,expires_at,session_hash,owner,renew_connection_id,bank_name) VALUES(?,?,?,?,?,?)').run(digest(state),Date.now()+15*60000,sessionHash(req),req.principal,renewal?.id||'',bank.name);
    try{
      const auth=await bankingRequest('/auth',{method:'POST',body:startConsentBody(bank,state,check.origin)});
      assertSessionStillAuthorized(req);
      const authUrl=validateAuthorizationUrl(auth.url);
      audit(db,'bank_consent_started',{bank:bank.name});return json(res,200,{url:String(authUrl),environment:activation.environment});
    }catch(e){db.prepare('DELETE FROM bank_states WHERE state_hash=?').run(digest(state));throw e;}
  }
  // Callback intentionally uses GET and SameSite=Lax cookie from interactive browser navigation.
  if(path==='/api/bank/callback'&&req.method==='GET'){
    if(['state','code','error'].some(key=>url.searchParams.getAll(key).length>1))throw bad(403,'Ogiltig bankretur');
    const state=url.searchParams.get('state')||'';
    const record=db.prepare('SELECT * FROM bank_states WHERE state_hash=?').get(digest(state));
    if(!state||state.length>256||!record||record.consumed||record.expires_at<=Date.now()||record.owner!==req.principal||!secureEqual(record.session_hash,sessionHash(req)))throw bad(403,'Ogiltig eller för gammal bankretur');
    const consumed=db.prepare('UPDATE bank_states SET consumed=1 WHERE state_hash=? AND consumed=0').run(digest(state));
    if(!consumed.changes)throw bad(403,'Bankreturen har redan använts');
    if(url.searchParams.has('error')){audit(db,'bank_consent_cancelled',{});return redirect(res,'/?tab=connections&status=cancelled');}
    const code=url.searchParams.get('code');if(!code||code.length>4096)throw bad(400,'Saknar bankens engångskod');
    const session=await bankingRequest('/sessions',{method:'POST',body:{code}});
    let renewalLock='';
    try{
      assertSessionStillAuthorized(req);
      const accounts=Array.isArray(session.accounts)?session.accounts.filter(a=>a&&typeof a.uid==='string'&&a.uid&&a.currency==='SEK'&&a.usage!=='PRIV'):[];
      if(typeof session.session_id!=='string'||!session.session_id||!accounts.length||!Number.isFinite(Date.parse(session.access?.valid_until))||Date.parse(session.access.valid_until)<=Date.now())throw bad(502,'Banken returnerade inget tillgängligt företagskonto i SEK med giltigt medgivande');
      if(session.aspsp?.name!==record.bank_name||session.aspsp?.country!=='SE'||session.psu_type!=='business')throw bad(502,'Bankens svar motsvarar inte det godkända företagsmedgivandet');
      for(const a of accounts)stableAccountIdentity(a,record.bank_name);
      const id=record.renew_connection_id||randomUUID();
      if(record.renew_connection_id){
        const old=ownedConnection(req,id);
        if(bankSyncing.has(old.id))throw bad(409,'Vänta tills bankhämtningen har avslutats och förnya sedan igen');
        bankSyncing.add(old.id);renewalLock=old.id;
        const previous=decryptObject(old.encrypted_session).session_id;
        if(previous!==session.session_id)try{await bankingRequest('/sessions/'+encodeURIComponent(previous),{method:'DELETE'});}catch(e){if(![404,410].includes(e.providerStatus))throw bad(502,'Det tidigare medgivandet kunde inte återkallas. Förnya anslutningen igen.');}
        assertSessionStillAuthorized(req);
        db.prepare("UPDATE bank_connections SET encrypted_session=?,accounts_json=?,valid_until=?,selected_account_uid='',status='pending_account',last_error='',retry_after=0 WHERE id=? AND owner=?").run(encryptObject({session_id:session.session_id}),encryptObject(accounts),session.access.valid_until,id,req.principal);
      }else{
        db.prepare("INSERT INTO bank_connections(id,provider,bank_name,encrypted_session,accounts_json,valid_until,owner,status) VALUES(?,?,?,?,?,?,?,'pending_account')").run(id,'enablebanking',record.bank_name,encryptObject({session_id:session.session_id}),encryptObject(accounts),session.access.valid_until,req.principal);
      }
      audit(db,'bank_accounts_authorized',{bank:record.bank_name,accounts:accounts.length,connection_id:id});
      return redirect(res,'/?tab=connections&status=select_account');
    }catch(e){
      if(typeof session.session_id==='string'&&session.session_id)try{await bankingRequest('/sessions/'+encodeURIComponent(session.session_id),{method:'DELETE'});}catch{}
      throw e;
    }finally{if(renewalLock)bankSyncing.delete(renewalLock);}
  }
  if(path==='/api/bank/accounts'&&req.method==='POST'){
    const b=await readBody(req),connection=ownedConnection(req,b.connection_id);
    if(bankSyncing.has(connection.id))throw bad(409,'Vänta tills bankåtgärden har avslutats');
    bankSyncing.add(connection.id);
    try{
    if(connection.retry_after>Date.now())throw Object.assign(bad(429,'Bankens anropsgräns är nådd. Försök igen senare.'),{retryAfter:Math.ceil((connection.retry_after-Date.now())/1000)});
    if(!Number.isFinite(Date.parse(connection.valid_until))||Date.parse(connection.valid_until)<=Date.now()||connection.status==='renewal_required')throw bad(409,'Bankanslutningen behöver förnyas – koppla igen');
    const account=decryptObject(connection.accounts_json).find(a=>a.uid===b.account_uid);
    if(!account)throw bad(400,'Välj ett godkänt företagskonto');
    stableAccountIdentity(account,connection.bank_name);
    await verifyBankSession({...connection,selected_account_uid:account.uid});
    assertSessionStillAuthorized(req);
    const changed=connection.selected_account_uid!==account.uid;
    db.prepare("UPDATE bank_connections SET selected_account_uid=?,last_synced=?,status='connected',last_error='' WHERE id=? AND owner=?").run(account.uid,changed?'':connection.last_synced,connection.id,req.principal);
    audit(db,'bank_account_selected',{connection_id:connection.id});
    try{return json(res,200,await syncBank({...ownedConnection(req,connection.id),request_session_hash:sessionHash(req)},{},true));}
    catch(e){return json(res,200,{imported:0,duplicate:0,initial_sync_error:e.message});}
    }catch(e){
      if(e.status===429)db.prepare('UPDATE bank_connections SET retry_after=?,last_error=? WHERE id=?').run(Date.now()+Math.max(60,e.retryAfter||60)*1000,'Bankens anropsgräns är nådd. Försök igen senare.',connection.id);
      if(e.code==='renewal_required'||[401,404,410].includes(e.providerStatus))db.prepare("UPDATE bank_connections SET status='renewal_required',last_error=? WHERE id=?").run('Bankanslutningen behöver förnyas – koppla igen',connection.id);
      throw e;
    }finally{bankSyncing.delete(connection.id);}
  }
  if(path==='/api/bank/sync'&&req.method==='POST'){
    const b=await readBody(req),connection=ownedConnection(req,b.connection_id);
    return json(res,200,await syncBank({...connection,request_session_hash:sessionHash(req)},b));
  }
  if(path==='/api/bank/connections'&&req.method==='DELETE'){
    const b=await readBody(req),connection=ownedConnection(req,b.id);
    if(bankSyncing.has(connection.id))throw bad(409,'Vänta tills bankhämtningen har avslutats');
    bankSyncing.add(connection.id);
    try{
    // Revoke at the provider first. A failed revocation must not be reported as success.
    try{await bankingRequest('/sessions/'+encodeURIComponent(decryptObject(connection.encrypted_session).session_id),{method:'DELETE'});}catch(e){if(![404,410].includes(e.providerStatus))throw bad(502,'Banken kunde inte återkalla åtkomsten. Försök igen eller återkalla medgivandet hos banken.');}
    db.prepare('DELETE FROM bank_connections WHERE id=?').run(connection.id);audit(db,'bank_disconnected',{id:connection.id});return json(res,200,{removed:true});
    }finally{bankSyncing.delete(connection.id);}
  }
  if(path==='/api/gmail/status'&&req.method==='GET')return json(res,200,gmailStatus());
  if(path==='/api/gmail/connect'&&req.method==='POST'){
    if(!isGmailConfigured())throw bad(409,'En administratör behöver först aktivera Google OAuth i serverns inställningar');
    const state=token();db.prepare('INSERT INTO gmail_states(state_hash,expires_at,session_hash) VALUES(?,?,?)').run(digest(state),Date.now()+15*60000,sessionHash(req));
    return json(res,200,{url:gmailAuthorizationUrl(state,check.origin)});
  }
  if(path==='/api/gmail/callback'&&req.method==='GET'){
    const state=url.searchParams.get('state')||'',record=db.prepare('SELECT * FROM gmail_states WHERE state_hash=?').get(digest(state));
    if(!state||!record||record.consumed||record.expires_at<Date.now()||!secureEqual(record.session_hash,sessionHash(req)))throw bad(403,'Ogiltig eller för gammal Gmail-retur');
    db.prepare('UPDATE gmail_states SET consumed=1 WHERE state_hash=?').run(digest(state));
    if(url.searchParams.has('error'))return redirect(res,'/?tab=import&gmail=cancelled');
    const code=url.searchParams.get('code');if(!code)throw bad(400,'Googles engångskod saknas');
    let tokens;
    try{
      tokens=await exchangeGmailCode(code,check.origin);const profile=await gmailProfile(tokens);
      if(!tokens.refresh_token){
        const existing=db.prepare('SELECT * FROM gmail_connections WHERE email=? ORDER BY created_at DESC LIMIT 1').get(profile.emailAddress);
        if(existing)tokens.refresh_token=decryptObject(existing.encrypted_tokens).refresh_token||'';
        if(!tokens.refresh_token)throw bad(409,'Google gav ingen bestående läsåtkomst. Koppla Gmail igen och godkänn åtkomsten.');
      }
      db.exec('BEGIN IMMEDIATE');
      try{
        db.prepare('DELETE FROM gmail_connections').run();db.prepare('INSERT INTO gmail_connections(id,email,encrypted_tokens) VALUES(?,?,?)').run(randomUUID(),profile.emailAddress,encryptObject(tokens));audit(db,'gmail_connected',{email:profile.emailAddress});db.exec('COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e;}
      return redirect(res,'/?tab=import&gmail=connected');
    }catch(e){if(e.code==='account_mismatch'&&tokens){try{await revokeGmailTokens(tokens);}catch{}}if(e.status)throw e;throw bad(502,'Gmail kunde inte kopplas. Kontrollera att rätt företagskonto valdes och försök igen.');}
  }
  if(path==='/api/gmail/sync'&&req.method==='POST')return json(res,200,await syncGmail());
  if(path==='/api/gmail/connection'&&req.method==='DELETE'){
    if(gmailSyncing)throw bad(409,'Vänta tills Gmail-hämtningen har avslutats');
    const connection=db.prepare('SELECT * FROM gmail_connections ORDER BY created_at DESC LIMIT 1').get();
    if(connection){try{await revokeGmailTokens(decryptObject(connection.encrypted_tokens));}catch{throw bad(502,'Google kunde inte återkalla åtkomsten. Försök igen eller återkalla åtkomsten i Google-kontot.');}db.prepare('DELETE FROM gmail_connections WHERE id=?').run(connection.id);audit(db,'gmail_disconnected',{email:connection.email});}
    return json(res,200,{removed:!!connection});
  }
  throw bad(404,'Okänd begäran');
}
const server=http.createServer((req,res)=>route(req,res).catch(err=>{
  const status=err.status||(err instanceof TypeError?400:500);
  if(status>=500)console.error('Serverfel',status); // No provider payloads, request URLs, keys or tokens.
  if(!res.headersSent)json(res,status,{error:status>=500&&!err.safe&&!err.code?'Ett serverfel inträffade':err.message,...(err.code?{code:err.code}:{})},err.retryAfter?{'Retry-After':String(err.retryAfter)}:{});else res.end();
}));
let schedulerTimer;
if(process.env.NODE_ENV!=='test'){
  server.listen(check.port,'127.0.0.1',()=>console.log(`MG Fakturakoll: ${check.origin}`));
  schedulerTimer=setInterval(()=>runScheduledSync().catch(()=>{schedulerState.last_error='Automatisk hämtning kunde inte slutföras';}),60000);schedulerTimer.unref();
}
server.on('close',()=>{if(schedulerTimer)clearInterval(schedulerTimer);});
export {server,db};
