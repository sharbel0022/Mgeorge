import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createBackup,restoreBackup,verifyBackup} from '../src/backup.js';

const key='4'.repeat(64),header=Buffer.from('MGBAK001');
const control='company_application_token_control',tokens='company_application_tokens';
// Independently specified persisted control-plane contract. These credentials
// and invoice originals are synthetic; no real archive or provider is read.
const controlSchema=`CREATE TABLE ${control}(id INTEGER PRIMARY KEY NOT NULL CHECK(id=1),revision INTEGER NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 9007199254740991),recovery_required INTEGER NOT NULL DEFAULT 0 CHECK(recovery_required IN (0,1)),restore_marker TEXT NOT NULL DEFAULT '' CHECK(length(restore_marker)<=100),recovery_evidence TEXT NOT NULL DEFAULT '' CHECK(length(recovery_evidence)<=200));`;
function fixture(t){
 const directory=mkdtempSync(join(tmpdir(),'mg-token-backup-')),source=join(directory,'source.sqlite'),archive=join(directory,'private.mgbak'),target=join(directory,'isolated.sqlite');
 const db=new DatabaseSync(source),original=Buffer.from('%PDF-Synthetic invoice 0599, total 625 SEK');
 db.exec("PRAGMA journal_mode=WAL; CREATE TABLE invoices(id TEXT PRIMARY KEY,invoice_number TEXT,total_cents INTEGER); CREATE TABLE bank_transactions(id TEXT PRIMARY KEY); CREATE TABLE documents(id TEXT PRIMARY KEY,content BLOB,fingerprint TEXT); INSERT INTO invoices VALUES('synthetic-invoice','0599',62500)");
 db.prepare('INSERT INTO documents VALUES(?,?,?)').run('synthetic-document',original,createHash('sha256').update(original).digest('hex'));
 t.after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});
 return{directory,source,archive,target,db,original};
}
function seal(content,path){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);cipher.setAAD(header);const encrypted=Buffer.concat([cipher.update(content),cipher.final()]);writeFileSync(path,Buffer.concat([header,iv,cipher.getAuthTag(),encrypted]),{mode:0o600});}
function unseal(path){const bytes=readFileSync(path),decipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),bytes.subarray(8,20));decipher.setAAD(header);decipher.setAuthTag(bytes.subarray(20,36));return Buffer.concat([decipher.update(bytes.subarray(36)),decipher.final()]);}
function rawArchive(f){const snapshot=join(f.directory,'raw.sqlite');f.db.prepare('VACUUM INTO ?').run(snapshot);seal(readFileSync(snapshot),f.archive);}
function sourceBytes(f){return Object.fromEntries(['','-wal'].filter(s=>existsSync(f.source+s)).map(s=>[s,readFileSync(f.source+s)]));}
function assertFinancial(db,f){assert.equal(db.prepare('SELECT invoice_number FROM invoices').get().invoice_number,'0599');assert.equal(db.prepare('SELECT total_cents FROM invoices').get().total_cents,62500);assert.deepEqual(Buffer.from(db.prepare('SELECT content FROM documents').get().content),f.original);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');}
function assertGate(db){const rows=db.prepare(`SELECT * FROM ${control}`).all();assert.equal(rows.length,1);const row={...rows[0]};assert.match(row.restore_marker,/^[a-f0-9]{64}$/);assert.deepEqual(row,{id:1,revision:row.revision,recovery_required:1,restore_marker:row.restore_marker,recovery_evidence:''});assert.ok(Number.isSafeInteger(row.revision)&&row.revision>0);return row;}

test('customer backup removes app-token state and free-page bytes only from its private snapshot',t=>{
 const f=fixture(t),secret='SYNTHETIC-APP-TOKEN-'+randomBytes(64).toString('hex');
 f.db.exec(controlSchema+`INSERT INTO ${control}(id,revision) VALUES(1,7); CREATE TABLE ${tokens}(family_key TEXT PRIMARY KEY,token_ciphertext TEXT,cooldown_until INTEGER);`);
 for(let i=0;i<8;i++)f.db.prepare(`INSERT INTO ${tokens} VALUES(?,?,?)`).run('synthetic-family-'+i,secret.repeat(80),4102444800000);
 const before=sourceBytes(f),rows=f.db.prepare(`SELECT * FROM ${tokens}`).all(),gate={...f.db.prepare(`SELECT * FROM ${control}`).get()};
 const result=createBackup(f.source,f.archive,key);assert.equal(result.verified,true);assert.equal(result.applicationTokenRecoveryRequired,true);
 assert.deepEqual(f.db.prepare(`SELECT * FROM ${tokens}`).all(),rows);assert.deepEqual({...f.db.prepare(`SELECT * FROM ${control}`).get()},gate);assert.deepEqual(sourceBytes(f),before);
 const clear=unseal(f.archive);assert.equal(clear.includes(Buffer.from(secret)),false,'discarded encrypted tokens must not remain in SQLite freelist pages');assert.equal(clear.includes(Buffer.from('synthetic-family-')),false);
 assert.equal(restoreBackup(f.archive,f.target,key).applicationTokenRecoveryRequired,true);
 const restored=new DatabaseSync(f.target,{readOnly:true});try{assert.equal(restored.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name=?").get(tokens).n,0);const row=assertGate(restored);assert.equal(row.revision,8);assertFinancial(restored,f);}finally{restored.close();}
 assert.deepEqual(readFileSync(f.target),clear,'a newly fenced archive restores its authenticated bytes exactly');assert.deepEqual(sourceBytes(f),before);
});

for(const occupied of [false,true])test(`an older raw archive with ${occupied?'occupied':'empty'} global token table is rejected before restore publication`,t=>{
 const f=fixture(t);f.db.exec(`CREATE TABLE ${tokens}(token_ciphertext TEXT)`);if(occupied)f.db.prepare(`INSERT INTO ${tokens} VALUES(?)`).run('SYNTHETIC-OLD-ISSUANCE');rawArchive(f);const original=readFileSync(f.archive);
 assert.throws(()=>verifyBackup(f.archive,key),{code:'backup_application_token_state_invalid'});assert.throws(()=>restoreBackup(f.archive,f.target,key),{code:'backup_application_token_state_invalid'});assert.equal(existsSync(f.target),false);assert.deepEqual(readFileSync(f.archive),original);
});

test('a pre-coordinator legacy archive is restored with a permanent gate and unchanged financial evidence',t=>{
 const f=fixture(t);rawArchive(f);const archived=readFileSync(f.archive),clear=unseal(f.archive),before=sourceBytes(f);assert.equal(verifyBackup(f.archive,key).verified,true);
 const result=restoreBackup(f.archive,f.target,key);assert.equal(result.applicationTokenRecoveryRequired,true);
 const restored=new DatabaseSync(f.target,{readOnly:true});try{assertGate(restored);assertFinancial(restored,f);assert.equal(restored.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name=?").get(tokens).n,0);}finally{restored.close();}
 assert.notDeepEqual(readFileSync(f.target),clear,'legacy recovery adds a control-plane barrier to a private validated copy');assert.deepEqual(readFileSync(f.archive),archived);assert.deepEqual(sourceBytes(f),before);
});

for(const [name,sql] of [
 ['active control row',`INSERT INTO ${control}(id) VALUES(1)`],
 ['missing control row',''],
 ['invalid marker',`INSERT INTO ${control}(id,recovery_required,restore_marker) VALUES(1,1,'not-a-valid-marker')`],
 ['retained operator evidence',`INSERT INTO ${control}(id,recovery_required,restore_marker,recovery_evidence) VALUES(1,1,'${'a'.repeat(64)}','synthetic-private-operator-note')`],
])test('archive rejects '+name+' instead of silently resetting authority',t=>{
 const f=fixture(t);f.db.exec(controlSchema+sql);rawArchive(f);assert.throws(()=>verifyBackup(f.archive,key),{code:'backup_application_token_state_invalid'});assert.throws(()=>restoreBackup(f.archive,f.target,key),{code:'backup_application_token_state_invalid'});assert.equal(existsSync(f.target),false);
});

test('a foreign trigger on the control table cannot change invoice data during snapshot sanitization',t=>{
 const f=fixture(t);f.db.exec(controlSchema+`INSERT INTO ${control}(id) VALUES(1); CREATE TRIGGER foreign_gate_trigger AFTER UPDATE ON ${control} BEGIN UPDATE invoices SET total_cents=1; END;`);const before=sourceBytes(f);
 assert.throws(()=>createBackup(f.source,f.archive,key),{code:'backup_application_token_state_invalid'});assert.equal(existsSync(f.archive),false);assertFinancial(f.db,f);assert.deepEqual(sourceBytes(f),before);
});

for(const reserved of [tokens,control])test('archive rejects a noncanonical case alias for '+reserved,t=>{
 const f=fixture(t),alias=reserved.toUpperCase();
 if(reserved===tokens)f.db.exec(`CREATE TABLE ${alias}(token_ciphertext TEXT); INSERT INTO ${alias} VALUES('SYNTHETIC-NONCANONICAL-TOKEN')`);
 else f.db.exec(controlSchema.replace(control,alias)+`INSERT INTO ${alias}(id) VALUES(1)`);
 rawArchive(f);const before=sourceBytes(f);
 assert.throws(()=>verifyBackup(f.archive,key),{code:'backup_application_token_state_invalid'});
 assert.throws(()=>restoreBackup(f.archive,f.target,key),{code:'backup_application_token_state_invalid'});
 assert.equal(existsSync(f.target),false);assert.deepEqual(sourceBytes(f),before);
});
