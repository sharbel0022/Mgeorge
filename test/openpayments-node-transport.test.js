import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { X509Certificate, generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenPaymentsHttpClient } from '../sites/lib/banking/openpayments/http.js';
import { validateOpenPaymentsConfig } from '../sites/lib/banking/openpayments/config.js';

let createOpenPaymentsNodeTransport;
try {
  ({ createOpenPaymentsNodeTransport } = await import('../src/banking/openpayments-node-transport.js'));
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}

let certificatePem, privateKeyPem, validFrom, validTo, fixtureDir;
before(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'openpayments-mtls-test-'));
  const certPath = join(fixtureDir, 'client.pem');
  const keyPath = join(fixtureDir, 'client.key');
  // A test certificate must not depend on an operator's global OpenSSL config
  // (some Windows distributions have an absent compiled-in default path).
  const configPath = join(fixtureDir, 'openssl.cnf');
  writeFileSync(configPath, '[req]\ndistinguished_name=subject\n[subject]\n', { mode: 0o600 });
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-config', configPath,
    '-subj', '/CN=synthetic-openpayments-client', '-days', '2',
    '-keyout', keyPath, '-out', certPath], { stdio: 'ignore' });
  certificatePem = readFileSync(certPath, 'utf8');
  privateKeyPem = readFileSync(keyPath, 'utf8');
  const cert = new X509Certificate(certificatePem);
  validFrom = Date.parse(cert.validFrom);
  validTo = Date.parse(cert.validTo);
});
after(() => { if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true }); });

function transport(overrides = {}) {
  assert.equal(typeof createOpenPaymentsNodeTransport, 'function', 'mTLS transport factory must exist');
  return createOpenPaymentsNodeTransport({ certificatePem, privateKeyPem, now: () => validFrom + 10_000, ...overrides });
}
function init(overrides = {}) {
  return { method: 'GET', headers: new Headers({ accept: 'application/json' }), ...overrides };
}
const API = 'https://api.openbankingplatform.com/psd2/accountinformation/v1/accounts';
const AUTH = 'https://auth.openbankingplatform.com/connect/token';

function adapter(t) {
  const calls = [];
  t.mock.method(https, 'request', (url, options, callback) => {
    const req = new EventEmitter();
    req.destroyed = false;
    req.end = body => { req.body = body; };
    req.destroy = () => { req.destroyed = true; return req; };
    calls.push({ url, options, req, callback });
    return req;
  });
  return {
    calls,
    respond(status = 200, headers = ['Content-Type', 'application/json'], call = calls.at(-1)) {
      const response = new PassThrough();
      response.statusCode = status;
      response.rawHeaders = headers;
      call.response = response;
      call.callback(response);
      return response;
    }
  };
}
function safeError(error, code) {
  assert.equal(error.code, code);
  assert.equal(error.cause, undefined);
  assert.doesNotMatch(`${error.message} ${JSON.stringify(error)}`, /BEGIN|PRIVATE KEY|synthetic-openpayments-client|bank-secret|certificate-secret/);
  return true;
}

// These checks exercise certificate material without sending it to any server.
test('factory validates the pair and exposes only the frozen transport interface', () => {
  const value = transport();
  assert.equal(Object.isFrozen(value), true);
  assert.deepEqual(Object.keys(value), ['kind', 'validateCertificate', 'request']);
  assert.equal(value.kind, 'mtls');
  assert.equal(value.validateCertificate(), undefined);
  assert.equal(JSON.stringify(value), '{"kind":"mtls"}');
});
test('malformed certificate and private key fail with sanitized errors', () => {
  assert.throws(() => transport({ certificatePem: 'certificate-secret' }), e => safeError(e, 'INVALID_CLIENT_CERTIFICATE'));
  assert.throws(() => transport({ privateKeyPem: 'bank-secret' }), e => safeError(e, 'INVALID_CLIENT_CERTIFICATE'));
});
test('a certificate and another private key are rejected', () => {
  const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
    .export({ type: 'pkcs8', format: 'pem' });
  assert.throws(() => transport({ privateKeyPem: otherKey }), e => safeError(e, 'INVALID_CLIENT_CERTIFICATE'));
});
test('not-yet-valid and expired certificates have distinct safe codes', () => {
  assert.throws(() => transport({ now: () => validFrom - 1 }), e => safeError(e, 'INVALID_CLIENT_CERTIFICATE'));
  assert.throws(() => transport({ now: () => validTo + 1 }), e => safeError(e, 'CLIENT_CERTIFICATE_EXPIRED'));
});
test('certificate expiry is checked again before a socket is created', async t => {
  const mock = adapter(t);
  let clock = validFrom + 10_000;
  const value = transport({ now: () => clock });
  clock = validTo + 1;
  assert.throws(() => value.validateCertificate(), e => safeError(e, 'CLIENT_CERTIFICATE_EXPIRED'));
  await assert.rejects(value.request(API, init()), e => safeError(e, 'CLIENT_CERTIFICATE_EXPIRED'));
  assert.equal(mock.calls.length, 0);
});
test('unsafe origins, credential-bearing URLs, token query strings and banking write endpoints never open a socket', async t => {
  const mock = adapter(t);
  const value = transport();
  for (const url of [
    'http://api.openbankingplatform.com/psd2/accountinformation/v1/accounts',
    'https://api.openbankingplatform.com.evil.example/psd2/accountinformation/v1/accounts',
    'https://api.sandbox.openbankingplatform.com/psd2/accountinformation/v1/accounts',
    'https://user:bank-secret@api.openbankingplatform.com/psd2/accountinformation/v1/accounts',
    'https://api.openbankingplatform.com:444/psd2/accountinformation/v1/accounts',
    `${API}#bank-secret`,
    `${AUTH}?client_secret=bank-secret`,
    'https://auth.openbankingplatform.com/other',
    'https://api.openbankingplatform.com/psd2/paymentinitiation/v1/payments',
    'https://api.openbankingplatform.com/iso20022/payments',
    'https://api.openbankingplatform.com/premium/accounts',
    'https://api.openbankingplatform.com/psd2/consent/v1/../paymentinitiation/v1/payments',
    'https://api.openbankingplatform.com/psd2/accountinformation/v1/%61ccounts'
  ]) {
    await assert.rejects(value.request(url, init()), e => safeError(e, 'INVALID_REQUEST'));
  }
  await assert.rejects(value.request(API, init({ method: 'POST', body: '{}' })), e => safeError(e, 'INVALID_REQUEST'));
  assert.equal(mock.calls.length, 0);
});
test('token and consent methods are allowed with verified TLS and fixed options', async t => {
  const mock = adapter(t);
  const value = transport();
  const headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded' });
  const promise = value.request(AUTH, init({ method: 'POST', headers, body: 'grant_type=client_credentials',
    redirect: 'manual', cache: 'no-store', rejectUnauthorized: false, ca: 'not-used' }));
  const { options, req } = mock.calls[0];
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.minVersion, 'TLSv1.2');
  assert.equal(options.agent, false);
  assert.equal(options.cert, certificatePem);
  assert.equal(options.key, privateKeyPem);
  assert.equal(options.ca, undefined);
  assert.equal(options.checkServerIdentity, undefined);
  assert.equal(req.body, 'grant_type=client_credentials');
  mock.respond().end('{}');
  assert.equal(await (await promise).text(), '{}');
  for (const [path, method] of [
    ['/psd2/consent/v1/consents', 'POST'],
    ['/psd2/consent/v1/consents/consent-1/authorisations/auth-1', 'PUT'],
    ['/psd2/consent/v1/consents/consent-1', 'DELETE']
  ]) {
    const pending = value.request(`https://api.openbankingplatform.com${path}`, init({ method }));
    mock.respond(204);
    assert.equal((await pending).status, 204);
  }
});
test('Host header cannot override the TLS destination', async t => {
  const mock = adapter(t);
  await assert.rejects(transport().request(API, init({ headers: new Headers({ host: 'evil.example' }) })), e => safeError(e, 'INVALID_REQUEST'));
  assert.equal(mock.calls.length, 0);
});
test('returns a streaming WHATWG Response with provider statuses and headers intact', async t => {
  const mock = adapter(t);
  const pending = transport().request(API, init());
  const incoming = mock.respond(429, ['Content-Type', 'application/json', 'Retry-After', '17', 'X-Request-ID', 'synthetic-1']);
  const response = await pending;
  assert.ok(response instanceof Response);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '17');
  assert.equal(response.headers.get('x-request-id'), 'synthetic-1');
  const reader = response.body.getReader();
  incoming.write('{"ok":');
  const chunk = await reader.read();
  assert.equal(Buffer.from(chunk.value).toString(), '{"ok":');
  incoming.end('true}');
  assert.equal(Buffer.from((await reader.read()).value).toString(), 'true}');
  assert.equal((await reader.read()).done, true);
});
test('preserves error statuses and headers while discarding unsafe declared bodies', async t => {
  const mock = adapter(t);
  for (const status of [401, 403, 429, 500, 503]) {
    for (const length of [String(2 * 1024 * 1024 + 1), 'invalid', '-1']) {
      const pending = transport().request(API, init());
      const incoming = mock.respond(status, [
        'Content-Type', 'application/json',
        'Content-Length', length,
        'Retry-After', '17',
        'X-Request-ID', 'synthetic-status'
      ]);
      const response = await pending;
      assert.equal(response.status, status);
      assert.equal(response.headers.get('retry-after'), '17');
      assert.equal(response.headers.get('x-request-id'), 'synthetic-status');
      assert.equal(response.body, null);
      assert.equal(await response.text(), '');
      assert.equal(incoming.destroyed, true);
      assert.equal(mock.calls.at(-1).req.destroyed, true);
      assert.notEqual(incoming.readableFlowing, true);
    }
  }
});

test('the shared HTTP client retains actionable errors through the native transport', async t => {
  const mock = adapter(t);
  const config = validateOpenPaymentsConfig({ environment: 'PRODUCTION', clientId: 'synthetic-client', clientSecret: 'synthetic-secret', credentialGeneration: 'test-1' });
  const http = createOpenPaymentsHttpClient(config, { transport: transport() });
  for (const [status, code, reportedStatus] of [
    [401, 'INVALID_ACCESS_TOKEN', 401], [403, 'PROVIDER_FORBIDDEN', 403],
    [429, 'PROVIDER_RATE_LIMIT', 429], [500, 'PROVIDER_SERVICE_ERROR', 502],
    [503, 'PROVIDER_SERVICE_ERROR', 502]
  ]) {
    const pending = http.send({ path: '/psd2/accountinformation/v1/accounts' });
    await Promise.resolve();
    const incoming = mock.respond(status, ['Content-Length', '3000000', 'Retry-After', '172800']);
    await assert.rejects(pending, error => {
      assert.equal(error.code, code);
      assert.equal(error.status, reportedStatus);
      if (status >= 429) assert.equal(error.retryAfter, 172800);
      return true;
    });
    assert.equal(incoming.destroyed, true);
  }
  const pending = http.send({ service: 'auth', path: '/connect/token', method: 'POST', body: 'grant_type=client_credentials' });
  await Promise.resolve();
  mock.respond(401, ['Content-Length', '3000000']);
  await assert.rejects(pending, { code: 'INVALID_CLIENT_CREDENTIALS', status: 401 });
});

test('redirect responses close the socket instead of following or exposing redirect data', async t => {
  const mock = adapter(t);
  const pending = transport().request(API, init());
  const incoming = mock.respond(302, ['Location', 'https://evil.example/?token=bank-secret']);
  await assert.rejects(pending, e => safeError(e, 'PROVIDER_REDIRECT'));
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].req.destroyed, true);
  assert.equal(incoming.destroyed, true);
});
test('advertised oversized response is rejected before body consumption', async t => {
  const mock = adapter(t);
  const pending = transport().request(API, init());
  const incoming = mock.respond(200, ['Content-Length', String(2 * 1024 * 1024 + 1)]);
  await assert.rejects(pending, e => safeError(e, 'RESPONSE_TOO_LARGE'));
  assert.equal(incoming.destroyed, true);
  assert.equal(mock.calls[0].req.destroyed, true);
});
test('chunked body limit cancels the socket when the actual bytes exceed 2 MiB', async t => {
  const mock = adapter(t);
  const pending = transport().request(API, init());
  const incoming = mock.respond();
  const response = await pending;
  const body = response.arrayBuffer();
  incoming.write(Buffer.alloc(2 * 1024 * 1024));
  incoming.end('x');
  await assert.rejects(body, e => safeError(e, 'RESPONSE_TOO_LARGE'));
  assert.equal(mock.calls[0].req.destroyed, true);
  assert.equal(incoming.destroyed, true);
});
test('abort before a request does not open a socket or expose the abort reason', async t => {
  const mock = adapter(t);
  const controller = new AbortController();
  controller.abort(new Error('bank-secret'));
  await assert.rejects(transport().request(API, init({ signal: controller.signal })), e => safeError(e, 'REQUEST_ABORTED'));
  assert.equal(mock.calls.length, 0);
});
test('abort while awaiting headers destroys the request', async t => {
  const mock = adapter(t);
  const controller = new AbortController();
  const pending = transport().request(API, init({ signal: controller.signal }));
  controller.abort('bank-secret');
  await assert.rejects(pending, e => safeError(e, 'REQUEST_ABORTED'));
  assert.equal(mock.calls[0].req.destroyed, true);
});
test('abort during a streamed response errors the reader and destroys both streams', async t => {
  const mock = adapter(t);
  const controller = new AbortController();
  const pending = transport().request(API, init({ signal: controller.signal }));
  const incoming = mock.respond();
  const response = await pending;
  const reading = response.text();
  controller.abort('bank-secret');
  await assert.rejects(reading, e => safeError(e, 'REQUEST_ABORTED'));
  assert.equal(mock.calls[0].req.destroyed, true);
  assert.equal(incoming.destroyed, true);
});
test('consumer cancellation closes the request and response', async t => {
  const mock = adapter(t);
  const pending = transport().request(API, init());
  const incoming = mock.respond();
  await (await pending).body.cancel();
  assert.equal(mock.calls[0].req.destroyed, true);
  assert.equal(incoming.destroyed, true);
});
test('the 20 second deadline covers both headers and body', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const mock = adapter(t);
  const first = transport().request(API, init());
  t.mock.timers.tick(20_000);
  await assert.rejects(first, e => safeError(e, 'REQUEST_TIMEOUT'));
  assert.equal(mock.calls[0].req.destroyed, true);
  const next = transport().request(API, init());
  const incoming = mock.respond();
  const body = (await next).text();
  t.mock.timers.tick(20_000);
  await assert.rejects(body, e => safeError(e, 'REQUEST_TIMEOUT'));
  assert.equal(incoming.destroyed, true);
  assert.equal(mock.calls[1].req.destroyed, true);
});
test('network errors before and after headers are sanitized', async t => {
  const mock = adapter(t);
  const first = transport().request(API, init());
  mock.calls[0].req.emit('error', new Error('bank-secret'));
  await assert.rejects(first, e => safeError(e, 'PROVIDER_NETWORK_ERROR'));
  const next = transport().request(API, init());
  const incoming = mock.respond();
  const body = (await next).text();
  incoming.destroy(new Error('bank-secret'));
  await assert.rejects(body, e => safeError(e, 'PROVIDER_NETWORK_ERROR'));
  assert.equal(mock.calls[1].req.destroyed, true);
});
