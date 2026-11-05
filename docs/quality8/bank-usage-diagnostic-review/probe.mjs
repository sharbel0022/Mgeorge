import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const path='sites/lib/bank-consent-policy.js';
const beforeCode=execFileSync('git',['show','b020d02:'+path],{encoding:'utf8'}).replace("from './company-contract.js'",'from '+JSON.stringify(pathToFileURL(process.cwd()+'/sites/lib/company-contract.js').href));
const before=await import('data:text/javascript;base64,'+Buffer.from(beforeCode).toString('base64'));
const after=await import(pathToFileURL(process.cwd()+'/'+path).href);
const now=Date.parse('2026-11-05T00:00:00.000Z'),until='2026-11-06T00:00:00.000Z';
const uid='11111111-1111-4111-8111-111111111111';
const usageValues=[undefined,'ORGA','PRIV',null,'','orga',' ORGA ','\u0000ORGA','UNKNOWN',false,true,0,1,[],{},['ORGA']];
const count=value=>({omitted:Number(value===undefined),orga:Number(value==='ORGA'),priv:Number(value==='PRIV'),explicitNull:Number(value===null),otherString:Number(typeof value==='string'&&!['ORGA','PRIV'].includes(value)),wrongType:Number(value!==null&&value!==undefined&&typeof value!=='string')});
const snapshot=(saved,live)=>({bankName:'Synthetic Bank',country:'SE',requestedValidUntil:until,now,selectedAccountUids:[uid],session:{accounts:[{uid,...(saved===undefined?{}:{usage:saved})}],aspsp:{name:'Synthetic Bank',country:'SE'},psu_type:'business',access:{valid_until:until}},checked:{status:'AUTHORIZED',accounts:[uid],accounts_data:[{uid,...(live===undefined?{}:{usage:live})}],aspsp:{name:'Synthetic Bank',country:'SE'},psu_type:'business',access:{valid_until:until}}});
const outcome=(module,input,strict=false)=>{try{return{result:module[strict?'validateEnableConsent':'validateLegacyEnableSelection'](input)}}catch(error){return{error,denial:{code:error.code,status:error.status,message:error.message,reason:module.bankAccountScopeReason(error)}}}};
let combinations=0,allowed=0,denied=0,strictDenied=0;
for(const saved of usageValues)for(const live of usageValues){
 const input=snapshot(saved,live),original=structuredClone(input);
 const a=outcome(before,input),b=outcome(after,input);
 assert.deepEqual(a.result,b.result);assert.deepEqual(a.denial,b.denial);assert.deepEqual(input,original);
 if(b.error){
   denied++;assert.deepEqual(after.bankAccountUsageDiagnostic(b.error),{version:'selected-account-usage-v1',selectedCount:1,saved:count(saved),live:count(live)});
   const strict=outcome(after,input,true);assert.equal(strict.denial.reason,'ACCOUNT_USAGE_INVALID');assert.equal(after.bankAccountUsageDiagnostic(strict.error),null);strictDenied++;
 }else allowed++;
 combinations++;
}
let unusual=0;
for(const val of [1n,Symbol('PRIVATE_SYMBOL'),()=>{throw Error('NOT_CALLED');}]){
 const input=snapshot('ORGA',val),a=outcome(before,input),b=outcome(after,input);assert.deepEqual(a.denial,b.denial);assert.equal(after.bankAccountUsageDiagnostic(b.error).live.wrongType,1);assert.doesNotThrow(()=>JSON.stringify(after.bankAccountUsageDiagnostic(b.error)));unusual++;
}
const input=snapshot(null,'ORGA');let descriptorCalls=0;
input.session.accounts[0]=new Proxy(input.session.accounts[0],{getOwnPropertyDescriptor(){descriptorCalls++;throw Error('PRIVATE_REFLECTION');}});
const a=outcome(before,input),b=outcome(after,input);assert.deepEqual(a.denial,b.denial);assert.equal(after.bankAccountUsageDiagnostic(b.error),null);assert.equal(descriptorCalls,1);
const paths=[path,'sites/lib/bank-consent-policy.d.ts','sites/lib/banking/service.ts','sites/tests/bank-usage-diagnostic.test.mjs','sites/tests/banking-security.test.mjs'];
const hashes=Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));
console.log(JSON.stringify({baseline:'b020d020ad7ab8d4ca7417959d01ceb1613a5709',combinations,allowed,denied,strictDenialsWithoutDiagnostic:strictDenied,unusualValues:unusual,throwingReflectionPreservesOriginalDenial:true,sourceAndTestSha256:hashes},null,2));
