import test from 'node:test';
import assert from 'node:assert/strict';
import {reconstructOcrLayout} from '../sites/lib/ocr-layout.js';
import {ocrInputHash,collectOcrBankgiroPage,bindOcrBankgiroEvidence,assessOcrBankgiro} from '../sites/lib/ocr-bankgiro-evidence.js';

// Independent synthetic observations frozen against 68e3cb7. These are neither
// image gold values nor a new optical measurement. Coordinates and raw gaps are
// intentional: evidence must not invent ownership of a competing column.
const inputSha256=ocrInputHash('Independent synthetic OCR layout review; no customer original.');
const word=(text,x0,y0,width=8*text.length,height=20,confidence=96)=>({text,confidence,bbox:{x0,y0,x1:x0+width,y1:y0+height}});
const sample=rows=>({text:rows.map(words=>words.map(word=>word.text).join(' ')).join('\n\n')+'\n',blocks:[{paragraphs:[{lines:rows.map(words=>({text:words.map(word=>word.text).join(' ')+'\n',words,bbox:{x0:Math.min(...words.map(w=>w.bbox.x0)),y0:Math.min(...words.map(w=>w.bbox.y0)),x1:Math.max(...words.map(w=>w.bbox.x1)),y1:Math.max(...words.map(w=>w.bbox.y1))}}))}]}]});
const wordsOf=blocks=>blocks.flatMap(b=>b.paragraphs.flatMap(p=>p.lines.flatMap(l=>l.words)));
function apply(source){
 const before=structuredClone(source),original=wordsOf(source.blocks),result=reconstructOcrLayout(source.text,source.blocks),retained=wordsOf(result.blocks);
 assert.deepEqual(source,before,'No source object or original confidence may change');
 assert.equal(retained.length,original.length);
 assert.equal(new Set(retained).size,original.length);
 for(const word of original)assert.ok(retained.includes(word),'Every exact original word must survive once');
 return result;
}
function assessment(result){
 const pages=[collectOcrBankgiroPage(result.text,result.blocks)],evidence=bindOcrBankgiroEvidence(inputSha256,result.text,pages);
 return assessOcrBankgiro(result.text,inputSha256,evidence,'482-7654');
}

for(const competing of ['Avtalsnr:','Kundkonto:'])test('unknown explicit column '+competing+' owns its aligned value; BG must remain unproved',()=>{
 const source=sample([[word('BG:',0,10,24)],[word(competing,30,10,72)],[word('482-7654',30,50,180,60)]]);
 assert.equal(assessment(source).accepted,false,'Raw source has no complete BG value');
 const actual=apply(source);
 assert.equal(actual.text,source.text,'A different aligned heading blocks association regardless of value font height');
 assert.equal(actual.reconstructed,false);
 assert.equal(assessment(actual).accepted,false);
});

test('words on incompatible vertical baselines cannot form a single amount label',()=>{
 const source=sample([[word('Att',0,0,24),word('betala',40,180,48)],[word('7410,00',0,250)]]),actual=apply(source);
 assert.equal(actual.text,source.text,'The tall union of contradictory word rows cannot extend the pairing reach');
 assert.equal(actual.reconstructed,false);
});

test('known competing field label also leaves the shared value unproved',()=>{
 const source=sample([[word('BG:',0,10,24)],[word('OCR:',30,10,32)],[word('482-7654',30,50,180,60)]]),actual=apply(source);
 assert.equal(actual.text,source.text);assert.equal(assessment(actual).accepted,false);
});

for(const confidence of [89,90,96])test('a genuinely aligned large-font value retains its exact word confidence '+confidence,()=>{
 const source=sample([[word('BG:',0,10,24)],[word('482-7654',0,50,180,60,confidence)]]),actual=apply(source);
 assert.equal(actual.reconstructed,true);assert.ok(actual.text.includes('BG: 482-7654'));
 assert.equal(assessment(actual).accepted,confidence>=90);
 if(confidence===89)assert.equal(assessment(actual).code,'OCR_BANKGIRO_LOW_CONFIDENCE');
});

test('cross-row coordinate overlap cannot repair a missing raw Bankgiro value',()=>{
 const source=sample([[word('BG:',0,10,24)],[word('482-7654',0,20,100)]]),actual=apply(source);
 assert.equal(actual.text,source.text);assert.equal(actual.reconstructed,false);assert.equal(assessment(actual).accepted,false);
});

test('layout retains a conflicting Bankgiro beyond the display excerpt while reconstructing an earlier valid pair',()=>{
 const filler=Array.from({length:350},(_,index)=>[word('Synthetic'.repeat(17),0,300+30*index,765)]);
 const source=sample([[word('BG:',0,10,24)],[word('482-7654',0,50,100)],...filler,[word('Bankgiro:',0,20000,72),word('7512-6384',80,20000,80)]]);
 assert.ok(source.text.length>50000&&source.text.length<150000);
 const actual=apply(source);
 assert.equal(actual.reconstructed,true);assert.ok(actual.text.includes('BG: 482-7654'));assert.ok(actual.text.includes('Bankgiro: 7512-6384'));
 assert.equal(assessment(actual).accepted,false,'The entire label census is still authoritative');
});

test('an unrepresented later label prevents reconstruction of all source observations',()=>{
 const source=sample([[word('BG:',0,10,24)],[word('482-7654',0,50,100)]]);source.text+='Bankgiro: 7512-6384\n';
 const actual=apply(source);assert.equal(actual.text,source.text);assert.equal(actual.reconstructed,false);assert.equal(assessment(actual).accepted,false);
});
