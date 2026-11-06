// Independent synthetic sentences and values, not a holdout transcript.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadInvoiceParsers} from './helpers/load-invoice-parsers.mjs';
const parsers=await loadInvoiceParsers();
const base=`Faktura
Leverantör: Syntetiska Björkdalen Prov AB
Organisationsnummer: 556016-0680
Fakturanummer: SYN-7284
Fakturadatum: 2026-09-03
Förfallodatum: 2026-10-03
Netto: 1640,00 SEK
Momsbelopp: 410,00 SEK
Att betala: 2050,00 SEK
OCR: 000018`;
const cases=[
 ['whole currency and reference-noun instruction','SEK. Ange OCR-numret som betalningsreferens.','SEK','000018'],
 ['whole currency and ordinary instruction','SEK. Uppge OCR vid betalning!','SEK','000018'],
 ['complete instruction may end at line end','SEK. Använd fakturans OCR-referens vid betalning','SEK','000018'],
 ['real matching reference after the closed instruction','SEK. Ange OCR-nummer vid betalning. OCR: 000018','SEK','000018'],
 ['same repeated currency remains a whole field','SEK. Ange OCR vid betalning. Currency: SEK.','SEK','000018'],
 ['a real malformed reference remains in the census','SEK. Ange OCR vid betalning. OCR: ???','SEK',null],
 ['a real conflicting reference remains in the census','SEK. Ange OCR vid betalning. OCR: 000026','SEK',null],
 ...[
  'SEK Ange OCR vid betalning.',
  'SEK.. Ange OCR vid betalning.',
  'SEK. Ange OCR 000018 vid betalning.',
  'SEK. Ange OCR-numret som betalningsreferens 000018.',
  'SEK. Ange OCR vid betalning, snarast.',
  'SEK. Ange OCR vid betalning. Okänt suffix.',
  'SEK. Ange OCR vid betalning..',
  'SEK. Ange OCR vid betalning: 000018',
  'SEK. Ange OCR-numret som betalningsref.',
  'SEK. Ange OCR vid betalning. EUR.',
  'SEK. Ange OCR vid betalning. Currency: ???',
  'SEK. Ange OCR vid betalning. Currency: EUR.',
 ].map(value=>['uncertain or conflicting remainder: '+value,value,null,undefined]),
];
for(const [engine,parse] of Object.entries(parsers))for(const method of ['pdf','ocr']){
 for(const [name,value,currency,reference] of cases)test(engine+' '+method+' closed ISO/instruction: '+name,()=>{
  const text=base+'\nValuta: '+value,result=parse(text,{method,ocrConfidence:99,direction:'supplier',direction_confident:true});
  assert.equal(result.fields.currency.value,currency);
  if(reference!==undefined)assert.equal(result.fields.reference.value,reference);
  assert.equal(result.fields.total_cents.value,205000);
  assert.equal(result.text_excerpt,text,'the complete source sentence remains available');
  if(currency===null||reference===null||method==='ocr')assert.notEqual(result.level,'green');
  if(reference==='000018'){
   assert.equal(result.details.reference.value,'000018');
   assert.ok(result.details.reference.evidence.every(row=>/OCR:[ \t]*000018$/.test(row.text)),'each retained full source line contains an actual marked value; an instruction alone is not evidence');
  }
 });
 test(engine+' '+method+' closed ISO/instruction supports a whole non-SEK code without rewriting it',()=>{
  const text=base.replaceAll('SEK','NOK')+'\nCurrency: NOK. Ange OCR vid betalning.';
  const result=parse(text,{method,ocrConfidence:99,direction:'supplier',direction_confident:true});
  assert.equal(result.fields.currency.value,'NOK');assert.equal(result.fields.total_cents.value,205000);assert.equal(result.text_excerpt,text);
 });
 test(engine+' '+method+' instruction still cannot supply a missing reference',()=>{
  const text=base.replace('\nOCR: 000018','')+'\nValuta: SEK. Ange OCR vid betalning.';
  const result=parse(text,{method,ocrConfidence:99,direction:'supplier',direction_confident:true});
  assert.equal(result.fields.currency.value,'SEK');assert.equal(result.fields.reference.value,null);assert.notEqual(result.level,'green');
 });
}
