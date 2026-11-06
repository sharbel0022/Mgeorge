import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARM_IDS, assertManifest, makeProviderInput, scoreArm, unavailableArm,
  acceptance, canonicalJson,
} from '../scripts/openai-invoices-benchmark-metrics.mjs';

const digest = 'a'.repeat(64);
function record(overrides = {}) {
  return {
    id: 'one', family: 'synthetic', path: 'one.png', mimeType: 'image/png',
    pageCount: 1, sha256: digest, modality: 'optical',
    requireReview: false, gold: { fields: { invoice_number: 'INV-1', total_cents: 1000 } },
    ...overrides,
  };
}
function manifest(overrides = {}) {
  return {
    version: 1, id: 'dev-example',
    provenance: { classification: 'development', synthetic: true, optimized: false },
    records: [record()], ...overrides,
  };
}
function extraction(values, level = 'red') {
  return { level, fields: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])) };
}
const observation = (value, extras = {}) => ({
  recordId: 'one', extraction: value, durationMs: 12, apiCostUsd: 0, ...extras,
});

test('wrong returned fields count as both false positive and false negative', () => {
  const result = scoreArm('existing_ocr', [record()], [
    observation(extraction({ invoice_number: 'WRONG', total_cents: 1000 })),
  ]);
  assert.equal(result.metrics.fieldPrecision, 0.5);
  assert.equal(result.metrics.fieldRecall, 0.5);
  assert.equal(result.metrics.completeCorrectDocuments, 0);
  assert.equal(result.metrics.manualReviewRate, 1);
});

test('missing fields reduce recall and precision has a null zero denominator', () => {
  const result = scoreArm('existing_ocr', [record()], [observation(extraction({}))]);
  assert.equal(result.metrics.fieldPrecision, null);
  assert.equal(result.metrics.fieldRecall, 0);
  assert.equal(result.metrics.completeCorrectDocuments, 0);
});

test('unavailable arms never produce zero cost, zero false approvals or accuracy', () => {
  const result = unavailableArm('openai_low', 'MISSING_API_KEY');
  assert.equal(result.status, 'unavailable');
  assert.equal(result.metrics, null);
  assert.equal(result.observations.length, 0);
  assert.equal(result.reason, 'MISSING_API_KEY');
});

test('false approvals include incorrect green and required-review green', () => {
  const wrong = scoreArm('existing_ocr', [record()], [
    observation(extraction({ invoice_number: 'WRONG', total_cents: 1000 }, 'green')),
  ]);
  assert.equal(wrong.metrics.falseApprovals, 1);
  assert.equal(wrong.metrics.falseApprovalAmongApproved, 1);
  const unsafe = scoreArm('existing_ocr', [record({ requireReview: true })], [
    observation(extraction({ invoice_number: 'INV-1', total_cents: 1000 }, 'green')),
  ]);
  assert.equal(unsafe.metrics.completeCorrectDocuments, 1);
  assert.equal(unsafe.metrics.falseApprovals, 1);
});

test('processing errors are scored as missing fields and manual review', () => {
  const result = scoreArm('existing_ocr', [record()], [
    observation(null, { errorCode: 'EXTRACTION_FAILED', apiCostUsd: null }),
  ]);
  assert.equal(result.status, 'failed');
  assert.equal(result.metrics.fieldRecall, 0);
  assert.equal(result.metrics.errorDocuments, 1);
  assert.equal(result.metrics.apiCostUsd, null);
  assert.equal(result.metrics.manualReviewRate, 1);
});

test('arm results require every record exactly once; unknown and duplicate records fail', () => {
  assert.throws(() => scoreArm('existing_ocr', [record()], []), /OBSERVATION_COVERAGE/);
  assert.throws(() => scoreArm('existing_ocr', [record()], [
    observation(extraction({}), { recordId: 'other' }),
  ]), /OBSERVATION_COVERAGE/);
});

test('manifest rejects empty truth, duplicate content and invalid holdout provenance', () => {
  assertManifest(manifest());
  assert.throws(() => assertManifest(manifest({ records: [record({ gold: { fields: {} } })] })), /GOLD_FIELDS/);
  assert.throws(() => assertManifest(manifest({ records: [record(), record({ id: 'two', path: 'two.png' })] })), /DUPLICATE_CONTENT/);
  assert.throws(() => assertManifest(manifest({
    provenance: { classification: 'independent_holdout', synthetic: true, optimized: true },
  })), /HOLDOUT_PROVENANCE/);
});

test('ground truth and descriptive filenames never enter provider input', () => {
  const secret = record({
    path: 'truth-INV-1-1000.png',
    family: 'supplier-secret',
    gold: { fields: { invoice_number: 'TOP-SECRET', total_cents: 987654321 } },
  });
  const input = makeProviderInput(secret, new Uint8Array([1, 2, 3]));
  assert.deepEqual(Object.keys(input).sort(), ['bytes', 'mime', 'pageCount', 'sha256']);
  const serialized = JSON.stringify(input);
  for (const value of ['TOP-SECRET', '987654321', 'supplier-secret', 'truth-INV']) {
    assert.equal(serialized.includes(value), false);
  }
});

test('development results can never satisfy independent acceptance', () => {
  const measured = scoreArm('existing_ocr', [record()], [
    observation(extraction({ invoice_number: 'INV-1', total_cents: 1000 }, 'green')),
  ]);
  const result = acceptance(manifest(), {
    freezeVerified: true, sourceVerified: true,
    arms: [measured, ...ARM_IDS.slice(1).map(id => unavailableArm(id, 'MISSING_API_KEY'))],
  });
  assert.equal(result.eligible, false);
  assert.equal(result.passed, false);
  assert.equal(result.reason, 'NOT_INDEPENDENT_OPTICAL');
});

test('latency percentile and missing cost coverage are reported explicitly', () => {
  const result = scoreArm('openai_low', [record()], [
    observation(extraction({ invoice_number: 'INV-1', total_cents: 1000 }), { durationMs: 25, apiCostUsd: null }),
  ]);
  assert.equal(result.metrics.latencyMs.p95, 25);
  assert.equal(result.metrics.apiCostUsd, null);
  assert.equal(result.metrics.costKnownDocuments, 0);
  assert.equal(result.metrics.completeCorrectDocumentRate, 1);
});

test('canonical manifests are independent of object key insertion order', () => {
  assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), canonicalJson({ a: { c: 3, d: 4 }, b: 2 }));
});

test('live execution requires an absolute persistent ledger path', async () => {
  const { liveBlockReason } = await import('../scripts/openai-invoices-benchmark.mjs');
  const args = { manifest: manifest(), live: true, apiKey: 'test-key' };
  assert.equal(liveBlockReason(args), 'BENCHMARK_LEDGER_REQUIRED');
  assert.equal(liveBlockReason({ ...args, ledgerPath: 'relative.sqlite' }), 'BENCHMARK_LEDGER_REQUIRED');
  assert.equal(liveBlockReason({ ...args, ledgerPath: '/tmp/benchmark.sqlite' }), null);
});

test('durable benchmark reservations survive restart and preserve the full cap', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { openBenchmarkLedger } = await import('../scripts/openai-invoices-benchmark-ledger.mjs');
  const directory = await mkdtemp(path.join(tmpdir(), 'invoice-benchmark-ledger-'));
  const filename = path.join(directory, 'ledger.sqlite');
  const make = () => openBenchmarkLedger(filename, { owner: 'benchmark-test' });
  const request = {
    key: '1'.repeat(64), documentId: 'test-document', sha256: digest,
    profileVersion: 'benchmark-v1', reservedMicroUsd: 80, dailyBudgetMicroUsd: 100,
  };
  let ledger;
  try {
    ledger = await make();
    assert.equal((await ledger.store.reserve(request)).status, 'reserved');
    await ledger.store.record(request.key, { status: 'fallback', costMicroUsd: 1 });
    ledger.close(); ledger = await make();
    assert.equal((await ledger.store.reserve({ ...request, key: '2'.repeat(64) })).status, 'budget_exhausted');
    assert.equal((await ledger.store.reserve(request)).status, 'existing');
  } finally { ledger?.close(); await rm(directory, { recursive: true, force: true }); }
});

test('benchmark ledger refuses foreign database and non-database files without modifying them', async () => {
  const { mkdtemp, readFile, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { DatabaseSync } = await import('node:sqlite');
  const { openBenchmarkLedger } = await import('../scripts/openai-invoices-benchmark-ledger.mjs');
  const directory = await mkdtemp(path.join(tmpdir(), 'invoice-benchmark-foreign-'));
  try {
    const database = path.join(directory, 'application.sqlite');
    const db = new DatabaseSync(database);
    db.exec('CREATE TABLE customer_data (id TEXT); INSERT INTO customer_data VALUES (\'retain\')');
    db.close();
    const before = await readFile(database);
    await assert.rejects(openBenchmarkLedger(database, { owner: 'benchmark-test' }), /BENCHMARK_LEDGER_FOREIGN_DATABASE/);
    assert.deepEqual(await readFile(database), before);
    const textFile = path.join(directory, 'notes.txt');
    await writeFile(textFile, 'retain these notes');
    await assert.rejects(openBenchmarkLedger(textFile, { owner: 'benchmark-test' }), /BENCHMARK_LEDGER_FOREIGN_DATABASE/);
    assert.equal(await readFile(textFile, 'utf8'), 'retain these notes');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
