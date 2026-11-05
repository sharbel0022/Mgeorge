import test from 'node:test';
import assert from 'node:assert/strict';
import { BankProviderError } from '../lib/banking/bank-data-provider.js';
import { validateOpenPaymentsConfig } from '../lib/banking/openpayments/config.js';
import { createOpenPaymentsHttpClient } from '../lib/banking/openpayments/http.js';
import { OpenPaymentsProvider } from '../lib/banking/openpayments-provider.js';
import { createSaasBankRuntime } from '../lib/banking/saas-bank-runtime.js';
import { fixtureTransport, CONFIG, CONTEXT, codec, AUTH_ID, CONSENT_ID, json, NOW } from './helpers/openpayments-fixture.mjs';

const CONSENTS = '/psd2/consent/v1/consents';
const AUTHORISATIONS = `${CONSENTS}/${CONSENT_ID}/authorisations`;
const AUTHORISATION = `${AUTHORISATIONS}/${AUTH_ID}`;
const secret = 'synthetic-provider-secret';
const malformed = () => new Response(`{"detail":"${secret}"`, { status: 201, headers: { 'content-type': 'application/json' } });
const brokenStream = () => new Response(new ReadableStream({ start(controller) { controller.error(new Error(secret)); } }), { status: 200, headers: { 'content-type': 'application/json' } });
const ambiguous = error => error instanceof BankProviderError && error.mayHaveSucceeded === true && error.retryable === false && !JSON.stringify(error).includes(secret) && !error.message.includes(secret);

// A successful write with an unreadable receipt must never be treated as proof
// that the bank did nothing. The real HTTP client decides; only transport is fake.
for (const [method, path] of [['POST', CONSENTS], ['PUT', AUTHORISATION]]) {
  for (const [name, response] of [
    ['truncated JSON', malformed],
    ['interrupted body', brokenStream],
    ['invalid UTF-8', () => new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'content-type': 'application/json' } })],
    ['oversized body', () => json({ detail: 'x'.repeat(200) }, 201)],
  ]) test(`${method} ${name} after success retains write ambiguity without an automatic retry`, async () => {
    let calls = 0;
    const http = createOpenPaymentsHttpClient(validateOpenPaymentsConfig(CONFIG), { maxResponseBytes: 128, transport: { kind: 'sandbox', async request() { calls++; return response(); } } });
    await assert.rejects(http.send({ method, path, body: '{}' }), ambiguous);
    assert.equal(calls, 1);
  });
}

test('a rejected write, pre-dispatch cancellation and malformed read do not invent a completed write', async () => {
  let calls = 0;
  const http = createOpenPaymentsHttpClient(validateOpenPaymentsConfig(CONFIG), { transport: { kind: 'sandbox', async request(_url, init) { calls++; return init.method === 'GET' ? malformed() : json({}, 403); } } });
  await assert.rejects(http.send({ method: 'POST', path: CONSENTS, body: '{}' }), error => error.code === 'PROVIDER_FORBIDDEN' && error.mayHaveSucceeded !== true);
  await assert.rejects(http.send({ path: `${CONSENTS}/${CONSENT_ID}` }), error => error.code === 'PROVIDER_RESPONSE_INVALID' && error.mayHaveSucceeded !== true);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(http.send({ method: 'POST', path: CONSENTS, body: '{}', signal: controller.signal }), error => error.code === 'PROVIDER_ABORTED' && error.mayHaveSucceeded !== true);
  assert.equal(calls, 2);
});

for (const [operation, key] of [['consent', `POST ${CONSENTS}`], ['authorisation', `POST ${AUTHORISATIONS}`], ['start', `PUT ${AUTHORISATION}`]]) {
  test(`semantically invalid successful ${operation} receipt retains write ambiguity`, async () => {
    const f = fixtureTransport({ [key]: () => json({}, 201) });
    const client = new OpenPaymentsProvider(CONFIG, { transport: f.transport, now: () => NOW }).forCompany(CONTEXT, f.dependencies);
    const create = () => client.createConsent({ validUntil: '2026-12-01' });
    if (operation === 'consent') await assert.rejects(create(), ambiguous);
    else {
      const consent = await create();
      if (operation === 'authorisation') await assert.rejects(client.createAuthorisation(consent.handle), ambiguous);
      else {
        const authorization = await client.createAuthorisation(consent.handle);
        await assert.rejects(client.startAuthorisation(authorization.handle, { authenticationMethodId: 'mbid' }), ambiguous);
      }
    }
    const [method, path] = key.split(' ');
    assert.equal(f.calls.filter(call => call.init.method === method && new URL(call.url).pathname === path).length, 1);
  });
}

test('a local sealing failure after consent creation is sanitized and retains write ambiguity', async () => {
  const f = fixtureTransport();
  const client = new OpenPaymentsProvider(CONFIG, { transport: f.transport, now: () => NOW }).forCompany(CONTEXT, { ...f.dependencies, codec: { ...codec, async seal() { throw new Error(secret); } } });
  await assert.rejects(client.createConsent({ validUntil: '2026-12-01' }), ambiguous);
  assert.equal(f.calls.filter(call => call.init.method === 'POST' && new URL(call.url).pathname === CONSENTS).length, 1);
});

test('membership loss after a successful consent request retains ambiguity without returning authority', async () => {
  const f = fixtureTransport();
  const client = new OpenPaymentsProvider(CONFIG, { transport: f.transport, now: () => NOW }).forCompany(CONTEXT, {
    ...f.dependencies,
    async assertCurrent() { if (f.calls.some(call => call.init.method === 'POST' && new URL(call.url).pathname === CONSENTS)) throw new Error(secret); },
  });
  await assert.rejects(client.createConsent({ validUntil: '2026-12-01' }), error => ambiguous(error) && error.code === 'RESOURCE_SCOPE_MISMATCH');
});

function runtimeFixture(overrides = {}, beforeSave = async () => {}) {
  let row = { revision: 0, value: null };
  const transport = fixtureTransport({
    [`PUT ${AUTHORISATION}`]: () => json({ scaStatus: 'started', _links: { scaOAuth: { href: `https://oauth.sandbox.openbankingplatform.com/connect/authorize?client_id=[CLIENT_ID]&scope=accountinformation%20corporate&response_type=code&redirect_uri=[TPP_REDIRECT_URI]&state=[TPP_STATE]&acr_values=idp:OPBKSE21%20consentId:${CONSENT_ID}%20ConsentAuthorisationId:${AUTH_ID}` } } }, 200, { 'aspsp-sca-approach': 'REDIRECT' }),
    ...overrides,
  });
  const store = {
    async read() { return structuredClone(row); },
    async compareAndSet(revision, value) { if (row.revision !== revision) return false; await beforeSave(value); row = { revision: revision + 1, value: structuredClone(value) }; return true; },
  };
  const context = { version: 'company-context-v1', companyId: 'company-a', storageOwner: 'owner-a', actorId: 'actor-a', role: 'owner', companyVersion: 1, membershipVersion: 1, contextVersion: 1 };
  const registration = { companyId: 'company-a', actorId: 'actor-a', verified: true, corporateAccessVerified: true, redirectVerified: true, corporateId: 'synthetic-company-a', psuId: 'synthetic-psu-a', bicFi: 'OPBKSE21', bankId: 'OPBKSE21', bankName: 'Synthetic Bank', psu: { ipAddress: '192.0.2.10', userAgent: 'Synthetic' } };
  return {
    transport, read: () => structuredClone(row),
    async restoreStatus(status) { const saved = await store.read(); await store.compareAndSet(saved.revision, { ...saved.value, status }); },
    service: (extra = {}) => createSaasBankRuntime({ context, config: CONFIG, registration, enabled: true, store: { ...store }, codec, assertCurrent: async () => {}, sessionHash: 'session-a', redirectUri: CONFIG.redirectUris[0], providerOptions: { transport: transport.transport }, requestKey: 'synthetic-start-request-0001', ...extra }),
  };
}
const startBody = expectedRevision => ({ bankId: 'OPBKSE21', expectedRevision, permissions: ['accounts:read', 'transactions:read'] });

for (const [name, key, reply, knownConsent] of [
  ['unreadable consent', `POST ${CONSENTS}`, malformed, false],
  ['lost consent reply', `POST ${CONSENTS}`, () => { throw new Error(secret); }, false],
  ['missing consent identity', `POST ${CONSENTS}`, () => json({}, 201), false],
  ['unreadable authorisation', `POST ${AUTHORISATIONS}`, brokenStream, true],
  ['unreadable authorization start', `PUT ${AUTHORISATION}`, malformed, true],
]) test(`${name} persists a blocked restart across a new runtime and a new idempotency key`, async () => {
  const f = runtimeFixture({ [key]: reply });
  await assert.rejects(f.service().start(startBody(0)));
  const snapshot = await f.service().snapshot();
  assert.equal(snapshot.actions.connect, false);
  assert.equal(snapshot.actions.disconnect, knownConsent);
  assert.equal(snapshot.connection.status, 'error');
  assert.deepEqual(snapshot.accounts, []);
  const calls = f.transport.calls.length;
  await assert.rejects(f.service({ requestKey: 'synthetic-start-request-0002' }).start(startBody(snapshot.revision)), { code: knownConsent ? 'BANK_BUSY' : 'CONSENT_RECOVERY_REQUIRED' });
  await assert.rejects(f.service().syncContext('unconfirmed-account'), { code: 'BANK_CONSENT_INVALID' });
  assert.equal(f.transport.calls.length, calls);
  assert.equal(JSON.stringify(snapshot).includes(secret), false);
});

test('a known consent survives a definite later rejection until explicit revocation permits another start', async () => {
  let reject = true;
  const f = runtimeFixture({ [`POST ${AUTHORISATIONS}`]: () => reject ? json({}, 403) : json({ authorisationId: AUTH_ID, scaStatus: 'received', scaMethods: [{ authenticationMethodId: 'mbid', authenticationType: 'PUSH_OTP', name: 'Synthetic BankID' }] }, 201) });
  await assert.rejects(f.service().start(startBody(0)), { code: 'PROVIDER_FORBIDDEN' });
  const blocked = await f.service().snapshot();
  assert.equal(blocked.actions.connect, false);
  assert.equal(blocked.actions.disconnect, true);
  const revoked = await f.service({ requestKey: 'synthetic-revoke-request-01' }).revoke({ connectionId: blocked.connection.id, expectedRevision: blocked.revision });
  assert.equal(revoked.connection.status, 'revoked');
  assert.equal(f.transport.calls.filter(call => call.init.method === 'DELETE').length, 1);
  reject = false;
  const restarted = await f.service({ requestKey: 'synthetic-start-request-0002' }).start(startBody(revoked.revision));
  assert.equal(restarted.authorization.state, 'pending');
});

for (const status of ['failed', 'cancelled']) test(`persisted legacy ${status} with a known unrevoked consent cannot be overwritten`, async () => {
  const f = runtimeFixture({ [`POST ${AUTHORISATIONS}`]: () => json({}, 403) });
  await assert.rejects(f.service().start(startBody(0)));
  await f.restoreStatus(status);
  const snapshot = await f.service().snapshot(), calls = f.transport.calls.length;
  assert.equal(snapshot.actions.connect, false);
  assert.equal(snapshot.actions.disconnect, true);
  assert.ok(snapshot.connection);
  await assert.rejects(f.service({ requestKey: 'synthetic-start-request-0002' }).start(startBody(snapshot.revision)), { code: 'BANK_BUSY' });
  assert.equal(f.transport.calls.length, calls);
});

test('failure before creating any consent remains recoverable without a fabricated bank resource', async () => {
  const f = runtimeFixture({ 'GET /psd2/aspspinformation/v1/aspsps/OPBKSE21': () => json({}, 503) });
  await assert.rejects(f.service().start(startBody(0)), { code: 'PROVIDER_SERVICE_ERROR' });
  const snapshot = await f.service().snapshot();
  assert.equal(snapshot.actions.connect, true);
  assert.equal(snapshot.actions.disconnect, false);
  assert.equal(snapshot.connection, null);
  assert.equal(f.transport.calls.some(call => new URL(call.url).pathname === CONSENTS), false);
});

test('a failed first persistence of a created consent retains its handle for explicit revocation', async () => {
  let failOnce = true;
  const f = runtimeFixture({}, async value => {
    if (failOnce && value.status === 'starting' && value.consentHandle) { failOnce = false; throw new Error('synthetic storage interruption'); }
  });
  await assert.rejects(f.service().start(startBody(0)));
  const snapshot = await f.service().snapshot();
  assert.equal(snapshot.actions.connect, false);
  assert.equal(snapshot.actions.disconnect, true);
  const calls = f.transport.calls.length;
  await assert.rejects(f.service({ requestKey: 'synthetic-start-request-0002' }).start(startBody(snapshot.revision)), { code: 'BANK_BUSY' });
  assert.equal(f.transport.calls.length, calls);
  const revoked = await f.service({ requestKey: 'synthetic-revoke-request-01' }).revoke({ connectionId: snapshot.connection.id, expectedRevision: snapshot.revision });
  assert.equal(revoked.connection.status, 'revoked');
});

for (const status of ['failed', 'cancelled']) test(`legacy ${status} without a receipt cannot certify that a new consent is safe`, async () => {
  const f = runtimeFixture({ [`POST ${CONSENTS}`]: malformed });
  await assert.rejects(f.service().start(startBody(0)));
  await f.restoreStatus(status);
  const snapshot = await f.service().snapshot(), calls = f.transport.calls.length;
  assert.equal(snapshot.actions.connect, false);
  assert.equal(snapshot.actions.disconnect, false);
  assert.equal(snapshot.connection.status, 'error');
  await assert.rejects(f.service({ requestKey: 'synthetic-start-request-0002' }).start(startBody(snapshot.revision)), { code: 'CONSENT_RECOVERY_REQUIRED' });
  assert.equal(f.transport.calls.length, calls);
});

for (const [name, failure, errorCode] of [
  ['token network failure', () => { throw new Error('synthetic token network failure'); }, 'PROVIDER_UNAVAILABLE_NETWORK'],
  ['malformed successful token body', () => new Response('{"access_token":', { status: 200, headers: { 'content-type': 'application/json' } }), 'PROVIDER_RESPONSE_INVALID'],
]) test(`${name} before consent creation remains safely retryable`, async () => {
  let tokenFails = true;
  const f = runtimeFixture({
    'POST /connect/token': (_url, init) => {
      if (tokenFails) return failure();
      return json({ access_token: 'synthetic-application-token', token_type: 'Bearer', expires_in: 3600, scope: new URLSearchParams(init.body).get('scope') });
    },
  });
  await assert.rejects(f.service().start(startBody(0)), error => error.code === errorCode && error.mayHaveSucceeded === true);
  const consentCalls = () => f.transport.calls.filter(call => call.init.method === 'POST' && new URL(call.url).pathname === CONSENTS).length;
  assert.equal(consentCalls(), 0);
  assert.deepEqual(f.transport.calls.map(call => call.init.method + ' ' + new URL(call.url).pathname), ['POST /connect/token']);
  const snapshot = await f.service().snapshot();
  assert.equal(snapshot.actions.connect, true, 'a token error before createConsent cannot require consent recovery');
  assert.equal(snapshot.actions.disconnect, false);
  assert.equal(snapshot.connection, null);
  assert.equal(f.read().value.status, 'failed');
  assert.equal(f.read().value.retrySafe, true);
  assert.equal(f.read().value.consentHandle, undefined);
  tokenFails = false;
  const restarted = await f.service({ requestKey: 'synthetic-token-retry-0002' }).start(startBody(snapshot.revision));
  assert.equal(restarted.authorization.state, 'pending');
  assert.equal(consentCalls(), 1, 'the explicit retry creates the first and only consent');
});
