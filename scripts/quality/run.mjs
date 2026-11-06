import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { captureSource, sourceSummary, runtimeInfo, writeJson, runCommand, runTestSuite, discoverTests, parseAudit, benchmarkVerdict, renderSummary, repositoryRoot as root } from './core.mjs';

const args = process.argv.slice(2);
const profile = args.shift();
const skipInstall = args.includes('--skip-install');
const paths = args.filter(arg => arg !== '--skip-install');
if (!['node', 'sites', 'bridge', 'performance', 'browser'].includes(profile) || paths.length > 1 || paths.some(arg => arg.startsWith('--'))) {
  throw new Error('Usage: npm run quality:<node|sites|bridge|performance|browser> -- [output-directory] [--skip-install]');
}
if (!process.env.npm_execpath || !existsSync(process.env.npm_execpath)) throw new Error('Invoke quality profiles through npm run so the exact npm CLI is known.');
const npmCli = process.env.npm_execpath;
const output = resolve(paths[0] || join(tmpdir(), 'mgeorge-quality', profile));
mkdirSync(output, { recursive: true, mode: 0o700 });
const before = captureSource(root), start = performance.now();
const report = {
  schemaVersion: 1, kind: 'quality-job', profile, status: 'RUNNING', passed: false,
  syntheticOnly: true, realBankVerification: 'NOT_RUN', productionPerformance: 'NOT_MEASURED',
  source: sourceSummary(before), runtime: runtimeInfo(),
  github: { runId: process.env.GITHUB_RUN_ID ?? null, runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null, event: process.env.GITHUB_EVENT_NAME ?? null, checkoutSha: process.env.GITHUB_SHA ?? null, pullRequestHeadSha: process.env.QUALITY_PR_HEAD_SHA ?? null, pullRequestBaseSha: process.env.QUALITY_PR_BASE_SHA ?? null },
  installExecuted: !skipInstall, startedAt: new Date().toISOString(), steps: [],
};
writeJson(join(output, 'source-manifest.json'), before);
const save = () => {
  writeJson(join(output, 'receipt.json'), report);
  writeFileSync(join(output, 'summary.md'), renderSummary(report), { mode: 0o600 });
};
save();

// Package installation/audit need the configured proxy and CA. Test children
// receive core.mjs's smaller credential-free, loopback-only environment instead.
const toolEnv = { TZ: 'UTC', CLOUDFLARE_CF_FETCH_ENABLED: 'false', WRANGLER_SEND_METRICS: 'false' };
for (const [key, value] of Object.entries(process.env)) {
  if (/^(?:PATH|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|SystemRoot|WINDIR|TMPDIR|TMP|TEMP|LANG|LC_ALL|CI|NO_COLOR|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS)$/.test(key)
    || /^(?:CODEX_PRIMARY_RUNTIME_|npm_config_(?:proxy|http_proxy|https_proxy|cache|registry|cafile|userconfig)|NPM_CONFIG_(?:PROXY|HTTP_PROXY|HTTPS_PROXY|CACHE|REGISTRY|CAFILE|USERCONFIG))/.test(key)) toolEnv[key] = value;
}
function command(name, executable, commandArgs, cwd = root, extra = {}) {
  console.log(`[quality:${profile}] ${name}`);
  const step = runCommand({ name, executable, args: commandArgs, cwd, output, env: { ...toolEnv, ...extra }, timeoutMs: 20 * 60_000 });
  report.steps.push(step); save();
  console.log(`[quality:${profile}] ${name}: ${step.passed ? 'PASS' : 'FAIL'} (${(step.durationMs / 1000).toFixed(2)} s)`);
  return step;
}
const npm = (name, commandArgs, cwd = root, extra) => command(name, process.execPath, [npmCli, ...commandArgs], cwd, extra);
function audit(cwd, scope) {
  const step = npm(`audit-${scope}`, ['audit', '--json', '--audit-level=high', ...(scope === 'production' ? ['--omit=dev'] : [])], cwd);
  step.audit = parseAudit(readFileSync(join(output, `${step.name}.stdout.log`), 'utf8'));
  step.passed = step.passed && step.audit.measured && step.audit.vulnerabilities.high === 0 && step.audit.vulnerabilities.critical === 0;
  save();
}
async function suite(name, cwd, directory, suffix, coverageIncludes) {
  console.log(`[quality:${profile}] ${name}: running complete suite with TAP/JUnit/LCOV`);
  const files = discoverTests(join(cwd, directory), suffix).map(file => `${directory}/${file}`);
  const step = await runTestSuite({ name, root, cwd, files, output: join(output, 'tests'), coverage: true, coverageIncludes, timeoutMs: 30 * 60_000, testTimeoutMs: 180_000 });
  step.artifactDirectory = 'tests'; report.steps.push(step); save();
  console.log(`[quality:${profile}] ${name}: ${step.passed ? 'PASS' : 'FAIL'} ${JSON.stringify(step.totals)}`);
}

try {
  const installs = [];
  if (!skipInstall) {
    if (['node', 'sites', 'performance'].includes(profile)) installs.push(npm('install-node', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']));
    if (['sites', 'browser'].includes(profile)) installs.push(npm('install-sites', ['run', 'install:ci'], join(root, 'sites')));
    if (['sites', 'bridge'].includes(profile)) installs.push(npm('install-bridge', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], join(root, 'bridge/bankgiro')));
    if (profile === 'browser') {
      const installed = npm('install-browser-tooling', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], join(root, 'qa/browser'));
      installs.push(installed);
      if (installed.passed) installs.push(npm('install-chromium', ['run', 'install:chromium'], join(root, 'qa/browser')));
    }
  }
  if (installs.some(step => !step.passed)) {
    report.steps.push({ name: 'dependent-checks', skipped: true, passed: false, reason: 'locked dependency installation failed' });
  } else if (profile === 'node') {
    npm('syntax', ['run', 'check']); audit(root, 'production'); audit(root, 'all');
    await suite('node-tests', root, 'test', '.test.js', ['src/**', 'sites/lib/**']);
  } else if (profile === 'sites') {
    const sites = join(root, 'sites');
    command('minimatch-mitigation', process.execPath, ['scripts/minimatch-backport.mjs', '--check', '--require-target'], sites);
    npm('typecheck', ['run', 'check'], sites); audit(sites, 'production'); audit(sites, 'all');
    await suite('sites-tests', sites, 'tests', '.test.mjs', ['lib/**', 'app/**', 'components/**', '../src/**']);
    npm('production-build', ['run', 'build'], sites, { NODE_ENV: 'production' });
  } else if (profile === 'bridge') {
    const bridge = join(root, 'bridge/bankgiro');
    npm('syntax', ['run', 'check'], bridge); audit(bridge, 'production'); audit(bridge, 'all');
    await suite('bridge-tests', bridge, 'test', '.test.js', ['src/**']);
  } else if (profile === 'performance') {
    const benchmarkPath = join(output, 'benchmark.json');
    rmSync(benchmarkPath, { force: true });
    const step = command('company-benchmark', process.execPath, ['--import', './scripts/saas-test-isolation.mjs', 'scripts/quality/benchmark-companies.mjs', '--output', benchmarkPath], root, { NODE_ENV: 'test' });
    if (existsSync(benchmarkPath)) step.benchmark = JSON.parse(readFileSync(benchmarkPath, 'utf8'));
    step.passed &&= benchmarkVerdict(step.benchmark, before.commit).passed;
    if (!step.passed) step.failures = ['Benchmark process or structured 1/10/100-company correctness evidence failed.'];
    save();
  } else if (profile === 'browser') {
    audit(join(root, 'qa/browser'), 'all');
    const step = command('browser-acceptance', process.execPath, ['scripts/quality/browser.mjs', join(output, 'browser')], root, {
      ...(process.env.MGEORGE_QA_CHROMIUM ? { MGEORGE_QA_CHROMIUM: process.env.MGEORGE_QA_CHROMIUM } : {}),
      ...(process.env.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH } : {}),
    });
    const receipt = join(output, 'browser/receipt.json');
    if (existsSync(receipt)) { step.browser = JSON.parse(readFileSync(receipt, 'utf8')); step.totals = step.browser.totals; step.failures = [...(step.browser.failures ?? []).map(item => item.name), ...(step.browser.workspace?.failures ?? []).map(item => item.name)]; step.passed &&= step.browser.passed === true; }
    else step.passed = false;
    save();
  }
} catch (error) {
  report.steps.push({ name: 'runner-error', passed: false, errorCode: error.code ?? error.name, failures: [String(error.message).slice(0, 800)] });
} finally {
  const after = captureSource(root);
  report.sourceAfter = sourceSummary(after);
  report.sourceChangedDuringRun = before.commit !== after.commit || before.contentSha256 !== after.contentSha256;
  report.finishedAt = new Date().toISOString(); report.durationMs = Math.round((performance.now() - start) * 1000) / 1000;
  report.passed = report.steps.length > 0 && report.steps.every(step => step.passed === true) && !report.sourceChangedDuringRun;
  report.status = report.passed ? 'PASSED' : 'FAILED'; save();
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, readFileSync(join(output, 'summary.md')));
  if (!report.passed) console.error(`::error title=Quality ${profile} failed::Inspect the retained receipt, TAP/JUnit and command logs. Synthetic-only verification.`);
  console.log(`[quality:${profile}] ${report.status}: ${join(output, 'receipt.json')}`);
  process.exitCode = report.passed ? 0 : 1;
}
