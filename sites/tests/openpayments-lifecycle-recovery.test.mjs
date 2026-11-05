import test from 'node:test';
import assert from 'node:assert/strict';
import {createSaasBankRuntime} from '../lib/banking/saas-bank-runtime.js';
import {parseSnapshot} from '../lib/onboarding/contract.ts';
import {mutationAllowed} from '../lib/onboarding/client.ts';
import {fixtureTransport,CONFIG,codec,AUTH_ID,CONSENT_ID,ACCOUNT,ACCOUNT_ID,json} from './helpers/openpayments-fixture.mjs';

const consentPath='/psd2/consent/v1/consents';
const context={version:'company-context-v1',companyId:'company-a',storageOwner:'owner-a',actorId:'actor-a',role:'owner',companyVersion:1,membershipVersion:1,contextVersion:1};
const startBody={bankId:'OPBKSE21',expectedRevision:0,permissions:['accounts:read','transactions:read']};

function fixture({companyId=context.companyId,storageOwner=context.storageOwner,account=ACCOUNT}={}){
 let row={revision:0,value:null},interruptRevocation=false,failKnownHandleOnce=false;
 const companyContext={...context,companyId,storageOwner};
 const transport=fixtureTransport({
  [`PUT ${consentPath}/${CONSENT_ID}/authorisations/${AUTH_ID}`]:()=>json({scaStatus:'started',_links:{scaOAuth:{href:`https://oauth.sandbox.openbankingplatform.com/connect/authorize?client_id=[CLIENT_ID]&scope=accountinformation%20corporate&response_type=code&redirect_uri=[TPP_REDIRECT_URI]&state=[TPP_STATE]&acr_values=idp:OPBKSE21%20consentId:${CONSENT_ID}%20ConsentAuthorisationId:${AUTH_ID}`}}},200,{'aspsp-sca-approach':'REDIRECT'}),
  'GET /psd2/accountinformation/v1/accounts':()=>json({accounts:[structuredClone(account)]}),
  [`GET /psd2/accountinformation/v1/accounts/${ACCOUNT_ID}`]:()=>json(structuredClone(account)),
 });
 const store={async read(){return structuredClone(row);},async compareAndSet(revision,value){if(revision!==row.revision)return false;if(failKnownHandleOnce&&value.consentHandle){failKnownHandleOnce=false;throw new Error('Synthetic transient first handle storage failure');}row={revision:revision+1,value:structuredClone(value)};if(interruptRevocation&&value.status==='revoked'){interruptRevocation=false;throw new Error('Synthetic lost commit reply');}return true;}};
 const registration={companyId,actorId:context.actorId,verified:true,corporateAccessVerified:true,redirectVerified:true,corporateId:'synthetic-'+companyId,psuId:'synthetic-psu-a',bicFi:'OPBKSE21',bankId:'OPBKSE21',bankName:'Synthetic Bank',psu:{ipAddress:'192.0.2.10',userAgent:'Synthetic'},ratePolicy:{verified:true,evidenceId:'synthetic-budget',maxRequests:10,windowMs:60000,scope:'company'}};
 const options={context:companyContext,config:CONFIG,registration,enabled:true,codec,assertCurrent:async()=>{},sessionHash:'synthetic-browser-a',redirectUri:CONFIG.redirectUris[0],providerOptions:{transport:transport.transport},requestKey:'synthetic-initial-start'};
 return {
  transport,
  read:()=>structuredClone(row),
  replace:value=>{row={revision:row.revision+1,value:structuredClone(value)};},
  interruptAfterRevocation:()=>{interruptRevocation=true;},
  failFirstHandleStore:()=>{failKnownHandleOnce=true;},
  runtime:(extra={})=>createSaasBankRuntime({...options,store:{...store},...extra}),
  async cancel(){const runtime=this.runtime();const started=await runtime.start(startBody);const state=new URL(await runtime.redirect(started.authorization.id)).searchParams.get('state');await this.runtime().callback({state,error:'access_denied'});},
 };
}

const providerMethods=f=>f.transport.calls.filter(call=>new URL(call.url).pathname.startsWith(consentPath)).map(call=>`${call.init.method} ${new URL(call.url).pathname}`);

test('explicit renewal after denied authorisation revokes the retained consent before creating a replacement',async()=>{
 const f=fixture();await f.cancel();
 const old=f.read();assert.equal(old.value.status,'cancelled');assert.ok(old.value.consentHandle);
 const before=f.transport.calls.length;
 await assert.rejects(f.runtime({requestKey:'synthetic-blocked-fresh-start'}).start({...startBody,expectedRevision:old.revision}),{code:'BANK_BUSY'});
 assert.equal(f.transport.calls.length,before,'a fresh start cannot replace known authority');
 const snapshot=parseSnapshot(await f.runtime().snapshot(),'company-a');
 assert.equal(snapshot.actions.connect,false);assert.equal(mutationAllowed(snapshot,'owner','renew'),true);
 await f.runtime({requestKey:'synthetic-replacement-renew'}).renew({connectionId:old.value.id,expectedRevision:old.revision});
 const calls=f.transport.calls.slice(before).filter(call=>new URL(call.url).pathname.startsWith(consentPath));
 assert.equal(calls[0].init.method,'DELETE','known cancelled consent must be deleted before another one is created');
 assert.equal(new URL(calls[0].url).pathname,`${consentPath}/${CONSENT_ID}`);
 assert.equal(calls[1].init.method,'POST');
 assert.equal(f.read().value.status,'pending');
});

test('failed authorisation remains visible and explicit renewal cleans its known consent before retry',async()=>{
 const f=fixture(),request=f.transport.transport.request;let failAuthorisation=true;
 f.transport.transport.request=async(url,init)=>failAuthorisation&&init.method==='POST'&&new URL(url).pathname.endsWith('/authorisations')?json({},503):request(url,init);
 await assert.rejects(f.runtime().start(startBody));
 const snapshot=await f.runtime().snapshot();
 assert.equal(snapshot.connection?.status,'error','the user must be able to see and disconnect an unfinished remote consent');
 assert.equal(snapshot.actions.disconnect,true);
 assert.equal(snapshot.actions.connect,false);assert.equal(snapshot.actions.renew,true);
 failAuthorisation=false;
 await f.runtime({requestKey:'synthetic-replacement-renew'}).renew({connectionId:snapshot.connection.id,expectedRevision:snapshot.revision});
 const methods=providerMethods(f);
 const cleanup=methods.indexOf(`DELETE ${consentPath}/${CONSENT_ID}`);
 assert.ok(cleanup>=0);assert.ok(cleanup<methods.lastIndexOf(`POST ${consentPath}`));
});

test('an ambiguous replacement cleanup blocks new consent creation and recovers using the same request key',async()=>{
 const f=fixture();await f.cancel();
 const request=f.transport.transport.request;let attempts=0;
 f.transport.transport.request=async(url,init)=>{
  if(init.method==='DELETE'&&++attempts===1)return json({},502);
  return request(url,init);
 };
 const body={connectionId:f.read().value.id,expectedRevision:f.read().revision},options={requestKey:'synthetic-replacement-retry'};
 await assert.rejects(f.runtime(options).renew(body));
 assert.equal(f.read().value.status,'revocation_pending');
 assert.equal(providerMethods(f).filter(value=>value===`POST ${consentPath}`).length,1);
 const started=await f.runtime(options).renew(body);
 assert.equal(started.authorization.state,'pending');assert.equal(attempts,2);
 assert.equal(providerMethods(f).filter(value=>value===`POST ${consentPath}`).length,2);
 const calls=f.transport.calls.length;
 assert.deepEqual(await f.runtime(options).renew(body),started);
 assert.equal(f.transport.calls.length,calls,'a repeated successful request must not create or revoke another consent');
});

test('an expired redirect can be renewed with cleanup without presenting bank approval',async()=>{
 const f=fixture();await f.runtime().start(startBody);
 f.replace({...f.read().value,expiresAt:'2000-01-01T00:00:00Z'});
 const snapshot=await f.runtime().snapshot();
 assert.equal(snapshot.connection.status,'error');
 assert.equal(snapshot.authorization.state,'failed');
 assert.equal(snapshot.authorization.redirectPath,null);
 assert.equal(snapshot.actions.renew,true);
 assert.equal(snapshot.actions.selectAccounts,false);
 assert.equal(snapshot.actions.sync,false);
 const started=await f.runtime({requestKey:'synthetic-expired-renew'}).renew({connectionId:snapshot.connection.id,expectedRevision:snapshot.revision});
 assert.equal(started.authorization.state,'pending');
 assert.equal(providerMethods(f).filter(value=>value===`DELETE ${consentPath}/${CONSENT_ID}`).length,1);
});

test('revoked authority during replacement cleanup prevents a new consent and preserves blocked state',async()=>{
 const f=fixture();await f.cancel();let current=true;const request=f.transport.transport.request;
 f.transport.transport.request=async(url,init)=>{const result=await request(url,init);if(init.method==='DELETE')current=false;return result;};
 await assert.rejects(f.runtime({requestKey:'synthetic-replacement-revoked',assertCurrent:async()=>{if(!current)throw Object.assign(new Error('company_access_denied'),{code:'company_access_denied'});}}).renew({connectionId:f.read().value.id,expectedRevision:f.read().revision}));
 assert.equal(f.read().value.status,'revocation_pending');
 assert.equal(providerMethods(f).filter(value=>value===`POST ${consentPath}`).length,1);
});

test('two verified company contexts at the same bank keep different accounts and identical remote resource IDs isolated',async()=>{
 const a=fixture(),b=fixture({companyId:'company-b',storageOwner:'owner-b',account:{...ACCOUNT,iban:'SE4280000890119146168423',bban:'890119146168423'}});
 async function activate(f){const started=await f.runtime().start(startBody),state=new URL(await f.runtime().redirect(started.authorization.id)).searchParams.get('state');return f.runtime().callback({state,code:'synthetic-activation',scope:'accountinformation corporate'});}
 const [snapshotA,snapshotB]=await Promise.all([activate(a),activate(b)]);
 assert.equal(snapshotA.companyId,'company-a');assert.equal(snapshotB.companyId,'company-b');
 assert.notEqual(snapshotA.accounts[0].maskedNumber,snapshotB.accounts[0].maskedNumber);
 assert.notEqual(a.read().value.consentHandle,b.read().value.consentHandle,'encrypted handles bind the company even when provider resource IDs coincide');
 const before=b.transport.calls.length;
 await assert.rejects(b.runtime({requestKey:'synthetic-foreign-account'}).select({connectionId:snapshotB.connection.id,accountIds:[snapshotA.accounts[0].id],expectedRevision:snapshotB.revision}),{code:'BANK_ACCOUNT_SCOPE_INVALID'});
 assert.equal(b.transport.calls.length,before);
 const selected=await Promise.all([[a,snapshotA],[b,snapshotB]].map(([f,s])=>f.runtime({requestKey:'synthetic-own-account'}).select({connectionId:s.connection.id,accountIds:[s.accounts[0].id],expectedRevision:s.revision})));
 const sync=await Promise.all([[a,selected[0]],[b,selected[1]]].map(([f,s])=>f.runtime().syncContext(s.accounts[0].id)));
 assert.equal(sync[0].context.accountKey,'iban:SE4550000000058398257466');
 assert.equal(sync[1].context.accountKey,'iban:SE4280000890119146168423');
 assert.notEqual(sync[0].context.consentId,sync[1].context.consentId);
 const retained=b.read(),callsB=b.transport.calls.length;
 await a.runtime({requestKey:'synthetic-disconnect-a'}).revoke({connectionId:selected[0].connection.id,expectedRevision:selected[0].revision});
 assert.deepEqual(b.read(),retained);assert.equal(b.transport.calls.length,callsB);
 await sync[1].assertCurrent();await assert.rejects(sync[0].assertCurrent,{code:'BANK_STATE_CHANGED'});
});

test('an unconfirmed consent creation is visible and cannot be overwritten or represented as remotely revoked',async()=>{
 const f=fixture(),request=f.transport.transport.request;
 f.transport.transport.request=async(url,init)=>init.method==='POST'&&new URL(url).pathname===consentPath?json({},504):request(url,init);
 await assert.rejects(f.runtime().start(startBody));
 const snapshot=await f.runtime().snapshot();
 assert.equal(snapshot.connection?.status,'error');
 assert.equal(snapshot.sync.errorCode,'consent_recovery_required');
 assert.deepEqual(snapshot.actions,{connect:false,renew:false,disconnect:false,selectAccounts:false,sync:false});
 const before=f.transport.calls.length;
 await assert.rejects(f.runtime({requestKey:'synthetic-uncertain-retry'}).start({...startBody,expectedRevision:snapshot.revision}),{code:'CONSENT_RECOVERY_REQUIRED'});
 await assert.rejects(f.runtime({requestKey:'synthetic-uncertain-revoke'}).revoke({connectionId:snapshot.connection.id,expectedRevision:snapshot.revision}),{code:'CONSENT_RECOVERY_REQUIRED'});
 assert.equal(f.transport.calls.length,before);assert.notEqual(f.read().value.status,'revoked');
});

test('a failure before consent creation remains safely retryable without a remote cleanup',async()=>{
 const f=fixture(),request=f.transport.transport.request;let unavailable=true;
 f.transport.transport.request=async(url,init)=>unavailable&&new URL(url).pathname==='/psd2/aspspinformation/v1/aspsps/OPBKSE21'?json({},503):request(url,init);
 await assert.rejects(f.runtime().start(startBody));
 const snapshot=await f.runtime().snapshot();assert.equal(snapshot.actions.connect,true);
 unavailable=false;
 await f.runtime({requestKey:'synthetic-capabilities-retry'}).start({...startBody,expectedRevision:snapshot.revision});
 assert.equal(providerMethods(f).filter(value=>value.startsWith('DELETE')).length,0);
 assert.equal(providerMethods(f).filter(value=>value===`POST ${consentPath}`).length,1);
});

test('disconnecting a never-created consent cannot make a safe retry permanently pending',async()=>{
 const f=fixture(),request=f.transport.transport.request;
 f.transport.transport.request=async(url,init)=>new URL(url).pathname==='/psd2/aspspinformation/v1/aspsps/OPBKSE21'?json({},503):request(url,init);
 await assert.rejects(f.runtime().start(startBody));const retained=f.read(),calls=f.transport.calls.length;
 await assert.rejects(f.runtime({requestKey:'synthetic-no-consent-revoke'}).revoke({connectionId:retained.value.id,expectedRevision:retained.revision}),{code:'RESOURCE_SCOPE_MISMATCH'});
 assert.deepEqual(f.read(),retained);assert.equal(f.transport.calls.length,calls);assert.equal((await f.runtime().snapshot()).actions.connect,true);
});

test('a process interrupted before consent creation can restart after its local attempt expires',async()=>{
 const f=fixture(),request=f.transport.transport.request;let unavailable=true;
 f.transport.transport.request=async(url,init)=>unavailable&&new URL(url).pathname==='/psd2/aspspinformation/v1/aspsps/OPBKSE21'?json({},503):request(url,init);
 await assert.rejects(f.runtime().start(startBody));
 f.replace({...f.read().value,status:'starting',expiresAt:'2000-01-01T00:00:00Z'});
 const snapshot=await f.runtime().snapshot();assert.equal(snapshot.actions.connect,true);assert.equal(snapshot.actions.disconnect,false);
 const browserSnapshot=parseSnapshot(snapshot,'company-a');
 assert.equal(browserSnapshot.connection,null,'an expired attempt that never created a consent is not a bank connection');
 assert.equal(mutationAllowed(browserSnapshot,'owner','connect'),true,'the real browser click gate must permit the offered recovery');
 assert.equal(mutationAllowed(browserSnapshot,'viewer','connect'),false);
 unavailable=false;
 const result=await f.runtime({requestKey:'synthetic-before-create-crash'}).start({...startBody,expectedRevision:snapshot.revision});
 assert.equal(result.authorization.state,'pending');assert.equal(providerMethods(f).filter(value=>value===`POST ${consentPath}`).length,1);
 assert.equal(providerMethods(f).filter(value=>value.startsWith('DELETE')).length,0);
});

test('an old failed record without creation evidence requires recovery instead of guessing that no consent exists',async()=>{
 const f=fixture();await f.runtime().start(startBody);
 const record=f.read().value;delete record.consentHandle;delete record.consentCreation;
 f.replace({...record,status:'failed'});
 const snapshot=await f.runtime().snapshot();assert.equal(snapshot.actions.connect,false);assert.equal(snapshot.sync.errorCode,'consent_recovery_required');
 await assert.rejects(f.runtime({requestKey:'synthetic-legacy-failure'}).start({...startBody,expectedRevision:snapshot.revision}),{code:'CONSENT_RECOVERY_REQUIRED'});
});

test('a replacement resumes after confirmed revocation was committed but its reply was lost',async()=>{
 const f=fixture();await f.cancel();f.interruptAfterRevocation();
 const body={connectionId:f.read().value.id,expectedRevision:f.read().revision},options={requestKey:'synthetic-revocation-commit'};
 await assert.rejects(f.runtime(options).renew(body),/Synthetic lost commit reply/);
 assert.equal(f.read().value.status,'revoked');
 const result=await f.runtime(options).renew(body);assert.equal(result.authorization.state,'pending');
 assert.equal(providerMethods(f).filter(value=>value===`DELETE ${consentPath}/${CONSENT_ID}`).length,1);
 assert.equal(providerMethods(f).filter(value=>value===`POST ${consentPath}`).length,2);
});

test('a known consent handle survives a transient first persistence failure and stays available for explicit revocation',async()=>{
 const f=fixture();f.failFirstHandleStore();
 await assert.rejects(f.runtime().start(startBody),/Synthetic transient first handle storage failure/);
 const retained=f.read(),snapshot=await f.runtime().snapshot();
 assert.equal(retained.value.status,'recovery_required');assert.equal(retained.value.consentCreation,'known');
 assert.ok(retained.value.consentHandle);assert.equal(retained.value.retrySafe,false);
 assert.equal(snapshot.actions.connect,false);assert.equal(snapshot.actions.disconnect,true);
 const calls=f.transport.calls.length;
 await assert.rejects(f.runtime({requestKey:'synthetic-after-storage-failure'}).start({...startBody,expectedRevision:retained.revision}),{code:'BANK_BUSY'});
 assert.deepEqual(f.read(),retained);assert.equal(f.transport.calls.length,calls);
 const revoked=await f.runtime({requestKey:'synthetic-revoke-retained-handle'}).revoke({connectionId:retained.value.id,expectedRevision:retained.revision});
 assert.equal(revoked.connection.revocationStatus,'confirmed');
 assert.equal(providerMethods(f).filter(v=>v===`POST ${consentPath}`).length,1);
 assert.equal(providerMethods(f).filter(v=>v===`DELETE ${consentPath}/${CONSENT_ID}`).length,1);
});

test('an explicit rejected consent creation records safe retry without erasing its attempted phase or correlation',async()=>{
 const f=fixture(),request=f.transport.transport.request;let reject=true,attempt,consentPosts=0;
 f.transport.transport.request=async(url,init)=>{
  if(init.method==='POST'&&new URL(url).pathname===consentPath){consentPosts++;if(reject){attempt=f.read();return json({error:'invalid_request'},400);}}
  return request(url,init);
 };
 await assert.rejects(f.runtime().start(startBody),{code:'PROVIDER_REQUEST_REJECTED'});
 assert.equal(consentPosts,1,'the rejected request is not automatically retried');
 const retained=f.read(),snapshot=await f.runtime().snapshot();
 assert.equal(retained.value.status,'failed');assert.equal(retained.value.retrySafe,true);
 assert.equal(retained.value.consentCreation,'pending','retain proof that an attempt was made rather than rewriting it as not_started');
 assert.equal(retained.value.authorizationId,attempt.value.authorizationId);assert.equal(retained.value.expiresAt,attempt.value.expiresAt);
 assert.deepEqual(retained.value.request,attempt.value.request);assert.deepEqual(retained.value.permissions,attempt.value.permissions);
 assert.equal(retained.value.consentHandle,undefined);assert.equal(snapshot.actions.connect,true);assert.equal(snapshot.actions.disconnect,false);
 assert.equal(mutationAllowed(parseSnapshot(snapshot,'company-a'),'owner','connect'),true);
 reject=false;
 const restarted=await f.runtime({requestKey:'synthetic-after-explicit-rejection'}).start({...startBody,expectedRevision:retained.revision});
 assert.equal(restarted.authorization.state,'pending');
 assert.equal(consentPosts,2);
 assert.equal(providerMethods(f).filter(v=>v===`POST ${consentPath}`).length,1,'only the explicitly requested replacement reaches the successful provider fixture');
 assert.equal(providerMethods(f).filter(v=>v.startsWith('DELETE')).length,0,'no handle or remote revocation is fabricated for the rejected attempt');
});
