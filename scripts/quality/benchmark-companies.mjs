#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, freemem, platform, release, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import { openDatabase } from '../../src/db.js';
import { createCompanyRuntime } from '../../src/company-runtime.js';
import { createNodeCompanyBankSyncRuntime, nodeCompanyBankAccountKey } from '../../src/company-bank-sync.js';
import { runCompanyBankSyncBatch } from '../../sites/lib/company-bank-sync.js';
import { encryptObject } from '../../src/security.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXED_NOW = Date.parse('2026-11-04T12:00:00Z');
const VALID_UNTIL = '2026-11-06T12:00:00Z';
export const DEFAULT_PARAMETERS = Object.freeze({ companies: [1, 10, 100], transactions: 10, concurrency: 4, replayRounds: 1, seed: 95 });

function boundedInteger(value, name, min, max) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${name} must be an integer in ${min}..${max}`);
  return number;
}

export function validateParameters(input = {}) {
  const parameters = { ...DEFAULT_PARAMETERS, ...input };
  if (!Array.isArray(parameters.companies) || parameters.companies.length < 1 || parameters.companies.length > 10) throw new Error('companies must contain 1..10 batch sizes');
  parameters.companies = [...new Set(parameters.companies.map(value => boundedInteger(value, 'companies', 1, 100)))];
  parameters.transactions = boundedInteger(parameters.transactions, 'transactions', 1, 1000);
  parameters.concurrency = boundedInteger(parameters.concurrency, 'concurrency', 1, 20);
  parameters.replayRounds = boundedInteger(parameters.replayRounds, 'replay-rounds', 1, 5);
  parameters.seed = boundedInteger(parameters.seed, 'seed', 0, 0xffffffff);
  if (parameters.companies.reduce((sum, count) => sum + count, 0) * parameters.transactions > 120000) throw new Error('combined fixture volume exceeds 120000 transactions');
  return parameters;
}

export function parseArguments(args) {
  const parameters = {};
  let output;
  const names = { '--transactions': 'transactions', '--concurrency': 'concurrency', '--replay-rounds': 'replayRounds', '--seed': 'seed' };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--help') return { help: true };
    const value = args[++index];
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for ${flag}`);
    if (flag === '--output') output = resolve(value);
    else if (flag === '--companies') parameters.companies = value.split(',');
    else if (names[flag]) parameters[names[flag]] = value;
    else throw new Error(`unknown option ${flag}`);
  }
  if (!output) throw new Error('--output <path.json> is required');
  return { output, parameters: validateParameters(parameters) };
}

function hash(value) { return createHash('sha256').update(value).digest('hex'); }

// The identifiers deliberately repeat in every partition. Only money and payer
// markers vary by company, so an accidental shared database is detectable.
export function syntheticTransactions(seed, companyIndex, count) {
  let state = (seed ^ Math.imul(companyIndex + 1, 0x9e3779b9)) >>> 0;
  return Array.from({ length: count }, (_, index) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const cents = 100 + (state % 100000);
    return {
      status: 'BOOK', entry_reference: `synthetic-entry-${index}`, transaction_id: `synthetic-lookup-${index}`,
      booking_date: '2026-11-04', transaction_amount: { amount: `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`, currency: 'SEK' },
      credit_debit_indicator: 'CRDT', debtor: { name: `Synthetic payer company ${companyIndex}` },
      reference_number: `SYNTHETIC-${companyIndex}-${index}`,
    };
  });
}

function sourceInfo() {
  const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
  try {
    const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
    return { commit: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']), dirty: Boolean(status), status: status ? status.split('\n') : [], trackedDiffSha256: hash(git(['diff', '--binary', 'HEAD'])), benchmarkSha256: hash(readFileSync(fileURLToPath(import.meta.url))) };
  } catch (error) { return { unavailable: true, reason: error.message, benchmarkSha256: hash(readFileSync(fileURLToPath(import.meta.url))) }; }
}

function memorySample() {
  const value = process.memoryUsage();
  return { rssBytes: value.rss, heapUsedBytes: value.heapUsed, externalBytes: value.external };
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function metrics(samples, elapsedMs) {
  const successful = samples.filter(sample => sample.status === 'success');
  const busy = samples.filter(sample => sample.status === 'retry' && sample.code === 'ACCOUNT_BUSY');
  const imported = successful.reduce((sum, sample) => sum + (sample.imported || 0), 0);
  return {
    elapsedMs, attempts: samples.length, successes: successful.length, expectedBusy: busy.length,
    errors: samples.length - successful.length - busy.length, imported,
    duplicate: successful.reduce((sum, sample) => sum + (sample.duplicate || 0), 0),
    latencyMs: { unit: 'one company sync attempt, including provider scheduling yield', p50: percentile(samples.map(sample => sample.elapsedMs), 0.5), p95: percentile(samples.map(sample => sample.elapsedMs), 0.95), max: samples.length ? Math.max(...samples.map(sample => sample.elapsedMs)) : null },
    successfulLatencyMs: { p50: percentile(successful.map(sample => sample.elapsedMs), 0.5), p95: percentile(successful.map(sample => sample.elapsedMs), 0.95) },
    successfulSyncsPerSecond: elapsedMs > 0 ? successful.length * 1000 / elapsedMs : null,
    importedTransactionsPerSecond: elapsedMs > 0 ? imported * 1000 / elapsedMs : null,
  };
}

async function runBatch(companyCount, parameters) {
  const started = performance.now();
  const directory = mkdtempSync(join(tmpdir(), 'mgeorge-synthetic-scale-'));
  const memoryBefore = memorySample();
  let sampledHighWater = { ...memoryBefore };
  const sampleMemory = () => {
    const sample = memorySample();
    for (const key of Object.keys(sample)) sampledHighWater[key] = Math.max(sampledHighWater[key], sample[key]);
  };
  let control;
  let runtime;
  const samples = [];
  const phases = [];
  const failures = [];
  let providerCalls = 0;
  let activeProviderCalls = 0;
  let maximumActiveProviderCalls = 0;
  const fixtures = [];
  const verification = { isolation: false, replay: false, competingClaims: false, persistedTransactions: 0 };
  const result = { companyCount, transactionsPerCompany: parameters.transactions, status: 'failed', phases, failures, verification };
  try {
    const databasePath = join(directory, 'control.sqlite');
    control = openDatabase(databasePath);
    runtime = createCompanyRuntime({ controlDb: control, legacyDatabasePath: databasePath });
    for (let companyIndex = 0; companyIndex < companyCount; companyIndex++) {
      const companyId = `quality-synthetic-company-${companyIndex}`;
      const actorId = `quality-synthetic-owner-${companyIndex}`;
      runtime.provisionCompany({ companyId, name: `Synthetic Company ${companyIndex}`, actorId, verification: { status: 'verified', evidenceId: 'synthetic-benchmark-boundary', verifiedBy: 'synthetic-benchmark' } });
      const context = runtime.resolve({ actorId });
      const transactions = syntheticTransactions(parameters.seed, companyIndex, parameters.transactions);
      const bank = 'Swedbank';
      const account = { uid: 'synthetic-account-uid', name: 'Synthetic account', currency: 'SEK', account_id: { other: { identification: 'SYNTHETIC-SHARED-ACCOUNT' } } };
      const selector = { companyId, connectionId: 'synthetic-shared-connection', accountKey: nodeCompanyBankAccountKey({ bank, account }) };
      const authorization = { ...selector, owner: context.storageOwner, provider: 'enablebanking', accountUid: account.uid, consentId: 'synthetic-consent', generation: 'synthetic-generation-1', revision: 1, authorizationStatus: 'VERIFIED', validUntil: VALID_UNTIL, ratePolicy: { verified: true, evidenceId: 'synthetic-rate-policy', maxRequests: 100, windowMs: 60000 }, bankgiroEnabled: false };
      const adapter = await runtime.run(context, async () => {
        runtime.db.prepare('INSERT INTO bank_connections(id,provider,bank_name,encrypted_session,accounts_json,valid_until,owner,selected_account_uid) VALUES(?,?,?,?,?,?,?,?)').run(selector.connectionId, 'enablebanking', bank, encryptObject({ session_id: authorization.consentId }), encryptObject([account]), VALID_UNTIL, context.storageOwner, account.uid);
        const adapter = await createNodeCompanyBankSyncRuntime({
          db: runtime.db, companyId, owner: context.storageOwner, existingDataCompanyId: companyId,
          evidenceId: 'synthetic-company-binding', now: () => FIXED_NOW,
          resolveContext: async () => ({ ...authorization }),
          assertCurrent: snapshot => { assert.equal(snapshot.companyId, companyId); assert.equal(snapshot.generation, authorization.generation); assert.equal(snapshot.revision, authorization.revision); },
          listJobs: async () => [selector],
          providerRequest: async path => {
            providerCalls++;
            activeProviderCalls++;
            maximumActiveProviderCalls = Math.max(maximumActiveProviderCalls, activeProviderCalls);
            try {
              await yieldImmediate();
              sampleMemory();
              if (path === `/sessions/${authorization.consentId}`) return { status: 'AUTHORIZED', accounts: [account.uid], aspsp: { name: bank, country: 'SE' }, psu_type: 'business', access: { valid_until: VALID_UNTIL } };
              if (path.startsWith(`/accounts/${account.uid}/transactions`)) return { transactions: structuredClone(transactions) };
              throw new Error(`unexpected synthetic provider route: ${path}`);
            } finally { activeProviderCalls--; }
          },
        });
        await adapter.store.setReferencePolicy({ companyId, owner: context.storageOwner, revision: 1, companyName: `Synthetic Company ${companyIndex}`, mode: 'invoice_number', evidenceId: 'synthetic-reference-policy' });
        return adapter;
      });
      fixtures.push({ companyIndex, context, adapter, selector, transactions });
      sampleMemory();
    }
    result.fixtureSha256 = hash(JSON.stringify(fixtures.map(fixture => fixture.transactions)));
    result.setupMs = performance.now() - started;

    const attempt = async fixture => {
      const attemptStarted = performance.now();
      let outcome;
      try { outcome = await runtime.run(fixture.context, () => fixture.adapter.run(fixture.selector)); }
      catch (error) { outcome = { status: 'error', code: error.code || error.name, message: error.message }; }
      const sample = { companyId: fixture.selector.companyId, elapsedMs: performance.now() - attemptStarted, status: outcome.status, code: outcome.code, imported: outcome.imported, duplicate: outcome.duplicate };
      samples.push(sample);
      sampleMemory();
      if (outcome.status !== 'success' && outcome.code !== 'ACCOUNT_BUSY') failures.push({ companyId: fixture.selector.companyId, code: outcome.code || outcome.status, message: outcome.message || 'sync did not succeed' });
      return outcome;
    };

    const runPhase = async (name, competing = false) => {
      const phaseStarted = performance.now();
      const sampleStart = samples.length;
      const batch = await runCompanyBankSyncBatch({
        jobs: fixtures, maxConcurrent: parameters.concurrency, maxJobs: 100,
        run: async fixture => {
          if (!competing) return attempt(fixture);
          const outcomes = await Promise.all([attempt(fixture), attempt(fixture)]);
          assert.equal(outcomes.filter(value => value.status === 'success').length, 1, `one competing sync must win for ${fixture.selector.companyId}`);
          assert.equal(outcomes.filter(value => value.status === 'retry' && value.code === 'ACCOUNT_BUSY').length, 1, `one competing sync must be busy for ${fixture.selector.companyId}`);
          return outcomes.find(value => value.status === 'success');
        },
      });
      const phase = { name, ...metrics(samples.slice(sampleStart), performance.now() - phaseStarted) };
      phases.push(phase);
      assert.equal(batch.remaining, 0);
      assert.ok(batch.results.every(value => value.status === 'success'), `${name} had unsuccessful syncs or contention invariant failures`);
      assert.equal(phase.successes, companyCount);
      assert.equal(phase.errors, 0);
      assert.equal(phase.expectedBusy, competing ? companyCount : 0);
      assert.equal(phase.imported, name === 'initial' ? companyCount * parameters.transactions : 0, `${name} import count`);
      if (name !== 'initial') assert.equal(phase.duplicate, companyCount * parameters.transactions, `${name} replay count`);
    };

    const verifyRows = () => {
      let total = 0;
      for (const fixture of fixtures) {
        runtime.run(fixture.context, () => {
          const rows = runtime.db.prepare('SELECT amount_cents, payer FROM bank_transactions ORDER BY fingerprint').all();
          assert.equal(rows.length, parameters.transactions, `isolated row count for company ${fixture.companyIndex}`);
          assert.ok(rows.every(row => row.payer === `Synthetic payer company ${fixture.companyIndex}`), 'foreign company payer leaked into partition');
          const expected = fixture.transactions.map(transaction => Math.round(Number(transaction.transaction_amount.amount) * 100)).sort((a, b) => a - b);
          assert.deepEqual(rows.map(row => row.amount_cents).sort((a, b) => a - b), expected, 'company monetary totals changed');
          total += rows.length;
        });
      }
      return total;
    };

    await runPhase('initial');
    verification.persistedTransactions = verifyRows();
    verification.isolation = true;
    for (let round = 0; round < parameters.replayRounds; round++) await runPhase(`replay-${round + 1}`);
    assert.equal(verifyRows(), verification.persistedTransactions);
    verification.replay = true;
    await runPhase('competing-claims', true);
    assert.equal(verifyRows(), verification.persistedTransactions);
    verification.competingClaims = true;
    result.status = 'passed';
  } catch (error) {
    failures.push({ code: error.code || error.name, message: error.message });
  } finally {
    sampleMemory();
    result.provider = { mode: 'in-process deterministic synthetic adapter', calls: providerCalls, maximumActiveCalls: maximumActiveProviderCalls, networkRequests: 0 };
    result.metrics = metrics(samples, phases.reduce((sum, phase) => sum + phase.elapsedMs, 0));
    result.memory = { before: memoryBefore, after: memorySample(), sampledHighWater, scope: 'current Node process; includes earlier batches; samples at provider yields and sync completions, not an exact OS peak' };
    runtime?.close();
    control?.close();
    rmSync(directory, { recursive: true, force: true });
    result.totalMs = performance.now() - started;
  }
  return result;
}

export async function runBenchmark(input = {}) {
  const parameters = validateParameters(input);
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const oldBankKey = process.env.BANK_DATA_KEY;
  const oldEncryptionKey = process.env.ENCRYPTION_KEY;
  const report = {
    schemaVersion: 1, kind: 'synthetic-company-sqlite-benchmark', syntheticOnly: true, startedAt, parameters,
    source: sourceInfo(),
    environment: { node: process.version, sqlite: process.versions.sqlite, platform: platform(), release: release(), architecture: process.arch, cpuModel: cpus()[0]?.model || null, logicalCpus: cpus().length, totalMemoryBytes: totalmem(), availableMemoryBytesAtStart: freemem() },
    limits: { maximumCompanies: 100, maximumTransactionsPerCompany: 1000, maximumCombinedFixtureTransactions: 120000, maximumCompanyConcurrency: 20, maximumReplayRounds: 5, fixedApplicationClock: new Date(FIXED_NOW).toISOString(), measuredClock: 'performance.now monotonic wall clock', concurrency: 'bounded company jobs; competing phase starts two attempts per job, so at most twice configured attempts', timingGate: false },
    limitations: [
      'Synthetic fixtures only. No customer data, real bank credentials, provider requests, browser activity, or production capacity claims.',
      'Fresh local SQLite files per batch; setup is reported separately. No warm-up, repeated statistical trials, artificial network latency, or distributed workers.',
      'Concurrency is asynchronous overlap in one Node process using the production scheduler and real persisted sync leases. It does not measure cross-process locking.',
      'Provider authorization and rate-policy evidence are explicit synthetic fixtures. This does not verify any bank integration or regulatory permission.',
      'Timing depends on host contention and filesystem caching; percentile observations and throughput are informational, never pass/fail thresholds.',
    ],
    batches: [],
  };
  try {
    process.env.BANK_DATA_KEY = '7'.repeat(64);
    delete process.env.ENCRYPTION_KEY;
    for (const companyCount of parameters.companies) report.batches.push(await runBatch(companyCount, parameters));
  } finally {
    if (oldBankKey === undefined) delete process.env.BANK_DATA_KEY; else process.env.BANK_DATA_KEY = oldBankKey;
    if (oldEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = oldEncryptionKey;
  }
  report.finishedAt = new Date().toISOString();
  report.totalMs = performance.now() - started;
  report.status = report.batches.length === parameters.companies.length && report.batches.every(batch => batch.status === 'passed') ? 'passed' : 'failed';
  return report;
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.help) {
    console.log('Usage: node scripts/quality/benchmark-companies.mjs --output report.json [--companies 1,10,100] [--transactions 10] [--concurrency 4] [--replay-rounds 1] [--seed 95]');
    return;
  }
  const report = await runBenchmark(parsed.parameters);
  mkdirSync(dirname(parsed.output), { recursive: true });
  writeFileSync(parsed.output, `${JSON.stringify(report, null, 2)}\n`);
  for (const batch of report.batches) console.log(JSON.stringify({ companies: batch.companyCount, status: batch.status, totalMs: batch.totalMs, p50Ms: batch.metrics.latencyMs.p50, p95Ms: batch.metrics.latencyMs.p95, errors: batch.metrics.errors, failures: batch.failures }));
  console.log(`Synthetic-only report: ${parsed.output}`);
  if (report.status !== 'passed') process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
