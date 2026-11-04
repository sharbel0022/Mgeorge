import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/db.js';
import {createCompanyRuntime} from '../src/company-runtime.js';
import {createIntegrationJobs} from '../src/integration-jobs.js';
import {encryptObject,decryptObject,digest} from '../src/security.js';
import {BankProviderError} from '../sites/lib/banking/bank-data-provider.js';

const target=new URL('../src/banking/company-provider-repository.js',import.meta.url),implementation=existsSync(target)?await import(target):null;
process.env.BANK_DATA_KEY='a'.repeat(64);delete process.env.ENCRYPTION_KEY;
const codec={async seal(owner,purpose,value){return encryptObject({owner,purpose,value});},async unseal(owner,purpose,bytes){const value=decryptObject(bytes);if(value.owner!==owner||value.purpose!==purpose)throw Error('wrong owner/purpose');return value.value;}};
function fixture(t){
 assert.equal(typeof implementation?.createNodeCompanyProviderRepository,'function','the actual Node provider repository must be implemented');
 const directory=mkdtempSync(join(tmpdir(),'mg-provider-repository-')),path=join(directory,'legacy.sqlite'),controlDb=openDatabase(path),runtime=createCompanyRuntime({controlDb,legacyDatabasePath:path});
 t.after(()=>{runtime.close();controlDb.close();rmSync(directory,{recursive:true,force:true});});
 const verification={status:'verified',evidenceId:'synthetic-owner-proof',verifiedBy:'operator'};
 const a=runtime.provisionCompany({companyId:'company-a',name:'Synthetic A',actorId:'alice',verification}),b=runtime.provisionCompany({companyId:'company-b',name:'Synthetic B',actorId:'ben',verification});
 const f={runtime,controlDb,a,b,db:runtime.db,session:digest('actual synthetic application session')};
 f.as=(context,fn,{session=true,repositoryCodec=codec}={})=>runtime.run(context,async()=>{
  const repo=implementation.createNodeCompanyProviderRepository({db:f.db,codec:repositoryCodec,currentContext:()=>runtime.current(),assertCurrent:(_context,action)=>runtime.assert(action),retainedProviderGrantInUse:(fp,id)=>{f.onGrantCheck?.();return runtime.retainedProviderGrantInUse(fp,id);},...(session?{sessionHash:()=>f.session}:{})});
  return fn(repo);
 });
 f.lock=async(fn)=>{const lease=createIntegrationJobs(f.db).claim('provider-repository',{recordAttempt:false});try{return await fn(lease);}finally{lease.release();}};
 f.row=(context,id='connection-a',fingerprint='')=>{const at=new Date().toISOString();return{id,owner:context.storageOwner,company_id:context.companyId,provider_kind:'open_payments',environment:'SANDBOX',app_generation:'g1',bank_id:'OPBKSE21',bank_name:'Synthetic bank',status:'creating',encrypted_state:'synthetic private encrypted connection',selected_accounts:'[]',valid_until:new Date(Date.now()+86400000).toISOString(),revision:1,last_synced_at:'',last_error:'',request_key_hash:digest('request-'+id),created_at:at,updated_at:at,grant_fingerprint:fingerprint};};
 f.flow=async(context,row,id='flow-a',status='creating')=>{
  const flow={id,owner:context.storageOwner,companyId:context.companyId,connectionId:row.id,provider:'open_payments',environment:'SANDBOX',appGeneration:'g1',initiatingContext:context,browserHash:digest('combined cookie and browser session'),requestKeyHash:digest('flow-request-'+id),requestFingerprint:digest('fingerprint-'+id),stateHash:digest('state-'+id),encryptedPayload:'',expiresAt:new Date(Date.now()+300000).toISOString(),status};
  flow.encryptedPayload=await codec.seal(flow.owner,'provider-manager-flow-v1:'+JSON.stringify([flow.companyId,row.id,id,flow.provider,flow.environment,flow.appGeneration]),{version:1,connectionId:row.id,flowId:id,providerFlowId:'inner-'+id});return flow;
 };
 f.pending=async(repo)=>{const row=f.row(a),flow=await f.flow(a,row);await f.lock(async lease=>{await repo.commit(a,{expectedRevision:null,connection:row,flow},lease);row.revision++;flow.status='method_required';await repo.commit(a,{expectedRevision:1,connection:row,flow,expectedFlowStatus:'creating'},lease);row.revision++;flow.status='pending';await repo.commit(a,{expectedRevision:2,connection:row,flow,expectedFlowStatus:'method_required'},lease);});return {row,flow,expected:{id:flow.id,expectedPayload:flow.encryptedPayload,stateHash:flow.stateHash,browserHash:flow.browserHash,providerFlowId:'inner-'+flow.id,expectedStatus:'pending'}};};
 return f;
}
test('runtime-scoped Node storage separates the actual app session hash and original full company OAuth pin',async t=>{
 const f=fixture(t),row=f.row(f.a),flow=await f.flow(f.a,row);
 await f.as(f.a,async repo=>{await f.lock(lease=>repo.commit(f.a,{expectedRevision:null,connection:row,flow},lease));const retained=f.db.prepare('SELECT * FROM bank_states').get();assert.equal(retained.session_hash,f.session);assert.notEqual(retained.session_hash,flow.browserHash);assert.equal(retained.context_json,'');assert.deepEqual(JSON.parse(retained.company_context_json),{version:'company-oauth-context-v1',actorId:f.a.actorId,storageOwner:f.a.storageOwner,context:f.a});assert.deepEqual(await repo.getFlow(f.a,flow.id),flow);});
 await f.as(f.b,async repo=>{assert.equal(await repo.getConnection(f.b,row.id),null);assert.equal(await repo.getFlow(f.b,flow.id),null);await assert.rejects(repo.getConnection(f.a,row.id),error=>error instanceof BankProviderError);});
});
test('Node flow insert refuses a missing real session accessor while stored connection reads remain available',async t=>{
 const f=fixture(t),row=f.row(f.a),flow=await f.flow(f.a,row);
 await f.as(f.a,async repo=>{await f.lock(lease=>repo.commit(f.a,{expectedRevision:null,connection:row},lease));});
 await f.as(f.a,async repo=>{assert.equal((await repo.getConnection(f.a,row.id)).id,row.id);await assert.rejects(f.lock(lease=>repo.commit(f.a,{expectedRevision:1,connection:{...row,revision:2},flow},lease)),{code:'PROVIDER_FLOW_SESSION_REQUIRED'});assert.equal(f.db.prepare('SELECT count(*) n FROM bank_states').get().n,0);},{session:false});
});
test('ordinary Node commit cannot fabricate an already-consumed flow',async t=>{
 const f=fixture(t),row=f.row(f.a),flow=await f.flow(f.a,row,'forged-used-flow','used');
 await f.as(f.a,async repo=>{await assert.rejects(f.lock(lease=>repo.commit(f.a,{expectedRevision:null,connection:row,flow},lease)),{code:'PROVIDER_REVISION_CONFLICT'});assert.equal(f.db.prepare('SELECT count(*) n FROM bank_states').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM bank_provider_connections').get().n,0);});
});
test('Node historical grant exclusion executes inside its real catalogue/tenant writer and spans companies',async t=>{
 const f=fixture(t),row=f.row(f.a,'connection-a','a'.repeat(64));
 let catalogueLocked=false;f.onGrantCheck=()=>{try{f.controlDb.exec('BEGIN IMMEDIATE');f.controlDb.exec('ROLLBACK');}catch(error){catalogueLocked=/transaction/i.test(error.message);}};
 await f.as(f.a,repo=>f.lock(async lease=>{await repo.commit(f.a,{expectedRevision:null,connection:row},lease);await repo.commit(f.a,{expectedRevision:1,connection:{...row,revision:2,grant_fingerprint:'b'.repeat(64)}},lease);assert.equal(f.db.prepare('SELECT count(*) n FROM bank_provider_grant_claims').get().n,2);}));
 await f.as(f.b,async repo=>{await assert.rejects(f.lock(lease=>repo.commit(f.b,{expectedRevision:null,connection:f.row(f.b,'connection-b','a'.repeat(64))},lease)),{code:'PROVIDER_GRANT_REUSED'});assert.equal(f.db.prepare('SELECT count(*) n FROM bank_provider_connections').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM bank_provider_grant_claims').get().n,0);});
 assert.equal(catalogueLocked,true,'global historical check must execute under the catalogue writer transaction');
});
test('Node CAS and injected SQL failure roll back both immutable claim and flow creation',async t=>{
 const f=fixture(t),row=f.row(f.a,'connection-a','a'.repeat(64)),flow=await f.flow(f.a,row);
 await f.as(f.a,async repo=>{
  f.db.exec("CREATE TRIGGER synthetic_flow_failure BEFORE INSERT ON bank_states BEGIN SELECT RAISE(ABORT,'synthetic private failure'); END");
  await assert.rejects(f.lock(lease=>repo.commit(f.a,{expectedRevision:null,connection:row,flow},lease)),error=>error instanceof BankProviderError&&!error.message.includes('synthetic private'));
  for(const table of ['bank_provider_connections','bank_provider_grant_claims','bank_states'])assert.equal(f.db.prepare('SELECT count(*) n FROM '+table).get().n,0);
  f.db.exec('DROP TRIGGER synthetic_flow_failure');await f.lock(async lease=>{await repo.commit(f.a,{expectedRevision:null,connection:row},lease);const results=await Promise.allSettled(['one','two'].map(last_error=>repo.commit(f.a,{expectedRevision:1,connection:{...row,revision:2,last_error}},lease)));assert.equal(results.filter(result=>result.status==='fulfilled').length,1);});
 });
});
test('Node execution-clock consent fence rolls back claims and selection after its synchronous writer waits',async t=>{
 const f=fixture(t),row=f.row(f.a),flow=await f.flow(f.a,row);
 await f.as(f.a,async repo=>{
  f.db.prepare("INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES('synthetic-old-invoice','customer','00599','Synthetic retained customer',62500)").run();
  f.db.prepare("INSERT INTO bank_transactions(id,fingerprint,account,booked_at,amount_cents) VALUES('synthetic-old-deposit','synthetic-retained-deposit','synthetic-account','2026-11-04',62500)").run();
  await f.lock(lease=>repo.commit(f.a,{expectedRevision:null,connection:row},lease));
  const before=f.db.prepare('SELECT * FROM bank_provider_connections').all(),financial=['invoices','bank_transactions','allocations'].map(table=>f.db.prepare('SELECT * FROM '+table).all());
  const next={...row,revision:2,status:'connected',selected_accounts:'["opaque-account"]',grant_fingerprint:'a'.repeat(64),valid_until:new Date(Date.now()+100).toISOString()};let writerWaited=false;
  f.onGrantCheck=()=>{writerWaited=true;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150);};
  await assert.rejects(f.lock(lease=>repo.commit(f.a,{expectedRevision:1,connection:next,flow},lease)),error=>error instanceof BankProviderError);assert.equal(writerWaited,true);
  assert.deepEqual(f.db.prepare('SELECT * FROM bank_provider_connections').all(),before);
  assert.equal(f.db.prepare('SELECT count(*) n FROM bank_provider_grant_claims').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM bank_states').get().n,0);
  assert.deepEqual(['invoices','bank_transactions','allocations'].map(table=>f.db.prepare('SELECT * FROM '+table).all()),financial);
 });
});
test('Node callback consumes exactly once and refuses a different actual request session',async t=>{
 const f=fixture(t);await f.as(f.a,async repo=>{const {expected}=await f.pending(repo),originalSession=f.session;f.session=digest('a different actual login');await f.lock(async lease=>assert.equal(await repo.consumeFlow(f.a,expected,lease),false));f.session=originalSession;await f.lock(async lease=>{const results=await Promise.all([repo.consumeFlow(f.a,expected,lease),repo.consumeFlow(f.a,expected,lease)]);assert.equal(results.filter(Boolean).length,1);assert.equal(await repo.consumeFlow(f.a,expected,lease),false);});assert.equal(f.db.prepare('SELECT consumed FROM bank_states').get().consumed,1);});
});
test('Node lost write response recognizes exact committed state without replaying writes',async t=>{
 const f=fixture(t),row=f.row(f.a),flow=await f.flow(f.a,row);
 await f.as(f.a,repo=>f.lock(async lease=>{let lose=true;const uncertain={...lease,write:work=>{const result=lease.write(work);if(lose){lose=false;throw Error('lost response');}return result;}};await repo.commit(f.a,{expectedRevision:null,connection:row,flow},uncertain);assert.equal(f.db.prepare('SELECT revision FROM bank_provider_connections').get().revision,1);}));
});
test('Node membership revoked during flow encryption cannot leave partial connection or grant data',async t=>{
 const f=fixture(t),row=f.row(f.a,'connection-a','a'.repeat(64)),flow=await f.flow(f.a,row);f.runtime.setMembership({companyId:f.a.companyId,actorId:'backup-owner',role:'owner'});
 const backup=f.runtime.resolve({actorId:'backup-owner',companyId:f.a.companyId});
 const lateCodec={...codec,async seal(...args){const value=await codec.seal(...args);f.controlDb.prepare("UPDATE company_memberships SET status='revoked',membership_version=membership_version+1 WHERE actor_id='alice'").run();return value;}};
 await assert.rejects(f.as(f.a,repo=>f.lock(lease=>repo.commit(f.a,{expectedRevision:null,connection:row,flow},lease)),{repositoryCodec:lateCodec}),error=>error instanceof BankProviderError);
 await f.as(backup,async()=>{for(const table of ['bank_provider_connections','bank_provider_grant_claims','bank_states'])assert.equal(f.db.prepare('SELECT count(*) n FROM '+table).get().n,0);});
});
