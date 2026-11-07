import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECURITY_SUITES } from './lib/saas-security-scope.mjs';
import { evidenceSource, verifySecurityEvidence, verifyRecoveryEvidence } from './lib/saas-release-evidence.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  const args = process.argv.slice(2);
  if (args.length !== 3 || !['security', 'recovery'].includes(args[0]) || !/^[a-f0-9]{40}$/.test(args[2])) {
    throw new Error('Usage: node scripts/verify-saas-release-evidence.mjs security|recovery evidence-directory expected-checkout-sha');
  }
  const [kind, directory, expectedCommit] = args, output = resolve(directory);
  const expectedSource = evidenceSource(root);
  if (expectedSource.sourceCommit !== expectedCommit) throw new Error('SAAS_RELEASE_EVIDENCE_EXPECTED_SOURCE');
  const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
  const result = kind === 'security'
    ? verifySecurityEvidence({ report, expectedSource,
      logs: Object.fromEntries(SECURITY_SUITES.map(suite => [suite.name, readFileSync(join(output, suite.name + '.tap'), 'utf8')])) })
    : verifyRecoveryEvidence({ report, expectedSource, recoveryJson: readFileSync(join(output, 'recovery-drill.json'), 'utf8') });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  // No receipt content, secret, filesystem path or upstream message is logged.
  const code = typeof error?.message === 'string' && error.message.startsWith('SAAS_RELEASE_EVIDENCE_')
    ? error.message : 'SAAS_RELEASE_EVIDENCE_INVALID';
  console.error(code);
  process.exitCode = 1;
}
