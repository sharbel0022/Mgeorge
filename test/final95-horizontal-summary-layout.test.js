// Independent synthetic geometry; no copied holdout coordinates or amounts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {reconstructOcrLayout} from '../sites/lib/ocr-layout.js';
import {word,observation,allWords} from './helpers/ocr-layout-fixtures.mjs';
import {loadInvoiceParsers} from './helpers/load-invoice-parsers.mjs';
const parsers=await loadInvoiceParsers();
function row(text,x,y,options){return text.split(' ').map(text=>{const value=word(text,x,y,options);x+=text.length*8+8;return value;});}
function fixture({english=false,damagedVat=false,numericVat=false,missingVat=false,duplicateValue=false,suffix='',extra=[],offset=0,wide=false,malformed=false,wrongTotal=false,articleHeading=false,lowConfidence=false}={}){
 const labels=english?['Net amount','VAT amount','Amount due']:['Netto',numericVat?'Moms 12':damagedVat?'Moms 12 ?':'Momsbelopp','Att betala'];
 const columns=wide?[0,1500,3000]:[0,450,900];
 const heads=labels.flatMap((label,index)=>row(label,columns[index],100));
 const values=['2 386,40 SEK','286,37 SEK',wrongTotal?'2 673,77 SEK':'2 672,77 SEK'];
 if(malformed)values[0]='2 386,4O SEK';
 const amounts=values.flatMap((value,index)=>index===1&&missingVat?[]:row(value,columns[index]+(index===1?offset:0),140,{confidence:lowConfidence?53:96}));
 return observation([
  [...row('Description',0,0),...row('Qty',450,0),...row('Amount',900,0)],
  [...(articleHeading?row('Quantity',-200+250,100):[]),...heads.map(value=>articleHeading?{...value,bbox:{...value.bbox,x0:value.bbox.x0+250,x1:value.bbox.x1+250}}:value)],
  [...amounts.map(value=>articleHeading?{...value,bbox:{...value.bbox,x0:value.bbox.x0+250,x1:value.bbox.x1+250}}:value),...(suffix?row(suffix,1300,140):[])],
  ...(duplicateValue?[row('286,38 SEK',450,160)]:[]),
  ...extra,
 ],{gap:'\n\n',trailing:'\n\n'});
}
function apply(source){
 const before=structuredClone(source),originals=allWords(source.blocks),result=reconstructOcrLayout(source.text,source.blocks),retained=allWords(result.blocks);
 assert.deepEqual(source,before);assert.equal(retained.length,originals.length);assert.equal(new Set(retained).size,originals.length);
 for(const token of originals)assert.ok(retained.includes(token),'word, bbox and actual confidence must be the original objects');
 assert.deepEqual(result.text.trim().split(/\s+/).sort(),source.text.trim().split(/\s+/).sort());
 return result;
}
for(const [engine,parse] of Object.entries(parsers)){
 const read=text=>parse(text,{method:'ocr',ocrConfidence:99,direction:'supplier',direction_confident:true});
 for(const [name,options,vat] of [
  ['three Swedish columns',{},28637],
  ['three English columns',{english:true},28637],
  ['damaged rate stays null',{damagedVat:true},null],
  ['numeric rate remains a separate uncertain label cell',{numericVat:true},null],
  ['low confidence is preserved without automatic approval',{lowConfidence:true},28637],
 ])test(engine+' horizontal closed summary: '+name,()=>{
  const source=fixture(options),raw=read(source.text);assert.equal(raw.fields.net_cents.value,null);assert.equal(raw.fields.total_cents.value,null);
  const layout=apply(source),result=read(layout.text);
  assert.equal(result.fields.net_cents.value,238640);assert.equal(result.fields.vat_cents.value,vat);assert.equal(result.fields.total_cents.value,267277);
  assert.notEqual(result.level,'green');
  if(options.damagedVat)assert.ok(layout.text.includes('Moms 12 ?'));
 });
 for(const [name,options] of [
  ['one missing value',{missingVat:true}],
  ['a second plausible value',{duplicateValue:true}],
  ['an unreadable money glyph',{malformed:true}],
  ['a source-row suffix',{suffix:'eller 3000,00'}],
  ['a shifted value column',{offset:80}],
  ['remote columns',{wide:true}],
  ['an additional article heading',{articleHeading:true}],
  ['a word in the cell region',{extra:[row('2',230,125,{height:8})]}],
  ['another explicit heading in the value corridor',{extra:[row('Avtalsbelopp:',450,125,{height:8})]}],
  ['an excluded heading above the region still competing for a value',{extra:[row('Avtalsbelopp:',450,80)]}],
 ])test(engine+' horizontal summary refuses '+name,()=>{
  const result=read(apply(fixture(options)).text);
  assert.equal(result.fields.net_cents.value,null);assert.equal(result.fields.total_cents.value,null);assert.notEqual(result.level,'green');
 });
 test(engine+' horizontal summary retains an inconsistent printed total',()=>{
  const result=read(apply(fixture({wrongTotal:true})).text);
  assert.equal(result.fields.net_cents.value,238640);assert.equal(result.fields.vat_cents.value,28637);assert.equal(result.fields.total_cents.value,267377);
  assert.ok(result.issues.some(issue=>/Momsberäkningen/.test(issue)));assert.notEqual(result.level,'green');
 });
 test(engine+' horizontal summary does not erase a later invalid net occurrence',()=>{
  const result=read(apply(fixture({extra:[row('Netto: oklart',0,400)]})).text);
  assert.equal(result.fields.net_cents.value,null);assert.notEqual(result.level,'green');
 });
}
