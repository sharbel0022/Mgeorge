import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { guardMinimatchBackport } from '../scripts/minimatch-backport.mjs';
import { copyScripts, fixture, hash, packageSnapshot, sitesRoot } from './helpers/minimatch-fixture.mjs';

function child(root, script, args = [], env = {}) {
  return spawnSync(process.execPath, [path.join(root, script), ...args], {
    cwd: root, env: { ...process.env, SITES_RUNTIME_ROOT: path.join(root, '.sites-runtime'),
      SITES_INSTALL_REPORT_PATH: '', WRANGLER_LOG_PATH: path.join(root, '.sites-runtime/wrangler/logs'),
      WRANGLER_REGISTRY_PATH: path.join(root, '.sites-runtime/wrangler/dev-registry'),
      MINIFLARE_REGISTRY_PATH: path.join(root, '.sites-runtime/wrangler/registry'), ...env },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 64_000,
  });
}

function tool(root, relative) {
  const filename = path.join(root, 'node_modules', relative);
  mkdirSync(path.dirname(filename), { recursive: true });
  writeFileSync(filename, `console.log('TOOL_RAN ' + JSON.stringify(process.argv.slice(2)));\n`);
}

function entryFixture(t) {
  const f = fixture(t); copyScripts(f.root);
  tool(f.root, 'vinext/dist/cli.js'); tool(f.root, 'typescript/bin/tsc'); tool(f.root, 'eslint/bin/eslint.js');
  return f;
}

for (const [name, script, args, expected] of [
  ['build', 'scripts/run-framework.mjs', ['build', '--synthetic-arg', 'two words'], ['build', '--synthetic-arg', 'two words']],
  ['check', 'scripts/run-verified-tool.mjs', ['check', '--pretty', 'false'], ['--noEmit', '--pretty', 'false']],
  ['lint', 'scripts/run-verified-tool.mjs', ['lint', '--max-warnings', '0'], ['.', '--ignore-pattern', 'dist', '--ignore-pattern', '.next', '--max-warnings', '0']],
]) {
  test(name + ' rejects suppressed/cached unpatched installs before the real tool entrypoint', t => {
    const f = entryFixture(t), before = packageSnapshot(f.targets[0]);
    const result = child(f.root, script, args, { npm_config_ignore_scripts: 'true' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unpatched/i);
    assert.doesNotMatch(result.stdout, /TOOL_RAN/);
    assert.deepEqual(packageSnapshot(f.targets[0]), before);
  });
  test(name + ' verifies current bytes on reuse and preserves default plus user arguments', t => {
    const f = entryFixture(t); guardMinimatchBackport({ projectRoot: f.root });
    const result = child(f.root, script, args);
    assert.equal(result.status, 0, result.error?.message || result.stderr);
    const line = result.stdout.split(/\r?\n/).find(line => line.startsWith('TOOL_RAN '));
    assert.ok(line, result.stdout);
    assert.deepEqual(JSON.parse(line.slice('TOOL_RAN '.length)), expected);
    writeFileSync(path.join(f.targets[0], 'dist/esm/index.d.ts'), 'unexpected declaration drift');
    const changed = child(f.root, script, args);
    assert.notEqual(changed.status, 0); assert.doesNotMatch(changed.stdout, /TOOL_RAN/);
  });
}

test('ordinary npm postinstall applies actual bytes without changing package/audit identity', t => {
  const f = entryFixture(t), before = packageSnapshot(f.targets[0]);
  const source = JSON.parse(readFileSync(path.join(sitesRoot, 'package.json')));
  const pkg = JSON.parse(readFileSync(path.join(f.root, 'package.json')));
  pkg.scripts = { postinstall: source.scripts.postinstall }; writeFileSync(path.join(f.root, 'package.json'), JSON.stringify(pkg));
  const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  const result = spawnSync(process.execPath, [npmCli, '--prefix', f.root, '--workspaces=false', 'run', 'postinstall'], {
    cwd: f.root, encoding: 'utf8', timeout: 30_000, maxBuffer: 64_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(guardMinimatchBackport({ projectRoot: f.root, check: true, requireTarget: true }).targets, 1);
  assert.equal(packageSnapshot(f.targets[0])['package.json'], before['package.json']);
});

test('portable installer explicitly patches after lifecycle-suppressed npm success', t => {
  const f = entryFixture(t);
  const bin = path.join(f.root, 'node_modules/.bin'); mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, process.platform === 'win32' ? 'vinext.cmd' : 'vinext'), '#!/bin/sh\nexit 0\n');
  if (process.platform !== 'win32') chmodSync(path.join(bin, 'vinext'), 0o755);
  const npm = path.join(f.root, 'synthetic-npm.cjs');
  writeFileSync(npm, `require('node:fs').writeFileSync(${JSON.stringify(path.join(f.root, 'npm-args.json'))},JSON.stringify(process.argv.slice(2)));\n`);
  const result = child(f.root, 'scripts/install-ci.mjs', [], { npm_execpath: npm, npm_config_ignore_scripts: 'true' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(guardMinimatchBackport({ projectRoot: f.root, check: true, requireTarget: true }), { targets: 1, writes: 0, status: 'verified' });
  const args = JSON.parse(readFileSync(path.join(f.root, 'npm-args.json')));
  assert.ok(args.includes('--include=dev')); assert.ok(args.includes('--include=optional'));
  assert.ok(args.includes('--workspaces=false'));
});

test('portable installer refuses a missing target after npm success', t => {
  const f = fixture(t, []); copyScripts(f.root);
  const npm = path.join(f.root, 'synthetic-npm.cjs'); writeFileSync(npm, 'process.exitCode=0;\n');
  const result = child(f.root, 'scripts/install-ci.mjs', [], { npm_execpath: npm, npm_config_ignore_scripts: 'true' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /target/i);
});

test('direct managed build checks reused bytes and forwards actual caller arguments', { skip: process.platform === 'win32' ? 'Linux managed build is exercised by the Ubuntu CI job' : false }, t => {
  const f = entryFixture(t), bin = path.join(f.root, 'node_modules/.bin'); mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'vinext'), '#!/usr/bin/env node\nconsole.log("TOOL_RAN "+JSON.stringify(process.argv.slice(2)));\n');
  chmodSync(path.join(bin, 'vinext'), 0o755);
  const execute = () => spawnSync('bash', [path.join(f.root, 'scripts/build-verified.sh'), '--synthetic-arg', 'two words'], {
    cwd: f.root, env: { ...process.env, SITES_ENV_READY: '0', SITES_RUNTIME_ROOT: path.join(f.root, '.sites-runtime') },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 64_000,
  });
  const before = execute(); assert.notEqual(before.status, 0); assert.match(before.stderr, /unpatched/i); assert.doesNotMatch(before.stdout, /TOOL_RAN/);
  guardMinimatchBackport({ projectRoot: f.root });
  const after = execute(); assert.equal(after.status, 0, after.stderr);
  const line = after.stdout.split(/\r?\n/).find(line => line.startsWith('TOOL_RAN '));
  assert.deepEqual(JSON.parse(line.slice('TOOL_RAN '.length)), ['build', '--synthetic-arg', 'two words']);
});

for (const invalid of [false, true]) test('managed installer ' + (invalid ? 'rejects unknown bytes before receipt' : 'patches actual bytes before receipt'), { skip: process.platform === 'win32' ? 'Linux managed installer is exercised by the Ubuntu CI job' : false }, t => {
  const f = entryFixture(t);
  if (invalid) writeFileSync(path.join(f.targets[0], 'dist/esm/index.js'), 'unknown');
  f.lock.packages['node_modules/vinext'] = { resolved: 'https://synthetic.invalid/vinext.tgz', integrity: 'sha512-synthetic' }; f.saveLock();
  const seed = path.join(f.root, 'seed'); mkdirSync(seed);
  writeFileSync(path.join(seed, '.sites-lockfile-sha256'), hash(readFileSync(path.join(f.root, 'package-lock.json'))));
  const bin = path.join(f.root, 'node_modules/.bin'); mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'vinext'), '#!/bin/sh\nexit 0\n'); chmodSync(path.join(bin, 'vinext'), 0o755);
  const fakeBin = path.join(f.root, 'fake-bin'); mkdirSync(fakeBin);
  writeFileSync(path.join(fakeBin, 'npm'), '#!/usr/bin/env node\nif(process.argv.includes("config"))console.log(process.env.npm_config_cache);\n'); chmodSync(path.join(fakeBin, 'npm'), 0o755);
  const result = spawnSync('bash', [path.join(f.root, 'scripts/install-ci.sh')], {
    cwd: f.root, env: { ...process.env, PATH: fakeBin + path.delimiter + process.env.PATH,
      SITES_ENV_READY: '0', SITES_PROJECT_ROOT: f.root, SITES_RUNTIME_ROOT: path.join(f.root, '.sites-runtime'),
      SITES_INSTALL_REPORT_PATH: '', SITES_NPM_CACHE_SEED: seed, npm_config_ignore_scripts: 'true' },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 64_000,
  });
  const receipt = path.join(f.root, 'node_modules/.sites-install.json');
  if (invalid) { assert.notEqual(result.status, 0); assert.equal(existsSync(receipt), false); }
  else {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(receipt), true);
    assert.equal(guardMinimatchBackport({ projectRoot: f.root, check: true, requireTarget: true }).targets, 1);
  }
});
