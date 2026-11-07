import path from 'node:path';
import { lstat, mkdir, open } from 'node:fs/promises';
import { createNodeAuditStore } from '../sites/lib/openai-invoices/audit-store.js';

const APPLICATION_ID = 0x4d47424d;
const MARKER = 'openai-invoices-benchmark-ledger.v1';
const foreign = () => { throw new Error('BENCHMARK_LEDGER_FOREIGN_DATABASE'); };

function validateIdentity(database) {
  const id = database.prepare('PRAGMA application_id').get();
  if (id?.application_id !== APPLICATION_ID) foreign();
  const row = database.prepare('SELECT protocol FROM benchmark_ledger_identity WHERE id=1').get();
  if (row?.protocol !== MARKER) foreign();
  const columns = database.prepare('PRAGMA table_info(audit_events)').all().map(row => row.name);
  if (columns.join(',') !== 'id,action,details,created_at') foreign();
}

/**
 * A separate persistent SQLite journal for benchmark reservations. Existing
 * application databases are inspected read-only and rejected before any write.
 * The journal must be retained across runs and must never be rotated to reset
 * an active daily budget.
 */
export async function openBenchmarkLedger(filename, { owner, authorize = async () => {}, now } = {}) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename)) throw new Error('BENCHMARK_LEDGER_REQUIRED');
  const { DatabaseSync } = await import('node:sqlite');
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  let created = false;
  try {
    const handle = await open(filename, 'wx', 0o600);
    await handle.close();
    created = true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw new Error('BENCHMARK_LEDGER_UNAVAILABLE');
  }
  const metadata = await lstat(filename);
  if (!metadata.isFile() || metadata.isSymbolicLink()) foreign();
  const initialize = created || metadata.size === 0;
  if (!initialize) {
    let probe;
    try {
      probe = new DatabaseSync(filename, { readOnly: true });
      validateIdentity(probe);
    } catch { foreign(); }
    finally { probe?.close(); }
  }
  let database;
  try {
    database = new DatabaseSync(filename);
    database.exec('PRAGMA busy_timeout=5000');
    if (initialize) {
      // Recheck inside the write transaction to reject a concurrent replacement.
      database.exec('BEGIN IMMEDIATE');
      const objects = database.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
      if (objects.length) foreign();
      database.exec('PRAGMA application_id=' + APPLICATION_ID);
      database.exec('CREATE TABLE benchmark_ledger_identity(id INTEGER PRIMARY KEY CHECK(id=1), protocol TEXT NOT NULL)');
      database.prepare('INSERT INTO benchmark_ledger_identity(id,protocol) VALUES(1,?)').run(MARKER);
      database.exec('CREATE TABLE audit_events(id TEXT PRIMARY KEY,action TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL)');
      database.exec('COMMIT');
    }
    validateIdentity(database);
    const store = createNodeAuditStore(database, { owner, authorize, ...(now ? { now } : {}) });
    let closed = false;
    return Object.freeze({
      store,
      close() { if (!closed) { database.close(); closed = true; } },
    });
  } catch {
    try { database?.exec('ROLLBACK'); } catch {}
    try { database?.close(); } catch {}
    throw new Error('BENCHMARK_LEDGER_UNAVAILABLE');
  }
}
