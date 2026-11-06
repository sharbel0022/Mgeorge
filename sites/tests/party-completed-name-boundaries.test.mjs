import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretInvoice as nodeParser} from '../../src/invoice-extraction.js';
import {loadInvoiceParser} from './helpers/invoice-module-loader.mjs';

const {interpretInvoice:sitesParser}=await loadInvoiceParser();
const tail='\nFakturanummer: NAME-842\nFakturadatum: 2026-11-01\nFörfallodatum: 2026-12-01\nNetto: 480,00 SEK\nMomsbelopp: 120,00 SEK\nAtt betala: 600,00 SEK\nValuta: SEK';
// A completed first identity followed by a bare role cannot become one name.
// Expectations are literal; no production role or name helper builds them.
const negative=[
 ['supplier','Leverantör: Exempel HB Kund Annan Firma'],
 ['supplier','Supplier: Example Ltd. Bill to Second Entity'],
 ['customer','Kund: Exempel ab leverantör annan firma'],
 ['supplier','Säljare: Exempel KB säljare Annan Firma'],
 ['customer','Faktureras till: Example AB, supplier Other Entity'],
 ['customer','Kund: Exempel AB Mottagare'],
 ['customer','Kund: Exempel Aktiebolag Supplier Other Entity'],
 ['customer','Kund: A AB Supplier Second Entity'],
];
const positive=[
 ['supplier','Leverantör: Original supplier AB','Original supplier AB'],
 ['customer','Kund: North Customer Support AB','North Customer Support AB'],
 ['customer','Kund: AB Customer Service','AB Customer Service'],
 ['supplier','Supplier: The Supplier Company Ltd.','The Supplier Company Ltd.'],
 ['customer','Kund: Kund AB','Kund AB'],
 ['supplier','Leverantör: Example AB SupplierSupport','Example AB SupplierSupport'],
];
for(const [engine,parse]of [['Node',nodeParser],['Sites',sitesParser]])for(const method of ['pdf','ocr']){
 const read=(direction,head)=>{
  const owner=direction==='customer'?'Kundens':'Leverantörens';
  const text='FAKTURA\n'+head+'\n'+owner+' organisationsnummer: 556016-0680'+tail;
  return {text,result:parse(text,{direction,direction_confident:true,method,ocrConfidence:96})};
 };
 for(const [direction,head]of negative)test(engine+' '+method+' holds a bare role after a completed name: '+head,()=>{
  const {text,result}=read(direction,head),role=direction==='customer'?'recipient':'supplier';
  assert.equal(result.details[role].name,null);
  assert.equal(result.fields.party.value,null);
  assert.notEqual(result.level,'green');
  assert.equal(result.text_excerpt,text);
 });
 for(const [direction,head,name]of positive)test(engine+' '+method+' retains a literal company name: '+name,()=>{
  const {text,result}=read(direction,head);
  assert.equal(result.fields.party.value,name);
  assert.equal(result.fields.organization_number.value,'5560160680');
  assert.deepEqual(result.issues,[]);
  assert.equal(result.level,method==='pdf'?'green':'yellow');
  assert.equal(result.text_excerpt,text);
 });
}
