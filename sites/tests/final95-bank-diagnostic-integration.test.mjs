import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bankAccountScopeError, bankAccountScopeReason, bankAccountUsageDiagnostic,
  consentDiagnostic, planAccountUsageDetailsRead, storedConsentDiagnostic,
  validateLegacyEnableSelection,
} from '../lib/bank-consent-policy.js';

const selected = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const now = Date.parse('2026-11-06T12:00:00.000Z');
const until = '2026-11-07T12:00:00.000Z';
function input() {
  const common = { aspsp: { name: 'Synthetic Bank', country: 'SE' }, psu_type: 'business', access: { valid_until: until } };
  return {
    session: { ...structuredClone(common), accounts: [{ uid: selected, usage: null, identification_hash: 'synthetic-stable-identity' }] },
    checked: { ...structuredClone(common), status: 'AUTHORIZED', accounts: [selected],
      accounts_data: [{ uid: selected, identification_hash: 'synthetic-stable-identity' }] },
    bankName: 'Synthetic Bank', country: 'SE', requestedValidUntil: until,
    requestedScopes: ['accounts:read', 'transactions:read'], selectedAccountUids: [selected], now,
  };
}
function rejected(value) {
  let error;
  try { validateLegacyEnableSelection(value); } catch (caught) { error = caught; }
  assert.ok(error, 'the invalid retained account snapshot must remain denied');
  assert.equal(error.code, 'BANK_ACCOUNT_SCOPE_INVALID');
  assert.equal(error.status, 409);
  return error;
}

test('final95: retained null usage preserves the deployed denial and the precise stored diagnostic', () => {
  const value = input(), before = structuredClone(value), error = rejected(value);
  assert.equal(bankAccountScopeReason(error), 'ACCOUNT_USAGE_INVALID');
  assert.equal(consentDiagnostic(error).reason, 'SAVED_ACCOUNT_USAGE_INVALID');
  assert.equal(bankAccountUsageDiagnostic(error).saved.explicitNull, 1);
  assert.equal(planAccountUsageDetailsRead(error, value, now).status, 'ready');
  assert.deepEqual(value, before, 'diagnostic planning cannot repair the denied snapshot');
  assert.throws(() => validateLegacyEnableSelection(value), e => e.code === 'BANK_ACCOUNT_SCOPE_INVALID');
});

test('final95: hostile public error fields cannot change either private diagnostic or authorize a read', () => {
  const value = input(), error = rejected(value), diagnostic = consentDiagnostic(error);
  error.reason = 'SYNTHETIC_PRIVATE_ACCOUNT';
  error.message = 'SYNTHETIC_PRIVATE_TOKEN';
  Object.defineProperty(error, 'code', { get() { throw new Error('SYNTHETIC_PRIVATE_GETTER'); } });
  assert.equal(bankAccountScopeReason(error), 'ACCOUNT_USAGE_INVALID');
  assert.deepEqual(consentDiagnostic(error), diagnostic);
  assert.equal(bankAccountUsageDiagnostic(error).saved.explicitNull, 1);
  assert.deepEqual(planAccountUsageDetailsRead(error, value, now), { status: 'not_read', reason: 'INPUT_NOT_BOUND' });
  assert.doesNotMatch(JSON.stringify(diagnostic), /SYNTHETIC_PRIVATE/);
});

test('final95: a missing selected account retains both public and stored reasons without usage capability', () => {
  const value = input(); value.checked.accounts = [other]; value.checked.accounts_data = [{ uid: other }];
  const error = rejected(value);
  assert.equal(bankAccountScopeReason(error), 'SELECTED_ACCOUNT_MISSING');
  assert.equal(consentDiagnostic(error).reason, 'SELECTED_ACCOUNT_UNAVAILABLE');
  assert.equal(bankAccountUsageDiagnostic(error), null);
  assert.deepEqual(planAccountUsageDetailsRead(error, value, now), { status: 'not_read', reason: 'INPUT_NOT_BOUND' });
  assert.equal(storedConsentDiagnostic(consentDiagnostic(error).code, consentDiagnostic(error).reason).reason, 'SELECTED_ACCOUNT_UNAVAILABLE');
});

test('final95: a public scope-error constructor cannot mint selected account usage evidence', () => {
  const value = input(), error = bankAccountScopeError('ACCOUNT_USAGE_INVALID');
  error.reason = 'SYNTHETIC_PRIVATE_REASON';
  assert.equal(bankAccountScopeReason(error), 'ACCOUNT_USAGE_INVALID');
  assert.equal(consentDiagnostic(error).reason, null);
  assert.equal(bankAccountUsageDiagnostic(error), null);
  assert.deepEqual(planAccountUsageDetailsRead(error, value, now), { status: 'not_read', reason: 'INPUT_NOT_BOUND' });
});
