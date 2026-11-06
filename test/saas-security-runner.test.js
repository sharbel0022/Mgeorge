import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const runner = join(root, 'scripts/run-saas-security-acceptance.mjs');
const guard = join(root, 'scripts/saas-test-isolation.mjs');

// Exercise the actual runner's child-process boundary without recursively
// launching its complete acceptance suites. Each suite still runs real Node
// with the runner's environment and the normal network guard.
test('acceptance runner excludes operator preload flags and secrets from both suites', () => {
  const temp = mkdtempSync(join(tmpdir(), 'mgeorge-runner-env-'));
  try {
    const sentinel = join(temp, 'operator-preload.mjs');
    const bootstrap = join(temp, 'bootstrap.mjs');
    const output = join(temp, 'evidence');
    writeFileSync(sentinel, 'process.env.SYNTHETIC_OPERATOR_PRELOAD_RAN = "yes";\n');
    const probe = `
      import assert from 'node:assert/strict';
      assert.equal(process.env.NODE_OPTIONS, undefined);
      assert.equal(process.env.SYNTHETIC_OPERATOR_PRELOAD_RAN, undefined);
      assert.equal(process.env.MG_SITES_OCR_TOKEN, undefined);
      assert.equal(process.env.NODE_ENV, 'test');
      assert.equal(process.env.CLOUDFLARE_CF_FETCH_ENABLED, 'false');
      assert.equal(process.env.WRANGLER_SEND_METRICS, 'false');
      await assert.rejects(fetch('https://bank.synthetic.invalid/'), /SAAS_TEST_NETWORK_BLOCKED/);
      console.log('# tests 1\\n# pass 1\\n# fail 0\\n# cancelled 0\\n# skipped 0\\n# todo 0');
    `;
    writeFileSync(bootstrap, `
      import childProcess from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      const actualSpawn = childProcess.spawnSync;
      childProcess.spawnSync = (command, args, options) => {
        if (command === 'git') return { status: 0, stdout: args[0] === 'rev-parse' ? 'synthetic-commit\\n' : '' };
        return actualSpawn(command, ['--import', ${JSON.stringify(guard)}, '--input-type=module', '-e', ${JSON.stringify(probe)}], options);
      };
      syncBuiltinESMExports();
      process.env.NODE_OPTIONS = ${JSON.stringify(`--import ${pathToFileURL(sentinel).href}`)};
      process.env.MG_SITES_OCR_TOKEN = 'synthetic-test-value';
      process.argv = [process.execPath, ${JSON.stringify(runner)}, ${JSON.stringify(output)}];
      await import(${JSON.stringify(pathToFileURL(runner).href)});
    `);
    const env = { NODE_ENV: 'test' };
    for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ']) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    const result = spawnSync(process.execPath, ['--import', guard, bootstrap], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    });
    const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(report.regressionPassed, true);
    assert.equal(report.suites.length, 2);
    assert.ok(report.suites.every(suite => suite.passed && suite.tests === 1 && suite.pass === 1));
    assert.ok(report.suites[0].files.includes('test/security-login-rate-limit.test.js'));
    assert.ok(report.suites[0].files.includes('test/saas-security-runner.test.js'));
    assert.ok(report.suites[1].files.includes('tests/security-request-budget.test.mjs'));
    assert.equal(report.productionAcceptance, 'NOT_VERIFIED');
    assert.equal(report.commercialLaunch, 'NOT_APPROVED');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
