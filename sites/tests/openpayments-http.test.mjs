import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOpenPaymentsConfig } from '../lib/banking/openpayments/config.js';
import { createOpenPaymentsHttpClient } from '../lib/banking/openpayments/http.js';
import { OpenPaymentsTokenClient } from '../lib/banking/openpayments/token.js';

const config = validateOpenPaymentsConfig({ environment: 'SANDBOX', clientId: 'synthetic-app', clientSecret: 'synthetic-secret', credentialGeneration: 'g1' });
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
const token = (patch = {}) => ({ access_token: 'opaque-synthetic-token', token_type: 'Bearer', expires_in: 3600, scope: 'accountinformation corporate', ...patch });
const apiPath = '/psd2/aspspinformation/v1/aspsps';
const harness = (reply, options = {}) => {
  const calls = [];
  const transport = { kind: 'sandbox', request: async (url, init) => { calls.push({ url, init }); return reply(url, init, calls.length); } };
  return { calls, http: createOpenPaymentsHttpClient(config, { transport, ...options }) };
};

test('client credentials are form encoded on the fixed sandbox auth host and never serialized in the token client', async () => {
  const { http, calls } = harness(() => json(token()));
  const client = new OpenPaymentsTokenClient(config, http);
  assert.equal(await client.accessToken(), 'opaque-synthetic-token');
  assert.equal(calls[0].url, 'https://oauth.sandbox.openbankingplatform.com/connect/token');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(calls[0].init.headers.get('content-type'), 'application/x-www-form-urlencoded');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(calls[0].init.body)), { client_id: 'synthetic-app', client_secret: 'synthetic-secret', grant_type: 'client_credentials', scope: 'accountinformation corporate' });
  assert.ok(!JSON.stringify(client).includes('synthetic'));
});

test('concurrent token requests share one refresh and actual expiry triggers a new token', async () => {
  let time = Date.parse('2026-11-04T00:00:00Z');
  const { http, calls } = harness(() => json(token()), { now: () => time });
  const client = new OpenPaymentsTokenClient(config, http, () => time);
  assert.deepEqual(await Promise.all([client.accessToken(), client.accessToken(), client.accessToken()]), Array(3).fill('opaque-synthetic-token'));
  assert.equal(calls.length, 1);
  time += 3500_000;
  await client.accessToken(); assert.equal(calls.length, 1);
  time += 100_000;
  await client.accessToken(); assert.equal(calls.length, 2);
  client.invalidate();
  await client.accessToken(); assert.equal(calls.length, 3);
});

test('token invalidation during refresh cannot resurrect the old token', async () => {
  let release;
  const { http } = harness(() => new Promise(resolve => { release = () => resolve(json(token())); }));
  const client = new OpenPaymentsTokenClient(config, http);
  const pending = client.accessToken();
  await new Promise(resolve => setImmediate(resolve));
  client.invalidate(); release();
  await assert.rejects(pending, { code: 'INVALID_ACCESS_TOKEN' });
});

test('malformed OAuth results fail closed, including extra permission and missing or invalid lifetime', async t => {
  const bad = [null, [], {}, token({ access_token: '' }), token({ access_token: 'with\nnewline' }), token({ token_type: 'Basic' }), token({ expires_in: 0 }), token({ expires_in: '3600' }), token({ expires_in: 3601 }), token({ scope: 'accountinformation corporate paymentinitiation' }), token({ scope: 'accountinformation private' }), token({ scope: undefined })];
  for (let i = 0; i < bad.length; i++) await t.test(`malformed response ${i}`, async () => {
    const { http } = harness(() => json(bad[i]));
    await assert.rejects(new OpenPaymentsTokenClient(config, http).accessToken(), error => ['INVALID_OAUTH_RESULT', 'PROVIDER_RESPONSE_INVALID'].includes(error.code));
  });
});

test('client error and expired configured credentials do not expose provider payload or retry forever', async () => {
  const { http } = harness(() => json({ error: 'invalid_client', error_description: 'synthetic-secret sensitive' }, 400));
  await assert.rejects(new OpenPaymentsTokenClient(config, http).accessToken(), error => error.code === 'INVALID_CLIENT_CREDENTIALS' && !error.message.includes('synthetic-secret') && !error.retryable);
  let time = Date.parse('2026-11-04T00:00:00Z');
  const expiring = validateOpenPaymentsConfig({ ...config, clientSecret: 'synthetic-secret', credentialsValidUntil: '2026-11-04T01:00:00Z' }, () => time);
  const client = new OpenPaymentsTokenClient(expiring, harness(() => json(token())).http, () => time);
  await client.accessToken(); time += 3600_000;
  await assert.rejects(client.accessToken(), { code: 'CREDENTIALS_EXPIRED' });
});

test('HTTP classification does not echo token, account, server response or exception details', async t => {
  for (const [status, code, retryable] of [[401, 'INVALID_ACCESS_TOKEN', false], [403, 'PROVIDER_FORBIDDEN', false], [429, 'PROVIDER_RATE_LIMIT', true], [500, 'PROVIDER_SERVICE_ERROR', true], [502, 'PROVIDER_SERVICE_ERROR', true], [503, 'PROVIDER_SERVICE_ERROR', true]]) {
    await t.test(String(status), async () => {
      const { http } = harness(() => json({ detail: 'synthetic-secret account-0599' }, status, { 'retry-after': '172800' }));
      await assert.rejects(http.send({ path: apiPath }), error => error.code === code && error.retryable === retryable && !JSON.stringify(error).includes('0599') && !error.message.includes('synthetic-secret'));
    });
  }
});

test('429 preserves Retry-After without reading a stalled body, and absurd delays block retry', async () => {
  const { http } = harness(() => new Response(new ReadableStream({ start() {} }), { status: 429, headers: { 'retry-after': '172800' } }), { timeoutMs: 20 });
  await assert.rejects(http.send({ path: apiPath }), error => error.code === 'PROVIDER_RATE_LIMIT' && error.retryAfter === 172800);
  const huge = harness(() => json({}, 429, { 'retry-after': '9999999999999999999999999' })).http;
  await assert.rejects(huge.send({ path: apiPath }), error => error.code === 'PROVIDER_RATE_LIMIT' && error.retryBlocked && !error.retryable);
});

test('network and body deadlines remain bounded even when injected transport ignores abort', async () => {
  for (const reply of [() => new Promise(() => {}), () => new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'application/json' } })]) {
    const { http, calls } = harness(reply, { timeoutMs: 15 });
    const start = Date.now();
    await assert.rejects(http.send({ path: apiPath }), { code: 'PROVIDER_TIMEOUT' });
    assert.ok(Date.now() - start < 1000);
    assert.ok(calls[0].init.signal.aborted);
  }
});

test('abort and oversized JSON responses fail safely', async () => {
  const abort = new AbortController(); abort.abort();
  const { http, calls } = harness(() => json({ aspsps: [] }));
  await assert.rejects(http.send({ path: apiPath, signal: abort.signal }), { code: 'PROVIDER_ABORTED' });
  assert.equal(calls.length, 0);
  const tooLarge = harness(() => json({ value: 'x'.repeat(2000) }), { maxResponseBytes: 100 }).http;
  await assert.rejects(tooLarge.send({ path: apiPath }), { code: 'PROVIDER_RESPONSE_INVALID' });
});

test('transport accepts no arbitrary origin, payment/premium/ISO path, redirect, unsupported version or duplicate query', async () => {
  const { http, calls } = harness(() => json({}));
  for (const input of [
    { path: 'https://evil.example' }, { path: '//evil.example' }, { path: '/psd2/paymentinitiation/v1/payments', method: 'POST' },
    { path: '/premium/v1/giro-numbers' }, { path: '/iso/payments' }, { path: '/psd2/aspspinformation/v2/aspsps' },
    { path: '/psd2/aspspinformation/v1/../paymentinitiation/v1/payments' },
    { path: apiPath + '?isoCountryCodes=SE&isoCountryCodes=FI' },
    { path: '/psd2/accountinformation/v1/accounts/a/transactions?bookingStatus=both' },
    { path: apiPath, method: 'DELETE' }, { service: 'auth', path: '/connect/authorize' },
    { path: apiPath, headers: { 'X-ISO-Fallback-Enabled': 'true' } },
  ]) await assert.rejects(http.send(input), { code: 'FEATURE_NOT_ALLOWED' });
  assert.equal(calls.length, 0);
  const redirect = harness(() => new Response(null, { status: 302, headers: { location: 'https://evil.example' } })).http;
  await assert.rejects(redirect.send({ path: apiPath }), { code: 'PROVIDER_RESPONSE_INVALID' });
});

test('production refuses ordinary fetch and invalid or expired certificate before token request', async () => {
  const production = validateOpenPaymentsConfig({ ...config, clientSecret: 'synthetic-secret', environment: 'PRODUCTION', scopes: undefined });
  assert.throws(() => createOpenPaymentsHttpClient(production), { code: 'INVALID_CLIENT_CERTIFICATE' });
  for (const code of ['INVALID_CLIENT_CERTIFICATE', 'CLIENT_CERTIFICATE_EXPIRED']) {
    let calls = 0;
    const transport = { kind: 'mtls', validateCertificate() { throw Object.assign(new Error('private certificate text'), { code }); }, request() { calls++; } };
    const http = createOpenPaymentsHttpClient(production, { transport });
    await assert.rejects(http.send({ path: apiPath }), error => error.code === code && !error.message.includes('private certificate'));
    assert.equal(calls, 0);
  }
});

test('a failed consent write is marked ambiguous and never auto-retried', async () => {
  const { http, calls } = harness(() => { throw Error('synthetic-secret network dump'); });
  await assert.rejects(http.send({ path: '/psd2/consent/v1/consents', method: 'POST', body: '{}' }), error => error.code === 'PROVIDER_UNAVAILABLE_NETWORK' && error.mayHaveSucceeded && !error.retryable);
  assert.equal(calls.length, 1);
});

test('direct construction cannot bypass scope policy or mutate a token request after validation', async () => {
  const { http, calls } = harness(() => json(token()));
  const raw = { environment: 'SANDBOX', clientId: 'synthetic-app', clientSecret: 'synthetic-secret', credentialGeneration: 'g1', scopes: ['accountinformation', 'corporate', 'paymentinitiation'] };
  assert.throws(() => new OpenPaymentsTokenClient(raw, http), { code: 'SCOPE_NOT_ALLOWED' });
  const mutable = { ...raw, scopes: ['accountinformation', 'corporate'] };
  const client = new OpenPaymentsTokenClient(mutable, http);
  mutable.scopes.push('paymentinitiation'); mutable.clientSecret = 'changed-secret';
  await client.accessToken();
  assert.equal(new URLSearchParams(calls[0].init.body).get('scope'), 'accountinformation corporate');
  assert.equal(new URLSearchParams(calls[0].init.body).get('client_secret'), 'synthetic-secret');
});
