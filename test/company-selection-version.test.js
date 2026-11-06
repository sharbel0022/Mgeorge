import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { digest } from '../src/security.js';

// Only synthetic company data and loopback HTTP; no provider calls.
const folder = mkdtempSync(join(tmpdir(), 'mg-company-selection-'));
const origin = 'https://mg.company-selection.test';
Object.assign(process.env, {
  NODE_ENV: 'test', APP_ORIGIN: origin, DB_PATH: join(folder, 'control.sqlite'),
  MG_COMPANY_DIRECTORY: join(folder, 'companies'),
  SESSION_SECRET: 'a'.repeat(64), BANK_DATA_KEY: 'b'.repeat(64),
  MG_ADMIN_PASSWORD: 'synthetic-company-selection-password',
});
delete process.env.ENCRYPTION_KEY;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error('Provider access is forbidden in the company selection test'); };
const { server, db, companyRuntime } = await import('../src/server.js');
const verification = { status: 'verified', evidenceId: 'synthetic-selection-evidence', verifiedBy: 'synthetic-operator' };
for (const companyId of ['company-a', 'company-b']) {
  const context = companyRuntime.provisionCompany({ companyId, name: companyId, actorId: companyId + '-owner', verification });
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

function browser(actorId) {
  for (const companyId of ['company-a', 'company-b']) {
    companyRuntime.setMembership({ companyId, actorId, role: 'viewer' });
  }
  const token = 'synthetic-session-' + actorId;
  companyRuntime.controlDb.prepare('INSERT INTO sessions(id_hash,expires_at,principal) VALUES(?,?,?)')
    .run(digest(token), Date.now() + 600_000, actorId);
  return (path, { body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    const req = request(base + path, {
      method: serialized === undefined ? 'GET' : 'POST',
      headers: {
        Host: 'mg.company-selection.test', Cookie: 'mg_session=' + token, ...headers,
        ...(serialized === undefined ? {} : {
          Origin: origin, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(serialized),
        }),
      },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.end(serialized);
  });
}

const invalidVersions = [
  ['missing', {}],
  ['null', { contextVersion: null }],
  ['numeric string', { contextVersion: '1' }],
  ['zero', { contextVersion: 0 }],
  ['negative', { contextVersion: -1 }],
  ['fraction', { contextVersion: 1.5 }],
  ['unsafe integer', { contextVersion: 9007199254740992 }],
];
for (const [index, [name, version]] of invalidVersions.entries()) {
  test('HTTP company selection rejects an invalid expected context version: ' + name, async () => {
    const call = browser('invalid-selector-' + index);
    const before = await call('/api/companies');
    assert.equal(before.body.activeCompanyId, 'company-a');
    assert.equal(before.body.contextVersion, 1);
    const result = await call('/api/companies/active', { body: { companyId: 'company-b', ...version } });
    assert.equal(result.status, 400, 'A company switch must supply a positive safe integer expected version');
    assert.deepEqual(await call('/api/companies'), before, 'Invalid selection must not change company or context version');
    assert.equal((await call('/api/invoices')).body.items[0].party, 'company-a');
  });
}

test('a replayed selection cannot switch back with an old context version', async () => {
  const call = browser('replay-selector');
  const selected = await call('/api/companies/active', { body: { companyId: 'company-b', contextVersion: 1 } });
  assert.equal(selected.status, 200);
  assert.equal(selected.body.context.contextVersion, 2);
  const replay = await call('/api/companies/active', { body: { companyId: 'company-a', contextVersion: 1 } });
  assert.equal(replay.status, 409);
  assert.equal(replay.body.code, 'COMPANY_CONTEXT_STALE');
  const directory = await call('/api/companies');
  assert.equal(directory.body.activeCompanyId, 'company-b');
  assert.equal(directory.body.contextVersion, 2);
  assert.equal((await call('/api/invoices')).body.items[0].party, 'company-b');
});

test('simultaneous selections consume one expected version and fence the old tab', async () => {
  const call = browser('concurrent-selector');
  const results = await Promise.all([
    call('/api/companies/active', { body: { companyId: 'company-b', contextVersion: 1 } }),
    call('/api/companies/active', { body: { companyId: 'company-b', contextVersion: 1 } }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort((a, b) => a - b), [200, 409]);
  const directory = await call('/api/companies');
  assert.equal(directory.body.activeCompanyId, 'company-b');
  assert.equal(directory.body.contextVersion, 2);
  const stale = await call('/api/invoices', { headers: { 'X-Company-Id': 'company-a', 'X-Company-Context-Version': '1' } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'COMPANY_CONTEXT_STALE');
  const current = await call('/api/invoices', { headers: { 'X-Company-Id': 'company-b', 'X-Company-Context-Version': '2' } });
  assert.equal(current.status, 200);
  assert.equal(current.body.items[0].party, 'company-b');
});
