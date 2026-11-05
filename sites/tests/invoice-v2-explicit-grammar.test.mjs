// Diagnostic synthetic regressions after the sealed V2 first measurement.
// These exposed missing grammar on 571073b; no OCR is invoked.
import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretInvoice as nodeParser} from '../../src/invoice-extraction.js';
import {loadInvoiceParser} from './helpers/invoice-module-loader.mjs';
import {reconstructOcrLayout} from '../lib/ocr-layout.js';
import {word,observation,allWords} from '../../test/helpers/ocr-layout-fixtures.mjs';

const {interpretInvoice:sitesParser}=await loadInvoiceParser();
const company='Syntetiska Textverkstaden AB';
const supplier='Leverantör: '+company;
const body=`FAKTURA
${supplier}
Organisationsnummer: 556016-0680
Fakturanummer: LAB-7935
Fakturadatum: 2026-08-06
Förfallodatum: 2026-09-05
Netto: 736,00 SEK
Momsbelopp: 184,00 SEK
Att betala: 920,00 SEK
Valuta: SEK`;
const context={direction:'supplier',direction_confident:true,method:'ocr',ocrConfidence:96};

for(const [engine,parse] of [['Node',nodeParser],['Sites',sitesParser]]){
  const read=(text,options=context)=>parse(text,options);
  for(const [name,line,key,want,replace] of [
    ['VAT summary alias','Summa moms 184,00 SEK','vat_cents',18400,'Momsbelopp: 184,00 SEK'],
    ['gross invoice amount alias','Fakturabelopp 920,00 SEK','total_cents',92000,'Att betala: 920,00 SEK'],
    ['VAT alias with a colon','Summa moms: 184,00 SEK','vat_cents',18400,'Momsbelopp: 184,00 SEK'],
    ['gross alias over an immediate line','Fakturabelopp\n920,00 SEK','total_cents',92000,'Att betala: 920,00 SEK'],
  ])test(engine+' V2 diagnosis: '+name,()=>{
    const text=body.replace(replace,line),actual=read(text);
    assert.equal(actual.fields[key].value,want);assert.equal(actual.text_excerpt,text);
    assert.notEqual(actual.level,'green');
  });
  for(const [label,key,value] of [
    ['Summa moms','vat_cents','185,00 SEK'],
    ['Summa moms','vat_cents','oläsligt'],
    ['Fakturabelopp','total_cents','921,00 SEK'],
    ['Fakturabelopp','total_cents','oläsligt'],
  ])test(engine+' V2 diagnosis: additional '+label+' '+value+' remains in the complete census',()=>{
    const text=body+'\n'+label+': '+value,actual=read(text);
    assert.equal(actual.fields[key].value,null);assert.notEqual(actual.level,'green');
  });
  for(const description of ['Summa moms 999,00','Fakturabelopp 999,00'])test(engine+' V2 diagnosis: article description '+description+' is not a document summary',()=>{
    const table='Beskrivning | Antal | À-pris | Netto | Moms % | Momsbelopp | Radbelopp\n'+description+' | 1 | 736,00 | 736,00 | 25 | 184,00 | 920,00\n';
    const actual=read(body.replace('Netto: 736,00 SEK',table+'Netto: 736,00 SEK'));
    assert.equal(actual.fields.net_cents.value,73600);assert.equal(actual.fields.vat_cents.value,18400);assert.equal(actual.fields.total_cents.value,92000);
    assert.equal(actual.details.line_items[0].description,description);
  });
  test(engine+' V2 diagnosis: explicit colonless supplier role retains its complete name',()=>{
    const text=body.replace(supplier,'Leverantör '+company),actual=read(text);
    assert.equal(actual.fields.party.value,company);assert.equal(actual.text_excerpt,text);assert.notEqual(actual.level,'green');
  });
  test(engine+' V2 diagnosis: safe geometry pairing and the actual name consumer must agree',()=>{
    const source=observation([[word('Leverantör',0,10)],[word('Syntetiska',0,50),word('Textverkstaden',90,50),word('AB',210,50)]],{gap:'\n\n'});
    const before=structuredClone(source),original=allWords(source.blocks),layout=reconstructOcrLayout(source.text,source.blocks);
    assert.equal(layout.reconstructed,true);assert.deepEqual(source,before);
    const kept=allWords(layout.blocks);assert.equal(kept.length,original.length);
    for(const item of original)assert.ok(kept.includes(item));
    assert.deepEqual(layout.text.trim().split(/\s+/).sort(),source.text.trim().split(/\s+/).sort());
    assert.equal(read(body.replace(supplier,layout.text.trim())).fields.party.value,company);
  });
  for(const competitor of ['Leverantör Syntetiska Andra Verkstaden AB','Leverantör oläsligt'])test(engine+' V2 diagnosis: later colonless supplier remains authoritative: '+competitor,()=>{
    const actual=read(body+'\n'+competitor);
    assert.equal(actual.fields.party.value,null);assert.notEqual(actual.level,'green');
  });
  for(const replacement of [
    company+'\nTestgatan 37\n123 45 Testorten',
    'Leverantör Faktureras till\n'+company+' Syntetiska Mottagaren AB',
    'Leverantör '+company+' Kund Syntetiska Mottagaren AB',
    'Leverantör\nKund Syntetiska Mottagaren AB',
    'Leverantör Avtal: SYN-803',
    'Leverantör Fakturabelopp 920,00 SEK',
  ])test(engine+' V2 diagnosis: role-less or conflicting text cannot become the party: '+replacement.split('\n')[0],()=>{
    const actual=read(body.replace(supplier,replacement));
    assert.equal(actual.fields.party.value,null);assert.notEqual(actual.level,'green');
  });
  test(engine+' V2 diagnosis: supplier words inside a structured article do not become party evidence',()=>{
    const table='Beskrivning | Antal | À-pris | Netto | Moms % | Momsbelopp | Radbelopp\nLeverantör Syntetiska Andra Verkstaden AB | 1 | 736,00 | 736,00 | 25 | 184,00 | 920,00\n';
    const actual=read(body.replace('Netto: 736,00 SEK',table+'Netto: 736,00 SEK'));
    assert.equal(actual.fields.party.value,company);
  });
  test(engine+' V2 diagnosis: an unlabelled prose mention does not create a competing supplier field',()=>{
    const actual=read(body+'\nVi kontaktar leverantör Syntetiska Andra Verkstaden AB om leveransen.');
    assert.equal(actual.fields.party.value,company);
  });
  test(engine+' V2 diagnosis: explicit new summaries terminate an incomplete article block',()=>{
    const text=body.replace('Netto: 736,00 SEK\nMomsbelopp: 184,00 SEK\nAtt betala: 920,00 SEK','Beskrivning Antal Belopp exkl. moms\nGranskningsrad 1 736,00\nSumma moms 184,00 SEK\nFakturabelopp 920,00 SEK');
    const actual=read(text);
    assert.equal(actual.fields.vat_cents.value,18400);assert.equal(actual.fields.total_cents.value,92000);
    assert.equal(actual.details.table_status,'incomplete');assert.notEqual(actual.level,'green');
  });
  for(const added of ['Fakturabelopp 921,00 SEK','Leverantör Syntetiska Andra Verkstaden AB'])test(engine+' V2 diagnosis: a native document cannot become green while ignoring '+added,()=>{
    const actual=read(body+'\n'+added,{direction:'supplier',direction_confident:true,method:'pdf'});
    assert.equal(actual.fields[added.startsWith('Fakturabelopp')?'total_cents':'party'].value,null);
    assert.notEqual(actual.level,'green');
  });
  for(const damaged of ['Moms 25 Yo 184,00','Momsbelopp (25 960) 184,00'])test(engine+' V2 diagnosis: damaged percentage text is not repaired: '+damaged,()=>{
    const actual=read(body.replace('Momsbelopp: 184,00 SEK',damaged));
    assert.equal(actual.fields.vat_cents.value,null);assert.notEqual(actual.level,'green');
  });
  test(engine+' V2 diagnosis: text order cannot associate detached summary values',()=>{
    const actual=read(body.replace('Netto: 736,00 SEK\nMomsbelopp: 184,00 SEK\nAtt betala: 920,00 SEK','Netto\nMomsbelopp\nAtt betala\nAnnan uttrycklig etikett: prov\n736,00\n184,00\n920,00 SEK'));
    for(const key of ['net_cents','vat_cents','total_cents'])assert.equal(actual.fields[key].value,null);
    assert.notEqual(actual.level,'green');
  });
}
