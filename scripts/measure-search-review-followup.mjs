import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createWorkspaceSearchIndex, searchWorkspaceIndex } from '../src/workspace-search.js';

const baselineCommit = '7d58953bccdd16e531db2465bd3e9f69e9458bed';
const baselineSource = execFileSync('git', ['show', `${baselineCommit}:src/workspace-search.js`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
const before = await import('data:text/javascript;base64,' + Buffer.from(baselineSource).toString('base64'));
const records = Array.from({ length: 9991 }, (_, i) => ({ type: i % 2 ? 'invoice' : 'transaction', id: `synthetic-${i}`, number: `SYN-${i}`, party: 'Synthetic common party', amountCents: 20000000 + i, date: '2026-10-01' }));
records.push(
  { type: 'invoice', id: 'large-amount', number: 'OTHER', amountCents: 12345600, date: '2026-11-06' },
  { type: 'invoice', id: 'short-reference', number: '123', amountCents: 45600, date: '2026-11-05' },
  { type: 'invoice', id: 'fuzzy-reference', number: 'PREFIX-123', amountCents: 45600, date: '2026-11-05' },
  { type: 'invoice', id: 'wrong-amount', number: '123', amountCents: 45601, date: '2026-11-05' },
  { type: 'invoice', id: 'multi-full', number: 'OTHER-MULTI', amountCents: 12345678900 },
  { type: 'invoice', id: 'multi-first', number: '123', amountCents: 45678900 },
  { type: 'invoice', id: 'multi-second', number: '123 456', amountCents: 78900 },
  { type: 'invoice', id: 'ordinary-grouping', number: '00599', amountCents: 123450, date: '2026-11-05' },
  { type: 'transaction', id: 'negative', number: 'SYN-NEGATIVE', amountCents: -45600 }
);
const scenarios = [
  { id: 'ambiguous-reference-first', query: '123 456,00', invoices: ['short-reference', 'large-amount'] },
  { id: 'reordered-unambiguous', query: '456,00 123', invoices: ['short-reference', 'fuzzy-reference'] },
  { id: 'unicode-grouping', query: '123\u00a0456,00 SEK', invoices: ['short-reference', 'large-amount'] },
  { id: 'date-preserved', query: '123 456,00 05/11/2026', invoices: ['short-reference'] },
  { id: 'multiple-group-boundaries', query: '123 456 789,00', invoices: ['multi-first', 'multi-second', 'multi-full'] },
  { id: 'ordinary-swedish-thousands', query: '1 234,50', invoices: ['ordinary-grouping'] },
  { id: 'leading-zero-and-date', query: '00599 1 234,50 2026-11-05', invoices: ['ordinary-grouping'] },
  { id: 'negative-amount', query: '-456,00', transactions: ['negative'] },
  { id: 'bounded-32-token-ambiguity', query: Array(16).fill('123 456,00').join(' '), invoices: ['short-reference', 'large-amount'] },
  { id: 'no-match', query: 'no-synthetic-party-9384' },
  { id: 'blank', query: '   ' },
  { id: 'over-term-limit', query: Array(33).fill('1,00').join(' ') },
];
const inputBefore = JSON.stringify(records);
const started = performance.now(), index = createWorkspaceSearchIndex(records), indexBuildMs = performance.now() - started;
const baselineIndex = before.createWorkspaceSearchIndex(records);
const ids = result => ({ invoices: result.invoices.map(row => row.id), transactions: result.transactions.map(row => row.id) });
const measurements = [];
for (const [phase, search, sourceIndex] of [['before', before.searchWorkspaceIndex, baselineIndex], ['after', searchWorkspaceIndex, index]]) {
  for (const scenario of scenarios) {
    for (let n = 0; n < 3; n++) search(sourceIndex, scenario.query);
    const samples = []; let result;
    for (let n = 0; n < 20; n++) {
      const start = performance.now(); result = search(sourceIndex, scenario.query); samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    measurements.push({ phase, id: scenario.id, correct: JSON.stringify(ids(result)) === JSON.stringify({ invoices: scenario.invoices || [], transactions: scenario.transactions || [] }), result: ids(result), samples: samples.length, p50_ms: samples[10], p95_ms: samples[18] });
  }
}
const hash = value => createHash('sha256').update(value).digest('hex');
const report = {
  schema: 'workspace-search-review-followup-v1', generated_at: new Date().toISOString(), runtime: process.version,
  baseline_commit: baselineCommit, before_source_sha256: hash(baselineSource), after_source_sha256: hash(readFileSync(new URL('../src/workspace-search.js', import.meta.url))),
  record_count: records.length, index_build_ms: indexBuildMs, input_mutations: Number(inputBefore !== JSON.stringify(records)),
  scope: 'Synthetic cached-index search only, before and after review fixes. No browser/network measurement or payment evidence. Reordered ordinary text retains substring matching; recovered thousands prefixes require exact references. Shared development host, 3 warmups and 20 samples per case.',
  metrics: Object.fromEntries(['before', 'after'].map(phase => { const rows = measurements.filter(row => row.phase === phase); return [phase, { correct_cases: rows.filter(row => row.correct).length, cases: rows.length, slowest_case_p95_ms: Math.max(...rows.map(row => row.p95_ms)) }]; })), cases: measurements,
};
const output = process.argv[2] || 'docs/quality8/search-review-followup-measurement.json';
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, metrics: report.metrics, index_build_ms: report.index_build_ms, input_mutations: report.input_mutations }, null, 2));
if (report.metrics.after.correct_cases !== scenarios.length || report.input_mutations) process.exitCode = 1;
