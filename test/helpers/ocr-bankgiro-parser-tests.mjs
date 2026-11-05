import test from 'node:test';
import assert from 'node:assert/strict';
import {bankgiroEvidenceCases,bankgiroText} from './ocr-bankgiro-cases.mjs';

export function registerOcrBankgiroTests(engine,parse){
  for(const sample of bankgiroEvidenceCases)test(`${engine}: OCR bankgiro ${sample.id}`,()=>{
    const before=structuredClone(sample),result=parse(sample.text,{direction:'supplier',direction_confident:true,method:'ocr',ocrConfidence:99,ocrEvidence:sample.evidence,ocrInputSha256:sample.inputSha256});
    assert.equal(result.fields.bankgiro.value,sample.expected);
    assert.notEqual(result.level,'green');
    assert.ok(result.fields.invoice_number.confidence<=.85);
    if(sample.expected===null){assert.match(result.fields.bankgiro.warning||'',/Bankgiro/i);assert.ok(result.issues.some(issue=>/Bankgiro/i.test(issue)));}
    assert.ok(result.fields.bankgiro.evidence?.includes(sample.text.includes('1223-4567')?'1223-4567':'123-4567'),'Raw original digits remain available even when value is held');
    assert.deepEqual(sample,before);
  });
  test(`${engine}: native PDF bankgiro does not require OCR word evidence`,()=>{
    const result=parse(bankgiroText,{direction:'supplier',direction_confident:true,method:'pdf'});
    assert.equal(result.fields.bankgiro.value,'123-4567');assert.equal(result.level,'green');
  });
}
