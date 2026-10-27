import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {encryptObject} from '../src/security.js';
const folder=mkdtempSync(join(tmpdir(),'mg-message-api-'));
Object.assign(process.env,{NODE_ENV:'test',APP_ORIGIN:'http://localhost:3000',DB_PATH:join(folder,'db.sqlite'),SESSION_SECRET:'1'.repeat(64),BANK_DATA_KEY:'2'.repeat(64),GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'test',GMAIL_ACCOUNT:'mg.vitvaror@gmail.com'});
const {server,db,runScheduledSync}=await import('../src/server.js');
const base=await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
let cookie='';
const realFetch=globalThis.fetch;
async function call(path,body,origin='http://localhost:3000'){
  const r=await realFetch(base+'/api'+path,{method:body?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json',Origin:origin}:{})},body:body?JSON.stringify(body):undefined});
  if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,body:await r.json()};
}
test('authenticated review, exact-version approval and Gmail send work through HTTP',async()=>{
  const inv=await call('/invoices',{direction:'customer',invoice_number:'0597',party:'Kund AB',email:'unverified@example.com',total_cents:312500,due_at:'2000-01-01'});assert.equal(inv.status,201);
  await call('/reconciliation',{});let m=(await call('/customer-messages')).body.items.find(x=>x.status==='draft');assert.equal(m.recipient,'');
  assert.equal((await call('/customer-contacts',{invoice_id:inv.body.id,email:'kund@example.com',evidence:'Kundavtal'},'https://attacker.example')).status,403);
  assert.equal((await call('/customer-contacts',{invoice_id:inv.body.id,email:'kund@example.com',evidence:'Kundavtal'})).status,200);
  m=(await call('/customer-messages')).body.items.find(x=>x.status==='draft');
  db.prepare('INSERT INTO gmail_connections(id,email,encrypted_tokens) VALUES(?,?,?)').run('gmail',process.env.GMAIL_ACCOUNT,encryptObject({access_token:'test',refresh_token:'test-refresh',expires_at:Date.now()+3600000,scope:'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send'}));
  const old=globalThis.fetch;let posts=0;
  globalThis.fetch=async(url,options)=>{if(url.endsWith('/profile'))return new Response(JSON.stringify({emailAddress:process.env.GMAIL_ACCOUNT}));assert.ok(url.endsWith('/messages/send'));posts++;return new Response(JSON.stringify({id:'gmail-api-1'}));};
  try{
    const r=await call(`/customer-messages/${m.id}/review`,{version:m.version});assert.equal(r.status,200);
    assert.equal((await call(`/customer-messages/${m.id}/send`,{version:m.version,review_id:r.body.review_id})).status,403);
    assert.equal((await call(`/customer-messages/${m.id}/send`,{version:m.version,review_id:'forged',approve:true})).status,403);
    const results=await Promise.all([call(`/customer-messages/${m.id}/send`,{version:m.version,review_id:r.body.review_id,approve:true}),call(`/customer-messages/${m.id}/send`,{version:m.version,review_id:r.body.review_id,approve:true})]);
    assert.equal(results.filter(x=>x.status===200).length,1);assert.equal(posts,1);
    await runScheduledSync();assert.equal(posts,1);assert.equal(db.prepare('SELECT gmail_message_id FROM message_deliveries').get().gmail_message_id,'gmail-api-1');
  }finally{globalThis.fetch=old;}
});
test('messages page and script are served under the existing CSP',async()=>{
  const r=await realFetch(base+'/messages.js');assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/script-src 'self'/);assert.match(await r.text(),/Godkänn och skicka/);
});
test.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();rmSync(folder,{recursive:true,force:true});});
