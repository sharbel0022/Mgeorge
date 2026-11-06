import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,storeDocument,invoiceReferenceOriginal} from '../src/db.js';
import {interpretInvoice,extractInvoice} from '../src/invoice-extraction.js';
import {approveDocument} from '../src/invoice-review.js';
import {enrichNodeInvoice} from '../src/openai-invoice-integration.js';
import {positionedInvoicePdf} from './helpers/pdf-layout-ocr.mjs';

function fixture(t){
  const folder=mkdtempSync(join(tmpdir(),'mg-openai-node-')),database=openDatabase(join(folder,'test.sqlite'));
  t.after(()=>{database.close();rmSync(folder,{recursive:true,force:true});});
  const bytes=positionedInvoicePdf(),document=storeDocument(database,{name:'synthetic.pdf',mime_type:'application/pdf',bytes});
  const row=database.prepare('SELECT * FROM documents WHERE id=?').get(document.id);
  return {database,row,bytes};
}
const environment=()=>({OPENAI_INVOICES_ENABLED:'true',OPENAI_INVOICES_PRIVACY_APPROVED:'true',OPENAI_INVOICES_SECURITY_APPROVED:'true',OPENAI_INVOICES_COST_APPROVED:'true',OPENAI_INVOICES_APPROVAL_ID:'synthetic-test',OPENAI_INVOICES_ALLOWED_OWNERS:'["node:legacy"]',OPENAI_INVOICES_COMPANY_ORGANIZATIONS:'{"node:legacy":"5560160680"}',OPENAI_INVOICES_PROFILE:'luna-v1',OPENAI_API_KEY:'synthetic-key-not-a-credential'});
test('Node worker supplies original-bound page metadata for the guarded AI wrapper',async t=>{
  const f=fixture(t),extraction=await extractInvoice(f.bytes,'application/pdf',{direction:'supplier'});
  assert.deepEqual(extraction.documentRead,{validated:true,sha256:f.row.fingerprint,mime:'application/pdf',pageCount:1});
});
test('Node integration requires worker-validated bytes and never changes the original',async t=>{
  const f=fixture(t),baseline=interpretInvoice('',{direction:'supplier'});let calls=0;
  const adapter=async input=>{calls++;assert.equal(input.inputValidated,true);assert.equal(input.policy.owner,'node:legacy');return {status:'fallback',code:'SYNTHETIC_UNAVAILABLE'};};
  const input={environment:environment(),adapter};
  const refused=await enrichNodeInvoice(f.database,f.row,baseline,input);
  assert.equal(refused.ai.code,'ORIGINAL_PREFLIGHT_FAILED');assert.equal(calls,0);
  baseline.documentRead={validated:true,sha256:f.row.fingerprint,mime:'application/pdf',pageCount:1};
  const first=await enrichNodeInvoice(f.database,f.row,baseline,input),second=await enrichNodeInvoice(f.database,f.row,baseline,input);
  assert.equal(calls,1);assert.equal(first.ai.bankEvidence,false);assert.equal(second.ai.replayed,true);
  assert.deepEqual(Buffer.from(f.database.prepare('SELECT content FROM documents WHERE id=?').get(f.row.id).content),f.bytes);
});
test('automatic Node registration rejects AI review even with a forged green result',t=>{
  const f=fixture(t),extraction=interpretInvoice('',{direction:'supplier'});
  extraction.level='green';extraction.ai={requiresHumanReview:true,bankEvidence:false};
  f.database.prepare('UPDATE documents SET extraction=? WHERE id=?').run(JSON.stringify(extraction),f.row.id);
  assert.throws(()=>approveDocument(f.database,f.row.id,{},true),/granskning/);
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM invoices').get().n,0);
});
test('Node integration refuses an original replaced after OCR',async t=>{
  const f=fixture(t),baseline=interpretInvoice('',{direction:'supplier'});let calls=0;
  baseline.documentRead={validated:true,sha256:f.row.fingerprint,mime:'application/pdf',pageCount:1};
  f.database.prepare('UPDATE documents SET content=? WHERE id=?').run(Buffer.from('altered'),f.row.id);
  await assert.rejects(()=>enrichNodeInvoice(f.database,f.row,baseline,{environment:environment(),adapter:async()=>{calls++;}}),/AI_DOCUMENT_CHANGED/);
  assert.equal(calls,0);
});

test('AI invoice references are excluded from original-derived payment evidence',()=>{
  const extraction={fields:{invoice_number:{value:'AI-17',provenance:{kind:'openai_document_claim'}},reference:{value:'00000599',provenance:{kind:'openai_document_claim'}}},details:{reference:{formal_verified:false}}};
  const original=invoiceReferenceOriginal(extraction);
  assert.equal(original.invoice_number,undefined);assert.equal(original.reference,undefined);
});
