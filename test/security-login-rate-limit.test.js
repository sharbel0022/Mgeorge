import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createLoginRateLimiter } from '../src/login-rate-limit.js';

// Real independent HTTP listeners and SQLite connections, synthetic credentials.
// Reverting persistent admission to a process-local Map must fail these tests.
async function fixture(t) {
  const folder = mkdtempSync(join(tmpdir(), 'mg-login-restart-'));
  const instances = [];
  const origin = 'https://mg.login-restart.test';
  const password = 'synthetic-login-restart-password';
  Object.assign(process.env, {
    NODE_ENV: 'test', APP_ORIGIN: origin, DB_PATH: join(folder, 'db.sqlite'),
    SESSION_SECRET: 'a'.repeat(64), BANK_DATA_KEY: 'b'.repeat(64),
    MG_ADMIN_PASSWORD: password,
  });
  delete process.env.ENCRYPTION_KEY;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw Error('No provider access in login tests'); };
  t.after(async () => {
    globalThis.fetch = originalFetch;
    for (const instance of instances) await instance.close();
    rmSync(folder, { recursive: true, force: true });
  });
  async function start() {
    const { server, db } = await import('../src/server.js?login-limiter=' + crypto.randomUUID());
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let closed = false;
    const instance = {
      db,
      async close() {
        if (closed) return;
        closed = true;
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        db.close();
      },
      login(value = 'synthetic-wrong-password', extraHeaders = {}) {
        const body = JSON.stringify({ password: value });
        return new Promise((resolve, reject) => {
          const req = request({
            host: '127.0.0.1', port: server.address().port, path: '/api/login', method: 'POST',
            headers: { Host: 'mg.login-restart.test', Origin: origin,
              'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...extraHeaders },
          }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers,
              body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
          });
          req.on('error', reject);
          req.end(body);
        });
      },
    };
    instances.push(instance);
    return instance;
  }
  return { start, password };
}

test('five failed logins stay throttled after the server is restarted', async t => {
  const f = await fixture(t), first = await f.start();
  for (let i = 0; i < 5; i++) assert.equal((await first.login()).status, 401);
  assert.equal((await first.login()).status, 429);
  await first.close();
  const restarted = await f.start(), result = await restarted.login();
  assert.equal(result.status, 429, 'Restarting must not reset the failed-password budget');
  assert.equal(restarted.db.prepare('SELECT count(*) n FROM sessions').get().n, 0);
});

test('competing server instances share the final available login attempt', async t => {
  const f = await fixture(t), first = await f.start(), second = await f.start();
  for (let i = 0; i < 4; i++) assert.equal((await first.login()).status, 401);
  const results = await Promise.all([first.login(), second.login()]);
  assert.deepEqual(results.map(r => r.status).sort(), [401, 429]);
  assert.equal((await second.login()).status, 429);
});

test('throttled login returns a bounded Retry-After and ignores forwarded peer claims', async t => {
  const f = await fixture(t), instance = await f.start();
  for (let i = 0; i < 5; i++) {
    assert.equal((await instance.login(undefined, { 'X-Forwarded-For': `192.0.2.${i + 1}` })).status, 401);
  }
  const result = await instance.login(undefined, { 'X-Forwarded-For': '198.51.100.1' });
  assert.equal(result.status, 429);
  const retry = Number(result.headers['retry-after']);
  assert.ok(Number.isInteger(retry) && retry > 0 && retry <= 900, 'Supply the actual remaining window');
  assert.doesNotMatch(JSON.stringify(result.body), /192\.0\.2|198\.51\.100|synthetic-wrong-password/);
});

test('login windows expire at the boundary without extending on rejected requests', t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  let now = 1_000_000;
  const limiter = createLoginRateLimiter(db, { now: () => now });
  for (let i = 0; i < 5; i++) limiter.reserve();
  now += 899_001;
  assert.throws(() => limiter.check(), error => error.status === 429 && error.retryAfter === 1);
  assert.throws(() => limiter.reserve(), error => error.status === 429 && error.retryAfter === 1);
  now = 1_900_000;
  limiter.check();
  limiter.reserve();
  assert.deepEqual({ ...db.prepare('SELECT * FROM login_rate_limits').get() }, {
    account: 'administrator', attempts: 1, window_ends_at: 2_800_000,
  });
});

test('successful login clears only the account throttle and preserves authenticated session behavior', async t => {
  const f = await fixture(t), instance = await f.start();
  for (let i = 0; i < 4; i++) assert.equal((await instance.login()).status, 401);
  assert.equal((await instance.login(f.password)).status, 200);
  assert.equal(instance.db.prepare('SELECT count(*) n FROM login_rate_limits').get().n, 0);
  assert.equal(instance.db.prepare('SELECT count(*) n FROM sessions').get().n, 1);
  for (let i = 0; i < 5; i++) assert.equal((await instance.login()).status, 401);
  assert.equal((await instance.login()).status, 429);
  const retained = instance.db.prepare('SELECT * FROM login_rate_limits').all();
  assert.equal(retained.length, 1);
  assert.doesNotMatch(JSON.stringify(retained), /127\.0\.0\.1|password|token|synthetic/);
});
