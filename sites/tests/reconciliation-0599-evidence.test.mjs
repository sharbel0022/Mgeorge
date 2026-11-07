import test from 'node:test';
import assert from 'node:assert/strict';
import {balance, economicTransactions} from '../lib/domain.ts';
import {ingestFixture, reportBytes, hash} from './helpers/bankgiro-ingest-fixture.mjs';

// Synthetic retained files, current source receipt and account consent; real
// parser, original reader, reconciliation and SQLite behind the existing fixture.
async function fixture(t) {
  const f = await ingestFixture(t);
  const invoiceBytes = new TextEncoder().encode('Synthetic invoice 0599, 625.00 SEK. No customer data.');
  const documentId = 'synthetic-0599-invoice-original';
  f.objects.set(f.owner + '/' + documentId, invoiceBytes);
  f.sql.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(documentId, f.owner, 'Synthetic-invoice.pdf', 'application/pdf', invoiceBytes.length, hash(invoiceBytes), '2026-10-26');
  const initial = f.read().state;
  initial.invoices[0].documentId = documentId;
  f.write(initial);
  const bytes = reportBytes(), input = await f.prepare(bytes), imported = await f.sink.importReport(input);
  assert.equal(imported.status, 'IMPORTED');
  const binding = 'e'.repeat(64);
  f.sql.prepare("UPDATE bankgiro_ingest_jobs SET status='IMPORTED',import_id=?,payment_count=1,registration_binding=? WHERE id=?")
    .run(imported.importId, binding, input.job.id);
  f.sql.prepare('UPDATE bankgiro_ingest_sources SET registration_revision=1,registration_binding=?,authorization_verified_at=?,authorization_valid_until=? WHERE owner=? AND source_id=?')
    .run(binding, Date.now() - 1000, Date.parse('2099-01-01T00:00:00Z'), f.owner, input.job.sourceId);
  const evidence = await import(f.moduleUrls.evidence);
  const child = f.read().state.transactions.find(row => row.specification);
  return Object.assign(f, {input, evidence, bytes, childId: child.id, reportKey: f.owner + '/' + input.documentId});
}

async function exactPreview(f, state) {
  const preview = await f.evidence.reconciliationPreviewWithOriginals(f.owner, state);
  assert.equal(preview.automatic_candidates, 1);
  assert.deepEqual(preview.findings.filter(row => row.safe).map(row => ({
    invoiceId: row.invoice_id, transactionId: row.transaction_id, amount: row.amount_cents,
  })), [{invoiceId: state.invoices[0].id, transactionId: f.childId, amount: 62500}]);
}

async function held(f, state) {
  const preview = await f.evidence.reconciliationPreviewWithOriginals(f.owner, state);
  assert.equal(preview.automatic_candidates, 0);
  assert.ok(preview.findings.some(row => row.transaction_id === f.childId && !row.safe));
  const result = await f.evidence.reconcileWithOriginals(f.owner, state);
  assert.deepEqual(result.state.allocations, []);
  assert.equal(balance(result.state, result.state.invoices[0]), 62500);
  return result;
}

for (const mode of ['missing', 'altered']) {
  test('0599 / 625 SEK: a ' + mode + ' bank original blocks saved verified flags until the exact bytes return', async t => {
    const f = await fixture(t), before = f.read(), auditBefore = f.audits(), inputBefore = structuredClone(before.state);
    const child = before.state.transactions.find(row => row.id === f.childId);
    assert.equal(child.verified, true);
    assert.equal(child.payerReference, '0599');
    assert.equal(child.party, 'Synthetic customer AB');
    assert.equal(child.parentId, before.state.transactions.find(row => !row.specification).id);
    await exactPreview(f, before.state);

    if (mode === 'missing') f.objects.delete(f.reportKey);
    else {
      const changed = Uint8Array.from(f.bytes);
      changed[0] ^= 1;
      f.objects.set(f.reportKey, changed);
    }
    await held(f, before.state);
    assert.deepEqual(before.state, inputBefore);
    assert.deepEqual(f.read(), before);
    assert.deepEqual(f.audits(), auditBefore);

    f.objects.set(f.reportKey, Uint8Array.from(f.bytes));
    await exactPreview(f, before.state);
    const result = await f.evidence.reconcileWithOriginals(f.owner, before.state);
    assert.deepEqual(result.state.allocations.map(row => ({
      invoiceId: row.invoiceId, transactionId: row.transactionId, amount: row.amount, effect: row.effect, active: row.active,
    })), [{invoiceId: before.state.invoices[0].id, transactionId: f.childId, amount: 62500, effect: 'payment', active: true}]);
    assert.equal(balance(result.state, result.state.invoices[0]), 0);
    assert.deepEqual(economicTransactions(result.state).map(row => row.id), [f.childId]);
    assert.equal(economicTransactions(result.state).reduce((sum, row) => sum + row.amount, 0), 62500);
    const repeated = await f.evidence.reconcileWithOriginals(f.owner, result.state);
    assert.deepEqual(repeated.state.allocations, result.state.allocations);
    assert.deepEqual(before.state, inputBefore);
    assert.deepEqual(f.read(), before);
    assert.deepEqual(f.audits(), auditBefore);
  });
}

for (const [label, change] of [
  ['registered source authorization', f => f.sql.prepare('UPDATE bankgiro_ingest_sources SET authorization_valid_until=? WHERE owner=?').run(Date.parse('2000-01-01T00:00:00Z'), f.owner)],
  ['receiving account consent', f => f.sql.prepare("UPDATE bank_connections SET valid_until='2000-01-01T00:00:00Z' WHERE owner=?").run(f.owner)],
]) {
  test('0599 / 625 SEK: expired ' + label + ' invalidates an earlier exact preview without changing money', async t => {
    const f = await fixture(t), before = f.read(), auditBefore = f.audits(), inputBefore = structuredClone(before.state);
    await exactPreview(f, before.state);
    change(f);
    await held(f, before.state);
    assert.deepEqual(f.objects.get(f.reportKey), f.bytes);
    assert.deepEqual(before.state, inputBefore);
    assert.deepEqual(f.read(), before);
    assert.deepEqual(f.audits(), auditBefore);
  });
}

// Registration and time evidence must still be identical in the financial batch.
for (const [label, change] of [
  ['source authorization expiry', f => f.sql.prepare('UPDATE bankgiro_ingest_sources SET authorization_valid_until=? WHERE owner=?').run(Date.parse('2000-01-01T00:00:00Z'), f.owner)],
  ['source registration binding', f => f.sql.prepare("UPDATE bankgiro_ingest_sources SET registration_binding=? WHERE owner=?").run('f'.repeat(64), f.owner)],
  ['report receipt registration binding', f => f.sql.prepare("UPDATE bankgiro_ingest_jobs SET registration_binding=? WHERE id=?").run('f'.repeat(64), f.input.job.id)],
  ['source registration revision', f => f.sql.prepare('UPDATE bankgiro_ingest_sources SET registration_revision=0 WHERE owner=?').run(f.owner)],
  ['source authorization verification time', f => f.sql.prepare('UPDATE bankgiro_ingest_sources SET authorization_verified_at=? WHERE owner=?').run(Date.parse('2099-01-01T00:00:00Z'), f.owner)],
]) {
  test('0599 / 625 SEK: ' + label + ' changing inside the final batch rolls back allocation and audit', async t => {
    const f = await fixture(t), before = f.read(), auditBefore = f.audits(), inputBefore = structuredClone(before.state);
    const result = await f.evidence.reconcileWithOriginals(f.owner, before.state);
    assert.equal(result.state.allocations.length, 1);
    assert.equal(result.state.allocations[0].amount, 62500);
    assert.equal(result.state.allocations[0].transactionId, f.childId);
    let changed = false;
    f.beforeBatch = () => {
      assert.equal(changed, false);
      changed = true;
      change(f);
    };
    const statements = [
      f.database.prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) VALUES(?,?,?,?,?,?)')
        .bind('synthetic-0599-auto-allocation', f.owner, before.revision + 1, 'automatic.reconciliation', '{}', '2026-10-26'),
      f.database.prepare('UPDATE workspaces SET payload=?,revision=revision+1 WHERE owner=? AND revision=?')
        .bind(JSON.stringify(result.state), f.owner, before.revision),
    ];
    await assert.rejects(
      f.evidence.writePaymentState(f.owner, before.revision, before.state, result.state, f.database, statements),
      {code: 'BANKGIRO_SOURCE_CHANGED'},
    );
    assert.equal(changed, true);
    assert.deepEqual(before.state, inputBefore);
    assert.deepEqual(f.read(), before);
    assert.deepEqual(f.audits(), auditBefore);
  });
}

for (const [label, elapsed, expires] of [
  ['one millisecond before expiry', 999, false],
  ['exactly at expiry', 1000, true],
]) {
  test('0599 / 625 SEK: database clock ' + label + ' decides the final batch without changing source rows', async t => {
    const f = await fixture(t);
    let clock = Date.parse('2030-01-01T00:00:00Z');
    t.mock.method(Date, 'now', () => clock);
    // Only time is controlled; SQL predicates, commit and rollback stay real.
    f.sql.function('unixepoch', {varargs: true}, (...args) => {
      assert.deepEqual(args, ['subsec']);
      return clock / 1000;
    });
    f.sql.prepare('UPDATE bankgiro_ingest_sources SET authorization_verified_at=?,authorization_valid_until=? WHERE owner=?')
      .run(clock - 1000, clock + 1000, f.owner);
    const sourceBefore = f.sql.prepare('SELECT * FROM bankgiro_ingest_sources WHERE owner=?').all(f.owner);
    const before = f.read(), auditBefore = f.audits(), inputBefore = structuredClone(before.state);
    const result = await f.evidence.reconcileWithOriginals(f.owner, before.state);
    assert.equal(result.state.allocations.length, 1);
    assert.equal(result.state.allocations[0].amount, 62500);
    let advanced = false;
    f.beforeBatch = () => {
      assert.equal(advanced, false);
      advanced = true;
      clock += elapsed;
    };
    const statements = [
      f.database.prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) VALUES(?,?,?,?,?,?)')
        .bind('synthetic-clock-allocation', f.owner, before.revision + 1, 'automatic.reconciliation', '{}', '2026-10-26'),
      f.database.prepare('UPDATE workspaces SET payload=?,revision=revision+1 WHERE owner=? AND revision=?')
        .bind(JSON.stringify(result.state), f.owner, before.revision),
    ];
    const write = f.evidence.writePaymentState(f.owner, before.revision, before.state, result.state, f.database, statements);
    if (expires) {
      await assert.rejects(write, {code: 'BANKGIRO_SOURCE_CHANGED'});
      assert.deepEqual(f.read(), before);
      assert.deepEqual(f.audits(), auditBefore);
    } else {
      await write;
      assert.equal(f.read().revision, before.revision + 1);
      assert.deepEqual(f.read().state.allocations, result.state.allocations);
      assert.equal(f.audits().length, auditBefore.length + 1);
    }
    assert.equal(advanced, true);
    assert.deepEqual(before.state, inputBefore);
    assert.deepEqual(f.sql.prepare('SELECT * FROM bankgiro_ingest_sources WHERE owner=?').all(f.owner), sourceBefore);
  });
}

test('0599 / 625 SEK: an already expired source permits only an explicit reviewed manual allocation with the same final snapshot', async t => {
  const f = await fixture(t), {applyCommand} = await import('../lib/domain.ts');
  f.sql.prepare('UPDATE bankgiro_ingest_sources SET authorization_valid_until=? WHERE owner=?')
    .run(Date.parse('2000-01-01T00:00:00Z'), f.owner);
  const before = f.read(), auditBefore = f.audits();
  const automatic = await f.evidence.reconcileWithOriginals(f.owner, before.state);
  assert.deepEqual(automatic.state.allocations, []);
  const manual = applyCommand(before.state, {
    type: 'match.create', invoiceId: before.state.invoices[0].id,
    transactionId: f.childId, amount: 25000,
    note: 'Synthetic explicit administrator review of the already expired report authorization.',
  }).state;
  const statements = [
    f.database.prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) VALUES(?,?,?,?,?,?)')
      .bind('synthetic-reviewed-source-allocation', f.owner, before.revision + 1, 'manual.reconciliation', '{}', '2026-10-26'),
    f.database.prepare('UPDATE workspaces SET payload=?,revision=revision+1 WHERE owner=? AND revision=?')
      .bind(JSON.stringify(manual), f.owner, before.revision),
  ];
  await assert.rejects(
    f.evidence.writePaymentState(f.owner, before.revision, before.state, manual, f.database, statements),
    {code: 'BANKGIRO_SOURCE_CHANGED'},
  );
  assert.deepEqual(f.read(), before);
  assert.deepEqual(f.audits(), auditBefore);
  const manualAllocationIds = new Set(manual.allocations.map(row => row.id));
  await f.evidence.writePaymentState(f.owner, before.revision, before.state, manual, f.database, statements, {manualAllocationIds});
  const saved = f.read();
  assert.equal(saved.revision, before.revision + 1);
  assert.deepEqual(saved.state.allocations, manual.allocations);
  assert.equal(balance(saved.state, saved.state.invoices[0]), 37500);
  assert.equal(f.audits().length, auditBefore.length + 1);
});
