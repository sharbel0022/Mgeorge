// Read-only synthetic proof of the exact published 819adee usage predicate.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const sourceRoot=resolve(process.argv[2]||fileURLToPath(new URL('../../',import.meta.url)));
const output=resolve(process.argv[3]||'bank-account-usage-matrix.json');
const hashFile=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const expected={"sites/lib/bank-consent-policy.js": "452cff5e328f931a5f1e81ab57fcd47a9b935f542146b1045de3b3e838d90538", "sites/lib/banking/enable-banking.ts": "c28a4576d73673652a242002e174dbbf91a3f3802f731fc8ffdfdc5c39a345a6", "sites/lib/banking/service.ts": "f741eb7c6333b42efb82b86511264a0fdad8a5dd4e49d929a06a258e9e5dc34a", "sites/lib/banking/store.ts": "3fdda2b5fbefb06debaf64cf5daab43e8204b673dc208dcd394b11d4680f1105", "sites/lib/banking/mcp.ts": "62a91ce3e29f7c6bf41a1466af093630b20aaf8bce82bdc7bc9f17e444a3a854"};
for(const [path,sha]of Object.entries(expected))assert.equal(hashFile(join(sourceRoot,path)),sha,'diagnosis requires exact 819adee source: '+path);
const {validateEnableConsent,validateLegacyEnableSelection,bankAccountScopeReason}=await import(pathToFileURL(join(sourceRoot,'sites/lib/bank-consent-policy.js')).href);
const now=Date.parse('2026-11-05T12:00:00.000Z'),later=n=>new Date(now+n*60000).toISOString();
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
const source={name:'Synthetic Usage Bank',country:'SE'};
function base(){return{bankName:source.name,country:source.country,requestedValidUntil:later(60),now,selectedAccountUids:[a],session:{accounts:[{uid:a,usage:'ORGA'}],aspsp:{...source},psu_type:'business',access:{valid_until:later(90),transactions:true}},checked:{status:'AUTHORIZED',accounts:[a],accounts_data:[{uid:a}],aspsp:{...source},psu_type:'business',access:{valid_until:later(120),transactions:true}}};}
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const observations=[];
function check(label,mode,input,accepted,reason=null){const original=structuredClone(input);freeze(input);let outcome;
try{const grant=(mode==='strict'?validateEnableConsent:validateLegacyEnableSelection)(input);outcome={accepted:true,accountCount:grant.accountUids.length,validUntil:grant.validUntil};}
catch(e){outcome={accepted:false,code:e.code,status:e.status,reason:bankAccountScopeReason(e)};}
assert.deepEqual(input,original,'pure policy must retain inputs');assert.equal(outcome.accepted,accepted,label);if(reason)assert.equal(outcome.reason,reason,label);if(!outcome.accepted){assert.equal(outcome.code,'BANK_ACCOUNT_SCOPE_INVALID');assert.equal(outcome.status,409);}
observations.push({label,mode,...outcome});}
const variants=[['omitted',undefined,true,true],['explicit_undefined',undefined,true,false],['ORGA','ORGA',true],['PRIV','PRIV',false],['null',null,false],['empty_string','',false],['lowercase_orga','orga',false],['padded_ORGA',' ORGA ',false],['business_string','business',false],['other_string','UNKNOWN',false],['number',0,false],['boolean',false,false],['array',[],false],['object',{},false]];
for(const mode of ['strict','legacy'])for(const side of ['saved','live'])for(const[label,value,accepted,omitted]of variants){const input=base(),account=side==='saved'?input.session.accounts[0]:input.checked.accounts_data[0];if(omitted)delete account.usage;else account.usage=value;check(`${side}:${label}`,mode,input,accepted,accepted?null:'ACCOUNT_USAGE_INVALID');}
function two(){const x=base();x.session.accounts.push({uid:b,usage:'ORGA'});x.checked.accounts.push(b);x.checked.accounts_data.push({uid:b});return x;}
{const x=two();x.session.accounts[1].usage='PRIV';check('unselected_saved_private_retains_selected_grant','legacy',x,true);}
{const x=two();x.checked.accounts_data[1].usage='PRIV';check('unselected_live_private_retains_selected_grant','legacy',x,true);}
{const x=two();x.session.accounts[1].usage=null;x.checked.accounts_data[1].usage=null;check('unselected_explicit_null_retains_selected_grant','legacy',x,true);}
{const x=two();x.selectedAccountUids.push(b);x.checked.accounts_data[1].usage='PRIV';check('selected_second_private_is_held','legacy',x,false,'ACCOUNT_USAGE_INVALID');}
{const x=two();x.checked.accounts_data.pop();check('unselected_UID_set_mismatch_still_fails_full_inventory','legacy',x,false,'LIVE_ACCOUNT_SET_MISMATCH');}
{const x=two();x.checked.accounts[1]='not-a-uuid';check('unselected_invalid_UID_still_fails_full_inventory','legacy',x,false,'LIVE_ACCOUNTS_INVALID');}
const result={schema:'mgeorge-bank-usage-readonly-diagnosis-v1',sourceCommit:'819adee2f3848b474167eb6b15f82584caeb39af',sourceHashes:Object.fromEntries(['sites/lib/bank-consent-policy.js','sites/lib/banking/enable-banking.ts','sites/lib/banking/service.ts','sites/lib/banking/store.ts','sites/lib/banking/mcp.ts'].map(p=>[p,hashFile(join(sourceRoot,p))])),scriptSha256:hashFile(fileURLToPath(import.meta.url)),node:process.version,bankRequests:0,credentialReads:0,productionDataReads:0,productionWrites:0,syntheticCases:observations.length,accepted:observations.filter(x=>x.accepted).length,rejected:observations.filter(x=>!x.accepted).length,assertionsPassed:true,observations};
writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({cases:result.syntheticCases,accepted:result.accepted,rejected:result.rejected,sourceCommit:result.sourceCommit,assertionsPassed:true}));
