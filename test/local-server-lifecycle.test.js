import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
const root = new URL('../', import.meta.url);
async function port() {
  const s = net.createServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return p;
}
async function exitedWithin(p, ms) {
  return Promise.race([new Promise(r => p.once('exit', () => r(true))), new Promise(r => {
    const t = setTimeout(() => r(false), ms);
    t.unref();
  })]);
}
test('managed real API authenticates launcher readiness and exits when parent disconnects', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mg-server-'));
  t.after(() => rmSync(dir, {
    recursive: true,
    force: true
  }));
  const pnum = await port();
  const token = 'b'.repeat(64);
  const p = fork(new URL('src/server.js', root), [], {
    execArgv: [],
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'development',
      DB_PATH: join(dir, 'data.sqlite'),
      SESSION_SECRET: 'a'.repeat(64),
      BANK_DATA_KEY: 'c'.repeat(64),
      APP_ORIGIN: `http://localhost:${pnum}`,
      PORT: String(pnum),
      MG_LAUNCH_TOKEN: token,
      MG_LAUNCH_MANAGED: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  let log = '';
  p.stderr.on('data', x => log += x);
  t.after(() => p.kill('SIGKILL'));
  let health;
  for (let i = 0; i < 100; i++) {
    try {
      health = await fetch(`http://127.0.0.1:${pnum}/api/health`, {
        headers: {
          'x-mg-launch-token': token
        }
      });
      break;
    } catch {
      await new Promise(r => setTimeout(r, 30));
    }
  }
  assert.ok(health, log);
  assert.equal((await health.json()).launchToken, token);
  const publicHealth = await fetch(`http://127.0.0.1:${pnum}/api/health`);
  assert.equal((await publicHealth.json()).launchToken, undefined);
  const exit = exitedWithin(p, 2000);
  p.disconnect();
  assert.equal(await exit, true, 'server must shut down if its launcher vanishes');
});
test('idle document worker exits when its parent disconnects', async t => {
  const p = fork(new URL('src/invoice-worker.js', root), [], {
    execArgv: [],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: {
      PATH: process.env.PATH
    }
  });
  t.after(() => p.kill('SIGKILL'));
  await new Promise(r => setTimeout(r, 150));
  const exit = exitedWithin(p, 6000);
  p.disconnect();
  assert.equal(await exit, true, 'document worker must not outlive its parent');
});
test('API shutdown terminates document work it already owns', async () => {
  const {
    runDocumentProcess,
    stopDocumentProcesses
  } = await import('../src/invoice-extraction.js');
  const pending = runDocumentProcess(Buffer.alloc(24), 'application/pdf').then(value => ({
    value
  }), error => ({
    error
  }));
  await stopDocumentProcesses();
  const result = await pending;
  assert.ok(result.error, 'stopped document work must not report a successful extraction');
  assert.match(result.error.code, /DOCUMENT_WORKER_/);
});
