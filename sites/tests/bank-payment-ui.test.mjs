import {syntheticBankTransaction} from './helpers/bank-api-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {paymentInvoiceAssessment} from '../lib/domain.ts';
import {genericCompanyState as emptyState} from './helpers/reference-policy-fixture.mjs';
import {extractPaymentReferences} from '../lib/payment-references.js';
import {paymentFieldSourceFixture,paymentFieldInvoiceFixture} from './helpers/payment-field-source-fixture.mjs';

const url=p=>new URL(p,import.meta.url).href;
function compiled(path,imports={}){
  let source=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  for(const [name,target]of Object.entries({'react':import.meta.resolve('react'),'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'./domain':url('../lib/domain.ts'),'@/lib/domain':url('../lib/domain.ts'),'./reconciliation-engine.js':url('../lib/reconciliation-engine.js'),'./payment-references.js':url('../lib/payment-references.js'),...imports}))for(const q of ['"',"'"])source=source.replaceAll(q+name+q,JSON.stringify(target));
  return 'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
}
const presentation=compiled('../lib/payment-presentation.ts'),view=await import(presentation);
const ui=await import(compiled('../components/bank-payments.tsx',{'@/lib/payment-presentation':presentation,'./list-pagination':compiled('../components/list-pagination.tsx'),'./bankgiro-availability':compiled('../components/bankgiro-availability.tsx')}));
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
const tx=(extra={},rawFields={})=>{
  const values={id:'t',date:'2026-10-26',amount:62500,currency:'SEK',party:'',payerReference:'',bankReference:'BANK-625',description:'Bankgiro inbetalning',source:'Enable Banking',evidence:'bank_api',externalId:'BANK-625',account:'konto',kind:'batch',verified:false,duplicateOf:'',ignored:false,parentId:'',importId:'',createdAt:'',...extra};
  // Unsourced legacy rows and typed specifications intentionally have no API receipt.
  return Object.hasOwn(extra,'evidence')&&extra.evidence!=='bank_api'?values:syntheticBankTransaction(values,rawFields);
};
const invoice=extra=>({id:'i',number:'0599',ocr:'',party:'Fakturakund AB',direction:'receivable',total:62500,reviewed:true,voided:false,currency:'SEK',issued:'2026-10-01',due:'2026-11-01',...extra});

test('625 SEK collection never presents invoice customer, bank description or proposed 0599 as payer or OCR',()=>{
  const s=emptyState(),t=tx({party:'Betalardetaljer saknas – importera betalningsspecifikation.',payerReference:'99990004'});s.transactions.push(t);s.invoices.push(invoice());
  const actual=view.bankPaymentView(s,t,[{number:'0599',party:'Fakturakund AB'}]);
  assert.equal(actual.payer,'Betalare okänd');assert.equal(actual.invoice,'Möjlig: 0599');assert.equal(actual.status,'Specifikation saknas');assert.equal(actual.reference.ocr,'');assert.equal(actual.verified,false);
  const before=JSON.stringify(s),html=render(ui.default,{state:s,transactions:[t],candidates:{t:[{number:'0599',party:'Fakturakund AB'}]},open(){throw Error('Render must never perform an action');}});
  assert.match(html,/Betalare okänd/);assert.match(html,/Möjlig: 0599/);assert.doesNotMatch(html,/Fakturakund AB|99990004|Betalardetaljer|OCR 0599/);assert.equal(JSON.stringify(s),before);
});

test('bank-supplied payer and labelled OCR keep leading zeros, separately from invoice identity',()=>{
  const s=emptyState(),t=tx({kind:'payment',party:'Verklig betalare AB',description:'',payerReference:'0001230',verified:true},{reference_number:undefined,ocr:'0001230'});s.transactions.push(t);s.invoices.push(invoice({ocr:'0001230'}));
  const x=view.bankPaymentView(s,t);assert.equal(x.payer,'Verklig betalare AB');assert.equal(x.reference.ocr,'0001230');assert.equal(x.invoice,'Möjlig: 0599');assert.equal(x.status,'Möjlig matchning');assert.equal(x.verified,false);
});

test('numeric invoice reference is never labelled OCR without OCR evidence',()=>{
  const t=tx({kind:'payment',party:'Kund AB',description:'',payerReference:'0599'},{reference_number:undefined,invoice_number:'0599'});
  assert.deepEqual(view.bankPaymentReference(t),{value:'0599',kind:'invoice',ocr:''});
});

test('general reference is the primary monospace value on desktop and mobile, separately from missing OCR',()=>{
 const s=emptyState(),t=tx({kind:'payment',party:'Syntetisk betalare AB',description:'',payerReference:'000427'}, {reference_number:undefined,payment_reference:'000427'});s.transactions.push(t);
 const html=render(ui.default,{state:s,transactions:[t],open(){}});
 const [desktop,mobile]=html.split('<div class="bank-mobile-list"');
 for(const layout of [desktop,mobile]){
  assert.match(layout,/<strong class="mono">000427<\/strong>/,'the observed reference must be a primary value rather than a small note');
  assert.match(layout,/<span class="bank-reference-label">Betalningsreferens<\/span>/);
  assert.match(layout,/<span class="bank-reference-note">Bank-OCR saknas\.<\/span>/);
  assert.doesNotMatch(layout,/Saknas i bankunderlaget|<small>[^<]*000427|000427Bank-OCR/);
 }
 assert.equal(view.bankPaymentReference(t).ocr,'');assert.equal(s.allocations.length,0);
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
  const t=tx({kind:'payment',parentId:'parent',party:'Manuellt kontrollerad AB',payerReference:'0599',source:'Betalningsspecifikation: manuellt kontrollerad',evidence:'verified_specification',description:'',original:{party:'Manuellt kontrollerad AB',payerReference:'0599'}});
  const s=emptyState();s.transactions.push(t);const x=view.bankPaymentView(s,t);assert.equal(x.payer,'Betalare okänd');assert.equal(x.reference.value,'');assert.equal(x.manualPayer,'Manuellt kontrollerad AB');assert.equal(x.manualReference,'0599');
});

test('unsourced legacy and manual names cannot masquerade as a bank-verified payer or OCR',()=>{
  const t=tx({kind:'payment',description:'',party:'Ett inskrivet kundnamn AB',payerReference:'0001230',evidence:undefined,verified:true,referenceEvidence:extractPaymentReferences({ocr:'0001230'}),original:{party:'Ett inskrivet kundnamn AB',payerReference:'0001230'}});
  assert.equal(view.payerLabel(t),'Betalare okänd');assert.equal(view.bankPaymentReference(t).value,'');t.amount=-62500;assert.equal(view.payerLabel(t),'Mottagare okänd');
});

test('active allocations distinguish partial payment, overpayment and verification',()=>{
  const s=emptyState();let t=tx({kind:'payment',description:'',party:'Kund AB',payerReference:'0599',verified:true});s.transactions.push(t);s.invoices.push(invoice({total:100000}));s.allocations.push({id:'a',transactionId:'t',invoiceId:'i',active:true,amount:62500,effect:'payment'});
  assert.equal(view.bankPaymentView(s,t).status,'Delbetalning');s.invoices[0].total=62500;assert.equal(view.bankPaymentView(s,t).status,'Verifierad');
  // The overpayment is a separate valid provider scenario, not an altered stored amount.
  t=tx({kind:'payment',description:'',party:'Kund AB',payerReference:'0599',verified:true,amount:70000});s.transactions[0]=t;assert.equal(view.bankPaymentView(s,t).status,'Överbetalning');t.verified=false;assert.equal(view.bankPaymentView(s,t).verified,false);
});

test('conflicting references, duplicate flags and invalid OCR remain visibly unresolved',()=>{
  const s=emptyState();let t=tx({kind:'payment',description:'',party:'Kund AB',payerReference:'0599',verified:true},{reference_number:undefined,invoice_number:'0599',payment_reference:'0604'});s.transactions.push(t);s.invoices.push(invoice(),invoice({id:'two',number:'0604'}));
  assert.equal(view.bankPaymentView(s,t).status,'Konflikt');t.duplicateOf='other';assert.equal(view.bankPaymentView(s,t).status,'Möjlig dubblett');
  t=tx({kind:'payment',description:'',party:'Kund AB',verified:true},{reference_number:undefined,ocr:'12345'});s.transactions[0]=t;assert.equal(view.bankPaymentView(s,t).status,'Konflikt');
  t=tx({kind:'payment',description:'',party:'Kund AB',verified:true},{reference_number:undefined,remittance_information:['0599','0604']});s.transactions[0]=t;assert.equal(view.bankPaymentView(s,t).status,'Konflikt');
});

test('incomplete child specifications retain the original collection in the list',()=>{
  const s=emptyState(),parent=tx();s.transactions.push(parent,tx({id:'child',parentId:'t',kind:'payment',description:'',amount:50000,specificationStatus:'linked'}));
  assert.equal(view.bankVisibleTransactions(s).length,2);s.transactions[1]=tx({id:'child',parentId:'t',kind:'payment',description:'',amount:62500,specificationStatus:'linked'});assert.equal(view.bankVisibleTransactions(s).length,1);s.transactions[1].specificationStatus='review';assert.equal(view.bankVisibleTransactions(s).length,2);
});

test('bank summary has exactly four facts and never invents a successful synchronization',()=>{
  const s=emptyState();s.transactions.push(tx());let html=render(ui.BankPaymentSummary,{state:s});assert.equal((html.match(/<dt>/g)||[]).length,4);assert.match(html,/Inte bekräftad/);html=render(ui.BankPaymentSummary,{state:s,lastSynced:'2026-10-28T10:06:00Z'});assert.doesNotMatch(html,/Inte bekräftad/);assert.match(html,/11:06/);
});

test('desktop exposes six payment facts including reference and OCR; missing OCR stays explicit on mobile',()=>{
  const s=emptyState(),t=tx({kind:'payment',description:'',party:'<script>bank</script>'});s.transactions.push(t);const html=render(ui.default,{state:s,transactions:[t],open(){}});
  assert.equal((html.match(/<th(?:\s|>)/g)||[]).length,6);assert.match(html,/<th scope="col">Referenser<\/th>/);assert.equal((html.match(/Bank-OCR saknas\./g)||[]).length,2);assert.match(html,/bank-mobile-list/);assert.match(html,/bank-payment-card/);assert.match(html,/aria-label="Visa betalning/);assert.match(html,/&lt;script&gt;bank/);assert.doesNotMatch(html,/<script>/);
});

test('an unmatched bank OCR is never described as an invoice number',()=>{
 const s=emptyState(),t=tx({kind:'payment',party:'Bankens betalare AB',description:'',payerReference:'000018'},{reference_number:undefined,ocr:'000018'});
 const message=paymentInvoiceAssessment(s,t).message;assert.match(message,/betalningsreferensen 000018/);assert.doesNotMatch(message,/faktura 000018/);assert.equal(s.allocations.length,0);
});

test('bank list explains unknown payer, missing bank OCR and a separately suggested invoice',()=>{
 const s=emptyState(),t=tx();s.transactions.push(t);s.invoices.push(invoice({number:'0594'}));
 const before=JSON.stringify(s),html=render(ui.default,{state:s,transactions:[t],candidates:{t:[{number:'0594',party:'Fakturakund AB'}]},open(){throw Error('Render must not write');}});
 for(const text of ['Betalare okänd – banken har inte lämnat verifierade individuella uppgifter.','Bank-OCR saknas.','Fakturaförslag: 0594 – inte verifierat av bankens OCR.'])assert.ok(html.includes(text),text);
 assert.equal((html.match(/<th(?:\s|>)/g)||[]).length,6);assert.equal(JSON.stringify(s),before);assert.doesNotMatch(html,/OCR 0594/);
});

test('known payer and typed bank OCR do not receive missing-information explanations',()=>{
 const s=emptyState(),t=tx({kind:'payment',party:'Bank payer',description:'',payerReference:'000018'}, {reference_number:undefined,ocr:'000018'});s.transactions.push(t);
 const html=render(ui.default,{state:s,transactions:[t],open(){}});
 assert.match(html,/Bank payer/);assert.equal((html.match(/<strong class="mono">000018<\/strong>/g)||[]).length,2);assert.equal((html.match(/<span class="bank-reference-label">Formell OCR<\/span>/g)||[]).length,2);assert.doesNotMatch(html,/Bank-OCR saknas\.|banken har inte lämnat verifierade individuella uppgifter/);
});

test('one shared read-only selector returns the actual independent payer and reference sources',()=>{
 assert.equal(typeof view.bankPaymentFieldSources,'function');
 const {state,target,report}=paymentFieldSourceFixture(),before=structuredClone(state),sources=view.bankPaymentFieldSources(state,target);
 assert.equal(sources.payer.kind,'report');assert.equal(sources.reference.kind,'report');assert.equal(sources.payer.row.id,report.id);assert.equal(sources.reference.row.id,report.id);assert.equal(sources.payer.evidence.organizationNumber,'3333333333');assert.equal(sources.reference.value.value,'0599');assert.match(sources.reference.evidence.candidates[0].source,/columns/);assert.deepEqual(state,before);assert.equal(state.allocations.length,0);
});

test('detail payer and AIS reference keep different original evidence when detail has no reference',()=>{
 assert.equal(typeof view.bankPaymentFieldSources,'function');
 const {state,target}=paymentFieldSourceFixture({linked:false,detailReference:'',collective:false});
 const sources=view.bankPaymentFieldSources(state,target);
 assert.equal(sources.payer.kind,'detail');assert.equal(sources.payer.evidence.organizationNumber,'2222222222');assert.equal(sources.reference.kind,'transaction');assert.equal(sources.reference.evidence,target.referenceEvidence);
});

test('a general detail reference never inherits an AIS OCR referencePart with the same value',()=>{
 const t=tx({kind:'payment',party:'AIS payer AB',description:'',payerReference:'000018',referenceParts:[{value:'000018',source:'$.ais.ocr',kind:'ocr'}]},{reference_number:undefined,ocr:'000018'});
 t.bankDetails={party:'Detail payer AB',payerReference:'000018',referenceEvidence:extractPaymentReferences({payment_reference:'000018'})};
 assert.equal(view.bankPaymentReference(t).kind,'reference');assert.equal(view.bankPaymentReference(t).ocr,'');
});

test('unused detail reference metadata cannot classify the AIS reference as OCR',()=>{
 const t=tx({kind:'payment',party:'AIS payer AB',description:'',payerReference:'000018'},{reference_number:undefined,payment_reference:'000018'});
 t.bankDetails={party:'Detail payer AB',payerReference:'',referenceEvidence:extractPaymentReferences({ocr:'000018'})};
 assert.equal(view.bankPaymentReference(t).kind,'reference');assert.equal(view.bankPaymentReference(t).ocr,'');
});

test('a displayed report reference selects its invoice rather than the different detail-reference invoice',()=>{
 const {state,target}=paymentFieldInvoiceFixture(),before=structuredClone(state),actual=view.bankPaymentView(state,target,[{number:'0800',party:'Detail source payer AB'}]);
 assert.equal(actual.reference.value,'0599');assert.equal(actual.invoice,'Möjlig: 0599');assert.deepEqual(actual.possible,['0599']);assert.deepEqual(state,before);assert.equal(state.allocations.length,0);
});

test('an existing different booking remains visible with a reference conflict and an independent report-invoice proposal',()=>{
 const {state,target}=paymentFieldInvoiceFixture({booked:true}),before=structuredClone(state),actual=view.bankPaymentView(state,target);
 assert.equal(actual.reference.value,'0599');assert.equal(actual.invoice,'0800');assert.deepEqual(actual.invoiceNumbers,['0800']);assert.deepEqual(actual.possible,['0599']);assert.equal(actual.status,'Referenskonflikt');assert.equal(actual.invoiceVerified,false);assert.deepEqual(state,before);
});

test('a document candidate selected by its extracted reference remains visible in dashboard presentation',()=>{const s=emptyState(),t=tx({kind:'payment',description:'',payerReference:'000018'});s.transactions.push(t);const candidate={documentId:'synthetic-reference-document',invoiceId:'',number:'0712',party:'Synthetic payer',source:'gmail',identifiers:[{field:'number',value:'0712'},{field:'reference',value:'000018'}],matchedFields:['reference'],extractionSource:'document_jobs',referenceFields:[{field:'reference',value:'000018'}],referenceConflict:false};const actual=view.bankPaymentView(s,t,[candidate]);assert.deepEqual(actual.possible,['0712']);assert.equal(actual.invoiceVerified,false);const html=render(ui.default,{state:s,transactions:[t],candidates:{[t.id]:[candidate]},open(){}});assert.match(html,/0712/);assert.match(html,/Möjlig/);});
