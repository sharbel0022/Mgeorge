import assert from 'node:assert/strict';
import test from 'node:test';
import { SECURITY_SCOPE, SECURITY_SUITES, RECOVERY_SCOPE, RECOVERY_COMMAND, RECOVERY_REJECTIONS } from '../scripts/lib/saas-security-scope.mjs';
import { sha256, tapTotals, verifySecurityEvidence, verifyRecoveryEvidence, isolatedTestEnvironment } from '../scripts/lib/saas-release-evidence.mjs';

// Independent literal restore contract; do not derive this from the receipt under test.
const recoveryTables = ["workspaces","audit_events","documents","bank_applications","bank_connections","bank_sync_runs","gmail_connections","customer_contacts","customer_messages","reconciliation_findings","customer_deliveries","gmail_sources","gmail_runs","document_automation","document_jobs","document_extractions","invoice_counterparties","document_registrations","payment_control_runs","payment_control_requests","bankgiro_ingest_sources","bankgiro_ingest_jobs","saas_bank_state","company_bank_sync_scopes","company_bank_sync_jobs","company_bank_sync_requests","company_bank_sync_receipts"];
const now = Date.parse('2026-11-06T15:00:00.000Z');
const startedAt = '2026-11-06T14:58:00.000Z', finishedAt = '2026-11-06T14:59:00.000Z';
const source = () => ({
  sourceCommit: 'a'.repeat(40), sourceTree: 'b'.repeat(40), workingTreeDirty: false,
  sourceContext: { event: null, checkoutCommit: null, headCommit: null, baseCommit: null, runId: null, runAttempt: null },
});
const common = () => ({
  version: 2, ...source(), sourceChangedDuringRun: false, node: 'v24.22.1', startedAt, finishedAt,
  productionAcceptance: 'NOT_VERIFIED', commercialLaunch: 'NOT_APPROVED',
});
const summary = count => '# tests ' + count + '\n# pass ' + count + '\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
const scale = () => [1, 10, 100].map(companies => '# ' + JSON.stringify({
  kind: 'synthetic_tenant_database_and_scheduler', companies, concurrency: 5,
  observedPeakConcurrency: Math.min(5, companies), replayObservedPeakConcurrency: Math.min(5, companies),
  receipts: companies, providerNetwork: false, financialWrites: 0,
})).join('\n') + '\n';
function security() {
  const logs = {}, report = { ...common(), scopeId: SECURITY_SCOPE,
    scopeManifestSha256: sha256(JSON.stringify(SECURITY_SUITES)),
    regressionPassed: true, multiCompanyAcceptance: 'INTERNAL_BOUNDARIES_PASSED', suites: [] };
  for (const suite of SECURITY_SUITES) {
    logs[suite.name] = (suite.name === 'sites-security' ? scale() : '') + summary(suite.files.length + 5);
    report.suites.push({ name: suite.name, files: [...suite.files], logFile: suite.name + '.tap',
      logSha256: sha256(logs[suite.name]), passed: true, exitCode: 0, signal: null, ...tapTotals(logs[suite.name]) });
  }
  return { report, logs, expectedSource: source(), now };
}
function recovery() {
  const restored = {
    format: 'MG-Sites-synthetic-recovery-drill-1', scope: 'synthetic-isolated-evidence-only',
    productionRestoreTested: false, accepted: true, startedAt, completedAt: finishedAt,
    runtime: { node: 'v24.22.1' }, originals: { count: 430, bytes: 185567855, hashesChecked: 430 },
    tables: recoveryTables.map(name => ({ name, rows: 1 })),
    ledger: { invoices: 2, invoiceCents: 75000, transactions: 2, transactionCents: 75000,
      allocations: 1, allocatedCents: 62500, revokedCredits: 1, revokedBankgiroLinks: 1 },
    sourceUnchanged: true, otherOwnerExcluded: true, authorizationAndTransientRowsAbsent: true,
    workerLeasesInvalidated: true, applicationTokenRecoveryBlocked: true, sourceProvenanceVerified: true,
    provenance: { backupId: '12345678-1234-4123-8123-123456789abc', companyBoundary: { version: 'company-data-boundary-v1', companyId: 'synthetic-company', storageOwner: 'synthetic-isolated-recovery-owner', boundaryVersion: 1 }, snapshotSha256: 'a'.repeat(64), tableCensusSha256: 'b'.repeat(64),
      originalCensusSha256: 'c'.repeat(64), sourceFiles: { 'bundle.json': 'd'.repeat(64), 'manifest.bin': 'e'.repeat(64), 'snapshot.bin': 'f'.repeat(64) } },
    rejectionChecks: RECOVERY_REJECTIONS.map((name, index) => ({ case: name, rejected: true,
      stage: index < 5 ? 'restore' : 'acceptance', ...(index < 5 ? { outputCreated: false } : {}) })),
    resume: { interruptionObserved: true, snapshotPreserved: true },
    objectives: { isolatedRtoMilliseconds: 60000, simulatedRpoMilliseconds: 900000 },
    timing: { restoreAndAcceptanceMilliseconds: 1000 },
    simulatedRecovery: { rpoMilliseconds: 900000, postSnapshotWritesExcluded: 1 },
  };
  const report = { ...common(), scopeId: RECOVERY_SCOPE, command: [...RECOVERY_COMMAND],
    scopeManifestSha256: sha256(JSON.stringify(RECOVERY_COMMAND)), exitCode: 0, signal: null,
    recoveryPassed: true, outputFile: 'recovery-drill.json' };
  const fixture = { report, recoveryJson: '', expectedSource: source(), now, restored };
  seal(fixture);
  return fixture;
}
function seal(fixture) { fixture.recoveryJson = JSON.stringify(fixture.restored); fixture.report.outputSha256 = sha256(fixture.recoveryJson); }
function replaceLog(fixture, name, change) {
  fixture.logs[name] = change(fixture.logs[name]);
  fixture.report.suites.find(suite => suite.name === name).logSha256 = sha256(fixture.logs[name]);
}

test('a complete fresh security receipt remains internal evidence without commercial approval', () => {
  const fixture = security(), result = verifySecurityEvidence(fixture);
  assert.equal(result.accepted, true);
  assert.equal(result.tests, SECURITY_SUITES.reduce((sum, suite) => sum + suite.files.length + 5, 0));
  assert.equal(result.productionAcceptance, 'NOT_VERIFIED');
  assert.equal(result.commercialLaunch, 'NOT_APPROVED');
});
test('a GitHub merge checkout is bound separately from PR head and base commits', () => {
  const fixture = security();
  const context = { event: 'pull_request', checkoutCommit: fixture.report.sourceCommit, headCommit: 'c'.repeat(40),
    baseCommit: 'd'.repeat(40), runId: '123', runAttempt: '1' };
  fixture.report.sourceContext = context; fixture.expectedSource.sourceContext = { ...context };
  assert.equal(verifySecurityEvidence(fixture).accepted, true);
  fixture.report.sourceCommit = context.headCommit;
  assert.throws(() => verifySecurityEvidence(fixture), /SAAS_RELEASE_EVIDENCE_SOURCE/);
});
for (const [label, change] of [
  ['another commit', f => { f.report.sourceCommit = 'c'.repeat(40); }],
  ['another tree', f => { f.report.sourceTree = 'c'.repeat(40); }],
  ['a dirty recorded tree', f => { f.report.workingTreeDirty = true; }],
  ['a dirty current tree', f => { f.expectedSource.workingTreeDirty = true; }],
  ['source changed during execution', f => { f.report.sourceChangedDuringRun = true; }],
  ['stale evidence', f => { f.now += 86_400_000; }],
  ['future evidence', f => { f.now -= 600_000; }],
  ['reversed timestamps', f => { f.report.startedAt = f.report.finishedAt; f.report.finishedAt = startedAt; }],
  ['unsupported runtime', f => { f.report.node = 'v20.0.0'; }],
  ['a missing scope', f => { delete f.report.scopeId; }],
  ['a mismatched scope hash', f => { f.report.scopeManifestSha256 = '0'.repeat(64); }],
  ['missing suite', f => { f.report.suites.pop(); }],
  ['a duplicate suite', f => { f.report.suites[1] = structuredClone(f.report.suites[0]); }],
  ['an omitted test file', f => { f.report.suites[0].files.pop(); }],
  ['an extra test file', f => { f.report.suites[0].files.push('test/unverified.test.js'); }],
  ['missing log', f => { delete f.logs['node-security']; }],
  ['modified saved log', f => { f.logs['node-security'] += '# changed\n'; }],
  ['an unexpected log path', f => { f.report.suites[0].logFile = '../elsewhere.tap'; }],
  ['a nonzero exit', f => { f.report.suites[0].exitCode = 1; }],
  ['a killed process', f => { f.report.suites[0].signal = 'SIGKILL'; }],
  ['contradictory totals', f => { f.report.suites[0].tests++; }],
  ['a missing TAP summary', f => { replaceLog(f, 'node-security', value => value.replace(/^# todo.*\n/m, '')); }],
  ['a duplicate TAP summary', f => { replaceLog(f, 'node-security', value => value + '# tests 1\n'); }],
  ['a hidden failing TAP assertion', f => { replaceLog(f, 'node-security', value => 'not ok 1 - hidden\n' + value); }],
  ['a skipped test', f => { replaceLog(f, 'node-security', value => value.replace('# skipped 0', '# skipped 1')); }],
  ['a cancelled test', f => { replaceLog(f, 'node-security', value => value.replace('# cancelled 0', '# cancelled 1')); }],
  ['a TODO test', f => { replaceLog(f, 'node-security', value => value.replace('# todo 0', '# todo 1')); }],
  ['zero tests', f => { replaceLog(f, 'node-security', () => summary(0)); }],
  ['an incomplete one-test subset', f => { replaceLog(f, 'node-security', () => summary(1)); }],
  ['unmeasured concurrency', f => { replaceLog(f, 'sites-security', value => value.replace(/^# \{.*\}\n/gm, '')); }],
  ['serialized tenant work', f => { replaceLog(f, 'sites-security', value => value.replaceAll('"observedPeakConcurrency":5', '"observedPeakConcurrency":1')); }],
  ['excess tenant concurrency', f => { replaceLog(f, 'sites-security', value => value.replaceAll('"observedPeakConcurrency":5', '"observedPeakConcurrency":6')); }],
  ['a commercial approval claim', f => { f.report.commercialLaunch = 'APPROVED'; }],
]) test('security receipt rejects ' + label, () => {
  const fixture = security(); change(fixture);
  assert.throws(() => verifySecurityEvidence(fixture), /SAAS_RELEASE_EVIDENCE_/);
});

test('fresh full-size restore receipt verifies independent provenance and all rejection checks', () => {
  const result = verifyRecoveryEvidence(recovery());
  assert.equal(result.accepted, true);
  assert.equal(result.originals, 430);
  assert.equal(result.originalBytes, 185567855);
  assert.equal(result.tables, 27);
  assert.equal(result.commercialLaunch, 'NOT_APPROVED');
});
for (const [label, change] of [
  ['only the small smoke fixture', f => { f.restored.originals.count = 7; }],
  ['missing hash readbacks', f => { f.restored.originals.hashesChecked = 429; }],
  ['an omitted durable table', f => { f.restored.tables.pop(); }],
  ['a duplicate durable table', f => { f.restored.tables[1] = f.restored.tables[0]; }],
  ['a renamed durable table', f => { f.restored.tables[0].name = 'unrelated'; }],
  ['a changed transaction count', f => { f.restored.ledger.transactions++; }],
  ['a changed transaction total', f => { f.restored.ledger.transactionCents++; }],
  ['a changed allocation count', f => { f.restored.ledger.allocations++; }],
  ['a missing revoked credit', f => { f.restored.ledger.revokedCredits = 0; }],
  ['a missing revoked Bankgiro link', f => { f.restored.ledger.revokedBankgiroLinks = 0; }],
  ['a negative control at the wrong stage', f => { f.restored.rejectionChecks[5].stage = 'restore'; }],
  ['a noncanonical backup identity', f => { f.restored.provenance.backupId = 'arbitrary-unbound-identity'; }],
  ['a changed ledger', f => { f.restored.ledger.allocatedCents++; }],
  ['missing provenance', f => { delete f.restored.provenance; }],
  ['another company provenance', f => { f.restored.provenance.companyBoundary.companyId = 'another-company'; }],
  ['missing source manifest hash', f => { delete f.restored.provenance.sourceFiles['manifest.bin']; }],
  ['unverified source provenance', f => { f.restored.sourceProvenanceVerified = false; }],
  ['a production-restore claim', f => { f.restored.productionRestoreTested = true; }],
  ['an unexpected provider-enabled command', f => { f.report.command = ['sites/scripts/recovery-drill.mjs']; }],
  ['missing required negative control', f => { f.restored.rejectionChecks.pop(); }],
  ['a negative control which did not reject', f => { f.restored.rejectionChecks[0].rejected = false; }],
  ['partial output on rejected restore', f => { f.restored.rejectionChecks[0].outputCreated = true; }],
  ['revived worker leases', f => { f.restored.workerLeasesInvalidated = false; }],
  ['retained token authority', f => { f.restored.applicationTokenRecoveryBlocked = false; }],
  ['an unobserved interruption', f => { f.restored.resume.interruptionObserved = false; }],
  ['an RTO objective miss', f => { f.restored.timing.restoreAndAcceptanceMilliseconds = 60001; }],
  ['an inflated RTO objective', f => { f.restored.objectives.isolatedRtoMilliseconds = 120000; }],
  ['an inconsistent RPO scenario', f => { f.restored.simulatedRecovery.rpoMilliseconds = 1; }],
  ['a post-cutoff write included in recovery', f => { f.restored.simulatedRecovery.postSnapshotWritesExcluded = 0; }],
]) test('recovery receipt rejects ' + label + ' even with a refreshed JSON hash', () => {
  const fixture = recovery(); change(fixture); seal(fixture);
  assert.throws(() => verifyRecoveryEvidence(fixture), /SAAS_RELEASE_EVIDENCE_/);
});
test('recovery receipt rejects byte tampering before reading its claims', () => {
  const fixture = recovery(); fixture.recoveryJson += '\n';
  assert.throws(() => verifyRecoveryEvidence(fixture), /SAAS_RELEASE_EVIDENCE_RECOVERY_HASH/);
});
test('recovery child environment excludes operator preloads and provider secrets', () => {
  const env = isolatedTestEnvironment({ PATH: '/synthetic/bin', NODE_OPTIONS: '--import=/operator.mjs',
    BANK_PRIVATE_KEY: 'synthetic-secret', MG_SITES_OCR_TOKEN: 'synthetic-secret' });
  assert.deepEqual(env, { NODE_ENV: 'test', CLOUDFLARE_CF_FETCH_ENABLED: 'false', WRANGLER_SEND_METRICS: 'false', PATH: '/synthetic/bin' });
});
