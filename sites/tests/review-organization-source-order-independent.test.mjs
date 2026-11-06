import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretInvoice as nodeParser} from '../../src/invoice-extraction.js';
import {loadInvoiceParser} from './helpers/invoice-module-loader.mjs';

const {interpretInvoice:sitesParser}=await loadInvoiceParser();
const recipient='Syntetiska Mottagaren AB';
const rest='\nFakturanummer: ORG-7392\nFakturadatum: 2026-11-01\nFörfallodatum: 2026-12-01\nNetto: 480,00 SEK\nMomsbelopp: 120,00 SEK\nAtt betala: 600,00 SEK\nValuta: SEK\nBankgiro: 482-7654\nBetalningsreferens: 537924';
for(const [engine,parse]of [['Node',nodeParser],['Sites',sitesParser]])for(const method of ['pdf','ocr']){
 const read=head=>parse('FAKTURA\n'+head+rest,{direction:'customer',direction_confident:true,method,ocrConfidence:96});
 for(const label of ['Utställd av:','Avsändare:'])for(const gap of ['\n','\n\n'])for(const order of ['issuer-first','recipient-first'])test(engine+' '+method+' independent organization provenance: '+label+' '+order+' gap='+gap.length,()=>{
  const issuer=label+' Syntetiska Utställaren AB\nOrganisationsnummer: 556016-0680',receiver='Faktureras till: '+recipient;
  const actual=read(order==='issuer-first'?issuer+gap+receiver:receiver+gap+issuer);
  assert.equal(actual.fields.party.value,recipient,'The explicit recipient name remains directly supported');
  assert.equal(actual.details.recipient.organization_number,null,'The other printed party region cannot donate its organization number');
  assert.equal(actual.fields.organization_number.value,null);
  assert.notEqual(actual.level,'green');
 });
 for(const [name,head]of [
  ['same explicit recipient section','Faktureras till: '+recipient+'\nOrganisationsnummer: 556016-0680'],
  ['explicit recipient-owned organization across paragraph','Faktureras till: '+recipient+'\n\nKundens organisationsnummer: 556016-0680'],
 ])test(engine+' '+method+' independent organization positive: '+name,()=>{
  const actual=read(head);
  assert.equal(actual.fields.party.value,recipient);assert.equal(actual.fields.organization_number.value,'5560160680');assert.equal(actual.details.recipient.organization_number,'5560160680');
  if(method==='pdf')assert.equal(actual.level,'green');else assert.notEqual(actual.level,'green');
 });
}
