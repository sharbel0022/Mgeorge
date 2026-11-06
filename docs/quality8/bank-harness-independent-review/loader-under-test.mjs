import { after } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const moduleDirectory = mkdtempSync(join(tmpdir(), 'mg-bank-security-'));
after(() => rmSync(moduleDirectory, { recursive: true, force: true }));
const jsUrl = value => {
  const bytes = Buffer.from(value);
  const file = join(moduleDirectory, createHash('sha256').update(bytes).digest('hex') + '.mjs');
  if (existsSync(file)) {
    if (!readFileSync(file).equals(bytes)) throw new Error('Synthetic module hash collision');
  } else writeFileSync(file, bytes, { mode: 0o600, flag: 'wx' });
  return pathToFileURL(file).href;
};

export { jsUrl, moduleDirectory };
