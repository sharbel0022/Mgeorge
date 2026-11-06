import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECURITY_SCOPE, SECURITY_SUITES } from './lib/saas-security-scope.mjs';
import { evidenceSource, isolatedTestEnvironment, sha256 } from './lib/saas-release-evidence.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const guard = join(root, 'scripts/saas-test-isolation.mjs');
const args = process.argv.slice(2);
if (args.length > 1) throw new Error('Usage: node scripts/run-saas-security-acceptance.mjs [output-directory]');
const output = resolve(args[0] || join(tmpdir(), 'mgeorge-saas-security-acceptance'));
mkdirSync(output, { recursive: true, mode: 0o700 });

const suites = SECURITY_SUITES.map(suite => ({ ...suite, cwd: resolve(root, suite.directory) }));
// The allowlist excludes operator credentials and NODE_OPTIONS preload code.
const testEnv = isolatedTestEnvironment();
const source = evidenceSource(root);
const report = {
  version: 2,
  ...source,
  scopeId: SECURITY_SCOPE,
  scopeManifestSha256: sha256(JSON.stringify(SECURITY_SUITES)),
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
  report.suites.push({ name: suite.name, files: suite.files, logFile: suite.name + '.tap', logSha256: sha256(log), passed, exitCode: result.status, signal: result.signal, ...totals });
  console.log(`${suite.name}: ${passed ? 'PASS' : 'FAIL'} ${JSON.stringify(totals)}`);
}

report.finishedAt = new Date().toISOString();
const after = evidenceSource(root);
report.sourceChangedDuringRun = after.sourceCommit !== source.sourceCommit || after.sourceTree !== source.sourceTree || after.workingTreeDirty;
report.regressionPassed = report.suites.every(suite => suite.passed);
report.multiCompanyAcceptance = report.regressionPassed ? 'INTERNAL_BOUNDARIES_PASSED' : 'INTERNAL_BOUNDARIES_FAILED';
report.productionAcceptance = 'NOT_VERIFIED';
writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log('Multi-company commercial launch remains gated; see docs/integration/saas/security-acceptance.md.');
console.log(`Synthetic evidence: ${output}`);
if (!report.regressionPassed) process.exitCode = 1;
