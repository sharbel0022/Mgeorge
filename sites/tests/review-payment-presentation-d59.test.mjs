import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {emptyState,invoiceReferenceMatchIssue,bankApiOriginalIssue,recordedPaymentSourceIssue,bankPaymentReviewReason,paid} from '../lib/domain.ts';
import {syntheticBankTransaction} from './helpers/bank-api-fixture.mjs';

async function moduleFrom(path,aliases){
 let source=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 for(const [from,to]of Object.entries(aliases))for(const quote of ['"',"'"])source=source.replaceAll(quote+from+quote,JSON.stringify(new URL(to,import.meta.url).href));
 return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}
const {bankPaymentView,bankPaymentCounts}=await moduleFrom('../lib/payment-presentation.ts',{'./domain':'../lib/domain.ts','./reconciliation-engine.js':'../lib/reconciliation-engine.js','./payment-references.js':'../lib/payment-references.js'});
const {transactionDetailEvidence}=await moduleFrom('../lib/banking/detail-evidence.ts',{'../domain':'../lib/domain.ts','../payment-references.js':'../lib/payment-references.js','../payer-evidence.js':'../lib/payer-evidence.js'});

function fixture({reference='00723',description='Chargeback',effect='payment'}={}){
 const state=emptyState();
 state.invoices=[{id:'synthetic-review-invoice',direction:'receivable',number:'00723',ocr:'00723',party:'Synthetic invoiced customer',total:83000,currency:'SEK',issued:'2026-10-01',due:'2026-11-01',reviewed:true,documentId:'synthetic-review-original'}];
 state.transactions=[syntheticBankTransaction({id:'synthetic-review-payment',date:'2026-11-05',amount:83000,party:'Synthetic bank payer',payerReference:reference,account:'synthetic-account',kind:'payment',description,verified:true})];
 state.allocations=[{id:'synthetic-review-allocation',invoiceId:state.invoices[0].id,transactionId:state.transactions[0].id,amount:83000,effect,active:true}];
 assert.equal(bankApiOriginalIssue(state.transactions[0]),'');
 return state;
}
function details(state,reference,extra={}){
 const t=state.transactions[0],raw={...structuredClone(t.bankData),reference_number:reference,...extra};
 t.bankDetails={...transactionDetailEvidence(t,t.bankData,raw),checkedAt:'2026-11-05T00:00:00Z',documentId:'synthetic-detail-original',bankReferenceText:''};
}
function inspect(state,expected='BLOCKED'){
 const before=structuredClone(state),ledger=paid(state,state.invoices[0].id),actual=bankPaymentView(state,state.transactions[0]);
 assert.deepEqual(state,before);assert.equal(paid(state,state.invoices[0].id),ledger);
 assert.equal(bankPaymentCounts(state).verified,0);assert.equal(actual.decision.code,expected,JSON.stringify(actual.decision));
 return actual;
}

test('baseline chargeback retains REVIEW with no independent issue',()=>{inspect(fixture(),'REVIEW');});
for(const [name,change]of [
 ['altered original',s=>{s.transactions[0].bankData.note='Synthetic unsealed mutation';}],
 ['missing receipt',s=>{delete s.transactions[0].bankDataSha256;}],
 ['account hold',s=>{s.transactions[0].bankAccountIssue='Synthetic current account hold';}],
 ['missing account',s=>{s.transactions[0].account='';}],
 ['unbacked details',s=>{s.transactions[0].bankDetails={status:'identified',party:'Synthetic detail payer',payerReference:'00723'};}],
 ['invoice policy conflict',s=>{s.invoices[0].ocr='00724';}],
 ['duplicate reference owner',s=>{s.invoices.push({...s.invoices[0],id:'synthetic-other-invoice'});}],
 ['duplicate transaction',s=>{s.transactions[0].duplicateOf='synthetic-other-payment';}],
 ['ignored transaction',s=>{s.transactions[0].ignored=true;}]
])test('chargeback cannot hide '+name,()=>{const s=fixture();change(s);inspect(s);});

test('chargeback cannot hide a conflicting retained AIS reference behind matching detail reference',()=>{
 const s=fixture({reference:'00724'});details(s,'00723');
 assert.match(invoiceReferenceMatchIssue(s,s.invoices[0],s.transactions[0]),/referensen stämmer inte exakt/);
 const retainedIssue=recordedPaymentSourceIssue(s,s.transactions[0],s.invoices[0],'payment');
 assert.match(retainedIssue,/referensen stämmer inte exakt/);
 assert.notEqual(retainedIssue,bankPaymentReviewReason(s.transactions[0],s));
 const actual=inspect(s);assert.match(actual.decision.reason,/referens/i);
});

test('chargeback cannot hide incomplete retained detail reference evidence behind complete AIS reference',()=>{
 const s=fixture();details(s,'00723',{remittance_information:Array.from({length:101},()=> 'Faktura 00723')});
 assert.equal(s.transactions[0].bankDetails.referenceEvidence.incomplete,true);
 assert.equal(s.transactions[0].bankDetails.payerReference,'');
 assert.match(invoiceReferenceMatchIssue(s,s.invoices[0],s.transactions[0]),/ofullständigt|ogiltig OCR/);
 const actual=inspect(s);assert.match(actual.decision.reason,/referens|OCR/i);
});

test('chargeback cannot hide a direction-inconsistent historical allocation',()=>{inspect(fixture({effect:'refund'}));});

test('invoice original missing cannot become VERIFIED under chargeback',()=>{const s=fixture();s.invoices[0].documentId='';inspect(s,'REVIEW');});
test('invoice review missing cannot become VERIFIED under chargeback',()=>{const s=fixture();s.invoices[0].reviewed=false;inspect(s,'REVIEW');});
