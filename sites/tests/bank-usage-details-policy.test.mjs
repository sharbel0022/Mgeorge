import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../lib/bank-consent-policy.js';

const now=Date.parse('2026-11-06T00:00:00.000Z'),until='2026-11-06T01:00:00.000Z';
const uuid=n=>`${String(n).padStart(8,'0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,a=uuid(1),b=uuid(2),c=uuid(3);
const account=(uid,usage=null)=>({uid,usage,currency:'SEK',identification_hash:'PRIMARY-'+uid,account_id:{other:{identification:'ACCOUNT'+uid.slice(0,8),scheme_name:'BBAN'}}});
function input(size=1){const ids=Array.from({length:size},(_,i)=>uuid(i+1));return {bankName:'Synthetic Usage Bank',country:'SE',requestedValidUntil:until,requestedScopes:['accounts:read','transactions:read'],now,selectedAccountUids:[...ids],
 session:{aspsp:{name:'Synthetic Usage Bank',country:'SE'},psu_type:'business',access:{valid_until:until,transactions:true},accounts:ids.map(id=>account(id))},
 checked:{status:'AUTHORIZED',aspsp:{name:'Synthetic Usage Bank',country:'SE'},psu_type:'business',access:{valid_until:until,transactions:true},accounts:[...ids],accounts_data:ids.map(uid=>({uid,identification_hash:'PRIMARY-'+uid}))}};}
function failure(value){let error;try{policy.validateLegacyEnableSelection(value);}catch(caught){error=caught;}assert.ok(error instanceof policy.ConsentError);return error;}
const readPlan=(error,value,at=now)=>policy.planAccountUsageDetailsRead?.(error,value,at)??{status:'not_read',reason:'NOT_IMPLEMENTED'};
const plan=value=>readPlan(failure(value),value);
const observe=(value,uid,details)=>policy.observeAccountUsageDetails?.(value,uid,details)??{status:'unavailable',reason:'NOT_IMPLEMENTED'};
const details=uid=>({...account(uid,'ORGA'),cash_account_type:'CACC'});

test('usage details diagnostic: original private error and exact original input are both required',()=>{
 const value=input(),error=failure(value),ready=readPlan(error,value);assert.equal(ready.status,'ready');
 const forged=new policy.ConsentError('BANK_ACCOUNT_SCOPE_INVALID',409);let reads=0;
 Object.defineProperties(forged,{reason:{get(){reads++;throw Error('PRIVATE');}},usageDiagnostic:{get(){reads++;throw Error('PRIVATE');}}});
 for(const candidate of [forged,policy.bankAccountScopeError('ACCOUNT_USAGE_INVALID'),Object.create(error),new Proxy(error,{}),null])assert.deepEqual(readPlan(candidate,value),{status:'not_read',reason:'INPUT_NOT_BOUND'});
 assert.deepEqual(readPlan(error,structuredClone(value)),{status:'not_read',reason:'INPUT_NOT_BOUND'});assert.equal(reads,0);
});

for(const [name,change]of [
 ['selected set',x=>x.selectedAccountUids.push(b)],['primary hash',x=>x.session.accounts[0].identification_hash='CHANGED'],
 ['bank',x=>x.checked.aspsp.name='Other bank'],['expiry',x=>x.checked.access.valid_until='2099-01-01T00:00:00.000Z'],
 ['usage',x=>x.session.accounts[0].usage='ORGA'],['live inventory',x=>x.checked.accounts.push(b)],
])test('usage details diagnostic: mutation of '+name+' after original validation cannot authorize a read',()=>{
 const value=input(),error=failure(value);change(value);assert.deepEqual(readPlan(error,value),{status:'not_read',reason:'INPUT_NOT_BOUND'});
});

for(const [name,change]of [
 ['revoked session',x=>x.checked.status='REVOKED'],['personal PSU',x=>x.checked.psu_type='personal'],
 ['wrong bank',x=>x.checked.aspsp.name='Other bank'],['wrong country',x=>x.checked.aspsp.country='NO'],
 ['expired session',x=>x.checked.access.valid_until='2000-01-01T00:00:00.000Z'],['transaction scope denied',x=>x.checked.access.transactions=false],
 ['duplicate saved UID',x=>x.session.accounts.push(account(a,'ORGA'))],['duplicate live UID',x=>x.checked.accounts.push(a)],
 ['mismatched full live inventory',x=>x.checked.accounts_data.push({uid:b})],['invalid unselected UID',x=>x.session.accounts.push(account('not-a-uuid','ORGA'))],
 ['missing selected UID',x=>x.selectedAccountUids.push(b)],['client-like unknown scope',x=>x.requestedScopes.push('payments:write')],
])test('usage details diagnostic: '+name+' never yields a details plan',()=>{
 const value=input();change(value);assert.equal(plan(value).status,'not_read');
});

test('usage details diagnostic: bankgiro scope cannot hide behind the earlier usage failure',()=>{
 const value=input();value.requestedScopes.push('bankgiro:read');assert.equal(policy.bankAccountScopeReason(failure(value)),'ACCOUNT_USAGE_INVALID');
 assert.deepEqual(plan(value),{status:'not_read',reason:'SCOPE_UNAVAILABLE'});
});

for(const [name,usage]of [['private','PRIV'],['unknown','PRIVATE_UNKNOWN'],['wrong type',{}]])test('usage details diagnostic: saved '+name+' does not become a null refresh target',()=>{
 const value=input();value.session.accounts[0].usage=usage;assert.deepEqual(plan(value),{status:'not_read',reason:'USAGE_NOT_ELIGIBLE'});
});
for(const [name,usage]of [['private','PRIV'],['null',null],['unknown','PRIVATE_UNKNOWN'],['wrong type',{}]])test('usage details diagnostic: explicit live '+name+' prevents details reads',()=>{
 const value=input();value.checked.accounts_data[0].usage=usage;assert.deepEqual(plan(value),{status:'not_read',reason:'USAGE_NOT_ELIGIBLE'});
});

for(const [name,change,reason]of [
 ['missing saved',x=>delete x.session.accounts[1].identification_hash,'PRIMARY_IDENTITY_MISSING'],
 ['missing live',x=>delete x.checked.accounts_data[1].identification_hash,'PRIMARY_IDENTITY_MISSING'],
 ['null saved',x=>x.session.accounts[1].identification_hash=null,'PRIMARY_IDENTITY_INVALID'],
 ['empty live',x=>x.checked.accounts_data[1].identification_hash='','PRIMARY_IDENTITY_INVALID'],
 ['changed live',x=>x.checked.accounts_data[1].identification_hash='CHANGED','PRIMARY_IDENTITY_CHANGED'],
 ['fuzzy overlap',x=>{x.checked.accounts_data[1].identification_hash='CHANGED';x.checked.accounts_data[1].identification_hashes=[x.session.accounts[1].identification_hash];},'PRIMARY_IDENTITY_CHANGED'],
])test('usage details diagnostic: '+name+' primary identity on a later selected account stops the entire plan',()=>{
 const value=input(2);value.session.accounts[1].usage='ORGA';change(value);
 assert.equal(policy.bankAccountScopeReason(failure(value)),'ACCOUNT_USAGE_INVALID');assert.deepEqual(plan(value),{status:'not_read',reason});
});

test('usage details diagnostic: exact byte-sensitive primary hash is required',()=>{
 const value=input();value.checked.accounts_data[0].identification_hash=value.session.accounts[0].identification_hash.toLowerCase();
 assert.deepEqual(plan(value),{status:'not_read',reason:'PRIMARY_IDENTITY_CHANGED'});
});

test('usage details diagnostic: current deadline is rechecked after the original failure',()=>{
 const value=input(),error=failure(value);assert.deepEqual(readPlan(error,value,Date.parse(until)),{status:'not_read',reason:'CONSENT_EXPIRED'});
 assert.deepEqual(readPlan(error,value,NaN),{status:'not_read',reason:'CONSENT_EXPIRED'});
});

test('usage details diagnostic: only selected saved-null resources enter the frozen plan',()=>{
 const value=input(3);value.session.accounts[1].usage='ORGA';value.session.accounts[2].usage='PRIV';value.selectedAccountUids=[a,b];
 const result=plan(value);assert.equal(result.status,'ready');assert.equal(result.selectedCount,2);assert.equal(result.validUntil,until);assert.deepEqual(result.targets,[{uid:a}]);
 assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.targets)&&Object.isFrozen(result.targets[0]));
 assert.throws(()=>result.targets.push({uid:c}),TypeError);assert.ok(!JSON.stringify(result).includes('PRIMARY-'));
});

for(const size of [5,6])test('usage details diagnostic: '+size+' null targets obey the five-read bound without truncation',()=>{
 const result=plan(input(size));if(size===5){assert.equal(result.status,'ready');assert.equal(result.targets.length,5);}else assert.deepEqual(result,{status:'not_read',reason:'READ_LIMIT_EXCEEDED'});
});

test('usage details diagnostic: a five-target plan may coexist with a larger fully checked selection',()=>{
 const value=input(6);value.session.accounts[5].usage='ORGA';const result=plan(value);assert.equal(result.status,'ready');assert.equal(result.selectedCount,6);assert.equal(result.targets.length,5);
});

test('usage details diagnostic: unsafe accessor input is not snapshotted by executing getters',()=>{
 const value=input();let reads=0;Object.defineProperty(value.session.accounts[0],'name',{enumerable:true,get(){reads++;throw Error('PRIVATE');}});
 assert.deepEqual(plan(value),{status:'not_read',reason:'INPUT_NOT_BOUND'});assert.equal(reads,0);
});

test('usage details diagnostic: observation accepts only the authentic plan and its own target',()=>{
 const value=plan(input());assert.equal(value.status,'ready');assert.deepEqual(observe(value,a,details(a)),{status:'observed',category:'orga'});
 for(const foreign of [structuredClone(value),Object.create(value),{},null])assert.deepEqual(observe(foreign,a,details(a)),{status:'unavailable',reason:'DETAILS_INPUT_NOT_BOUND'});
 assert.deepEqual(observe(value,b,details(b)),{status:'unavailable',reason:'DETAILS_INPUT_NOT_BOUND'});
});

for(const [name,change,reason]of [
 ['other UID',x=>x.uid=b,'DETAILS_IDENTITY_CHANGED'],['null UID',x=>x.uid=null,'DETAILS_IDENTITY_INVALID'],
 ['missing primary hash',x=>delete x.identification_hash,'DETAILS_IDENTITY_MISSING'],['changed primary hash',x=>x.identification_hash='CHANGED','DETAILS_IDENTITY_CHANGED'],
 ['invalid primary hash',x=>x.identification_hash=' PRIVATE\n','DETAILS_IDENTITY_INVALID'],
 ['fuzzy hash overlap',x=>{x.identification_hash='CHANGED';x.identification_hashes=['PRIMARY-'+a];},'DETAILS_IDENTITY_CHANGED'],
 ['currency conflict',x=>x.currency='EUR','DETAILS_ACCOUNT_CONFLICT'],
 ['same-scheme primary number conflict',x=>x.account_id.other.identification='OTHERACCOUNT','DETAILS_ACCOUNT_CONFLICT'],
 ['null currency',x=>x.currency=null,'DETAILS_RESOURCE_INVALID'],['missing account type',x=>delete x.cash_account_type,'DETAILS_RESOURCE_INVALID'],
])test('usage details diagnostic: fresh '+name+' cannot supply a usage observation',()=>{
 const result=details(a);change(result);assert.deepEqual(observe(plan(input()),a,result),{status:'unavailable',reason});
});

test('usage details diagnostic: omitted response UID is bound by endpoint and exact primary hash',()=>{
 const result=details(a);delete result.uid;assert.deepEqual(observe(plan(input()),a,result),{status:'observed',category:'orga'});
});

for(const [name,usage,category]of [['omitted',undefined,'omitted'],['null',null,'explicitNull'],['private','PRIV','priv'],['professional','ORGA','orga'],['unknown','PRIVATE_SYNTHETIC_STRING','otherString'],['wrong type',{secret:'PRIVATE_VALUE'},'wrongType']])test('usage details diagnostic: fresh '+name+' remains a literal fixed category',()=>{
 const result=details(a);if(usage===undefined)delete result.usage;else result.usage=usage;
 const snapshot=structuredClone(result),observed=observe(plan(input()),a,result);assert.deepEqual(observed,{status:'observed',category});assert.deepEqual(result,snapshot);
 assert.ok(!JSON.stringify(observed).includes('PRIVATE_'));
});

test('usage details diagnostic: a getter or conversion hook cannot become a response or diagnostic',()=>{
 const read=plan(input()),result=details(a);let reads=0;Object.defineProperty(result,'usage',{get(){reads++;throw Error('PRIVATE');}});
 assert.deepEqual(observe(read,a,result),{status:'unavailable',reason:'DETAILS_RESOURCE_INVALID'});assert.equal(reads,0);
 const unknown=details(a);unknown.usage={toJSON(){reads++;throw Error('PRIVATE');}};
 assert.deepEqual(observe(read,a,unknown),{status:'observed',category:'wrongType'});assert.equal(reads,0);
});

for(const freshIdentifiers of ['omitted','different scheme'])test('usage details identity I1: conflicting live IBANs survive '+freshIdentifiers+' fresh identifiers',()=>{
 const value=input(),result=details(a);
 value.checked.accounts_data[0].account_id={iban:'SE4550000000058398257466',other:{scheme_name:'IBAN',identification:'SE3550000000054910000003'}};
 if(freshIdentifiers==='omitted')delete result.account_id;
 else result.account_id={other:{scheme_name:'LOCAL',identification:'SYNTHETIC_FRESH_ACCOUNT'}};
 assert.deepEqual(observe(plan(value),a,result),{status:'unavailable',reason:'DETAILS_ACCOUNT_CONFLICT'});
});

test('usage details identity I1: saved/live BBAN conflict survives a noncomparable fresh IBAN',()=>{
 const value=input(),result=details(a);
 value.checked.accounts_data[0].account_id={other:{scheme_name:'BBAN',identification:'SYNTHETIC_DIFFERENT_LIVE_ACCOUNT'}};
 result.account_id={iban:'SE4550000000058398257466'};
 assert.deepEqual(observe(plan(value),a,result),{status:'unavailable',reason:'DETAILS_ACCOUNT_CONFLICT'});
});

test('usage details identity I1: identical duplicate IBANs within all three resources remain observable',()=>{
 const value=input(),result=details(a);
 for(const resource of [value.session.accounts[0],value.checked.accounts_data[0],result]){
  resource.account_id={iban:'SE4550000000058398257466',other:{scheme_name:'IBAN',identification:'SE4550000000058398257466'}};
 }
 assert.deepEqual(observe(plan(value),a,result),{status:'observed',category:'orga'});
});

test('usage details identity I1: distinct noncomparable schemes across all three resources remain observable',()=>{
 const value=input(),result=details(a);
 value.checked.accounts_data[0].account_id={iban:'SE4550000000058398257466'};
 result.account_id={other:{scheme_name:'LOCAL',identification:'SYNTHETIC_FRESH_ACCOUNT'}};
 assert.deepEqual(observe(plan(value),a,result),{status:'observed',category:'orga'});
});
