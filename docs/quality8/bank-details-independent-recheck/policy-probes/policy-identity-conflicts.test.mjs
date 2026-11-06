import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../snapshot/sites/lib/bank-consent-policy.js';

const uid='00000001-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const now=Date.parse('2026-11-06T00:00:00.000Z');
const until='2026-11-06T01:00:00.000Z';
const hash='SYNTHETIC_EXACT_PRIMARY_HASH';
const ibanA='SE4550000000058398257466';
const ibanB='SE3550000000054910000003';
const bban=n=>({other:{scheme_name:'BBAN',identification:n}});
function input() {
 return {bankName:'Synthetic review bank',country:'SE',requestedValidUntil:until,
  requestedScopes:['accounts:read','transactions:read'],now,selectedAccountUids:[uid],
  session:{aspsp:{name:'Synthetic review bank',country:'SE'},psu_type:'business',access:{valid_until:until,transactions:true},accounts:[{uid,usage:null,currency:'SEK',identification_hash:hash}]},
  checked:{status:'AUTHORIZED',aspsp:{name:'Synthetic review bank',country:'SE'},psu_type:'business',access:{valid_until:until,transactions:true},accounts:[uid],accounts_data:[{uid,identification_hash:hash}]}};
}
function plan(value){let error;try{policy.validateLegacyEnableSelection(value);}catch(caught){error=caught;}assert.equal(policy.bankAccountScopeReason(error),'ACCOUNT_USAGE_INVALID');const result=policy.planAccountUsageDetailsRead(error,value,now);assert.equal(result.status,'ready');return result;}
const details=()=>({uid,identification_hash:hash,currency:'SEK',cash_account_type:'CACC',usage:'ORGA'});

// Positive control: a hash-bound resource with genuinely absent account_id is allowed.
test('hash-bound resource with no primary identifiers remains observable',()=>{
 assert.deepEqual(policy.observeAccountUsageDetails(plan(input()),uid,details()),{status:'observed',category:'orga'});
});

test('contradictory IBAN fields inside fresh primary account_id must prevent an observation',()=>{
 const value=input();value.session.accounts[0].account_id=bban('SYNTHETIC_BBAN');
 const fresh=details();fresh.account_id={iban:ibanA,other:{scheme_name:'IBAN',identification:ibanB}};
 assert.deepEqual(policy.observeAccountUsageDetails(plan(value),uid,fresh),{status:'unavailable',reason:'DETAILS_ACCOUNT_CONFLICT'});
});

test('saved and live primary BBAN disagreement must survive omitted fresh account_id',()=>{
 const value=input();value.session.accounts[0].account_id=bban('SYNTHETIC_SAVED_BBAN');value.checked.accounts_data[0].account_id=bban('SYNTHETIC_DIFFERENT_LIVE_BBAN');
 assert.deepEqual(policy.observeAccountUsageDetails(plan(value),uid,details()),{status:'unavailable',reason:'DETAILS_ACCOUNT_CONFLICT'});
});

test('contradictory cached primary IBANs cannot be erased by omitted fresh account_id',()=>{
 const value=input();value.session.accounts[0].account_id={iban:ibanA,other:{scheme_name:'IBAN',identification:ibanB}};
 assert.deepEqual(policy.observeAccountUsageDetails(plan(value),uid,details()),{status:'unavailable',reason:'DETAILS_ACCOUNT_CONFLICT'});
});

// Negative control: the implementation already rejects a directly comparable conflict.
test('fresh BBAN disagreement is rejected when the same scheme is present',()=>{
 const value=input();value.session.accounts[0].account_id=bban('SYNTHETIC_SAVED_BBAN');
 const fresh=details();fresh.account_id=bban('SYNTHETIC_DIFFERENT_FRESH_BBAN');
 assert.deepEqual(policy.observeAccountUsageDetails(plan(value),uid,fresh),{status:'unavailable',reason:'DETAILS_ACCOUNT_CONFLICT'});
});
