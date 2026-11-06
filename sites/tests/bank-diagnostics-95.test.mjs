import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../lib/bank-consent-policy.js';

const at = Date.parse('2026-11-05T12:00:00.000Z');
const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
function consent() {
  const context = { aspsp: { name: 'Synthetic bank', country: 'SE' }, psu_type: 'business',
    access: { valid_until: '2026-11-06T12:00:00.000Z', transactions: true } };
  return { bankName: 'Synthetic bank', country: 'SE', now: at,
    requestedValidUntil: context.access.valid_until,
    session: { ...structuredClone(context), accounts: [{ uid: first, usage: 'ORGA', identification_hash: 'synthetic-private-identity' }] },
    checked: { ...structuredClone(context), status: 'AUTHORIZED', accounts: [first],
      accounts_data: [{ uid: first, usage: 'ORGA', identification_hash: 'synthetic-private-identity' }] },
    selectedAccountUids: [first] };
}
function failure(input, legacy = false) {
  try { (legacy ? policy.validateLegacyEnableSelection : policy.validateEnableConsent)(input); }
  catch (error) { assert.ok(error instanceof policy.ConsentError); return error; }
  assert.fail('The invalid grant must stay rejected');
}

for (const [label, reason, mutate, legacy] of [
  ['saved account shape', 'SAVED_ACCOUNT_DATA_INVALID', v => { v.session.accounts = []; }],
  ['current account shape', 'CURRENT_ACCOUNT_DATA_INVALID', v => { v.checked.accounts_data = []; }],
  ['saved private account', 'SAVED_ACCOUNT_USAGE_INVALID', v => { v.session.accounts[0].usage = 'PRIV'; }],
  ['current private account', 'CURRENT_ACCOUNT_USAGE_INVALID', v => { v.checked.accounts_data[0].usage = 'PRIV'; }],
  ['duplicate saved account', 'SAVED_ACCOUNT_IDS_INVALID', v => { v.session.accounts.push({ ...v.session.accounts[0] }); }],
  ['duplicate live account', 'CURRENT_ACCOUNT_IDS_INVALID', v => { v.checked.accounts.push(first); }],
  ['missing live UID', 'CURRENT_ACCOUNT_DETAILS_INVALID', v => { delete v.checked.accounts_data[0].uid; }],
  ['inconsistent live inventory', 'CURRENT_ACCOUNT_INVENTORY_MISMATCH', v => { v.checked.accounts = [second]; }],
  ['changed full grant', 'CONSENT_ACCOUNT_INVENTORY_CHANGED', v => { v.checked.accounts = [second]; v.checked.accounts_data[0].uid = second; }],
  ['changed singular account identity', 'ACCOUNT_IDENTITY_CHANGED', v => { v.checked.accounts_data[0].identification_hash = 'synthetic-other-private-identity'; }],
  ['missing selected account', 'SELECTED_ACCOUNT_UNAVAILABLE', v => { v.selectedAccountUids = [second]; }, true],
  ['duplicate selection', 'SELECTED_ACCOUNT_IDS_INVALID', v => { v.selectedAccountUids.push(first); }, true],
]) test('safe consent diagnosis distinguishes ' + label + ' without retaining account values', () => {
  const value = consent(); mutate(value);
  const error = failure(value, legacy);
  const diagnostic = policy.consentDiagnostic?.(error);
  assert.equal(diagnostic?.code, 'BANK_ACCOUNT_SCOPE_INVALID');
  assert.equal(diagnostic?.reason, reason);
  assert.equal(diagnostic?.message, 'Bankens godkända konton kunde inte verifieras.');
  assert.doesNotMatch(JSON.stringify(diagnostic), /11111111|22222222|synthetic-private|synthetic-other/);
});

test('diagnostic does not trust custom messages, mutable fields, forged prototypes or getters', () => {
  const error = failure({ ...consent(), checked: { ...consent().checked, accounts: [second] } });
  error.message = 'SYNTHETIC_PRIVATE_TOKEN';
  error.reason = 'SYNTHETIC_PRIVATE_ACCOUNT';
  Object.defineProperty(error, 'code', { get() { throw new Error('SYNTHETIC_PRIVATE_GETTER'); } });
  const diagnostic = policy.consentDiagnostic?.(error);
  assert.equal(diagnostic?.code, 'BANK_ACCOUNT_SCOPE_INVALID');
  assert.equal(diagnostic?.reason, 'CURRENT_ACCOUNT_INVENTORY_MISMATCH');
  assert.doesNotMatch(JSON.stringify(diagnostic), /SYNTHETIC_PRIVATE/);
  for (const forged of [{ code: 'BANK_ACCOUNT_SCOPE_INVALID' }, Object.create(policy.ConsentError.prototype),
    new policy.ConsentError('SYNTHETIC_PRIVATE_TOKEN', 409, 'SYNTHETIC_PRIVATE_MESSAGE')]) {
    assert.equal(policy.consentDiagnostic?.(forged), null);
  }
});

test('diagnostics preserve valid strict and legacy selections without inventing evidence', () => {
  const input = consent(), before = structuredClone(input);
  assert.deepEqual(policy.validateEnableConsent(input).accountUids, [first]);
  input.session.accounts.push({ uid: second, usage: 'PRIV' });
  assert.deepEqual(policy.validateLegacyEnableSelection(input).accountUids, [first]);
  assert.deepEqual(input.checked, before.checked);
  assert.equal(policy.consentDiagnostic?.(new Error('SYNTHETIC_PRIVATE_TOKEN')), null);
});

test('persisted diagnostic reconstruction allows fixed code/reason pairs only', () => {
  assert.deepEqual(policy.storedConsentDiagnostic?.('BANK_ACCOUNT_SCOPE_INVALID', 'SELECTED_ACCOUNT_UNAVAILABLE'), {
    code: 'BANK_ACCOUNT_SCOPE_INVALID', message: 'Bankens godkända konton kunde inte verifieras.', reason: 'SELECTED_ACCOUNT_UNAVAILABLE',
  });
  for (const [code, reason] of [['BANK_ACCOUNT_SCOPE_INVALID', 'SYNTHETIC_PRIVATE_ACCOUNT'],
    ['BANK_CONSENT_EXPIRED', 'SELECTED_ACCOUNT_UNAVAILABLE'], ['__proto__', null], ['SYNTHETIC_PRIVATE_TOKEN', null]]) {
    assert.equal(policy.storedConsentDiagnostic?.(code, reason), null);
  }
});

test('canonical diagnostics preserve existing lifecycle codes and HTTP status without custom text', () => {
  for (const code of ['CONSENT_RENEWAL_CONFLICT', 'BANK_DISCONNECT_PENDING', 'SAAS_BANK_CONFIGURATION_INVALID',
    'SAAS_BANK_DISABLED', 'BANK_BUSY', 'BANK_STATE_CHANGED', 'RESOURCE_SCOPE_MISMATCH',
    'BANK_AUTHENTICATION_METHOD_REQUIRED', 'IDEMPOTENCY_KEY_REQUIRED', 'IDEMPOTENCY_KEY_REUSED', 'BANK_RATE_POLICY_REQUIRED']) {
    const diagnostic = policy.consentDiagnostic?.(new policy.ConsentError(code, 409, 'SYNTHETIC_PRIVATE_MESSAGE'));
    assert.equal(diagnostic?.code, code);
    assert.equal(diagnostic?.status, 409);
    assert.doesNotMatch(diagnostic?.message ?? '', /SYNTHETIC_PRIVATE/);
  }
});

const storedConnection = () => ({ present: true, status: 'connected', validUntil: '2026-11-06T12:00:00.000Z',
  applicationReady: true, generationMatches: true, storageReady: true, companyRequired: false,
  companyAuthorized: false, selectedAccountUids: [first] });
for (const [label, patch, expectedStatus, expectedCode, expectedAction] of [
  ['no connection', { present: false }, 'disconnected', 'BANK_CONNECTION_REQUIRED', 'connect'],
  ['disabled application', { applicationReady: false }, 'configuration_required', 'BANK_CONFIGURATION_REQUIRED', 'configure_service'],
  ['unreadable encryption', { storageReady: false }, 'configuration_required', 'BANK_STORAGE_UNAVAILABLE', 'configure_service'],
  ['changed credentials', { generationMatches: false }, 'reauth_required', 'CONSENT_APPLICATION_CHANGED', 'reconnect'],
  ['recorded reauthorization', { status: 'reauth_required' }, 'reauth_required', 'BANK_RECONNECT_REQUIRED', 'reconnect'],
  ['expired consent', { validUntil: '2026-11-05T12:00:00.000Z' }, 'expired', 'BANK_CONSENT_EXPIRED', 'reconnect'],
  ['invalid stored expiry', { validUntil: 'not-a-date' }, 'expired', 'BANK_CONSENT_EXPIRED', 'reconnect'],
  ['missing corporate evidence', { companyRequired: true }, 'corporate_authorization_required', 'CORPORATE_AUTHORIZATION_REQUIRED', 'verify_company_authority'],
  ['no selected account', { selectedAccountUids: [] }, 'pending_account', 'BANK_ACCOUNT_SELECTION_REQUIRED', 'select_accounts'],
  ['duplicate selected account', { selectedAccountUids: [first, first] }, 'pending_account', 'BANK_ACCOUNT_SELECTION_REQUIRED', 'select_accounts'],
  ['pending remote revocation', { status: 'revocation_pending' }, 'revocation_pending', 'BANK_DISCONNECT_PENDING', 'complete_revocation'],
]) test('stored consent status cannot advertise sync for ' + label, () => {
  const result = policy.storedEnableConnectionHealth?.({ ...storedConnection(), ...patch }, at);
  assert.equal(result?.status, expectedStatus);
  assert.equal(result?.blockedReason, expectedCode);
  assert.equal(result?.nextAction, expectedAction);
  assert.equal(result?.connected, false);
  assert.equal(result?.syncAllowed, false);
  assert.equal(result?.evidence, 'stored_connection');
});

test('local connected status is explicit stored evidence and never repairs the original row', () => {
  const input = storedConnection(), before = structuredClone(input);
  const result = policy.storedEnableConnectionHealth?.(input, at);
  assert.deepEqual(result, { status: 'connected', connected: true, syncAllowed: true,
    requiresReauthentication: false, blockedReason: null, nextAction: 'none', evidence: 'stored_connection' });
  assert.deepEqual(input, before);
  assert.equal(policy.storedEnableConnectionHealth?.({ ...input, companyRequired: true, companyAuthorized: true }, at)?.connected, true);
});
