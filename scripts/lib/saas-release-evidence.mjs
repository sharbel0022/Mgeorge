import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  SECURITY_SCOPE, SECURITY_SUITES, RECOVERY_SCOPE, RECOVERY_COMMAND, RECOVERY_REJECTIONS,
} from './saas-security-scope.mjs';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
const equal = isDeepStrictEqual;
const hex = (value, length) => typeof value === 'string' && new RegExp('^[a-f0-9]{' + length + '}$').test(value);
const requireEvidence = (ok, reason) => {
  if (!ok) throw Object.assign(new Error('SAAS_RELEASE_EVIDENCE_' + reason), { code: 'SAAS_RELEASE_EVIDENCE_' + reason });
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function evidenceSource(root, env = process.env) {
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    requireEvidence(result.status === 0, 'SOURCE_UNAVAILABLE');
    return result.stdout.trim();
  };
  return {
    sourceCommit: git('rev-parse', 'HEAD'),
    sourceTree: git('rev-parse', 'HEAD^{tree}'),
    workingTreeDirty: Boolean(git('status', '--porcelain')),
    sourceContext: {
      event: env.GITHUB_EVENT_NAME || null,
      checkoutCommit: env.GITHUB_SHA || null,
      headCommit: env.SAAS_EVIDENCE_HEAD_SHA || null,
      baseCommit: env.SAAS_EVIDENCE_BASE_SHA || null,
      runId: env.GITHUB_RUN_ID || null,
      runAttempt: env.GITHUB_RUN_ATTEMPT || null,
    },
  };
}

export function isolatedTestEnvironment(env = process.env) {
  const result = { NODE_ENV: 'test', CLOUDFLARE_CF_FETCH_ENABLED: 'false', WRANGLER_SEND_METRICS: 'false' };
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ', 'NO_COLOR', 'FORCE_COLOR', 'CI']) {
    if (env[key] !== undefined) result[key] = env[key];
  }
  return result;
}

export function tapTotals(log) {
  const totals = {};
  for (const name of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const matches = [...log.matchAll(new RegExp('^# ' + name + ' (\\d+)\\s*$', 'gm'))];
    requireEvidence(matches.length === 1, 'TAP_SUMMARY');
    const count = Number(matches[0][1]);
    requireEvidence(Number.isSafeInteger(count), 'TAP_SUMMARY');
    totals[name] = count;
  }
  requireEvidence(!/^\s*(?:not ok\b|Bail out!)/m.test(log), 'TAP_FAILURE');
  requireEvidence(totals.tests > 0 && totals.pass === totals.tests
    && ['fail', 'cancelled', 'skipped', 'todo'].every(name => totals[name] === 0), 'TAP_INCOMPLETE');
  return totals;
}

function timestamp(value) {
  requireEvidence(typeof value === 'string', 'TIME');
  const time = Date.parse(value);
  requireEvidence(Number.isFinite(time) && new Date(time).toISOString() === value, 'TIME');
  return time;
}

function verifySource(report, expectedSource, now) {
  requireEvidence(object(report) && report.version === 2, 'FORMAT');
  requireEvidence(object(expectedSource) && hex(expectedSource.sourceCommit, 40) && hex(expectedSource.sourceTree, 40), 'EXPECTED_SOURCE');
  requireEvidence(report.sourceCommit === expectedSource.sourceCommit && report.sourceTree === expectedSource.sourceTree, 'SOURCE');
  requireEvidence(report.workingTreeDirty === false && expectedSource.workingTreeDirty === false
    && report.sourceChangedDuringRun === false, 'DIRTY_SOURCE');
  requireEvidence(object(report.sourceContext) && equal(report.sourceContext, expectedSource.sourceContext), 'SOURCE_CONTEXT');
  const context = report.sourceContext;
  if (context.checkoutCommit !== null) {
    requireEvidence(context.checkoutCommit === report.sourceCommit && hex(context.headCommit, 40)
      && hex(context.baseCommit, 40) && /^\d+$/.test(context.runId) && /^\d+$/.test(context.runAttempt), 'SOURCE_CONTEXT');
  } else {
    requireEvidence(Object.values(context).every(value => value === null), 'SOURCE_CONTEXT');
  }
  requireEvidence(typeof report.node === 'string' && /^v(?:22|24)\.\d+\.\d+$/.test(report.node), 'RUNTIME');
  const start = timestamp(report.startedAt), finish = timestamp(report.finishedAt);
  requireEvidence(Number.isFinite(now) && start <= finish && finish <= now + 300_000
    && now - start <= 86_400_000, 'STALE_OR_FUTURE');
  requireEvidence(report.productionAcceptance === 'NOT_VERIFIED' && report.commercialLaunch === 'NOT_APPROVED', 'LAUNCH_CLAIM');
  return { start, finish };
}

function verifyScale(log) {
  const observations = [];
  for (const match of log.matchAll(/^\s*# (\{[^\r\n]+\})\s*$/gm)) {
    let value;
    try { value = JSON.parse(match[1]); } catch { continue; }
    if (value?.kind === 'synthetic_tenant_database_and_scheduler') observations.push(value);
  }
  requireEvidence(observations.length === 3, 'CONCURRENCY');
  for (const count of [1, 10, 100]) {
    const rows = observations.filter(row => row.companies === count);
    requireEvidence(rows.length === 1, 'CONCURRENCY');
    const row = rows[0], expected = Math.min(5, count);
    requireEvidence(row.concurrency === 5 && row.observedPeakConcurrency === expected
      && row.replayObservedPeakConcurrency === expected && row.receipts === count
      && row.providerNetwork === false && row.financialWrites === 0, 'CONCURRENCY');
  }
}

export function verifySecurityEvidence({ report, logs, expectedSource, now = Date.now() }) {
  verifySource(report, expectedSource, now);
  requireEvidence(report.scopeId === SECURITY_SCOPE && report.scopeManifestSha256 === sha256(JSON.stringify(SECURITY_SUITES)), 'SCOPE');
  requireEvidence(report.regressionPassed === true && report.multiCompanyAcceptance === 'INTERNAL_BOUNDARIES_PASSED', 'RESULT');
  requireEvidence(Array.isArray(report.suites) && report.suites.length === SECURITY_SUITES.length, 'SUITES');
  requireEvidence(object(logs) && equal(Object.keys(logs).sort(), SECURITY_SUITES.map(suite => suite.name).sort()), 'LOGS');
  let tests = 0;
  for (const expected of SECURITY_SUITES) {
    const matches = report.suites.filter(suite => suite?.name === expected.name);
    requireEvidence(matches.length === 1, 'SUITES');
    const suite = matches[0], log = logs[expected.name];
    requireEvidence(equal(suite.files, expected.files), 'FILES');
    requireEvidence(typeof log === 'string' && suite.logFile === expected.name + '.tap'
      && hex(suite.logSha256, 64) && suite.logSha256 === sha256(log), 'LOG_HASH');
    requireEvidence(suite.passed === true && suite.exitCode === 0 && suite.signal === null, 'RESULT');
    const totals = tapTotals(log);
    requireEvidence(totals.tests >= expected.files.length, 'COVERAGE');
    for (const [key, value] of Object.entries(totals)) requireEvidence(suite[key] === value, 'TOTALS');
    tests += totals.tests;
    if (expected.name === 'sites-security') verifyScale(log);
  }
  return { accepted: true, scope: SECURITY_SCOPE, sourceCommit: report.sourceCommit, sourceTree: report.sourceTree, tests,
    productionAcceptance: 'NOT_VERIFIED', commercialLaunch: 'NOT_APPROVED' };
}

export function verifyRecoveryEvidence({ report, recoveryJson, expectedSource, now = Date.now() }) {
  const time = verifySource(report, expectedSource, now);
  requireEvidence(report.scopeId === RECOVERY_SCOPE && equal(report.command, RECOVERY_COMMAND)
    && report.scopeManifestSha256 === sha256(JSON.stringify(RECOVERY_COMMAND)), 'SCOPE');
  requireEvidence(report.exitCode === 0 && report.signal === null && report.recoveryPassed === true, 'RESULT');
  requireEvidence(report.outputFile === 'recovery-drill.json' && typeof recoveryJson === 'string'
    && hex(report.outputSha256, 64) && report.outputSha256 === sha256(recoveryJson), 'RECOVERY_HASH');
  let recovery;
  try { recovery = JSON.parse(recoveryJson); } catch { requireEvidence(false, 'RECOVERY_JSON'); }
  requireEvidence(object(recovery) && recovery.format === 'MG-Sites-synthetic-recovery-drill-1'
    && recovery.scope === 'synthetic-isolated-evidence-only' && recovery.accepted === true
    && recovery.productionRestoreTested === false, 'RECOVERY_SCOPE');
  requireEvidence(timestamp(recovery.startedAt) >= time.start && timestamp(recovery.completedAt) <= time.finish
    && timestamp(recovery.startedAt) <= timestamp(recovery.completedAt), 'TIME');
  requireEvidence(recovery.runtime?.node === report.node, 'RUNTIME');
  requireEvidence(equal(recovery.originals, { count: 430, bytes: 185567855, hashesChecked: 430 }), 'RECOVERY_ORIGINALS');
  requireEvidence(Array.isArray(recovery.tables) && recovery.tables.length === 27
    && new Set(recovery.tables.map(table => table.name)).size === 27
    && recovery.tables.every(table => object(table) && /^[a-z_]+$/.test(table.name) && Number.isSafeInteger(table.rows) && table.rows > 0), 'RECOVERY_TABLES');
  requireEvidence(recovery.ledger?.invoices === 2 && recovery.ledger.invoiceCents === 75000
    && recovery.ledger.allocatedCents === 62500, 'RECOVERY_LEDGER');
  for (const key of ['sourceUnchanged', 'otherOwnerExcluded', 'authorizationAndTransientRowsAbsent',
    'workerLeasesInvalidated', 'applicationTokenRecoveryBlocked', 'sourceProvenanceVerified']) {
    requireEvidence(recovery[key] === true, 'RECOVERY_BOUNDARY');
  }
  const provenance = recovery.provenance;
  requireEvidence(object(provenance) && typeof provenance.backupId === 'string' && provenance.backupId.length > 0
    && equal(provenance.companyBoundary, { version: 'company-data-boundary-v1', companyId: 'synthetic-company', storageOwner: 'synthetic-isolated-recovery-owner', boundaryVersion: 1 })
    && hex(provenance.snapshotSha256, 64) && hex(provenance.tableCensusSha256, 64)
    && hex(provenance.originalCensusSha256, 64) && object(provenance.sourceFiles)
    && equal(Object.keys(provenance.sourceFiles).sort(), ['bundle.json', 'manifest.bin', 'snapshot.bin'])
    && Object.values(provenance.sourceFiles).every(hash => hex(hash, 64)), 'RECOVERY_PROVENANCE');
  requireEvidence(Array.isArray(recovery.rejectionChecks) && recovery.rejectionChecks.length === RECOVERY_REJECTIONS.length, 'RECOVERY_REJECTIONS');
  for (const name of RECOVERY_REJECTIONS) {
    const rows = recovery.rejectionChecks.filter(row => row?.case === name);
    requireEvidence(rows.length === 1 && rows[0].rejected === true, 'RECOVERY_REJECTIONS');
    if (['wrong_key', 'wrong_owner', 'wrong_company', 'corrupt_original', 'missing_original'].includes(name)) {
      requireEvidence(rows[0].stage === 'restore' && rows[0].outputCreated === false, 'RECOVERY_REJECTIONS');
    }
  }
  requireEvidence(recovery.resume?.interruptionObserved === true && recovery.resume.snapshotPreserved === true, 'RECOVERY_RESUME');
  requireEvidence(recovery.objectives?.isolatedRtoMilliseconds === 60000
    && recovery.objectives.simulatedRpoMilliseconds === 900000
    && Number.isFinite(recovery.timing?.restoreAndAcceptanceMilliseconds)
    && recovery.timing.restoreAndAcceptanceMilliseconds > 0
    && recovery.timing.restoreAndAcceptanceMilliseconds <= 60000
    && recovery.simulatedRecovery?.rpoMilliseconds === 900000
    && recovery.simulatedRecovery.postSnapshotWritesExcluded === 1, 'RECOVERY_OBJECTIVES');
  return { accepted: true, scope: RECOVERY_SCOPE, sourceCommit: report.sourceCommit, sourceTree: report.sourceTree,
    originals: 430, originalBytes: 185567855, tables: 27, rejectionChecks: recovery.rejectionChecks.length,
    productionAcceptance: 'NOT_VERIFIED', commercialLaunch: 'NOT_APPROVED' };
}
