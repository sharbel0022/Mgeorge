import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import * as policy from '../lib/bank-consent-policy.js';
import { getAccountDetails } from '../lib/banking/enable-banking.ts';

const uid='00000001-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const hash='SYNTHETIC_EXACT_PRIMARY_HASH';
const now=Date.parse('2026-11-06T00:00:00.000Z');
const until='2026-11-06T01:00:00.000Z';
// An ephemeral test-only key is never printed or persisted. fetch is replaced below.
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const config={applicationId:'11111111-1111-4111-8111-111111111111',privateKeyPem:privateKey.export({type:'pkcs8',format:'pem'})};
function plan() {
 const value={bankName:'Synthetic review bank',country:'SE',requestedValidUntil:until,
 requestedScopes:['accounts:read','transactions:read'],now,selectedAccountUids:[uid],
 session:{aspsp:{name:'Synthetic review bank',country:'SE'},psu_type:'business',access:{valid_until:until,transactions:true},accounts:[{uid,usage:null,currency:'SEK',identification_hash:hash}]},
 checked:{status:'AUTHORIZED',aspsp:{name:'Synthetic review bank',country:'SE'},psu_type:'business',access:{valid_until:until,transactions:true},accounts:[uid],accounts_data:[{uid,identification_hash:hash}]}};
 let error;try{policy.validateLegacyEnableSelection(value);}catch(caught){error=caught;}
 assert.equal(policy.bankAccountScopeReason(error),'ACCOUNT_USAGE_INVALID');
 const result=policy.planAccountUsageDetailsRead(error,value,now);assert.equal(result.status,'ready');return result;
}
for(const contradict of [false,true])test('actual details adapter to observer, internally '+(contradict?'contradictory':'consistent')+' primary IBAN',async t=>{
 const ibanA='SE4550000000058398257466';
 const ibanB=contradict?'SE3550000000054910000003':ibanA;
 const payload={uid,identification_hash:hash,currency:'SEK',cash_account_type:'CACC',usage:'ORGA',account_id:{iban:ibanA,other:{scheme_name:'IBAN',identification:ibanB}}};
 let calls=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  calls++;assert.equal(new URL(url).pathname,`/accounts/${uid}/details`);assert.equal(init.method,'GET');
  return new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json'}});
 });
 const readPlan=plan();
 const actualResource=await getAccountDetails(config,uid);
 assert.equal(calls,1);assert.deepEqual(actualResource,payload);
 const actual=policy.observeAccountUsageDetails(readPlan,uid,actualResource);
 assert.deepEqual(actual,contradict?{status:'unavailable',reason:'DETAILS_ACCOUNT_CONFLICT'}:{status:'observed',category:'orga'});
});
