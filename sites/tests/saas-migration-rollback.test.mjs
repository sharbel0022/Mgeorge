import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provisionCompany, resolveCompanyScope, createCompanyDatabase } from '../lib/company-storage.js';

const migrations = new URL('../drizzle/', import.meta.url);
const read = name => readFileSync(new URL(name, migrations), 'utf8');
const journal = JSON.parse(read('meta/_journal.json')).entries;
const quoted = name => '"' + name.replaceAll('"', '""') + '"';

test('the release migration journal includes every SQL file exactly once in execution order', t => {
  const files = readdirSync(migrations).filter(name => /^\d{4}.*\.sql$/.test(name)).sort();
  assert.equal(new Set(journal.map(entry => entry.idx)).size, journal.length);
  assert.equal(new Set(journal.map(entry => entry.tag)).size, journal.length);
  assert.deepEqual(journal.map(entry => entry.tag + '.sql').sort(), files);
  for (let index = 0; index < journal.length; index++) {
    assert.equal(journal[index].idx, index);
    if (index) assert.ok(journal[index].when > journal[index - 1].when);
  }
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=ON');
  for (const entry of journal) db.exec(read(entry.tag + '.sql'));
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

// Real SQL and transactions with the D1 shape used by the application. The
// getter allows closing/reopening the actual file without replacing the API.
function adapter(current) {
  return {
    prepare(query) {
      return {
        args: [],
        bind(...args) { return { ...this, args }; },
        async first() { return current().prepare(query).get(...this.args) ?? null; },
        async all() { return { results: current().prepare(query).all(...this.args), success: true, meta: { changes: 0 } }; },
        async run() { return this.execute(); },
        execute() {
          const statement = current().prepare(query);
          if (statement.columns().length) return { results: statement.all(...this.args), success: true, meta: { changes: 0 } };
          return { results: [], success: true, meta: { changes: Number(statement.run(...this.args).changes) } };
        },
      };
    },
    async batch(statements) {
      const db = current();
      db.exec('BEGIN');
      try { const rows = statements.map(statement => statement.execute()); db.exec('COMMIT'); return rows; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
}

test('persisted upgrade preserves originals and rejects pre-tenant writes after adoption and reopen', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'mg-saas-migration-'));
  const filename = join(directory, 'upgrade.sqlite'), checkpoint = join(directory, 'before-tenancy.sqlite');
  let db = new DatabaseSync(filename);
  t.after(() => { db?.close(); rmSync(directory, { recursive: true, force: true }); });
  db.exec('PRAGMA foreign_keys=ON');
  for (const entry of journal.filter(entry => entry.idx < 19)) db.exec(read(entry.tag + '.sql'));
  const payload = JSON.stringify({
    invoices: [{ id: 'synthetic-invoice', number: '0599', total: 75000 }],
    transactions: [{ id: 'synthetic-bank', amount: 62500 }],
    allocations: [{ id: 'synthetic-allocation', invoiceId: 'synthetic-invoice', transactionId: 'synthetic-bank', amount: 62500 }],
  });
  const original = Buffer.from('synthetic retained migration original');
  const originalHash = createHash('sha256').update(original).digest('hex');
  db.prepare('INSERT INTO workspaces VALUES(?,9,?,?)').run('legacy-actor', payload, '2026-01-01');
  db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?)').run('original', 'legacy-actor', 'original.txt', 'text/plain', original.length, originalHash, '2026-01-01');
  db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?,?)').run('historic', 'legacy-actor', 9, 'synthetic.legacy', '{"retained":true}', '2026-01-01');
  const snapshot = () => Object.fromEntries(['workspaces', 'documents', 'audit_events'].map(name =>
    [name, db.prepare('SELECT * FROM ' + quoted(name) + ' ORDER BY owner').all()]));
  const before = snapshot();
  db.close(); db = null;
  copyFileSync(filename, checkpoint);
  db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys=ON');
  for (const entry of journal.filter(entry => entry.idx >= 19)) db.exec(read(entry.tag + '.sql'));
  assert.deepEqual(snapshot(), before);
  // Until verified adoption, the existing owner installation remains writable.
  assert.equal(db.prepare('UPDATE workspaces SET revision=revision+1 WHERE owner=?').run('legacy-actor').changes, 1);
  const raw = adapter(() => db);
  await provisionCompany(raw, {
    id: 'adopted-company', name: 'Synthetic migration company', actorId: 'legacy-actor',
    legacyOwner: 'legacy-actor', verifiedLegacyOwner: 'legacy-actor', verifiedBy: 'synthetic-operator',
    verificationEvidence: 'Synthetic verified namespace adoption.',
  });
  const retained = snapshot();
  for (let reopen = 0; reopen < 3; reopen++) {
    if (reopen) { db.close(); db = new DatabaseSync(filename); db.exec('PRAGMA foreign_keys=ON'); }
    for (const [query, args] of [
      ['UPDATE workspaces SET payload=? WHERE owner=?', ['{}', 'legacy-actor']],
      ['DELETE FROM documents WHERE owner=?', ['legacy-actor']],
      ['INSERT INTO audit_events VALUES(?,?,?,?,?,?)', ['rollback-writer', 'legacy-actor', 11, 'synthetic.rollback', '{}', '2026-01-02']],
    ]) assert.throws(() => db.prepare(query).run(...args), /COMPANY_BOUNDARY_VIOLATION/);
    assert.deepEqual(snapshot(), retained, 'a pre-tenant writer cannot erase ledger, original metadata or audit after reopening');
    const scope = await resolveCompanyScope(raw, 'legacy-actor', { companyId: 'adopted-company', contextVersion: 1 });
    const scoped = createCompanyDatabase(raw, async () => scope);
    assert.equal((await scoped.prepare('SELECT payload FROM workspaces').first()).payload, payload);
    assert.equal((await scoped.prepare('SELECT sha256 FROM documents').first()).sha256, originalHash);
    assert.equal(db.prepare('SELECT count(*) n FROM company_operation_guard').get().n, 0);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  }
  // This separately retained pre-migration file is usable by the old SQL shape.
  // It is a synthetic checkpoint, not authorization to downgrade a live tenant DB.
  const previous = new DatabaseSync(checkpoint);
  try {
    assert.equal(previous.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name='companies'").get().n, 0);
    assert.equal(previous.prepare('SELECT payload FROM workspaces').get().payload, payload);
    assert.equal(previous.prepare('SELECT sha256 FROM documents').get().sha256, originalHash);
    assert.equal(previous.prepare('UPDATE workspaces SET revision=revision+1').run().changes, 1);
  } finally { previous.close(); }
});
