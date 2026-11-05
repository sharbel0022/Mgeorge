import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {applyCommand,balance,invoicePaymentEvidenceIssue,invoiceStatus,paymentInvoiceAssessment,paymentOriginalIssue} from '../lib/domain.ts';
import {genericCompanyState as emptyState} from './helpers/reference-policy-fixture.mjs';
import {economySummary} from '../lib/economy-summary.js';
import {syntheticBankRow} from './helpers/bank-api-fixture.mjs';

const url=path=>new URL(path,import.meta.url).href;
let code=stripTypeScriptTypes(readFileSync(new URL('../lib/payment-presentation.ts',import.meta.url),'utf8'),{mode:'transform'});
for(const [name,target] of Object.entries({'./domain':url('../lib/domain.ts'),'./reconciliation-engine.js':url('../lib/reconciliation-engine.js'),'./payment-references.js':url('../lib/payment-references.js')}))for(const quote of ['"',"'"])code=code.replaceAll(quote+name+quote,JSON.stringify(target));
const {bankPaymentView,bankPaymentCounts}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));

function booked(description=''){
 let state=applyCommand(emptyState(),{type:'invoice.save',invoice:{direction:'receivable',party:'Synthetic customer AB',organizationNumber:'1111111111',number:'SYN-1',ocr:'',total:10000,issued:'2026-10-01',due:'2026-10-30',reviewed:true}}).state;
 state=applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({date:'2026-10-26',amount:10000,party:'Synthetic customer AB',payerReference:'SYN-1',bankReference:'SYNTHETIC-STATUS',account:'synthetic-account',kind:'payment',verified:true},{bank_transaction_code:{description}})]}).state;
 // Preserved historical bookings also occur in legacy workspaces. They must
 // be assessed against today's bank facts without rewriting their money.
 state.allocations.push({id:'synthetic-allocation',invoiceId:state.invoices[0].id,transactionId:state.transactions[0].id,amount:10000,effect:'payment',active:true,note:'Synthetic historical decision',createdAt:'2026-10-27T00:00:00Z'});
 return state;
}
function assertHeld(state){
 const before=structuredClone(state),invoice=state.invoices[0],payment=state.transactions[0],left=balance(state,invoice);
 const view=bankPaymentView(state,payment),summary=economySummary(state,'2026-10-30');
 assert.deepEqual({issue:!!invoicePaymentEvidenceIssue(state,invoice.id),invoiceStatus:invoiceStatus(state,invoice).key,bankVerified:view.verified,invoiceVerified:view.invoiceVerified,verifiedCount:bankPaymentCounts(state).verified,received:summary.received_month_cents,refunded:summary.refunded_month_cents,unverified:summary.unverified_allocation_count,recent:summary.recent_payments.length},
  {issue:true,invoiceStatus:'review',bankVerified:false,invoiceVerified:false,verifiedCount:0,received:0,refunded:0,unverified:1,recent:0});
 assert.doesNotMatch(view.status,/^Verifierad$|^Delbetalning$|^Överbetalning$/);
 assert.equal(summary.remaining_cents,Math.max(0,left));assert.equal(balance(state,invoice),left);assert.deepEqual(state,before);
}

for(const parent of [false,true])test('current account hold remains visible on a booked payment or its ancestor: '+parent,()=>{
 const state=booked();if(parent){state.transactions[0].parentId='synthetic-parent';state.transactions.push({id:'synthetic-parent',kind:'batch',amount:10000,account:'synthetic-account',currency:'SEK',bankAccountIssue:'Synthetic expired account consent'});}else state.transactions[0].bankAccountIssue='Synthetic expired account consent';
 assertHeld(state);
});
for(const description of ['Reversal','Card refund','Internal transfer','Payroll'])test('booked '+description+' retains a current review status and historical balance',()=>assertHeld(booked(description)));

test('an ancestor bank transaction type remains review evidence for its booked child',()=>{
 const state=booked(),parent=booked('Reversal').transactions[0];parent.id='synthetic-parent';state.transactions[0].parentId=parent.id;state.transactions.push(parent);assertHeld(state);
});
test('an explicitly booked refund keeps its verified refund classification',()=>{
 let state=booked();state=applyCommand(state,{type:'credit.add',invoiceId:state.invoices[0].id,amount:10000,number:'SYN-REFUND-CREDIT',date:'2026-10-27',note:'Synthetic return'}).state;
 state=applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({date:'2026-10-28',amount:-10000,party:'Synthetic customer AB',payerReference:'',bankReference:'SYNTHETIC-REFUND',account:'synthetic-account',kind:'payment',verified:true},{bank_transaction_code:{description:'Refund'}})]}).state;
 state=applyCommand(state,{type:'match.create',invoiceId:state.invoices[0].id,transactionId:state.transactions[1].id,amount:10000,effect:'refund',note:'Explicitly reviewed synthetic refund against the credit'}).state;
 const before=structuredClone(state),summary=economySummary(state,'2026-10-30');
 assert.equal(invoicePaymentEvidenceIssue(state,state.invoices[0].id),'');assert.equal(bankPaymentView(state,state.transactions[0]).verified,true);
 assert.equal(bankPaymentView(state,state.transactions[1]).verified,true);assert.equal(invoiceStatus(state,state.invoices[0]).key,'paid');assert.equal(balance(state,state.invoices[0]),0);
 assert.equal(summary.received_month_cents,10000);assert.equal(summary.refunded_month_cents,10000);assert.equal(summary.unverified_allocation_count,0);assert.deepEqual(state,before);
});

for(const refundFirst of [true,false])test('a mixed historical refund and payment holds the whole bank post regardless of allocation order: '+refundFirst,()=>{
 let state=emptyState();
 for(const [direction,number] of [['receivable','SYN-CUSTOMER'],['payable','SYN-SUPPLIER']])state=applyCommand(state,{type:'invoice.save',invoice:{direction,party:'Synthetic company AB',number,total:10000,issued:'2026-10-01',due:'2026-10-30',reviewed:true}}).state;
 state=applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({date:'2026-10-26',amount:10000,party:'Synthetic company AB',payerReference:'SYN-CUSTOMER',bankReference:'SYNTHETIC-INITIAL',account:'synthetic-account',kind:'payment',verified:true})]}).state;
 state=applyCommand(state,{type:'match.create',invoiceId:state.invoices[0].id,transactionId:state.transactions[0].id,amount:10000,note:'Synthetic initial payment'}).state;
 state=applyCommand(state,{type:'credit.add',invoiceId:state.invoices[0].id,amount:10000,number:'SYN-CREDIT',date:'2026-10-27',note:'Synthetic full credit'}).state;
 state=applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({date:'2026-10-28',amount:-20000,party:'Synthetic company AB',payerReference:'',bankReference:'SYNTHETIC-MIXED-REFUND',account:'synthetic-account',kind:'payment',verified:true},{bank_transaction_code:{description:'Refund'}})]}).state;
 const payment=state.transactions[1];
 state=applyCommand(state,{type:'match.create',invoiceId:state.invoices[0].id,transactionId:payment.id,amount:10000,effect:'refund',referenceCorrection:true,note:'Explicitly reviewed synthetic refund against the customer credit'}).state;
 // Retain a legacy supplier payment on the same bank post. Today's command
 // rejects a new payment against Refund; the projection must hold old ones.
 state.allocations.push({id:'synthetic-legacy-payment',invoiceId:state.invoices[1].id,transactionId:payment.id,amount:10000,effect:'payment',active:true,note:'Synthetic historical supplier booking',createdAt:'2026-10-28T00:00:00Z'});
 if(!refundFirst)state.allocations.reverse();
 const before=structuredClone(state),view=bankPaymentView(state,state.transactions[1]),summary=economySummary(state,'2026-10-30');
 assert.equal(paymentOriginalIssue(state,state.transactions[1]),'');assert.deepEqual(state.invoices.map(i=>balance(state,i)),[0,0]);
 assert.equal(paymentInvoiceAssessment(state,state.transactions[1]).status,'review');assert.equal(view.verified,false);assert.equal(view.invoiceVerified,false);
 assert.equal(invoicePaymentEvidenceIssue(state,state.invoices[0].id),'');assert.ok(invoicePaymentEvidenceIssue(state,state.invoices[1].id));
 assert.equal(summary.unverified_allocation_count,1);assert.equal(summary.refunded_month_cents,10000);assert.equal(summary.received_month_cents,10000);assert.equal(summary.remaining_cents,0);assert.equal(summary.payable_due_cents,0);
 assert.deepEqual(state,before);
});

test('an active credit also locks the invoice organization while unrelated metadata stays editable',()=>{
 let state=applyCommand(emptyState(),{type:'invoice.save',invoice:{direction:'receivable',party:'Synthetic customer AB',organizationNumber:'1111111111',number:'SYN-CREDIT',total:10000,issued:'2026-10-01',due:'2026-10-30',reviewed:true}}).state;
 state=applyCommand(state,{type:'credit.add',invoiceId:state.invoices[0].id,amount:1000,number:'SYN-C1',date:'2026-10-27',note:'Synthetic credit'}).state;
 const before=structuredClone(state);assert.throws(()=>applyCommand(state,{type:'invoice.save',invoice:{...state.invoices[0],organizationNumber:'2222222222'}}),/betalningar|krediter|identitet/i);
 const edited=applyCommand(state,{type:'invoice.save',invoice:{...state.invoices[0],note:'Allowed correction'}}).state;assert.equal(balance(edited,edited.invoices[0]),9000);assert.deepEqual(edited.credits,before.credits);assert.deepEqual(state,before);
});

test('a booked invoice without its reviewed original cannot display an invoice verification badge',()=>{
 const state=booked(),before=structuredClone(state),view=bankPaymentView(state,state.transactions[0]);
 assert.equal(view.decision.code,'REVIEW');
 assert.equal(view.invoiceVerified,false);
 assert.deepEqual(state,before);assert.equal(balance(state,state.invoices[0]),0);
});

test('missing bank payer blocks the invoice verification badge on a historical allocation',()=>{
 let state=applyCommand(emptyState(),{type:'invoice.save',invoice:{direction:'receivable',party:'Synthetic customer AB',number:'SYN-1',total:10000,issued:'2026-10-01',due:'2026-10-30',reviewed:true,documentId:'synthetic-invoice-original'}}).state;
 state=applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({date:'2026-10-26',amount:10000,party:'',payerReference:'SYN-1',bankReference:'SYNTHETIC-NO-PAYER',account:'synthetic-account',kind:'payment',verified:true})]}).state;
 state.allocations.push({id:'synthetic-historical-no-payer',invoiceId:state.invoices[0].id,transactionId:state.transactions[0].id,amount:10000,effect:'payment',active:true,note:'Synthetic historical allocation',createdAt:'2026-10-27T00:00:00Z'});
 const before=structuredClone(state),view=bankPaymentView(state,state.transactions[0]);
 assert.equal(view.decision.code,'BLOCKED');assert.match(view.decision.reason,/betalare/);
 assert.equal(view.invoiceVerified,false);assert.deepEqual(state,before);assert.equal(balance(state,state.invoices[0]),0);
});
