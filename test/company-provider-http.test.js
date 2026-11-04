import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {AsyncResource} from 'node:async_hooks';
import {digest} from '../src/security.js';

const directory=mkdtempSync(join(tmpdir(),'mg-provider-http-')),origin='https://provider-runtime.example.test',callbackUri=origin+'/api/bank/callback',controlPlane=new AsyncResource('synthetic-provider-control-plane');
Object.assign(process.env,{NODE_ENV:'test',APP_ORIGIN:origin,MG_ADMIN_PASSWORD:'synthetic-provider-password',DB_PATH:join(directory,'legacy.sqlite'),SESSION_SECRET:'6'.repeat(64),BANK_DATA_KEY:'7'.repeat(64),MG_SAAS_ONBOARDING_ENABLED:'false'});
delete process.env.MG_OPENPAYMENTS_CONFIG;delete process.env.MG_COMPANY_BANK_REGISTRATIONS;
const {server,db,companyRuntime:runtime}=await import('../src/server.js');
const base=await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)));
const verification={status:'verified',evidenceId:'synthetic-company-proof',verifiedBy:'operator'},a=runtime.provisionCompany({companyId:'company-a',name:'Synthetic A',actorId:'alice',verification});
runtime.provisionCompany({companyId:'company-b',name:'Synthetic B',actorId:'ben',verification});runtime.setMembership({companyId:'company-b',actorId:'alice',role:'owner'});
for(const [actorId,role]of [['viewer','viewer'],['accountant','accountant']])runtime.setMembership({companyId:'company-a',actorId,role});
runtime.setMembership({companyId:'company-a',actorId:'synthetic-successor-owner',role:'owner'});
const configuration={environment:'SANDBOX',clientId:'synthetic-client-id',clientSecret:'private-client-secret',credentialGeneration:'approved-g1',redirectUris:[callbackUri]};
const registration={verified:true,companyId:'company-a',owner:a.storageOwner,environment:'SANDBOX',appGeneration:'approved-g1',evidenceId:'synthetic-bank-registration',validUntil:'2027-01-01T00:00:00Z',corporateId:'private-corporate-id',psuId:'private-psu-id',psu:{ipAddress:'192.0.2.10',userAgent:'Synthetic test client'},redirectUri:callbackUri};
const validUntil='2026-12-01',accountId='synthetic-account',account={resourceId:accountId,iban:'SE4550000000058398257466',currency:'SEK',name:'Private actual bank account',usage:'ORGA'};
const jars=new Map(),calls=[],consents=new Map();let sequence=0,started,chosen,connected,beforeRequest;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init={})=>{
 const url=new URL(input);assert.ok(['https://oauth.sandbox.openbankingplatform.com','https://api.sandbox.openbankingplatform.com'].includes(url.origin),'Only synthetic sandbox transport is permitted');calls.push(init.method+' '+url.pathname);await beforeRequest?.(url,init);
 if(url.pathname==='/connect/token')return Response.json({access_token:'private-provider-token',token_type:'Bearer',expires_in:3600,scope:new URLSearchParams(init.body).get('scope')});
 if(url.pathname==='/psd2/aspspinformation/v1/aspsps')return Response.json({aspsps:[{bicFi:'OPBKSE21',name:'Synthetic bank'}]});
 if(url.pathname==='/psd2/aspspinformation/v1/aspsps/OPBKSE21')return Response.json({bicFi:'OPBKSE21',name:'Synthetic bank',supportedAuthorizationMethods:[{name:'OAuth2',uri:'https://oauth.sandbox.openbankingplatform.com/.well-known/openid-configuration'}],accountInformation:{transactionHistoryMaxDays:90}});
 if(url.pathname==='/psd2/consent/v1/consents'&&init.method==='POST'){const id='synthetic-consent-'+(++sequence);consents.set(id,JSON.parse(init.body));return Response.json({consentId:id,consentStatus:'received'},{status:201});}
 const authorization=/\/consents\/([^/]+)\/authorisations(?:\/([^/]+))?$/.exec(url.pathname);
 if(authorization){
  const cid=authorization[1],aid='authorization-'+cid;
  if(init.method==='POST')return Response.json({authorisationId:aid,scaStatus:'received',scaMethods:[{authenticationMethodId:'mbid',authenticationType:'PUSH_OTP',name:'Synthetic identification'}]},{status:201});
  if(init.method==='PUT'){
   const parameters=new URLSearchParams({client_id:'[CLIENT_ID]',scope:'accountinformation corporate',response_type:'code',redirect_uri:'[TPP_REDIRECT_URI]',state:'[TPP_STATE]',acr_values:'idp:OPBKSE21 consentId:'+cid+' ConsentAuthorisationId:'+aid});
   return Response.json({scaStatus:'started',_links:{scaOAuth:{href:'https://oauth.sandbox.openbankingplatform.com/connect/authorize?'+parameters}}},{headers:{'aspsp-sca-approach':'REDIRECT'}});
  }
  return Response.json({scaStatus:'finalised'});
 }
 const consent=/\/consents\/([^/]+)(?:\/status)?$/.exec(url.pathname);
 if(consent)return init.method==='DELETE'?new Response(null,{status:204}):Response.json({consentStatus:'valid',validUntil,recurringIndicator:true,frequencyPerDay:4,access:{}});
 if(url.pathname==='/psd2/accountinformation/v1/accounts')return Response.json({accounts:[account]});
 if(url.pathname==='/psd2/accountinformation/v1/accounts/'+accountId)return Response.json(account);
 throw Error('Unexpected synthetic provider operation');
};
function session(actor,browser){const value='synthetic-'+actor+'-'+browser;runtime.controlDb.prepare('INSERT OR REPLACE INTO sessions(id_hash,expires_at,principal) VALUES(?,?,?)').run(digest(value),Date.now()+600000,actor);return 'mg_session='+value;}
function call(path,{actor='alice',browser='one',method='GET',body,headers={}}={}){return new Promise((resolve,reject)=>{
 const jarKey=actor+':'+browser,cookies=jars.get(jarKey)??'',content=body===undefined?undefined:JSON.stringify(body);
 const req=request(base+path,{method,headers:{Host:'provider-runtime.example.test',Cookie:session(actor,browser)+(cookies?'; '+cookies:''),...(content?{Origin:origin,'Content-Type':'application/json','Content-Length':Buffer.byteLength(content)}:{}),...headers}},res=>{
  const saved=new Map(cookies.split('; ').filter(Boolean).map(value=>{const at=value.indexOf('=');return [value.slice(0,at),value.slice(at+1)];}));
  for(const value of res.headers['set-cookie']??[]){const first=value.split(';')[0],at=first.indexOf('=');if(at>0){const name=first.slice(0,at);if(name==='mg_provider_browser'||name.startsWith('__Secure-mg-provider-')){if(/Max-Age=0(?:;|$)/.test(value))saved.delete(name);else saved.set(name,first.slice(at+1));}}}
  jars.set(jarKey,[...saved].map(([name,value])=>name+'='+value).join('; '));
  const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{let json={};try{json=JSON.parse(Buffer.concat(chunks));}catch{}resolve({status:res.statusCode,json,headers:res.headers});});
 });req.on('error',reject);req.end(content);
});}
const prefix='/api/companies/company-a/bank',start=key=>call(prefix+'/provider-connections',{method:'POST',body:{bankId:'OPBKSE21',validUntil,requestKey:key}});
async function complete(response){
 assert.equal(response.status,201,JSON.stringify(response.json));const connection=response.json;
 const method=await call(prefix+'/provider-connections/'+connection.id+'/method',{method:'POST',body:{methodId:'mbid',revision:connection.revision}});assert.equal(method.status,200,JSON.stringify(method.json));
 const redirect=await call(method.json.redirectPath);assert.equal(redirect.status,302);const state=new URL(redirect.headers.location).searchParams.get('state');
 assert.equal((await call('/api/bank/callback?'+new URLSearchParams({code:'synthetic-complete-code',scope:'accountinformation corporate',state}))).status,302);
 const status=await call(prefix+'/provider-connections/'+connection.id);assert.equal(status.json.status,'accounts_required');
 const selected=await call(prefix+'/provider-connections/'+connection.id+'/accounts',{method:'POST',body:{revision:status.json.revision,accountIds:[status.json.accounts[0].id]}});assert.equal(selected.status,200,JSON.stringify(selected.json));assert.equal(selected.json.status,'connected');return selected.json;
}
after(async()=>{globalThis.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));controlPlane.emitDestroy();db.close();rmSync(directory,{recursive:true,force:true});});
test('disabled or missing provider settings expose safe stored status without bank work',async()=>{
 const off=await call(prefix+'/providers');assert.equal(off.status,200,JSON.stringify(off.json));assert.equal(off.json.providers[0].available,false);
 assert.equal((await call(prefix+'/provider-connections')).status,200);assert.equal((await start('disabled-start')).status,403);assert.equal(calls.length,0);
 process.env.MG_SAAS_ONBOARDING_ENABLED='true';const missing=await call(prefix+'/providers');assert.equal(missing.json.providers[0].configured,false);assert.equal((await start('missing-config')).status,403);assert.equal(calls.length,0);
 process.env.MG_OPENPAYMENTS_CONFIG=JSON.stringify(configuration);process.env.MG_COMPANY_BANK_REGISTRATIONS=JSON.stringify({version:1,bindings:[registration]});
});
test('nested lifecycle routes enforce exact company current role and bounded business inputs',async()=>{
 assert.equal((await call('/api/companies/company-b/bank/providers')).status,403);
 for(const actor of ['viewer','accountant']){assert.equal((await call(prefix+'/provider-connections',{actor})).status,200);assert.equal((await call(prefix+'/provider-connections',{actor,method:'POST',body:{bankId:'OPBKSE21',validUntil,requestKey:'role-test'}})).status,403);}
 assert.equal((await call(prefix+'/provider-connections',{method:'POST',body:{bankId:'OPBKSE21',validUntil,requestKey:'invalid',corporateId:'browser-proof'}})).status,400);assert.equal(calls.length,0);
 assert.equal((await call(prefix+'/provider-connections',{method:'POST',body:{bankId:'OPBKSE21',validUntil,requestKey:'invalid-origin'},headers:{Origin:'https://foreign.example.test'}})).status,403);
 assert.equal((await call(prefix+'/provider-connections',{method:'POST',body:{bankId:'OPBKSE21',validUntil,requestKey:'x'.repeat(17000)}})).status,413);
 assert.equal((await call(prefix+'/providers?provider=enable_banking')).status,400);assert.equal(calls.length,0);
});

test('a session lost while the nested JSON body streams prevents configuration and provider work',async()=>{
 let reached;const opening=new Promise(resolve=>{reached=resolve;}),marker='synthetic-body-stream';
 const observe=req=>{if(req.headers['x-test-provider-body']===marker)req.once('data',reached);};server.on('request',observe);
 const before=calls.length,content=JSON.stringify({bankId:'OPBKSE21',validUntil,requestKey:'synthetic-streamed-session'});let stream;
 const result=new Promise((resolve,reject)=>{
  stream=request(base+prefix+'/provider-connections',{method:'POST',headers:{Host:'provider-runtime.example.test',Origin:origin,Cookie:session('alice','streamed'),'Content-Type':'application/json','Transfer-Encoding':'chunked','x-test-provider-body':marker}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,json:JSON.parse(Buffer.concat(chunks))}));});stream.on('error',reject);
 });
 try{stream.write('{');await opening;runtime.controlDb.prepare('DELETE FROM sessions WHERE id_hash=?').run(digest('synthetic-alice-streamed'));stream.end(content.slice(1));assert.equal((await result).status,401);assert.equal(calls.length,before);}
 finally{server.off('request',observe);stream.destroy();}
});
test('actual SDK repository and manager retain private state while completing the HTTP lifecycle',async()=>{
 const banks=await call(prefix+'/open-payments/banks');assert.equal(banks.status,200,JSON.stringify(banks.json));assert.equal(banks.json.banks[0].id,'OPBKSE21');
 const response=await start('synthetic-http-start-0001');assert.equal(response.status,201,JSON.stringify(response.json));started=response.json;assert.equal(started.status,'authorization_required');assert.ok(response.headers['set-cookie']?.some(cookie=>/HttpOnly.*Secure|Secure.*HttpOnly/.test(cookie)));
 for(const secret of ['private-client-secret','private-corporate-id','private-psu-id','private-provider-token','synthetic-consent-1'])assert.equal(JSON.stringify(started).includes(secret),false);
 const method=await call(prefix+'/provider-connections/'+started.id+'/method',{method:'POST',body:{methodId:'mbid',revision:started.revision}});assert.equal(method.status,200,JSON.stringify(method.json));chosen=method.json;
 assert.equal(chosen.redirectPath,prefix+'/authorizations/'+chosen.flowId+'/redirect');
 const redirect=await call(chosen.redirectPath);assert.equal(redirect.status,302,JSON.stringify(redirect.json));const external=new URL(redirect.headers.location);assert.equal(external.origin,'https://oauth.sandbox.openbankingplatform.com');
 const parameters=new URLSearchParams({code:'synthetic-code',scope:'accountinformation corporate',state:external.searchParams.get('state')}),callback='/api/bank/callback?'+parameters;
 const beforeCallback=calls.length;
 for(const invalid of [callback+'&provider=enable_banking',callback+'&state='+external.searchParams.get('state'),callback.replace('scope=accountinformation+corporate','scope=payments')])assert.equal((await call(invalid)).status,403);
 assert.equal((await call(callback,{browser:'other'})).status,403);assert.equal(calls.length,beforeCallback);
 runtime.run(runtime.resolve({actorId:'alice'}),()=>assert.equal(db.prepare('SELECT session_hash FROM bank_states WHERE provider_flow_id=?').get(chosen.flowId).session_hash,digest('synthetic-alice-one')));
 const result=await call(callback);assert.equal(result.status,302,JSON.stringify(result.json));assert.ok(result.headers.location.startsWith('/?tab=connections'));assert.doesNotMatch(result.headers.location,/synthetic-code|state=/);
 assert.equal((await call(callback)).status,403);
 const status=await call(prefix+'/provider-connections/'+started.id);assert.equal(status.status,200,JSON.stringify(status.json));assert.equal(status.json.status,'accounts_required');assert.equal(status.json.accounts.length,1);
 connected=(await call(prefix+'/provider-connections/'+started.id+'/accounts',{method:'POST',body:{revision:status.json.revision,accountIds:[status.json.accounts[0].id]}})).json;assert.equal(connected.status,'connected');assert.equal(connected.paymentDataComplete,false);
 const retained=()=>runtime.run(runtime.resolve({actorId:'alice'}),()=>db.prepare('SELECT * FROM bank_provider_connections').all()),beforeReaders=retained(),beforeReads=calls.length;
 for(const actor of ['viewer','accountant']){const result=await call(prefix+'/provider-connections/'+started.id,{actor});assert.equal(result.status,200);assert.equal(result.json.status,'connected');}
 assert.deepEqual(retained(),beforeReaders);assert.equal(calls.length,beforeReads);
 runtime.run(runtime.resolve({actorId:'alice'}),()=>{for(const table of ['invoices','bank_transactions','allocations'])assert.equal(db.prepare('SELECT count(*) n FROM '+table).get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM bank_connections').get().n,0);});
});
test('stored connection collections return the same canonical usable handoff path as item responses',async()=>{
 const response=await start('synthetic-list-redirect'),connection=response.json;
 const chosen=await call(prefix+'/provider-connections/'+connection.id+'/method',{method:'POST',body:{methodId:'mbid',revision:connection.revision}});assert.equal(chosen.status,200,JSON.stringify(chosen.json));
 const listing=await call(prefix+'/provider-connections');assert.equal(listing.status,200);const retained=listing.json.connections.find(row=>row.id===connection.id);
 assert.equal(retained.redirectPath,chosen.json.redirectPath);assert.equal((await call(retained.redirectPath)).status,302);
});

test('two initial requests without a provider cookie retain independent flows in the same browser',async()=>{
 const browser='two-initial-tabs',headers={Cookie:session('alice',browser)},request=key=>call(prefix+'/provider-connections',{browser,headers,method:'POST',body:{bankId:'OPBKSE21',validUntil,requestKey:key}});
 const first=await request('synthetic-two-initial-a'),second=await request('synthetic-two-initial-b');assert.equal(first.status,201);assert.equal(second.status,201);
 for(const connection of [first.json,second.json]){
  const chosen=await call(prefix+'/provider-connections/'+connection.id+'/method',{browser,method:'POST',body:{methodId:'mbid',revision:connection.revision}});assert.equal(chosen.status,200,JSON.stringify(chosen.json));
  const navigation=await call(chosen.json.redirectPath,{browser});assert.equal(navigation.status,302);const state=new URL(navigation.headers.location).searchParams.get('state');
  const callback=await call('/api/bank/callback?'+new URLSearchParams({code:'synthetic-two-tab-code',scope:'accountinformation corporate',state}),{browser});assert.equal(callback.status,302,JSON.stringify(callback.json));
  assert.equal((await call(prefix+'/provider-connections/'+connection.id,{browser})).json.status,'accounts_required');
 }
});

test('stored status remains readable after disablement and secret rotation invalidates old handles',async()=>{
 const before=calls.length;process.env.MG_SAAS_ONBOARDING_ENABLED='false';const off=await call(prefix+'/provider-connections/'+started.id);assert.equal(off.status,200);assert.equal(off.json.onboardingAvailable,false);assert.equal(calls.length,before);
 process.env.MG_SAAS_ONBOARDING_ENABLED='true';process.env.MG_OPENPAYMENTS_CONFIG=JSON.stringify({...configuration,clientSecret:'rotated-private-client-secret'});
 const changed=await call(prefix+'/provider-connections/'+started.id);assert.equal(changed.status,200);assert.equal(changed.json.available,false);assert.equal(changed.json.error,'PROVIDER_GENERATION_CHANGED');assert.equal(calls.length,before);
 process.env.MG_OPENPAYMENTS_CONFIG=JSON.stringify(configuration);process.env.MG_SAAS_ONBOARDING_ENABLED='false';
 try{const revoked=await call(prefix+'/provider-connections/'+started.id+'/revoke',{method:'POST',body:{revision:connected.revision}});assert.equal(revoked.status,200,JSON.stringify(revoked.json));assert.equal(revoked.json.status,'revoked');}finally{process.env.MG_SAAS_ONBOARDING_ENABLED='true';}
});

test('disabling onboarding during an owned revoke preserves safe stop authority',async()=>{
 const connection=await complete(await start('synthetic-stop-existing')),before=calls.length;let changed=false;
 beforeRequest=url=>{if(url.pathname==='/connect/token'&&!changed){changed=true;process.env.MG_SAAS_ONBOARDING_ENABLED='false';}};
 try{const result=await call(prefix+'/provider-connections/'+connection.id+'/revoke',{method:'POST',body:{revision:connection.revision}});assert.equal(result.status,200,JSON.stringify(result.json));assert.equal(result.json.status,'revoked');assert.equal(changed,true);assert.ok(calls.slice(before).some(path=>path.startsWith('DELETE /psd2/consent/v1/consents/')));}
 finally{beforeRequest=undefined;process.env.MG_SAAS_ONBOARDING_ENABLED='true';}
});

test('owned renewal and explicit refresh use the real revision-fenced provider lifecycle',async()=>{
 const first=await complete(await start('synthetic-renew-first')),path=prefix+'/provider-connections/'+first.id,before=calls.length;
 assert.equal((await call(path+'/renew',{actor:'viewer',method:'POST',body:{bankId:'OPBKSE21',validUntil,requestKey:'synthetic-renew-denied',revision:first.revision}})).status,403);
 assert.equal((await call(path+'/renew',{method:'POST',body:{bankId:'OPBKSE21',validUntil,requestKey:'synthetic-renew-stale',revision:first.revision-1}})).status,409);assert.equal(calls.length,before);
 const renewed=await complete(await call(path+'/renew',{method:'POST',body:{bankId:'OPBKSE21',validUntil,requestKey:'synthetic-renew-next',revision:first.revision}}));assert.equal(renewed.id,first.id);assert.ok(renewed.revision>first.revision);
 assert.equal((await call(path+'/refresh',{actor:'accountant',method:'POST',body:{}})).status,403);assert.equal((await call(path+'/refresh',{method:'POST',body:{refresh:true}})).status,400);
 const refresh=await call(path+'/refresh',{method:'POST',body:{}});assert.equal(refresh.status,200,JSON.stringify(refresh.json));assert.equal(refresh.json.status,'connected');
 runtime.run(runtime.resolve({actorId:'alice'}),()=>assert.equal(db.prepare('SELECT count(*) n FROM bank_provider_grant_claims WHERE connection_id=?').get(first.id).n,2));
 const result=await call(path+'/revoke',{method:'POST',body:{revision:refresh.json.revision}});assert.equal(result.status,200);assert.equal(result.json.status,'revocation_pending');assert.equal(result.json.error,'PROVIDER_PREVIOUS_GRANTS_PENDING');
});
test('redirect navigation and callbacks retain their original company generation',async()=>{
 const pending=await start('synthetic-stale-flow-0002');assert.equal(pending.status,201);
 const method=await call(prefix+'/provider-connections/'+pending.json.id+'/method',{method:'POST',body:{revision:pending.json.revision,methodId:'mbid'}});assert.equal(method.status,200);
 const redirect=await call(method.json.redirectPath),state=new URL(redirect.headers.location).searchParams.get('state'),before=calls.length;
 const context=runtime.resolve({actorId:'alice'});runtime.selectActiveCompany({actorId:'alice',companyId:'company-b',contextVersion:context.contextVersion});runtime.selectActiveCompany({actorId:'alice',companyId:'company-a',contextVersion:context.contextVersion+1});
 assert.equal((await call(method.json.redirectPath)).status,409);assert.equal((await call('/api/bank/callback?'+new URLSearchParams({code:'synthetic-stale-code',scope:'accountinformation corporate',state}))).status,409);assert.equal(calls.length,before);
});

test('live credential authority and browser-session revocation stop provider work after an await',async()=>{
 const cases=[
  {name:'flag',change:()=>{process.env.MG_SAAS_ONBOARDING_ENABLED='false';},restore:()=>{process.env.MG_SAAS_ONBOARDING_ENABLED='true';}},
  {name:'secret',change:()=>{process.env.MG_OPENPAYMENTS_CONFIG=JSON.stringify({...configuration,clientSecret:'rotated-during-await'});},restore:()=>{process.env.MG_OPENPAYMENTS_CONFIG=JSON.stringify(configuration);}},
  {name:'membership',change:()=>runtime.setMembership({companyId:'company-a',actorId:'alice',role:'viewer'}),restore:()=>runtime.setMembership({companyId:'company-a',actorId:'alice',role:'owner'})},
  {name:'session',change:()=>runtime.controlDb.prepare('DELETE FROM sessions WHERE id_hash=?').run(digest('synthetic-alice-one')),restore:()=>{}},
 ];
 for(const scenario of cases){
  let changed=false;beforeRequest=url=>{if(url.pathname==='/connect/token'&&!changed){changed=true;controlPlane.runInAsyncScope(scenario.change);}};
  const before=calls.length;
  try{const result=await start('synthetic-await-'+scenario.name);assert.ok([401,403,409].includes(result.status),scenario.name+': '+JSON.stringify(result.json));assert.equal(changed,true);assert.deepEqual(calls.slice(before),['POST /connect/token']);}
  finally{beforeRequest=undefined;scenario.restore();}
 }
 runtime.run(runtime.resolve({actorId:'alice'}),()=>{assert.equal(db.prepare("SELECT count(*) n FROM bank_provider_connections WHERE status='connected'").get().n,0);for(const table of ['invoices','bank_transactions','allocations'])assert.equal(db.prepare('SELECT count(*) n FROM '+table).get().n,0);});
});

test('production is unavailable without actual native mTLS even with an attested company registration',async()=>{
 const before=calls.length;process.env.MG_OPENPAYMENTS_CONFIG=JSON.stringify({...configuration,environment:'PRODUCTION'});process.env.MG_COMPANY_BANK_REGISTRATIONS=JSON.stringify({version:1,bindings:[{...registration,environment:'PRODUCTION',productionTransportVerified:true}]});
 try{const status=await call(prefix+'/providers');assert.equal(status.status,200);assert.equal(status.json.providers[0].available,false);assert.equal(status.json.providers[0].reason,'transport_required');assert.equal((await start('synthetic-production-unavailable')).status,403);assert.equal(calls.length,before);}
 finally{process.env.MG_OPENPAYMENTS_CONFIG=JSON.stringify(configuration);process.env.MG_COMPANY_BANK_REGISTRATIONS=JSON.stringify({version:1,bindings:[registration]});}
});
