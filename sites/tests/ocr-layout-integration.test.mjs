import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {ocrInputHash,assessOcrBankgiro,checkedOcrBankgiroEvidence} from '../lib/ocr-bankgiro-evidence.js';
import {word,observation,totalReferenceMix} from '../../test/helpers/ocr-layout-fixtures.mjs';

const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
async function fixture(t,sample,{failure=null}={}){
  const key='__syntheticOcrLayout_'+crypto.randomUUID().replaceAll('-','');
  const state={data:{...structuredClone(sample),confidence:84},mode:null,terminated:0,failure};globalThis[key]=state;
  const prior=globalThis.HTMLCanvasElement;globalThis.HTMLCanvasElement=class SyntheticCanvas {};
  t.after(()=>{delete globalThis[key];if(prior===undefined)delete globalThis.HTMLCanvasElement;else globalThis.HTMLCanvasElement=prior;});
  const ocr=data(`const state=globalThis[${JSON.stringify(key)}];export const PSM={AUTO:'3'};export async function createWorker(){return {async setParameters(params){state.mode=params.tessedit_pageseg_mode;if(state.failure==='configuration')throw Error('Synthetic configuration failure');},async recognize(){if(state.failure==='recognition')throw Error('Synthetic recognition failure');return {data:state.data};},async terminate(){state.terminated++;}};}`);
  let source=stripTypeScriptTypes(readFileSync(new URL('../lib/local-ocr.ts',import.meta.url),'utf8'),{mode:'transform'});
  for(const [from,to] of Object.entries({'tesseract.js':ocr,'./pdf-text.js':new URL('../lib/pdf-text.js',import.meta.url).href,'./ocr-bankgiro-evidence.js':new URL('../lib/ocr-bankgiro-evidence.js',import.meta.url).href,'./ocr-layout.js':new URL('../lib/ocr-layout.js',import.meta.url).href}))for(const q of ["'",'"'])source=source.replaceAll(q+from+q,JSON.stringify(to));
  return {api:await import(data(source)),state};
}

test('browser OCR uses AUTO, reconstructed actual words and unchanged page/word confidence',async t=>{
  const sample=observation([[word('Bankgiro',0,10),word('OCR',400,10)],[word('482-7654',0,50,{confidence:89}),word('0065432109',400,50)]]);
  const {api,state}=await fixture(t,sample),bytes=new TextEncoder().encode('Synthetic browser source, no customer original'),result=await api.imageText(new Blob([bytes]));
  assert.deepEqual(result.text.split('\n').map(line=>line.trim()).filter(Boolean),['Bankgiro 482-7654','OCR 0065432109']);
  assert.equal(state.mode,'3');assert.equal(state.terminated,1);assert.equal(result.confidence,84);
  assert.equal(result.inputSha256,ocrInputHash(bytes));
  assert.ok(checkedOcrBankgiroEvidence(result.text,result.inputSha256,result.ocrEvidence));
  assert.equal(assessOcrBankgiro(result.text,result.inputSha256,result.ocrEvidence,'482-7654').code,'OCR_BANKGIRO_LOW_CONFIDENCE');
});

test('browser OCR preserves a row with unknown content and its strong paragraph gaps',async t=>{
  const sample=totalReferenceMix({unknownSuffix:true}),{api,state}=await fixture(t,sample),result=await api.imageText(new Blob(['Synthetic ambiguous layout']));
  assert.equal(result.text,sample.text);assert.equal(state.mode,'3');assert.equal(result.confidence,84);assert.equal(state.terminated,1);
});

for(const failure of ['configuration','recognition'])test('browser OCR terminates the worker after '+failure+' failure',async t=>{
  const {api,state}=await fixture(t,totalReferenceMix(),{failure});
  await assert.rejects(api.imageText(new Blob(['Synthetic failure'])),/Synthetic/);
  assert.equal(state.terminated,1);
});
