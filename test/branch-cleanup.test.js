import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const script = new URL('../scripts/release/branch-cleanup.mjs', import.meta.url);
const executionBranch = 'release/cleanup-approved-20261107';
const sh = value => "'" + value.replaceAll("'", "'\\''") + "'";
function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mgeorge-cleanup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const remote = path.join(dir, 'remote.git'), seed = path.join(dir, 'seed'), cwd = path.join(dir, 'checkout');
  mkdirSync(seed);
  git(dir, 'init', '--bare', '--initial-branch=main', remote);
  git(seed, 'init', '--initial-branch=main');
  git(seed, 'config', 'user.name', 'Synthetic cleanup test');
  git(seed, 'config', 'user.email', 'cleanup@example.invalid');
  writeFileSync(path.join(seed, 'fixture.txt'), 'integrated\n');
  git(seed, 'add', '.'); git(seed, 'commit', '-m', 'Integrated feature');
  const tip = git(seed, 'rev-parse', 'HEAD');
  for (const name of ['feature/done', 'feature/other', 'feature/95-saas']) git(seed, 'branch', name);
  writeFileSync(path.join(seed, 'fixture.txt'), 'integrated main\n');
  git(seed, 'commit', '-am', 'Current main');
  const main = git(seed, 'rev-parse', 'HEAD');
  git(seed, 'branch', executionBranch);
  git(seed, 'remote', 'add', 'origin', remote); git(seed, 'push', 'origin', '--all');
  writeFileSync(path.join(seed, 'fixture.txt'), 'new work\n');
  git(seed, 'commit', '-am', 'New unintegrated work');
  const moved = git(seed, 'rev-parse', 'HEAD');
  git(seed, 'push', 'origin', 'HEAD:refs/heads/future');
  git(dir, 'clone', '--no-local', remote, cwd);
  const f = { dir, remote, cwd, tip, main, moved, outputDir: path.join(dir, 'evidence'), protected: false, prs: [] };
  f.ref = name => git(remote, 'rev-parse', 'refs/heads/' + name);
  f.move = (name, sha = moved) => git(remote, 'update-ref', 'refs/heads/' + name, sha);
  f.refs = () => git(remote, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/tags');
  f.hasArchive = () => Boolean(git(remote, 'for-each-ref', '--format=%(refname)', 'refs/tags/archive/branch-cleanup/'));
  f.api = {
    async branch(name) {
      if (f.apiError) throw new Error('GitHub denied access');
      return { name, protected: name === 'main' ? false : f.protected, commit: { sha: f.ref(name) } };
    },
    async openPullRequests() {
      if (f.beforePulls) await f.beforePulls();
      return structuredClone(f.prs);
    },
  };
  f.request = { version: 1, execute: true, expectedMain: main, knownActiveBranches: ['feature/95-saas'], candidates: [{ name: 'feature/done', sha: tip }] };
  return f;
}
async function run(f, options = {}) {
  assert.ok(existsSync(script), 'The safe cleanup entrypoint is not implemented yet');
  const { runCleanup } = await import(script);
  return runCleanup({ cwd: f.cwd, outputDir: f.outputDir, request: f.request, api: f.api,
    expectedRemoteUrl: f.remote, context: { actions: true, repository: 'sharbel0022/Mgeorge',
      ref: 'refs/heads/' + executionBranch, eventName: 'workflow_dispatch' }, ...options });
}
function retained(f, report, code) {
  assert.equal(report.results[0].status, 'retained');
  assert.equal(report.results[0].code, code);
  assert.equal(f.ref(f.request.candidates[0].name), f.request.candidates[0].sha);
  assert.equal(report.status, 'blocked');
  assert.ok(existsSync(path.join(f.outputDir, 'result.json')));
}

test('dry run leaves every remote branch and tag unchanged even when the manifest requests execution', async t => {
  const f = fixture(t), before = f.refs();
  const report = await run(f);
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.results[0].status, 'would-delete');
  assert.equal(f.refs(), before);
  assert.equal(f.hasArchive(), false);
});

test('execution archives, verifies a standalone bundle and restores a bare clone before deleting', async t => {
  const f = fixture(t);
  const hook = `#!/bin/sh\nwhile read old new ref; do\n  if test "$new" = 0000000000000000000000000000000000000000; then\n    test -f ${sh(path.join(f.outputDir, 'recovery-verification.json'))} || exit 31\n    git bundle verify ${sh(path.join(f.outputDir, 'recovery.bundle'))} >/dev/null 2>&1 || exit 32\n    test -d ${sh(path.join(f.outputDir, 'restore.git'))} || exit 33\n  fi\ndone\n`;
  writeFileSync(path.join(f.remote, 'hooks/pre-receive'), hook, { mode: 0o755 });
  const report = await run(f, { execute: true });
  assert.equal(report.status, 'completed');
  assert.equal(report.results[0].status, 'deleted');
  assert.equal(f.ref('main'), f.main);
  assert.throws(() => f.ref('feature/done'));
  const archive = report.results[0].archive;
  assert.equal(git(f.remote, 'rev-parse', archive.ref + '^{commit}'), f.tip);
  assert.equal(git(path.join(f.outputDir, 'restore.git'), 'rev-parse', archive.ref + '^{commit}'), f.tip);
  git(path.join(f.outputDir, 'restore.git'), 'fsck', '--full', '--strict');
  assert.equal(report.recovery.verified, true);
  assert.match(report.recovery.sha256, /^[a-f0-9]{64}$/);
  assert.ok(report.remainingBranches.some(b => b.name === 'main' && b.sha === f.main));
  assert.ok(!report.remainingBranches.some(b => b.name === 'feature/done'));
});

for (const name of ['--delete', '../main', 'feature:main', 'feature\nmain', 'refs/heads/main', 'feature..x']) {
  test('dangerous branch name is rejected without changing refs: ' + JSON.stringify(name), async t => {
    const f = fixture(t), before = f.refs(); f.request.candidates[0].name = name;
    const report = await run(f, { execute: true });
    assert.equal(report.status, 'blocked');
    assert.equal(report.error.code, 'INVALID_REQUEST');
    assert.equal(f.refs(), before);
  });
}

for (const name of ['main', 'feature/95-saas', executionBranch]) {
  test('main, active work and the execution branch are never deletion targets: ' + name, async t => {
    const f = fixture(t); f.request.candidates = [{ name, sha: f.ref(name) }];
    retained(f, await run(f, { execute: true }), 'FORBIDDEN_BRANCH');
    assert.equal(f.hasArchive(), false);
  });
}

for (const side of ['head', 'base']) {
  test('an open PR using the candidate as ' + side + ' retains the branch', async t => {
    const f = fixture(t);
    f.prs = [{ number: 12, state: 'open', head: { ref: 'elsewhere' }, base: { ref: 'main' } }];
    f.prs[0][side].ref = 'feature/done';
    retained(f, await run(f, { execute: true }), 'OPEN_PR');
    assert.equal(f.hasArchive(), false);
  });
}

for (const protectedValue of [true, undefined]) {
  test('protected or ambiguously protected branches are retained: ' + protectedValue, async t => {
    const f = fixture(t); f.protected = protectedValue;
    retained(f, await run(f, { execute: true }), 'PROTECTED_BRANCH');
  });
}

test('a moved main aborts cleanup before any archive or deletion', async t => {
  const f = fixture(t); f.move('main');
  retained(f, await run(f, { execute: true }), 'MAIN_MOVED');
  assert.equal(f.hasArchive(), false);
});

for (const target of ['main', 'feature/done']) {
  test('a ref moved after archival is retained by the final fresh check: ' + target, async t => {
    const f = fixture(t);
    f.beforePulls = () => { if (f.hasArchive()) f.move(target); };
    const report = await run(f, { execute: true });
    assert.equal(report.results[0].status, 'retained');
    assert.equal(report.results[0].code, target === 'main' ? 'MAIN_MOVED' : 'HEAD_MOVED');
    assert.equal(f.ref('feature/done'), target === 'main' ? f.tip : f.moved);
    assert.equal(f.hasArchive(), true);
  });
}

test('a nonancestor commit is retained even when the requested head matches', async t => {
  const f = fixture(t); f.move('feature/done'); f.request.candidates[0].sha = f.moved;
  retained(f, await run(f, { execute: true }), 'NOT_INTEGRATED');
});

test('PR state is rechecked before every deletion, retaining newly active branches', async t => {
  const f = fixture(t); f.request.candidates.push({ name: 'feature/other', sha: f.tip });
  f.beforePulls = () => {
    try { f.ref('feature/done'); } catch {
      f.prs = [{ number: 13, state: 'open', head: { ref: 'new-work' }, base: { ref: 'feature/other' } }];
    }
  };
  const report = await run(f, { execute: true });
  assert.equal(report.status, 'partial');
  assert.equal(report.results[0].status, 'deleted');
  assert.equal(report.results[1].status, 'retained');
  assert.equal(report.results[1].code, 'OPEN_PR');
  assert.equal(f.ref('feature/other'), f.tip);
});

test('lease protected deletion preserves a branch moved after the final read', async t => {
  const f = fixture(t);
  const hook = `#!/bin/sh\nwhile read localref localsha remoteref remotesha; do\n  if test "$remoteref" = refs/heads/feature/done; then\n    git --git-dir=${sh(f.remote)} update-ref "$remoteref" ${sh(f.moved)} || exit 1\n  fi\ndone\n`;
  writeFileSync(path.join(f.cwd, '.git/hooks/pre-push'), hook, { mode: 0o755 });
  const report = await run(f, { execute: true });
  assert.equal(report.results[0].status, 'retained');
  assert.equal(report.status, 'blocked');
  assert.equal(f.ref('feature/done'), f.moved);
  assert.equal(f.hasArchive(), true);
});

test('archive write rejection prevents every deletion', async t => {
  const f = fixture(t);
  writeFileSync(path.join(f.remote, 'hooks/pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const report = await run(f, { execute: true });
  retained(f, report, 'GIT_COMMAND_FAILED');
  assert.equal(f.hasArchive(), false);
});

test('API access denial fails closed and still records remaining refs', async t => {
  const f = fixture(t); f.apiError = true;
  const report = await run(f, { execute: true });
  retained(f, report, 'API_ERROR');
  assert.ok(report.remainingBranches.some(b => b.name === 'feature/done' && b.sha === f.tip));
});

test('an API response for another branch cannot supply protection approval', async t => {
  const f = fixture(t), branch = f.api.branch;
  f.api.branch = async name => ({ ...await branch(name), name: 'another-branch' });
  retained(f, await run(f, { execute: true }), 'API_ERROR');
  assert.equal(f.hasArchive(), false);
});

test('missing manifest records no request and cannot execute', async t => {
  const f = fixture(t), before = f.refs();
  const report = await run(f, { request: undefined, execute: true });
  assert.equal(report.status, 'no-request');
  assert.equal(report.mode, 'dry-run');
  assert.equal(f.refs(), before);
  assert.equal(JSON.parse(readFileSync(path.join(f.outputDir, 'result.json'))).status, 'no-request');
});

test('manifest execute false stays dry-run even with the execute flag', async t => {
  const f = fixture(t); f.request.execute = false;
  const report = await run(f, { execute: true });
  assert.equal(report.mode, 'dry-run');
  assert.equal(f.ref('feature/done'), f.tip);
  assert.equal(f.hasArchive(), false);
});

test('execution outside the single approved Actions branch fails closed', async t => {
  const f = fixture(t);
  retained(f, await run(f, { execute: true, context: { actions: true, repository: 'sharbel0022/Mgeorge', ref: 'refs/heads/main', eventName: 'workflow_dispatch' } }), 'EXECUTION_CONTEXT');
  assert.equal(f.hasArchive(), false);
});
