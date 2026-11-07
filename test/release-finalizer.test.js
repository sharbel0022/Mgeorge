import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const script = new URL('../scripts/release/finalize-cleanup-branch.mjs', import.meta.url);
const transport = new URL('../scripts/release/github-read-transport.mjs', import.meta.url);
const branch = 'release/cleanup-approved-20261107';
const jobName = 'Finalize archived execution branch';
const uploadName = 'Upload execution recovery before deletion';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sh = value => "'" + value.replaceAll("'", "'\\''") + "'";
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function fixture(t, { productChange = false, transportChange = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mgeorge-finalizer-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const seed = path.join(dir, 'seed'), remote = path.join(dir, 'remote.git'), cwd = path.join(dir, 'checkout');
  mkdirSync(seed);
  git(dir, 'init', '--bare', '--initial-branch=main', remote);
  git(seed, 'init', '--initial-branch=main');
  git(seed, 'config', 'user.name', 'Synthetic release finalization');
  git(seed, 'config', 'user.email', 'finalizer@example.invalid');
  mkdirSync(path.join(seed, 'scripts/release'), { recursive: true });
  writeFileSync(path.join(seed, 'app.txt'), 'unchanged product\n');
  writeFileSync(path.join(seed, 'scripts/release/branch-cleanup.mjs'), 'original cleanup guard\n');
  git(seed, 'add', '.'); git(seed, 'commit', '-m', 'Approved main');
  const main = git(seed, 'rev-parse', 'HEAD'), mainTree = git(seed, 'rev-parse', 'HEAD^{tree}');
  const request = { version: 1, execute: true, finalizeExecutionBranch: true, expectedMain: main,
    knownActiveBranches: ['feature/95-saas'], candidates: [{ name: 'feature/completed', sha: main }] };
  git(seed, 'checkout', '-b', branch);
  mkdirSync(path.join(seed, 'docs/cleanup'), { recursive: true });
  writeFileSync(path.join(seed, 'docs/cleanup/deletion-request.json'), JSON.stringify(request, null, 2) + '\n');
  writeFileSync(path.join(seed, 'scripts/release/finalize-cleanup-branch.mjs'), existsSync(script) ? readFileSync(script) : 'not implemented');
  if (transportChange) writeFileSync(path.join(seed, 'scripts/release/github-read-transport.mjs'), readFileSync(transport));
  if (productChange) writeFileSync(path.join(seed, 'app.txt'), 'unapproved product change\n');
  git(seed, 'add', '.'); git(seed, 'commit', '-m', 'Temporary reviewed execution payload');
  const head = git(seed, 'rev-parse', 'HEAD');
  git(seed, 'remote', 'add', 'origin', remote); git(seed, 'push', 'origin', '--all');
  writeFileSync(path.join(seed, 'app.txt'), 'new concurrent work\n');
  git(seed, 'commit', '-am', 'Concurrent work');
  const moved = git(seed, 'rev-parse', 'HEAD'); git(seed, 'push', 'origin', 'HEAD:refs/heads/future');
  git(dir, 'clone', '--no-local', remote, cwd); git(cwd, 'checkout', '--detach', main);
  const context = { actions: true, repository: 'sharbel0022/Mgeorge', ref: 'refs/heads/' + branch,
    sha: head, runId: '77', runAttempt: '2', job: 'finalize', eventName: 'push',
    workflowRef: 'sharbel0022/Mgeorge/.github/workflows/branch-cleanup.yml@refs/heads/' + branch };
  const run = { id: 77, run_attempt: 2, head_sha: head, head_branch: branch, event: 'push',
    path: '.github/workflows/branch-cleanup.yml', status: 'in_progress', conclusion: null,
    repository: { full_name: 'sharbel0022/Mgeorge' } };
  const f = { dir, remote, cwd, main, mainTree, head, moved, request, context,
    outputDir: path.join(dir, 'evidence'), protected: false, prs: [], runs: [run], currentRun: run };
  f.ref = name => git(remote, 'rev-parse', 'refs/heads/' + name);
  f.move = name => git(remote, 'update-ref', 'refs/heads/' + name, moved);
  f.jobs = [
    { id: 1, run_id: 77, head_sha: head, name: 'cleanup', status: 'completed', conclusion: 'success',
      steps: [{ name: 'Preserve results and verified recovery bundle', status: 'completed', conclusion: 'success' }] },
    { id: 2, run_id: 77, head_sha: head, name: jobName, status: 'in_progress', conclusion: null, steps: [] },
  ];
  const artifact = (id, name, sha) => ({ id, name, expired: false, size_in_bytes: 100, digest: 'sha256:' + sha,
    workflow_run: { id: 77, head_sha: head, head_branch: branch } });
  f.artifacts = [artifact(200, `branch-cleanup-${head}-77-2`, 'a'.repeat(64))];
  const page = (rows, url, key) => ({ total_count: rows.length, [key]: rows.slice((Number(url.searchParams.get('page') || 1) - 1) * 100, Number(url.searchParams.get('page') || 1) * 100) });
  f.api = {
    async get(route) {
      if (f.beforeGet) await f.beforeGet(route);
      const url = new URL(route, 'https://fixture.invalid/'), p = url.pathname;
      if (p.startsWith('/branches/')) {
        const name = decodeURIComponent(p.slice(10));
        return { name, protected: name === 'main' ? false : f.protected, commit: { sha: f.ref(name) } };
      }
      if (p === '/pulls') return f.prs.slice((Number(url.searchParams.get('page')) - 1) * 100, Number(url.searchParams.get('page')) * 100);
      if (p === '/actions/runs/77') return structuredClone(f.currentRun);
      if (p === '/actions/runs/77/attempts/2/jobs') return page(f.jobs, url, 'jobs');
      if (p === '/actions/runs') return page(f.runs, url, 'workflow_runs');
      if (p === '/actions/runs/77/artifacts') return page(f.artifacts, url, 'artifacts');
      if (p.startsWith('/actions/artifacts/')) return structuredClone(f.artifacts.find(a => String(a.id) === p.split('/').at(-1)));
      throw new Error('Unexpected fixture API route: ' + route);
    },
    async downloadArtifact(id) { assert.equal(String(id), '201'); return readFileSync(f.zip); },
  };
  f.publish = () => {
    f.zip = path.join(dir, 'uploaded.zip');
    execFileSync('zip', ['-q', '-j', f.zip, path.join(f.outputDir, 'execution-recovery.bundle'), path.join(f.outputDir, 'execution-recovery.json')]);
    const sha = digest(readFileSync(f.zip));
    f.artifacts.push(artifact(201, `execution-recovery-${head}-77-2`, sha));
    f.jobs[1].steps = [{ name: uploadName, status: 'completed', conclusion: 'success' }];
    return { artifactId: '201', artifactDigest: sha };
  };
  return f;
}

async function run(f, options = {}) {
  assert.ok(existsSync(script), 'The terminal finalizer is not implemented yet');
  const { runFinalization } = await import(script);
  return runFinalization({ cwd: f.cwd, outputDir: f.outputDir, request: f.request,
    context: f.context, api: f.api, expectedRemoteUrl: f.remote, phase: 'prepare', ...options });
}
async function prepared(f) {
  const result = await run(f);
  assert.equal(result.status, 'prepared', JSON.stringify(result));
  assert.equal(f.ref(branch), f.head);
  return f.publish();
}

test('default check cannot archive or delete the execution branch', async t => {
  const f = fixture(t), report = await run(f, { phase: 'check' });
  assert.equal(report.status, 'ready');
  assert.equal(f.ref(branch), f.head);
  assert.equal(git(f.remote, 'for-each-ref', '--format=%(refname)', 'refs/tags'), '');
});

test('uploaded independently restored recovery permits exact release deletion and leaves main unchanged', async t => {
  const f = fixture(t), originalContext = structuredClone(f.context), uploaded = await prepared(f);
  const report = await run(f, { phase: 'delete', ...uploaded });
  assert.equal(report.status, 'deleted', JSON.stringify(report));
  assert.equal(report.mainUnchanged, true);
  assert.equal(report.productCheckoutUnchanged, true);
  assert.equal(report.uploadVerified, true);
  assert.ok(Array.isArray(report.remainingHeads), 'Final evidence includes the complete remaining branch inventory');
  assert.ok(report.remainingHeads.some(row => row.name === 'future' && row.sha === f.moved));
  assert.ok(!report.remainingHeads.some(row => row.name === branch));
  assert.equal(f.ref('main'), f.main);
  assert.equal(git(f.cwd, 'rev-parse', 'HEAD^{tree}'), f.mainTree);
  assert.throws(() => f.ref(branch));
  assert.equal(git(f.remote, 'rev-parse', report.archiveRef + '^{commit}'), f.head);
  assert.equal(git(path.join(f.outputDir, 'uploaded-restore.git'), 'rev-parse', report.archiveRef + '^{commit}'), f.head);
  assert.deepEqual(f.context, originalContext);
});

for (const missing of ['cleanup', 'cleanup upload', 'cleanup artifact']) test('incomplete prerequisite retains execution branch: ' + missing, async t => {
  const f = fixture(t);
  if (missing === 'cleanup') f.jobs[0].conclusion = 'failure';
  if (missing === 'cleanup upload') f.jobs[0].steps[0].conclusion = 'failure';
  if (missing === 'cleanup artifact') f.artifacts = [];
  const report = await run(f);
  assert.equal(report.status, 'retained');
  assert.equal(f.ref(branch), f.head);
  assert.equal(git(f.remote, 'for-each-ref', '--format=%(refname)', 'refs/tags'), '');
});

test('separate explicit finalization intent is required', async t => {
  const f = fixture(t); delete f.request.finalizeExecutionBranch;
  assert.equal((await run(f)).status, 'retained');
  assert.equal(f.ref(branch), f.head);
});

test('the real checkout must be exactly approved main, without faking workflow context', async t => {
  const f = fixture(t); git(f.cwd, 'checkout', '--detach', f.head);
  const report = await run(f);
  assert.equal(report.code, 'CHECKOUT_MISMATCH');
  assert.equal(f.ref(branch), f.head);
});

test('a release commit containing product changes cannot be finalized', async t => {
  const f = fixture(t, { productChange: true });
  assert.equal((await run(f)).code, 'PRODUCT_CHANGE');
  assert.equal(f.ref(branch), f.head);
});

for (const changed of ['main', branch]) test('a changed remote ref after upload blocks deletion: ' + changed, async t => {
  const f = fixture(t), uploaded = await prepared(f); f.move(changed);
  const report = await run(f, { phase: 'delete', ...uploaded });
  assert.equal(report.status, 'retained');
  assert.equal(report.code, changed === 'main' ? 'MAIN_MOVED' : 'HEAD_MOVED');
  assert.equal(f.ref(branch), changed === branch ? f.moved : f.head);
});

test('new branch protection after upload blocks deletion', async t => {
  const f = fixture(t), uploaded = await prepared(f); f.protected = true;
  assert.equal((await run(f, { phase: 'delete', ...uploaded })).code, 'PROTECTED');
  assert.equal(f.ref(branch), f.head);
});

for (const side of ['head', 'base']) test('new open PR on either side blocks finalization: ' + side, async t => {
  const f = fixture(t), uploaded = await prepared(f);
  f.prs = [{ id: 19, number: 19, state: 'open', head: { ref: 'elsewhere' }, base: { ref: 'main' } }];
  f.prs[0][side].ref = branch;
  assert.equal((await run(f, { phase: 'delete', ...uploaded })).code, 'OPEN_PR');
  assert.equal(f.ref(branch), f.head);
});

for (const status of ['queued', 'waiting', 'pending']) test('an active workflow on page two blocks finalization: ' + status, async t => {
  const f = fixture(t), uploaded = await prepared(f);
  f.runs = [f.currentRun, ...Array.from({ length: 99 }, (_, i) => ({ ...f.currentRun, id: 1000 + i, status: 'completed', conclusion: 'success' })), { ...f.currentRun, id: 9000, status }];
  assert.equal((await run(f, { phase: 'delete', ...uploaded })).code, 'OTHER_ACTIVE_RUN');
  assert.equal(f.ref(branch), f.head);
});

test('only the exact current terminal job may remain active, including later job pages', async t => {
  const f = fixture(t), uploaded = await prepared(f);
  f.jobs.push(...Array.from({ length: 98 }, (_, i) => ({ id: 100 + i, run_id: 77, head_sha: f.head, name: 'finished-' + i, status: 'completed', conclusion: 'success' })));
  f.jobs.push({ id: 999, run_id: 77, head_sha: f.head, name: 'other-work', status: 'queued', conclusion: null });
  assert.equal((await run(f, { phase: 'delete', ...uploaded })).code, 'OTHER_ACTIVE_JOB');
  assert.equal(f.ref(branch), f.head);
});

test('current run attempt and head must match the real Actions context', async t => {
  const f = fixture(t); f.currentRun.run_attempt = 3;
  assert.equal((await run(f)).code, 'RUN_CONTEXT');
  assert.equal(f.ref(branch), f.head);
});

test('missing upload identity cannot delete a locally prepared archive', async t => {
  const f = fixture(t); await run(f);
  assert.equal((await run(f, { phase: 'delete' })).status, 'retained');
  assert.equal(f.ref(branch), f.head);
});

test('an artifact belonging to another source head is rejected', async t => {
  const f = fixture(t), uploaded = await prepared(f); f.artifacts[1].workflow_run.head_sha = 'a'.repeat(40);
  assert.equal((await run(f, { phase: 'delete', ...uploaded })).code, 'ARTIFACT_UNVERIFIED');
  assert.equal(f.ref(branch), f.head);
});

test('downloaded artifact bytes must match the upload digest', async t => {
  const f = fixture(t), uploaded = await prepared(f); writeFileSync(f.zip, 'corrupted upload');
  assert.equal((await run(f, { phase: 'delete', ...uploaded })).code, 'ARTIFACT_UNVERIFIED');
  assert.equal(f.ref(branch), f.head);
});

test('archive permission failure retains the branch', async t => {
  const f = fixture(t); writeFileSync(path.join(f.remote, 'hooks/pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  assert.equal((await run(f)).status, 'retained');
  assert.equal(f.ref(branch), f.head);
});

test('exact deletion lease preserves concurrent work after the last read', async t => {
  const f = fixture(t), uploaded = await prepared(f);
  writeFileSync(path.join(f.cwd, '.git/hooks/pre-push'), `#!/bin/sh\nwhile read localref localsha remoteref remotesha; do\n  if test "$remoteref" = refs/heads/${branch}; then\n    git --git-dir=${sh(f.remote)} update-ref "$remoteref" ${sh(f.moved)} || exit 1\n  fi\ndone\n`, { mode: 0o755 });
  assert.equal((await run(f, { phase: 'delete', ...uploaded })).status, 'retained');
  assert.equal(f.ref(branch), f.moved);
  assert.equal(f.ref('main'), f.main);
});

const apiRoot = 'https://api.github.com/repos/sharbel0022/Mgeorge/';

test('transport scopes GET connection closure and preserves all supplied request options', async () => {
  const { createGitHubReadTransport } = await import(transport);
  const calls = [], response = new Response('{}');
  const wrapped = createGitHubReadTransport(function (...args) { calls.push({ receiver: this, args }); return Promise.resolve(response); });
  const controller = new AbortController(), headers = new Headers({ Authorization: 'Bearer synthetic-token', Accept: 'application/json' });
  const inherited = { signal: controller.signal, redirect: 'manual', cache: 'no-store' };
  const init = Object.assign(Object.create(inherited), { method: 'get', headers });
  const receiver = {}, url = new URL(apiRoot + 'branches/main');
  assert.equal(await wrapped.call(receiver, url, init), response);
  const call = calls[0], options = call.args[1];
  assert.equal(call.receiver, receiver);
  assert.equal(call.args[0], url);
  assert.equal(options.signal, controller.signal);
  assert.equal(options.redirect, 'manual');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.method, 'get');
  assert.equal(options.headers.get('authorization'), 'Bearer synthetic-token');
  assert.equal(options.headers.get('accept'), 'application/json');
  assert.equal(options.headers.get('connection'), 'close');
  assert.equal(headers.has('connection'), false);
  assert.equal(init.headers, headers);
  assert.equal(calls.length, 1);
});

test('transport honors Request headers and explicit init-header precedence without replacing its signal', async () => {
  const { createGitHubReadTransport } = await import(transport);
  const calls = [], wrapped = createGitHubReadTransport((...args) => { calls.push(args); return Promise.resolve(new Response('{}')); });
  const controller = new AbortController();
  const request = new Request(apiRoot + 'pulls?state=open', { headers: { Authorization: 'Bearer request-token', 'X-Request': 'kept' }, signal: controller.signal, redirect: 'error' });
  await wrapped(request);
  assert.equal(calls[0][0], request);
  assert.equal(calls[0][1].headers.get('authorization'), 'Bearer request-token');
  assert.equal(calls[0][1].headers.get('x-request'), 'kept');
  assert.equal(calls[0][1].headers.get('connection'), 'close');
  assert.equal(calls[0][1].signal, undefined, 'The original Request continues to supply its exact signal');
  assert.equal(request.redirect, 'error');
  assert.equal(request.headers.has('connection'), false);
  const override = { headers: [['Authorization', 'Bearer override-token']] };
  await wrapped(request, override);
  assert.equal(calls[1][1].headers.get('authorization'), 'Bearer override-token');
  assert.equal(calls[1][1].headers.has('x-request'), false);
  assert.deepEqual(override.headers, [['Authorization', 'Bearer override-token']]);
});

test('transport passes every other origin, repository and method through unchanged', async () => {
  const { createGitHubReadTransport } = await import(transport);
  const calls = [], wrapped = createGitHubReadTransport((...args) => { calls.push(args); return Promise.resolve(new Response('{}')); });
  const cases = [
    ['https://storage.example.invalid/private.zip', {}],
    ['https://api.github.com.evil.invalid/repos/sharbel0022/Mgeorge/branches/main', {}],
    ['http://api.github.com/repos/sharbel0022/Mgeorge/branches/main', {}],
    ['https://api.github.com:444/repos/sharbel0022/Mgeorge/branches/main', {}],
    ['https://user:password@api.github.com/repos/sharbel0022/Mgeorge/branches/main', {}],
    ['https://api.github.com/repos/sharbel0022/Mgeorge-other/branches/main', {}],
    ['https://api.github.com/repos/elsewhere/Mgeorge/branches/main', {}],
    ['https://api.github.com/repos/sharbel0022/Mgeorge', {}],
    [apiRoot + 'git/refs', { method: 'POST', body: 'synthetic body' }],
    [apiRoot + 'branches/main', { method: 'HEAD' }],
    [new Request(apiRoot + 'git/refs', { method: 'POST', body: 'synthetic body' }), undefined],
    [new Request(apiRoot + 'branches/main'), { method: 'DELETE' }],
  ];
  for (const args of cases) {
    await wrapped(...args);
    const received = calls.at(-1);
    assert.equal(received[0], args[0]);
    assert.equal(received[1], args[1]);
    assert.equal(received.length, args.length);
  }
  assert.equal(calls.length, cases.length);
});

test('transport propagates the same failure once and emits only sanitized endpoint and error codes', async () => {
  const { createGitHubReadTransport } = await import(transport);
  const diagnostics = [];
  let calls = 0;
  const failure = Object.assign(new TypeError('secret raw message'), { cause: Object.assign(new Error('secret cause'), { code: 'UND_ERR_SOCKET' }) });
  const wrapped = createGitHubReadTransport(async () => { calls++; throw failure; }, row => diagnostics.push(row));
  await assert.rejects(wrapped(apiRoot + 'branches/sensitive-branch?token=secret-query', { headers: { Authorization: 'Bearer secret-token' }, redirect: 'error' }), error => error === failure);
  assert.equal(calls, 1, 'Transport failures are never retried');
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].endpoint, '/repos/sharbel0022/Mgeorge/branches/[ref]');
  assert.equal(diagnostics[0].causeCode, 'UND_ERR_SOCKET');
  assert.doesNotMatch(JSON.stringify(diagnostics), /secret|sensitive|authorization|headers|body/i);
  const abort = Object.assign(new Error('secret abort reason'), { code: 'ABORT_ERR', cause: { code: 'SECRET_DIAGNOSTIC' } });
  const aborted = createGitHubReadTransport(async () => { throw abort; }, row => diagnostics.push(row));
  await assert.rejects(aborted(apiRoot + 'branches/main'), error => error === abort);
  assert.equal(diagnostics[1].code, 'ABORT_ERR');
  assert.equal(diagnostics[1].causeCode, 'UNKNOWN');
  assert.doesNotMatch(JSON.stringify(diagnostics), /SECRET_DIAGNOSTIC/);
  const brokenLogger = createGitHubReadTransport(async () => { throw failure; }, () => { throw new Error('logger failed'); });
  await assert.rejects(brokenLogger(apiRoot + 'branches/main'), error => error === failure);
  const denied = new Response('denied', { status: 403 });
  let deniedCalls = 0;
  const noRetry = createGitHubReadTransport(async () => { deniedCalls++; return denied; });
  assert.equal(await noRetry(apiRoot + 'branches/main'), denied);
  assert.equal(deniedCalls, 1);
});

test('transport survives three warm GETs and a synchronous pause after the server closes idle sockets', { timeout: 20_000 }, async t => {
  const { createGitHubReadTransport, originalFetch } = await import(transport);
  const serverCode = [
    "import http from 'node:http';",
    "let sequence = 0; const sockets = new WeakMap();",
    "const server = http.createServer((request, response) => {",
    "  response.setHeader('content-type', 'application/json');",
    "  response.setHeader('keep-alive', 'timeout=4');",
    "  response.end(JSON.stringify({ socketId: sockets.get(request.socket), connection: request.headers.connection }));",
    "});",
    "server.keepAliveTimeout = 4000; server.keepAliveTimeoutBuffer = 0;",
    "server.on('connection', socket => sockets.set(socket, ++sequence));",
    "server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));",
    "process.on('disconnect', () => process.exit(0));",
  ].join('\n');
  const child = spawn(process.execPath, ['--input-type=module', '-e', serverCode], { env: { PATH: process.env.PATH }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit', { signal: AbortSignal.timeout(2000) }).catch(() => child.kill('SIGKILL'));
      child.kill('SIGTERM'); await stopped;
    }
  });
  const [{ port }] = await once(child, 'message', { signal: AbortSignal.timeout(5000) });
  const local = 'http://127.0.0.1:' + port;
  const wrapped = createGitHubReadTransport((input, options) => {
    assert.equal(input, apiRoot + 'branches/main');
    return originalFetch(local, options);
  });
  const get = async () => (await wrapped(apiRoot + 'branches/main', { redirect: 'error', signal: AbortSignal.timeout(3000) })).json();
  const warm = [];
  for (let i = 0; i < 3; i++) warm.push(await get());
  const blocked = spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { timeout: 7000, env: { PATH: process.env.PATH } });
  assert.equal(blocked.status, 0);
  const after = await get();
  assert.deepEqual([...warm, after].map(row => row.socketId), [1, 2, 3, 4]);
  assert.ok([...warm, after].every(row => row.connection === 'close'));
});

test('finalizer closes GitHub GET connections without forwarding authorization to artifact storage', async t => {
  const { createFinalizationApi } = await import(script);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    calls.push({ url: String(input), options });
    if (String(input).endsWith('/zip')) return new Response(null, { status: 302, headers: { Location: 'https://storage.example.invalid/recovery.zip?signature=synthetic' } });
    if (String(input).startsWith('https://storage.')) return new Response('verified recovery');
    return new Response('{"name":"main"}', { headers: { 'Content-Type': 'application/json' } });
  });
  const api = createFinalizationApi('synthetic-actions-token');
  assert.deepEqual(await api.get('branches/main'), { name: 'main' });
  assert.equal((await api.downloadArtifact(17)).toString(), 'verified recovery');
  assert.equal(calls.length, 3);
  for (const call of calls.slice(0, 2)) {
    const headers = new Headers(call.options.headers);
    assert.equal(headers.get('authorization'), 'Bearer synthetic-actions-token');
    assert.equal(headers.get('connection'), 'close');
    assert.ok(call.options.signal instanceof AbortSignal);
  }
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[1].options.redirect, 'manual');
  assert.equal(calls[2].options.redirect, 'error');
  assert.equal(calls[2].options.headers, undefined);
  assert.ok(calls[2].options.signal instanceof AbortSignal);
});

test('the single new transport path is permitted in the archived operational payload', async t => {
  const f = fixture(t, { transportChange: true });
  const report = await run(f, { phase: 'check' });
  assert.equal(report.status, 'ready', JSON.stringify(report));
  assert.ok(report.changedPaths.includes('scripts/release/github-read-transport.mjs'));
  assert.equal(f.ref(branch), f.head);
  assert.equal(f.ref('main'), f.main);
});
