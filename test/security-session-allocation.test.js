import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { digest } from '../src/security.js';

// Real HTTP and SQLite, with only synthetic credentials and no provider access.
const folder = mkdtempSync(join(tmpdir(), 'mg-session-allocation-'));
const origin = 'https://mg.session-allocation.test';
const password = 'synthetic-session-allocation-password';
Object.assign(process.env, {
  NODE_ENV: 'test', APP_ORIGIN: origin, DB_PATH: join(folder, 'db.sqlite'),
  SESSION_SECRET: 'a'.repeat(64), BANK_DATA_KEY: 'b'.repeat(64),
  MG_ADMIN_PASSWORD: password,
});
delete process.env.ENCRYPTION_KEY;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error('Provider access is forbidden in the session allocation test'); };
const { server, db } = await import('../src/server.js');
const base = await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    server.removeListener('error', reject);
    resolve(`http://127.0.0.1:${server.address().port}`);
  });
});
after(async () => {
  globalThis.fetch = originalFetch;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  db.close();
  rmSync(folder, { recursive: true, force: true });
});
beforeEach(() => db.exec('DELETE FROM sessions'));

function call(path, { method = 'GET', body, cookie = '' } = {}) {
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(base + path, {
      method,
      headers: {
        Host: 'mg.session-allocation.test',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(serialized === undefined ? {} : {
          Origin: origin, 'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(serialized),
        }),
      },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        cookie: res.headers['set-cookie']?.[0],
      }));
    });
    req.on('error', reject);
    req.end(serialized);
  });
}
const sessions = () => db.prepare('SELECT id_hash, expires_at, principal FROM sessions ORDER BY id_hash').all();

test('HTTPS anonymous and invalid-cookie reads do not allocate persistent sessions', async () => {
  for (const cookie of ['', 'mg_session=unknown-synthetic-token']) {
    const me = await call('/api/me', { cookie });
    assert.equal(me.status, 200);
    assert.equal(me.body.authenticated, false);
    for (const path of ['/api/invoices', '/api/documents', '/api/export', '/api/settings']) {
      assert.equal((await call(path, { cookie })).status, 401);
    }
  }
  assert.equal(sessions().length, 0, 'Denied reads must not grow the persistent session table');
});

test('HTTPS expired cookies cannot mint replacement sessions before authentication', async () => {
  const expired = 'expired-synthetic-token';
  db.prepare('INSERT INTO sessions(id_hash,expires_at,principal) VALUES(?,?,?)').run(digest(expired), 0, 'administrator');
  assert.equal((await call('/api/invoices', { cookie: `mg_session=${expired}` })).status, 401);
  assert.equal(sessions().filter(session => session.expires_at > Date.now()).length, 0);
});

test('successful HTTPS login rotates a legacy browser token and cleans expired sessions', async () => {
  const legacy = 'legacy-synthetic-browser-token';
  db.prepare('INSERT INTO sessions(id_hash,expires_at,principal) VALUES(?,?,?)').run(digest(legacy), Date.now() + 60_000, '');
  db.prepare('INSERT INTO sessions(id_hash,expires_at,principal) VALUES(?,?,?)').run(digest('expired-synthetic-session'), 0, 'administrator');
  const result = await call('/api/login', { method: 'POST', body: { password }, cookie: `mg_session=${legacy}` });
  assert.equal(result.status, 200);
  assert.match(result.cookie, /HttpOnly/);
  assert.match(result.cookie, /SameSite=Lax/);
  assert.match(result.cookie, /; Secure/);
  const cookie = result.cookie.split(';')[0];
  assert.notEqual(cookie, `mg_session=${legacy}`);
  const records = sessions();
  assert.equal(records.length, 1);
  assert.equal(records[0].principal, 'administrator');
  assert.equal(records[0].id_hash, digest(decodeURIComponent(cookie.slice('mg_session='.length))));
  assert.equal((await call('/api/me', { cookie })).body.authenticated, true);
  assert.equal((await call('/api/invoices', { cookie })).status, 200);
  assert.equal((await call('/api/invoices', { cookie: `mg_session=${legacy}` })).status, 401);
  assert.equal(sessions().length, 1, 'A rejected old token must not allocate an anonymous replacement');
});

test('failed and rate-limited HTTPS logins do not allocate persistent sessions', async () => {
  const statuses = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    statuses.push((await call('/api/login', { method: 'POST', body: { password: 'synthetic-wrong-password' } })).status);
  }
  assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
  assert.equal(sessions().length, 0, 'Authentication failures, including throttled requests, must not create sessions');
});
