import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat, writeFile, chmod, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';
import ssh2 from 'ssh2';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { createBridge } from '../src/bridge.js';
import { startSftp } from './sftp-server.js';

const token = 'fixture-only-012345678901234567890123456789';
function config(remote, spool, extra = {}) {
  return {
    enabled: true, spoolDirectory: spool, bearerToken: token,
    binding: { owner: 'fixture-owner', sourceId: 'fixture-source', companyId: 'fixture-company', bankgiro: '1234567', scopeId: 'fixture-scope', generation: '1', profileId: 'fixture-csv' },
    entitlement: { status: 'VERIFIED', origin: 'provider_authorization', evidenceId: 'fixture-proof', checkedAt: '2026-11-03T00:00:00Z', validUntil: '2099-01-01T00:00:00Z', capabilities: ['bankgiro_reports:read'] },
    sftp: { host: '127.0.0.1', port: remote.port, username: 'reader', password: 'fixture-password', hostKeySha256: remote.hostKeySha256, remoteDirectory: '/reports' },
    allowedFormats: ['csv'], maxFileBytes: 100000, maxEntries: 20, operationTimeoutMs: 700, scanTimeoutMs: 6000,
    ...extra
  };
}
async function setup(t, options = {}, extra = {}) {
  const remote = await startSftp(options);
  const dir = await mkdtemp(join(tmpdir(), 'bankgiro-bridge-'));
  const bridge = await createBridge(config(remote, join(dir, 'spool'), extra));
  const bridges = new Set([bridge]);
  const track = value => { bridges.add(value); return value; };
  t.after(async () => { for (const value of bridges) await value.close(); await remote.close(); await rm(dir, { recursive: true, force: true }); });
  return { bridge, remote, dir, track };
}
async function serving(bridge) {
  const server = bridge.createHttpServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}
const get = (base, path, auth = token) => fetch(base + path, { headers: auth == null ? {} : { authorization: `Bearer ${auth}` } });

// Removing journal publication or SFTP fetch makes this fail at the real HTTP output.
test('authenticated real SFTP delivery is retained and exposed through the scoped normalized HTTP contract', async t => {
  const { bridge, remote, dir } = await setup(t);
  assert.deepEqual(await bridge.syncOnce(), { discovered: 1, conflicts: 0 });
  const base = await serving(bridge);
  const receipt = await (await get(base, '/v1/authorization')).json();
  assert.equal(receipt.status, 'VERIFIED'); assert.equal(receipt.owner, 'fixture-owner');
  assert.equal(receipt.origin, 'provider_authorization'); assert.equal(receipt.profileId, 'fixture-csv');
  const page = await (await get(base, '/v1/reports?limit=1')).json();
  assert.equal(page.reports.length, 1); assert.equal(page.nextCursor, '1');
  const report = page.reports[0];
  assert.match(report.reportId, /^[a-f0-9]{64}$/);
  assert.equal(report.filename, 'report.csv'); assert.equal(report.byteLength, 26);
  const bytes = Buffer.from(await (await get(base, `/v1/reports/${report.reportId}/content`)).arrayBuffer());
  assert.equal(bytes.toString(), 'reference,amount\n0599,100\n');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), report.sha256);
  assert.equal((await stat(join(dir, 'spool'))).mode & 0o777, 0o700);
  assert.equal((await stat(join(dir, 'spool', 'blobs', report.sha256))).mode & 0o777, 0o400);
  assert.equal(remote.operations.some(([op]) => ['WRITE', 'REMOVE', 'RENAME'].includes(op)), false);
});

test('host identity mismatch and upstream authentication failure never publish a report', async t => {
  for (const kind of ['host', 'password']) {
    const { bridge, remote } = await setup(t);
    const altered = kind === 'host' ? { hostKeySha256: '0'.repeat(64) } : { password: 'wrong' };
    await bridge.close();
    const dir = await mkdtemp(join(tmpdir(), 'bankgiro-negative-'));
    const bad = await createBridge(config(remote, join(dir, 'spool'), { sftp: { ...config(remote, '').sftp, ...altered } }));
    t.after(async () => { await bad.close(); await rm(dir, { recursive: true, force: true }); });
    await assert.rejects(bad.syncOnce(), { code: kind === 'host' ? 'HOST_IDENTITY_FAILED' : 'UPSTREAM_UNAVAILABLE' });
    assert.deepEqual(bad.listReports({ limit: 10 }).reports, []);
  }
});

test('HTTP Bearer guard covers authorization, listing and content; errors never echo secrets', async t => {
  const { bridge } = await setup(t); await bridge.syncOnce();
  const base = await serving(bridge);
  for (const path of ['/v1/authorization', '/v1/reports', '/v1/reports/' + 'a'.repeat(64) + '/content']) {
    for (const auth of [null, 'wrong-' + token]) {
      const response = await get(base, path, auth);
      assert.equal(response.status, 401); assert.equal((await response.text()).includes(token), false);
    }
  }
  assert.equal((await get(base, '/v1/reports?cursor=../evil')).status, 400);
  assert.equal((await get(base, '/v1/reports?limit=51')).status, 400);
  assert.equal((await fetch(base + '/v1/reports', { method: 'POST', headers: { authorization: `Bearer ${token}` } })).status, 405);
});

test('sequence cursors discover late old-dated deliveries and replay survives restart', async t => {
  const { bridge, remote, dir, track } = await setup(t); await bridge.syncOnce();
  const original = bridge.listReports({ limit: 10 }).reports[0];
  assert.deepEqual(await bridge.syncOnce(), { discovered: 0, conflicts: 0 });
  await bridge.close();
  const reopened = track(await createBridge(config(remote, join(dir, 'spool'))));
  assert.equal(reopened.listReports({ limit: 10 }).reports[0].reportId, original.reportId);
  remote.files.set('late.csv', { bytes: Buffer.from('reference,amount\n599,9\n'), mtime: 1, mode: 0o100400 });
  await reopened.syncOnce();
  const late = reopened.listReports({ cursor: '1', limit: 1 });
  assert.equal(late.reports[0].filename, 'late.csv'); assert.equal(late.nextCursor, '2');
  assert.equal(reopened.listReports({ cursor: '2', limit: 1 }).nextCursor, '2');
});

test('changed bytes under one delivery ID preserve both originals and surface conflict', async t => {
  const { bridge, remote, dir } = await setup(t); await bridge.syncOnce();
  const first = bridge.listReports({ limit: 10 }).reports[0];
  remote.files.get('report.csv').bytes = Buffer.from('reference,amount\n0599,999\n');
  assert.deepEqual(await bridge.syncOnce(), { discovered: 0, conflicts: 1 });
  const changed = bridge.listReports({ cursor: '1', limit: 10 }).reports[0];
  assert.equal(changed.reportId, first.reportId); assert.notEqual(changed.sha256, first.sha256);
  assert.equal((await readdir(join(dir, 'spool', 'blobs'))).length, 2);
  const base = await serving(bridge);
  assert.equal((await get(base, `/v1/reports/${first.reportId}/content`)).status, 409);
  assert.equal((await readFile(join(dir, 'spool', 'blobs', first.sha256))).toString(), 'reference,amount\n0599,100\n');
});

for (const [name, options] of [
  ['symlink', { files: { 'link.csv': { bytes: Buffer.from('evil'), mode: 0o120777, mtime: 1 } } }],
  ['path traversal', { files: { '../escape.csv': 'evil' } }],
  ['changing metadata', { onRead(offset, file) { file.mtime++; } }],
  ['canonical path swap', { realpath(path) { return path.endsWith('.csv') ? '/elsewhere/report.csv' : path; } }],
  ['partial stream', { partialAt: 10 }],
  ['disconnect', { disconnectAt: 10 }],
  ['unbounded enumeration', { repeatListing: true }],
  ['stalled protocol', { stallRead: true }]
]) {
  test(`${name} cannot publish an incomplete original`, async t => {
    const { bridge, dir } = await setup(t, options);
    await assert.rejects(bridge.syncOnce());
    assert.deepEqual(bridge.listReports({ limit: 10 }).reports, []);
    assert.deepEqual(await readdir(join(dir, 'spool', 'journal')), []);
    assert.deepEqual(await readdir(join(dir, 'spool', 'tmp')), []);
  });
}

test('oversize, insecure spool, missing pin and disabled or expired entitlement fail closed', async t => {
  const { bridge, remote, dir, track } = await setup(t, {}, { maxFileBytes: 10 });
  await assert.rejects(bridge.syncOnce(), { code: 'REMOTE_FILE_REJECTED' });
  await assert.rejects(createBridge(config(remote, join(dir, 'missing-pin'), { sftp: { ...config(remote, '').sftp, hostKeySha256: '' } })), { code: 'INVALID_CONFIGURATION' });
  const disabled = track(await createBridge(config(remote, join(dir, 'disabled'), { enabled: false })));
  await assert.rejects(disabled.syncOnce(), { code: 'AUTHORIZATION_BLOCKED' });
  const base = await serving(disabled); assert.equal((await get(base, '/v1/authorization')).status, 403);
  const expired = track(await createBridge(config(remote, join(dir, 'expired'), { entitlement: { ...config(remote, '').entitlement, checkedAt: '2019-01-01T00:00:00Z', validUntil: '2020-01-01T00:00:00Z' } })));
  await assert.rejects(expired.syncOnce(), { code: 'AUTHORIZATION_BLOCKED' });
});

test('journal ownership is exclusive and a differently scoped restart is rejected', async t => {
  const { bridge, remote, dir } = await setup(t); await bridge.syncOnce();
  await assert.rejects(createBridge(config(remote, join(dir, 'spool'))), { code: 'SPOOL_LOCKED' });
  await bridge.close();
  await assert.rejects(createBridge(config(remote, join(dir, 'spool'), { binding: { ...config(remote, '').binding, generation: '2' } })), { code: 'SPOOL_BINDING_MISMATCH' });
});

// An OS lock released by process death must not require unsafe stale-PID lock deletion.
test('real process kill releases exclusive journal ownership and restart replays committed originals', async t => {
  const { bridge, remote, dir, track } = await setup(t); await bridge.syncOnce(); await bridge.close();
  const configuration = config(remote, join(dir, 'spool'));
  const conf = join(dir, 'child.json'); await writeFile(conf, JSON.stringify(configuration), { mode: 0o600 });
  const script = `import { readFile } from 'node:fs/promises'; import { createBridge } from './src/bridge.js'; const b=await createBridge(JSON.parse(await readFile(process.argv[1],'utf8'))); console.log('READY'); setInterval(()=>{},10000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, conf], { cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode == null) child.kill('SIGKILL'); });
  const ready = await Promise.race([once(child.stdout, 'data').then(([chunk]) => chunk.toString()), once(child, 'exit').then(() => 'EXIT')]);
  assert.equal(ready.trim(), 'READY');
  await assert.rejects(createBridge(configuration), { code: 'SPOOL_LOCKED' });
  child.kill('SIGKILL'); await once(child, 'exit');
  // A spoofed live-PID lock from a legacy implementation must be irrelevant to OS ownership.
  await writeFile(join(dir, 'spool', 'writer.lock'), JSON.stringify({ pid: process.pid, nonce: 'legacy' }), { mode: 0o600 });
  const restarted = track(await createBridge(configuration));
  assert.equal(restarted.listReports({ limit: 10 }).reports.length, 1);
  assert.deepEqual(await restarted.syncOnce(), { discovered: 0, conflicts: 0 });
});

test('empty pages retain the discovery checkpoint rather than resetting late-file discovery', async t => {
  const { bridge } = await setup(t); await bridge.syncOnce();
  assert.deepEqual(bridge.listReports({ cursor: '1', limit: 1 }), { reports: [], nextCursor: '1' });
});

test('private spool permissions and local symlink substitutions are refused', async t => {
  const { remote, dir } = await setup(t);
  const insecure = join(dir, 'public-spool'); await mkdir(insecure, { mode: 0o755 });
  await assert.rejects(createBridge(config(remote, insecure)), { code: 'INSECURE_SPOOL' });
  const target = join(dir, 'target'); await mkdir(target, { mode: 0o700 });
  const alias = join(dir, 'alias'); await symlink(target, alias);
  await assert.rejects(createBridge(config(remote, alias)), { code: 'INSECURE_SPOOL' });
});

test('tampered retained bytes are blocked at HTTP readback and restart', async t => {
  const { bridge, remote, dir } = await setup(t); await bridge.syncOnce();
  const report = bridge.listReports({ limit: 10 }).reports[0];
  const blob = join(dir, 'spool', 'blobs', report.sha256);
  await chmod(blob, 0o600); await writeFile(blob, 'tampered-original'); await chmod(blob, 0o400);
  const base = await serving(bridge);
  assert.equal((await get(base, `/v1/reports/${report.reportId}/content`)).status, 503);
  await bridge.close();
  await assert.rejects(createBridge(config(remote, join(dir, 'spool'))), { code: 'SPOOL_CORRUPT' });
});

test('source authorization needs a fresh successful scan and fails again after upstream rejection', async t => {
  const { bridge, remote } = await setup(t);
  const base = await serving(bridge);
  assert.equal((await get(base, '/v1/authorization')).status, 503);
  await bridge.syncOnce(); assert.equal((await get(base, '/v1/authorization')).status, 200);
  remote.files.get('report.csv').mode = 0o120777;
  await assert.rejects(bridge.syncOnce());
  assert.equal((await get(base, '/v1/authorization')).status, 503);
  assert.equal(bridge.listReports({ limit: 10 }).reports.length, 1);
});

test('directory entry count is bounded before any report publication', async t => {
  const files = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`file${i}.csv`, 'reference,amount\n0599,1\n']));
  const { bridge } = await setup(t, { files });
  await assert.rejects(bridge.syncOnce(), { code: 'REMOTE_DIRECTORY_LIMIT' });
  assert.deepEqual(bridge.listReports({ limit: 10 }).reports, []);
});

test('upstream rename retains exact bytes with a new delivery ID for downstream hash deduplication', async t => {
  const { bridge, remote } = await setup(t); await bridge.syncOnce();
  const first = bridge.listReports({ limit: 10 }).reports[0];
  remote.files.set('renamed.csv', remote.files.get('report.csv')); remote.files.delete('report.csv');
  await bridge.syncOnce();
  const second = bridge.listReports({ cursor: '1', limit: 1 }).reports[0];
  assert.notEqual(second.reportId, first.reportId); assert.equal(second.sha256, first.sha256);
});

test('entitlement expiry during an upstream transfer prevents journal publication', async t => {
  const realNow = Date.now;
  const remoteOptions = { onRead() { Date.now = () => Date.parse('2100-01-01T00:00:00Z'); } };
  const { bridge } = await setup(t, remoteOptions);
  try {
    await assert.rejects(bridge.syncOnce());
    assert.deepEqual(bridge.listReports({ limit: 10 }).reports, []);
  } finally { Date.now = realNow; }
});

test('authorization projection never returns undeclared trusted-config fields', async t => {
  const remote = await startSftp();
  const dir = await mkdtemp(join(tmpdir(), 'bridge-projection-'));
  const c = config(remote, join(dir, 'spool'));
  c.binding.debugCredential = 'private-canary'; c.entitlement.debugCredential = 'private-canary';
  const bridge = await createBridge(c);
  t.after(async () => { await bridge.close(); await remote.close(); await rm(dir, { recursive: true, force: true }); });
  await bridge.syncOnce(); const base = await serving(bridge);
  const body = await (await get(base, '/v1/authorization')).text();
  assert.equal(body.includes('private-canary'), false);
});

test('SIGKILL during a real stalled SFTP read publishes nothing partial and restart resumes discovery', async t => {
  const options = {};
  const { bridge, remote, dir, track } = await setup(t, options); await bridge.syncOnce(); await bridge.close();
  remote.files.set('late.csv', { bytes: Buffer.from('reference,amount\n599,9\n'), mode: 0o100400, mtime: 1 });
  options.stallRead = true;
  let timer;
  const readStarted = new Promise((resolve, reject) => { options.onRequestRead = resolve; timer = setTimeout(() => reject(new Error('SFTP read not reached')), 5000); });
  const conf = join(dir, 'child-transfer.json'); await writeFile(conf, JSON.stringify(config(remote, join(dir, 'spool'))), { mode: 0o600 });
  const script = `import { readFile } from 'node:fs/promises'; import { createBridge } from './src/bridge.js'; const b=await createBridge(JSON.parse(await readFile(process.argv[1],'utf8'))); await b.syncOnce();`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, conf], { cwd: new URL('..', import.meta.url), stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(() => { clearTimeout(timer); if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL'); });
  await readStarted; clearTimeout(timer);
  child.kill('SIGKILL'); await once(child, 'exit'); options.stallRead = false; delete options.onRequestRead;
  const restarted = track(await createBridge(config(remote, join(dir, 'spool'))));
  assert.equal(restarted.listReports({ limit: 10 }).reports.length, 1);
  await restarted.syncOnce();
  assert.equal(restarted.listReports({ cursor: '1', limit: 10 }).reports[0].filename, 'late.csv');
  assert.deepEqual(await readdir(join(dir, 'spool', 'tmp')), []);
});

test('aborted transfer cannot publish and a later complete retry retains the original', async t => {
  const controller = new AbortController();
  const options = { onRequestRead() { controller.abort(); } };
  const { bridge } = await setup(t, options);
  await assert.rejects(bridge.syncOnce({ signal: controller.signal }));
  assert.deepEqual(bridge.listReports({ limit: 10 }).reports, []);
  delete options.onRequestRead;
  assert.deepEqual(await bridge.syncOnce(), { discovered: 1, conflicts: 0 });
});


test('anonymous-only upstream cannot replace the configured authentication method', async t => {
  const { bridge } = await setup(t, { anonymousOnly: true });
  await assert.rejects(bridge.syncOnce(), { code: 'UPSTREAM_UNAVAILABLE' });
  assert.deepEqual(bridge.listReports({ limit: 10 }).reports, []);
});


test('configured upstream private-key authentication completes a signed real SSH exchange', async t => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'pkcs1', format: 'pem' } });
  const authorizedKey = ssh2.utils.parseKey(privateKey);
  const remote = await startSftp({ authorizedKey });
  const dir = await mkdtemp(join(tmpdir(), 'bridge-key-auth-'));
  const c = config(remote, join(dir, 'spool'));
  delete c.sftp.password; c.sftp.privateKey = Buffer.from(privateKey);
  const bridge = await createBridge(c);
  t.after(async () => { await bridge.close(); await remote.close(); await rm(dir, { recursive: true, force: true }); });
  assert.deepEqual(await bridge.syncOnce(), { discovered: 1, conflicts: 0 });
});

test('clock rollback and stale scan receipts cannot claim current authorization', async t => {
  const { bridge } = await setup(t); await bridge.syncOnce();
  const base = await serving(bridge); const realNow = Date.now; const fixed = realNow();
  try {
    Date.now = () => fixed - 60000;
    assert.equal((await get(base, '/v1/authorization')).status, 503);
    Date.now = () => fixed + 300001;
    assert.equal((await get(base, '/v1/authorization')).status, 503);
  } finally { Date.now = realNow; }
});


test('abort during durable blob publication cannot publish a journal event or fresh authorization', async t => {
  const { bridge, dir } = await setup(t);
  const controller = new AbortController();
  const watcher = watch(join(dir, 'spool', 'blobs'), () => controller.abort());
  t.after(() => watcher.close());
  await assert.rejects(bridge.syncOnce({ signal: controller.signal }), { code: 'ABORTED' });
  assert.equal(controller.signal.aborted, true);
  assert.deepEqual(bridge.listReports({ limit: 10 }).reports, []);
  const base = await serving(bridge);
  assert.equal((await get(base, '/v1/authorization')).status, 503);
});

test('a scan deadline reached during blob publication cannot publish or refresh authority', async t => {
  const { bridge, dir } = await setup(t);
  const realNow = Date.now; const clock = realNow();
  const watcher = watch(join(dir, 'spool', 'blobs'), () => { Date.now = () => clock + 10000; });
  t.after(() => watcher.close());
  try {
    await assert.rejects(bridge.syncOnce(), { code: 'UPSTREAM_TIMEOUT' });
    assert.deepEqual(bridge.listReports({ limit: 10 }).reports, []);
    const base = await serving(bridge);
    assert.equal((await get(base, '/v1/authorization')).status, 503);
  } finally { Date.now = realNow; }
});

test('generation is an opaque bounded string and malformed wire types are rejected', async t => {
  const { remote, dir } = await setup(t);
  let index = 0;
  for (const generation of [1, 0, NaN, null, undefined, true, {}, [], '', '\0', 'a'.repeat(501)]) {
    const c = config(remote, join(dir, `bad-generation-${index++}`)); c.binding.generation = generation;
    let admitted;
    try { await assert.rejects(async () => { admitted = await createBridge(c); }, { code: 'INVALID_CONFIGURATION' }); }
    finally { await admitted?.close(); }
  }
  for (const generation of ['0', '-1', 'opaque:scope/generation', 'a'.repeat(500)]) {
    const c = config(remote, join(dir, `opaque-generation-${index++}`)); c.binding.generation = generation;
    const bridge = await createBridge(c); await bridge.close();
  }
});

test('explicit synthetic source or entitlement markers cannot produce bridge production authority', async t => {
  const { remote, dir } = await setup(t);
  for (const location of ['source', 'entitlement', 'source-mode', 'entitlement-mode']) {
    const c = config(remote, join(dir, `synthetic-${location}`));
    if (location === 'source') c.synthetic = true;
    else if (location === 'entitlement') c.entitlement.synthetic = true;
    else if (location === 'source-mode') c.mode = 'synthetic';
    else c.entitlement.mode = 'synthetic';
    let admitted;
    try { await assert.rejects(async () => { admitted = await createBridge(c); }, { code: 'INVALID_CONFIGURATION' }); }
    finally { await admitted?.close(); }
  }
});

test('abort after atomic journal publication preserves a complete original without refreshing authority', async t => {
  const { bridge, dir } = await setup(t);
  const controller = new AbortController();
  const watcher = watch(join(dir, 'spool', 'journal'), () => controller.abort());
  t.after(() => watcher.close());
  await assert.rejects(bridge.syncOnce({ signal: controller.signal }), { code: 'ABORTED' });
  assert.equal(controller.signal.aborted, true);
  assert.equal(bridge.listReports({ limit: 10 }).reports.length, 1);
  const base = await serving(bridge);
  assert.equal((await get(base, '/v1/authorization')).status, 503);
  assert.deepEqual(await bridge.syncOnce(), { discovered: 0, conflicts: 0 });
  assert.equal((await get(base, '/v1/authorization')).status, 200);
  const report = bridge.listReports({ limit: 10 }).reports[0];
  assert.equal(await (await get(base, `/v1/reports/${report.reportId}/content`)).text(), 'reference,amount\n0599,100\n');
});


test('an empty real SFTP directory completes authorization and later delivery advances the initial checkpoint', async t => {
  const { bridge, remote } = await setup(t, { files: {} });
  assert.deepEqual(await bridge.syncOnce(), { discovered: 0, conflicts: 0 });
  const base = await serving(bridge);
  assert.equal((await get(base, '/v1/authorization')).status, 200);
  assert.deepEqual(await (await get(base, '/v1/reports')).json(), { reports: [], nextCursor: '0' });
  remote.files.set('late.csv', { bytes: Buffer.from('reference,amount\n0599,100\n'), mtime: 1, mode: 0o100400 });
  assert.deepEqual(await bridge.syncOnce(), { discovered: 1, conflicts: 0 });
  const page = await (await get(base, '/v1/reports?cursor=0')).json();
  assert.equal(page.reports[0].filename, 'late.csv'); assert.equal(page.nextCursor, '1');
  assert.equal(await (await get(base, `/v1/reports/${page.reports[0].reportId}/content`)).text(), 'reference,amount\n0599,100\n');
});

test('a dot-only READDIR page filtered by ssh2 is followed through to actual report bytes', async t => {
  const { bridge, remote } = await setup(t, { dotOnlyFirstPage: true });
  assert.deepEqual(await bridge.syncOnce(), { discovered: 1, conflicts: 0 });
  assert.equal(remote.operations.filter(([op]) => op === 'READDIR').length, 3);
  const base = await serving(bridge);
  assert.equal((await get(base, '/v1/authorization')).status, 200);
  const page = await (await get(base, '/v1/reports')).json();
  assert.equal(page.reports[0].filename, 'report.csv');
  assert.equal(await (await get(base, `/v1/reports/${page.reports[0].reportId}/content`)).text(), 'reference,amount\n0599,100\n');
});

for (const [name, options] of [['empty', { repeatEmptyListing: true }], ['dot-only', { repeatDotOnlyListing: true }]]) {
  test(`infinite ${name} non-EOF SFTP pages hit the finite page budget without authorizing or publishing`, async t => {
    const { bridge, remote } = await setup(t, options, { maxEntries: 2 });
    await assert.rejects(bridge.syncOnce(), { code: 'REMOTE_DIRECTORY_LIMIT' });
    // Three non-EOF pages fit the configured two-entry-plus-one page budget;
    // the fourth must fail instead of spinning or treating an empty page as EOF.
    assert.equal(remote.operations.filter(([op]) => op === 'READDIR').length, 4);
    assert.deepEqual(bridge.listReports({ limit: 10 }).reports, []);
    const base = await serving(bridge);
    assert.equal((await get(base, '/v1/authorization')).status, 503);
  });
}
