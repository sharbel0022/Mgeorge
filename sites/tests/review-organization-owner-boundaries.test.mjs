import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretInvoice as nodeParser} from '../../src/invoice-extraction.js';
import {loadInvoiceParser} from './helpers/invoice-module-loader.mjs';

const {interpretInvoice:sitesParser}=await loadInvoiceParser();
const recipient='Syntetiska Mottagaren AB',issuer='Syntetiska Utställaren AB';
const rest='\nFakturanummer: ROLE-7410\nFakturadatum: 2026-06-03\nFörfallodatum: 2026-07-03\nNetto: 736,00 SEK\nMomsbelopp: 184,00 SEK\nAtt betala: 920,00 SEK\nValuta: SEK';
const negative=[];
for(const label of ['Utställd av','Avsändare']){
 const issuerBlock=label+': '+issuer+'\nOrganisationsnummer: 556016-0680';
 for(const [placement,line]of [
  ['before-recipient',issuerBlock+'\n\nFaktureras till: '+recipient],
  ['after-recipient','Faktureras till: '+recipient+'\n'+issuerBlock],
  ['after-paragraph','Faktureras till: '+recipient+'\n\n'+issuerBlock],
 ])negative.push({label,placement,line});
}
const positive=[
 ['adjacent recipient identity','Faktureras till: '+recipient+'\nOrganisationsnummer: 556016-0680'],
 ['same-line recipient identity','Faktureras till: '+recipient+' Organisationsnummer: 556016-0680'],
 ['explicitly owner-qualified identities','Avsändare: '+issuer+'\nLeverantörens organisationsnummer: 559762-3114\n\nFaktureras till: '+recipient+'\nMottagarens organisationsnummer: 556016-0680'],
];
for(const [engine,parse]of [['Node',nodeParser],['Sites',sitesParser]])for(const method of ['pdf','ocr']){
 const options={direction:'customer',direction_confident:true,method,ocrConfidence:96};
 for(const item of negative)test(engine+' '+method+' cannot move an organization across '+item.label+' '+item.placement,()=>{
  const text='FAKTURA\n'+item.line+rest,actual=parse(text,options);
  assert.equal(actual.fields.party.value,recipient,'The explicit recipient name is retained');
  assert.equal(actual.details.recipient.organization_number,null,'An unowned or differently scoped number is not the recipient identity');
  assert.equal(actual.fields.organization_number.value,null);
  assert.notEqual(actual.level,'green');
  assert.equal(actual.details.supplier.name,null,'Do not invent a legal party from an unsupported sender label');
  assert.equal(actual.text_excerpt,text);
 });
 for(const [name,line]of positive)test(engine+' '+method+' retains source-bound '+name,()=>{
  const text='FAKTURA\n'+line+rest,actual=parse(text,options);
  assert.equal(actual.fields.party.value,recipient);assert.equal(actual.fields.organization_number.value,'5560160680');
  assert.equal(actual.level,method==='pdf'?'green':'yellow');assert.deepEqual(actual.issues,[]);assert.equal(actual.text_excerpt,text);
  if(name==='explicitly owner-qualified identities'){
   assert.equal(actual.details.supplier.name,null);assert.equal(actual.details.supplier.organization_number,'5597623114');
  }
 });
}
