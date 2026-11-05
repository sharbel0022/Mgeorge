// Compare policy outcomes on synthetic inputs. No provider, credentials or DB.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const [beforeArg,afterArg,outputArg]=process.argv.slice(2);
if(!beforeArg||!afterArg||!outputArg)throw Error('Usage: node review-bank-usage-diagnostic-parity.mjs BEFORE AFTER NEW_OUTPUT_JSON');
const roots=[resolve(beforeArg),resolve(afterArg)],file='sites/lib/bank-consent-policy.js';
const sources=roots.map(root=>readFileSync(join(root,file),'utf8'));
const [before,after]=await Promise.all(roots.map(root=>import(pathToFileURL(join(root,file)).href)));
const hash=value=>createHash('sha256').update(value).digest('hex');
assert.equal(after.validateEnableConsent.toString(),before.validateEnableConsent.toString(),'strict validation must remain byte-identical');
const businessPredicate=source=>source.match(/function businessAccountData\(values\) \{[^}]*\}/)?.[0];
assert.ok(businessPredicate(sources[0]));assert.equal(businessPredicate(sources[1]),businessPredicate(sources[0]));
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
const now=Date.parse('2026-11-05T12:00:00.000Z'),until='2026-11-06T12:00:00.000Z';
function input(){const aspsp={name:'Synthetic Parity Bank',country:'SE'},access={valid_until:until,transactions:true};return {bankName:aspsp.name,country:'SE',requestedValidUntil:until,now,selectedAccountUids:[a],session:{accounts:[{uid:a,usage:'ORGA'}],aspsp:{...aspsp},access:{...access},psu_type:'business'},checked:{status:'AUTHORIZED',accounts:[a],accounts_data:[{uid:a}],aspsp:{...aspsp},access:{...access},psu_type:'business'}};}
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
function outcome(api,method,value){try{return {accepted:true,grant:api[method](value)};}catch(error){return {accepted:false,code:error.code,status:error.status,message:error.message,reason:api.bankAccountScopeReason(error)};}}
const rows=[];
function compare(label,method,value){const snapshot=structuredClone(value);freeze(value);const previous=outcome(before,method,value),current=outcome(after,method,value);assert.deepEqual(current,previous,label);assert.deepEqual(value,snapshot,label+' input mutation');rows.push({label,method,...current});}
const variants=[['omitted',undefined,true],['explicit_undefined',undefined],['ORGA','ORGA'],['PRIV','PRIV'],['null',null],['empty_string',''],['lowercase_orga','orga'],['padded_ORGA',' ORGA '],['business_string','business'],['other_string','UNKNOWN'],['number',0],['boolean',false],['array',[]],['object',{}]];
for(const method of ['validateEnableConsent','validateLegacyEnableSelection'])for(const side of ['saved','live'])for(const [label,value,omitted]of variants){const x=input(),account=side==='saved'?x.session.accounts[0]:x.checked.accounts_data[0];if(omitted)delete account.usage;else account.usage=value;compare(side+':'+label,method,x);}
function two(){const x=input();x.session.accounts.push({uid:b,usage:'ORGA'});x.checked.accounts.push(b);x.checked.accounts_data.push({uid:b});return x;}
for(const [label,mutate]of [
 ['unselected_saved_private',x=>x.session.accounts[1].usage='PRIV'],
 ['unselected_live_private',x=>x.checked.accounts_data[1].usage='PRIV'],
 ['unselected_both_null',x=>{x.session.accounts[1].usage=null;x.checked.accounts_data[1].usage=null;}],
 ['selected_second_private',x=>{x.selectedAccountUids.push(b);x.checked.accounts_data[1].usage='PRIV';}],
 ['unselected_UID_mismatch',x=>x.checked.accounts_data.pop()],
 ['unselected_invalid_UID',x=>x.checked.accounts[1]='not-a-uuid'],
]){const x=two();mutate(x);compare(label,'validateLegacyEnableSelection',x);}
const result={schema:'mgeorge-bank-usage-diagnostic-parity-v1',node:process.version,
 beforeSourceSha256:hash(sources[0]),afterSourceSha256:hash(sources[1]),
 strictValidatorByteIdentical:true,businessPredicateByteIdentical:true,
 cases:rows.length,accepted:rows.filter(x=>x.accepted).length,rejected:rows.filter(x=>!x.accepted).length,
 decisionMismatches:0,inputMutations:0,bankRequests:0,productionDataReads:0,productionWrites:0,rows};
writeFileSync(resolve(outputArg),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...result,rows:undefined}));
