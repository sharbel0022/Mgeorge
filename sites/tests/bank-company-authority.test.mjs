import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCorporateAccountEvidence } from '../lib/bank-company-authority.js';

// This fixture represents a trusted server provisioner plus accounts already
// authorized by the provider. It does not assert that the registry, an ORGA
// account, or an actor identifier independently proves company membership.
const at = '2026-11-04T12:00:00.000Z';
const now = Date.parse(at);
const checkedAt = '2026-11-03T12:00:00.000Z';
const evidenceExpiry = '2026-12-04T12:00:00.000Z';
const sessionExpiry = '2026-11-20T12:00:00.000Z';
const firstUid = '11111111-1111-4111-8111-111111111111';
const secondUid = '22222222-2222-4222-8222-222222222222';
const firstKey = `enable-account:${'a'.repeat(64)}`;
const secondKey = `enable-account:${'b'.repeat(64)}`;

function fixture() {
  const binding = {
    companyId: 'synthetic-company-a',
    storageOwnerId: 'synthetic-storage-owner-a',
    provider: 'enablebanking',
    bankName: 'Synthetic Bank',
    country: 'SE',
    status: 'active',
    origin: 'bank',
    evidenceId: 'synthetic-bank-evidence-a',
    checkedAt,
    validUntil: evidenceExpiry,
    accountKeys: [firstKey],
  };
  const registry = { version: 1, bindings: [binding] };
  const input = {
    context: {
      companyId: binding.companyId,
      storageOwnerId: binding.storageOwnerId,
      actorId: 'synthetic-authorized-actor-a',
    },
    bankName: binding.bankName,
    country: binding.country,
    accounts: [{ uid: firstUid, key: firstKey, usage: 'ORGA' }],
    validUntil: sessionExpiry,
    now,
  };
  return {
    binding, registry, input,
    resolve: () => resolveCorporateAccountEvidence(JSON.stringify(registry), input),
  };
}

function expected(f) {
  return {
    status: 'verified',
    origin: f.binding.origin,
    evidenceId: f.binding.evidenceId,
    companyId: f.input.context.companyId,
    actorId: f.input.context.actorId,
    bankName: f.input.bankName,
    country: f.input.country,
    accountUids: [firstUid],
    checkedAt,
    validUntil: sessionExpiry,
  };
}

test('a current exact server binding produces bounded evidence for the authorized account', () => {
  const f = fixture();
  const before = structuredClone({ registry: f.registry, input: f.input });
  assert.deepEqual(f.resolve(), expected(f));
  assert.deepEqual({ registry: f.registry, input: f.input }, before);
});

test('provider-origin evidence retains its recorded origin without claiming bank origin', () => {
  const f = fixture();
  f.binding.origin = 'provider';
  assert.deepEqual(f.resolve(), expected(f));
});

test('only the intersection of mapped keys and currently authorized accounts is returned', () => {
  const f = fixture();
  f.binding.accountKeys.push(`enable-account:${'c'.repeat(64)}`);
  f.input.accounts.push({ uid: secondUid, key: secondKey, usage: 'ORGA' });
  assert.deepEqual(f.resolve().accountUids, [firstUid]);
});

test('all matched authorized accounts are retained in provider order', () => {
  const f = fixture();
  f.binding.accountKeys.push(secondKey);
  f.input.accounts.unshift({ uid: secondUid, key: secondKey, usage: 'ORGA' });
  assert.deepEqual(f.resolve().accountUids, [secondUid, firstUid]);
});

test('missing account usage can rely on the explicit server mapping, while private usage cannot', () => {
  const f = fixture();
  delete f.input.accounts[0].usage;
  assert.deepEqual(f.resolve().accountUids, [firstUid]);
  f.input.accounts[0].usage = 'PRIV';
  assert.equal(f.resolve(), undefined);
});

test('a private account is never included alongside a permitted company account', () => {
  const f = fixture();
  f.binding.accountKeys.push(secondKey);
  f.input.accounts.push({ uid: secondUid, key: secondKey, usage: 'PRIV' });
  assert.deepEqual(f.resolve().accountUids, [firstUid]);
});

test('membership remains a caller prerequisite and the returned actor comes from server context', () => {
  const f = fixture();
  f.binding.actorId = 'synthetic-unrelated-registry-actor';
  f.input.actorId = 'synthetic-forged-extra-actor';
  assert.equal(f.resolve().actorId, f.input.context.actorId);
  assert.equal('membershipVerified' in f.resolve(), false);
});

for (const [field, value] of [
  ['companyId', 'synthetic-company-b'],
  ['storageOwnerId', 'synthetic-storage-owner-b'],
  ['provider', 'openpayments'],
  ['bankName', 'Different Synthetic Bank'],
  ['country', 'NO'],
]) test(`a binding for a different ${field} grants no account`, () => {
  const f = fixture();
  f.binding[field] = value;
  assert.equal(f.resolve(), undefined);
});

test('bank, country and account keys use exact matching without normalization or prefix matching', () => {
  for (const [scope, field, value] of [
    ['binding', 'bankName', 'synthetic bank'],
    ['binding', 'country', 'se'],
    ['account', 'key', firstKey.toUpperCase()],
    ['account', 'key', `${firstKey}-suffix`],
    ['account', 'key', ` ${firstKey}`],
    ['account', 'key', secondKey],
  ]) {
    const f = fixture();
    (scope === 'binding' ? f.binding : f.input.accounts[0])[field] = value;
    assert.equal(f.resolve(), undefined, `${scope}.${field}: ${value}`);
  }
});

test('unrelated registry entries do not authorize or suppress the single exact binding', () => {
  const f = fixture();
  f.registry.bindings.unshift({ ...f.binding, companyId: 'synthetic-company-b' });
  f.registry.bindings.push({ ...f.binding, bankName: 'Different Synthetic Bank' });
  assert.deepEqual(f.resolve(), expected(f));
});

for (const status of ['active', 'revoked']) test(`duplicate matching bindings fail closed even if the second is ${status}`, () => {
  const f = fixture();
  f.registry.bindings.push({ ...f.binding, status, evidenceId: 'synthetic-bank-evidence-b' });
  assert.equal(f.resolve(), undefined);
});

test('evidence is capped by the earlier authority and provider consent expiration', () => {
  const f = fixture();
  assert.equal(f.resolve().validUntil, sessionExpiry);
  f.binding.validUntil = '2026-11-10T12:00:00.000Z';
  assert.equal(f.resolve().validUntil, f.binding.validUntil);
  f.input.validUntil = f.binding.validUntil;
  assert.equal(f.resolve().validUntil, f.input.validUntil);
});

test('current validity is evaluated on every call, including the exact expiry boundary', () => {
  const f = fixture();
  f.input.now = Date.parse(sessionExpiry) - 1;
  assert.equal(f.resolve().status, 'verified');
  f.input.now++;
  assert.equal(f.resolve(), undefined);
});

test('the server clock is used when no explicit test clock is supplied', t => {
  const f = fixture();
  delete f.input.now;
  t.mock.method(Date, 'now', () => now);
  assert.equal(f.resolve().status, 'verified');
});

test('checking at the current instant is permitted but checking in the future is rejected', () => {
  const f = fixture();
  f.binding.checkedAt = at;
  assert.equal(f.resolve().checkedAt, at);
  f.binding.checkedAt = new Date(now + 1).toISOString();
  assert.equal(f.resolve(), undefined);
});

for (const [label, change] of [
  ['revoked authority', f => { f.binding.status = 'revoked'; }],
  ['disabled authority', f => { f.binding.status = 'disabled'; }],
  ['unverified authority', f => { f.binding.status = 'unverified'; }],
  ['expired authority', f => { f.binding.validUntil = checkedAt; }],
  ['authority expiring now', f => { f.binding.validUntil = at; }],
  ['expired provider consent', f => { f.input.validUntil = checkedAt; }],
  ['provider consent expiring now', f => { f.input.validUntil = at; }],
  ['missing authority expiry', f => { delete f.binding.validUntil; }],
  ['missing provider expiry', f => { delete f.input.validUntil; }],
  ['unknown check time', f => { f.binding.checkedAt = 'not-a-date'; }],
]) test(`${label} cannot produce verified evidence`, () => {
  const f = fixture();
  change(f);
  assert.equal(f.resolve(), undefined);
});

test('invalid numeric or coerced clocks cannot extend an authorization', () => {
  for (const clock of [NaN, Infinity, -Infinity, at, null]) {
    const f = fixture();
    f.input.now = clock;
    assert.equal(f.resolve(), undefined, String(clock));
  }
});

for (const [label, field, value] of [
  ['numeric check time', 'checkedAt', 2026],
  ['array check time', 'checkedAt', ['2026-11-03T12:00:00.000Z']],
  ['date-only check time', 'checkedAt', '2026-11-03'],
  ['impossible check date', 'checkedAt', '2026-02-30T12:00:00.000Z'],
  ['numeric authority expiry', 'validUntil', 2099],
  ['array authority expiry', 'validUntil', ['2099-01-01T00:00:00.000Z']],
  ['date-only authority expiry', 'validUntil', '2099-01-01'],
  ['impossible authority expiry', 'validUntil', '2027-02-30T12:00:00.000Z'],
]) test(`${label} is malformed evidence, not a valid timestamp`, () => {
  const f = fixture();
  f.binding[field] = value;
  assert.equal(f.resolve(), undefined);
});

test('timestamp-looking objects and arrays cannot supply a provider consent expiration', () => {
  for (const value of [2099, ['2099-01-01T00:00:00.000Z'], new Date(evidenceExpiry)]) {
    const f = fixture();
    f.input.validUntil = value;
    assert.equal(f.resolve(), undefined, String(value));
  }
});

test('missing, malformed and wrong-version server configuration fails closed', () => {
  const f = fixture();
  for (const configuration of [
    undefined, null, '', ' ', '{', 'null', '[]', '{}',
    JSON.stringify({ version: '1', bindings: [f.binding] }),
    JSON.stringify({ version: 2, bindings: [f.binding] }),
    JSON.stringify({ version: 1, bindings: {} }),
    JSON.stringify({ version: 1, bindings: [] }),
  ]) assert.equal(resolveCorporateAccountEvidence(configuration, f.input), undefined);
});

test('a caller-supplied object cannot substitute for serialized trusted server configuration', () => {
  const f = fixture();
  let serializationCalls = 0;
  const forged = { ...f.registry, toJSON() { serializationCalls++; return f.registry; } };
  assert.equal(resolveCorporateAccountEvidence(forged, f.input), undefined);
  assert.equal(serializationCalls, 0);
});

test('oversized registries and oversized account lists fail closed', () => {
  const f = fixture();
  assert.equal(resolveCorporateAccountEvidence(`${JSON.stringify(f.registry)}${' '.repeat(262144)}`, f.input), undefined);
  f.registry.bindings.push(...Array.from({ length: 100 }, (_, i) => ({ ...f.binding, companyId: `synthetic-other-${i}` })));
  assert.equal(f.resolve(), undefined);
  const other = fixture();
  other.input.accounts = Array.from({ length: 101 }, (_, i) => ({ uid: `synthetic-account-${i}`, key: firstKey, usage: 'ORGA' }));
  assert.equal(other.resolve(), undefined);
});

test('unsupported origins and missing or unsafe evidence identifiers fail closed', () => {
  for (const origin of ['manual', 'browser', 'BankID', 'BANK', '', null]) {
    const f = fixture();
    f.binding.origin = origin;
    assert.equal(f.resolve(), undefined, `origin: ${origin}`);
  }
  for (const evidenceId of ['', null, 17, 'x'.repeat(301), 'synthetic\nidentity', 'synthetic\u007fidentity']) {
    const f = fixture();
    f.binding.evidenceId = evidenceId;
    assert.equal(f.resolve(), undefined, `evidenceId: ${String(evidenceId)}`);
  }
});

test('malformed, wildcard and duplicate mapped keys never become account authority', () => {
  for (const accountKeys of [undefined, null, {}, [], ['*'], [firstKey, '*'], [firstKey, firstKey], [''], [17], ['key\n'], ['x'.repeat(301)], Array.from({ length: 101 }, (_, i) => `synthetic-key-${i}`)]) {
    const f = fixture();
    f.binding.accountKeys = accountKeys;
    assert.equal(f.resolve(), undefined);
  }
});

test('a mapped key does not authorize a different key or invent a missing account UID', () => {
  const f = fixture();
  f.input.accounts[0].key = secondKey;
  assert.equal(f.resolve(), undefined);
  f.input.accounts = [{ uid: secondUid, key: secondKey, usage: 'ORGA' }];
  assert.equal(f.resolve(), undefined);
  f.input.accounts = [{ key: firstKey, usage: 'ORGA' }];
  assert.equal(f.resolve(), undefined);
});

test('duplicate authorized UIDs cannot produce verified account evidence', () => {
  const f = fixture();
  f.binding.accountKeys.push(secondKey);
  f.input.accounts.push({ uid: firstUid, key: secondKey, usage: 'ORGA' });
  assert.equal(f.resolve(), undefined);
});

for (const [label, other] of [
  ['an unmapped account', { uid: firstUid, key: secondKey, usage: 'ORGA' }],
  ['a private account', { uid: firstUid, key: firstKey, usage: 'PRIV' }],
  ['a record without a key', { uid: firstUid, usage: 'ORGA' }],
]) test(`a UID conflicting with ${label} cannot be rescued by filtering`, () => {
  const f = fixture();
  f.input.accounts.push(other);
  assert.equal(f.resolve(), undefined);
});

test('a missing or malformed provider account list remains unverified without throwing', () => {
  for (const accounts of [undefined, null, {}, [], [null], [undefined]]) {
    const f = fixture();
    f.input.accounts = accounts;
    assert.equal(f.resolve(), undefined);
  }
});

test('missing binding dimensions never match missing context dimensions', () => {
  for (const field of ['companyId', 'storageOwnerId']) {
    const f = fixture();
    delete f.binding[field];
    delete f.input.context[field];
    assert.equal(f.resolve(), undefined, field);
  }
  for (const field of ['bankName', 'country']) {
    const f = fixture();
    delete f.binding[field];
    delete f.input[field];
    assert.equal(f.resolve(), undefined, field);
  }
});

test('forged caller evidence and corporate labels cannot replace the trusted registry', () => {
  const f = fixture();
  Object.assign(f.input, {
    status: 'verified', origin: 'bank', evidenceId: 'synthetic-forged-evidence',
    corporateAuthorization: { status: 'verified', accountUids: [firstUid, secondUid] },
    psu_type: 'business',
  });
  f.input.accounts[0].corporateAuthorization = 'verified';
  assert.equal(resolveCorporateAccountEvidence(undefined, f.input), undefined);
  assert.equal(resolveCorporateAccountEvidence('{"version":1,"bindings":[]}', f.input), undefined);
  assert.deepEqual(f.resolve(), expected(f));
});

test('changing caller objects after resolution cannot rewrite previously returned evidence', () => {
  const f = fixture();
  const result = f.resolve();
  const before = structuredClone(result);
  f.input.accounts[0].uid = secondUid;
  f.input.accounts[0].key = secondKey;
  f.input.accounts.push({ uid: 'synthetic-extra-uid', key: firstKey });
  f.input.context.actorId = 'synthetic-different-actor';
  f.input.context.companyId = 'synthetic-different-company';
  f.binding.accountKeys.push(secondKey);
  assert.deepEqual(result, before);
  assert.equal(f.resolve(), undefined);
});

test('mutating a returned projection cannot poison future resolutions or the source accounts', () => {
  const f = fixture();
  const result = f.resolve();
  result.accountUids.push(secondUid);
  result.companyId = 'synthetic-forged-company';
  result.origin = 'browser';
  assert.deepEqual(f.resolve(), expected(f));
  assert.deepEqual(f.input.accounts.map(account => account.uid), [firstUid]);
});

test('removing or revoking a once-valid registry cannot reuse an earlier successful result', () => {
  const f = fixture();
  assert.equal(f.resolve().status, 'verified');
  f.binding.status = 'revoked';
  assert.equal(f.resolve(), undefined);
  f.registry.bindings.length = 0;
  assert.equal(f.resolve(), undefined);
});
