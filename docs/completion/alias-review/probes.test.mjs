import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadInvoiceParsers} from '../../../test/helpers/load-invoice-parsers.mjs';

const ownRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const sourceRoot=resolve(process.env.ALIAS_REVIEW_ROOT||ownRoot);
const fixtures=JSON.parse(readFileSync(new URL('./cases.json',import.meta.url),'utf8'));
const parsers=await loadInvoiceParsers(sourceRoot);
const {reconstructOcrLayout}=await import(pathToFileURL(join(sourceRoot,'sites/lib/ocr-layout.js')).href);
const at=(object,path)=>path.split('.').reduce((value,key)=>value?.[key],object);
const inspect=(actual,expected)=>{
  for(const [path,value] of Object.entries(expected))assert.deepEqual(at(actual,path),value,path);
};
const sourceWords=blocks=>blocks.flatMap(block=>block.paragraphs.flatMap(p=>p.lines.flatMap(line=>line.words)));
const observe=sample=>{
  const rows=structuredClone(sample.rows);
  const lines=rows.map(words=>({text:words.map(word=>word.text).join(' '),words,bbox:{
    x0:Math.min(...words.map(word=>word.bbox.x0)),y0:Math.min(...words.map(word=>word.bbox.y0)),
    x1:Math.max(...words.map(word=>word.bbox.x1)),y1:Math.max(...words.map(word=>word.bbox.y1)),
  }}));
  let text=lines.map(line=>line.text).join('\n\n')+'\n';
  if(sample.id==='layout_unrepresented_residual')text+='Memo: residual source not represented by word boxes\n';
  return {text,blocks:[{paragraphs:[{lines}]}]};
};

for(const [engine,interpretInvoice] of Object.entries(parsers)){
  for(const sample of fixtures.textCases)test(`${engine} text ${sample.id}`,()=>{
    const result=interpretInvoice(sample.text,{direction:sample.direction,direction_confident:true,method:'pdf'});
    inspect(result,sample.expected);
    if(sample.nonGreen)assert.notEqual(result.level,'green','Unsafe or incomplete observation must not be green');
  });
  for(const sample of fixtures.layoutCases)test(`${engine} wordbox ${sample.id}`,()=>{
    const input=observe(sample),before=structuredClone(input),originals=sourceWords(input.blocks);
    const output=reconstructOcrLayout(input.text,input.blocks);
    assert.deepEqual(input,before,'Layout must not mutate source observations');
    const retained=sourceWords(output.blocks);
    assert.equal(retained.length,originals.length,'Every original word occurs exactly once');
    assert.equal(new Set(retained).size,originals.length,'No duplicate source word references');
    assert.ok(retained.every(word=>originals.includes(word)),'No replacement word, spelling, confidence or box');
    if(sample.expectRaw){
      assert.equal(output.reconstructed,false,'Ambiguous/unsupported observation must retain raw layout');
      assert.equal(output.text,input.text,'Residual text must remain unchanged');
    }else{
      assert.equal(output.reconstructed,true,'Explicit unique supported label/value should be paired');
      assert.ok(output.text.split('\n').includes(sample.joined),'Exact source tokens must form the joined field');
    }
    let common=fixtures.common;
    if(sample.context==='organization')common=common.filter(line=>!line.startsWith('Supplier organization number:')).concat('Invoice date: 2027-02-04');
    const result=interpretInvoice(common.join('\n')+'\n'+output.text,{direction:'supplier',direction_confident:true,method:'ocr',ocrConfidence:96});
    inspect(result,sample.expected);
  });
}
