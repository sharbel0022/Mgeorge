import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { emptyState, applyCommand } from '../lib/domain.ts';
import {
  ProviderError, providerRequest, getApplication, listBusinessBanks, startAuth,
  createSession, getSession, deleteSession, getTransactions, getTransactionDetails,
} from '../lib/banking/enable-banking.ts';

const compiled = ts.transpileModule(readFileSync(new URL('../lib/banking/transactions.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace("'../payment-references.js'", JSON.stringify(new URL('../lib/payment-references.js',import.meta.url).href)).replace(/from ['"]\.\.\/domain['"]/, `from '${new URL('../lib/domain.ts', import.meta.url).href}'`);
const { normalizeTransactions, stableAccountKey } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const applicationId = '11111111-1111-4111-8111-111111111111';
const accountUid = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pem = '-----BEGIN PRIVATE KEY-----\n' + Buffer.from(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)).toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END PRIVATE KEY-----\n';
const config = { applicationId, privateKeyPem: pem };
const application = { name: 'MG test', kid: applicationId, environment: 'PRODUCTION', active: true, redirect_urls: ['https://mg.example.test/api/bank/callback'], countries: ['SE'], services: ['AIS'] };
const bank = { name: 'Swedbank', country: 'SE', psu_types: ['business', 'personal'], maximum_consent_validity: 15_552_000, auth_methods: [] };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const opts = { accountKey: 'iban:SE4550000000058398257466', accountLabel: 'Företagskonto', bankName: 'Swedbank', dateFrom: '2026-10-01', dateTo: '2026-10-26' };
const rawTx = (patch = {}) => ({ entry_reference: 'BOOK-REF-001', transaction_id: 'not-stable', transaction_amount: { amount: '1875.00', currency: 'SEK' }, credit_debit_indicator: 'CRDT', status: 'BOOK', booking_date: '2026-10-20', debtor: { name: 'Exempelkund AB' }, creditor: { name: 'M.George Vitvaror AB' }, reference_number: '001019', remittance_information: ['Faktura 1001'], ...patch });

test('trusted normalization preserves raw bank fields, candidate paths and immutable source on duplicate import',async()=>{
 const input=rawTx({reference_number:'0599',details:{invoice_number:'0600'}}),before=structuredClone(input);
 const {rows}=await normalizeTransactions([input],opts);
 assert.deepEqual(rows[0].bankData,before);assert.ok(rows[0].referenceEvidence.candidates.some(c=>c.value==='0600'&&c.source==='$.details.invoice_number'));
 input.details.invoice_number='mutated';assert.equal(rows[0].bankData.details.invoice_number,'0600');
 let state=applyCommand(emptyState(),{type:'transactions.import',rows,trustedBankImport:true}).state;
 assert.deepEqual(state.transactions[0].bankData,before);assert.ok(state.transactions[0].referenceEvidence.candidates.length>=2);
 const next=await normalizeTransactions([rawTx({reference_number:'changed'})],opts);
 state=applyCommand(state,{type:'transactions.import',rows:next.rows,trustedBankImport:true}).state;
 assert.equal(state.transactions.length,1);assert.deepEqual(state.transactions[0].bankData,before);
});

test('client imports cannot claim to hold authenticated raw bank data',async()=>{
 const {rows}=await normalizeTransactions([rawTx()],opts);
 const state=applyCommand(emptyState(),{type:'transactions.import',rows}).state;
 assert.equal(state.transactions[0].bankData,undefined);assert.equal(state.transactions[0].referenceEvidence,undefined);
});

test('overlong bank payer identity is retained in original but never truncated into a matching name',async()=>{
 const actualName='A'.repeat(200)+' Annan betalare AB',input=rawTx({debtor:{name:actualName}});
 const result=await normalizeTransactions([input],opts);
 assert.equal(result.rows[0].party,'');assert.equal(result.rows[0].bankData.debtor.name,actualName);
 assert.ok(result.warnings.some(w=>/betalar.*för lång|långa betalar/i.test(w)));
 const state=applyCommand(emptyState(),{type:'transactions.import',rows:result.rows,trustedBankImport:true}).state;
 assert.equal(state.transactions[0].verified,false);assert.equal(state.transactions[0].party,'');
});
test('transaction details use the documented scoped GET and retain the payer reference as text',async t=>{
 let call;t.mock.method(globalThis,'fetch',async(url,init)=>{call={url,init};return json(rawTx({reference_number:'0599',debtor:{name:'Café Gränden Bistro AB'}}));});
 const tx=await getTransactionDetails(config,accountUid,'fresh-lookup:id');assert.equal(tx.reference_number,'0599');assert.equal(call.url,`https://api.enablebanking.com/accounts/${accountUid}/transactions/fresh-lookup%3Aid`);assert.equal(call.init.method,'GET');
});
test('transaction detail paths reject traversal, unscoped IDs and arbitrary query strings before network',async t=>{
 let called=false;t.mock.method(globalThis,'fetch',async()=>{called=true;return json({});});
 for(const id of ['../other','..','https://attacker.test','id?force=true','id#x','id\\x',''])await assert.rejects(()=>getTransactionDetails(config,accountUid,id));
 await assert.rejects(()=>providerRequest(config,`/accounts/${accountUid}/transactions/id?owner=other`));assert.equal(called,false);
});
test('malformed detail responses fail and a missing resource has an explicit safe code',async t=>{
 t.mock.method(globalThis,'fetch',async()=>json({reference_number:'0599'}));await assert.rejects(()=>getTransactionDetails(config,accountUid,'id'),e=>e.code==='INVALID_PROVIDER_RESPONSE');
 t.mock.method(globalThis,'fetch',async()=>json({error:'NOT_FOUND'},404));await assert.rejects(()=>getTransactionDetails(config,accountUid,'id'),e=>e.code==='BANK_RESOURCE_UNAVAILABLE');
});

test('Provider JWT is a verifiable short-lived RS256 token and uses fixed HTTPS without redirects', async t => {
  let call;
  t.mock.method(globalThis, 'fetch', async (url, init) => { call = { url, init }; return json(application); });
  const result = await getApplication(config);
  assert.equal(result.environment, 'PRODUCTION');
  assert.equal(call.url, 'https://api.enablebanking.com/application');
  assert.equal(call.init.redirect, 'manual');
  assert.equal(call.init.cache, 'no-store');
  const token = call.init.headers.get('Authorization').replace(/^Bearer /, '');
  const [header, body, signature] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { typ: 'JWT', alg: 'RS256', kid: applicationId });
  const claims = JSON.parse(Buffer.from(body, 'base64url'));
  assert.equal(claims.iss, 'enablebanking.com');
  assert.equal(claims.aud, 'api.enablebanking.com');
  assert.equal(claims.exp - claims.iat, 300);
  assert.ok(Math.abs(claims.iat - Math.floor(Date.now() / 1000)) < 5);
  assert.equal(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', keyPair.publicKey, Buffer.from(signature, 'base64url'), new TextEncoder().encode(`${header}.${body}`)), true);
});

test('Adapter rejects arbitrary origins, payment paths, path traversal, query injection and wrong methods before fetch', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return json({}); });
  const cases = [
    ['https://attacker.invalid/application'], ['//attacker.invalid/application'], ['/\\attacker.invalid/application'],
    ['/payments', { method: 'POST', body: {} }], ['/application?api_key=secret'], ['/application#fragment'],
    ['/sessions/../payments', { method: 'POST', body: {} }], ['/auth'],
    ['/aspsps?country=SE&psu_type=business&service=PIS'], ['/aspsps?country=SE&country=FI&psu_type=business&service=AIS'],
    [`/accounts/${accountUid}/transactions?date_from=2026-10-01&date_to=2026-10-26&transaction_status=PDNG`],
    ['/application', { body: {} }],
  ];
  for (const [path, options] of cases) await assert.rejects(providerRequest(config, path, options), error => error instanceof ProviderError && error.code === 'INVALID_REQUEST');
  assert.equal(calls, 0);
});

test('Invalid keys are rejected safely and key material is not returned in errors', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('should not fetch'); });
  const secret = 'sensitive-key-text';
  await assert.rejects(providerRequest({ applicationId, privateKeyPem: secret }, '/application'), error => {
    assert.equal(error.code, 'INVALID_PRIVATE_KEY'); assert.ok(!error.message.includes(secret)); return true;
  });
});

test('Bank discovery requires the Swedish business AIS result and preserves the provider bank name', async t => {
  let requestUrl;
  t.mock.method(globalThis, 'fetch', async url => { requestUrl = new URL(url); return json({ aspsps: [bank] }); });
  assert.deepEqual(await listBusinessBanks(config), [bank]);
  assert.equal(requestUrl.searchParams.get('country'), 'SE');
  assert.equal(requestUrl.searchParams.get('psu_type'), 'business');
  assert.equal(requestUrl.searchParams.get('service'), 'AIS');
  t.mock.method(globalThis, 'fetch', async () => json({ aspsps: [{ ...bank, psu_types: ['personal'] }] }));
  await assert.rejects(listBusinessBanks(config), error => error.code === 'INVALID_PROVIDER_RESPONSE');
});

test('Start auth requests transaction reading only and refuses a provider URL on an untrusted host', async t => {
  let sent;
  t.mock.method(globalThis, 'fetch', async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return json({ url: 'https://auth.enablebanking.com/ais/start?sessionid=example', authorization_id: sessionId }); });
  const input = { bank: { name: bank.name, country: bank.country }, state: '12345678901234567890123456789012', redirectUrl: 'https://mg.example.test/api/bank/callback', validUntil: new Date(Date.now() + 86_400_000).toISOString() };
  await startAuth(config, input);
  assert.equal(sent.url, 'https://api.enablebanking.com/auth');
  assert.deepEqual(sent.body.access, { valid_until: input.validUntil, transactions: true, balances: false });
  assert.equal(sent.body.psu_type, 'business');
  assert.equal(sent.body.state, input.state);
  assert.equal(sent.body.redirect_url, input.redirectUrl);
  assert.equal(sent.body.language, 'sv');
  t.mock.method(globalThis, 'fetch', async () => json({ url: 'https://tilisy.enablebanking.com/ais/start?sessionid=example' }));
  assert.match((await startAuth(config, input)).url, /^https:\/\/tilisy\.enablebanking\.com\/ais\/start\?/);
  for (const url of ['https://auth.enablebanking.com.evil.test/ais/start', 'https://tilisy.enablebanking.com.evil.test/ais/start', 'http://tilisy.enablebanking.com/ais/start', 'https://tilisy.enablebanking.com:444/ais/start', 'https://user:password@tilisy.enablebanking.com/ais/start', 'https://tilisy.enablebanking.com/pis/start', 'https://tilisy.enablebanking.com/ais/start#fragment']) {
    t.mock.method(globalThis, 'fetch', async () => json({ url }));
    await assert.rejects(startAuth(config, input), error => error.code === 'INVALID_PROVIDER_RESPONSE');
  }
});

test('The real browser navigation gate accepts both provider AIS hosts and rejects unrelated URLs', () => {
  const component = readFileSync(new URL('../components/bank-connection.tsx', import.meta.url), 'utf8');
  const implementation = component.match(/function followBankUrl\(value: string\) \{([\s\S]*?)\n\}/)[1];
  const visits = [];
  const follow = new Function('value', 'window', 'BankApiError', implementation);
  const window = { location: { assign: url => visits.push(url) } };
  for (const host of ['auth.enablebanking.com', 'tilisy.enablebanking.com']) {
    const url = `https://${host}/ais/start?sessionid=test`;
    follow(url, window, Error);
    assert.equal(visits.at(-1), url);
  }
  for (const url of ['https://tilisy.enablebanking.com.evil.test/ais/start', 'http://tilisy.enablebanking.com/ais/start', 'https://tilisy.enablebanking.com/pis/start']) assert.throws(() => follow(url, window, Error));
  assert.equal(visits.length, 2);
});

test('Create and inspect session preserve distinct POST and GET account shapes; deletion is limited to a session', async t => {
  const methods = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    methods.push([url, init.method]);
    if (init.method === 'POST') {
      assert.deepEqual(JSON.parse(init.body), { code: 'authorization-code' });
      return json({ session_id: sessionId, accounts: [{ uid: accountUid, account_id: { iban: 'SE4550000000058398257466' } }], aspsp: { name: 'Swedbank', country: 'SE' }, psu_type: 'business', access: { valid_until: '2027-01-01T00:00:00Z' } });
    }
    if (init.method === 'DELETE') return json({ message: 'OK' });
    return json({ status: 'AUTHORIZED', accounts: [accountUid], accounts_data: [{ uid: accountUid, identification_hash: 'hash' }], aspsp: { name: 'Swedbank', country: 'SE' }, psu_type: 'business', access: { valid_until: '2027-01-01T00:00:00Z' }, created: '2026-10-26T00:00:00Z' });
  });
  assert.equal((await createSession(config, 'authorization-code')).accounts[0].uid, accountUid);
  assert.equal((await getSession(config, sessionId)).accounts[0], accountUid);
  await deleteSession(config, sessionId);
  assert.deepEqual(methods.map(call => call[1]), ['POST', 'GET', 'DELETE']);
  assert.equal(methods[2][0], `https://api.enablebanking.com/sessions/${sessionId}`);
});

test('Closed accounts without a fetch uid do not block another accessible authorized account', async t => {
  const accessible = { uid: accountUid, currency: 'SEK', account_id: { iban: 'SE4550000000058398257466' } };
  const inactive = { currency: 'SEK', account_id: null, identification_hash: 'closed-account-primary-hash' };
  const authorized = accounts => ({ session_id: sessionId, accounts, aspsp: { name: 'Swedbank', country: 'SE' }, psu_type: 'business', access: { valid_until: '2027-01-01T00:00:00Z' } });
  t.mock.method(globalThis, 'fetch', async () => json(authorized([inactive, accessible, { ...inactive, uid: null }])));
  assert.deepEqual((await createSession(config, 'authorization-code')).accounts, [accessible]);
  t.mock.method(globalThis, 'fetch', async () => json(authorized([inactive])));
  assert.deepEqual((await createSession(config, 'authorization-code')).accounts, []);
  for (const uid of [42, '', 'not-a-valid-account-uid']) {
    t.mock.method(globalThis, 'fetch', async () => json(authorized([accessible, { ...inactive, uid }])));
    await assert.rejects(createSession(config, 'authorization-code'), error => error.code === 'INVALID_PROVIDER_RESPONSE');
  }
});

test('Transaction pagination encodes opaque keys, keeps dates and BOOK filter, and supplies real foreground headers only when present', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => { calls.push({ url: new URL(url), headers: init.headers }); return json({ transactions: [], continuation_key: calls.length === 1 ? 'a+/=?&next' : null }); });
  const first = await getTransactions(config, accountUid, { dateFrom: opts.dateFrom, dateTo: opts.dateTo, psu: { ipAddress: '192.0.2.1', userAgent: 'MG test' } });
  await getTransactions(config, accountUid, { dateFrom: opts.dateFrom, dateTo: opts.dateTo, continuationKey: first.continuation_key });
  assert.equal(calls[1].url.searchParams.get('continuation_key'), 'a+/=?&next');
  assert.equal(calls[1].url.searchParams.get('date_from'), opts.dateFrom);
  assert.equal(calls[1].url.searchParams.get('date_to'), opts.dateTo);
  assert.equal(calls[1].url.searchParams.get('transaction_status'), 'BOOK');
  assert.equal(calls[0].headers.get('Psu-Ip-Address'), '192.0.2.1');
  assert.equal(calls[0].headers.get('Psu-User-Agent'), 'MG test');
  assert.equal(calls[1].headers.has('Psu-Ip-Address'), false);
  assert.equal(calls[1].headers.has('Psu-User-Agent'), false);
});

test('Provider errors are classified without leaking upstream messages or retrying POST', async t => {
  const secret = 'account-id-and-private-secret'; let calls = 0;
  const cases = [
    [401, 'UNAUTHORIZED_ACCESS', 'PROVIDER_AUTHORIZATION_FAILED'],
    [409, 'EXPIRED_SESSION', 'BANK_RECONNECT_REQUIRED'],
    [429, 'ASPSP_RATE_LIMIT_EXCEEDED', 'BANK_RATE_LIMIT'],
    [422, 'PSU_HEADER_NOT_PROVIDED', 'BANK_USER_CONTEXT_REQUIRED'],
    [503, 'ASPSP_ERROR', 'BANK_SERVICE_ERROR'],
  ];
  for (const [status, error, expected] of cases) {
    t.mock.method(globalThis, 'fetch', async () => { calls++; return json({ error, message: secret, detail: { private: secret } }, status); });
    await assert.rejects(providerRequest(config, '/sessions', { method: 'POST', body: { code: 'test-code' } }), thrown => {
      assert.equal(thrown.code, expected); assert.ok(!thrown.message.includes(secret)); assert.ok(!JSON.stringify(thrown).includes(secret)); return true;
    });
  }
  assert.equal(calls, cases.length);
});

test('Response bounds and malformed success data fail before caller can import', async t => {
  t.mock.method(globalThis, 'fetch', async () => json({}, 200, { 'content-length': String(2 * 1024 * 1024 + 1) }));
  await assert.rejects(getApplication(config), error => error.code === 'RESPONSE_TOO_LARGE');
  t.mock.method(globalThis, 'fetch', async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)));
  await assert.rejects(getApplication(config), error => error.code === 'RESPONSE_TOO_LARGE');
  t.mock.method(globalThis, 'fetch', async () => json({ ...application, environment: 'pretend-production' }));
  await assert.rejects(getApplication(config), error => error.code === 'INVALID_PROVIDER_RESPONSE');
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>not JSON</html>'));
  await assert.rejects(getApplication(config), error => error.code === 'INVALID_PROVIDER_RESPONSE');
});

test('Worker-compatible manual redirects never forward bank credentials or authorization codes', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    calls++;
    if (init.redirect === 'error') throw new TypeError('Invalid redirect value');
    assert.equal(init.redirect, 'manual');
    return new Response(null, { status: 307, headers: { Location: 'https://untrusted.invalid/' } });
  });
  await assert.rejects(providerRequest(config, '/sessions', { method: 'POST', body: { code: 'test-code' } }), error => error.code === 'PROVIDER_REDIRECT_DENIED');
  assert.equal(calls, 1);
});

test('Transport diagnostics redact URLs and credentials while retaining the runtime failure', async t => {
  const diagnostics = [];
  t.mock.method(console, 'error', (...items) => diagnostics.push(items));
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Network connection lost https://api.enablebanking.com/application?code=private-code Bearer abc.def.ghi secret-value-long-enough-to-redact'); });
  await assert.rejects(getApplication(config), error => error.code === 'BANK_NETWORK_ERROR');
  assert.match(JSON.stringify(diagnostics), /Network connection lost/);
  for (const secret of ['api.enablebanking.com', 'private-code', 'abc.def.ghi', 'secret-value-long-enough-to-redact']) assert.ok(!JSON.stringify(diagnostics).includes(secret));
});

test('A stalled bank request is aborted with a safe timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let ready;
  const started = new Promise(resolve => { ready = resolve; });
  t.mock.method(globalThis, 'fetch', async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); ready();
  }));
  const request = getApplication(config);
  await started;
  t.mock.timers.tick(20_001);
  await assert.rejects(request, error => error.code === 'BANK_TIMEOUT' && error.retryable);
});

test('Stable account identity uses account numbers and never the session uid', () => {
  const a = { uid: accountUid, account_id: { iban: 'se45 5000 0000 0583 9825 7466' } };
  assert.equal(stableAccountKey(a, bank), opts.accountKey);
  assert.equal(stableAccountKey({ ...a, uid: sessionId }, bank), opts.accountKey);
  assert.equal(stableAccountKey({ uid: accountUid }, bank), null);
  assert.equal(stableAccountKey({ uid: accountUid, account_id: { other: { identification: '1234-567890', scheme_name: 'BBAN' } } }, bank), 'SE:swedbank:BBAN:1234567890');
  assert.notEqual(stableAccountKey({ uid: accountUid, account_id: { other: { identification: '1234-567890', scheme_name: 'BBAN' } } }, { name: 'Another Bank', country: 'SE' }), 'SE:swedbank:BBAN:1234567890');
});

test('Accounts without numbers use the full exact primary identification hash, scoped to bank and country', async () => {
  const prefix = 'WwpbCiJhY2NvdW50IiwKImFjY291bnRfaWQiLAoiaWJhbiIKXQpd.';
  const primary = prefix + 'E8GzhnnsFC7K+4e3YMYYKpyM83Zx6toXrjgcvPP/Lqc=';
  const bare = { uid: accountUid, currency: 'SEK', identification_hash: primary };
  const expected = async hash => 'enable-account:' + Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(['SE', 'swedbank', hash])))).toString('hex');
  const stable = stableAccountKey(bare, bank);
  assert.equal(stable, await expected(primary)); assert.equal(stable.length, 79);
  assert.equal(stableAccountKey({ ...bare, uid: sessionId }, bank), stable);
  assert.equal(stableAccountKey(bare, { ...bank, name: ' SWEDBANK ' }), stable);
  assert.notEqual(stableAccountKey(bare, { ...bank, country: 'FI' }), stable);
  assert.notEqual(stableAccountKey(bare, { ...bank, name: 'Another Bank' }), stable);
  for (const changed of [primary.toLowerCase(), primary.slice(0, -1), prefix + 'x'.repeat(1000), prefix + 'x'.repeat(1000) + 'A', prefix + 'x'.repeat(1000) + 'a']) {
    const actual = stableAccountKey({ ...bare, identification_hash: changed }, bank);
    assert.equal(actual, await expected(changed)); assert.notEqual(actual, stable); assert.ok(actual.length <= 100);
  }
  for (const identification_hash of ['', 'NOTPROVIDED', 'N/A', primary + ' ', primary + '\n', 'x'.repeat(4097)]) assert.equal(stableAccountKey({ ...bare, identification_hash }, bank), null);
  assert.equal(stableAccountKey({ uid: accountUid, identification_hashes: [primary] }, bank), null);
  assert.equal(stableAccountKey({ ...bare, account_id: { iban: 'SE4550000000058398257466' } }, bank), opts.accountKey);
});

test('Primary-hash account identity survives renewed session uids and deduplicates booked imports', async () => {
  const account = { uid: accountUid, currency: 'SEK', identification_hash: 'primary/Account+Hash.With=Case' };
  const firstKey = stableAccountKey(account, bank), nextKey = stableAccountKey({ ...account, uid: sessionId }, bank);
  assert.equal(firstKey, nextKey);
  const first = (await normalizeTransactions([rawTx()], { ...opts, accountKey: firstKey })).rows[0];
  const next = (await normalizeTransactions([rawTx({ transaction_id: 'session-dependent-detail-id' })], { ...opts, accountKey: nextKey })).rows[0];
  assert.equal(first.externalId, next.externalId);
  const state = applyCommand(applyCommand(emptyState(), { type: 'transactions.import', rows: [first] }).state, { type: 'transactions.import', rows: [next] }).state;
  assert.equal(state.transactions.length, 1); assert.equal(state.transactions[0].account, firstKey);
});

test('Only booked SEK magnitudes become exact integer cash flows with the correct counterparty', async () => {
  const result = await normalizeTransactions([rawTx(), rawTx({ entry_reference: 'debit', credit_debit_indicator: 'DBIT', creditor: { name: 'Leverantör AB' }, transaction_amount: { amount: '42.30', currency: 'SEK' } })], opts);
  assert.equal(result.rows[0].amount, 187500);
  assert.equal(result.rows[0].party, 'Exempelkund AB');
  assert.equal(result.rows[0].payerReference, '001019');
  assert.equal(result.rows[0].bankReference, 'BOOK-REF-001');
  assert.equal(result.rows[1].amount, -4230);
  assert.equal(result.rows[1].party, 'Leverantör AB');
  for (const row of result.rows) { assert.equal(row.verified, false); assert.equal(row.kind, 'unknown'); assert.equal(row.account, opts.accountKey); }
});

test('Pending, foreign, zero, malformed, negative, invalid calendar and out-of-period values cannot become imported payments', async () => {
  const result = await normalizeTransactions([
    rawTx({ status: 'PDNG' }), rawTx({ status: 'CNCL' }), rawTx({ transaction_amount: { currency: 'EUR', amount: '1.00' } }),
    rawTx({ transaction_amount: { currency: 'SEK', amount: '0.00' } }), rawTx({ transaction_amount: { currency: 'SEK', amount: '1,23' } }),
    rawTx({ transaction_amount: { currency: 'SEK', amount: '-20.00' } }), rawTx({ booking_date: '2026-02-30' }),
    rawTx({ booking_date: '2026-09-30' }), rawTx({ credit_debit_indicator: '???' }),
  ], opts);
  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.skipped, { pending: 2, nonSek: 1, invalid: 6, unstableId: 0 });
  assert.ok(result.warnings.some(w => w.includes('negativt API-belopp')));
});

test('Stable entry IDs survive changing transaction details ID and session uid, but are scoped per stable account', async () => {
  const first = (await normalizeTransactions([rawTx()], opts)).rows[0];
  const next = (await normalizeTransactions([rawTx({ transaction_id: 'different' })], { ...opts, accountLabel: 'Renamed account' })).rows[0];
  const other = (await normalizeTransactions([rawTx()], { ...opts, accountKey: 'iban:SE3550000000058398257467' })).rows[0];
  assert.equal(first.externalId, next.externalId);
  assert.notEqual(first.externalId, other.externalId);
  const state = applyCommand(applyCommand(emptyState(), { type: 'transactions.import', rows: [first] }).state, { type: 'transactions.import', rows: [next] }).state;
  assert.equal(state.transactions.length, 1);
});

test('Missing entry references are retained separately and held for duplicate review by the existing domain', async () => {
  const result = await normalizeTransactions([rawTx({ entry_reference: null }), rawTx({ entry_reference: 'NOTPROVIDED', transaction_id: 'a-fake-stable-id' })], opts);
  assert.equal(result.rows.length, 2);
  assert.equal(result.skipped.unstableId, 2);
  assert.ok(result.rows.every(row => row.externalId === '' && row.bankReference === '' && row.verified === false));
  const state = applyCommand(emptyState(), { type: 'transactions.import', rows: result.rows }).state;
  assert.equal(state.transactions.length, 2);
  assert.equal(state.transactions[1].duplicateOf, state.transactions[0].id);
});

test('Long entry references are hashed without truncation collisions; long payer references are not misrepresented', async () => {
  const prefix = 'x'.repeat(500);
  const result = await normalizeTransactions([rawTx({ entry_reference: prefix + 'a', reference_number: '9'.repeat(400) }), rawTx({ entry_reference: prefix + 'b' })], opts);
  assert.notEqual(result.rows[0].externalId, result.rows[1].externalId);
  assert.ok(result.rows.every(row => row.externalId.length < 300));
  assert.equal(result.rows[0].payerReference, '');
  assert.ok(result.warnings.some(w => w.includes('långa betalningsreferenser')));
});

test('Missing booking date uses only a valid documented value date with an explicit warning', async () => {
  const result = await normalizeTransactions([
    rawTx({ booking_date: null, value_date: '2026-10-19' }),
    rawTx({ booking_date: null, value_date: null, transaction_date: '2026-10-18' }),
    rawTx({ booking_date: '2026-02-30', value_date: '2026-10-17' }),
  ], opts);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].date, '2026-10-19');
  assert.equal(result.skipped.invalid, 2);
  assert.ok(result.warnings.some(w => w.includes('valutadatum')));
});

test('Bankgiro totals require payment specification and cannot become an ordinary verified payment', async () => {
  const result = await normalizeTransactions([rawTx({ remittance_information: ['BANKGIRO SAMLINGSINBETALNING'], reference_number: null, debtor: null })], opts);
  assert.equal(result.rows[0].kind, 'batch');
  assert.equal(result.rows[0].verified, false);
  assert.match(result.rows[0].description,/Betalardetaljer saknas – importera betalningsspecifikation/);
  assert.ok(result.warnings.some(w => w.includes('betalningsspecifikation')));
});

test('Bankgiro individual identity needs real payer and structured reference; explicit batches stay blocked', async()=>{
 const rows=await normalizeTransactions([
  rawTx({entry_reference:'real-individual',bank_transaction_code:{description:'Bankgiro inbetalning'}}),
  rawTx({entry_reference:'only-free-text',reference_number:null,bank_transaction_code:{description:'Bankgiro inbetalning'}}),
  rawTx({entry_reference:'generic-party',debtor:{name:'Bankgirot AB'},bank_transaction_code:{description:'Bankgiro inbetalning'}}),
  rawTx({entry_reference:'explicit-batch',bank_transaction_code:{description:'Samlad Bankgiroinbetalning'}}),
 ],opts);
 assert.deepEqual(rows.rows.map(row=>row.kind),['unknown','batch','batch','batch']);
 assert.ok(rows.rows.every(row=>!row.verified));
});


test('provider Retry-After keeps long waits and treats extreme values as blocked',async t=>{
 for(const [header,minimum,blocked] of [['172800',172800,false],[new Date(Date.now()+172800000).toUTCString(),172799,false],['999999999999999999999999',60,true],['invalid',60,false]]){
  t.mock.method(globalThis,'fetch',async()=>json({error:'ASPSP_RATE_LIMIT_EXCEEDED'},429,{'Retry-After':header}));
  await assert.rejects(providerRequest(config,'/application'),e=>e.code==='BANK_RATE_LIMIT'&&e.retryAfter>=minimum&&e.retryBlocked===blocked);
 }
});
