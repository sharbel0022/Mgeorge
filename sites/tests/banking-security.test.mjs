import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash, generateKeyPairSync } from 'node:crypto';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { emptyState } from '../lib/domain.ts';
import { bankUtcDate } from '../lib/banking/sync-periods.ts';
import { ProviderError } from '../lib/banking/enable-banking.ts';
import { ConsentError } from '../lib/bank-consent-policy.js';
import { seal, unseal, randomToken, digest, validFlowToken, cookieValue } from '../lib/banking/security.ts';
import { runtimeBankConfig, runtimeBankStatus } from '../lib/banking/runtime-config.ts';
import { confirmedBankConsent } from '../lib/banking/status-view.ts';
import { accountReadCooldown } from '../lib/banking/account-read-cooldown.ts';
import { applyCurrentMigrations, businessSql } from './helpers/company-compat-fixture.mjs';

// Exercise the real route services, encryption, domain and SQL. Only the identity
// provider and banking HTTP boundary are replaced. No test can call a live bank.
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const jsUrl = value => 'data:text/javascript;base64,' + Buffer.from(value).toString('base64');
function compiledModule(path, imports, jsx = ts.JsxEmit.Preserve) {
  imports = { '../bank-consent-policy.js': new URL('../lib/bank-consent-policy.js', import.meta.url).href, '../bank-company-authority.js': new URL('../lib/bank-company-authority.js', import.meta.url).href, './account-read-cooldown': new URL('../lib/banking/account-read-cooldown.ts', import.meta.url).href, './sync-periods': new URL('../lib/banking/sync-periods.ts', import.meta.url).href, '../payer-evidence.js': new URL('../lib/payer-evidence.js', import.meta.url).href, ...imports };
  let js = ts.transpileModule(source(path), { fileName: path, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx } }).outputText;
  for (const [name, replacement] of Object.entries(imports)) {
    for (const quote of ['"', "'"]) js = js.replaceAll(`${quote}${name}${quote}`, JSON.stringify(replacement));
  }
  return jsUrl(js);
}

class LocalD1 {
  constructor(sqlite) { this.sqlite = sqlite; this.beforeBatch = null; }
  prepare(sql) {
    const database = this;
    return {
      sql, values: [],
      bind(...values) { this.values = values; return this; },
      async first() { return database.sqlite.prepare(sql).get(...this.values) ?? null; },
      async all() { return { results: database.sqlite.prepare(sql).all(...this.values), success: true }; },
      async run() { return this.execute(); },
      execute() { const result = database.sqlite.prepare(sql).run(...this.values); return { success: true, meta: { changes: Number(result.changes) } }; },
    };
  }
  async batch(statements) {
    if (this.beforeBatch) await this.beforeBatch(statements);
    this.sqlite.exec('BEGIN');
    try {
      const results = statements.map(statement => statement.execute());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}

const appId = '11111111-1111-4111-8111-111111111111';
const accountUid = '22222222-2222-4222-8222-222222222222';
const remoteSession = '33333333-3333-4333-8333-333333333333';
const origin = 'https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site';
const redirect = `${origin}/api/bank/callback`;
const cookieName = '__Secure-mg-bank-flow';
const future = () => new Date(Date.now() + 86400_000).toISOString();
const rawTx = (patch = {}) => ({ entry_reference: 'BANK-001', transaction_amount: { amount: '1875.00', currency: 'SEK' }, credit_debit_indicator: 'CRDT', status: 'BOOK', booking_date: bankUtcDate(), debtor: { name: 'Example customer' }, reference_number: '10019', remittance_information: ['Invoice 1001'], ...patch });
const post = (path, body = {}, requestOrigin = origin, servedOrigin = origin) => new Request(`${servedOrigin}/api/bank/${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(requestOrigin === null ? {} : { Origin: requestOrigin }), 'CF-Connecting-IP': '192.0.2.1', 'User-Agent': 'MG local security tests' }, body: JSON.stringify(body),
});
const count = (f, table) => f.sql.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
const financialAuditCount = f => f.sql.prepare("SELECT count(*) AS n FROM audit_events WHERE action NOT LIKE 'bank.job.%'").get().n;
const bankJobEvents = f => f.sql.prepare("SELECT action,detail,created_at,revision FROM audit_events WHERE owner=? AND action LIKE 'bank.job.%' ORDER BY rowid").all(f.owner).map(row=>({...row,detail:JSON.parse(row.detail)}));

async function fixture(t, environment = 'PRODUCTION', { actualProvider = false, companyContext = false } = {}) {
  const key = `__mgBankTest_${crypto.randomUUID().replaceAll('-', '')}`;
  const sql = new DatabaseSync(':memory:');
  applyCurrentMigrations(sql);
  const f = { sql, owner: 'owner-alice', user: { userId: 'owner-alice' }, calls: [], provider: {}, env: {
    BANK_DATA_ENCRYPTION_KEY: randomToken(), ENABLE_BANKING_APPLICATION_ID: appId,
    ENABLE_BANKING_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nVEVTVC1PTkxZLU5PVC1SRUFM\n-----END PRIVATE KEY-----',
    ENABLE_BANKING_ENVIRONMENT: environment, ENABLE_BANKING_KEY_ROTATED: 'true', ENABLE_BANKING_REDIRECT_URL: redirect,
  } };
  f.d1 = new LocalD1(sql); f.env.DB = f.d1;
  globalThis[key] = f;
  t.after(() => { delete globalThis[key]; sql.close(); });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Live network access is forbidden in security tests'); });
  const cloudflare = jsUrl(`export const env=globalThis[${JSON.stringify(key)}].env;`);
  const auth = jsUrl(`export async function getChatGPTUser(){return globalThis[${JSON.stringify(key)}].user;}`);
  const domain = new URL('../lib/domain.ts', import.meta.url).href;
  const security = new URL('../lib/banking/security.ts', import.meta.url).href;
  const serverUrl = compiledModule('../lib/server.ts', {'./company-storage.js':new URL('../lib/company-storage.js',import.meta.url).href, 'cloudflare:workers': cloudflare, '@/app/chatgpt-auth': auth, './domain': domain });
  const runtimeConfig = new URL('../lib/banking/runtime-config.ts', import.meta.url).href;
  const normalizerUrl = compiledModule('../lib/banking/transactions.ts', { '../domain': domain, '../payment-references.js': new URL('../lib/payment-references.js', import.meta.url).href });
  const storeServerUrl = companyContext ? jsUrl(`export * from ${JSON.stringify(serverUrl)}; export function currentCompanyContext(){return globalThis[${JSON.stringify(key)}].companyContext??null;}`) : serverUrl;
  const storeUrl = compiledModule('../lib/banking/store.ts', { 'cloudflare:workers': cloudflare, '@/lib/server': storeServerUrl, './security': security, './runtime-config': runtimeConfig, './transactions': normalizerUrl });
  const providerFunctions = ['getApplication', 'listBusinessBanks', 'startAuth', 'createSession', 'getSession', 'deleteSession', 'getTransactions'];
  const providerUrl = actualProvider ? new URL('../lib/banking/enable-banking.ts', import.meta.url).href : jsUrl(`export {ProviderError,providerCooldownDiagnostic,providerErrorCode} from ${JSON.stringify(new URL('../lib/banking/enable-banking.ts', import.meta.url).href)};` + providerFunctions.map(name => `export async function ${name}(...args){const f=globalThis[${JSON.stringify(key)}];f.calls.push({name:${JSON.stringify(name)},args});return f.provider[${JSON.stringify(name)}](...args);}`).join('\n'));
  const readGuardUrl = compiledModule('../lib/banking/account-read-guard.ts', { '../server': serverUrl, './store': storeUrl, './enable-banking': providerUrl });
  const openPaymentsSchedulerUrl = compiledModule('../lib/banking/openpayments-scheduler.ts', { 'cloudflare:workers': cloudflare, '../server': serverUrl });
  const serviceUrl = compiledModule('../lib/banking/service.ts', { '@/lib/server': serverUrl, '@/lib/domain': domain, './enable-banking': providerUrl, './transactions': normalizerUrl, './store': storeUrl, './security': security, './runtime-config': runtimeConfig, './account-read-guard': readGuardUrl, './openpayments-scheduler':openPaymentsSchedulerUrl, './company-sync':jsUrl('export async function dispatchCompanyAutomaticSync(){return null;}'), '../bankgiro-ingest-service':jsUrl(`export async function runBankgiroSource(owner){globalThis[${JSON.stringify(key)}].reportOwner=owner;return {enabled:false,state:'DISABLED'};}`),'../customer-messages': jsUrl(`export async function reconcileAndPrepare(){if(globalThis[${JSON.stringify(key)}].reconcileError)throw Error('synthetic postprocessing failure');}`) });
  f.store = await import(storeUrl); f.service = await import(serviceUrl);
  f.mcp = await import(compiledModule('../lib/banking/mcp.ts', { './service': serviceUrl }));
  f.info = { name: 'Local test app', kid: appId, environment, active: true, redirect_urls: [redirect], countries: ['SE'], services: ['AIS'] };
  f.account = { uid: accountUid, name: 'Company account', currency: 'SEK', account_id: { iban: 'SE4550000000058398257466' } };
  f.bank = { name: 'Swedbank', country: 'SE', psu_types: ['business'], maximum_consent_validity: 15552000 };
  f.live = { status: 'AUTHORIZED', accounts: [accountUid], accounts_data: [{ uid: accountUid }], aspsp: { name: 'Swedbank', country: 'SE' }, psu_type: 'business', access: { valid_until: future() }, created: new Date().toISOString() };
  f.provider = {
    getApplication: async () => structuredClone(f.info),
    listBusinessBanks: async () => [structuredClone(f.bank)],
    startAuth: async (_config, options) => { f.auth = options; return { url: 'https://auth.enablebanking.com/ais/start?test=1' }; },
    createSession: async () => ({ session_id: remoteSession, accounts: [structuredClone(f.account)], aspsp: { name: 'Swedbank', country: 'SE' }, psu_type: 'business', access: { valid_until: future() } }),
    getSession: async () => structuredClone(f.live),
    deleteSession: async () => {},
    getTransactions: async () => ({ transactions: [rawTx()] }),
  };
  f.seedApp = async (owner = f.owner) => {
    const current = await f.store.application(owner);
    const encrypted = await f.store.encrypt(owner, 'key:generation-one', 'PRIVATE-TEST-KEY');
    sql.prepare('INSERT INTO bank_applications VALUES (?,?,?,?,?,?,?)').run(owner, appId, encrypted, JSON.stringify(f.info), current.generation, new Date().toISOString(), new Date().toISOString());
  };
  f.seedConnection = async (owner = f.owner) => {
    const id = `connection-${owner}`;
    const encryptedSession = await f.store.encrypt(owner, `session:${id}`, remoteSession);
    const encryptedAccounts = await f.store.encrypt(owner, `accounts:${id}`, [f.account]);
    sql.prepare('INSERT INTO bank_connections (id,owner,app_generation,environment,bank_name,country,encrypted_session,encrypted_accounts,selected_accounts,valid_until,date_from,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, owner, (await f.store.application(owner)).generation, environment, 'Swedbank', 'SE', encryptedSession, encryptedAccounts, JSON.stringify([accountUid]), future(), bankUtcDate(), 'connected', new Date().toISOString(), new Date().toISOString());
    return id;
  };
  f.start = async (options = {}, servedOrigin = origin) => {
    const response = await f.service.connect(post('connect', { bankName: 'Swedbank', country: 'SE', dateFrom: bankUtcDate(), ...options }, servedOrigin, servedOrigin));
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    f.flowCookie = cookie; f.flowState = f.auth.state;
    return response;
  };
  f.callbackRequest = (query = '', cookie = f.flowCookie) => new Request(`${redirect}?state=${f.flowState}&code=one-use-code${query}`, { headers: cookie ? { Cookie: cookie } : {} });
  f.workspace = () => { const row = sql.prepare('SELECT * FROM workspaces WHERE owner=?').get(f.owner); return row ? { ...row, state: JSON.parse(row.payload) } : null; };
  f.connection = () => sql.prepare('SELECT * FROM bank_connections WHERE owner=?').get(f.owner);
  return f;
}

test('hash-only company accounts can be selected and synchronized without duplicates after renewed account UIDs', async t => {
  const f = await fixture(t);
  f.account = { uid: accountUid, name: 'Company account', currency: 'SEK', identification_hash: 'opaque.primary+case/SensitiveHash=TEST' };
  companyAuthority(f, { accountKeys: ['enable-account:' + createHash('sha256').update(JSON.stringify(['SE', 'swedbank', f.account.identification_hash])).digest('hex')] });
  await f.seedApp(); await f.start();
  assert.equal((await f.service.callback(f.callbackRequest())).headers.get('location'), '/bank?result=select_account');
  let visible = await (await f.service.status(new Request(origin + '/api/bank/status'))).json();
  assert.equal(visible.connection.accounts[0].importable, true);
  assert.match(visible.connection.accounts[0].label, /kontonummer saknas/);
  assert.ok(!JSON.stringify(visible).includes('SensitiveHash'));
  const from = new Date(Date.parse(bankUtcDate() + 'T12:00:00Z') - 29 * 86400000).toISOString().slice(0, 10);
  await f.service.selectAccounts(post('accounts', { connectionId: visible.connection.id, accountUids: [accountUid], dateFrom: from }));
  assert.equal((await (await f.service.sync(post('sync'))).json()).imported, 1);
  assert.equal(f.workspace().state.transactions.length, 1);
  await f.service.disconnect(post('disconnect'));
  const renewedUid = '44444444-4444-4444-8444-444444444444';
  f.account.uid = renewedUid; f.live.accounts = [renewedUid]; f.live.accounts_data = [{ uid: renewedUid }];
  await f.start();
  assert.equal((await f.service.callback(f.callbackRequest())).headers.get('location'), '/bank?result=select_account');
  visible = await (await f.service.status(new Request(origin + '/api/bank/status'))).json();
  await f.service.selectAccounts(post('accounts', { connectionId: visible.connection.id, accountUids: [renewedUid], dateFrom: from }));
  assert.equal((await (await f.service.sync(post('sync'))).json()).imported, 0);
  assert.equal(f.workspace().state.transactions.length, 1);
});

test('Automatic fetching is opt-in and rejects foreign connection IDs and cross-origin changes', async t => {
  const f = await fixture(t); await f.seedApp(); const id = await f.seedConnection();
  assert.equal((await (await f.service.automaticSync()).json()).reason, 'disabled');
  assert.equal(f.calls.length, 0);
  await assert.rejects(f.service.setAutomaticSync(post('automatic', { enabled: true, connectionId: 'foreign' })), /företagets konto/);
  await assert.rejects(f.service.setAutomaticSync(post('automatic', { enabled: true, connectionId: id }, 'https://untrusted.invalid')), /ORIGIN_DENIED/);
  assert.equal(f.connection().auto_sync_enabled, 0);
  await f.service.setAutomaticSync(post('automatic', { enabled: true, connectionId: id }));
  assert.equal((await (await f.service.automaticSyncStatus()).json()).enabled, true);
});

test('company reconnect preserves the disconnected same-bank connection identity and requires new account selection',async t=>{
 const f=await fixture(t);companyAuthority(f);await f.seedApp();const id=await f.seedConnection();
 f.sql.prepare('INSERT INTO company_bank_sync_scopes(company_id,owner,evidence_id,created_at) VALUES(?,?,?,?)').run('synthetic-company',f.owner,'synthetic-membership-proof',Date.now());
 const retryAfter=new Date(Date.now()+3600000).toISOString();f.sql.prepare('UPDATE bank_connections SET retry_after=? WHERE owner=?').run(retryAfter,f.owner);
 await f.service.disconnect(post('disconnect'));
 const nextUid='44444444-4444-4444-8444-444444444444',nextSession='55555555-5555-4555-8555-555555555555';f.account.uid=nextUid;f.live.accounts=[nextUid];f.live.accounts_data=[{uid:nextUid}];
 f.provider.createSession=async()=>({session_id:nextSession,accounts:[structuredClone(f.account)],aspsp:{name:'Swedbank',country:'SE'},psu_type:'business',access:{valid_until:future()}});
 await f.start();assert.equal((await f.service.callback(f.callbackRequest())).headers.get('location'),'/bank?result=select_account');
 const conn=f.connection();assert.equal(conn.status,'pending_account');assert.equal(conn.id,id);assert.equal(await f.store.sessionId(conn),nextSession);assert.equal((await f.store.accounts(conn))[0].uid,nextUid);assert.equal(conn.selected_accounts,'[]');assert.equal(conn.auto_sync_enabled,0);assert.equal(conn.retry_after,retryAfter);
 await assert.rejects(f.service.selectAccounts(post('accounts',{connectionId:id,accountUids:[accountUid]})),/tillgängliga/);
 await f.service.selectAccounts(post('accounts',{connectionId:id,accountUids:[nextUid]}));assert.equal(f.connection().selected_accounts,JSON.stringify([nextUid]));
 await assert.rejects(f.service.sync(post('sync')),error=>error.status===409);
});

test('company reconnect never aliases a different provider environment to the prior connection',async t=>{
 const f=await fixture(t);companyAuthority(f);await f.seedApp();const id=await f.seedConnection();
 f.sql.prepare('INSERT INTO company_bank_sync_scopes(company_id,owner,evidence_id,created_at) VALUES(?,?,?,?)').run('synthetic-company',f.owner,'synthetic-membership-proof',Date.now());
 await f.service.disconnect(post('disconnect'));f.sql.prepare("UPDATE bank_connections SET environment='SANDBOX' WHERE owner=?").run(f.owner);
 await f.start();assert.equal((await f.service.callback(f.callbackRequest())).headers.get('location'),'/bank?result=select_account');assert.equal(f.connection().status,'pending_account');assert.notEqual(f.connection().id,id);assert.equal(f.connection().selected_accounts,'[]');
});

test('main control reserves a six-hour retry inside the bank lock without enabling automatic sync',async t=>{
  const f=await fixture(t);await f.seedApp();await f.seedConnection();
  f.provider.getTransactions=async()=>{throw new ProviderError('BANK_RATE_LIMIT','För många förfrågningar',429,true);};
  await assert.rejects(f.service.syncControl(post('sync')),e=>e.code==='BANK_RATE_LIMIT');
  const c=f.connection();assert.ok(c.control_last_attempt_at);assert.equal(c.auto_sync_enabled,0);assert.equal(c.auto_last_attempt_at,null);assert.equal(c.auto_next_at,null);assert.equal(c.last_synced_at,null);
  const calls=f.calls.length,again=await (await f.service.syncControl(post('sync'))).json();assert.equal(again.reason,'not_due');assert.equal(again.due,false);assert.equal(f.calls.length,calls);assert.equal(Date.parse(again.nextAttemptAt),Date.parse(c.control_last_attempt_at)+6*3600000);
  f.sql.prepare("UPDATE bank_connections SET control_last_attempt_at='2000-01-01',retry_after=''").run();f.provider.getTransactions=async()=>({transactions:[rawTx()]});assert.equal((await (await f.service.syncControl(post('sync'))).json()).imported,1);assert.equal(f.connection().auto_sync_enabled,0);
});

test('main control honors an interrupted reservation and keeps real PSU headers',async t=>{
  const f=await fixture(t);await f.seedApp();await f.seedConnection();
  f.sql.prepare('UPDATE bank_connections SET control_last_attempt_at=?').run(new Date().toISOString());assert.equal((await (await f.service.syncControl(post('sync'))).json()).reason,'not_due');assert.equal(f.calls.length,0);
  f.sql.prepare("UPDATE bank_connections SET control_last_attempt_at='2000-01-01'").run();await f.service.syncControl(post('sync'));
  assert.equal(f.calls.find(c=>c.name==='getTransactions').args[2].psu.ipAddress,'192.0.2.1');assert.equal(f.connection().auto_sync_enabled,0);
});

test('Hosted automatic sync uses no fabricated PSU context and replays cannot duplicate or refetch', async t => {
  const f = await fixture(t); await f.seedApp(); const id = await f.seedConnection();
  await f.service.setAutomaticSync(post('automatic', { enabled: true, connectionId: id }));
  const call = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'bank_auto_sync', arguments: {} } };
  const first = await (await f.mcp.bankRpc(call)).json();
  assert.equal(first.result.structuredContent.imported, 1);
  assert.equal(f.calls.find(call => call.name === 'getTransactions').args[2].psu, undefined);
  const before = f.calls.length;
  const second = await (await f.mcp.bankRpc(call)).json();
  assert.equal(second.result.structuredContent.reason, 'not_due'); assert.equal(f.calls.length, before);
  assert.equal(f.workspace().state.transactions.length, 1);
  assert.equal(f.connection().auto_next_at, f.service.nextAutomaticAttempt(Date.parse(f.connection().auto_last_attempt_at)));
  f.sql.prepare('UPDATE bank_connections SET auto_next_at=?,auto_last_attempt_at=?,last_synced_at=?').run('2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z');
  assert.equal((await (await f.service.automaticSync()).json()).imported, 0);
  assert.equal(f.workspace().state.transactions.length, 1);
});

test('Automatic slots stay fixed in Stockholm time across jitter, browser checks and daylight-saving changes', async t => {
  const f = await fixture(t);
  const next = at => f.service.nextAutomaticAttempt(Date.parse(at));
  assert.equal(next('2026-10-27T20:06:45Z'), '2026-10-28T02:06:00.000Z');
  assert.equal(next('2026-10-27T22:59:00Z'), '2026-10-28T02:06:00.000Z');
  assert.equal(next('2026-06-01T19:06:45Z'), '2026-06-02T01:06:00.000Z');
  assert.equal(next('2026-03-28T20:06:45Z'), '2026-03-29T01:06:00.000Z');
  assert.equal(next('2026-10-24T19:06:45Z'), '2026-10-25T02:06:00.000Z');
});

test('Automatic failure reserves its retry time, preserves data, and can be paused or disconnected', async t => {
  const f = await fixture(t); await f.seedApp(); const id = await f.seedConnection();
  await f.service.setAutomaticSync(post('automatic', { enabled: true, connectionId: id }));
  f.provider.getTransactions = async () => { throw new ProviderError('BANK_RATE_LIMIT', 'För många förfrågningar', 429, true); };
  await assert.rejects(f.service.automaticSync(), error => error.code === 'BANK_RATE_LIMIT');
  assert.equal(f.connection().last_synced_at, null); assert.match(f.connection().last_error, /förfrågningar/);
  const before = f.calls.length;
  assert.equal((await (await f.service.automaticSync()).json()).reason, 'not_due'); assert.equal(f.calls.length, before);
  assert.equal(count(f, 'workspaces'), 0);
  await f.service.setAutomaticSync(post('automatic', { enabled: false, connectionId: id }));
  assert.equal((await (await f.service.automaticSync()).json()).reason, 'disabled');
  await f.service.setAutomaticSync(post('automatic', { enabled: true, connectionId: id }));
  await f.service.disconnect(post('disconnect'));
  assert.equal(f.connection().auto_sync_enabled, 0);
  assert.equal((await (await f.service.automaticSync()).json()).reason, 'disabled');
});

test('Automatic catch-up overlaps the last successful fetch while preserving the chosen start date', async t => {
  const f = await fixture(t); await f.seedApp(); const id = await f.seedConnection();
  const daysAgo = n => new Date(Date.parse(bankUtcDate() + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10);
  f.sql.prepare('UPDATE bank_connections SET date_from=?,last_synced_at=?').run(daysAgo(29), daysAgo(2) + 'T12:00:00Z');
  await f.service.setAutomaticSync(post('automatic', { enabled: true, connectionId: id }));
  await f.service.automaticSync();
  const options = f.calls.find(call => call.name === 'getTransactions').args[2];
  assert.equal(options.dateFrom, daysAgo(5)); assert.equal(options.dateTo, bankUtcDate());
  assert.equal(f.connection().date_from, daysAgo(29));
});

test('MCP supports discovery but never accepts an owner override or unauthenticated bank operation', async t => {
  const f = await fixture(t); await f.seedApp(); await f.seedConnection();
  const list = await (await f.mcp.bankRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).json();
  for(const name of ['payment_evidence','retained_report_evidence'])assert.equal(list.result.tools.find(tool=>tool.name===name)?.annotations.readOnlyHint,true);
  assert.ok(list.result.tools.some(t=>t.name==='backup_step'));assert.ok(list.result.tools.some(t=>t.name==='backup_status'));assert.ok(!list.result.tools.some(t=>/send/.test(t.name)));
  assert.ok(list.result.tools.some(tool=>tool.name==='gmail_auto_sync'));
  const override = await (await f.mcp.bankRpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bank_auto_sync', arguments: { owner: f.owner, force: true } } })).json();
  assert.equal(override.error.code, -32602);
  f.user = null;
  const denied = await (await f.mcp.bankRpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'bank_auto_sync', arguments: {} } })).json();
  assert.equal(denied.result.isError, true); assert.match(denied.result.content[0].text, /Logga in/);
  assert.equal(f.calls.length, 0);
});

test('MCP authentication selects only its caller workspace and browser auto-sync keeps genuine PSU context', async t => {
  const f = await fixture(t); await f.seedApp(); const id = await f.seedConnection();
  await f.seedApp('owner-bob'); await f.seedConnection('owner-bob');
  await f.service.setAutomaticSync(post('automatic', { enabled: true, connectionId: id }));
  f.user = { userId: 'owner-bob' };
  assert.equal((await (await f.service.automaticSync()).json()).reason, 'disabled');
  assert.equal(f.calls.length, 0);
  f.user = { userId: f.owner };
  await f.service.automaticSync(post('auto-sync'));
  assert.deepEqual(f.calls.find(call => call.name === 'getTransactions').args[2].psu, { ipAddress: '192.0.2.1', userAgent: 'MG local security tests' });
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM workspaces WHERE owner=?').get('owner-bob').n, 0);
});

test('AES-GCM envelopes bind private values to the owner and purpose with fresh nonces', async () => {
  const key = randomToken(), value = { session: 'private-session', accounts: ['private-account'] };
  const a = await seal(key, 'alice', 'session:one', value), b = await seal(key, 'alice', 'session:one', value);
  assert.notEqual(a, b); assert.notEqual(a.split('.')[1], b.split('.')[1]);
  assert.ok(!a.includes('private-session'));
  assert.deepEqual(await unseal(key, 'alice', 'session:one', a), value);
  for (const [secret, owner, purpose] of [[randomToken(), 'alice', 'session:one'], [key, 'bob', 'session:one'], [key, 'alice', 'accounts:one'], [key, 'alice', 'session:two']]) {
    await assert.rejects(unseal(secret, owner, purpose, a), { message: 'BANK_SECRET_UNREADABLE' });
  }
});

test('Tampered ciphertext, IVs and malformed envelopes fail without exposing secrets or crypto errors', async () => {
  const key = randomToken(), encrypted = await seal(key, 'alice', 'key:one', 'PRIVATE-TEST-KEY');
  const [version, iv, body] = encrypted.split('.');
  const flip = value => { const bytes = Buffer.from(value, 'base64url'); bytes[0] ^= 1; return bytes.toString('base64url'); };
  for (const changed of [`${version}.${iv}.${flip(body)}`, `${version}.${flip(iv)}.${body}`, `v2.${iv}.${body}`, `v1.eA.${body}`, 'plain-private-key', `${encrypted}.extra`]) {
    await assert.rejects(unseal(key, 'alice', 'key:one', changed), { message: 'BANK_SECRET_UNREADABLE' });
  }
  await assert.rejects(seal('not-a-256-bit-key', 'alice', 'key:one', 'private'), { message: 'BANK_STORAGE_UNAVAILABLE' });
});

test('Flow tokens are 256-bit URL-safe values and ambiguous cookies are rejected', async () => {
  const first = randomToken(), second = randomToken();
  assert.equal(Buffer.from(first, 'base64url').length, 32); assert.notEqual(first, second);
  assert.equal(validFlowToken(first), true);
  for (const value of [null, '', `${first}=`, first.slice(1), `${first.slice(0, -1)}+`]) assert.equal(validFlowToken(value), false);
  assert.equal(await digest(first), await digest(first)); assert.notEqual(await digest(first), first);
  const request = cookie => new Request(origin, { headers: { Cookie: cookie } });
  assert.equal(cookieValue(request(`unrelated=x; ${cookieName}=${first}`), cookieName), first);
  assert.equal(cookieValue(request(`${cookieName}=${first}; ${cookieName}=${second}`), cookieName), '');
  assert.equal(cookieValue(request(`${cookieName}suffix=${first}`), cookieName), '');
});

test('Mutation services enforce real signed-in identity and exact same-origin before banking access', async t => {
  const f = await fixture(t);
  for (const otherOrigin of ['https://evil.example', `${origin}.evil.example`, 'null', null]) {
    await assert.rejects(f.service.removeConfig(post('config', {}, otherOrigin)), { message: 'ORIGIN_DENIED' });
  }
  f.user = null;
  await assert.rejects(f.service.removeConfig(post('config')), { message: 'AUTH_REQUIRED' });
  assert.equal(f.calls.length, 0); assert.equal(count(f, 'bank_locks'), 0);
  f.user = { userId: f.owner };
  assert.equal((await f.service.removeConfig(post('config'))).status, 200);
});

test('Owner locks exclude concurrent mutations, allow other owners and release after errors', async t => {
  const f = await fixture(t);
  f.user = { userId: 'alice' };
  await f.store.withBankLock('alice', async () => {
    await assert.rejects(f.store.withBankLock('alice', async () => 'unexpected'), { message: 'BANK_BUSY' });
    f.user = { userId: 'bob' };
    try { assert.equal(await f.store.withBankLock('bob', async () => 'other-owner'), 'other-owner'); }
    finally { f.user = { userId: 'alice' }; }
  });
  await assert.rejects(f.store.withBankLock('alice', async () => { throw new Error('task failed'); }), /task failed/);
  assert.equal(count(f, 'bank_locks'), 0);
});

test('A stale invocation cannot release a replacement lock acquired after lease expiry', async t => {
  const f = await fixture(t);
  f.user = { userId: 'alice' };
  let releaseReplacement, replacementStarted;
  const gate = new Promise(resolve => { releaseReplacement = resolve; });
  const started = new Promise(resolve => { replacementStarted = resolve; });
  let replacement;
  await f.store.withBankLock('alice', async () => {
    f.sql.prepare('UPDATE bank_locks SET expires_at=? WHERE owner=?').run('2000-01-01T00:00:00Z', 'alice');
    replacement = f.store.withBankLock('alice', async () => { replacementStarted(); await gate; });
    await started;
  });
  assert.equal(count(f, 'bank_locks'), 1);
  releaseReplacement(); await replacement;
  assert.equal(count(f, 'bank_locks'), 0);
});

test('Runtime credentials never use legacy D1 keys; account lists and connection status stay owner-bound', async t => {
  const f = await fixture(t); await f.seedApp(); await f.seedConnection();
  assert.ok(await f.store.application('owner-bob')); assert.equal(await f.store.connection('owner-bob'), null);
  const app = await f.store.application(f.owner), conn = await f.store.connection(f.owner);
  const config = await f.store.providerConfig({ ...app, encrypted_key: 'tampered-legacy-key-never-read' });
  assert.equal(config.privateKeyPem, f.env.ENABLE_BANKING_PRIVATE_KEY);
  assert.equal(app.encrypted_key, '');
  await assert.rejects(f.store.accounts({ ...conn, owner: 'owner-bob' }), /BANK_SECRET_UNREADABLE/);
  const text = await (await f.service.status(new Request(`${origin}/api/bank/status`))).text();
  for (const secret of ['PRIVATE-TEST-KEY', f.env.ENABLE_BANKING_PRIVATE_KEY, remoteSession, 'SE4550000000058398257466', conn.encrypted_session]) assert.ok(!text.includes(secret));
  f.user = { userId: 'owner-bob' };
  const other = await (await f.service.status(new Request(`${origin}/api/bank/status`))).json();
  assert.equal(other.configured, true); assert.equal(other.connection, null);
});

test('Explicit status refresh replaces stale activation and redirect metadata while ordinary reads stay local', async t => {
  const f = await fixture(t);
  f.info.active = false; f.info.redirect_urls = ['https://old.example.test/callback'];
  await f.seedApp(); await f.seedApp('owner-bob');
  const originalApp = await f.store.application(f.owner);
  f.info.active = true; f.info.redirect_urls = [redirect];
  const ordinary = await (await f.service.status(new Request(`${origin}/api/bank/status`))).json();
  assert.equal(ordinary.application.active, false); assert.equal(ordinary.application.redirectConfigured, false);
  assert.equal(f.calls.length, 0);

  const refreshed = await (await f.service.status(new Request(`${origin}/api/bank/status?refresh=1`))).json();
  assert.equal(refreshed.application.active, true); assert.equal(refreshed.application.redirectConfigured, true);
  assert.deepEqual(f.calls.map(call => call.name), ['getApplication']);
  const updatedApp = await f.store.application(f.owner);
  assert.deepEqual(JSON.parse(updatedApp.metadata), f.info);
  assert.equal(updatedApp.encrypted_key, originalApp.encrypted_key); assert.equal(updatedApp.generation, originalApp.generation);
  // Inspect the retained row directly: Alice's service cannot read Bob's key
  // metadata, and refreshing Alice must still leave Bob's metadata unchanged.
  const otherApp = JSON.parse(f.sql.prepare('SELECT metadata FROM bank_applications WHERE owner=?').get('owner-bob').metadata);
  assert.equal(otherApp.active, false); assert.deepEqual(otherApp.redirect_urls, ['https://old.example.test/callback']);

  const cached = await (await f.service.status(new Request(`${origin}/api/bank/status`))).json();
  assert.equal(cached.application.active, true); assert.equal(cached.application.redirectConfigured, true);
  assert.equal(f.calls.length, 1);
});

test('Authorization stores state and cookie hashes, sets secure callback-only cookie and accepts one callback only', async t => {
  const f = await fixture(t); companyAuthority(f); await f.seedApp();
  const start = await f.start(), cookie = start.headers.get('set-cookie');
  for (const attribute of ['Path=/api/bank/callback', 'Secure', 'HttpOnly', 'SameSite=Lax', 'Max-Age=900']) assert.ok(cookie.includes(attribute));
  const flow = f.sql.prepare('SELECT * FROM bank_auth_flows').get();
  assert.equal(flow.state_hash, await digest(f.flowState));
  assert.equal(flow.cookie_hash, await digest(f.flowCookie.split('=')[1]));
  assert.ok(!JSON.stringify(flow).includes(f.flowState)); assert.ok(!JSON.stringify(flow).includes(f.flowCookie.split('=')[1]));
  const accepted = await f.service.callback(f.callbackRequest());
  assert.equal(accepted.status, 303); assert.equal(accepted.headers.get('location'), '/bank?result=select_account');
  assert.ok(accepted.headers.get('set-cookie').includes('Max-Age=0'));
  assert.equal(f.sql.prepare('SELECT status FROM bank_auth_flows').get().status, 'completed');
  const replay = await f.service.callback(f.callbackRequest());
  assert.equal(replay.headers.get('location'), '/bank?result=expired');
  assert.equal(f.calls.filter(call => call.name === 'createSession').length, 1);
  assert.equal(count(f, 'bank_connections'), 1);
});

test('Callback rejects missing or ambiguous state, wrong browser, owner, expired flow and replaced application', async t => {
  const f = await fixture(t); await f.seedApp(); await f.start();
  const checks = [f.callbackRequest('', ''), f.callbackRequest(`&state=${f.flowState}`), f.callbackRequest('', `${f.flowCookie}; ${f.flowCookie}`)];
  for (const request of checks) assert.equal((await f.service.callback(request)).headers.get('location'), '/bank?result=expired');
  assert.equal((await f.service.callback(f.callbackRequest('', `${f.flowCookie.split('=')[0]}=${randomToken()}`))).headers.get('location'), '/bank?result=wrong_user');
  f.user = { userId: 'owner-bob' };
  // The company boundary conceals another owner's flow altogether. The generic
  // expired result preserves denial without revealing that the flow exists.
  assert.equal((await f.service.callback(f.callbackRequest())).headers.get('location'), '/bank?result=expired');
  f.user = { userId: f.owner };
  f.env.ENABLE_BANKING_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nUk9UQVRFRC1URVNULU9OTFk=\n-----END PRIVATE KEY-----';
  assert.equal((await f.service.callback(f.callbackRequest())).headers.get('location'), '/bank?result=expired');
  f.sql.prepare('UPDATE bank_auth_flows SET expires_at=?').run('2000-01-01T00:00:00Z');
  assert.equal((await f.service.callback(f.callbackRequest())).headers.get('location'), '/bank?result=expired');
  assert.equal(f.calls.filter(call => call.name === 'createSession').length, 0); assert.equal(count(f, 'bank_connections'), 0);
});

test('Unverified session accounts cause revocation and cannot become a local connection', async t => {
  const f = await fixture(t); await f.seedApp(); await f.start();
  f.live.accounts = ['44444444-4444-4444-8444-444444444444'];
  const response = await f.service.callback(f.callbackRequest());
  assert.equal(response.headers.get('location'), '/bank?result=failed');
  assert.equal(count(f, 'bank_connections'), 0);
  assert.equal(f.calls.filter(call => call.name === 'deleteSession').length, 1);
  assert.equal(f.sql.prepare('SELECT status FROM bank_auth_flows').get().status, 'failed');
});

test('Selections and sync cannot retrieve accounts outside the current authorized session', async t => {
  const f = await fixture(t); await f.seedApp(); const id = await f.seedConnection();
  await assert.rejects(f.service.selectAccounts(post('accounts', { connectionId: id, accountUids: ['foreign-account'] })), /SEK-konton/);
  assert.deepEqual(JSON.parse(f.connection().selected_accounts), [accountUid]);
  f.live.accounts = [];
  await assert.rejects(f.service.sync(post('sync')), error => error.code === 'BANK_ACCOUNT_SCOPE_INVALID');
  assert.equal(f.calls.filter(call => call.name === 'getTransactions').length, 0); assert.equal(count(f, 'workspaces'), 0);
});

test('Sandbox sync reads test data but never touches financial workspace or financial audit', async t => {
  const f = await fixture(t, 'SANDBOX'); await f.seedApp(); await f.seedConnection();
  const old = emptyState(); old.company.name = 'Existing live company';
  f.sql.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run(f.owner, 7, JSON.stringify(old), '2026-01-01T00:00:00Z');
  const before = f.workspace();
  const result = await (await f.service.sync(post('sync'))).json();
  assert.equal(result.test, true); assert.equal(result.imported, 0);
  assert.deepEqual(f.workspace(), before); assert.equal(financialAuditCount(f), 0);
  assert.equal(f.sql.prepare('SELECT test FROM bank_sync_runs').get().test, 1);
  assert.ok(result.warnings.some(warning => warning.includes('testhändelser')));
});

test('Production import and audit commit together; repeated stable references are not imported twice', async t => {
  const f = await fixture(t); await f.seedApp(); await f.seedConnection();
  let result = await (await f.service.sync(post('sync'))).json();
  assert.equal(result.imported, 1); assert.equal(result.test, false);
  const first = f.workspace();
  assert.equal(first.revision, 1); assert.equal(first.state.transactions.length, 1);
  assert.equal(first.state.transactions[0].verified, true); assert.equal(first.state.transactions[0].kind, 'payment');assert.equal(first.state.transactions[0].evidence,'bank_api');
  assert.equal(f.sql.prepare("SELECT revision FROM audit_events WHERE action='bank.sync'").get().revision, 1);
  f.sql.prepare('UPDATE bank_connections SET last_synced_at=NULL').run();
  result = await (await f.service.sync(post('sync'))).json();
  assert.equal(result.imported, 0); assert.equal(result.skipped, 1);
  assert.equal(f.workspace().state.transactions.length, 1);
});

test('Missing stable transaction IDs preserve all rows and repeat imports flag review instead of discarding payments', async t => {
  const f = await fixture(t); await f.seedApp(); await f.seedConnection();
  f.provider.getTransactions = async () => ({ transactions: [rawTx({ entry_reference: undefined }), rawTx({ entry_reference: undefined })] });
  assert.equal((await (await f.service.sync(post('sync'))).json()).imported, 2);
  let rows = f.workspace().state.transactions;
  assert.equal(rows.length, 2); assert.equal(rows[0].externalId, ''); assert.equal(rows[1].duplicateOf, rows[0].id);
  f.sql.prepare('UPDATE bank_connections SET last_synced_at=NULL').run();
  assert.equal((await (await f.service.sync(post('sync'))).json()).imported, 2);
  rows = f.workspace().state.transactions;
  assert.equal(rows.length, 4); assert.equal(rows.filter(row => row.duplicateOf).length, 3);
  assert.ok(rows.every(row => !row.verified && row.kind === 'unknown'));
});

test('A later pagination failure cannot commit earlier pages or claim a successful sync', async t => {
  const f = await fixture(t); await f.seedApp(); await f.seedConnection();
  f.provider.getTransactions = async (_config, _id, options) => {
    if (!options.continuationKey) return { transactions: [rawTx()], continuation_key: 'next-page' };
    throw new ProviderError('BANK_TIMEOUT', 'Banktjänsten svarade inte i tid.', 504, true);
  };
  await assert.rejects(f.service.sync(post('sync')), error => error.code === 'BANK_TIMEOUT');
  assert.equal(count(f, 'workspaces'), 0); assert.equal(financialAuditCount(f), 0); assert.equal(count(f, 'bank_sync_runs'), 0);
  assert.equal(f.connection().last_synced_at, null);
});

test('Optimistic revision conflict preserves a concurrent workspace edit and writes no misleading audit or run', async t => {
  const f = await fixture(t); await f.seedApp(); await f.seedConnection();
  f.sql.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run(f.owner, 3, JSON.stringify(emptyState()), new Date().toISOString());
  const edited = emptyState(); edited.company.name = 'Concurrent user edit';
  f.d1.beforeBatch = async statements => {
    if (!statements.some(statement => statement.values.includes('bank.sync'))) return;
    f.d1.beforeBatch = null;
    f.sql.prepare('UPDATE workspaces SET revision=4,payload=? WHERE owner=?').run(JSON.stringify(edited), f.owner);
  };
  await assert.rejects(f.service.sync(post('sync')), error => error.status === 409);
  assert.equal(f.workspace().revision, 4); assert.equal(f.workspace().state.company.name, 'Concurrent user edit');
  assert.equal(f.workspace().state.transactions.length, 0); assert.equal(financialAuditCount(f), 0); assert.equal(count(f, 'bank_sync_runs'), 0);
  assert.equal(f.connection().last_synced_at, null);
});

test('A failed sync-run insert rolls back both financial data and its audit entry', async t => {
  const f = await fixture(t); await f.seedApp(); await f.seedConnection();
  f.sql.exec("CREATE TRIGGER fail_sync_run BEFORE INSERT ON bank_sync_runs BEGIN SELECT RAISE(ABORT, 'simulated database failure'); END;");
  await assert.rejects(f.service.sync(post('sync')), /simulated database failure/);
  assert.equal(f.workspace().revision, 0); assert.equal(f.workspace().state.transactions.length, 0);
  assert.equal(financialAuditCount(f), 0); assert.equal(count(f, 'bank_sync_runs'), 0); assert.equal(f.connection().last_synced_at, null);
});

test('A terminal provider error leaves the connection requiring authorization', async t => {
  const f = await fixture(t); await f.seedApp(); await f.seedConnection();
  f.provider.getSession = async () => { throw new ProviderError('BANK_RECONNECT_REQUIRED', 'Bankmedgivandet har avslutats.', 409); };
  await assert.rejects(f.service.sync(post('sync')), error => error.code === 'BANK_RECONNECT_REQUIRED');
  assert.equal(f.connection().status, 'reauth_required');
  assert.equal(f.calls.filter(call => call.name === 'getTransactions').length, 0);
});

test('A revoked session status cannot be overwritten as connected by failure handling', async t => {
  const f = await fixture(t); await f.seedApp(); await f.seedConnection(); f.live.status = 'REVOKED';
  await assert.rejects(f.service.sync(post('sync')), /medgivande/);
  assert.equal(f.connection().status, 'reauth_required');
  assert.equal(f.calls.filter(call => call.name === 'getTransactions').length, 0);
});

test('Disconnect retains credentials on an unconfirmed failure and clears them when session is already gone', async t => {
  const f = await fixture(t); await f.seedApp(); await f.seedConnection();
  f.provider.deleteSession = async () => { throw new ProviderError('BANK_TIMEOUT', 'Banktjänsten svarade inte i tid.', 504, true); };
  await assert.rejects(f.service.disconnect(post('disconnect')), error => error.code === 'BANK_TIMEOUT');
  assert.ok(f.connection().encrypted_session); assert.equal(f.connection().status, 'revocation_pending');
  f.provider.deleteSession = async () => { throw new ProviderError('BANK_RECONNECT_REQUIRED', 'Bankmedgivandet har avslutats.', 409); };
  assert.equal((await f.service.disconnect(post('disconnect'))).status, 200);
  assert.equal(f.connection().status, 'disconnected'); assert.equal(f.connection().encrypted_session, ''); assert.equal(f.connection().encrypted_accounts, '');
});

test('Production configuration requires an explicit environment and rotation before accessing the runtime key', () => {
  assert.equal(runtimeBankStatus({}).configured, false);
  const blocked = new Proxy({ ENABLE_BANKING_ENVIRONMENT: 'PRODUCTION', ENABLE_BANKING_KEY_ROTATED: 'false' }, {
    get(target, name) { if (name === 'ENABLE_BANKING_PRIVATE_KEY') throw new Error('must not read an unrotated key'); return target[name]; },
  });
  assert.throws(() => runtimeBankConfig(blocked), error => error.code === 'BANK_KEY_ROTATION_REQUIRED');
  const env = { ENABLE_BANKING_ENVIRONMENT: 'PRODUCTION', ENABLE_BANKING_KEY_ROTATED: 'true', ENABLE_BANKING_APPLICATION_ID: appId, ENABLE_BANKING_PRIVATE_KEY: 'not-a-key' };
  assert.equal(runtimeBankStatus(env).configured, false);
  assert.equal(runtimeBankStatus(env).code, 'BANK_RUNTIME_CONFIGURATION_INVALID');
  assert.ok(!JSON.stringify(runtimeBankStatus(env)).includes('not-a-key'));
});

test('Browser credential uploads are rejected before the body is read, with no provider call or D1 key write', async t => {
  const f = await fixture(t);
  const request = post('config', { applicationId: appId, privateKeyPem: 'client-secret-that-must-never-be-saved' });
  Object.defineProperty(request, 'body', { get() { throw new Error('request body must not be read'); } });
  await assert.rejects(f.service.saveConfig(request), error => error.status === 405 && !error.message.includes('client-secret'));
  assert.equal(count(f, 'bank_applications'), 0); assert.equal(f.calls.length, 0);
  const component = source('../components/bank-connection.tsx');
  for (const forbidden of ['privateKeyPem', 'readKey', 'keyFilename', 'FileKey2', 'saveConfiguration', '/api/bank/config']) assert.ok(!component.includes(forbidden));
  assert.ok(component.includes('Koppla banken')); assert.ok(component.includes('Importera bankfil istället'));
});

test('Legacy D1 keys cannot authorize any provider call when runtime configuration or rotation is absent', async t => {
  const f = await fixture(t); await f.seedApp(); await f.seedConnection();
  delete f.env.ENABLE_BANKING_PRIVATE_KEY;
  assert.equal(await f.store.application(f.owner), null);
  await assert.rejects(f.service.connect(post('connect', { bankName: 'Swedbank', country: 'SE', dateFrom: bankUtcDate() })), /systemadministratören/);
  await assert.rejects(f.service.sync(post('sync')), /giltig bankanslutning/);
  const status = await (await f.service.status(new Request(origin + '/api/bank/status'))).json();
  assert.equal(status.configured, false); assert.equal(status.connection.status, 'reauth_required');
  assert.equal(status.connection.connectionStatus, 'configuration_required');
  assert.equal(status.connection.blockedReason, 'BANK_CONFIGURATION_REQUIRED');
  assert.equal(status.connection.nextAction, 'configure_service');
  assert.equal(f.calls.length, 0);
  f.env.ENABLE_BANKING_KEY_ROTATED = 'false';
  assert.equal(f.store.configurationStatus().code, 'BANK_KEY_ROTATION_REQUIRED');
});

test('Runtime app readiness checks provider environment, AIS, Swedish access, exact callback and activation', async t => {
  const f = await fixture(t);
  for (const patch of [{ environment: 'SANDBOX' }, { active: false }, { services: ['PIS'] }, { countries: ['FI'] }, { redirect_urls: [redirect + '/'] }, { kid: accountUid }]) {
    const base = structuredClone(f.info); Object.assign(f.info, patch);
    await assert.rejects(f.service.banks(new Request(origin + '/api/bank/banks')), /systemadministratören/);
    Object.assign(f.info, base);
  }
  assert.equal(f.calls.filter(call => call.name === 'startAuth').length, 0);
  assert.equal(f.calls.filter(call => call.name === 'listBusinessBanks').length, 0);
  const ready = await (await f.service.banks(new Request(origin + '/api/bank/banks'))).json();
  assert.equal(ready.banks[0].name, 'Swedbank');
  assert.equal(f.sql.prepare('SELECT encrypted_key FROM bank_applications WHERE owner=?').get(f.owner).encrypted_key, '');
});

test('Explicit disconnect of a legacy connection never uses its key and reports the manual revocation requirement', async t => {
  const f = await fixture(t); await f.seedApp(); await f.seedConnection();
  delete f.env.ENABLE_BANKING_PRIVATE_KEY;
  const result = await (await f.service.disconnect(post('disconnect'))).json();
  assert.equal(result.remoteRevoked, false); assert.match(result.message, /Återkalla det hos Swedbank/);
  assert.equal(f.calls.length, 0); assert.equal(f.connection().status, 'disconnected');
  assert.equal(f.connection().encrypted_session, ''); assert.equal(f.sql.prepare('SELECT encrypted_key FROM bank_applications').get().encrypted_key, '');
});

test('A forged connected query cannot claim bank consent without a current unexpired server connection', () => {
  const at = Date.parse('2026-10-27T12:00:00Z');
  const server = { configured: true, storageReady: true, connection: { status: 'connected', validUntil: '2026-10-28T12:00:00Z' } };
  for (const status of [null, undefined, {}, { configured: true, storageReady: true, connection: null }, { ...server, configured: false }, { ...server, storageReady: false }, ...['disconnected', 'reauth_required', 'expired', 'pending'].map(status => ({ ...server, connection: { ...server.connection, status } })), ...['', 'not-a-date', '2026-10-27T12:00:00Z', '2026-10-26T12:00:00Z'].map(validUntil => ({ ...server, connection: { ...server.connection, validUntil } }))]) assert.equal(confirmedBankConsent(status, at), false);
  assert.equal(confirmedBankConsent(server, at), true);
  const component = source('../components/bank-connection.tsx');
  assert.match(component, /const verified = await loadStatus\(\)/);
  assert.match(component, /if \(cancelled \|\| !alive\.current \|\| demoMode\.current\) return/);
  assert.match(component, /if \(confirmedBankConsent\(verified\)\) setNotice\(resultMessages\.connected\)/);
  assert.match(component, /cancelled = true/);
  assert.match(component, /date\.setUTCDate\(date\.getUTCDate\(\) - 29\)/);
});


test('delayed bank responses cannot write or release a replacement lease',async t=>{
 const f=await fixture(t);await f.seedApp();await f.seedConnection();
 f.provider.getTransactions=async()=>{f.sql.prepare("UPDATE bank_locks SET token='replacement',expires_at=?").run(future());return{transactions:[rawTx()]};};
 await assert.rejects(f.service.sync(post('sync')),/BANK_LEASE_LOST/);
 assert.equal(f.workspace(),null);assert.equal(count(f,'bank_sync_runs'),0);assert.equal(f.connection().last_synced_at,null);assert.equal(f.connection().last_error,null);assert.equal(f.sql.prepare('SELECT token FROM bank_locks').get().token,'replacement');
});

test('D1 atomically fences bank writes even when a lease changes after a valid assertion',async t=>{
 const f=await fixture(t);await f.seedApp();await f.seedConnection();
 f.d1.beforeBatch=items=>{if(items.some(i=>businessSql(i.sql).startsWith('INSERT OR IGNORE INTO workspaces'))){f.sql.prepare("UPDATE bank_locks SET token='replacement',expires_at=?").run(future());}};
 await assert.rejects(f.service.sync(post('sync')),/BANK_LEASE_LOST/);
 assert.equal(f.workspace(),null);assert.equal(financialAuditCount(f),0);assert.equal(count(f,'bank_sync_runs'),0);assert.equal(f.connection().last_synced_at,null);
});

test('expired bank leases and delayed disconnects cannot overwrite a replacement connection',async t=>{
 const f=await fixture(t);await f.seedApp();await f.seedConnection();
 f.provider.getTransactions=async()=>{f.sql.prepare("UPDATE bank_locks SET expires_at='2000-01-01'").run();return{transactions:[rawTx()]};};
 await assert.rejects(f.service.sync(post('sync')),/BANK_LEASE_LOST/);assert.equal(f.workspace(),null);
 f.provider.deleteSession=async()=>{f.sql.prepare("UPDATE bank_locks SET token='replacement',expires_at=?").run(future());f.sql.prepare("UPDATE bank_connections SET id='new-connection',last_error='new owner'").run();};
 await assert.rejects(f.service.disconnect(post('disconnect')),/BANK_LEASE_LOST/);
 assert.equal(f.connection().id,'new-connection');assert.equal(f.connection().last_error,'new owner');assert.ok(f.connection().encrypted_session);
});

test('delayed bank OAuth cannot overwrite a replacement flow or connection',async t=>{
 const f=await fixture(t);await f.seedApp();await f.start();
 f.provider.createSession=async()=>{f.sql.prepare("UPDATE bank_locks SET token='replacement',expires_at=?").run(future());f.sql.prepare("UPDATE bank_auth_flows SET status='pending'").run();return{session_id:remoteSession,accounts:[structuredClone(f.account)],aspsp:{name:'Swedbank',country:'SE'},psu_type:'business',access:{valid_until:future()}};};
 assert.equal((await f.service.callback(f.callbackRequest())).headers.get('location'),'/bank?result=failed');
 assert.equal(count(f,'bank_connections'),0);assert.equal(f.sql.prepare('SELECT status FROM bank_auth_flows').get().status,'pending');assert.equal(f.sql.prepare('SELECT token FROM bank_locks').get().token,'replacement');
});

test('bank Retry-After persists and blocks manual, control and automatic retries',async t=>{
 const f=await fixture(t);await f.seedApp();const id=await f.seedConnection();await f.service.setAutomaticSync(post('automatic',{enabled:true,connectionId:id}));
 f.provider.getTransactions=async()=>{throw Object.assign(new ProviderError('BANK_RATE_LIMIT','Vänta',429,true),{retryAfter:172800});};
 await assert.rejects(f.service.automaticSync(),e=>e.code==='BANK_RATE_LIMIT');
 assert.ok(Date.parse(f.connection().retry_after)>Date.now()+172799000);const calls=f.calls.length;
 await assert.rejects(f.service.sync(post('sync')),e=>e.code==='BANK_RATE_LIMIT'&&e.retryAfter>=172799);
 assert.equal((await (await f.service.syncControl(post('sync'))).json()).reason,'not_due');
 assert.equal((await (await f.service.automaticSync()).json()).reason,'not_due');assert.equal(f.calls.length,calls);
 const status=await(await f.service.automaticSyncStatus()).json();assert.equal(status.nextAttemptAt,f.connection().retry_after);
});

test('three failed or interrupted automatic bank attempts remain blocked until a manual success',async t=>{
 const f=await fixture(t);await f.seedApp();const id=await f.seedConnection();await f.service.setAutomaticSync(post('automatic',{enabled:true,connectionId:id}));
 f.provider.getTransactions=async()=>{throw new ProviderError('BANK_TIMEOUT','Tillfälligt fel',504,true);};
 for(let n=1;n<=3;n++){f.sql.prepare('UPDATE bank_connections SET auto_last_attempt_at=NULL,auto_next_at=NULL').run();await assert.rejects(f.service.automaticSync());assert.equal(f.connection().sync_failures,n);}
 assert.equal((await(await f.service.automaticSync()).json()).reason,'blocked');assert.equal((await(await f.service.automaticSyncStatus()).json()).blocked,true);assert.match(f.connection().last_error,/tre/);
 const calls=f.calls.length;await f.service.automaticSync();assert.equal(f.calls.length,calls);
 f.provider.getTransactions=async()=>({transactions:[rawTx()]});await f.service.sync(post('sync'));assert.equal(f.connection().sync_failures,0);assert.equal(f.connection().last_error,null);
});


test('committed bank imports stay successful if the independent after-check needs retrying',async t=>{
 const f=await fixture(t);await f.seedApp();const id=await f.seedConnection();await f.service.setAutomaticSync(post('automatic',{enabled:true,connectionId:id}));f.reconcileError=true;
 const result=await(await f.service.automaticSync()).json();assert.equal(result.imported,1);assert.ok(result.warnings.some(w=>w.includes('Efterkontrollen')));assert.equal(f.connection().last_error,null);assert.equal(f.connection().sync_failures,0);assert.equal(count(f,'bank_sync_runs'),1);assert.equal(financialAuditCount(f),1);
 const visible=await(await f.service.status(new Request(origin+'/api/bank/status'))).json();assert.match(visible.connection.postprocessWarning,/Efterkontrollen/);assert.ok(visible.connection.lastSyncedAt);assert.equal(visible.automatic.failures,0);assert.match((await(await f.service.automaticSyncStatus()).json()).postprocessWarning,/Efterkontrollen/);
 f.reconcileError=false;f.sql.prepare('UPDATE bank_connections SET last_synced_at=NULL').run();await f.service.sync(post('sync'));assert.equal((await(await f.service.status(new Request(origin+'/api/bank/status'))).json()).connection.postprocessWarning,null);
});

test('Swedbank period rejection is recovered with complete non-overlapping shorter windows',async t=>{
 const f=await fixture(t);await f.seedApp();await f.seedConnection();
 f.sql.prepare('UPDATE bank_connections SET date_from=?').run('2026-01-01');
 const ranges=[];
 f.provider.getTransactions=async(_config,_id,input)=>{
  ranges.push({...input});
  if(Date.parse(input.dateTo)-Date.parse(input.dateFrom)>30*86400000)throw new ProviderError('BANK_PERIOD_UNAVAILABLE','Period unavailable',400);
  return{transactions:[rawTx({entry_reference:'WINDOW-'+input.dateFrom,booking_date:input.dateFrom})]};
 };
 const result=await(await f.service.sync(post('sync'))).json();
 assert.ok(result.imported>1);assert.ok(ranges.length<=25);
 const successful=ranges.filter(x=>Date.parse(x.dateTo)-Date.parse(x.dateFrom)<=30*86400000);
 assert.equal(successful[0].dateFrom,'2026-01-01');assert.equal(successful.at(-1).dateTo,new Date().toISOString().slice(0,10));
 for(let i=1;i<successful.length;i++)assert.equal(Date.parse(successful[i].dateFrom)-Date.parse(successful[i-1].dateTo),86400000);
 assert.equal(JSON.parse(f.sql.prepare('SELECT payload FROM workspaces WHERE owner=?').get(f.owner).payload).transactions.length,successful.length);assert.ok(f.connection().last_synced_at);
});

test('manual updates use the successful overlap instead of repeatedly requesting old history',async t=>{
 const f=await fixture(t);await f.seedApp();await f.seedConnection();
 const end=new Date().toISOString().slice(0,10),last=new Date(Date.parse(end+'T12:00:00Z')-2*86400000).toISOString(),expected=new Date(Date.parse(end+'T12:00:00Z')-5*86400000).toISOString().slice(0,10);
 f.sql.prepare('UPDATE bank_connections SET date_from=?,last_synced_at=?').run('2026-01-01',last);
 await f.service.sync(post('sync'));
 const input=f.calls.find(x=>x.name==='getTransactions').args[2];
 assert.equal(input.dateFrom,expected);assert.equal(input.dateTo,end);assert.equal(f.connection().date_from,'2026-01-01');
});

test('saving an older date or different account scope resets incremental coverage',async t=>{
 const f=await fixture(t);await f.seedApp();const id=await f.seedConnection();
 f.sql.prepare('UPDATE bank_connections SET last_synced_at=?').run(new Date(Date.now()-3600000).toISOString());
 await f.service.selectAccounts(post('accounts',{connectionId:id,accountUids:[accountUid],dateFrom:'2026-01-01'}));
 assert.equal(f.connection().last_synced_at,null);
});

test('invalid stored bank dates fail before any provider request or cursor change',async t=>{
 const f=await fixture(t);await f.seedApp();await f.seedConnection();
 f.sql.prepare("UPDATE bank_connections SET date_from='2026-02-30'").run();
 await assert.rejects(f.service.sync(post('sync')),/datum|period/i);
 assert.equal(f.calls.length,0);assert.equal(f.connection().last_synced_at,null);assert.equal(count(f,'bank_sync_runs'),0);
});

test('lost lease after session response prevents even the next bank request',async t=>{
 const f=await fixture(t);await f.seedApp();await f.seedConnection();
 f.provider.getSession=async()=>{f.sql.prepare("UPDATE bank_locks SET token='other-run',expires_at=?").run(future());return structuredClone(f.live);};
 await assert.rejects(f.service.sync(post('sync')),/BANK_LEASE_LOST/);
 assert.equal(f.calls.filter(x=>x.name==='getTransactions').length,0);assert.equal(f.connection().last_synced_at,null);
});

test('Retry-After is exposed as an HTTP header as well as a safe admin message',async t=>{
 const f=await fixture(t),error=Object.assign(new ProviderError('BANK_RATE_LIMIT','Vänta på banken',429,true),{retryAfter:172800});
 const result=f.service.bankFailure(error);
 assert.equal(result.status,429);assert.equal(result.headers.get('retry-after'),'172800');assert.equal((await result.json()).retryAfter,172800);
});

test('historical window failure preserves saved money and restarts without duplicate rows',async t=>{
 const f=await fixture(t);await f.seedApp();const id=await f.seedConnection();
 await f.service.sync(post('sync'));const before=f.workspace();
 await f.service.selectAccounts(post('accounts',{connectionId:id,accountUids:[accountUid],dateFrom:'2026-01-01'}));
 const history=rawTx({entry_reference:'HISTORY-1',booking_date:'2026-01-10'}),current=rawTx();let fail=true;
 f.provider.getTransactions=async(_config,_id,input)=>{
  if(fail&&input.dateFrom>'2026-03-01')throw new ProviderError('BANK_TIMEOUT','Banken svarade inte',504,true);
  return{transactions:[history,current].filter(row=>row.booking_date>=input.dateFrom&&row.booking_date<=input.dateTo)};
 };
 await assert.rejects(f.service.sync(post('sync')),e=>e.code==='BANK_TIMEOUT');
 assert.deepEqual(f.workspace(),before);assert.equal(f.connection().last_synced_at,null);assert.equal(count(f,'bank_sync_runs'),1);
 fail=false;const resumed=await(await f.service.sync(post('sync'))).json();
 assert.equal(resumed.imported,1);assert.equal(f.workspace().state.transactions.length,2);
 f.sql.prepare('UPDATE bank_connections SET last_synced_at=NULL').run();
 assert.equal((await(await f.service.sync(post('sync'))).json()).imported,0);assert.equal(f.workspace().state.transactions.length,2);
});

for(const [label,patch]of [
 ['malformed amount',{transaction_amount:{amount:'broken',currency:'SEK'}}],
 ['zero amount',{transaction_amount:{amount:'0.00',currency:'SEK'}}],
 ['invalid booking date',{booking_date:'2026-02-30'}],
 ['booking date outside the requested window',{booking_date:'2025-12-31'}],
])test(`an invalid historical BOOK row with ${label} preserves success coverage for a complete retry`,async t=>{
 const f=await fixture(t);await f.seedApp();const id=await f.seedConnection();
 await f.service.sync(post('sync'));
 await f.service.selectAccounts(post('accounts',{connectionId:id,accountUids:[accountUid],dateFrom:'2026-01-01'}));
 const before=f.workspace(),runs=count(f,'bank_sync_runs'),audits=financialAuditCount(f);
 const valid=rawTx({entry_reference:'HISTORY-VALID',booking_date:'2026-01-10'}),repaired=rawTx({entry_reference:'HISTORY-REPAIRED',booking_date:'2026-01-11'});
 let invalid=true;
 f.provider.getTransactions=async(_config,_id,input)=>({transactions:input.dateFrom==='2026-01-01'?[valid,invalid?{...repaired,...patch}:repaired]:[]});
 await assert.rejects(f.service.sync(post('sync')),e=>e.code==='BANK_INCOMPLETE_RESPONSE');
 assert.deepEqual(f.workspace(),before);assert.equal(count(f,'bank_sync_runs'),runs);assert.equal(financialAuditCount(f),audits);assert.equal(f.connection().last_synced_at,null);
 invalid=false;f.calls=[];
 const resumed=await(await f.service.sync(post('sync'))).json();
 assert.equal(f.calls.find(call=>call.name==='getTransactions').args[2].dateFrom,'2026-01-01');
 assert.equal(resumed.imported,2);assert.equal(f.workspace().state.transactions.length,3);assert.ok(f.connection().last_synced_at);
});

test('documented pending and foreign-currency skips can complete a bank interval',async t=>{
 const f=await fixture(t);await f.seedApp();await f.seedConnection();
 f.provider.getTransactions=async()=>({transactions:[rawTx(),rawTx({entry_reference:'PENDING',status:'PDNG'}),rawTx({entry_reference:'FOREIGN',transaction_amount:{amount:'10.00',currency:'EUR'}})]});
 const result=await(await f.service.sync(post('sync'))).json();
 assert.equal(result.imported,1);assert.equal(result.skipped,2);assert.equal(f.workspace().state.transactions.length,1);assert.ok(f.connection().last_synced_at);
});

test('recovered bank history retains one financial receipt and truthful evidence in the paginated payment view',async t=>{
 const end=new Date().toISOString().slice(0,10),date=offset=>new Date(Date.parse(end)+offset*86400000).toISOString().slice(0,10);
 const f=await fixture(t,'PRODUCTION',{actualProvider:true});
 f.env.ENABLE_BANKING_PRIVATE_KEY=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}}).privateKey;
 await f.seedApp();const id=await f.seedConnection();
 const original=rawTx({entry_reference:'SYNTHETIC-FLOW-B-001',booking_date:date(-6),transaction_amount:{amount:'625.00',currency:'SEK'},debtor:{name:'Bankens verkliga betalare AB'},reference_number:undefined,payment_reference:'000427',remittance_information:[]});
 const received=JSON.parse(JSON.stringify(original)),ranges=[];
 t.mock.method(globalThis,'fetch',async(input,options)=>{
  const target=new URL(input);assert.equal(target.origin,'https://api.enablebanking.com');assert.equal(options.method,'GET');assert.match(options.headers.get('Authorization'),/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  if(target.pathname===`/sessions/${remoteSession}`)return Response.json(f.live);
  assert.equal(target.pathname,`/accounts/${accountUid}/transactions`);assert.equal(target.searchParams.get('transaction_status'),'BOOK');
  const from=target.searchParams.get('date_from'),to=target.searchParams.get('date_to'),cursor=target.searchParams.get('continuation_key');ranges.push([from,to,cursor]);
  if(Date.parse(to)-Date.parse(from)>4*86400000)return Response.json({error:'WRONG_TRANSACTIONS_PERIOD'},{status:400});
  if(from<=received.booking_date&&to>=received.booking_date)return Response.json(cursor?{transactions:[received]}:{transactions:[],continuation_key:'history-ready'});
  return Response.json({transactions:[]});
 });
 await f.service.selectAccounts(post('accounts',{connectionId:id,accountUids:[accountUid],dateFrom:date(-8)}));
 const first=await(await f.service.sync(post('sync'))).json();
 assert.equal(first.imported,1);assert.deepEqual(ranges,[[date(-8),end,null],[date(-8),date(-5),null],[date(-8),date(-5),'history-ready'],[date(-4),date(-1),null],[end,end,null]]);
 const saved=f.workspace().state.transactions[0],receipt=createHash('sha256').update(JSON.stringify(received)).digest('hex');
 assert.equal(saved.amount,62500);assert.equal(saved.payerReference,'000427');assert.equal(saved.bankReference,'SYNTHETIC-FLOW-B-001');assert.equal(saved.bankDataVersion,'bank-api-original-v1');assert.equal(saved.bankDataSha256,receipt);assert.deepEqual(saved.bankData,received);assert.ok(saved.referenceEvidence.candidates.some(candidate=>candidate.value==='000427'&&candidate.kind!=='ocr'));
 // Widen the historical scope through the real account-selection service so
 // the same observed payment is fetched again, rather than bypassing the cursor.
 await f.service.selectAccounts(post('accounts',{connectionId:id,accountUids:[accountUid],dateFrom:date(-9)}));ranges.length=0;
 const repeated=await(await f.service.sync(post('sync'))).json(),persisted=f.workspace().state;
 assert.equal(repeated.imported,0);assert.deepEqual(ranges,[[date(-9),end,null],[date(-9),date(-5),null],[date(-9),date(-5),'history-ready'],[date(-4),end,null]]);
 assert.equal(persisted.transactions.length,1);assert.equal(persisted.transactions.reduce((sum,row)=>sum+row.amount,0),62500);assert.deepEqual(persisted.transactions[0],saved);assert.equal(persisted.allocations.length,0);assert.equal(count(f,'bank_sync_runs'),2);
 const viewImports={'react':import.meta.resolve('react'),'react/jsx-runtime':import.meta.resolve('react/jsx-runtime'),'./domain':new URL('../lib/domain.ts',import.meta.url).href,'@/lib/domain':new URL('../lib/domain.ts',import.meta.url).href,'./reconciliation-engine.js':new URL('../lib/reconciliation-engine.js',import.meta.url).href,'./payment-references.js':new URL('../lib/payment-references.js',import.meta.url).href};
 const presentation=compiledModule('../lib/payment-presentation.ts',viewImports),pagination=compiledModule('../components/list-pagination.tsx',viewImports,ts.JsxEmit.ReactJSX);
 const component=await import(compiledModule('../components/bank-payments.tsx',{...viewImports,'@/lib/payment-presentation':presentation,'./list-pagination':pagination,'./bankgiro-availability':compiledModule('../components/bankgiro-availability.tsx',viewImports,ts.JsxEmit.ReactJSX)},ts.JsxEmit.ReactJSX));
 const before=JSON.stringify(persisted),html=renderToStaticMarkup(React.createElement(component.default,{state:persisted,transactions:persisted.transactions,candidates:{[saved.id]:[{number:'0712',party:'Fakturakund som inte är bankbetalaren AB',identifiers:[{field:'reference',value:'000427'}]}]},open(){throw Error('Rendering cannot change money');}}));
 const [desktop,mobile]=html.split('<div class="bank-mobile-list"');assert.equal((desktop.match(/<tr\b[^>]*data-economic="true"[^>]*>/g)||[]).length,1);assert.equal((mobile.match(/class="bank-payment-card"/g)||[]).length,1);
 for(const layout of [desktop,mobile]){assert.match(layout,/Bankens verkliga betalare AB/);assert.match(layout,/<strong class="mono">000427<\/strong>/);assert.match(layout,/<span class="bank-reference-label">Betalningsreferens<\/span>/);assert.match(layout,/Bank-OCR saknas\./);assert.match(layout,/Möjlig: 0712/);assert.match(layout,/inte verifierat av bankens OCR/);assert.doesNotMatch(layout,/Fakturakund som inte är bankbetalaren|is-verified/);}
 assert.match(html,/Bankbetalningar – sidnavigering/);assert.match(html,/Visar 1–1 av 1 bankbetalningar/);assert.match(html,/Sida 1 av 1/);assert.equal(JSON.stringify(persisted),before);
});

test('rate limit encountered after period adjustment persists a cooldown without importing partial history',async t=>{
 const f=await fixture(t);await f.seedApp();const id=await f.seedConnection();
 f.sql.prepare("UPDATE bank_connections SET date_from='2026-10-01'").run();
 await f.service.setAutomaticSync(post('automatic',{enabled:true,connectionId:id}));let calls=0;
 f.provider.getTransactions=async()=>{calls++;if(calls===1)throw new ProviderError('BANK_PERIOD_UNAVAILABLE','unavailable',400);throw Object.assign(new ProviderError('BANK_RATE_LIMIT','Vänta',429,true),{retryAfter:172800});};
 const before=Date.now();await assert.rejects(f.service.automaticSync(),e=>e.code==='BANK_RATE_LIMIT');
 assert.equal(calls,2);assert.ok(Date.parse(f.connection().retry_after)>=before+172800000);assert.equal(f.connection().last_synced_at,null);assert.equal(f.workspace(),null);
 assert.equal((await(await f.service.automaticSync()).json()).reason,'not_due');assert.equal(calls,2);
});

test('unavailable history has bounded attempts and retains the failed period in admin status',async t=>{
 const f=await fixture(t);await f.seedApp();await f.seedConnection();f.sql.prepare("UPDATE bank_connections SET date_from='2026-01-01'").run();
 f.provider.getTransactions=async()=>{throw new ProviderError('BANK_PERIOD_UNAVAILABLE','unavailable',400);};
 await assert.rejects(f.service.sync(post('sync')),e=>e.code==='BANK_PERIOD_UNAVAILABLE');
 assert.equal(f.calls.filter(x=>x.name==='getTransactions').length,7);assert.equal(f.connection().last_synced_at,null);assert.equal(count(f,'bank_sync_runs'),0);
 const status=await(await f.service.status(new Request(origin+'/api/bank/status'))).json();
 assert.match(status.connection.lastError,/2026-01-01/);assert.match(status.connection.lastError,/tidigare historik finns kvar/);
});

test('bank date inputs use the provider UTC day while timestamps remain displayed in Sweden',()=>{
 const component=source('../components/bank-connection.tsx'),body=component.match(/function localDate\(date = new Date\(\)\) \{([^\n]+)\}/)[1];
 const actual=new Function('date',body);
 assert.equal(actual(new Date('2026-12-31T23:30:00Z')),'2026-12-31');assert.equal(actual(new Date('2026-03-29T22:30:00Z')),'2026-03-29');
});

test('provider maintenance Retry-After blocks subsequent syncs without losing history',async t=>{
 const f=await fixture(t);await f.seedApp();await f.seedConnection();
 f.provider.getTransactions=async()=>{throw Object.assign(new ProviderError('BANK_SERVICE_ERROR','Tillfälligt underhåll',503,true),{retryAfter:172800});};
 const before=Date.now();await assert.rejects(f.service.sync(post('sync')),e=>e.code==='BANK_SERVICE_ERROR');
 assert.ok(Date.parse(f.connection().retry_after)>=before+172800000);const calls=f.calls.length;
 await assert.rejects(f.service.sync(post('sync')),e=>e.code==='BANK_RATE_LIMIT');assert.equal(f.calls.length,calls);assert.equal(f.connection().last_synced_at,null);
});

test('consent expiring during pagination stops before another request and preserves the checkpoint',async t=>{
 const f=await fixture(t);await f.seedApp();await f.seedConnection();
 const at=Date.now();f.live.access.valid_until=new Date(at+30000).toISOString();let calls=0;
 f.provider.getTransactions=async()=>{calls++;if(calls===1){t.mock.timers.enable({apis:['Date'],now:at+60000});return{transactions:[rawTx()],continuation_key:'after-expiry'};}return{transactions:[]};};
 await assert.rejects(f.service.sync(post('sync')),e=>e.code==='BANK_RECONNECT_REQUIRED');
 assert.equal(calls,1);assert.equal(f.connection().status,'reauth_required');assert.equal(f.connection().last_synced_at,null);assert.equal(f.workspace(),null);assert.equal(count(f,'bank_sync_runs'),0);
});

for(const retryAfter of [null,'120'])test('actual sync throttling retains '+(retryAfter===null?'unknown':'known')+' account-read advice across a later successful transaction sync',async t=>{
 const f=await fixture(t,'PRODUCTION',{actualProvider:true});
 f.env.ENABLE_BANKING_PRIVATE_KEY=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}}).privateKey;
 await f.seedApp();await f.seedConnection();let limited=true;
 t.mock.method(globalThis,'fetch',async address=>{
  const path=new URL(address).pathname;
  if(path===`/sessions/${remoteSession}`)return Response.json(f.live);
  assert.equal(path,`/accounts/${accountUid}/transactions`);
  return limited?new Response('',{status:429,headers:retryAfter===null?{}:{'Retry-After':retryAfter}}):Response.json({transactions:[]});
 });
 await assert.rejects(f.service.sync(post('sync')),error=>error.code==='BANK_RATE_LIMIT');
 const guard=f.connection().account_evidence_retry;
 assert.ok(guard,'the response provenance must be persisted, separately from fallback retry_after');
 assert.equal(JSON.parse(guard).status,retryAfter===null?'unknown':'known');
 limited=false;f.sql.exec("UPDATE bank_connections SET retry_after=''");
 await f.service.sync(post('sync'));
 assert.equal(f.connection().account_evidence_retry,guard,'successful transaction reads cannot resolve a distinct account-details wait');
 assert.ok(f.connection().last_synced_at);
});

for(const stage of ['session','transactions'])for(const failure of ['result save','lease loss'])for(const priorKnown of [false,true])test(`sync ${stage} retains a pending read guard after ${failure} with ${priorKnown?'an older known deadline':'no prior wait'}`,async t=>{
 const f=await fixture(t,'PRODUCTION',{actualProvider:true});
 f.env.ENABLE_BANKING_PRIVATE_KEY=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}}).privateKey;
 await f.seedApp();await f.seedConnection();let failing=false,pending='',calls=[];
 t.mock.method(globalThis,'fetch',async address=>{
  const path=new URL(address).pathname;calls.push(path);
  const currentStage=path===`/sessions/${remoteSession}`?'session':'transactions';
  if(currentStage==='transactions')assert.equal(path,`/accounts/${accountUid}/transactions`);
  if(failing&&currentStage===stage){
   pending=f.connection().account_evidence_retry;
   if(failure==='lease loss')f.sql.prepare("UPDATE bank_locks SET token='synthetic-replacement',expires_at=?").run(future());
   else f.d1.beforeBatch=statements=>{if(statements.some(statement=>statement.sql.includes('account_evidence_retry'))){f.d1.beforeBatch=null;throw Error('Synthetic result save failed');}};
   return new Response('',{status:429});
  }
  return Response.json(currentStage==='session'?f.live:{transactions:[rawTx()]});
 });
 await f.service.sync(post('sync'));const original=f.workspace(),runs=count(f,'bank_sync_runs');
 f.sql.prepare('UPDATE bank_connections SET last_synced_at=NULL,account_evidence_retry=?').run(priorKnown?JSON.stringify({status:'known',checkedAt:new Date().toISOString(),notBefore:new Date(Date.now()+120000).toISOString(),provenance:'retry_after_seconds'}):'');
 failing=true;calls=[];await assert.rejects(f.service.sync(post('sync')));
 const saved=f.connection().account_evidence_retry;
 assert.ok(pending,'uncertainty must be durable before contacting the provider');assert.equal(JSON.parse(pending).status,'pending');assert.equal(saved,pending);
 assert.equal(accountReadCooldown(saved,Date.now()+180000).blocked,true,'the older deadline cannot release an unresolved result');
 assert.deepEqual(f.workspace(),original);assert.equal(f.connection().last_synced_at,null);assert.equal(count(f,'bank_sync_runs'),runs);
 assert.equal(calls.length,stage==='session'?1:2);
 if(failure==='lease loss')assert.equal(f.sql.prepare('SELECT token FROM bank_locks').get().token,'synthetic-replacement');
});

for(const mode of ['manual','automatic','control'])test(`bank job audit records the ${mode} attempt before provider work and completes it with the imported run`,async t=>{
 const f=await fixture(t);await f.seedApp();const id=await f.seedConnection();
 if(mode==='automatic')await f.service.setAutomaticSync(post('automatic',{enabled:true,connectionId:id}));
 let reached,resume;const ready=new Promise(resolve=>{reached=resolve;}),gate=new Promise(resolve=>{resume=resolve;});
 f.provider.getSession=async()=>{reached();await gate;return structuredClone(f.live);};
 const run=()=>mode==='automatic'?f.service.automaticSync():mode==='control'?f.service.syncControl(post('sync')):f.service.sync(post('sync'));
 const pending=run();await ready;const started=bankJobEvents(f);
 try{
  assert.equal(started.length,1);assert.equal(started[0].action,'bank.job.started');
  assert.deepEqual(Object.keys(started[0].detail).sort(),['connection_id','mode','run_id']);assert.equal(started[0].detail.connection_id,id);assert.equal(started[0].detail.mode,mode);assert.match(started[0].detail.run_id,/^[a-f0-9-]{36}$/);
  assert.ok(Number.isFinite(Date.parse(started[0].created_at)));assert.equal(f.connection().last_synced_at,null);
  await assert.rejects(run(),/BANK_BUSY/);assert.deepEqual(bankJobEvents(f),started,'a blocked overlap is not another attempt');
 }finally{resume();await pending.catch(()=>{});}
 assert.equal((await(await pending).json()).imported,1);
 const events=bankJobEvents(f);assert.deepEqual(events.map(event=>event.action),['bank.job.started','bank.job.completed']);
 assert.deepEqual(events[1].detail,started[0].detail);assert.equal(events[1].detail.run_id,f.sql.prepare('SELECT id FROM bank_sync_runs').get().id);
 assert.equal(events[1].revision,f.workspace().revision);assert.ok(f.connection().last_synced_at);
});

for(const [label,makeError,expected]of [
 ['rate limit',()=>Object.assign(new ProviderError('BANK_RATE_LIMIT','PRIVATE_PROVIDER_REFERENCE',429,true),{retryAfter:172800}),'BANK_RATE_LIMIT'],
 ['timeout',()=>new ProviderError('BANK_TIMEOUT','PRIVATE_PROVIDER_REFERENCE',504,true),'BANK_TIMEOUT'],
 ['mutated public field',()=>Object.assign(new ProviderError('BANK_TIMEOUT','PRIVATE_PROVIDER_REFERENCE',504,true),{code:'PRIVATE_PROVIDER_REFERENCE'}),'BANK_TIMEOUT'],
 ['unrecognized provider',()=>new ProviderError('PRIVATE_PROVIDER_REFERENCE','PRIVATE_PROVIDER_REFERENCE',502),'BANK_SYNC_FAILED'],
 ['untrusted error',()=>Object.assign(Error('PRIVATE_PROVIDER_REFERENCE'),{code:'BANK_RATE_LIMIT'}),'BANK_SYNC_FAILED'],
])test(`failed bank job audit keeps a safe ${label} code and the previous success timestamp`,async t=>{
 const f=await fixture(t);await f.seedApp();await f.seedConnection();const previous=new Date(Date.now()-120000).toISOString();
 f.sql.prepare('UPDATE bank_connections SET last_synced_at=?').run(previous);f.provider.getTransactions=async()=>{throw makeError();};
 await assert.rejects(f.service.sync(post('sync')));
 const events=bankJobEvents(f);assert.deepEqual(events.map(event=>event.action),['bank.job.started','bank.job.failed']);
 assert.deepEqual(events[1].detail,{run_id:events[0].detail.run_id,connection_id:f.connection().id,mode:'manual',error_code:expected});
 assert.equal(JSON.stringify(events).includes('PRIVATE_PROVIDER_REFERENCE'),false);assert.equal(f.connection().last_synced_at,previous);assert.equal(count(f,'bank_sync_runs'),0);
 assert.doesNotMatch(f.connection().last_error, /PRIVATE_PROVIDER_REFERENCE/);
});

test('bank completion audit failure rolls back the import instead of leaving a false success receipt',async t=>{
 const f=await fixture(t);await f.seedApp();await f.seedConnection();
 f.sql.exec("CREATE TRIGGER fail_completion_event BEFORE INSERT ON audit_events WHEN NEW.action='bank.job.completed' BEGIN SELECT RAISE(ABORT,'synthetic completion audit failure'); END;");
 await assert.rejects(f.service.sync(post('sync')),/synthetic completion audit failure/);
 assert.equal(f.workspace().state.transactions.length,0);assert.equal(f.workspace().revision,0);assert.equal(count(f,'bank_sync_runs'),0);assert.equal(financialAuditCount(f),0);assert.equal(f.connection().last_synced_at,null);
 assert.deepEqual(bankJobEvents(f).map(event=>event.action),['bank.job.started','bank.job.failed']);
});

test('bank failure audit errors cannot discard a provider cooldown or replace its original error',async t=>{
 const f=await fixture(t);await f.seedApp();await f.seedConnection();
 f.sql.exec("CREATE TRIGGER fail_failure_event BEFORE INSERT ON audit_events WHEN NEW.action='bank.job.failed' BEGIN SELECT RAISE(ABORT,'synthetic failure audit error'); END;");
 const previous=new Date(Date.now()-120000).toISOString();f.sql.prepare('UPDATE bank_connections SET last_synced_at=?').run(previous);
 const before=Date.now();f.provider.getTransactions=async()=>{throw Object.assign(new ProviderError('BANK_RATE_LIMIT','Vänta på banken',429,true),{retryAfter:172800});};
 await assert.rejects(f.service.sync(post('sync')),error=>error.code==='BANK_RATE_LIMIT');
 assert.ok(Date.parse(f.connection().retry_after)>=before+172800000);assert.equal(f.connection().last_synced_at,previous);assert.equal(f.connection().last_error,'Banken har begränsat antalet förfrågningar. Vänta till nästa tillåtna försök.');
 assert.deepEqual(bankJobEvents(f).map(event=>event.action),['bank.job.started']);assert.equal(count(f,'bank_sync_runs'),0);
 const calls=f.calls.length;await assert.rejects(f.service.sync(post('sync')),error=>error.code==='BANK_RATE_LIMIT');assert.equal(f.calls.length,calls);
});

for(const [label,environment,empty,replaced]of [
 ['production import','PRODUCTION',false,false],
 ['empty successful fetch','PRODUCTION',true,false],
 ['sandbox fetch','SANDBOX',false,false],
 ['replacement lease','PRODUCTION',false,true],
])test(`a lost ${label} commit reply cannot change a durable completed job into a failed attempt`,async t=>{
 const f=await fixture(t,environment);await f.seedApp();await f.seedConnection();if(empty)f.provider.getTransactions=async()=>({transactions:[]});
 const batch=f.d1.batch.bind(f.d1);let lost=false;
 f.d1.batch=async statements=>{
  const result=await batch(statements);
  if(!lost&&statements.some(statement=>businessSql(statement.sql).startsWith('INSERT INTO bank_sync_runs'))){
   lost=true;
   if(replaced){f.sql.prepare("UPDATE bank_locks SET token='replacement',expires_at=?").run(future());f.sql.prepare("UPDATE bank_connections SET last_error='Newer worker status'").run();}
   throw Error('PRIVATE_TRANSPORT_REPLY_DETAILS');
  }
  return result;
 };
 let result,failure;try{result=await(await f.service.sync(post('sync'))).json();}catch(error){failure=error.message;}
 assert.equal(failure,undefined,'a durable committed run must remain an accepted result');
 const imported=environment==='PRODUCTION'&&!empty?1:0;
 assert.equal(result.imported,imported);assert.equal(result.test,environment==='SANDBOX');assert.equal(typeof result.metadata_warning,'string');assert.ok(result.metadata_warning.length>0);assert.equal(JSON.stringify(result).includes('PRIVATE_TRANSPORT_REPLY_DETAILS'),false);
 assert.deepEqual(bankJobEvents(f).map(event=>event.action),['bank.job.started','bank.job.completed']);assert.equal(count(f,'bank_sync_runs'),1);assert.ok(f.connection().last_synced_at);assert.equal(f.connection().last_error,replaced?'Newer worker status':null);
 assert.equal(f.workspace()?.state.transactions.length||0,imported);
 if(replaced)assert.equal(f.sql.prepare('SELECT token FROM bank_locks').get().token,'replacement');
});

test('bank job audit does not record skipped automatic attempts or append results after losing the lease',async t=>{
 const f=await fixture(t);await f.seedApp();const id=await f.seedConnection();
 assert.equal((await(await f.service.automaticSync()).json()).reason,'disabled');assert.deepEqual(bankJobEvents(f),[]);
 await f.service.setAutomaticSync(post('automatic',{enabled:true,connectionId:id}));
 f.provider.getTransactions=async()=>{f.sql.prepare("UPDATE bank_locks SET token='replacement',expires_at=?").run(future());return{transactions:[rawTx()]};};
 await assert.rejects(f.service.automaticSync(),/BANK_LEASE_LOST/);
 const events=bankJobEvents(f);assert.deepEqual(events.map(event=>event.action),['bank.job.started']);
 assert.equal(f.workspace(),null);assert.equal(f.connection().last_synced_at,null);assert.equal(f.sql.prepare('SELECT token FROM bank_locks').get().token,'replacement');
 f.sql.prepare('DELETE FROM bank_locks').run();
 assert.equal((await(await f.service.automaticSync()).json()).reason,'not_due');assert.deepEqual(bankJobEvents(f),events);
});

test('a committed bank job remains completed when later housekeeping loses its lease',async t=>{
 const f=await fixture(t);await f.seedApp();await f.seedConnection();
 f.d1.beforeBatch=statements=>{if(statements.some(statement=>businessSql(statement.sql).startsWith('DELETE FROM bank_sync_runs'))){f.d1.beforeBatch=null;f.sql.prepare("UPDATE bank_locks SET token='replacement',expires_at=?").run(future());}};
 const response=await(await f.service.sync(post('sync'))).json();
 assert.equal(response.imported,1);assert.ok(response.warnings.some(warning=>warning.includes('Efterkontrollen')));assert.equal(f.connection().last_error,null);assert.ok(f.connection().last_synced_at);
 assert.deepEqual(bankJobEvents(f).map(event=>event.action),['bank.job.started','bank.job.completed']);assert.equal(f.workspace().state.transactions.length,1);
});

test('bank fixtures keep UTC booking and request dates when Stockholm has entered the following day',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-12-31T23:30:00Z')});
 const f=await fixture(t);await f.seedApp();await f.seedConnection();
 const response=await(await f.service.sync(post('sync'))).json();
 assert.equal(response.imported,1);assert.equal(f.connection().date_from,'2026-12-31');
 assert.equal(f.workspace().state.transactions[0].date,'2026-12-31');
 const requested=f.calls.find(call=>call.name==='getTransactions').args[2];
 assert.equal(requested.dateFrom,'2026-12-31');assert.equal(requested.dateTo,'2026-12-31');
});

test('existing automatic bank boundary dispatches reports for its authenticated owner even with AIS paused',async t=>{const f=await fixture(t);await f.service.automaticSync();assert.equal(f.reportOwner,f.owner);});

test('company consent rejects a foreign company before any provider request or flow is saved', async t => {
  const f = await fixture(t);
  await assert.rejects(f.start({ companyId: 'workspace:owner-bob' }), error => error.code === 'COMPANY_ACCESS_DENIED');
  assert.equal(f.calls.length, 0);
  assert.equal(count(f, 'bank_auth_flows'), 0);
});

test('company consent cannot accept client-supplied authority, owner or unsupported Bankgiro scope', async t => {
  const f = await fixture(t);
  for (const options of [{ owner: 'owner-bob' }, { corporateAuthorization: { status: 'verified' } }, { role: 'owner' }]) {
    await assert.rejects(f.start({ companyId: 'workspace:' + f.owner, ...options }), error => error.status === 400);
  }
  await assert.rejects(f.start({ companyId: 'workspace:' + f.owner, requiredScopes: ['accounts:read', 'transactions:read', 'bankgiro:read'] }), error => error.code === 'BANKGIRO_SCOPE_UNAVAILABLE');
  assert.equal(f.calls.length, 0);
  assert.equal(count(f, 'bank_auth_flows'), 0);
});

test('ambiguous code and error callbacks never claim the flow or exchange its authorization code', async t => {
  const f = await fixture(t); await f.start();
  const ambiguous = await f.service.callback(f.callbackRequest('&error=access_denied'));
  assert.equal(ambiguous.headers.get('location'), '/bank?result=failed');
  assert.equal(f.sql.prepare('SELECT status FROM bank_auth_flows').get().status, 'pending');
  assert.equal(f.calls.filter(call => call.name === 'createSession').length, 0);
  assert.equal(count(f, 'bank_connections'), 0);
});

test('the first concurrent company callback survives a later start without accepting two connections', async t => {
  const f = await fixture(t); companyAuthority(f); await f.start();
  const first = f.callbackRequest();
  await f.start(); const second = f.callbackRequest();
  assert.equal(count(f, 'bank_auth_flows'), 2);
  assert.equal((await f.service.callback(first)).headers.get('location'), '/bank?result=select_account');
  assert.equal((await f.service.callback(second)).headers.get('location'), '/bank?result=failed');
  assert.equal(count(f, 'bank_connections'), 1);
});

function companyAuthority(f, patch = {}) {
  f.env.BANK_COMPANY_AUTHORIZATIONS = JSON.stringify({ version: 1, bindings: [{
    companyId: 'workspace:' + f.owner, storageOwnerId: f.owner, provider: 'enablebanking',
    bankName: 'Swedbank', country: 'SE', accountKeys: ['iban:' + (f.account.account_id?.iban ?? 'TEST')],
    evidenceId: 'synthetic-bank-company-account-proof', origin: 'bank',
    checkedAt: new Date(Date.now() - 1000).toISOString(), validUntil: future(), status: 'active', ...patch,
  }] });
}

function reconnectCompanyContext(f) {
  f.companyContext = { version: 'company-context-v1', companyId: 'workspace:' + f.owner,
    storageOwner: f.owner, actorId: f.owner, role: 'owner', membershipVersion: 1,
    companyVersion: 1, contextVersion: 1 };
}

test('consent-reconnect-95: configured callback is verified, saved and used exactly', async t => {
  const f = await fixture(t); companyAuthority(f);
  const configured = 'https://configured.example.test/api/bank/callback';
  f.env.ENABLE_BANKING_REDIRECT_URL = configured;
  f.info.redirect_urls = [configured];
  await f.start({}, new URL(configured).origin);
  assert.equal(f.auth.redirectUrl, configured);
  assert.equal(f.sql.prepare('SELECT redirect_uri FROM bank_auth_flows').get().redirect_uri, configured);
  const visible = await (await f.service.status(new Request(origin + '/api/bank/status'))).json();
  assert.equal(visible.redirectUrl, configured);
  assert.equal(visible.application.redirectConfigured, true);
  const wrong = await f.service.callback(f.callbackRequest());
  assert.equal(wrong.headers.get('location'), '/bank?result=failed');
  assert.equal(f.calls.filter(call => call.name === 'createSession').length, 0);
  const request = new Request(`${configured}?state=${f.flowState}&code=one-use-code`, { headers: { Cookie: f.flowCookie } });
  assert.equal((await f.service.callback(request)).headers.get('location'), '/bank?result=select_account');
  assert.equal((await f.service.callback(request)).headers.get('location'), '/bank?result=expired');
  assert.equal(f.calls.filter(call => call.name === 'createSession').length, 1);
});

test('consent-reconnect-95: trusted APP_ORIGIN supplies the exact callback when no explicit URI is set', async t => {
  const f = await fixture(t);
  delete f.env.ENABLE_BANKING_REDIRECT_URL;
  f.env.APP_ORIGIN = 'https://configured.example.test';
  f.info.redirect_urls = [f.env.APP_ORIGIN + '/api/bank/callback'];
  await f.start({}, f.env.APP_ORIGIN);
  assert.equal(f.auth.redirectUrl, f.env.APP_ORIGIN + '/api/bank/callback');
});

test('consent-reconnect-95: absent, malformed or conflicting trusted callback config fails before provider calls', async t => {
  const f = await fixture(t);
  for (const settings of [
    {}, { ENABLE_BANKING_REDIRECT_URL: 'http://configured.example.test/api/bank/callback' },
    { ENABLE_BANKING_REDIRECT_URL: 'https://configured.example.test/api/bank/callback?next=private' },
    { ENABLE_BANKING_REDIRECT_URL: 'https://configured.example.test/api/bank/callback#fragment' },
    { ENABLE_BANKING_REDIRECT_URL: 'https://user:secret@configured.example.test/api/bank/callback' },
    { ENABLE_BANKING_REDIRECT_URL: 'https://configured.example.test/other' },
    { ENABLE_BANKING_REDIRECT_URL: redirect, APP_ORIGIN: 'https://other.example.test' },
    { APP_ORIGIN: 'https://configured.example.test/untrusted/path' },
  ]) {
    delete f.env.ENABLE_BANKING_REDIRECT_URL; delete f.env.APP_ORIGIN; Object.assign(f.env, settings);
    await assert.rejects(f.service.connect(post('connect', { bankName: 'Swedbank', country: 'SE', dateFrom: bankUtcDate() })), error => error.code === 'BANK_REDIRECT_CONFIGURATION_INVALID');
    assert.equal(f.calls.length, 0);
    assert.equal(count(f, 'bank_auth_flows'), 0);
  }
});

test('consent-reconnect-95: a configured callback missing from fresh registration cannot start consent', async t => {
  const f = await fixture(t);
  f.env.ENABLE_BANKING_REDIRECT_URL = 'https://configured.example.test/api/bank/callback';
  await assert.rejects(f.service.connect(post('connect', { bankName: 'Swedbank', country: 'SE', dateFrom: bankUtcDate() }, 'https://configured.example.test', 'https://configured.example.test')));
  assert.equal(f.calls.filter(call => call.name === 'getApplication').length, 1);
  assert.equal(f.calls.filter(call => call.name === 'startAuth').length, 0);
  assert.equal(count(f, 'bank_auth_flows'), 0);
});

test('consent-reconnect-95: configuration rotation during application lookup cannot cache or start stale consent', async t => {
  for (const rotate of [f => { f.env.ENABLE_BANKING_REDIRECT_URL = 'https://changed.example.test/api/bank/callback'; },
    f => { f.env.ENABLE_BANKING_APPLICATION_ID = '66666666-6666-4666-8666-666666666666'; }]) {
    const f = await fixture(t); await f.seedApp();
    const before = { ...f.sql.prepare('SELECT * FROM bank_applications').get() };
    f.provider.getApplication = async () => { rotate(f); return structuredClone(f.info); };
    await assert.rejects(f.service.connect(post('connect', { bankName: 'Swedbank', country: 'SE', dateFrom: bankUtcDate() })));
    assert.equal(f.calls.filter(call => call.name === 'startAuth').length, 0);
    assert.equal(count(f, 'bank_auth_flows'), 0);
    assert.deepEqual({ ...f.sql.prepare('SELECT * FROM bank_applications').get() }, before);
  }
});

test('consent-reconnect-95: an existing flow keeps its captured callback when deployment configuration changes', async t => {
  const f = await fixture(t); companyAuthority(f); await f.start();
  f.env.ENABLE_BANKING_REDIRECT_URL = 'https://changed.example.test/api/bank/callback';
  assert.equal((await f.service.callback(f.callbackRequest())).headers.get('location'), '/bank?result=select_account');
  assert.equal(f.calls.filter(call => call.name === 'createSession').length, 1);
});

test('consent-reconnect-95: expired consent can be renewed without retaining the old account selection', async t => {
  const f = await fixture(t); companyAuthority(f); await f.seedApp(); const id = await f.seedConnection();
  f.sql.prepare("UPDATE bank_connections SET valid_until='2000-01-01T00:00:00.000Z',status='reauth_required',auto_sync_enabled=1 WHERE owner=?").run(f.owner);
  const nextSession = '55555555-5555-4555-8555-555555555555', create = f.provider.createSession;
  f.provider.createSession = async () => ({ ...await create(), session_id: nextSession });
  await f.start({ renewConnectionId: id });
  assert.equal((await f.service.callback(f.callbackRequest())).headers.get('location'), '/bank?result=select_account');
  assert.equal(f.connection().id, id);
  assert.equal(await f.store.sessionId(f.connection()), nextSession);
  assert.equal(f.connection().selected_accounts, '[]');
  assert.equal(f.connection().auto_sync_enabled, 0);
  assert.equal(f.calls.filter(call => call.name === 'deleteSession' && call.args[1] === remoteSession).length, 1);
  assert.equal(f.calls.filter(call => call.name === 'getTransactions').length, 0);
});

test('consent-reconnect-95: membership change while listing banks cannot initiate authorization', async t => {
  const f = await fixture(t, 'PRODUCTION', { companyContext: true }); reconnectCompanyContext(f);
  f.provider.listBusinessBanks = async () => { f.companyContext.membershipVersion = 2; return [structuredClone(f.bank)]; };
  await assert.rejects(f.service.connect(post('connect', { bankName: 'Swedbank', country: 'SE', dateFrom: bankUtcDate() })), error => error.code === 'COMPANY_ACCESS_DENIED');
  assert.equal(f.calls.filter(call => call.name === 'startAuth').length, 0);
  assert.equal(count(f, 'bank_auth_flows'), 0);
});

test('consent-reconnect-95: membership change during exchange preserves old consent and prevents further reads', async t => {
  const f = await fixture(t, 'PRODUCTION', { companyContext: true }); reconnectCompanyContext(f); companyAuthority(f); await f.seedApp(); const id = await f.seedConnection();
  const before = { ...f.connection() };
  await f.start({ renewConnectionId: id });
  const nextSession = '55555555-5555-4555-8555-555555555555', create = f.provider.createSession;
  f.provider.createSession = async () => { f.companyContext.membershipVersion = 2; return { ...await create(), session_id: nextSession }; };
  assert.equal((await f.service.callback(f.callbackRequest())).headers.get('location'), '/bank?result=failed');
  assert.deepEqual({ ...f.connection() }, before);
  assert.equal(f.calls.filter(call => call.name === 'getSession').length, 0);
  assert.equal(f.calls.filter(call => call.name === 'deleteSession' && call.args[1] === remoteSession).length, 0);
  assert.equal(f.calls.filter(call => call.name === 'deleteSession' && call.args[1] === nextSession).length, 1);
});

test('approved company consent requires separate bank company/account proof and explicit confirmation', async t => {
  const f = await fixture(t); companyAuthority(f);
  await f.start({ companyId: 'workspace:' + f.owner });
  const result = await f.service.callback(f.callbackRequest());
  assert.equal(result.headers.get('location'), '/bank?result=select_account');
  assert.equal(f.connection().status, 'pending_account');
  assert.deepEqual(JSON.parse(f.connection().selected_accounts), []);
  const visible = await (await f.service.status(new Request(origin + '/api/bank/status'))).json();
  assert.equal(visible.company.id, 'workspace:' + f.owner);
  assert.equal(visible.connection.consent.corporateAuthorization.status, 'verified');
  assert.equal(visible.connection.consent.bankgiro.status, 'unavailable');
  assert.equal(visible.connection.accounts[0].importable, true);
  assert.ok(!JSON.stringify(visible).includes(remoteSession));
  await f.service.selectAccounts(post('accounts', { companyId: visible.company.id, connectionId: visible.connection.id, accountUids: [accountUid] }));
  assert.equal(f.connection().status, 'connected');
  assert.equal(f.calls.filter(call => call.name === 'getTransactions').length, 0);
});

test('BankID business login without a company/account attestation remains unverified and cannot import', async t => {
  const f = await fixture(t); f.account.usage = 'ORGA'; f.live.psu_id_hash = 'synthetic-person-not-company';
  await f.start({ companyId: 'workspace:' + f.owner });
  assert.equal((await f.service.callback(f.callbackRequest())).headers.get('location'), '/bank?result=corporate_authorization_required');
  const visible = await (await f.service.status(new Request(origin + '/api/bank/status'))).json();
  assert.equal(visible.connection.consent.corporateAuthorization.status, 'unverified');
  assert.equal(visible.connection.accounts[0].importable, false);
  await assert.rejects(f.service.selectAccounts(post('accounts', { connectionId: f.connection().id, accountUids: [accountUid] })), error => error.code === 'CORPORATE_AUTHORIZATION_REQUIRED');
  await assert.rejects(f.service.sync(post('sync')));
  assert.equal(f.calls.filter(call => call.name === 'getTransactions').length, 0);
});

test('company authority revocation after consent blocks confirmation and automated use', async t => {
  const f = await fixture(t); companyAuthority(f); await f.start({ companyId: 'workspace:' + f.owner });
  await f.service.callback(f.callbackRequest());
  delete f.env.BANK_COMPANY_AUTHORIZATIONS;
  await assert.rejects(f.service.selectAccounts(post('accounts', { connectionId: f.connection().id, accountUids: [accountUid] })), error => error.code === 'CORPORATE_AUTHORIZATION_REQUIRED');
  assert.deepEqual(JSON.parse(f.connection().selected_accounts), []);
  assert.equal(f.calls.filter(call => call.name === 'getTransactions').length, 0);
});

test('both provider expiries and the requested expiry cap the saved consent', async t => {
  const f = await fixture(t); const short = new Date(Date.now() + 300000).toISOString();
  const create = f.provider.createSession; f.provider.createSession = async () => ({ ...await create(), access: { valid_until: short, transactions: true } });
  await f.start(); await f.service.callback(f.callbackRequest());
  assert.equal(f.connection().valid_until, short);
});

test('denied and cancelled identification have distinct safe durable outcomes', async t => {
  for (const [description, outcome] of [['Cancelled by user', 'cancelled'], ['Denied data sharing consent', 'denied']]) {
    const f = await fixture(t); await f.start();
    const result = await f.service.callback(new Request(`${redirect}?state=${f.flowState}&error=access_denied&error_description=${encodeURIComponent(description)}`, { headers: { Cookie: f.flowCookie } }));
    assert.equal(result.headers.get('location'), '/bank?result=' + outcome);
    assert.equal(f.sql.prepare('SELECT status FROM bank_auth_flows').get().status, outcome);
    assert.equal(f.calls.filter(call => call.name === 'createSession').length, 0);
  }
});

test('lost callback is reported expired from stored flow state without a bank request or replay', async t => {
  const f = await fixture(t); await f.start();
  f.sql.prepare("UPDATE bank_auth_flows SET expires_at='2000-01-01T00:00:00.000Z'").run();
  const before = f.calls.length;
  const visible = await (await f.service.status(new Request(origin + '/api/bank/status'))).json();
  assert.equal(visible.consentFlow.status, 'expired');
  assert.equal(visible.consentFlow.reason, 'CALLBACK_NOT_RECEIVED');
  assert.equal(visible.connection, null);
  assert.equal(f.calls.length, before);
});

test('renewal cancellation preserves the existing connection and accepted renewal replaces it once', async t => {
  const f = await fixture(t); companyAuthority(f); await f.seedApp(); const id = await f.seedConnection();
  const before = { ...f.connection() };
  await f.start({ renewConnectionId: id });
  const cancelled = new Request(`${redirect}?state=${f.flowState}&error=access_denied&error_description=Cancelled%20by%20user`, { headers: { Cookie: f.flowCookie } });
  await f.service.callback(cancelled);
  assert.deepEqual({ ...f.connection() }, before);
  await f.start({ renewConnectionId: id });
  const newSession = '55555555-5555-4555-8555-555555555555', create = f.provider.createSession;
  f.provider.createSession = async () => ({ ...await create(), session_id: newSession });
  assert.equal((await f.service.callback(f.callbackRequest())).headers.get('location'), '/bank?result=select_account');
  assert.equal(f.connection().id, id);
  assert.equal(await f.store.sessionId(f.connection()), newSession);
  assert.equal(f.calls.filter(call => call.name === 'deleteSession' && call.args[1] === remoteSession).length, 1);
  assert.deepEqual(JSON.parse(f.connection().selected_accounts), []);
});

test('disconnect fences a renewal even if the callback arrives after the connection is removed', async t => {
  const f = await fixture(t); await f.seedApp(); const id = await f.seedConnection();
  await f.start({ renewConnectionId: id }); const late = f.callbackRequest();
  await f.service.disconnect(post('disconnect'));
  const before = f.calls.filter(call => call.name === 'createSession').length;
  assert.equal((await f.service.callback(late)).headers.get('location'), '/bank?result=expired');
  assert.equal(f.calls.filter(call => call.name === 'createSession').length, before);
  assert.equal(f.connection().status, 'disconnected');
});

test('omitting companyId cannot opt a new authorization into legacy authority bypass', async t => {
  const f = await fixture(t); await f.start();
  assert.equal((await f.service.callback(f.callbackRequest())).headers.get('location'), '/bank?result=corporate_authorization_required');
  assert.equal(JSON.parse(f.connection().consent_metadata).mode, 'company');
  await assert.rejects(f.service.selectAccounts(post('accounts', { connectionId: f.connection().id, accountUids: [accountUid] })), error => error.code === 'CORPORATE_AUTHORIZATION_REQUIRED');
  assert.equal(f.calls.filter(call => call.name === 'getTransactions').length, 0);
});

test('a newly revoked transaction scope blocks every subsequent transaction fetch', async t => {
  const f = await fixture(t); await f.seedApp(); await f.seedConnection();
  f.live.access.transactions = false;
  await assert.rejects(f.service.sync(post('sync')));
  assert.equal(f.calls.filter(call => call.name === 'getTransactions').length, 0);
  assert.equal(f.workspace(), null);
  assert.equal(f.connection().status, 'reauth_required');
});

test('company evidence expiry caps the consent saved by a successful callback', async t => {
  const f = await fixture(t), short = new Date(Date.now() + 120000).toISOString();
  companyAuthority(f, { validUntil: short });
  await f.start({ companyId: 'workspace:' + f.owner });
  assert.equal((await f.service.callback(f.callbackRequest())).headers.get('location'), '/bank?result=select_account');
  assert.equal(f.connection().valid_until, short);
});

test('a callback that loses its lease cannot revoke a provider session owned by a newer worker', async t => {
  const f = await fixture(t); await f.start();
  const create = f.provider.createSession;
  f.provider.createSession = async () => {
    const result = await create();
    f.sql.prepare("UPDATE bank_locks SET token='newer-worker',expires_at=?").run(future());
    return result;
  };
  assert.equal((await f.service.callback(f.callbackRequest())).headers.get('location'), '/bank?result=failed');
  assert.equal(f.calls.filter(call => call.name === 'deleteSession').length, 0);
  assert.equal(count(f, 'bank_connections'), 0);
  assert.equal(f.sql.prepare('SELECT status FROM bank_auth_flows').get().status, 'exchanging');
});

test('later verified company evidence unlocks confirmation without automatically activating the connection', async t => {
  const f = await fixture(t); await f.start(); await f.service.callback(f.callbackRequest());
  assert.equal(f.connection().status, 'corporate_authorization_required');
  companyAuthority(f);
  const visible = await (await f.service.status(new Request(origin + '/api/bank/status'))).json();
  assert.equal(visible.connection.status, 'pending_account');
  assert.equal(confirmedBankConsent(visible), false);
  assert.deepEqual(JSON.parse(f.connection().selected_accounts), []);
  await f.service.selectAccounts(post('accounts', { connectionId: f.connection().id, accountUids: [accountUid] }));
  assert.equal(f.connection().status, 'connected');
});

test('unavailable corporate bank fails before creating a redirect or persistent authorization flow', async t => {
  const f = await fixture(t); f.bank.psu_types = ['personal'];
  await assert.rejects(f.start(), error => error.code === 'BUSINESS_BANK_UNAVAILABLE' && /företagsanslutning/.test(error.message));
  assert.equal(f.calls.filter(call => call.name === 'startAuth').length, 0);
  assert.equal(count(f, 'bank_auth_flows'), 0);
});

test('company consent status cannot claim success with missing or revoked corporate authority', () => {
  const status = { configured: true, storageReady: true, connection: { status: 'connected', validUntil: future(), consent: { mode: 'company', corporateAuthorization: { status: 'unverified' } } } };
  assert.equal(confirmedBankConsent(status), false);
  status.connection.consent.corporateAuthorization.status = 'verified';
  assert.equal(confirmedBankConsent(status), true);
});

test('revoking company authority during a provider response prevents financial persistence', async t => {
  const f = await fixture(t); companyAuthority(f); await f.start(); await f.service.callback(f.callbackRequest());
  await f.service.selectAccounts(post('accounts', { connectionId: f.connection().id, accountUids: [accountUid] }));
  f.provider.getTransactions = async () => { delete f.env.BANK_COMPANY_AUTHORIZATIONS; return { transactions: [rawTx()] }; };
  await assert.rejects(f.service.sync(post('sync')), error => error.code === 'CORPORATE_AUTHORIZATION_REQUIRED');
  assert.equal(f.workspace()?.state.transactions.length || 0, 0);
  assert.equal(count(f, 'bank_sync_runs'), 0);
  assert.equal(f.connection().last_synced_at, null);
});

test('simultaneous delivery of one callback exchanges its authorization code at most once', async t => {
  const f = await fixture(t); companyAuthority(f); await f.start();
  const replies = await Promise.all([f.service.callback(f.callbackRequest()), f.service.callback(f.callbackRequest())]);
  assert.equal(replies.filter(reply => reply.headers.get('location') === '/bank?result=select_account').length, 1);
  assert.equal(f.calls.filter(call => call.name === 'createSession').length, 1);
  assert.equal(count(f, 'bank_connections'), 1);
  assert.equal(f.sql.prepare('SELECT status FROM bank_auth_flows').get().status, 'completed');
});

test('a flow revoked at the actual callback write boundary cannot activate a connection', async t => {
  const f = await fixture(t); companyAuthority(f); await f.start();
  f.d1.beforeBatch = statements => {
    if (statements.some(statement => statement.sql.includes('INSERT INTO bank_connections'))) {
      f.d1.beforeBatch = null;
      f.sql.prepare("UPDATE bank_auth_flows SET status='cancelled'").run();
    }
  };
  assert.equal((await f.service.callback(f.callbackRequest())).headers.get('location'), '/bank?result=failed');
  assert.equal(count(f, 'bank_connections'), 0);
  assert.equal(f.sql.prepare('SELECT status FROM bank_auth_flows').get().status, 'cancelled');
  assert.equal(f.calls.filter(call => call.name === 'deleteSession').length, 1);
});

for (const replacementLease of [false, true]) test(`a lost callback commit reply preserves the saved provider session with replacement lease ${replacementLease}`, async t => {
  const f = await fixture(t); companyAuthority(f); await f.start();
  const batch = f.d1.batch.bind(f.d1);
  f.d1.batch = async statements => {
    const result = await batch(statements);
    if (statements.some(statement => statement.sql.includes('INSERT INTO bank_connections'))) {
      if (replacementLease) f.sql.prepare("UPDATE bank_locks SET token='newer-worker',expires_at=?").run(future());
      throw Error('SYNTHETIC_LOST_COMMIT_REPLY');
    }
    return result;
  };
  assert.equal((await f.service.callback(f.callbackRequest())).headers.get('location'), '/bank?result=select_account');
  assert.equal(await f.store.revocationSessionId(f.connection()), remoteSession);
  assert.equal(f.connection().status, 'pending_account');
  assert.equal(f.sql.prepare('SELECT status FROM bank_auth_flows').get().status, 'completed');
  assert.equal(f.calls.filter(call => call.name === 'deleteSession').length, 0);
});

test('an interrupted code exchange expires as unknown outcome without replay or provider polling', async t => {
  const f = await fixture(t); await f.start();
  f.sql.prepare("UPDATE bank_auth_flows SET status='exchanging',expires_at='2000-01-01T00:00:00.000Z'").run();
  const before = f.calls.length;
  const visible = await (await f.service.status(new Request(origin + '/api/bank/status'))).json();
  assert.equal(visible.consentFlow.status, 'expired');
  assert.equal(visible.consentFlow.reason, 'AUTHORIZATION_OUTCOME_UNKNOWN');
  assert.equal((await f.service.callback(f.callbackRequest())).headers.get('location'), '/bank?result=expired');
  assert.equal(f.calls.length, before);
});

test('uncertain old-session revocation during renewal never leaves an apparently usable connection', async t => {
  const f = await fixture(t); companyAuthority(f); await f.seedApp(); const id = await f.seedConnection();
  const before = f.connection().encrypted_session, create = f.provider.createSession;
  const replacement = '55555555-5555-4555-8555-555555555555';
  f.provider.createSession = async () => ({ ...await create(), session_id: replacement });
  f.provider.deleteSession = async (_config, id) => { if (id === remoteSession) throw new ProviderError('BANK_NETWORK_ERROR', 'Syntetiskt okänt återkallelseresultat', 502); };
  await f.start({ renewConnectionId: id });
  assert.equal((await f.service.callback(f.callbackRequest())).headers.get('location'), '/bank?result=failed');
  assert.equal(f.connection().encrypted_session, before);
  assert.equal(f.connection().status, 'reauth_required');
  assert.equal(f.connection().auto_sync_enabled, 0);
  await assert.rejects(f.service.sync(post('sync')));
  assert.equal(f.calls.filter(call => call.name === 'getTransactions').length, 0);
});

test('pre-migration redirects cannot create a new legacy connection without company verification', async t => {
  const f = await fixture(t); await f.start();
  const secret = f.flowCookie.split('=')[1];
  f.sql.prepare("UPDATE bank_auth_flows SET context_json=''").run();
  assert.equal((await f.service.callback(f.callbackRequest('', `${cookieName}=${secret}`))).headers.get('location'), '/bank?result=expired');
  assert.equal(count(f, 'bank_connections'), 0);
  assert.equal(f.calls.filter(call => call.name === 'createSession').length, 0);
  const visible = await (await f.service.status(new Request(origin + '/api/bank/status'))).json();
  assert.equal(visible.consentFlow.reason, 'CONSENT_RESTART_REQUIRED');
});


for (const [label, code, mutate] of [
  ['selected account missing from current account data', 'BANK_ACCOUNT_SCOPE_INVALID', f => { f.live.accounts_data = []; }],
  ['transaction permission withdrawn', 'BANK_TRANSACTION_SCOPE_REQUIRED', f => { f.live.access.transactions = false; }],
]) test(`consent sync diagnostic retains canonical reason for ${label} without resetting reauthorization`, async t => {
  const f = await fixture(t); await f.seedApp(); await f.seedConnection();
  const lastSuccess = new Date(Date.now() - 7 * 3600_000).toISOString();
  f.sql.prepare('UPDATE bank_connections SET auto_sync_enabled=1,last_synced_at=? WHERE owner=?').run(lastSuccess, f.owner);
  mutate(f);
  await assert.rejects(f.service.automaticSync(), error => error instanceof ConsentError && error.code === code);
  const conn = f.connection(), status = await (await f.service.automaticSyncStatus()).json();
  assert.equal(conn.status, 'reauth_required'); assert.equal(status.connected, false);
  assert.equal(conn.sync_failures, 1); assert.equal(status.blocked, false);
  assert.equal(conn.last_synced_at, lastSuccess); assert.equal(status.lastSyncedAt, lastSuccess);
  assert.equal(conn.last_error, new ConsentError(code).message);
  assert.equal(status.lastError, new ConsentError(code).message);
  assert.equal(bankJobEvents(f).find(event => event.action === 'bank.job.failed').detail.error_code, code);
  assert.equal(f.calls.filter(call => call.name === 'getTransactions').length, 0);
  assert.equal(f.workspace(), null); assert.equal(count(f, 'bank_sync_runs'), 0);
  assert.equal(financialAuditCount(f), 0);
  const calls = f.calls.length;
  await assert.rejects(f.service.automaticSync(), /En giltig bankanslutning/);
  assert.equal(f.calls.length, calls, 'a diagnostic must never re-enable the rejected connection');
  assert.equal(f.connection().status, 'reauth_required');
});

for (const code of ['BANK_ACCOUNT_SCOPE_INVALID', 'SYNTHETIC_PRIVATE_TOKEN_123'])
  test(`consent sync diagnostic excludes arbitrary custom message and unsafe code ${code}`, async t => {
    const f = await fixture(t); await f.seedApp(); await f.seedConnection();
    f.sql.prepare('UPDATE bank_connections SET auto_sync_enabled=1 WHERE owner=?').run(f.owner);
    const privateMessage = 'Synthetic secret token and private account observation';
    f.provider.getSession = async () => { throw new ConsentError(code, 409, privateMessage); };
    await assert.rejects(f.service.automaticSync(), error => error instanceof ConsentError);
    const recognized = code === 'BANK_ACCOUNT_SCOPE_INVALID';
    const expectedMessage = recognized ? new ConsentError(code).message : 'Bankhändelserna kunde inte hämtas. Försök igen.';
    const status = await (await f.service.automaticSyncStatus()).json();
    assert.equal(f.connection().last_error, expectedMessage); assert.equal(status.lastError, expectedMessage);
    assert.equal(bankJobEvents(f).find(event => event.action === 'bank.job.failed').detail.error_code, recognized ? code : 'BANK_SYNC_FAILED');
    const persisted = JSON.stringify([f.connection(), bankJobEvents(f), status]);
    assert.ok(!persisted.includes(privateMessage));
    if (!recognized) assert.ok(!persisted.includes(code));
    assert.equal(f.workspace(), null); assert.equal(count(f, 'bank_sync_runs'), 0);
    assert.equal(f.calls.filter(call => call.name === 'getTransactions').length, 0);
  });

test('consent sync diagnostic rejects a forged changing code without reading getter-supplied secrets', async t => {
  const f = await fixture(t); await f.seedApp(); await f.seedConnection();
  f.sql.prepare('UPDATE bank_connections SET auto_sync_enabled=1 WHERE owner=?').run(f.owner);
  const secret = 'SYNTHETIC_CHANGING_CODE_SECRET'; let reads = 0;
  const error = Object.create(ConsentError.prototype);
  Object.defineProperty(error, 'code', { get: () => ++reads % 3 === 1 ? 'BANK_ACCOUNT_SCOPE_INVALID' : secret });
  error.message = 'Synthetic private error text';
  f.provider.getSession = async () => { throw error; };
  await assert.rejects(f.service.automaticSync());
  const status = await (await f.service.automaticSyncStatus()).json();
  const persisted = JSON.stringify([f.connection(), bankJobEvents(f), status]);
  assert.ok(!persisted.includes(secret)); assert.ok(!persisted.includes(error.message));
  assert.equal(status.lastError, 'Bankhändelserna kunde inte hämtas. Försök igen.');
  assert.equal(bankJobEvents(f).find(event => event.action === 'bank.job.failed').detail.error_code, 'BANK_SYNC_FAILED');
  assert.equal(reads, 0);
  assert.equal(f.workspace(), null); assert.equal(count(f, 'bank_sync_runs'), 0);
});


for (const forged of ['duck-typed', 'throwing-getter']) test(`consent sync diagnostic ignores ${forged} error details`, async t => {
  const f = await fixture(t); await f.seedApp(); await f.seedConnection();
  f.sql.prepare('UPDATE bank_connections SET auto_sync_enabled=1 WHERE owner=?').run(f.owner);
  const error = forged === 'duck-typed' ? { code: 'BANK_ACCOUNT_SCOPE_INVALID', message: 'Synthetic private message' } : Object.create(ConsentError.prototype);
  if (forged === 'throwing-getter') Object.defineProperty(error, 'code', { get() { throw Error('Synthetic private getter message'); } });
  f.provider.getSession = async () => { throw error; };
  await assert.rejects(f.service.automaticSync());
  const status = await (await f.service.automaticSyncStatus()).json();
  assert.equal(status.lastError, 'Bankhändelserna kunde inte hämtas. Försök igen.');
  assert.equal(bankJobEvents(f).find(event => event.action === 'bank.job.failed').detail.error_code, 'BANK_SYNC_FAILED');
  assert.ok(!JSON.stringify([f.connection(), bankJobEvents(f), status]).includes('Synthetic private'));
  assert.equal(f.workspace(), null); assert.equal(count(f, 'bank_sync_runs'), 0);
});

const extraLegacyUid = '44444444-4444-4444-8444-444444444444';
async function cachedLegacyAccounts(f, mode = null) {
  await f.seedApp(); const id = await f.seedConnection();
  const extra = { ...f.account, uid: extraLegacyUid, account_id: { iban: 'SE4550000000058398257474' } };
  const encrypted = await f.store.encrypt(f.owner, `accounts:${id}`, [f.account, extra]);
  f.sql.prepare('UPDATE bank_connections SET encrypted_accounts=? WHERE owner=?').run(encrypted, f.owner);
  if (mode) {
    const metadata = { version: 'bank-consent-v1', mode, companyId: 'workspace:' + f.owner, actorId: f.owner, membershipVersion: 'legacy-owner-v1', requestedScopes: ['accounts:read', 'transactions:read'], grantedScopes: ['accounts:read', 'transactions:read'], validUntil: future(), corporateAuthorization: { status: 'unverified' } };
    f.sql.prepare('UPDATE bank_connections SET consent_metadata=? WHERE owner=?').run(JSON.stringify(metadata), f.owner);
    if (mode === 'company') companyAuthority(f, { accountKeys: ['iban:' + f.account.account_id.iban, 'iban:' + extra.account_id.iban] });
  }
  return id;
}

for (const mode of [null, 'legacy']) test(`legacy selected scope ${mode ?? 'migration'} can retain A after unselected cached B leaves the live consent`, async t => {
  const f = await fixture(t); const id = await cachedLegacyAccounts(f, mode);
  assert.equal((await f.service.selectAccounts(post('accounts', { connectionId: id, accountUids: [accountUid] }))).status, 200);
  assert.deepEqual(JSON.parse(f.connection().selected_accounts), [accountUid]);
  const result = await (await f.service.sync(post('sync'))).json();
  assert.equal(result.imported, 1);
  assert.ok(f.calls.some(call => call.name === 'getTransactions'));
  assert.ok(f.calls.filter(call => call.name === 'getTransactions').every(call => call.args[1] === accountUid));
  assert.equal(f.connection().status, 'connected');
  assert.equal(f.workspace().state.transactions.length, 1);
  assert.equal(f.workspace().state.allocations.length, 0);
});

test('legacy selected scope never imports a selected cached account absent from the live consent', async t => {
  const f = await fixture(t); const id = await cachedLegacyAccounts(f);
  f.sql.prepare('UPDATE bank_connections SET selected_accounts=? WHERE owner=?').run(JSON.stringify([extraLegacyUid]), f.owner);
  await assert.rejects(f.service.selectAccounts(post('accounts', { connectionId: id, accountUids: [extraLegacyUid] })), error => error.code === 'BANK_ACCOUNT_SCOPE_INVALID');
  await assert.rejects(f.service.sync(post('sync')), error => error.code === 'BANK_ACCOUNT_SCOPE_INVALID');
  assert.equal(f.connection().status, 'reauth_required');
  assert.equal(f.workspace(), null); assert.equal(count(f, 'bank_sync_runs'), 0);
  assert.equal(f.calls.filter(call => call.name === 'getTransactions').length, 0);
});

test('company selected scope retains strict full-account equality when unselected cached B leaves consent', async t => {
  const f = await fixture(t); const id = await cachedLegacyAccounts(f, 'company');
  await assert.rejects(f.service.selectAccounts(post('accounts', { connectionId: id, accountUids: [accountUid] })), error => error.code === 'BANK_ACCOUNT_SCOPE_INVALID');
  await assert.rejects(f.service.sync(post('sync')), error => error.code === 'BANK_ACCOUNT_SCOPE_INVALID');
  assert.equal(f.connection().status, 'reauth_required');
  assert.equal(f.workspace(), null); assert.equal(count(f, 'bank_sync_runs'), 0);
  assert.equal(f.calls.filter(call => call.name === 'getTransactions').length, 0);
});

test('95: reauthorization status suppresses scheduled retry promises without rewriting bank state', async t => {
  const f = await fixture(t); await f.seedApp(); await f.seedConnection();
  const attempted = new Date(Date.now() - 60_000).toISOString();
  f.sql.prepare("UPDATE bank_connections SET status='reauth_required',auto_sync_enabled=1,auto_last_attempt_at=?,auto_next_at=? WHERE owner=?")
    .run(attempted, future(), f.owner);
  const before = { ...f.connection() };
  const result = await (await f.service.automaticSyncStatus()).json();
  assert.equal(result.connected, false);
  assert.equal(result.connectionStatus, 'reauth_required');
  assert.equal(result.requiresReauthentication, true);
  assert.equal(result.nextAction, 'reconnect');
  assert.equal(result.nextAttemptAt, null);
  assert.equal(result.syncAllowed, false);
  assert.equal(result.statusEvidence, 'stored_connection');
  assert.deepEqual({ ...f.connection() }, before);
  assert.equal(f.calls.length, 0);
});

test('95: status rejects a stale application generation without contacting the bank', async t => {
  const f = await fixture(t); await f.seedApp(); await f.seedConnection();
  f.sql.prepare("UPDATE bank_connections SET app_generation='old-generation',auto_sync_enabled=1 WHERE owner=?").run(f.owner);
  const before = { ...f.connection() };
  const automatic = await (await f.service.automaticSyncStatus()).json();
  assert.equal(automatic.connected, false);
  assert.equal(automatic.connectionStatus, 'reauth_required');
  assert.equal(automatic.blockedReason, 'CONSENT_APPLICATION_CHANGED');
  assert.equal(automatic.nextAttemptAt, null);
  const visible = await (await f.service.status(new Request(origin + '/api/bank/status'))).json();
  assert.equal(visible.connection.status, automatic.connectionStatus);
  assert.deepEqual({ ...f.connection() }, before);
  assert.equal(f.calls.length, 0);
});

test('95: automatic status rejects withdrawn corporate authority and empty account selection', async t => {
  const f = await fixture(t); await cachedLegacyAccounts(f, 'company');
  f.sql.prepare('UPDATE bank_connections SET auto_sync_enabled=1 WHERE owner=?').run(f.owner);
  delete f.env.BANK_COMPANY_AUTHORIZATIONS;
  let result = await (await f.service.automaticSyncStatus()).json();
  assert.equal(result.connected, false);
  assert.equal(result.connectionStatus, 'corporate_authorization_required');
  assert.equal(result.blockedReason, 'CORPORATE_AUTHORIZATION_REQUIRED');
  f.sql.prepare("UPDATE bank_connections SET consent_metadata='',selected_accounts='[]' WHERE owner=?").run(f.owner);
  result = await (await f.service.automaticSyncStatus()).json();
  assert.equal(result.connected, false);
  assert.equal(result.connectionStatus, 'pending_account');
  assert.equal(result.nextAction, 'select_accounts');
  assert.equal(f.calls.length, 0);
});

test('95: safe account predicate is persisted and projected from the same failed connection only', async t => {
  const f = await fixture(t); await f.seedApp(); await f.seedConnection();
  f.sql.prepare('UPDATE bank_connections SET auto_sync_enabled=1 WHERE owner=?').run(f.owner);
  f.live.accounts = [extraLegacyUid]; f.live.accounts_data = [{ uid: extraLegacyUid }];
  await assert.rejects(f.service.automaticSync(), e => e.code === 'BANK_ACCOUNT_SCOPE_INVALID');
  const event = bankJobEvents(f).find(value => value.action === 'bank.job.failed');
  assert.equal(event.detail.error_code, 'BANK_ACCOUNT_SCOPE_INVALID');
  assert.equal(event.detail.validation_reason, 'SELECTED_ACCOUNT_UNAVAILABLE');
  assert.equal(event.detail.connection_id, f.connection().id);
  const result = await (await f.service.automaticSyncStatus()).json();
  assert.deepEqual(result.diagnostic, { code: 'BANK_ACCOUNT_SCOPE_INVALID',
    message: 'Bankens godkända konton kunde inte verifieras.', reason: 'SELECTED_ACCOUNT_UNAVAILABLE' });
  assert.doesNotMatch(JSON.stringify(event.detail), /22222222|44444444|SE4550|PRIVATE/);
  assert.equal(result.requiresReauthentication, true);
  assert.equal(result.nextAttemptAt, null);
  f.sql.prepare("UPDATE bank_connections SET id='replacement-connection' WHERE owner=?").run(f.owner);
  assert.equal((await (await f.service.automaticSyncStatus()).json()).diagnostic, null);
  assert.equal(f.calls.filter(call => call.name === 'getTransactions').length, 0);
});

test('95: public consent error never reflects custom or forged error properties', async t => {
  const f = await fixture(t);
  const error = new ConsentError('BANK_ACCOUNT_SCOPE_INVALID', 409, 'SYNTHETIC_SECRET_TOKEN');
  Object.defineProperty(error, 'code', { get() { throw Error('SYNTHETIC_SECRET_GETTER'); } });
  const result = f.service.bankFailure(error), body = await result.json();
  assert.equal(result.status, 409);
  assert.equal(body.code, 'BANK_ACCOUNT_SCOPE_INVALID');
  assert.equal(body.error, 'Bankens godkända konton kunde inte verifieras.');
  assert.doesNotMatch(JSON.stringify(body), /SYNTHETIC_SECRET/);
});

test('95: a partially withdrawn corporate grant cannot advertise the selected account as connected', async t => {
  const f = await fixture(t); await cachedLegacyAccounts(f, 'company');
  f.sql.prepare('UPDATE bank_connections SET selected_accounts=? WHERE owner=?').run(JSON.stringify([extraLegacyUid]), f.owner);
  companyAuthority(f);
  const before = { ...f.connection() };
  const result = await (await f.service.automaticSyncStatus()).json();
  assert.equal(result.connected, false);
  assert.equal(result.blockedReason, 'CORPORATE_AUTHORIZATION_REQUIRED');
  assert.equal(result.syncAllowed, false);
  assert.deepEqual({ ...f.connection() }, before);
  assert.equal(f.calls.length, 0);
});

test('95: public provider failure uses the original code and canonical message only', async t => {
  const f = await fixture(t);
  const error = new ProviderError('BANK_TIMEOUT', 'SYNTHETIC_PRIVATE_PROVIDER_MESSAGE', 504, true);
  Object.defineProperty(error, 'code', { get() { throw Error('SYNTHETIC_PRIVATE_PROVIDER_GETTER'); } });
  const result = f.service.bankFailure(error), body = await result.json();
  assert.equal(result.status, 502);
  assert.equal(body.code, 'BANK_TIMEOUT');
  assert.doesNotMatch(JSON.stringify(body), /SYNTHETIC_PRIVATE/);
});

for (const role of ['viewer', 'accountant']) test(`95: ${role} can read existing bank status without gaining management permission`, async t => {
  const f = await fixture(t, 'PRODUCTION', { companyContext: true }); await cachedLegacyAccounts(f, 'company'); reconnectCompanyContext(f);
  f.companyContext.role = role;
  const metadata = JSON.parse(f.connection().consent_metadata); metadata.membershipVersion = '1';
  f.sql.prepare('UPDATE bank_connections SET consent_metadata=? WHERE owner=?').run(JSON.stringify(metadata), f.owner);
  const automatic = await (await f.service.automaticSyncStatus()).json();
  assert.equal(automatic.connected, true);
  const status = await (await f.service.status(new Request(origin + '/api/bank/status'))).json();
  assert.equal(status.company.canManageBank, false);
  assert.equal(status.connection.status, 'connected');
  await assert.rejects(f.service.syncControl(post('sync')), error => error.code === 'COMPANY_ACCESS_DENIED');
  assert.equal(f.calls.length, 0);
});

test('95: authorization cannot start on a host that cannot deliver its host-only callback cookie', async t => {
  const f = await fixture(t);
  const configured = 'https://configured.example.test/api/bank/callback';
  f.env.ENABLE_BANKING_REDIRECT_URL = configured; f.info.redirect_urls = [configured];
  await assert.rejects(f.service.connect(post('connect', { bankName: 'Swedbank', country: 'SE', dateFrom: bankUtcDate() })),
    error => error.code === 'BANK_REDIRECT_CONFIGURATION_INVALID');
  assert.equal(f.calls.length, 0);
  assert.equal(count(f, 'bank_auth_flows'), 0);
});
