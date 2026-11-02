import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReconciliationPreview,validateReconciliationApproval} from '../sites/lib/reconciliation-contract.js';
import {reconciliationContractFixture} from './helpers/reconciliation-contract-cases.mjs';

function report(){
 const input=reconciliationContractFixture(),first=input.transactions[0];
 const second={...structuredClone(first),id:'second-child',bankId:'synthetic-child-2',amountMinor:1000,references:[{value:'OTHER',rawValue:'OTHER',source:'$.reference_number',kind:'structured'}]};
 first.parentId=second.parentId='deposit';first.reportId=second.reportId='report';
 first.original=second.original={status:'VERIFIED',source:'bankgiro_file',id:'synthetic-report',sha256:'b'.repeat(64)};
 const parent={...structuredClone(first),id:'deposit',bankId:'synthetic-deposit',kind:'aggregate',amountMinor:74100,economic:false,parentId:'',reportId:'',payerEvidence:null,references:[],original:{status:'VERIFIED',source:'bank_api',id:'synthetic-deposit-original',sha256:'c'.repeat(64)}};
 input.transactions.push(second,parent);
 input.reports=[{id:'report',bankDepositId:parent.bankId,accountId:parent.accountId,currency:'SEK',bookedDate:parent.bookedDate,totalMinor:74100,paymentCount:2,paymentIds:[first.id,second.id],original:structuredClone(first.original)}];
 input.relationships=[{id:'synthetic-link',reportId:'report',transactionId:'deposit',method:'bank_identity',status:'VERIFIED',active:true}];
 return input;
}
const selected=p=>p.decisions.find(d=>d.transactionId==='payment-1');
const approvalFor=(input,preview)=>({contractVersion:preview.contractVersion,source:'stored_business_approval',ownerId:input.ownerId,approvedBy:'synthetic-admin',approved:true,requestId:'synthetic-request',expiresAt:'2026-09-13T12:30:00Z',snapshotSha256:preview.snapshot.sha256,revision:input.revision,decisions:[{transactionId:'payment-1',allocations:selected(preview).allocations.map(({invoiceId,amountMinor,currency})=>({invoiceId,amountMinor,currency}))}]});
function historical(){
 const input=reconciliationContractFixture();input.transactions[0].amountMinor=53100;
 input.transactions.push({...structuredClone(input.transactions[0]),id:'previous',bankId:'previous-bank-id',amountMinor:20000});
 input.allocations=[{id:'earlier-payment',invoiceId:'invoice-1',transactionId:'previous',amountMinor:20000,active:true,effect:'payment'}];
 return input;
}

test('one report cannot certify a row whose retained original belongs to another report',async()=>{
 const input=report();input.transactions[0].original={...input.transactions[0].original,id:'different-report',sha256:'d'.repeat(64)};
 const preview=await buildReconciliationPreview(input);assert.equal(selected(preview).status,'BLOCKED');assert.deepEqual(selected(preview).allocations,[]);
});
test('invalid evidence or ignored rows anywhere in a complete report hold every child proposal',async()=>{
 for(const change of [t=>{t.original.status='BLOCKED';},t=>{t.accountEvidence.status='BLOCKED';},t=>{t.conflict=true;},t=>{t.ignored=true;},t=>{t.reversal=true;}]){
  const input=report();change(input.transactions[1]);const preview=await buildReconciliationPreview(input);
  assert.equal(selected(preview).status,'BLOCKED');assert.deepEqual(selected(preview).allocations,[]);
 }
});
test('an invalid historical allocated original holds new proposals without rewriting the recorded balance',async()=>{
 const input=reconciliationContractFixture();input.transactions[0].amountMinor=53100;
 input.transactions.push({...structuredClone(input.transactions[0]),id:'previous',bankId:'previous-bank-id',amountMinor:20000,original:{status:'BLOCKED',source:'bank_api',id:'missing-original',sha256:''}});
 input.allocations=[{id:'earlier-payment',invoiceId:'invoice-1',transactionId:'previous',amountMinor:20000,active:true,effect:'payment'}];
 const before=structuredClone(input),preview=await buildReconciliationPreview(input);
 assert.equal(selected(preview).status,'BLOCKED');assert.deepEqual(selected(preview).allocations,[]);assert.deepEqual(input,before);
});
test('malformed stored approval selections or replay sets reject without throwing',async()=>{
 const input=reconciliationContractFixture(),preview=await buildReconciliationPreview(input);
 const approval={contractVersion:preview.contractVersion,source:'stored_business_approval',ownerId:input.ownerId,approvedBy:'synthetic-admin',approved:true,requestId:'synthetic-request',expiresAt:'2026-09-13T12:30:00Z',snapshotSha256:preview.snapshot.sha256,revision:7,decisions:[{transactionId:'payment-1',allocations:[{invoiceId:'invoice-1',amountMinor:73100,currency:'SEK'}]}]};
 for(const decisions of [{},true,23,'unexpected'])assert.equal(validateReconciliationApproval(preview,{...approval,decisions},{ownerId:input.ownerId,now:'2026-09-13T12:05:00Z'}).valid,false);
 assert.equal(validateReconciliationApproval(preview,approval,{ownerId:input.ownerId,now:'2026-09-13T12:05:00Z',consumedRequestIds:{}}).valid,false);
});
test('conflicting bank identities in the deposit or any report sibling block the entire group',async()=>{
 for(const targetId of ['deposit','second-child']){
  const input=report(),target=input.transactions.find(t=>t.id===targetId);
  input.transactions.push({...structuredClone(target),id:'contradictory-observation',amountMinor:target.amountMinor+100,parentId:'',reportId:'',references:[]});
  const preview=await buildReconciliationPreview(input);
  assert.equal(selected(preview).status,'BLOCKED');assert.ok(selected(preview).reasonCodes.includes('DUPLICATE_BANK_PAYMENT_ID'));assert.deepEqual(selected(preview).allocations,[]);
 }
});
test('a conflicting bank identity in allocated history cannot certify the remaining invoice balance',async()=>{
 const input=historical(),source=input.transactions[1];
 input.transactions.push({...structuredClone(source),id:'contradictory-history',amountMinor:30000,references:[{value:'OTHER',rawValue:'OTHER',source:'$.reference_number',kind:'structured'}]});
 const preview=await buildReconciliationPreview(input);
 assert.equal(selected(preview).status,'BLOCKED');assert.ok(selected(preview).reasonCodes.includes('EXISTING_ALLOCATION_EVIDENCE_INVALID'));assert.deepEqual(selected(preview).allocations,[]);
});
test('all children naming a replaced deposit must belong to its complete report',async()=>{
 for(const reportId of ['', 'unrelated-report']){
  const input=report(),extra={...structuredClone(input.transactions[1]),id:'unlisted-child',bankId:'unlisted-child-bank-id',reportId};
  input.transactions.push(extra);const preview=await buildReconciliationPreview(input);
  assert.equal(selected(preview).status,'BLOCKED');assert.deepEqual(selected(preview).allocations,[]);
 }
});
test('source evidence expiry invalidates an unchanged stored approval',async()=>{
 const input=reconciliationContractFixture();input.transactions[0].accountEvidence.validUntil='2026-09-13T12:01:00Z';
 const preview=await buildReconciliationPreview(input);assert.equal(selected(preview).status,'VERIFIED');
 const approval=approvalFor(input,preview);
 assert.equal(validateReconciliationApproval(preview,approval,{ownerId:input.ownerId,now:'2026-09-13T12:00:30Z'}).valid,true);
 const expired=validateReconciliationApproval(preview,approval,{ownerId:input.ownerId,now:'2026-09-13T12:05:00Z'});
 assert.equal(expired.valid,false);assert.ok(expired.reasonCodes.includes('STALE_APPROVAL'));
});
test('approval expiry includes deposit siblings and allocated balance evidence without unrelated accounts',async()=>{
 for(const [input,targetId] of [[report(),'deposit'],[report(),'second-child'],[historical(),'previous']]){
  input.transactions.find(t=>t.id===targetId).accountEvidence.validUntil='2026-09-13T12:01:00Z';
  const preview=await buildReconciliationPreview(input);assert.equal(selected(preview).status,'VERIFIED');
  assert.equal(validateReconciliationApproval(preview,approvalFor(input,preview),{ownerId:input.ownerId,now:'2026-09-13T12:05:00Z'}).valid,false);
 }
 const input=reconciliationContractFixture();input.transactions.push({...structuredClone(input.transactions[0]),id:'unrelated',bankId:'unrelated-bank-id',references:[],accountEvidence:{...input.transactions[0].accountEvidence,validUntil:'2026-09-13T11:00:00Z'}});
 const preview=await buildReconciliationPreview(input);assert.equal(selected(preview).status,'VERIFIED');
 assert.equal(validateReconciliationApproval(preview,approvalFor(input,preview),{ownerId:input.ownerId,now:'2026-09-13T12:05:00Z'}).valid,true);
});
