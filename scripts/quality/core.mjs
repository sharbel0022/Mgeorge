import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, arch } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const guard = fileURLToPath(new URL('../saas-test-isolation.mjs', import.meta.url));
const totalNames = ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'];
export const sha256 = value => createHash('sha256').update(value).digest('hex');

export function writeJson(path, value) {
  mkdirSync(resolve(path, '..'), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, path);
}

export function parseTapSummary(log) {
  return Object.fromEntries(totalNames.map(name => {
    const matches = [...log.matchAll(new RegExp(`^# ${name} (\\d+)\\s*$`, 'gm'))];
    return [name, matches.length ? Number(matches.at(-1)[1]) : null];
  }));
}

export function testVerdict(exitCode, totals, { errorCode = null, signal = null } = {}) {
  const complete = totalNames.every(name => Number.isSafeInteger(totals[name]) && totals[name] >= 0);
  return {
    passed: exitCode === 0 && !errorCode && !signal && complete && totals.tests > 0 && totals.pass === totals.tests
      && ['fail', 'cancelled', 'skipped', 'todo'].every(name => totals[name] === 0),
    complete,
  };
}

export function benchmarkVerdict(report, commit) {
  // A zero exit alone must never bless stale, partial or unchecked measurements.
  const companies = [1, 10, 100];
  const parameters = report?.parameters;
  const validParameters = parameters && JSON.stringify(parameters.companies) === JSON.stringify(companies)
    && parameters.transactions === 10 && parameters.replayRounds === 1 && parameters.concurrency === 4 && parameters.seed === 95;
  const validBatches = Array.isArray(report?.batches) && report.batches.length === companies.length && report.batches.every((batch, index) => {
    const count = companies[index], metrics = batch?.metrics, checks = batch?.verification;
    return batch?.companyCount === count && batch.status === 'passed' && batch.transactionsPerCompany === 10
      && Array.isArray(batch.failures) && batch.failures.length === 0 && batch.provider?.networkRequests === 0
      && checks?.isolation === true && checks.replay === true && checks.competingClaims === true && checks.persistedTransactions === count * 10
      && metrics?.errors === 0 && metrics.attempts === count * 4 && metrics.successes === count * 3 && metrics.expectedBusy === count
      && metrics.imported === count * 10 && metrics.duplicate === count * 20
      && Number.isFinite(metrics.latencyMs?.p50) && metrics.latencyMs.p50 >= 0
      && Number.isFinite(metrics.latencyMs?.p95) && metrics.latencyMs.p95 >= metrics.latencyMs.p50
      && Array.isArray(batch.phases) && JSON.stringify(batch.phases.map(phase => phase.name)) === JSON.stringify(['initial', 'replay-1', 'competing-claims'])
      && batch.phases.every(phase => phase.errors === 0);
  });
  return { passed: Boolean(report?.schemaVersion === 1 && report.kind === 'synthetic-company-sqlite-benchmark'
    && report.status === 'passed' && report.syntheticOnly === true && report.source?.commit === commit && validParameters && validBatches) };
}

export function parseLcov(text) {
  const count = key => [...text.matchAll(new RegExp(`^${key}:(\\d+)\\s*$`, 'gm'))].reduce((sum, match) => sum + Number(match[1]), 0);
  const ratio = (covered, total) => ({ covered, total, percent: total ? Math.round(covered / total * 10000) / 100 : null });
  const files = [...text.matchAll(/^SF:.+$/gm)].length;
  const completeRecords = text.split('end_of_record').slice(0, -1).filter(record => /^SF:.+$/m.test(record));
  const valid = completeRecords.length === files && completeRecords.every(record => {
    const values = Object.fromEntries(['LF', 'LH', 'FNF', 'FNH', 'BRF', 'BRH'].map(key => {
      const matches = [...record.matchAll(new RegExp(`^${key}:(\\d+)\\s*$`, 'gm'))];
      return [key, matches.length === 1 ? Number(matches[0][1]) : null];
    }));
    return Object.values(values).every(value => Number.isSafeInteger(value) && value >= 0)
      && values.LH <= values.LF && values.FNH <= values.FNF && values.BRH <= values.BRF;
  });
  return {
    measured: files > 0 && valid,
    scope: 'loaded production files only; unimported files are not measured',
    files,
    lines: ratio(count('LH'), count('LF')),
    functions: ratio(count('FNH'), count('FNF')),
    branches: ratio(count('BRH'), count('BRF')),
  };
}

export function cleanTestEnvironment(input = process.env) {
  const env = { NODE_ENV: 'test', TZ: 'UTC', LANG: 'C.UTF-8', CLOUDFLARE_CF_FETCH_ENABLED: 'false', WRANGLER_SEND_METRICS: 'false' };
  // npm's executable path is toolchain identity, not registry configuration or
  // credentials. Retain it for lifecycle tests on different installation layouts.
  for (const key of ['PATH', 'npm_execpath', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TMP', 'TEMP', 'CI', 'NO_COLOR']) {
    if (input[key] !== undefined) env[key] = input[key];
  }
  return env;
}

export function captureSource(root = repositoryRoot) {
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (result.status !== 0) throw new Error('QUALITY_SOURCE_IDENTITY_UNAVAILABLE');
    return result.stdout;
  };
  // Include every tracked/nonignored input, regardless of extension: npmrc,
  // CSV/XML/PDF fixtures and OCR WASM bytes can change execution too. Evidence
  // must be written outside the checkout or in its ignored .codex-work folder.
  const paths = [...new Set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean))].sort();
  const files = paths.map(path => {
    const full = join(root, path);
    if (!existsSync(full)) return { path, sha256: null, missing: true };
    const stat = lstatSync(full);
    return { path, sha256: sha256(readFileSync(full)), executable: Boolean(stat.mode & 0o111), ...(stat.isSymbolicLink() ? { linkTarget: readlinkSync(full) } : {}) };
  });
  return {
    commit: git('rev-parse', 'HEAD').trim(),
    tree: git('rev-parse', 'HEAD^{tree}').trim(),
    branch: git('branch', '--show-current').trim(),
    workingTreeDirty: Boolean(git('status', '--porcelain=v1', '--untracked-files=all').trim()),
    contentSha256: sha256(JSON.stringify(files)),
    files,
  };
}

export function sourceSummary(source) {
  const { files, ...summary } = source;
  return { ...summary, fileCount: files.length };
}

export function runtimeInfo() {
  return { node: process.version, platform: platform(), release: release(), arch: arch(), logicalCpus: cpus().length, cpu: cpus()[0]?.model ?? null };
}

export function discoverTests(directory, suffix) {
  return readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith(suffix)).map(entry => entry.name).sort();
}

export function artifact(path, output) {
  const bytes = readFileSync(path);
  return { path: relative(output, path).split('\\').join('/'), bytes: bytes.length, sha256: sha256(bytes) };
}

export async function runTestSuite({ root = repositoryRoot, name, cwd, files, output, coverage = false, coverageIncludes = [], timeoutMs = 12 * 60_000, testTimeoutMs = 120_000 }) {
  mkdirSync(output, { recursive: true, mode: 0o700 });
  const before = captureSource(root);
  writeJson(join(output, 'source-manifest.json'), before);
  const tapPath = join(output, 'tests.tap');
  const junitPath = join(output, 'tests.junit.xml');
  const lcovPath = join(output, 'coverage.lcov');
  for (const path of [junitPath, lcovPath]) if (existsSync(path)) unlinkSync(path);
  writeJson(join(output, 'receipt.json'), { schemaVersion: 1, kind: 'test-suite', name, status: 'RUNNING', passed: false, source: sourceSummary(before), syntheticOnly: true, realBankVerification: 'NOT_RUN' });
  const args = ['--import', guard, '--experimental-strip-types', '--test', '--test-concurrency=1', `--test-timeout=${testTimeoutMs}`,
    '--test-reporter=tap', '--test-reporter-destination=stdout', '--test-reporter=junit', `--test-reporter-destination=${junitPath}`];
  if (coverage) {
    args.push('--experimental-test-coverage', '--test-reporter=lcov', `--test-reporter-destination=${lcovPath}`);
    for (const include of coverageIncludes) args.push(`--test-coverage-include=${include}`);
    args.push('--test-coverage-exclude=**/node_modules/**', '--test-coverage-exclude=**/test/**', '--test-coverage-exclude=**/tests/**');
  }
  args.push(...files);
  const startedAt = new Date().toISOString(), start = performance.now();
  const fd = openSync(tapPath, 'w', 0o600);
  let result;
  try {
    result = files.length ? spawnSync(process.execPath, args, {
      cwd, env: cleanTestEnvironment(), stdio: ['ignore', fd, fd], timeout: timeoutMs, killSignal: 'SIGTERM',
    }) : { status: null, signal: null, error: { code: 'QUALITY_NO_TEST_FILES' } };
  } finally { closeSync(fd); }
  const log = readFileSync(tapPath, 'utf8');
  const totals = parseTapSummary(log);
  const verdict = testVerdict(result.status, totals, { errorCode: result.error?.code, signal: result.signal });
  const after = captureSource(root);
  const sourceChangedDuringRun = before.commit !== after.commit || before.contentSha256 !== after.contentSha256;
  const coverageReport = parseLcov(existsSync(lcovPath) ? readFileSync(lcovPath, 'utf8') : '');
  const report = {
    schemaVersion: 1, kind: 'test-suite', name,
    syntheticOnly: true, realBankVerification: 'NOT_RUN',
    network: 'loopback-only accidental-egress guard; synthetic provider fixtures; not a malicious-code sandbox',
    source: sourceSummary(before), sourceAfter: sourceSummary(after), sourceChangedDuringRun,
    runtime: runtimeInfo(), startedAt, finishedAt: new Date().toISOString(), durationMs: Math.round((performance.now() - start) * 1000) / 1000,
    command: { executable: process.execPath, args, cwd: relative(root, cwd) || '.' },
    files, exitCode: result.status, signal: result.signal ?? null, errorCode: result.error?.code ?? null,
    totals, complete: verdict.complete,
    passed: verdict.passed && !sourceChangedDuringRun && (!coverage || coverageReport.measured),
    failures: [...log.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map(match => match[1]).slice(0, 50),
    coverage: { requested: coverage, ...coverageReport },
    artifacts: [tapPath, junitPath, ...(coverage ? [lcovPath] : []), join(output, 'source-manifest.json')].filter(existsSync).map(path => artifact(path, output)),
  };
  writeJson(join(output, 'receipt.json'), report);
  return report;
}

export function runCommand({ name, executable, args, cwd, output, env, timeoutMs = 12 * 60_000 }) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error('QUALITY_INVALID_STEP_NAME');
  mkdirSync(output, { recursive: true, mode: 0o700 });
  const stdout = join(output, name + '.stdout.log'), stderr = join(output, name + '.stderr.log');
  const out = openSync(stdout, 'w', 0o600), err = openSync(stderr, 'w', 0o600);
  const start = performance.now(), startedAt = new Date().toISOString();
  let result;
  try { result = spawnSync(executable, args, { cwd, env, stdio: ['ignore', out, err], timeout: timeoutMs, killSignal: 'SIGTERM' }); }
  finally { closeSync(out); closeSync(err); }
  return {
    name, kind: 'command', passed: result.status === 0 && !result.error && !result.signal,
    exitCode: result.status, signal: result.signal ?? null, errorCode: result.error?.code ?? null,
    command: { executable, args, cwd }, startedAt, finishedAt: new Date().toISOString(),
    durationMs: Math.round((performance.now() - start) * 1000) / 1000,
    artifacts: [artifact(stdout, output), artifact(stderr, output)],
  };
}

export function parseAudit(text) {
  try {
    const report = JSON.parse(text), vulnerabilities = report.metadata?.vulnerabilities;
    const severities = ['info', 'low', 'moderate', 'high', 'critical'];
    if (report.error || !vulnerabilities || ![...severities, 'total'].every(key => Number.isSafeInteger(vulnerabilities[key]) && vulnerabilities[key] >= 0)
      || severities.reduce((sum, key) => sum + vulnerabilities[key], 0) !== vulnerabilities.total) return { measured: false };
    return { measured: true, vulnerabilities: Object.fromEntries([...severities, 'total'].map(key => [key, vulnerabilities[key]])) };
  } catch { return { measured: false }; }
}

const markdown = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '&#124;').replace(/[\r\n]+/g, ' ').slice(0, 500);
export function renderSummary(report) {
  const lines = [
    `# Quality evidence: ${markdown(report.profile)}`,
    '', `**${markdown(report.status)}** — commit \`${markdown(report.source?.commit)}\`; working tree dirty: ${Boolean(report.source?.workingTreeDirty)}.`,
    '', '**Synthetic acceptance only. Real bank verification: NOT_RUN. Production performance: NOT_MEASURED.**',
    '', '| Gate | Result | Tests / pass / fail / cancelled / skipped / TODO | Duration |', '| --- | --- | --- | --- |',
  ];
  const notes = [];
  for (const step of report.steps ?? []) {
    const totals = step.totals ? totalNames.map(key => step.totals[key] ?? '?').join(' / ') : '—';
    lines.push(`| ${markdown(step.name)} | ${step.passed ? 'PASS' : step.skipped ? 'NOT_RUN' : 'FAIL'} | ${totals} | ${Number.isFinite(step.durationMs) ? (step.durationMs / 1000).toFixed(2) + ' s' : '—'} |`);
    if (step.coverage?.measured) notes.push(`${markdown(step.name)} coverage: lines **${step.coverage.lines.percent}%**, branches **${step.coverage.branches.percent}%**, functions **${step.coverage.functions.percent}%** (${step.coverage.files} loaded files; unimported files are not measured).`);
    if (step.audit?.measured) notes.push(`${markdown(step.name)} vulnerabilities: ${Object.entries(step.audit.vulnerabilities).map(([key, count]) => `${key}=${count}`).join(', ')}.`);
  }
  if (notes.length) lines.push('', '## Measurements', '', ...notes.map(note => `- ${note}`));
  const failures = (report.steps ?? []).flatMap(step => (step.failures ?? []).map(failure => `${step.name}: ${failure}`));
  if (failures.length) lines.push('', '## Failures', '', ...failures.slice(0, 30).map(failure => `- ${markdown(failure)}`));
  if (report.sourceChangedDuringRun) lines.push('', '**Source inputs changed during execution; this receipt is invalid as immutable-commit evidence.**');
  lines.push('', 'Full commands, exit codes, timestamps, source manifest, log SHA-256 hashes and retained artifacts are in `receipt.json`.', '');
  return lines.join('\n');
}
