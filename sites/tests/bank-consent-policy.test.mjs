import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ConsentError, legacyCompanyContext, assertCompanyBankAccess,
  validateCallbackParameters, validateReadScopes, validateEnableConsent,
  corporateAuthorization,
} from '../lib/bank-consent-policy.js';

const now = Date.parse('2026-11-04T12:00:00.000Z');
const later = minutes => new Date(now + minutes * 60_000).toISOString();
const state = 'a'.repeat(43);
const callback = entries => new URLSearchParams({ state, ...entries });
const fails = (fn, code) => assert.throws(fn, error => error instanceof ConsentError && (!code || error.code === code));
function grant() {
  return {
    bankName: 'Synthetic Bank', country: 'SE', requestedValidUntil: later(60), now,
    session: { aspsp: { name: 'Synthetic Bank', country: 'SE' }, psu_type: 'business',
      accounts: [{ uid: 'synthetic-account-a', usage: 'ORGA' }], access: { valid_until: later(90), transactions: true } },
    checked: { status: 'AUTHORIZED', aspsp: { name: 'Synthetic Bank', country: 'SE' }, psu_type: 'business',
      accounts: ['synthetic-account-a'], accounts_data: [{ uid: 'synthetic-account-a' }], access: { valid_until: later(120), transactions: true } },
  };
}
function authority() {
  return { companyId: 'workspace:synthetic-actor', actorId: 'synthetic-actor', bankName: 'Synthetic Bank',
    country: 'SE', accountUids: ['synthetic-account-a'], validUntil: later(60), now };
}
function evidence(input = authority()) {
  return { status: 'verified', origin: 'bank', evidenceId: 'synthetic-bank-attestation',
    companyId: input.companyId, actorId: input.actorId, bankName: input.bankName, country: input.country,
    accountUids: [...input.accountUids], checkedAt: later(-1), validUntil: later(30) };
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test('legacy owner context cannot accept another company or a client object', () => {
  const context = legacyCompanyContext('synthetic-actor');
  assert.deepEqual(context, { companyId: 'workspace:synthetic-actor', actorId: 'synthetic-actor',
    storageOwnerId: 'synthetic-actor', membershipVersion: 'legacy-owner-v1', role: 'owner', active: true });
  assert.deepEqual(legacyCompanyContext('synthetic-actor', context.companyId), context);
  for (const companyId of ['workspace:other', '', null, { owner: 'synthetic-actor' }]) {
    fails(() => legacyCompanyContext('synthetic-actor', companyId), 'COMPANY_ACCESS_DENIED');
  }
  fails(() => legacyCompanyContext('actor\nspoof'), 'COMPANY_ACCESS_DENIED');
});

test('server context binds active membership, actor, company and manage role', () => {
  const context = legacyCompanyContext('synthetic-actor');
  const request = { actorId: context.actorId, companyId: context.companyId, action: 'manage' };
  assert.equal(assertCompanyBankAccess(context, request), context);
  for (const change of [{ actorId: 'other' }, { companyId: 'workspace:other' }, { active: false },
    { role: 'member' }, { membershipVersion: '' }, { storageOwnerId: '' }]) {
    fails(() => assertCompanyBankAccess({ ...context, ...change }, request), 'COMPANY_ACCESS_DENIED');
  }
  assertCompanyBankAccess({ ...context, role: 'member' }, { ...request, action: 'read' });
  fails(() => assertCompanyBankAccess(context, { ...request, action: 'delete' }), 'COMPANY_ACCESS_DENIED');
});

test('callback accepts one opaque code and maps cancellation without raw error reflection', () => {
  assert.deepEqual(validateCallbackParameters(callback({ code: 'synthetic-code' })), { state, code: 'synthetic-code' });
  assert.deepEqual(validateCallbackParameters(callback({ error: 'access_denied', error_description: 'Cancelled by user' })),
    { state, error: 'access_denied', outcome: 'cancelled' });
  for (const description of ['Denied data sharing consent', 'Private bank message', 'cancelled by user']) {
    assert.deepEqual(validateCallbackParameters(callback({ error: 'access_denied', error_description: description })),
      { state, error: 'access_denied', outcome: 'denied' });
  }
  const safe = validateCallbackParameters(callback({ error: 'private_bank_error', error_description: 'Private identifier' }));
  assert.equal(safe.outcome, 'failed');
  assert.equal(JSON.stringify(safe).includes('private_'), false);
  assert.equal(JSON.stringify(safe).includes('Private'), false);
});

test('ambiguous, duplicate, malformed and unbounded callbacks fail before code use', () => {
  const cases = [callback({}), callback({ code: '', error: '' }), callback({ code: 'x', error: 'access_denied' }),
    callback({ code: 'x', error_description: 'Cancelled by user' }), callback({ code: 'x', unknown: 'x' }),
    callback({ code: 'x\n' }), callback({ code: 'x'.repeat(4097) }), callback({ error: 'x\u007f' }),
    callback({ state: 'a'.repeat(42), code: 'x' }), callback({ state: '!'.repeat(43), code: 'x' })];
  for (const key of ['state', 'code', 'error', 'error_description']) {
    const params = key === 'state' || key === 'code' ? callback({ code: 'x' }) : callback({ error: 'access_denied', error_description: 'Cancelled by user' });
    params.append(key, params.get(key)); cases.push(params);
  }
  for (const params of cases) fails(() => validateCallbackParameters(params), 'INVALID_CALLBACK');
});

test('only explicit unique read capabilities are accepted', () => {
  assert.deepEqual(validateReadScopes(), ['accounts:read', 'transactions:read']);
  assert.deepEqual(validateReadScopes(['bankgiro:read', 'transactions:read', 'accounts:read']),
    ['accounts:read', 'transactions:read', 'bankgiro:read']);
  for (const scopes of [[], null, 'accounts:read', ['payments:write'], ['transactions:read', 'transactions:read'], ['accounts:read', 'admin']]) {
    fails(() => validateReadScopes(scopes), 'INVALID_CONSENT_SCOPES');
  }
});

test('requested scopes must include the account and transaction access the adapters request', () => {
  for (const scopes of [['accounts:read'], ['transactions:read'], ['bankgiro:read'],
    ['accounts:read', 'bankgiro:read'], ['transactions:read', 'bankgiro:read']]) {
    fails(() => validateReadScopes(scopes), 'INVALID_CONSENT_SCOPES');
    fails(() => validateEnableConsent({ ...grant(), requestedScopes: scopes }), 'INVALID_CONSENT_SCOPES');
  }
  assert.deepEqual(validateReadScopes(['transactions:read', 'accounts:read']), ['accounts:read', 'transactions:read']);
});

test('consent uses earliest requested, exchange or checked expiry without needing session_id', () => {
  for (const field of ['requested', 'session', 'checked']) {
    const input = grant();
    if (field === 'requested') input.requestedValidUntil = later(5);
    else input[field].access.valid_until = later(5);
    assert.deepEqual(validateEnableConsent(input), { validUntil: later(5), accountUids: ['synthetic-account-a'],
      grantedScopes: ['accounts:read', 'transactions:read'], missingScopes: [] });
  }
});

test('consent timestamps reject impossible calendar dates and invalid clock or offset fields', () => {
  const invalid = ['2027-02-29T12:00:00Z', '2028-02-30T12:00:00+01:00', '2100-02-29T12:00:00Z',
    '2026-11-31T12:00:00Z', '2026-13-01T12:00:00Z', '2026-11-00T12:00:00Z',
    '2026-11-05T24:00:00Z', '2026-11-05T12:60:00Z', '2026-11-05T12:00:60Z',
    '2026-11-05T12:00:00+24:00', '2026-11-05T12:00:00+01:60', '2026-11-05T12:00:00'];
  for (const value of invalid) for (const field of ['requested', 'session', 'checked']) {
    const input = grant();
    if (field === 'requested') input.requestedValidUntil = value;
    else input[field].access.valid_until = value;
    fails(() => validateEnableConsent(input), 'BANK_CONSENT_EXPIRED');
  }
});

test('valid leap dates and numeric timezone offsets preserve the actual earliest instant', () => {
  const input = grant();
  input.requestedValidUntil = '2026-11-04T14:00:00+01:00';
  input.session.access.valid_until = '2026-11-04T08:30:00-04:00';
  input.checked.access.valid_until = '2026-11-04T18:15:00.123+05:45';
  assert.equal(validateEnableConsent(input).validUntil, '2026-11-04T12:30:00.000Z');
  for (const value of ['2028-02-29T12:00:00+01:00', '2400-02-29T12:00:00Z']) {
    const leap = grant(); leap.requestedValidUntil = value;
    leap.session.access.valid_until = value; leap.checked.access.valid_until = value;
    assert.equal(validateEnableConsent(leap).validUntil, new Date(value).toISOString());
  }
});

test('each consent source must be current, business and the same requested bank', () => {
  for (const field of ['session', 'checked']) {
    for (const change of [value => { value.access.valid_until = later(0); }, value => { value.access.valid_until = 'invalid'; },
      value => { value.psu_type = 'personal'; }, value => { value.aspsp.name = 'Other Bank'; },
      value => { value.aspsp.country = 'NO'; }, value => { value.access.transactions = false; }]) {
      const input = grant(); change(input[field]); fails(() => validateEnableConsent(input));
    }
  }
  for (const status of ['PENDING_AUTHORIZATION', 'REVOKED', 'EXPIRED', 'CLOSED']) {
    const input = grant(); input.checked.status = status; fails(() => validateEnableConsent(input));
  }
  const input = grant(); input.requestedValidUntil = later(-1); fails(() => validateEnableConsent(input));
});

test('legacy omitted transaction flags are accepted but malformed flags cannot grant scope', () => {
  const input = grant(); delete input.session.access.transactions; delete input.checked.access.transactions;
  delete input.country;
  assert.deepEqual(validateEnableConsent(input).grantedScopes, ['accounts:read', 'transactions:read']);
  for (const field of ['session', 'checked']) for (const value of [false, null, 0, 1, 'true', 'false', [], {}]) {
    const malformed = grant(); malformed[field].access.transactions = value;
    fails(() => validateEnableConsent(malformed), 'BANK_TRANSACTION_SCOPE_REQUIRED');
  }
});

test('fresh account data cannot downgrade an account to private or malformed usage unnoticed', () => {
  for (const usage of ['PRIV', 'unknown', null, true, '']) {
    const input = grant(); input.checked.accounts_data[0].usage = usage;
    fails(() => validateEnableConsent(input), 'BANK_ACCOUNT_SCOPE_INVALID');
  }
  const business = grant(); business.checked.accounts_data[0].usage = 'ORGA';
  assert.deepEqual(validateEnableConsent(business).accountUids, ['synthetic-account-a']);
});

test('account approvals must be bounded, unique and agree across provider responses', () => {
  for (const mutate of [
    input => { input.session.accounts = []; },
    input => { input.session.accounts.push({ ...input.session.accounts[0] }); },
    input => { input.session.accounts[0].usage = 'PRIV'; },
    input => { input.checked.accounts = ['other-account']; },
    input => { input.checked.accounts_data = [{ uid: 'other-account' }]; },
    input => { input.checked.accounts.push(input.checked.accounts[0]); },
    input => { input.session.accounts = Array.from({ length: 101 }, (_, i) => ({ uid: `synthetic-${i}` })); },
  ]) { const input = grant(); mutate(input); fails(() => validateEnableConsent(input)); }
});

test('matching UIDs cannot hide conflicting singular account hashes or be repaired by plural aliases', () => {
  const input = grant();
  input.session.accounts[0].identification_hash = 'synthetic-exact-account-hash';
  input.checked.accounts_data[0].identification_hash = 'synthetic-exact-account-hash';
  assert.deepEqual(validateEnableConsent(input).accountUids, ['synthetic-account-a']);
  input.checked.accounts_data[0].identification_hash = 'synthetic-other-account-hash';
  input.checked.accounts_data[0].identification_hashes = ['synthetic-exact-account-hash', 'shared-alias'];
  input.session.accounts[0].identification_hashes = ['synthetic-other-account-hash', 'shared-alias'];
  fails(() => validateEnableConsent(input), 'BANK_ACCOUNT_SCOPE_INVALID');
});

test('Enable Banking does not manufacture a Bankgiro read grant', () => {
  const input = grant(); input.requestedScopes = ['accounts:read', 'transactions:read', 'bankgiro:read'];
  input.checked.bankgiro = true;
  fails(() => validateEnableConsent(input), 'BANKGIRO_SCOPE_UNAVAILABLE');
});

test('business account usage and a person hash alone never prove company authorization', () => {
  const input = { ...authority(), evidence: { status: 'verified', psu_type: 'business', usage: 'ORGA', psu_id_hash: 'synthetic-person' } };
  assert.equal(corporateAuthorization(authority()).status, 'unverified');
  assert.equal(corporateAuthorization(input).status, 'unverified');
});

test('trusted-adapter evidence is bound to actor, company, bank, full account set and validity', () => {
  const input = authority(); input.evidence = evidence(input);
  const verified = corporateAuthorization(input);
  assert.equal(verified.status, 'verified'); assert.equal(verified.evidenceId, input.evidence.evidenceId);
  assert.equal(verified.validUntil, later(30));
  for (const patch of [{ actorId: 'other' }, { companyId: 'workspace:other' }, { bankName: 'Other' }, { country: 'NO' },
    { accountUids: ['other'] }, { accountUids: ['synthetic-account-a', 'extra'] }, { accountUids: [] },
    { accountUids: ['synthetic-account-a', 'synthetic-account-a'] }, { evidenceId: '' },
    { origin: 'browser' }, { validUntil: later(0) }, { checkedAt: later(1) }, { status: 'pending' }]) {
    assert.equal(corporateAuthorization({ ...input, evidence: { ...input.evidence, ...patch } }).status, 'unverified');
  }
});

test('corporate evidence cannot use rolled-over calendar dates for checking or expiration', () => {
  const input = authority(); input.evidence = evidence(input);
  fails(() => corporateAuthorization({ ...input, validUntil: '2027-02-29T00:00:00Z' }), 'CORPORATE_AUTHORIZATION_REQUIRED');
  for (const patch of [{ checkedAt: '2026-02-30T00:00:00Z' }, { validUntil: '2027-02-29T00:00:00Z' }]) {
    assert.equal(corporateAuthorization({ ...input, evidence: { ...input.evidence, ...patch } }).status, 'unverified');
  }
});

test('validators neither mutate inputs nor reflect untrusted values in default errors', () => {
  const input = freeze(grant()); const before = JSON.stringify(input); validateEnableConsent(input);
  assert.equal(JSON.stringify(input), before);
  const corp = authority(); corp.evidence = evidence(corp); freeze(corp); corporateAuthorization(corp);
  const error = new ConsentError('SYNTHETIC_PRIVATE_VALUE');
  assert.equal(error.status, 400); assert.equal(error.message.includes('SYNTHETIC_PRIVATE_VALUE'), false);
});

test('foundation context retains distinct actor/storage owner and rejects client-selected companies and accountant management',async()=>{
 const {companyBankContext}=await import('../lib/bank-consent-policy.js');
 const c={version:'company-context-v1',companyId:'company-a',storageOwner:'namespace-a',actorId:'admin-a',role:'admin',membershipVersion:3,companyVersion:1,contextVersion:2};
 assert.deepEqual(companyBankContext(c,'namespace-a','company-a'),{companyId:'company-a',storageOwnerId:'namespace-a',actorId:'admin-a',role:'admin',membershipVersion:'3',active:true});
 fails(()=>companyBankContext(c,'namespace-b','company-a'),'COMPANY_ACCESS_DENIED');fails(()=>companyBankContext(c,'namespace-a','company-b'),'COMPANY_ACCESS_DENIED');fails(()=>companyBankContext({...c,role:'accountant'},'namespace-a'),'COMPANY_ACCESS_DENIED');assert.equal(companyBankContext({...c,role:'accountant'},'namespace-a',undefined,'read').actorId,'admin-a');
});
