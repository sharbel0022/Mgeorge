import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {OpenPaymentsProvider} from '../lib/banking/openpayments-provider.js';
import {companyCacheKey} from '../lib/company-contract.js';
import {NOW,CONFIG,CONTEXT,CONSENT_ID,AUTH_ID,ACCOUNT,codec,fixtureTransport,json} from './helpers/openpayments-fixture.mjs';

const target=new URL('../lib/banking/company-provider-manager.js',import.meta.url);
const implementation=existsSync(target)?await import(target):null;
const browser={cookie:'synthetic-browser-cookie',session:'synthetic-authenticated-session'};
const pin={version:'company-context-v1',companyId:'company-a',storageOwner:'owner-a',actorId:'actor-a',role:'owner',membershipVersion:1,companyVersion:1,contextVersion:1};
const input={bankId:'OPBKSE21',validUntil:'2026-12-01',requestKey:'synthetic-request-key-0001',browser};
const hash=value=>createHash('sha256').update(value).digest('hex');
const failure=code=>Object.assign(new Error(code),{code});
const copy=value=>value==null?value:structuredClone(value);

function redirectResponse(consentId=CONSENT_ID){
 const parameters=new URLSearchParams({client_id:'[CLIENT_ID]',scope:'accountinformation corporate',response_type:'code',redirect_uri:'[TPP_REDIRECT_URI]',state:'[TPP_STATE]',acr_values:`idp:OPBKSE21 consentId:${consentId} ConsentAuthorisationId:${AUTH_ID}`});
 return json({scaStatus:'started',_links:{scaOAuth:{href:'https://oauth.sandbox.openbankingplatform.com/connect/authorize?'+parameters}}},200,{'aspsp-sca-approach':'REDIRECT'});
}
function fixture(options={}){
 assert.equal(typeof implementation?.createCompanyProviderManager,'function','the real scoped provider manager must be implemented');
 const f={context:copy(pin),active:true,time:NOW,rows:new Map(),flows:new Map(),grants:new Map(),held:new Map(),writes:0,consumptions:0,beforeCommit:null};
 const transport=fixtureTransport({[`PUT /psd2/consent/v1/consents/${CONSENT_ID}/authorisations/${AUTH_ID}`]:()=>redirectResponse(),...options.transport});
 f.calls=transport.calls;
 f.assertCurrent=async(context,action)=>{
  if(!f.active||companyCacheKey(context)!==companyCacheKey(f.context))throw failure('COMPANY_AUTHORIZATION_CHANGED');
  if(action==='manage_integrations'&&!['owner','admin'].includes(context.role))throw failure('COMPANY_FORBIDDEN');
 };
 const inScope=(context,row)=>row&&row.owner===context.storageOwner&&(row.company_id??row.companyId)===context.companyId;
 f.repository={
  async listConnections(context){await f.assertCurrent(context,'read');return [...f.rows.values()].filter(row=>inScope(context,row)).map(copy);},
  async getConnection(context,id){await f.assertCurrent(context,'read');const row=f.rows.get(id);return inScope(context,row)?copy(row):null;},
  async findFlowByRequestKey(context,key){await f.assertCurrent(context,'read');return copy([...f.flows.values()].find(row=>inScope(context,row)&&row.requestKeyHash===key)||null);},
  async getFlow(context,id){await f.assertCurrent(context,'read');const row=f.flows.get(id);return inScope(context,row)?copy(row):null;},
  async commit(context,change,lease){
   await lease.assert();await f.assertCurrent(context,'manage_integrations');
   if(f.beforeCommit)await f.beforeCommit(change);
   const previous=f.rows.get(change.connection.id);
   if(change.expectedRevision===null?previous!==undefined:!inScope(context,previous)||previous.revision!==change.expectedRevision)throw failure('PROVIDER_REVISION_CONFLICT');
   assert.equal(change.connection.revision,(change.expectedRevision??0)+1);
   assert.equal(inScope(context,change.connection),true);
   const grant=change.connection.grant_fingerprint;
   if(grant&&f.grants.has(grant)&&f.grants.get(grant)!==change.connection.id)throw failure('PROVIDER_GRANT_REUSED');
   if(change.flow){
    const old=f.flows.get(change.flow.id);
    if(change.expectedFlowStatus===undefined){
     if(old||[...f.flows.values()].some(row=>inScope(context,row)&&row.requestKeyHash===change.flow.requestKeyHash))throw failure('PROVIDER_REQUEST_CONFLICT');
    }else if(!inScope(context,old)||old.status!==change.expectedFlowStatus)throw failure('PROVIDER_REVISION_CONFLICT');
   }
   await lease.assert();await f.assertCurrent(context,'manage_integrations');
   f.rows.set(change.connection.id,copy(change.connection));if(change.flow)f.flows.set(change.flow.id,copy(change.flow));if(grant)f.grants.set(grant,change.connection.id);f.writes++;
  },
  async consumeFlow(context,expected,lease){
   await lease.assert();await f.assertCurrent(context,'manage_integrations');
   const row=f.flows.get(expected.id);
   if(!inScope(context,row)||row.status!=='pending'||row.stateHash!==expected.stateHash||row.browserHash!==expected.browserHash||row.encryptedPayload!==expected.expectedPayload||Date.parse(row.expiresAt)<=f.time||companyCacheKey(row.initiatingContext)!==companyCacheKey(context))return false;
   row.status='used';f.consumptions++;return true;
  },
 };
 f.withBankLock=async(owner,run)=>{
  if(f.held.has(owner))throw failure('BANK_BUSY');const token=crypto.randomUUID();f.held.set(owner,token);
  const lease={async assert(){if(f.held.get(owner)!==token)throw failure('BANK_LEASE_LOST');},fence(){return {owner,token};}};
  try{return await run(lease);}finally{if(f.held.get(owner)===token)f.held.delete(owner);}
 };
 const provider=new OpenPaymentsProvider(CONFIG,{transport:transport.transport,now:()=>f.time});
 f.options={provider,repository:f.repository,codec,currentContext:()=>copy(f.context),assertCurrent:f.assertCurrent,
  registration:()=>({verified:true,companyId:f.context.companyId,owner:f.context.storageOwner,evidenceId:'synthetic-corporate-registration',environment:'SANDBOX',appGeneration:'g1',validUntil:'2026-12-10T12:00:00Z',corporateId:CONTEXT.corporateId,psuId:CONTEXT.psuId,psu:CONTEXT.psu,redirectUri:CONFIG.redirectUris[0],...f.registrationPatch}),
  withBankLock:f.withBankLock,onboardingEnabled:true,now:()=>f.time,hash,...options.manager};
 f.manager=implementation.createCompanyProviderManager(f.options);
 f.start=overrides=>f.manager.start({...input,...overrides});
 f.authorize=async()=>{
  const started=await f.start();
  const chosen=await f.manager.chooseMethod({connectionId:started.id,revision:started.revision,methodId:'mbid',browser});
  let redirect;
  await f.manager.withRedirect({flowId:chosen.flowId,browser},value=>{redirect=value;});
  const state=new URL(redirect).searchParams.get('state');
  const parameters=new URLSearchParams({code:'synthetic-authorization-code',scope:'accountinformation corporate',state});
  return {started,chosen,parameters};
 };
 f.connected=async()=>{const flow=await f.authorize();return f.manager.callback({flowId:flow.chosen.flowId,parameters:flow.parameters,browser});};
 return f;
}

test('missing enablement and unverified corporate registration cannot start external work',async()=>{
 for(const manager of [{onboardingEnabled:false},{registration:()=>null},{registration:()=>({verified:false})}]){
  const f=fixture({manager});await assert.rejects(f.start());assert.equal(f.calls.length,0);assert.equal(f.rows.size,0);
 }
});
test('application discovery uses actual ASPSP data without a selected or invented BIC',async()=>{
 const f=fixture(),result=await f.manager.discoverBanks({countries:['SE']});
 assert.deepEqual(result,{provider:'open_payments',banks:[{id:'OPBKSE21',name:'Synthetic Demo Bank'}],payments:'disabled'});
 const call=f.calls.find(call=>new URL(call.url).pathname.endsWith('/aspsps'));
 assert.equal(call.init.headers.get('X-BicFi'),null);assert.equal(call.init.headers.get('PSU-ID'),null);
});
test('start retains encrypted company provenance and exact request replay creates one consent',async()=>{
 const f=fixture(),first=await f.start(),again=await f.start();
 assert.equal(first.status,'authorization_required');assert.equal(again.id,first.id);assert.equal(f.rows.size,1);assert.equal(f.flows.size,1);
 assert.equal(f.calls.filter(call=>call.init.method==='POST'&&new URL(call.url).pathname.endsWith('/consents')).length,1);
 const row=f.rows.get(first.id);assert.equal(row.selected_accounts,'[]');assert.equal(row.status,'authorization_required');
 for(const secret of [CONSENT_ID,CONTEXT.corporateId,CONTEXT.psuId,'synthetic-authorization-code',ACCOUNT.iban,'https://'])assert.ok(!JSON.stringify(first).includes(secret));
 assert.ok(!row.encrypted_state.includes(CONSENT_ID));assert.ok(!JSON.stringify([...f.flows.values()]).includes('synthetic-browser-cookie'));
 await assert.rejects(f.start({validUntil:'2026-12-02'}),{code:'PROVIDER_REQUEST_CONFLICT'});
});
test('separate requests retain independent connections instead of overwriting the owner bank row',async()=>{
 const secondConsent='44444444-4444-4444-8444-444444444444';let creations=0;
 const f=fixture({transport:{'POST /psd2/consent/v1/consents':()=>json({consentId:creations++?secondConsent:CONSENT_ID,consentStatus:'received'},201),[`POST /psd2/consent/v1/consents/${secondConsent}/authorisations`]:()=>json({authorisationId:AUTH_ID,scaStatus:'received',scaMethods:[{authenticationMethodId:'mbid',authenticationType:'PUSH_OTP',name:'Synthetic BankID'}]},201)}}),first=await f.start(),second=await f.start({requestKey:'synthetic-request-key-0002'});
 assert.notEqual(first.id,second.id);assert.equal(f.rows.size,2);assert.equal([...f.rows.values()].every(row=>row.owner==='owner-a'&&row.company_id==='company-a'),true);
});
test('selection change during consent creation rejects the late result without activating it',async()=>{
 let f;f=fixture({transport:{'POST /psd2/consent/v1/consents':()=>{f.context.contextVersion++;return json({consentId:CONSENT_ID,consentStatus:'received'},201);}}});
 await assert.rejects(f.start());assert.equal([...f.rows.values()][0].status,'creating');assert.equal([...f.rows.values()][0].selected_accounts,'[]');
});
test('repository CAS conflict rejects consent progression without accepting another writer',async()=>{
 const f=fixture();f.beforeCommit=change=>{if(change.expectedRevision!==null)f.rows.get(change.connection.id).revision++;};
 await assert.rejects(f.start(),{code:'PROVIDER_REVISION_CONFLICT'});assert.notEqual([...f.rows.values()][0].status,'connected');
});
test('provider URL and state stay private while the UI receives only an internal handoff path',async()=>{
 const f=fixture(),{chosen,parameters}=await f.authorize();
 assert.equal(chosen.status,'pending_authorization');assert.match(chosen.redirectPath,/^\/api\/bank\/providers\/redirect\?flowId=/);
 for(const secret of ['https://','connect/authorize',parameters.get('state'),CONSENT_ID])assert.ok(!JSON.stringify(chosen).includes(secret));
 await assert.rejects(f.manager.withRedirect({flowId:chosen.flowId,browser:{...browser,session:'other-session'}},()=>assert.fail('foreign browser received provider URL')));
});
test('an asynchronous redirect controller cannot publish after its company selection changes',async()=>{
 const f=fixture(),{chosen}=await f.authorize();
 await assert.rejects(f.manager.withRedirect({flowId:chosen.flowId,browser},async()=>{f.context.contextVersion++;return 'private redirect response';}));
});
test('callback is consumed once before activation and same-state replay cannot issue another token',async()=>{
 const f=fixture(),{chosen,parameters}=await f.authorize();
 const result=await f.manager.callback({flowId:chosen.flowId,parameters,browser});
 assert.equal(result.status,'accounts_required');assert.equal(f.consumptions,1);assert.equal(result.accounts.length,1);
 const count=f.calls.length;await assert.rejects(f.manager.callback({flowId:chosen.flowId,parameters,browser}));assert.equal(f.calls.length,count);
 const activation=f.calls.find(call=>new URLSearchParams(call.init.body).get('grant_type')==='authorization_code');assert.ok(activation);
});
test('callback validates provider-specific parameters rather than accepting a generic OAuth alias',async()=>{
 const f=fixture(),{chosen,parameters}=await f.authorize();
 for(const mutate of [p=>p.append('state',p.get('state')),p=>p.set('scope','accountinformation corporate paymentinitiation'),p=>p.set('provider','open_payments'),p=>p.set('state','wrong-state'),p=>p.set('code','not an opaque code')]){
  const bad=new URLSearchParams(parameters);mutate(bad);await assert.rejects(f.manager.callback({flowId:chosen.flowId,parameters:bad,browser}));
 }
 assert.equal(f.consumptions,0);
 assert.equal(f.rows.get(chosen.id).status,'pending_authorization');
});
test('actor, company, membership and selection switches invalidate pending callback provenance',async()=>{
 for(const patch of [{actorId:'actor-b'},{companyId:'company-b',storageOwner:'owner-b'},{membershipVersion:2},{companyVersion:2},{contextVersion:2}]){
  const f=fixture(),{chosen,parameters}=await f.authorize();Object.assign(f.context,patch);
  await assert.rejects(f.manager.callback({flowId:chosen.flowId,parameters,browser}));assert.equal(f.consumptions,0);
 }
});
test('an ambiguous callback activation remains reviewable and cannot be replayed',async()=>{
 let activated=false;
 const f=fixture({transport:{'POST /connect/token':(url,init)=>{const form=new URLSearchParams(init.body);if(form.get('grant_type')==='authorization_code'){activated=true;throw Error('lost activation response');}return json({access_token:'synthetic-app-token',token_type:'Bearer',expires_in:3600,scope:form.get('scope')});}}});
 const {chosen,parameters}=await f.authorize();await assert.rejects(f.manager.callback({flowId:chosen.flowId,parameters,browser}));
 assert.equal(activated,true);assert.equal(f.consumptions,1);assert.equal(f.rows.get(chosen.id).status,'review');
 await assert.rejects(f.manager.callback({flowId:chosen.flowId,parameters,browser}));assert.equal(f.consumptions,1);
});
test('a later authorized company reader can see status without impersonating the consent initiator',async()=>{
 const f=fixture(),connection=await f.connected(),writes=f.writes,calls=f.calls.length;
 f.context={...f.context,actorId:'reader-b',role:'viewer',membershipVersion:9,contextVersion:5};
 const result=await f.manager.status({connectionId:connection.id});
 assert.equal(result.id,connection.id);assert.equal(f.writes,writes);assert.equal(f.calls.length,calls);
 await assert.rejects(f.manager.selectAccounts({connectionId:connection.id,revision:result.revision,accountIds:[result.accounts[0].id]}));
});
test('account selection accepts retained opaque selectors but withholds company and Bankgiro proof',async()=>{
 const f=fixture(),connection=await f.connected(),id=connection.accounts[0].id;
 await assert.rejects(f.manager.selectAccounts({connectionId:connection.id,revision:connection.revision,accountIds:[ACCOUNT.resourceId]}));
 const result=await f.manager.selectAccounts({connectionId:connection.id,revision:connection.revision,accountIds:[id]});
 assert.equal(result.status,'connected');assert.equal(result.accounts[0].selected,true);assert.equal(result.accounts[0].companyAccountVerified,false);assert.equal(result.accounts[0].bankgiroMappingVerified,false);
 for(const value of [ACCOUNT.iban,ACCOUNT.name,ACCOUNT.resourceId,ACCOUNT.bankgiroNumber])assert.ok(!JSON.stringify(result).includes(value));
});
test('expiry is a read-only derived status and disables subsequent provider acquisition',async()=>{
 const f=fixture(),connection=await f.connected(),before=f.writes;f.time=Date.parse('2027-01-01T12:00:00Z');
 const result=await f.manager.status({connectionId:connection.id});assert.equal(result.status,'expired');assert.equal(f.writes,before);
 await assert.rejects(f.manager.acquireTransactions({connectionId:connection.id,accountId:connection.accounts[0].id,dateFrom:'2026-11-01',dateTo:'2026-11-04'},()=>assert.fail('expired acquisition')));
});
test('uncertain revoke is durably held before DELETE and cannot be reported revoked',async()=>{
 let f;f=fixture({transport:{[`DELETE /psd2/consent/v1/consents/${CONSENT_ID}`]:()=>{assert.equal([...f.rows.values()][0].status,'revocation_pending');throw Error('lost bank response');}}});
 const connection=await f.connected();await assert.rejects(f.manager.revoke({connectionId:connection.id,revision:connection.revision}));
 assert.equal(f.rows.get(connection.id).status,'revocation_pending');assert.equal((await f.manager.status({connectionId:connection.id})).status,'revocation_pending');
});
test('renewal retains previous evidence and holds the old connection during uncertain new consent',async()=>{
 const f=fixture(),connection=await f.connected();
 const originalKey=f.rows.get(connection.id).request_key_hash;
 const renewed=await f.start({requestKey:'synthetic-renewal-request',renewConnectionId:connection.id,expectedRevision:connection.revision});
 assert.equal(renewed.id,connection.id);assert.equal(f.rows.size,1);assert.equal(renewed.status,'authorization_required');assert.equal(renewed.accounts.length,0);
 assert.equal(f.rows.get(connection.id).request_key_hash,originalKey);
});
test('a same-ID renewal cannot change immutable bank, environment or provider generation',async()=>{
 for(const patch of [{bankId:'ESSESESS'},{registration:{environment:'PRODUCTION',productionTransportVerified:true}},{registration:{appGeneration:'g2'}}]){
  const f=fixture(),connection=await f.connected(),calls=f.calls.length,writes=f.writes;f.registrationPatch=patch.registration;
  await assert.rejects(f.start({bankId:patch.bankId??input.bankId,requestKey:'changed-binding-renewal',renewConnectionId:connection.id,expectedRevision:connection.revision}),{code:'PROVIDER_RENEWAL_IDENTITY_CHANGED'});
  assert.equal(f.calls.length,calls);assert.equal(f.writes,writes);
 }
});
test('private acquisition cannot become public JSON and cannot claim committed sync without a receipt',async()=>{
 const f=fixture(),connection=await f.connected();
 const selected=await f.manager.selectAccounts({connectionId:connection.id,revision:connection.revision,accountIds:[connection.accounts[0].id]});
 const result=await f.manager.acquireTransactions({connectionId:selected.id,accountId:selected.accounts[0].id,dateFrom:'2026-11-01',dateTo:'2026-11-04'},async(data,guard)=>{
  await guard.assertCurrent();await guard.lease.assert();assert.equal(data.booked[0].remittanceInformationStructured,'0599');assert.equal(data.paymentReconciliationAllowed,false);
  assert.throws(()=>JSON.stringify(data),/PRIVATE_PROVIDER_DATA/);
 });
 assert.deepEqual(result,{status:'acquired',bookedCount:1,bankgiroCount:0,committed:false,paymentReconciliationAllowed:false});assert.equal(f.rows.get(selected.id).last_synced_at,'');
});
test('acquisition discards a late response after revocation and rejects a fabricated receipt scope',async()=>{
 const f=fixture(),connection=await f.connected(),selected=await f.manager.selectAccounts({connectionId:connection.id,revision:connection.revision,accountIds:[connection.accounts[0].id]});
 await assert.rejects(f.manager.acquireTransactions({connectionId:selected.id,accountId:selected.accounts[0].id,dateFrom:'2026-11-01',dateTo:'2026-11-04'},()=>({version:'provider-acquisition-receipt-v1',id:'receipt',companyId:'wrong-company',connectionId:selected.id,accountId:selected.accounts[0].id,sha256:'a'.repeat(64),committedAt:'2026-11-04T12:00:00Z'})),{code:'PROVIDER_RECEIPT_INVALID'});
 let release;const gate=new Promise(resolve=>{release=resolve;});
 const running=f.manager.acquireTransactions({connectionId:selected.id,accountId:selected.accounts[0].id,dateFrom:'2026-11-01',dateTo:'2026-11-04'},async(data,guard)=>{await gate;await guard.assertCurrent();});
 await new Promise(resolve=>setImmediate(resolve));f.active=false;release();await assert.rejects(running);
});

test('start captures bank and browser request fields before its first asynchronous guard',async()=>{
 const f=fixture(),request={...input,browser:{...browser}},running=f.manager.start(request);
 request.bankId='ESSESESS';request.browser.session='replaced-session';
 const result=await running;assert.equal(result.bank.id,'OPBKSE21');
 const chosen=await f.manager.chooseMethod({connectionId:result.id,revision:result.revision,methodId:'mbid',browser});assert.equal(chosen.status,'pending_authorization');
});
test('corporate registration cannot change during an account request and still publish those accounts',async()=>{
 let f;f=fixture({transport:{'GET /psd2/accountinformation/v1/accounts':()=>{f.registrationPatch={psuId:'replacement-psu'};return json({accounts:[ACCOUNT]});}}});
 const {chosen,parameters}=await f.authorize();await assert.rejects(f.manager.callback({flowId:chosen.flowId,parameters,browser}));
 assert.equal(f.rows.get(chosen.id).status,'review');assert.equal(JSON.parse(f.rows.get(chosen.id).selected_accounts).length,0);
});
test('application discovery refuses a provider environment different from the trusted production registration',async()=>{
 const f=fixture();f.registrationPatch={environment:'PRODUCTION',productionTransportVerified:true};
 await assert.rejects(f.manager.discoverBanks());assert.equal(f.calls.length,0);
});
test('refresh preserves selected public account identity while retaining fresh provider handles privately',async()=>{
 const f=fixture(),connection=await f.connected(),selected=await f.manager.selectAccounts({connectionId:connection.id,revision:connection.revision,accountIds:[connection.accounts[0].id]});
 const result=await f.manager.status({connectionId:selected.id,refresh:true});assert.equal(result.status,'connected');assert.equal(result.accounts[0].id,selected.accounts[0].id);assert.equal(result.accounts[0].selected,true);
});
test('disabled new onboarding preserves owned status, authorized acquisition and revocation',async()=>{
 const f=fixture(),connection=await f.connected(),selected=await f.manager.selectAccounts({connectionId:connection.id,revision:connection.revision,accountIds:[connection.accounts[0].id]}),count=f.calls.length,writes=f.writes;
 const manager=implementation.createCompanyProviderManager({...f.options,onboardingEnabled:false});
 const stored=await manager.status({connectionId:connection.id});assert.equal(stored.available,true);assert.equal(stored.onboardingAvailable,false);assert.equal(f.calls.length,count);assert.equal(f.writes,writes);
 await assert.rejects(manager.discoverBanks());await assert.rejects(manager.start({...input,requestKey:'disabled-renewal',renewConnectionId:selected.id,expectedRevision:selected.revision}));assert.equal(f.calls.length,count);
 const acquired=await manager.acquireTransactions({connectionId:selected.id,accountId:selected.accounts[0].id,dateFrom:'2026-11-01',dateTo:'2026-11-04'},()=>{});assert.equal(acquired.bookedCount,1);assert.equal(acquired.committed,false);
 const refreshed=await manager.status({connectionId:selected.id,refresh:true});assert.equal(refreshed.status,'connected');
 const revoked=await manager.revoke({connectionId:refreshed.id,revision:refreshed.revision});assert.equal(revoked.status,'revoked');assert.equal(revoked.onboardingAvailable,false);
});
test('a live onboarding switch blocks pending activation before side effects and hides its navigation',async()=>{
 let enabled=true;const f=fixture({manager:{onboardingEnabled:async()=>enabled}}),{chosen,parameters}=await f.authorize();enabled=false;
 const calls=f.calls.length,writes=f.writes,stored=await f.manager.status({connectionId:chosen.id});assert.equal(stored.available,false);assert.equal(stored.onboardingAvailable,false);assert.equal(stored.flowId,undefined);assert.equal(stored.redirectPath,undefined);
 for(const invoke of [()=>f.manager.withRedirect({flowId:chosen.flowId,browser},()=>assert.fail('disabled redirect')),()=>f.manager.callback({flowId:chosen.flowId,browser,parameters}),()=>f.manager.status({connectionId:chosen.id,refresh:true})])await assert.rejects(invoke(),{code:'PROVIDER_UNAVAILABLE'});
 assert.equal(f.calls.length,calls);assert.equal(f.writes,writes);assert.equal(f.consumptions,0);
 assert.equal((await f.manager.revoke({connectionId:chosen.id,revision:chosen.revision})).status,'revoked');
});
test('disabling onboarding during consent creation retains uncertainty without claiming or activating the new grant',async()=>{
 let enabled=true;const f=fixture({manager:{onboardingEnabled:async()=>enabled},transport:{'POST /psd2/consent/v1/consents':()=>{enabled=false;return json({consentId:CONSENT_ID,consentStatus:'received'},201);}}});
 await assert.rejects(f.start());assert.equal(f.rows.size,1);assert.equal([...f.rows.values()][0].status,'creating');assert.equal(f.grants.size,0);
 assert.equal(f.calls.some(call=>new URL(call.url).pathname.endsWith('/authorisations')),false);
});
test('stored status distinguishes a retired provider generation from a currently usable connection',async()=>{
 const f=fixture(),connection=await f.connected(),calls=f.calls.length,writes=f.writes;
 f.registrationPatch={appGeneration:'g2'};const result=await f.manager.status({connectionId:connection.id});
 assert.equal(result.available,false);assert.equal(result.status,'review');assert.equal(result.error,'PROVIDER_GENERATION_CHANGED');assert.equal(f.calls.length,calls);assert.equal(f.writes,writes);
});
test('confirmed revocation remains idempotent and clears selection without deleting retained originals',async()=>{
 const f=fixture(),connection=await f.connected(),revoked=await f.manager.revoke({connectionId:connection.id,revision:connection.revision});
 assert.equal(revoked.status,'revoked');assert.equal(f.flows.size,1);assert.ok(f.rows.get(connection.id).encrypted_state);
 const count=f.calls.length;assert.equal((await f.manager.revoke({connectionId:connection.id,revision:revoked.revision})).status,'revoked');assert.equal(f.calls.length,count);
});
test('a failed durable single-use transition prevents provider token activation',async()=>{
 const f=fixture(),{chosen,parameters}=await f.authorize();f.repository.consumeFlow=async()=>false;
 await assert.rejects(f.manager.callback({flowId:chosen.flowId,parameters,browser}));
 assert.equal(f.calls.filter(call=>new URLSearchParams(call.init.body).get('grant_type')==='authorization_code').length,0);assert.equal(f.rows.get(chosen.id).status,'review');
});
test('expired pending flow reports a held state without performing provider maintenance',async()=>{
 const f=fixture(),{chosen,parameters}=await f.authorize(),calls=f.calls.length,writes=f.writes;f.time+=600_001;
 const result=await f.manager.status({connectionId:chosen.id});assert.equal(result.status,'review');assert.equal(result.error,'PROVIDER_FLOW_EXPIRED');assert.equal(f.writes,writes);
 await assert.rejects(f.manager.callback({flowId:chosen.flowId,parameters,browser}));await f.manager.status({connectionId:chosen.id,refresh:true});assert.equal(f.calls.length,calls);
});
test('public projection cannot disclose retained exception text or payer-like SCA method labels',async()=>{
 const privateLabel='Synthetic Individual Person';
 const f=fixture({transport:{[`POST /psd2/consent/v1/consents/${CONSENT_ID}/authorisations`]:()=>json({authorisationId:AUTH_ID,scaStatus:'received',scaMethods:[{authenticationMethodId:'mbid',authenticationType:'PUSH_OTP',name:privateLabel}]},201)}});
 const connection=await f.start();assert.ok(!JSON.stringify(connection).includes(privateLabel));
 f.rows.get(connection.id).last_error='token=private-exception person=19121212-1212';
 const result=await f.manager.status({connectionId:connection.id});assert.ok(!JSON.stringify(result).includes('private-exception'));assert.equal(result.error,'PROVIDER_OPERATION_FAILED');
});
test('a durable consumer receipt is required for a committed acquisition result and does not itself advance a cursor',async()=>{
 const f=fixture(),connection=await f.connected(),selected=await f.manager.selectAccounts({connectionId:connection.id,revision:connection.revision,accountIds:[connection.accounts[0].id]});
 const retained=new Map();
 const result=await f.manager.acquireTransactions({connectionId:selected.id,accountId:selected.accounts[0].id,dateFrom:'2026-11-01',dateTo:'2026-11-04'},async(data,guard)=>{
  await guard.assertCurrent();const receipt={version:'provider-acquisition-receipt-v1',id:'synthetic-durable-acquisition',companyId:'company-a',connectionId:data.connectionId,accountId:data.accountId,sha256:hash(JSON.stringify(data.originals)),committedAt:'2026-11-04T12:00:00Z'};
  retained.set(receipt.id,{receipt,originals:copy(data.originals)});return receipt;
 });
 assert.equal(result.committed,true);assert.equal(retained.has(result.receiptId),true);assert.equal(f.rows.get(selected.id).last_synced_at,'');
});

for(const [field,patch]of [
 ['corporate identity',{corporateId:'synthetic-replacement-corporate'}],
 ['PSU identity',{psuId:'synthetic-replacement-psu'}],
 ['evidence receipt',{evidenceId:'synthetic-replacement-registration'}],
 ['corporate identity type',{corporateIdType:'ORGANISATION'}],
 ['affiliated bank',{affiliatedAspspId:'synthetic-other-affiliation'}],
 ['trusted PSU metadata',{psu:{...CONTEXT.psu,ipAddress:'198.51.100.31'}}],
 ['registered callback',{redirectUri:'https://app.example.test/replaced-callback'}],
 ['registration expiry',{validUntil:'2026-12-09T12:00:00Z'}],
])test('durable acquisition guard rejects replaced '+field+' before a consumer can commit',async()=>{
 const f=fixture(),connection=await f.connected(),selected=await f.manager.selectAccounts({connectionId:connection.id,revision:connection.revision,accountIds:[connection.accounts[0].id]});
 const writes=f.writes;let committed=false;
 await assert.rejects(f.manager.acquireTransactions({connectionId:selected.id,accountId:selected.accounts[0].id,dateFrom:'2026-11-01',dateTo:'2026-11-04'},async(data,guard)=>{
  f.registrationPatch=patch;await guard.assertCurrent();committed=true;
  return {version:'provider-acquisition-receipt-v1',id:'synthetic-stale-receipt',companyId:'company-a',connectionId:data.connectionId,accountId:data.accountId,sha256:hash(JSON.stringify(data.originals)),committedAt:'2026-11-04T12:00:00Z'};
 }),{code:'PROVIDER_GENERATION_CHANGED'});
 assert.equal(committed,false);assert.equal(f.writes,writes);assert.equal(f.rows.get(selected.id).last_synced_at,'');
 const status=await f.manager.status({connectionId:selected.id});assert.equal(status.available,false);assert.equal(status.status,'review');
});

test('durable acquisition guard rechecks row revision after awaiting a trusted registration read',async()=>{
 const f=fixture(),connection=await f.connected(),selected=await f.manager.selectAccounts({connectionId:connection.id,revision:connection.revision,accountIds:[connection.accounts[0].id]});
 let changeDuringRead=false,committed=false;const original=f.options.registration;
 const manager=implementation.createCompanyProviderManager({...f.options,async registration(context){
  const value=original(context);if(changeDuringRead){changeDuringRead=false;f.rows.get(selected.id).revision++;}return value;
 }});
 await assert.rejects(manager.acquireTransactions({connectionId:selected.id,accountId:selected.accounts[0].id,dateFrom:'2026-11-01',dateTo:'2026-11-04'},async(_data,guard)=>{
  changeDuringRead=true;await guard.assertCurrent();committed=true;
 }),{code:'PROVIDER_REVISION_CONFLICT'});assert.equal(committed,false);
});
for(const during of ['consumer','registration','row read'])test('durable acquisition guard rejects bank-effective consent expiry during '+during+' before commit',async()=>{
 let validUntil='2026-12-01';const f=fixture({transport:{[`GET /psd2/consent/v1/consents/${CONSENT_ID}`]:()=>json({consentStatus:'valid',validUntil,access:{}})}}),connection=await f.connected(),selected=await f.manager.selectAccounts({connectionId:connection.id,revision:connection.revision,accountIds:[connection.accounts[0].id]});
 let changeDuringAwait=false,committed=false;const registration=f.options.registration,getConnection=f.repository.getConnection;
 const manager=implementation.createCompanyProviderManager({...f.options,async registration(context){const result=registration(context);if(changeDuringAwait&&during==='registration'){changeDuringAwait=false;f.time+=20;}return result;}});
 f.repository.getConnection=async(...args)=>{const row=await getConnection(...args);if(changeDuringAwait&&during==='row read'){changeDuringAwait=false;f.time+=20;}return row;};
 f.time=Date.parse('2026-11-04T23:59:59.990Z');validUntil='2026-11-04';const writes=f.writes;
 await assert.rejects(manager.acquireTransactions({connectionId:selected.id,accountId:selected.accounts[0].id,dateFrom:'2026-11-01',dateTo:'2026-11-04'},async(data,guard)=>{
  if(during==='consumer')f.time+=20;else changeDuringAwait=true;
  await guard.assertCurrent();committed=true;
  return {version:'provider-acquisition-receipt-v1',id:'synthetic-expired-receipt',companyId:'company-a',connectionId:data.connectionId,accountId:data.accountId,sha256:'a'.repeat(64),committedAt:new Date(f.time).toISOString()};
 }),{code:'CONSENT_NOT_VALID'});assert.equal(committed,false);assert.equal(f.writes,writes);assert.equal(f.rows.get(selected.id).last_synced_at,'');
});
test('the final receipt guard cannot report committed acquisition after bank-effective expiry',async()=>{
 let validUntil='2026-12-01';const f=fixture({transport:{[`GET /psd2/consent/v1/consents/${CONSENT_ID}`]:()=>json({consentStatus:'valid',validUntil,access:{}})}}),connection=await f.connected(),selected=await f.manager.selectAccounts({connectionId:connection.id,revision:connection.revision,accountIds:[connection.accounts[0].id]});
 f.time=Date.parse('2026-11-04T23:59:59.990Z');validUntil='2026-11-04';
 await assert.rejects(f.manager.acquireTransactions({connectionId:selected.id,accountId:selected.accounts[0].id,dateFrom:'2026-11-01',dateTo:'2026-11-04'},async(data)=>{
  f.time+=20;return {version:'provider-acquisition-receipt-v1',id:'synthetic-late-receipt',companyId:'company-a',connectionId:data.connectionId,accountId:data.accountId,sha256:'a'.repeat(64),committedAt:new Date(f.time).toISOString()};
 }),{code:'CONSENT_NOT_VALID'});
});
test('durable acquisition guard rejects registration expiry during its final row await',async()=>{
 const f=fixture();f.registrationPatch={validUntil:'2026-11-04T23:59:59.999Z'};
 const connection=await f.connected(),selected=await f.manager.selectAccounts({connectionId:connection.id,revision:connection.revision,accountIds:[connection.accounts[0].id]});
 const getConnection=f.repository.getConnection;let expireDuringRead=false,committed=false;
 f.repository.getConnection=async(...args)=>{const row=await getConnection(...args);if(expireDuringRead){expireDuringRead=false;f.time+=20;}return row;};
 f.time=Date.parse('2026-11-04T23:59:59.990Z');
 await assert.rejects(f.manager.acquireTransactions({connectionId:selected.id,accountId:selected.accounts[0].id,dateFrom:'2026-11-01',dateTo:'2026-11-04'},async(_data,guard)=>{expireDuringRead=true;await guard.assertCurrent();committed=true;}),{code:'PROVIDER_GENERATION_CHANGED'});assert.equal(committed,false);
});
test('registration authority pin ignores object order while private acquisition retains its effective deadline',async()=>{
 const f=fixture(),connection=await f.connected(),selected=await f.manager.selectAccounts({connectionId:connection.id,revision:connection.revision,accountIds:[connection.accounts[0].id]}),original=f.options.registration;
 const manager=implementation.createCompanyProviderManager({...f.options,registration(context){const row=original(context);return Object.fromEntries(Object.entries({...row,psu:Object.fromEntries(Object.entries(row.psu).reverse())}).reverse());}});
 const result=await manager.acquireTransactions({connectionId:selected.id,accountId:selected.accounts[0].id,dateFrom:'2026-11-01',dateTo:'2026-11-04'},async(data,guard)=>{
  await guard.assertCurrent();assert.equal(data.effectiveConsentValidUntil,'2026-12-01T23:59:59.999Z');
  return {version:'provider-acquisition-receipt-v1',id:'synthetic-ordered-authority',companyId:'company-a',connectionId:data.connectionId,accountId:data.accountId,sha256:'a'.repeat(64),committedAt:new Date(f.time).toISOString()};
 });assert.equal(result.committed,true);assert.equal(Object.hasOwn(result,'effectiveConsentValidUntil'),false);
});
test('an unpinned retained state cannot be promoted to current authority or acquire any provider data',async()=>{
 const f=fixture(),connection=await f.connected(),selected=await f.manager.selectAccounts({connectionId:connection.id,revision:connection.revision,accountIds:[connection.accounts[0].id]}),row=f.rows.get(selected.id),purpose='provider-manager-state-v1:'+JSON.stringify([row.company_id,row.id,'open_payments',row.environment,row.app_generation]);
 const state=await codec.unseal(row.owner,purpose,row.encrypted_state);delete state.registrationFingerprint;row.encrypted_state=await codec.seal(row.owner,purpose,state);const calls=f.calls.length,writes=f.writes;
 const status=await f.manager.status({connectionId:selected.id});assert.equal(status.status,'review');assert.equal(status.available,false);
 await assert.rejects(f.manager.acquireTransactions({connectionId:selected.id,accountId:selected.accounts[0].id,dateFrom:'2026-11-01',dateTo:'2026-11-04'},()=>assert.fail('unbound consumer')),{code:'PROVIDER_GENERATION_CHANGED'});assert.equal(f.calls.length,calls);assert.equal(f.writes,writes);
});
test('account selection truthfully retains a bank-shortened effective consent deadline',async()=>{
 let validUntil='2026-12-01';const f=fixture({transport:{[`GET /psd2/consent/v1/consents/${CONSENT_ID}`]:()=>json({consentStatus:'valid',validUntil,access:{}})}}),connection=await f.connected();validUntil='2026-11-05';
 const selected=await f.manager.selectAccounts({connectionId:connection.id,revision:connection.revision,accountIds:[connection.accounts[0].id]});
 assert.equal(selected.status,'connected');assert.equal(selected.validUntil,'2026-11-05T23:59:59.999Z');assert.equal(f.rows.get(selected.id).valid_until,selected.validUntil);
});
test('account selection cannot commit connected after bank-effective expiry during final state encryption',async()=>{
 let validUntil='2026-12-01';const f=fixture({transport:{[`GET /psd2/consent/v1/consents/${CONSENT_ID}`]:()=>json({consentStatus:'valid',validUntil,access:{}})}}),connection=await f.connected(),before=copy(f.rows.get(connection.id));
 const manager=implementation.createCompanyProviderManager({...f.options,codec:{unseal:codec.unseal,async seal(owner,purpose,value){const encrypted=await codec.seal(owner,purpose,value);if(purpose.startsWith('provider-manager-state-v1:'))f.time+=20;return encrypted;}}});
 f.time=Date.parse('2026-11-04T23:59:59.990Z');validUntil='2026-11-04';
 await assert.rejects(manager.selectAccounts({connectionId:connection.id,revision:connection.revision,accountIds:[connection.accounts[0].id]}),{code:'CONSENT_NOT_VALID'});
 assert.deepEqual(f.rows.get(connection.id),before);assert.equal(f.rows.get(connection.id).selected_accounts,'[]');
});
test('a reused raw provider grant is rejected before authorization and cannot be revoked through the collided connection',async()=>{
 const f=fixture(),first=await f.connected(),before=f.calls.length;
 await assert.rejects(f.start({requestKey:'synthetic-colliding-request'}),{code:'PROVIDER_GRANT_REUSED'});
 const collided=[...f.rows.values()].find(row=>row.id!==first.id);assert.ok(collided);assert.equal(collided.status,'review');assert.equal(collided.grant_fingerprint,'');
 const expected=hash(JSON.stringify(['provider-grant-v1','open_payments','SANDBOX',CONSENT_ID]));assert.equal(f.rows.get(first.id).grant_fingerprint,expected);
 const extra=f.calls.slice(before);assert.equal(extra.filter(call=>new URL(call.url).pathname.endsWith('/authorisations')).length,0);
 await assert.rejects(f.manager.revoke({connectionId:collided.id,revision:collided.revision}));
 assert.equal(f.calls.filter(call=>call.init.method==='DELETE').length,0);assert.equal(f.rows.get(first.id).status,'accounts_required');
 assert.ok(!JSON.stringify(await f.manager.status({connectionId:collided.id})).includes(CONSENT_ID));
});
test('explicit refresh resolves uncertain revocation only from a terminal bank status, never from SCA or valid consent',async()=>{
 let bankStatus='valid';
 const f=fixture({transport:{[`DELETE /psd2/consent/v1/consents/${CONSENT_ID}`]:()=>{throw Error('uncertain DELETE');},[`GET /psd2/consent/v1/consents/${CONSENT_ID}/status`]:()=>json({consentStatus:bankStatus})}}),connection=await f.connected();
 await assert.rejects(f.manager.revoke({connectionId:connection.id,revision:connection.revision}));
 const reads=f.calls.filter(call=>new URL(call.url).pathname==='/psd2/accountinformation/v1/accounts').length;
 assert.equal((await f.manager.status({connectionId:connection.id,refresh:true})).status,'revocation_pending');
 bankStatus='revokedByPsu';assert.equal((await f.manager.status({connectionId:connection.id,refresh:true})).status,'revoked');
 assert.equal(f.calls.filter(call=>new URL(call.url).pathname==='/psd2/accountinformation/v1/accounts').length,reads);
});
test('revoking a renewed connection does not falsely revoke a different retained unexpired grant',async()=>{
 const secondConsent='44444444-4444-4444-8444-444444444444';let creations=0;
 const f=fixture({transport:{
  'POST /psd2/consent/v1/consents':()=>json({consentId:creations++?secondConsent:CONSENT_ID,consentStatus:'received'},201),
  [`POST /psd2/consent/v1/consents/${secondConsent}/authorisations`]:()=>json({authorisationId:AUTH_ID,scaStatus:'received',scaMethods:[{authenticationMethodId:'mbid',authenticationType:'PUSH_OTP',name:'Synthetic BankID'}]},201),
  [`PUT /psd2/consent/v1/consents/${secondConsent}/authorisations/${AUTH_ID}`]:()=>redirectResponse(secondConsent),
  [`GET /psd2/consent/v1/consents/${secondConsent}`]:()=>json({consentStatus:'valid',validUntil:'2026-12-01',access:{}}),
  [`GET /psd2/consent/v1/consents/${secondConsent}/status`]:()=>json({consentStatus:'valid'}),
  [`DELETE /psd2/consent/v1/consents/${secondConsent}`]:()=>json({},204),
 }});
 const old=await f.connected(),started=await f.start({requestKey:'different-grant-renewal',renewConnectionId:old.id,expectedRevision:old.revision});
 const chosen=await f.manager.chooseMethod({connectionId:started.id,revision:started.revision,methodId:'mbid',browser});let redirect;
 await f.manager.withRedirect({flowId:chosen.flowId,browser},url=>{redirect=url;});
 const connection=await f.manager.callback({flowId:chosen.flowId,browser,parameters:new URLSearchParams({code:'synthetic-renewal-code',scope:'accountinformation corporate',state:new URL(redirect).searchParams.get('state')})});
 const result=await f.manager.revoke({connectionId:connection.id,revision:connection.revision});
 assert.equal(result.status,'revocation_pending');assert.equal(result.error,'PROVIDER_PREVIOUS_GRANTS_PENDING');assert.equal(f.grants.size,2);
});
test('terminal status of the latest renewal cannot claim older live grants are revoked or expired',async()=>{
 for(const terminal of ['terminatedByTpp','expired']){
  const secondConsent='44444444-4444-4444-8444-444444444444';let creations=0,bankStatus='valid';
  const f=fixture({transport:{
   'POST /psd2/consent/v1/consents':()=>json({consentId:creations++?secondConsent:CONSENT_ID,consentStatus:'received'},201),
   [`POST /psd2/consent/v1/consents/${secondConsent}/authorisations`]:()=>json({authorisationId:AUTH_ID,scaStatus:'received',scaMethods:[{authenticationMethodId:'mbid',authenticationType:'PUSH_OTP',name:'Synthetic BankID'}]},201),
   [`PUT /psd2/consent/v1/consents/${secondConsent}/authorisations/${AUTH_ID}`]:()=>redirectResponse(secondConsent),
   [`GET /psd2/consent/v1/consents/${secondConsent}`]:()=>json({consentStatus:'valid',validUntil:'2026-12-01',access:{}}),
   [`GET /psd2/consent/v1/consents/${secondConsent}/status`]:()=>json({consentStatus:bankStatus}),
  }});
  const old=await f.connected(),started=await f.start({requestKey:'terminal-renewal-'+terminal,renewConnectionId:old.id,expectedRevision:old.revision}),chosen=await f.manager.chooseMethod({connectionId:started.id,revision:started.revision,methodId:'mbid',browser});let redirect;
  await f.manager.withRedirect({flowId:chosen.flowId,browser},url=>{redirect=url;});
  await f.manager.callback({flowId:chosen.flowId,browser,parameters:new URLSearchParams({code:'synthetic-renewal-code',scope:'accountinformation corporate',state:new URL(redirect).searchParams.get('state')})});
  bankStatus=terminal;const result=await f.manager.status({connectionId:old.id,refresh:true});
  assert.equal(result.status,'revocation_pending');assert.equal(result.error,'PROVIDER_PREVIOUS_GRANTS_PENDING');assert.equal(result.accounts.every(account=>!account.selected),true);assert.equal(f.grants.size,2);assert.equal(f.calls.some(call=>call.init.method==='DELETE'),false);
  f.time=Date.parse('2026-12-02T12:00:00Z');const calls=f.calls.length,settled=await f.manager.status({connectionId:old.id,refresh:true});
  assert.equal(settled.status,terminal==='expired'?'expired':'revoked');assert.equal(f.calls.length,calls);
 }
});
test('a bank-expired grant remains terminal when a later status response would say valid',async()=>{
 let bankStatus='valid';const f=fixture({transport:{[`GET /psd2/consent/v1/consents/${CONSENT_ID}/status`]:()=>json({consentStatus:bankStatus})}}),connection=await f.connected();
 bankStatus='expired';assert.equal((await f.manager.status({connectionId:connection.id,refresh:true})).status,'expired');
 const calls=f.calls.length;bankStatus='valid';assert.equal((await f.manager.status({connectionId:connection.id,refresh:true})).status,'expired');assert.equal(f.calls.length,calls);
});
