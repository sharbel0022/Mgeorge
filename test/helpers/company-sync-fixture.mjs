import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createCompanyBankSyncStore, companySyncError } from '../../sites/lib/company-bank-sync-store.js';

export const START = Date.parse('2026-11-04T12:00:00Z');
export function syntheticContext(id = 'A', overrides = {}) {
  return { companyId: `company-${id}`, owner: `scope-${id}`, connectionId: `connection-${id}`,
    provider: 'synthetic-bank', accountKey: `account-${id}`, accountUid: `uid-${id}`,
    consentId: `consent-${id}`, generation: 'generation-1', revision: 1,
    validUntil: '2026-11-05T12:00:00.000Z', authorizationStatus: 'VERIFIED',
    ratePolicy: { verified: true, evidenceId: 'synthetic-quota-proof', maxRequests: 10, windowMs: 86400000 },
    bankgiroEnabled: false, ...overrides };
}
export function syncFixture(t) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../../sites/drizzle/0023_saas_bank_sync.sql', import.meta.url), 'utf8'));
  sql.exec('CREATE TABLE synthetic_authorities(company_id TEXT PRIMARY KEY, owner TEXT, revision INTEGER, active INTEGER); CREATE TABLE synthetic_imports(company_id TEXT, id TEXT, raw TEXT, PRIMARY KEY(company_id,id));');
  const database = {
    prepare(query) { return { query, args: [], bind(...args) { this.args = args; return this; }, async first() { return sql.prepare(query).get(...this.args) || null; }, async all() { return { results: sql.prepare(query).all(...this.args) }; }, async run() { return this.execute(); }, execute() { return { success: true, meta: { changes: Number(sql.prepare(query).run(...this.args).changes) } }; } }; },
    async batch(statements) { sql.exec('BEGIN IMMEDIATE'); try { const values = statements.map(s => s.execute()); sql.exec('COMMIT'); return values; } catch (error) { sql.exec('ROLLBACK'); throw error; } },
    async batchWork(before, work, after) { sql.exec('BEGIN IMMEDIATE'); try { for (const s of before) s.execute(); const value = work(); if (value?.then) throw Error('ASYNC_FINANCIAL_WORK'); for (const s of after(value)) s.execute(); sql.exec('COMMIT'); return value; } catch (error) { sql.exec('ROLLBACK'); throw error; } },
  };
  let time = START;
  const store = createCompanyBankSyncStore(database, { now: () => time });
  const contexts = new Map();
  t.after(() => sql.close());
  const f = { sql, database, store, now: () => time, setTime(value) { time = value; }, contexts,
    async add(value = syntheticContext()) {
      await store.bindScope({ ...value, evidenceId: 'synthetic-binding' });
      contexts.set(value.companyId, value);
      sql.prepare('INSERT OR REPLACE INTO synthetic_authorities VALUES(?,?,?,1)').run(value.companyId, value.owner, value.revision);
      return value;
    },
    async resolveContext(request) { return contexts.get(request.companyId); },
    currentGuard(context) {
      const valid = () => { const row = sql.prepare('SELECT * FROM synthetic_authorities WHERE company_id=?').get(context.companyId); return row?.active === 1 && row.owner === context.owner && row.revision === context.revision; };
      return { assert() { if (!valid()) throw companySyncError('AUTHORIZATION_CHANGED'); }, fence() { return database.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM synthetic_authorities WHERE company_id=? AND owner=? AND revision=? AND active=1) THEN 1 ELSE json('AUTHORIZATION_CHANGED') END").bind(context.companyId, context.owner, context.revision); } };
    },
    async sync({ context, lease, request, assertCurrent }) {
      const raw = await request(async () => ({ id: 'same-provider-id', raw: 'immutable original' }));
      await assertCurrent();
      const receipt = await lease.commit({ key: 'synthetic-page', sha256: 'a'.repeat(64), statements: [database.prepare('INSERT INTO synthetic_imports VALUES(?,?,?)').bind(context.companyId, raw.id, raw.raw)], result: { imported: 1, duplicate: 0 } });
      return { complete: true, receiptKey: 'synthetic-page', imported: receipt.duplicate ? 0 : 1, duplicate: receipt.duplicate ? 1 : 0 };
    },
  };
  return f;
}

export const selector = value => ({ companyId: value.companyId, connectionId: value.connectionId, accountKey: value.accountKey });
export function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
