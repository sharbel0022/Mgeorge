import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { browserAssetsComplete, closeBrowserResources } from '../scripts/quality/browser-lifecycle.mjs';

const completeAssets = ['index.html', 'app.js', 'app.css'].map(path => ({ path, match: true }));
const deadlines = { browserTimeoutMs: 20, termTimeoutMs: 20, killTimeoutMs: 20 };
function syntheticServer(onSignal) {
  const server = new EventEmitter();
  server.exitCode = null;
  server.signalCode = null;
  server.signals = [];
  server.kill = signal => { server.signals.push(signal); return onSignal(server, signal); };
  server.finish = signal => { server.signalCode = signal; server.emit('exit', null, signal); };
  return server;
}
function assertNoListeners(server) {
  assert.equal(server.listenerCount('exit'), 0);
  assert.equal(server.listenerCount('error'), 0);
}

test('browser receipt requires every production asset with exact matching hashes', () => {
  assert.equal(browserAssetsComplete(completeAssets), true);
  assert.equal(browserAssetsComplete([]), false);
  for (const missing of ['index.html', 'app.js', 'app.css']) {
    assert.equal(browserAssetsComplete(completeAssets.filter(item => item.path !== missing)), false, missing);
  }
  assert.equal(browserAssetsComplete([...completeAssets, { path: 'app.js', match: false }]), false);
  assert.equal(browserAssetsComplete(completeAssets.map(item => ({ ...item, match: 'true' }))), false);
  assert.equal(browserAssetsComplete(completeAssets.map(item => ({ ...item, path: '/' + item.path }))), false);
});

test('rejected browser close still stops the server and records a cleanup failure', async () => {
  const server = syntheticServer((child, signal) => { child.finish(signal); return true; });
  const failures = await closeBrowserResources({ browser: { close: async () => { throw new Error('synthetic close failure'); } }, server, ...deadlines });
  assert.deepEqual(server.signals, ['SIGTERM']);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /synthetic close failure/);
  assertNoListeners(server);
});

test('a stalled browser close is bounded and cannot prevent server cleanup', async () => {
  const server = syntheticServer((child, signal) => { child.finish(signal); return true; });
  const failures = await closeBrowserResources({ browser: { close: () => new Promise(() => {}) }, server, ...deadlines });
  assert.deepEqual(server.signals, ['SIGTERM']);
  assert.match(failures[0], /timed out/);
  assertNoListeners(server);
});

test('graceful browser and server cleanup preserves a successful receipt', async () => {
  const server = syntheticServer((child, signal) => { queueMicrotask(() => child.finish(signal)); return true; });
  const failures = await closeBrowserResources({ browser: { close: async () => {} }, server, ...deadlines });
  assert.deepEqual(failures, []);
  assert.deepEqual(server.signals, ['SIGTERM']);
  assertNoListeners(server);
});

test('a server ignoring SIGTERM is killed with a bounded red cleanup receipt', async () => {
  const server = syntheticServer((child, signal) => { if (signal === 'SIGKILL') child.finish(signal); return true; });
  const failures = await closeBrowserResources({ server, ...deadlines });
  assert.deepEqual(server.signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /SIGTERM.*timed out/);
  assertNoListeners(server);
});

test('both unsuccessful shutdown deadlines return failures instead of hanging', async () => {
  const server = syntheticServer(() => true);
  const failures = await closeBrowserResources({ server, ...deadlines });
  assert.deepEqual(server.signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(failures.length, 2);
  assert.match(failures[1], /SIGKILL.*timed out/);
  assertNoListeners(server);
});

test('a rejected signal cannot skip escalation or leave event listeners behind', async () => {
  const server = syntheticServer((child, signal) => { if (signal === 'SIGTERM') throw new Error('synthetic signal failure'); child.finish(signal); return true; });
  const failures = await closeBrowserResources({ server, ...deadlines });
  assert.deepEqual(server.signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /synthetic signal failure/);
  assertNoListeners(server);
});

test('already exited and missing resources need no signals', async () => {
  const server = syntheticServer(() => { throw new Error('must not signal an exited process'); });
  server.exitCode = 0;
  assert.deepEqual(await closeBrowserResources({ server, ...deadlines }), []);
  assert.deepEqual(server.signals, []);
  assert.deepEqual(await closeBrowserResources({}), []);
  assertNoListeners(server);
});
