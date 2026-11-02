import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [originalPath, patchedPath, sitesRoot] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const shapes = [];
let comparisons = 0;
const literalCases = [
  ['src/a.ts', 'src/**/*.ts', {}, true],
  ['src/a.js', 'src/**/*.ts', {}, false],
  ['.hidden', '*', {}, false],
  ['.hidden', '*', { dot: true }, true],
  ['src', 'src/**/*.ts', { partial: true }, true],
  ['src', 'src/**/*.ts', {}, false],
  ['//server/share/a.ts', '//server/share/**/*.ts', { platform: 'win32' }, true],
  ['//?/C:/src/a.ts', '//?/C:/src/**/*.ts', { platform: 'win32' }, true],
  ['C:/src/a.ts', 'C:/src/**/*.ts', { platform: 'win32' }, true],
  ['a/b/c', 'a/**/c', {}, true],
  ['a/.b/c', 'a/**/c', {}, false],
];
for (const format of ['commonjs', 'esm']) {
  const load = base => format === 'commonjs'
    ? require(base + '/dist/commonjs/index.js')
    : import(pathToFileURL(base + '/dist/esm/index.js').href);
  const original = await load(originalPath), patched = await load(patchedPath);
  assert.deepEqual(Object.keys(patched).sort(), Object.keys(original).sort());
  assert.equal(typeof patched.minimatch, 'function');
  assert.equal(typeof patched.Minimatch, 'function');
  shapes.push({ format, exports: Object.keys(patched).sort() });
  for (const optimizationLevel of [0, 1]) {
    for (const [filename, pattern, options, expected] of literalCases) {
      const config = { ...options, optimizationLevel };
      assert.equal(original.minimatch(filename, pattern, config), expected, `original literal ${filename}`);
      assert.equal(patched.minimatch(filename, pattern, config), expected, `patched literal ${filename}`);
      const before = new original.Minimatch(pattern, config), after = new patched.Minimatch(pattern, config);
      const setShape = set => set.map(parts => parts.map(part => typeof part === 'string' ? ['text', part] : [typeof part, String(part)]));
      assert.deepEqual(setShape(after.set), setShape(before.set));
      assert.equal(String(after.makeRe()), String(before.makeRe()));
      assert.equal(after.match(filename), before.match(filename));
      comparisons++;
    }
  }
  for (const config of [{}, { dot: true }, { partial: true }, { platform: 'win32' }, { windowsPathsNoEscape: true, platform: 'win32' }]) {
    for (const pattern of ['**/*.ts', '**/../a/b/**/../c/d', '{a,b}/**', '//server/share/**', 'C:\\src\\*.ts']) {
      for (const filename of ['src/a.ts', '.a.ts', 'a/b/c', '../a/b/../c/d', '//server/share/a', 'C:\\src\\a.ts']) {
        assert.equal(patched.minimatch(filename, pattern, config), original.minimatch(filename, pattern, config));
        comparisons++;
      }
    }
  }
}

// Exercise the real installed parser and real patched package at its dependency
// boundary. Only this isolated child's loader is substituted; node_modules stays
// unchanged. A project-service typed program and exclusion both execute for real.
const patched = require(patchedPath + '/dist/commonjs/index.js');
const originalLoad = Module._load;
let minimatchCalls = 0;
Module._load = function (request, parent, isMain) {
  if (request === 'minimatch' && parent?.filename.includes(path.join('@typescript-eslint', 'typescript-estree'))) {
    return { ...patched, minimatch(...args) { minimatchCalls++; return patched.minimatch(...args); } };
  }
  return originalLoad.apply(this, arguments);
};
const parser = createRequire(path.join(sitesRoot, 'package.json'))('@typescript-eslint/parser');
const tsconfigRootDir = path.dirname(patchedPath);
const parsed = parser.parseForESLint('const sample: number = 1;', {
  filePath: path.join(tsconfigRootDir, 'sample.ts'), tsconfigRootDir,
  projectService: { allowDefaultProject: ['sample.ts'] }, loc: true, range: true,
});
assert.equal(parsed.ast.type, 'Program');
assert.ok(parsed.services.program);
assert.ok(minimatchCalls > 0);
assert.throws(() => parser.parseForESLint('const excluded: number = 1;', {
  filePath: path.join(tsconfigRootDir, 'excluded.ts'), tsconfigRootDir,
  projectService: { allowDefaultProject: ['sample.ts'] },
}), /does not match|not found/);
Module._load = originalLoad;
console.log(JSON.stringify({ comparisons, shapes, minimatchCalls, typedProgram: true, nonMatchingFileRejected: true }));
