import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {companyFixture} from './helpers/company-storage-fixture.mjs';
import {assertScopeCurrent,changeCompanyMembership} from '../lib/company-storage.js';
import {BankProviderError} from '../lib/banking/bank-data-provider.js';
import {OpenPaymentsProvider} from '../lib/banking/openpayments-provider.js';
import {createCompanyProviderManager} from '../lib/banking/company-provider-manager.js';
import {codec,CONFIG,CONTEXT,CONSENT_ID,AUTH_ID,fixtureTransport,json} from './helpers/openpayments-fixture.mjs';

const target=new URL('../lib/banking/company-provider-repository.js',import.meta.url);
const implementation=existsSync(target)?await import(target):null;
const hash=value=>createHash('sha256').update(value).digest('hex');
const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const local=path=>new URL('../lib/'+path,import.meta.url).href;
async function fixture(t){
 assert.equal(typeof implementation?.createCompanyProviderRepository,'function','the actual scoped provider repository must be implemented');
 const f=companyFixture(t);await f.create('company-a');await f.create('company-b','actor-b');f.a=await f.scope();f.b=await f.scope('actor-b','company-b');
 f.for=async scope=>{
  const database=f.database(scope),key='__provider_repository_'+crypto.randomUUID().replaceAll('-','');globalThis[key]={database,context:scope.context};t.after(()=>delete globalThis[key]);
  const server=data(`const f=globalThis[${JSON.stringify(key)}];export const db=()=>f.database;export const identity=async()=>({userId:f.context.storageOwner,actorId:f.context.actorId});export const currentCompanyContext=()=>f.context;`);
  let source=ts.transpileModule(readFileSync(new URL('../lib/banking/store.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const imports={'cloudflare:workers':data('export const env={};'),'@/lib/server':server,'./security':local('banking/security.ts'),'./runtime-config':data('export const runtimeBankConfig=()=>null;export const runtimeBankStatus=()=>({});'),'../bank-consent-policy.js':local('bank-consent-policy.js'),'../bank-company-authority.js':local('bank-company-authority.js'),'./transactions':data('export function stableAccountKey(){throw Error("Unrelated account operation");}')};
  for(const [name,url]of Object.entries(imports))for(const quote of ['"',"'"])source=source.replaceAll(quote+name+quote,JSON.stringify(url));
  const store=await import(data(source));
  const repo=implementation.createCompanyProviderRepository({database,codec,currentContext:()=>scope.context,assertCurrent:async(context,action)=>assertScopeCurrent(f.raw,scope,action)});
  return {scope,database,repo,lock:run=>store.withBankLock(scope.owner,run)};
 };
 f.A=await f.for(f.a);f.B=await f.for(f.b);
 f.row=(scope,id='connection-a',fingerprint='')=>{const at=new Date().toISOString();return {id,owner:scope.owner,company_id:scope.context.companyId,provider_kind:'open_payments',environment:'SANDBOX',app_generation:'g1',bank_id:'OPBKSE21',bank_name:'Synthetic bank',status:'creating',encrypted_state:'synthetic encrypted connection bytes',selected_accounts:'[]',valid_until:new Date(Date.now()+86400000).toISOString(),revision:1,last_synced_at:'',last_error:'',grant_fingerprint:fingerprint,request_key_hash:hash('request:'+id),created_at:at,updated_at:at};};
 f.flow=async(scope,row,id='flow-a',status='creating')=>{
  const flow={id,owner:scope.owner,companyId:scope.context.companyId,connectionId:row.id,provider:'open_payments',environment:row.environment,appGeneration:row.app_generation,initiatingContext:scope.context,browserHash:hash('browser:'+id),requestKeyHash:hash('flow-request:'+id),requestFingerprint:hash('fingerprint:'+id),stateHash:hash('state:'+id),encryptedPayload:'',expiresAt:new Date(Date.now()+300000).toISOString(),status};
  flow.encryptedPayload=await codec.seal(flow.owner,'provider-manager-flow-v1:'+JSON.stringify([flow.companyId,flow.connectionId,flow.id,flow.provider,flow.environment,flow.appGeneration]),{version:1,connectionId:row.id,flowId:id,providerFlowId:'inner-'+id});return flow;
 };
 f.pending=async()=>{
  const row=f.row(f.a),flow=await f.flow(f.a,row);
  await f.A.lock(async lease=>{await f.A.repo.commit(f.a.context,{expectedRevision:null,connection:row,flow},lease);row.revision++;row.status='authorization_required';flow.status='method_required';await f.A.repo.commit(f.a.context,{expectedRevision:1,connection:row,flow,expectedFlowStatus:'creating'},lease);row.revision++;row.status='pending_authorization';flow.status='pending';await f.A.repo.commit(f.a.context,{expectedRevision:2,connection:row,flow,expectedFlowStatus:'method_required'},lease);});
  return {row,flow,expected:{id:flow.id,expectedPayload:flow.encryptedPayload,stateHash:flow.stateHash,browserHash:flow.browserHash,providerFlowId:'inner-'+flow.id,expectedStatus:'pending'}};
 };
 return f;
}

test('actual scoped SQL persists encrypted full flow DTO and denies foreign IDs and forged contexts',async t=>{
 const f=await fixture(t),row=f.row(f.a),flow=await f.flow(f.a,row);
 await f.A.lock(lease=>f.A.repo.commit(f.a.context,{expectedRevision:null,connection:row,flow},lease));
 assert.deepEqual(await f.A.repo.getConnection(f.a.context,row.id),row);assert.deepEqual(await f.A.repo.getFlow(f.a.context,flow.id),flow);
 assert.equal(await f.B.repo.getConnection(f.b.context,row.id),null);assert.equal(await f.B.repo.getFlow(f.b.context,flow.id),null);
 await assert.rejects(f.A.repo.getConnection({...f.a.context,role:'admin'},row.id),error=>error instanceof BankProviderError);
 const retained=f.sql.prepare('SELECT provider_payload,context_json,cookie_hash FROM bank_auth_flows').get();assert.ok(!retained.provider_payload.includes(flow.requestFingerprint));assert.equal(retained.context_json,'');assert.equal(retained.cookie_hash,flow.browserHash);
});
test('current company readers can read without impersonating the initiating actor but cannot write credentials',async t=>{
 const f=await fixture(t),row=f.row(f.a);await f.A.lock(lease=>f.A.repo.commit(f.a.context,{expectedRevision:null,connection:row},lease));
 await changeCompanyMembership(f.raw,f.a,{actorId:'viewer',role:'viewer',status:'active'});const view=await f.for(await f.scope('viewer'));
 assert.equal((await view.repo.getConnection(view.scope.context,row.id)).id,row.id);
 await assert.rejects(f.A.lock(lease=>view.repo.commit(view.scope.context,{expectedRevision:1,connection:{...row,revision:2}},lease)),error=>error instanceof BankProviderError);
});
test('concurrent CAS admits one writer and failed flow CAS rolls back the new grant claim and connection together',async t=>{
 const f=await fixture(t),{row,flow}=await f.pending();
 await f.A.lock(async lease=>{
  const attempts=await Promise.allSettled(['first','second'].map(marker=>f.A.repo.commit(f.a.context,{expectedRevision:row.revision,connection:{...row,revision:row.revision+1,last_error:marker}},lease)));
  assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);
  const before=f.sql.prepare('SELECT * FROM bank_provider_connections').all(),current=await f.A.repo.getConnection(f.a.context,row.id);
  await assert.rejects(f.A.repo.commit(f.a.context,{expectedRevision:current.revision,connection:{...current,revision:current.revision+1,grant_fingerprint:'a'.repeat(64)},flow:{...flow,status:'pending'},expectedFlowStatus:'creating'},lease));
  assert.deepEqual(f.sql.prepare('SELECT * FROM bank_provider_connections').all(),before);assert.equal(f.sql.prepare('SELECT count(*) n FROM bank_provider_grant_claims').get().n,0);
 });
});
test('foreign fingerprint collisions are denied while historical own claims remain immutable across replacement',async t=>{
 const f=await fixture(t),row=f.row(f.a,'connection-a','a'.repeat(64));
 await f.A.lock(async lease=>{await f.A.repo.commit(f.a.context,{expectedRevision:null,connection:row},lease);await f.A.repo.commit(f.a.context,{expectedRevision:1,connection:{...row,revision:2,grant_fingerprint:'b'.repeat(64)}},lease);});
 assert.equal(f.sql.prepare('SELECT count(*) n FROM bank_provider_grant_claims').get().n,2);
 await assert.rejects(f.B.lock(lease=>f.B.repo.commit(f.b.context,{expectedRevision:null,connection:f.row(f.b,'connection-b','a'.repeat(64))},lease)),{code:'PROVIDER_GRANT_REUSED'});
 assert.equal(f.sql.prepare('SELECT count(*) n FROM bank_provider_connections').get().n,1);assert.equal(f.sql.prepare('SELECT count(*) n FROM bank_provider_grant_claims').get().n,2);
});
test('revocation during the real D1 write queue prevents row, flow and claim writes',async t=>{
 const f=await fixture(t),row=f.row(f.a,'connection-a','a'.repeat(64)),flow=await f.flow(f.a,row);
 await changeCompanyMembership(f.raw,f.a,{actorId:'backup-owner',role:'owner',status:'active'});
 let denied=false;await f.A.lock(async lease=>{
  f.beforeBatch=statements=>{if(statements.some(statement=>/INSERT INTO bank_provider_grant_claims/i.test(statement.query))){f.beforeBatch=null;f.sql.prepare("UPDATE company_memberships SET membership_version=membership_version+1,status='revoked' WHERE actor_id='actor-a'").run();}};
  await assert.rejects(f.A.repo.commit(f.a.context,{expectedRevision:null,connection:row,flow},lease),error=>{denied=error instanceof BankProviderError;return denied;});
 }).catch(error=>assert.match(error.message,/COMPANY_/));assert.equal(denied,true);
 for(const table of ['bank_provider_connections','bank_provider_grant_claims','bank_auth_flows'])assert.equal(f.sql.prepare('SELECT count(*) n FROM '+table).get().n,0);
});
test('a SQL failure after a grant insert rolls back the whole real transaction',async t=>{
 const f=await fixture(t),row=f.row(f.a,'connection-a','a'.repeat(64)),flow=await f.flow(f.a,row);
 f.sql.exec("CREATE TRIGGER synthetic_provider_flow_failure BEFORE INSERT ON bank_auth_flows BEGIN SELECT RAISE(ABORT,'synthetic private storage error'); END");
 await assert.rejects(f.A.lock(lease=>f.A.repo.commit(f.a.context,{expectedRevision:null,connection:row,flow},lease)),error=>error instanceof BankProviderError&&!error.message.includes('synthetic private'));
 for(const table of ['bank_provider_connections','bank_provider_grant_claims','bank_auth_flows'])assert.equal(f.sql.prepare('SELECT count(*) n FROM '+table).get().n,0);
});
test('a connected commit whose consent expires in the real SQL queue rolls back new claim flow and selection together',async t=>{
 const f=await fixture(t),row=f.row(f.a);await f.A.lock(lease=>f.A.repo.commit(f.a.context,{expectedRevision:null,connection:row},lease));
 const before=f.sql.prepare('SELECT * FROM bank_provider_connections').all(),flow=await f.flow(f.a,row),next={...row,revision:2,status:'connected',selected_accounts:'["opaque-account"]',grant_fingerprint:'a'.repeat(64)};
 f.beforeBatch=statements=>{if(statements.some(statement=>/INSERT INTO bank_provider_grant_claims/.test(statement.query))){f.beforeBatch=null;const executionNow=Date.now()+2*86400000;f.sql.function('julianday',value=>((value==='now'?executionNow:Date.parse(value))/86400000)+2440587.5);}};
 await assert.rejects(f.A.lock(lease=>f.A.repo.commit(f.a.context,{expectedRevision:1,connection:next,flow},lease)),error=>error instanceof BankProviderError);
 assert.deepEqual(f.sql.prepare('SELECT * FROM bank_provider_connections').all(),before);assert.equal(f.sql.prepare('SELECT count(*) n FROM bank_provider_grant_claims').get().n,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM bank_auth_flows').get().n,0);
});
test('one-use consumption compares encrypted state, browser, full original actor and expiry',async t=>{
 const f=await fixture(t),{flow,expected}=await f.pending();
 await changeCompanyMembership(f.raw,f.a,{actorId:'other-admin',role:'admin',status:'active'});const admin=await f.for(await f.scope('other-admin'));
 await admin.lock(async lease=>assert.equal(await admin.repo.consumeFlow(admin.scope.context,expected,lease),false));
 const expired=implementation.createCompanyProviderRepository({database:f.A.database,codec,currentContext:()=>f.a.context,assertCurrent:(_ctx,action)=>assertScopeCurrent(f.raw,f.a,action),now:()=>Date.now()+600000});
 await f.A.lock(async lease=>assert.equal(await expired.consumeFlow(f.a.context,expected,lease),false));
 await f.A.lock(async lease=>{
  for(const patch of [{stateHash:'b'.repeat(64)},{browserHash:'b'.repeat(64)},{expectedPayload:'other opaque handle'},{providerFlowId:'other-flow'}])assert.equal(await f.A.repo.consumeFlow(f.a.context,{...expected,...patch},lease),false);
  const results=await Promise.all([f.A.repo.consumeFlow(f.a.context,expected,lease),f.A.repo.consumeFlow(f.a.context,expected,lease)]);assert.equal(results.filter(Boolean).length,1);
  assert.equal(await f.A.repo.consumeFlow(f.a.context,expected,lease),false);
 });
 assert.equal((await f.A.repo.getFlow(f.a.context,flow.id)).status,'used');
});
test('lost commit and consumption responses read exact durable receipts without accepting another caller consumption',async t=>{
 const f=await fixture(t),row=f.row(f.a),flow=await f.flow(f.a,row);
 await f.A.lock(async lease=>{
  let lose=true;const uncertain={...lease,write:async statements=>{const result=await lease.write(statements);if(lose){lose=false;throw Error('lost committed response');}return result;}};
  await f.A.repo.commit(f.a.context,{expectedRevision:null,connection:row,flow},uncertain);
  assert.equal((await f.A.repo.getConnection(f.a.context,row.id)).revision,1);
 });
 const second=await fixture(t),{expected}=await second.pending();
 await second.A.lock(async lease=>{
  let lose=true;const uncertain={...lease,write:async statements=>{const result=await lease.write(statements);if(lose){lose=false;throw Error('lost consume response');}return result;}};
  assert.equal(await second.A.repo.consumeFlow(second.a.context,expected,uncertain),true);assert.equal(await second.A.repo.consumeFlow(second.a.context,expected,lease),false);
 });
});
test('revocation while decrypting a retained flow prevents publishing the private DTO',async t=>{
 const f=await fixture(t),{flow}=await f.pending();
 await changeCompanyMembership(f.raw,f.a,{actorId:'backup-owner',role:'owner',status:'active'});
 const lateCodec={...codec,async unseal(...args){const result=await codec.unseal(...args);f.sql.prepare("UPDATE company_memberships SET status='revoked',membership_version=membership_version+1 WHERE actor_id='actor-a'").run();return result;}};
 const repo=implementation.createCompanyProviderRepository({database:f.A.database,codec:lateCodec,currentContext:()=>f.a.context,assertCurrent:(_context,action)=>assertScopeCurrent(f.raw,f.a,action)});
 await assert.rejects(repo.getFlow(f.a.context,flow.id),error=>error instanceof BankProviderError);
});
test('a queued SQL flow CAS failure aborts an earlier claim instead of merely updating zero rows',async t=>{
 const f=await fixture(t),{row,flow}=await f.pending(),before=f.sql.prepare('SELECT * FROM bank_provider_connections').all();
 await f.A.lock(async lease=>{
  f.beforeBatch=async statements=>{if(statements.some(item=>/UPDATE bank_auth_flows SET/.test(item.query))){f.beforeBatch=null;await f.A.database.prepare("UPDATE bank_auth_flows SET status='cancelled' WHERE owner=? AND provider_flow_id=?").bind(f.a.owner,flow.id).run();}};
  await assert.rejects(f.A.repo.commit(f.a.context,{expectedRevision:row.revision,connection:{...row,revision:row.revision+1,grant_fingerprint:'a'.repeat(64)},flow,expectedFlowStatus:'pending'},lease),{code:'PROVIDER_REVISION_CONFLICT'});
 });
 assert.deepEqual(f.sql.prepare('SELECT * FROM bank_provider_connections').all(),before);assert.equal(f.sql.prepare('SELECT count(*) n FROM bank_provider_grant_claims').get().n,0);assert.equal(f.sql.prepare('SELECT status FROM bank_auth_flows').get().status,'cancelled');
});
test('the real provider manager completes a synthetic consent through the actual Sites repository and one-use flow table',async t=>{
 const f=await fixture(t),browser={cookie:'synthetic-owned-cookie',session:'synthetic-owned-session'};
 const consentDate=new Date(Date.now()+30*86400000).toISOString().slice(0,10),registrationUntil=new Date(Date.now()+40*86400000).toISOString();
 const fixtureProvider=fixtureTransport({[`GET /psd2/consent/v1/consents/${CONSENT_ID}`]:()=>json({consentStatus:'valid',validUntil:consentDate,access:{}}),[`PUT /psd2/consent/v1/consents/${CONSENT_ID}/authorisations/${AUTH_ID}`]:()=>json({scaStatus:'started',_links:{scaOAuth:{href:'https://oauth.sandbox.openbankingplatform.com/connect/authorize?'+new URLSearchParams({client_id:'[CLIENT_ID]',scope:'accountinformation corporate',response_type:'code',redirect_uri:'[TPP_REDIRECT_URI]',state:'[TPP_STATE]',acr_values:`idp:OPBKSE21 consentId:${CONSENT_ID} ConsentAuthorisationId:${AUTH_ID}`})}}},200,{'aspsp-sca-approach':'REDIRECT'})});
 const manager=createCompanyProviderManager({provider:new OpenPaymentsProvider(CONFIG,{transport:fixtureProvider.transport}),repository:f.A.repo,codec,currentContext:()=>f.a.context,assertCurrent:(_ctx,action)=>assertScopeCurrent(f.raw,f.a,action),registration:()=>({verified:true,companyId:f.a.context.companyId,owner:f.a.owner,evidenceId:'synthetic-registration',environment:'SANDBOX',appGeneration:'g1',validUntil:registrationUntil,corporateId:CONTEXT.corporateId,psuId:CONTEXT.psuId,psu:CONTEXT.psu,redirectUri:CONFIG.redirectUris[0]}),withBankLock:(_owner,run)=>f.A.lock(run),onboardingEnabled:true});
 const started=await manager.start({bankId:'OPBKSE21',validUntil:consentDate,requestKey:'real-synthetic-manager-request',browser});
 const chosen=await manager.chooseMethod({connectionId:started.id,revision:started.revision,methodId:'mbid',browser});let providerUrl;await manager.withRedirect({flowId:chosen.flowId,browser},url=>{providerUrl=url;});
 const result=await manager.callback({flowId:chosen.flowId,browser,parameters:new URLSearchParams({code:'synthetic-code',scope:'accountinformation corporate',state:new URL(providerUrl).searchParams.get('state')})});
 const connected=await manager.selectAccounts({connectionId:result.id,revision:result.revision,accountIds:[result.accounts[0].id]});assert.equal(connected.status,'connected');
 assert.equal(f.sql.prepare('SELECT status FROM bank_auth_flows').get().status,'used');assert.equal(f.sql.prepare('SELECT count(*) n FROM bank_provider_grant_claims').get().n,1);assert.equal(f.sql.prepare('SELECT payload FROM workspaces WHERE owner=?').get(f.a.owner).payload.includes('"allocations":[]'),true);
});
