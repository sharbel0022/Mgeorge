import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('the real syntax gate rejects broken nested scripts and succeeds after a valid correction', t => {
  const root = mkdtempSync(join(tmpdir(), 'mgeorge-syntax-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ['src', 'public', 'scripts/nested', 'test']) mkdirSync(join(root, path), { recursive: true });
  const file = join(root, 'scripts/nested/broken.mjs');
  const script = fileURLToPath(new URL('../scripts/check.mjs', import.meta.url));
  writeFileSync(file, 'function {');
  const rejected = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.notEqual(rejected.status, 0, 'a nested syntax error must fail CI');
  assert.match(rejected.stderr, /broken\.mjs/);
  writeFileSync(file, 'export const value = 42;\n');
  const accepted = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.equal(accepted.status, 0, accepted.stderr);
});
