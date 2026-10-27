import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {textPdf} from './fixtures.js';
import {request} from 'node:http';

const folder=mkdtempSync(join(tmpdir(),'mg-gmail-api-'));
Object.assign(process.env,{NODE_ENV:'test',APP_ORIGIN:'https://mg.example',DB_PATH:join(folder,'db.sqlite'),SESSION_SECRET:'1'.repeat(64),BANK_DATA_KEY:'2'.repeat(64),MG_ADMIN_PASSWORD:'synthetic-test-password',GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',GMAIL_ACCOUNT:'mg.vitvaror@gmail.com'});
const {server,db,runScheduledSync}=await import('../src/server.js');
const base=await new Promise(r=>server.listen(0,'127.0.0.1',()=>r('http://127.0.0.1:'+server.address().port)));
const originalFetch=globalThis.fetch;let cookie='',wrongAccount=false,tokenCalls=0,listCalls=0;
globalThis.fetch=async(url,options)=>{
  if(String(url).startsWith(base))return originalFetch(url,options);
  const path=new URL(url).pathname;
  if(path==='/token'){tokenCalls++;return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,scope:'https://www.googleapis.com/auth/gmail.readonly'});}
  if(path==='/revoke')return new Response('');
  if(path.endsWith('/profile'))return Response.json({emailAddress:wrongAccount?'wrong@gmail.com':'mg.vitvaror@gmail.com'});
  if(path.endsWith('/messages')){listCalls++;return Response.json({messages:[{id:'archive'}]});}
  if(path.includes('/attachments/'))return Response.json({data:textPdf().toString('base64url')});
  if(path.includes('/messages/'))return Response.json({id:'archive',labelIds:[],internalDate:String(Date.now()),payload:{headers:[{name:'Subject',value:'Här kommer underlaget'},{name:'From',value:'Testbolaget AB <supplier@example.com>'},{name:'To',value:'mg.vitvaror@gmail.com'}],parts:[{filename:'document.pdf',mimeType:'application/pdf',partId:'1',body:{attachmentId:'file',size:1000}}]}});
  throw Error('Unexpected provider request');
};
async function call(path,method='GET',body,session=cookie){
  return new Promise((resolve,reject)=>{
    const req=request(base+path,{method,headers:{Host:'mg.example',...(session?{Cookie:session}:{}),...(body!==undefined?{'Content-Type':'application/json',Origin:'https://mg.example','Content-Length':Buffer.byteLength(JSON.stringify(body))}:{})}},res=>{
      const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{let json={};try{json=JSON.parse(Buffer.concat(chunks).toString());}catch{}resolve({res:{status:res.statusCode,headers:{get:key=>Array.isArray(res.headers[key])?res.headers[key].join(','):res.headers[key]}},json});});
    });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
}
test('Gmail business endpoints and original previews reject anonymous public access',async()=>{
  for(const path of ['/api/gmail/status','/api/documents/unknown/preview'])assert.equal((await call(path)).res.status,401);
  const login=await call('/api/login','POST',{password:process.env.MG_ADMIN_PASSWORD});assert.equal(login.res.status,200);cookie=login.res.headers.get('set-cookie').split(';')[0];
});
test('OAuth callback requires the initiating browser, rejects ambiguous parameters and consumes state once',async()=>{
  const start=await call('/api/gmail/connect','POST',{}),state=new URL(start.json.url).searchParams.get('state');
  assert.equal((await call('/api/gmail/callback?state='+state+'&code=x','GET',undefined,'mg_session=other')).res.status,401);
  assert.equal((await call('/api/gmail/callback?state='+state+'&state='+state+'&code=x')).res.status,403);assert.equal(tokenCalls,0);
  assert.equal((await call('/api/gmail/callback?state='+state+'&code=x')).res.status,302);
  assert.equal((await call('/api/gmail/callback?state='+state+'&code=x')).res.status,403);
  const stored=db.prepare('SELECT encrypted_tokens FROM gmail_connections').get();assert.ok(stored);assert.ok(!stored.encrypted_tokens.includes('synthetic-refresh'));
});
test('wrong Gmail account cannot replace the existing connection',async()=>{
  wrongAccount=true;const start=await call('/api/gmail/connect','POST',{}),state=new URL(start.json.url).searchParams.get('state');
  const result=await call('/api/gmail/callback?state='+state+'&code=x');assert.equal(result.res.status,409);assert.equal(result.json.code,'account_mismatch');assert.equal(db.prepare('SELECT email FROM gmail_connections').get().email,'mg.vitvaror@gmail.com');wrongAccount=false;
});
test('server scheduler imports archived mail with neutral subject, extracts real PDF and repeats idempotently',async()=>{
  await runScheduledSync();assert.equal(listCalls,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM documents').get().n,1);
  const doc=db.prepare('SELECT * FROM documents').get(),extraction=JSON.parse(doc.extraction);assert.equal(extraction.fields.total_cents.value,375000);assert.equal(extraction.fields.invoice_number.value,'0606');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM invoices').get().n,0);
  await runScheduledSync();assert.equal(listCalls,1);
  const repeat=await call('/api/gmail/sync','POST',{});assert.equal(repeat.json.duplicate,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM documents').get().n,1);
  const approved=await call('/api/documents/'+doc.id+'/approve','POST',{confirm:true,values:{party:'Korrigerat Testbolaget AB'}});assert.equal(approved.res.status,200);assert.equal(JSON.parse(db.prepare('SELECT extraction FROM documents').get().extraction).fields.party.value,'Testbolaget AB');
  const audit=JSON.parse(db.prepare("SELECT details FROM audit_events WHERE action='invoice_review_approved'").get().details);assert.equal(audit.changes.party.before,'Testbolaget AB');assert.equal(audit.changes.party.after,'Korrigerat Testbolaget AB');
  assert.equal((await call('/api/invoices')).json.items[0].status,'unreconciled');
});
test.after(async()=>{globalThis.fetch=originalFetch;await new Promise(r=>server.close(r));db.close();rmSync(folder,{recursive:true,force:true});});
