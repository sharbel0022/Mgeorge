import ssh2 from 'ssh2';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, readdir, unlink, link } from 'node:fs/promises';
import { resolve, join, dirname, posix } from 'node:path';

const { Client } = ssh2;
const CAPABILITY = 'bankgiro_reports:read';
const ID = /^[a-f0-9]{64}$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => Object.assign(new Error(code), { code });
const requireValue = (condition, code = 'INVALID_CONFIGURATION') => { if (!condition) throw fail(code); };
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 500 && !/[\x00-\x1f\x7f]/.test(value);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const same = (a, b) => a.size === b.size && a.mode === b.mode && a.mtime === b.mtime && a.uid === b.uid && a.gid === b.gid;
const regular = attrs => attrs && (attrs.mode & 0o170000) === 0o100000;
const directory = attrs => attrs && (attrs.mode & 0o170000) === 0o040000;
const json = value => Buffer.from(JSON.stringify(value));

function validate(configuration) {
  const c = { ...configuration, sftp: { ...configuration?.sftp }, binding: { ...configuration?.binding }, entitlement: { ...configuration?.entitlement } };
  c.maxFileBytes ??= 15000000; c.maxEntries ??= 1000; c.maxJournalEntries ??= 100000;
  c.operationTimeoutMs ??= 10000; c.scanTimeoutMs ??= 120000;
  requireValue(c.synthetic !== true && c.mode !== 'synthetic' && c.entitlement.synthetic !== true && c.entitlement.mode !== 'synthetic');
  requireValue(typeof c.enabled === 'boolean' && text(c.spoolDirectory) && resolve(c.spoolDirectory) === c.spoolDirectory);
  requireValue(typeof c.bearerToken === 'string' && /^[\x21-\x7e]{32,256}$/.test(c.bearerToken));
  for (const key of ['owner', 'sourceId', 'companyId', 'bankgiro', 'scopeId', 'profileId']) requireValue(text(c.binding[key]));
  requireValue(/^\d{7,8}$/.test(c.binding.bankgiro) && text(c.binding.generation));
  const e = c.entitlement;
  requireValue(e.status === 'VERIFIED' && e.origin === 'provider_authorization' && text(e.evidenceId));
  requireValue(Number.isFinite(Date.parse(e.checkedAt)) && Number.isFinite(Date.parse(e.validUntil)) && Date.parse(e.validUntil) > Date.parse(e.checkedAt));
  requireValue(Array.isArray(e.capabilities) && e.capabilities.includes(CAPABILITY));
  const s = c.sftp;
  requireValue(text(s.host) && !/[\s/@#?]/.test(s.host) && integer(s.port, 1, 65535) && text(s.username));
  requireValue(ID.test(s.hostKeySha256) && text(s.remoteDirectory) && s.remoteDirectory.startsWith('/') && s.remoteDirectory !== '/' && posix.normalize(s.remoteDirectory) === s.remoteDirectory && !s.remoteDirectory.split('/').includes('..'));
  requireValue((typeof s.password === 'string' && s.password.length > 0) || (Buffer.isBuffer(s.privateKey) && s.privateKey.length > 0));
  requireValue(Array.isArray(c.allowedFormats) && c.allowedFormats.length > 0 && c.allowedFormats.length <= 20 && c.allowedFormats.every(f => /^(csv|xml|xlsx|txt|dat)$/.test(f)));
  for (const [key, min, max] of [['maxFileBytes', 1, 15000000], ['maxEntries', 1, 10000], ['maxJournalEntries', 1, 1000000], ['operationTimeoutMs', 100, 60000], ['scanTimeoutMs', 100, 1800000]]) requireValue(integer(c[key], min, max));
  c.allowedFormats = [...new Set(c.allowedFormats)];
  c.entitlement.capabilities = [...c.entitlement.capabilities];
  if (c.sftp.privateKey) c.sftp.privateKey = Buffer.from(c.sftp.privateKey);
  return c;
}

async function privateDirectory(path) {
  await mkdir(path, { mode: 0o700, recursive: true });
  const info = await lstat(path);
  requireValue(info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o077) === 0 && info.uid === process.getuid?.(), 'INSECURE_SPOOL');
  requireValue(await realpath(path) === resolve(path), 'INSECURE_SPOOL');
}
async function privateRead(path, limit, modeMask = 0o077) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    requireValue(before.isFile() && before.uid === process.getuid?.() && (before.mode & modeMask) === 0 && before.size <= limit, 'SPOOL_CORRUPT');
    const bytes = await handle.readFile();
    const after = await handle.stat();
    requireValue(bytes.length === before.size && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs, 'SPOOL_CORRUPT');
    return bytes;
  } finally { await handle.close(); }
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}

class Journal {
  constructor(c) {
    this.c = c; this.events = []; this.reports = new Map();
    const s = c.sftp;
    this.bindingHash = digest(json({ binding: c.binding, formats: c.allowedFormats, upstream: { host: s.host, port: s.port, username: s.username, pin: s.hostKeySha256, directory: s.remoteDirectory } }));
  }
  path(...parts) { return join(this.c.spoolDirectory, ...parts); }
  async init() {
    await privateDirectory(this.c.spoolDirectory);
    for (const name of ['blobs', 'journal', 'tmp']) await privateDirectory(this.path(name));
    const lockPath = this.path('writer.sqlite');
    const lockFile = await open(lockPath, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    try {
      const info = await lockFile.stat();
      requireValue(info.isFile() && info.uid === process.getuid?.() && (info.mode & 0o077) === 0, 'INSECURE_SPOOL');
    } finally { await lockFile.close(); }
    try {
      this.lock = new DatabaseSync(lockPath);
      this.lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;');
    } catch {
      this.lock?.close(); this.lock = null; throw fail('SPOOL_LOCKED');
    }
    try {
      await this.publish('binding.json', json({ version: 1, bindingHash: this.bindingHash }), 0o400, 'SPOOL_BINDING_MISMATCH');
      const names = (await readdir(this.path('journal'))).sort();
      requireValue(names.length <= this.c.maxJournalEntries, 'JOURNAL_LIMIT');
      for (const name of names) {
        requireValue(/^\d{12}\.json$/.test(name), 'SPOOL_CORRUPT');
        const event = JSON.parse((await privateRead(this.path('journal', name), 4096)).toString());
        requireValue(event.sequence === this.events.length + 1 && name === this.eventName(event.sequence), 'SPOOL_CORRUPT');
        requireValue(ID.test(event.reportId) && ID.test(event.sha256) && text(event.filename) && integer(event.byteLength, 1, this.c.maxFileBytes) && Number.isFinite(Date.parse(event.availableAt)), 'SPOOL_CORRUPT');
        requireValue(event.reportId === this.identity(event.filename), 'SPOOL_CORRUPT');
        const bytes = await privateRead(this.path('blobs', event.sha256), this.c.maxFileBytes);
        requireValue(bytes.length === event.byteLength && digest(bytes) === event.sha256, 'SPOOL_CORRUPT');
        this.apply(event);
      }
      for (const name of await readdir(this.path('tmp'))) {
        requireValue(/^[a-f0-9]{32}$/.test(name), 'SPOOL_CORRUPT');
        await privateRead(this.path('tmp', name), this.c.maxFileBytes);
        await unlink(this.path('tmp', name));
      }
    } catch (error) { await this.close(); throw error; }
  }
  identity(filename) { return digest(`${this.bindingHash}\0${filename}`); }
  eventName(sequence) { return `${String(sequence).padStart(12, '0')}.json`; }
  apply(event) {
    this.events.push(event);
    const previous = this.reports.get(event.reportId);
    this.reports.set(event.reportId, { event, conflict: previous != null && (previous.conflict || previous.event.sha256 !== event.sha256) });
  }
  async publish(relative, bytes, mode, conflictCode = 'SPOOL_CORRUPT', guard = () => {}) {
    const temporary = this.path('tmp', randomBytes(16).toString('hex'));
    const target = this.path(relative);
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(bytes); await handle.chmod(mode); await handle.sync(); } finally { await handle.close(); }
    try {
      guard();
      try { await link(temporary, target); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      requireValue((await privateRead(target, Math.max(bytes.length, 4096))).equals(bytes), conflictCode);
      await syncDirectory(dirname(target));
    } finally { await unlink(temporary); await syncDirectory(this.path('tmp')); }
  }
  async append(filename, bytes, guard) {
    guard();
    const sha256 = digest(bytes); const reportId = this.identity(filename);
    const previous = this.reports.get(reportId);
    if (this.events.some(event => event.reportId === reportId && event.sha256 === sha256)) return { discovered: 0, conflicts: 0 };
    requireValue(this.events.length < this.c.maxJournalEntries, 'JOURNAL_LIMIT');
    await this.publish(join('blobs', sha256), bytes, 0o400, 'SPOOL_CORRUPT', guard);
    guard();
    const event = { sequence: this.events.length + 1, reportId, filename, sha256, byteLength: bytes.length, availableAt: new Date().toISOString() };
    await this.publish(join('journal', this.eventName(event.sequence)), json(event), 0o400, 'SPOOL_CORRUPT', guard);
    this.apply(event);
    guard();
    return { discovered: previous ? 0 : 1, conflicts: previous ? 1 : 0 };
  }
  list({ cursor = null, limit = 50 } = {}) {
    requireValue(integer(limit, 1, 50) && (cursor == null || (typeof cursor === 'string' && /^(0|[1-9]\d{0,11})$/.test(cursor))), 'INVALID_REQUEST');
    const after = cursor == null ? 0 : Number(cursor);
    requireValue(after <= this.events.length, 'INVALID_REQUEST');
    const events = this.events.slice(after, after + limit);
    return { reports: events.map(({ sequence, ...event }) => event), nextCursor: String(events.length ? events.at(-1).sequence : after) };
  }
  async content(id) {
    requireValue(ID.test(id), 'NOT_FOUND');
    const item = this.reports.get(id); requireValue(item, 'NOT_FOUND');
    requireValue(!item.conflict, 'REPORT_HASH_CONFLICT');
    const bytes = await privateRead(this.path('blobs', item.event.sha256), this.c.maxFileBytes);
    requireValue(bytes.length === item.event.byteLength && digest(bytes) === item.event.sha256, 'SPOOL_CORRUPT');
    return bytes;
  }
  async close() {
    if (!this.lock) return;
    this.lock.exec('ROLLBACK'); this.lock.close(); this.lock = null;
  }
}

async function collect(c, journal, signal, setClient, authorityGuard, deadline) {
  const client = new Client(); setClient(client);
  let identityFailed = false; let disconnected = false; let scanExpired = false;
  const guard = () => {
    authorityGuard();
    requireValue(!signal?.aborted, 'ABORTED');
    requireValue(!scanExpired && Date.now() <= deadline, 'UPSTREAM_TIMEOUT');
    requireValue(!disconnected, 'UPSTREAM_UNAVAILABLE');
  };
  const outstanding = new Set();
  const abort = () => {
    let failure; try { guard(); } catch (error) { failure = error; }
    for (const reject of outstanding) reject(failure ?? fail('UPSTREAM_UNAVAILABLE'));
    client.destroy();
  };
  client.on('error', () => { disconnected = true; abort(); });
  client.on('close', () => { disconnected = true; abort(); });
  signal?.addEventListener('abort', abort, { once: true });
  const rpc = (target, method, ...args) => new Promise((resolveRpc, rejectRpc) => {
    try { guard(); } catch (error) { rejectRpc(error); return; }
    if (signal?.aborted || disconnected) { rejectRpc(fail(signal?.aborted ? 'ABORTED' : 'UPSTREAM_UNAVAILABLE')); return; }
    let timer;
    const rejected = error => { clearTimeout(timer); outstanding.delete(rejected); rejectRpc(error); };
    outstanding.add(rejected);
    timer = setTimeout(() => { rejected(fail('UPSTREAM_TIMEOUT')); client.destroy(); }, c.operationTimeoutMs);
    try { target[method](...args, (error, ...values) => {
      clearTimeout(timer); outstanding.delete(rejected);
      if (error && method === 'readdir' && error.code === 1) resolveRpc([false]);
      else if (error) rejectRpc(fail('UPSTREAM_UNAVAILABLE')); else resolveRpc(values);
    }); } catch { rejected(fail('UPSTREAM_UNAVAILABLE')); }
  });
  const scanTimer = setTimeout(() => { scanExpired = true; abort(); }, Math.max(0, deadline - Date.now()));
  try {
    await new Promise((ready, reject) => {
      const onError = () => reject(fail(identityFailed ? 'HOST_IDENTITY_FAILED' : 'UPSTREAM_UNAVAILABLE'));
      client.once('ready', () => { client.setNoDelay(true); ready(); }); client.once('error', onError); client.once('close', onError);
      if (signal?.aborted) { reject(fail('ABORTED')); return; }
      const s = c.sftp;
      client.connect({ host: s.host, port: s.port, username: s.username, password: s.password, privateKey: s.privateKey, passphrase: s.passphrase,
        hostHash: 'sha256', hostVerifier(key) { const match = key === s.hostKeySha256; if (!match) identityFailed = true; return match; },
        authHandler: [s.privateKey ? 'publickey' : 'password'],
        readyTimeout: c.operationTimeoutMs, keepaliveInterval: 10000, keepaliveCountMax: 1, tryKeyboard: false });
    });
    const [sftp] = await rpc(client, 'sftp');
    const root = c.sftp.remoteDirectory;
    async function checkRoot() {
      let path = '';
      for (const component of root.split('/').filter(Boolean)) {
        path += '/' + component;
        const [attrs] = await rpc(sftp, 'lstat', path);
        requireValue(directory(attrs), 'REMOTE_PATH_REJECTED');
      }
      requireValue((await rpc(sftp, 'realpath', root))[0] === root, 'REMOTE_PATH_REJECTED');
    }
    async function metadata(path) {
      const [attrs] = await rpc(sftp, 'lstat', path);
      requireValue(regular(attrs) && integer(attrs.size, 1, c.maxFileBytes) && integer(attrs.mtime, 0, Number.MAX_SAFE_INTEGER) && integer(attrs.uid, 0, 4294967295) && integer(attrs.gid, 0, 4294967295), 'REMOTE_FILE_REJECTED');
      requireValue((await rpc(sftp, 'realpath', path))[0] === path, 'REMOTE_PATH_REJECTED');
      return attrs;
    }
    await checkRoot();
    const [directoryHandle] = await rpc(sftp, 'opendir', root);
    const names = new Set(); let count = 0; let pages = 0;
    try {
      while (true) {
        const [entries] = await rpc(sftp, 'readdir', directoryHandle);
        if (entries === false) break;
        // ssh2 filters literal . and .. entries, so a legal non-EOF page may
        // be empty. Charge every such page to the finite enumeration budget.
        requireValue(Array.isArray(entries) && ++pages <= c.maxEntries + 1, 'REMOTE_DIRECTORY_LIMIT');
        for (const entry of entries) {
          requireValue(++count <= c.maxEntries, 'REMOTE_DIRECTORY_LIMIT');
          const name = entry.filename;
          requireValue(typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(name) && name !== '.' && name !== '..' && !names.has(name), 'REMOTE_PATH_REJECTED');
          requireValue((entry.attrs.mode & 0o170000) !== 0o120000, 'REMOTE_PATH_REJECTED');
          names.add(name);
        }
      }
    } finally { await rpc(sftp, 'close', directoryHandle); }
    const total = { discovered: 0, conflicts: 0 };
    for (const filename of [...names].sort()) {
      if (!c.allowedFormats.includes(posix.extname(filename).slice(1).toLowerCase())) continue;
      await checkRoot();
      const path = posix.join(root, filename);
      const before = await metadata(path);
      const [handle] = await rpc(sftp, 'open', path, 'r');
      let bytes;
      try {
        requireValue(same(before, (await rpc(sftp, 'fstat', handle))[0]), 'REMOTE_FILE_CHANGED');
        const chunks = []; let length = 0;
        while (true) {
          const buffer = Buffer.alloc(Math.min(32768, before.size - length + 1));
          const [read] = await rpc(sftp, 'read', handle, buffer, 0, buffer.length, length);
          requireValue(integer(read, 0, buffer.length), 'REMOTE_FILE_REJECTED');
          if (read === 0) break;
          length += read; requireValue(length <= before.size && length <= c.maxFileBytes, 'REMOTE_FILE_CHANGED');
          chunks.push(buffer.subarray(0, read));
        }
        requireValue(length === before.size, 'REMOTE_FILE_CHANGED');
        requireValue(same(before, (await rpc(sftp, 'fstat', handle))[0]), 'REMOTE_FILE_CHANGED');
        requireValue(same(before, await metadata(path)), 'REMOTE_FILE_CHANGED');
        await checkRoot();
        bytes = Buffer.concat(chunks, length);
      } finally { await rpc(sftp, 'close', handle); }
      if (signal?.aborted || disconnected) throw fail('UPSTREAM_UNAVAILABLE');
      const result = await journal.append(filename, bytes, guard);
      total.discovered += result.discovered; total.conflicts += result.conflicts;
    }
    guard();
    return total;
  } finally {
    clearTimeout(scanTimer); signal?.removeEventListener('abort', abort);
    setClient(null); client.destroy();
  }
}

export async function createBridge(configuration) {
  const c = validate(configuration); const journal = new Journal(c); await journal.init();
  let lastScanAt = null; let healthy = false; let running = null; let activeClient = null; let closed = false;
  const servers = new Set();
  function entitled() {
    requireValue(!closed && c.enabled && Date.parse(c.entitlement.checkedAt) <= Date.now() && Date.parse(c.entitlement.validUntil) > Date.now(), 'AUTHORIZATION_BLOCKED');
  }
  function receipt() {
    entitled(); requireValue(healthy && lastScanAt && Date.parse(lastScanAt) <= Date.now() && Date.now() - Date.parse(lastScanAt) <= 300000, 'UPSTREAM_UNAVAILABLE');
    return { status: 'VERIFIED', ...Object.fromEntries(['owner', 'sourceId', 'companyId', 'bankgiro', 'scopeId', 'generation', 'profileId'].map(key => [key, c.binding[key]])), evidenceId: c.entitlement.evidenceId, checkedAt: lastScanAt, validUntil: c.entitlement.validUntil, origin: 'provider_authorization', capabilities: [CAPABILITY] };
  }
  const bridge = {
    syncOnce({ signal } = {}) {
      if (running) return Promise.reject(fail('SCAN_IN_PROGRESS'));
      try { entitled(); } catch (error) { return Promise.reject(error); }
      const deadline = Date.now() + c.scanTimeoutMs;
      running = collect(c, journal, signal, client => { activeClient = client; }, entitled, deadline).then(result => {
        entitled(); requireValue(!signal?.aborted, 'ABORTED'); requireValue(Date.now() <= deadline, 'UPSTREAM_TIMEOUT');
        lastScanAt = new Date().toISOString(); healthy = true; return result;
      }).catch(error => { healthy = false; throw error; }).finally(() => { running = null; });
      return running;
    },
    listReports(options) { return journal.list(options); },
    createHttpServer() {
      requireValue(!closed, 'AUTHORIZATION_BLOCKED');
      const expected = Buffer.from(c.bearerToken);
      const server = createServer({ maxHeaderSize: 4096, requestTimeout: 10000, headersTimeout: 5000 }, async (req, res) => {
        const send = (status, value) => {
          res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(json(value));
        };
        try {
          const supplied = Buffer.from(typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '');
          if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { send(401, { error: { code: 'AUTHORIZATION_BLOCKED' } }); return; }
          if (req.method !== 'GET') { send(405, { error: { code: 'INVALID_REQUEST' } }); return; }
          requireValue(typeof req.url === 'string' && req.url.length <= 2048 && req.url.startsWith('/') && !req.url.startsWith('//'), 'INVALID_REQUEST');
          const url = new URL(req.url, 'http://bridge.invalid');
          receipt();
          if (url.pathname === '/v1/authorization' && !url.search) { send(200, receipt()); return; }
          if (url.pathname === '/v1/reports') {
            requireValue([...url.searchParams.keys()].every(key => ['cursor', 'limit'].includes(key)) && url.searchParams.getAll('cursor').length <= 1 && url.searchParams.getAll('limit').length <= 1, 'INVALID_REQUEST');
            const limitText = url.searchParams.get('limit');
            requireValue(limitText == null || /^[1-9]\d?$/.test(limitText), 'INVALID_REQUEST');
            send(200, journal.list({ cursor: url.searchParams.get('cursor'), limit: limitText == null ? 50 : Number(limitText) })); return;
          }
          const match = /^\/v1\/reports\/([a-f0-9]{64})\/content$/.exec(url.pathname);
          if (match && !url.search) {
            const bytes = await journal.content(match[1]); receipt();
            res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(bytes); return;
          }
          send(404, { error: { code: 'NOT_FOUND' } });
        } catch (error) {
          const status = ({ INVALID_REQUEST: 400, NOT_FOUND: 404, AUTHORIZATION_BLOCKED: 403, REPORT_HASH_CONFLICT: 409 })[error.code] ?? 503;
          const code = ['INVALID_REQUEST', 'NOT_FOUND', 'AUTHORIZATION_BLOCKED', 'REPORT_HASH_CONFLICT'].includes(error.code) ? error.code : 'SOURCE_UNAVAILABLE';
          send(status, { error: { code } });
        }
      });
      server.on('clientError', (_error, socket) => { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
      servers.add(server); server.once('close', () => servers.delete(server)); return server;
    },
    async close() {
      if (closed) return; closed = true; activeClient?.destroy();
      if (running) await running.catch(() => {});
      for (const server of servers) { server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose)); }
      await journal.close();
    }
  };
  return bridge;
}
