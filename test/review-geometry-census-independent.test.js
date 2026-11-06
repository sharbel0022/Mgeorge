import test from 'node:test';
import assert from 'node:assert/strict';
import {reconstructOcrLayout} from '../sites/lib/ocr-layout.js';
import {ocrInputHash,collectOcrBankgiroPage,bindOcrBankgiroEvidence,assessOcrBankgiro} from '../sites/lib/ocr-bankgiro-evidence.js';

const word=(text,x,y,{width=text.length*8,height=20,confidence=96}={})=>({text,confidence,bbox:{x0:x,y0:y,x1:x+width,y1:y+height}});
const source=rows=>({text:rows.map(row=>row.map(w=>w.text).join(' ')).join('\n\n')+'\n',blocks:[{paragraphs:[{lines:rows.map(words=>({text:words.map(w=>w.text).join(' '),words}))}]}]});
const words=blocks=>blocks.flatMap(block=>block.paragraphs.flatMap(p=>p.lines.flatMap(line=>line.words)));
function apply(input){
 const copy=structuredClone(input),original=words(input.blocks),result=reconstructOcrLayout(input.text,input.blocks),retained=words(result.blocks);
 assert.deepEqual(input,copy);assert.equal(retained.length,original.length);assert.equal(new Set(retained).size,original.length);
 for(const item of original)assert.ok(retained.includes(item),'No word, confidence or bounding box may be synthesized or lost');
 return result;
}
function holds(rows){const input=source(rows),actual=apply(input);assert.equal(actual.text,input.text);assert.equal(actual.blocks,input.blocks);assert.equal(actual.reconstructed,false);}

for(const [name,rows]of [
 ['unreadable alternative on the same physical row',[[word('Netto:',15,30)],[word('72,50',180,30)],[word('???',280,30)]]],
 ['unknown vertical owner competes with a horizontal owner',[[word('Netto:',15,90)],[word('Avtalsnr:',205,50,{width:120})],[word('72,50',210,90)]]],
 ['low-confidence owner still participates in the census',[[word('Netto:',15,90)],[word('Avtalsnr:',205,50,{width:120,confidence:0})],[word('72,50',210,90)]]],
 ['minimum glyph height constrains a mixed-size compound label',[[word('Att',15,30,{height:8}),word('betala',45,30,{height:20})],[word('72,50',220,31)]]],
 ['tall value cannot create physical row agreement',[[word('Netto:',15,40)],[word('72,50',240,0,{height:100})]]],
 ['small value glyphs cannot create physical row agreement',[[word('Netto:',15,30)],[word('72,50',240,35,{height:5})]]],
 ['a wide value cannot increase label reach',[[word('Netto:',15,30)],[word('72,50',900,30,{width:1500})]]],
 ['touching vertical bands are not a physical row',[[word('Netto:',15,30)],[word('72,50',220,50)]]],
 ['a raw OCR line without common vertical overlap is unusable',[[word('Att',15,20,{height:8}),word('betala',45,40)],[word('72,50',220,40)]]],
 ['partially known two-column headings remain indivisible',[[word('Leverantör',0,10),word('Faktureras:',500,10)],[word('Syntetiska',0,50),word('Vänster',90,50),word('AB',150,50),word('Syntetiska',500,50),word('Höger',590,50),word('AB',640,50)]]],
 ['a missing second role value cannot license the first raw column',[[word('Leverantör',0,10),word('Faktureras',500,10),word('till',590,10)],[word('Syntetiska',0,50),word('Vänster',90,50),word('AB',150,50)]]],
])test('independent geometric census: '+name,()=>holds(rows));

test('independent geometric control: an unambiguous aligned right value retains its exact source',()=>{
 const input=source([[word('Netto:',15,30)],[word('72,50',220,32,{height:18})]]),actual=apply(input);
 assert.equal(actual.reconstructed,true);assert.match(actual.text,/Netto: 72,50/);
});

for(const confidence of [0,89,90])test('independent geometric control: Bankgiro word confidence '+confidence+' is never increased',()=>{
 const input=source([[word('Bankgiro:',15,30)],[word('482-7654',240,30,{confidence})]]),actual=apply(input);
 assert.equal(actual.reconstructed,true);assert.equal(words(actual.blocks).find(w=>w.text==='482-7654').confidence,confidence);
 const hash=ocrInputHash('Independent synthetic word evidence; no image');
 const proof=bindOcrBankgiroEvidence(hash,actual.text,[collectOcrBankgiroPage(actual.text,actual.blocks)]);
 assert.equal(assessOcrBankgiro(actual.text,hash,proof,'482-7654').accepted,confidence>=90);
});
