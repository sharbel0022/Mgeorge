import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createCipheriv,createHash,randomBytes} from 'node:crypto';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,recordImport,storeDocument,storeTransactions} from '../src/db.js';
import {normalizeBankApiTransaction} from '../src/importers.js';
import {createBackup,restoreBackup,verifyBackup} from '../src/backup.js';

const key='a'.repeat(64);
function fixture(t){
 const folder=mkdtempSync(join(tmpdir(),'mg-backup-integrity-')),path=join(folder,'source.sqlite'),db=openDatabase(path);
 t.after(()=>{db.close();rmSync(folder,{recursive:true,force:true});});
 return{folder,path,db,archive:join(folder,'snapshot.mgbak'),target:join(folder,'restored.sqlite')};
}
function original(f,kind){
 const bytes=Buffer.from(kind==='document'?'%PDF-Synthetic invoice original':'date;amount;reference\n2026-10-30;625.00;SYNTHETIC');
 if(kind==='document')return{id:storeDocument(f.db,{name:'synthetic.pdf',mime_type:'application/pdf',bytes}).id,bytes,table:'documents',hash:'fingerprint'};
 return{id:recordImport(f.db,{source:'bank_file',name:'synthetic.csv',content:bytes,mime_type:'text/csv'}),bytes,table:'import_jobs',hash:'content_sha256'};
}
function apiOriginal(f){
 const raw={status:'BOOK',entry_reference:'SYNTHETIC-API-ORIGINAL',transaction_id:'SYNTHETIC-LOOKUP',booking_date:'2026-10-30',credit_debit_indicator:'CRDT',transaction_amount:{amount:'625.00',currency:'SEK'},debtor:{name:'Synthetic API payer'},reference_number:'SYNTHETIC-01'};
 storeTransactions(f.db,[normalizeBankApiTransaction(raw,'synthetic-account')],'enablebanking');
 const row=f.db.prepare('SELECT * FROM bank_transactions').get();
 assert.equal(row.raw_bank_data,JSON.stringify(raw));
 assert.equal(row.raw_bank_data_sha256,createHash('sha256').update(JSON.stringify(raw)).digest('hex'));
 return row;
}
// Model an authenticated archive produced before original-hash verification existed.
// The production create function must not be needed to build an invalid old archive.
function legacyArchive(f){
 const snapshot=join(f.folder,'legacy.sqlite');f.db.prepare('VACUUM INTO ?').run(snapshot);
 const header=Buffer.from('MGBAK001'),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);
 cipher.setAAD(header);const encrypted=Buffer.concat([cipher.update(readFileSync(snapshot)),cipher.final()]);
 writeFileSync(f.archive,Buffer.concat([header,iv,cipher.getAuthTag(),encrypted]));
 return readFileSync(f.archive);
}

for(const kind of ['document','bank file']){
 test(`creating a backup rejects a ${kind} original whose bytes disagree with its retained hash`,t=>{
  const f=fixture(t),source=original(f,kind),damaged=Buffer.from('synthetic stored-byte corruption');
  f.db.prepare(`UPDATE ${source.table} SET content=? WHERE id=?`).run(damaged,source.id);
  const before=f.db.prepare(`SELECT content,${source.hash} hash FROM ${source.table} WHERE id=?`).get(source.id);
  assert.throws(()=>createBackup(f.path,f.archive,key),{code:'backup_original_hash_mismatch'});
  assert.equal(existsSync(f.archive),false);
  assert.deepEqual(f.db.prepare(`SELECT content,${source.hash} hash FROM ${source.table} WHERE id=?`).get(source.id),before,'source evidence must remain unchanged');
 });

 test(`verification and isolated restoration reject an authenticated old archive with a damaged ${kind} original`,t=>{
  const f=fixture(t),source=original(f,kind);
  f.db.prepare(`UPDATE ${source.table} SET content=? WHERE id=?`).run(Buffer.from('synthetic damaged original'),source.id);
  const archive=legacyArchive(f);
  assert.throws(()=>verifyBackup(f.archive,key),{code:'backup_original_hash_mismatch'});
  assert.throws(()=>restoreBackup(f.archive,f.target,key),{code:'backup_original_hash_mismatch'});
  assert.equal(existsSync(f.target),false,'failed verification must not create a restoration target');
  const existing=Buffer.from('Existing recovery target must be preserved');writeFileSync(f.target,existing);
  assert.throws(()=>restoreBackup(f.archive,f.target,key),{code:'backup_original_hash_mismatch'});
  assert.deepEqual(readFileSync(f.target),existing);assert.deepEqual(readFileSync(f.archive),archive);
 });

 for(const value of ['', 'not-a-sha256'])test(`legacy ${kind} original with ${value?'malformed':'missing'} hash fails closed without backfilling trust`,t=>{
  const f=fixture(t),source=original(f,kind);
  f.db.prepare(`UPDATE ${source.table} SET ${source.hash}=? WHERE id=?`).run(value,source.id);
  const archive=legacyArchive(f);
  assert.throws(()=>verifyBackup(f.archive,key),{code:'backup_original_hash_unavailable'});
  assert.throws(()=>restoreBackup(f.archive,f.target,key),{code:'backup_original_hash_unavailable'});
  assert.equal(existsSync(f.target),false);
  assert.equal(f.db.prepare(`SELECT ${source.hash} hash FROM ${source.table} WHERE id=?`).get(source.id).hash,value);
  assert.deepEqual(readFileSync(f.archive),archive);
 });
}

test('legacy retained bank originals without a hash column cannot be declared verified',t=>{
 const f=fixture(t);original(f,'bank file');f.db.exec('ALTER TABLE import_jobs DROP COLUMN content_sha256');legacyArchive(f);
 assert.throws(()=>createBackup(f.path,join(f.folder,'new.mgbak'),key),{code:'backup_original_hash_unavailable'});
 assert.throws(()=>verifyBackup(f.archive,key),{code:'backup_original_hash_unavailable'});
 assert.throws(()=>restoreBackup(f.archive,f.target,key),{code:'backup_original_hash_unavailable'});
 assert.equal(existsSync(f.target),false);
 assert.equal(f.db.prepare('PRAGMA table_info(import_jobs)').all().some(column=>column.name==='content_sha256'),false);
});

test('a legacy bank-file import with missing original bytes cannot be declared verified',t=>{
 const f=fixture(t);recordImport(f.db,{source:'bank_file',name:'legacy.csv'});legacyArchive(f);
 assert.throws(()=>verifyBackup(f.archive,key),{code:'backup_original_missing'});
 assert.throws(()=>restoreBackup(f.archive,f.target,key),{code:'backup_original_missing'});
 assert.equal(existsSync(f.target),false);
});

test('valid originals, ordinary non-file jobs and financial allocations survive isolated recovery exactly',t=>{
 const f=fixture(t),document=original(f,'document'),bank=original(f,'bank file');
 recordImport(f.db,{source:'gmail',name:'synthetic mailbox',found:1,imported:1});
 recordImport(f.db,{source:'enablebanking',found:0});
 f.db.prepare("INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES('invoice','customer','SYNTHETIC-01','Synthetic customer',62500)").run();
 f.db.prepare("INSERT INTO bank_transactions(id,fingerprint,account,booked_at,amount_cents,source) VALUES('payment','synthetic-payment','synthetic-account','2026-10-30',62500,'manual')").run();
 f.db.prepare("INSERT INTO allocations(id,invoice_id,transaction_id,amount_cents) VALUES('allocation','invoice','payment',62500)").run();
 f.db.prepare('UPDATE documents SET invoice_id=? WHERE id=?').run('invoice',document.id);
 const created=createBackup(f.path,f.archive,key);assert.equal(created.verified,true);assert.equal(verifyBackup(f.archive,key).verified,true);
 const archive=readFileSync(f.archive);assert.equal(restoreBackup(f.archive,f.target,key).restored,true);
 const restored=new DatabaseSync(f.target,{readOnly:true});
 try{
  for(const source of [document,bank])assert.deepEqual(Buffer.from(restored.prepare(`SELECT content FROM ${source.table} WHERE id=?`).get(source.id).content),source.bytes);
  assert.deepEqual({...restored.prepare('SELECT * FROM allocations').get()},{...f.db.prepare('SELECT * FROM allocations').get()});
  assert.equal(restored.prepare('SELECT SUM(amount_cents) amount FROM allocations').get().amount,62500);
  assert.equal(restored.prepare('SELECT COUNT(*) count FROM import_jobs').get().count,3);
 }finally{restored.close();}
 const target=readFileSync(f.target);
 assert.throws(()=>restoreBackup(f.archive,f.target,key));assert.deepEqual(readFileSync(f.target),target);
 assert.throws(()=>restoreBackup(f.archive,join(f.folder,'wrong-key.sqlite'),'b'.repeat(64)));
 assert.equal(existsSync(join(f.folder,'wrong-key.sqlite')),false);assert.deepEqual(readFileSync(f.archive),archive);
});

test('creating a backup rejects a bank API original changed after its retained hash was recorded',t=>{
 const f=fixture(t),row=apiOriginal(f);
 f.db.prepare('UPDATE bank_transactions SET raw_bank_data=? WHERE id=?').run(row.raw_bank_data.replace('Synthetic API payer','Different synthetic payer'),row.id);
 const before=f.db.prepare('SELECT * FROM bank_transactions WHERE id=?').get(row.id);
 assert.throws(()=>createBackup(f.path,f.archive,key),{code:'backup_original_hash_mismatch'});
 assert.equal(existsSync(f.archive),false);
 assert.deepEqual(f.db.prepare('SELECT * FROM bank_transactions WHERE id=?').get(row.id),before);
});

test('verification and restoration reject a damaged API original inside an authenticated legacy archive',t=>{
 const f=fixture(t),row=apiOriginal(f);
 f.db.prepare('UPDATE bank_transactions SET raw_bank_data=? WHERE id=?').run(row.raw_bank_data.replace('625.00','700.00'),row.id);
 const archive=legacyArchive(f),before=f.db.prepare('SELECT * FROM bank_transactions WHERE id=?').get(row.id);
 assert.throws(()=>verifyBackup(f.archive,key),{code:'backup_original_hash_mismatch'});
 assert.throws(()=>restoreBackup(f.archive,f.target,key),{code:'backup_original_hash_mismatch'});
 assert.equal(existsSync(f.target),false);
 const existing=Buffer.from('Existing synthetic recovery target');writeFileSync(f.target,existing);
 assert.throws(()=>restoreBackup(f.archive,f.target,key),{code:'backup_original_hash_mismatch'});
 assert.deepEqual(readFileSync(f.target),existing);assert.deepEqual(readFileSync(f.archive),archive);
 assert.deepEqual(f.db.prepare('SELECT * FROM bank_transactions WHERE id=?').get(row.id),before);
});

function assertApiOriginalRejected(f,code){
 const before=f.db.prepare('SELECT * FROM bank_transactions').all(),archive=legacyArchive(f),newArchive=join(f.folder,'new.mgbak');
 assert.throws(()=>createBackup(f.path,newArchive,key),{code});assert.equal(existsSync(newArchive),false);
 assert.throws(()=>verifyBackup(f.archive,key),{code});
 assert.throws(()=>restoreBackup(f.archive,f.target,key),{code});assert.equal(existsSync(f.target),false);
 const existing=Buffer.from('Existing synthetic recovery target');writeFileSync(f.target,existing);
 assert.throws(()=>restoreBackup(f.archive,f.target,key),{code});assert.deepEqual(readFileSync(f.target),existing);
 assert.deepEqual(f.db.prepare('SELECT * FROM bank_transactions').all(),before);assert.deepEqual(readFileSync(f.archive),archive);
}

for(const value of ['', 'not-a-sha256'])test('retained API original with '+(value?'malformed':'missing')+' hash fails closed without manufacturing a new hash',t=>{
 const f=fixture(t),row=apiOriginal(f);
 f.db.prepare('UPDATE bank_transactions SET raw_bank_data_sha256=? WHERE id=?').run(value,row.id);
 assertApiOriginalRejected(f,'backup_original_hash_unavailable');
});

test('retained API original without its legacy hash column fails closed without migrating the snapshot',t=>{
 const f=fixture(t);apiOriginal(f);f.db.exec('ALTER TABLE bank_transactions DROP COLUMN raw_bank_data_sha256');
 assertApiOriginalRejected(f,'backup_original_hash_unavailable');
 assert.equal(f.db.prepare('PRAGMA table_info(bank_transactions)').all().some(column=>column.name==='raw_bank_data_sha256'),false);
});

for(const value of ['{}',''])test('a lost API original represented by '+JSON.stringify(value)+' cannot evade its retained hash',t=>{
 const f=fixture(t),row=apiOriginal(f);
 f.db.prepare('UPDATE bank_transactions SET raw_bank_data=? WHERE id=?').run(value,row.id);
 assertApiOriginalRejected(f,'backup_original_missing');
});

test('a lost API original column cannot evade its retained hash',t=>{
 const f=fixture(t);apiOriginal(f);f.db.exec('ALTER TABLE bank_transactions DROP COLUMN raw_bank_data');
 assertApiOriginalRejected(f,'backup_original_missing');
 assert.equal(f.db.prepare('PRAGMA table_info(bank_transactions)').all().some(column=>column.name==='raw_bank_data'),false);
});

test('an API transaction with no retained original or hash cannot be called a verified backup',t=>{
 const f=fixture(t),row=apiOriginal(f);
 f.db.prepare("UPDATE bank_transactions SET raw_bank_data='{}',raw_bank_data_sha256='' WHERE id=?").run(row.id);
 assertApiOriginalRejected(f,'backup_original_missing');
});

test('a retained API original attached to a file transaction is still checked against its hash',t=>{
 const f=fixture(t),row=apiOriginal(f);
 f.db.prepare('UPDATE bank_transactions SET source=?,raw_bank_data=? WHERE id=?').run('file:synthetic.csv',row.raw_bank_data.replace('Synthetic API payer','Different synthetic payer'),row.id);
 assertApiOriginalRejected(f,'backup_original_hash_mismatch');
});

test('a valid retained API original and its allocation restore exactly without changing source evidence',t=>{
 const f=fixture(t),row=apiOriginal(f);
 f.db.prepare("INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES('api-invoice','customer','SYNTHETIC-01','Synthetic API payer',62500)").run();
 f.db.prepare("INSERT INTO allocations(id,invoice_id,transaction_id,amount_cents) VALUES('api-allocation','api-invoice',?,62500)").run(row.id);
 assert.equal(createBackup(f.path,f.archive,key).verified,true);assert.equal(verifyBackup(f.archive,key).verified,true);
 assert.equal(restoreBackup(f.archive,f.target,key).restored,true);
 const restored=new DatabaseSync(f.target,{readOnly:true});
 try{
  assert.deepEqual(restored.prepare('SELECT * FROM bank_transactions WHERE id=?').get(row.id),row);
  assert.deepEqual(restored.prepare('SELECT * FROM allocations').all(),f.db.prepare('SELECT * FROM allocations').all());
  assert.equal(restored.prepare('SELECT SUM(amount_cents) amount FROM allocations').get().amount,62500);
 }finally{restored.close();}
 assert.deepEqual(f.db.prepare('SELECT * FROM bank_transactions WHERE id=?').get(row.id),row);
});
