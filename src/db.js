import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest, passwordHash } from './security.js';

export function openDatabase(filename=process.env.DB_PATH || './data/mgeorge.sqlite') {
  const path=resolve(filename); mkdirSync(dirname(path),{recursive:true,mode:0o700});
  const db=new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins(id INTEGER PRIMARY KEY, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(id_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS invoices(
      id TEXT PRIMARY KEY, direction TEXT NOT NULL CHECK(direction IN ('customer','supplier')),
      invoice_number TEXT NOT NULL, party TEXT NOT NULL, email TEXT NOT NULL DEFAULT '',
      issued_at TEXT NOT NULL DEFAULT '', due_at TEXT NOT NULL DEFAULT '',
      total_cents INTEGER NOT NULL CHECK(total_cents>0), currency TEXT NOT NULL DEFAULT 'SEK',
      reference TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS bank_transactions(
      id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, account TEXT NOT NULL,
      booked_at TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents!=0),
      currency TEXT NOT NULL DEFAULT 'SEK', payer TEXT NOT NULL DEFAULT '',
      reference TEXT NOT NULL DEFAULT '', bank_reference TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '',
      needs_review INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS allocations(
      id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
      transaction_id TEXT NOT NULL REFERENCES bank_transactions(id) ON DELETE RESTRICT,
      amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
      confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(invoice_id,transaction_id)
    );
    CREATE TABLE IF NOT EXISTS audit_events(id TEXT PRIMARY KEY,action TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS bank_states(state_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL,consumed INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS bank_connections(
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, bank_name TEXT NOT NULL,
      encrypted_session TEXT NOT NULL, accounts_json TEXT NOT NULL,
      valid_until TEXT NOT NULL, last_synced TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'connected',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS mail_candidates(
      id TEXT PRIMARY KEY, provider_message_id TEXT NOT NULL UNIQUE, mailbox TEXT NOT NULL,
      sender TEXT NOT NULL, subject TEXT NOT NULL, snippet TEXT NOT NULL,
      received_at TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'needs_review',
      status TEXT NOT NULL DEFAULT 'needs_review', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  if(!db.prepare('SELECT id FROM admins WHERE id=1').get()) {
    const password=process.env.MG_ADMIN_PASSWORD;
    if(!password || password.length<16 || password.includes('replace-with-')) throw new Error('Set MG_ADMIN_PASSWORD (at least 16 characters) before first run');
    db.prepare('INSERT INTO admins(id,password_hash) VALUES(1,?)').run(passwordHash(password));
  }
  return db;
}
export function audit(db,action,details={}) {
  db.prepare('INSERT INTO audit_events(id,action,details) VALUES(?,?,?)').run(randomUUID(),action,JSON.stringify(details));
}
export function listInvoices(db) {
  return db.prepare(`SELECT i.*, COALESCE((SELECT SUM(a.amount_cents) FROM allocations a WHERE a.invoice_id=i.id),0) AS paid_cents FROM invoices i ORDER BY i.due_at ASC, i.created_at DESC`).all().map(i=>({...i,remaining_cents:i.total_cents-i.paid_cents,status:i.total_cents===i.paid_cents?'paid':i.paid_cents>0?'partial':'unpaid'}));
}
export function listTransactions(db) {
  return db.prepare(`SELECT t.*, COALESCE((SELECT SUM(a.amount_cents) FROM allocations a WHERE a.transaction_id=t.id),0) AS allocated_cents FROM bank_transactions t ORDER BY t.booked_at DESC,t.created_at DESC`).all().map(t=>({...t,available_cents:Math.abs(t.amount_cents)-t.allocated_cents}));
}
export function invoiceStatus(db) {
  const invoices=listInvoices(db);
  return {
    customer_open_cents: invoices.filter(i=>i.direction==='customer').reduce((s,i)=>s+i.remaining_cents,0),
    supplier_open_cents: invoices.filter(i=>i.direction==='supplier').reduce((s,i)=>s+i.remaining_cents,0),
    customer_overdue_cents: invoices.filter(i=>i.direction==='customer'&&i.due_at&&i.due_at<new Date().toISOString().slice(0,10)).reduce((s,i)=>s+i.remaining_cents,0),
    customer_paid_cents: invoices.filter(i=>i.direction==='customer').reduce((s,i)=>s+i.paid_cents,0),
    invoice_count: invoices.length,
    unmatched_count: listTransactions(db).filter(t=>t.available_cents>0).length
  };
}
export function storeTransactions(db,items,source) {
  const insert=db.prepare(`INSERT OR IGNORE INTO bank_transactions(id,fingerprint,account,booked_at,amount_cents,currency,payer,reference,bank_reference,description,source,needs_review) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)`);
  let imported=0,duplicate=0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for(const x of items){
      const f=digest([x.account,x.booked_at,x.amount_cents,x.currency,x.bank_reference,x.reference,x.payer,x.description].join('\u001f'));
      const r=insert.run(randomUUID(),f,x.account,x.booked_at,x.amount_cents,x.currency,x.payer,x.reference,x.bank_reference,x.description,source);
      if(r.changes)imported++;else duplicate++;
    }
    audit(db,'bank_import',{source,imported,duplicate}); db.exec('COMMIT');
  } catch(e) {db.exec('ROLLBACK');throw e;}
  return {imported,duplicate};
}
export function allocate(db,invoiceId,transactionId,amountCents) {
  if(!Number.isSafeInteger(amountCents)||amountCents<=0)throw new Error('Ange ett positivt belopp');
  db.exec('BEGIN IMMEDIATE');
  try {
    const i=listInvoices(db).find(x=>x.id===invoiceId),t=listTransactions(db).find(x=>x.id===transactionId);
    if(!i||!t)throw new Error('Faktura eller bankhändelse saknas');
    if((i.direction==='customer'&&t.amount_cents<0)||(i.direction==='supplier'&&t.amount_cents>0))throw new Error('Fel betalningsriktning');
    if(i.currency!==t.currency)throw new Error('Valutorna skiljer sig');
    if(amountCents>i.remaining_cents||amountCents>t.available_cents)throw new Error('Beloppet överskrider återstående saldo');
    if(!t.payer&&!t.reference)throw new Error('Betalare/referens saknas. Komplettera bankunderlag före matchning.');
    db.prepare('INSERT INTO allocations(id,invoice_id,transaction_id,amount_cents) VALUES(?,?,?,?)').run(randomUUID(),invoiceId,transactionId,amountCents);
    audit(db,'manual_match',{invoiceId,transactionId,amountCents}); db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
}
export function deleteAllocation(db,id){
  const r=db.prepare('DELETE FROM allocations WHERE id=?').run(id);
  if(r.changes)audit(db,'undo_match',{id});return r.changes>0;
}
