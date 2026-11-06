import test from 'node:test';
import assert from 'node:assert/strict';
import {loadInvoiceParsers} from './helpers/load-invoice-parsers.mjs';
import {reconstructOcrLayout} from '../sites/lib/ocr-layout.js';
import {word,observation,allWords} from './helpers/ocr-layout-fixtures.mjs';

const parsers=await loadInvoiceParsers();
const row=(text,x,y)=>text.split(' ').map(text=>{const token=word(text,x,y);x+=text.length*8+8;return token;});
function summary(scale=1,dx=0,dy=0){
  const rows=[
    [...row('Description',100,0),...row('Qty',500,0),...row('Amount',900,0)],
    [...row('Net amount',100,100),...row('VAT amount',500,100),...row('Amount due',900,100)],
    [...row('2 820,00 SEK',100,140),...row('705,00 SEK',500,140),...row('3 525,00 SEK',900,140)],
  ];
  return observation(rows.map(words=>words.map(token=>({...token,bbox:Object.fromEntries(Object.entries(token.bbox).map(([axis,value])=>[axis,value*scale+(axis[0]==='x'?dx:dy)]))}))),{gap:'\n\n',trailing:'\n\n'});
}

for(const [engine,parse] of Object.entries(parsers)){
  for(const [scale,dx,dy] of [[.5,30,20],[1,0,0],[2,200,100]])test(`${engine} summary ownership survives uniform scale and translation ${scale}`,()=>{
    const source=summary(scale,dx,dy),before=structuredClone(source),words=allWords(source.blocks);
    const layout=reconstructOcrLayout(source.text,source.blocks),result=parse(layout.text,{method:'ocr',ocrConfidence:99});
    assert.equal(layout.reconstructed,true);assert.deepEqual(source,before);
    assert.deepEqual(new Set(allWords(layout.blocks)),new Set(words),'every original word and confidence survives once');
    assert.equal(allWords(layout.blocks).length,words.length);
    assert.deepEqual([result.fields.net_cents.value,result.fields.vat_cents.value,result.fields.total_cents.value],[282000,70500,352500]);
    assert.notEqual(result.level,'green');
  });
  for(const [name,mutate] of [
    ['page boundary',source=>{source.text=source.text.replace('Net amount','\fNet amount');}],
    ['unmatched original word',source=>{source.blocks[0].paragraphs[0].lines[1].words[0].text='Changed';}],
    ['overlapping source boxes',source=>{const rows=source.blocks[0].paragraphs[0].lines;rows[2].words[0].bbox={...rows[1].words[0].bbox};}],
  ])test(`${engine} reconstruction refuses ${name} without creating field ownership`,()=>{
    const source=summary();mutate(source);const layout=reconstructOcrLayout(source.text,source.blocks);
    assert.equal(layout.reconstructed,false);assert.equal(layout.text,source.text);assert.equal(layout.blocks,source.blocks);
    const result=parse(layout.text,{method:'ocr',ocrConfidence:99});
    assert.equal(result.fields.net_cents.value,null);assert.equal(result.fields.total_cents.value,null);assert.notEqual(result.level,'green');
  });
  for(const method of ['pdf','ocr']){
    const read=text=>parse(text,{method,ocrConfidence:99,direction:'supplier',direction_confident:true});
    const header='Syntetiska Fyrklövern System AB\nProvvägen 16\n123 45 Provstad\nOrg.nr: 556016-0680';
    test(`${engine} ${method} an unlabelled header and explicit recipient cannot prove the issuer role`,()=>{
      const text='FAKTURA\n\n'+header+'\n\nFaktureras till: Syntetisk Köpare AB\nFakturanummer: SYNTH-2047';
      const result=read(text);
      assert.equal(result.fields.party.value,null);assert.equal(result.fields.organization_number.value,null);
      assert.equal(result.details.recipient.name,'Syntetisk Köpare AB');assert.notEqual(result.level,'green');
    });
    test(`${engine} ${method} an explicit supplier owns its continuous header but not an orphaned footer`,()=>{
      const text='FAKTURA\nLeverantör: '+header+'\nFaktureras till: Syntetisk Köpare AB\nFakturanummer: SYNTH-2047';
      const complete=read(text);assert.equal(complete.fields.party.value,'Syntetiska Fyrklövern System AB');assert.equal(complete.fields.organization_number.value,'5560160680');
      const separated=text.replace('\nOrg.nr: 556016-0680','')+'\n\nOrg.nr: 556016-0680';
      const held=read(separated);assert.equal(held.fields.party.value,'Syntetiska Fyrklövern System AB');assert.equal(held.fields.organization_number.value,null);assert.notEqual(held.level,'green');
    });
    test(`${engine} ${method} a closed currency instruction cannot hide a later damaged reference`,()=>{
      const result=read('FAKTURA\nOCR: 000018\nValuta: SEK. Ange OCR-numret som betalningsreferens. OCR: 0000I8');
      assert.equal(result.fields.currency.value,'SEK');assert.equal(result.fields.reference.value,null);assert.notEqual(result.level,'green');
    });
  }
}
