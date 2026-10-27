import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCanvas} from '@napi-rs/canvas';
import {interpretInvoice,extractInvoice,validOrganization} from '../src/invoice-extraction.js';
import {openDatabase,storeDocument,listInvoices,storeTransactions,listDocuments,allocate,getSettings,saveSettings} from '../src/db.js';
import {analyzeDocument,approveDocument} from '../src/invoice-review.js';

import {text,textPdf,image,pdf} from './fixtures.js';
const context={direction:'supplier',direction_confident:true};
const extracted=()=>interpretInvoice(text,context);

test('Swedish invoice fields retain leading zeroes, evidence, valid dates, amounts and VAT',()=>{
  const r=extracted();assert.equal(r.fields.invoice_number.value,'0606');assert.equal(r.fields.total_cents.value,375000);assert.equal(r.fields.net_cents.value,300000);assert.equal(r.fields.vat_cents.value,75000);assert.equal(r.fields.party.value,'Testbolaget AB');assert.equal(r.fields.organization_number.value,'5560160680');assert.equal(validOrganization('556016-0680'),true);assert.equal(r.level,'green');assert.ok(r.fields.total_cents.evidence);
});
test('missing fields stay null, conflicting totals and multiple invoices require review',()=>{
  assert.equal(interpretInvoice('Invoice',context).fields.total_cents.value,null);
  const r=interpretInvoice(text+'\nFakturanummer: 0777\nAtt betala: 10,00 SEK',context);assert.equal(r.level,'red');assert.equal(r.fields.invoice_number.value,null);assert.equal(r.fields.total_cents.value,null);
  assert.equal(interpretInvoice(text.replace('750,00','700,00'),context).level,'red');
  assert.equal(interpretInvoice(text.replace('2026-11-07','2026-02-30'),context).fields.due_at.value,null);
});
test('credits use positive ledger amounts; receipts, forwarded mail and foreign currency cannot auto-register',()=>{
  const credit=interpretInvoice(text.replace('Faktura\n','Kreditfaktura\n').replace('3 750,00','-3 750,00'),context);assert.equal(credit.fields.kind.value,'credit');assert.equal(credit.fields.total_cents.value,375000);
  assert.equal(interpretInvoice('Kvitto\n'+text,context).fields.kind.value,'receipt');
  assert.equal(interpretInvoice(text,{direction:'supplier',direction_confident:false}).level,'yellow');
  assert.notEqual(interpretInvoice(text.replace('SEK','EUR'),context).level,'green');
});
test('real synthetic text PDF extracts fields without invoking OCR',async()=>{
  const r=await extractInvoice(textPdf(),'application/pdf',context);assert.equal(r.method,'pdf');assert.equal(r.fields.total_cents.value,375000);assert.equal(r.fields.invoice_number.value,'0606');
});
test('local OCR reads PNG, JPG and WebP invoice images and marks them for review',async()=>{
  const canvas=image();for(const mime of ['image/png','image/jpeg','image/webp']){const r=await extractInvoice(canvas.toBuffer(mime),mime,context);assert.equal(r.method,'ocr');assert.equal(r.fields.invoice_number.value,'0606');assert.equal(r.fields.total_cents.value,375000);assert.equal(r.level,'yellow');}
});
test('scanned PDF falls back to local OCR',async()=>{
  const canvas=image(),jpg=canvas.toBuffer('image/jpeg'),stream='q 595 0 0 595 0 200 cm /Im0 Do Q';
  const bytes=pdf(['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',`<< /Type /XObject /Subtype /Image /Width 1400 /Height 1400 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n${jpg.toString('latin1')}\nendstream`,`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`]);
  const r=await extractInvoice(bytes,'application/pdf',context);assert.equal(r.method,'ocr');assert.equal(r.fields.invoice_number.value,'0606');assert.equal(r.fields.total_cents.value,375000);
});
test('invalid PDF remains a red review item without crashing the API',async()=>{const r=await extractInvoice(Buffer.from('%PDF-invalid'),'application/pdf',context);assert.equal(r.level,'red');assert.equal(r.fields.total_cents.value,null);});

test('automatic registration is opt-in and restricted to green invoices from known identities',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'mg-auto-register-')),db=openDatabase(join(folder,'test.sqlite'));
  try{
    const seed=storeDocument(db,{name:'first.pdf',mime_type:'application/pdf',bytes:Buffer.from('seed')});await analyzeDocument(db,seed.id,{extract:async()=>extracted()});approveDocument(db,seed.id,{confirm:true});
    saveSettings(db,{...getSettings(db),auto_register_known:true});
    const next=storeDocument(db,{name:'next.pdf',mime_type:'application/pdf',bytes:Buffer.from('next')});await analyzeDocument(db,next.id,{extract:async()=>interpretInvoice(text.replace('0606','0607'),context)});
    assert.equal(listInvoices(db).length,2);assert.equal(listInvoices(db).find(i=>i.invoice_number==='0607').status,'unreconciled');
    const unknown=storeDocument(db,{name:'unknown.pdf',mime_type:'application/pdf',bytes:Buffer.from('unknown')});await analyzeDocument(db,unknown.id,{extract:async()=>interpretInvoice(text.replace('Testbolaget AB','New supplier AB'),context)});assert.equal(listInvoices(db).length,2);
    const scan=storeDocument(db,{name:'scan.pdf',mime_type:'application/pdf',bytes:Buffer.from('scan')});await analyzeDocument(db,scan.id,{extract:async()=>interpretInvoice(text.replace('0606','0608'),{...context,method:'ocr',ocrConfidence:99})});assert.equal(listInvoices(db).length,2);
  }finally{db.close();rmSync(folder,{recursive:true,force:true});}
});

test('review registration, corrections, retransmissions, unknown suppliers and payment evidence are preserved',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'mg-extraction-')),db=openDatabase(join(folder,'test.sqlite'));
  try{
    const document=storeDocument(db,{name:'synthetic.pdf',mime_type:'application/pdf',bytes:textPdf(),source:'gmail',source_id:'mail-1',metadata:context});
    const r=await analyzeDocument(db,document.id,{extract:async()=>extracted()});assert.equal(r.level,'yellow');assert.equal(listInvoices(db).length,0);
    assert.throws(()=>approveDocument(db,document.id,{}),/bekräfta/);
    const invoice=approveDocument(db,document.id,{confirm:true,values:{party:'Testbolaget AB',reference:'0606'}});
    assert.equal(listInvoices(db)[0].status,'unreconciled');assert.equal(approveDocument(db,document.id,{confirm:true}).id,invoice.id);
    const sentAgain=storeDocument(db,{name:'again.pdf',mime_type:'application/pdf',bytes:textPdf(),source:'gmail',source_id:'mail-2',metadata:{from:'supplier@example.com'}});assert.equal(sentAgain.id,document.id);assert.equal(listDocuments(db)[0].sources.length,2);
    const second=storeDocument(db,{name:'copy.pdf',mime_type:'application/pdf',bytes:Buffer.concat([textPdf(),Buffer.from('\n')])});await analyzeDocument(db,second.id,{extract:async()=>extracted()});
    assert.throws(()=>approveDocument(db,second.id,{confirm:true}),/finns redan/);approveDocument(db,second.id,{confirm:true,link_invoice_id:invoice.id});assert.equal(listInvoices(db).length,1);
    const other=storeDocument(db,{name:'other.pdf',mime_type:'application/pdf',bytes:Buffer.concat([textPdf(),Buffer.from('\n\n')])});await analyzeDocument(db,other.id,{extract:async()=>interpretInvoice(text.replace('Testbolaget AB','Annat AB').replace('556016-0680','556036-0793'),context)});approveDocument(db,other.id,{confirm:true});assert.equal(listInvoices(db).length,2);
    storeTransactions(db,[{account:'Synthetic',booked_at:'2026-10-27',amount_cents:-100000,currency:'SEK',payer:'Testbolaget AB',reference:'0606',bank_reference:'test-reference'}],'manual');
    const tx=db.prepare('SELECT id FROM bank_transactions').get();allocate(db,invoice.id,tx.id,100000);assert.equal(listInvoices(db).find(i=>i.id===invoice.id).remaining_cents,275000);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='invoice_review_approved'").get().n,2);
  }finally{db.close();rmSync(folder,{recursive:true,force:true});}
});
