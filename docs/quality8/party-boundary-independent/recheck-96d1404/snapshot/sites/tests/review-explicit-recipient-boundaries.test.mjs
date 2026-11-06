import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretInvoice as nodeParser} from '../../src/invoice-extraction.js';
import {loadInvoiceParser} from './helpers/invoice-module-loader.mjs';

const {interpretInvoice:sitesParser}=await loadInvoiceParser();
const recipient='Syntetiska Mottagaren AB',supplier='Syntetiska Säljaren AB';
const rest='\nMottagarens organisationsnummer: 556016-0680\nFakturanummer: RP-5279\nFakturadatum: 2026-11-01\nFörfallodatum: 2026-12-01\nNetto: 480,00 SEK\nMomsbelopp: 120,00 SEK\nAtt betala: 600,00 SEK\nValuta: SEK\nBankgiro: 482-7654\nBetalningsreferens: 537924';
const negative=[
 ['colon recipient followed by bare supplier','Faktureras till: '+recipient+' Leverantör '+supplier],
 ['colon recipient followed by bare customer','Faktureras till: '+recipient+' Kund Syntetiska Andra AB'],
 ['colon recipient followed by unknown colon field','Faktureras till: '+recipient+' Avtal: Syntetisk post'],
 ['colon recipient followed by repeated bare recipient','Faktureras till: '+recipient+' Faktureras till Syntetiska Andra AB'],
 ['bare recipient followed by bare supplier','Faktureras till '+recipient+' Leverantör '+supplier],
 ['empty recipient followed by unknown colon field','Faktureras till:\nAvtalsnr: SYNT-628'],
];
const positive=[
 ['single explicit colon recipient','Faktureras till: '+recipient,recipient],
 ['single explicit bare recipient','Faktureras till '+recipient,recipient],
 ['two fully explicit colon roles','Leverantör: '+supplier+' Faktureras till: '+recipient,recipient],
 ['ordinary company name containing no competing field','Faktureras till: Syntetiska Avtalsbyrån AB','Syntetiska Avtalsbyrån AB'],
];
for(const [engine,parse]of [['Node',nodeParser],['Sites',sitesParser]])for(const method of ['pdf','ocr']){
 const options={direction:'customer',direction_confident:true,method,ocrConfidence:96};
 for(const [name,line]of negative)test(engine+' '+method+' independent recipient census: '+name,()=>{
  const actual=parse('FAKTURA\n'+line+rest,options);
  assert.equal(actual.details.recipient.name,null,'An unresolved role/field is not part of a recipient name');
  assert.equal(actual.fields.party.value,null,'No composite identity may be accepted from this source');
  assert.notEqual(actual.level,'green','Ambiguous original identities must retain review');
 });
 for(const [name,line,wanted]of positive)test(engine+' '+method+' independent recipient control: '+name,()=>{
  const actual=parse('FAKTURA\n'+line+rest,options);
  assert.equal(actual.details.recipient.name,wanted);
  assert.equal(actual.fields.party.value,wanted);
  assert.equal(actual.fields.organization_number.value,'5560160680');
  if(method==='pdf')assert.equal(actual.level,'green');
  else assert.notEqual(actual.level,'green');
 });
}
