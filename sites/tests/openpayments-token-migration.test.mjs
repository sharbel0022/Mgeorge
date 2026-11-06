import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

const directory=new URL('../drizzle/',import.meta.url),read=path=>readFileSync(new URL(path,directory),'utf8');
const migration=read('0025_application_tokens.sql'),journal=JSON.parse(read('meta/_journal.json')).entries;
function database(t){const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());return sql;}

test('global issuer migration preserves existing customer financial bytes and originals',t=>{
 const sql=database(t);
 for(const entry of journal.filter(entry=>entry.tag!=='0025_application_tokens'))sql.exec(read(entry.tag+'.sql'));
 const payload=JSON.stringify({invoices:[{id:'synthetic-invoice',number:'0599',total:62500}],transactions:[],allocations:[]});
 sql.prepare('INSERT INTO workspaces(owner,revision,payload,updated_at) VALUES(?,?,?,?)').run('synthetic-owner',43,payload,'2026-11-06T12:00:00Z');
 sql.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run('synthetic-original','synthetic-owner','original.pdf','application/pdf',12,'f'.repeat(64),'2026-11-06T12:00:00Z');
 const rows={workspace:sql.prepare('SELECT * FROM workspaces').all(),documents:sql.prepare('SELECT * FROM documents').all()};
 sql.exec(migration);
 assert.deepEqual(sql.prepare('SELECT * FROM workspaces').all(),rows.workspace);assert.deepEqual(sql.prepare('SELECT * FROM documents').all(),rows.documents);
 assert.equal(sql.prepare('SELECT count(*) n FROM company_application_tokens').get().n,0);
 assert.deepEqual({...sql.prepare('SELECT * FROM company_application_token_control').get()},{id:1,revision:1,recovery_required:0,restore_marker:'',recovery_evidence:''});
});

test('issuer schema rejects nullable identities, malformed keys and inconsistent lease/payload state',t=>{
 const sql=database(t);sql.exec(migration);const family='a'.repeat(64),config='b'.repeat(64);
 for(const key of [null,'','g'.repeat(64),'a'.repeat(63)])assert.throws(()=>sql.prepare('INSERT INTO company_application_tokens(family_key,config_hash) VALUES(?,?)').run(key,config),/constraint/i);
 sql.prepare('INSERT INTO company_application_tokens(family_key,config_hash) VALUES(?,?)').run(family,config);
 for(const assignment of ["epoch=0","epoch=1.5","fence=1.5","revision=9007199254740992","token_ciphertext='unpaired'","lease_token='unpaired'","cooldown_blocked=2","last_safe_code='unsafe detail'","uncertain_until=-1"]){
  assert.throws(()=>sql.prepare('UPDATE company_application_tokens SET '+assignment).run(),/constraint/i);
 }
 assert.throws(()=>sql.prepare('INSERT INTO company_application_token_control(id) VALUES(2)').run(),/constraint/i);
});

test('repeated schema bootstrap cannot erase the durable restore gate',t=>{
 const sql=database(t);sql.exec(migration);
 sql.prepare("UPDATE company_application_token_control SET revision=2,recovery_required=1,restore_marker='synthetic-restore'").run();
 const before=sql.prepare('SELECT * FROM company_application_token_control').all();sql.exec(migration);
 assert.deepEqual(sql.prepare('SELECT * FROM company_application_token_control').all(),before);
});

test('Sites migration exactly matches the common issuer storage contract and chained snapshot',()=>{
 assert.equal(migration,readFileSync(new URL('../lib/banking/openpayments/token-coordinator.schema.sql',import.meta.url),'utf8'));
 const entry=journal.find(entry=>entry.tag==='0025_application_tokens');assert.ok(entry);assert.equal(entry.idx,23);
 const previous=JSON.parse(read('meta/0022_snapshot.json')),current=JSON.parse(read('meta/0023_snapshot.json'));
 assert.equal(current.prevId,previous.id);
 for(const [name,table]of Object.entries(previous.tables))assert.deepEqual(current.tables[name],table,name+' must keep its existing schema');
 for(const name of ['company_application_tokens','company_application_token_control'])assert.ok(current.tables[name]);
});
