import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase, audit, listInvoices, listTransactions, invoiceStatus, storeTransactions, allocate, deleteAllocation } from './db.js';
import { digest, token, verifyPassword, secureEqual, sessionCookie, clearCookie, encryptObject, decryptObject } from './security.js';
import { parseBankFile, normalizeBankApiTransaction } from './importers.js';
import { isConfigured, bankingRequest, findSwedbank, startConsentBody, fetchBookedTransactions } from './bank.js';

function config(){
  const origin=(process.env.APP_ORIGIN||'http://localhost:3000').replace(/\/$/,'');
  if(!/^https:\/\//.test(origin)&&!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))throw Error('APP_ORIGIN måste vara HTTPS för publik drift');
  if(!/^[a-f0-9]{64}$/i.test(process.env.SESSION_SECRET||''))throw Error('SESSION_SECRET måste vara 64 hextecken');
  if(!/^[a-f0-9]{64}$/i.test(process.env.BANK_DATA_KEY||''))throw Error('BANK_DATA_KEY måste vara 64 hextecken');
  return {origin,secure:origin.startsWith('https:'),port:Number(process.env.PORT||3000)};
}
const check=config();
const db=openDatabase();
const failedLogins=new Map();
const baseHeaders={
  'Content-Security-Policy':"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'X-Frame-Options':'DENY','Cache-Control':'no-store','Permissions-Policy':'camera=(), microphone=(), geolocation=()'
};
function json(res,status,data,headers={}){res.writeHead(status,{...baseHeaders,'Content-Type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(data));}
function redirect(res,url,cookie){res.writeHead(302,{...baseHeaders,Location:url,...(cookie?{'Set-Cookie':cookie}:{})});res.end();}
function bad(status,message){return Object.assign(new Error(message),{status});}
function requiredString(x,label,max=240){if(typeof x!=='string'||!x.trim()||x.length>max)throw bad(400,`${label} krävs (max ${max} tecken)`);return x.trim();}
function optionalString(x,max=1000){return String(x??'').trim().slice(0,max);}
function validateDate(s,required=false){if(!s&&!required)return ''; if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(Date.parse(s+'T00:00:00Z')))throw bad(400,'Datum måste vara ÅÅÅÅ-MM-DD');return s;}
async function readBody(req){
  const chunks=[];let length=0;
  for await (const chunk of req){length+=chunk.length;if(length>22_000_000)throw bad(413,'Filen är för stor');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw bad(400,'Ogiltig JSON');}
}
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').filter(x=>x.includes('=')).map(x=>{const i=x.indexOf('=');return [x.slice(0,i).trim(),decodeURIComponent(x.slice(i+1).trim())];}));}
function loggedIn(req){const t=cookies(req).mg_session;return !!(t&&db.prepare('SELECT id_hash FROM sessions WHERE id_hash=? AND expires_at>?').get(digest(t),Date.now()));}
function checkOrigin(req){
  const origin=req.headers.origin;
  if(origin!==check.origin)throw bad(403,'Begäran måste komma från MG:s egen hemsida');
  if(!String(req.headers['content-type']||'').startsWith('application/json'))throw bad(415,'Content-Type måste vara application/json');
}
function serveStatic(req,res,path){
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
  const id=randomUUID();
  db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,email,issued_at,due_at,total_cents,currency,reference,note) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
    id,direction,requiredString(body.invoice_number,'Fakturanummer',80),requiredString(body.party,'Företag/person'),optionalString(body.email,240),validateDate(body.issued_at),validateDate(body.due_at),total,'SEK',optionalString(body.reference,120),optionalString(body.note,1500));
  audit(db,'invoice_created',{id,direction,invoice_number:body.invoice_number});return {id};
}
function addBankTransaction(body){
  const amount=Number(body.amount_cents);
  if(!Number.isSafeInteger(amount)||amount===0)throw bad(400,'Beloppet kan inte vara noll');
  const items=[{account:requiredString(body.account,'Konto',120),booked_at:validateDate(body.booked_at,true),amount_cents:amount,currency:'SEK',payer:optionalString(body.payer,240),reference:optionalString(body.reference,240),bank_reference:optionalString(body.bank_reference,240),description:optionalString(body.description,500)}];
  return storeTransactions(db,items,'manual');
}
function maskAccount(s){return s?String(s).replace(/.(?=.{4})/g,'•'):'';}
async function route(req,res){
  const url=new URL(req.url,check.origin);const path=url.pathname;
  if(path==='/api/health'&&req.method==='GET')return json(res,200,{ok:true,app:'Mgeorge Fakturakoll'});
  if(path==='/api/login'&&req.method==='POST'){
    checkOrigin(req);
    const ip=req.socket.remoteAddress||'unknown';const previous=failedLogins.get(ip);const item=previous && previous.resetAt>Date.now()?previous:null;
    if(item&&item.count>=6&&Date.now()<item.resetAt)throw bad(429,'För många försök. Försök senare.');
    const body=await readBody(req);
    if(typeof body.password!=='string'||!verifyPassword(body.password,db.prepare('SELECT password_hash FROM admins WHERE id=1').get().password_hash)){
      failedLogins.set(ip,{count:(item?.count||0)+1,resetAt:Date.now()+15*60000});throw bad(401,'Fel lösenord');
    }
    failedLogins.delete(ip);
    const session=token();db.prepare('INSERT INTO sessions(id_hash,expires_at) VALUES(?,?)').run(digest(session),Date.now()+8*3600000);
    return json(res,200,{ok:true},{'Set-Cookie':sessionCookie(session,check.secure)});
  }
  if(path==='/api/me'&&req.method==='GET')return json(res,200,{authenticated:loggedIn(req),company:'M.George Vitvaror AB'});
  if(!path.startsWith('/api/'))return serveStatic(req,res,path);
  if(!loggedIn(req))throw bad(401,'Logga in för att fortsätta');
  if(req.method!=='GET')checkOrigin(req);
  if(path==='/api/logout'&&req.method==='POST'){
    const t=cookies(req).mg_session;if(t)db.prepare('DELETE FROM sessions WHERE id_hash=?').run(digest(t));
    return json(res,200,{ok:true},{'Set-Cookie':clearCookie(check.secure)});
  }
  if(path==='/api/dashboard'&&req.method==='GET')return json(res,200,invoiceStatus(db));
  if(path==='/api/invoices'&&req.method==='GET')return json(res,200,{items:listInvoices(db)});
  if(path==='/api/invoices'&&req.method==='POST')return json(res,201,addInvoice(await readBody(req)));
  if(path==='/api/invoices'&&req.method==='PATCH'){
    const b=await readBody(req);const prev=db.prepare('SELECT * FROM invoices WHERE id=?').get(b.id);
    if(!prev)throw bad(404,'Faktura saknas');
    if(b.total_cents!==undefined&&Number(b.total_cents)!==prev.total_cents)throw bad(409,'Beloppet kan inte ändras efter registrering; skapa korrigeringsfaktura');
    const info=db.prepare('UPDATE invoices SET due_at=?,note=?,reference=? WHERE id=?').run(validateDate(b.due_at??prev.due_at),optionalString(b.note??prev.note,1500),optionalString(b.reference??prev.reference,120),b.id);
    audit(db,'invoice_updated',{id:b.id});return json(res,200,{updated:info.changes>0});
  }
  if(path==='/api/bank-transactions'&&req.method==='GET')return json(res,200,{items:listTransactions(db)});
  if(path==='/api/bank-transactions'&&req.method==='POST')return json(res,201,addBankTransaction(await readBody(req)));
  if(path==='/api/import/preview'&&req.method==='POST'){
    const b=await readBody(req);const items=parseBankFile(b.name,b.content_base64,optionalString(b.account,120)||'Swedbank');
    return json(res,200,{count:items.length,items:items.slice(0,20)});
  }
  if(path==='/api/import/commit'&&req.method==='POST'){
    const b=await readBody(req);if(b.confirm!==true)throw bad(400,'Bekräfta importen');
    const items=parseBankFile(b.name,b.content_base64,optionalString(b.account,120)||'Swedbank');
    return json(res,200,storeTransactions(db,items,'file:'+optionalString(b.name,120)));
  }
  if(path==='/api/allocations'&&req.method==='GET')return json(res,200,{items:db.prepare('SELECT * FROM allocations ORDER BY confirmed_at DESC').all()});
  if(path==='/api/allocations'&&req.method==='POST'){
    const b=await readBody(req);if(b.confirm!==true)throw bad(400,'Matchning måste bekräftas manuellt');
    allocate(db,requiredString(b.invoice_id,'Faktura-ID'),requiredString(b.transaction_id,'Bankhändelse-ID'),Number(b.amount_cents));
    return json(res,201,{ok:true});
  }
  if(path==='/api/allocations'&&req.method==='DELETE'){
    const b=await readBody(req);return json(res,200,{removed:deleteAllocation(db,requiredString(b.id,'Matchnings-ID'))});
  }
  if(path==='/api/audit'&&req.method==='GET')return json(res,200,{items:db.prepare('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 100').all()});
  // AIS only: reads account data, never creates, approves or executes payments.
  if(path==='/api/bank/status'&&req.method==='GET'){
    const connections=db.prepare('SELECT id,bank_name,accounts_json,valid_until,last_synced,status FROM bank_connections ORDER BY created_at DESC').all();
    return json(res,200,{configured:isConfigured(),connections:connections.map(x=>({...x,accounts:decryptObject(x.accounts_json).map(a=>({uid:a.uid,name:a.name,currency:a.currency,account_hint:maskAccount(a.account_id?.iban||a.account_id?.other?.identification)})),accounts_json:undefined}))});
  }
  if(path==='/api/bank/connect'&&req.method==='POST'){
    if(!isConfigured())throw bad(409,'Konfigurera Enable Banking i serverns miljövariabler först');
    const banks=await findSwedbank();const bank=banks.find(x=>x.name==='Swedbank')||banks[0];
    if(!bank)throw bad(404,'Swedbank hittades inte bland tillgängliga banker');
    const state=token();db.prepare('INSERT INTO bank_states(state_hash,expires_at) VALUES(?,?)').run(digest(state),Date.now()+15*60000);
    const auth=await bankingRequest('/auth',{method:'POST',body:startConsentBody(bank,state,check.origin)});
    const authUrl=new URL(auth.url);
    if(authUrl.protocol!=='https:'||!/(^|\.)enablebanking\.com$/.test(authUrl.hostname))throw bad(502,'Ogiltig vidarekoppling från bankleverantören');
    audit(db,'bank_consent_started',{bank:bank.name});return json(res,200,{url:auth.url});
  }
  // Callback intentionally uses GET and SameSite=Lax cookie from interactive browser navigation.
  if(path==='/api/bank/callback'&&req.method==='GET'){
    const state=url.searchParams.get('state')||'';
    const record=db.prepare('SELECT * FROM bank_states WHERE state_hash=?').get(digest(state));
    if(!state||!record||record.consumed||record.expires_at<Date.now())throw bad(403,'Ogiltig eller för gammal bankretur');
    db.prepare('UPDATE bank_states SET consumed=1 WHERE state_hash=?').run(digest(state));
    if(url.searchParams.has('error'))return redirect(res,'/?tab=bank&status=cancelled');
    const code=url.searchParams.get('code');if(!code)throw bad(400,'Saknar bankens engångskod');
    const session=await bankingRequest('/sessions',{method:'POST',body:{code}});
    const accounts=session.accounts||[];
    if(!session.session_id||!accounts.length)throw bad(502,'Banken returnerade inget tillgängligt konto');
    db.prepare('INSERT INTO bank_connections(id,provider,bank_name,encrypted_session,accounts_json,valid_until) VALUES(?,?,?,?,?,?)').run(randomUUID(),'enablebanking',session.aspsp?.name||'Swedbank',encryptObject({session_id:session.session_id}),encryptObject(accounts),session.access?.valid_until||'');
    audit(db,'bank_connected',{bank:session.aspsp?.name,accounts:accounts.length});
    return redirect(res,'/?tab=bank&status=connected');
  }
  if(path==='/api/bank/sync'&&req.method==='POST'){
    const b=await readBody(req),connection=db.prepare('SELECT * FROM bank_connections WHERE id=? AND status=?').get(b.connection_id,'connected');
    if(!connection)throw bad(404,'Aktiv bankanslutning saknas');
    if(connection.valid_until&&new Date(connection.valid_until).getTime()<Date.now())throw bad(409,'Bankmedgivandet har löpt ut');
    const accounts=decryptObject(connection.accounts_json);
    const selected=accounts.find(a=>a.uid===b.account_uid);
    if(!selected)throw bad(400,'Välj ett godkänt konto');
    const from=validateDate(b.date_from,true),to=validateDate(b.date_to,true);
    if(from>to||Math.abs(Date.parse(to)-Date.parse(from))>91*86400000)throw bad(400,'Välj ett datumintervall på högst 91 dagar');
    const raw=await fetchBookedTransactions(selected.uid,{dateFrom:from,dateTo:to});
    const hint=selected.account_id?.iban||selected.account_id?.other?.identification||selected.uid;
    const transactions=raw.map(x=>normalizeBankApiTransaction(x,hint)).filter(Boolean);
    const result=storeTransactions(db,transactions,'enablebanking');
    db.prepare('UPDATE bank_connections SET last_synced=CURRENT_TIMESTAMP WHERE id=?').run(connection.id);
    return json(res,200,{...result,received:raw.length});
  }
  throw bad(404,'Okänd begäran');
}
const server=http.createServer((req,res)=>route(req,res).catch(err=>{
  const status=err.status||(err instanceof TypeError?400:500);
  if(status>=500)console.error('Server error:',err.message); // Never log credentials, auth codes or request bodies.
  if(!res.headersSent)json(res,status,{error:status>=500?'Ett serverfel inträffade':err.message});else res.end();
}));
if(process.env.NODE_ENV!=='test')server.listen(check.port,()=>console.log(`MG Fakturakoll: ${check.origin}`));
export {server,db};
