import test from 'node:test';
import assert from 'node:assert/strict';
import {reconstructOcrLayout} from '../sites/lib/ocr-layout.js';
import {ocrInputHash,collectOcrBankgiroPage,bindOcrBankgiroEvidence,assessOcrBankgiro} from '../sites/lib/ocr-bankgiro-evidence.js';
import {word,observation,allWords,textRows} from './helpers/ocr-layout-fixtures.mjs';

const sourceHash=ocrInputHash('Synthetic explicit-field layout boundary; no image or customer data');
function apply(source){
 const before=structuredClone(source),original=allWords(source.blocks),result=reconstructOcrLayout(source.text,source.blocks),retained=allWords(result.blocks);
 assert.deepEqual(source,before);assert.equal(retained.length,original.length);assert.equal(new Set(retained).size,original.length);
 for(const item of original)assert.ok(retained.includes(item),'Every original word object and confidence survives exactly once');
 assert.deepEqual(result.text.trim().split(/\s+/).sort(),source.text.trim().split(/\s+/).sort());
 return result;
}
function unchanged(rows){
 const source=observation(rows,{gap:'\n\n\n',trailing:'\n\n'}),result=apply(source);
 assert.equal(result.text,source.text);assert.equal(result.reconstructed,false);assert.equal(result.blocks,source.blocks);
 return result;
}
const assess=result=>assessOcrBankgiro(result.text,sourceHash,bindOcrBankgiroEvidence(sourceHash,result.text,[collectOcrBankgiroPage(result.text,result.blocks)]),'482-7654');

for(const reversed of [false,true])test('same physical row can join independent OCR rows without choosing source order: '+reversed,()=>{
 const rows=[[word('Netto:',0,20)],[word('418,00',240,22),word('SEK',300,22)]];
 const result=apply(observation(reversed?rows.reverse():rows,{gap:'\n\n'}));
 assert.equal(result.reconstructed,true);assert.deepEqual(textRows(result.text),['Netto: 418,00 SEK']);
});

test('two explicit inline fields are indivisible until both horizontal pairs are resolved',()=>{
 const result=apply(observation([[word('Netto:',0,20),word('418,00',140,20),word('Moms:',400,20),word('104,50',550,20)]]));
 assert.deepEqual(textRows(result.text),['Netto: 418,00','Moms: 104,50']);
});

for(const label of [['Summa', 'moms'],['Fakturabelopp']])test('reviewed compound amount alias participates in the geometry census: '+label.join(' '),()=>{
 const result=apply(observation([label.map((text,index)=>word(text,index*55,20)),[word('522,50',240,20)]],{gap:'\n\n'}));
 assert.equal(result.reconstructed,true);assert.deepEqual(textRows(result.text),[label.join(' ')+' 522,50']);
});

for(const [name,rows]of [
 ['tall value box',[[word('Netto:',0,50)],[word('418,00',240,0,{height:140})]]],
 ['tall label box',[[word('Netto:',0,0,{height:140})],[word('418,00',240,50)]]],
 ['tall multiword-label union',[[word('Att',0,0,{height:180}),word('betala',40,160)],[word('522,50',240,160)]]],
 ['two right values',[[word('Netto:',0,20)],[word('418,00',140,20)],[word('419,00',280,20)]]],
 ['one unreadable right competitor',[[word('Netto:',0,20)],[word('418,00',140,20)],[word('oläsligt',280,20)]]],
 ['unknown intervening label',[[word('Netto:',0,20)],[word('Avtalsnr:',140,20)],[word('418,00',300,20)]]],
 ['unknown complete intervening field',[[word('Netto:',0,20)],[word('Avtalsnr:',100,20),word('SYN-17',180,20)],[word('418,00',300,20)]]],
 ['competing wider vertical region',[[word('Netto:',0,60)],[word('Avtalsnr:',220,20,{width:80})],[word('418,00',240,60)]]],
 ['competing wider horizontal region',[[word('Netto:',0,60)],[word('Avtalsnr:',100,25,{width:80,height:40})],[word('418,00',260,60)]]],
 ['right and below candidates',[[word('Netto:',0,20)],[word('418,00',240,20)],[word('419,00',0,60)]]],
 ['one value claimed horizontally and vertically',[[word('Netto:',0,60)],[word('OCR:',240,20)],[word('00004180',240,60)]]],
 ['large horizontal gap',[[word('Netto:',0,20)],[word('418,00',1600,20)]]],
 ['only value to the left',[[word('Netto:',240,20)],[word('418,00',0,20)]]],
 ['incomplete source-row suffix',[[word('Netto:',0,20)],[word('418,00',240,20),word('SEK',300,20),word('eller',700,20),word('419,00',750,20)]]],
 ['low-confidence competing label',[[word('Netto:',0,60)],[word('Avtalsnr:',220,20,{width:80,confidence:41})],[word('418,00',240,60)]]],
])test('horizontal layout preserves the complete raw source for '+name,()=>{unchanged(rows);});

for(const rowY of [50,100])test('article named Netto with quantity and row amount cannot become a document net summary at y='+rowY,()=>{
 unchanged([
  [word('Beskrivning',0,0),word('Antal',200,0),word('Netto',250,0)],
  [word('Netto',0,rowY)],
  [word('1',200,rowY),word('480,00',250,rowY)],
 ]);
});

test('an explicit table barrier remains authoritative for separate horizontal article columns',()=>{
 unchanged([
  [word('Beskrivning',0,0),word('Antal',200,0),word('Netto',400,0)],
  [word('Netto',0,50)],
  [word('1',200,50)],
  [word('480,00',400,50)],
 ]);
});

test('neither reordered blocks nor an unrelated complete field proves the end of a table',()=>{
 unchanged([
  [word('Valuta:',0,50),word('SEK',70,50)],
  [word('Netto',0,200)],
  [word('1',200,200),word('480,00',250,200)],
  [word('Beskrivning',0,0),word('Antal',200,0)],
 ]);
});

test('an explicit rightward field above a later table remains eligible',()=>{
 const source=observation([
  [word('Netto:',0,20)],
  [word('418,00',240,20)],
  [word('Beskrivning',0,200),word('Antal',200,200)],
 ],{gap:'\n\n'});
 const result=apply(source);
 assert.equal(result.reconstructed,true);
 assert.deepEqual(textRows(result.text),['Netto: 418,00','Beskrivning Antal']);
});

for(const confidence of [89,90,96])test('horizontal Bankgiro keeps the actual word confidence '+confidence,()=>{
 const result=apply(observation([[word('BG:',0,20)],[word('482-7654',180,20,{confidence})]],{gap:'\n\n'}));
 assert.equal(result.reconstructed,true);assert.deepEqual(textRows(result.text),['BG: 482-7654']);
 assert.equal(assess(result).accepted,confidence>=90);
 if(confidence===89)assert.equal(assess(result).code,'OCR_BANKGIRO_LOW_CONFIDENCE');
 const proof=bindOcrBankgiroEvidence(sourceHash,result.text,[collectOcrBankgiroPage(result.text,result.blocks)]);
 assert.equal(assessOcrBankgiro(result.text,ocrInputHash('Different synthetic original'),proof,'482-7654').accepted,false);
});

test('a distant unreadable Bankgiro label remains in the full census after horizontal reconstruction',()=>{
 const source=observation([[word('BG:',0,20)],[word('482-7654',180,20)],[word('Synthetic'.repeat(6000),0,200,{width:900})],[word('Bankgiro:',0,600)]],{gap:'\n\n'});
 assert.ok(source.text.length>50000&&source.text.length<150000);
 const result=apply(source);assert.equal(result.reconstructed,true);assert.ok(result.text.includes('Bankgiro:'));assert.equal(assess(result).accepted,false);
});
