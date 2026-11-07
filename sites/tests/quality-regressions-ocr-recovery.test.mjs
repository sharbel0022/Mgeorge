import test from 'node:test';
import assert from 'node:assert/strict';
import { documentOcrFixture } from './helpers/document-ocr-fixture.mjs';
import { runSitesOcr } from '../../src/sites-ocr-pull.js';

for (const protocol of ['legacy', 'receipt-v2']) test(`OCR ${protocol} recovery after a lost committed completion keeps exactly one SQLite extraction and unchanged original`, async t => {
  // Explicit extractor fixture: this tests durable protocol recovery, not optical accuracy.
  const bytes = Buffer.from('synthetic document bytes for lost OCR acknowledgment');
  const f = await documentOcrFixture(t, bytes);
  const token = 'C'.repeat(43);
  Object.assign(f.env, { DOCUMENT_CLOUD_OCR_ENABLED: 'true', DOCUMENT_CLOUD_WORKER_TOKEN: token });
  f.sql.prepare('UPDATE document_automation SET auto_register = 0').run();
  f.sql.prepare("UPDATE documents SET filename = 'synthetic-scan.png', mime = 'image/png' WHERE id = ?").run(f.id);
  f.env.BUCKET.get = async path => path === `${f.owner}/${f.id}` ? {
    size: f.bytes.length, body: f.bytes, arrayBuffer: async () => Uint8Array.from(f.bytes).buffer,
  } : null;
  const text = 'Faktura\nFakturanummer: 0007\nLeverantör: Testbolaget AB\nOrg.nr: 556016-0680\nFakturadatum: 24/10/2026\nFörfallodag: 07/11/2026\nBelopp före moms: 2 500,00 SEK\nTotal moms: 625,00 SEK\nSumma att betala: 3 125,00 SEK\nBankgiro: 123-4567';
  let loseResponse = true;
  let extractCalls = 0;
  let completionBody;
  const calls = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://site.example');
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    assert.equal(init.headers['X-MG-OCR-Runner'], 'cloud');
    assert.equal(init.redirect, 'manual');
    const action = url.pathname.split('/').pop();
    calls.push(action);
    const response = await f.api.workerAction(new Request(input, init), action);
    if (action === 'lease' && protocol === 'legacy') {
      const body = await response.json();
      if (body.job) { delete body.job.protocol; delete body.job.run_id; delete body.job.lease_until; }
      return Response.json(body, {status: response.status});
    }
    if (action === 'complete' && loseResponse) {
      completionBody = JSON.parse(init.body);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).state, 'needs_review');
      loseResponse = false;
      // The durable write succeeded; only its response is unavailable to this client.
      return Response.json({ error: 'synthetic lost acknowledgment' }, { status: 503 });
    }
    return response;
  };
  const run = () => runSitesOcr({ origin: 'https://site.example', token, mode: 'cloud' }, {
    fetchImpl,
    extract: async (received, mime) => {
      extractCalls++;
      assert.deepEqual(received, bytes);
      assert.equal(mime, 'image/png');
      return { text, method: 'ocr', confidence: 90 };
    },
  });
  if (protocol === 'legacy') {
    await assert.rejects(run(), /site_unavailable/, 'an unacknowledged legacy completion cannot be counted as a client success');
    assert.equal(calls.filter(action => action === 'receipt').length, 0);
  } else {
    assert.deepEqual(await run(), {processed: 1, failed: 0}, 'a matching durable receipt resolves the lost acknowledgement');
    assert.equal(calls.filter(action => action === 'receipt').length, 1);
  }
  assert.equal(calls.filter(action => action === 'complete').length, 1, 'an accepted result is never resubmitted');
  const history = f.sql.prepare('SELECT * FROM document_extractions ORDER BY id').all();
  assert.equal(history.length, 1);
  const extraction = JSON.parse(history[0].result);
  assert.equal(extraction.fields.invoice_number.value, '0007');
  assert.equal(extraction.fields.total_cents.value, 312500);
  assert.equal(extraction.processing.sha256, f.sha);
  assert.equal(extraction.processing.runner, 'cloud');
  const job = f.sql.prepare('SELECT state, attempts, lease, extraction, automatic FROM document_jobs').get();
  assert.equal(job.state, 'needs_review');
  assert.equal(job.lease, '');
  assert.equal(job.automatic, 0);

  calls.length = 0;
  assert.deepEqual(await run(), { processed: 0, failed: 0 });
  assert.deepEqual(calls, ['process', 'lease']);
  assert.equal(extractCalls, 1, 'a fresh client must not OCR an already committed document again');
  const replay = await f.api.workerAction(new Request('https://site.example/api/ocr-worker/complete', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-MG-OCR-Runner': 'cloud', 'Content-Type': 'application/json' },
    body: JSON.stringify(completionBody),
  }), 'complete');
  assert.equal(replay.status, 409);
  assert.deepEqual(f.sql.prepare('SELECT * FROM document_extractions ORDER BY id').all(), history);
  assert.deepEqual(f.sql.prepare('SELECT state, attempts, lease, extraction, automatic FROM document_jobs').get(), job);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n, 0);
  assert.equal(f.invoices().length, 0);
  assert.deepEqual(f.bytes, bytes);
  assert.equal(f.sql.prepare('SELECT sha256 FROM documents WHERE id = ?').get(f.id).sha256, f.sha);
});
