import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const sitesRoot = fileURLToPath(new URL('../../', import.meta.url));
export const sourcePackage = path.join(sitesRoot, 'node_modules/@typescript-eslint/typescript-estree/node_modules/minimatch');
export const targetRecord = {
  version: '10.2.5',
  resolved: 'https://registry.npmjs.org/minimatch/-/minimatch-10.2.5.tgz',
  integrity: 'sha512-MULkVLfKGYDFYejP07QOurDLLQpcjk7Fw+7jXS2R2czRQzR56yHRveU5NDJEOviH+hETZKSkIk5c+T23GjFUMg==',
  dev: true,
};
export const hash = body => createHash('sha256').update(body).digest('hex');
export const originals = {
  'dist/commonjs/index.js': 'd224f71f20d7c206fcc5b7e9f747324c7698345a0b2c28d717dd9cf698306783',
  'dist/commonjs/index.js.map': '4345abdf627c9208d8c34f654a03a3ee3378a10c5241c7e434f8048db21b8240',
  'dist/esm/index.js': '59821ec2ce0d3df968292036e5c831ad322b33e9c33a949ecbc9dfe125d165be',
  'dist/esm/index.js.map': '5c3e65c473cad1e082a2bcf0c8d40c63d4b72efe239906380515b33a5023a384',
};

// A fresh CI install is already patched by postinstall. Recover the exact npm
// fixture bytes, asserting independent original digests before any guard test.
export function copyOriginal(destination) {
  cpSync(sourcePackage, destination, { recursive: true });
  let patch;
  for (const [relative, digest] of Object.entries(originals)) {
    const filename = path.join(destination, relative);
    let body = readFileSync(filename, 'utf8');
    if (hash(body) !== digest) {
      patch ??= JSON.parse(readFileSync(path.join(sitesRoot, 'scripts/patches/minimatch-10.2.5.json'), 'utf8'));
      const reverse = (value, edits) => {
        for (const [before, after] of [...edits].reverse()) {
          assert.equal(value.split(after).length, 2, 'known patched fixture transform must be unique');
          value = value.replace(after, before);
        }
        return value;
      };
      if (relative.endsWith('.js.map')) {
        const map = JSON.parse(body);
        map.sourcesContent = map.sourcesContent.map(source => reverse(source, patch.sourceEdits));
        map.mappings = reverse(map.mappings, patch.mappingEdits);
        body = JSON.stringify(map);
      } else body = reverse(body, patch.runtimeEdits);
      writeFileSync(filename, body);
    }
    assert.equal(hash(body), digest, 'fixture must match the actual pinned npm artifact');
  }
  for (const dependency of ['brace-expansion', 'balanced-match']) {
    const sibling = path.join(path.dirname(destination), dependency);
    if (!existsSync(sibling)) cpSync(path.join(path.dirname(sourcePackage), dependency), sibling, { recursive: true });
  }
  return destination;
}

export function fixture(t, locations = ['node_modules/minimatch']) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sites-minimatch-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packages = Object.fromEntries(locations.map(location => [location, { ...targetRecord }]));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'synthetic-sites-test', private: true, type: 'module' }));
  const lock = { name: 'synthetic-sites-test', lockfileVersion: 3, packages: { '': {}, ...packages } };
  const saveLock = () => writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(lock));
  saveLock();
  const targets = locations.map(location => {
    const target = path.join(root, location);
    mkdirSync(path.dirname(target), { recursive: true });
    return copyOriginal(target);
  });
  return { root, targets, lock, saveLock };
}

export function packageSnapshot(directory) {
  const entries = ['package.json', 'LICENSE.md', ...Object.keys(originals),
    'dist/commonjs/index.d.ts', 'dist/commonjs/index.d.ts.map',
    'dist/esm/index.d.ts', 'dist/esm/index.d.ts.map'];
  return Object.fromEntries(entries.map(relative => [relative, hash(readFileSync(path.join(directory, relative)))]));
}

export function copyScripts(root) {
  cpSync(path.join(sitesRoot, 'scripts'), path.join(root, 'scripts'), { recursive: true });
  return path.join(root, 'scripts');
}
