import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpenPaymentsHttpClient} from '../lib/banking/openpayments/http.js';
import {validateOpenPaymentsConfig} from '../lib/banking/openpayments/config.js';
import {OpenPaymentsTokenClient} from '../lib/banking/openpayments/token.js';
const config=validateOpenPaymentsConfig({environment:'SANDBOX',clientId:'synthetic',clientSecret:'synthetic',credentialGeneration:'generation'});
test('durable request boundary observes token exchanges and complete classified HTTP failures',async()=>{
 const observed=[],sent=[];
 const client=createOpenPaymentsHttpClient(config,{transport:{kind:'sandbox',async request(url){sent.push(url);return new Response(JSON.stringify(url.includes('/connect/token')?{access_token:'synthetic-token',token_type:'Bearer',expires_in:3600,scope:'accountinformation corporate'}:{}),{status:url.includes('/connect/token')?200:429,headers:{'content-type':'application/json','retry-after':'7200'}});}},async requestBoundary(operation){observed.push('reserved');try{return await operation({signal:new AbortController().signal,deadline:Date.now()+1000});}catch(error){observed.push({code:error.code,retryAfter:error.retryAfter});throw error;}}});
 await new OpenPaymentsTokenClient(config,client).accessToken();
 await assert.rejects(client.send({path:'/psd2/aspspinformation/v1/aspsps'}),{code:'PROVIDER_RATE_LIMIT'});
 assert.equal(sent.length,2);assert.deepEqual(observed,['reserved','reserved',{code:'PROVIDER_RATE_LIMIT',retryAfter:7200}]);
});
test('a denied quota boundary prevents every HTTP request and preserves its exact safe error',async()=>{
 let calls=0;const client=createOpenPaymentsHttpClient(config,{transport:{kind:'sandbox',async request(){calls++;throw Error('must not send');}},requestBoundary(){throw Object.assign(Error('PROVIDER_BUDGET_EXHAUSTED'),{code:'PROVIDER_BUDGET_EXHAUSTED'});}});
 await assert.rejects(async()=>client.send({path:'/psd2/aspspinformation/v1/aspsps'}),{code:'PROVIDER_BUDGET_EXHAUSTED'});assert.equal(calls,0);
});
