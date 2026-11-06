import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretInvoice as nodeParser} from '../../src/invoice-extraction.js';
import {loadInvoiceParser} from './helpers/invoice-module-loader.mjs';

const {interpretInvoice:sitesParser}=await loadInvoiceParser();
const recipient='Syntetiska Mottagaren AB',issuer='Syntetiska Utställaren AB';
const rest='\nFakturanummer: INLINE-7392\nFakturadatum: 2026-11-01\nFörfallodatum: 2026-12-01\nNetto: 480,00 SEK\nMomsbelopp: 120,00 SEK\nAtt betala: 600,00 SEK\nValuta: SEK\nBankgiro: 482-7654\nBetalningsreferens: 537924';
for(const [engine,parse]of [['Node',nodeParser],['Sites',sitesParser]])for(const method of ['pdf','ocr']){
 const read=head=>{const text='FAKTURA\n'+head+rest;return {text,actual:parse(text,{direction:'customer',direction_confident:true,method,ocrConfidence:96})};};
 for(const label of ['Avsändare:','Utställd av:'])test(engine+' '+method+' independent inline organization boundary: '+label,()=>{
  const {text,actual}=read('Faktureras till: '+recipient+'\n'+label+' '+issuer+' Organisationsnummer: 556016-0680');
  assert.equal(actual.fields.party.value,recipient);
  assert.equal(actual.details.recipient.organization_number,null,'An unknown party field before the organization event cannot inherit the preceding recipient section');
  assert.equal(actual.fields.organization_number.value,null);
  assert.equal(actual.details.supplier.name,null,'Do not create a legal party from the unsupported sender field');
  assert.notEqual(actual.level,'green');
  assert.equal(actual.text_excerpt,text);
 });
 for(const [name,head]of [
  ['same-line explicit recipient section','Faktureras till: '+recipient+' Organisationsnummer: 556016-0680'],
  ['explicit owner-qualified number after an unknown field','Faktureras till: '+recipient+'\nAvsändare: '+issuer+' Mottagarens organisationsnummer: 556016-0680'],
 ])test(engine+' '+method+' independent inline organization positive: '+name,()=>{
  const {text,actual}=read(head);
  assert.equal(actual.fields.party.value,recipient);
  assert.equal(actual.details.recipient.organization_number,'5560160680');
  assert.equal(actual.fields.organization_number.value,'5560160680');
  assert.equal(actual.details.supplier.name,null);
  if(method==='pdf')assert.equal(actual.level,'green');else assert.notEqual(actual.level,'green');
  assert.equal(actual.text_excerpt,text);
 });
}
