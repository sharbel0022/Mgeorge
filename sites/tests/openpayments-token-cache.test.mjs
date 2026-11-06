import test from 'node:test';
import assert from 'node:assert/strict';
import {OpenPaymentsTokenClient} from '../lib/banking/openpayments/token.js';
import {createOpenPaymentsTokenCacheIdentity,invalidateOpenPaymentsTokenCacheIdentity} from '../lib/banking/openpayments/token-cache.js';
import {OpenPaymentsProvider} from '../lib/banking/openpayments-provider.js';
import {BankProviderError} from '../lib/banking/bank-data-provider.js';
import {codec,json} from './helpers/openpayments-fixture.mjs';

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

// Independent reviewer reproductions, retained with their request-level
// assertions. Only module paths/context helpers differ from the scratch probe.
const reviewConfig={environment:'SANDBOX',clientId:'review-app',clientSecret:'review-secret',credentialGeneration:'review-g1',features:['bank_discovery']};
function reviewCompany(transport,identity,index){
 const provider=new OpenPaymentsProvider(reviewConfig,{transport,timeoutMs:2000,applicationTokenCache:{identity}});
 return provider.forCompany({binding:{owner:'owner-'+index,companyId:'company-'+index,connectionId:'connection-'+index,provider:'open_payments',environment:'SANDBOX',generation:'review-g1'},corporateId:'corporate-'+index,psuId:'psu-'+index,bicFi:'OPBKSE21'},{codec,assertCurrent:async()=>{}});
}
const reviewBanks=()=>json({aspsps:[{bicFi:'OPBKSE21',name:'Synthetic review bank'}]});
test('late 401 for an old app token cannot evict a newly issued token',async()=>{
 const identity=createOpenPaymentsTokenCacheIdentity();let tokens=0,api=0,ready;const waiting=[],entered=new Promise(resolve=>ready=resolve);
 const transport={kind:'sandbox',async request(url,init){
  if(new URL(url).pathname==='/connect/token'){tokens++;return json({access_token:'review-token-'+tokens,token_type:'Bearer',expires_in:3600,scope:new URLSearchParams(init.body).get('scope')});}
  api++;if(api<=2){const promise=new Promise(resolve=>waiting.push(resolve));if(api===2)ready();return promise;}return reviewBanks();
 }};
 const first=reviewCompany(transport,identity,1).listBanks(),late=reviewCompany(transport,identity,2).listBanks();
 await entered;assert.equal(tokens,1);waiting[0](json({},401));await assert.rejects(first,{code:'INVALID_ACCESS_TOKEN'});
 await reviewCompany(transport,identity,3).listBanks();assert.equal(tokens,2);
 waiting[1](json({},401));await assert.rejects(late,{code:'INVALID_ACCESS_TOKEN'});
 await reviewCompany(transport,identity,4).listBanks();assert.equal(tokens,2,'the delayed rejection refers to token-1, never token-2');
});
test('token endpoint Retry-After remains app-wide across the next company request',async()=>{
 const identity=createOpenPaymentsTokenCacheIdentity();let tokens=0;
 const transport={kind:'sandbox',async request(url){if(new URL(url).pathname==='/connect/token'){tokens++;return json({},429,{'retry-after':'120'});}return reviewBanks();}};
 await assert.rejects(reviewCompany(transport,identity,1).listBanks(),e=>e.code==='PROVIDER_RATE_LIMIT'&&e.retryAfter===120);
 await assert.rejects(reviewCompany(transport,identity,2).listBanks(),e=>e.code==='PROVIDER_RATE_LIMIT'&&e.retryAfter>0);
 assert.equal(tokens,1,'a second company must honor the same token-endpoint cooldown');
});

test('an old token rejection leaves an already-started refresh in flight',async()=>{
 const f=fixture(),a=f.client(),old=await a.accessTokenReceipt();f.advance(3570000);let release,entered;
 const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve),pending=f.client({handler:async(input,id)=>{entered();await gate;return{data:{access_token:'synthetic-token-'+id,token_type:'Bearer',expires_in:3600,scope:new URLSearchParams(input.body).get('scope')}};}}).accessToken();
 await started;a.invalidate(old);release();assert.equal(await pending,'synthetic-token-2');assert.equal(await f.client().accessToken(),'synthetic-token-2');assert.equal(f.calls(),2);
});

test('a delayed rejection cannot evict a newer issuance with the same opaque token value',async()=>{
 const f=fixture(),handler=async input=>({data:{access_token:'synthetic-stable-opaque-value',token_type:'Bearer',expires_in:3600,scope:new URLSearchParams(input.body).get('scope')}}),a=f.client({handler}),old=await a.accessTokenReceipt();
 f.advance(3570000);assert.equal(await f.client({handler}).accessToken(),'synthetic-stable-opaque-value');a.invalidate(old);
 assert.equal(await f.client({handler}).accessToken(),'synthetic-stable-opaque-value');assert.equal(f.calls(),2);
});

test('shared Retry-After counts down, survives invalidation, and permits one explicit request at expiry',async()=>{
 const f=fixture(),a=f.client({handler:async()=>{throw new BankProviderError('PROVIDER_RATE_LIMIT',429,{retryAfter:120,retryable:true});}});
 await assert.rejects(a.accessToken(),{code:'PROVIDER_RATE_LIMIT'});f.advance(119000);a.invalidate();
 await assert.rejects(f.client().accessToken(),e=>e.code==='PROVIDER_RATE_LIMIT'&&e.retryAfter===1);assert.equal(f.calls(),1);
 f.advance(1000);assert.equal(await f.client().accessToken(),'synthetic-token-2');assert.equal(f.calls(),2);
});

test('an app-wide cooldown longer than an hour is not lost by idle cache pruning',async()=>{
 const f=fixture();await assert.rejects(f.client({handler:async()=>{throw new BankProviderError('PROVIDER_RATE_LIMIT',429,{retryAfter:7200});}}).accessToken(),{code:'PROVIDER_RATE_LIMIT'});
 f.advance(3600000);await assert.rejects(f.client().accessToken(),e=>e.code==='PROVIDER_RATE_LIMIT'&&e.retryAfter===3600);assert.equal(f.calls(),1);
});

test('an overflow embargo cannot become an automatic retry after idle time',async()=>{
 const f=fixture();await assert.rejects(f.client({handler:async()=>{throw new BankProviderError('PROVIDER_RATE_LIMIT',429,{retryBlocked:true});}}).accessToken(),{code:'PROVIDER_RATE_LIMIT'});
 f.advance(366*86400000);await assert.rejects(f.client().accessToken(),e=>e.code==='PROVIDER_RATE_LIMIT'&&e.retryBlocked===true);assert.equal(f.calls(),1);
});

test('authorization activation shares token-endpoint cooldown without discarding an existing app token',async()=>{
 const f=fixture(),app=f.client();assert.equal(await app.accessToken(),'synthetic-token-1');
 const input={code:'synthetic-code',redirectUri:'https://app.example/callback',consentId:'synthetic-consent',authorisationId:'synthetic-authorisation'};
 await assert.rejects(f.client({handler:async()=>{throw new BankProviderError('PROVIDER_RATE_LIMIT',429,{retryAfter:120});}}).activateAuthorization(input),{code:'PROVIDER_RATE_LIMIT'});
 assert.equal(await f.client().accessToken(),'synthetic-token-1');await assert.rejects(f.client().activateAuthorization(input),{code:'PROVIDER_RATE_LIMIT'});assert.equal(f.calls(),2);
});

test('cache capacity cannot evict active provider embargoes to permit new token traffic',async()=>{
 const f=fixture(),handler=async()=>{throw new BankProviderError('PROVIDER_RATE_LIMIT',429,{retryAfter:7200});};
 for(let index=0;index<128;index++)await assert.rejects(f.client({config:{clientId:'embargo-app-'+index},handler}).accessToken(),{code:'PROVIDER_RATE_LIMIT'});
 await assert.rejects(f.client({config:{clientId:'another-app'}}).accessToken(),e=>e.code==='PROVIDER_RATE_LIMIT'&&e.retryBlocked===true);
 assert.equal(f.calls(),128);await assert.rejects(f.client({config:{clientId:'embargo-app-0'}}).accessToken(),e=>e.code==='PROVIDER_RATE_LIMIT'&&e.retryAfter===7200);assert.equal(f.calls(),128);
});
