import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {digest,decryptObject} from '../src/security.js';
import * as runtimeModule from '../src/company-runtime.js';

const directory=mkdtempSync(join(tmpdir(),'mg-joined-consent-'));
Object.assign(process.env,{NODE_ENV:'test',APP_ORIGIN:'https://joined-consent.example.test',MG_ADMIN_PASSWORD:'synthetic-joined-password',DB_PATH:join(directory,'legacy.sqlite'),SESSION_SECRET:'1'.repeat(64),BANK_DATA_KEY:'2'.repeat(64),ENABLE_BANKING_ENVIRONMENT:'SANDBOX',ENABLE_BANKING_APPLICATION_ID:'joined-consent',MG_SAAS_ONBOARDING_ENABLED:'true'});
for(const key of ['ENABLEBANKING_APP_ID','ENABLEBANKING_PRIVATE_KEY_FILE','ENABLEBANKING_ENVIRONMENT','ENABLE_BANKING_PRIVATE_KEY_FILE'])delete process.env[key];
process.env.ENABLE_BANKING_PRIVATE_KEY=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}}).privateKey;
const {server,db,companyRuntime:runtime}=await import('../src/server.js');
const base=await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)));
const verification={status:'verified',evidenceId:'synthetic-owner-relationship',verifiedBy:'operator'};
const a=runtime.provisionCompany({companyId:'company-a',name:'Company A',actorId:'alice',verification});
runtime.provisionCompany({companyId:'company-b',name:'Company B',actorId:'ben',verification});
for(const [actorId,role]of [['bob','admin'],['accountant','accountant'],['viewer','viewer'],['backup-owner','owner']])runtime.setMembership({companyId:'company-a',actorId,role});
runtime.setMembership({companyId:'company-b',actorId:'alice',role:'owner'});
const account={uid:'synthetic-account',name:'Synthetic business account',currency:'SEK',usage:'ORGA',identification_hash:'synthetic-stable-hash',account_id:{iban:'SE4280000890119146168423'}};
const future=hours=>new Date(Date.now()+hours*3600000).toISOString();
process.env.BANK_COMPANY_AUTHORIZATIONS=JSON.stringify({version:1,bindings:[{companyId:'company-a',storageOwnerId:a.storageOwner,provider:'enablebanking',bankName:'Swedbank',country:'SE',accountKeys:['iban:'+account.account_id.iban],status:'active',origin:'bank',evidenceId:'synthetic-bank-company-account-proof',checkedAt:new Date(Date.now()-60000).toISOString(),validUntil:future(72)}]});
let providerCalls=0,state,sequence=0,connectionId,reusedSession='',onSessionRead,onSessionDelete;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,options={})=>{
 const url=new URL(input);assert.equal(url.origin,'https://api.enablebanking.com');providerCalls++;
 if(url.pathname==='/application')return Response.json({kid:'joined-consent',environment:'SANDBOX',active:true,countries:['SE'],services:['AIS'],redirect_urls:[process.env.APP_ORIGIN+'/api/bank/callback']});
 if(url.pathname==='/aspsps')return Response.json({aspsps:[{name:'Swedbank',country:'SE',psu_types:['business'],maximum_consent_validity:86400}]});
 if(url.pathname==='/auth'){state=JSON.parse(options.body).state;return Response.json({url:'https://auth.enablebanking.com/ais/start?sessionid=synthetic'});}
 if(url.pathname==='/sessions'&&options.method==='POST')return Response.json({session_id:reusedSession||'synthetic-consent-'+(++sequence),accounts:[account],aspsp:{name:'Swedbank',country:'SE'},psu_type:'business',access:{valid_until:future(48),transactions:true}});
 if(url.pathname.startsWith('/sessions/')){
  if(options.method==='DELETE'){await onSessionDelete?.(url.pathname);return new Response(null,{status:204});}
  return Response.json({status:'AUTHORIZED',accounts:[account.uid],accounts_data:[{uid:account.uid,identification_hash:account.identification_hash}],aspsp:{name:'Swedbank',country:'SE'},psu_type:'business',access:{valid_until:future(36),transactions:true},...await onSessionRead?.()});
 }
 if(url.pathname.endsWith('/transactions'))return Response.json({transactions:[]});
 throw Error('Unexpected synthetic bank request');
};
function session(actor,suffix='browser'){
 const value='synthetic-'+actor+'-'+suffix;runtime.controlDb.prepare('INSERT OR REPLACE INTO sessions(id_hash,expires_at,principal) VALUES(?,?,?)').run(digest(value),Date.now()+600000,actor);return 'mg_session='+value;
}
function call(path,{actor='alice',method='GET',body,headers={},browser='browser'}={}){return new Promise((resolve,reject)=>{
 const content=body===undefined?undefined:JSON.stringify(body),req=request(base+path,{method,headers:{Host:'joined-consent.example.test',Cookie:session(actor,browser),...(content?{Origin:process.env.APP_ORIGIN,'Content-Type':'application/json','Content-Length':Buffer.byteLength(content)}:{}),...headers}},res=>{
  const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{let json={};try{json=JSON.parse(Buffer.concat(chunks));}catch{}resolve({status:res.statusCode,json,headers:res.headers});});
 });req.on('error',reject);req.end(content);
});}
const inA=fn=>runtime.runJob(runtime.resolve({actorId:'bob',companyId:'company-a'}),()=>fn(db));
test('new bound-company consent is disabled by default before any provider request',async()=>{
 const old=process.env.MG_SAAS_ONBOARDING_ENABLED,before=providerCalls;delete process.env.MG_SAAS_ONBOARDING_ENABLED;
 try{const result=await call('/api/bank/connect',{actor:'bob',method:'POST',body:{}});assert.equal(result.status,503);assert.equal(providerCalls,before);}
 finally{process.env.MG_SAAS_ONBOARDING_ENABLED=old;}
});
after(async()=>{globalThis.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));db.close();rmSync(directory,{recursive:true,force:true});});

test('current company accessor follows concurrent runtime scopes through awaits',async()=>{
 assert.equal(typeof runtimeModule.currentCompanyContext,'function');assert.equal(runtimeModule.currentCompanyContext(),null);
 await Promise.all([a,runtime.resolve({actorId:'ben'})].map(context=>runtime.runJob(context,async()=>{await Promise.resolve();assert.equal(runtimeModule.currentCompanyContext().companyId,context.companyId);assert.equal(runtimeModule.currentCompanyContext().actorId,context.actorId);})));
 assert.equal(runtimeModule.currentCompanyContext(),null);
});
test('joined status resolves the canonical company and permits read roles without maintenance writes',async()=>{
 inA(db=>db.prepare('INSERT INTO bank_states(state_hash,expires_at,session_hash,owner,flow_id) VALUES(?,0,?,?,?)').run('expired-synthetic','missing-session',a.storageOwner,'read-only-flow'));
 const before=inA(db=>db.prepare('SELECT * FROM bank_states').all()),calls=providerCalls;
 for(const actor of ['alice','bob','accountant','viewer']){
  const result=await call('/api/bank/status',{actor});assert.equal(result.status,200,JSON.stringify(result.json));assert.equal(result.json.company.id,'company-a');
  assert.equal(result.json.company.canManageBank,['alice','bob'].includes(actor));assert.equal(result.json.consentFlow.status,'expired');
 }
 assert.deepEqual(inA(db=>db.prepare('SELECT * FROM bank_states').all()),before);assert.equal(providerCalls,calls);
});
test('joined connect retains both consent provenance and complete foundation callback authority',async()=>{
 const started=await call('/api/bank/connect',{method:'POST',body:{requiredScopes:['accounts:read','transactions:read']}});assert.equal(started.status,200,JSON.stringify(started.json));assert.equal(started.json.companyId,'company-a');
 const row=inA(db=>db.prepare('SELECT * FROM bank_states WHERE state_hash=?').get(digest(state))),pin=JSON.parse(row.company_context_json),consent=JSON.parse(row.context_json);
 assert.equal(pin.context.companyId,'company-a');assert.equal(pin.context.storageOwner,a.storageOwner);assert.equal(pin.context.actorId,'alice');assert.equal(pin.context.membershipVersion,1);
 assert.equal(consent.companyId,'company-a');assert.equal(consent.actorId,'alice');assert.equal(consent.membershipVersion,1);assert.equal(consent.contextVersion,1);assert.equal(consent.companyVersion,1);
 const result=await call('/api/bank/callback?state='+state+'&code=synthetic-once');assert.equal(result.status,302,JSON.stringify(result.json));
 assert.match(result.headers.location,/select_account/);connectionId=inA(db=>db.prepare('SELECT id FROM bank_connections').get().id);
 assert.equal((await call('/api/bank/callback?state='+state+'&code=synthetic-once')).status,403);
});
test('another current administrator can select and sync the retained company consent',async()=>{
 assert.ok(connectionId,'the preceding real callback must persist a connection');
 const selected=await call('/api/bank/accounts',{actor:'bob',method:'POST',body:{connection_id:connectionId,account_uid:account.uid}});assert.equal(selected.status,200,JSON.stringify(selected.json));assert.equal(selected.json.initial_sync_error,undefined);
 const sync=await call('/api/bank/sync',{actor:'bob',method:'POST',body:{connection_id:connectionId}});assert.equal(sync.status,200,JSON.stringify(sync.json));
 for(const actor of ['bob','accountant','viewer']){
  const result=await call('/api/bank/status',{actor}),connection=result.json.connections.find(c=>c.id===connectionId);assert.equal(result.status,200);assert.equal(connection.status,'connected');assert.equal(connection.consent.actorId,'alice');assert.equal(connection.consent.corporateAuthorization.actorId,'alice');assert.equal(connection.accounts[0].uid,account.uid);
 }
 assert.equal(inA(db=>db.prepare('SELECT count(*) n FROM allocations').get().n),0);
});
test('read-only company roles cannot manage consent or query another company selector',async()=>{
 const calls=providerCalls;
 for(const actor of ['accountant','viewer'])for(const [path,method,body]of [['connect','POST',{}],['accounts','POST',{connection_id:connectionId,account_uid:account.uid}],['sync','POST',{connection_id:connectionId}],['connections','DELETE',{id:connectionId}]])assert.equal((await call('/api/bank/'+path,{actor,method,body})).status,403);
 assert.equal((await call('/api/bank/status?companyId=company-b&companyContextVersion=1',{actor:'viewer'})).status,403);assert.equal(providerCalls,calls);
});
test('removing the initiator preserves company consent provenance for remaining authorized members',async()=>{
 runtime.setMembership({companyId:'company-a',actorId:'alice',role:'owner',status:'revoked'});
 const status=await call('/api/bank/status',{actor:'viewer'});assert.equal(status.status,200);assert.equal(status.json.connections[0].status,'connected');assert.equal(status.json.connections[0].consent.actorId,'alice');
 const sync=await call('/api/bank/sync',{actor:'bob',method:'POST',body:{connection_id:connectionId}});assert.equal(sync.status,200,JSON.stringify(sync.json));
 runtime.setMembership({companyId:'company-a',actorId:'alice',role:'owner',status:'active'});
});
test('a retained consent cannot use a different application credential generation',async()=>{
 const applicationId=process.env.ENABLE_BANKING_APPLICATION_ID,calls=providerCalls,before=inA(db=>db.prepare('SELECT * FROM bank_connections WHERE id=?').get(connectionId));
 process.env.ENABLE_BANKING_APPLICATION_ID='different-synthetic-application';
 try{
  const result=await call('/api/bank/sync',{actor:'bob',method:'POST',body:{connection_id:connectionId}});assert.equal(result.status,409,JSON.stringify(result.json));assert.equal(result.json.code,'CONSENT_APPLICATION_CHANGED');assert.equal(providerCalls,calls);
  assert.deepEqual(inA(db=>db.prepare('SELECT * FROM bank_connections WHERE id=?').get(connectionId)),before);
 }finally{process.env.ENABLE_BANKING_APPLICATION_ID=applicationId;}
});
test('a provider session already retained by company A cannot be attached to company B',async()=>{
 const config=process.env.BANK_COMPANY_AUTHORIZATIONS,registry=JSON.parse(config),b=runtime.resolve({actorId:'ben'});
 registry.bindings.push({...registry.bindings[0],companyId:'company-b',storageOwnerId:b.storageOwner});process.env.BANK_COMPANY_AUTHORIZATIONS=JSON.stringify(registry);
 reusedSession=inA(db=>decryptObject(db.prepare('SELECT encrypted_session FROM bank_connections WHERE id=?').get(connectionId).encrypted_session).session_id);
 try{
  assert.equal((await call('/api/bank/connect',{actor:'ben',method:'POST',body:{}})).status,200);
  const result=await call('/api/bank/callback?state='+state+'&code=synthetic-alias',{actor:'ben'});assert.equal(result.status,502,JSON.stringify(result.json));assert.equal(result.json.code,'BANK_SESSION_REUSED');
  assert.equal(runtime.run(b,()=>db.prepare('SELECT count(*) n FROM bank_connections').get().n),0);
 }finally{process.env.BANK_COMPANY_AUTHORIZATIONS=config;reusedSession='';}
});
test('failed company callback never deletes an unowned session accepted by another company after its absence check',async t=>{
 const config=process.env.BANK_COMPANY_AUTHORIZATIONS,registry=JSON.parse(config),b=runtime.resolve({actorId:'ben'}),shared='synthetic-cleanup-race-session',deletions=[];
 registry.bindings.push({...registry.bindings[0],companyId:'company-b',storageOwnerId:b.storageOwner});process.env.BANK_COMPANY_AUTHORIZATIONS=JSON.stringify(registry);
 reusedSession=shared;let accepted,aChecks=0;
 const lookup=runtime.retainedBankSessionInUse.bind(runtime);
 t.mock.method(runtime,'retainedBankSessionInUse',sessionId=>{
  const result=lookup(sessionId);
  // The old cleanup's second check sees no retained S. Start B at that exact
  // gap; its real callback commits before the simulated DELETE takes effect.
  if(runtimeModule.currentCompanyContext()?.companyId==='company-a'&&sessionId===shared&&++aChecks===2&&!result)accepted=call('/api/bank/callback?state='+bState+'&code=synthetic-other-company',{actor:'ben'});
  return result;
 });
 let aState,bState;
 onSessionRead=()=>runtimeModule.currentCompanyContext()?.companyId==='company-a'?{accounts:['wrong-synthetic-account']}:{};
 onSessionDelete=async path=>{assert.ok(accepted,'the other company starts after the absence check');assert.equal((await accepted).status,302);deletions.push(path);};
 try{
  assert.equal((await call('/api/bank/connect',{method:'POST',body:{}})).status,200);aState=state;
  assert.equal((await call('/api/bank/connect',{actor:'ben',method:'POST',body:{}})).status,200);bState=state;
  const failed=await call('/api/bank/callback?state='+aState+'&code=synthetic-invalid-accounts');assert.equal(failed.status,409);assert.equal(failed.json.code,'BANK_ACCOUNT_SCOPE_INVALID');
  // With safe cleanup B can simply finish after A's failure: no absence scan
  // or network DELETE is needed to establish the failed attempt's ownership.
  accepted??=call('/api/bank/callback?state='+bState+'&code=synthetic-other-company',{actor:'ben'});assert.equal((await accepted).status,302);
  assert.equal(runtime.run(b,()=>decryptObject(db.prepare('SELECT encrypted_session FROM bank_connections').get().encrypted_session).session_id),shared);
  assert.deepEqual(deletions,[]);
  const attempt=inA(db=>db.prepare('SELECT status,terminal_reason FROM bank_states WHERE state_hash=?').get(digest(aState)));assert.equal(attempt.status,'failed');assert.equal(attempt.terminal_reason,'BANK_ACCOUNT_SCOPE_INVALID');
  const review=inA(db=>db.prepare("SELECT details FROM audit_events WHERE action='bank_consent_cleanup_review' ORDER BY rowid DESC LIMIT 1").get());
  assert.equal(JSON.parse(review.details).provider_session_revoked,false);assert.equal(JSON.parse(review.details).recovery,'provider_expiry_or_manual_review');assert.equal(review.details.includes(shared),false);
 }finally{process.env.BANK_COMPANY_AUTHORIZATIONS=config;reusedSession='';onSessionRead=undefined;onSessionDelete=undefined;}
});
