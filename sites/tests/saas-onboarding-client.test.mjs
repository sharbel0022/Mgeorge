import test from 'node:test';
import assert from 'node:assert/strict';
import { createOnboardingClient, OnboardingError } from '../lib/onboarding/client.ts';
import { mutationAllowed } from '../lib/onboarding/client.ts';
import { snapshotFixture, fixtureNow } from './helpers/saas-onboarding-fixture.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
test('directory read is same-origin, private, abortable, and never follows an API redirect', async () => {
  const signal = new AbortController().signal;
  const client = createOnboardingClient(async (path, options) => {
    assert.equal(path, '/api/companies'); assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal); assert.equal(options.signal.aborted, false);
    assert.equal(options.body, undefined); return json({ version: 1 });
  });
  assert.deepEqual(await client.directory(signal), { version: 1 });
});

test('only explicit missing directory enables legacy mode; forbidden and missing company never do', async () => {
  assert.equal(await createOnboardingClient(async () => json({}, 404)).directory(), null);
  for (const [status, kind] of [[401, 'signin'], [403, 'forbidden'], [409, 'conflict'], [429, 'rate_limited'], [500, 'unavailable']]) {
    const client = createOnboardingClient(async () => json({ error: 'SECRET provider URL or another company' }, status));
    await assert.rejects(client.directory(), error => error instanceof OnboardingError && error.kind === kind && !error.message.includes('SECRET'));
  }
  await assert.rejects(createOnboardingClient(async () => json({}, 404)).snapshot('company-alpha'), error => error.kind === 'forbidden');
});

test('company mutation carries current scope, CSRF, revision and fresh idempotency without storing credentials', async () => {
  let calls = 0; const keys = new Set();
  const client = createOnboardingClient(async (path, options) => {
    calls++; assert.equal(path, '/api/companies/company-alpha/bank/accounts');
    assert.equal(options.method, 'POST'); assert.equal(options.headers['X-CSRF-Token'], 'synthetic-csrf-01234567890');
    assert.match(options.headers['Idempotency-Key'], /^[\w-]{16,128}$/); keys.add(options.headers['Idempotency-Key']);
    assert.deepEqual(JSON.parse(options.body), { connectionId: 'connection-alpha', accountIds: ['account-alpha'], expectedRevision: 7 });
    return json({ accepted: true });
  });
  for (let n = 0; n < 2; n++) await client.mutate('company-alpha', 'accounts', { connectionId: 'connection-alpha', accountIds: ['account-alpha'], expectedRevision: 7 }, 'synthetic-csrf-01234567890');
  assert.equal(calls, 2); assert.equal(keys.size, 2);
});

test('invalid company path, unknown action and missing CSRF fail before any request', async () => {
  let calls = 0; const client = createOnboardingClient(async () => { calls++; return json({}); });
  await assert.rejects(client.snapshot('../other'));
  await assert.rejects(client.mutate('company-alpha', 'transfer', {}, 'synthetic-csrf-01234567890'));
  await assert.rejects(client.mutate('company-alpha', 'disconnect', {}, ''));
  assert.equal(calls, 0);
});

test('a successful HTML response and arbitrary provider errors are not displayed as onboarding data', async () => {
  await assert.rejects(createOnboardingClient(async () => new Response('<html>Login page</html>')).directory(), error => error.kind === 'invalid');
  await assert.rejects(createOnboardingClient(async () => json({ error: 'bank secret' })).directory(), error => error.kind === 'invalid' && !error.message.includes('secret'));
});

test('network failure becomes a safe retry message while intentional abort stays an abort', async () => {
  await assert.rejects(createOnboardingClient(async () => { throw Error('sensitive upstream failure'); }).directory(), error => error.kind === 'unavailable' && !error.message.includes('sensitive'));
  await assert.rejects(createOnboardingClient(async () => { throw new DOMException('Aborted', 'AbortError'); }).directory(), error => error.name === 'AbortError');
});

test('mutations recheck time, role, capability and provider eligibility at click time', () => {
  const s = snapshotFixture(); s.sync.nextAllowedAt = null;
  assert.equal(mutationAllowed(s, 'owner', 'sync', fixtureNow), true);
  assert.equal(mutationAllowed(s, 'viewer', 'sync', fixtureNow), false);
  assert.equal(mutationAllowed(s, 'owner', 'sync', fixtureNow + 301000), false);
  s.connection.validUntil = new Date(fixtureNow).toISOString();
  assert.equal(mutationAllowed(s, 'owner', 'sync', fixtureNow), false);
  assert.equal(mutationAllowed(s, 'owner', 'accounts', fixtureNow), false);
  assert.equal(mutationAllowed(s, 'owner', 'renew', fixtureNow), true);
  s.actions.renew = false; assert.equal(mutationAllowed(s, 'owner', 'renew', fixtureNow), false);
});

test('queued jobs, no selected accounts and future eligibility never start a second sync', () => {
  for (const change of [s => s.sync.state = 'queued', s => s.sync.state = 'running', s => s.sync.state = 'blocked', s => s.accounts[0].selected = false, s => s.sync.nextAllowedAt = new Date(fixtureNow + 1000).toISOString()]) {
    const s = snapshotFixture(); s.sync.nextAllowedAt = null; change(s);
    assert.equal(mutationAllowed(s, 'admin', 'sync', fixtureNow), false);
  }
  const s = snapshotFixture(); assert.equal(mutationAllowed(s, 'owner', 'connect', fixtureNow), false);
  s.connection.status = 'revoked'; assert.equal(mutationAllowed(s, 'owner', 'connect', fixtureNow), true);
  assert.equal(mutationAllowed(s, 'owner', 'renew', fixtureNow), false);
});

test('a hung API read has a bounded deadline even if its transport ignores abort', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let observedSignal;
  const client = createOnboardingClient(async (_path, options) => { observedSignal = options.signal; return new Promise(() => {}); });
  const result = client.snapshot('company-alpha');
  const rejected = assert.rejects(result, error => error instanceof OnboardingError && error.kind === 'unavailable');
  t.mock.timers.tick(20000);
  assert.equal(observedSignal.aborted, true);
  await rejected;
});

test('scope cancellation settles ignored transport aborts and a cancelled scope never starts a request', async () => {
  const controller = new AbortController(); let transportSignal, calls = 0;
  const client = createOnboardingClient(async (_path, options) => { calls++; transportSignal = options.signal; return new Promise(() => {}); });
  const request = client.snapshot('company-alpha', controller.signal);
  const rejected = assert.rejects(request, error => error.name === 'AbortError');
  controller.abort();
  await rejected; assert.equal(transportSignal.aborted, true);
  await assert.rejects(client.snapshot('company-alpha', controller.signal), error => error.name === 'AbortError');
  assert.equal(calls, 1);
});
