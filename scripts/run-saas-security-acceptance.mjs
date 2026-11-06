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
      'test/saas-login-boundary.test.js', 'test/saas-test-isolation.test.js', 'test/saas-security-runner.test.js', 'test/saas-company-acceptance.test.js',
      'test/company-api.test.js', 'test/company-boundary.test.js', 'test/company-client.test.js',
      'test/bank-consent-api.test.js', 'test/consent-reconnect-95.test.js',
      'test/openpayments-company-bank-sync.test.js', 'test/openpayments-company-bank-sync-normalization.test.js',
      'test/openpayments-bankgiro-ingest.test.js', 'test/openpayments-node-transport.test.js',
      'test/openpayments-runtime-transport.test.js', 'test/openpayments-runtime-disable.test.js',
      'test/openpayments-node-token-coordinator.test.js',
      'test/company-bank-sync.test.js', 'test/company-bank-sync-store.test.js',
      'test/company-bank-sync-scheduler.test.js', 'test/company-bank-sync-fairness.test.js',
      'test/company-bank-sync-legacy-binding.test.js', 'test/node-company-bank-sync.test.js',
      'test/security-session-allocation.test.js', 'test/security-login-rate-limit.test.js', 'test/session-mutation-fence.test.js',
      'test/bank-api.test.js', 'test/integration-job-api.test.js',
      'test/backup-disaster-recovery.test.js',
      'test/openpayments-token-backup.test.js',
    ],
  },
  {
    name: 'sites-security', cwd: join(root, 'sites'),
    files: [
      'tests/saas-company-acceptance.test.mjs', 'tests/company-storage.test.mjs', 'tests/company-sql-boundary-completion.test.mjs', 'tests/company-backup.test.mjs',
      'tests/openpayments-lifecycle.test.mjs', 'tests/openpayments-expired-revocation.test.mjs', 'tests/saas-bank-runtime.test.mjs',
      'tests/openpayments-company-sync.test.mjs', 'tests/openpayments-account-state.test.mjs',
      'tests/openpayments-request-boundary.test.mjs', 'tests/openpayments-raw-receipt.test.mjs',
      'tests/openpayments-capture.test.mjs', 'tests/openpayments-ingest.test.mjs', 'tests/openpayments-domain.test.mjs',
      'tests/company-bank-sync.test.mjs', 'tests/company-bank-sync-backup.test.mjs',
      'tests/company-sync-boundary-integration.test.mjs', 'tests/company-sync-scale.test.mjs',
      'tests/saas-onboarding-server.test.mjs', 'tests/saas-onboarding-projection.test.mjs',
      'tests/saas-onboarding-contract.test.mjs', 'tests/saas-onboarding-client.test.mjs', 'tests/saas-onboarding-views.test.mjs',
      'tests/openpayments-provider.test.mjs', 'tests/openpayments-policy.test.mjs', 'tests/openpayments-http.test.mjs',
      'tests/openpayments-workers-transport.test.mjs', 'tests/openpayments-workers-runtime.test.mjs',
      'tests/openpayments-token-cache.test.mjs',
      'tests/openpayments-token-coordinator.test.mjs',
      'tests/openpayments-sites-token-coordinator.test.mjs', 'tests/openpayments-token-migration.test.mjs',
      'tests/openpayments-token-fence.test.mjs', 'tests/openpayments-token-d1.test.mjs',
      'tests/saas-owner-isolation.test.mjs', 'tests/saas-transport-privacy.test.mjs', 'tests/saas-upload-boundary.test.mjs',
      'tests/security-request-budget.test.mjs',
      'tests/banking-security.test.mjs', 'tests/banking-provider.test.mjs',
      'tests/bank-account-consent.test.mjs', 'tests/bank-account-commit.test.mjs',
      'tests/bank-state-integrity-q8.test.mjs', 'tests/mcp-security-q8.test.mjs',
      'tests/bankgiro-authority.test.mjs', 'tests/backup-recovery.test.mjs',
      'tests/recovery-drill.test.mjs',
      'tests/seven-agent-0599-joined.test.mjs',
    ],
  },
];

// Fixtures install their own synthetic credentials. Pass only process/runtime
// settings, never an operator's bank, cloud, database or application secrets.
// NODE_OPTIONS can preload operator code before the guard and must not be inherited.
const testEnv = { NODE_ENV: 'test', CLOUDFLARE_CF_FETCH_ENABLED: 'false', WRANGLER_SEND_METRICS: 'false' };
for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ', 'NO_COLOR', 'FORCE_COLOR', 'CI']) {
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
  scope: 'Actual three-company Node SQLite partitions and Sites D1/R2 role boundaries; company switching/cache fencing; Open Payments lifecycle, configured Node/Workers mTLS, application token coordination, expired consent recovery, durable sync and Bankgiro originals; real onboarding snapshot; isolated backup recovery; 1/10/100-tenant durable runner scale. Synthetic data only.',
  tenantRoleCoverage: { minimumCompanies: 3, roles: ['owner', 'admin', 'accountant', 'viewer'], suites: ['test/saas-company-acceptance.test.js', 'tests/saas-company-acceptance.test.mjs'] },
  scaleCoverage: { companies: [1, 10, 100], suite: 'tests/company-sync-scale.test.mjs', externalProviderPerformance: 'NOT_MEASURED' },
  multiCompanyAcceptance: 'PENDING_INTEGRATED_INTERNAL_RUN',
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
report.multiCompanyAcceptance = report.regressionPassed ? 'INTERNAL_BOUNDARIES_PASSED' : 'INTERNAL_BOUNDARIES_FAILED';
report.productionAcceptance = 'NOT_VERIFIED';
writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log('Multi-company commercial launch remains gated; see docs/integration/saas/security-acceptance.md.');
console.log(`Synthetic evidence: ${output}`);
if (!report.regressionPassed) process.exitCode = 1;
