import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretInvoice as node} from '../../src/invoice-extraction.js';
import {loadInvoiceParser} from './helpers/invoice-module-loader.mjs';
const {interpretInvoice:sites}=await loadInvoiceParser();

// Synthetic independent review cases. The prior 13b6473 baseline comparison
// was run from immutable archives; its outcomes are preserved in the review
// report. These portable regressions require no temporary checkout or history.
const context={direction:'supplier',direction_confident:true};
const body=`Leverantör: Syntetiska Testbolaget AB
Organisationsnummer: 556016-0680
Fakturanummer: REG-942
Fakturadatum: 2026-08-03
Förfallodatum: 2026-09-02
Netto: 4 000,00 SEK
Moms: 1 000,00 SEK
Att betala: 5 000,00 SEK
Betalningsreferens: REG-942`;
const typeCensus=[
 ['ordinary-after',body+'\nDokumenttyp: Offert'],
 ['incomplete-table-after',body+'\nBeskrivning Antal Belopp exkl. moms\nTjänst 1 4 000,00\nDokumenttyp: Offert'],
 ['after-display-limit',body+'\n'+'Beskrivande text.\n'.repeat(1500)+'Dokumenttyp: Offert']
];
const amounts=[
 ['ocr','000123',null],['ocr','-000123',null],['ocr','00 123',null],
 ['ocr','0000',0],['ocr','123',12300],['ocr','000123,50',12350],['ocr','0,50',50],
 ['ocr','000123 kr',12300],['ocr','SEK 000123',12300],
 ['pdf','000123',12300],['pdf','-000123',-12300]
];
for(const [engine,read]of [['Node',node],['Sites',sites]]){
 for(const title of ['Dokumenttyp: Offert','Dokumenttyp: Påminnelse','Leveransbekräftelse','Bekräftelse','Offertnummer: Q-417'])test(engine+' explicit non-invoice heading: '+title,()=>{
  const actual=read(title+'\n'+body,context);
  assert.notEqual(actual.level,'green');assert.equal(actual.fields.kind.value,'other');
 });
 test(engine+' explicit invoice title remains a positive native-text control',()=>{
  const actual=read('Faktura\n'+body,context);assert.equal(actual.fields.kind.value,'invoice');assert.equal(actual.level,'green');
 });
 test(engine+' title-less OCR number identifies an invoice while retaining review',()=>{
  const actual=read(body,{...context,method:'ocr',ocrConfidence:99});
  assert.equal(actual.fields.kind.value,'invoice');assert.notEqual(actual.level,'green');assert.ok(actual.fields.kind.confidence<=.85);
 });
 for(const [name,text]of typeCensus)test(engine+' competing type census '+name,()=>{
  const actual=read(text,{...context,method:'ocr',ocrConfidence:99});
  assert.notEqual(actual.level,'green');assert.equal(actual.fields.kind.value,'other');
  if(name==='incomplete-table-after')assert.equal(actual.details.table_status,'incomplete');
 });
 for(const [method,value,want]of amounts)test(engine+' amount evidence '+method+' '+value,()=>{
  const text=body.replace('Att betala: 5 000,00 SEK','Att betala: '+value),actual=read(text,{...context,method,ocrConfidence:99});
  assert.equal(actual.fields.total_cents.value,want);
  assert.equal(actual.text_excerpt,text,'Neither held nor retained digits may be rewritten');
  if(method==='ocr')assert.notEqual(actual.level,'green');
  if(want===null)assert.equal(actual.level,'red');
 });
 test(engine+' later ambiguous amount is not hidden by an earlier explicit amount',()=>{
  const text=body.replace('Att betala: 5 000,00 SEK','Att betala: 123,00 SEK')+'\nAtt betala: 000123';
  const actual=read(text,{...context,method:'ocr',ocrConfidence:99});
  assert.equal(actual.fields.total_cents.value,null);assert.equal(actual.level,'red');assert.equal(actual.text_excerpt,text);
 });
}
