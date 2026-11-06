// New synthetic development regressions. No holdout image, gold or OCR call.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadInvoiceParsers} from './helpers/load-invoice-parsers.mjs';
import {reconstructOcrLayout} from '../sites/lib/ocr-layout.js';
import {word,observation,allWords} from './helpers/ocr-layout-fixtures.mjs';

const parsers=await loadInvoiceParsers();
const options={method:'ocr',ocrConfidence:99,direction:'supplier',direction_confident:true};
const body='INVOICE\nSupplier: Synthetic Cobalt AB\nInvoice number: ALIAS-482\nDue date: 2027-03-12\nNet amount: 800.00 SEK\nVAT amount: 200.00 SEK\nAmount due: 1 000.00 SEK';
function row(text,x,y){return text.split(' ').map(text=>{const token=word(text,x,y);x+=text.length*8+8;return token;});}
function layout(source){
  const before=structuredClone(source),originals=allWords(source.blocks);
  const result=reconstructOcrLayout(source.text,source.blocks),retained=allWords(result.blocks);
  assert.deepEqual(source,before);assert.equal(retained.length,originals.length);
  assert.equal(new Set(retained).size,originals.length);
  for(const token of originals)assert.ok(retained.includes(token),'actual words, boxes and confidence survive once');
  assert.deepEqual(result.text.trim().split(/\s+/).sort(),source.text.trim().split(/\s+/).sort());
  return result;
}
function dateCell({label='Issue date',value='2027-02-12',extra=[],role='Faktureras till'}={}){
  return observation([row(label,700,10),[...row(role,0,45),...row(value,700,45)],row('Synthetic Buyer AB',0,80),...extra],{gap:'\n\n'});
}

for(const [engine,parse] of Object.entries(parsers)){
  const read=text=>parse(text,options);
  for(const value of ['2027-02-12','12/02/2027','2 0 2 7 - 0 2 - 1 2'])test(engine+' Issue date reads its complete printed date: '+value,()=>{
    const text=body+'\nIssue date: '+value,r=read(text);
    assert.equal(r.fields.issued_at.value,'2027-02-12');assert.equal(r.text_excerpt,text);
    assert.ok(r.fields.issued_at.confidence<=.85);assert.notEqual(r.level,'green');
  });
  for(const suffix of ['unknown','2027-02-13','2027-02-30'])test(engine+' Issue date participates in the full duplicate census: '+suffix,()=>{
    const r=read(body+'\nInvoice date: 2027-02-12\nIssue date: '+suffix);
    assert.equal(r.fields.issued_at.value,null);assert.notEqual(r.level,'green');
  });
  for(const label of ['Reissue date','XIssue date','Ref/Issue date','Issue dates','Issue datecode'])test(engine+' a longer label is not the Issue date alias: '+label,()=>{
    const text=body+'\n'+label+': 2027-02-12',r=read(text);
    assert.equal(r.fields.issued_at.value,null);assert.equal(r.text_excerpt,text);
  });
  for(const value of ['2027-02-12 unknown','2027-02-12/17','2027-02-30','2027-02-12 2027-02-13'])test(engine+' Issue date retains invalid or residual value text: '+value,()=>{
    assert.equal(read(body+'\nIssue date: '+value).fields.issued_at.value,null);
  });
  for(const label of ['Organisation number','Organization number'])test(engine+' supported organization spelling bounds an inline scalar: '+label,()=>{
    const text=body.replace('Invoice number: ALIAS-482','Invoice number: ALIAS-482 '+label+': 556016-0680');
    assert.equal(read(text).fields.invoice_number.value,'ALIAS-482');
  });
  for(const label of ['Reorganization number','Organization numbercode'])test(engine+' a longer organization label cannot hide an invalid invoice suffix: '+label,()=>{
    const text=body.replace('Invoice number: ALIAS-482','Invoice number: ALIAS-482 '+label+': 556016-0680');
    assert.equal(read(text).fields.invoice_number.value,null);
  });
  test(engine+' Issue date ends the preceding explicit supplier name and organization value',()=>{
    const r=read(body.replace('Supplier: Synthetic Cobalt AB','Supplier: Synthetic Cobalt AB Issue date: 2027-02-12')+'\nSupplier organization number: 556016-0680 Issue date: 2027-02-12');
    assert.equal(r.fields.party.value,'Synthetic Cobalt AB');
    assert.equal(r.fields.organization_number.value,'5560160680');assert.equal(r.fields.issued_at.value,'2027-02-12');
  });
  test(engine+' a standalone Issue date heading cannot become the next supplier name',()=>{
    const r=read('INVOICE\nSupplier\nIssue date\n2027-02-12');
    assert.equal(r.fields.party.value,null);assert.equal(r.fields.issued_at.value,'2027-02-12');
  });
  test(engine+' Issue date bounds but cannot validate an invalid organization number',()=>{
    const r=read(body+'\nSupplier organization number: 556016-0681 Issue date: 2027-02-12');
    assert.equal(r.fields.organization_number.value,null);assert.equal(r.fields.issued_at.value,'2027-02-12');
  });
  test(engine+' Issue date is an owned geometry cell without creating an organization owner',()=>{
    const result=layout(dateCell());assert.equal(result.reconstructed,true);
    const r=read(result.text);assert.equal(r.fields.issued_at.value,'2027-02-12');
    assert.equal(r.fields.party.value,null);assert.equal(r.fields.organization_number.value,null);
  });
  test(engine+' all three explicit metadata columns must own their original values',()=>{
    const source=observation([
      [...row('Invoice number',0,10),...row('Issue date',400,10),...row('Due date',800,10)],
      [...row('CELL-734',0,45),...row('2027-02-12',400,45),...row('2027-03-12',800,45)]
    ],{gap:'\n\n'}),result=layout(source),r=read(result.text);
    assert.equal(result.reconstructed,true);assert.equal(r.fields.invoice_number.value,'CELL-734');
    assert.equal(r.fields.issued_at.value,'2027-02-12');assert.equal(r.fields.due_at.value,'2027-03-12');
  });
  for(const [name,settings] of [
    ['a competing below value',{extra:[row('2027-04-15',700,70)]}],
    ['an unresolved neighboring role',{role:'Unknown label'}],
    ['an incomplete label',{label:'Issue dates'}],
    ['an unreadable value suffix',{value:'2027-02-12 unknown'}],
    ['a competing explicit heading',{extra:[row('Agreement date:',500,45)]}],
  ])test(engine+' alias geometry keeps '+name,()=>{
    const source=dateCell(settings),r=read(layout(source).text);
    assert.equal(r.fields.issued_at.value,null);assert.notEqual(r.level,'green');
  });
  for(const label of ['Organization number','Organisation number'])test(engine+' organization geometry spelling keeps the unowned number unassigned: '+label,()=>{
    const source=observation([row(label,700,10),[...row('Faktureras till',0,45),...row('556016-0680',700,45)],row('Synthetic Buyer AB',0,80)],{gap:'\n\n'});
    const result=layout(source),r=read(result.text);assert.equal(result.reconstructed,true);
    assert.ok(result.text.includes(label+' 556016-0680'));
    assert.equal(r.fields.party.value,null);assert.equal(r.fields.organization_number.value,null);
  });
  for(const label of ['Bill to:','Fakturamottagare:'])test(engine+' existing recipient label participates in the complete geometry census: '+label,()=>{
    const source=observation([
      [...row(label,0,10),...row('Invoice number',700,10)],
      [...row('Synthetic Buyer AB',0,45),...row('CELL-734',700,45)],
      row('Organization number: 556016-0680',0,160)
    ],{gap:'\n\n'}),result=layout(source),r=read(result.text);
    assert.equal(result.reconstructed,true);assert.equal(r.fields.invoice_number.value,'CELL-734');
    assert.equal(r.details.recipient.name,'Synthetic Buyer AB');assert.equal(r.fields.party.value,null);
    assert.equal(r.fields.organization_number.value,null);assert.equal(r.details.recipient.organization_number,null);
  });
  test(engine+' unknown residual recipient text prevents the neighboring invoice assignment',()=>{
    const source=observation([
      [...row('Bill to:',0,10),...row('Invoice number',700,10)],
      [...row('Synthetic Buyer AB',0,45),...row('unknown',400,45),...row('CELL-734',700,45)]
    ],{gap:'\n\n'}),result=layout(source);
    assert.equal(result.reconstructed,false);assert.equal(result.text,source.text);
    assert.equal(read(result.text).fields.invoice_number.value,null);
  });
  test(engine+' alias handling does not repair VAT or authorize an unbound payment destination',()=>{
    const r=read(body.replace('VAT amount: 200.00 SEK','VAT 2590\t200.00 SEK')+'\nIssue date: 2027-02-12\nBankgiro: 482-7654');
    assert.equal(r.fields.vat_cents.value,null);assert.equal(r.fields.bankgiro.value,null);assert.notEqual(r.level,'green');
  });
}
