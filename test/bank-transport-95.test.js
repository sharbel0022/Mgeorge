import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { bankingRequest } from '../src/bank.js';

// Ephemeral configuration only: every test replaces fetch and cannot contact a bank.
const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const names = ['ENABLE_BANKING_APPLICATION_ID', 'ENABLEBANKING_APP_ID', 'ENABLE_BANKING_PRIVATE_KEY', 'ENABLE_BANKING_PRIVATE_KEY_FILE', 'ENABLEBANKING_PRIVATE_KEY_FILE', 'ENABLE_BANKING_ENVIRONMENT', 'ENABLEBANKING_ENVIRONMENT', 'ENABLE_BANKING_KEY_ROTATED', 'APP_ORIGIN'];
const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
test.beforeEach(() => {
  for (const name of names) delete process.env[name];
  process.env.ENABLE_BANKING_APPLICATION_ID = '11111111-1111-4111-8111-111111111111';
  process.env.ENABLE_BANKING_PRIVATE_KEY = pem;
  process.env.ENABLE_BANKING_ENVIRONMENT = 'SANDBOX';
  process.env.APP_ORIGIN = 'http://localhost:3000';
});
test.after(() => {
  for (const name of names) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const nextTurn = () => new Promise(resolve => setImmediate(() => resolve({ pending: true })));

for (const stage of ['fetch', 'response body']) {
  test(`bank transport 95: ${stage} ignoring abort still stops at the deadline without a retry`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const entered = deferred(), blocked = deferred(); let calls = 0, signal;
    t.mock.method(globalThis, 'fetch', (_url, options) => {
      calls++; signal = options.signal;
      if (stage === 'fetch') { entered.resolve(); return blocked.promise; }
      return Promise.resolve({ status: 200, ok: true, headers: new Headers(), json: () => { entered.resolve(); return blocked.promise; } });
    });
    const outcome = bankingRequest('/application').then(value => ({ value }), error => ({ error }));
    await entered.promise;
    t.mock.timers.tick(18_000);
    const result = await Promise.race([outcome, nextTurn()]);
    try {
      assert.equal(result.pending, undefined, 'deadline must settle even when the transport ignores AbortSignal');
      assert.equal(result.error?.code, 'bank_timeout');
      assert.equal(signal.aborted, true);
      assert.equal(calls, 1);
    } finally {
      blocked.resolve(stage === 'fetch' ? new Response('{}') : {});
      await outcome;
    }
  });
}
