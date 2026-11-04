import test from 'node:test';
import assert from 'node:assert/strict';
import { bankApiDataHash } from '../lib/bank-api-original.js';
import { OpenPaymentsProvider } from '../lib/banking/openpayments-provider.js';
import { NOW, CONFIG, BINDING, CONTEXT, ACCOUNT_ID, ACCOUNT, TX, CONSENT_ID, AUTH_ID, json, fixtureTransport } from './helpers/openpayments-fixture.mjs';

function setup(overrides = {}, config = CONFIG, context = CONTEXT) {
  const fixture = fixtureTransport(overrides);
  const provider = new OpenPaymentsProvider(config, { transport: fixture.transport, now: () => NOW });
  return { ...fixture, fixture, provider, connection: provider.forCompany(context, fixture.dependencies) };
}
async function consent(connection, redirectPreferred = false) { return (await connection.createConsent({ validUntil: '2026-12-01', redirectPreferred })).handle; }
async function account(connection) { return (await connection.listAccounts(await consent(connection))).accounts[0].handle; }

test('application discovery needs live authority but no selected bank or corporate/PSU placeholder',async()=>{
 const {provider,calls}=setup();let active=true;
 assert.equal(typeof provider.discoverBanks,'function','application-level discovery must exist before bank selection');
 const result=await provider.discoverBanks(['SE'],{async assertCurrent(){if(!active)throw Error('revoked');}});
 assert.deepEqual(result,{banks:[{id:'OPBKSE21',name:'Synthetic Demo Bank'}]});
 const request=calls.find(call=>new URL(call.url).pathname.endsWith('/aspsps'));
 for(const header of ['X-BicFi','PSU-ID','PSU-Corporate-ID','PSU-IP-Address'])assert.equal(request.init.headers.get(header),null);
 active=false;const count=calls.length;
 await assert.rejects(provider.discoverBanks(['SE'],{async assertCurrent(){if(!active)throw Error('revoked');}}));assert.equal(calls.length,count);
});

test('bank list/details come from official ASPSP paths; bank payment capability never enables payments or proves company Bankgiro', async () => {
  const { connection, calls } = setup();
  const banks = await connection.listBanks(['SE']);
  assert.equal(banks.banks[0].id, 'OPBKSE21');
  const caps = await connection.discoverCapabilities();
  assert.equal(caps.bank.id, 'OPBKSE21');
  assert.equal(caps.corporateAccountAccess, 'requires_company_consent');
  assert.equal(caps.bankgiro.status, 'not_configured');
  assert.equal(caps.payments, 'disabled');
  assert.deepEqual(caps.authorizationMethods, ['redirect', 'decoupled']);
  assert.equal(caps.accountInformation.transactionHistoryMaxDays, 90);
  assert.ok(calls.some(call => call.url.endsWith('/psd2/aspspinformation/v1/aspsps?isoCountryCodes=SE')));
  assert.ok(!calls.some(call => call.url.includes('paymentinitiation')));
  const enriched = setup({}, { ...CONFIG, features: ['bank_discovery', 'consents', 'accounts', 'transactions', 'bankgiro_enrichment'] });
  assert.equal((await enriched.connection.discoverCapabilities()).bankgiro.status, 'unknown');
});

test('consents carry exact company and PSU identifiers, read-only access and no ISO fallback', async () => {
  const { connection, calls } = setup();
  const result = await connection.createConsent({ validUntil: '2026-12-01', frequencyPerDay: 4, redirectPreferred: false });
  assert.equal(result.status, 'received');
  assert.ok(!result.handle.includes(CONSENT_ID));
  const call = calls.find(call => call.url.endsWith('/consents'));
  assert.deepEqual(JSON.parse(call.init.body), { access: {}, recurringIndicator: true, validUntil: '2026-12-01', frequencyPerDay: 4, combinedServiceIndicator: false });
  assert.equal(call.init.headers.get('PSU-Corporate-ID'), 'synthetic-company-a');
  assert.equal(call.init.headers.get('PSU-ID'), 'synthetic-psu-a');
  assert.equal(call.init.headers.get('TPP-Redirect-Preferred'), 'false');
  assert.equal(call.init.headers.get('X-ISO-Fallback-Enabled'), null);
  assert.equal(result.original.bankDataSha256, bankApiDataHash(result.original.bankData));
  assert.equal(result.original.provider, 'open_payments');
  assert.notEqual(result.original.bankDataVersion, 'bank-api-original-v1');
});

test('background reads omit PSU IP/User-Agent while interactive authorization requires the real PSU context', async () => {
  const first = setup(); const handle = await consent(first.connection);
  const background = first.provider.forCompany({ ...CONTEXT, psu: undefined }, first.dependencies);
  await background.getConsentStatus(handle);
  const call = first.calls.at(-1);
  assert.equal(call.init.headers.get('PSU-IP-Address'), null);
  assert.equal(call.init.headers.get('PSU-User-Agent'), null);
  await assert.rejects(background.createConsent({ validUntil: '2026-12-01' }), { code: 'AUTHORIZATION_INVALID' });
});

test('invalid context, forbidden frequency and invalid dates stop before external calls', async () => {
  const { provider, connection, calls, dependencies } = setup();
  for (const patch of [{ corporateId: '' }, { psuId: '' }, { bicFi: 'not-a-bank' }, { binding: { ...BINDING, generation: 'wrong' } }, { binding: { ...BINDING, provider: 'enable_banking' } }]) {
    assert.throws(() => provider.forCompany({ ...CONTEXT, ...patch }, dependencies));
  }
  for (const input of [{ validUntil: '2026-02-30' }, { validUntil: '2026-01-01' }, { validUntil: '2026-12-01', frequencyPerDay: 5 }, { validUntil: '2026-12-01', combinedServiceIndicator: true }]) await assert.rejects(connection.createConsent(input));
  assert.equal(calls.length, 0);
});

test('account resources are scoped and cannot cross company, connection, environment, PSU or bank', async () => {
  const { provider, connection, calls, dependencies } = setup(); const handle = await account(connection);
  const count = calls.length;
  for (const patch of [{ corporateId: 'other-company' }, { psuId: 'other-psu' }, { bicFi: 'ESSESESS' }, { binding: { ...BINDING, companyId: 'company-b' } }, { binding: { ...BINDING, connectionId: 'connection-b' } }]) {
    const other = provider.forCompany({ ...CONTEXT, ...patch }, { ...dependencies, async assertCurrent() {} });
    await assert.rejects(other.getAccount(handle), { code: 'RESOURCE_SCOPE_MISMATCH' });
  }
  assert.equal(calls.length, count);
});

test('accounts preserve returned identifiers; private accounts or inconsistent detail identity are rejected', async () => {
  const normal = setup(); const result = await normal.connection.listAccounts(await consent(normal.connection));
  assert.equal(result.accounts[0].identity.iban, ACCOUNT.iban);
  assert.equal(result.accounts[0].identity.bankgiroNumber, '1234-5678');
  assert.equal(result.accounts[0].bankgiroMappingVerified, false);
  const privateAccount = setup({ 'GET /psd2/accountinformation/v1/accounts': () => json({ accounts: [{ ...ACCOUNT, usage: 'PRIV' }] }) });
  await assert.rejects(privateAccount.connection.listAccounts(await consent(privateAccount.connection)), { code: 'PROVIDER_RESPONSE_INVALID' });
  const swapped = setup({ [`GET /psd2/accountinformation/v1/accounts/${ACCOUNT_ID}`]: () => json({ ...ACCOUNT, iban: 'SE1412000000000012345678' }) });
  await assert.rejects(swapped.connection.getAccount(await account(swapped.connection)), { code: 'RESOURCE_SCOPE_MISMATCH' });
});

test('revocation, expiry and partial authorization block AIS; a finalised SCA alone cannot grant account access', async t => {
  for (const status of ['received', 'rejected', 'expired', 'revokedByPsu', 'terminatedByTpp', 'partiallyAuthorised']) await t.test(status, async () => {
    const { connection, calls } = setup({ [`GET /psd2/consent/v1/consents/${CONSENT_ID}`]: () => json({ consentStatus: status, validUntil: '2026-12-01', access: {} }) });
    await assert.rejects(connection.listAccounts(await consent(connection)), { code: 'CONSENT_NOT_VALID' });
    assert.ok(!calls.some(call => new URL(call.url).pathname === '/psd2/accountinformation/v1/accounts'));
  });
  const expired = setup({ [`GET /psd2/consent/v1/consents/${CONSENT_ID}`]: () => json({ consentStatus: 'valid', validUntil: '2026-11-03', access: {} }) });
  await assert.rejects(expired.connection.listAccounts(await consent(expired.connection)), { code: 'CONSENT_NOT_VALID' });
});

test('late provider response is discarded when company membership or generation is revoked in flight', async () => {
  let fixture;
  const created = setup({ 'GET /psd2/accountinformation/v1/accounts': () => { fixture.revoke(); return json({ accounts: [ACCOUNT] }); } });
  fixture = created.fixture;
  await assert.rejects(created.connection.listAccounts(await consent(created.connection)), { code: 'RESOURCE_SCOPE_MISMATCH' });
});

test('booked rows and Bankgiro observations stay separate; raw original, leading zeros and checksums are retained', async () => {
  const source = { account: { iban: ACCOUNT.iban }, transactions: { booked: [TX], bankgiro: [{ ...TX, transactionId: 'bankgiro-observation', isEnriched: true }], _links: {} } };
  const { connection } = setup({ [`GET /psd2/accountinformation/v1/accounts/${ACCOUNT_ID}/transactions`]: () => json(source) }, { ...CONFIG, features: ['consents', 'accounts', 'transactions', 'bankgiro_enrichment'] });
  const result = await connection.getTransactions(await account(connection), { dateFrom: '2026-11-01', dateTo: '2026-11-04', requireBankgiro: true });
  assert.equal(result.booked.length, 1); assert.equal(result.bankgiro.length, 1);
  assert.equal(result.booked[0].remittanceInformationStructured, '0599');
  assert.equal(result.bankgiroEvidence.status, 'returned_by_provider');
  assert.equal(result.bankgiroEvidence.completeness, 'unknown');
  assert.equal(result.paymentReconciliationAllowed, false);
  assert.deepEqual(result.originals[0].bankData, source);
  assert.equal(result.originals[0].bankDataSha256, bankApiDataHash(source));
  source.transactions.booked[0] = { ...TX, remittanceInformationStructured: '599' };
  assert.equal(result.originals[0].bankData.transactions.booked[0].remittanceInformationStructured, '0599');
});

test('missing Bankgiro support is explicit; no payer or OCR is reconstructed from the invoice', async () => {
  const { connection } = setup(); const handle = await account(connection);
  await assert.rejects(connection.getTransactions(handle, { dateFrom: '2026-11-01', dateTo: '2026-11-04', requireBankgiro: true }), { code: 'BANKGIRO_NOT_AVAILABLE' });
  const result = await connection.getTransactions(handle, { dateFrom: '2026-11-01', dateTo: '2026-11-04' });
  assert.equal(result.bankgiroEvidence.status, 'not_requested'); assert.deepEqual(result.bankgiro, []);
  const scoped = setup({}, { ...CONFIG, features: ['consents', 'accounts', 'transactions', 'bankgiro_enrichment'] });
  await assert.rejects(scoped.connection.getTransactions(await account(scoped.connection), { dateFrom: '2026-11-01', dateTo: '2026-11-04', requireBankgiro: true }), { code: 'BANKGIRO_NOT_AVAILABLE' });
});

test('pagination follows only documented continuationKey links within the same account and requested dates', async () => {
  const path = `/psd2/accountinformation/v1/accounts/${ACCOUNT_ID}/transactions`;
  const { connection } = setup({ [`GET ${path}`]: url => json({ account: { iban: ACCOUNT.iban }, transactions: { booked: [{ ...TX, transactionId: new URL(url).searchParams.has('continuationKey') ? 'second' : 'first' }], _links: new URL(url).searchParams.has('continuationKey') ? {} : { next: { href: `${path}?bookingStatus=booked&dateFrom=2026-11-01&dateTo=2026-11-04&continuationKey=opaque-page-2` } } } }) });
  const result = await connection.getTransactions(await account(connection), { dateFrom: '2026-11-01', dateTo: '2026-11-04' });
  assert.deepEqual(result.booked.map(row => row.transactionId), ['first', 'second']); assert.equal(result.originals.length, 2);
});

test('cross-account, cross-origin, repeated or broadened pagination never returns a partial batch', async t => {
  const path = `/psd2/accountinformation/v1/accounts/${ACCOUNT_ID}/transactions`;
  for (const href of ['https://evil.example/data', path.replace(ACCOUNT_ID, 'other-account') + '?bookingStatus=booked', `${path}?bookingStatus=both`, `${path}?bookingStatus=booked&dateFrom=2026-01-01&dateTo=2026-11-04&continuationKey=2`, `${path}?bookingStatus=booked&dateFrom=2026-11-01&dateTo=2026-11-04&continuationKey=same`]) await t.test(href.slice(-40), async () => {
    const { connection } = setup({ [`GET ${path}`]: () => json({ account: { iban: ACCOUNT.iban }, transactions: { booked: [TX], _links: { next: { href } } } }) });
    await assert.rejects(connection.getTransactions(await account(connection), { dateFrom: '2026-11-01', dateTo: '2026-11-04' }), { code: 'PROVIDER_RESPONSE_INVALID' });
  });
});

test('401 discards the application token without replaying the failed request', async () => {
  let reject = true;
  const { connection, calls } = setup({ 'GET /psd2/aspspinformation/v1/aspsps': () => reject ? json({}, 401) : json({ aspsps: [] }) });
  await assert.rejects(connection.listBanks(), { code: 'INVALID_ACCESS_TOKEN' });
  assert.equal(calls.length, 2);
  reject = false;
  await connection.listBanks();
  assert.equal(calls.filter(call => call.url.endsWith('/connect/token')).length, 2);
});

test('decoupled authorization uses advertised method only and returns challenge without claiming consent is valid', async () => {
  const { connection } = setup();
  const authorization = await connection.createAuthorisation(await consent(connection));
  await assert.rejects(connection.startAuthorisation(authorization.handle, { authenticationMethodId: 'invented' }), { code: 'AUTHORIZATION_INVALID' });
  const started = await connection.startAuthorisation(authorization.handle, { authenticationMethodId: 'mbid' });
  assert.equal(started.approach, 'decoupled'); assert.equal(started.scaStatus, 'started');
  assert.equal(started.challengeData.data[0], 'synthetic-autostart');
  assert.equal((await connection.getAuthorisationStatus(authorization.handle)).scaStatus, 'finalised');
  assert.equal(started.consentValid, false);
});

const redirectResponse = () => json({ scaStatus: 'started', _links: { scaOAuth: { href: `https://oauth.sandbox.openbankingplatform.com/connect/authorize?client_id=[CLIENT_ID]&scope=accountinformation%20corporate&response_type=code&redirect_uri=[TPP_REDIRECT_URI]&state=[TPP_STATE]&acr_values=idp:OPBKSE21%20consentId:${CONSENT_ID}%20ConsentAuthorisationId:${AUTH_ID}` } } }, 200, { 'aspsp-sca-approach': 'REDIRECT' });

test('redirect activation binds state/callback/scope, consumes flow once and discards activation token', async () => {
  const { connection, calls } = setup({ [`PUT /psd2/consent/v1/consents/${CONSENT_ID}/authorisations/${AUTH_ID}`]: redirectResponse });
  const authorization = await connection.createAuthorisation(await consent(connection, true));
  const start = await connection.startAuthorisation(authorization.handle, { authenticationMethodId: 'mbid', redirectUri: CONFIG.redirectUris[0] });
  assert.equal(start.approach, 'redirect'); const url = new URL(start.redirectUrl);
  assert.equal(url.searchParams.get('client_id'), CONFIG.clientId); assert.equal(url.searchParams.get('redirect_uri'), CONFIG.redirectUris[0]);
  assert.equal(url.searchParams.get('scope'), 'accountinformation corporate');
  const callback = { state: url.searchParams.get('state'), code: 'synthetic-auth-code', scope: 'accountinformation corporate' };
  await assert.rejects(connection.completeRedirect(start.flowHandle, { ...callback, state: 'wrong' }), { code: 'AUTHORIZATION_INVALID' });
  await assert.rejects(connection.completeRedirect(start.flowHandle, { ...callback, scope: 'accountinformation corporate paymentinitiation' }), { code: 'AUTHORIZATION_INVALID' });
  assert.equal((await connection.completeRedirect(start.flowHandle, callback)).status, 'valid');
  await assert.rejects(connection.completeRedirect(start.flowHandle, callback), { code: 'AUTHORIZATION_INVALID' });
  const activation = calls.find(call => call.url.endsWith('/connect/token') && new URLSearchParams(call.init.body).get('grant_type') === 'authorization_code');
  assert.equal(activation.init.headers.get('X-consentId'), CONSENT_ID);
  assert.equal(activation.init.headers.get('X-ConsentAuthorisationId'), AUTH_ID);
  assert.ok(calls.filter(call => call.url.includes('/psd2/')).every(call => call.init.headers.get('Authorization') === 'Bearer application-only'));
});

test('malicious OAuth URL or modified consent binding never becomes browser navigation', async () => {
  for (const href of ['https://evil.example/connect/authorize', 'https://oauth.sandbox.openbankingplatform.com/connect/authorize?scope=paymentinitiation', `https://oauth.sandbox.openbankingplatform.com/connect/authorize?client_id=[CLIENT_ID]&scope=accountinformation%20corporate&response_type=code&redirect_uri=[TPP_REDIRECT_URI]&state=[TPP_STATE]&acr_values=idp:OPBKSE21%20consentId:other-consent%20ConsentAuthorisationId:${AUTH_ID}`]) {
    const { connection } = setup({ [`PUT /psd2/consent/v1/consents/${CONSENT_ID}/authorisations/${AUTH_ID}`]: () => json({ scaStatus: 'started', _links: { scaOAuth: { href } } }, 200, { 'aspsp-sca-approach': 'REDIRECT' }) });
    const auth = await connection.createAuthorisation(await consent(connection, true));
    await assert.rejects(connection.startAuthorisation(auth.handle, { authenticationMethodId: 'mbid', redirectUri: CONFIG.redirectUris[0] }), { code: 'AUTHORIZATION_INVALID' });
  }
});

test('two companies share only application authentication, never consent, headers, accounts or originals', async () => {
  const secondConsent = '44444444-4444-4444-8444-444444444444';
  const secondAccount = '55555555-5555-4555-8555-555555555555';
  const fixture = fixtureTransport({
    'POST /psd2/consent/v1/consents': (_url, init) => json({ consentId: init.headers.get('PSU-Corporate-ID') === 'synthetic-company-a' ? CONSENT_ID : secondConsent, consentStatus: 'received' }, 201),
    [`GET /psd2/consent/v1/consents/${secondConsent}`]: () => json({ consentStatus: 'valid', validUntil: '2026-12-01', access: {} }),
    'GET /psd2/accountinformation/v1/accounts': (_url, init) => json({ accounts: [init.headers.get('PSU-Corporate-ID') === 'synthetic-company-a' ? ACCOUNT : { ...ACCOUNT, resourceId: secondAccount, iban: 'SE1412000000000012345678', bban: '12345678', currency: 'EUR' }] }),
  });
  const provider = new OpenPaymentsProvider(CONFIG, { transport: fixture.transport, now: () => NOW });
  const first = provider.forCompany(CONTEXT, fixture.dependencies);
  const second = provider.forCompany({ ...CONTEXT, binding: { ...BINDING, companyId: 'company-b', connectionId: 'connection-b' }, corporateId: 'synthetic-company-b', psuId: 'synthetic-psu-b' }, { ...fixture.dependencies, async assertCurrent(binding) { assert.equal(binding.companyId, 'company-b'); } });
  const [firstHandle, secondHandle] = await Promise.all([consent(first), consent(second)]);
  const [a, b] = await Promise.all([first.listAccounts(firstHandle), second.listAccounts(secondHandle)]);
  assert.equal(a.accounts[0].identity.iban, ACCOUNT.iban); assert.equal(a.accounts[0].identity.currency, 'SEK');
  assert.equal(b.accounts[0].identity.iban, 'SE1412000000000012345678'); assert.equal(b.accounts[0].identity.currency, 'EUR');
  assert.equal(a.original.binding.companyId, 'company-a'); assert.equal(b.original.binding.companyId, 'company-b');
  assert.equal(fixture.tokenCount, 1);
  await assert.rejects(second.getAccount(a.accounts[0].handle), { code: 'RESOURCE_SCOPE_MISMATCH' });
  await assert.rejects(first.getAccount(b.accounts[0].handle), { code: 'RESOURCE_SCOPE_MISMATCH' });
});

test('a consent shortened by the bank cannot expire during an AIS request and still return data', async () => {
  let time = Date.parse('2026-11-04T23:59:59Z');
  const fixture = fixtureTransport({
    [`GET /psd2/consent/v1/consents/${CONSENT_ID}`]: () => json({ consentStatus: 'valid', validUntil: '2026-11-04', access: {} }),
    [`GET /psd2/accountinformation/v1/accounts/${ACCOUNT_ID}`]: () => { time += 2000; return json(ACCOUNT); },
  });
  const provider = new OpenPaymentsProvider(CONFIG, { transport: fixture.transport, now: () => time });
  const connection = provider.forCompany(CONTEXT, fixture.dependencies);
  const handle = await account(connection);
  await assert.rejects(connection.getAccount(handle), error => ['CONSENT_NOT_VALID', 'RESOURCE_EXPIRED'].includes(error.code));
});
test('transaction acquisition privately returns the minimum retained and bank-effective consent deadline across pagination',async()=>{
 for(const [retained,bank,expected]of [['2026-11-20','2026-11-04','2026-11-04'],['2026-11-04','2026-12-01','2026-11-04'],['2026-12-01','2026-12-02','2026-12-01']]){
  let validUntil=retained;const {connection}=setup({
   [`GET /psd2/consent/v1/consents/${CONSENT_ID}`]:()=>json({consentStatus:'valid',validUntil,access:{}}),
   [`GET /psd2/accountinformation/v1/accounts/${ACCOUNT_ID}/transactions`]:(url)=>json({account:{iban:ACCOUNT.iban},transactions:{booked:[TX],_links:new URL(url).searchParams.has('continuationKey')?{}:{next:{href:`/psd2/accountinformation/v1/accounts/${ACCOUNT_ID}/transactions?bookingStatus=booked&dateFrom=2026-11-01&dateTo=2026-11-04&continuationKey=second`}}}}),
  });
  const handle=await account(connection);validUntil=bank;
  const result=await connection.getTransactions(handle,{dateFrom:'2026-11-01',dateTo:'2026-11-04'});
  assert.equal(result.booked.length,2);assert.equal(result.originals.length,2);assert.equal(result.effectiveConsentValidUntil,expected+'T23:59:59.999Z');assert.equal(result.paymentReconciliationAllowed,false);
 }
});
test('account details privately return the minimum retained and current bank consent deadline',async()=>{
 let validUntil='2026-12-01';const {connection}=setup({[`GET /psd2/consent/v1/consents/${CONSENT_ID}`]:()=>json({consentStatus:'valid',validUntil,access:{}})}),handle=await account(connection);validUntil='2026-11-05';
 const result=await connection.getAccount(handle);assert.equal(result.effectiveConsentValidUntil,'2026-11-05T23:59:59.999Z');assert.equal(result.bankgiroMappingVerified,false);
});

test('transaction range and Bankgiro requirements cannot change after an asynchronous operation starts', async () => {
  const { connection, calls } = setup(); const handle = await account(connection);
  const range = { dateFrom: '2026-11-01', dateTo: '2026-11-04' };
  const pending = connection.getTransactions(handle, range);
  range.dateFrom = '2020-01-01';
  await pending;
  const request = calls.find(call => new URL(call.url).pathname.endsWith('/transactions'));
  assert.equal(new URL(request.url).searchParams.get('dateFrom'), '2026-11-01');
  const required = { dateFrom: '2026-11-01', dateTo: '2026-11-04', requireBankgiro: true };
  const rejected = connection.getTransactions(handle, required); required.requireBankgiro = false;
  await assert.rejects(rejected, { code: 'BANKGIRO_NOT_AVAILABLE' });
});

test('authorization and callback inputs are captured before any guard or resource await', async () => {
  const { connection, calls } = setup({ [`PUT /psd2/consent/v1/consents/${CONSENT_ID}/authorisations/${AUTH_ID}`]: redirectResponse });
  const authorization = await connection.createAuthorisation(await consent(connection, true));
  const input = { authenticationMethodId: 'mbid', redirectUri: CONFIG.redirectUris[0] };
  const pending = connection.startAuthorisation(authorization.handle, input);
  input.authenticationMethodId = 'invented'; input.redirectUri = 'https://evil.example/callback';
  const start = await pending;
  const callback = { code: 'original-auth-code', scope: 'accountinformation corporate', state: new URL(start.redirectUrl).searchParams.get('state') };
  const completed = connection.completeRedirect(start.flowHandle, callback);
  callback.code = 'changed-auth-code'; callback.scope = 'paymentinitiation';
  assert.equal((await completed).status, 'valid');
  const activation = calls.find(call => call.url.endsWith('/connect/token') && new URLSearchParams(call.init.body).get('grant_type') === 'authorization_code');
  assert.equal(new URLSearchParams(activation.init.body).get('code'), 'original-auth-code');
});

test('caller mutation while HTTP is pending cannot relax response range validation', async () => {
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const { connection } = setup({
    [`GET /psd2/accountinformation/v1/accounts/${ACCOUNT_ID}/transactions`]: () => new Promise(resolve => {
      release = () => resolve(json({ account: { iban: ACCOUNT.iban }, transactions: { booked: [{ ...TX, bookingDate: '2026-01-01' }], _links: {} } }));
      entered();
    }),
  });
  const handle = await account(connection), range = { dateFrom: '2026-11-01', dateTo: '2026-11-04' };
  const pending = connection.getTransactions(handle, range);
  await waiting; range.dateFrom = '2020-01-01'; release();
  await assert.rejects(pending, { code: 'PROVIDER_RESPONSE_INVALID' });
});
