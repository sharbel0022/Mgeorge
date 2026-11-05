import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseTapSummary, parseLcov, testVerdict, benchmarkVerdict, cleanTestEnvironment, captureSource, runTestSuite, runCommand, parseAudit, renderSummary } from '../scripts/quality/core.mjs';

const tap = ({ tests = 2, pass = 2, fail = 0, cancelled = 0, skipped = 0, todo = 0 } = {}) =>
  Object.entries({ tests, pass, fail, cancelled, skipped, todo }).map(([key, value]) => `# ${key} ${value}`).join('\n') + '\n';

test('quality evidence rejects missing, truncated and inconsistent final test totals', () => {
  assert.equal(testVerdict(0, parseTapSummary('')) .passed, false);
  assert.equal(testVerdict(0, parseTapSummary('# tests 2\n# pass 2\n')).passed, false);
  assert.equal(testVerdict(0, parseTapSummary(tap({ tests: 0, pass: 0 }))).passed, false);
  assert.equal(testVerdict(0, parseTapSummary(tap({ tests: 3, pass: 2 }))).passed, false);
  assert.equal(testVerdict(0, parseTapSummary(tap())).passed, true);
  assert.equal(testVerdict(7, parseTapSummary(tap())).passed, false);
  assert.equal(testVerdict(null, parseTapSummary(tap())).passed, false);
  assert.equal(testVerdict(0, parseTapSummary(tap()), { errorCode: 'ETIMEDOUT' }).passed, false);
  assert.equal(testVerdict(0, parseTapSummary(tap()), { signal: 'SIGTERM' }).passed, false);
});

test('quality evidence does not turn skipped, cancelled, TODO or failed tests into passes', () => {
  for (const field of ['fail', 'cancelled', 'skipped', 'todo']) {
    assert.equal(testVerdict(0, parseTapSummary(tap({ pass: 1, [field]: 1 }))).passed, false, field);
  }
  assert.deepEqual(parseTapSummary('    # tests 99\n' + tap()), { tests: 2, pass: 2, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
});

test('benchmark evidence rejects missing scenarios, failed correctness checks and another source commit', () => {
  const commit = 'a'.repeat(40);
  const report = {
    schemaVersion: 1, kind: 'synthetic-company-sqlite-benchmark', status: 'passed', syntheticOnly: true,
    source: { commit }, parameters: { companies: [1, 10, 100], transactions: 10, replayRounds: 1, concurrency: 4, seed: 95 },
    batches: [1, 10, 100].map(companyCount => ({
      companyCount, status: 'passed', transactionsPerCompany: 10, failures: [],
      verification: { isolation: true, replay: true, competingClaims: true, persistedTransactions: companyCount * 10 },
      provider: { networkRequests: 0 },
      metrics: { attempts: companyCount * 4, successes: companyCount * 3, expectedBusy: companyCount, errors: 0, imported: companyCount * 10, duplicate: companyCount * 20, latencyMs: { p50: 1, p95: 2 } },
      phases: ['initial', 'replay-1', 'competing-claims'].map(name => ({ name, errors: 0 })),
    })),
  };
  assert.equal(benchmarkVerdict(report, commit).passed, true);
  for (const invalid of [null, {}, { ...report, status: 'failed' }, { ...report, batches: [] }, { ...report, batches: report.batches.slice(0, 2) }, { ...report, source: { commit: 'b'.repeat(40) } }]) {
    assert.equal(benchmarkVerdict(invalid, commit).passed, false);
  }
  const invalidIsolation = structuredClone(report);
  invalidIsolation.batches[2].verification.isolation = false;
  assert.equal(benchmarkVerdict(invalidIsolation, commit).passed, false);
  const missingMetric = structuredClone(report);
  delete missingMetric.batches[1].metrics.latencyMs.p95;
  assert.equal(benchmarkVerdict(missingMetric, commit).passed, false);
});

test('coverage totals retain real denominators and label loaded-file scope', () => {
  const result = parseLcov('SF:src/one.js\nLF:10\nLH:7\nFNF:4\nFNH:2\nBRF:8\nBRH:3\nend_of_record\nSF:src/two.js\nLF:2\nLH:2\nFNF:1\nFNH:1\nBRF:0\nBRH:0\nend_of_record\n');
  assert.equal(result.files, 2);
  assert.deepEqual(result.lines, { covered: 9, total: 12, percent: 75 });
  assert.deepEqual(result.functions, { covered: 3, total: 5, percent: 60 });
  assert.deepEqual(result.branches, { covered: 3, total: 8, percent: 37.5 });
  assert.equal(result.scope, 'loaded production files only; unimported files are not measured');
  assert.equal(parseLcov('').measured, false);
  assert.equal(parseLcov('SF:src/one.js\nLF:10\nLH:7\n').measured, false);
  assert.equal(parseLcov('SF:src/one.js\nLF:2\nLH:7\nFNF:0\nFNH:0\nBRF:0\nBRH:0\nend_of_record\n').measured, false);
});

test('synthetic test children do not inherit provider credentials, preload code or production state', () => {
  const env = cleanTestEnvironment({ PATH: '/bin', npm_execpath: '/toolchain/lib/node_modules/npm/bin/npm-cli.js', TZ: 'Europe/Stockholm', NODE_OPTIONS: '--import private.mjs', DATABASE_URL: 'secret', MG_SITES_OCR_TOKEN: 'secret', NODE_ENV: 'production', HOME: '/operator', CI: 'true' });
  assert.equal(env.NODE_ENV, 'test');
  assert.equal(env.TZ, 'UTC');
  assert.equal(env.PATH, '/bin');
  assert.equal(env.npm_execpath, '/toolchain/lib/node_modules/npm/bin/npm-cli.js', 'retain the actual caller npm CLI instead of guessing its filesystem layout');
  for (const key of ['DATABASE_URL', 'MG_SITES_OCR_TOKEN', 'NODE_OPTIONS', 'HOME']) assert.equal(env[key], undefined);
});

function fixture(t, source) {
  const root = mkdtempSync(join(tmpdir(), 'mgeorge-quality-runner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'test'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, '.gitignore'), 'results/\n');
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
  writeFileSync(join(root, 'src/example.js'), 'export const answer = value => value ? 42 : 0;\n');
  writeFileSync(join(root, 'test/example.test.js'), source);
  for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=Synthetic QA', '-c', 'user.email=synthetic@example.invalid', 'commit', '-qm', 'synthetic fixture']]) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  return root;
}

test('quality suite executes actual tests and retains commit, TAP, JUnit, coverage and log hashes', async t => {
  const root = fixture(t, `import test from 'node:test'; import assert from 'node:assert/strict'; import {answer} from '../src/example.js'; test('real fixture', () => assert.equal(answer(true),42));`);
  const report = await runTestSuite({ root, name: 'fixture', cwd: root, files: ['test/example.test.js'], output: join(root, 'results'), coverage: true, coverageIncludes: ['src/**'], timeoutMs: 20000 });
  assert.equal(report.passed, true, JSON.stringify(report));
  assert.equal(report.totals.tests, 1);
  assert.equal(report.totals.pass, 1);
  assert.match(report.source.commit, /^[a-f0-9]{40}$/);
  assert.equal(report.source.workingTreeDirty, false);
  assert.equal(report.sourceChangedDuringRun, false);
  assert.equal(report.syntheticOnly, true);
  assert.equal(report.realBankVerification, 'NOT_RUN');
  assert.ok(report.coverage.lines.covered > 0);
  for (const artifact of report.artifacts) assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
  assert.match(readFileSync(join(root, 'results', 'tests.junit.xml'), 'utf8'), /real fixture/);
  assert.equal(JSON.parse(readFileSync(join(root, 'results', 'receipt.json'), 'utf8')).passed, true);
});

test('quality suite preserves real assertion failures and exits with a failed receipt', async t => {
  const root = fixture(t, `import test from 'node:test'; import assert from 'node:assert/strict'; test('broken synthetic amount',()=>assert.equal(62500,50000));`);
  const report = await runTestSuite({ root, name: 'fixture', cwd: root, files: ['test/example.test.js'], output: join(root, 'results'), timeoutMs: 20000 });
  assert.equal(report.passed, false);
  assert.equal(report.totals.fail, 1);
  assert.notEqual(report.exitCode, 0);
  assert.match(readFileSync(join(root, 'results', 'tests.tap'), 'utf8'), /broken synthetic amount/);
});

test('source identity catches uncommitted and untracked executable changes', t => {
  const root = fixture(t, `import test from 'node:test'; test('fixture',()=>{});`);
  const before = captureSource(root);
  writeFileSync(join(root, 'src/example.js'), 'export const answer = () => 43;\n');
  writeFileSync(join(root, 'test/new.test.js'), 'throw new Error("untracked");\n');
  const after = captureSource(root);
  assert.equal(after.commit, before.commit);
  assert.equal(after.workingTreeDirty, true);
  assert.notEqual(after.contentSha256, before.contentSha256);
  assert.ok(after.files.some(file => file.path === 'test/new.test.js'));
});

test('source identity includes npm configuration and non-JavaScript financial fixtures', t => {
  const root = fixture(t, `import test from 'node:test'; test('fixture',()=>{});`);
  const before = captureSource(root);
  mkdirSync(join(root, 'test/fixtures'));
  writeFileSync(join(root, '.npmrc'), 'ignore-scripts=true\n');
  writeFileSync(join(root, 'test/fixtures/payment.csv'), 'reference,amount\n0599,62500\n');
  writeFileSync(join(root, 'test/fixtures/report.xml'), '<reference>0000599</reference>');
  const after = captureSource(root);
  assert.notEqual(after.contentSha256, before.contentSha256);
  for (const path of ['.npmrc', 'test/fixtures/payment.csv', 'test/fixtures/report.xml']) assert.ok(after.files.some(file => file.path === path), path);
});

test('quality suite rejects source changes made while the child is running', async t => {
  const root = fixture(t, `import test from 'node:test'; import fs from 'node:fs'; test('source mutator',()=>fs.appendFileSync(new URL('../src/example.js', import.meta.url),'// changed\\n'));`);
  const report = await runTestSuite({ root, name: 'fixture', cwd: root, files: ['test/example.test.js'], output: join(root, 'results'), timeoutMs: 20000 });
  assert.equal(report.totals.pass, 1);
  assert.equal(report.sourceChangedDuringRun, true);
  assert.equal(report.passed, false);
});

test('command evidence retains failure exit codes and separate stdout/stderr artifacts', t => {
  const root = fixture(t, `import test from 'node:test'; test('fixture',()=>{});`);
  const result = runCommand({ name: 'intentional-failure', executable: process.execPath, args: ['-e', 'console.log("synthetic output");console.error("synthetic failure");process.exit(7)'], cwd: root, output: join(root, 'results'), env: cleanTestEnvironment(), timeoutMs: 10000 });
  assert.equal(result.passed, false);
  assert.equal(result.exitCode, 7);
  assert.equal(result.artifacts.length, 2);
  assert.match(readFileSync(join(root, 'results', result.artifacts[0].path), 'utf8'), /synthetic output/);
  assert.match(readFileSync(join(root, 'results', result.artifacts[1].path), 'utf8'), /synthetic failure/);
});

test('a timed out command is never a successful quality gate', t => {
  const root = fixture(t, `import test from 'node:test'; test('fixture',()=>{});`);
  const result = runCommand({ name: 'intentional-timeout', executable: process.execPath, args: ['-e', 'setTimeout(()=>process.exit(0),2000)'], cwd: root, output: join(root, 'results'), env: cleanTestEnvironment(), timeoutMs: 100 });
  assert.equal(result.passed, false);
  assert.equal(result.exitCode, null);
  assert.equal(result.errorCode, 'ETIMEDOUT');
});

test('audit errors and invalid severity totals never become a clean dependency audit', () => {
  assert.equal(parseAudit('{"error":{"code":"ENETUNREACH"}}').measured, false);
  assert.equal(parseAudit('not JSON').measured, false);
  assert.equal(parseAudit('{"metadata":{"vulnerabilities":{"high":"0"}}}').measured, false);
  const result = parseAudit('{"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":8,"high":0,"critical":0,"total":8}}}');
  assert.equal(result.measured, true);
  assert.equal(result.vulnerabilities.moderate, 8);
});

test('GitHub summary explicitly separates synthetic acceptance and escapes failure labels', () => {
  const summary = renderSummary({ profile: 'node', source: { commit: 'a'.repeat(40), workingTreeDirty: false }, status: 'FAILED', steps: [{ name: 'tests|<script>', passed: false, totals: { tests: 2, pass: 1, fail: 1, cancelled: 0, skipped: 0, todo: 0 }, failures: ['bad|<script>\nname'] }] });
  assert.match(summary, /NOT_RUN/);
  assert.match(summary, /FAILED/);
  assert.match(summary, /2/);
  assert.doesNotMatch(summary, /<script>/);
  assert.match(summary, /&lt;script&gt;/);
});

test('actual browser harness retains startup failure evidence and closes its loopback server', t => {
  const output = mkdtempSync(join(tmpdir(), 'mgeorge-browser-startup-'));
  t.after(() => rmSync(output, { recursive: true, force: true }));
  writeFileSync(join(output, 'manifest.json'), '{"inputs":[],"outputs":[]}');
  const stub = join(output, 'unavailable-browser.cjs');
  writeFileSync(stub, 'exports.chromium={launch:async()=>{throw new Error("SYNTHETIC_BROWSER_STARTUP_FAILURE")}};');
  const script = fileURLToPath(new URL('../docs/integration/saas-onboarding-browser/browser-suite.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 10000, env: { ...cleanTestEnvironment(), MGEORGE_ONBOARDING_QA: output, PLAYWRIGHT_MODULE_PATH: stub } });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.error, undefined, 'startup failure must not leave the fixture server alive');
  const report = JSON.parse(readFileSync(join(output, 'results/acceptance-results.json'), 'utf8'));
  assert.equal(report.success, false);
  assert.equal(report.passed, 0);
  assert.equal(report.results.length, 0);
  assert.ok(report.runnerErrors.some(error => error.includes('SYNTHETIC_BROWSER_STARTUP_FAILURE')));
});
