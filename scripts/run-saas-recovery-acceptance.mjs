// A fresh synthetic 430-object restore with a source-bound, hash-bound receipt.
// No credentials, production source paths or restore destinations are accepted.
import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECOVERY_SCOPE, RECOVERY_COMMAND } from './lib/saas-security-scope.mjs';
import { evidenceSource, isolatedTestEnvironment, sha256 } from './lib/saas-release-evidence.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length > 1) throw new Error('Usage: node scripts/run-saas-recovery-acceptance.mjs [output-directory]');
const output = resolve(args[0] || join(tmpdir(), 'mgeorge-saas-recovery-acceptance'));
mkdirSync(output, { recursive: true, mode: 0o700 });
const source = evidenceSource(root);
const report = {
  version: 2, ...source, scopeId: RECOVERY_SCOPE,
  scopeManifestSha256: sha256(JSON.stringify(RECOVERY_COMMAND)),
  node: process.version, startedAt: new Date().toISOString(),
  command: RECOVERY_COMMAND, outputFile: 'recovery-drill.json',
  productionAcceptance: 'NOT_VERIFIED', commercialLaunch: 'NOT_APPROVED',
};
const fd = openSync(join(output, report.outputFile), 'w', 0o600);
const errors = openSync(join(output, 'recovery-drill.stderr.log'), 'w', 0o600);
let result;
try {
  result = spawnSync(process.execPath, RECOVERY_COMMAND, {
    cwd: root, env: isolatedTestEnvironment(), stdio: ['ignore', fd, errors], timeout: 10 * 60_000,
  });
} finally { closeSync(fd); closeSync(errors); }
const bytes = readFileSync(join(output, report.outputFile));
const after = evidenceSource(root);
report.finishedAt = new Date().toISOString();
report.sourceChangedDuringRun = after.sourceCommit !== source.sourceCommit || after.sourceTree !== source.sourceTree || after.workingTreeDirty;
report.outputSha256 = sha256(bytes);
report.exitCode = result.status;
report.signal = result.signal;
let drill;
try { drill = JSON.parse(bytes.toString('utf8')); } catch { /* The verifier rejects absent/truncated JSON. */ }
report.recoveryPassed = result.status === 0 && drill?.accepted === true && drill?.productionRestoreTested === false;
writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log('Synthetic 430-original recovery: ' + (report.recoveryPassed ? 'PASS' : 'FAIL'));
if (!report.recoveryPassed) process.exitCode = 1;
