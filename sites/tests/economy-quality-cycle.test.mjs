import test from 'node:test';
import assert from 'node:assert/strict';
import {economySummary} from '../lib/economy-summary.js';

const at='2026-10-30';
function fixture(){
 return {
  invoices:[{id:'invoice',direction:'receivable',number:'0604',party:'Synthetic customer AB',reviewed:true,total:10000,currency:'SEK',due:'2026-10-01'}],
  transactions:[{id:'payment',date:'2026-10-29',amount:10000,currency:'SEK',kind:'payment',verified:true,evidence:'bank_api',party:'Bank payer AB',payerReference:'0604',account:'synthetic-account',original:{party:'Bank payer AB',payerReference:'0604'}}],
  allocations:[{id:'allocation',invoiceId:'invoice',transactionId:'payment',amount:10000,effect:'payment',active:true}],credits:[]
 };
}
function expectHeld(s){
 const before=JSON.stringify(s),summary=economySummary(s,at);
 assert.equal(summary.received_month_cents,0);
 assert.equal(summary.unverified_allocation_count,1);
 assert.deepEqual(summary.recent_payments,[]);
 assert.equal(summary.remaining_cents,0,'a review hold must not silently undo an existing allocation');
 assert.equal(JSON.stringify(s),before,'the overview is a read-only projection');
}
test('overview does not label a manually entered original snapshot as bank-supplied identity',()=>{
 const s=fixture(),t=s.transactions[0];t.evidence='manual';t.verification={party:t.party,payerReference:t.payerReference,note:'Synthetic review'};
 const row=economySummary(s,at).recent_payments[0];
 assert.equal(row.payer,'');assert.equal(row.reference,'');assert.equal(row.manually_completed,true);
 assert.equal(row.customer,'Synthetic customer AB');
});
test('overview preserves actual bank identity and exact reference separately from invoice customer',()=>{
 const row=economySummary(fixture(),at).recent_payments[0];
 assert.equal(row.payer,'Bank payer AB');assert.equal(row.reference,'0604');assert.notEqual(row.payer,row.customer);
});
test('conflicted preserved allocations are not counted as verified monthly receipts',()=>{
 const s=fixture();s.transactions[0].bankEvidenceConflicts=[{fields:['party'],incoming:{party:'Contradictory AB'}}];expectHeld(s);
});
test('a conflicted parent also removes child allocations from verified receipt reporting',()=>{
 const s=fixture();s.transactions[0].parentId='parent';s.transactions.push({id:'parent',kind:'batch',amount:10000,account:'synthetic-account',currency:'SEK',bankEvidenceConflicts:[{fields:['amount'],incoming:{amount:9000}}]});expectHeld(s);
});
test('unavailable originals on the payment or parent stay visible as unverified allocations',()=>{
 for(const parent of [false,true]){const s=fixture();if(parent){s.transactions[0].parentId='parent';s.transactions.push({id:'parent',kind:'batch',amount:10000,account:'synthetic-account',currency:'SEK',bankOriginalIssue:'Original missing'});}else s.transactions[0].bankOriginalIssue='Original missing';expectHeld(s);}
});
test('legacy or unreviewed file proof cannot produce verified monthly receipts',()=>{
 for(const proof of [undefined,{version:'bank-file-original-v1',documentId:'original',sha256:'a'.repeat(64)}]){const s=fixture();s.transactions[0].evidence='bank_file';s.transactions[0].bankFileProof=proof;expectHeld(s);}
 const s=fixture();s.transactions[0].evidence='bank_file';s.transactions[0].bankFileProof={version:'bank-file-original-v1',documentId:'original',sha256:'a'.repeat(64),reviewedAt:at};assert.equal(economySummary(s,at).received_month_cents,10000);
});
test('invalid or incomplete reference evidence cannot be presented as a verified receipt',()=>{
 for(const evidence of [{incomplete:true,candidates:[]},{candidates:[{kind:'ocr',value:'0604',validity:'checksum_invalid'}]}]){const s=fixture();s.transactions[0].referenceEvidence=evidence;expectHeld(s);}
});
