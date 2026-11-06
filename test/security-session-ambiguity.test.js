import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { digest } from '../src/security.js';

// Real HTTP, company partitions and sessions; all identities are synthetic.
const folder = mkdtempSync(join(tmpdir(), 'mg-session-ambiguity-'));
const origin = 'https://mg.session-ambiguity.test';
Object.assign(process.env, {
  NODE_ENV: 'test', APP_ORIGIN: origin, DB_PATH: join(folder, 'control.sqlite'),
  MG_COMPANY_DIRECTORY: join(folder, 'companies'),
  SESSION_SECRET: 'a'.repeat(64), BANK_DATA_KEY: 'b'.repeat(64),
  MG_ADMIN_PASSWORD: 'synthetic-session-ambiguity-password',
});
delete process.env.ENCRYPTION_KEY;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error('Provider access is forbidden in the session ambiguity test'); };
const { server, db, companyRuntime } = await import('../src/server.js');
const verification = { status: 'verified', evidenceId: 'synthetic-session-evidence', verifiedBy: 'synthetic-operator' };
for (const [companyId, actorId] of [['company-a', 'alice'], ['company-b', 'bob']]) {
  const context = companyRuntime.provisionCompany({ companyId, name: companyId, actorId, verification });
  companyRuntime.run(context, () => {
    db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES(?,?,?,?,?)')
      .run('same-invoice', 'customer', 'SYNTHETIC-1', companyId, 100);
  });
}
const base = await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    server.removeListener('error', reject);
    resolve('http://127.0.0.1:' + server.address().port);
  });
});
after(async () => {
  globalThis.fetch = originalFetch;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  db.close();
  rmSync(folder, { recursive: true, force: true });
});

const alice = 'synthetic-session-alice';
const bob = 'synthetic-session-bob';
const sessions = () => companyRuntime.controlDb.prepare('SELECT id_hash, expires_at, principal FROM sessions ORDER BY id_hash').all();
beforeEach(() => {
  companyRuntime.controlDb.exec('DELETE FROM sessions');
  const expiresAt = Date.now() + 600_000;
  for (const [value, actor] of [[alice, 'alice'], [bob, 'bob']]) {
    companyRuntime.controlDb.prepare('INSERT INTO sessions(id_hash,expires_at,principal) VALUES(?,?,?)')
      .run(digest(value), expiresAt, actor);
  }
});

function call(path, cookie, method = 'GET') {
  const body = method === 'GET' ? undefined : '{}';
  return new Promise((resolve, reject) => {
    const req = request(base + path, {
      method,
      headers: {
        Host: 'mg.session-ambiguity.test', Cookie: cookie,
        ...(body === undefined ? {} : {
          Origin: origin, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
        }),
      },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        headers: res.headers,
      }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('single session cookies keep simultaneous company reads isolated', async () => {
  const before = sessions();
  const results = await Promise.all([
    call('/api/invoices', 'theme=dark; mg_session=' + alice + '; preference=a=b'),
    call('/api/invoices', 'mg_session=' + bob),
  ]);
  for (const [index, companyId] of ['company-a', 'company-b'].entries()) {
    assert.equal(results[index].status, 200);
    assert.equal(results[index].body.items.length, 1);
    assert.equal(results[index].body.items[0].party, companyId);
    assert.equal(results[index].headers['x-company-id'], companyId);
  }
  assert.deepEqual(sessions(), before);
});

const ambiguousCookies = [
  ['unknown before valid', 'mg_session=unknown; mg_session=' + alice],
  ['valid before unknown', 'mg_session=' + alice + '; mg_session=unknown'],
  ['two valid principals', 'mg_session=' + alice + '; mg_session=' + bob],
  ['two valid principals reversed', 'mg_session=' + bob + '; mg_session=' + alice],
  ['the same valid token twice', 'mg_session=' + alice + '; mg_session=' + alice],
  ['empty before valid', 'mg_session=; mg_session=' + alice],
  ['malformed encoding before valid', 'mg_session=%ZZ; mg_session=' + alice],
  ['encoded alias of the same token', 'mg_session=%73ynthetic-session-alice; mg_session=' + alice],
];
for (const [name, cookie] of ambiguousCookies) {
  test('ambiguous session cookies cannot read a tenant or revoke a session: ' + name, async () => {
    const before = sessions();
    const invoices = await call('/api/invoices', cookie);
    const directory = await call('/api/companies', cookie);
    const me = await call('/api/me', cookie);
    const logout = await call('/api/logout', cookie, 'POST');
    assert.deepEqual(
      [invoices.status, directory.status, me.status, logout.status],
      [401, 401, 200, 401],
      'An ambiguous browser token must never select either authenticated principal',
    );
    assert.equal(me.body.authenticated, false);
    for (const result of [invoices, directory, me, logout]) {
      assert.equal(result.headers['set-cookie'], undefined);
      assert.equal(result.headers['x-company-id'], undefined);
    }
    assert.deepEqual(sessions(), before, 'Denied reads and logout must neither allocate nor delete a session');
  });
}

test('a single encoded session cookie still resolves the authenticated principal', async () => {
  const result = await call('/api/invoices', 'mg_session=%73ynthetic-session-alice');
  assert.equal(result.status, 200);
  assert.equal(result.body.items[0].party, 'company-a');
});

test('unambiguous logout revokes only its session and replay stays unauthorized', async () => {
  const result = await call('/api/logout', 'mg_session=' + alice, 'POST');
  assert.equal(result.status, 200);
  assert.equal(result.body.authenticated, false);
  assert.equal(sessions().length, 1);
  assert.equal(sessions()[0].principal, 'bob');
  assert.equal((await call('/api/invoices', 'mg_session=' + alice)).status, 401);
  const other = await call('/api/invoices', 'mg_session=' + bob);
  assert.equal(other.status, 200);
  assert.equal(other.body.items[0].party, 'company-b');
});
