import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCanvas} from '@napi-rs/canvas';
import {interpretInvoice,extractInvoice,runDocumentProcess,validOrganization} from '../src/invoice-extraction.js';
import {openDatabase,storeDocument,listInvoices,storeTransactions,listDocuments,allocate,getSettings,saveSettings} from '../src/db.js';
import {analyzeDocument,approveDocument} from '../src/invoice-review.js';
import {ocrRasterSize} from '../src/ocr-raster-size.js';

import {text,textPdf,image,pdf} from './fixtures.js';
import {rasterPdf,archiveFooter,opticalInvoiceFacit} from './helpers/optical-invoice-fixtures.mjs';
const context={direction:'supplier',direction_confident:true};
const extracted=()=>interpretInvoice(text,context);
function opticalMeasurement(t,name,result){
  t.diagnostic(JSON.stringify({sample:name,method:result.method,fields:Object.fromEntries(Object.keys(opticalInvoiceFacit).map(key=>[key,result.fields[key].value])),level:result.level,invoice_confidence:result.fields.invoice_number.confidence,total_confidence:result.fields.total_cents.confidence}));
}
function assertOpticalFacit(result){for(const [key,value] of Object.entries(opticalInvoiceFacit))assert.equal(result.fields[key].value,value,key);}

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
test('real synthetic text PDF extracts fields without invoking OCR',async t=>{
  const r=await extractInvoice(textPdf(),'application/pdf',context);assert.equal(r.method,'pdf');assert.equal(r.fields.total_cents.value,375000);assert.equal(r.fields.invoice_number.value,'0606');
  assertOpticalFacit(r);
  opticalMeasurement(t,'native-text-pdf',r);
});
test('local OCR reads PNG, JPG and WebP invoice images and marks them for review',async t=>{
  const canvas=image();for(const mime of ['image/png','image/jpeg','image/webp']){const r=await extractInvoice(canvas.toBuffer(mime),mime,context);assert.equal(r.method,'ocr');assertOpticalFacit(r);assert.equal(r.level,'yellow');opticalMeasurement(t,mime,r);}
});
test('scanned PDF falls back to local OCR',async t=>{
  const r=await extractInvoice(rasterPdf(),'application/pdf',context);assert.equal(r.method,'ocr');assert.equal(r.fields.invoice_number.value,'0606');assert.equal(r.fields.total_cents.value,375000);assert.equal(r.level,'yellow');
  assertOpticalFacit(r);
  opticalMeasurement(t,'image-only-pdf',r);
});
test('scanned invoice with a long digital archive footer still uses optical invoice content',async t=>{
  const footer=archiveFooter;
  assert.ok(footer.replace(/\s/g,'').length>60);
  const r=await extractInvoice(rasterPdf({textLayer:footer}),'application/pdf',context);
  assert.equal(r.method,'ocr');assert.equal(r.fields.invoice_number.value,'0606');assert.equal(r.fields.total_cents.value,375000);
  assert.equal(r.level,'yellow');assert.ok(r.fields.invoice_number.confidence<=.85);assert.ok(r.fields.total_cents.confidence<=.85);
  assertOpticalFacit(r);
  opticalMeasurement(t,'scan-with-digital-footer',r);
});
test('usable native invoice text with a raster image retains PDF provenance',async t=>{
  const logo=createCanvas(120,120),ctx=logo.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,120,120);ctx.fillStyle='blue';ctx.fillRect(20,20,80,80);
  const r=await extractInvoice(rasterPdf({canvas:logo,textLayer:text}),'application/pdf',context);
  assert.equal(r.method,'pdf');assert.equal(r.fields.invoice_number.value,'0606');assert.equal(r.fields.total_cents.value,375000);assert.equal(r.level,'green');
  assertOpticalFacit(r);
  opticalMeasurement(t,'native-text-with-raster',r);
});
test('blank and severely pixelated synthetic scans remain review items without invented fields',async t=>{
  const blank=createCanvas(1400,1400),ctx=blank.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1400,1400);
  const tiny=createCanvas(25,25);tiny.getContext('2d').drawImage(image(),0,0,25,25);
  const poor=createCanvas(1400,1400),poorCtx=poor.getContext('2d');poorCtx.imageSmoothingEnabled=false;poorCtx.drawImage(tiny,0,0,1400,1400);
  for(const [name,canvas] of [['blank-image',blank],['pixelated-image',poor]]){
    const r=await extractInvoice(canvas.toBuffer('image/png'),'image/png',context);
    assert.equal(r.method,'ocr');assert.notEqual(r.level,'green');assert.equal(r.fields.invoice_number.value,null);assert.equal(r.fields.total_cents.value,null);
    for(const key of Object.keys(opticalInvoiceFacit))assert.equal(r.fields[key].value,null,key);
    opticalMeasurement(t,name,r);
  }
});
test('OCR enlargement is bounded after rounding and keeps larger input rasters unchanged',()=>{
  assert.deepEqual(ocrRasterSize(1400,1400),{width:2100,height:2100});
  assert.deepEqual(ocrRasterSize(1000,5333),{width:1500,height:8000});
  // The unrounded 1.5x product fits; rounding both axes would exceed 12M.
  assert.ok(1001*5328*2.25<12_000_000);
  assert.deepEqual(ocrRasterSize(1001,5328),{width:1001,height:5328});
  assert.deepEqual(ocrRasterSize(4000,3000),{width:4000,height:3000});
  assert.throws(()=>ocrRasterSize(4001,3000),/pixels/);
  for(const dimensions of [[0,10],[1.5,10],[10,Infinity]])assert.throws(()=>ocrRasterSize(...dimensions),/pixels/);
});
test('OCR enlargement preserves readable light gray and colored invoice text',async t=>{
  for(const ink of ['#b0b0b0','#4682b4']){
    const canvas=createCanvas(1400,1400),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1400,1400);ctx.fillStyle=ink;ctx.font='32px Arial';text.split('\n').forEach((line,n)=>ctx.fillText(line,60,70+n*68));
    const r=await extractInvoice(canvas.toBuffer('image/png'),'image/png',context);
    assert.equal(r.method,'ocr');assertOpticalFacit(r);assert.equal(r.level,'yellow');
    opticalMeasurement(t,'invoice-ink-'+ink,r);
  }
});
test('invalid PDF remains a red review item without crashing the API',async()=>{const r=await extractInvoice(Buffer.from('%PDF-invalid'),'application/pdf',context);assert.equal(r.level,'red');assert.equal(r.fields.total_cents.value,null);});
test('optical fallback retains document byte, page, text and rendered pixel limits',async()=>{
  assert.equal((await runDocumentProcess(Buffer.alloc(15_000_001),'image/png')).error,true);
  const pageIds=Array.from({length:11},(_,i)=>`${i+3} 0 R`).join(' ');
  const manyPages=pdf(['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${pageIds}] /Count 11 >>`,...Array.from({length:11},()=> '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>')]);
  assert.equal((await runDocumentProcess(manyPages,'application/pdf')).error,true);
  const hugePage=rasterPdf({pageSize:[4000,4000]});
  assert.equal((await runDocumentProcess(hugePage,'application/pdf')).error,true);
  assert.equal((await runDocumentProcess(rasterPdf({textLayer:'Archive '.repeat(20000),textFontSize:.001}),'application/pdf')).error,true);
});

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
