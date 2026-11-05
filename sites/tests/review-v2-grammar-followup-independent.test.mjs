// Independent follow-up probes of the exact ae56dc9 correction; text only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretInvoice as nodeParser} from '../../src/invoice-extraction.js';
import {loadInvoiceParser} from './helpers/invoice-module-loader.mjs';
const {interpretInvoice:sitesParser}=await loadInvoiceParser();
const company='Syntetiska Granhed System AB';
const body=`FAKTURA
Leverantör: ${company}
Organisationsnummer: 556016-0680
Fakturanummer: RV-6824
Fakturadatum: 2026-08-16
Förfallodatum: 2026-09-15
Netto: 1496,00 SEK
Momsbelopp: 374,00 SEK
Att betala: 1870,00 SEK
Valuta: SEK`;
const seed='559998001';
const sum=[...seed].reduce((total,c,i)=>{const n=Number(c)*(i%2?1:2);return total+Math.floor(n/10)+n%10;},0);
const alternateOrg=seed+((10-sum%10)%10);
const holdOrg=r=>{assert.equal(r.fields.organization_number.value,null);assert.notEqual(r.level,'green');assert.ok(r.issues.length);};
const valid=r=>{assert.equal(r.fields.party.value,company);assert.equal(r.fields.organization_number.value,'5560160680');assert.equal(r.fields.net_cents.value,149600);assert.equal(r.fields.vat_cents.value,37400);assert.equal(r.fields.total_cents.value,187000);assert.deepEqual(r.issues,[]);};
const cases=[
  ['unreadable owned organization is not erased by the no-extra-name exception',body+'\nSupplier organization number: oläsligt',holdOrg],
  ['missing owned organization cannot borrow the following invoice label',body+'\nSeller org number:\nFakturanummer: RV-6824',holdOrg],
  ['conflicting valid owned organizations remain in the full census',body+'\nSupplier organization number: '+alternateOrg,holdOrg],
  ['identical owned organization evidence remains a legitimate positive',body+'\nSupplier organization number: 556016-0680\nSeller org number: 556016-0680',valid],
  ['three complete inline monetary aliases retain exact separate values',body.replace('Netto: 1496,00 SEK\nMomsbelopp: 374,00 SEK\nAtt betala: 1870,00 SEK','Netto: 1496,00 SEK Summa moms 374,00 SEK Fakturabelopp 1870,00 SEK'),valid],
  ['unsupported generic VAT suffix stays visible after total',body.replace('Att betala: 1870,00 SEK','Att betala: 1870,00 SEK VAT oläsligt'),r=>{assert.equal(r.fields.total_cents.value,null);assert.notEqual(r.level,'green');}],
  ['conflicting explicit VAT after currency is still collected',body.replace('Valuta: SEK','Valuta: SEK Summa moms 375,00 SEK'),r=>{assert.equal(r.fields.vat_cents.value,null);assert.notEqual(r.level,'green');}],
  ['a complete second supplier does not hide explicit absence',body.replace('Leverantör: '+company,'Leverantör ej angiven\nLeverantör: '+company),r=>{assert.equal(r.fields.party.value,null);assert.notEqual(r.level,'green');}],
];
for(const [engine,parse]of[['Node',nodeParser],['Sites',sitesParser]])for(const method of['pdf','ocr'])for(const [name,text,check]of cases){
  test(`${engine} ${method} independent grammar follow-up: ${name}`,()=>{
    const actual=parse(text,{direction:'supplier',direction_confident:true,method,ocrConfidence:99});
    assert.equal(actual.text_excerpt,text);check(actual);
    if(method==='ocr')assert.notEqual(actual.level,'green');
  });
}
