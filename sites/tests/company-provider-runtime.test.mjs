import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {codec,CONFIG,CONTEXT,NOW,fixtureTransport} from './helpers/openpayments-fixture.mjs';
const target=new URL('../lib/banking/company-provider-runtime.js',import.meta.url),implementation=existsSync(target)?await import(target):null;
const context={version:'company-context-v1',companyId:'company-a',storageOwner:'owner-a',actorId:'alice',role:'owner',membershipVersion:1,companyVersion:1,contextVersion:1};
const at=Date.parse('2026-11-04T12:00:00Z'),callbackUri='https://runtime.example.test/api/bank/callback';
const configuration={environment:'SANDBOX',clientId:'synthetic-client',clientSecret:'never-serialize-client-secret',credentialGeneration:'approved-generation',redirectUris:[callbackUri]};
const registration={verified:true,companyId:'company-a',owner:'owner-a',environment:'SANDBOX',appGeneration:'approved-generation',evidenceId:'synthetic-approved-registration',validUntil:'2026-12-01T00:00:00Z',corporateId:'private-corporate-identity',psuId:'private-psu-identity',psu:{ipAddress:'192.0.2.10',userAgent:'Synthetic trusted client'},redirectUri:callbackUri};
async function fixture(patch={}){
 assert.equal(typeof implementation?.createCompanyProviderRuntime,'function');
 const settings={MG_SAAS_ONBOARDING_ENABLED:'true',MG_OPENPAYMENTS_CONFIG:JSON.stringify(configuration),MG_COMPANY_BANK_REGISTRATIONS:JSON.stringify({version:1,bindings:[registration]}),...patch.settings},calls=[];
 const transport=patch.transport??{kind:'sandbox',async request(url,init){calls.push(new URL(url).pathname);patch.onRequest?.(settings);return Response.json({access_token:'synthetic-application-token',expires_in:3600,token_type:'Bearer',scope:new URLSearchParams(init.body).get('scope')});}};
 const repository={async listConnections(){return[];},async getConnection(){return null;},async findFlowByRequestKey(){return null;},async getFlow(){return null;},async commit(){assert.fail('Unavailable runtime must not write');},async consumeFlow(){return false;}};
 const runtime=await implementation.createCompanyProviderRuntime({settings:()=>{patch.onSettings?.(settings);return settings;},repository,codec:{async seal(){throw Error('Unexpected encryption');},async unseal(){throw Error('Unexpected decryption');}},currentContext:()=>patch.currentContext?.()??context,assertCurrent:patch.assertCurrent??(()=>{}),withBankLock:async(_owner,run)=>run({assert(){}}),transport,callbackUri,now:()=>at});
 return {runtime,settings,calls};
}
test('exact enablement and trusted config are required while stored status stays readable',async()=>{
 for(const value of [undefined,'false','TRUE',true]){
  const f=await fixture({settings:{MG_SAAS_ONBOARDING_ENABLED:value}}),status=await f.runtime.configStatus();assert.equal(status.available,false);assert.equal(status.reason,'disabled');
  assert.deepEqual(await f.runtime.manager.status(),{connections:[]});await assert.rejects(f.runtime.manager.discoverBanks());assert.deepEqual(f.calls,[]);
 }
});
test('SDK whitelist and exact company registration fail closed without exposing private settings',async()=>{
 for(const settings of [{MG_OPENPAYMENTS_CONFIG:JSON.stringify({...configuration,baseUrl:'https://unapproved.example.test'})},{MG_COMPANY_BANK_REGISTRATIONS:JSON.stringify({version:1,bindings:[{...registration,owner:'foreign-owner'}]})},{MG_COMPANY_BANK_REGISTRATIONS:JSON.stringify({version:1,bindings:[{...registration,appGeneration:'unapproved-generation'}]})},{MG_COMPANY_BANK_REGISTRATIONS:JSON.stringify({version:1,bindings:[registration,registration]})}]){
  const f=await fixture({settings}),status=await f.runtime.configStatus();assert.equal(status.available,false);assert.doesNotMatch(JSON.stringify(status),/never-serialize|private-corporate|private-psu|unapproved\.example/);await assert.rejects(f.runtime.manager.start({}));assert.deepEqual(f.calls,[]);
 }
});
test('approved runtime exposes only a safe availability projection',async()=>{
 const f=await fixture(),status=await f.runtime.configStatus();assert.deepEqual(status,{provider:'open_payments',enabled:true,configured:true,registered:true,available:true,environment:'SANDBOX',reason:'available',payments:'disabled'});
 assert.doesNotMatch(JSON.stringify(f.runtime),/never-serialize|private-corporate|private-psu/);
});
test('actual client secret rotation invalidates ongoing work despite an unchanged manual generation',async()=>{
 const f=await fixture({onRequest:settings=>{settings.MG_OPENPAYMENTS_CONFIG=JSON.stringify({...configuration,clientSecret:'rotated-private-secret'});}});
 await assert.rejects(f.runtime.manager.discoverBanks(),error=>['PROVIDER_GENERATION_CHANGED','RESOURCE_SCOPE_MISMATCH'].includes(error.code));assert.deepEqual(f.calls,['/connect/token']);
});
test('production needs both explicit registration attestation and a validated mTLS transport',async()=>{
 const settings={MG_OPENPAYMENTS_CONFIG:JSON.stringify({...configuration,environment:'PRODUCTION'}),MG_COMPANY_BANK_REGISTRATIONS:JSON.stringify({version:1,bindings:[{...registration,environment:'PRODUCTION'}]})};
 const sandbox=await fixture({settings});assert.equal((await sandbox.runtime.configStatus()).available,false);
 let validations=0;const transport={kind:'mtls',validateCertificate(){validations++;},async request(){assert.fail('No live bank call');}};
 const unattested=await fixture({settings,transport});assert.equal((await unattested.runtime.configStatus()).available,false);
 settings.MG_COMPANY_BANK_REGISTRATIONS=JSON.stringify({version:1,bindings:[{...registration,environment:'PRODUCTION',productionTransportVerified:true}]});
 const approved=await fixture({settings,transport});assert.equal((await approved.runtime.configStatus()).available,true);assert.ok(validations>0);
 const invalid=await fixture({settings,transport:{...transport,validateCertificate(){throw Error('private certificate material');}}});assert.equal((await invalid.runtime.configStatus()).available,false);
});
test('availability requires the trusted PSU metadata that the actual SDK needs for consent creation',async()=>{
 for(const psu of [undefined,{}, {ipAddress:'untrusted-text',userAgent:'Synthetic client'},{ipAddress:'999.0.0.1',userAgent:'Synthetic client'},{ipAddress:'192.0.2.10',userAgent:'bad\r\nheader'}]){
  const f=await fixture({settings:{MG_COMPANY_BANK_REGISTRATIONS:JSON.stringify({version:1,bindings:[{...registration,psu}]})}});
  assert.equal((await f.runtime.configStatus()).available,false);assert.equal((await f.runtime.configStatus()).registered,false);await assert.rejects(f.runtime.manager.start({}));assert.deepEqual(f.calls,[]);
 }
});
test('config availability cannot publish after authority or active company changes during settings await',async()=>{
 for(const selectionChanged of [false,true]){
  let current={...context},active=true,loads=0;
  const f=await fixture({currentContext:()=>current,assertCurrent(){if(!active)throw Object.assign(Error('revoked'),{code:'COMPANY_AUTHORIZATION_CHANGED'});},onSettings(){if(++loads===2){if(selectionChanged)current={...current,contextVersion:2};else active=false;}}});
  await assert.rejects(f.runtime.configStatus(),error=>['COMPANY_AUTHORIZATION_CHANGED','COMPANY_CONTEXT_STALE'].includes(error.code));
 }
});
test('runtime disabling new onboarding preserves the owned grant revocation path without bypassing live configuration',async()=>{
 const rows=new Map(),flows=new Map(),calls=fixtureTransport(),browser={cookie:'synthetic-browser',session:'synthetic-session'};
 const settings={MG_SAAS_ONBOARDING_ENABLED:'true',MG_OPENPAYMENTS_CONFIG:JSON.stringify(CONFIG),MG_COMPANY_BANK_REGISTRATIONS:JSON.stringify({version:1,bindings:[{...registration,appGeneration:CONFIG.credentialGeneration,corporateId:CONTEXT.corporateId,psuId:CONTEXT.psuId,psu:CONTEXT.psu,redirectUri:CONFIG.redirectUris[0]}]})};
 const repository={async listConnections(){return [...rows.values()].map(structuredClone);},async getConnection(_context,id){return rows.has(id)?structuredClone(rows.get(id)):null;},async findFlowByRequestKey(_context,key){return structuredClone([...flows.values()].find(flow=>flow.requestKeyHash===key)??null);},async getFlow(_context,id){return structuredClone(flows.get(id)??null);},async commit(_context,change){const old=rows.get(change.connection.id);assert.equal(old?.revision??null,change.expectedRevision);rows.set(change.connection.id,structuredClone(change.connection));if(change.flow)flows.set(change.flow.id,structuredClone(change.flow));},async consumeFlow(){return false;}};
 const runtime=await implementation.createCompanyProviderRuntime({settings:()=>settings,repository,codec,currentContext:()=>context,assertCurrent(){},withBankLock:async(_owner,run)=>run({assert(){}}),transport:calls.transport,callbackUri:CONFIG.redirectUris[0],now:()=>NOW});
 const started=await runtime.manager.start({bankId:'OPBKSE21',validUntil:'2026-12-01',requestKey:'runtime-retained-grant',browser});settings.MG_SAAS_ONBOARDING_ENABLED='false';
 const before=calls.calls.length,stored=await runtime.manager.status({connectionId:started.id});assert.equal(stored.available,false);assert.equal(stored.onboardingAvailable,false);assert.equal(calls.calls.length,before);
 await assert.rejects(runtime.manager.start({bankId:'OPBKSE21',validUntil:'2026-12-01',requestKey:'runtime-disabled-new-grant',browser}));assert.equal(calls.calls.length,before);
 const revoked=await runtime.manager.revoke({connectionId:started.id,revision:started.revision});assert.equal(revoked.status,'revoked');assert.equal(calls.calls.filter(call=>call.init.method==='DELETE').length,1);
 settings.MG_OPENPAYMENTS_CONFIG=JSON.stringify({...CONFIG,clientSecret:'rotated-private-secret'});await assert.rejects(runtime.manager.revoke({connectionId:revoked.id,revision:revoked.revision}),{code:'PROVIDER_GENERATION_CHANGED'});
});
