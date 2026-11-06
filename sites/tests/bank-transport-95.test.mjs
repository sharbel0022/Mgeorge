import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { providerRequest } from '../lib/banking/enable-banking.ts';

// Synthetic credentials and fetch replacements: no provider network access.
const config = {
  applicationId: '11111111-1111-4111-8111-111111111111',
  privateKeyPem: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }),
};
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const nextTurn = () => new Promise(resolve => setImmediate(() => resolve({ pending: true })));

for (const stage of ['fetch', 'response body']) {
  test(`bank transport 95: ${stage} ignoring abort still stops at the deadline without a retry`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const entered = deferred(), blocked = deferred(); let calls = 0, signal, stream;
    t.mock.method(globalThis, 'fetch', (_url, options) => {
      calls++; signal = options.signal;
      if (stage === 'fetch') { entered.resolve(); return blocked.promise; }
      return Promise.resolve(new Response(new ReadableStream({ start(controller) { stream = controller; }, pull() { entered.resolve(); } })));
    });
    const outcome = providerRequest(config, '/application').then(value => ({ value }), error => ({ error }));
    await entered.promise;
    t.mock.timers.tick(20_000);
    const result = await Promise.race([outcome, nextTurn()]);
    try {
      assert.equal(result.pending, undefined, 'deadline must settle even when the transport ignores AbortSignal');
      assert.equal(result.error?.code, 'BANK_TIMEOUT');
      assert.equal(signal.aborted, true);
      assert.equal(calls, 1);
    } finally {
      if (stage === 'fetch') blocked.resolve(new Response('{}'));
      else { try { stream.close(); } catch {} }
      await outcome;
    }
  });
}

for (const scenario of [
  { name: 'redirect', status: 302, code: 'PROVIDER_REDIRECT_DENIED' },
  { name: 'declared oversize', status: 200, headers: { 'content-length': String(2 * 1024 * 1024 + 1) }, code: 'RESPONSE_TOO_LARGE' },
  { name: 'streamed oversize', status: 200, oversized: true, code: 'RESPONSE_TOO_LARGE' },
]) {
  for (const cancellation of ['rejects', 'never settles']) {
    test(`bank transport 95: ${scenario.name} retains its error when cancellation ${cancellation}`, async t => {
      let cancelled = 0; const blocked = deferred(), entered = deferred();
      t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
        start(controller) { if (scenario.oversized) controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); },
        cancel() { cancelled++; entered.resolve(); return cancellation === 'rejects' ? Promise.reject(new Error('PRIVATE_CANCELLATION_DETAIL')) : blocked.promise; },
      }), { status: scenario.status, headers: scenario.headers }));
      t.mock.method(console, 'error', () => {});
      const outcome = providerRequest(config, '/application').then(value => ({ value }), error => ({ error }));
      await entered.promise;
      const result = await Promise.race([outcome, nextTurn()]);
      try {
        assert.equal(result.pending, undefined, 'cleanup must not delay an established provider error');
        assert.equal(result.error?.code, scenario.code);
        assert.doesNotMatch(result.error.message, /PRIVATE_CANCELLATION_DETAIL/);
        assert.equal(cancelled, 1);
      } finally { blocked.resolve(); await outcome; }
    });
  }
}
