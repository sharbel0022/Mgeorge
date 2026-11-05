import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../lib/bank-consent-policy.js';

const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',c='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const now=Date.parse('2026-11-05T00:00:00.000Z'),until='2026-11-06T00:00:00.000Z';
const counts=(patch={})=>({omitted:0,orga:0,priv:0,explicitNull:0,otherString:0,wrongType:0,...patch});
const expected=(saved,live,selectedCount=1)=>({version:'selected-account-usage-v1',selectedCount,saved:counts(saved),live:counts(live)});
const diagnostic=error=>policy.bankAccountUsageDiagnostic?.(error)??null;
function input(){return {bankName:'Synthetic Bank',country:'SE',requestedValidUntil:until,now,
 session:{aspsp:{name:'Synthetic Bank',country:'SE'},psu_type:'business',access:{valid_until:until},accounts:[{uid:a,usage:'ORGA'}]},
 checked:{status:'AUTHORIZED',aspsp:{name:'Synthetic Bank',country:'SE'},psu_type:'business',access:{valid_until:until},accounts:[a],accounts_data:[{uid:a}]},selectedAccountUids:[a]};}
function denied(value,method='validateLegacyEnableSelection'){
 let caught;try{policy[method](value);}catch(error){caught=error;}
 assert.ok(caught instanceof policy.ConsentError);assert.equal(caught.status,409);return caught;
}

test('usage diagnostic: public properties, allowed reason and inherited errors cannot forge provenance',()=>{
 const genuine=denied({...input(),session:{...input().session,accounts:[{uid:a,usage:null}]}});
 const forged=new policy.ConsentError('BANK_ACCOUNT_SCOPE_INVALID',409);let reads=0;
 Object.defineProperties(forged,{reason:{get(){reads++;throw Error('PRIVATE_REASON');}},usageDiagnostic:{get(){reads++;throw Error('PRIVATE_PAYLOAD');}}});
 for(const error of [forged,policy.bankAccountScopeError('ACCOUNT_USAGE_INVALID'),Object.create(genuine),new Proxy(genuine,{}),{...genuine},null,undefined,'ACCOUNT_USAGE_INVALID'])assert.equal(diagnostic(error),null);
 assert.equal(reads,0);
});

for(const [name,mutate,reason] of [
 ['empty selection',x=>x.selectedAccountUids=[],'SAVED_SELECTION_EMPTY'],
 ['unknown selection',x=>x.selectedAccountUids=[c],'SELECTED_ACCOUNT_MISSING'],
 ['duplicate saved inventory',x=>x.session.accounts.push({uid:a,usage:'ORGA'}),'SAVED_ACCOUNTS_INVALID'],
 ['duplicate live inventory',x=>x.checked.accounts.push(a),'LIVE_ACCOUNTS_INVALID'],
 ['unmatched live data',x=>x.checked.accounts_data.push({uid:b,usage:'PRIV'}),'LIVE_ACCOUNT_SET_MISMATCH'],
 ['invalid unselected UID',x=>x.session.accounts.push({uid:'PRIVATE_NOT_A_UUID',usage:'PRIV'}),'SAVED_ACCOUNTS_INVALID'],
])test('usage diagnostic: '+name+' blocks before any selected usage census',()=>{
 const value=input();value.session.accounts[0].usage=null;mutate(value);const error=denied(value);
 assert.equal(policy.bankAccountScopeReason(error),reason);assert.equal(diagnostic(error),null);
});

for(const [name,mutate,code] of [
 ['revoked consent',x=>x.checked.status='REVOKED','BANK_CONSENT_INVALID'],
 ['wrong bank',x=>x.checked.aspsp.name='Other Bank','BANK_CONSENT_INVALID'],
 ['personal PSU',x=>x.checked.psu_type='personal','BANK_CONSENT_INVALID'],
 ['expired consent',x=>x.checked.access.valid_until='2000-01-01T00:00:00.000Z','BANK_CONSENT_EXPIRED'],
 ['no transaction scope',x=>x.checked.access.transactions=false,'BANK_TRANSACTION_SCOPE_REQUIRED'],
])test('usage diagnostic: '+name+' retains earlier denial without payload',()=>{
 const value=input();value.session.accounts[0].usage=null;mutate(value);const error=denied(value);
 assert.equal(error.code,code);assert.equal(diagnostic(error),null);
});

test('usage diagnostic: strict callback errors do not acquire legacy selected metadata',()=>{
 const value=input();value.session.accounts[0].usage='PRIV';const error=denied(value,'validateEnableConsent');
 assert.equal(policy.bankAccountScopeReason(error),'ACCOUNT_USAGE_INVALID');assert.equal(diagnostic(error),null);
});

test('usage diagnostic: selected saved null is separate from omitted live usage',()=>{
 const value=input();value.session.accounts[0].usage=null;const error=denied(value);
 assert.equal(policy.bankAccountScopeReason(error),'ACCOUNT_USAGE_INVALID');
 assert.deepEqual(diagnostic(error),expected({explicitNull:1},{omitted:1}));
});

for(const [name,value,category] of [
 ['private','PRIV','priv'],['empty string','','otherString'],['lower case','orga','otherString'],
 ['padded string',' ORGA ','otherString'],['unknown string','PRIVATE_SYNTHETIC_USAGE','otherString'],
 ['null',null,'explicitNull'],['boolean',true,'wrongType'],['number',0,'wrongType'],
 ['array',['ORGA'],'wrongType'],['object',{secret:'PRIVATE_SYNTHETIC_VALUE'},'wrongType'],
])test('usage diagnostic: selected live '+name+' is a fixed category, never a repair',()=>{
 const valueInput=input();valueInput.checked.accounts_data[0].usage=value;const before=structuredClone(valueInput),error=denied(valueInput);
 assert.equal(policy.bankAccountScopeReason(error),'ACCOUNT_USAGE_INVALID');
 assert.deepEqual(diagnostic(error),expected({orga:1},{[category]:1}));assert.deepEqual(valueInput,before);
 assert.ok(!JSON.stringify(diagnostic(error)).includes('PRIVATE_SYNTHETIC'));
});

test('usage diagnostic: counts cover both selected sides and exclude complete unselected accounts',()=>{
 const value=input();value.session.accounts=[{uid:a,usage:null},{uid:b,usage:'ORGA'},{uid:c,usage:'PRIVATE_UNSELECTED'}];
 value.checked.accounts=[c,b,a];value.checked.accounts_data=[{uid:c,usage:null},{uid:b,usage:'PRIV'},{uid:a}];value.selectedAccountUids=[b,a];
 const error=denied(value);assert.deepEqual(diagnostic(error),expected({explicitNull:1,orga:1},{omitted:1,priv:1},2));
 for(const secret of [a,b,c,'PRIVATE_UNSELECTED'])assert.ok(!JSON.stringify(diagnostic(error)).includes(secret));
});

test('usage diagnostic: bounded full selected census includes all 100 accounts',()=>{
 const value=input(),ids=Array.from({length:100},(_,i)=>`${String(i).padStart(8,'0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`);
 value.session.accounts=ids.map(uid=>({uid,usage:'ORGA'}));value.checked.accounts=ids;value.checked.accounts_data=ids.map((uid,i)=>({uid,usage:i===99?null:'ORGA'}));value.selectedAccountUids=ids;
 assert.deepEqual(diagnostic(denied(value)),expected({orga:100},{orga:99,explicitNull:1},100));
 value.session.accounts.push({uid:c,usage:'PRIV'});
 const error=denied(value);assert.equal(policy.bankAccountScopeReason(error),'SAVED_ACCOUNTS_INVALID');assert.equal(diagnostic(error),null);
});

test('usage diagnostic: captured counts cannot be mutated or changed by later input edits',()=>{
 const value=input();value.session.accounts[0].usage=null;const error=denied(value),result=diagnostic(error);
 assert.deepEqual(result,expected({explicitNull:1},{omitted:1}));
 assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.saved)&&Object.isFrozen(result.live));
 assert.throws(()=>{result.saved.explicitNull=99;},TypeError);assert.throws(()=>{result.selectedCount=99;},TypeError);
 value.session.accounts[0].usage='ORGA';value.checked.accounts_data[0].usage='PRIVATE_AFTER';
 Object.defineProperty(error,'usageDiagnostic',{get(){throw Error('PRIVATE_FORGED_GETTER');}});
 assert.deepEqual(diagnostic(error),expected({explicitNull:1},{omitted:1}));
});

test('usage diagnostic: unknown objects are classified without invoking conversion or serialization',()=>{
 let calls=0;const value=input();value.session.accounts[0].usage={toJSON(){calls++;throw Error('PRIVATE');},toString(){calls++;throw Error('PRIVATE');}};
 const error=denied(value);assert.deepEqual(diagnostic(error),expected({wrongType:1},{omitted:1}));
 JSON.stringify(diagnostic(error));assert.equal(calls,0);
});

for(const kind of ['accessor','inherited'])test('usage diagnostic: '+kind+' usage cannot supply diagnostic evidence',()=>{
 const value=input();let calls=0;
 if(kind==='accessor')Object.defineProperty(value.session.accounts[0],'usage',{get(){calls++;return null;}});
 else value.session.accounts[0]=Object.assign(Object.create({usage:null}),{uid:a});
 const error=denied(value);assert.equal(policy.bankAccountScopeReason(error),'ACCOUNT_USAGE_INVALID');assert.equal(diagnostic(error),null);
 assert.equal(calls,kind==='accessor'?2:0,'Diagnostic capture must not add an accessor read to the unchanged predicate');
});

for(const [name,mutate] of [
 ['omitted',x=>delete x.session.accounts[0].usage],['explicit undefined',x=>x.session.accounts[0].usage=undefined],['ORGA',()=>{}],
 ['unselected invalid usage',x=>x.session.accounts.push({uid:b,usage:null})],
])test('usage diagnostic: allowed '+name+' retains the exact original grant',()=>{
 const value=input();mutate(value);const before=structuredClone(value);
 assert.deepEqual(policy.validateLegacyEnableSelection(value),{validUntil:until,accountUids:[a],grantedScopes:['accounts:read','transactions:read'],missingScopes:[]});assert.deepEqual(value,before);
});
