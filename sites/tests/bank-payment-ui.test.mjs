import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {emptyState} from '../lib/domain.ts';
import {extractPaymentReferences} from '../lib/payment-references.js';

const url=p=>new URL(p,import.meta.url).href;
function compiled(path,imports={}){
  let source=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  for(const [name,target]of Object.entries({'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'./domain':url('../lib/domain.ts'),'@/lib/domain':url('../lib/domain.ts'),'./reconciliation-engine.js':url('../lib/reconciliation-engine.js'),'./payment-references.js':url('../lib/payment-references.js'),...imports}))for(const q of ['"',"'"])source=source.replaceAll(q+name+q,JSON.stringify(target));
  return 'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
}
const presentation=compiled('../lib/payment-presentation.ts'),view=await import(presentation);
const ui=await import(compiled('../components/bank-payments.tsx',{'@/lib/payment-presentation':presentation}));
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
const tx=extra=>({id:'t',date:'2026-10-26',amount:62500,currency:'SEK',party:'',payerReference:'',bankReference:'BANK-625',description:'Bankgiro inbetalning',source:'Enable Banking',evidence:'bank_api',externalId:'BANK-625',account:'konto',kind:'batch',verified:false,duplicateOf:'',ignored:false,parentId:'',importId:'',createdAt:'',...extra});
const invoice=extra=>({id:'i',number:'0599',ocr:'',party:'Fakturakund AB',direction:'receivable',total:62500,reviewed:true,voided:false,currency:'SEK',issued:'2026-10-01',due:'2026-11-01',...extra});

test('625 SEK collection never presents invoice customer, bank description or proposed 0599 as payer or OCR',()=>{
  const s=emptyState(),t=tx({party:'Betalardetaljer saknas – importera betalningsspecifikation.',payerReference:'58197013'});s.transactions.push(t);s.invoices.push(invoice());
  const actual=view.bankPaymentView(s,t,[{number:'0599',party:'Fakturakund AB'}]);
  assert.equal(actual.payer,'Betalare okänd');assert.equal(actual.invoice,'Möjlig: 0599');assert.equal(actual.status,'Specifikation saknas');assert.equal(actual.reference.ocr,'');assert.equal(actual.verified,false);
  const before=JSON.stringify(s),html=render(ui.default,{state:s,transactions:[t],candidates:{t:[{number:'0599',party:'Fakturakund AB'}]},open(){throw Error('Render must never perform an action');}});
  assert.match(html,/Betalare okänd/);assert.match(html,/Möjlig: 0599/);assert.doesNotMatch(html,/Fakturakund AB|58197013|Betalardetaljer|OCR 0599/);assert.equal(JSON.stringify(s),before);
});

test('bank-supplied payer and labelled OCR keep leading zeros, separately from invoice identity',()=>{
  const s=emptyState(),t=tx({kind:'payment',party:'Verklig betalare AB',description:'',payerReference:'0001230',verified:true,referenceEvidence:extractPaymentReferences({ocr:'0001230'})});s.transactions.push(t);s.invoices.push(invoice({ocr:'0001230'}));
  const x=view.bankPaymentView(s,t);assert.equal(x.payer,'Verklig betalare AB');assert.equal(x.reference.ocr,'0001230');assert.equal(x.invoice,'Möjlig: 0599');assert.equal(x.status,'Möjlig matchning');assert.equal(x.verified,false);
});

test('numeric invoice reference is never labelled OCR without OCR evidence',()=>{
  const t=tx({kind:'payment',party:'Kund AB',description:'',payerReference:'0599',referenceEvidence:extractPaymentReferences({invoice_number:'0599'})});
  assert.deepEqual(view.bankPaymentReference(t),{value:'0599',kind:'invoice',ocr:''});
});

test('manual completion does not rewrite the bank payer or reference in presentation',()=>{
  const s=emptyState(),t=tx({kind:'payment',description:'',party:'Manuell Kund AB',payerReference:'0599',original:{party:'',payerReference:'',description:'',amount:62500,date:'2026-10-26',account:'konto',bankReference:'BANK-625'},verification:{party:'Manuell Kund AB',payerReference:'0599',note:'Kontrollerad av administratör',at:'2026-10-27T12:00:00Z'},verified:true});
  s.transactions.push(t);const x=view.bankPaymentView(s,t);assert.equal(x.payer,'Betalare okänd');assert.equal(x.reference.value,'');assert.equal(x.manualPayer,'Manuell Kund AB');assert.equal(x.manualReference,'0599');
});

test('identified detail response enriches payer while aggregate remains unverified',()=>{
  const s=emptyState(),t=tx({bankDetails:{status:'identified',party:'Bankens Betalare AB',payerReference:'0599',referenceEvidence:extractPaymentReferences({invoice_number:'0599'})}});s.transactions.push(t);s.invoices.push(invoice());
  const x=view.bankPaymentView(s,t);assert.equal(x.payer,'Bankens Betalare AB');assert.equal(x.status,'Specifikation saknas');assert.equal(x.verified,false);assert.equal(x.reference.ocr,'');
});

test('typed split details remain manual even when the split stores an original snapshot',()=>{
  const t=tx({kind:'payment',parentId:'parent',party:'Manuellt kontrollerad AB',payerReference:'0599',evidence:'verified_specification',description:'',original:{party:'Manuellt kontrollerad AB',payerReference:'0599'}});
  const s=emptyState();s.transactions.push(t);const x=view.bankPaymentView(s,t);assert.equal(x.payer,'Betalare okänd');assert.equal(x.reference.value,'');assert.equal(x.manualPayer,'Manuellt kontrollerad AB');assert.equal(x.manualReference,'0599');
});

test('unsourced legacy and manual names cannot masquerade as a bank-verified payer or OCR',()=>{
  const t=tx({kind:'payment',description:'',party:'Ett inskrivet kundnamn AB',payerReference:'0001230',evidence:undefined,verified:true,referenceEvidence:extractPaymentReferences({ocr:'0001230'}),original:{party:'Ett inskrivet kundnamn AB',payerReference:'0001230'}});
  assert.equal(view.payerLabel(t),'Betalare okänd');assert.equal(view.bankPaymentReference(t).value,'');t.amount=-62500;assert.equal(view.payerLabel(t),'Mottagare okänd');
});

test('active allocations distinguish partial payment, overpayment and verification',()=>{
  const s=emptyState(),t=tx({kind:'payment',description:'',party:'Kund AB',payerReference:'0599',verified:true});s.transactions.push(t);s.invoices.push(invoice({total:100000}));s.allocations.push({id:'a',transactionId:'t',invoiceId:'i',active:true,amount:62500,effect:'payment'});
  assert.equal(view.bankPaymentView(s,t).status,'Delbetalning');s.invoices[0].total=62500;assert.equal(view.bankPaymentView(s,t).status,'Verifierad');t.amount=70000;assert.equal(view.bankPaymentView(s,t).status,'Överbetalning');t.verified=false;assert.equal(view.bankPaymentView(s,t).verified,false);
});

test('conflicting references, duplicate flags and invalid OCR remain visibly unresolved',()=>{
  const s=emptyState(),t=tx({kind:'payment',description:'',party:'Kund AB',payerReference:'0599',verified:true,referenceEvidence:extractPaymentReferences({invoice_number:'0599',payment_reference:'0604'})});s.transactions.push(t);s.invoices.push(invoice(),invoice({id:'two',number:'0604'}));
  assert.equal(view.bankPaymentView(s,t).status,'Konflikt');t.duplicateOf='other';assert.equal(view.bankPaymentView(s,t).status,'Möjlig dubblett');t.duplicateOf='';t.referenceEvidence=extractPaymentReferences({ocr:'12345'});assert.equal(view.bankPaymentView(s,t).status,'Konflikt');
  t.referenceEvidence=extractPaymentReferences({remittance_information:['0599','0604']});assert.equal(view.bankPaymentView(s,t).status,'Konflikt');
});

test('incomplete child specifications retain the original collection in the list',()=>{
  const s=emptyState(),parent=tx();s.transactions.push(parent,tx({id:'child',parentId:'t',kind:'payment',description:'',amount:50000,specificationStatus:'linked'}));
  assert.equal(view.bankVisibleTransactions(s).length,2);s.transactions[1].amount=62500;assert.equal(view.bankVisibleTransactions(s).length,1);s.transactions[1].specificationStatus='review';assert.equal(view.bankVisibleTransactions(s).length,2);
});

test('bank summary has exactly four facts and never invents a successful synchronization',()=>{
  const s=emptyState();s.transactions.push(tx());let html=render(ui.BankPaymentSummary,{state:s});assert.equal((html.match(/<dt>/g)||[]).length,4);assert.match(html,/Inte bekräftad/);html=render(ui.BankPaymentSummary,{state:s,lastSynced:'2026-10-28T10:06:00Z'});assert.doesNotMatch(html,/Inte bekräftad/);assert.match(html,/11:06/);
});

test('desktop has five semantic columns and mobile cards use native action buttons with escaped payer text',()=>{
  const s=emptyState(),t=tx({kind:'payment',description:'',party:'<script>bank</script>'});s.transactions.push(t);const html=render(ui.default,{state:s,transactions:[t],open(){}});
  assert.equal((html.match(/<th(?:\s|>)/g)||[]).length,5);assert.match(html,/bank-mobile-list/);assert.match(html,/bank-payment-card/);assert.match(html,/aria-label="Visa betalning/);assert.match(html,/&lt;script&gt;bank/);assert.doesNotMatch(html,/<script>/);
});
