import test from 'node:test';
import assert from 'node:assert/strict';
import {preflightOriginal} from '../lib/openai-invoices/preflight.js';
import {pagesPdf,continuedInvoicePdf} from '../../test/helpers/pdf-layout-ocr.mjs';
import {image} from '../../test/fixtures.js';
test('AI preflight uses actual original pages and preserves PDF bytes',async()=>{
  const bytes=continuedInvoicePdf(),before=Buffer.from(bytes),result=await preflightOriginal(bytes,'application/pdf');
  assert.equal(result.pageCount,2);assert.deepEqual(bytes,before);assert.equal(result.bytes,bytes);
});
test('corrupt and excessive-page PDFs are rejected before transmission',async()=>{
  await assert.rejects(()=>preflightOriginal(Buffer.from('%PDF-1.7 invalid synthetic file'),'application/pdf'));
  await assert.rejects(()=>preflightOriginal(pagesPdf(Array(11).fill('')),'application/pdf'));
});
test('image preflight accepts bounded originals and rejects invalid dimensions/type/size',async()=>{
  const bytes=image().toBuffer('image/png'),result=await preflightOriginal(bytes,'image/png');
  assert.equal(result.pageCount,1);assert.equal(result.bytes,bytes);
  await assert.rejects(()=>preflightOriginal(bytes,'image/gif'));
  await assert.rejects(()=>preflightOriginal(new Uint8Array(5_000_001),'application/pdf'));
  const huge=Buffer.from(bytes);huge.writeUInt32BE(12001,16);
  await assert.rejects(()=>preflightOriginal(huge,'image/png'));
});
