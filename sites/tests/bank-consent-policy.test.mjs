import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ConsentError, legacyCompanyContext, assertCompanyBankAccess,
  validateCallbackParameters, validateReadScopes, validateEnableConsent,
  corporateAuthorization, validateLegacyEnableSelection,
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


const legacyA='11111111-1111-4111-8111-111111111111',legacyB='22222222-2222-4222-8222-222222222222',legacyC='33333333-3333-4333-8333-333333333333';
function legacySelection(){
 const input=grant(),account=uid=>({uid,usage:'ORGA',currency:'SEK',cash_account_type:'CACC',identification_hash:'primary-'+uid,identification_hashes:['primary-'+uid]});
 input.session.accounts=[account(legacyA),account(legacyB)];input.checked.accounts=[legacyA];input.checked.accounts_data=[account(legacyA)];input.selectedAccountUids=[legacyA];return input;
}
test('legacy selection preserves the selected authorized account after an unselected cached account is withdrawn',()=>{
 const input=freeze(legacySelection()),before=JSON.stringify(input),result=validateLegacyEnableSelection(input);
 assert.deepEqual(result.accountUids,[legacyA]);assert.equal(result.validUntil,later(60));assert.deepEqual(result.grantedScopes,['accounts:read','transactions:read']);assert.equal(JSON.stringify(input),before);
 fails(()=>validateEnableConsent(input),'BANK_ACCOUNT_SCOPE_INVALID');
});
test('legacy selection does not import an unselected private account or grant newly observed accounts',()=>{
 const input=legacySelection();input.session.accounts[1].usage='PRIV';input.checked.accounts.push(legacyB,legacyC);input.checked.accounts_data.push({...input.session.accounts[1]},{uid:legacyC,identification_hash:'new-primary',usage:'PRIV'});
 const result=validateLegacyEnableSelection(freeze(input));assert.deepEqual(result.accountUids,[legacyA]);fails(()=>validateEnableConsent(input),'BANK_ACCOUNT_SCOPE_INVALID');
});
for(const [label,mutate] of [
 ['empty selection',i=>i.selectedAccountUids=[]],['duplicate selection',i=>i.selectedAccountUids=[legacyA,legacyA]],['malformed selected UID',i=>i.selectedAccountUids=['not-a-uuid']],
 ['selected absent from live',i=>i.selectedAccountUids=[legacyB]],['selected absent from saved',i=>i.session.accounts=i.session.accounts.filter(a=>a.uid!==legacyA)],
 ['duplicate saved unused UID',i=>i.session.accounts.push({...i.session.accounts[1]})],['duplicate live UID',i=>i.checked.accounts.push(legacyA)],['duplicate live metadata',i=>i.checked.accounts_data.push({...i.checked.accounts_data[0]})],
 ['UID-less GET metadata',i=>i.checked.accounts_data.push({identification_hash:'unavailable'})],['null GET metadata',i=>i.checked.accounts_data.push(null)],['malformed unused GET UID',i=>{i.checked.accounts.push('not-a-uuid');i.checked.accounts_data.push({uid:'not-a-uuid'});}],
 ['malformed unused cached UID',i=>i.session.accounts[1].uid='not-a-uuid'],['UID-less cached account',i=>delete i.session.accounts[1].uid],
 ['GET IDs lack metadata',i=>i.checked.accounts.push(legacyB)],['GET metadata lacks ID',i=>i.checked.accounts_data.push({...i.session.accounts[1]})],
 ['private selected saved account',i=>i.session.accounts[0].usage='PRIV'],['private selected current account',i=>i.checked.accounts_data[0].usage='PRIV'],['unknown selected usage',i=>i.checked.accounts_data[0].usage='unknown'],
 ['selected primary hash changed despite plural overlap',i=>{i.checked.accounts_data[0].identification_hash='changed';i.checked.accounts_data[0].identification_hashes=[i.session.accounts[0].identification_hash];}],
 ['overbound saved accounts',i=>i.session.accounts=Array.from({length:101},(_,n)=>({uid:`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`}))],
 ['overbound GET accounts',i=>{i.checked.accounts=Array.from({length:101},(_,n)=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`);i.checked.accounts_data=i.checked.accounts.map(uid=>({uid}));}],
 ['overbound selection',i=>i.selectedAccountUids=Array.from({length:101},(_,n)=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`)],
])test('legacy selected adapter rejects '+label,()=>{const input=legacySelection();mutate(input);fails(()=>validateLegacyEnableSelection(input),'BANK_ACCOUNT_SCOPE_INVALID');});
for(const [label,mutate,code] of [
 ['revoked session',i=>i.checked.status='REVOKED','BANK_CONSENT_INVALID'],['different bank',i=>i.checked.aspsp.name='Other Bank','BANK_CONSENT_INVALID'],['personal PSU',i=>i.checked.psu_type='personal','BANK_CONSENT_INVALID'],
 ['withdrawn transaction scope',i=>i.checked.access.transactions=false,'BANK_TRANSACTION_SCOPE_REQUIRED'],['write scope',i=>i.requestedScopes=['accounts:read','transactions:read','payments:write'],'INVALID_CONSENT_SCOPES'],['missing transaction scope',i=>i.requestedScopes=['accounts:read'],'INVALID_CONSENT_SCOPES'],
 ['Bankgiro scope',i=>i.requestedScopes=['accounts:read','transactions:read','bankgiro:read'],'BANKGIRO_SCOPE_UNAVAILABLE'],
 ['expired cached access',i=>i.session.access.valid_until=later(-1),'BANK_CONSENT_EXPIRED'],['expired current access',i=>i.checked.access.valid_until=later(-1),'BANK_CONSENT_EXPIRED'],['expired requested cap',i=>i.requestedValidUntil=later(-1),'BANK_CONSENT_EXPIRED'],
])test('legacy selected adapter retains '+label+' denial',()=>{const input=legacySelection();mutate(input);fails(()=>validateLegacyEnableSelection(input),code);});
