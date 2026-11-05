import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {emptyState,invoiceReferenceMatchIssue,paid} from '../lib/domain.ts';
import {genericCompanyState} from './helpers/reference-policy-fixture.mjs';
import {syntheticBankTransaction} from './helpers/bank-api-fixture.mjs';
import {economySummary} from '../lib/economy-summary.js';
const at='2026-11-05';
async function moduleFrom(path,aliases){
 let source=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 for(const [from,to]of Object.entries(aliases))for(const quote of ['"',"'"])source=source.replaceAll(quote+from+quote,JSON.stringify(new URL(to,import.meta.url).href));
 return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}
const {bankPaymentView}=await moduleFrom('../lib/payment-presentation.ts',{'./domain':'../lib/domain.ts','./reconciliation-engine.js':'../lib/reconciliation-engine.js','./payment-references.js':'../lib/payment-references.js'});
const {transactionDetailEvidence}=await moduleFrom('../lib/banking/detail-evidence.ts',{'../domain':'../lib/domain.ts','../payment-references.js':'../lib/payment-references.js','../payer-evidence.js':'../lib/payer-evidence.js'});
function fixture({number='00599',ocr=number,reference=number,strict=false}={}){
 const state=strict?emptyState():genericCompanyState();
 state.invoices.push({id:'synthetic-invoice',direction:'receivable',number,ocr,party:'Synthetic customer',total:10000,currency:'SEK',issued:'2026-01-01',due:at,reviewed:true,documentId:'synthetic-invoice-original'});
 state.transactions.push(syntheticBankTransaction({id:'synthetic-payment',date:at,amount:10000,party:'Synthetic original payer',payerReference:reference,account:'synthetic-account',kind:'payment',verified:true}));
 state.allocations.push({id:'synthetic-allocation',invoiceId:'synthetic-invoice',transactionId:'synthetic-payment',amount:10000,effect:'payment',active:true});
 return state;
}
function setDetails(state,reference,extra={}){
 const t=state.transactions[0],raw={...structuredClone(t.bankData),reference_number:reference,...extra};
 t.bankDetails={...transactionDetailEvidence(t,t.bankData,raw),checkedAt:at+'T00:00:00Z',documentId:'synthetic-detail-original',bankReferenceText:''};
}
test('separate company policies never share cached decisions for the same invoice objects',()=>{
 const generic=fixture({ocr:'00600',reference:'00600'}),strict={...generic,company:emptyState().company};
 for(let n=0;n<3;n++){
  assert.equal(economySummary(generic,at).received_month_cents,10000);
  assert.equal(economySummary(strict,at).received_month_cents,0);
 }
});
test('changing company policy between reads invalidates all derived decisions',()=>{
 const s=fixture({ocr:'00600',reference:'00600'}),genericName=s.company.name;
 assert.equal(economySummary(s,at).received_month_cents,10000);
 s.company.name=emptyState().company.name;
 assert.equal(economySummary(s,at).received_month_cents,0);
 s.company.name=genericName;
 assert.equal(economySummary(s,at).received_month_cents,10000);
});
test('a held conflicting original reserves its identifier on each new read',()=>{
 const s=fixture({strict:true});
 assert.equal(economySummary(s,at).received_month_cents,10000);
 s.invoices.push({...s.invoices[0],id:'synthetic-held-owner',number:'00600',ocr:'00600',reviewed:false,referenceOriginal:{invoice_number:'00600',reference:'00599'}});
 const before=structuredClone(s),held=economySummary(s,at);
 assert.equal(held.received_month_cents,0);assert.equal(held.unverified_allocation_count,1);assert.deepEqual(s,before);
 s.invoices.pop();assert.equal(economySummary(s,at).received_month_cents,10000);
});
test('a saved detail reference cannot hide a different retained AIS reference',()=>{
 const s=fixture({reference:'00600',strict:true});setDetails(s,'00599');
 assert.ok(invoiceReferenceMatchIssue(s,s.invoices[0],s.transactions[0]));
 const before=structuredClone(s),summary=economySummary(s,at),view=bankPaymentView(s,s.transactions[0]);
 console.log(JSON.stringify({case:'conflicting-retained-references',summary,decision:view.decision,details:s.transactions[0].bankDetails}));
 assert.deepEqual(s,before);assert.equal(paid(s,'synthetic-invoice'),10000);
 assert.equal(summary.received_month_cents,0);assert.notEqual(view.decision.code,'VERIFIED');
});
test('an incomplete saved detail reference cannot disappear behind the complete AIS reference',()=>{
 const s=fixture({strict:true});setDetails(s,'00599',{remittance_information:Array.from({length:101},()=> 'Faktura 00599')});
 assert.equal(s.transactions[0].bankDetails.referenceEvidence.incomplete,true);assert.equal(s.transactions[0].bankDetails.payerReference,'');
 assert.ok(invoiceReferenceMatchIssue(s,s.invoices[0],s.transactions[0]));
 const before=structuredClone(s),summary=economySummary(s,at),view=bankPaymentView(s,s.transactions[0]);
 console.log(JSON.stringify({case:'incomplete-retained-detail',received:summary.received_month_cents,held:summary.unverified_allocation_count,decision:view.decision}));
 assert.deepEqual(s,before);assert.equal(paid(s,'synthetic-invoice'),10000);
 assert.equal(summary.received_month_cents,0);assert.notEqual(view.decision.code,'VERIFIED');
});
