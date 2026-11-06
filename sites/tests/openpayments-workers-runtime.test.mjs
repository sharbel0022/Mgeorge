import {sitesTokenCoordinatorUrl} from './helpers/openpayments-coordinator-loader.mjs';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
import {companyFixture} from './helpers/company-storage-fixture.mjs';
import {seal,unseal,randomToken} from '../lib/banking/security.ts';
import {scopedResourceCodec} from '../lib/banking/bank-data-provider.js';
import {fixtureTransport,CONFIG,CONSENT_ID,AUTH_ID,ACCOUNT_ID,TX,json} from './helpers/openpayments-fixture.mjs';
import {workersBindingConfiguration,syntheticWorkersCertificate} from './helpers/openpayments-workers-fixture.mjs';

const directory=mkdtempSync(join(tmpdir(),'mgeorge-workers-runtime-'));
let sequence=0;
after(()=>rmSync(directory,{recursive:true,force:true}));
const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const local=path=>new URL('../lib/'+path,import.meta.url).href;
function compiled(path,imports={}){
 imports={'./openpayments-sites-token-coordinator':sitesTokenCoordinatorUrl,...imports};
 const source=new URL('../lib/'+path,import.meta.url);
 let code=stripTypeScriptTypes(readFileSync(source,'utf8'),{mode:'transform'});
 for(const[from,to]of Object.entries(imports))for(const quote of ['"',"'"])code=code.replaceAll(quote+from+quote,JSON.stringify(to));
 code=code.replace(/(['"])(\.{1,2}\/[^'"]+\.js)\1/g,(_all,_quote,specifier)=>JSON.stringify(new URL(specifier,source).href));
 const filename=join(directory,`${++sequence}.mjs`);writeFileSync(filename,code);return pathToFileURL(filename).href;
}
async function fixture(t,{responses={}}={}){
 const f=companyFixture(t);await f.create('company-a');const scope=await f.scope(),context=scope.context,owner=scope.owner,key=randomToken(),db=f.database(scope);
 const config={...CONFIG,environment:'PRODUCTION',redirectUris:['https://app.example/api/companies/company-a/bank/callback']};
 const registration={companyId:context.companyId,actorId:context.actorId,verified:true,corporateAccessVerified:true,redirectVerified:true,corporateId:'synthetic-company-a',psuId:'synthetic-psu-a',bicFi:'OPBKSE21',bankId:'OPBKSE21',bankName:'Synthetic bank',authenticationMethodId:'mbid',ratePolicy:{verified:true,evidenceId:'synthetic-read-policy',maxRequests:100,windowMs:60000},psu:{ipAddress:'192.0.2.10',userAgent:'Synthetic worker'}};
 const provider=fixtureTransport(responses),binding={async fetch(url,init){assert.equal(this,binding);return provider.transport.request(url,init);}};
 const env={DB:f.raw,BANK_DATA_ENCRYPTION_KEY:key,SAAS_BANK_ENABLED:'true',SAAS_OPENPAYMENTS_CONFIG:JSON.stringify(config),SAAS_OPENPAYMENTS_REGISTRATIONS:JSON.stringify([registration]),SAAS_OPENPAYMENTS_MTLS_BINDING_CONFIG:JSON.stringify(workersBindingConfiguration()),OPENPAYMENTS_MTLS:binding};
 const globalKey='__workers_runtime_'+crypto.randomUUID().replaceAll('-',''),principal={env,user:{userId:context.actorId,displayName:'Synthetic actor'}};
 globalThis[globalKey]=principal;t.after(()=>delete globalThis[globalKey]);
 let plainFetches=0;t.mock.method(globalThis,'fetch',async()=>{plainFetches++;throw Error('Ordinary fetch is forbidden in a production mTLS test.');});
 const ref=`globalThis[${JSON.stringify(globalKey)}]`,envUrl=data(`export const env=${ref}.env;`);
 const serverUrl=compiled('server.ts',{'cloudflare:workers':envUrl,'@/app/chatgpt-auth':data(`export const getChatGPTUser=async()=>${ref}.user;`),'./domain':local('domain.ts')});
 const server=await import(serverUrl),runtimeUrl=compiled('banking/saas-runtime.ts',{'cloudflare:workers':envUrl,'@/lib/server':serverUrl,'./security':local('banking/security.ts')});
 const runtime=await import(runtimeUrl),accounts=await import(compiled('banking/openpayments-account-state.ts',{'cloudflare:workers':envUrl,'../server':serverUrl,'./security':local('banking/security.ts')}));
 const sync=await import(compiled('banking/openpayments-company-sync.ts',{'../server':serverUrl,'../domain':local('domain.ts'),'../reconciliation-evidence':data('export const reconciliationPreviewWithOriginals=async()=>[];'),'./saas-runtime':runtimeUrl,'./openpayments-company-enrichment':data('export const enrichOpenPaymentsCompany=async()=>({state:"unavailable"});')}));
 async function call(name,{body,companyId='company-a',target=runtime,args,extra=[],query={},operation}={}){
  let value;const handler=server.withCompanyRequest(async req=>{value=operation?await operation(req):await target[name](...(args??[req,companyId,...(body===undefined?[]:[body]),...extra]));return value instanceof Response?value:server.response(value);});
  const response=await handler(new Request(`https://app.example/api/companies/${companyId}/bank?${new URLSearchParams(query)}`,{method:body===undefined?'GET':'POST',headers:{Origin:'https://app.example','X-Company-Id':companyId,'X-Company-Context-Version':String(context.contextVersion),Cookie:'__Host-mg-onboarding='+'a'.repeat(64),'Idempotency-Key':'synthetic-'+crypto.randomUUID(),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  return{status:response.status,data:response.status===303?{location:response.headers.get('location')}:await response.json(),value};
 }
 async function saveActiveState(){
  const expiry='2099-01-01T00:00:00.000Z',codec={seal:(o,p,v)=>seal(key,o,p,v),unseal:(o,p,v)=>unseal(key,o,p,v)},resources=scopedResourceCodec({owner,companyId:context.companyId,connectionId:'connection-a',provider:'open_payments',environment:'PRODUCTION',generation:'g1'},codec);
  const consent={id:'consent-a',corporateId:registration.corporateId,psuId:registration.psuId,bicFi:registration.bicFi,validUntil:'2099-01-01'},identity={iban:'SE4550000000058398257466',currency:'SEK'};
  const state={permissions:['accounts:read','transactions:read'],id:'connection-a',bankId:'OPBKSE21',generation:'g1',status:'active',validUntil:expiry,consentHandle:await resources.seal('consent',consent,expiry),selected:['account-a'],accounts:[{id:'account-a',identity,handle:await resources.seal('account',{id:'resource-a',identity,consent},expiry)}]};
  const payload=await seal(key,owner,'saas-bank-state',state);await db.prepare('INSERT INTO saas_bank_state(owner,revision,payload) VALUES(?,1,?)').bind(owner,payload).run();return state;
 }
 return{f,scope,context,owner,env,key,config,registration,binding,provider,principal,call,server,runtime,accounts,sync,saveActiveState,plainFetches:()=>plainFetches};
}
test('production Workers configuration recognizes an actual mTLS binding without any egress',async t=>{
 const f=await fixture(t),result=await f.call('saasBankSyncConfiguration');
 assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.serviceEnabled,true);assert.equal(result.data.enabled,true);assert.equal(result.data.syncEnabled,true);
 assert.equal(f.provider.calls.length,0);assert.equal(f.plainFetches(),0);
});
test('actual Sites discovery uses only the certificate fetch binding and production origins',async t=>{
 const f=await fixture(t),result=await f.call('saasBankDiscovery');
 assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.banks.length,1);assert.equal(f.provider.calls.length,2);
 assert.deepEqual(f.provider.calls.map(c=>new URL(c.url).origin),['https://auth.openbankingplatform.com','https://api.openbankingplatform.com']);
 for(const call of f.provider.calls){assert.equal(call.init.redirect,'manual');assert.equal(call.init.cache,'no-store');}
 assert.equal(f.plainFetches(),0);
});
test('production account authority is a stored read bounded by real certificate expiry',async t=>{
 const f=await fixture(t);await f.saveActiveState();const result=await f.call('readOpenPaymentsAccountState',{target:f.accounts,args:[f.owner]});
 assert.equal(result.status,200,JSON.stringify(result.data));assert.deepEqual(result.data.selected,['account-a']);assert.equal(result.data.snapshot.validUntil,new Date(syntheticWorkersCertificate().validTo).toISOString());
 assert.equal(f.provider.calls.length,0);assert.equal(f.plainFetches(),0);assert.equal(f.f.sql.prepare('SELECT count(*) n FROM bank_connections').get().n,0);
});

test('actual Workers consent, callback, selected account and durable sync run through the binding',async t=>{
 const date=new Date().toISOString().slice(0,10),expiry=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
 const f=await fixture(t,{responses:{
  ['GET /psd2/aspspinformation/v1/aspsps/OPBKSE21']:()=>json({bicFi:'OPBKSE21',name:'Synthetic bank',supportedAuthorizationMethods:[{name:'OAuth2',uri:'https://auth.openbankingplatform.com/.well-known/openid-configuration'}]}),
  ['GET /psd2/consent/v1/consents/'+CONSENT_ID]:()=>json({consentStatus:'valid',validUntil:expiry,recurringIndicator:true,frequencyPerDay:4,access:{}}),
  ['PUT /psd2/consent/v1/consents/'+CONSENT_ID+'/authorisations/'+AUTH_ID]:()=>json({scaStatus:'started',_links:{scaOAuth:{href:`https://auth.openbankingplatform.com/connect/authorize?client_id=[CLIENT_ID]&scope=accountinformation%20corporate&response_type=code&redirect_uri=[TPP_REDIRECT_URI]&state=[TPP_STATE]&acr_values=idp:OPBKSE21%20consentId:${CONSENT_ID}%20ConsentAuthorisationId:${AUTH_ID}`}}},200,{'aspsp-sca-approach':'REDIRECT'}),
  ['GET /psd2/accountinformation/v1/accounts/'+ACCOUNT_ID+'/transactions']:()=>json({account:{iban:'SE4550000000058398257466'},transactions:{booked:[{...TX,bookingDate:date,remittanceInformationStructured:'0000599'}],_links:{}}}),
 }});
 const started=await f.call('saasBankStart',{body:{bankId:'OPBKSE21',permissions:['accounts:read','transactions:read'],expectedRevision:0}});
 assert.equal(started.status,200,JSON.stringify(started.data));assert.equal(started.data.authorization.state,'pending');
 const redirect=await f.call('saasBankRedirect',{extra:[started.data.authorization.id]});assert.equal(redirect.status,303,JSON.stringify(redirect.data));
 const state=new URL(redirect.data.location).searchParams.get('state');
 const callback=await f.call('saasBankCallback',{query:{state,code:'synthetic-code',scope:'accountinformation corporate'}});
 assert.equal(callback.status,200,JSON.stringify(callback.data));const accountId=callback.data.accounts[0].id;
 const selected=await f.call('saasBankSelect',{body:{connectionId:callback.data.connection.id,accountIds:[accountId],expectedRevision:callback.data.revision}});
 assert.equal(selected.status,200,JSON.stringify(selected.data));assert.equal(selected.data.accounts[0].selected,true);
 const beforeReplay=f.f.sql.prepare('SELECT revision,payload FROM saas_bank_state WHERE owner=?').get(f.owner),callsBeforeReplay=f.provider.calls.length;
 const replay=await f.call('saasBankCallback',{query:{state,code:'synthetic-code',scope:'accountinformation corporate'}});
 assert.equal(replay.status,200,'an exact callback receipt replay is intentionally idempotent');assert.deepEqual(f.f.sql.prepare('SELECT revision,payload FROM saas_bank_state WHERE owner=?').get(f.owner),beforeReplay);assert.equal(f.provider.calls.length,callsBeforeReplay);
 assert.notEqual((await f.call('saasBankCallback',{query:{state,code:'different-code',scope:'accountinformation corporate'}})).status,200);assert.equal(f.provider.calls.length,callsBeforeReplay);
 f.provider.calls.length=0;
 const run=()=>f.call('sync',{body:{},operation:async req=>(await f.sync.sitesOpenPaymentsCompanySync(req,'company-a')).run(accountId)});
 const first=await run();assert.equal(first.status,200,JSON.stringify(first.data));assert.equal(first.data.status,'success',JSON.stringify(first.data));assert.equal(first.data.imported,1);
 assert.equal(f.f.sql.prepare('SELECT count(*) n FROM company_bank_sync_requests').get().n,f.provider.calls.length,'every binding exchange is covered by the durable request budget');
 const second=await run();assert.equal(second.data.status,'success',JSON.stringify(second.data));assert.equal(second.data.imported,0);
 const workspace=JSON.parse(f.f.sql.prepare('SELECT payload FROM workspaces WHERE owner=?').get(f.owner).payload);
 assert.equal(workspace.transactions.length,1);assert.equal(workspace.transactions[0].amount,62500);assert.equal(workspace.transactions[0].payerReference,'0000599');assert.equal(workspace.transactions[0].verified,false);assert.deepEqual(workspace.allocations,[]);
 const calls=f.provider.calls.length,status=await f.call('status',{operation:async req=>(await f.sync.sitesOpenPaymentsCompanySync(req,'company-a')).status(accountId)});
 assert.equal(status.data.state,'succeeded',JSON.stringify(status.data));assert.equal(f.provider.calls.length,calls);
 const disabled=await f.call('scheduled',{operation:async req=>(await f.sync.sitesOpenPaymentsCompanySync(req,'company-a')).scheduled()});assert.deepEqual(disabled.data,{disabled:true,results:[]});assert.equal(f.provider.calls.length,calls);
 assert.equal(f.plainFetches(),0);assert.equal(f.f.sql.prepare('SELECT count(*) n FROM bank_connections').get().n,0);
});
for(const flag of ['verified','corporateAccessVerified','redirectVerified'])test('mTLS does not bypass unverified registration '+flag,async t=>{
 const f=await fixture(t);f.env.SAAS_OPENPAYMENTS_REGISTRATIONS=JSON.stringify([{...f.registration,[flag]:false}]);
 const config=await f.call('saasBankSyncConfiguration');assert.equal(config.status,200);assert.equal(config.data.enabled,false);
 assert.notEqual((await f.call('saasBankDiscovery')).status,200);await f.saveActiveState();assert.notEqual((await f.call('readOpenPaymentsAccountState',{target:f.accounts,args:[f.owner]})).status,200);
 assert.equal(f.provider.calls.length,0);assert.equal(f.plainFetches(),0);
});
test('metadata without a real binding and a caller transport cannot activate production',async t=>{
 const f=await fixture(t);await f.saveActiveState();delete f.env.OPENPAYMENTS_MTLS;let injectedCalls=0;
 const result=await f.call('sync-context',{operation:req=>f.runtime.saasBankSyncContext(req,'company-a','account-a',{transport:{kind:'mtls',validateCertificate(){},async request(){injectedCalls++;return json({});}}})});
 assert.notEqual(result.status,200);assert.equal(injectedCalls,0);assert.equal(f.provider.calls.length,0);assert.equal(f.plainFetches(),0);
});
test('foreign company and owner cannot read account resources or start provider traffic',async t=>{
 const f=await fixture(t);await f.saveActiveState();
 assert.notEqual((await f.call('saasBankDiscovery',{companyId:'foreign-company'})).status,200);
 assert.notEqual((await f.call('readOpenPaymentsAccountState',{target:f.accounts,args:['foreign-owner']})).status,200);assert.equal(f.provider.calls.length,0);
});
test('membership revocation during token response stops the next provider operation',async t=>{
 const f=await fixture(t),original=f.provider.transport.request;
 f.provider.transport.request=async(url,init)=>{const response=await original(url,init);if(new URL(url).pathname==='/connect/token')f.f.sql.prepare("UPDATE company_memberships SET status='revoked',membership_version=membership_version+1 WHERE company_id='company-a'").run();return response;};
 assert.notEqual((await f.call('saasBankDiscovery')).status,200);assert.equal(f.provider.calls.length,1);assert.equal(new URL(f.provider.calls[0].url).pathname,'/connect/token');assert.equal(f.f.sql.prepare('SELECT count(*) n FROM saas_bank_state').get().n,0);
});
for(const action of ['configuration','account-state'])test('binding rotation during stored '+action+' read fails closed without provider traffic',async t=>{
 const f=await fixture(t);await f.saveActiveState();const prepare=f.f.raw.prepare;let rotations=0;
 t.mock.method(f.f.raw,'prepare',function(query){const statement=prepare.call(this,query),bind=statement.bind;if(/FROM (?:main\.)?saas_bank_state\b/.test(query))statement.bind=function(...args){const bound=bind.apply(this,args),first=bound.first;bound.first=async function(...values){const row=await first.apply(this,values);rotations++;f.env.OPENPAYMENTS_MTLS={fetch:f.binding.fetch};return row;};return bound;};return statement;});
 const result=action==='configuration'?await f.call('saasBankSyncConfiguration'):await f.call('readOpenPaymentsAccountState',{target:f.accounts,args:[f.owner]});
 assert.equal(rotations,1,'the injected rotation occurred during the actual scoped SQL read');assert.notEqual(result.status,200);assert.equal(f.provider.calls.length,0);assert.equal(f.plainFetches(),0);
});

test('two separate Sites requests reuse the verified binding app-token state',async t=>{
 const f=await fixture(t);
 for(let attempt=0;attempt<2;attempt++){const result=await f.call('saasBankDiscovery');assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.banks.length,1);}
 assert.equal(f.provider.calls.filter(c=>new URL(c.url).pathname==='/connect/token').length,1);
 assert.equal(f.provider.calls.filter(c=>new URL(c.url).pathname.endsWith('/aspsps')).length,2);assert.equal(f.plainFetches(),0);
});
for(const count of [1,10,100])test(count+' actual isolated company requests share one app token without cross-company access',async t=>{
 const f=await fixture(t),registrations=[];
 for(let index=0;index<count;index++){
  const companyId='synthetic-company-'+index,actorId='synthetic-actor-'+index;await f.f.create(companyId,actorId);
  registrations.push({...f.registration,companyId,actorId,corporateId:'synthetic-corporate-'+index,psuId:'synthetic-psu-'+index});
 }
 f.env.SAAS_OPENPAYMENTS_REGISTRATIONS=JSON.stringify(registrations);
 for(const registration of registrations){
  f.principal.user={userId:registration.actorId,displayName:'Synthetic actor'};
  const result=await f.call('saasBankDiscovery',{companyId:registration.companyId});assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.banks.length,1);
 }
 assert.equal(f.provider.calls.filter(c=>new URL(c.url).pathname==='/connect/token').length,1);
 assert.equal(f.provider.calls.filter(c=>new URL(c.url).pathname.endsWith('/aspsps')).length,count);
 const calls=f.provider.calls.length;assert.notEqual((await f.call('saasBankDiscovery',{companyId:'company-a'})).status,200);assert.equal(f.provider.calls.length,calls);
 assert.equal(f.f.sql.prepare('SELECT count(*) n FROM saas_bank_state').get().n,0);assert.equal(f.plainFetches(),0);
});

for(const rotate of [false,true])test('stored active consent and an empty issuer registry support '+(rotate?'atomic rejection of a commit-time rotation':'the first authorized sync'),async t=>{
 const date=new Date().toISOString().slice(0,10);
 const f=await fixture(t,{responses:{
  'GET /psd2/consent/v1/consents/consent-a/status':()=>json({consentStatus:'valid'}),
  'GET /psd2/consent/v1/consents/consent-a':()=>json({consentStatus:'valid',validUntil:'2099-01-01',recurringIndicator:true,frequencyPerDay:4,access:{}}),
  'GET /psd2/accountinformation/v1/accounts/resource-a/transactions':()=>json({account:{iban:'SE4550000000058398257466'},transactions:{booked:[{...TX,bookingDate:date,remittanceInformationStructured:'0000599'}],_links:{}}}),
 }});
 await f.saveActiveState();const before=f.f.sql.prepare('SELECT * FROM workspaces WHERE owner=?').get(f.owner);
 assert.equal((await f.call('saasBankSyncConfiguration')).status,200);
 assert.equal(f.f.sql.prepare('SELECT count(*) n FROM company_application_tokens').get().n,0,'configuration GET remains a pure stored read');assert.equal(f.provider.calls.length,0);
 let rotations=0;
 if(rotate)f.f.beforeBatch=statements=>{if(statements.some(statement=>/UPDATE workspaces SET payload=/.test(statement.query))){f.f.beforeBatch=null;rotations++;f.f.sql.prepare("UPDATE company_application_tokens SET epoch=epoch+1,config_hash=?").run('e'.repeat(64));}};
 const result=await f.call('sync',{body:{},operation:async req=>(await f.sync.sitesOpenPaymentsCompanySync(req,'company-a')).run('account-a')});
 assert.equal(result.status,200,JSON.stringify(result.data));
 if(rotate){
  assert.equal(rotations,1,'rotation occurred after the guard and immediately before the actual financial batch');
  assert.notEqual(result.data.status,'success');assert.deepEqual(f.f.sql.prepare('SELECT * FROM workspaces WHERE owner=?').get(f.owner),before);
  assert.equal(f.f.sql.prepare('SELECT count(*) n FROM company_bank_sync_receipts').get().n,0);
 }else{
  assert.equal(result.data.status,'success',JSON.stringify(result.data));assert.equal(result.data.imported,1);
  const workspace=JSON.parse(f.f.sql.prepare('SELECT payload FROM workspaces WHERE owner=?').get(f.owner).payload);
  assert.equal(workspace.transactions.length,1);assert.equal(workspace.transactions[0].amount,62500);assert.equal(workspace.transactions[0].verified,false);assert.deepEqual(workspace.allocations,[]);
 }
 assert.equal(f.provider.calls.filter(call=>new URL(call.url).pathname==='/connect/token').length,1);assert.equal(f.plainFetches(),0);
});
