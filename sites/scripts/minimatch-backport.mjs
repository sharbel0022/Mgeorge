import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, constants, existsSync, fsyncSync, lstatSync, openSync,
  readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Owned backport of isaacs/minimatch 77a0f5c4b80bdc641c3c930a1d9edf5ad2db57f8.
// Exact npm 10.2.5 bytes only; no version, dependency or audit identity changes.
// Transform output was compared offline with TypeScript 5.9.3 for both formats,
// embedded source and mappings. See patches/NOTICE.md and minimatch-LICENSE.md.
const patch = JSON.parse(readFileSync(new URL('./patches/minimatch-10.2.5.json', import.meta.url), 'utf8'));
const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const samePath = (a, b) => process.platform === 'win32'
  ? a.toLowerCase() === b.toLowerCase() : a === b;

function safePath(root, relative, { optional = false, directory = false } = {}) {
  const pieces = relative.split('/');
  if (pieces.some(piece => !piece || piece === '.' || piece === '..' || /[\\:]/.test(piece)))
    throw new Error(`Unsafe backport path: ${relative}`);
  let filename = root;
  for (let index = 0; index < pieces.length; index++) {
    filename = path.join(filename, pieces[index]);
    let entry;
    try { entry = lstatSync(filename); }
    catch (error) {
      if (error.code === 'ENOENT' && optional) return null;
      throw error;
    }
    if (entry.isSymbolicLink()) throw new Error(`Symlink/junction in backport path: ${relative}`);
    if (!samePath(realpathSync(filename), filename)) throw new Error(`Unsafe real backport path: ${relative}`);
    if (index < pieces.length - 1 || directory) {
      if (!entry.isDirectory()) throw new Error(`Expected backport directory: ${relative}`);
    } else if (!entry.isFile() || entry.nlink !== 1) {
      throw new Error(`Expected an unlinked regular backport file: ${relative}`);
    }
  }
  return filename;
}

function discover(root) {
  const actual = new Map();
  const physical = new Set();
  function packageDirectory(relative) {
    const location = safePath(root, relative, { directory: true });
    const canonical = realpathSync(location);
    const identity = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
    if (physical.has(identity)) throw new Error(`Duplicate physical package path: ${relative}`);
    physical.add(identity);
    const metadata = safePath(root, `${relative}/package.json`, { optional: true });
    const pkg = metadata ? JSON.parse(readFileSync(metadata, 'utf8')) : null;
    if (relative.endsWith('/minimatch') || pkg?.name === 'minimatch') actual.set(relative, pkg);
    moduleDirectory(`${relative}/node_modules`);
  }
  function moduleDirectory(relative) {
    const location = safePath(root, relative, { optional: true, directory: true });
    if (!location) return;
    for (const entry of readdirSync(location, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue; // npm's executable shims/cache are not packages.
      const next = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Symlink/junction package path: ${next}`);
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('@')) {
        const scope = safePath(root, next, { directory: true });
        for (const child of readdirSync(scope, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          if (child.isSymbolicLink()) throw new Error(`Symlink/junction package path: ${next}/${child.name}`);
          if (child.isDirectory()) packageDirectory(`${next}/${child.name}`);
        }
      } else packageDirectory(next);
    }
  }
  moduleDirectory('node_modules');
  return actual;
}

function replaceUnique(body, edits) {
  for (const [before, after] of edits) {
    if (typeof before !== 'string' || !before || typeof after !== 'string' || body.split(before).length !== 2)
      throw new Error('Unknown/non-unique minimatch transform input');
    body = body.replace(before, after);
  }
  return body;
}

function patchedBody(relative, bytes) {
  const body = bytes.toString('utf8');
  if (!relative.endsWith('.js.map')) return Buffer.from(replaceUnique(body, patch.runtimeEdits));
  const map = JSON.parse(body);
  if (!Array.isArray(map.sourcesContent) || map.sourcesContent.length !== 1 || typeof map.mappings !== 'string')
    throw new Error('Unknown minimatch source-map layout');
  map.sourcesContent = map.sourcesContent.map(source => replaceUnique(source, patch.sourceEdits));
  map.mappings = replaceUnique(map.mappings, patch.mappingEdits);
  return Buffer.from(JSON.stringify(map));
}

function replaceFile(root, plan) {
  // All targets and outputs have passed preflight. Recheck the real path and
  // input immediately before replacing a file; each sibling rename is atomic,
  // while interruption across files remains a known repairable mixture.
  const filename = safePath(root, plan.relative);
  if (sha256(readFileSync(filename)) !== plan.before) throw new Error(`Backport input changed after preflight: ${plan.relative}`);
  const temporary = `${filename}.minimatch-backport-${randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW || 0), lstatSync(filename).mode & 0o777);
    writeFileSync(descriptor, plan.output);
    fsyncSync(descriptor);
    closeSync(descriptor); descriptor = undefined;
    safePath(root, plan.relative);
    if (sha256(readFileSync(filename)) !== plan.before) throw new Error(`Backport input changed before rename: ${plan.relative}`);
    renameSync(temporary, filename);
    if (sha256(readFileSync(safePath(root, plan.relative))) !== plan.after)
      throw new Error(`Backport output readback mismatch: ${plan.relative}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function guardMinimatchBackport({ projectRoot = defaultRoot, check = false, requireTarget = false } = {}) {
  const root = path.resolve(projectRoot);
  if (lstatSync(root).isSymbolicLink() || !samePath(realpathSync(root), root))
    throw new Error('Unsafe project root symlink/junction path');
  const lock = JSON.parse(readFileSync(safePath(root, 'package-lock.json'), 'utf8'));
  if (lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== 'object')
    throw new Error('Unsupported minimatch lock format');
  const locked = new Map();
  for (const [relative, record] of Object.entries(lock.packages)) {
    if (!/(?:^|[/\\])minimatch$/.test(relative) && record?.name !== 'minimatch') continue;
    if (!/^node_modules\/(?:@[^/]+\/)?[^/]+(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*$/.test(relative)
      || relative.split('/').some(piece => piece === '.' || piece === '..' || /[\\:]/.test(piece)))
      throw new Error(`Unsafe minimatch lock path: ${relative}`);
    if (!['3.1.5', patch.version].includes(record?.version)) throw new Error(`Unsupported minimatch lock version: ${relative}`);
    if (record.version === patch.version && (record.integrity !== patch.integrity || record.resolved !== patch.resolved))
      throw new Error(`Unsupported minimatch lock integrity/source: ${relative}`);
    locked.set(relative, record);
  }
  const actual = discover(root);
  const targets = [];
  for (const [relative, pkg] of actual) {
    const record = locked.get(relative);
    if (!record) throw new Error(`Unlisted minimatch package outside lock: ${relative}`);
    if (pkg?.name !== 'minimatch' || pkg.version !== record.version)
      throw new Error(`Unsupported minimatch package identity/version: ${relative}`);
    if (pkg.version === patch.version) targets.push(relative);
  }
  const expectedTargets = [...locked].filter(([, record]) => record.version === patch.version);
  if ((requireTarget || targets.length) && expectedTargets.some(([relative]) => !actual.has(relative)))
    throw new Error('Missing locked minimatch backport target');
  if (requireTarget && !targets.length) throw new Error('Required minimatch backport target is absent');
  const plans = [];
  const verified = [];
  for (const target of targets) {
    for (const entry of patch.files) {
      const relative = `${target}/${entry.file}`;
      const filename = safePath(root, relative);
      const current = readFileSync(filename);
      const digest = sha256(current);
      if (digest !== entry.before && digest !== entry.after)
        throw new Error(`Unknown minimatch file hash: ${relative}`);
      verified.push({ relative, after: entry.after });
      if (digest !== entry.after) {
        const output = patchedBody(entry.file, current);
        if (sha256(output) !== entry.after) throw new Error(`Minimatch transform output hash mismatch: ${relative}`);
        plans.push({ relative, before: entry.before, after: entry.after, output });
      }
    }
  }
  // No mutation occurs until every package/file/version/path/output is known.
  if (check && plans.length) throw new Error(`Unpatched minimatch installation: ${targets.length} target(s), ${plans.length} file(s)`);
  for (const plan of plans) replaceFile(root, plan);
  for (const entry of verified) {
    if (sha256(readFileSync(safePath(root, entry.relative))) !== entry.after)
      throw new Error(`Minimatch final verification failed: ${entry.relative}`);
  }
  return { targets: targets.length, writes: plans.length, status: targets.length ? 'verified' : 'no-targets' };
}

if (process.argv[1] && samePath(path.resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  const options = process.argv.slice(2);
  if (options.some(option => !['--check', '--require-target'].includes(option))) throw new Error('Expected only --check and/or --require-target');
  const result = guardMinimatchBackport({ check: options.includes('--check'), requireTarget: options.includes('--require-target') });
  console.log(`[minimatch-backport] ${JSON.stringify(result)}`);
}
