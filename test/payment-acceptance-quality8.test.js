import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReconciliationPreview,validateReconciliationApproval} from '../sites/lib/reconciliation-contract.js';
import {paymentAcceptanceCases,paymentAcceptanceInput} from './helpers/payment-acceptance-quality8.mjs';

for(const scenario of paymentAcceptanceCases)test('independent payment acceptance: '+scenario.id,async()=>{
 const input=paymentAcceptanceInput(scenario.id),before=structuredClone(input),preview=await buildReconciliationPreview(input),row=preview.decisions.find(row=>row.transactionId==='payment-1');
 assert.ok(row);assert.equal(row.status,scenario.expected,JSON.stringify(row.reasonCodes));assert.equal(row.allocations.length,scenario.allocations);
 if(scenario.amounts)assert.deepEqual(row.allocations.map(item=>item.amountMinor),scenario.amounts);
 assert.equal(preview.changed,false);assert.equal(preview.writesAllowed,false);assert.equal(preview.approvalRequired,true);assert.deepEqual(input,before);
 for(const allocation of row.allocations)assert.ok(Number.isSafeInteger(allocation.amountMinor));
 if(row.status!=='VERIFIED')assert.ok(row.reasonCodes.length>0,'Every abstention explains its reason');
 const again=await buildReconciliationPreview(input);assert.equal(again.snapshot.sha256,preview.snapshot.sha256);assert.deepEqual(again.decisions,preview.decisions);
});

test('a business approval cannot make a multi-invoice proposal executable or mutate balances',async()=>{
 const input=paymentAcceptanceInput('two-invoices-exact-ore'),before=structuredClone(input),preview=await buildReconciliationPreview(input),row=preview.decisions[0];
 const approval={contractVersion:preview.contractVersion,source:'stored_business_approval',ownerId:input.ownerId,approvedBy:'synthetic-reviewer',approved:true,requestId:'synthetic-multi-request',expiresAt:'2026-09-13T12:30:00.000Z',snapshotSha256:preview.snapshot.sha256,revision:preview.snapshot.revision,decisions:[{transactionId:row.transactionId,allocations:row.allocations.map(({invoiceId,amountMinor,currency})=>({invoiceId,amountMinor,currency}))}]};
 const result=validateReconciliationApproval(preview,approval,{ownerId:input.ownerId,now:'2026-09-13T12:05:00.000Z',consumedRequestIds:[]});
 assert.equal(result.valid,false);assert.equal(result.writesAllowed,false);assert.ok(result.reasonCodes.includes('DECISION_NOT_VERIFIED'));assert.deepEqual(input,before);
});
