import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { configuredOpenPaymentsNodeTransport } from '../src/banking/openpayments-runtime-transport.js';
import { assertOpenPaymentsTokenCacheIdentity } from '../sites/lib/banking/openpayments/token-cache.js';
import { certificateFixture, localProvider } from './helpers/openpayments-local-tls.mjs';

// Synthetic certificates and loopback TLS only; no provider credentials or external bank traffic.
let certificates;
before(() => { certificates = certificateFixture(); });
after(() => certificates?.close());
function fixture() {
  const configuration = { environment: 'PRODUCTION', credentialGeneration: 'synthetic-production-g1' };
  const environment = { SAAS_BANK_ENABLED: 'true', SAAS_OPENPAYMENTS_CONFIG: JSON.stringify(configuration),
    SAAS_OPENPAYMENTS_MTLS_CONFIG: JSON.stringify(certificates.configuration) };
  const create = () => configuredOpenPaymentsNodeTransport({ environment, configuration });
  return { environment, create, transport: create() };
}

test('disabling Node banking retires captured transport and cache even if configuration is restored', () => {
  const f = fixture();
  assert.doesNotThrow(f.transport.validateCertificate);
  assert.doesNotThrow(() => assertOpenPaymentsTokenCacheIdentity(f.transport.cacheIdentity));
  f.environment.SAAS_BANK_ENABLED = 'false';
  assert.throws(f.transport.validateCertificate, { code: 'INVALID_CLIENT_CERTIFICATE' });
  assert.throws(() => assertOpenPaymentsTokenCacheIdentity(f.transport.cacheIdentity), { code: 'INVALID_ACCESS_TOKEN' });
  f.environment.SAAS_BANK_ENABLED = 'true';
  assert.throws(f.transport.validateCertificate, { code: 'INVALID_CLIENT_CERTIFICATE' }, 'a retired captured transport cannot revive');
  const replacement = f.create();
  assert.notEqual(replacement.cacheIdentity, f.transport.cacheIdentity);
  assert.doesNotThrow(replacement.validateCertificate);
});

for (const flag of ['false', undefined]) test('captured Node transport rejects disabled service ' + String(flag) + ' before opening a socket', async t => {
  const f = fixture(); let socketAttempts = 0;
  t.mock.method(https, 'request', () => { socketAttempts++; throw Error('Synthetic test forbids every network request'); });
  if (flag === undefined) delete f.environment.SAAS_BANK_ENABLED; else f.environment.SAAS_BANK_ENABLED = flag;
  await assert.rejects(f.transport.request('https://api.openbankingplatform.com/psd2/aspspinformation/v1/aspsps',
    { method: 'GET', headers: new Headers() }), { code: 'INVALID_CLIENT_CERTIFICATE' });
  assert.equal(socketAttempts, 0);
  assert.throws(() => assertOpenPaymentsTokenCacheIdentity(f.transport.cacheIdentity), { code: 'INVALID_ACCESS_TOKEN' });
});

test('banking disabled during an in-flight read discards the response and retires its cache', async t => {
  const f = fixture();
  const provider = await localProvider(t, certificates, () => {
    f.environment.SAAS_BANK_ENABLED = 'false';
    return { aspsps: [] };
  });
  await assert.rejects(f.transport.request('https://api.openbankingplatform.com/psd2/aspspinformation/v1/aspsps',
    { method: 'GET', headers: new Headers() }), { code: 'INVALID_CLIENT_CERTIFICATE' });
  assert.equal(provider.requests.length, 1);
  assert.equal(provider.requests[0].method, 'GET');
  assert.equal(provider.requests[0].path, '/psd2/aspspinformation/v1/aspsps');
  assert.throws(() => assertOpenPaymentsTokenCacheIdentity(f.transport.cacheIdentity), { code: 'INVALID_ACCESS_TOKEN' });
});
