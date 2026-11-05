import test from 'node:test';
import assert from 'node:assert/strict';
import { seal, unseal } from '../lib/banking/security.ts';
import { createProviderBinding, scopedResourceCodec, providerForConnection } from '../lib/banking/bank-data-provider.js';
import { validateOpenPaymentsConfig } from '../lib/banking/openpayments/config.js';

const credentials = { environment: 'SANDBOX', clientId: 'synthetic-app', clientSecret: 'synthetic-secret', credentialGeneration: 'g1' };
const binding = { owner: 'owner-a', companyId: 'company-a', connectionId: 'connection-a', provider: 'open_payments', environment: 'SANDBOX', generation: 'g1' };
const secret = 'A'.repeat(43);
const codec = { seal: (owner, purpose, value) => seal(secret, owner, purpose, value), unseal: (owner, purpose, value) => unseal(secret, owner, purpose, value) };

test('sandbox bank discovery requests accountinformation corporate; production adds aspspinformation', () => {
  assert.deepEqual(validateOpenPaymentsConfig(credentials).scopes, ['accountinformation', 'corporate']);
  assert.deepEqual(validateOpenPaymentsConfig({ ...credentials, environment: 'PRODUCTION' }).scopes, ['aspspinformation', 'accountinformation', 'corporate']);
  assert.deepEqual(validateOpenPaymentsConfig({ ...credentials, features: ['consents', 'accounts', 'transactions', 'bankgiro_enrichment'] }).scopes, ['accountinformation', 'bankgiroinformation', 'corporate']);
});

test('scope and feature allowlists reject private, payment and unknown access without silent filtering', () => {
  for (const scope of ['paymentinitiation', 'private', 'payments', 'bankgirolookup', 'accountinformation corporate']) {
    assert.throws(() => validateOpenPaymentsConfig({ ...credentials, scopes: ['accountinformation', 'corporate', scope] }), { code: 'SCOPE_NOT_ALLOWED' });
  }
  for (const feature of ['payments', 'bankgiro_lookup', 'iso_fallback', 'payouts']) {
    assert.throws(() => validateOpenPaymentsConfig({ ...credentials, features: ['accounts', feature] }), { code: 'FEATURE_NOT_ALLOWED' });
  }
  for (const scopes of [[], ['corporate'], ['accountinformation'], ['bankgiroinformation', 'corporate'], ['accountinformation', 'corporate', 'corporate']]) {
    assert.throws(() => validateOpenPaymentsConfig({ ...credentials, scopes }), { code: 'SCOPE_NOT_ALLOWED' });
  }
});

test('reject unsupported version, arbitrary hosts, missing credentials and non-HTTPS callbacks', () => {
  for (const patch of [{ apiVersion: 'v2' }, { environment: 'TEST' }, { clientId: '' }, { clientSecret: '' }, { credentialGeneration: '' }, { apiBaseUrl: 'https://evil.example' }, { redirectUris: ['http://example.test/callback'] }]) {
    assert.throws(() => validateOpenPaymentsConfig({ ...credentials, ...patch }), { code: 'PROVIDER_CONFIGURATION_INVALID' });
  }
  const config = validateOpenPaymentsConfig({ ...credentials, redirectUris: ['https://app.example.test/api/bank/callback'] });
  assert.deepEqual(config.redirectUris, ['https://app.example.test/api/bank/callback']);
});

test('expired configured credentials are blocked without revealing the secret', () => {
  assert.throws(() => validateOpenPaymentsConfig({ ...credentials, credentialsValidUntil: '2026-01-01T00:00:00Z' }, () => Date.parse('2026-11-04T00:00:00Z')), error => error.code === 'CREDENTIALS_EXPIRED' && !error.message.includes(credentials.clientSecret));
});

test('legacy provider selection stays Enable Banking; unknown/disabled providers cannot fall back', () => {
  const legacy = { id: 'enable_banking' }, open = { id: 'open_payments' };
  assert.equal(providerForConnection({}, { enable_banking: legacy, open_payments: open }), legacy);
  assert.equal(providerForConnection({ provider: 'open_payments' }, { enable_banking: legacy, open_payments: open }), open);
  for (const provider of ['unknown', '', null, 'paymentinitiation']) assert.throws(() => providerForConnection({ provider }, { enable_banking: legacy }), { code: 'PROVIDER_UNAVAILABLE' });
  assert.throws(() => providerForConnection({ provider: 'open_payments' }, { enable_banking: legacy }), { code: 'PROVIDER_UNAVAILABLE' });
  assert.throws(() => providerForConnection({ provider: 'open_payments' }, { open_payments: legacy }), { code: 'PROVIDER_UNAVAILABLE' });
});

test('real existing AES-GCM codec binds resources to owner, company, provider, connection, environment and generation', async () => {
  const scope = createProviderBinding(binding);
  const resources = scopedResourceCodec(scope, codec, () => Date.parse('2026-11-04T00:00:00Z'));
  const handle = await resources.seal('account', { id: 'provider-account-0599' }, '2026-11-05T00:00:00Z');
  assert.ok(!handle.includes('provider-account-0599'));
  assert.deepEqual(await resources.open('account', handle), { id: 'provider-account-0599' });
  for (const patch of [{ owner: 'owner-b' }, { companyId: 'company-b' }, { connectionId: 'connection-b' }, { provider: 'enable_banking' }, { environment: 'PRODUCTION' }, { generation: 'g2' }]) {
    const other = scopedResourceCodec(createProviderBinding({ ...binding, ...patch }), codec);
    await assert.rejects(other.open('account', handle), { code: 'RESOURCE_SCOPE_MISMATCH' });
  }
  await assert.rejects(resources.open('consent', handle), { code: 'RESOURCE_SCOPE_MISMATCH' });
  const later = scopedResourceCodec(scope, codec, () => Date.parse('2026-11-06T00:00:00Z'));
  await assert.rejects(later.open('account', handle), { code: 'RESOURCE_EXPIRED' });
  assert.ok(Object.isFrozen(scope));
});

test('binding snapshot does not follow mutable caller state or ambiguous delimiter tuples', async () => {
  const input = { ...binding }, scope = createProviderBinding(input);
  input.companyId = 'mutated';
  assert.equal(scope.companyId, 'company-a');
  assert.throws(() => createProviderBinding({ ...binding, companyId: '' }), { code: 'INVALID_PROVIDER_BINDING' });
  const first = scopedResourceCodec(createProviderBinding({ ...binding, companyId: 'a:b', connectionId: 'c' }), codec);
  const second = scopedResourceCodec(createProviderBinding({ ...binding, companyId: 'a', connectionId: 'b:c' }), codec);
  const handle = await first.seal('consent', { id: 'consent' }, new Date(Date.now() + 60_000).toISOString());
  await assert.rejects(second.open('consent', handle), { code: 'RESOURCE_SCOPE_MISMATCH' });
});
