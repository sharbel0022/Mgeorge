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

// Missing trusted metadata, an invented fallback deadline, or truncated oversized
// waits would mislead the read-only account consumer about supplier permission.
test('actual 429 responses retain only bounded explicit supplier retry advice separately from sync fallback policy',async t=>{
 t.mock.method(Date,'now',()=>Date.parse('2026-11-02T10:00:00.000Z'));
 const checkedAt='2026-11-02T10:00:00.000Z';
 for(const [header,retryAfter,retryBlocked,want]of [
  ['7200',7200,false,{status:'known',checkedAt,notBefore:'2026-11-02T12:00:00.000Z',provenance:'retry_after_seconds'}],
  ['Mon, 02 Nov 2026 13:00:00 GMT',10800,false,{status:'known',checkedAt,notBefore:'2026-11-02T13:00:00.000Z',provenance:'retry_after_http_date'}],
  ['0',1,false,{status:'known',checkedAt,notBefore:'2026-11-02T10:00:00.000Z',provenance:'retry_after_seconds'}],
  [null,21600,false,{status:'unknown',checkedAt,provenance:'retry_after_missing'}],
  ['private-account-'+account,21600,false,{status:'unknown',checkedAt,provenance:'retry_after_invalid'}],
  ['January 1, 2028',21600,false,{status:'unknown',checkedAt,provenance:'retry_after_invalid'}],
  ['Sun, 01 Nov 2026 10:00:00 GMT',21600,false,{status:'unknown',checkedAt,provenance:'retry_after_invalid'}],
  ['31536001',31536000,true,{status:'manual_block',checkedAt,provenance:'retry_after_exceeds_limit'}],
  ['999999999999999999999999999999999999',31536000,true,{status:'manual_block',checkedAt,provenance:'retry_after_exceeds_limit'}],
  ['Thu, 02 Dec 2027 10:00:00 GMT',31536000,true,{status:'manual_block',checkedAt,provenance:'retry_after_exceeds_limit'}],
 ]){
  t.mock.method(globalThis,'fetch',async()=>json({error:'ASPSP_RATE_LIMIT_EXCEEDED',private:account},429,header===null?{}:{'Retry-After':header}));
  await assert.rejects(adapter.getAccountDetails(config,account),error=>{
   assert.equal(error.code,'BANK_RATE_LIMIT');assert.equal(error.retryAfter,retryAfter);assert.equal(error.retryBlocked,retryBlocked);
   assert.deepEqual(adapter.providerRetryDiagnostic?.(error),want);
   const first=adapter.providerRetryDiagnostic(error);first.status='forged';assert.deepEqual(adapter.providerRetryDiagnostic(error),want);
   assert.doesNotMatch(JSON.stringify(adapter.providerRetryDiagnostic(error)),new RegExp(account+'|private-account|ASPSP_RATE_LIMIT'));
   return true;
  });
 }
});
test('retry advice ignores forged properties and getters and requires an actual HTTP 429 response',async t=>{
 let reads=0;const error=new adapter.ProviderError('BANK_RATE_LIMIT','private '+account,429,true);
 for(const name of ['retryAfter','retryBlocked','retryAdvice','checkedAt','notBefore','provenance'])Object.defineProperty(error,name,{get(){reads++;throw Error('Getter must not be evaluated');}});
 assert.equal(adapter.providerRetryDiagnostic?.(error),null);
 assert.equal(adapter.providerRetryDiagnostic?.({retryAdvice:{status:'known',notBefore:'2099-01-01T00:00:00.000Z'}}),null);
 assert.equal(reads,0);
 t.mock.method(globalThis,'fetch',async()=>json({error:'ASPSP_RATE_LIMIT_EXCEEDED'},400,{'Retry-After':'7200'}));
 await assert.rejects(adapter.getAccountDetails(config,account),error=>{assert.equal(error.code,'BANK_RATE_LIMIT');assert.equal(error.retryAfter,7200);assert.equal(adapter.providerRetryDiagnostic(error),null);return true;});
});
test('provider error codes come from constructor metadata without inspecting public getters or prototypes',()=>{
 let reads=0;const getter=()=>{reads++;throw Error('SYNTHETIC_PRIVATE_TRAP_MESSAGE');},real=new adapter.ProviderError('BANK_TIMEOUT','Synthetic safe message');
 Object.defineProperty(real,'code',{get:getter});assert.equal(adapter.providerErrorCode?.(real),'BANK_TIMEOUT');
 const forged=Object.create(adapter.ProviderError.prototype);Object.defineProperty(forged,'code',{get:getter});
 const proxy=new Proxy(real,{get:getter,getPrototypeOf:getter,getOwnPropertyDescriptor:getter}),revoked=Proxy.revocable(real,{});revoked.revoke();
 for(const error of [forged,proxy,revoked.proxy,{code:'BANK_TIMEOUT'},null,undefined,'BANK_TIMEOUT'])assert.equal(adapter.providerErrorCode?.(error),undefined);
 assert.equal(reads,0);
});
