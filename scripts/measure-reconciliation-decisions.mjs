// Synthetic, pure-engine acceptance only. Opens no database or bank connection.
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {reconciliationDecisionCases, safeAllocations} from '../test/helpers/reconciliation-decisions.mjs';

const args = process.argv.slice(2);
const option = name => {const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1];};
const sourceRoot = resolve(option('--source-root') || fileURLToPath(new URL('..', import.meta.url)));
const sourceHash = path => createHash('sha256').update(readFileSync(resolve(sourceRoot, path))).digest('hex');
const sourceRevision = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
const sourceFiles = ['src/reconciliation.js', 'src/db.js', 'src/bank-evidence.js', 'src/payment-references.js', 'sites/lib/reconciliation-engine.js', 'sites/lib/reconciliation-decisions.js', 'sites/lib/payment-references.js', 'sites/lib/invoice-reference-policy.js'];
const sourceHashes = Object.fromEntries(sourceFiles.map(path => [path, existsSync(resolve(sourceRoot, path)) ? sourceHash(path) : null]));
const results = [];
for (const [runtime, path] of [['node', 'src/reconciliation.js'], ['sites', 'sites/lib/reconciliation-engine.js']]) {
  const {analyzeReconciliation, RECONCILIATION_RULE_VERSION} = await import(pathToFileURL(resolve(sourceRoot, path)).href);
  const counts = {truePositiveScenarios: 0, falseNegativeScenarios: 0, trueNegativeScenarios: 0, falsePositiveScenarios: 0, expectedAllocations: 0, truePositiveAllocations: 0, falsePositiveAllocations: 0, falseNegativeAllocations: 0};
  const scenarios = reconciliationDecisionCases.map(scenario => {
    const input = scenario.input(), before = JSON.stringify(input);
    const actual = safeAllocations(analyzeReconciliation(input));
    if (JSON.stringify(input) !== before) throw new Error('Mutated synthetic evidence: ' + scenario.id);
    const expectedKeys = new Set(scenario.expected.map(value => JSON.stringify(value)));
    const actualKeys = new Set(actual.map(value => JSON.stringify(value)));
    const missing = [...expectedKeys].filter(key => !actualKeys.has(key));
    const unexpected = [...actualKeys].filter(key => !expectedKeys.has(key));
    // Duplicate returned allocations are false positives, even if their key is valid.
    const duplicates = actual.length - actualKeys.size;
    counts.expectedAllocations += expectedKeys.size;
    counts.truePositiveAllocations += [...actualKeys].filter(key => expectedKeys.has(key)).length;
    counts.falsePositiveAllocations += unexpected.length + duplicates;
    counts.falseNegativeAllocations += missing.length;
    if (unexpected.length || duplicates) counts.falsePositiveScenarios++;
    else if (missing.length) counts.falseNegativeScenarios++;
    else if (expectedKeys.size) counts.truePositiveScenarios++;
    else counts.trueNegativeScenarios++;
    return {id: scenario.id, expected: scenario.expected, actual, pass: !missing.length && !unexpected.length && !duplicates};
  });
  results.push({runtime, ruleVersion: RECONCILIATION_RULE_VERSION, engineSha256: sourceHash(path), scenarioCount: scenarios.length, counts, scenarios});
}
const report = {
  kind: 'synthetic-reconciliation-decision-corpus',
  sourceRevision,
  sourceHashes,
  corpusSha256: createHash('sha256').update(readFileSync(new URL('../test/helpers/reconciliation-decisions.mjs', import.meta.url))).digest('hex'),
  scope: 'Pure engines with trusted synthetic adapter facts; no production/bank provenance, persistence or statistical population claim.',
  results,
};
const output = JSON.stringify(report, null, 2) + '\n';
if (option('--output')) writeFileSync(resolve(option('--output')), output);
process.stdout.write(output);
if (option('--assert') === 'pass' && results.some(result => result.scenarios.some(scenario => !scenario.pass))) process.exitCode = 1;
