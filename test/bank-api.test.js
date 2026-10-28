import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {digest,decryptObject} from '../src/security.js';

// Entire provider boundary is mocked. No .env, real certificates or bank accounts.
const folder=mkdtempSync(join(tmpdir(),'mg-bank-api-'));
process.env.NODE_ENV='test';process.env.APP_ORIGIN='https://mg.example.test';
process.env.MG_ADMIN_PASSWORD='test-only-administrator-password';
process.env.DB_PATH=join(folder,'db.sqlite');process.env.SESSION_SECRET='4'.repeat(64);process.env.BANK_DATA_KEY='5'.repeat(64);
for(const key of ['ENCRYPTION_KEY','ENABLEBANKING_APP_ID','ENABLEBANKING_PRIVATE_KEY_FILE','ENABLEBANKING_ENVIRONMENT','ENABLE_BANKING_PRIVATE_KEY_FILE'])delete process.env[key];
process.env.ENABLE_BANKING_ENVIRONMENT='SANDBOX';process.env.ENABLE_BANKING_APPLICATION_ID='mock-application';
process.env.ENABLE_BANKING_PRIVATE_KEY=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}}).privateKey;
const {server,db,runScheduledSync}=await import('../src/server.js');
const base=await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
const originalFetch=globalThis.fetch;
let cookie='',authBody,sessionIndex=0,providerCalls=0,transactionCalls=0,active=true,mode='',lastQuery;
let releaseProvider,providerReached,providerWait;
const account=(uid='account-1')=>({uid,name:'Test företagskonto',currency:'SEK',usage:'ORGA',account_id:{iban:'TEST-ACCOUNT-0001'},identification_hash:'stable-test-account'});
const transaction=(entry,amount='100.00',direction='CRDT')=>({status:'BOOK',entry_reference:entry,transaction_id:'temporary-'+sessionIndex+'-'+entry,booking_date:'2026-10-26',transaction_amount:{amount,currency:'SEK'},credit_debit_indicator:direction,debtor:{name:'Testkund AB'},reference_number:'12345'});
globalThis.fetch=async(url,options)=>{
  if(String(url).startsWith(base))return originalFetch(url,options);
  const target=new URL(url);assert.equal(target.origin,'https://api.enablebanking.com');providerCalls++;
  if(target.pathname==='/application')return Response.json({kid:'mock-application',environment:'SANDBOX',active,countries:['SE'],services:['AIS'],redirect_urls:[process.env.APP_ORIGIN+'/api/bank/callback']});
  if(target.pathname==='/aspsps')return Response.json({aspsps:[{name:'Swedbank',country:'SE',psu_types:['business'],maximum_consent_validity:90*86400}]});
  if(target.pathname==='/auth'){authBody=JSON.parse(options.body);return Response.json({url:'https://auth.enablebanking.com/ais/start?sessionid=mock'});}
  if(target.pathname==='/sessions'&&options.method==='POST'){
    if(mode==='pause_create'){mode='';providerReached();await providerWait;}
    sessionIndex++;
    if(mode==='code_error')return Response.json({error:'WRONG_AUTHORIZATION_CODE',message:'private-code-never-reflect'},{status:400});
    return Response.json({session_id:'private-session-'+sessionIndex,accounts:mode==='no_accounts'?[]:[account('account-'+sessionIndex)],aspsp:{name:'Swedbank',country:'SE'},psu_type:'business',access:{valid_until:new Date(Date.now()+86400000).toISOString()}});
  }
  if(target.pathname.startsWith('/sessions/')){
    if(options.method==='DELETE')return new Response(null,{status:204});
    if(mode==='pause_verify'){mode='';providerReached();await providerWait;}
    if(mode==='expired')return Response.json({error:'EXPIRED_SESSION'},{status:400});
    return Response.json({status:'AUTHORIZED',accounts:['account-'+target.pathname.split('-').at(-1)],access:{valid_until:new Date(Date.now()+86400000).toISOString()}});
  }
  if(target.pathname.endsWith('/transactions')){
    transactionCalls++;lastQuery=target.searchParams;
    if(mode==='rate_limit')return Response.json({error:'ASPSP_RATE_LIMIT_EXCEEDED',message:'private-bank-data'},{status:429,headers:{'Retry-After':'120'}});
    if(mode==='rate_limit_missing')return Response.json({error:'ASPSP_RATE_LIMIT_EXCEEDED'},{status:429});
    if(mode==='failure')throw Error('secret-provider-error');
    if(mode==='aggregate')return Response.json({transactions:[{...transaction('bg-aggregate','200.00'),debtor:{name:'Bankgirot'},reference_number:undefined,remittance_information:['Bankgiro insättning']} ]});
    if(!target.searchParams.has('continuation_key'))return Response.json({transactions:[transaction('entry-1')],continuation_key:'page-2'});
    assert.equal(target.searchParams.get('continuation_key'),'page-2');
    return Response.json({transactions:[transaction('entry-2','20.00','DBIT')]});
  }
  throw Error('Unexpected mock endpoint '+target.pathname);
};
async function call(path,method='GET',body,{session=cookie,origin=process.env.APP_ORIGIN}={}){
  return new Promise((resolve,reject)=>{
    const req=request(base+path,{method,headers:{Host:'mg.example.test',...(session?{Cookie:session}:{}),...(body!==undefined?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(JSON.stringify(body)),Origin:origin}:{})}},res=>{
      const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{let json={};try{json=JSON.parse(Buffer.concat(chunks).toString());}catch{}resolve({res:{status:res.statusCode,headers:{get:key=>Array.isArray(res.headers[key])?res.headers[key].join(','):res.headers[key]}},json});});
    });req.on('error',reject);req.end(body!==undefined?JSON.stringify(body):undefined);
  });
}
async function start(){const result=await call('/api/bank/connect','POST',{});assert.equal(result.res.status,200,JSON.stringify(result.json));return authBody.state;}
async function callback(state){return call('/api/bank/callback?state='+state+'&code=mock-one-use-code');}
async function current(){return (await call('/api/bank/status')).json.connections[0];}
after(async()=>{globalThis.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));db.close();rmSync(folder,{recursive:true,force:true});});

test('public HTTPS APIs require authenticated session; login rotates a Secure HttpOnly cookie',async()=>{
  assert.equal((await call('/api/me')).json.authenticated,false);
  for(const path of ['/api/invoices','/api/bank/status','/api/bank-transactions','/api/export','/api/payment-control/overview','/api/payment-control/runs/unowned'])assert.equal((await call(path)).res.status,401);
  assert.equal((await call('/api/payment-control/run','POST',{request_id:'unauthorized_request_0001'})).res.status,401);
  assert.equal((await call('/api/login','POST',{password:'wrong'})).res.status,401);
  assert.equal((await call('/api/login','POST',{password:process.env.MG_ADMIN_PASSWORD},{origin:'https://attacker.test'})).res.status,403);
  const login=await call('/api/login','POST',{password:process.env.MG_ADMIN_PASSWORD});assert.equal(login.res.status,200);
  const header=login.res.headers.get('set-cookie');assert.match(header,/HttpOnly/);assert.match(header,/SameSite=Lax/);assert.match(header,/Secure/);
  cookie=header.split(';')[0];assert.equal((await call('/api/me')).json.authenticated,true);
});
test('inactive provider application and missing configuration never start consent',async()=>{
  active=false;const result=await call('/api/bank/connect','POST',{});assert.equal(result.res.status,409);assert.equal(result.json.code,'application_inactive');active=true;
  const key=process.env.ENABLE_BANKING_PRIVATE_KEY;delete process.env.ENABLE_BANKING_PRIVATE_KEY;const before=providerCalls;
  try{assert.equal((await call('/api/bank/connect','POST',{})).res.status,409);assert.equal(providerCalls,before);}finally{process.env.ENABLE_BANKING_PRIVATE_KEY=key;}
});
test('state is bound to authenticated initiating browser and cannot be forged or replayed',async()=>{
  const state=await start();assert.match(state,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(authBody.psu_type,'business');assert.equal(authBody.access.transactions,true);assert.equal(authBody.access.balances,false);
  assert.equal(authBody.redirect_url,'https://mg.example.test/api/bank/callback');
  assert.equal((await call('/api/bank/callback?state=forged&code=x')).res.status,403);
  assert.equal((await call('/api/bank/callback?state='+state+'&code=x','GET',undefined,{session:''})).res.status,401);
  // A different valid login session for the same admin cannot finish this browser's consent.
  const other=await call('/api/login','POST',{password:process.env.MG_ADMIN_PASSWORD},{session:''});
  const otherCookie=other.res.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/api/bank/callback?state='+state+'&code=x','GET',undefined,{session:otherCookie})).res.status,403);
  const result=await callback(state);assert.equal(result.res.status,302);assert.equal(result.res.headers.get('location'),'/?tab=connections&status=select_account');
  assert.equal((await callback(state)).res.status,403);
  const connection=await current();assert.equal(connection.status,'pending_account');assert.equal(connection.selected_account_uid,'');
  assert.equal((await call('/api/bank/sync','POST',{connection_id:connection.id})).res.status,409);
  const stored=db.prepare('SELECT * FROM bank_connections WHERE id=?').get(connection.id);
  assert.ok(!stored.encrypted_session.includes('private-session'));assert.ok(!stored.accounts_json.includes('TEST-ACCOUNT'));assert.ok(decryptObject(stored.encrypted_session).session_id);
  const serialized=JSON.stringify((await call('/api/bank/status')).json);assert.ok(!serialized.includes('private-session'));assert.ok(!serialized.includes('TEST-ACCOUNT'));assert.ok(!serialized.includes('PRIVATE KEY'));
});
test('explicit account selection verifies accounts and initially imports 30 days with pagination',async()=>{
  const c=await current();
  assert.equal((await call('/api/bank/accounts','POST',{connection_id:c.id,account_uid:'unapproved-account'})).res.status,400);
  const result=await call('/api/bank/accounts','POST',{connection_id:c.id,account_uid:c.accounts[0].uid});
  assert.equal(result.res.status,200);assert.equal(result.json.imported,2);assert.equal(transactionCalls,2);
  assert.equal(lastQuery.get('transaction_status'),'BOOK');
  assert.equal(Date.parse(lastQuery.get('date_to'))-Date.parse(lastQuery.get('date_from')),29*86400000);
  const connected=await current();assert.equal(connected.status,'connected');assert.ok(connected.last_synced);
  const again=await call('/api/bank/sync','POST',{connection_id:c.id});assert.equal(again.json.imported,0);assert.equal(again.json.duplicate,2);
});
test('wrong owner and another principal cannot read or mutate company banking data',async()=>{
  const c=await current();db.prepare('UPDATE bank_connections SET owner=? WHERE id=?').run('another-user',c.id);
  try{
    assert.equal((await call('/api/bank/status')).json.connections.length,0);
    for(const [path,method,body] of [['/api/bank/sync','POST',{connection_id:c.id}],['/api/bank/accounts','POST',{connection_id:c.id,account_uid:c.accounts[0].uid}],['/api/bank/connections','DELETE',{id:c.id}]])assert.equal((await call(path,method,body)).res.status,404);
  }finally{db.prepare('UPDATE bank_connections SET owner=? WHERE id=?').run('administrator',c.id);}
  const otherToken='other-principal-test';db.prepare('INSERT INTO sessions(id_hash,expires_at,principal) VALUES(?,?,?)').run(digest(otherToken),Date.now()+10000,'other-user');
  for(const path of ['/api/bank/status','/api/bank-transactions','/api/invoices','/api/export'])assert.equal((await call(path,'GET',undefined,{session:'mg_session='+otherToken})).res.status,403);
});
test('rate limits persist cooldown; expired sessions require renewal without importing',async()=>{
  const c=await current();mode='rate_limit';const result=await call('/api/bank/sync','POST',{connection_id:c.id});assert.equal(result.res.status,429);assert.equal(result.res.headers.get('retry-after'),'120');
  const before=providerCalls;assert.equal((await call('/api/bank/sync','POST',{connection_id:c.id})).res.status,429);assert.equal(providerCalls,before);
  assert.equal((await call('/api/bank/accounts','POST',{connection_id:c.id,account_uid:c.accounts[0].uid})).res.status,429);assert.equal(providerCalls,before);
  db.prepare('UPDATE bank_connections SET retry_after=0 WHERE id=?').run(c.id);mode='expired';assert.equal((await call('/api/bank/sync','POST',{connection_id:c.id})).res.status,409);assert.equal((await current()).status,'renewal_required');mode='';
});
test('renewal replaces revoked consent and keeps stable transaction identities across account UIDs',async()=>{
  const old=await current();const result=await call('/api/bank/connect','POST',{renew_connection_id:old.id});assert.equal(result.res.status,200);
  assert.equal((await callback(authBody.state)).res.status,302);const c=await current();assert.equal(c.id,old.id);assert.equal(c.status,'pending_account');assert.notEqual(c.accounts[0].uid,old.accounts[0].uid);
  const selected=await call('/api/bank/accounts','POST',{connection_id:c.id,account_uid:c.accounts[0].uid});assert.equal(selected.json.imported,0);assert.equal(selected.json.duplicate,2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,2);
});
test('account selection locks provider verification against concurrent selection, sync and disconnect',async()=>{
  const c=await current();mode='pause_verify';providerWait=new Promise(resolve=>{releaseProvider=resolve;});const reached=new Promise(resolve=>{providerReached=resolve;});
  const pending=call('/api/bank/accounts','POST',{connection_id:c.id,account_uid:c.accounts[0].uid});await reached;
  try{
    assert.equal((await call('/api/bank/accounts','POST',{connection_id:c.id,account_uid:c.accounts[0].uid})).res.status,409);
    assert.equal((await call('/api/bank/sync','POST',{connection_id:c.id})).res.status,409);
    assert.equal((await call('/api/bank/connections','DELETE',{id:c.id})).res.status,409);
  }finally{releaseProvider();}
  assert.equal((await pending).res.status,200);assert.equal((await current()).selected_account_uid,c.accounts[0].uid);
});
test('failed initial retrieval reports the failure and preserves imported history',async()=>{
  const c=await current(),before=db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n;mode='failure';
  const result=await call('/api/bank/accounts','POST',{connection_id:c.id,account_uid:c.accounts[0].uid});mode='';
  assert.equal(result.res.status,200);assert.ok(result.json.initial_sync_error);assert.equal(result.json.imported,0);assert.equal((await current()).status,'error');assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,before);
  assert.equal((await call('/api/bank/sync','POST',{connection_id:c.id})).res.status,200);
});
test('revoked consent during initial account verification exposes a renewal path',async()=>{
  const c=await current();db.prepare("UPDATE bank_connections SET status='pending_account',selected_account_uid='' WHERE id=?").run(c.id);
  mode='expired';const result=await call('/api/bank/accounts','POST',{connection_id:c.id,account_uid:c.accounts[0].uid});mode='';
  assert.equal(result.res.status,409);assert.equal((await current()).status,'renewal_required');
  db.prepare("UPDATE bank_connections SET status='connected',selected_account_uid=? WHERE id=?").run(c.selected_account_uid,c.id);
});
test('cancelled, expired and failed approvals never create a connection',async()=>{
  const n=db.prepare('SELECT COUNT(*) n FROM bank_connections').get().n;
  let state=await start();const cancelled=await call('/api/bank/callback?state='+state+'&error=access_denied&error_description=private-data');assert.equal(cancelled.res.status,302);assert.match(cancelled.res.headers.get('location'),/cancelled/);assert.equal((await callback(state)).res.status,403);
  state=await start();db.prepare('UPDATE bank_states SET expires_at=0 WHERE state_hash=?').run(digest(state));assert.equal((await callback(state)).res.status,403);
  state=await start();mode='code_error';const error=await callback(state);assert.equal(error.res.status,409);assert.ok(!JSON.stringify(error.json).includes('private-code'));mode='';
  state=await start();mode='no_accounts';assert.equal((await callback(state)).res.status,502);mode='';
  assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_connections').get().n,n);
});
test('Bankgiro totals without payer details are review-only and cannot pay invoices',async()=>{
  const c=await current();mode='aggregate';const synced=await call('/api/bank/sync','POST',{connection_id:c.id});mode='';assert.equal(synced.json.imported,1);
  const t=(await call('/api/bank-transactions')).json.items.find(t=>t.bank_reference==='bg-aggregate');assert.equal(t.is_aggregate,1);assert.equal(t.status,'review');assert.match(t.review_reason,/Betalardetaljer saknas/);
  const invoice=await call('/api/invoices','POST',{direction:'customer',party:'Testkund AB',invoice_number:'BG-1',total_cents:20000,reference:'12345'});
  assert.equal((await call('/api/allocations','POST',{invoice_id:invoice.json.id,transaction_id:t.id,amount_cents:20000,confirm:true})).res.status,400);
  assert.equal((await call('/api/invoices/'+invoice.json.id)).json.invoice.paid_cents,0);
});
test('legacy identity preflight blocks the complete sync before any provider read',async()=>{
  const c=await current(),legacy=db.prepare("SELECT id FROM bank_transactions WHERE source='enablebanking' LIMIT 1").get();
  db.prepare('UPDATE bank_transactions SET api_identity_version=0 WHERE id=?').run(legacy.id);
  const calls=providerCalls,rows=db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n;
  try{
    const result=await call('/api/bank/sync','POST',{connection_id:c.id});
    assert.equal(result.res.status,409);assert.match(result.json.error,/äldre konto- eller transaktions-ID/);
    assert.equal(providerCalls,calls);assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,rows);
  }finally{
    db.prepare('UPDATE bank_transactions SET api_identity_version=1 WHERE id=?').run(legacy.id);
    db.prepare("UPDATE bank_connections SET status='connected',last_error='' WHERE id=?").run(c.id);
  }
});

test('scheduled ASPSP rate limits without Retry-After retain six-hour cooldown across restart',async()=>{
  const c=await current(),job='bank:'+c.id;
  db.prepare("UPDATE bank_connections SET last_synced='',retry_after=0,status='connected' WHERE id=?").run(c.id);db.prepare('DELETE FROM integration_jobs WHERE name=?').run(job);
  await call('/api/settings','PATCH',{sync_interval_minutes:15});mode='rate_limit_missing';const before=transactionCalls;
  try{
    await runScheduledSync();assert.equal(transactionCalls,before+1);
    assert.ok(db.prepare('SELECT retry_after FROM bank_connections WHERE id=?').get(c.id).retry_after>=Date.now()+21599000);
    assert.ok(db.prepare('SELECT next_attempt FROM integration_jobs WHERE name=?').get(job).next_attempt>=Date.now()+21599000);
    // Even if the shorter configured interval elapsed, provider cooldown wins.
    db.prepare('UPDATE integration_jobs SET last_attempt=0 WHERE name=?').run(job);
    const restarted=await import('../src/server.js?aspsp-rate-fallback-restart');
    try{await restarted.runScheduledSync();assert.equal(transactionCalls,before+1);}finally{restarted.db.close();}
  }finally{mode='';db.prepare("UPDATE bank_connections SET retry_after=0,last_synced='',status='connected' WHERE id=?").run(c.id);db.prepare('DELETE FROM integration_jobs WHERE name=?').run(job);}
});

test('scheduled synchronization only uses selected account and logout invalidates pending callback',async()=>{
  const c=await current();db.prepare("UPDATE bank_connections SET last_synced='' WHERE id=?").run(c.id);
  await call('/api/settings','PATCH',{sync_interval_minutes:15});const before=transactionCalls;await runScheduledSync();assert.equal(transactionCalls,before+2);
  const state=await start(),count=db.prepare('SELECT COUNT(*) n FROM bank_connections').get().n;
  mode='pause_create';providerWait=new Promise(resolve=>{releaseProvider=resolve;});const reached=new Promise(resolve=>{providerReached=resolve;});
  const pending=callback(state);await reached;
  assert.equal((await call('/api/logout','POST',{})).res.status,200);releaseProvider();
  assert.equal((await pending).res.status,401);assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_connections').get().n,count);
  assert.equal((await call('/api/bank/status')).res.status,401);assert.equal((await callback(state)).res.status,401);
});
