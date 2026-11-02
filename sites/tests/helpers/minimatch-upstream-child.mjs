import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [base, format] = process.argv.slice(2);
const fixtureRoot = path.dirname(path.dirname(base));
const esmLoader = path.join(fixtureRoot, 'minimatch-export-probe.mjs');
if (format === 'esm') writeFileSync(esmLoader, "export * from 'minimatch';\n");
const api = format === 'commonjs'
  ? createRequire(path.join(fixtureRoot, 'synthetic.cjs'))('minimatch')
  : await import(pathToFileURL(esmLoader).href);
const { Minimatch } = api;
const started = performance.now();
const optimizationLevel = 2;
const pattern = Array(30).fill('**/../a/b').join('/');
assert.equal(new Minimatch(pattern, { optimizationLevel, braceExpandMax: 64 }).set.length, 64);
assert.equal(new Minimatch(pattern, { optimizationLevel }).set.length, 100_000);
const mm = new Minimatch('**/../a/b/**/../c/d', { optimizationLevel });
assert.equal(mm.set.length, 4);
assert.equal(mm.match('../a/b/../c/d'), true);
assert.equal(mm.match('x/a/b/y/c/d'), true);
assert.equal(new Minimatch('{x,*}/{0..9}', { optimizationLevel }).set.length, 10);
const large = new Minimatch('{x,*}/{0..999}', { optimizationLevel });
assert.equal(large.set.length, 2000);
assert.equal(large.match('x/5'), true);
assert.equal(large.match('y/999'), true);
assert.equal(large.match('.y/5'), false);
console.log(JSON.stringify({ format, assertions: 10, milliseconds: performance.now() - started,
  maxRssKb: process.resourceUsage().maxRSS, heapBudgetMiB: 1024 }));
