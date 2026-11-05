import test from 'node:test';
import assert from 'node:assert/strict';
import {labelDevelopmentCases,labelSafetyCases} from './document-label-corpus.mjs';
import {evidenceTable} from './invoice-evidence-cases.mjs';
import {packet,inputSha256} from './ocr-bankgiro-cases.mjs';

export function registerSummaryLabelTests(engine,parse){
  test(`${engine}: paragraph gaps never establish invoice identity from another line`,()=>{
    const sample=labelDevelopmentCases[0];
    for(const gap of ['\n\n','\n \n\t'])for(const value of ['Betalningsuppgifter','Tilläggsinformation','Avtalsöversikt','AnnanRubrik','123456','SYN-903']){
      const text=sample.text.replace('Fakturanummer: 86140','Fakturanummer:'+gap+value),result=parse(text,sample.metadata);
      assert.equal(result.fields.invoice_number.value,null,JSON.stringify({gap,value}));
      assert.notEqual(result.level,'green');assert.equal(result.text_excerpt,text);
    }
  });
  test(`${engine}: a bare alphabetic next-line value is not a verified invoice identifier`,()=>{
    const sample=labelDevelopmentCases[0];
    for(const value of ['Betalningsuppgifter','Tilläggsinformation','Avtalsöversikt','AnnanRubrik','ABCDEF']){
      const text=sample.text.replace('Fakturanummer: 86140','Fakturanummer:\n'+value),result=parse(text,sample.metadata);
      assert.equal(result.fields.invoice_number.value,null,value);assert.notEqual(result.level,'green');
    }
  });
  test(`${engine}: direct wrapped identifiers and same-line alphabetic identifiers remain readable`,()=>{
    const sample=labelDevelopmentCases[0];
    for(const [separator,value] of [['\n','86140'],['\n \t','SYN-86140'],[' ','ABCDEF']]){
      const result=parse(sample.text.replace('Fakturanummer: 86140','Fakturanummer:'+separator+value),sample.metadata);
      assert.equal(result.fields.invoice_number.value,value);assert.equal(result.level,'green',result.issues.join(' '));
    }
  });
  test(`${engine}: paragraph gaps do not borrow a reference, account or date`,()=>{
    const sample=labelDevelopmentCases[0];
    for(const [field,label,value] of [['reference','OCR','000026'],['bankgiro','Bankgiro','123-4567'],['issued_at','Fakturadatum','2026-10-20']]){
      const text=sample.text.replace(label+': '+value,label+':\n\n'+value),result=parse(text,sample.metadata);
      assert.equal(result.fields[field].value,null,field);assert.notEqual(result.level,'green');assert.equal(result.text_excerpt,text);
    }
  });
  test(`${engine}: OCR paragraph gaps preserve explicit wrapped summary values`,()=>{
    const sample=labelDevelopmentCases.find(sample=>sample.id==='wrapped-summaries');
    const text=sample.text.replaceAll('moms:\n','moms:\n \n\t');
    const result=parse(text,{...sample.metadata,method:'ocr',ocrConfidence:99,ocrEvidence:packet(text),ocrInputSha256:inputSha256});
    assert.deepEqual(Object.fromEntries(Object.entries(result.fields).map(([key,field])=>[key,field.value])),sample.gold.fields);
    assert.notEqual(result.level,'green','OCR still requires human verification');
    assert.match(result.fields.net_cents.evidence,/moms:\n \n\t4 000,00 SEK/);
  });
  test(`${engine}: blank lines never permit borrowing another heading or crossing a page`,()=>{
    const sample=labelDevelopmentCases.find(sample=>sample.id==='wrapped-summaries');
    for(const replacement of ['Summa exkl moms:\n\nMoms: 1 000,00 SEK','Summa exkl moms:\n\f\n4 000,00 SEK']){
      const result=parse(sample.text.replace('Summa exkl moms:\n4 000,00 SEK',replacement),sample.metadata);
      assert.equal(result.fields.net_cents.value,null);
      assert.notEqual(result.level,'green');
    }
  });
  test(`${engine}: tax-summary labels terminate an item table without hiding or adding rows`,()=>{
    const text=evidenceTable.replace('Netto: 300,00 SEK','Summa exklusive moms: 300,00 SEK').replace('Att betala: 362,00 SEK','Summa inklusive moms: 362,00 SEK');
    const result=parse(text,{direction:'supplier',direction_confident:true});
    assert.equal(result.details.table_status,'complete');
    assert.equal(result.details.line_items.length,2);
    assert.deepEqual(result.details.line_items.map(row=>[row.net_cents,row.vat_cents,row.total_cents]),[[20000,5000,25000],[10000,1200,11200]]);
    assert.equal(result.fields.net_cents.value,30000);
    assert.equal(result.fields.total_cents.value,36200);
    assert.equal(result.level,'green');
  });
  for(const sample of labelDevelopmentCases)test(`${engine}: explicit tax-summary label ${sample.id} preserves all printed fields`,()=>{
    const result=parse(sample.text,sample.metadata);
    assert.deepEqual(Object.fromEntries(Object.entries(result.fields).map(([key,field])=>[key,field.value])),sample.gold.fields);
    assert.equal(result.level,'green');
  });
  for(const sample of labelSafetyCases)test(`${engine}: unsafe tax-summary label ${sample.id} requires review`,()=>{
    const result=parse(sample.text,sample.metadata);
    assert.deepEqual(Object.fromEntries(Object.entries(result.fields).map(([key,field])=>[key,field.value])),sample.gold.fields);
    assert.notEqual(result.level,'green');
  });
}
