import test from 'node:test';
import assert from 'node:assert/strict';
import {documentOcrFixture} from './helpers/document-ocr-fixture.mjs';
import {loadInvoiceParser} from './helpers/invoice-module-loader.mjs';
import {positionedInvoicePdf} from '../../test/helpers/pdf-layout-ocr.mjs';
import {enrichSitesInvoice} from '../lib/openai-invoices/sites.js';
const env=owner=>({OPENAI_INVOICES_ENABLED:'true',OPENAI_INVOICES_PRIVACY_APPROVED:'true',OPENAI_INVOICES_SECURITY_APPROVED:'true',OPENAI_INVOICES_COST_APPROVED:'true',OPENAI_INVOICES_APPROVAL_ID:'synthetic-sites-test',OPENAI_INVOICES_ALLOWED_OWNERS:JSON.stringify([owner]),OPENAI_INVOICES_COMPANY_ORGANIZATIONS:JSON.stringify({[owner]:'5560160680'}),OPENAI_INVOICES_PROFILE:'luna-v1',OPENAI_API_KEY:'synthetic-key-not-a-credential'});
async function processing(t){
  const f=await documentOcrFixture(t,positionedInvoicePdf());
  await f.api.enqueueDocuments(f.owner);
  f.sql.prepare("UPDATE document_jobs SET state='processing',lease='synthetic-lease',lease_until=? WHERE owner=? AND document_id=?").run(new Date(Date.now()+180000).toISOString(),f.owner,f.id);
  const job=f.sql.prepare('SELECT j.*,d.mime,d.size,d.sha256 FROM document_jobs j JOIN documents d ON d.owner=j.owner AND d.id=j.document_id WHERE j.owner=? AND j.document_id=?').get(f.owner,f.id);
  const {interpretInvoice}=await loadInvoiceParser();
  return {...f,job,baseline:interpretInvoice('',{direction:'supplier'})};
}
test('Sites production processing blocks an incomplete approval before any AI request',async t=>{
  const f=await documentOcrFixture(t,positionedInvoicePdf());
  Object.assign(f.env,env(f.owner),{OPENAI_INVOICES_PRIVACY_APPROVED:'false'});
  const result=await f.api.processDocuments(f.owner,1);
  assert.equal(result.processed,1);
  const extraction=JSON.parse(f.sql.prepare('SELECT extraction FROM document_jobs WHERE owner=? AND document_id=?').get(f.owner,f.id).extraction);
  assert.equal(extraction.ai.status,'blocked');assert.equal(extraction.ai.code,'APPROVAL_REQUIRED');
  assert.equal(f.invoices().length,0);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='invoice.ai.reserved'").get().n,0);
});
test('Sites integration validates the original, persists reservation and reuses the receipt',async t=>{
  const f=await processing(t);let calls=0;
  const input={database:f.db,owner:f.owner,job:f.job,baseline:f.baseline,environment:env(f.owner),loadBytes:async()=>new Uint8Array(f.bytes),adapter:async args=>{calls++;assert.equal(args.pageCount,1);assert.equal(args.inputValidated,true);return {status:'fallback',code:'SYNTHETIC_UNAVAILABLE'};}};
  await enrichSitesInvoice(input);const again=await enrichSitesInvoice(input);
  assert.equal(calls,1);assert.equal(again.ai.replayed,true);assert.equal(f.invoices().length,0);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='invoice.ai.reserved' AND owner=?").get(f.owner).n,1);
  assert.deepEqual(f.bytes,positionedInvoicePdf());
});
test('Sites integration cannot use an expired lease, another owner or replaced original',async t=>{
  const f=await processing(t);let calls=0;
  const input={database:f.db,owner:f.owner,job:f.job,baseline:f.baseline,environment:env(f.owner),loadBytes:async()=>new Uint8Array(f.bytes),adapter:async()=>{calls++;}};
  const bad=await enrichSitesInvoice({...input,loadBytes:async()=>new Uint8Array([1,2,3])});
  assert.equal(bad.ai.code,'ORIGINAL_PREFLIGHT_FAILED');
  await assert.rejects(()=>enrichSitesInvoice({...input,owner:'other-owner',environment:env('other-owner')}),/AI_DOCUMENT_CHANGED/);
  f.sql.prepare("UPDATE document_jobs SET lease_until='2000-01-01T00:00:00.000Z' WHERE owner=?").run(f.owner);
  await assert.rejects(()=>enrichSitesInvoice(input),/AI_DOCUMENT_CHANGED/);assert.equal(calls,0);
});
test('Sites automatic registration rejects a forged green AI extraction at the write boundary',async t=>{
  const f=await processing(t),extraction={...f.baseline,level:'green',ai:{requiresHumanReview:true}};
  f.sql.prepare('UPDATE document_jobs SET extraction=? WHERE owner=? AND document_id=?').run(JSON.stringify(extraction),f.owner,f.id);
  await assert.rejects(()=>f.api.registerProcessedInvoice(f.owner,f.id,{direction:'payable',party:'Synthetic AB',number:'SYN-1',total:12500,issued:'2026-11-01',due:'2026-12-01'}, {currency:'SEK',organization_number:'5560160680',vat_cents:2500,net_cents:10000},{automatic:true,lease:f.job.lease,sha256:f.sha}),/AI-förslaget kräver granskning/);
  assert.equal(f.invoices().length,0);
});
