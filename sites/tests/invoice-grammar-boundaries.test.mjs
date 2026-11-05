// New synthetic boundary regressions after independent review of abe5c1e.
// No optical calls, image fixtures or holdout answers are used here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretInvoice as nodeParser} from '../../src/invoice-extraction.js';
import {loadInvoiceParser} from './helpers/invoice-module-loader.mjs';

const {interpretInvoice:sitesParser}=await loadInvoiceParser();
const company='Syntetiska Bergstrand Instrument AB';
const supplier='Leverantör: '+company;
const body=`FAKTURA
${supplier}
Organisationsnummer: 556016-0680
Fakturanummer: BR-9147
Fakturadatum: 2026-07-18
Förfallodatum: 2026-08-17
Netto: 2396,00 SEK
Momsbelopp: 599,00 SEK
Att betala: 2995,00 SEK
Valuta: SEK`;
const held=actual=>{assert.notEqual(actual.level,'green');assert.ok(actual.issues.length);};
const exact=actual=>{
 assert.equal(actual.fields.party.value,company);assert.equal(actual.fields.organization_number.value,'5560160680');
 assert.equal(actual.fields.net_cents.value,239600);assert.equal(actual.fields.vat_cents.value,59900);assert.equal(actual.fields.total_cents.value,299500);
 assert.deepEqual(actual.issues,[]);
};
const cases=[
 ['inline unreadable explicit VAT after total',body.replace('Att betala: 2995,00 SEK','Att betala: 2995,00 SEK Summa moms oläsligt'),actual=>{held(actual);assert.equal(actual.fields.vat_cents.value,null);}],
 ['inline conflicting explicit VAT after date',body.replace('Fakturadatum: 2026-07-18','Fakturadatum: 2026-07-18 Summa moms 600,00 SEK'),actual=>{held(actual);assert.equal(actual.fields.vat_cents.value,null);}],
 ['complete inline explicit VAT has the same name and scalar boundary',body.replace(supplier,'Leverantör '+company+' Summa moms 599,00 SEK'),exact],
 ...['moms oläsligt','total moms 600,00 SEK','VAT oläsligt'].map(value=>[
  'unsupported inline VAT syntax cannot disappear at a sibling boundary: '+value,
  body.replace('Netto: 2396,00 SEK','Netto: 2396,00 SEK '+value),actual=>{held(actual);assert.ok(actual.fields.net_cents.value===null||actual.fields.vat_cents.value===null);},
 ]),
 ['unsupported inline net syntax cannot disappear at a sibling boundary',body.replace('Momsbelopp: 599,00 SEK','Momsbelopp: 599,00 SEK Netto 2397,00 SEK'),actual=>{held(actual);assert.ok(actual.fields.net_cents.value===null||actual.fields.vat_cents.value===null);}],
 ...['Leverantör namn','Leverantör namn:','Supplier name','Säljare namn'].map(label=>[
  'a next-line unknown label is never a company: '+label,
  body.replace(supplier,label+'\nOrdervillkor: SYN-592'),actual=>{held(actual);assert.equal(actual.fields.party.value,null);},
 ]),
 ...['Supplier org.nr:','Seller organization number:'].map(label=>[
  'explicit organization owner does not create an empty name: '+label,
  body.replace('Organisationsnummer:',label),exact,
 ]),
 ...['saknas','ej angiven','inte angiven','not provided'].map(value=>[
  'an explicit absent name is held: '+value,body.replace(supplier,'Leverantör '+value),actual=>{held(actual);assert.equal(actual.fields.party.value,null);},
 ]),
 ['absence words inside a real name are not substring-rejected',body.replace(supplier,'Leverantör: Saknas Infrastruktur AB'),actual=>{assert.equal(actual.fields.party.value,'Saknas Infrastruktur AB');assert.deepEqual(actual.issues,[]);}],
 ['a heading can still borrow an unambiguous company name',body.replace(supplier,'Leverantör namn\n'+company),exact],
 ['inline VAT alias census extends beyond the display excerpt',body+'\n'+('Syntetisk oförändrad fritext. '.repeat(900))+'\nNetto: 2396,00 SEK Summa moms oläsligt',actual=>{held(actual);assert.equal(actual.fields.vat_cents.value,null);}],
];
for(const [engine,parse]of [['Node',nodeParser],['Sites',sitesParser]])for(const method of ['pdf','ocr'])for(const [name,text,check]of cases){
 test(engine+' '+method+' reviewed grammar boundary: '+name,()=>{
  const actual=parse(text,{direction:'supplier',direction_confident:true,method,ocrConfidence:99});
  assert.equal(actual.text_excerpt,text.slice(0,20000));check(actual);
  if(method==='ocr')assert.notEqual(actual.level,'green');
 });
}
