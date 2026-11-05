import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';

// Exercise the real Node HTTP flow with synthetic bank responses only.
const folder = mkdtempSync(join(tmpdir(), 'mg-consent-reconnect-95-'));
Object.assign(process.env, { NODE_ENV: 'test', APP_ORIGIN: 'https://reconnect.example.test',
  MG_ADMIN_PASSWORD: 'synthetic-reconnect-admin-password', DB_PATH: join(folder, 'db.sqlite'),
  SESSION_SECRET: '6'.repeat(64), BANK_DATA_KEY: '7'.repeat(64),
  ENABLE_BANKING_ENVIRONMENT: 'SANDBOX', ENABLE_BANKING_APPLICATION_ID: 'reconnect-test' });
for (const key of ['ENABLEBANKING_APP_ID', 'ENABLEBANKING_PRIVATE_KEY_FILE', 'ENABLEBANKING_ENVIRONMENT', 'ENABLE_BANKING_PRIVATE_KEY_FILE']) delete process.env[key];
process.env.ENABLE_BANKING_PRIVATE_KEY = generateKeyPairSync('rsa', { modulusLength: 2048,
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } }).privateKey;
const { server, db } = await import('../src/server.js');
const base = await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const originalFetch = globalThis.fetch, calls = [], future = () => new Date(Date.now() + 3600000).toISOString();
const account = { uid: 'synthetic-account-95', name: 'Synthetic company account', currency: 'SEK',
  usage: 'ORGA', account_id: { iban: 'SE4280000890119146168423' }, identification_hash: 'synthetic-stable-95' };
let cookie = '', authState = '', sessionIndex = 0, currentPatch = {}, revokeAuthority = false;
function authority() {
  process.env.BANK_COMPANY_AUTHORIZATIONS = JSON.stringify({ version: 1, bindings: [{
    companyId: 'workspace:administrator', storageOwnerId: 'administrator', provider: 'enablebanking',
    bankName: 'Swedbank', country: 'SE', accountKeys: ['iban:' + account.account_id.iban],
    status: 'active', origin: 'bank', evidenceId: 'synthetic-authority-95',
    checkedAt: new Date(Date.now() - 60000).toISOString(), validUntil: future() }] });
}
globalThis.fetch = async (url, options = {}) => {
  const target = new URL(url); assert.equal(target.origin, 'https://api.enablebanking.com');
  calls.push({ method: options.method || 'GET', path: target.pathname });
  if (target.pathname === '/application') return Response.json({ kid: 'reconnect-test', environment: 'SANDBOX', active: true,
    countries: ['SE'], services: ['AIS'], redirect_urls: [process.env.APP_ORIGIN + '/api/bank/callback'] });
  if (target.pathname === '/aspsps') return Response.json({ aspsps: [{ name: 'Swedbank', country: 'SE', psu_types: ['business'], maximum_consent_validity: 86400 }] });
  if (target.pathname === '/auth') { authState = JSON.parse(options.body).state; return Response.json({ url: 'https://auth.enablebanking.com/ais/start?test=95' }); }
  if (target.pathname === '/sessions' && options.method === 'POST') return Response.json({ session_id: 'synthetic-session-' + (++sessionIndex),
    accounts: [account], aspsp: { name: 'Swedbank', country: 'SE' }, psu_type: 'business', access: { valid_until: future(), transactions: true } });
  if (target.pathname.startsWith('/sessions/')) {
    if (options.method === 'DELETE') return new Response(null, { status: 204 });
    if (revokeAuthority) delete process.env.BANK_COMPANY_AUTHORIZATIONS;
    return Response.json({ status: 'AUTHORIZED', accounts: [account.uid], accounts_data: [{ uid: account.uid, identification_hash: account.identification_hash }],
      aspsp: { name: 'Swedbank', country: 'SE' }, psu_type: 'business', access: { valid_until: future(), transactions: true }, ...currentPatch });
  }
  if (target.pathname.endsWith('/transactions')) return Response.json({ transactions: [] });
  throw Error('Unexpected synthetic bank request');
};
async function call(path, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const content = body === undefined ? undefined : JSON.stringify(body);
    const req = request(base + path, { method, headers: { Host: 'reconnect.example.test', ...(cookie ? { Cookie: cookie } : {}),
      ...(content ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(content), Origin: process.env.APP_ORIGIN } : {}) } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => {
        let json = {}; try { json = JSON.parse(Buffer.concat(chunks)); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    }); req.on('error', reject); req.end(content);
  });
}
after(async () => { globalThis.fetch = originalFetch; await new Promise(resolve => server.close(resolve)); db.close(); rmSync(folder, { recursive: true, force: true }); });

test('consent-reconnect-95: verified consent denial durably requires renewal and stops repeated bank reads', async t => {
  const login = await call('/api/login', 'POST', { password: process.env.MG_ADMIN_PASSWORD });
  assert.equal(login.status, 200); cookie = login.headers['set-cookie'][0].split(';')[0];
  for (const [code, patch, revoked] of [
    ['BANK_CONSENT_INVALID', { status: 'REVOKED' }, false],
    ['BANK_CONSENT_EXPIRED', { access: { valid_until: '2000-01-01T00:00:00.000Z', transactions: true } }, false],
    ['BANK_ACCOUNT_SCOPE_INVALID', { accounts: ['other-account'] }, false],
    ['BANK_TRANSACTION_SCOPE_REQUIRED', { access: { valid_until: future(), transactions: false } }, false],
    ['CORPORATE_AUTHORIZATION_REQUIRED', {}, true],
  ]) await t.test(code, async () => {
    authority(); currentPatch = {}; revokeAuthority = false;
    assert.equal((await call('/api/bank/connect', 'POST', {})).status, 200);
    assert.equal((await call('/api/bank/callback?state=' + authState + '&code=synthetic-once')).status, 302);
    const before = db.prepare('SELECT * FROM bank_connections ORDER BY rowid DESC LIMIT 1').get();
    assert.equal((await call('/api/bank/accounts', 'POST', { connection_id: before.id, account_uid: account.uid })).status, 200);
    const selected = db.prepare('SELECT * FROM bank_connections WHERE id=?').get(before.id);
    const transactionReads = calls.filter(call => call.path.endsWith('/transactions')).length;
    currentPatch = patch; revokeAuthority = revoked;
    const result = await call('/api/bank/sync', 'POST', { connection_id: before.id });
    assert.equal(result.status, 409); assert.equal(result.json.code, code);
    const failed = db.prepare('SELECT * FROM bank_connections WHERE id=?').get(before.id);
    assert.equal(failed.status, 'renewal_required');
    assert.equal(failed.encrypted_session, selected.encrypted_session);
    assert.equal(failed.last_synced, selected.last_synced);
    const count = calls.length;
    assert.equal((await call('/api/bank/sync', 'POST', { connection_id: before.id })).status, 409);
    assert.equal(calls.length, count);
    assert.equal(calls.filter(call => call.path.endsWith('/transactions')).length, transactionReads);
  });
});
