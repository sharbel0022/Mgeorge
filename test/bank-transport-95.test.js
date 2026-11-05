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
      let cancelled = false;
      return Promise.resolve(new Response(new ReadableStream({
        pull(controller) { entered.resolve(); return blocked.promise.then(() => { if (!cancelled) controller.close(); }); },
        cancel() { cancelled = true; }
      }, { highWaterMark: 0 })));
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

function byteStream(bytes, { chunkSize = 65_535, read = () => {}, cancel = () => {} } = {}) {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      read();
      if (offset === bytes.byteLength) { controller.close(); return; }
      const end = Math.min(offset + chunkSize, bytes.byteLength);
      controller.enqueue(bytes.subarray(offset, end)); offset = end;
    },
    cancel
  }, { highWaterMark: 0 });
}

for (const cancellation of ['rejects', 'never settles']) {
  test(`bank transport 95: declared oversize fails before reading even when cancellation ${cancellation}`, async t => {
    let calls = 0, reads = 0, cancelled = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      return new Response(byteStream(Buffer.from('{}'), {
        read() { reads++; },
        cancel() { cancelled++; return cancellation === 'rejects' ? Promise.reject(Error('Synthetic cleanup error')) : new Promise(() => {}); }
      }), { headers: { 'Content-Length': '2097153' } });
    });
    await assert.rejects(bankingRequest('/application'), { code: 'response_too_large', status: 502 });
    assert.equal(reads, 0);
    assert.equal(cancelled, 1);
    assert.equal(calls, 1);
  });
}

for (const contentLength of [undefined, '2']) {
  test(`bank transport 95: streamed bytes enforce 2 MiB with ${contentLength === undefined ? 'missing' : 'understated'} Content-Length`, async t => {
    let calls = 0, cancelled = 0;
    // UTF-8 bytes exceed the limit although the decoded character count does not.
    const bytes = Buffer.from(JSON.stringify({ padding: 'å'.repeat(1_048_576) }));
    t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      return new Response(byteStream(bytes, {
        cancel() { cancelled++; return contentLength === undefined ? Promise.reject(Error('Synthetic cleanup error')) : new Promise(() => {}); }
      }), { headers: contentLength === undefined ? {} : { 'Content-Length': contentLength } });
    });
    await assert.rejects(bankingRequest('/application'), { code: 'response_too_large', status: 502 });
    assert.equal(cancelled, 1);
    assert.equal(calls, 1);
  });
}

test('bank transport 95: exactly 2 MiB remains valid across split UTF-8 characters', async t => {
  const padding = 'å'.repeat(1_048_569);
  const bytes = Buffer.from(JSON.stringify({ padding }));
  assert.equal(bytes.byteLength, 2_097_152);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(byteStream(bytes), { headers: { 'Content-Length': '2097152' } });
  });
  assert.deepEqual(await bankingRequest('/application'), { padding });
  assert.equal(calls, 1);
});

test('bank transport 95: a fetch resolved after timeout is cancelled without starting body consumption', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const entered = deferred(), blocked = deferred();
  let calls = 0, reads = 0, cancelled = 0;
  t.mock.method(globalThis, 'fetch', () => { calls++; entered.resolve(); return blocked.promise; });
  const outcome = bankingRequest('/application').then(value => ({ value }), error => ({ error }));
  await entered.promise;
  t.mock.timers.tick(18_000);
  assert.equal((await outcome).error?.code, 'bank_timeout');
  blocked.resolve(new Response(byteStream(Buffer.from('{}'), {
    read() { reads++; }, cancel() { cancelled++; }
  })));
  await nextTurn();
  assert.equal(reads, 0);
  assert.equal(cancelled, 1);
  assert.equal(calls, 1);
});

for (const status of [429, 503]) {
  test(`bank transport 95: HTTP ${status} keeps immediate Retry-After ahead of the byte limit`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let calls = 0, reads = 0, cancelled = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      return new Response(byteStream(Buffer.from('{}'), {
        read() { reads++; }, cancel() { cancelled++; return new Promise(() => {}); }
      }), { status, headers: { 'Retry-After': '172800', 'Content-Length': '2097153' } });
    });
    const outcome = bankingRequest('/application').then(value => ({ value }), error => ({ error }));
    const result = await Promise.race([outcome, nextTurn()]);
    try {
      assert.equal(result.pending, undefined, 'cooldown must not wait for cancellation');
      assert.equal(result.error?.code, status === 429 ? 'rate_limited' : 'bank_unavailable');
      assert.equal(result.error?.status, status);
      assert.equal(result.error?.retryAfter, 172_800);
      assert.equal(reads, 0);
      assert.equal(cancelled, 1);
      assert.equal(calls, 1);
    } finally { t.mock.timers.tick(18_000); await outcome; }
  });
}
