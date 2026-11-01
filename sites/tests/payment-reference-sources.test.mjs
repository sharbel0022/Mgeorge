import test from 'node:test';
import assert from 'node:assert/strict';
import * as references from '../lib/payment-references.js';
import {analyzeReconciliation} from '../lib/reconciliation-engine.js';

test('bank SEBG type detects invalid OCR that otherwise exactly matches an invoice number',()=>{
 const evidence=references.extractPaymentReferences({reference_number:'0599',reference_number_schema:'SEBG'});
 const findings=analyzeReconciliation({invoices:[{id:'i',invoice_number:'0599',reference:'000018',party:'Syntetisk kund AB',direction:'customer',kind:'invoice',currency:'SEK',issued_at:'2026-10-01',remaining_cents:62500}],transactions:[{id:'t',account:'synthetic-account',bank_reference:'SYNTHETIC-ENTRY',booked_at:'2026-10-26',amount_cents:62500,available_cents:62500,currency:'SEK',payer:'Syntetisk kund AB',reference:'0599',reference_evidence:evidence,verified:true}]});
 assert.equal(findings.length,1);assert.equal(findings[0].safe,false);assert.equal(findings[0].kind,'reference_conflict');
 assert.equal(evidence.selected.kind,'ocr');assert.equal(evidence.selected.validity,'checksum_invalid');
});

test('SEBG reads only its sibling reference and preserves exact text and schema',()=>{
 const result=references.extractPaymentReferences({reference_number:' 000018 ',reference_number_schema:'SEBG',details:{reference_number:'0599'}});
 assert.deepEqual(result.candidates.map(({value,rawValue,source,kind,validity,schema})=>({value,rawValue,source,kind,validity,schema})),[
  {value:'000018',rawValue:' 000018 ',source:'$.reference_number',kind:'ocr',validity:'checksum_valid',schema:'SEBG'},
  {value:'0599',rawValue:'0599',source:'$.details.reference_number',kind:'structured',validity:'unchecked',schema:undefined}
 ]);
});

test('unknown API scheme and generic SCOR retain structured identity without claiming OCR',()=>{
 for(const schema of ['SEPG','OTHER']){
  const candidate=references.extractPaymentReferences({reference_number:'0599',reference_number_schema:schema}).selected;
  assert.equal(candidate.kind,'structured');assert.equal(candidate.validity,'unchecked');assert.equal(candidate.schema,schema);
 }
 const candidate=references.extractPaymentReferences({RmtInf:{Strd:{CdtrRefInf:{Tp:{CdOrPrtry:{Cd:'SCOR'}},Ref:' 0599 '}}}}).selected;
 assert.equal(candidate.kind,'structured');assert.equal(candidate.validity,'unchecked');assert.equal(candidate.schema,'SCOR');assert.equal(candidate.rawValue,' 0599 ');
});

test('typed ISO OCR references keep their real paths across all repeated XML elements',()=>{
 const raw={RmtInf:[{Strd:[{CdtrRefInf:[{Tp:[{CdOrPrtry:[{Prtry:['OCR']}]}],Ref:[' 000018 ']}]},{CdtrRefInf:[{Tp:[{CdOrPrtry:[{Prtry:['SEOCR']}]}],Ref:['000019']}]}]}]};
 const before=structuredClone(raw),result=references.extractPaymentReferences(raw,{sourcePrefix:'$.Ntry[1].NtryDtls.TxDtls[2]'});
 assert.deepEqual(result.candidates.map(({source,value,rawValue,kind,validity,schema})=>({source,value,rawValue,kind,validity,schema})),[
  {source:'$.Ntry[1].NtryDtls.TxDtls[2].RmtInf[0].Strd[0].CdtrRefInf[0].Ref[0]',value:'000018',rawValue:' 000018 ',kind:'ocr',validity:'checksum_valid',schema:'OCR'},
  {source:'$.Ntry[1].NtryDtls.TxDtls[2].RmtInf[0].Strd[1].CdtrRefInf[0].Ref[0]',value:'000019',rawValue:'000019',kind:'ocr',validity:'checksum_invalid',schema:'SEOCR'}
 ]);
 assert.deepEqual(raw,before);assert.ok(result.warnings.length);
});

test('labelled references preserve the complete original message for every extracted token',()=>{
 const rawValue='  Tack, faktura: 0599; OCR: 000018\n ';
 const result=references.extractPaymentReferences({note:rawValue,remittance_information:['  Betalning  ',rawValue]});
 const tokens=result.candidates.filter(c=>c.kind!=='message');
 assert.deepEqual(new Set(tokens.map(c=>c.value)),new Set(['0599','000018']));
 assert.ok(tokens.every(c=>c.rawValue===rawValue));
 assert.equal(result.candidates.find(c=>c.value==='Betalning').rawValue,'  Betalning  ');
 assert.deepEqual(new Set(references.matchingReferenceValues(result)),new Set(['000018','0599']));
});

test('same reference labelled as invoice and OCR keeps the invalid OCR evidence',()=>{
 const rawValue='Faktura: 0599; OCR: 0599',result=references.extractPaymentReferences({note:rawValue});
 assert.deepEqual(new Set(result.candidates.map(c=>c.kind)),new Set(['invoice','ocr']));
 assert.ok(result.candidates.some(c=>c.kind==='ocr'&&c.validity==='checksum_invalid'&&c.rawValue===rawValue));
 assert.ok(result.warnings.length);
});

test('ambiguous ISO reference types are incomplete instead of silently generic',()=>{
 const result=references.extractPaymentReferences({RmtInf:{Strd:{CdtrRefInf:{Tp:[{CdOrPrtry:{Prtry:'OCR'}},{CdOrPrtry:{Cd:'SCOR'}}],Ref:'0599'}}}});
 assert.equal(result.incomplete,true);
});

test('agreement status stays unknown unless its rules were explicitly supplied',()=>{
 assert.equal(typeof references.validateOcrAgreement,'function');
 for(const agreement of [undefined,{}, {control:'fixed_length',lengths:[]},{control:'fixed_length',lengths:[6,10,12]}, {control:'guessed'}]){
  const result=references.validateOcrAgreement('000018',agreement);
  assert.equal(result.status,'unknown');assert.equal(result.checksumValid,true);
 }
});

test('explicit OCR agreement checks variable penultimate digit and at most two fixed lengths',()=>{
 assert.equal(typeof references.validateOcrAgreement,'function');
 const cases=[
  ['000067',{control:'variable_length'},'valid',true],
  ['000018',{control:'variable_length'},'invalid',false],
  ['000018',{control:'fixed_length',lengths:[6,10]},'valid',true],
  ['000018',{control:'fixed_length',lengths:[10]},'invalid',false],
  ['000019',{control:'hard'},'invalid',null],
  ['000018',{control:'soft'},'valid',null],
  ['000 018',{control:'hard'},'invalid',null]
 ];
 for(const [value,agreement,status,lengthValid] of cases){const result=references.validateOcrAgreement(value,agreement);assert.equal(result.status,status,JSON.stringify({value,agreement}));assert.equal(result.lengthValid,lengthValid);}
});
