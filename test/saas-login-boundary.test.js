import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { digest } from '../src/security.js';

// This runtime is still a single-administrator installation. These assertions
// prove denial of other principals, not an unimplemented company-role model.
const folder = mkdtempSync(join(tmpdir(), 'mg-saas-login-'));
const origin = 'https://mg.login-boundary.test';
const password = 'synthetic-login-boundary-password';
Object.assign(process.env, {
  NODE_ENV: 'test', APP_ORIGIN: origin, DB_PATH: join(folder, 'db.sqlite'),
  SESSION_SECRET: 'c'.repeat(64), BANK_DATA_KEY: 'd'.repeat(64),
  MG_ADMIN_PASSWORD: password,
});
delete process.env.ENCRYPTION_KEY;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('External network access is forbidden in login acceptance'); };
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

function call(path, { body, cookie, chunked = false, requestOrigin = origin } = {}) {
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(base + path, {
      method: serialized === undefined ? 'GET' : 'POST',
      headers: {
        Host: 'mg.login-boundary.test',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(serialized === undefined ? {} : {
          Origin: requestOrigin,
          'Content-Type': 'application/json',
          ...(chunked ? { 'Transfer-Encoding': 'chunked' } : { 'Content-Length': Buffer.byteLength(serialized) }),
        }),
      },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()), cookie: res.headers['set-cookie']?.[0] }));
    });
    req.on('error', reject);
    req.end(serialized);
  });
}
const sessionCount = () => db.prepare('SELECT count(*) n FROM sessions').get().n;

for (const chunked of [false, true]) {
  test(`unauthenticated login rejects oversized ${chunked ? 'streamed' : 'declared'} bodies before creating a session`, async () => {
    const result = await call('/api/login', { body: { password, padding: 'x'.repeat(8_192) }, chunked });
    assert.equal(result.status, 413);
    assert.equal(sessionCount(), 0);
    assert.equal(result.cookie, undefined);
  });
}

test('bounded legitimate login still rotates into a secure authenticated session', async () => {
  const result = await call('/api/login', { body: { password } });
  assert.equal(result.status, 200);
  assert.match(result.cookie, /HttpOnly; SameSite=Lax; Path=\/; Max-Age=28800; Secure/);
  const cookie = result.cookie.split(';')[0];
  assert.equal((await call('/api/invoices', { cookie })).status, 200);
  assert.equal(sessionCount(), 1);
});

test('cross-site login cannot allocate a session even with a correct password', async () => {
  const result = await call('/api/login', { body: { password }, requestOrigin: 'https://foreign.example.test' });
  assert.equal(result.status, 403);
  assert.equal(sessionCount(), 0);
});

for (const principal of ['company-a-owner', 'company-b-accountant', 'company-c-viewer']) {
  test(`legacy Node rejects ${principal} instead of treating it as an administrator`, async () => {
    const session = `synthetic-${principal}`;
    db.prepare('INSERT INTO sessions(id_hash,expires_at,principal) VALUES(?,?,?)').run(digest(session), Date.now() + 60_000, principal);
    const before = db.prepare('SELECT count(*) n FROM audit_events').get().n;
    for (const path of ['/api/invoices', '/api/documents', '/api/export', '/api/bank/status']) {
      assert.equal((await call(path, { cookie: `mg_session=${session}` })).status, 403);
    }
    assert.equal(db.prepare('SELECT count(*) n FROM audit_events').get().n, before);
  });
}
