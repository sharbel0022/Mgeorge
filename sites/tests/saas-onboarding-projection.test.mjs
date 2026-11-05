import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {snapshotFixture} from './helpers/saas-onboarding-fixture.mjs';
import {emptyState,applyCommand,bankApiOriginalIssue} from '../lib/domain.ts';
import {normalizeOpenPaymentsWorkspaceRows} from '../lib/banking/openpayments-normalization.js';
import {parseSnapshot} from '../lib/onboarding/contract.ts';
const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
let presentation=stripTypeScriptTypes(readFileSync(new URL('../lib/payment-presentation.ts',import.meta.url),'utf8'),{mode:'transform'});
for(const path of ['./domain','./reconciliation-engine.js','./payment-references.js'])for(const q of ['\"',"'"])presentation=presentation.replaceAll(q+path+q,JSON.stringify(new URL('../lib/'+path.slice(2)+(path==='./domain'?'.ts':''),import.meta.url).href));
let code=stripTypeScriptTypes(readFileSync(new URL('../lib/onboarding/snapshot-projection.ts',import.meta.url),'utf8'),{mode:'transform'});
for(const [from,to] of [['../payment-presentation',data(presentation)],['../domain',new URL('../lib/domain.ts',import.meta.url).href],['./contract',new URL('../lib/onboarding/contract.ts',import.meta.url).href]])for(const q of ['"',"'"])code=code.replaceAll(q+from+q,JSON.stringify(to));
const {projectSync,projectPayments}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const now=new Date().toISOString(),past=new Date(Date.now()-60000).toISOString();
const ready=()=>{const s=snapshotFixture();s.checkedAt=now;s.connection.validUntil=new Date(Date.now()+86400000).toISOString();s.sync.lastSuccessAt=null;return s;};
const status={state:'succeeded',lastSuccessAt:past,nextAllowedAt:null,automaticEnabled:false,errorCode:null,coverage:{ais:'complete',bankgiro:'verified',paymentDataComplete:true}};
test('current durable receipt enables sync status and bounded Bankgiro evidence without fabricating automatic scheduling',()=>{
 const s=ready(),result=projectSync(s,[status],true,true);assert.equal(result.sync.state,'succeeded');assert.equal(result.sync.lastSuccessAt,past);assert.equal(result.sync.automaticEnabled,false);assert.equal(result.bankgiro.state,'available');assert.equal(result.actions.sync,true);parseSnapshot(result,s.companyId);
});
test('new selected account without receipt prevents completed first-fetch state',()=>{
 const s=ready();s.accounts.push({...s.accounts[0],id:'account-b'});const result=projectSync(s,[status,{...status,state:'never',lastSuccessAt:null,coverage:{ais:'unknown',bankgiro:'unknown',paymentDataComplete:false}}],true,true);assert.equal(result.sync.state,'never');assert.equal(result.sync.lastSuccessAt,null);assert.notEqual(result.bankgiro.state,'available');
});
test('cooldown, reader capability and blocked current authority prevent manual action',()=>{
 assert.equal(projectSync(ready(),[status],false,true).actions.sync,false);
 const until=new Date(Date.now()+60000).toISOString(),cooldown=projectSync(ready(),[{...status,state:'failed',nextAllowedAt:until,errorCode:'provider_429'}],true,true);assert.equal(cooldown.actions.sync,false);assert.equal(cooldown.sync.nextAllowedAt,until);
 const blocked=projectSync(ready(),[{...status,state:'blocked',errorCode:'consent_expired'}],true,true);assert.equal(blocked.actions.sync,false);assert.equal(blocked.sync.state,'blocked');
});
test('unavailable actual original cannot become verified from a stored verified flag or familiar reference',async()=>{
 const snapshot=ready(),state=applyCommand(emptyState(),{type:'transactions.import',rows:[{date:now.slice(0,10),amount:62500,currency:'SEK',party:'Synthetic Customer',payerReference:'0000599',account:'SE4550000000058398257466',kind:'payment'}]}).state;
 const t=state.transactions[0];t.source='Open Payments';t.verified=true;t.kind='payment';const result=await projectPayments({snapshot,state,accounts:[t.account],checkOriginal:async()=>false});assert.equal(result.payments[0].verification.status,'review');assert.equal(result.payments[0].verification.reason,'conflict');assert.equal(result.payments[0].reference,null);assert.equal(result.payments[0].payerName,null);assert.equal(state.allocations.length,0);assert.equal(t.verified,true);
});
test('children replace aggregate in overview and other-account observations never cross selection',async()=>{
 const snapshot=ready(),state=emptyState(),base={id:'parent',date:now.slice(0,10),amount:62500,currency:'SEK',party:'Synthetic customer',payerReference:'0599',account:'iban:SE4550000000058398257466',kind:'batch',source:'Open Payments',externalId:'',bankReference:'parent-ref',description:'',verified:false,duplicateOf:'',ignored:false,parentId:'',importId:'import-a',createdAt:now};
 state.transactions=[base,{...base,id:'child',kind:'payment',parentId:'parent',specification:true},{...base,id:'foreign',account:'iban:SE0000000000000000000000'}];
 const result=await projectPayments({snapshot,state,accounts:[base.account],checkOriginal:async()=>true});assert.deepEqual(result.payments.map(t=>t.id),['child']);assert.equal(result.payments[0].verification.status,'review');assert.equal(result.payments[0].reference,null);assert.equal(state.allocations.length,0);
});

for(const missing of [false,true])test('manual completion never replaces '+(missing?'missing':'retained')+' Open Payments payer or reference in bank observation projection',async()=>{
 const snapshot=ready(),raw={entryReference:'synthetic-original-only',bookingDate:now.slice(0,10),transactionAmount:{amount:'625.00',currency:'SEK'},...(missing?{}:{debtorName:'Original synthetic payer',remittanceInformationStructured:'000018'})};
 const rows=normalizeOpenPaymentsWorkspaceRows([raw],{account:'iban:SE4550000000058398257466',dateFrom:raw.bookingDate,dateTo:raw.bookingDate});
 let state=applyCommand(emptyState(),{type:'transactions.import',trustedBankImport:true,rows}).state;
 state=applyCommand(state,{type:'transaction.verify',id:state.transactions[0].id,party:'Separately corrected payer',payerReference:'000026',note:'Synthetic separate manual completion'}).state;
 const t=state.transactions[0],before=JSON.stringify(state);assert.equal(bankApiOriginalIssue(t),'');
 const result=await projectPayments({snapshot,state,accounts:[t.account],checkOriginal:async transaction=>!bankApiOriginalIssue(transaction)}),payment=result.payments[0];
 assert.equal(payment.payerName,missing?null:'Original synthetic payer');
 assert.equal(payment.reference?.value??null,missing?null:'000018');
 if(!missing){assert.equal(payment.reference.source,'bank_account');assert.equal(payment.reference.kind,'payment');}
 else{assert.notEqual(payment.verification.status,'verified');assert.equal(payment.verification.reason,'missing_payer');}
 assert.equal(JSON.stringify(state),before);assert.equal(state.allocations.length,0);
});
