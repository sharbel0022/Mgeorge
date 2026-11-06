import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { captureSource, sourceSummary, runtimeInfo, cleanTestEnvironment, runCommand, writeJson, repositoryRoot as root } from './core.mjs';

if (process.argv.length !== 3) throw new Error('Usage: node scripts/quality/browser.mjs <output-directory>');
const output = resolve(process.argv[2]);
mkdirSync(output, { recursive: true, mode: 0o700 });
const before = captureSource(root);
const report = {
  schemaVersion: 1, kind: 'browser-acceptance', passed: false, status: 'RUNNING',
  syntheticOnly: true, realBankVerification: 'NOT_RUN',
  scope: 'Actual bundled onboarding UI in Chromium; API responses are intercepted synthetic fixtures. Backend and provider end-to-end coverage is not claimed.',
  source: sourceSummary(before), runtime: runtimeInfo(), startedAt: new Date().toISOString(), steps: [],
};
writeJson(join(output, 'receipt.json'), report);
writeJson(join(output, 'source-manifest.json'), before);
for (const result of ['harness/results/acceptance-results.json', 'workspace/workspace-results.json']) {
  const path = join(output, result); if (existsSync(path)) unlinkSync(path);
}
try {
  const require = createRequire(join(root, 'qa/browser/package.json'));
  const playwright = require.resolve('playwright');
  report.playwrightVersion = require('playwright/package.json').version;
  const env = {
    ...cleanTestEnvironment(), MGEORGE_ONBOARDING_QA: join(output, 'harness'), PLAYWRIGHT_MODULE_PATH: playwright,
    ...(process.env.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH } : {}),
    ...(process.env.MGEORGE_QA_CHROMIUM ? { MGEORGE_QA_CHROMIUM: process.env.MGEORGE_QA_CHROMIUM } : {}),
  };
  // No caller-provided filter/preview/base URL is forwarded: every case runs,
  // and the product harness permits only its own loopback fixture server.
  for (const [name, path] of [['bundle', 'docs/integration/saas-onboarding-browser/build-harness.mjs'], ['chromium', 'docs/integration/saas-onboarding-browser/browser-suite.mjs']]) {
    const step = runCommand({ name, executable: process.execPath, args: [path], cwd: root, output, env, timeoutMs: 12 * 60_000 });
    report.steps.push(step); writeJson(join(output, 'receipt.json'), report);
    if (!step.passed) break;
  }
  const resultPath = join(output, 'harness/results/acceptance-results.json');
  let isolatedPassed = false;
  if (existsSync(resultPath)) {
    const result = JSON.parse(readFileSync(resultPath, 'utf8'));
    report.totals = { tests: result.results.length, pass: result.passed, fail: result.failed, cancelled: 0, skipped: 0, todo: 0 };
    report.browserVersion = result.browserVersion;
    report.externalRequests = result.externalRequests.length;
    report.browserErrors = result.browserErrors.length;
    report.failures = result.results.filter(item => !item.passed).map(item => ({ name: item.name, error: item.error }));
    isolatedPassed = result.success === true && result.omitted.length === 0 && result.runnerErrors.length === 0
      && report.steps.length === 2 && report.steps.every(step => step.passed)
      && result.results.length >= 41 && result.passed === result.results.length && result.failed === 0
      && result.externalRequests.length === 0 && result.browserErrors.length === 0
      && result.assetChecks.length > 0 && result.assetChecks.every(item => item.match === true);
  }
  const workspaceEnv = { ...env, MGEORGE_ONBOARDING_QA: join(output, 'workspace'), MGEORGE_ONBOARDING_WORKSPACE: 'true' };
  for (const [name, path] of [['workspace-bundle', 'docs/integration/saas-onboarding-browser/build-harness.mjs'], ['workspace-chromium', 'scripts/quality/workspace-browser.mjs']]) {
    const step = runCommand({ name, executable: process.execPath, args: [path], cwd: root, output, env: workspaceEnv, timeoutMs: 5 * 60_000 });
    report.steps.push(step); writeJson(join(output, 'receipt.json'), report);
    if (!step.passed) break;
  }
  const workspacePath = join(output, 'workspace/workspace-results.json');
  if (existsSync(workspacePath)) {
    const workspace = JSON.parse(readFileSync(workspacePath, 'utf8'));
    report.workspace = { passed: workspace.passed, tests: workspace.results.length, failures: workspace.results.filter(item => !item.passed) };
    if (report.totals) {
      report.totals.tests += workspace.results.length;
      report.totals.pass += workspace.results.filter(item => item.passed).length;
      report.totals.fail += workspace.results.filter(item => !item.passed).length;
    }
    report.passed = isolatedPassed && workspace.passed === true && report.steps.length === 4 && report.steps.every(step => step.passed);
  }
} catch (error) {
  report.errorCode = error.code ?? error.name;
  report.error = String(error.message).slice(0, 1000);
} finally {
  const after = captureSource(root);
  report.sourceAfter = sourceSummary(after);
  report.sourceChangedDuringRun = before.commit !== after.commit || before.contentSha256 !== after.contentSha256;
  report.passed &&= !report.sourceChangedDuringRun;
  report.status = report.passed ? 'PASSED' : 'FAILED';
  report.finishedAt = new Date().toISOString();
  writeJson(join(output, 'receipt.json'), report);
  console.log(JSON.stringify({ passed: report.passed, totals: report.totals ?? null, realBankVerification: 'NOT_RUN' }));
  process.exitCode = report.passed ? 0 : 1;
}
