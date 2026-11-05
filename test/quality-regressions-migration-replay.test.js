import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { openDatabase, listInvoices } from '../src/db.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const rawBankData = JSON.stringify({ transaction_id: 'synthetic-legacy-payment', amount: '625.00', currency: 'SEK' });
const originalImport = Buffer.from('Datum;Belopp;OCR\n2026-10-26;625.00;000018\n');
const originalDocument = Buffer.from('Synthetic historic invoice 000018: SEK 1250.00');

// This is the historic schema before original hashes, API identity versions,
// and document_sources existed. Seed it directly so openDatabase really upgrades it.
function historicDatabase(t) {
  const directory = mkdtempSync(join(tmpdir(), 'mgeorge-quality-migration-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'historic.sqlite');
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE invoices (
      id TEXT PRIMARY KEY, direction TEXT NOT NULL CHECK(direction IN ('customer','supplier')),
      invoice_number TEXT NOT NULL, party TEXT NOT NULL, email TEXT NOT NULL DEFAULT '',
      issued_at TEXT NOT NULL DEFAULT '', due_at TEXT NOT NULL DEFAULT '',
      total_cents INTEGER NOT NULL CHECK(total_cents > 0), currency TEXT NOT NULL DEFAULT 'SEK',
      reference TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE bank_transactions (
      id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, account TEXT NOT NULL,
      booked_at TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents != 0),
      currency TEXT NOT NULL DEFAULT 'SEK', payer TEXT NOT NULL DEFAULT '', reference TEXT NOT NULL DEFAULT '',
      bank_reference TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '',
      needs_review INTEGER NOT NULL DEFAULT 1, raw_bank_data TEXT NOT NULL DEFAULT '{}',
      provider_transaction_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE allocations (
      id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
      transaction_id TEXT NOT NULL REFERENCES bank_transactions(id) ON DELETE RESTRICT,
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
      confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(invoice_id, transaction_id)
    );
    CREATE TABLE audit_events (
      id TEXT PRIMARY KEY, action TEXT NOT NULL, details TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY CHECK(id = 1), data TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE import_jobs (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', found INTEGER NOT NULL DEFAULT 0,
      imported INTEGER NOT NULL DEFAULT 0, duplicate INTEGER NOT NULL DEFAULT 0, review INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'completed', error TEXT NOT NULL DEFAULT '', content BLOB,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE documents (
      id TEXT PRIMARY KEY, invoice_id TEXT REFERENCES invoices(id), name TEXT NOT NULL, mime_type TEXT NOT NULL,
      content BLOB NOT NULL, fingerprint TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'upload', source_id TEXT UNIQUE,
      metadata TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'needs_review',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare(`INSERT INTO invoices (id, direction, invoice_number, party, total_cents, reference)
    VALUES ('historic-invoice', 'customer', '000018', 'Syntetisk Kund AB', 125000, '000018')`).run();
  db.prepare(`INSERT INTO bank_transactions
    (id, fingerprint, account, booked_at, amount_cents, reference, source, raw_bank_data, provider_transaction_id)
    VALUES ('historic-payment', 'synthetic-fingerprint', 'synthetic-account', '2026-10-26', 62500,
      '000018', 'enablebanking', ?, 'synthetic-legacy-payment')`).run(rawBankData);
  db.prepare(`INSERT INTO allocations (id, invoice_id, transaction_id, amount_cents)
    VALUES ('historic-allocation', 'historic-invoice', 'historic-payment', 62500)`).run();
  db.prepare(`INSERT INTO audit_events (id, action, details)
    VALUES ('historic-audit', 'synthetic.historic.confirmation', '{"fixture":true}')`).run();
  db.prepare('INSERT INTO app_settings (id, data) VALUES (1, ?)').run(JSON.stringify({ company_name: 'Syntetisk Migrering AB' }));
  db.prepare(`INSERT INTO import_jobs (id, source, name, found, imported, content)
    VALUES ('historic-import', 'csv', 'synthetic-historic.csv', 1, 1, ?)`).run(originalImport);
  db.prepare(`INSERT INTO documents
    (id, invoice_id, name, mime_type, content, fingerprint, source_id, metadata)
    VALUES ('historic-document', 'historic-invoice', 'synthetic-historic.txt', 'text/plain', ?, ?,
      'synthetic-source-id', '{"fixture":true}')`).run(originalDocument, digest(originalDocument));
  const before = financialSnapshot(db);
  db.close();
  return { filename, before };
}

function financialSnapshot(db) {
  return {
    invoices: db.prepare('SELECT id, direction, invoice_number, party, total_cents, currency, reference FROM invoices ORDER BY id').all(),
    transactions: db.prepare('SELECT id, fingerprint, account, booked_at, amount_cents, currency, reference FROM bank_transactions ORDER BY id').all(),
    allocations: db.prepare('SELECT * FROM allocations ORDER BY id').all(),
    audit: db.prepare('SELECT * FROM audit_events ORDER BY id').all(),
    settings: db.prepare('SELECT * FROM app_settings ORDER BY id').all(),
  };
}

test('historic SQLite upgrade and repeated reopen preserve financial identity, balances, and original provenance', t => {
  const { filename, before } = historicDatabase(t);
  for (let opening = 0; opening < 3; opening++) {
    const db = openDatabase(filename);
    try {
      assert.deepEqual(financialSnapshot(db), before, `opening ${opening} must preserve existing financial records`);
      const invoice = listInvoices(db).find(item => item.id === 'historic-invoice');
      assert.equal(invoice.paid_cents, 62500);
      assert.equal(invoice.remaining_cents, 62500);
      const bank = db.prepare('SELECT raw_bank_data, raw_bank_data_sha256, api_identity_version FROM bank_transactions WHERE id = ?').get('historic-payment');
      assert.equal(bank.raw_bank_data, rawBankData);
      assert.equal(bank.raw_bank_data_sha256, digest(rawBankData));
      assert.equal(bank.api_identity_version, 1, 'a legacy API row must keep its legacy identity version');
      const imported = db.prepare('SELECT content, content_sha256 FROM import_jobs WHERE id = ?').get('historic-import');
      assert.deepEqual(Buffer.from(imported.content), originalImport);
      assert.equal(imported.content_sha256, digest(originalImport));
      assert.deepEqual(db.prepare('SELECT source_id, document_id, metadata FROM document_sources').all().map(row => ({ ...row })), [
        { source_id: 'synthetic-source-id', document_id: 'historic-document', metadata: '{"fixture":true}' },
      ]);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
      assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    } finally {
      db.close();
    }
  }
});

test('reopening an upgraded SQLite database does not bless changed bank or import originals with new hashes', t => {
  const { filename, before } = historicDatabase(t);
  let db = openDatabase(filename);
  db.close();
  db = new DatabaseSync(filename);
  db.prepare('UPDATE bank_transactions SET raw_bank_data = ? WHERE id = ?')
    .run(JSON.stringify({ transaction_id: 'synthetic-tampered-payment', amount: '999.00' }), 'historic-payment');
  db.prepare('UPDATE import_jobs SET content = ? WHERE id = ?')
    .run(Buffer.from('synthetic changed source'), 'historic-import');
  db.close();
  db = openDatabase(filename);
  try {
    const bank = db.prepare('SELECT raw_bank_data, raw_bank_data_sha256 FROM bank_transactions WHERE id = ?').get('historic-payment');
    const imported = db.prepare('SELECT content, content_sha256 FROM import_jobs WHERE id = ?').get('historic-import');
    assert.equal(bank.raw_bank_data_sha256, digest(rawBankData));
    assert.notEqual(bank.raw_bank_data_sha256, digest(bank.raw_bank_data));
    assert.equal(imported.content_sha256, digest(originalImport));
    assert.notEqual(imported.content_sha256, digest(imported.content));
    assert.deepEqual(financialSnapshot(db), before, 'opening a database must not change booked amounts or allocations');
  } finally {
    db.close();
  }
});

// Reopening a shared database must honor the configured busy timeout before
// negotiating WAL; a second process can still own the existing journal lock.
test('database startup waits for a transient journal lock before enabling WAL', { timeout: 10000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'mgeorge-quality-startup-lock-'));
  const filename = join(directory, 'locked.sqlite');
  const locker = new DatabaseSync(filename);
  locker.exec(`CREATE TABLE startup_marker (value TEXT); INSERT INTO startup_marker VALUES ('synthetic retained row');`);
  locker.exec('BEGIN EXCLUSIVE;');
  let lockHeld = true;
  const release = () => { if (lockHeld) { locker.exec('COMMIT'); lockHeld = false; } };
  t.after(() => { release(); locker.close(); rmSync(directory, { recursive: true, force: true }); });
  const source = `import {openDatabase} from ${JSON.stringify(new URL('../src/db.js', import.meta.url).href)};
    process.send({opening:true});
    try { const db=openDatabase(process.argv[1]);
      const marker=db.prepare('SELECT value FROM startup_marker').get();db.close();
      process.send({ready:true,value:marker.value});process.disconnect();
    } catch(error) { process.send({error:error.message,code:error.code});process.disconnect();process.exitCode=1; }`;
  const child = spawn(process.execPath, ['--input-type=module','--eval',source,filename], { stdio:['ignore','ignore','pipe','ipc'] });
  let diagnostics='', outcome, timer;
  child.stderr.on('data', bytes => { diagnostics = (diagnostics + bytes).slice(-12000); });
  t.after(() => { clearTimeout(timer); if(child.exitCode===null)child.kill(); });
  child.on('message', message => {
    if(message.opening) timer=setTimeout(release, 250);
    else outcome=message;
  });
  const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  assert.equal(exitCode,0,JSON.stringify(outcome)+' '+diagnostics);
  assert.deepEqual(outcome,{ready:true,value:'synthetic retained row'});
});
