import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpenPaymentsHttpClient} from '../lib/banking/openpayments/http.js';
import {validateOpenPaymentsConfig} from '../lib/banking/openpayments/config.js';
import {OpenPaymentsTokenClient} from '../lib/banking/openpayments/token.js';
import {CONFIG,json} from './helpers/openpayments-fixture.mjs';
import {workersBindingConfiguration,syntheticWorkersCertificate} from './helpers/openpayments-workers-fixture.mjs';

let configuredOpenPaymentsWorkersTransport;
try{({configuredOpenPaymentsWorkersTransport}=await import('../lib/banking/openpayments-workers-transport.js'));}
catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
const API='https://api.openbankingplatform.com/psd2/accountinformation/v1/accounts';
function fixture(t,{metadata={},fetch,clock}={}){
 const configuration={...CONFIG,environment:'PRODUCTION'},calls=[];
 let plainFetches=0;t.mock.method(globalThis,'fetch',async()=>{plainFetches++;throw Error('Ordinary fetch forbidden');});
 const binding={async fetch(url,init){assert.equal(this,binding);calls.push({url,init});return fetch?fetch(url,init):json({ok:true});}};
 const environment={SAAS_BANK_ENABLED:'true',SAAS_OPENPAYMENTS_CONFIG:JSON.stringify(configuration),SAAS_OPENPAYMENTS_MTLS_BINDING_CONFIG:JSON.stringify(workersBindingConfiguration(metadata)),OPENPAYMENTS_MTLS:binding};
 const create=()=>{assert.equal(typeof configuredOpenPaymentsWorkersTransport,'function');return configuredOpenPaymentsWorkersTransport({configuration,environment:()=>environment,...(clock?{now:clock}:{})});};
 return{configuration,environment,binding,calls,create,plainFetches:()=>plainFetches};
}
const init=overrides=>({method:'GET',headers:new Headers({accept:'application/json'}),...overrides});
function safe(error,code){assert.equal(error.code,code);assert.doesNotMatch(error.message+JSON.stringify(error),/BEGIN|synthetic-workers-client|bank-secret|certificate-secret/);assert.equal(error.cause,undefined);return true;}
test('validated Workers transport has an immutable private interface and only binding egress',async t=>{
 const f=fixture(t),value=f.create();assert.equal(Object.isFrozen(value),true);assert.equal(Object.isFrozen(value.transport),true);assert.equal(value.transport.kind,'mtls');assert.equal(value.assertCurrent(),undefined);
 assert.equal(JSON.stringify(value.transport),'{"kind":"mtls"}');const response=await value.transport.request(API,init({redirect:'follow',cf:{resolveOverride:'evil.example'}}));assert.deepEqual(await response.json(),{ok:true});
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].init.redirect,'manual');assert.equal(f.calls[0].init.cache,'no-store');assert.equal(f.calls[0].init.cf,undefined);assert.equal(f.plainFetches(),0);
});
for(const change of ['disabled','sandbox','missing-config'])test('unconfigured '+change+' cannot opt into production transport',t=>{
 const f=fixture(t);if(change==='disabled')f.environment.SAAS_BANK_ENABLED='false';if(change==='sandbox')f.configuration.environment='SANDBOX';if(change==='missing-config')delete f.environment.SAAS_OPENPAYMENTS_MTLS_BINDING_CONFIG;
 assert.equal(f.create(),null);assert.equal(f.calls.length,0);assert.equal(f.plainFetches(),0);
});
for(const [name,change]of [
 ['generation',m=>{m.credentialGeneration='other';}],['digest',m=>{m.certificateSha256='0'.repeat(64);}],
 ['missing-id',m=>{delete m.certificateId;}],['private-key',m=>{m.privateKeyPem='bank-secret';}],
 ['malformed-cert',m=>{m.certificatePem='certificate-secret';}],['appended-cert',m=>{m.certificatePem+=m.certificatePem;}],
 ['binding-name',m=>{m.binding='https://evil.example';}],['extra-key',m=>{m.verified=true;}],
 ['array',()=>[]],['wrong-version',m=>{m.version=2;}],
])test('invalid '+name+' rejects before any binding or plain fetch',t=>{
 const f=fixture(t),metadata=workersBindingConfiguration();const replacement=change(metadata);
 f.environment.SAAS_OPENPAYMENTS_MTLS_BINDING_CONFIG=JSON.stringify(replacement??metadata);
 assert.throws(f.create,e=>safe(e,'INVALID_CLIENT_CERTIFICATE'));assert.equal(f.calls.length,0);assert.equal(f.plainFetches(),0);
});
for(const value of [undefined,{}, {fetch:true},'mtls'])test('non-binding '+String(value)+' cannot be activated by metadata',t=>{
 const f=fixture(t);f.environment.OPENPAYMENTS_MTLS=value;assert.throws(f.create,e=>safe(e,'INVALID_CLIENT_CERTIFICATE'));assert.equal(f.plainFetches(),0);
});
test('certificate validity comes from X.509 bytes and is rechecked after construction',async t=>{
 const cert=syntheticWorkersCertificate();let clock=cert.validFrom-1;const f=fixture(t,{clock:()=>clock});
 assert.throws(f.create,e=>safe(e,'INVALID_CLIENT_CERTIFICATE'));clock=cert.validFrom+1000;const value=f.create();clock=cert.validTo;
 assert.throws(value.assertCurrent,e=>safe(e,'CLIENT_CERTIFICATE_EXPIRED'));await assert.rejects(value.transport.request(API,init()),e=>safe(e,'CLIENT_CERTIFICATE_EXPIRED'));assert.equal(f.calls.length,0);
});
for(const rotation of ['metadata','provider','binding','fetch','disabled'])test('rotation of '+rotation+' invalidates the captured transport before egress',async t=>{
 const f=fixture(t),value=f.create();
 if(rotation==='metadata')f.environment.SAAS_OPENPAYMENTS_MTLS_BINDING_CONFIG+=' ';
 if(rotation==='provider')f.environment.SAAS_OPENPAYMENTS_CONFIG+=' ';
 if(rotation==='binding')f.environment.OPENPAYMENTS_MTLS={fetch:f.binding.fetch};
 if(rotation==='fetch')f.binding.fetch=async()=>json({});
 if(rotation==='disabled')f.environment.SAAS_BANK_ENABLED='false';
 await assert.rejects(value.transport.request(API,init()),e=>safe(e,'INVALID_CLIENT_CERTIFICATE'));assert.equal(f.calls.length,0);assert.equal(f.plainFetches(),0);
});
test('rotation while headers are pending cancels the response and releases no data',async t=>{
 let complete,cancelled=0;const f=fixture(t,{fetch:()=>new Promise(resolve=>complete=resolve)}),value=f.create(),pending=value.transport.request(API,init());
 await Promise.resolve();f.environment.OPENPAYMENTS_MTLS={fetch:f.binding.fetch};complete(new Response(new ReadableStream({cancel(){cancelled++;}})));
 await assert.rejects(pending,e=>safe(e,'INVALID_CLIENT_CERTIFICATE'));assert.equal(cancelled,1);assert.equal(f.calls.length,1);
});
test('rotation while body bytes are pending cancels the original stream',async t=>{
 let controller,cancelled=0;const f=fixture(t,{fetch:()=>new Response(new ReadableStream({start(c){controller=c;},cancel(){cancelled++;}}))});
 const value=f.create(),response=await value.transport.request(API,init()),pending=response.text();await Promise.resolve();
 f.environment.SAAS_OPENPAYMENTS_MTLS_BINDING_CONFIG+=' ';controller.enqueue(new TextEncoder().encode('{"secret":"bank-secret"}'));
 await assert.rejects(pending,e=>safe(e,'INVALID_CLIENT_CERTIFICATE'));assert.equal(cancelled,1);
});
test('abort before headers settles even if a binding ignores abort and cancels its late response',async t=>{
 let complete,cancelled=0;const f=fixture(t,{fetch:()=>new Promise(resolve=>complete=resolve)}),controller=new AbortController();
 const pending=f.create().transport.request(API,init({signal:controller.signal}));await Promise.resolve();controller.abort('bank-secret');
 await assert.rejects(pending,e=>safe(e,'PROVIDER_ABORTED'));complete(new Response(new ReadableStream({cancel(){cancelled++;}})));await new Promise(resolve=>setImmediate(resolve));assert.equal(cancelled,1);
});
test('abort during a streamed body rejects promptly and cancels the binding body',async t=>{
 let cancelled=0;const f=fixture(t,{fetch:()=>new Response(new ReadableStream({cancel(){cancelled++;}}))}),controller=new AbortController();
 const response=await f.create().transport.request(API,init({signal:controller.signal})),pending=response.text();controller.abort('bank-secret');
 await assert.rejects(pending,e=>safe(e,'PROVIDER_ABORTED'));assert.equal(cancelled,1);
});
test('foreign origins, encoded paths, payment endpoints and Host overrides never reach the binding',async t=>{
 const f=fixture(t),transport=f.create().transport;
 for(const url of ['http://api.openbankingplatform.com/psd2/accountinformation/v1/accounts','https://api.openbankingplatform.com.evil.example/psd2/accountinformation/v1/accounts','https://api.sandbox.openbankingplatform.com/psd2/accountinformation/v1/accounts','https://user:bank-secret@api.openbankingplatform.com/psd2/accountinformation/v1/accounts',API+'#bank-secret',API.replace('/accounts','/%61ccounts'),API.replace('accountinformation/v1/accounts','paymentinitiation/v1/payments')])await assert.rejects(transport.request(url,init()),e=>safe(e,'FEATURE_NOT_ALLOWED'));
 await assert.rejects(transport.request(API,init({method:'POST',body:'{}'})),e=>safe(e,'FEATURE_NOT_ALLOWED'));
 await assert.rejects(transport.request(API,init({headers:new Headers({host:'evil.example'})})),e=>safe(e,'FEATURE_NOT_ALLOWED'));assert.equal(f.calls.length,0);
});
test('redirect response is cancelled and never followed',async t=>{
 let cancelled=0;const f=fixture(t,{fetch:()=>new Response(new ReadableStream({cancel(){cancelled++;}}),{status:302,headers:{location:'https://evil.example/?bank-secret'}})});
 await assert.rejects(f.create().transport.request(API,init()),e=>safe(e,'PROVIDER_RESPONSE_INVALID'));assert.equal(f.calls.length,1);assert.equal(cancelled,1);
});
test('shared HTTP limits, rate advice, and one request boundary survive binding composition',async t=>{
 let status=429,boundaries=0;const f=fixture(t,{fetch:()=>json({secret:'bank-secret'},status,{'retry-after':'120'})});
 const http=createOpenPaymentsHttpClient(validateOpenPaymentsConfig(f.configuration),{transport:f.create().transport,requestBoundary:async operation=>{boundaries++;return operation({signal:new AbortController().signal,deadline:Date.now()+1000});}});
 await assert.rejects(http.send({path:'/psd2/accountinformation/v1/accounts'}),e=>e.code==='PROVIDER_RATE_LIMIT'&&e.retryAfter===120);assert.equal(boundaries,1);assert.equal(f.calls.length,1);
 status=200;const tiny=createOpenPaymentsHttpClient(validateOpenPaymentsConfig(f.configuration),{transport:f.create().transport,maxResponseBytes:5});
 await assert.rejects(tiny.send({path:'/psd2/accountinformation/v1/accounts'}),e=>e.code==='PROVIDER_RESPONSE_INVALID');assert.equal(f.calls.length,2);assert.equal(f.plainFetches(),0);
});

test('recreated transport wrappers retain only the same opaque app-token capability',async t=>{
 const f=fixture(t),first=f.create(),second=f.create();let exchanges=0;
 const token=runtime=>new OpenPaymentsTokenClient(f.configuration,{async send(input){exchanges++;return{data:{access_token:'synthetic-'+exchanges,token_type:'Bearer',expires_in:3600,scope:new URLSearchParams(input.body).get('scope')}};}},Date.now,{identity:runtime.cacheIdentity});
 assert.equal(first.cacheIdentity,second.cacheIdentity);assert.deepEqual(Object.keys(first.cacheIdentity),[]);assert.equal(Object.isFrozen(first.cacheIdentity),true);
 assert.equal(await token(first).accessToken(),'synthetic-1');assert.equal(await token(second).accessToken(),'synthetic-1');assert.equal(exchanges,1);
});
for(const rotation of ['metadata','provider','binding','fetch','disabled','missing','malformed','expired'])test('observed '+rotation+' rotation permanently revokes old cached token capability',async t=>{
 const cert=syntheticWorkersCertificate();let clock=cert.validFrom+1000,exchanges=0;
 const f=fixture(t,{clock:()=>clock}),first=f.create(),client=new OpenPaymentsTokenClient(f.configuration,{async send(input){exchanges++;return{data:{access_token:'synthetic-old-token',token_type:'Bearer',expires_in:3600,scope:new URLSearchParams(input.body).get('scope')}};}},()=>clock,{identity:first.cacheIdentity});
 await client.accessToken();
 if(rotation==='metadata')f.environment.SAAS_OPENPAYMENTS_MTLS_BINDING_CONFIG+=' ';
 if(rotation==='provider')f.environment.SAAS_OPENPAYMENTS_CONFIG+=' ';
 if(rotation==='binding')f.environment.OPENPAYMENTS_MTLS={fetch:f.binding.fetch};
 if(rotation==='fetch')f.binding.fetch=async()=>json({});
 if(rotation==='disabled')f.environment.SAAS_BANK_ENABLED='false';
 if(rotation==='missing')delete f.environment.SAAS_OPENPAYMENTS_MTLS_BINDING_CONFIG;
 if(rotation==='malformed')f.environment.SAAS_OPENPAYMENTS_MTLS_BINDING_CONFIG='{"certificatePem":"bank-secret"}';
 if(rotation==='expired')clock=cert.validTo;
 if(rotation==='malformed')assert.throws(f.create,e=>safe(e,'INVALID_CLIENT_CERTIFICATE'));
 else if(rotation==='expired')assert.throws(f.create,e=>safe(e,'CLIENT_CERTIFICATE_EXPIRED'));
 else{const replacement=f.create();if(replacement)assert.notEqual(replacement.cacheIdentity,first.cacheIdentity);}
 await assert.rejects(client.accessToken(),e=>e.code==='INVALID_ACCESS_TOKEN');assert.equal(exchanges,1);
 await assert.rejects(first.transport.request(API,init()),e=>e.code==='INVALID_CLIENT_CERTIFICATE'||e.code==='CLIENT_CERTIFICATE_EXPIRED');assert.equal(f.calls.length,0);
});
