import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { loadConfiguration } from '../src/main.js';
import { startSftp } from './sftp-server.js';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-cli-'));
  const remote = await startSftp();
  t.after(async () => { await remote.close(); await rm(dir, { force: true, recursive: true }); });
  const configuration = {
    enabled: true, spoolDirectory: join(dir, 'spool'), http: { port: 0 }, pollIntervalMs: 30000,
    binding: { owner: 'fixture-owner', sourceId: 'fixture-source', companyId: 'fixture-company', bankgiro: '1234567', scopeId: 'fixture-scope', generation: '1', profileId: 'fixture-csv' },
    entitlement: { status: 'VERIFIED', origin: 'provider_authorization', evidenceId: 'fixture-proof', checkedAt: '2026-11-03T00:00:00Z', validUntil: '2099-01-01T00:00:00Z', capabilities: ['bankgiro_reports:read'] },
    sftp: { host: '127.0.0.1', port: remote.port, username: 'reader', hostKeySha256: remote.hostKeySha256, remoteDirectory: '/reports' },
    allowedFormats: ['csv']
  };
  const configPath = join(dir, 'config.json'); await writeFile(configPath, JSON.stringify(configuration), { mode: 0o600 });
  const tokenPath = join(dir, 'token'); await writeFile(tokenPath, 'fixture-bearer-012345678901234567890123456789\n', { mode: 0o600 });
  const env = { BANKGIRO_BRIDGE_CONFIG: configPath, BANKGIRO_BRIDGE_BEARER_TOKEN_FILE: tokenPath, BANKGIRO_BRIDGE_SFTP_PASSWORD: 'fixture-password' };
  return { dir, remote, env, configuration, configPath, tokenPath };
}

test('entrypoint loads private config/secret files and never takes raw credentials from config', async t => {
  const { env, configuration, configPath } = await fixture(t);
  const loaded = await loadConfiguration(env);
  assert.equal(loaded.bearerToken, 'fixture-bearer-012345678901234567890123456789');
  assert.equal(loaded.sftp.password, 'fixture-password');
  await writeFile(configPath, JSON.stringify({ ...configuration, bearerToken: 'embedded-secret' }));
  await assert.rejects(loadConfiguration(env), { code: 'INVALID_CONFIGURATION' });
});

test('entrypoint rejects public secret permissions and missing config', async t => {
  const { env, dir } = await fixture(t);
  const insecure = join(dir, 'insecure-secret'); await writeFile(insecure, 'private-secret', { mode: 0o644 });
  await assert.rejects(loadConfiguration({ ...env, BANKGIRO_BRIDGE_BEARER_TOKEN_FILE: insecure }), { code: 'INVALID_CONFIGURATION' });
  await assert.rejects(loadConfiguration({}), { code: 'INVALID_CONFIGURATION' });
});

test('entrypoint serves actual SFTP reports over a loopback-only HTTP listener and terminates cleanly', async t => {
  const { env } = await fixture(t);
  const child = spawn(process.execPath, ['src/main.js'], { cwd: new URL('..', import.meta.url), env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode == null) { child.kill('SIGKILL'); await once(child, 'exit'); } });
  let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes; });
  let output = ''; let timer;
  const receipt = await new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('entrypoint did not become ready')), 5000);
    child.once('exit', () => { clearTimeout(timer); reject(new Error('entrypoint exited without readiness')); });
    child.stdout.on('data', bytes => {
      output += bytes.toString();
      if (output.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(output.split('\n')[0])); }
    });
  });
  assert.equal(receipt.code, 'BRIDGE_READY'); assert.equal(receipt.host, '127.0.0.1');
  const response = await fetch(`http://127.0.0.1:${receipt.port}/v1/authorization`, { headers: { authorization: 'Bearer fixture-bearer-012345678901234567890123456789' } });
  assert.equal(response.status, 200); assert.equal((await response.json()).status, 'VERIFIED');
  child.kill('SIGTERM'); const [code] = await once(child, 'exit'); assert.equal(code, 0);
  assert.equal((stderr + output).includes('fixture-password'), false);
  assert.equal((stderr + output).includes('fixture-bearer'), false);
});
