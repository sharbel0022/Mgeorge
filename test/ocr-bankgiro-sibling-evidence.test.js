import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {collectOcrBankgiroPage,bindOcrBankgiroEvidence,checkedOcrBankgiroEvidence,assessOcrBankgiro} from '../sites/lib/ocr-bankgiro-evidence.js';

const inputSha256=createHash('sha256').update('Synthetic same-line word evidence; no real invoice or account.').digest('hex');
const sourceLine='Bankgiro: 482-7654 OCR: 0065432109';
const sourceValue='482-7654';
const wordsFor=(text,confidence=96)=>text.trim().split(/[ \t]+/).map(text=>({text,confidence}));
function observed(text,{confidence=96,changeBlocks}={}){
  const blocks=text.split('\f').map(page=>[{paragraphs:[{lines:page.trim().split('\n').map(text=>({text,words:wordsFor(text,confidence)}))}]}]);
  changeBlocks?.(blocks);
  const pages=text.split('\f').map((page,index)=>collectOcrBankgiroPage(page,blocks[index],index+1));
  return {text,blocks,evidence:bindOcrBankgiroEvidence(inputSha256,text,pages)};
}
const assessment=(sample,value=sourceValue)=>assessOcrBankgiro(sample.text,inputSha256,sample.evidence,value);

// These expected values are literal synthetic examples, unrelated to the held
// corpus. Exact whole values and explicit next labels are the tested contract.
for(const [line,want] of [
  [sourceLine,'482-7654'],
  ['BG. 7512–6384 Fakturanummer: SYN-8802','7512-6384'],
  ['bankgirokonto # 482 7654 Betalningsreferens: SYN/0093','482-7654'],
  ['Bankgiro: 7512-6384 Plusgiro: 728316-5','7512-6384'],
  ['Bankgiro: 482-7654 IBAN: SE1450000000058392577012','482-7654'],
  ['Bankgiro: 482-7654 OCR-nummer: 0065432109','482-7654'],
  ['Bankgiro: 482-7654 OCR referens: 0065432109','482-7654'],
  ['Bankgiro: 482-7654 Förfallodatum: 2026-11-30','482-7654'],
  ['Bankgiro: 482-7654 Fakturadatum: 2026-11-01','482-7654'],
  ['Bankgiro: 482-7654 Faktura nr: SYN-8809','482-7654'],
  ['Bankgiro: 482-7654 Kundnummer: K-0123','482-7654'],
  ['Bankgiro: 482-7654 OCR: 0065432109 Fakturanummer: SYN-8811','482-7654'],
])test('supports explicit same-line sibling boundary: '+line,()=>{
  const sample=observed(line),before=structuredClone(sample);
  assert.equal(assessment(sample,want).accepted,true);
  const row=sample.evidence.pages[0].bankgiro[0];
  assert.equal(row.value,want);assert.equal(row.text,line);
  assert.deepEqual(row.words,wordsFor(line));
  assert.deepEqual(sample,before,'Neither the observation nor its full sibling words may be rewritten');
});

for(const line of [
  'Bankgiro: 482-7654x OCR: 0065432109',
  'Bankgiro: 482-7654/8 OCR: 0065432109',
  'Bankgiro: 482-7654.8 OCR: 0065432109',
  'Bankgiro: 482-7654-8 OCR: 0065432109',
  'Bankgiro: 482-7654 8 OCR: 0065432109',
  'Bankgiro: 482-7654 7512-6384 OCR: 0065432109',
  'Bankgiro: 74822-7654 OCR: 0065432109',
  'Bankgiro: 482-76540 OCR: 0065432109',
  'Bankgiro: 4827654 OCR: 0065432109',
  'Bankgiro: 482-7654OCR: 0065432109',
  'Bankgiro: 482-7654 OCR 0065432109',
  'Bankgiro: 482-7654 OCR:',
  'Bankgiro: 482-7654 OCRs: 0065432109',
  'Bankgiro: 482-7654 OCR/foo: 0065432109',
  'Bankgiro: 482-7654 Observera: 7512-6384',
  'Bankgiro: 482-7654 eller rätt nummer: 7512-6384',
  'Bankgiro: 482-7654 SEK',
  'Bankgiro OCR: 482-7654 0065432109',
  'Bankgiro: OCR: 482-7654',
  'OCR: 0065432109 Bankgiro: 482-7654',
  'Bankgiro: 482-\n7654 OCR: 0065432109',
])test('never infer a bankgiro prefix or an unlabelled column: '+line,()=>{
  assert.equal(assessment(observed(line)).accepted,false);
});

test('all source words, including the sibling label and value, must reach the existing confidence threshold',()=>{
  assert.equal(assessment(observed(sourceLine,{confidence:90})).accepted,true);
  for(const index of [0,1,2,3]){
    const sample=observed(sourceLine,{changeBlocks:blocks=>{blocks[0][0].paragraphs[0].lines[0].words[index].confidence=89;}});
    assert.equal(assessment(sample).accepted,false);
    assert.equal(assessment(sample).code,'OCR_BANKGIRO_LOW_CONFIDENCE');
  }
});

test('complete sibling words stay bound to the exact original, text, page, line and value',()=>{
  const sample=observed(sourceLine);
  assert.ok(checkedOcrBankgiroEvidence(sample.text,inputSha256,sample.evidence));
  for(const mutate of [
    e=>{e.inputSha256='b'.repeat(64);},
    e=>{e.textSha256='b'.repeat(64);},
    e=>{e.pages[0].textSha256='b'.repeat(64);},
    e=>{e.pages[0].page=2;},
    e=>{e.pages[0].bankgiro[0].line=1;},
    e=>{e.pages[0].bankgiro[0].value='7512-6384';},
    e=>{e.pages[0].bankgiro[0].text='Bankgiro: 482-7654';},
    e=>{e.pages[0].bankgiro[0].words.pop();},
    e=>{e.pages[0].bankgiro[0].words[2].text='Telefon:';},
    e=>{e.pages[0].bankgiro[0].words[3].text='0065432108';},
    e=>{e.pages[0].bankgiro.push(structuredClone(e.pages[0].bankgiro[0]));},
  ]){
    const evidence=structuredClone(sample.evidence);mutate(evidence);
    assert.equal(checkedOcrBankgiroEvidence(sample.text,inputSha256,evidence),null);
    assert.equal(assessOcrBankgiro(sample.text,inputSha256,evidence,sourceValue).accepted,false);
  }
  assert.equal(assessOcrBankgiro(sourceLine.replace('0065432109','0065432110'),inputSha256,sample.evidence,sourceValue).accepted,false);
  assert.equal(assessOcrBankgiro(sourceLine,'b'.repeat(64),sample.evidence,sourceValue).accepted,false);
});

for(const extra of [' Bankgiro: 482-7654',' BG: 7512-6384',' bankgirokonto: 7512-6384'])test('a sibling suffix never hides another Bankgiro label: '+extra,()=>{
  assert.equal(assessment(observed(sourceLine+extra)).accepted,false);
});

test('all equal repeated rows and pages need their own complete sibling word evidence',()=>{
  const sample=observed(sourceLine+'\n'+sourceLine+'\f'+sourceLine);
  assert.equal(assessment(sample).accepted,true);
  const missing=structuredClone(sample);missing.evidence.pages[1].bankgiro=[];
  assert.equal(assessment(missing).accepted,false);
  const low=structuredClone(sample);low.evidence.pages[0].bankgiro[1].words[3].confidence=89;
  assert.equal(assessment(low).code,'OCR_BANKGIRO_LOW_CONFIDENCE');
});

test('word rows cannot be donated from a duplicate recognition or an incomplete repeated source census',()=>{
  const duplicate=observed(sourceLine,{changeBlocks:blocks=>{const lines=blocks[0][0].paragraphs[0].lines;lines.push(structuredClone(lines[0]));}});
  assert.equal(assessment(duplicate).accepted,false);
  const missing=observed(sourceLine+'\n'+sourceLine,{changeBlocks:blocks=>blocks[0][0].paragraphs[0].lines.pop()});
  assert.equal(assessment(missing).accepted,false);
});

test('later missing or conflicting Bankgiro labels cannot be hidden beyond a display excerpt',()=>{
  const body='Synthetic body without payment labels.\n'.repeat(1500),text=sourceLine+'\n'+body;
  assert.ok(text.length>50000&&text.length<150000);
  assert.equal(assessment(observed(text)).accepted,true);
  for(const suffix of ['Bankgiro:','Bankgiro: 7512-6384','Bankgiro:\n482-7654'])assert.equal(assessment(observed(text+suffix)).accepted,false);
  const unproved=observed(text+sourceLine);unproved.evidence.pages[0].bankgiro.pop();
  assert.equal(assessment(unproved).accepted,false);
});

test('a complete sibling line does not bypass the existing text, line or word bounds',()=>{
  for(const text of [sourceLine+'\n'+'x'.repeat(150001),sourceLine+' '+Array.from({length:17},()=> 'x').join(' '),sourceLine+' '+ 'x'.repeat(501)])assert.equal(assessment(observed(text)).accepted,false);
});
