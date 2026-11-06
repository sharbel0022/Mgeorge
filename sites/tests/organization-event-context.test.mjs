import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretInvoice as nodeParser} from '../../src/invoice-extraction.js';
import {loadInvoiceParser} from './helpers/invoice-module-loader.mjs';

const {interpretInvoice:sitesParser}=await loadInvoiceParser();
const name='Syntetiska Mottagaren AB';
const rest='\nFakturanummer: EVENT-3591\nFakturadatum: 2026-06-03\nFörfallodatum: 2026-07-03\nNetto: 736,00 SEK\nMomsbelopp: 184,00 SEK\nAtt betala: 920,00 SEK\nValuta: SEK';
const held=[
 ['scalar prefix on the organization row','Faktureras till: '+name+'\nValuta: SEK Organisationsnummer: 556016-0680'],
 ['registered tax-summary prefix on the organization row','Faktureras till: '+name+'\nBelopp exkl. moms: 736,00 SEK Organisationsnummer: 556016-0680'],
 ['separate registered tax-summary row','Faktureras till: '+name+'\nBelopp exkl. moms: 736,00 SEK\nOrganisationsnummer: 556016-0680'],
 ['a different explicit owner before an unqualified organization','Faktureras till: '+name+'\nLeverantörens organisationsnummer: 559762-3114 Organisationsnummer: 556016-0680'],
];
const supported=[
 // This new case was originally over-constrained. The original matrix and
 // full prior gate are frozen in ocr-organization-inline-contract-before.json.
 // A known inline scalar is not another party, with or without a colon.
 ['scalar suffix after the last name event','Faktureras till: '+name+' Valuta: SEK\nOrganisationsnummer: 556016-0680'],
 ['known inline VAT with a colon','Faktureras till: '+name+' Summa moms: 184,00 SEK\nOrganisationsnummer: 556016-0680'],
 ['known inline currency without a colon','Faktureras till: '+name+' Valuta SEK\nOrganisationsnummer: 556016-0680'],
 ['recognized adjacent identity fields separated by a pipe','Faktureras till: '+name+' | Organisationsnummer: 556016-0680'],
 ['explicit ownership after an unknown inline field','Faktureras till: '+name+'\nAvsändare: Syntetiska Utställaren AB Mottagarens organisationsnummer: 556016-0680'],
 ['matching explicit ownership keeps its existing local section','Faktureras till: '+name+'\nMottagarens organisationsnummer: 556016-0680 Organisationsnummer: 556016-0680'],
];
for(const [engine,parse]of [['Node',nodeParser],['Sites',sitesParser]])for(const method of ['pdf','ocr']){
 const options={direction:'customer',direction_confident:true,method,ocrConfidence:96};
 for(const [label,body]of held)test(engine+' '+method+' holds organization context at '+label,()=>{
  const text='FAKTURA\n'+body+rest,result=parse(text,options);
  assert.equal(result.fields.party.value,name);assert.equal(result.fields.organization_number.value,null);assert.equal(result.details.recipient.organization_number,null);
  assert.notEqual(result.level,'green');assert.equal(result.text_excerpt,text);
  if(label.startsWith('a different'))assert.equal(result.details.supplier.organization_number,'5597623114');
 });
 for(const [label,body]of supported)test(engine+' '+method+' retains '+label,()=>{
  const text='FAKTURA\n'+body+rest,result=parse(text,options);
  assert.equal(result.fields.party.value,name);assert.equal(result.fields.organization_number.value,'5560160680');
  assert.equal(result.level,method==='pdf'?'green':'yellow');assert.deepEqual(result.issues,[]);assert.equal(result.text_excerpt,text);
 });
 test(engine+' '+method+' a name prefix is not a scalar label or a new section',()=>{
  const company='Momsnära Syntetiska AB',text='FAKTURA\nFaktureras till: '+company+'\nOrganisationsnummer: 556016-0680'+rest;
  const result=parse(text,options);
  assert.equal(result.fields.party.value,company);assert.equal(result.fields.organization_number.value,'5560160680');
  assert.equal(result.level,method==='pdf'?'green':'yellow');assert.deepEqual(result.issues,[]);
 });
}
