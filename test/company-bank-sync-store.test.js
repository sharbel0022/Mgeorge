import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const moduleUrl = new URL('../sites/lib/company-bank-sync-store.js', import.meta.url);
const implementation = existsSync(moduleUrl) ? await import(moduleUrl) : null;
const migration = new URL('../sites/drizzle/0023_saas_bank_sync.sql', import.meta.url);
const START = Date.parse('2026-11-04T12:00:00Z');

function databaseAdapter(sql) {
  return {
    prepare(query) {
      return {
        query, args: [],
        bind(...args) { this.args = args; return this; },
        async first() { return sql.prepare(query).get(...this.args) || null; },
        async all() { return { results: sql.prepare(query).all(...this.args) }; },
        async run() { return this.execute(); },
        execute() { return { success: true, meta: { changes: Number(sql.prepare(query).run(...this.args).changes) } }; },
      };
    },
    async batch(statements) {
      sql.exec('BEGIN IMMEDIATE');
      try { const result = statements.map(s => s.execute()); sql.exec('COMMIT'); return result; }
      catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  };
}

function fixture(t, { filename = ':memory:', initialize = true } = {}) {
  assert.ok(implementation?.createCompanyBankSyncStore, 'company sync requires a persistent company/account coordinator');
  const sql = new DatabaseSync(filename);
  sql.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  if (initialize) {
    sql.exec(readFileSync(migration, 'utf8'));
    sql.exec('CREATE TABLE synthetic_imports(company_id TEXT, account_key TEXT, id TEXT, raw TEXT, PRIMARY KEY(company_id, account_key, id))');
  }
  let time = START;
  const database = databaseAdapter(sql);
  const store = implementation.createCompanyBankSyncStore(database, { now: () => time, leaseMs: 1000, maxRunMs: 5000 });
  t.after(() => { try { sql.close(); } catch {} });
  return { sql, database, store, setTime(value) { time = value; } };
}

function context(suffix = 'A', overrides = {}) {
  return {
    companyId: `company-${suffix}`, owner: `scope-${suffix}`, connectionId: `connection-${suffix}`,
    provider: 'synthetic-bank', accountKey: `stable-account-${suffix}`, accountUid: `uid-${suffix}`,
    consentId: `consent-${suffix}`, generation: 'generation-1', revision: 1,
    validUntil: '2026-11-05T12:00:00.000Z', authorizationStatus: 'VERIFIED',
    ratePolicy: { verified: true, evidenceId: `quota-proof-${suffix}`, maxRequests: 3, windowMs: 60000 },
    bankgiroEnabled: false,
    ...overrides,
  };
}
async function configured(f, value = context()) {
  await f.store.bindScope({ companyId: value.companyId, owner: value.owner, evidenceId: 'synthetic-scope-proof' });
  await f.store.register(value);
  return value;
}
const isCode = code => error => error?.code === code;

test('100 synthetic companies retain separate jobs, accounts, request quotas and receipts', async t => {
  const f = fixture(t);
  const contexts = await Promise.all(Array.from({ length: 100 }, (_, i) => configured(f, context(String(i)))));
  await Promise.all(contexts.map(async value => {
    const lease = await f.store.claim(value);
    await lease.reserveRequest();
    const statement = f.database.prepare('INSERT INTO synthetic_imports VALUES(?,?,?,?)').bind(value.companyId, value.accountKey, 'same-bank-id', 'original bytes');
    await lease.commit({ key: 'same-page', sha256: 'a'.repeat(64), statements: [statement], result: { imported: 1 } });
    await lease.finish({ status: 'success', coverage: { ais: 'complete', bankgiro: 'unavailable', paymentDataComplete: false } });
  }));
  assert.equal(f.sql.prepare('SELECT count(*) n FROM synthetic_imports').get().n, 100);
  for (const value of contexts) {
    const status = await f.store.status(value);
    assert.equal(status.companyId, value.companyId);
    assert.equal(status.accountKey, value.accountKey);
    assert.equal(status.status, 'success');
    assert.equal(status.coverage.paymentDataComplete, false);
  }
});

test('one storage scope cannot be attached to two companies and status cannot cross owners', async t => {
  const f = fixture(t), value = await configured(f);
  await assert.rejects(f.store.bindScope({ companyId: 'company-B', owner: value.owner, evidenceId: 'different-proof' }), isCode('COMPANY_SCOPE_MISMATCH'));
  await assert.rejects(f.store.claim({ ...value, owner: 'scope-B' }), isCode('COMPANY_SCOPE_MISMATCH'));
  await assert.rejects(f.store.status({ ...value, companyId: 'company-B' }), isCode('COMPANY_SCOPE_MISMATCH'));
});

test('unregistered company and unverified background policy block before any request', async t => {
  const f = fixture(t);
  await assert.rejects(f.store.register(context()), isCode('COMPANY_SCOPE_MISMATCH'));
  await f.store.bindScope({ companyId: 'company-A', owner: 'scope-A', evidenceId: 'synthetic-proof' });
  await assert.rejects(f.store.register(context('A', { ratePolicy: null })), isCode('BACKGROUND_POLICY_UNVERIFIED'));
  await assert.rejects(f.store.register(context('A', { ratePolicy: { verified: false, maxRequests: 5, windowMs: 60000 } })), isCode('BACKGROUND_POLICY_UNVERIFIED'));
});

test('concurrent jobs for the same account admit exactly one writer', async t => {
  const f = fixture(t), value = await configured(f);
  const results = await Promise.allSettled(Array.from({ length: 30 }, () => f.store.claim(value)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.code === 'ACCOUNT_BUSY'));
});

test('expired lease cannot commit after another process claims the account', async t => {
  const f = fixture(t), value = await configured(f), first = await f.store.claim(value);
  f.setTime(START + 1001);
  const second = await f.store.claim(value);
  const write = f.database.prepare('INSERT INTO synthetic_imports VALUES(?,?,?,?)').bind(value.companyId, value.accountKey, 'late', 'late response');
  await assert.rejects(first.commit({ key: 'late', sha256: 'a'.repeat(64), statements: [write], result: {} }), isCode('LEASE_LOST'));
  await second.finish({ status: 'retry', code: 'PROVIDER_TIMEOUT', nextAttemptAt: START + 60000 });
  assert.equal(f.sql.prepare('SELECT count(*) n FROM synthetic_imports').get().n, 0);
});

test('renewed consent retains quota and fences an in-flight old generation', async t => {
  const f = fixture(t), value = await configured(f), lease = await f.store.claim(value);
  await lease.reserveRequest(); await lease.reserveRequest(); await lease.reserveRequest();
  const renewed = context('A', { consentId: 'consent-renewed', accountUid: 'uid-renewed', generation: 'generation-2', revision: 2 });
  await f.store.register(renewed);
  await assert.rejects(lease.assert(), isCode('AUTHORIZATION_CHANGED'));
  await lease.release();
  const fresh = await f.store.claim(renewed);
  await assert.rejects(fresh.reserveRequest(), isCode('PROVIDER_BUDGET_EXHAUSTED'));
  await assert.rejects(f.store.register(value), isCode('AUTHORIZATION_CHANGED'));
});

test('revoked permission prevents a late import and cannot be revived by unchanged registration', async t => {
  const f = fixture(t), value = await configured(f), lease = await f.store.claim(value);
  await f.store.revoke(value);
  await assert.rejects(lease.commit({ key: 'revoked', sha256: 'a'.repeat(64), statements: [], result: {} }), isCode('AUTHORIZATION_CHANGED'));
  await assert.rejects(f.store.register(value), isCode('AUTHORIZATION_CHANGED'));
  assert.equal((await f.store.status(value)).status, 'blocked');
});

test('provider retry embargo survives restart and renewal', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'saas-sync-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = join(dir, 'synthetic.sqlite'), f = fixture(t, { filename });
  const value = await configured(f), lease = await f.store.claim(value);
  await lease.reserveRequest();
  await lease.finish({ status: 'retry', code: 'PROVIDER_429', nextAttemptAt: START + 120000 });
  const other = fixture(t, { filename, initialize: false });
  const renewed = context('A', { revision: 2, generation: 'generation-2', consentId: 'consent-2' });
  await other.store.register(renewed);
  await assert.rejects(other.store.claim(renewed), isCode('RETRY_NOT_DUE'));
  assert.equal((await other.store.status(renewed)).nextAttemptAt, START + 120000);
});

test('an interrupted import rolls back originals and receipt, then retry commits exactly once', async t => {
  const f = fixture(t), value = await configured(f), lease = await f.store.claim(value);
  const writes = () => [f.database.prepare('INSERT INTO synthetic_imports VALUES(?,?,?,?)').bind(value.companyId, value.accountKey, 'transaction-1', '{"unmodified":"original"}')];
  await assert.rejects(lease.commit({ key: 'page-1', sha256: 'b'.repeat(64), statements: [...writes(), f.database.prepare("SELECT json('simulated interruption')")], result: { imported: 1 } }));
  assert.equal(f.sql.prepare('SELECT count(*) n FROM synthetic_imports').get().n, 0);
  const result = await lease.commit({ key: 'page-1', sha256: 'b'.repeat(64), statements: writes(), result: { imported: 1 }, checkpoint: { next: 'page-2' } });
  assert.equal(result.duplicate, false);
  await lease.release();
  const retry = await f.store.claim(value);
  const duplicate = await retry.commit({ key: 'page-1', sha256: 'b'.repeat(64), statements: writes(), result: { imported: 900 } });
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.result, { imported: 1 });
  assert.equal(f.sql.prepare('SELECT count(*) n FROM synthetic_imports').get().n, 1);
  assert.deepEqual((await f.store.status(value)).checkpoint, { next: 'page-2' });
});

test('conflicting original under the same import identity never overwrites accepted bytes', async t => {
  const f = fixture(t), value = await configured(f), lease = await f.store.claim(value);
  await lease.commit({ key: 'page-1', sha256: 'a'.repeat(64), statements: [], result: { imported: 1 } });
  await assert.rejects(lease.commit({ key: 'page-1', sha256: 'b'.repeat(64), statements: [], result: {} }), isCode('IMPORT_IDENTITY_CONFLICT'));
});

test('failure after success preserves previous success and cannot claim complete Bankgiro data', async t => {
  const f = fixture(t), value = await configured(f), first = await f.store.claim(value);
  await first.finish({ status: 'success', coverage: { ais: 'complete', bankgiro: 'unavailable', paymentDataComplete: false } });
  f.setTime(START + 100);
  const second = await f.store.claim(value);
  await second.finish({ status: 'partial', code: 'BANKGIRO_UNAVAILABLE', coverage: { ais: 'complete', bankgiro: 'unknown', paymentDataComplete: false } });
  const status = await f.store.status(value);
  assert.equal(status.lastSuccessAt, START);
  assert.equal(status.lastAttemptAt, START + 100);
  assert.equal(status.status, 'partial');
  assert.equal(status.coverage.paymentDataComplete, false);
});

test('a terminal receipt closes the writer before a delayed status response returns', async t => {
  const f = fixture(t), value = await configured(f), lease = await f.store.claim(value);
  const batch = f.database.batch.bind(f.database);
  let done, release;
  const reached = new Promise(resolve => { done = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  f.database.batch = async statements => {
    const result = await batch(statements);
    if (statements.some(s => s.query.includes('last_success_at=CASE'))) { done(); await held; }
    return result;
  };
  const finished = lease.finish({ status: 'success' });
  await reached;
  try {
    await assert.rejects(lease.commit({ key: 'too-late', sha256: 'c'.repeat(64), statements: [], result: {} }), isCode('LEASE_LOST'));
  } finally { release(); await finished; }
});

test('reference policy is explicitly company bound and revisions cannot move backwards', async t => {
  const f = fixture(t), value = await configured(f);
  assert.equal(await f.store.referencePolicy(value), null);
  await f.store.setReferencePolicy({ ...value, companyName: 'Synthetic A AB', mode: 'ocr', evidenceId: 'synthetic-policy-proof', revision: 2 });
  const policy = await f.store.referencePolicy(value);
  assert.equal(policy.companyId, value.companyId);
  assert.equal(policy.owner, value.owner);
  assert.equal(policy.mode, 'ocr');
  await assert.rejects(f.store.setReferencePolicy({ ...value, companyName: 'Synthetic A AB', mode: 'invoice_number', evidenceId: 'old-proof', revision: 1 }), isCode('REFERENCE_POLICY_CHANGED'));
});

test('one connection background budget is shared by its separately locked accounts', async t => {
  const f = fixture(t);
  const policy = { verified: true, evidenceId: 'synthetic-connection-quota', maxRequests: 2, windowMs: 60000, scope: 'connection' };
  const firstContext = await configured(f, context('A', { ratePolicy: policy }));
  const secondContext = { ...firstContext, accountKey: 'second-stable-account', accountUid: 'second-provider-account' };
  await f.store.register(secondContext);
  const first = await f.store.claim(firstContext), second = await f.store.claim(secondContext);
  await first.reserveRequest();
  await second.reserveRequest();
  await assert.rejects(second.reserveRequest(), isCode('PROVIDER_BUDGET_EXHAUSTED'));
});

test('blocked configuration failures do not automatically repeat until an authority revision changes', async t => {
  const f = fixture(t), value = await configured(f), lease = await f.store.claim(value);
  await lease.finish({ status: 'blocked', code: 'IMPORT_RECEIPT_MISSING' });
  await assert.rejects(f.store.claim(value), isCode('JOB_BLOCKED'));
  const corrected = { ...value, revision: 2 };
  await f.store.register(corrected);
  await (await f.store.claim(corrected)).release();
});
