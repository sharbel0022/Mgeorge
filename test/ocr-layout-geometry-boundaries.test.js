import test from 'node:test';
import assert from 'node:assert/strict';
import {reconstructOcrLayout} from '../sites/lib/ocr-layout.js';
import {ocrInputHash,collectOcrBankgiroPage,bindOcrBankgiroEvidence,assessOcrBankgiro} from '../sites/lib/ocr-bankgiro-evidence.js';
import {word,observation,allWords} from './helpers/ocr-layout-fixtures.mjs';

const inputSha256=ocrInputHash('Synthetic geometry boundary regression; no customer original');
function apply(sample){
  const before=structuredClone(sample),original=allWords(sample.blocks);
  const result=reconstructOcrLayout(sample.text,sample.blocks),retained=allWords(result.blocks);
  assert.deepEqual(sample,before,'No source word, text, coordinate or confidence changes');
  assert.equal(retained.length,original.length);
  assert.equal(new Set(retained).size,original.length);
  for(const item of original)assert.ok(retained.includes(item),'Each original object survives exactly once');
  assert.deepEqual(result.text.trim().split(/\s+/).sort(),sample.text.trim().split(/\s+/).sort());
  return result;
}
function assess(result){
  const page=collectOcrBankgiroPage(result.text,result.blocks);
  return assessOcrBankgiro(result.text,inputSha256,bindOcrBankgiroEvidence(inputSha256,result.text,[page]),'482-7654');
}
function unchanged(sample){
  const result=apply(sample);
  assert.equal(result.text,sample.text);
  assert.equal(result.blocks,sample.blocks);
  assert.equal(result.reconstructed,false);
  return result;
}

for(const height of [60,180])test('large value height does not widen alignment into another column: '+height,()=>{
  const sample=observation([[word('BG:',0,10,{width:24})],[word('482-7654',30,50,{width:180,height})]],{gap:'\n\n'});
  assert.equal(assess(unchanged(sample)).accepted,false);
});

test('large value height cannot extend the vertical pairing range',()=>{
  const sample=observation([[word('BG:',0,10,{width:24})],[word('482-7654',0,100,{width:180,height:100})]],{gap:'\n\n'});
  assert.equal(assess(unchanged(sample)).accepted,false);
});

for(const placement of ['own OCR row','split OCR row'])for(const name of ['Avtalsnr:','Kundkonto:']){
  test('unknown explicit label competes inside the valid label tolerance: '+name+' on '+placement,()=>{
    // Both headings have plausible geometry, with no overlapping word boxes.
    // This cannot be fixed merely by shrinking the value-height tolerance.
    const competing=[word(name,30,10,{width:80,height:60})];
    if(placement==='split OCR row')competing.push(word('Moms:',400,10,{height:60}),word('25,00',450,10,{height:60}));
    const sample=observation([[word('BG:',0,10,{width:24,height:60})],competing,[word('482-7654',15,90,{width:180,height:60})]],{gap:'\n\n'});
    assert.equal(assess(unchanged(sample)).accepted,false);
  });
}

test('unknown heading with several possible values still blocks ownership of the shared candidate',()=>{
  const sample=observation([
    [word('BG:',0,10,{width:24,height:60})],
    [word('Avtalsnr:',30,10,{width:80,height:60})],
    [word('482-7654',15,90,{width:10,height:60})],
    [word('7512-6384',45,90,{width:160,height:60})],
  ],{gap:'\n\n'});
  assert.equal(assess(unchanged(sample)).accepted,false);
});

test('unknown complete column outside the label geometry does not block a legitimate pair',()=>{
  const sample=observation([
    [word('BG:',0,10,{width:24})],
    [word('Avtalsnr:',300,10,{width:80})],
    [word('SYN-481',300,50,{width:80})],
    [word('482-7654',0,50,{width:180,height:60})],
  ],{gap:'\n\n'}),result=apply(sample);
  assert.equal(result.reconstructed,true);
  assert.ok(result.text.includes('BG: 482-7654'));
  assert.ok(result.text.includes('Avtalsnr:\n\nSYN-481'));
  assert.equal(assess(result).accepted,true);
});

for(const confidence of [89,90,96])test('aligned large-font value stays usable without confidence changes: '+confidence,()=>{
  const sample=observation([[word('BG:',0,10,{width:24})],[word('482-7654',0,50,{width:180,height:60,confidence})]],{gap:'\n\n'}),result=apply(sample);
  assert.equal(result.reconstructed,true);
  assert.ok(result.text.includes('BG: 482-7654'));
  assert.equal(assess(result).accepted,confidence>=90);
  if(confidence===89)assert.equal(assess(result).code,'OCR_BANKGIRO_LOW_CONFIDENCE');
});

for(const y of [20,180])test('words without a shared vertical band cannot form a label: '+y,()=>{
  unchanged(observation([[word('Att',0,0,{width:24}),word('betala',40,y,{width:48})],[word('7410,00',0,250)]],{gap:'\n\n'}));
});

test('mixed-height label uses its shortest actual word as alignment scale',()=>{
  unchanged(observation([[word('Att',0,0,{width:24,height:120}),word('betala',40,100,{width:48,height:20})],[word('7410,00',30,140,{height:60})]],{gap:'\n\n'}));
});

test('slightly staggered words sharing a real vertical band form a legitimate label',()=>{
  const sample=observation([[word('Att',0,10,{width:24}),word('betala',40,14,{width:48})],[word('7410,00',0,50)]],{gap:'\n\n'}),result=apply(sample);
  assert.equal(result.reconstructed,true);
  assert.ok(result.text.includes('Att betala 7410,00'));
});
