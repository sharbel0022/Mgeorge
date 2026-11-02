import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

const directory=new URL('../drizzle/',import.meta.url);
const read=path=>readFileSync(new URL(path,directory),'utf8');
const journal=JSON.parse(read('meta/_journal.json')).entries;

test('combined account guard and Bankgiro queue upgrade preserves existing financial workspace',t=>{
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 for(const entry of journal.filter(e=>e.idx<=15))sql.exec(read(entry.tag+'.sql'));
 const payload=JSON.stringify({invoices:[{id:'synthetic-invoice',number:'0599',total:62500}],transactions:[],allocations:[]});
 sql.prepare('INSERT INTO workspaces(owner,revision,payload,updated_at) VALUES(?,?,?,?)').run('synthetic-owner',43,payload,'2026-11-02T12:00:00Z');
 const before=sql.prepare('SELECT * FROM workspaces').all();
 for(const entry of journal.filter(e=>e.idx>15))sql.exec(read(entry.tag+'.sql'));
 assert.deepEqual(sql.prepare('SELECT * FROM workspaces').all(),before);
 assert.ok(sql.prepare('PRAGMA table_info(bank_connections)').all().some(column=>column.name==='account_evidence_retry'));
 for(const name of ['bankgiro_ingest_jobs','bankgiro_ingest_sources','bankgiro_ingest_leases']){
  assert.equal(sql.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get().count,0);
 }
 assert.throws(()=>sql.prepare("INSERT INTO bankgiro_ingest_jobs(id,owner) VALUES('incomplete','synthetic-owner')").run(),/NOT NULL/);
});

test('combined migration journal has unique ordered entries and chained complete snapshots',()=>{
 assert.equal(new Set(journal.map(e=>e.idx)).size,journal.length);
 assert.equal(new Set(journal.map(e=>e.tag)).size,journal.length);
 const account=journal.find(e=>e.tag==='0016_agent2_account_read_guard');
 const bankgiro=journal.find(e=>e.tag==='0017_bankgiro_auto_ingest');
 assert.ok(account&&bankgiro);assert.equal(bankgiro.idx,account.idx+1);
 const prior=JSON.parse(read('meta/0016_snapshot.json'));
 const current=JSON.parse(read('meta/0017_snapshot.json'));
 assert.equal(current.prevId,prior.id);
 assert.ok(current.tables.bank_connections.columns.account_evidence_retry);
 for(const name of ['bankgiro_ingest_jobs','bankgiro_ingest_sources','bankgiro_ingest_leases'])assert.ok(current.tables[name]);
});
