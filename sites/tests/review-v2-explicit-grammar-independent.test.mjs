// Independent review matrix, frozen before any response to the review.
// Synthetic text only. No optical processing or holdout-result modification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=process.env.REVIEW_SOURCE_ROOT||resolve(fileURLToPath(new URL('../..',import.meta.url)));
const {interpretInvoice:nodeParser}=await import(pathToFileURL(join(root,'src/invoice-extraction.js')).href);
const {loadInvoiceParser}=await import(pathToFileURL(join(root,'sites/tests/helpers/invoice-module-loader.mjs')).href);
const {interpretInvoice:sitesParser}=await loadInvoiceParser();
const company='Syntetiska Granhed System AB',supplier='Leverantör: '+company;
const body=`FAKTURA
${supplier}
Organisationsnummer: 556016-0680
Fakturanummer: RV-6824
Fakturadatum: 2026-08-16
Förfallodatum: 2026-09-15
Netto: 1496,00 SEK
Momsbelopp: 374,00 SEK
Att betala: 1870,00 SEK
Valuta: SEK`;
const valid=r=>{
  assert.equal(r.fields.party.value,company);
  assert.equal(r.fields.organization_number.value,'5560160680');
  assert.equal(r.fields.net_cents.value,149600);
  assert.equal(r.fields.vat_cents.value,37400);
  assert.equal(r.fields.total_cents.value,187000);
  assert.deepEqual(r.issues,[]);
};
const heldParty=r=>{assert.equal(r.fields.party.value,null);assert.notEqual(r.level,'green');};
const heldAmount=r=>{
  assert.notEqual(r.level,'green');
  assert.ok(r.fields.net_cents.value===null||r.fields.vat_cents.value===null,'unreadable or conflicting inline VAT must not disappear from the amount census');
  assert.ok(r.issues.length,'a concrete source inconsistency must remain visible');
};
const correctOrHeldName=r=>{
  assert.ok(r.fields.party.value===null||r.fields.party.value===company,'a monetary label/value cannot become part of a company name');
  if(r.fields.party.value===null)assert.notEqual(r.level,'green');
};
const tableHeader='Beskrivning | Antal | À-pris | Netto | Moms % | Momsbelopp | Radbelopp';
const cases=[
  ['existing complete document',body,valid],
  ['explicit bare supplier and both new summary labels',body.replace(supplier,'Leverantör '+company).replace('Momsbelopp: 374,00 SEK','Summa moms 374,00 SEK').replace('Att betala: 1870,00 SEK','Fakturabelopp 1870,00 SEK'),valid],
  ['unreadable inline VAT alias after net',body.replace('Netto: 1496,00 SEK','Netto: 1496,00 SEK Summa moms oläsligt'),heldAmount],
  ['conflicting inline VAT alias after net',body.replace('Netto: 1496,00 SEK','Netto: 1496,00 SEK Summa moms 375,00 SEK'),heldAmount],
  ['bare supplier cannot absorb a monetary field',body.replace(supplier,'Leverantör '+company+' Summa moms 374,00 SEK'),correctOrHeldName],
  ['bare supplier cannot absorb or hide conflicting VAT',body.replace(supplier,'Leverantör '+company+' Summa moms 375,00 SEK'),r=>{correctOrHeldName(r);heldAmount(r);}],
  ['explicitly missing bare supplier',body.replace(supplier,'Leverantör saknas'),heldParty],
  ['explicitly unspecified bare supplier',body.replace(supplier,'Leverantör ej angiven'),heldParty],
  ['expanded supplier heading cannot borrow an unknown label',body.replace(supplier,'Leverantör namn\nAvtal: TEST-803'),heldParty],
  ['supplier-owned organization label is not a second empty name',body.replace('Organisationsnummer:','Supplier organization number:'),valid],
  ['seller-owned organization label is not a second empty name',body.replace('Organisationsnummer:','Seller org number:'),valid],
  ['merged two-role heading cannot assign two unseparated names',body.replace(supplier,'Leverantör Faktureras till\n'+company+' Syntetiska Mottagaren AB'),heldParty],
  ['new VAT alias cannot repair a damaged percentage',body.replace('Momsbelopp: 374,00 SEK','Summa moms (25 90) 374,00 SEK'),r=>{assert.equal(r.fields.vat_cents.value,null);assert.notEqual(r.level,'green');}],
  ['new total alias on a later page remains in the census',body+'\f\nFakturabelopp: oläsligt',r=>{assert.equal(r.fields.total_cents.value,null);assert.notEqual(r.level,'green');}],
  ...['Summa moms 781,00','Fakturabelopp 781,00'].map(description=>[
    'structured article remains an article: '+description,
    body.replace('Netto: 1496,00 SEK',tableHeader+'\n'+description+' | 1 | 1496,00 | 1496,00 | 25 | 374,00 | 1870,00\nNetto: 1496,00 SEK'),
    r=>{valid(r);assert.equal(r.details.table_status,'complete');assert.equal(r.details.line_items[0].description,description);},
  ]),
];
for(const [engine,parse]of[['Node',nodeParser],['Sites',sitesParser]])for(const method of['pdf','ocr'])for(const [name,text,check]of cases){
  test(`${engine} ${method} independent V2 grammar: ${name}`,()=>{
    const actual=parse(text,{direction:'supplier',direction_confident:true,method,ocrConfidence:99});
    assert.equal(actual.text_excerpt,text,'the complete original text is retained');
    check(actual);
    if(method==='ocr')assert.notEqual(actual.level,'green','the OCR review ceiling is unchanged');
  });
}
