import test from 'node:test';
import assert from 'node:assert/strict';
import * as adapter from '../lib/banking/enable-banking.ts';

const app='11111111-1111-4111-8111-111111111111',account='22222222-2222-4222-8222-222222222222';
const key=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const pem='-----BEGIN PRIVATE KEY-----\n'+Buffer.from(await crypto.subtle.exportKey('pkcs8',key.privateKey)).toString('base64').match(/.{1,64}/g).join('\n')+'\n-----END PRIVATE KEY-----\n',config={applicationId:app,privateKeyPem:pem};
const resource=()=>({uid:account,account_id:{iban:'SE4280000890119146168423'},all_account_ids:[{scheme_name:'BBAN',identification:'890119146168423'}],currency:'SEK',cash_account_type:'CACC'});
const json=(v,status=200,headers={})=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json',...headers}});
test('documented account-details GET returns typed bank supplied aliases using the fixed authenticated endpoint',async t=>{assert.equal(typeof adapter.getAccountDetails,'function');let seen;t.mock.method(globalThis,'fetch',async(url,init)=>{seen={url,init};return json(resource());});const result=await adapter.getAccountDetails(config,account);assert.equal(result.all_account_ids[0].scheme_name,'BBAN');assert.equal(seen.url,'https://api.enablebanking.com/accounts/'+account+'/details');assert.equal(seen.init.method,'GET');assert.equal(seen.init.redirect,'manual');assert.equal(seen.init.cache,'no-store');assert.ok(seen.init.headers.get('Authorization').startsWith('Bearer '));assert.equal(seen.init.headers.has('Psu-Ip-Address'),false);});
test('account-details allowlist rejects caller paths, methods, queries and invalid UUIDs before any fetch',async t=>{assert.equal(typeof adapter.getAccountDetails,'function');let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return json(resource());});for(const uid of ['bad','../'+account,account+'?x=1',account+'/../details',''])await assert.rejects(adapter.getAccountDetails(config,uid));for(const [path,options]of [[`/accounts/${account}/details?owner=x`],[`/accounts/${account}/details?`],[`/accounts/${account}/details`,{method:'POST'}],[`/accounts/${account}/details`,{method:'DELETE'}],[`/accounts/${account}/details`,{body:{}}],[`/accounts/not-a-uuid/details`],[`/accounts/${account}/%64etails`]])await assert.rejects(adapter.providerRequest(config,path,options),e=>e.code==='INVALID_REQUEST');assert.equal(calls,0);});
test('malformed, cross-account and over-cap account details never pass response validation',async t=>{assert.equal(typeof adapter.getAccountDetails,'function');for(const change of [r=>{r.currency=null;},r=>{delete r.cash_account_type;},r=>{r.account_id={};},r=>{r.account_id.iban=42;},r=>{r.uid=app;},r=>{r.all_account_ids={};},r=>{r.all_account_ids=[{identification:'123',scheme_name:5}];},r=>{r.all_account_ids=[{identification:'X'.repeat(81),scheme_name:'BBAN'}];},r=>{r.all_account_ids=Array.from({length:51},()=>({identification:'123',scheme_name:'BBAN'}));}]){const r=resource();change(r);t.mock.method(globalThis,'fetch',async()=>json(r));await assert.rejects(adapter.getAccountDetails(config,account),e=>e.code==='INVALID_PROVIDER_RESPONSE');}});
test('account-detail errors and oversized responses use existing safe bounded provider handling',async t=>{assert.equal(typeof adapter.getAccountDetails,'function');t.mock.method(globalThis,'fetch',async()=>json({error:'NOT_FOUND',private:'never expose'},404));await assert.rejects(adapter.getAccountDetails(config,account),e=>e.code==='BANK_RESOURCE_UNAVAILABLE'&&!e.message.includes('never expose'));t.mock.method(globalThis,'fetch',async()=>json(resource(),200,{'Content-Length':String(2*1024*1024+1)}));await assert.rejects(adapter.getAccountDetails(config,account),e=>e.code==='RESPONSE_TOO_LARGE');});
test('a malformed typed IBAN alias cannot masquerade as a domestic identifier',async t=>{const r=resource();r.all_account_ids=[{identification:'890119146168423',scheme_name:'IBAN'}];t.mock.method(globalThis,'fetch',async()=>json(r));await assert.rejects(adapter.getAccountDetails(config,account),e=>e.code==='INVALID_PROVIDER_RESPONSE');});

test('account schema diagnostics describe null, absent and invalid fields without returning bank values',async t=>{
 const cases=[
  [r=>{r.account_id.other=null;},{field:'account_id.other',kind:'null'}],
  [r=>{delete r.cash_account_type;},{field:'cash_account_type',kind:'absent'}],
  [r=>{r.currency={secret:account};},{field:'currency',kind:'object'}],
  [r=>{r.all_account_ids=[{identification:'123',scheme_name:account}];},{field:'all_account_ids[].scheme_name',kind:'string'}],
 ];
 for(const [change,want]of cases){const r=resource();change(r);t.mock.method(globalThis,'fetch',async()=>json(r));await assert.rejects(adapter.getAccountDetails(config,account),e=>{assert.equal(e.code,'INVALID_PROVIDER_RESPONSE');assert.deepEqual(adapter.providerResponseDiagnostic(e),want);assert.doesNotMatch(JSON.stringify(adapter.providerResponseDiagnostic(e)),new RegExp(account+'|890119146168423'));return true;});}
});
test('untrusted error properties cannot forge a provider schema diagnostic',()=>{
 const malicious=new adapter.ProviderError(account,account);malicious.validationIssue={field:account,kind:account};
 assert.equal(typeof adapter.providerResponseDiagnostic,'function');
 assert.equal(adapter.providerResponseDiagnostic(malicious),null);
 assert.equal(adapter.providerResponseDiagnostic({code:'INVALID_PROVIDER_RESPONSE',validationIssue:{field:account,kind:'string'}}),null);
});

test('the observed null alias collection is retained as no additional aliases',async t=>{
 const r=resource();r.all_account_ids=null;t.mock.method(globalThis,'fetch',async()=>json(r));
 const result=await adapter.getAccountDetails(config,account);assert.equal(result.all_account_ids,null);assert.equal(result.account_id.iban,'SE4280000890119146168423');
});
test('nullable alias collection does not permit malformed lists or other null account fields',async t=>{
 for(const change of [r=>{r.all_account_ids='BBAN';},r=>{r.all_account_ids=[null];},r=>{r.all_account_ids=[{identification:'123',scheme_name:null}];},r=>{r.account_id=null;},r=>{r.account_id.other=null;},r=>{r.uid=null;},r=>{r.currency=null;}]){
  const r=resource();r.all_account_ids=null;change(r);t.mock.method(globalThis,'fetch',async()=>json(r));await assert.rejects(adapter.getAccountDetails(config,account),e=>e.code==='INVALID_PROVIDER_RESPONSE');
 }
});
