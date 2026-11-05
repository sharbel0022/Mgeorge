import test from 'node:test';
import assert from 'node:assert/strict';
import {reconstructOcrLayout} from '../sites/lib/ocr-layout.js';
import {ocrInputHash,collectOcrBankgiroPage,bindOcrBankgiroEvidence,assessOcrBankgiro} from '../sites/lib/ocr-bankgiro-evidence.js';
import {word,observation,allWords,textRows,inlineColumns,totalReferenceMix} from './helpers/ocr-layout-fixtures.mjs';

function apply(sample){
  const before=structuredClone(sample),result=reconstructOcrLayout(sample.text,sample.blocks);
  assert.deepEqual(sample,before,'Source OCR words and metadata must not be mutated');
  const ordered=words=>[...words].sort((a,b)=>a.syntheticTokenId-b.syntheticTokenId);
  assert.deepEqual(ordered(allWords(result.blocks)),ordered(allWords(sample.blocks)),'Every original word, bbox and confidence must occur exactly once');
  assert.deepEqual(result.text.trim().split(/\s+/).sort(),sample.text.trim().split(/\s+/).sort(),'Only whitespace and proven word order may change');
  return result;
}

test('layout splits two complete labelled fields at a large word-bbox gap',()=>{
  const result=apply(inlineColumns());
  assert.equal(result.reconstructed,true);
  assert.deepEqual(textRows(result.text),['Fakturadatum: 2026-10-03','Förfallodatum: 2026-11-02']);
});

test('layout pairs only unique close left-aligned values below standalone labels',()=>{
  const result=apply(observation([
    [word('Fakturadatum',0,10),word('Förfallodatum',400,10)],
    [word('2026-10-03',0,50),word('2026-11-02',400,50)],
  ]));
  assert.deepEqual(textRows(result.text),['Fakturadatum 2026-10-03','Förfallodatum 2026-11-02']);
});

test('layout pairs columns by geometry even when OCR block order interleaves another label',()=>{
  const result=apply(observation([
    [word('Fakturanummer',400,10)],
    [word('Leverantör',0,15)],
    [word('Syntetisk',0,50),word('Verkstad',85,50),word('AB',160,50),word('SYN-9802',400,50)],
  ],{gap:'\n\n'}));
  assert.deepEqual(textRows(result.text),['Fakturanummer SYN-9802','Leverantör Syntetisk Verkstad AB']);
});

test('layout does not attach a neighbouring OCR number to the payable amount label',()=>{
  const result=apply(totalReferenceMix());
  assert.deepEqual(textRows(result.text),['OCR 0065432109','Att betala 925,00 SEK']);
  assert.ok(!result.text.includes('Att betala 0065432109'));
});

test('unknown unpaired content restores its entire source row and cancels dependent pairs iteratively',()=>{
  const source=totalReferenceMix({unknownSuffix:true}),result=apply(source);
  assert.equal(result.text,source.text);
  assert.equal(result.reconstructed,false);
  assert.ok(result.text.includes('925,00 SEK Observera suffix'));
  assert.ok(result.text.includes('Att betala 0065432109'));
});

for(const [name,rows] of [
  ['large vertical gap',[[word('Bankgiro',0,10)],[word('482-7654',0,150)]]],
  ['horizontal misalignment',[[word('Bankgiro',0,10)],[word('482-7654',100,50)]]],
  ['two nearby value candidates',[[word('Bankgiro',0,10)],[word('482-7654',0,40)],[word('7512-6384',0,65)]]],
  ['intervening content',[[word('Bankgiro',0,10)],[word('Kontrollera',0,40)],[word('482-7654',0,65)]]],
  ['one value claimed by two labels',[[word('OCR',0,10,{width:20,height:40})],[word('Netto',30,10,{width:20,height:40})],[word('0065432109',15,60,{height:40})]]],
])test('layout retains original strong paragraph gaps for '+name,()=>{
  const sample=observation(rows,{gap:'\n\n\n',trailing:'\n\n'}),result=apply(sample);
  assert.equal(result.text,sample.text);assert.equal(result.reconstructed,false);
});

test('layout never resolves table headers or item rows, but can resolve a later standalone summary',()=>{
  const sample=observation([
    [word('Beskrivning',0,0),word('Antal',200,0),word('Moms',400,0)],
    [word('Service',0,35),word('1',200,35),word('25',400,35)],
    [word('Netto',0,130)],
    [word('740,00',0,170),word('SEK',65,170)],
  ],{gap:'\n\n'}),result=apply(sample);
  assert.deepEqual(textRows(result.text),['Beskrivning Antal Moms','Service 1 25','Netto 740,00 SEK']);
  assert.ok(result.text.startsWith('Beskrivning Antal Moms\n\nService 1 25\n\n'));
});

test('layout cannot strip an unknown suffix from an otherwise complete split field row',()=>{
  const sample=observation([[word('Bankgiro:',0,20),word('482-7654',90,20),word('eller',400,20),word('7512-6384',450,20)]]),result=apply(sample);
  assert.equal(result.text,sample.text);assert.equal(result.reconstructed,false);
});

for(const confidence of [89,90])test('reconstructed Bankgiro uses the actual unchanged word confidence '+confidence,()=>{
  const sample=observation([[word('Bankgiro',0,10)],[word('482-7654',0,50,{confidence})]]),result=apply(sample);
  assert.deepEqual(textRows(result.text),['Bankgiro 482-7654']);
  const input=ocrInputHash('Synthetic geometry evidence'),page=collectOcrBankgiroPage(result.text,result.blocks),evidence=bindOcrBankgiroEvidence(input,result.text,[page]);
  const assessment=assessOcrBankgiro(result.text,input,evidence,'482-7654');
  assert.equal(assessment.accepted,confidence===90);
  if(confidence===89)assert.equal(assessment.code,'OCR_BANKGIRO_LOW_CONFIDENCE');
});

test('reconstruction preserves every Bankgiro label in the complete source census',()=>{
  const sample=observation([[word('Bankgiro',0,10)],[word('482-7654',0,50)],[word('Bankgiro:',0,200)]]),result=apply(sample);
  assert.deepEqual(textRows(result.text),['Bankgiro 482-7654','Bankgiro:']);
  const input=ocrInputHash('Synthetic complete geometry census'),page=collectOcrBankgiroPage(result.text,result.blocks),evidence=bindOcrBankgiroEvidence(input,result.text,[page]);
  assert.equal(assessOcrBankgiro(result.text,input,evidence,'482-7654').accepted,false);
});

for(const [name,mutate] of [
  ['missing word bbox',s=>delete s.blocks[0].paragraphs[0].lines[0].words[0].bbox],
  ['NaN coordinate',s=>s.blocks[0].paragraphs[0].lines[0].words[0].bbox.x0=NaN],
  ['negative coordinate',s=>s.blocks[0].paragraphs[0].lines[0].words[0].bbox.y0=-1],
  ['reversed box',s=>s.blocks[0].paragraphs[0].lines[0].words[0].bbox.x1=-1],
  ['overlapping words',s=>s.blocks[0].paragraphs[0].lines[0].words[1].bbox.x0=40],
  ['invalid confidence',s=>s.blocks[0].paragraphs[0].lines[0].words[0].confidence=101],
  ['text/word mismatch',s=>s.blocks[0].paragraphs[0].lines[0].words[0].text='ANNAN'],
  ['Unicode-normalized but different word token',s=>s.blocks[0].paragraphs[0].lines[0].words[0].text='Ｆａｋｔｕｒａｄａｔｕｍ:'],
  ['line/source mismatch',s=>s.blocks[0].paragraphs[0].lines[0].text+='hidden'],
  ['unrepresented source label',s=>s.text+='Bankgiro: 7512-6384\n'],
  ['missing source line',s=>s.blocks[0].paragraphs[0].lines=[]],
])test('layout falls back to the unchanged original on '+name,()=>{
  const sample=inlineColumns();mutate(sample);const before=structuredClone(sample),result=reconstructOcrLayout(sample.text,sample.blocks);
  assert.equal(result.text,sample.text);assert.equal(result.blocks,sample.blocks);assert.equal(result.reconstructed,false);assert.deepEqual(sample,before);
});

test('layout preserves uncertain spelling and punctuation instead of repairing OCR digits',()=>{
  const sample=observation([[word('Bankgiro',0,10)],[word('482-76S4',0,50,{confidence:82})]]),result=apply(sample);
  assert.deepEqual(textRows(result.text),['Bankgiro 482-76S4']);
  const input=ocrInputHash('Synthetic untouched OCR spelling'),page=collectOcrBankgiroPage(result.text,result.blocks),evidence=bindOcrBankgiroEvidence(input,result.text,[page]);
  assert.equal(assessOcrBankgiro(result.text,input,evidence,'482-7654').accepted,false);
});
