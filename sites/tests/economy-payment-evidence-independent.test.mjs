import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {applyCommand,balance,paid,paymentOriginalIssue} from '../lib/domain.ts';
import {genericCompanyState} from './helpers/reference-policy-fixture.mjs';
import {syntheticBankTransaction} from './helpers/bank-api-fixture.mjs';
import {economySummary} from '../lib/economy-summary.js';
const at='2026-11-05';
let source=ts.transpileModule(readFileSync(new URL('../lib/payment-presentation.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
for(const [name,path]of Object.entries({'./domain':'../lib/domain.ts','./reconciliation-engine.js':'../lib/reconciliation-engine.js','./payment-references.js':'../lib/payment-references.js'}))for(const q of ['"',"'"])source=source.replaceAll(q+name+q,JSON.stringify(new URL(path,import.meta.url).href));
const {bankPaymentView}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
let detailSource=ts.transpileModule(readFileSync(new URL('../lib/banking/detail-evidence.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
for(const [name,path]of Object.entries({'../domain':'../lib/domain.ts','../payment-references.js':'../lib/payment-references.js','../payer-evidence.js':'../lib/payer-evidence.js'}))for(const q of ['"',"'"])detailSource=detailSource.replaceAll(q+name+q,JSON.stringify(new URL(path,import.meta.url).href));
const {transactionDetailEvidence}=await import('data:text/javascript;base64,'+Buffer.from(detailSource).toString('base64'));
function savedDetails(t,{party='Synthetic detail payer',reference='00599'}={}){
 const raw={...structuredClone(t.bankData),[t.amount>0?'debtor':'creditor']:{name:party},reference_number:reference};
 return {...transactionDetailEvidence(t,t.bankData,raw),checkedAt:at+'T00:00:00Z',documentId:'synthetic-detail-original',bankReferenceText:''};
}
function fixture({party='Synthetic bank payer',reference='00599',account='synthetic-account',original=true,reviewed=true,effect='payment'}={}){
 const state=applyCommand(genericCompanyState(),{type:'invoice.save',invoice:{direction:'receivable',number:'00599',ocr:'00599',party:'Synthetic invoice customer',total:10000,issued:'2026-01-01',due:at,reviewed,documentId:original?'synthetic-invoice-original':''}}).state;
 state.transactions.push(syntheticBankTransaction({id:'synthetic-payment',date:at,amount:effect==='refund'?-10000:10000,party,payerReference:reference,account,kind:'payment',verified:true}));
 state.allocations.push({id:'synthetic-historical-allocation',invoiceId:state.invoices[0].id,transactionId:'synthetic-payment',amount:10000,effect,active:true,note:'Synthetic historical decision',createdAt:at+'T00:00:00Z'});return state;
}
function inspect(s){const before=structuredClone(s),summary=economySummary(s,at),view=bankPaymentView(s,s.transactions[0]);assert.deepEqual(s,before);assert.equal(paid(s,s.invoices[0].id),s.allocations[0].effect==='refund'?-10000:10000);assert.equal(summary.remaining_cents,Math.max(0,balance(s,s.invoices[0])));return {summary,view};}
function expectHeld(s){const {summary,view}=inspect(s);console.log(JSON.stringify({case:test.name,received:summary.received_month_cents,refunded:summary.refunded_month_cents,held:summary.unverified_allocation_count,detail:view.decision.code,reason:view.decision.reason,sourceIssue:paymentOriginalIssue(s,s.transactions[0]),recent:summary.recent_payments}));assert.equal(summary.received_month_cents,0);assert.equal(summary.refunded_month_cents,0);assert.equal(summary.unverified_allocation_count,1);assert.deepEqual(summary.recent_payments,[]);}
test('independent: actual complete AIS original remains a positive source case',()=>{const {summary,view}=inspect(fixture());assert.equal(summary.received_month_cents,10000);assert.equal(view.decision.code,'VERIFIED');});
for(const [name,options]of [['missing payer',{party:''}],['missing reference',{reference:''}],['missing account',{account:''}],['missing original',{original:false}],['unreviewed invoice',{reviewed:false}],['refund missing reference',{effect:'refund',reference:''}]])test('independent: '+name,()=>expectHeld(fixture(options)));
test('independent: manual completion preserves legitimate bank original identity',()=>{const s=fixture();s.transactions[0]=syntheticBankTransaction({id:'synthetic-payment',date:at,amount:10000,party:'Typed alternate payer',payerReference:'00599',account:'synthetic-account',kind:'payment',verified:true,original:{party:'Synthetic bank payer',payerReference:'00599'},verification:{party:'Typed alternate payer',payerReference:'00599',note:'Synthetic manual review',at:at+'T00:00:00Z'}});const {summary}=inspect(s);assert.equal(summary.received_month_cents,10000);assert.equal(summary.recent_payments[0].payer,'Synthetic bank payer');});
test('independent: unsupported bankDetails cannot fill missing bank-original payer and reference',()=>{const s=fixture({party:'',reference:''});s.transactions[0].bankDetails={status:'identified',checkedAt:at+'T00:00:00Z',party:'Unsupported details payer',payerReference:'00599',referenceSchema:'',reason:'Synthetic unsourced details',documentId:'',bankReferenceText:''};expectHeld(s);});
test('independent: unsupported bankDetails cannot certify a manual-only historical source',()=>{const s=fixture();s.transactions[0]={id:'synthetic-payment',date:at,amount:10000,currency:'SEK',account:'synthetic-account',party:'Typed payer',payerReference:'00599',kind:'payment',verified:true,evidence:'manual_verified',source:'Manuellt registrerad',original:{party:'Typed payer',payerReference:'00599'},verification:{party:'Typed payer',payerReference:'00599',note:'Synthetic manual review',at:at+'T00:00:00Z'},bankDetails:{status:'identified',checkedAt:at+'T00:00:00Z',party:'Unsupported details payer',payerReference:'00599',referenceSchema:'',reason:'Synthetic unsourced details',documentId:'',bankReferenceText:''}};expectHeld(s);});
test('independent: receiving-account hold shown by detail also holds summary',()=>{const s=fixture();s.transactions[0].bankgiroAccountIssue='Synthetic current receiving account mismatch';const view=bankPaymentView(s,s.transactions[0]);assert.equal(view.decision.code,'BLOCKED');expectHeld(s);});
test('independent: allocation to another preserved reference must not outrank detail',()=>{const s=fixture({reference:'00600'});assert.equal(bankPaymentView(s,s.transactions[0]).decision.code,'BLOCKED');expectHeld(s);});
test('independent: unsourced details cannot turn a refund with missing reference into verified refund',()=>{const s=fixture({effect:'refund',party:'',reference:''});s.transactions[0].bankDetails={status:'identified',checkedAt:at+'T00:00:00Z',party:'Unsupported refund recipient',payerReference:'00599',referenceSchema:'',reason:'Synthetic unsourced details',documentId:'',bankReferenceText:''};expectHeld(s);});
test('independent: complete explicit refund still records exact refund amount',()=>{const {summary}=inspect(fixture({effect:'refund'}));assert.equal(summary.refunded_month_cents,10000);assert.equal(summary.received_month_cents,0);});

// Freeze source-specific controls before changing the shared presentation guard.
for(const effect of ['payment','refund'])test('saved original-backed detail evidence remains positive: '+effect,()=>{
 const s=fixture({effect,party:'',reference:''});s.transactions[0].bankDetails=savedDetails(s.transactions[0]);
 const {summary,view}=inspect(s);assert.equal(summary[effect==='refund'?'refunded_month_cents':'received_month_cents'],10000);assert.equal(summary.unverified_allocation_count,0);assert.equal(view.payer,'Synthetic detail payer');assert.equal(view.reference.value,'00599');
});
test('a saved detail payer can coexist with the unchanged AIS reference',()=>{
 const s=fixture();s.transactions[0].bankDetails=savedDetails(s.transactions[0],{reference:''});
 const {summary,view}=inspect(s);assert.equal(summary.received_month_cents,10000);assert.equal(view.fieldSources.payer.kind,'detail');assert.equal(view.fieldSources.reference.kind,'transaction');assert.equal(view.reference.value,'00599');
});
for(const documentId of ['', '   '])test('unsourced detail metadata cannot verify either presentation: '+JSON.stringify(documentId),()=>{
 const s=fixture({party:'',reference:''});s.transactions[0].bankDetails={...savedDetails(s.transactions[0]),documentId};
 expectHeld(s);const view=bankPaymentView(s,s.transactions[0]);assert.notEqual(view.decision.code,'VERIFIED');assert.equal(view.payerKnown,false);assert.equal(view.reference.value,'');
});
test('a claimed detail document cannot give a manually entered bank post AIS provenance',()=>{
 const s=fixture({party:'',reference:''}),bankDetails=savedDetails(s.transactions[0]);
 s.transactions[0]={id:'synthetic-payment',date:at,amount:10000,currency:'SEK',account:'synthetic-account',party:'Typed payer',payerReference:'00599',kind:'payment',verified:true,evidence:'manual_verified',source:'Manuellt registrerad',original:{party:'Typed payer',payerReference:'00599'},bankDetails};
 expectHeld(s);assert.notEqual(bankPaymentView(s,s.transactions[0]).decision.code,'VERIFIED');
});
test('a receiving-account hold on the original ancestor holds both presentations',()=>{
 const s=fixture(),parent=syntheticBankTransaction({id:'synthetic-parent',date:at,amount:10000,account:'synthetic-account',party:'Synthetic bank payer',payerReference:'00599',kind:'batch',verified:true});
 parent.bankgiroAccountIssue='Synthetic ancestor receiving account mismatch';s.transactions[0].parentId=parent.id;s.transactions.push(parent);
 expectHeld(s);assert.notEqual(bankPaymentView(s,s.transactions[0]).decision.code,'VERIFIED');
});
for(const settled of [false,true])test('reference ownership includes '+(settled?'settled':'unreviewed')+' invoices and is reevaluated on the next read',()=>{
 const s=fixture();assert.equal(economySummary(s,at).received_month_cents,10000);
 s.invoices.push({...s.invoices[0],id:'synthetic-other-invoice',reviewed:settled});
 if(settled){s.transactions.push(syntheticBankTransaction({id:'synthetic-other-payment',date:at,amount:10000,party:'Synthetic bank payer',payerReference:'00599',bankReference:'SYNTHETIC-OTHER-ENTRY',account:'synthetic-account',kind:'payment',verified:true}));s.allocations.push({id:'synthetic-other-allocation',invoiceId:'synthetic-other-invoice',transactionId:'synthetic-other-payment',amount:10000,effect:'payment',active:true});}
 const before=structuredClone(s),summary=economySummary(s,at);assert.equal(summary.received_month_cents,0);assert.equal(summary.unverified_allocation_count,settled?2:1);assert.equal(summary.valid,true);assert.deepEqual(s,before);
 s.invoices.pop();if(settled){s.transactions.pop();s.allocations.pop();}assert.equal(economySummary(s,at).received_month_cents,10000);
});
