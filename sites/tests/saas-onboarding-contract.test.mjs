import test from 'node:test';
import assert from 'node:assert/strict';
import { directoryFixture, snapshotFixture, authorizationFixture, fixtureNow } from './helpers/saas-onboarding-fixture.mjs';
import { parseDirectory, parseSnapshot, parseAuthorization, activeConsent, freshSnapshot, selectedPermissions, callbackMessage } from '../lib/onboarding/contract.ts';
import { RequestScope } from '../lib/onboarding/request-scope.ts';

test('company directory rejects duplicate identities, unsupported roles and missing CSRF instead of inventing a company', () => {
  assert.equal(parseDirectory(directoryFixture()).companies[1].name, 'Exempel Beta AB');
  for (const change of [d => d.companies.push(d.companies[0]), d => d.companies[0].role = 'superuser', d => d.csrfToken = '', d => d.version = 2]) {
    const d = directoryFixture(); change(d); assert.throws(() => parseDirectory(d));
  }
  const empty = directoryFixture(); empty.companies = []; assert.deepEqual(parseDirectory(empty).companies, []);
});

test('every nested company-bound object is checked before any snapshot is accepted', () => {
  assert.equal(parseSnapshot(snapshotFixture(), 'company-alpha', fixtureNow).companyId, 'company-alpha');
  for (const change of [s => s.companyId = 'company-beta', s => s.connection.companyId = 'company-beta', s => s.accounts[0].companyId = 'company-beta', s => s.payments[0].companyId = 'company-beta', s => s.authorization = authorizationFixture('company-beta').authorization]) {
    const s = snapshotFixture(); change(s); assert.throws(() => parseSnapshot(s, 'company-alpha', fixtureNow));
  }
});

test('stale/future snapshots, invalid dates, duplicate accounts and numeric references fail closed', () => {
  for (const change of [s => s.checkedAt = new Date(fixtureNow - 300001).toISOString(), s => s.checkedAt = new Date(fixtureNow + 30001).toISOString(), s => s.sync.lastSuccessAt = 'tomorrow', s => s.accounts.push(s.accounts[0]), s => s.payments[0].reference.value = 599, s => s.payments[0].date = '2026-02-31', s => s.payments[0].amountMinor = 1.5]) {
    const s = snapshotFixture(); change(s); assert.throws(() => parseSnapshot(s, 'company-alpha', fixtureNow));
  }
  assert.equal(freshSnapshot(snapshotFixture(), fixtureNow + 300001), false);
});

test('observed leading-zero reference is preserved and verification needs an explicit evidence receipt', () => {
  const s = snapshotFixture();
  assert.equal(parseSnapshot(s, 'company-alpha', fixtureNow).payments[0].reference.value, '0000599');
  s.payments[0].verification.status = 'verified'; assert.throws(() => parseSnapshot(s, 'company-alpha', fixtureNow));
  s.payments[0].verification.evidenceId = 'verified-evidence-123';
  s.payments[0].verification.reason = null;
  assert.equal(parseSnapshot(s, 'company-alpha', fixtureNow).payments[0].verification.status, 'verified');
  s.payments[0].reference = null; s.payments[0].payerName = null;
  assert.equal(parseSnapshot(s, 'company-alpha', fixtureNow).payments[0].reference, null);
});

test('only current active consent supports success; callback query alone does not', () => {
  const s = snapshotFixture();
  assert.equal(activeConsent(s, fixtureNow), true);
  assert.equal(callbackMessage('connected', s, fixtureNow), null);
  s.authorization = { ...authorizationFixture().authorization, state: 'completed', redirectPath: null };
  assert.match(callbackMessage('connected', s, fixtureNow), /bekräftat/);
  s.connection.validUntil = new Date(fixtureNow).toISOString();
  assert.equal(activeConsent(s, fixtureNow), false); assert.equal(callbackMessage('connected', s, fixtureNow), null);
  for (const result of ['cancelled', 'failed', 'expired', 'wrong_user', 'signin_required']) assert.ok(callbackMessage(result, null, fixtureNow));
  assert.equal(callbackMessage('<script>', s, fixtureNow), null);
});

test('selection cannot request unsupported permission, omit required read access or select an unavailable bank', () => {
  const b = snapshotFixture().banks[0];
  assert.deepEqual(selectedPermissions(b, ['accounts:read', 'transactions:read']), ['accounts:read', 'transactions:read']);
  assert.throws(() => selectedPermissions(b, ['accounts:read']));
  assert.throws(() => selectedPermissions(b, ['accounts:read', 'transactions:read', 'payments:write']));
  assert.throws(() => selectedPermissions({ ...b, available: false }, b.requiredPermissions));
});

test('provider handoff is limited to the exact scoped server authorization redirect', () => {
  const good = authorizationFixture();
  assert.equal(parseAuthorization(good, 'company-alpha', fixtureNow).authorization.redirectPath, '/api/companies/company-alpha/bank/authorizations/authorization-123/redirect');
  for (const path of ['https://evil.example/', '//evil.example/', '/api/companies/company-beta/bank/authorizations/authorization-123/redirect', '/api/companies/company-alpha/bank/authorizations/other/redirect', '/api/companies/company-alpha/bank/authorizations/authorization-123/redirect?next=evil', 'javascript:alert(1)', '/api/companies/company-alpha/bank/authorizations/authorization-123/redirect#code']) {
    const bad = authorizationFixture(); bad.authorization.redirectPath = path;
    assert.throws(() => parseAuthorization(bad, 'company-alpha', fixtureNow));
  }
  const expired = authorizationFixture(); expired.authorization.expiresAt = new Date(fixtureNow).toISOString();
  assert.throws(() => parseAuthorization(expired, 'company-alpha', fixtureNow));
  const decoupled = authorizationFixture(); decoupled.authorization.mode = 'decoupled'; decoupled.authorization.redirectPath = null;
  assert.equal(parseAuthorization(decoupled, 'company-alpha', fixtureNow).authorization.mode, 'decoupled');
});

test('late A to B to A and late same-company requests cannot commit or redirect', () => {
  const scope = new RequestScope();
  const first = scope.begin('company-alpha');
  const second = scope.begin('company-beta');
  const third = scope.begin('company-alpha');
  assert.equal(scope.current(first), false); assert.equal(scope.current(second), false); assert.equal(scope.current(third), true);
  const fourth = scope.begin('company-alpha');
  assert.equal(scope.current(third), false); assert.equal(scope.current(fourth), true);
  scope.invalidate(); assert.equal(scope.current(fourth), false);
});

test('nested flags, catalog capabilities, financial fields and safe error codes are validated', () => {
  const changes = [
    s => s.actions.connect = 'yes', s => delete s.actions.sync,
    s => s.accounts[0].importable = 1, s => s.accounts[0].currency = 'sek',
    s => s.connection.status = 'connected', s => s.connection.permissions.push('payments:write'),
    s => s.connection.revocationStatus = 'done', s => s.connection.validUntil = '2026-02-31T12:00:00Z',
    s => s.banks[0].authorization = 'iframe', s => s.banks[0].bankgiro = 'supported',
    s => s.banks[0].maximumConsentSeconds = -1, s => s.banks[0].available = 'true',
    s => s.banks[0].unavailableReason = 'Arbitrary provider error',
    s => s.banks[0].requiredPermissions = ['bankgiro:read'],
    s => s.banks.push(s.banks[0]), s => s.sync.state = 'ok',
    s => s.sync.errorCode = '<script>provider failure</script>',
    s => s.sync.automaticEnabled = undefined, s => s.bankgiro.state = 'ok',
    s => s.bankgiro.lastSuccessAt = '2026-11-04T25:00:00Z',
    s => s.payments[0].currency = 'SEKK', s => s.payments[0].amountMinor = Number.MAX_SAFE_INTEGER + 1,
    s => s.payments[0].reference.kind = 'unknown', s => s.payments[0].reference.source = 'query',
    s => s.payments[0].verification.reason = 'Looks paid', s => s.payments[0].verification.status = 'paid',
    s => s.paymentsHasMore = 'false', s => s.payments.push(s.payments[0]),
    s => s.revision = -1, s => s.environment = 'live',
  ];
  for (const change of changes) { const s = snapshotFixture(); change(s); assert.throws(() => parseSnapshot(s, 'company-alpha', fixtureNow)); }
  const safe = snapshotFixture(); safe.sync.errorCode = 'provider_temporarily_unavailable';
  assert.equal(parseSnapshot(safe, 'company-alpha', fixtureNow).sync.errorCode, 'provider_temporarily_unavailable');
});

test('identity fields, company organization numbers, strings and collections are bounded', () => {
  for (const change of [d => d.companies[0].id = '../other', d => d.companies[0].id = 'a'.repeat(129), d => d.companies[0].name = ' ', d => d.companies[0].name = 'a'.repeat(201), d => d.companies[0].organizationNumber = 5599000001, d => d.companies[0].organizationNumber = '559900', d => d.canCreate = 1, d => d.csrfToken = 'x\nsecret', d => d.companies = Array.from({ length: 1001 }, (_, i) => ({ ...d.companies[0], id: `company-${i}` }))]) {
    const d = directoryFixture(); change(d); assert.throws(() => parseDirectory(d));
  }
});

test('manual import links are exactly scoped and selected accounts need a connection', () => {
  for (const path of ['/companies/company-beta/imports', '//evil.example', 'https://evil.example', '/companies/company-alpha/imports?next=evil', '/companies/company-alpha/imports#token', '/companies/company-alpha/imports/']) {
    const s = snapshotFixture(); s.manualImportPath = path; assert.throws(() => parseSnapshot(s, 'company-alpha', fixtureNow));
  }
  const s = snapshotFixture(); s.manualImportPath = '/companies/company-alpha/imports';
  assert.equal(parseSnapshot(s, 'company-alpha', fixtureNow).manualImportPath, s.manualImportPath);
  s.connection = null; assert.throws(() => parseSnapshot(s, 'company-alpha', fixtureNow));
  s.accounts[0].selected = false; assert.equal(parseSnapshot(s, 'company-alpha', fixtureNow).connection, null);
});

test('validated snapshots and directory are sanitized copies and preserve explicit unknowns', () => {
  const raw = snapshotFixture(); raw.bankgiro.state = 'unknown'; raw.providerSecret = 'must not survive';
  const parsed = parseSnapshot(raw, 'company-alpha', fixtureNow);
  assert.equal(parsed.bankgiro.state, 'unknown'); assert.equal('providerSecret' in parsed, false);
  raw.accounts[0].name = 'Changed'; raw.connection.permissions.length = 0;
  assert.equal(parsed.accounts[0].name, 'Företagskonto'); assert.equal(parsed.connection.permissions.length, 2);
  const directory = directoryFixture(), result = parseDirectory(directory); directory.companies[0].name = 'Changed';
  assert.equal(result.companies[0].name, 'Exempel Alfa AB');
});

test('authorization handoff rejects terminal states, long lifetimes and unscoped identity', () => {
  for (const change of [a => a.companyId = 'company-beta', a => a.authorization.id = '../redirect', a => a.authorization.companyId = 'company-beta', a => a.authorization.state = 'completed', a => a.authorization.mode = 'iframe', a => a.authorization.expiresAt = new Date(fixtureNow + 1200001).toISOString(), a => a.authorization.mode = 'decoupled']) {
    const a = authorizationFixture(); change(a); assert.throws(() => parseAuthorization(a, 'company-alpha', fixtureNow));
  }
  const s = snapshotFixture(); s.authorization = { ...authorizationFixture().authorization, expiresAt: new Date(fixtureNow - 1).toISOString() };
  assert.equal(parseSnapshot(s, 'company-alpha', fixtureNow).authorization.state, 'pending');
  s.authorization.state = 'completed'; assert.throws(() => parseSnapshot(s, 'company-alpha', fixtureNow));
  s.authorization.redirectPath = null; assert.equal(parseSnapshot(s, 'company-alpha', fixtureNow).authorization.state, 'completed');
});

test('snapshot pending authorization cannot assert an unbounded future lifetime', () => {
  const s = snapshotFixture(); s.authorization = authorizationFixture().authorization;
  s.authorization.expiresAt = new Date(fixtureNow + 1200001).toISOString();
  assert.throws(() => parseSnapshot(s, 'company-alpha', fixtureNow));
});

test('freshness bounds and consent expiration use exact server timestamps', () => {
  const s = snapshotFixture();
  assert.equal(freshSnapshot(s, fixtureNow + 300000), true);
  assert.equal(freshSnapshot(s, fixtureNow - 30000), true);
  assert.equal(freshSnapshot(s, fixtureNow - 30001), false);
  for (const status of ['pending', 'expired', 'revoked', 'error']) { s.connection.status = status; assert.equal(activeConsent(s, fixtureNow), false); }
  s.connection.status = 'active'; s.connection.validUntil = null; assert.equal(activeConsent(s, fixtureNow), false);
  s.connection = null; assert.equal(activeConsent(s, fixtureNow), false);
});

test('callback success requires current company-scoped completed authorization and fresh consent', () => {
  const s = snapshotFixture(); s.authorization = { ...authorizationFixture().authorization, state: 'completed', redirectPath: null };
  assert.equal(callbackMessage('connected', s, fixtureNow + 300001), null);
  s.authorization.companyId = 'company-beta'; assert.equal(callbackMessage('connected', s, fixtureNow), null);
  s.authorization.companyId = s.companyId; s.connection.companyId = 'company-beta'; assert.equal(callbackMessage('connected', s, fixtureNow), null);
});

test('superseded and invalidated tickets are aborted and ticket forgery cannot commit', () => {
  const scope = new RequestScope(), first = scope.begin('company-alpha');
  assert.equal(first.signal.aborted, false); assert.equal(scope.current({ ...first }), false);
  const second = scope.begin('company-beta'); assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false); scope.invalidate();
  assert.equal(second.signal.aborted, true); assert.equal(scope.current(second), false);
});

test('CSRF matches printable ASCII mutation contract and lists have documented bounds', () => {
  for (const token of ['short', 'å'.repeat(20), 'space token here 12345', 'x'.repeat(513)]) {
    const d = directoryFixture(); d.csrfToken = token; assert.throws(() => parseDirectory(d));
  }
  const directory = directoryFixture(); directory.companies = Array.from({ length: 101 }, (_, index) => ({ ...directory.companies[0], id: `company-${index}` }));
  assert.throws(() => parseDirectory(directory));
  for (const [key, count] of [['accounts', 101], ['payments', 101], ['banks', 201]]) {
    const s = snapshotFixture(); s[key] = Array.from({ length: count }, (_, index) => ({ ...s[key][0], id: `item-${index}` }));
    assert.throws(() => parseSnapshot(s, 'company-alpha', fixtureNow));
  }
});

test('unknown consent duration remains null and selections need an explicit read purpose', () => {
  const s = snapshotFixture(); s.banks[0].maximumConsentSeconds = null;
  const parsed = parseSnapshot(s, 'company-alpha', fixtureNow); assert.equal(parsed.banks[0].maximumConsentSeconds, null);
  assert.throws(() => selectedPermissions({ ...parsed.banks[0], requiredPermissions: [] }, []));
  const bankgiro = { ...parsed.banks[0], supportedPermissions: ['bankgiro:read'], requiredPermissions: ['bankgiro:read'] };
  assert.deepEqual(selectedPermissions(bankgiro, ['bankgiro:read']), ['bankgiro:read']);
});

test('future success claims and aged active-consent claims are rejected', () => {
  for (const key of ['sync', 'bankgiro']) { const s = snapshotFixture(); s[key].lastSuccessAt = new Date(fixtureNow + 30001).toISOString(); assert.throws(() => parseSnapshot(s, 'company-alpha', fixtureNow)); }
  assert.equal(activeConsent(snapshotFixture(), fixtureNow + 300001), false);
});
