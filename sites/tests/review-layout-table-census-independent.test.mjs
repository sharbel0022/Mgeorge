import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretInvoice as nodeParser} from '../../src/invoice-extraction.js';
import {loadInvoiceParser} from './helpers/invoice-module-loader.mjs';
import {reconstructOcrLayout} from '../lib/ocr-layout.js';

const {interpretInvoice:sitesParser}=await loadInvoiceParser();
const word=(text,x,y)=>({text,confidence:96,bbox:{x0:x,y0:y,x1:x+text.length*9,y1:y+20}});
const rowsToSource=rows=>({text:rows.map((row,i)=>row.map(w=>w.text).join(i===0?'  ':' ')).join('\n\n')+'\n',blocks:[{paragraphs:[{lines:rows.map((words,i)=>({text:words.map(w=>w.text).join(i===0?'  ':' '),words}))}]}]});
function articleSource(description,quantity){
 return rowsToSource([
  [word(description,0,0),word(quantity,200,0),word('Netto',300,0)],
  [word('1',200,100),word('480,00',250,100)],
  [word('Netto',0,100)],
 ]);
}
const rest='\nFAKTURA\nLeverantör: Syntetiska Verkstaden AB\nLeverantörens organisationsnummer: 556016-0680\nFakturanummer: LR-5296\nFakturadatum: 2026-11-01\nFörfallodatum: 2026-12-01\nMomsbelopp: 120,00 SEK\nAtt betala: 600,00 SEK\nValuta: SEK';
const originalWords=blocks=>blocks.flatMap(block=>block.paragraphs.flatMap(p=>p.lines.flatMap(line=>line.words)));
function apply(source){
 const copy=structuredClone(source),original=originalWords(source.blocks),actual=reconstructOcrLayout(source.text,source.blocks),kept=originalWords(actual.blocks);
 assert.deepEqual(source,copy);assert.equal(kept.length,original.length);assert.equal(new Set(kept).size,original.length);
 for(const item of original)assert.ok(kept.includes(item),'All original words, spelling, coordinates and confidence must survive once');
 return actual;
}
for(const [engine,parse]of [['Node',nodeParser],['Sites',sitesParser]]){
 for(const [description,quantity]of [['Artikel','Antal'],['Item','Quantity'],['Beskrivning','Kvantitet'],['Beskrivning','Antal'],['Description','Qty']])test(engine+' independent table census: '+description+'/'+quantity+' cannot make quantity and price a document amount',()=>{
  const source=articleSource(description,quantity),actual=apply(source);
  assert.equal(actual.reconstructed,false,'An already recognized table grammar blocks horizontal ownership');
  assert.equal(actual.text,source.text);
  const parsed=parse(actual.text+rest,{method:'ocr',ocrConfidence:96,direction:'supplier',direction_confident:true});
  assert.equal(parsed.fields.net_cents.value,null,'Article Netto plus quantity 1 and amount 480,00 must not become a 1480,00 summary');
  assert.equal(parsed.details.table_status,'incomplete');
  assert.notEqual(parsed.level,'green');
 });
 test(engine+' independent table control: a unique field above a later article table still pairs',()=>{
  const source=rowsToSource([[word('Netto:',0,20)],[word('480,00',240,20)],[word('Artikel',0,200),word('Antal',200,200),word('Netto',300,200)]]);
  const actual=apply(source);assert.equal(actual.reconstructed,true);assert.match(actual.text,/Netto: 480,00/);
  const parsed=parse(actual.text+rest,{method:'ocr',ocrConfidence:96,direction:'supplier',direction_confident:true});
  assert.equal(parsed.fields.net_cents.value,48000);assert.notEqual(parsed.level,'green');
 });
}
