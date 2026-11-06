// Independent synthetic literals: no holdout text, coordinates or source names.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadInvoiceParsers} from './helpers/load-invoice-parsers.mjs';
const parsers=await loadInvoiceParsers();
const base=`Faktura
Leverantör: Syntetiska Lindglänta Test AB
Organisationsnummer: 556016-0680
Fakturanummer: SYN-8432
Fakturadatum: 2026-10-02
Förfallodatum: 2026-11-02
Netto: 2184,40 SEK
Momsbelopp: 546,10 SEK
Att betala: 2730,50 SEK
OCR: 000018
Valuta: SEK`;
const cases=[
 ['single terminal currency period',base.replace('Valuta: SEK','Valuta: SEK.'),'currency','SEK'],
 ['English currency with terminal period',base.replace(/SEK/g,'NOK').replace('Valuta: NOK','Currency: NOK.'),'currency','NOK'],
 ...['SEK..','SEK. okänt','SEK.123','SEK. EUR','???'].map(value=>['currency remains whole-token checked: '+value,base.replace('Valuta: SEK','Valuta: '+value),'currency',null]),
 ['invalid currency sibling still blocks',base.replace('Valuta: SEK','Valuta: SEK.\nCurrency: ???'),'currency',null],
 ['different currency sibling still blocks',base.replace('Valuta: SEK','Valuta: SEK.\nCurrency: EUR.'),'currency',null],
 ['complete payment instruction after actual OCR',base+'\nAnge OCR vid betalning.','reference','000018'],
 ['complete payment instruction before actual OCR',base.replace('OCR: 000018','Ange OCR vid betalning.\nOCR: 000018'),'reference','000018'],
 ['instruction in a second sentence',base+'\nBetalningsvillkor enligt avtal. Ange OCR vid betalning.','reference','000018'],
 ['reference noun in complete instruction',base+'\nAnge OCR-numret som betalningsreferens.','reference','000018'],
 ['instruction never supplies a missing reference',base.replace('OCR: 000018','Ange OCR vid betalning.'),'reference',null],
 ...['OCR: ???','OCR: 000019','Ange OCR vid betalning: 000018','Ange OCR vid betalning 000018','Ange OCR vid betalning, okänt','Ange OCR vid betalning. OCR: ???'].map(value=>['real or malformed reference occurrence still blocks: '+value,base+'\n'+value,'reference',null]),
 ['multiple recognized instructions preserve actual OCR',base+'\nAnge OCR vid betalning.\nAnge fakturans OCR-nummer vid betalning.','reference','000018'],
];
for(const [engine,parse] of Object.entries(parsers))for(const method of ['pdf','ocr'])for(const [name,text,field,expected] of cases)test(engine+' '+method+' final95 census: '+name,()=>{
 const result=parse(text,{direction:'supplier',direction_confident:true,method,ocrConfidence:99});
 assert.equal(result.fields[field].value,expected);
 assert.equal(result.text_excerpt,text,'the original text remains available for review');
 assert.equal(result.fields.total_cents.value,273050);
 if(field==='reference'&&expected!==null)assert.ok(result.details.reference.evidence.every(row=>!row.text.includes('vid betalning')&&!row.text.includes('som betalningsreferens')),'prose is not reference-value evidence');
 if(expected===null&&field==='currency')assert.notEqual(result.level,'green');
 if(method==='ocr')assert.notEqual(result.level,'green','OCR review cap remains enforced');
});
