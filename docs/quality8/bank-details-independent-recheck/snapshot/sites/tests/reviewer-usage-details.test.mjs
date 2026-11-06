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
import { ConsentError, bankAccountScopeError, validateLegacyEnableSelection } from '../lib/bank-consent-policy.js';
import { seal, unseal, randomToken, digest, validFlowToken, cookieValue } from '../lib/banking/security.ts';
import { runtimeBankConfig, runtimeBankStatus } from '../lib/banking/runtime-config.ts';
import { confirmedBankConsent } from '../lib/banking/status-view.ts';
import { accountReadCooldown } from '../lib/banking/account-read-cooldown.ts';
import { applyCurrentMigrations, businessSql } from './helpers/company-compat-fixture.mjs';
import { provisionCompany } from '../lib/company-storage.js';

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
const post = (path, body = {}, requestOrigin = origin) => new Request(`${origin}/api/bank/${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(requestOrigin === null ? {} : { Origin: requestOrigin }), 'CF-Connecting-IP': '192.0.2.1', 'User-Agent': 'MG local security tests' }, body: JSON.stringify(body),
});
const count = (f, table) => f.sql.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
const financialAuditCount = f => f.sql.prepare("SELECT count(*) AS n FROM audit_events WHERE action NOT LIKE 'bank.job.%'").get().n;
const bankJobEvents = f => f.sql.prepare("SELECT action,detail,created_at,revision FROM audit_events WHERE owner=? AND action LIKE 'bank.job.%' ORDER BY rowid").all(f.owner).map(row=>({...row,detail:JSON.parse(row.detail)}));
const usageCounts = (patch={}) => ({omitted:0,orga:0,priv:0,explicitNull:0,otherString:0,wrongType:0,...patch});
const usageDiagnostic = (saved,live,selectedCount=1) => ({version:'selected-account-usage-v1',selectedCount,saved:usageCounts(saved),live:usageCounts(live)});

async function fixture(t, environment = 'PRODUCTION', { actualProvider = false } = {}) {
  const key = `__mgBankTest_${crypto.randomUUID().replaceAll('-', '')}`;
  const sql = new DatabaseSync(':memory:');
  applyCurrentMigrations(sql);
  const f = { sql, owner: 'owner-alice', user: { userId: 'owner-alice' }, calls: [], provider: {}, env: {
    BANK_DATA_ENCRYPTION_KEY: randomToken(), ENABLE_BANKING_APPLICATION_ID: appId,
    ENABLE_BANKING_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nVEVTVC1PTkxZLU5PVC1SRUFM\n-----END PRIVATE KEY-----',
    ENABLE_BANKING_ENVIRONMENT: environment, ENABLE_BANKING_KEY_ROTATED: 'true',
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
  const storeUrl = compiledModule('../lib/banking/store.ts', { 'cloudflare:workers': cloudflare, '@/lib/server': serverUrl, './security': security, './runtime-config': runtimeConfig, './transactions': normalizerUrl });
  const providerFunctions = ['getApplication', 'listBusinessBanks', 'startAuth', 'createSession', 'getSession', 'getAccountDetails', 'deleteSession', 'getTransactions'];
  const providerUrl = actualProvider ? new URL('../lib/banking/enable-banking.ts', import.meta.url).href : jsUrl(`export {ProviderError,providerCooldownDiagnostic,providerErrorCode} from ${JSON.stringify(new URL('../lib/banking/enable-banking.ts', import.meta.url).href)};` + providerFunctions.map(name => `export async function ${name}(...args){const f=globalThis[${JSON.stringify(key)}];f.calls.push({name:${JSON.stringify(name)},args});return f.provider[${JSON.stringify(name)}](...args);}`).join('\n'));
  const readGuardUrl = compiledModule('../lib/banking/account-read-guard.ts', { '../server': serverUrl, './store': storeUrl, './enable-banking': providerUrl });
  const openPaymentsSchedulerUrl = compiledModule('../lib/banking/openpayments-scheduler.ts', { 'cloudflare:workers': cloudflare, '../server': serverUrl });
  const serviceUrl = compiledModule('../lib/banking/service.ts', { '@/lib/server': serverUrl, '@/lib/domain': domain, './enable-banking': providerUrl, './transactions': normalizerUrl, './store': storeUrl, './security': security, './runtime-config': runtimeConfig, './account-read-guard': readGuardUrl, './openpayments-scheduler':openPaymentsSchedulerUrl, './company-sync':jsUrl('export async function dispatchCompanyAutomaticSync(){return null;}'), '../bankgiro-ingest-service':jsUrl(`export async function runBankgiroSource(owner){globalThis[${JSON.stringify(key)}].reportOwner=owner;return {enabled:false,state:'DISABLED'};}`),'../customer-messages': jsUrl(`export async function reconcileAndPrepare(){if(globalThis[${JSON.stringify(key)}].reconcileError)throw Error('synthetic postprocessing failure');}`) });
  f.server = await import(serverUrl); f.store = await import(storeUrl); f.service = await import(serviceUrl);
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
  f.start = async (options = {}) => {
    const response = await f.service.connect(post('connect', { bankName: 'Swedbank', country: 'SE', dateFrom: bankUtcDate(), ...options }));
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


const usageDetailsVersion='selected-account-usage-details-v1';
const usageDetailsObserved=(patch,amount=1)=>({version:usageDetailsVersion,status:'observed',reason:'EXACT_SELECTED_DETAILS_OBSERVED',targetCount:amount,attemptedCount:amount,observedCount:amount,usage:usageCounts(patch)});
async function usageDetailsFixture(t,size=1,{actualProvider=false}={}){
 const f=await fixture(t,'PRODUCTION',{actualProvider});
 if(actualProvider)f.env.ENABLE_BANKING_PRIVATE_KEY=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}}).privateKey;
 await f.seedApp();
 const values=Array.from({length:size},(_,i)=>({...f.account,uid:i===0?accountUid:`${String(i+4).padStart(8,'0')}-4444-4444-8444-444444444444`,usage:null,identification_hash:'SYNTHETIC_PRIMARY_'+i,account_id:{other:{identification:'SYNTHETIC_ACCOUNT_'+i,scheme_name:'BBAN'}}}));
 f.account=values[0];const id=await f.seedConnection();f.retainedUsageAccounts=values;f.usageDetails=new Map(values.map(value=>[value.uid,{...structuredClone(value),usage:'ORGA',cash_account_type:'CACC'}]));
 const encrypted=await f.store.encrypt(f.owner,`accounts:${id}`,values);
 f.sql.prepare("UPDATE bank_connections SET encrypted_accounts=?,selected_accounts=?,status='reauth_required'").run(encrypted,JSON.stringify(values.map(value=>value.uid)));
 f.live.accounts=values.map(value=>value.uid);f.live.accounts_data=values.map(value=>({uid:value.uid,identification_hash:value.identification_hash}));
 f.provider.getAccountDetails=async(_config,uid)=>structuredClone(f.usageDetails.get(uid));
 f.setRetainedUsageAccounts=async(values,selection=JSON.parse(f.connection().selected_accounts))=>{
  const encrypted=await f.store.encrypt(f.owner,`accounts:${id}`,values);f.sql.prepare('UPDATE bank_connections SET encrypted_accounts=?,selected_accounts=?').run(encrypted,JSON.stringify(selection));f.retainedUsageAccounts=values;
 };
 if(actualProvider)t.mock.method(globalThis,'fetch',async(address,options)=>{
  const target=new URL(address);assert.equal(target.origin,'https://api.enablebanking.com');assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');
  if(target.pathname==='/sessions/'+remoteSession){f.calls.push({name:'getSession',args:[null,remoteSession]});return Response.json(f.live);}
  const match=/^\/accounts\/([a-f0-9-]+)\/details$/.exec(target.pathname);assert.ok(match,'Only the retained session and selected account details may be read');
  f.calls.push({name:'getAccountDetails',args:[null,match[1]]});return f.detailsResponse?f.detailsResponse(match[1]):Response.json(f.usageDetails.get(match[1]));
 });
 return f;
}
async function usageDetailsDenial(f){let error;try{await f.service.revalidateConsent(post('revalidate'));}catch(caught){error=caught;}assert.ok(error instanceof ConsentError);const response=f.service.bankFailure(error),body=await response.json();assert.equal(response.status,409);assert.equal(body.code,'BANK_ACCOUNT_SCOPE_INVALID');assert.equal(body.reason,'ACCOUNT_USAGE_INVALID');return {error,body};}


// Independent reviewer probes: product code is imported from the exact archive;
// only the existing synthetic fixture above is reused.
function assertNoFinancialEffects(f) {
 assert.equal(f.connection().status,'reauth_required');
 assert.equal(f.workspace(),null);
 assert.equal(count(f,'bank_sync_runs'),0);
 assert.equal(f.sql.prepare("SELECT count(*) n FROM audit_events WHERE action='bank.consent.revalidated'").get().n,0);
}
const failedAuditBatch = statements => statements.some(s=>s.values?.includes('bank.consent.revalidation.failed'));

test('reviewer: complete maximum-sized mixed batch preserves the original denial and row',async t=>{
 const f=await usageDetailsFixture(t,5);
 const values=[ 'ORGA','PRIV',null,'PRIVATE_UNKNOWN',undefined ];
 f.retainedUsageAccounts.forEach((account,index)=>{
  const details=f.usageDetails.get(account.uid);details.usage=values[index];
  if(index===0)delete details.uid;
  if(index===4)delete details.usage;
 });
 const before={...f.connection()},{body}=await usageDetailsDenial(f);
 assert.deepEqual(body.usageDetailsDiagnostic,usageDetailsObserved({orga:1,priv:1,explicitNull:1,otherString:1,omitted:1},5));
 assert.deepEqual(f.calls.filter(c=>c.name==='getAccountDetails').map(c=>c.args[1]),f.retainedUsageAccounts.map(a=>a.uid));
 assert.deepEqual({...f.connection()},before);assertNoFinancialEffects(f);
 for(const value of ['PRIVATE_UNKNOWN',...f.retainedUsageAccounts.map(a=>a.uid),'SYNTHETIC_PRIMARY_'])assert.ok(!JSON.stringify(body).includes(value));
});

test('reviewer: provider failure on the fifth result withholds all partial usage',async t=>{
 const f=await usageDetailsFixture(t,5),before={...f.connection()};let calls=0;
 f.provider.getAccountDetails=async(_config,uid)=>{if(++calls===5)throw new ProviderError('BANK_TIMEOUT','PRIVATE_LAST_RESULT',504,true);return structuredClone(f.usageDetails.get(uid));};
 const {body}=await usageDetailsDenial(f);
 assert.deepEqual(body.usageDetailsDiagnostic,{version:usageDetailsVersion,status:'unavailable',reason:'DETAILS_PROVIDER_UNAVAILABLE',targetCount:5,attemptedCount:5,observedCount:4});
 assert.equal(calls,5);assert.ok(!JSON.stringify(body).includes('PRIVATE_LAST_RESULT'));
 assert.deepEqual({...f.connection()},before);assertNoFinancialEffects(f);
});

test('reviewer: app metadata changes atomically at final failed audit suppress the five-result diagnosis',async t=>{
 const f=await usageDetailsFixture(t,5),batch=f.d1.batch.bind(f.d1);
 f.d1.batch=async statements=>{if(failedAuditBatch(statements))f.sql.prepare('UPDATE bank_applications SET metadata=?').run(JSON.stringify({...f.info,countries:['NO']}));return batch(statements);};
 const {body}=await usageDetailsDenial(f);
 assert.equal(f.calls.filter(c=>c.name==='getAccountDetails').length,5);
 assert.ok(!('usageDetailsDiagnostic' in body));assert.ok(!('usageDiagnostic' in body));
 assert.equal(f.sql.prepare("SELECT count(*) n FROM audit_events WHERE action='bank.consent.revalidation.failed'").get().n,0);
 assertNoFinancialEffects(f);
});

test('reviewer: a committed failed audit with lost acknowledgement cannot publish completed categories',async t=>{
 const f=await usageDetailsFixture(t,5),batch=f.d1.batch.bind(f.d1),before={...f.connection()};
 f.d1.batch=async statements=>{const result=await batch(statements);if(failedAuditBatch(statements))throw Error('PRIVATE_LOST_AUDIT_ACK');return result;};
 const {body}=await usageDetailsDenial(f);
 assert.equal(f.calls.filter(c=>c.name==='getAccountDetails').length,5);
 assert.ok(!('usageDetailsDiagnostic' in body));assert.ok(!('usageDiagnostic' in body));
 assert.equal(f.sql.prepare("SELECT count(*) n FROM audit_events WHERE action='bank.consent.revalidation.failed'").get().n,1);
 assert.ok(!JSON.stringify(body).includes('PRIVATE_LOST_AUDIT_ACK'));assert.deepEqual({...f.connection()},before);assertNoFinancialEffects(f);
});

test('reviewer: connection mutation after the failed audit commits suppresses completed categories',async t=>{
 const f=await usageDetailsFixture(t,5),batch=f.d1.batch.bind(f.d1);
 f.d1.batch=async statements=>{const result=await batch(statements);if(failedAuditBatch(statements))f.sql.prepare("UPDATE bank_connections SET date_from='2001-01-01'").run();return result;};
 const {body}=await usageDetailsDenial(f);
 assert.equal(f.calls.filter(c=>c.name==='getAccountDetails').length,5);
 assert.ok(!('usageDetailsDiagnostic' in body));assert.ok(!('usageDiagnostic' in body));
 assert.equal(f.sql.prepare("SELECT count(*) n FROM audit_events WHERE action='bank.consent.revalidation.failed'").get().n,1);
 assertNoFinancialEffects(f);
});

test('reviewer: deadline expiry after all results but before audit acknowledgement suppresses categories',async t=>{
 const f=await usageDetailsFixture(t,5),batch=f.d1.batch.bind(f.d1);let clock=Date.now();
 t.mock.method(Date,'now',()=>clock);f.live.access.valid_until=new Date(clock+60000).toISOString();
 f.d1.batch=async statements=>{const result=await batch(statements);if(failedAuditBatch(statements))clock+=61000;return result;};
 const {body}=await usageDetailsDenial(f);
 assert.equal(f.calls.filter(c=>c.name==='getAccountDetails').length,5);
 assert.ok(!('usageDetailsDiagnostic' in body));assert.ok(!('usageDiagnostic' in body));
 assertNoFinancialEffects(f);
});

test('reviewer: actual provider adapter must reject contradictory fresh primary IBAN values',async t=>{
 const f=await usageDetailsFixture(t,1,{actualProvider:true});
 const details=f.usageDetails.get(f.retainedUsageAccounts[0].uid);
 details.account_id={iban:'SE4550000000058398257466',other:{scheme_name:'IBAN',identification:'SE4550000000058398257474'}};
 const before={...f.connection()},{body}=await usageDetailsDenial(f);
 assert.deepEqual(f.calls.map(call=>call.name),['getSession','getAccountDetails']);
 assert.deepEqual({...f.connection()},before);assertNoFinancialEffects(f);
 assert.deepEqual(body.usageDetailsDiagnostic,{version:usageDetailsVersion,status:'unavailable',reason:'DETAILS_ACCOUNT_CONFLICT',targetCount:1,attemptedCount:1,observedCount:0});
});
