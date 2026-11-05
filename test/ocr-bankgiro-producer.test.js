import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ocrInputHash,collectOcrBankgiroPage,bindOcrBankgiroEvidence,checkedOcrBankgiroEvidence} from '../sites/lib/ocr-bankgiro-evidence.js';
import {interpretInvoice,extractInvoice,runDocumentProcess} from '../src/invoice-extraction.js';
import {packet,bankgiroText,inputSha256} from './helpers/ocr-bankgiro-cases.mjs';

const snapshots=JSON.parse(readFileSync(new URL('./fixtures/ocr-bankgiro-word-snapshots.json',import.meta.url))).cases;
for(const sample of snapshots)test('frozen actual OCR word observation: '+sample.id,()=>{
  const before=structuredClone(sample),page=collectOcrBankgiroPage(sample.text,sample.blocks),evidence=bindOcrBankgiroEvidence(sample.inputSha256,sample.text,[page]);
  const result=interpretInvoice(sample.text,{direction:'supplier',direction_confident:true,method:'ocr',ocrConfidence:99,ocrInputSha256:sample.inputSha256,ocrEvidence:evidence});
  assert.equal(result.fields.bankgiro.value,sample.policyExpectedBankgiro);
  assert.notEqual(result.level,'green');assert.deepEqual(sample,before);
  // Source-field accuracy still uses sourceExpectedBankgiro in the separate
  // measurement. A desired abstention is not relabelled as a recovered value.
  if(result.fields.bankgiro.value!==null)assert.equal(result.fields.bankgiro.value,sample.sourceExpectedBankgiro);
});

test('duplicated block rows cannot donate one convenient high-confidence reading',()=>{
  const row={text:'Bankgiro: 123-4567\n',words:[{text:'Bankgiro:',confidence:99},{text:'123-4567',confidence:99}]};
  const page=collectOcrBankgiroPage(bankgiroText,[{paragraphs:[{lines:[row,row]}]}]);
  assert.deepEqual(page.bankgiro,[]);
  const result=interpretInvoice(bankgiroText,{method:'ocr',ocrConfidence:99,ocrInputSha256:inputSha256,ocrEvidence:bindOcrBankgiroEvidence(inputSha256,bankgiroText,[page])});
  assert.equal(result.fields.bankgiro.value,null);
});

test('only the bounded evidence shape can cross the worker boundary',()=>{
  const value=packet();value.debug='unexpected private data';value.id='not-the-document';value.pages[0].bankgiro[0].words[1].token='not-a-token';
  const checked=checkedOcrBankgiroEvidence(bankgiroText,inputSha256,value);
  assert.ok(checked);assert.doesNotMatch(JSON.stringify(checked),/unexpected|not-the-document|not-a-token/);
  assert.equal(checkedOcrBankgiroEvidence(bankgiroText,'a'.repeat(64),value),null);
  assert.equal(checkedOcrBankgiroEvidence(bankgiroText+'\nother source',inputSha256,value),null);
});

for(const [file,expected] of [['ocr-bankgiro-low-word-confidence.png',null],['ocr-bankgiro-four-digit-prefix.png','1223-4567']])test('actual raster worker and extraction retain word evidence: '+file,async()=>{
  const bytes=readFileSync(new URL('./fixtures/'+file,import.meta.url)),before=ocrInputHash(bytes),processed=await runDocumentProcess(bytes,'image/png');
  assert.equal(processed.error,undefined);assert.equal(processed.method,'ocr');
  assert.ok(checkedOcrBankgiroEvidence(processed.text,before,processed.ocrEvidence));
  const result=interpretInvoice(processed.text,{direction:'supplier',direction_confident:true,method:'ocr',ocrConfidence:99,ocrEvidence:processed.ocrEvidence,ocrInputSha256:before});
  assert.equal(result.fields.bankgiro.value,expected);assert.notEqual(result.level,'green');
  assert.match(processed.text,/Bankgiro: 1223-4567/);assert.match(result.fields.bankgiro.evidence,/1223-4567/);
  assert.equal(ocrInputHash(bytes),before);
});

test('extractInvoice binds worker evidence to the original bytes, preserving a real four-digit prefix',async()=>{
  const bytes=readFileSync(new URL('./fixtures/ocr-bankgiro-four-digit-prefix.png',import.meta.url));
  const result=await extractInvoice(bytes,'image/png',{direction:'supplier',direction_confident:true,ocrInputSha256:'a'.repeat(64)});
  assert.equal(result.fields.bankgiro.value,'1223-4567');assert.notEqual(result.level,'green');
});
