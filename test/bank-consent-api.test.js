import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {digest, decryptObject,encryptObject} from '../src/security.js';

// Synthetic application, browser and bank boundaries; no external requests.
const folder=mkdtempSync(join(tmpdir(),'mg-company-consent-'));
Object.assign(process.env,{NODE_ENV:'test',APP_ORIGIN:'https://consent.example.test',MG_ADMIN_PASSWORD:'synthetic-consent-admin-password',DB_PATH:join(folder,'db.sqlite'),SESSION_SECRET:'6'.repeat(64),BANK_DATA_KEY:'7'.repeat(64),ENABLE_BANKING_ENVIRONMENT:'SANDBOX',ENABLE_BANKING_APPLICATION_ID:'consent-test'});
for(const key of ['ENABLEBANKING_APP_ID','ENABLEBANKING_PRIVATE_KEY_FILE','ENABLEBANKING_ENVIRONMENT','ENABLE_BANKING_PRIVATE_KEY_FILE','BANK_COMPANY_AUTHORIZATIONS'])delete process.env[key];
process.env.ENABLE_BANKING_PRIVATE_KEY=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}}).privateKey;
const {server,db}=await import('../src/server.js');
const base=await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
const originalFetch=globalThis.fetch, iban='SE4280000890119146168423';
const account={uid:'account-1',name:'Syntetiskt företagskonto',currency:'SEK',usage:'ORGA',account_id:{iban},identification_hash:'synthetic-stable-hash'};
let cookie='',calls=0,authBody,checkedPatch={},exchangePatch={},providerIndex=0,releaseExchange,reachedExchange,exchangeWait,deleteFailure='',onTransactions,onSessionRead;
const deletedSessions=[];
const future=hours=>new Date(Date.now()+hours*3600000).toISOString();
globalThis.fetch=async(url,options={})=>{
  const target=new URL(url);assert.equal(target.origin,'https://api.enablebanking.com');calls++;
  if(target.pathname==='/application')return Response.json({kid:'consent-test',environment:'SANDBOX',active:true,countries:['SE'],services:['AIS'],redirect_urls:[process.env.APP_ORIGIN+'/api/bank/callback']});
  if(target.pathname==='/aspsps')return Response.json({aspsps:[{name:'Swedbank',country:'SE',psu_types:['business'],maximum_consent_validity:86400}]});
  if(target.pathname==='/auth'){authBody=JSON.parse(options.body);return Response.json({url:'https://auth.enablebanking.com/ais/start?sessionid=synthetic'});}
  if(target.pathname==='/sessions'&&options.method==='POST'){
    if(exchangeWait){reachedExchange();await exchangeWait;exchangeWait=undefined;}
    return Response.json({session_id:'secret-consent-'+(++providerIndex),accounts:[account],aspsp:{name:'Swedbank',country:'SE'},psu_type:'business',access:{valid_until:future(48),transactions:true},...exchangePatch});
  }
  if(target.pathname.startsWith('/sessions/')){
    if(options.method==='DELETE'){deletedSessions.push(target.pathname);if(target.pathname===deleteFailure)return Response.json({error:'SYNTHETIC_DELETE_FAILURE',message:'private-bank-error'},{status:500});return new Response(null,{status:204});}
    await onSessionRead?.();
    // Official GET schema is SessionAccount, not the POST AccountResource.
    return Response.json({status:'AUTHORIZED',accounts:[account.uid],accounts_data:[{uid:account.uid,identification_hash:account.identification_hash}],aspsp:{name:'Swedbank',country:'SE'},psu_type:'business',access:{valid_until:future(36),transactions:true},...checkedPatch});
  }
  if(target.pathname.endsWith('/transactions')){onTransactions?.();return Response.json({transactions:[]});}
  throw Error('Unexpected synthetic endpoint '+target.pathname);
};
async function call(path,method='GET',body,session=cookie,origin=process.env.APP_ORIGIN){
  return new Promise((resolve,reject)=>{
    const content=body===undefined?undefined:JSON.stringify(body);
    const req=request(base+path,{method,headers:{Host:'consent.example.test',...(session?{Cookie:session}:{}),...(content?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(content),Origin:origin}:{})}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{let json={};try{json=JSON.parse(Buffer.concat(chunks));}catch{}resolve({status:res.statusCode,headers:res.headers,json});});
    });req.on('error',reject);req.end(content);
  });
}
async function start(body={}){const result=await call('/api/bank/connect','POST',body);assert.equal(result.status,200,JSON.stringify(result.json));return {...result.json,state:authBody.state};}
const callback=(state,suffix='code=synthetic-once')=>call('/api/bank/callback?state='+state+'&'+suffix);
function proof(){process.env.BANK_COMPANY_AUTHORIZATIONS=JSON.stringify({version:1,bindings:[{companyId:'workspace:administrator',storageOwnerId:'administrator',provider:'enablebanking',bankName:'Swedbank',country:'SE',accountKeys:['iban:'+iban],status:'active',origin:'bank',evidenceId:'synthetic-bank-authority',checkedAt:new Date(Date.now()-60000).toISOString(),validUntil:future(72)}]});}
after(async()=>{globalThis.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));db.close();rmSync(folder,{recursive:true,force:true});});

test('company consent HTTP security and lifecycle',async t=>{
  const login=await call('/api/login','POST',{password:process.env.MG_ADMIN_PASSWORD});assert.equal(login.status,200);cookie=login.headers['set-cookie'][0].split(';')[0];
  await t.test('company, CSRF, unsupported bank and Bankgiro scope fail before provider calls',async()=>{
    for(const body of [{companyId:'workspace:someone-else'},{requiredScopes:['accounts:read','transactions:read','bankgiro:read']},{bankName:'Unknown Corporate Bank',country:'SE'}]){
      const before=calls,result=await call('/api/bank/connect','POST',body);assert.ok([400,403,409].includes(result.status));assert.equal(calls,before);
    }
    const before=calls;assert.equal((await call('/api/bank/connect','POST',{},cookie,'https://attacker.test')).status,403);assert.equal(calls,before);
  });
  await t.test('sibling attempts survive and omitted company cannot bypass corporate proof',async()=>{
    const first=await start(),second=await start();assert.notEqual(first.flowId,second.flowId);
    assert.equal((await callback(first.state)).status,302);assert.equal((await callback(second.state)).status,302);
    const before=calls,status=await call('/api/bank/status');assert.equal(calls,before);
    assert.equal(status.json.connections.length,2);
    const connection=status.json.connections[0];assert.equal(connection.consent.companyId,'workspace:administrator');assert.equal(connection.consent.mode,'company');assert.equal(connection.consent.corporateAuthorization.status,'unverified');
    assert.equal((await call('/api/bank/accounts','POST',{connection_id:connection.id,account_uid:account.uid})).status,409);assert.equal(calls,before);
    assert.equal((await callback(first.state)).status,403);
    assert.ok(!JSON.stringify(status.json).includes('secret-consent-'));
  });
  await t.test('callback envelope and same-principal other browser cannot consume the state',async()=>{
    const flow=await start(),login=await call('/api/login','POST',{password:process.env.MG_ADMIN_PASSWORD},''),other=login.headers['set-cookie'][0].split(';')[0],before=calls;
    assert.equal((await call('/api/bank/callback?state='+flow.state+'&code=once','GET',undefined,other)).status,403);
    for(const suffix of ['code=once&code=twice','code=once&error=access_denied','code=once&companyId=workspace:other','error=access_denied&error_description=%0Aprivate'])assert.equal((await callback(flow.state,suffix)).status,403);
    assert.equal(db.prepare('SELECT consumed FROM bank_states WHERE state_hash=?').get(digest(flow.state)).consumed,0);assert.equal(calls,before);
    assert.equal((await callback(flow.state)).status,302);
  });
  await t.test('changing application generation invalidates pending consent before exchange',async()=>{
    const flow=await start(),before=calls;process.env.ENABLE_BANKING_APPLICATION_ID='replaced-test-application';
    try{const result=await callback(flow.state);assert.equal(result.status,409);assert.equal(result.json.code,'CONSENT_APPLICATION_CHANGED');assert.equal(calls,before);}finally{process.env.ENABLE_BANKING_APPLICATION_ID='consent-test';}
  });
  await t.test('pre-migration contextless redirects require restart and cannot create legacy rows',async()=>{
    const flow=await start(),before=calls,count=db.prepare('SELECT count(*) n FROM bank_connections').get().n;db.prepare("UPDATE bank_states SET context_json='' WHERE state_hash=?").run(digest(flow.state));
    const result=await callback(flow.state);assert.equal(result.status,409);assert.equal(result.json.code,'CONSENT_FLOW_EXPIRED');assert.equal(calls,before);assert.equal(db.prepare('SELECT count(*) n FROM bank_connections').get().n,count);
  });
  await t.test('current provider session, exact accounts and read scope are checked after exchange',async()=>{
    for(const patch of [{status:'REVOKED'},{accounts:['other'],accounts_data:[{...account,uid:'other'}]},{access:{valid_until:future(24),transactions:false}},{accounts_data:[{...account,usage:'PRIV'}]},{accounts_data:[{...account,account_id:{iban:'SE4280000890119146168424'}}]},{accounts_data:[{uid:account.uid,identification_hash:'different-primary-hash'}]},{accounts_data:[{...account,currency:'EUR'}]}]){
      const flow=await start(),before=db.prepare('SELECT count(*) n FROM bank_connections').get().n;checkedPatch=patch;
      const result=await callback(flow.state);assert.equal(result.status,409,JSON.stringify(result.json));checkedPatch={};
      assert.equal(db.prepare('SELECT count(*) n FROM bank_connections').get().n,before);
      assert.equal(db.prepare('SELECT consumed,status FROM bank_states WHERE state_hash=?').get(digest(flow.state)).status,'failed');
      assert.equal((await callback(flow.state)).status,403);
    }
  });
  await t.test('an unbound failed callback never deletes a provider grant it has not committed',async()=>{
    const flow=await start(),remote='synthetic-unowned-legacy-session',before=deletedSessions.length,connections=db.prepare('SELECT count(*) n FROM bank_connections').get().n;
    exchangePatch={session_id:remote};checkedPatch={status:'REVOKED'};
    try{
      const result=await callback(flow.state);assert.equal(result.status,409);
      assert.equal(deletedSessions.length,before,'An absence scan cannot authorize remote revocation');
      assert.equal(db.prepare('SELECT count(*) n FROM bank_connections').get().n,connections);
      const review=db.prepare("SELECT details FROM audit_events WHERE action='bank_consent_cleanup_review' ORDER BY rowid DESC LIMIT 1").get();
      assert.equal(JSON.parse(review.details).flow_id,flow.flowId);assert.equal(JSON.parse(review.details).provider_session_revoked,false);assert.equal(JSON.parse(review.details).recovery,'provider_expiry_or_manual_review');
      assert.equal((await callback(flow.state)).status,403);
    }finally{exchangePatch={};checkedPatch={};}
  });
  await t.test('consent expiry is bounded by request, exchange and current provider response',async()=>{
    proof();const flow=await start(),requested=authBody.access.valid_until;
    assert.equal((await callback(flow.state)).status,302);
    const row=db.prepare('SELECT * FROM bank_connections ORDER BY rowid DESC LIMIT 1').get();assert.equal(row.valid_until,requested);assert.equal(decryptObject(row.encrypted_session).session_id,'secret-consent-'+providerIndex);
    const earlier=future(1),next=await start();checkedPatch={access:{valid_until:earlier,transactions:true}};assert.equal((await callback(next.state)).status,302);checkedPatch={};assert.equal(db.prepare('SELECT valid_until FROM bank_connections ORDER BY rowid DESC LIMIT 1').get().valid_until,earlier);
    assert.equal((await call('/api/bank/accounts','POST',{connection_id:row.id,account_uid:account.uid})).status,200);
    delete process.env.BANK_COMPANY_AUTHORIZATIONS;const before=calls;
    assert.equal((await call('/api/bank/sync','POST',{connection_id:row.id})).status,409);assert.equal(calls,before);proof();
  });
  await t.test('terminal cancellation, denial and expiry remain visible without provider calls',async()=>{
    for(const [description,outcome]of [['Cancelled by user','cancelled'],['Denied data sharing consent','denied']]){
      const flow=await start();assert.equal((await callback(flow.state,'error=access_denied&error_description='+encodeURIComponent(description))).status,302);
      const stored=db.prepare('SELECT status FROM bank_states WHERE state_hash=?').get(digest(flow.state));assert.equal(stored.status,outcome);
    }
    const flow=await start();db.prepare('UPDATE bank_states SET expires_at=? WHERE state_hash=?').run(Date.now()-1,digest(flow.state));
    const before=calls,status=await call('/api/bank/status');assert.equal(calls,before);assert.equal(status.json.consentFlow.id,flow.flowId);assert.equal(status.json.consentFlow.status,'expired');assert.equal((await callback(flow.state)).status,403);
  });
  await t.test('disconnect invalidates an outstanding renewal without resurrecting the connection',async()=>{
    const connection=db.prepare('SELECT * FROM bank_connections ORDER BY rowid DESC LIMIT 1').get(),renewal=await start({renew_connection_id:connection.id});
    const removed=await call('/api/bank/connections','DELETE',{id:connection.id});assert.equal(removed.status,200);assert.equal(removed.json.providerSessionRevoked,true);assert.equal(removed.json.bankRevocationConfirmed,false);
    const before=calls;assert.equal((await callback(renewal.state)).status,403);assert.equal(calls,before);assert.equal(db.prepare('SELECT id FROM bank_connections WHERE id=?').get(connection.id),undefined);
  });
  await t.test('renewal exchange holds the existing connection lease against disconnect',async()=>{
    const connection=db.prepare('SELECT * FROM bank_connections ORDER BY rowid DESC LIMIT 1').get(),renewal=await start({renew_connection_id:connection.id});
    exchangeWait=new Promise(resolve=>{releaseExchange=resolve;});const reached=new Promise(resolve=>{reachedExchange=resolve;});const pending=callback(renewal.state);await reached;
    try{assert.equal((await call('/api/bank/connections','DELETE',{id:connection.id})).status,409);}finally{releaseExchange();}
    assert.equal((await pending).status,302);assert.equal(db.prepare('SELECT status FROM bank_connections WHERE id=?').get(connection.id).status,'pending_account');
  });
  await t.test('unverified renewal preserves the previous consent and reused remote ids are never deleted',async()=>{
    const connection=db.prepare('SELECT * FROM bank_connections ORDER BY rowid DESC LIMIT 1').get(),remote=decryptObject(connection.encrypted_session).session_id;
    let flow=await start({renew_connection_id:connection.id});delete process.env.BANK_COMPANY_AUTHORIZATIONS;
    const before=deletedSessions.length;assert.equal((await callback(flow.state)).status,409);assert.equal(deletedSessions.slice(before).includes('/sessions/'+remote),false);assert.equal(db.prepare('SELECT encrypted_session FROM bank_connections WHERE id=?').get(connection.id).encrypted_session,connection.encrypted_session);proof();
    flow=await start({renew_connection_id:connection.id});exchangePatch={session_id:remote};const next=deletedSessions.length;
    try{assert.equal((await callback(flow.state)).status,502);assert.equal(deletedSessions.slice(next).includes('/sessions/'+remote),false);}finally{exchangePatch={};}
  });
  await t.test('a fresh connection cannot alias or clean up another persisted provider session',async()=>{
    const existing=db.prepare('SELECT * FROM bank_connections ORDER BY rowid DESC LIMIT 1').get(),remote=decryptObject(existing.encrypted_session).session_id,flow=await start(),before=calls,deleted=deletedSessions.length;
    exchangePatch={session_id:remote};
    try{const result=await callback(flow.state);assert.equal(result.status,502);assert.equal(result.json.code,'BANK_SESSION_REUSED');assert.equal(calls,before+1);assert.equal(deletedSessions.length,deleted);assert.equal(db.prepare('SELECT encrypted_session FROM bank_connections WHERE id=?').get(existing.id).encrypted_session,existing.encrypted_session);}finally{exchangePatch={};}
  });
  await t.test('simultaneous fresh callbacks cannot commit or revoke a shared provider session',async()=>{
    const first=await start(),second=await start(),before=db.prepare('SELECT count(*) n FROM bank_connections').get().n,deleted=deletedSessions.length;
    let release,ready,count=0;const gate=new Promise(resolve=>{release=resolve;}),reached=new Promise(resolve=>{ready=resolve;});
    onSessionRead=async()=>{if(++count===2)ready();await gate;};exchangePatch={session_id:'synthetic-race-session'};
    const one=callback(first.state),two=callback(second.state);await reached;release();
    try{const results=await Promise.all([one,two]);assert.deepEqual(results.map(result=>result.status).sort(),[302,502]);assert.equal(db.prepare('SELECT count(*) n FROM bank_connections').get().n,before+1);assert.equal(deletedSessions.length,deleted);}finally{onSessionRead=undefined;exchangePatch={};}
  });
  await t.test('uncertain replacement revocation blocks the old consent until renewed',async()=>{
    const connection=db.prepare('SELECT * FROM bank_connections ORDER BY rowid DESC LIMIT 1').get(),flow=await start({renew_connection_id:connection.id});deleteFailure='/sessions/'+decryptObject(connection.encrypted_session).session_id;
    try{assert.equal((await callback(flow.state)).status,502);const status=await call('/api/bank/status');assert.equal(status.json.connections.find(item=>item.id===connection.id).status,'renewal_required');const before=calls;assert.equal((await call('/api/bank/sync','POST',{connection_id:connection.id})).status,409);assert.equal(calls,before);}finally{deleteFailure='';}
  });
  await t.test('failed disconnect stays visibly pending and prevents any subsequent import',async()=>{
    const connection=db.prepare('SELECT * FROM bank_connections ORDER BY rowid DESC LIMIT 1').get();deleteFailure='/sessions/'+decryptObject(connection.encrypted_session).session_id;
    try{const result=await call('/api/bank/connections','DELETE',{id:connection.id});assert.equal(result.status,502);assert.ok(!JSON.stringify(result.json).includes('private-bank-error'));const before=calls,status=await call('/api/bank/status');assert.equal(status.json.connections.find(item=>item.id===connection.id).status,'revocation_pending');assert.equal((await call('/api/bank/accounts','POST',{connection_id:connection.id,account_uid:account.uid})).status,409);assert.equal((await call('/api/bank/sync','POST',{connection_id:connection.id})).status,409);assert.equal(calls,before);}finally{deleteFailure='';}
    assert.equal((await call('/api/bank/connections','DELETE',{id:connection.id})).status,200);
  });
  await t.test('authority revoked during a provider read prevents checkpoint and financial writes',async()=>{
    proof();const flow=await start();assert.equal((await callback(flow.state)).status,302);const connection=db.prepare('SELECT * FROM bank_connections ORDER BY rowid DESC LIMIT 1').get();assert.equal((await call('/api/bank/accounts','POST',{connection_id:connection.id,account_uid:account.uid})).status,200);
    const before=db.prepare('SELECT encrypted_session,last_synced FROM bank_connections WHERE id=?').get(connection.id);onTransactions=()=>{delete process.env.BANK_COMPANY_AUTHORIZATIONS;};
    try{assert.equal((await call('/api/bank/sync','POST',{connection_id:connection.id})).status,409);assert.deepEqual(db.prepare('SELECT encrypted_session,last_synced FROM bank_connections WHERE id=?').get(connection.id),before);}finally{onTransactions=undefined;proof();}
  });
  await t.test('existing metadata-free connections remain usable and explicitly unverified',async()=>{
    delete process.env.BANK_COMPANY_AUTHORIZATIONS;
    db.prepare("INSERT INTO bank_connections(id,provider,bank_name,encrypted_session,accounts_json,valid_until,owner,status,selected_account_uid) VALUES('legacy-consent','enablebanking','Swedbank',?,?,?,'administrator','connected',?)").run(encryptObject({session_id:'legacy-provider-session'}),encryptObject([account]),future(12),account.uid);
    const status=await call('/api/bank/status'),connection=status.json.connections.find(item=>item.id==='legacy-consent');assert.equal(connection.consent.mode,'legacy');assert.equal(connection.consent.corporateAuthorization.status,'unverified');assert.equal(connection.status,'connected');assert.equal((await call('/api/bank/sync','POST',{connection_id:'legacy-consent'})).status,200);proof();
  });
});
