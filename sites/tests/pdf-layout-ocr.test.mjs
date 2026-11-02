import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {serverPdfText} from '../lib/server-pdf.ts';
import {positionedInvoicePdf,hiddenLayerInvoicePdf,continuedInvoicePdf,tableInvoicePdf,paintedInvoicePdf,layoutContext} from '../../test/helpers/pdf-layout-ocr.mjs';
import {loadInvoiceParser} from './helpers/invoice-module-loader.mjs';
import {documentOcrFixture} from './helpers/document-ocr-fixture.mjs';
import {browserOcrFixture} from './helpers/browser-ocr-fixture.mjs';
import {fragmentedInvoicePdf} from '../../test/helpers/fragmented-pdf.mjs';
import {rasterPdf,archiveFooter} from '../../test/helpers/optical-invoice-fixtures.mjs';
const {interpretInvoice}=await loadInvoiceParser();

test('permuted real PDF objects register only the visibly labelled invoice identity',async t=>{
  const bytes=positionedInvoicePdf({order:[0,3,2,1]}),f=await documentOcrFixture(t,bytes);
  await f.api.processDocuments(f.owner);
  assert.equal(f.invoices().length,1);assert.equal(f.invoices()[0].number,'0606');assert.equal(f.invoices()[0].ocr,'000018');
  const job=f.sql.prepare('SELECT state,automatic,extraction FROM document_jobs').get();
  assert.equal(job.state,'registered');assert.equal(job.automatic,1);assert.equal(JSON.parse(job.extraction).method,'pdf');
  assert.deepEqual(f.bytes,bytes);assert.equal(createHash('sha256').update(f.bytes).digest('hex'),f.sha);
});

for(const order of [[0,1,2,3],[0,3,2,1]])test('vertical columns cannot assign an OCR value as the invoice number: '+order.join(','),async t=>{
  const bytes=positionedInvoicePdf({columns:true,order}),f=await documentOcrFixture(t,bytes);
  await f.api.processDocuments(f.owner);
  for(const invoice of f.invoices()){assert.equal(invoice.number,'0606');assert.equal(invoice.ocr,'000018');}
  const job=f.sql.prepare('SELECT state,extraction FROM document_jobs').get(),result=JSON.parse(job.extraction);
  assert.ok(result.fields.invoice_number.value===null||result.fields.invoice_number.value==='0606');
  assert.ok(result.fields.reference.value===null||result.fields.reference.value==='000018');
  if(result.fields.invoice_number.value===null||result.fields.reference.value===null){assert.notEqual(result.level,'green');assert.equal(f.invoices().length,0);}
  assert.deepEqual(f.bytes,bytes);
});

for(const options of [{},{mode:0,opacity:0}])test('hidden native text routes a scan to optical review: '+JSON.stringify(options),async t=>{
  const bytes=hiddenLayerInvoicePdf(options),f=await documentOcrFixture(t,bytes);
  await assert.rejects(serverPdfText(Uint8Array.from(bytes)),/local_ocr_required/);
  await f.api.processDocuments(f.owner);
  assert.equal(f.sql.prepare('SELECT state FROM document_jobs').get().state,'waiting_ocr');
  assert.equal(f.invoices().length,0);assert.deepEqual(f.bytes,bytes);
});

for(const option of ['rotated','mirrored','overlap'])test('unreliable invoice geometry cannot acquire native PDF trust: '+option,async()=>{
  await assert.rejects(serverPdfText(Uint8Array.from(positionedInvoicePdf({[option]:true}))),/local_ocr_required/);
});

test('Sites native text preserves page boundaries without changing document values',async()=>{
  const parsed=await serverPdfText(Uint8Array.from(continuedInvoicePdf()));
  assert.equal(parsed.text.split('\f').length,2);
  const result=interpretInvoice(parsed.text,layoutContext);
  assert.equal(result.fields.invoice_number.value,'0606');assert.equal(result.fields.total_cents.value,375000);
});

test('browser PDF reconstruction preserves the same adjacent identifier and amount fragments',async t=>{
  const browser=await browserOcrFixture(t),bytes=fragmentedInvoicePdf(),parsed=await browser.pdfInvoiceText(Uint8Array.from(bytes).buffer);
  const result=interpretInvoice(parsed.text,layoutContext);
  assert.equal(parsed.ocr,false);assert.equal(result.fields.invoice_number.value,'0606');assert.equal(result.fields.total_cents.value,50000);
});

test('browser PDF fallback reads invoice pixels when a long native footer contains no invoice fields',async t=>{
  const browser=await browserOcrFixture(t),bytes=rasterPdf({textLayer:archiveFooter}),parsed=await browser.pdfInvoiceText(Uint8Array.from(bytes).buffer);
  assert.equal(parsed.ocr,true);assert.match(parsed.text,/0606/);
  const result=interpretInvoice(parsed.text,{...layoutContext,method:'ocr',ocrConfidence:parsed.confidence});
  assert.notEqual(result.level,'green');assert.ok(result.fields.invoice_number.confidence<=.85);
});

test('browser PDF retains the actual boundary between native pages',async t=>{
  const browser=await browserOcrFixture(t),bytes=continuedInvoicePdf(),parsed=await browser.pdfInvoiceText(Uint8Array.from(bytes).buffer);
  assert.equal(parsed.text.split('\f').length,2);
});

for(const continued of [false,true])test('Sites reads actual positioned invoice table cells'+(continued?' across pages':''),async()=>{
  const parsed=await serverPdfText(Uint8Array.from(tableInvoicePdf({continued}))),result=interpretInvoice(parsed.text,layoutContext);
  assert.equal(result.details.table_status,'complete');assert.equal(result.details.line_items.length,2);
  assert.deepEqual(result.details.line_items.map(row=>[row.description,row.quantity,row.unit_price_cents,row.net_cents]),[['Tjänst A',2,10000,20000],['Tjänst B',1,10000,10000]]);
  assert.equal(result.details.line_items[1].evidence.page,continued?2:1);
});

for(const variant of ['white','clipped','covered','dark'])test('native paint operations require optical review when invoice text may be invisible: '+variant,async()=>{
  await assert.rejects(serverPdfText(Uint8Array.from(paintedInvoicePdf(variant))),/local_ocr_required/);
});
