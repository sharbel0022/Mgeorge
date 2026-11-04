import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const guard = fileURLToPath(new URL('../scripts/saas-test-isolation.mjs', import.meta.url));
function run(source, environment = 'test') {
  return spawnSync(process.execPath, ['--import', guard, '--input-type=module', '-e', source], {
    encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, NODE_ENV: environment },
  });
}

test('acceptance isolation refuses to load outside a test process', () => {
  const result = run('console.log("UNSAFE_START")', 'production');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SAAS_TEST_ONLY/);
  assert.ok(!result.stdout.includes('UNSAFE_START'));
});

test('acceptance isolation denies external fetch and raw TCP before connection', () => {
  const result = run(`
    import assert from 'node:assert/strict';
    import net from 'node:net';
    await assert.rejects(fetch('https://bank.synthetic.invalid/private'), /SAAS_TEST_NETWORK_BLOCKED/);
    assert.throws(() => net.connect({ host: '192.0.2.1', port: 443 }), /SAAS_TEST_NETWORK_BLOCKED/);
    assert.throws(() => net.connect({ path: '/tmp/synthetic-private.sock' }), /SAAS_TEST_NETWORK_BLOCKED/);
    console.log('EXTERNAL_BLOCKED');
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /EXTERNAL_BLOCKED/);
});

test('acceptance isolation permits the actual loopback HTTP fixture', () => {
  const result = run(`
    import assert from 'node:assert/strict';
    import http from 'node:http';
    const server = http.createServer((req, res) => res.end('synthetic local fixture'));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch('http://127.0.0.1:' + server.address().port);
      assert.equal(await response.text(), 'synthetic local fixture');
      console.log('LOOPBACK_PASSED');
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /LOOPBACK_PASSED/);
});
