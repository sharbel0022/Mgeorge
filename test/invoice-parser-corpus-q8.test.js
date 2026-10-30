import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {interpretInvoice,extractInvoice,runDocumentProcess} from '../src/invoice-extraction.js';
import {openDatabase,storeDocument,getSettings,saveSettings,listInvoices} from '../src/db.js';
import {analyzeDocument,approveDocument} from '../src/invoice-review.js';
import {context,invoiceText,columnInvoice,adjacentOcr,hyphenDates,ambiguousHeaderCases,percentVat,identityCases,dateCases,moneyCases,invoicePdf,invoiceImage} from './helpers/invoice-parser-corpus.mjs';

for(const item of identityCases)test('Q8 synthetic invoice identity: '+item.name,()=>{
 const result=interpretInvoice(item.text,context);
 assert.equal(result.text_excerpt,item.text);
 if(item.held){assert.notEqual(result.level,'green');assert.equal(result.fields.invoice_number.value,null);}
 else{assert.equal(result.level,'green');assert.equal(result.fields.invoice_number.value,item.number);assert.equal(result.fields.reference.value,item.reference);assert.equal(result.fields.total_cents.value,375000);}
 if(item.ambiguousColumns)assert.equal(result.fields.reference.value,null);
});

for(const item of dateCases)test('Q8 synthetic Swedish invoice date: '+item.name,()=>{
 const result=interpretInvoice(item.text,context);assert.equal(result.fields.invoice_number.value,'0606');assert.equal(result.text_excerpt,item.text);
 if(item.held){assert.notEqual(result.level,'green');assert.equal(result.fields[item.held].value,null);}
 else{assert.equal(result.level,'green');assert.equal(result.fields.issued_at.value,item.issued);assert.equal(result.fields.due_at.value,item.due);}
});

for(const item of moneyCases)test('Q8 synthetic invoice money unit: '+item.name,()=>{
 const result=interpretInvoice(item.text,context);
 assert.notEqual(result.level,'green');assert.equal(result.fields.vat_cents.value,null);assert.equal(result.text_excerpt,item.text);
});

async function registrationFixture(t){
 const folder=mkdtempSync(join(tmpdir(),'mg-invoice-corpus-')),db=openDatabase(join(folder,'synthetic.sqlite'));
 t.after(()=>{db.close();rmSync(folder,{recursive:true,force:true});});
 const document=(text,name='syntetiskt-underlag.pdf')=>storeDocument(db,{name,mime_type:'application/pdf',bytes:invoicePdf(text),metadata:context});
 const seed=document(invoiceText.replace('Fakturanummer: 0606','Fakturanummer: SEED-01'));
 await analyzeDocument(db,seed.id);approveDocument(db,seed.id,{confirm:true});saveSettings(db,{...getSettings(db),auto_register_known:true});
 return {db,document};
}

test('Q8 actual PDF with explicit Swedish dates registers exact labelled identity once and rejects a second copy',async t=>{
 const f=await registrationFixture(t),doc=f.document(hyphenDates),result=await analyzeDocument(f.db,doc.id);
 assert.equal(result.method,'pdf');assert.equal(result.level,'green');
 const invoice=listInvoices(f.db).find(row=>row.invoice_number!=='SEED-01');assert.ok(invoice);
 assert.equal(invoice.invoice_number,'0606');assert.equal(invoice.reference,'000018');assert.equal(invoice.total_cents,375000);
 const before=invoicePdf(hyphenDates),original=f.db.prepare('SELECT content,fingerprint FROM documents WHERE id=?').get(doc.id);
 assert.deepEqual(Buffer.from(original.content),before);assert.equal(original.fingerprint,createHash('sha256').update(before).digest('hex'));
 const retransmission=f.document(invoiceText+'\nSyntetisk kopia'),held=await analyzeDocument(f.db,retransmission.id);
 assert.equal(listInvoices(f.db).length,2);assert.notEqual(held.level,'green');assert.deepEqual(held.duplicate_invoice_ids,[invoice.id]);
});

test('Q8 identical visible PDF columns remain held regardless of content-stream value order',async t=>{
 const f=await registrationFixture(t),forward=invoicePdf(columnInvoice),reverse=invoicePdf(columnInvoice,{reverseColumnValueOrder:true});
 const first=await runDocumentProcess(forward,'application/pdf',true),second=await runDocumentProcess(reverse,'application/pdf',true);
 assert.notDeepEqual(forward,reverse);assert.ok(Buffer.isBuffer(first.preview)&&first.preview.length>1000);assert.ok(Buffer.isBuffer(second.preview)&&second.preview.length>1000);
 assert.deepEqual(first.preview,second.preview,'Both originals display exactly the same column positions');
 for(const bytes of [forward,reverse]){
  const doc=storeDocument(f.db,{name:'syntetiska-kolumner.pdf',mime_type:'application/pdf',bytes,metadata:context}),result=await analyzeDocument(f.db,doc.id);
  assert.equal(result.method,'pdf');assert.notEqual(result.level,'green');assert.equal(result.fields.invoice_number.value,null);assert.equal(result.fields.reference.value,null);assert.equal(listInvoices(f.db).length,1);
 }
});

test('Q8 actual PDFs with punctuated or multiline heading lists remain unregistered',async t=>{
 const f=await registrationFixture(t);
 for(const item of ambiguousHeaderCases){
  const doc=f.document(item.text),result=await analyzeDocument(f.db,doc.id);
  assert.equal(result.method,'pdf');assert.notEqual(result.level,'green',item.name);assert.equal(result.fields.invoice_number.value,null,item.name);assert.equal(result.fields.reference.value,null,item.name);
  assert.equal(listInvoices(f.db).length,1,item.name);assert.equal(f.db.prepare('SELECT status FROM documents WHERE id=?').get(doc.id).status,'needs_review');
 }
});

test('Q8 actual PDF with contradictory VAT cannot auto-register using the percentage as its amount',async t=>{
 const f=await registrationFixture(t),doc=f.document(percentVat),result=await analyzeDocument(f.db,doc.id);
 assert.equal(result.method,'pdf');assert.notEqual(result.level,'green');assert.equal(result.fields.vat_cents.value,null);
 assert.equal(listInvoices(f.db).length,1);assert.equal(f.db.prepare('SELECT status FROM documents WHERE id=?').get(doc.id).status,'needs_review');
});

test('Q8 actual PDF cannot automatically register the next OCR label as a missing invoice number',async t=>{
 const f=await registrationFixture(t),doc=f.document(adjacentOcr),result=await analyzeDocument(f.db,doc.id);
 assert.equal(result.method,'pdf');assert.equal(result.fields.invoice_number.value,null);assert.notEqual(result.level,'green');
 assert.equal(listInvoices(f.db).length,1);assert.equal(f.db.prepare('SELECT status FROM documents WHERE id=?').get(doc.id).status,'needs_review');
});

test('Q8 actual Swedish PNG OCR keeps the same invoice/OCR facts but never becomes automatic evidence',async()=>{
 const bytes=invoiceImage(hyphenDates),before=createHash('sha256').update(bytes).digest('hex'),result=await extractInvoice(bytes,'image/png',context);
 assert.equal(result.method,'ocr');assert.equal(result.fields.invoice_number.value,'0606');assert.equal(result.fields.reference.value,'000018');
 assert.equal(result.fields.total_cents.value,375000);assert.equal(result.fields.issued_at.value,'2026-10-24');assert.equal(result.fields.due_at.value,'2026-11-07');
 assert.notEqual(result.level,'green');assert.ok(result.fields.invoice_number.confidence<.9);assert.equal(createHash('sha256').update(bytes).digest('hex'),before);
});

test('Q8 improved identity parsing does not admit unknown counterparties, credits or contradictory totals',async t=>{
 const f=await registrationFixture(t);
 for(const text of [hyphenDates.replace('Testbolaget AB','Okänd syntetisk leverantör AB'),hyphenDates.replace('Faktura\n','Kreditfaktura\n').replace('3 750,00','-3 750,00'),hyphenDates.replace('Moms: 750,00','Moms: 700,00')]){
  const doc=f.document(text),result=await analyzeDocument(f.db,doc.id);assert.notEqual(result.level,'green');assert.equal(listInvoices(f.db).length,1);
 }
});
