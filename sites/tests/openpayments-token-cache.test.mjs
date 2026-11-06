import test from 'node:test';
import assert from 'node:assert/strict';
import {OpenPaymentsTokenClient} from '../lib/banking/openpayments/token.js';
import {createOpenPaymentsTokenCacheIdentity,invalidateOpenPaymentsTokenCacheIdentity} from '../lib/banking/openpayments/token-cache.js';
import {OpenPaymentsProvider} from '../lib/banking/openpayments-provider.js';
import {codec} from './helpers/openpayments-fixture.mjs';

const base={environment:'SANDBOX',clientId:'synthetic-client',clientSecret:'synthetic-secret',credentialGeneration:'synthetic-g1',features:['accounts','transactions'],redirectUris:['https://app.example/callback']};
function fixture(){
 let clock=Date.parse('2026-11-06T12:00:00Z'),calls=0;
 const identity=createOpenPaymentsTokenCacheIdentity(),requests=[];
 const client=({config={},cacheIdentity=identity,handler}={})=>new OpenPaymentsTokenClient({...base,...config},{async send(input){const id=++calls;requests.push(input);return handler?handler(input,id):{data:{access_token:'synthetic-token-'+id,token_type:'Bearer',expires_in:3600,scope:new URLSearchParams(input.body).get('scope')}};}},()=>clock,{identity:cacheIdentity});
 return{identity,requests,client,calls:()=>calls,advance:ms=>clock+=ms,time:()=>clock};
}

test('separate token clients share one in-flight exchange and no HTTP clients',async()=>{
 const f=fixture();let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
 const first=f.client({handler:async(input,id)=>{entered();await gate;return{data:{access_token:'synthetic-token-'+id,token_type:'Bearer',expires_in:3600,scope:new URLSearchParams(input.body).get('scope')}};}});
 const pending=[first.accessToken(),...Array.from({length:49},()=>f.client().accessToken())];await started;assert.equal(f.calls(),1);release();
 assert.deepEqual(new Set(await Promise.all(pending)),new Set(['synthetic-token-1']));assert.equal(f.calls(),1);
 f.advance(3570000);assert.equal(await f.client().accessToken(),'synthetic-token-2','refresh uses the current caller HTTP client');assert.equal(f.calls(),2);
});

for(const [name,options]of[
 ['credential generation',{config:{credentialGeneration:'synthetic-g2'}}],
 ['secret without a generation rename',{config:{clientSecret:'synthetic-replacement-secret'}}],
 ['scope',{config:{features:['accounts','transactions','bankgiro_enrichment']}}],
 ['TLS identity',{newIdentity:true}],
])test('application tokens are not reused after changing '+name,async()=>{
 const f=fixture();assert.equal(await f.client().accessToken(),'synthetic-token-1');
 const changed=options.newIdentity?{cacheIdentity:createOpenPaymentsTokenCacheIdentity()}:options;
 assert.equal(await f.client(changed).accessToken(),'synthetic-token-2');assert.equal(f.calls(),2);
});

test('explicit rejection invalidates the shared token without an implicit retry',async()=>{
 const f=fixture(),a=f.client(),b=f.client();await a.accessToken();assert.equal(await b.accessToken(),'synthetic-token-1');
 a.invalidate();assert.equal(f.calls(),1);assert.equal(await b.accessToken(),'synthetic-token-2');assert.equal(f.calls(),2);
});

test('permanent TLS namespace revocation rejects old clients and late token responses',async()=>{
 const f=fixture();let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
 const a=f.client({handler:async input=>{entered();await gate;return{data:{access_token:'synthetic-late-token',token_type:'Bearer',expires_in:3600,scope:new URLSearchParams(input.body).get('scope')}};}}),b=f.client();
 const pending=a.accessToken(),waiter=b.accessToken();await started;invalidateOpenPaymentsTokenCacheIdentity(f.identity);release();
 await assert.rejects(pending,{code:'INVALID_ACCESS_TOKEN'});await assert.rejects(waiter,{code:'INVALID_ACCESS_TOKEN'});await assert.rejects(b.accessToken(),{code:'INVALID_ACCESS_TOKEN'});assert.equal(f.calls(),1);
 assert.equal(await f.client({cacheIdentity:createOpenPaymentsTokenCacheIdentity()}).accessToken(),'synthetic-token-2');
});

test('refresh starts thirty seconds before token expiry and respects credential expiry',async()=>{
 const f=fixture(),a=f.client();await a.accessToken();f.advance(3569000);assert.equal(await f.client().accessToken(),'synthetic-token-1');f.advance(1000);assert.equal(await f.client().accessToken(),'synthetic-token-2');
 const validUntil=new Date(f.time()+10000).toISOString(),short=f.client({config:{credentialsValidUntil:validUntil}});await short.accessToken();f.advance(10000);
 await assert.rejects(short.accessToken(),{code:'CREDENTIALS_EXPIRED'});assert.equal(f.calls(),3);
});

test('malformed OAuth results never populate the cache and a later explicit request may recover',async()=>{
 const f=fixture(),a=f.client({handler:async()=>({data:{access_token:'synthetic-invalid-scope-token',token_type:'Bearer',expires_in:3600,scope:'accountinformation private'}})});
 await assert.rejects(a.accessToken(),{code:'INVALID_OAUTH_RESULT'});assert.equal(await f.client().accessToken(),'synthetic-token-2');assert.equal(f.calls(),2);
});

test('cache capacity is bounded to 128 app/config entries without reviving evicted tokens',async()=>{
 const f=fixture();for(let index=0;index<129;index++)await f.client({config:{clientId:'synthetic-'+index}}).accessToken();
 assert.equal(f.calls(),129);assert.equal(await f.client({config:{clientId:'synthetic-0'}}).accessToken(),'synthetic-token-130');
});

test('in-flight work evicted by the capacity bound cannot republish its token',async()=>{
 const f=fixture();let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
 const pending=f.client({handler:async input=>{entered();await gate;return{data:{access_token:'synthetic-evicted-token',token_type:'Bearer',expires_in:3600,scope:new URLSearchParams(input.body).get('scope')}};}}).accessToken();await started;
 for(let index=0;index<128;index++)await f.client({config:{clientId:'synthetic-'+index}}).accessToken();release();await assert.rejects(pending,{code:'INVALID_ACCESS_TOKEN'});assert.equal(f.calls(),129);
 assert.equal(await f.client().accessToken(),'synthetic-token-130');
});

test('authorization-code activation remains separate and cannot replace the app token',async()=>{
 const f=fixture(),a=f.client();assert.equal(await a.accessToken(),'synthetic-token-1');await a.activateAuthorization({code:'synthetic-code',redirectUri:'https://app.example/callback',consentId:'synthetic-consent',authorisationId:'synthetic-authorisation'});
 assert.equal(await f.client().accessToken(),'synthetic-token-1');assert.equal(f.calls(),2);assert.equal(new URLSearchParams(f.requests[1].body).get('grant_type'),'authorization_code');
});

test('unbranded or cloned cache identities fail closed without requesting credentials',async()=>{
 const f=fixture();for(const cacheIdentity of [{},structuredClone(f.identity)])assert.throws(()=>f.client({cacheIdentity}),{code:'INVALID_ACCESS_TOKEN'});assert.equal(f.calls(),0);
 assert.equal(JSON.stringify(f.identity),'{}','the public identity contains no token or credential fields');
});

test('revocation between receipt parsing and promise delivery cannot return a completed stale token',async()=>{
 const identity=createOpenPaymentsTokenCacheIdentity();let resolve,calls=0;const response=new Promise(done=>resolve=done),client=new OpenPaymentsTokenClient(base,{send(){calls++;return response;}},Date.now,{identity}),pending=client.accessToken();
 resolve({data:{access_token:'synthetic-revoked-after-parsing',token_type:'Bearer',expires_in:3600,scope:'accountinformation corporate'}});
 queueMicrotask(()=>invalidateOpenPaymentsTokenCacheIdentity(identity));await assert.rejects(pending,{code:'INVALID_ACCESS_TOKEN'});assert.equal(calls,1);
});

for(const companies of [1,10,100])test(`${companies} independent company providers reuse one app token and retain each identity and request budget`,async()=>{
 const identity=createOpenPaymentsTokenCacheIdentity(),requests=[],budgets=Array(companies).fill(0),active=Array(companies).fill(true),now=()=>Date.parse('2026-11-06T12:00:00Z');
 const transport={kind:'sandbox',async request(url,init){
  requests.push({path:new URL(url).pathname,method:init.method,headers:init.headers});
  const body=new URL(url).pathname==='/connect/token'?{access_token:'synthetic-shared-app-token',token_type:'Bearer',expires_in:3600,scope:new URLSearchParams(init.body).get('scope')}:{consentId:'consent-'+init.headers.get('psu-corporate-id'),consentStatus:'received'};
  return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
 }};
 const connections=Array.from({length:companies},(_,index)=>new OpenPaymentsProvider({...base,features:['consents','accounts','transactions']},{transport,now,applicationTokenCache:{identity},requestBoundary:async operation=>{budgets[index]++;return operation({signal:new AbortController().signal,deadline:now()+20000});}}).forCompany({binding:{owner:'owner-'+index,companyId:'company-'+index,connectionId:'connection-'+index,provider:'open_payments',environment:'SANDBOX',generation:base.credentialGeneration},corporateId:'corporate-'+index,psuId:'psu-'+index,bicFi:'OPBKSE21',psu:{ipAddress:'192.0.2.10',userAgent:'Synthetic company isolation test'}},{codec,assertCurrent:async binding=>{if(!active[index]||binding.companyId!=='company-'+index||binding.owner!=='owner-'+index)throw Error('synthetic denied company');}}));
 const consents=await Promise.all(connections.map(connection=>connection.createConsent({validUntil:'2026-12-01'})));
 assert.equal(requests.filter(r=>r.path==='/connect/token').length,1);assert.equal(budgets.reduce((a,b)=>a+b,0),companies+1);assert.ok(budgets.every(count=>count>=1));
 const seen=requests.filter(r=>r.path!=='/connect/token').map(r=>[r.headers.get('psu-id'),r.headers.get('psu-corporate-id')]);
 assert.deepEqual(new Set(seen.map(JSON.stringify)),new Set(Array.from({length:companies},(_,index)=>JSON.stringify(['psu-'+index,'corporate-'+index]))));
 consents.forEach((value,index)=>{assert.equal(value.original.binding.companyId,'company-'+index);assert.equal(value.original.binding.owner,'owner-'+index);});
 const count=requests.length;if(companies>1)await assert.rejects(connections[1].getConsentStatus(consents[0].handle),{code:'RESOURCE_SCOPE_MISMATCH'});
 active[0]=false;await assert.rejects(connections[0].getConsentStatus(consents[0].handle),{code:'RESOURCE_SCOPE_MISMATCH'});assert.equal(requests.length,count,'foreign consent handles and revoked memberships cannot send requests with the shared app token');
});
