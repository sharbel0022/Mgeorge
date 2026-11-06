import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretInvoice as nodeParser} from '../../src/invoice-extraction.js';
import {loadInvoiceParser} from './helpers/invoice-module-loader.mjs';

const {interpretInvoice:sitesParser}=await loadInvoiceParser();
const tail='\nFakturanummer: NAME-701\nFakturadatum: 2026-06-03\nFörfallodatum: 2026-07-03\nNetto: 480,00 SEK\nMomsbelopp: 120,00 SEK\nAtt betala: 600,00 SEK\nValuta: SEK';
const positive=[
 ['supplier','Leverantör: Original supplier AB','Original supplier AB'],
 ['customer','Kund: Synthetic customer AB','Synthetic customer AB'],
 ['supplier','Leverantör: Nord Customer Service AB','Nord Customer Service AB'],
 ['customer','Kund: Svenska Supplier Support AB','Svenska Supplier Support AB'],
 ['supplier','Leverantör:\nOriginal supplier AB','Original supplier AB'],
 ['supplier','Leverantör: Kund AB','Kund AB'],
];
const negative=[
 ['bare conflicting roles','Faktureras till Syntetiska Mottagaren AB Leverantör Syntetiska Utställaren AB'],
 ['unresolved heading columns','Faktureras till Leverantör\nSyntetiska Mottagaren AB Syntetiska Utställaren AB'],
 ['unknown explicit inline label','Faktureras till: Syntetiska Mottagaren AB Avsändare: Syntetiska Utställaren AB'],
 ['tab-delimited bare role column','Faktureras till: Syntetiska Mottagaren AB\tLeverantör Syntetiska Utställaren AB'],
 ['space-delimited bare role column','Faktureras till: Syntetiska Mottagaren AB    Leverantör Syntetiska Utställaren AB'],
];
for(const [engine,parse]of [['Node',nodeParser],['Sites',sitesParser]])for(const method of ['pdf','ocr']){
 for(const [direction,head,name]of positive)test(engine+' '+method+' a colon-labelled name keeps literal role words: '+name,()=>{
  const owner=direction==='supplier'?'Leverantörens':'Kundens',text='FAKTURA\n'+head+'\n'+owner+' organisationsnummer: 556016-0680'+tail,result=parse(text,{direction,direction_confident:true,method,ocrConfidence:96});
  assert.equal(result.fields.party.value,name);assert.equal(result.fields.organization_number.value,'5560160680');assert.equal(result.text_excerpt,text);assert.deepEqual(result.issues,[]);assert.equal(result.level,method==='pdf'?'green':'yellow');
 });
 for(const [name,head]of negative)test(engine+' '+method+' literal-name grammar keeps '+name+' unresolved',()=>{
  const text='FAKTURA\n'+head+tail,result=parse(text,{direction:'customer',direction_confident:true,method,ocrConfidence:96});
  assert.equal(result.fields.party.value,null);assert.equal(result.fields.organization_number.value,null);assert.notEqual(result.level,'green');assert.equal(result.text_excerpt,text);
 });
 test(engine+' '+method+' a second explicit colon role remains an independent party',()=>{
  const text='FAKTURA\nLeverantör: Nord Customer Service AB Kund: Svenska Supplier Support AB\nLeverantörens organisationsnummer: 559762-3114\nKundens organisationsnummer: 556016-0680'+tail,result=parse(text,{direction:'customer',direction_confident:true,method,ocrConfidence:96});
  assert.equal(result.details.supplier.name,'Nord Customer Service AB');assert.equal(result.details.recipient.name,'Svenska Supplier Support AB');assert.equal(result.fields.party.value,'Svenska Supplier Support AB');assert.equal(result.fields.organization_number.value,'5560160680');assert.equal(result.details.supplier.organization_number,'5597623114');assert.deepEqual(result.issues,[]);
 });
}
