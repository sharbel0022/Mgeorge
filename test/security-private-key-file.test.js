import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { configStatus, consentApplicationFingerprint, jwt } from '../src/bank.js';

// Independently generated fixtures only. These configuration/signing paths do
// not need network access, a customer account or a real provider credential.
const directory = mkdtempSync(join(tmpdir(), 'mg-private-key-acceptance-'));
const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const names = ['ENABLE_BANKING_APPLICATION_ID', 'ENABLEBANKING_APP_ID', 'ENABLE_BANKING_PRIVATE_KEY', 'ENABLE_BANKING_PRIVATE_KEY_FILE', 'ENABLEBANKING_PRIVATE_KEY_FILE', 'ENABLE_BANKING_ENVIRONMENT', 'ENABLEBANKING_ENVIRONMENT', 'ENABLE_BANKING_KEY_ROTATED', 'APP_ORIGIN'];
const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
const posix = typeof process.getuid === 'function';
let sequence = 0;

test.beforeEach(() => {
  for (const name of names) delete process.env[name];
  Object.assign(process.env, {
    ENABLE_BANKING_APPLICATION_ID: '11111111-1111-4111-8111-111111111111',
    ENABLE_BANKING_ENVIRONMENT: 'PRODUCTION', ENABLE_BANKING_KEY_ROTATED: 'true',
    APP_ORIGIN: 'https://synthetic.example.test',
  });
});
test.after(() => {
  for (const name of names) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  rmSync(directory, { recursive: true, force: true });
});

function keyFile(contents = pem, mode = 0o600) {
  const path = join(directory, 'synthetic-' + (++sequence) + '.pem');
  writeFileSync(path, contents, { mode });
  chmodSync(path, mode);
  process.env.ENABLE_BANKING_PRIVATE_KEY_FILE = path;
  return path;
}
function denied() {
  const status = configStatus();
  assert.equal(status.configured, false, 'Unsafe key material must never become a configured signing identity');
  assert.equal(status.code, 'invalid_private_key');
  assert.throws(jwt, error => error.code === 'invalid_private_key');
  assert.doesNotMatch(JSON.stringify(status), /PRIVATE KEY|synthetic-\d+\.pem|mg-private-key-acceptance-/);
}

test('a verified private regular file signs and reports only non-secret readiness', () => {
  const path = keyFile();
  if (!posix) { denied(); return; }
  assert.equal(configStatus().configured, true);
  assert.equal(jwt().split('.').length, 3);
  assert.match(consentApplicationFingerprint(), /^[a-f0-9]{64}$/);
  assert.equal(readFileSync(path, 'utf8'), pem, 'Readiness/signing must not mutate key files');
  assert.doesNotMatch(JSON.stringify(configStatus()), /PRIVATE KEY|synthetic-\d+\.pem/);
});

for (const mode of [0o644, 0o640, 0o620, 0o604, 0o666]) {
  test('a key shared with another OS principal (' + mode.toString(8) + ') is rejected', () => {
    keyFile(pem, mode);
    denied();
  });
}

test('a key selected through a symbolic link is rejected', () => {
  const path = keyFile(), link = join(directory, 'linked-' + (++sequence) + '.pem');
  symlinkSync(path, link);
  process.env.ENABLE_BANKING_PRIVATE_KEY_FILE = link;
  denied();
});

test('a symbolic-link parent cannot hide the key-file location', () => {
  const parent = join(directory, 'parent-' + (++sequence)), link = parent + '-alias';
  mkdirSync(parent, { mode: 0o700 });
  writeFileSync(join(parent, 'synthetic.pem'), pem, { mode: 0o600 });
  symlinkSync(parent, link, 'dir');
  process.env.ENABLE_BANKING_PRIVATE_KEY_FILE = join(link, 'synthetic.pem');
  denied();
});

test('oversized PEM data is rejected even when its initial private key is valid', () => {
  keyFile(pem + '\n' + ' '.repeat(128 * 1024));
  denied();
});

test('invalid UTF-8 cannot be discarded after an otherwise valid PEM', () => {
  keyFile(Buffer.concat([Buffer.from(pem), Buffer.from([0xff])]));
  denied();
});

test('a directory is not a private-key file', () => {
  process.env.ENABLE_BANKING_PRIVATE_KEY_FILE = directory;
  denied();
});

test('changing permissions during the descriptor read invalidates the key', t => {
  const path = keyFile();
  if (!posix) { denied(); return; }
  const originalRead = fs.readSync;
  let changed = false;
  t.mock.method(fs, 'readSync', (...args) => {
    const count = originalRead(...args);
    if (!changed) { changed = true; chmodSync(path, 0o644); }
    return count;
  });
  syncBuiltinESMExports();
  try { denied(); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test('a replacement key changes the consent generation and leaves the old file unchanged', () => {
  const old = keyFile();
  if (!posix) { denied(); return; }
  const before = consentApplicationFingerprint();
  const replacement = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  keyFile(replacement);
  assert.notEqual(consentApplicationFingerprint(), before);
  assert.equal(readFileSync(old, 'utf8'), pem);
});

test('protected runtime PEM remains available without any file-based ACL claim', () => {
  process.env.ENABLE_BANKING_PRIVATE_KEY = pem;
  assert.equal(configStatus().configured, true);
  assert.equal(jwt().split('.').length, 3);
});
