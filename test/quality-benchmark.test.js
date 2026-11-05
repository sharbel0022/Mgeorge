import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArguments, syntheticTransactions, validateParameters } from '../scripts/quality/benchmark-companies.mjs';

test('synthetic benchmark bounds fixture size, concurrency and replay and requires a report path', () => {
  assert.throws(() => parseArguments([]), /--output/);
  assert.throws(() => parseArguments(['--output', '/tmp/report.json', '--transactions']), /missing value/);
  assert.throws(() => parseArguments(['--output', '/tmp/report.json', '--production', 'true']), /unknown option/);
  for (const input of [
    { companies: [0] }, { companies: [101] }, { companies: [1.5] }, { companies: [] },
    { transactions: 0 }, { transactions: 1001 }, { concurrency: 0 }, { concurrency: 21 },
    { replayRounds: 0 }, { replayRounds: 6 }, { seed: -1 }, { seed: 0x100000000 },
    { companies: [100, 99], transactions: 1000 },
  ]) assert.throws(() => validateParameters(input));
  assert.deepEqual(parseArguments(['--output', '/tmp/report.json']).parameters.companies, [1, 10, 100]);
});

test('seeded fixtures retain duplicate source IDs across companies with distinct tenant markers', () => {
  const first = syntheticTransactions(95, 0, 3);
  assert.deepEqual(first, syntheticTransactions(95, 0, 3));
  assert.notDeepEqual(first, syntheticTransactions(96, 0, 3));
  const second = syntheticTransactions(95, 1, 3);
  assert.deepEqual(first.map(row => row.entry_reference), second.map(row => row.entry_reference));
  assert.notEqual(first[0].debtor.name, second[0].debtor.name);
});

test('benchmark CLI verifies real SQLite tenant isolation, duplicate replay and competing sync claims', { timeout: 120000 }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'mgeorge-quality-report-'));
  try {
    const output = join(directory, 'nested', 'report.json');
    const child = spawnSync(process.execPath, ['--import', './scripts/saas-test-isolation.mjs', 'scripts/quality/benchmark-companies.mjs', '--output', output, '--companies', '2', '--transactions', '3', '--concurrency', '2', '--seed', '95'], {
      cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 110000,
      env: { ...process.env, NODE_ENV: 'test' },
    });
    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
    const report = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(report.syntheticOnly, true);
    assert.equal(report.status, 'passed');
    assert.match(report.source.commit, /^[a-f0-9]{40}$/);
    assert.equal(typeof report.source.dirty, 'boolean');
    assert.equal(report.parameters.seed, 95);
    assert.equal(report.batches.length, 1);
    const batch = report.batches[0];
    assert.deepEqual(batch.verification, { isolation: true, replay: true, competingClaims: true, persistedTransactions: 6 });
    assert.equal(batch.metrics.attempts, 8);
    assert.equal(batch.metrics.successes, 6);
    assert.equal(batch.metrics.expectedBusy, 2);
    assert.equal(batch.metrics.errors, 0);
    assert.equal(batch.metrics.imported, 6);
    assert.equal(batch.metrics.duplicate, 12);
    assert.equal(batch.provider.networkRequests, 0);
    assert.ok(batch.provider.maximumActiveCalls >= 2, 'synthetic provider calls must overlap across company jobs');
    assert.deepEqual(batch.failures, []);
    assert.equal(batch.phases[0].imported, 6);
    assert.equal(batch.phases[1].imported, 0);
    assert.equal(batch.phases[2].expectedBusy, 2);
    for (const phase of batch.phases) {
      assert.ok(Number.isFinite(phase.elapsedMs));
      assert.ok(Number.isFinite(phase.latencyMs.p50));
      assert.ok(Number.isFinite(phase.latencyMs.p95));
      assert.ok(phase.latencyMs.p95 >= phase.latencyMs.p50);
    }
    assert.ok(batch.memory.sampledHighWater.rssBytes >= batch.memory.before.rssBytes);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
