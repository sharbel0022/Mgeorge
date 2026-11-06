// Independent synthetic date cells and adversarial neighboring source rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import {reconstructOcrLayout} from '../sites/lib/ocr-layout.js';
import {word,observation,allWords} from './helpers/ocr-layout-fixtures.mjs';
import {loadInvoiceParsers} from './helpers/load-invoice-parsers.mjs';
const parsers=await loadInvoiceParsers();
function row(text,x,y){return text.split(' ').map(text=>{const result=word(text,x,y);x+=text.length*8+8;return result;});}
function fixture(label,{extra=[],value='2026-12-17',labelY=10,valueY=45,role='Faktureras till',name='Syntetisk mottagare AB'}={}){
 return observation([
  row(label,700,labelY),
  [...row(role,0,valueY),...row(value,700,valueY)],
  row(name,0,valueY+35),
  ...extra,
 ],{gap:'\n\n',trailing:'\n\n'});
}
function apply(source){
 const before=structuredClone(source),originals=allWords(source.blocks),result=reconstructOcrLayout(source.text,source.blocks),retained=allWords(result.blocks);
 assert.deepEqual(source,before);assert.equal(retained.length,originals.length);assert.equal(new Set(retained).size,originals.length);
 for(const value of originals)assert.ok(retained.includes(value),'actual words, boxes and confidence survive unchanged');
 assert.deepEqual(result.text.trim().split(/\s+/).sort(),source.text.trim().split(/\s+/).sort());
 return result;
}
for(const [engine,parse] of Object.entries(parsers)){
 const read=text=>parse(text,{method:'ocr',ocrConfidence:99,direction:'supplier',direction_confident:true});
 for(const [label,field] of [['Betalas senast','due_at'],['Oss tillhanda senast','due_at'],['Faktureringsdatum','issued_at'],['Due date','due_at']])test(engine+' supported date alias owns only its proved cell: '+label,()=>{
  const source=fixture(label);assert.equal(read(source.text).fields[field].value,null);
  const result=read(apply(source).text);assert.equal(result.fields[field].value,'2026-12-17');assert.notEqual(result.level,'green');
  assert.equal(result.details.supplier.organization_number,null);assert.equal(result.fields.organization_number.value,null);
 });
 for(const label of ['Betalas','Oss tillhanda','Senast'])test(engine+' partial date alias creates no date ownership: '+label,()=>{
  const result=read(apply(fixture(label)).text);assert.equal(result.fields.due_at.value,null);assert.notEqual(result.level,'green');
 });
 for(const [name,options] of [
  ['another candidate in the same column',{extra:[row('2027-01-17',700,70)]}],
  ['a competing explicit heading',{labelY:0,valueY:60,extra:[row('Avtalsdatum:',700,30)]}],
  ['an unresolved suffix in the value row',{value:'2026-12-17 okänt'}],
  ['an unknown neighboring role',{role:'Okänd etikett'}],
  ['an invalid calendar date',{value:'2026-02-30'}],
  ['a remote value',{valueY:150}],
 ])test(engine+' date alias refuses '+name,()=>{
  const result=read(apply(fixture('Betalas senast',options)).text);assert.equal(result.fields.due_at.value,null);assert.notEqual(result.level,'green');
 });
 test(engine+' full date census retains a later invalid declared date',()=>{
  const source=fixture('Betalas senast',{extra:[row('Förfallodatum: oläsligt',0,300)]});
  const result=read(apply(source).text);assert.equal(result.fields.due_at.value,null);assert.notEqual(result.level,'green');
 });
}
