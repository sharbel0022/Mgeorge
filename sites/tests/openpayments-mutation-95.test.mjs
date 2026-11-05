import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOpenPaymentsConfig } from '../lib/banking/openpayments/config.js';
import { createOpenPaymentsHttpClient } from '../lib/banking/openpayments/http.js';

const config = validateOpenPaymentsConfig({ environment: 'SANDBOX', clientId: 'synthetic-app',
  clientSecret: 'synthetic-secret', credentialGeneration: 'g1' });
const path = '/psd2/consent/v1/consents/synthetic-consent';

for (const [label, reply, code] of [
  ['network interruption', () => { throw Error('SYNTHETIC_PRIVATE_NETWORK'); }, 'PROVIDER_UNAVAILABLE_NETWORK'],
  ['unanswered request', () => new Promise(() => {}), 'PROVIDER_TIMEOUT'],
  ['server failure', () => new Response(null, { status: 503 }), 'PROVIDER_SERVICE_ERROR'],
]) test('consent DELETE keeps an unknown remote outcome after ' + label, async () => {
  let requests = 0;
  const http = createOpenPaymentsHttpClient(config, { timeoutMs: 20,
    transport: { kind: 'sandbox', request() { requests++; return reply(); } } });
  await assert.rejects(http.send({ path, method: 'DELETE' }), error => {
    assert.equal(error.code, code);
    assert.equal(error.mayHaveSucceeded, true);
    assert.equal(error.retryable, false);
    assert.doesNotMatch(error.message, /SYNTHETIC_PRIVATE/);
    return true;
  });
  assert.equal(requests, 1);
});

test('aborting an in-flight consent DELETE preserves ambiguity and never replays the request', async () => {
  let requests = 0;
  const controller = new AbortController();
  const http = createOpenPaymentsHttpClient(config, { transport: { kind: 'sandbox', request() {
    requests++;
    controller.abort();
    return new Promise(() => {});
  } } });
  await assert.rejects(http.send({ path, method: 'DELETE', signal: controller.signal }), error =>
    error.code === 'PROVIDER_ABORTED' && error.mayHaveSucceeded === true && error.retryable === false);
  assert.equal(requests, 1);
});

test('consent DELETE before dispatch stays definitely unsent and successful 204 is accepted once', async () => {
  let requests = 0;
  const controller = new AbortController(); controller.abort();
  const http = createOpenPaymentsHttpClient(config, { transport: { kind: 'sandbox', request() {
    requests++; return new Response(null, { status: 204 });
  } } });
  await assert.rejects(http.send({ path, method: 'DELETE', signal: controller.signal }), error =>
    error.code === 'PROVIDER_ABORTED' && error.mayHaveSucceeded !== true);
  assert.equal(requests, 0);
  assert.deepEqual((await http.send({ path, method: 'DELETE' })).data, {});
  assert.equal(requests, 1);
});
