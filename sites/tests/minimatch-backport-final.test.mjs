import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, linkSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { copyOriginal, copyScripts, fixture, hash, originals, packageSnapshot, sitesRoot, targetRecord } from './helpers/minimatch-fixture.mjs';

async function guard() {
  let module;
  try { module = await import('../scripts/minimatch-backport.mjs'); }
  catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
  assert.equal(typeof module?.guardMinimatchBackport, 'function', 'the exact installed-byte guard must exist');
  return module.guardMinimatchBackport;
}

test('read-only check rejects original bytes and leaves every guarded original intact', async t => {
  const run = await guard(), f = fixture(t), before = packageSnapshot(f.targets[0]);
  assert.throws(() => run({ projectRoot: f.root, check: true, requireTarget: true }), /unpatched/i);
  assert.deepEqual(packageSnapshot(f.targets[0]), before);
});

test('apply verifies all four compiler-proven outputs, retains declarations/identity and is idempotent', async t => {
  const run = await guard(), f = fixture(t), before = packageSnapshot(f.targets[0]);
  assert.deepEqual(run({ projectRoot: f.root, requireTarget: true }), { targets: 1, writes: 4, status: 'verified' });
  const after = packageSnapshot(f.targets[0]);
  assert.equal(after['dist/commonjs/index.js'], '40a85b7016eba56e2e45a3ede6235216b9d084e8d740c9907cbf5fb88b829648');
  assert.equal(after['dist/commonjs/index.js.map'], 'd104377c5b8c69599727d6c30b9a22537ce1a1d0d43e539d2af232c030a81c27');
  assert.equal(after['dist/esm/index.js'], '7532da23f97b1cf949df7733f340f4f97c5cb81f5136ee6d8a9ecef9192809c5');
  assert.equal(after['dist/esm/index.js.map'], 'df1b7c4424ce2a3bf2a91e151e89a01c5c995edfbbe45715071752d4f78c18a1');
  for (const relative of Object.keys(before).filter(relative => !Object.hasOwn(originals, relative))) assert.equal(after[relative], before[relative], relative);
  assert.deepEqual(run({ projectRoot: f.root }), { targets: 1, writes: 0, status: 'verified' });
  assert.deepEqual(run({ projectRoot: f.root, check: true, requireTarget: true }), { targets: 1, writes: 0, status: 'verified' });
});

test('missing dev packages report zero actual targets while complete paths require a target', async t => {
  const run = await guard(), f = fixture(t, []);
  f.lock.packages['node_modules/minimatch'] = { ...targetRecord }; f.saveLock();
  assert.deepEqual(run({ projectRoot: f.root }), { targets: 0, writes: 0, status: 'no-targets' });
  assert.throws(() => run({ projectRoot: f.root, requireTarget: true }), /target/i);
});

test('all actual nested copies are patched while the locked 3.1.5 copy stays byte-identical', async t => {
  const run = await guard(), f = fixture(t, ['node_modules/a/node_modules/minimatch', 'node_modules/z/node_modules/minimatch']);
  const legacy = path.join(f.root, 'node_modules/minimatch');
  cpSync(path.join(sitesRoot, 'node_modules/minimatch'), legacy, { recursive: true });
  const legacyBody = readFileSync(path.join(legacy, 'minimatch.js'));
  f.lock.packages['node_modules/minimatch'] = { version: '3.1.5' }; f.saveLock();
  assert.equal(run({ projectRoot: f.root, requireTarget: true }).writes, 8);
  assert.deepEqual(readFileSync(path.join(legacy, 'minimatch.js')), legacyBody);
});

for (const [label, alter] of [
  ['late runtime drift', f => writeFileSync(path.join(f.targets[1], 'dist/esm/index.js'), 'unknown')],
  ['late declaration drift', f => writeFileSync(path.join(f.targets[1], 'dist/commonjs/index.d.ts'), 'unknown')],
  ['late CJS declaration-map drift', f => writeFileSync(path.join(f.targets[1], 'dist/commonjs/index.d.ts.map'), 'unknown')],
  ['late ESM declaration drift', f => writeFileSync(path.join(f.targets[1], 'dist/esm/index.d.ts'), 'unknown')],
  ['late ESM declaration-map drift', f => writeFileSync(path.join(f.targets[1], 'dist/esm/index.d.ts.map'), 'unknown')],
  ['late license drift', f => writeFileSync(path.join(f.targets[1], 'LICENSE.md'), 'unknown')],
  ['late source-map drift', f => writeFileSync(path.join(f.targets[1], 'dist/esm/index.js.map'), '{}')],
  ['late identity drift', f => writeFileSync(path.join(f.targets[1], 'package.json'), '{"name":"different","version":"10.2.5"}')],
  ['late version drift', f => { f.lock.packages['node_modules/z/node_modules/minimatch'].version = '10.2.6'; f.saveLock(); }],
  ['late integrity drift', f => { f.lock.packages['node_modules/z/node_modules/minimatch'].integrity = 'sha512-unknown'; f.saveLock(); }],
]) test(label + ' rejects before any earlier target is written', async t => {
  const run = await guard(), f = fixture(t, ['node_modules/a/node_modules/minimatch', 'node_modules/z/node_modules/minimatch']);
  const before = packageSnapshot(f.targets[0]); alter(f);
  assert.throws(() => run({ projectRoot: f.root }), /unknown|unsupported|identity|integrity|hash|version/i);
  assert.deepEqual(packageSnapshot(f.targets[0]), before);
});

test('an unlisted actual package and a missing locked copy cannot silently escape discovery', async t => {
  const run = await guard(), f = fixture(t);
  const rogue = path.join(f.root, 'node_modules/z/node_modules/minimatch'); copyOriginal(rogue);
  const before = packageSnapshot(f.targets[0]);
  assert.throws(() => run({ projectRoot: f.root }), /lock|unlisted/i);
  assert.deepEqual(packageSnapshot(f.targets[0]), before);
  f.lock.packages['node_modules/z/node_modules/minimatch'] = { ...targetRecord }; f.saveLock();
  rmSync(rogue, { recursive: true });
  assert.throws(() => run({ projectRoot: f.root, requireTarget: true }), /missing|target/i);
  assert.deepEqual(packageSnapshot(f.targets[0]), before);
});

test('known interrupted before/after mixtures fail check read-only and repair without rewriting known output', async t => {
  const run = await guard(), f = fixture(t), originalJs = readFileSync(path.join(f.targets[0], 'dist/esm/index.js'));
  run({ projectRoot: f.root });
  writeFileSync(path.join(f.targets[0], 'dist/esm/index.js'), originalJs);
  const before = packageSnapshot(f.targets[0]);
  assert.throws(() => run({ projectRoot: f.root, check: true }), /unpatched/i);
  assert.deepEqual(packageSnapshot(f.targets[0]), before);
  assert.equal(run({ projectRoot: f.root }).writes, 1);
  assert.equal(run({ projectRoot: f.root, check: true }).writes, 0);
  assert.deepEqual(readdirSync(path.join(f.targets[0], 'dist/esm')).filter(name => name.includes('backport-')), []);
});

for (const evil of ['../outside/node_modules/minimatch', 'node_modules/a/../../outside/node_modules/minimatch', 'node_modules\\minimatch', '/node_modules/minimatch']) {
  test('lock target traversal is rejected: ' + evil, async t => {
    const run = await guard(), f = fixture(t), before = packageSnapshot(f.targets[0]);
    f.lock.packages[evil] = { ...targetRecord }; f.saveLock();
    assert.throws(() => run({ projectRoot: f.root }), /path|lock|unsafe/i);
    assert.deepEqual(packageSnapshot(f.targets[0]), before);
  });
}

test('a target junction cannot redirect writes outside the selected project', async t => {
  const run = await guard(), f = fixture(t), outside = fixture(t), before = packageSnapshot(outside.targets[0]);
  rmSync(f.targets[0], { recursive: true });
  symlinkSync(outside.targets[0], f.targets[0], process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => run({ projectRoot: f.root }), /symlink|junction|path/i);
  assert.deepEqual(packageSnapshot(outside.targets[0]), before);
});

test('a nested directory junction is rejected before replacing any runtime file', async t => {
  const run = await guard(), f = fixture(t), outside = fixture(t), before = packageSnapshot(outside.targets[0]);
  rmSync(path.join(f.targets[0], 'dist/esm'), { recursive: true });
  symlinkSync(path.join(outside.targets[0], 'dist/esm'), path.join(f.targets[0], 'dist/esm'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => run({ projectRoot: f.root }), /symlink|junction|path/i);
  assert.equal(hash(readFileSync(path.join(f.targets[0], 'dist/commonjs/index.js'))), originals['dist/commonjs/index.js']);
  assert.deepEqual(packageSnapshot(outside.targets[0]), before);
});

test('a hard-linked guarded file is rejected without changing its outside original', async t => {
  const run = await guard(), f = fixture(t), outside = fixture(t);
  const destination = path.join(f.targets[0], 'dist/commonjs/index.js');
  const original = path.join(outside.targets[0], 'dist/commonjs/index.js');
  rmSync(destination); linkSync(original, destination);
  assert.throws(() => run({ projectRoot: f.root }), /regular|unlinked|path/i);
  assert.equal(hash(readFileSync(original)), originals['dist/commonjs/index.js']);
});

test('a real mid-write OS failure is not certified and the known partial state repairs safely', { timeout: 30_000 }, async t => {
  const run = await guard(), f = fixture(t); copyScripts(f.root);
  // This deliberately resource-limited fault child is uninstrumented: its
  // 64KiB file cap also truncates inherited V8 coverage JSON, invalidating the
  // entire suite's report. Parent preflight/repair assertions remain covered.
  const faultEnvironment = { ...process.env, NODE_V8_COVERAGE: '' };
  let holder;
  let result;
  if (process.platform === 'win32') {
    // FileShare.Read allows guard preflight reads but denies the second rename.
    holder = spawn('powershell.exe', ['-NoProfile', '-Command', '$f=[IO.File]::Open($env:MINIMATCH_LOCK_FILE,"Open","Read","Read");[Console]::Out.WriteLine("ready");[Console]::In.ReadLine()|Out-Null;$f.Dispose()'], {
      env: { ...process.env, MINIMATCH_LOCK_FILE: path.join(f.targets[0], 'dist/commonjs/index.js.map') }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const ready = await once(holder.stdout, 'data'); assert.match(String(ready[0]), /ready/);
    try { result = spawnSync(process.execPath, [path.join(f.root, 'scripts/minimatch-backport.mjs'), '--require-target'], { env: faultEnvironment, encoding: 'utf8', timeout: 10_000 }); }
    finally { holder.stdin.end('\n'); await once(holder, 'close'); }
  } else {
    // A 64KiB file-size limit accepts the first runtime then rejects the map.
    result = spawnSync('bash', ['-c', 'ulimit -f 64; exec "$@"', 'minimatch-limited', process.execPath, path.join(f.root, 'scripts/minimatch-backport.mjs'), '--require-target'], {
      env: faultEnvironment, encoding: 'utf8', timeout: 10_000,
    });
  }
  assert.notEqual(result.status, 0);
  assert.equal(hash(readFileSync(path.join(f.targets[0], 'dist/commonjs/index.js'))), '40a85b7016eba56e2e45a3ede6235216b9d084e8d740c9907cbf5fb88b829648');
  assert.equal(hash(readFileSync(path.join(f.targets[0], 'dist/commonjs/index.js.map'))), originals['dist/commonjs/index.js.map']);
  assert.throws(() => run({ projectRoot: f.root, check: true }), /unpatched/i);
  assert.equal(run({ projectRoot: f.root }).writes, 3);
  assert.equal(run({ projectRoot: f.root, check: true }).writes, 0);
});

test('a tampered transform fails output verification before touching any target', async t => {
  await guard(); const f = fixture(t); copyScripts(f.root);
  const patchFile = path.join(f.root, 'scripts/patches/minimatch-10.2.5.json');
  const patch = JSON.parse(readFileSync(patchFile)); patch.runtimeEdits[0][1] += '\n';
  writeFileSync(patchFile, JSON.stringify(patch));
  const { guardMinimatchBackport: run } = await import(pathToFileURL(path.join(f.root, 'scripts/minimatch-backport.mjs')).href);
  const before = packageSnapshot(f.targets[0]);
  assert.throws(() => run({ projectRoot: f.root }), /output|transform|hash/i);
  assert.deepEqual(packageSnapshot(f.targets[0]), before);
});

for (const format of ['commonjs', 'esm']) test('actual npm ' + format + ' exports pass all ten upstream assertions under bounded default-100k workload', { timeout: 60_000 }, async t => {
  const run = await guard(), f = fixture(t); run({ projectRoot: f.root, requireTarget: true });
  const child = spawnSync(process.execPath, ['--max-old-space-size=1024', path.join(sitesRoot, 'tests/helpers/minimatch-upstream-child.mjs'), f.targets[0], format], {
    encoding: 'utf8', timeout: 55_000, maxBuffer: 64_000,
  });
  assert.equal(child.status, 0, child.error?.message || child.stderr);
  assert.equal(JSON.parse(child.stdout).assertions, 10);
});

test('real CJS/ESM matching, Windows/UNC/dot/partial/levels0/1 and installed parser contracts survive', { timeout: 60_000 }, async t => {
  const run = await guard(), before = fixture(t), after = fixture(t);
  run({ projectRoot: after.root, requireTarget: true });
  const child = spawnSync(process.execPath, ['--max-old-space-size=1024', path.join(sitesRoot, 'tests/helpers/minimatch-compat-child.mjs'), before.targets[0], after.targets[0], sitesRoot], {
    encoding: 'utf8', timeout: 55_000, maxBuffer: 64_000,
  });
  assert.equal(child.status, 0, child.error?.message || child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.comparisons, 344);
  assert.equal(result.typedProgram, true);
  assert.equal(result.nonMatchingFileRejected, true);
});
