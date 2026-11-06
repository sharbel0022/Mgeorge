import { constants, openSync, closeSync, fstatSync, lstatSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

const MAX_PRIVATE_KEY_BYTES = 128 * 1024;
const unavailable = () => new Error('PRIVATE_KEY_FILE_UNVERIFIED');
const identityFields = ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs', 'mode', 'uid'];

/**
 * Read one owner-only POSIX credential from its verified descriptor. Files must
 * live outside the repository, with no symlink components and a trusted parent.
 * This is not an ACL verifier for Windows: use a protected runtime PEM there.
 * Concurrent hostile writes by the service's own OS principal are out of scope.
 */
export function readPrivateKeyFile(path, repositoryRoot) {
  let fd;
  try {
    if (typeof process.getuid !== 'function' || typeof path !== 'string' ||
        !path || path.length > 4096 || !isAbsolute(path) || resolve(path) !== path ||
        /[\u0000-\u001f\u007f]/.test(path)) throw unavailable();
    const ownerUid = process.getuid();
    if (!Number.isSafeInteger(ownerUid) || ownerUid < 0) throw unavailable();
    const root = realpathSync(repositoryRoot);
    const location = relative(root, path);
    if (location !== '..' && !location.startsWith('..' + sep) && !isAbsolute(location)) throw unavailable();

    // Inspect all components; O_NOFOLLOW separately protects the final open.
    let current = parse(path).root;
    for (const component of path.slice(current.length).split(sep)) {
      current = join(current, component);
      if (lstatSync(current).isSymbolicLink()) throw unavailable();
    }
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
    const before = fstatSync(fd);
    if (!before.isFile() || before.size < 1 || before.size > MAX_PRIVATE_KEY_BYTES ||
        before.uid !== ownerUid || (before.mode & 0o077) !== 0) throw unavailable();

    const bytes = Buffer.alloc(MAX_PRIVATE_KEY_BYTES + 1);
    let length = 0, read;
    while (length < bytes.length &&
        (read = readSync(fd, bytes, length, bytes.length - length, null)) > 0) length += read;
    const after = fstatSync(fd), named = lstatSync(path);
    if (length !== before.size || length > MAX_PRIVATE_KEY_BYTES || named.isSymbolicLink() ||
        realpathSync(path) !== path ||
        identityFields.some(field => before[field] !== after[field] || after[field] !== named[field])) throw unavailable();
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
  } catch {
    // Do not copy OS error text, a private filename or credential contents.
    throw unavailable();
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
