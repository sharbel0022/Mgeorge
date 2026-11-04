import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const guard = join(root, 'scripts/saas-test-isolation.mjs');
const args = process.argv.slice(2);
if (args.length > 1) throw new Error('Usage: node scripts/run-saas-security-acceptance.mjs [output-directory]');
const output = resolve(args[0] || join(tmpdir(), 'mgeorge-saas-security-acceptance'));
mkdirSync(output, { recursive: true, mode: 0o700 });

const suites = [
  {
    name: 'node-security', cwd: root,
    files: [
      'test/saas-login-boundary.test.js', 'test/saas-test-isolation.test.js',
      'test/security-session-allocation.test.js', 'test/session-mutation-fence.test.js',
      'test/bank-api.test.js', 'test/integration-job-api.test.js',
      'test/backup-disaster-recovery.test.js',
    ],
  },
  {
    name: 'sites-security', cwd: join(root, 'sites'),
    files: [
      'tests/saas-owner-isolation.test.mjs', 'tests/saas-transport-privacy.test.mjs', 'tests/saas-upload-boundary.test.mjs',
      'tests/banking-security.test.mjs', 'tests/banking-provider.test.mjs',
      'tests/bank-account-consent.test.mjs', 'tests/bank-account-commit.test.mjs',
      'tests/bank-state-integrity-q8.test.mjs', 'tests/mcp-security-q8.test.mjs',
      'tests/bankgiro-authority.test.mjs', 'tests/backup-recovery.test.mjs',
      'tests/seven-agent-0599-joined.test.mjs',
    ],
  },
];

// Fixtures install their own synthetic credentials. Pass only process/runtime
// settings, never an operator's bank, cloud, database or application secrets.
const testEnv = { NODE_ENV: 'test', CLOUDFLARE_CF_FETCH_ENABLED: 'false', WRANGLER_SEND_METRICS: 'false' };
for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ', 'NODE_OPTIONS', 'NO_COLOR', 'FORCE_COLOR', 'CI']) {
  if (process.env[key] !== undefined) testEnv[key] = process.env[key];
}

const git = (...command) => {
  const result = spawnSync('git', command, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('SAAS_EVIDENCE_SOURCE_UNAVAILABLE');
  return result.stdout.trim();
};
const report = {
  version: 1,
  sourceCommit: git('rev-parse', 'HEAD'),
  workingTreeDirty: Boolean(git('status', '--porcelain')),
  node: process.version,
  startedAt: new Date().toISOString(),
  scope: 'Existing Node administrator and Sites owner boundaries; synthetic data only.',
  multiCompanyAcceptance: 'BLOCKED_PENDING_PRODUCER_INTEGRATION',
  commercialLaunch: 'NOT_APPROVED',
  launchGates: 'docs/integration/saas/security-acceptance.md',
  network: 'Loopback only; fixture stubs replace provider responses. Guard is not a malicious-code sandbox.',
  suites: [],
};

for (const suite of suites) {
  const logPath = join(output, suite.name + '.tap');
  const fd = openSync(logPath, 'w', 0o600);
  const command = ['--import', guard, '--experimental-strip-types', '--test', '--test-concurrency=1', '--test-reporter=tap', ...suite.files];
  let result;
  try {
    result = spawnSync(process.execPath, command, {
      cwd: suite.cwd, env: testEnv, stdio: ['ignore', fd, fd], timeout: 12 * 60_000,
    });
  } finally { closeSync(fd); }
  const log = readFileSync(logPath, 'utf8');
  const count = name => {
    const matches = [...log.matchAll(new RegExp(`^# ${name} (\\d+)\\s*$`, 'gm'))];
    return matches.length ? Number(matches.at(-1)[1]) : null;
  };
  const totals = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(name => [name, count(name)]));
  const passed = result.status === 0 && totals.tests > 0 && totals.pass === totals.tests
    && ['fail', 'cancelled', 'skipped', 'todo'].every(name => totals[name] === 0);
  report.suites.push({ name: suite.name, files: suite.files, passed, exitCode: result.status, signal: result.signal, ...totals });
  console.log(`${suite.name}: ${passed ? 'PASS' : 'FAIL'} ${JSON.stringify(totals)}`);
}

report.finishedAt = new Date().toISOString();
report.regressionPassed = report.suites.every(suite => suite.passed);
writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log('Multi-company commercial launch remains gated; see docs/integration/saas/security-acceptance.md.');
console.log(`Synthetic evidence: ${output}`);
if (!report.regressionPassed) process.exitCode = 1;
