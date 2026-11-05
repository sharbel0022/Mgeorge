import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { syncFixture, syntheticContext, selector, deferred, START } from './helpers/company-sync-fixture.mjs';

const moduleUrl = new URL('../sites/lib/company-bank-sync.js', import.meta.url);
const implementation = existsSync(moduleUrl) ? await import(moduleUrl) : null;
function runner(f, options = {}) {
  assert.ok(implementation?.createCompanyBankSyncRunner, 'company sync needs a bounded provider runner connected to durable jobs');
  return implementation.createCompanyBankSyncRunner({ ...f, ...options });
}

test('100-company scheduler batch runs bounded concurrent real imports with separate receipts', async t => {
  const f = syncFixture(t), values = await Promise.all(Array.from({ length: 100 }, (_, i) => f.add(syntheticContext(String(i)))));
  let active = 0, maximum = 0;
  const r = runner(f, { async sync(input) { active++; maximum = Math.max(maximum, active); try { await new Promise(resolve => setImmediate(resolve)); return await f.sync(input); } finally { active--; } } });
  const result = await implementation.runCompanyBankSyncBatch({ jobs: values.map(selector), run: value => r.run(value), maxConcurrent: 5 });
  assert.equal(result.results.length, 100);
  assert.ok(result.results.every(item => item.status === 'success'));
  assert.ok(maximum > 1 && maximum <= 5);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM synthetic_imports').get().n, 100);
});

test('wrong company/account selectors never read another account', async t => {
  const f = syncFixture(t), value = await f.add();
  let calls = 0;
  const r = runner(f, { async sync() { calls++; throw Error('must not reach'); } });
  assert.equal((await r.run({ ...selector(value), accountKey: 'another-account' })).status, 'blocked');
  assert.equal((await r.run({ ...selector(value), companyId: 'another-company' })).status, 'blocked');
  assert.equal((await r.run({ ...selector(value), owner: 'another-owner' })).status, 'blocked');
  assert.equal(calls, 0);
});

test('provider429 persists embargo and a renewed consent cannot trigger an early background call', async t => {
  const f = syncFixture(t), value = await f.add();
  let calls = 0;
  const sync = async ({ request }) => request(async () => { calls++; throw Object.assign(Error('contains provider secrets'), { status: 429, retryAfter: 120 }); });
  const result = await runner(f, { sync }).run(selector(value));
  assert.equal(result.status, 'retry');
  assert.equal(result.code, 'PROVIDER_429');
  assert.equal(result.nextAttemptAt, START + 120000);
  assert.ok(!JSON.stringify(result).includes('secrets'));
  const renewed = syntheticContext('A', { consentId: 'new-consent', generation: 'generation-2', revision: 2 });
  await f.add(renewed);
  const next = await runner(f, { sync }).run(selector(renewed));
  assert.equal(next.status, 'retry');
  assert.equal(calls, 1);
});

test('malformed provider retry deadline blocks rather than shortening its wait', async t => {
  const f = syncFixture(t), value = await f.add();
  const result = await runner(f, { async sync({ request }) { return request(async () => { throw Object.assign(Error('429'), { status: 429, retryAfter: Infinity }); }); } }).run(selector(value));
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'RETRY_AFTER_UNKNOWN');
  assert.equal((await f.store.status(value)).nextAttemptAt, null);
});

test('provider explicitly unresolved Retry-After blocks even when a numeric fallback is present', async t => {
  const f = syncFixture(t), value = await f.add();
  const result = await runner(f, { async sync({ request }) { return request(async () => { throw Object.assign(Error('429'), { status: 429, retryAfter: 60, retryBlocked: true }); }); } }).run(selector(value));
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'RETRY_AFTER_UNKNOWN');
  assert.equal((await f.store.status(value)).nextAttemptAt, null);
});

test('503 Retry-After is honored without shortening the provider embargo', async t => {
  const f = syncFixture(t), value = await f.add();
  const result = await runner(f, { async sync({ request }) { return request(async () => { throw Object.assign(Error('temporary outage'), { status: 503, code: 'bank_unavailable', retryAfter: 172800 }); }); } }).run(selector(value));
  assert.equal(result.status, 'retry');
  assert.equal(result.code, 'PROVIDER_UNAVAILABLE');
  assert.equal(result.nextAttemptAt, START + 172800000);
});

for (const unresolved of [false, true]) test(`rejected provider call rechecks revocation and retains ${unresolved ? 'unknown' : 'known'} embargo across renewal`, async t => {
  const f = syncFixture(t), value = await f.add();
  let calls = 0;
  const sync = async ({ request }) => request(async () => {
    calls++;
    f.sql.prepare('UPDATE synthetic_authorities SET active=0 WHERE company_id=?').run(value.companyId);
    throw Object.assign(Error('throttled and concurrently revoked'), { status: 429, retryAfter: unresolved ? Infinity : 120 });
  });
  const first = await runner(f, { sync }).run(selector(value));
  assert.equal(first.status, 'blocked');
  assert.equal(first.code, 'AUTHORIZATION_CHANGED');
  const renewed = await f.add(syntheticContext('A', { revision: 2, generation: 'generation-2', consentId: 'consent-renewed' }));
  const second = await runner(f, { sync }).run(selector(renewed));
  assert.equal(second.status, unresolved ? 'blocked' : 'retry');
  assert.equal(second.code, unresolved ? 'RETRY_AFTER_UNKNOWN' : 'PROVIDER_429');
  assert.equal(calls, 1);
});

for (const providerCode of ['BANK_RECONNECT_REQUIRED', 'BANK_AUTHORIZATION_EXPIRED', 'NO_LINKED_ACCOUNTS', 'PROVIDER_AUTHORIZATION_FAILED', 'application_access_denied', 'authorization_failed', 'account_unavailable', 'action_required']) test(`mapped provider authorization failure ${providerCode} blocks instead of automatic retry`, async t => {
  const f = syncFixture(t), value = await f.add();
  let calls = 0;
  const sync = async ({request}) => request(async () => { calls++; throw Object.assign(Error('private provider diagnostic'), {code: providerCode, status: 409}); });
  const first = await runner(f, {sync}).run(selector(value));
  assert.equal(first.status, 'blocked');
  assert.equal(first.code, 'AUTHORIZATION_CHANGED');
  assert.equal(first.nextAttemptAt, null);
  assert.equal((await f.store.status(value)).status, 'blocked');
  assert.equal((await runner(f, {sync}).run(selector(value))).status, 'blocked');
  assert.equal(calls, 1);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM synthetic_imports').get().n, 0);
});

for (const providerCode of ['BANK_USER_CONTEXT_REQUIRED', 'background_access_denied']) test(`foreground-only provider access ${providerCode} blocks the background policy`, async t => {
  const f = syncFixture(t), value = await f.add();
  let calls = 0;
  const sync = async ({request}) => request(async () => { calls++; throw Object.assign(Error('interactive context required'), {code: providerCode, status: 409}); });
  const first = await runner(f, {sync}).run(selector(value));
  assert.equal(first.status, 'blocked');
  assert.equal(first.code, 'BACKGROUND_POLICY_UNVERIFIED');
  assert.equal((await runner(f, {sync}).run(selector(value))).status, 'blocked');
  assert.equal(calls, 1);
  assert.equal(f.sql.prepare('SELECT revoked FROM company_bank_sync_jobs').get().revoked, 0);
});

test('revocation during a provider wait prevents original/import writes', async t => {
  const f = syncFixture(t), value = await f.add(), waiting = deferred(), started = deferred();
  const r = runner(f, { async sync({ request, lease }) {
    await request(async () => { started.resolve(); return waiting.promise; });
    await lease.commit({ key: 'must-not-write', sha256: 'b'.repeat(64), statements: [f.database.prepare('INSERT INTO synthetic_imports VALUES(?,?,?)').bind(value.companyId, 'revoked', 'secret')], result: {} });
    return { complete: true, receiptKey: 'must-not-write', imported: 1, duplicate: 0 };
  } });
  const pending = r.run(selector(value));
  await started.promise;
  f.sql.prepare('UPDATE synthetic_authorities SET active=0 WHERE company_id=?').run(value.companyId);
  waiting.resolve({});
  const result = await pending;
  assert.equal(result.status, 'blocked');
  assert.equal(f.sql.prepare('SELECT count(*) n FROM synthetic_imports').get().n, 0);
});

test('slow provider ignoring abort cannot commit a late response after bounded retry', async t => {
  const f = syncFixture(t), value = await f.add(), waiting = deferred(), started = deferred();
  let oldLease;
  const resultPromise = runner(f, { requestTimeoutMs: 10, async sync({ request, lease }) {
    oldLease = lease;
    return request(async () => { started.resolve(); return waiting.promise; });
  } }).run(selector(value));
  await started.promise;
  const result = await resultPromise;
  assert.equal(result.status, 'retry');
  assert.equal(result.code, 'PROVIDER_TIMEOUT');
  waiting.resolve({});
  await assert.rejects(oldLease.commit({ key: 'late', sha256: 'a'.repeat(64), statements: [], result: {} }));
});

for (const unresolved of [false, true]) test(`provider denial arriving after timeout retains ${unresolved ? 'unknown' : 'known'} embargo even after consent renewal`, async t => {
  const f = syncFixture(t), value = await f.add(), waiting = deferred(), started = deferred();
  let calls = 0;
  const sync = async ({request}) => request(async () => { calls++; started.resolve(); return waiting.promise; });
  const pending = runner(f, {requestTimeoutMs: 10, sync}).run(selector(value));
  await started.promise;
  const timedOut = await pending;
  assert.equal(timedOut.code, 'PROVIDER_TIMEOUT');
  await f.store.revoke(value);
  const renewed = await f.add(syntheticContext('A', {revision: 2, consentId: 'renewed-consent', generation: 'generation-2'}));
  await f.store.register(renewed);
  waiting.reject(Object.assign(Error('late provider denial'), {status: 429, retryAfter: unresolved ? Infinity : 172800}));
  await new Promise(resolve => setImmediate(resolve));
  const stored = await f.store.status(renewed);
  assert.equal(stored.code, unresolved ? 'RETRY_AFTER_UNKNOWN' : 'PROVIDER_429');
  assert.equal(stored.nextAttemptAt, unresolved ? null : START + 172800000);
  const next = await runner(f, {sync}).run(selector(renewed));
  assert.equal(next.status, unresolved ? 'blocked' : 'retry');
  assert.equal(calls, 1);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM synthetic_imports').get().n, 0);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM company_bank_sync_requests').get().n, 1);
});

test('lost import response is retried from the durable receipt without double import', async t => {
  const f = syncFixture(t), value = await f.add();
  let lost = true;
  const sync = async input => { const result = await f.sync(input); if (lost) { lost = false; throw Error('lost response'); } return result; };
  const first = await runner(f, { sync }).run(selector(value));
  assert.equal(first.status, 'retry');
  f.setTime(first.nextAttemptAt);
  const second = await runner(f, { sync }).run(selector(value));
  assert.equal(second.status, 'success');
  assert.equal(second.duplicate, 1);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM synthetic_imports').get().n, 1);
});

test('enabled enrichment without actual coverage is partial and imported AIS does not prove complete payments', async t => {
  const f = syncFixture(t), value = await f.add(syntheticContext('A', { bankgiroEnabled: true }));
  const result = await runner(f).run(selector(value));
  assert.equal(result.status, 'partial');
  assert.equal(result.coverage.bankgiro, 'unavailable');
  assert.equal(result.coverage.paymentDataComplete, false);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM synthetic_imports').get().n, 1);
});

test('verified enrichment stays in its enabled company scope and never certifies complete payment data', async t => {
  const f = syncFixture(t), enabled = await f.add(syntheticContext('A', {bankgiroEnabled: true})), disabled = await f.add(syntheticContext('B'));
  f.sql.exec('CREATE TABLE synthetic_reports(company_id TEXT, report_id TEXT, original TEXT, PRIMARY KEY(company_id,report_id))');
  const calls = [];
  const r = runner(f, {async enrich({context, request, lease}) {
    const report = await request(async () => { calls.push(context.companyId); return {id: 'same-report-id', reference: '000123', companyId: context.companyId}; });
    await lease.commit({key: 'bankgiro-report', sha256: 'b'.repeat(64), statements: [f.database.prepare('INSERT INTO synthetic_reports VALUES(?,?,?)').bind(context.companyId, report.id, JSON.stringify(report))], result: {retained: 1}});
    return {state: 'verified'};
  }});
  const a = await r.run(selector(enabled)), b = await r.run(selector(disabled));
  assert.equal(a.status, 'success');assert.equal(a.coverage.bankgiro, 'verified');assert.equal(a.coverage.paymentDataComplete, false);
  assert.equal(b.status, 'success');assert.notEqual(b.coverage.bankgiro, 'verified');
  assert.deepEqual(calls, [enabled.companyId]);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM synthetic_reports').get().n, 1);
  assert.equal(f.sql.prepare('SELECT company_id FROM synthetic_reports').get().company_id, enabled.companyId);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM synthetic_imports').get().n, 2);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM company_bank_sync_requests WHERE company_id=?').get(enabled.companyId).n, 2);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM company_bank_sync_requests WHERE company_id=?').get(disabled.companyId).n, 1);
});

test('revocation during enrichment retains committed AIS but cannot accept a new report', async t => {
  const f = syncFixture(t), value = await f.add(syntheticContext('A', {bankgiroEnabled: true}));
  let reportCommit = false;
  const result = await runner(f, {async enrich({request}) {
    await request(async () => {f.sql.prepare('UPDATE synthetic_authorities SET active=0 WHERE company_id=?').run(value.companyId);return {id: 'late-report'};});
    reportCommit = true;
    return {state: 'verified'};
  }}).run(selector(value));
  assert.equal(result.status, 'blocked');assert.equal(result.imported, 1);assert.equal(reportCommit, false);
  assert.equal(result.coverage.ais, 'complete');assert.equal(result.coverage.bankgiro, 'unavailable');assert.equal(result.coverage.paymentDataComplete, false);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM synthetic_imports').get().n, 1);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM company_bank_sync_receipts').get().n, 1);
});

test('every actual provider call consumes its own durable reservation', async t => {
  const f = syncFixture(t), value = await f.add(syntheticContext('A', { ratePolicy: { verified: true, evidenceId: 'synthetic-two-call-budget', maxRequests: 2, windowMs: 60000 } }));
  let calls = 0;
  const result = await runner(f, { async sync({ request }) { for (let i = 0; i < 3; i++) await request(async () => { calls++; return {}; }); return {}; } }).run(selector(value));
  assert.equal(result.status, 'retry');
  assert.equal(result.code, 'PROVIDER_BUDGET_EXHAUSTED');
  assert.equal(calls, 2);
  assert.equal(result.nextAttemptAt, START + 60000);
});

test('a declared successful import without an atomic receipt is rejected', async t => {
  const f = syncFixture(t), value = await f.add();
  const result = await runner(f, { async sync() { return { complete: true, receiptKey: 'nonexistent', imported: 1, duplicate: 0 }; } }).run(selector(value));
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'IMPORT_RECEIPT_MISSING');
  assert.equal((await f.store.status(value)).lastSuccessAt, null);
});

test('Node synchronous financial work and the actual-result receipt share one transaction', async t => {
  const f = syncFixture(t), value = await f.add();
  await f.store.register(value);
  const lease = await f.store.claim(value);
  assert.equal(typeof lease.commitWork, 'function', 'Node needs a synchronous financial callback inside its guarded receipt transaction');
  await assert.rejects(lease.commitWork({ key: 'node-import', sha256: 'c'.repeat(64), work() {
    f.sql.prepare('INSERT INTO synthetic_imports VALUES(?,?,?)').run(value.companyId, 'node-id', 'original');
    throw Error('interruption inside import');
  } }));
  assert.equal(f.sql.prepare('SELECT count(*) n FROM synthetic_imports').get().n, 0);
  const stored = await lease.commitWork({ key: 'node-import', sha256: 'c'.repeat(64), work() {
    const result = f.sql.prepare('INSERT INTO synthetic_imports VALUES(?,?,?)').run(value.companyId, 'node-id', 'original');
    return { imported: Number(result.changes), duplicate: 0 };
  } });
  assert.deepEqual(stored.result, { imported: 1, duplicate: 0 });
  const replayed = await lease.commitWork({ key: 'node-import', sha256: 'c'.repeat(64), work() { throw Error('duplicate must not execute'); } });
  assert.equal(replayed.duplicate, true);
  assert.deepEqual(replayed.result, { imported: 1, duplicate: 0 });
});
