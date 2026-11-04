import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import ts from 'typescript';
import {companyFixture} from './helpers/company-storage-fixture.mjs';
import {changeCompanyMembership,selectCompany} from '../lib/company-storage.js';
import {fixtureTransport,json,CONSENT_ID,AUTH_ID} from './helpers/openpayments-fixture.mjs';
import {randomToken} from '../lib/banking/security.ts';

const origin='https://mg-fakturakoll-sharbel.sharbelrasho.chatgpt.site',callbackUri=origin+'/api/bank/callback',prefix='/api/companies/company-a/bank';
const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64'),url=path=>new URL(path,import.meta.url).href;
function compile(path,imports){let code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;for(const [from,to]of Object.entries(imports))for(const quote of ['"',"'"])code=code.replaceAll(quote+from+quote,JSON.stringify(to));return data(code);}
const files={providers:['../app/api/companies/[companyId]/bank/providers/route.ts','GET'],banks:['../app/api/companies/[companyId]/bank/open-payments/banks/route.ts','GET'],list:['../app/api/companies/[companyId]/bank/provider-connections/route.ts','GET'],start:['../app/api/companies/[companyId]/bank/provider-connections/route.ts','POST'],status:['../app/api/companies/[companyId]/bank/provider-connections/[id]/route.ts','GET'],method:['../app/api/companies/[companyId]/bank/provider-connections/[id]/method/route.ts','POST'],accounts:['../app/api/companies/[companyId]/bank/provider-connections/[id]/accounts/route.ts','POST'],revoke:['../app/api/companies/[companyId]/bank/provider-connections/[id]/revoke/route.ts','POST'],redirect:['../app/api/companies/[companyId]/bank/authorizations/[flowId]/redirect/route.ts','GET']};
files.renew=['../app/api/companies/[companyId]/bank/provider-connections/[id]/renew/route.ts','POST'];files.refresh=['../app/api/companies/[companyId]/bank/provider-connections/[id]/refresh/route.ts','POST'];
async function fixture(t){
 assert.ok(existsSync(new URL('../lib/banking/company-provider-service.ts',import.meta.url)),'Sites provider HTTP service must be implemented');
 const f=companyFixture(t),key='__provider_http_'+crypto.randomUUID().replaceAll('-','');globalThis[key]=f;t.after(()=>delete globalThis[key]);
 await f.create('company-a');await f.create('company-b','actor-b');f.a=await f.scope();f.b=await f.scope('actor-b','company-b');
 f.user={userId:'actor-a',email:'synthetic@example.test',displayName:'Synthetic'};
 const config={environment:'SANDBOX',clientId:'synthetic-client',clientSecret:'PRIVATE_SYNTHETIC_CLIENT_SECRET',credentialGeneration:'synthetic-generation',redirectUris:[callbackUri]};
 const registration={verified:true,companyId:'company-a',owner:f.a.owner,environment:'SANDBOX',appGeneration:'synthetic-generation',evidenceId:'synthetic-registration',validUntil:'2026-12-04T00:00:00Z',corporateId:'PRIVATE_SYNTHETIC_CORPORATE_ID',psuId:'PRIVATE_SYNTHETIC_PSU_ID',psu:{ipAddress:'192.0.2.10',userAgent:'Synthetic test client'},redirectUri:callbackUri};
 f.config=config;f.registration=registration;f.env={DB:f.raw,BANK_DATA_ENCRYPTION_KEY:randomToken(),MG_SAAS_ONBOARDING_ENABLED:'true',MG_OPENPAYMENTS_CONFIG:JSON.stringify(config),MG_COMPANY_BANK_REGISTRATIONS:JSON.stringify({version:1,bindings:[registration]})};
 const ref=`globalThis[${JSON.stringify(key)}]`,environment=data(`export const env=${ref}.env;`),domain=url('../lib/domain.ts'),security=url('../lib/banking/security.ts');
 const server=compile('../lib/server.ts',{'cloudflare:workers':environment,'@/app/chatgpt-auth':data(`export async function getChatGPTUser(){return ${ref}.user;}`),'./domain':domain,'./company-storage.js':url('../lib/company-storage.js')});
 const transactions=compile('../lib/banking/transactions.ts',{'../domain':domain,'../payment-references.js':url('../lib/payment-references.js'),'../payer-evidence.js':url('../lib/payer-evidence.js')});
 const store=compile('../lib/banking/store.ts',{'cloudflare:workers':environment,'@/lib/server':server,'./security':security,'./runtime-config':url('../lib/banking/runtime-config.ts'),'../bank-consent-policy.js':url('../lib/bank-consent-policy.js'),'../bank-company-authority.js':url('../lib/bank-company-authority.js'),'./transactions':transactions});
 const service=compile('../lib/banking/company-provider-service.ts',{'cloudflare:workers':environment,'@/lib/server':server,'./store':store,'./security':security,'../company-contract.js':url('../lib/company-contract.js'),'./company-provider-runtime.js':url('../lib/banking/company-provider-runtime.js'),'./company-provider-repository.js':url('../lib/banking/company-provider-repository.js')});
 f.server=await import(server);f.service=await import(service);f.store=await import(store);f.routes={};
 for(const [name,[path,method]]of Object.entries(files)){assert.ok(existsSync(new URL(path,import.meta.url)),path);f.routes[name]=(await import(compile(path,{'@/lib/banking/company-provider-service':service})))[method];assert.equal(typeof f.routes[name],'function',name);}
 f.ebCallbacks=0;
 const callback=await import(compile('../app/api/bank/callback/route.ts',{'@/lib/banking/service':data(`export async function callback(){${ref}.ebCallbacks++;return new Response(null,{status:303,headers:{Location:'/bank?result=legacy'}});}`),'@/lib/banking/company-provider-service':service,'@/lib/server':server}));
 f.routes.callback=callback.GET;
 const base=fixtureTransport(),calls=[];f.calls=calls;f.beforeFetch=null;let creates=0;
 t.mock.method(globalThis,'fetch',async(input,init)=>{
  const target=new URL(typeof input==='string'?input:input.url??input),method=init?.method??'GET',path=target.pathname;calls.push({method,path});if(f.beforeFetch)await f.beforeFetch(target,init);
  assert.ok(['api.sandbox.openbankingplatform.com','oauth.sandbox.openbankingplatform.com'].includes(target.hostname),'synthetic provider boundary only');
  if(path==='/psd2/consent/v1/consents'&&method==='POST')return json({consentId:creates++?`11111111-1111-4111-8111-${String(creates).padStart(12,'0')}`:CONSENT_ID,consentStatus:'received'},201);
  if(/\/consents\/[^/]+\/authorisations$/.test(path)&&method==='POST')return json({authorisationId:AUTH_ID,scaStatus:'received',scaMethods:[{authenticationMethodId:'mbid',authenticationType:'PUSH_OTP',name:'Synthetic BankID'}]},201);
  if(path.endsWith('/authorisations/'+AUTH_ID)&&method==='PUT'){
   const consentId=path.split('/')[5],parameters=new URLSearchParams({client_id:'[CLIENT_ID]',scope:'accountinformation corporate',response_type:'code',redirect_uri:'[TPP_REDIRECT_URI]',state:'[TPP_STATE]',acr_values:`idp:OPBKSE21 consentId:${consentId} ConsentAuthorisationId:${AUTH_ID}`});
   return json({scaStatus:'started',_links:{scaOAuth:{href:'https://oauth.sandbox.openbankingplatform.com/connect/authorize?'+parameters}}},200,{'aspsp-sca-approach':'REDIRECT'});
  }
  return base.transport.request(target.href,init);
 });
 f.cookie='';f.issuedCookies=[];
 f.request=(path,{companyId='company-a',version=1,method='GET',body,headers={},cookie=f.cookie}={})=>new Request(origin+path,{method,headers:{...(companyId?{'X-Company-Id':companyId,'X-Company-Context-Version':String(version)}:{}),...(method==='POST'?{'Origin':origin,'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
 f.call=async(name,{companyId='company-a',id,flowId,...options}={})=>{
  const path=name==='callback'?'/api/bank/callback'+options.query:prefix.replace('company-a',companyId??'company-a')+(name==='providers'?'/providers':name==='banks'?'/open-payments/banks':name==='list'||name==='start'?'/provider-connections':name==='redirect'?`/authorizations/${flowId}/redirect`:`/provider-connections/${id}`+(name==='status'?'':'/'+name));
  const req=f.request(path,{companyId,...options}),r=await f.routes[name](req,{params:Promise.resolve({companyId:companyId??'company-a',id,flowId})});
  const issued=r.headers.get('Set-Cookie');if(issued)f.issuedCookies.push(issued);if(issued&&!issued.includes('Max-Age=0')){const pair=issued.split(';')[0],cookieName=pair.split('=')[0];f.cookie=[...f.cookie.split('; ').filter(value=>value&&!value.startsWith(cookieName+'=')),pair].join('; ');}
  return r;
 };
 f.start=async(requestKey='synthetic-request-0001')=>{const r=await f.call('start',{method:'POST',body:{bankId:'OPBKSE21',validUntil:'2026-12-01',requestKey}});assert.equal(r.status,201,await r.clone().text());return r.json();};
 f.authorize=async()=>{const started=await f.start(),chosenResponse=await f.call('method',{id:started.id,method:'POST',body:{methodId:'mbid',revision:started.revision}});assert.equal(chosenResponse.status,200,await chosenResponse.clone().text());const chosen=await chosenResponse.json(),redirect=await f.call('redirect',{flowId:chosen.flowId,companyId:null});assert.equal(redirect.status,303,await redirect.clone().text());return{started,chosen,state:new URL(redirect.headers.get('Location')).searchParams.get('state')};};
 f.connected=async()=>{const {state,chosen}=await f.authorize(),returned=await f.call('callback',{companyId:null,query:'?'+new URLSearchParams({state,scope:'accountinformation corporate',code:'synthetic-code'})});assert.equal(returned.headers.get('Location'),'/bank?result=provider_ready');const value=await(await f.call('status',{id:chosen.id})).json(),selected=await f.call('accounts',{id:chosen.id,method:'POST',body:{accountIds:[value.accounts[0].id],revision:value.revision}});assert.equal(selected.status,200,await selected.clone().text());return selected.json();};
 return f;
}

test('real provider routes report safe trusted configuration and immutable stored status',async t=>{
 const f=await fixture(t),before=f.sql.prepare('SELECT * FROM bank_provider_connections').all();
 const r=await f.call('providers');assert.equal(r.status,200);const body=await r.json();assert.equal(body.companyId,'company-a');assert.equal(body.providers[0].available,true);
 assert.doesNotMatch(JSON.stringify(body),/PRIVATE_|clientSecret|corporateId|psuId/);
 const listed=await f.call('list');assert.deepEqual(await listed.json(),{companyId:'company-a',connections:[]});assert.deepEqual(f.calls,[]);assert.deepEqual(f.sql.prepare('SELECT * FROM bank_provider_connections').all(),before);
 const banks=await f.call('banks');assert.equal(banks.status,200);assert.equal((await banks.json()).banks[0].id,'OPBKSE21');
});

test('real HTTP consent lifecycle uses encrypted scoped persistence, private redirect, one-use callback and exact revision',async t=>{
 const f=await fixture(t),financial=f.sql.prepare('SELECT * FROM workspaces ORDER BY owner').all(),{chosen,state}=await f.authorize();
 assert.equal(chosen.redirectPath,`${prefix}/authorizations/${chosen.flowId}/redirect`);assert.doesNotMatch(JSON.stringify(chosen),/https:|PRIVATE_|consentId|encrypted/);
 const beforeRead=f.sql.prepare('SELECT * FROM bank_auth_flows').all(),beforeReadCalls=f.calls.length;
 const listed=await(await f.call('list')).json();assert.equal(listed.connections[0].redirectPath,chosen.redirectPath);assert.equal(f.calls.length,beforeReadCalls);assert.deepEqual(f.sql.prepare('SELECT * FROM bank_auth_flows').all(),beforeRead);assert.equal(f.sql.prepare('SELECT count(*) n FROM bank_locks').get().n,0);
 const query='?'+new URLSearchParams({state,scope:'accountinformation corporate',code:'synthetic-code'}),r=await f.call('callback',{companyId:null,query});
 assert.equal(r.status,303);assert.equal(r.headers.get('Location'),'/bank?result=provider_ready');assert.equal(f.ebCallbacks,0);
 const status=await(await f.call('status',{id:chosen.id})).json();assert.equal(status.status,'accounts_required');assert.equal(status.accounts.length,1);
 const selected=await f.call('accounts',{id:chosen.id,method:'POST',body:{accountIds:[status.accounts[0].id],revision:status.revision}});assert.equal(selected.status,200);const connected=await selected.json();assert.equal(connected.status,'connected');
 const before=f.calls.length;assert.equal((await f.call('accounts',{id:chosen.id,method:'POST',body:{accountIds:[status.accounts[0].id],revision:status.revision}})).status,409);assert.equal(f.calls.length,before);
 const replay=await f.call('callback',{companyId:null,query});assert.notEqual(replay.headers.get('Location'),'/bank?result=provider_ready');assert.equal(f.calls.length,before);
 const revoked=await f.call('revoke',{id:chosen.id,method:'POST',body:{revision:connected.revision}});assert.equal(revoked.status,200);assert.equal((await revoked.json()).status,'revoked');
 const row=f.sql.prepare('SELECT * FROM bank_provider_connections').get();assert.equal(row.owner,f.a.owner);assert.equal(row.company_id,'company-a');assert.doesNotMatch(row.encrypted_state,/PRIVATE_|synthetic-code|consentId/);assert.equal(f.sql.prepare('SELECT count(*) n FROM bank_provider_grant_claims').get().n,1);
 assert.deepEqual(f.sql.prepare('SELECT * FROM workspaces ORDER BY owner').all(),financial);assert.equal(f.sql.prepare('SELECT count(*) n FROM bank_connections').get().n,0);
});

for(const role of ['accountant','viewer'])test(role+' reads provider status but cannot start discovery or mutate consent',async t=>{
 const f=await fixture(t);await changeCompanyMembership(f.raw,f.a,{actorId:role,role,status:'active'});f.user.userId=role;
 assert.equal((await f.call('providers')).status,200);assert.equal((await f.call('list')).status,200);
 for(const [name,options]of [['banks',{}],['start',{method:'POST',body:{bankId:'OPBKSE21',validUntil:'2026-12-01',requestKey:'synthetic-request-0001'}}]])assert.equal((await f.call(name,options)).status,403);
 assert.deepEqual(f.calls,[]);assert.equal(f.sql.prepare('SELECT count(*) n FROM bank_provider_connections').get().n,0);
});

test('URL company, selectors, origin and exact request shape fail before provider work',async t=>{
 const f=await fixture(t);
 assert.equal((await f.call('providers',{companyId:'company-b'})).status,403);
 assert.equal((await f.routes.providers(f.request(prefix+'/providers',{companyId:'company-a'}),{params:Promise.resolve({companyId:'company-b'})})).status,403);
 for(const options of [{headers:{Origin:'https://foreign.example.test'}},{body:{bankId:'OPBKSE21',validUntil:'2026-12-01',requestKey:'synthetic-request-0001',corporateId:'spoof'}},{body:'x'.repeat(9000)},{body:[]},{body:'{'}]){
  const r=await f.call('start',{method:'POST',body:{bankId:'OPBKSE21',validUntil:'2026-12-01',requestKey:'synthetic-request-0001'},...options});assert.ok([400,403,413].includes(r.status),await r.text());
 }
 assert.deepEqual(f.calls,[]);assert.equal(f.sql.prepare('SELECT count(*) n FROM bank_provider_connections').get().n,0);
});

test('production Workers transport and a mismatched registered callback fail closed',async t=>{
 const f=await fixture(t);f.env.MG_OPENPAYMENTS_CONFIG=JSON.stringify({...f.config,environment:'PRODUCTION'});f.env.MG_COMPANY_BANK_REGISTRATIONS=JSON.stringify({version:1,bindings:[{...f.registration,environment:'PRODUCTION',productionTransportVerified:true}]});
 assert.equal((await(await f.call('providers')).json()).providers[0].reason,'transport_required');assert.equal((await f.call('start',{method:'POST',body:{bankId:'OPBKSE21',validUntil:'2026-12-01',requestKey:'synthetic-request-0001'}})).status,403);
 f.env.MG_OPENPAYMENTS_CONFIG=JSON.stringify({...f.config,redirectUris:[callbackUri.replace('sharbelrasho','asdasdsa213')]});f.env.MG_COMPANY_BANK_REGISTRATIONS=JSON.stringify({version:1,bindings:[{...f.registration,redirectUri:callbackUri.replace('sharbelrasho','asdasdsa213')}]});
 assert.equal((await(await f.call('providers')).json()).providers[0].available,false);assert.deepEqual(f.calls,[]);
});

test('per-flow browser cookies survive concurrent onboarding without replacing the first nonce',async t=>{
 const f=await fixture(t),first=await f.start(),cookie=f.cookie,second=await f.start('synthetic-request-0002');assert.notEqual(first.flowId,second.flowId);assert.ok(f.cookie.includes(cookie));assert.equal(f.cookie.split('; ').length,2);
 const repeated=await f.start();assert.equal(repeated.id,first.id);assert.equal(f.sql.prepare('SELECT count(*) n FROM bank_provider_connections').get().n,2);
 assert.equal(f.calls.filter(call=>call.method==='POST'&&call.path==='/psd2/consent/v1/consents').length,2);
 for(const cookie of f.issuedCookies){assert.match(cookie,/^__Secure-mg-provider-[a-f0-9]{32}=[-_A-Za-z0-9]{43}; Path=\/api; Secure; HttpOnly; SameSite=Lax; Max-Age=900$/);}
});

test('renewal keeps the same scoped connection, explicit revision and retained prior encrypted handles',async t=>{
 const f=await fixture(t),connected=await f.connected(),old={...f.sql.prepare('SELECT * FROM bank_provider_connections').get()},claims=f.sql.prepare('SELECT * FROM bank_provider_grant_claims').all();
 const input={bankId:'OPBKSE21',validUntil:'2026-12-01',requestKey:'synthetic-renewal-0001',revision:connected.revision};
 const before=f.calls.length,stale=await f.call('renew',{id:connected.id,method:'POST',body:{...input,revision:1}});assert.equal(stale.status,409);assert.equal(f.calls.length,before);assert.deepEqual({...f.sql.prepare('SELECT * FROM bank_provider_connections').get()},old);
 const foreign=await f.call('renew',{companyId:'company-b',id:connected.id,method:'POST',body:input});assert.equal(foreign.status,403);assert.equal(f.calls.length,before);
 const r=await f.call('renew',{id:connected.id,method:'POST',body:input});assert.equal(r.status,200,await r.clone().text());const renewed=await r.json();assert.equal(renewed.id,connected.id);assert.ok(renewed.revision>connected.revision);
 const row=f.sql.prepare('SELECT * FROM bank_provider_connections').get(),purpose='provider-manager-state-v1:'+JSON.stringify([row.company_id,row.id,row.provider_kind,row.environment,row.app_generation]),state=await f.store.decrypt(row.owner,purpose,row.encrypted_state);
 assert.deepEqual(state.previous,old);assert.equal(f.sql.prepare('SELECT count(*) n FROM bank_provider_connections').get().n,1);
 for(const claim of claims)assert.deepEqual(f.sql.prepare('SELECT * FROM bank_provider_grant_claims WHERE fingerprint=?').get(claim.fingerprint),claim);
 const count=f.calls.length;assert.equal((await f.call('renew',{id:connected.id,method:'POST',body:input})).status,200);assert.equal(f.calls.length,count);
});

test('failed renewal retains the previous connection and grant history as review evidence',async t=>{
 const f=await fixture(t),connected=await f.connected(),old={...f.sql.prepare('SELECT * FROM bank_provider_connections').get()},claims=f.sql.prepare('SELECT * FROM bank_provider_grant_claims').all();
 f.beforeFetch=async(target,init)=>{if(target.pathname==='/psd2/consent/v1/consents'&&init.method==='POST')throw Error('PRIVATE_SYNTHETIC_NETWORK_FAILURE');};
 const r=await f.call('renew',{id:connected.id,method:'POST',body:{bankId:'OPBKSE21',validUntil:'2026-12-01',requestKey:'synthetic-renewal-fail',revision:connected.revision}});assert.equal(r.status,403);assert.doesNotMatch(await r.text(),/PRIVATE_|encrypted_state/);
 const row=f.sql.prepare('SELECT * FROM bank_provider_connections').get(),purpose='provider-manager-state-v1:'+JSON.stringify([row.company_id,row.id,row.provider_kind,row.environment,row.app_generation]),state=await f.store.decrypt(row.owner,purpose,row.encrypted_state);
 assert.deepEqual(state.previous,old);assert.equal(row.status,'review');assert.deepEqual(f.sql.prepare('SELECT * FROM bank_provider_grant_claims').all(),claims);assert.equal(f.calls.some(call=>call.method==='DELETE'),false);
});

test('explicit refresh is a bounded manage POST and ordinary reads never poll a provider',async t=>{
 const f=await fixture(t),connected=await f.connected(),before=f.calls.length,row={...f.sql.prepare('SELECT * FROM bank_provider_connections').get()};
 assert.equal((await f.call('status',{id:connected.id})).status,200);assert.equal((await f.call('list')).status,200);assert.equal(f.calls.length,before);assert.deepEqual({...f.sql.prepare('SELECT * FROM bank_provider_connections').get()},row);
 assert.equal((await f.call('refresh',{id:connected.id,method:'POST',body:{revision:connected.revision}})).status,400);assert.equal(f.calls.length,before);
 const r=await f.call('refresh',{id:connected.id,method:'POST',body:{}});assert.equal(r.status,200,await r.clone().text());assert.ok(f.calls.length>before);
 await changeCompanyMembership(f.raw,f.a,{actorId:'viewer',role:'viewer',status:'active'});f.user.userId='viewer';const count=f.calls.length;assert.equal((await f.call('refresh',{id:connected.id,method:'POST',body:{}})).status,403);assert.equal(f.calls.length,count);
});

test('disabled onboarding preserves owned status refresh and revoke while blocking new consent and renewal',async t=>{
 const f=await fixture(t),connected=await f.connected();f.env.MG_SAAS_ONBOARDING_ENABLED='false';
 const status=await(await f.call('status',{id:connected.id})).json();assert.equal(status.available,true);assert.equal(status.onboardingAvailable,false);
 const before=f.calls.length;
 for(const name of ['start','renew']){const r=await f.call(name,{id:connected.id,method:'POST',body:{bankId:'OPBKSE21',validUntil:'2026-12-01',requestKey:'synthetic-gate-off',...(name==='renew'?{revision:connected.revision}:{})}});assert.equal(r.status,403);}
 assert.equal(f.calls.length,before);
 const refreshed=await f.call('refresh',{id:connected.id,method:'POST',body:{}});assert.equal(refreshed.status,200,await refreshed.clone().text());const current=await refreshed.json();
 const revoked=await f.call('revoke',{id:connected.id,method:'POST',body:{revision:current.revision}});assert.equal(revoked.status,200,await revoked.clone().text());assert.equal((await revoked.json()).status,'revoked');
});

test('provider handoff requires the original browser and exposes only a validated provider redirect',async t=>{
 const f=await fixture(t),started=await f.start(),chosen=await(await f.call('method',{id:started.id,method:'POST',body:{methodId:'mbid',revision:started.revision}})).json();
 const denied=await f.call('redirect',{flowId:chosen.flowId,companyId:null,cookie:''});assert.equal(denied.status,403);assert.equal(denied.headers.get('Location'),null);
 const foreign=await f.call('redirect',{flowId:chosen.flowId,companyId:'company-b'});assert.ok([403,409].includes(foreign.status));assert.equal(foreign.headers.get('Location'),null);
 const allowed=await f.call('redirect',{flowId:chosen.flowId,companyId:null});assert.equal(allowed.status,303);assert.equal(new URL(allowed.headers.get('Location')).origin,'https://oauth.sandbox.openbankingplatform.com');assert.equal(allowed.headers.get('Referrer-Policy'),'no-referrer');
});

test('credential rotation or live membership change during provider I/O cannot activate a late response',async t=>{
 const f=await fixture(t);let changed=false;f.beforeFetch=async target=>{if(!changed&&target.pathname==='/psd2/consent/v1/consents'){changed=true;f.sql.prepare("UPDATE companies SET company_version=company_version+1 WHERE id='company-a'").run();}};
 const result=await f.call('start',{method:'POST',body:{bankId:'OPBKSE21',validUntil:'2026-12-01',requestKey:'synthetic-request-0001'}});assert.ok([403,409].includes(result.status));assert.equal(changed,true);assert.notEqual(f.sql.prepare('SELECT status FROM bank_provider_connections').get().status,'connected');assert.equal(f.sql.prepare('SELECT count(*) n FROM bank_connections').get().n,0);
});

for(const damage of ['wrong cookie','different actor','membership generation','company generation','selection roundtrip','other active company','revoked and reactivated','unexpected callback field'])test('provider callback rejects '+damage+' before activation',async t=>{
 const f=await fixture(t),{state}=await f.authorize(),before=f.calls.length;
 await changeCompanyMembership(f.raw,f.a,{actorId:'other-admin',role:'owner',status:'active'});
 if(damage==='wrong cookie')f.cookie=f.cookie.replace(/=[^;]+/g,'='+randomToken());
 if(damage==='different actor')f.user.userId='other-admin';
 if(damage==='membership generation')await changeCompanyMembership(f.raw,f.a,{actorId:'actor-a',role:'admin',status:'active'});
 if(damage==='company generation')f.sql.prepare("UPDATE companies SET company_version=company_version+1 WHERE id='company-a'").run();
 if(damage==='selection roundtrip'){await changeCompanyMembership(f.raw,f.b,{actorId:'actor-a',role:'admin',status:'active'});await selectCompany(f.raw,'actor-a','company-b',1);await selectCompany(f.raw,'actor-a','company-a',2);}
 if(damage==='other active company'){await changeCompanyMembership(f.raw,f.b,{actorId:'actor-a',role:'admin',status:'active'});await selectCompany(f.raw,'actor-a','company-b',1);}
 if(damage==='revoked and reactivated'){const other=await f.scope('other-admin');await changeCompanyMembership(f.raw,other,{actorId:'actor-a',role:'owner',status:'revoked'});await changeCompanyMembership(f.raw,other,{actorId:'actor-a',role:'owner',status:'active'});}
 const parameters=new URLSearchParams({state,scope:'accountinformation corporate',code:'synthetic-code'});if(damage==='unexpected callback field')parameters.set('provider','enable_banking');
 const r=await f.call('callback',{companyId:null,query:'?'+parameters});assert.ok([303,403,409].includes(r.status));assert.equal(f.calls.length,before);assert.equal(f.ebCallbacks,0);
 assert.notEqual(f.sql.prepare('SELECT status FROM bank_provider_connections').get().status,'connected');
});
