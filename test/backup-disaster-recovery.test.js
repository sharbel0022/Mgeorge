import test from 'node:test';
import assert from 'node:assert/strict';
import fs,{existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createBackup,dailyBackup,restoreBackup,verifyBackup} from '../src/backup.js';

const key='1'.repeat(64),at=new Date('2026-11-02T12:00:00Z');
const isArchive=content=>content instanceof Uint8Array&&Buffer.from(content.subarray(0,8)).equals(Buffer.from('MGBAK001'));
function fixture(t){
 const folder=mkdtempSync(join(tmpdir(),'mg-disaster-recovery-')),source=join(folder,'source.sqlite'),db=new DatabaseSync(source),directory=join(folder,'backups');
 db.exec("CREATE TABLE invoices(id TEXT PRIMARY KEY,invoice_number TEXT,total_cents INTEGER); CREATE TABLE bank_transactions(id TEXT PRIMARY KEY); INSERT INTO invoices VALUES('invoice','SYNTHETIC-DR-01',62500)");
 db.close();mkdirSync(directory);
 t.after(()=>rmSync(folder,{recursive:true,force:true}));
 return{folder,source,directory,archive:join(directory,'mgeorge-2026-11-02.mgbak')};
}
// Faults affect real filesystem writes only. Encryption, SQLite, authentication,
// retry and publication still execute through the production backup functions.
function withFilesystemFault(name,replacement,run){
 const original=fs[name];fs[name]=(...args)=>replacement(original,...args);syncBuiltinESMExports();
 try{return run();}finally{fs[name]=original;syncBuiltinESMExports();}
}

test('a partial archive write leaves the daily name available for a verified retry',t=>{
 const f=fixture(t),source=readFileSync(f.source),failure=Object.assign(Error('Synthetic full disk'),{code:'ENOSPC'});
 withFilesystemFault('writeFileSync',(write,path,content,...args)=>{
  if(!isArchive(content))return write(path,content,...args);
  write(path,content.subarray(0,64),...args);throw failure;
 },()=>assert.throws(()=>dailyBackup(f.source,f.directory,key,at),error=>error===failure));
 assert.equal(existsSync(f.archive),false,'a partial encrypted write must never publish the final daily archive');
 assert.deepEqual(readdirSync(f.directory),[],'a handled failure should clean its private staging files');
 assert.equal(dailyBackup(f.source,f.directory,key,at).created,true);
 assert.equal(verifyBackup(f.archive,key).verified,true);
 assert.deepEqual(readFileSync(f.source),source);
});

test('a failed durability flush cannot publish or report a verified daily backup',t=>{
 const f=fixture(t),failure=Object.assign(Error('Synthetic flush failure'),{code:'EIO'});
 withFilesystemFault('fsyncSync',()=>{throw failure;},()=>assert.throws(()=>dailyBackup(f.source,f.directory,key,at),error=>error===failure));
 assert.equal(existsSync(f.archive),false);
 assert.deepEqual(readdirSync(f.directory),[]);
 assert.equal(dailyBackup(f.source,f.directory,key,at).created,true);
});

test('failed encrypted readback is rejected before publishing the daily archive',t=>{
 const f=fixture(t);
 withFilesystemFault('writeFileSync',(write,path,content,...args)=>{
  if(!isArchive(content))return write(path,content,...args);
  const damaged=Buffer.from(content);damaged[damaged.length-1]^=1;
  return write(path,damaged,...args);
 },()=>assert.throws(()=>createBackup(f.source,f.archive,key)));
 assert.equal(existsSync(f.archive),false,'failed authentication must not leave a final archive blocking retry');
 assert.deepEqual(readdirSync(f.directory),[]);
 assert.equal(dailyBackup(f.source,f.directory,key,at).created,true);
});

test('process termination during an encrypted write permits a fresh same-day retry',t=>{
 const f=fixture(t),source=readFileSync(f.source),temporary=join(f.folder,'private-temp'),witness=join(f.folder,'interrupted');mkdirSync(temporary);
 const script=`
  import fs from 'node:fs';
  import {syncBuiltinESMExports} from 'node:module';
  import {dailyBackup} from ${JSON.stringify(new URL('../src/backup.js',import.meta.url).href)};
  const [source,directory,witness]=process.argv.slice(1),write=fs.writeFileSync;
  fs.writeFileSync=(path,content,...args)=>{
   if(!(content instanceof Uint8Array)||!Buffer.from(content.subarray(0,8)).equals(Buffer.from('MGBAK001')))return write(path,content,...args);
   write(path,content.subarray(0,64),...args);write(witness,'synthetic partial write reached');
   process.kill(process.pid,'SIGKILL');
  };
  syncBuiltinESMExports();dailyBackup(source,directory,'1'.repeat(64),new Date('2026-11-02T12:00:00Z'));
 `;
 const interrupted=spawnSync(process.execPath,['--input-type=module','-e',script,f.source,f.directory,witness],{
  encoding:'utf8',timeout:20000,env:{...process.env,TMPDIR:temporary,TEMP:temporary,TMP:temporary},
 });
 assert.equal(interrupted.error,undefined);assert.notEqual(interrupted.status,0);
 assert.equal(readFileSync(witness,'utf8'),'synthetic partial write reached');
 assert.equal(existsSync(f.archive),false,'process termination must not strand a partial final archive');
 assert.equal(dailyBackup(f.source,f.directory,key,at).created,true);
 const archive=readFileSync(f.archive);assert.equal(dailyBackup(f.source,f.directory,key,at).created,false);
 assert.deepEqual(readFileSync(f.archive),archive);assert.deepEqual(readFileSync(f.source),source);
});

test('concurrent daily publication authenticates and preserves the winner instead of failing or replacing it',t=>{
 const f=fixture(t),winner=fixture(t);let published,publishing=false;
 const db=new DatabaseSync(winner.source);db.prepare('UPDATE invoices SET invoice_number=?').run('SYNTHETIC-WINNER');db.close();
 const result=withFilesystemFault('linkSync',(link,staged,target,...args)=>{
  if(target===f.archive&&!publishing){
   publishing=true;
   createBackup(winner.source,f.archive,key);published=readFileSync(f.archive);
  }
  return link(staged,target,...args);
 },()=>dailyBackup(f.source,f.directory,key,at));
 assert.equal(result.verified,true);assert.equal(result.created,false);
 assert.deepEqual(readFileSync(f.archive),published);assert.deepEqual(readdirSync(f.directory),['mgeorge-2026-11-02.mgbak']);
 const target=join(f.folder,'restored.sqlite');restoreBackup(f.archive,target,key);
 const restored=new DatabaseSync(target,{readOnly:true});
 try{assert.equal(restored.prepare('SELECT invoice_number FROM invoices').get().invoice_number,'SYNTHETIC-WINNER');}finally{restored.close();}
});

test('a concurrent invalid archive is preserved and rejected without becoming a successful daily backup',t=>{
 const f=fixture(t),foreign=Buffer.from('Synthetic incomplete foreign archive');
 withFilesystemFault('linkSync',(link,staged,target,...args)=>{
  writeFileSync(target,foreign,{flag:'wx'});return link(staged,target,...args);
 },()=>assert.throws(()=>dailyBackup(f.source,f.directory,key,at)));
 assert.deepEqual(readFileSync(f.archive),foreign);
 assert.deepEqual(readdirSync(f.directory),['mgeorge-2026-11-02.mgbak']);
});

function databaseContents(db){
 const schema=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
 const tables=schema.filter(row=>row.type==='table').map(row=>row.name);
 return{schema,tables:Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT * FROM "${table.replaceAll('"','""')}"`).all().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]))};
}

test('isolated full recovery preserves committed WAL originals, revoked links and financial history while excluding uncommitted work',async t=>{
 const [{openDatabase,storeDocument,recordImport,storeTransactions,allocate,deleteAllocation,audit},{withSyntheticBankOriginal},{makeBankgiroXLSX},{encryptObject},{bankSpecificationCandidates,confirmBankSpecificationLink,revokeBankSpecificationLink}]=await Promise.all([
  import('../src/db.js'),import('./bank-fixtures.js'),import('../sites/tests/helpers/bankgiro-xlsx-fixture.mjs'),import('../src/security.js'),import('../src/bankgiro-links.js'),
 ]);
 const folder=mkdtempSync(join(tmpdir(),'mg-full-recovery-')),source=join(folder,'source.sqlite'),archive=join(folder,'complete.mgbak'),target=join(folder,'isolated.sqlite'),db=openDatabase(source);
 const previousKey=process.env.BANK_DATA_KEY;process.env.BANK_DATA_KEY='3'.repeat(64);
 let writer;
 t.after(()=>{writer?.close();db.close();if(previousKey===undefined)delete process.env.BANK_DATA_KEY;else process.env.BANK_DATA_KEY=previousKey;rmSync(folder,{recursive:true,force:true});});
 db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA wal_autocheckpoint=0');
 db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES(?,?,?,?,?)').run('invoice-paid','customer','SYNTHETIC-PAID','Synthetic customer',62500);
 db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES(?,?,?,?,?)').run('invoice-unpaid','supplier','SYNTHETIC-UNPAID','Synthetic supplier',12500);
 const documentBytes=[Buffer.from('%PDF-Synthetic historical invoice original'),Buffer.from('%PDF-Synthetic current invoice original')];
 const historical=storeDocument(db,{name:'history.pdf',mime_type:'application/pdf',bytes:documentBytes[0],source_id:'synthetic-old-source'});
 const current=storeDocument(db,{name:'current.pdf',mime_type:'application/pdf',bytes:documentBytes[1],invoice_id:'invoice-paid',source_id:'synthetic-current-source'});
 db.prepare("UPDATE documents SET status='dismissed' WHERE id=?").run(historical.id);audit(db,'document_dismissed',{id:historical.id});
 const extraction={processing:{sha256:createHash('sha256').update(documentBytes[1]).digest('hex')}};
 db.prepare('UPDATE documents SET extraction=? WHERE id=?').run(JSON.stringify(extraction),current.id);audit(db,'document_extracted',{id:current.id,extraction});
 const payment={account:'synthetic-file-account',booked_at:'2026-11-01',amount_cents:62500,currency:'SEK',payer:'Synthetic customer',reference:'SYNTHETIC-PAID',bank_reference:'SYNTHETIC-FILE-PAYMENT',description:'Synthetic retained payment'};
 const bankFile=Buffer.from('date;amount;reference\n2026-11-01;625.00;SYNTHETIC-PAID');
 storeTransactions(db,[payment],'file:synthetic.csv',{content:bankFile,mime_type:'text/csv'});
 const paymentId=db.prepare('SELECT id FROM bank_transactions WHERE bank_reference=?').get(payment.bank_reference).id;
 allocate(db,'invoice-paid',paymentId,62500);
 deleteAllocation(db,db.prepare('SELECT id FROM allocations').get().id);
 allocate(db,'invoice-paid',paymentId,62500);
 const rejectedBytes=Buffer.from('Synthetic conflicting retained file');
 assert.throws(()=>storeTransactions(db,[{...payment,amount_cents:70000}],'file:rejected.csv',{content:rejectedBytes,mime_type:'text/csv'}),{code:'conflicting_bank_record'});
 const account='SE4280000890119146168423',owner='synthetic-recovery-owner';
 storeTransactions(db,[withSyntheticBankOriginal({account,booked_at:'2026-10-30',amount_cents:62500,currency:'SEK',payer:'',reference:'',bank_reference:'SYNTHETIC-AIS-DR',description:'Synthetic unallocated deposit'})],'enablebanking');
 db.prepare('INSERT INTO bank_connections(id,provider,bank_name,encrypted_session,accounts_json,valid_until,owner,status,selected_account_uid) VALUES(?,?,?,?,?,?,?,?,?)').run('synthetic-connection','enablebanking','Synthetic bank',encryptObject({session_id:'synthetic-only'}),encryptObject([{uid:'synthetic-account',account_id:{iban:account},currency:'SEK'}]),'2099-01-01',owner,'connected','synthetic-account');
 const workbook=Buffer.from(makeBankgiroXLSX({currency:'SEK',account,date:'2026-10-30',sequence:'83',payments:[{party:'Synthetic customer',reference:'SYNTHETIC-PAID',payerBankgiro:'987-6543',amount:62500}]}));
 const importId=recordImport(db,{source:'bank_file',name:'synthetic-report.xlsx',content:workbook,mime_type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
 const depositId=db.prepare('SELECT id FROM bank_transactions WHERE bank_reference=?').get('SYNTHETIC-AIS-DR').id;
 const report=bankSpecificationCandidates(db,depositId,owner).items.find(item=>item.import_id===importId);assert.equal(report.can_link,true);
 const review={transaction_id:depositId,import_id:importId,report_key:report.report_key,confirm:true,originals_checked:true,account_checked:true,evidence:'Synthetic reviewed source relation.'};
 const revoked=confirmBankSpecificationLink(db,review,owner);revokeBankSpecificationLink(db,revoked.id,{evidence:'Synthetic correction retained as history.'},owner);
 confirmBankSpecificationLink(db,review,owner);
 db.prepare('INSERT INTO sessions(id_hash,expires_at,principal) VALUES(?,?,?)').run('synthetic-session-hash',4102444800000,'synthetic-admin');
 const before=databaseContents(db),main=readFileSync(source),wal=readFileSync(`${source}-wal`);assert.ok(wal.length>32,'committed fixture data must still exist in the WAL');
 writer=new DatabaseSync(source);writer.exec('BEGIN IMMEDIATE');
 writer.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES(?,?,?,?,?)').run('uncommitted','customer','NEVER-RESTORE','Synthetic pending work',99999);
 assert.equal(createBackup(source,archive,key).verified,true);assert.equal(verifyBackup(archive,key).verified,true);
 const encrypted=readFileSync(archive);assert.equal(encrypted.includes(documentBytes[0]),false);assert.equal(encrypted.includes(workbook),false);
 assert.equal(restoreBackup(archive,target,key).restored,true);
 const restored=new DatabaseSync(target,{readOnly:true});
 try{
  assert.deepEqual(databaseContents(restored),before,'every table, schema definition and row must survive evidence recovery');
  assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.deepEqual(restored.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(restored.prepare('SELECT COUNT(*) count FROM invoices').get().count,2);
  assert.equal(restored.prepare('SELECT COUNT(*) count FROM bank_transactions').get().count,2);
  assert.equal(restored.prepare('SELECT SUM(amount_cents) cents FROM allocations').get().cents,62500);
  assert.equal(restored.prepare("SELECT COUNT(*) count FROM audit_events WHERE action='manual_match'").get().count,2);
  assert.equal(restored.prepare("SELECT COUNT(*) count FROM audit_events WHERE action='undo_match'").get().count,1);
  assert.equal(restored.prepare("SELECT COUNT(*) count FROM bank_specification_links WHERE revoked_at<>''").get().count,1);
  assert.equal(restored.prepare("SELECT COUNT(*) count FROM bank_specification_links WHERE revoked_at=''").get().count,1);
  for(const [id,bytes] of [[historical.id,documentBytes[0]],[current.id,documentBytes[1]]])assert.deepEqual(Buffer.from(restored.prepare('SELECT content FROM documents WHERE id=?').get(id).content),bytes);
  assert.deepEqual(Buffer.from(restored.prepare('SELECT content FROM import_jobs WHERE id=?').get(importId).content),workbook);
  assert.deepEqual(Buffer.from(restored.prepare("SELECT content FROM import_jobs WHERE name='rejected.csv'").get().content),rejectedBytes);
 }finally{restored.close();}
 assert.deepEqual(databaseContents(db),before);assert.deepEqual(readFileSync(source),main);assert.deepEqual(readFileSync(`${source}-wal`),wal);assert.deepEqual(readFileSync(archive),encrypted);
 const restoredBytes=readFileSync(target);assert.throws(()=>restoreBackup(archive,target,key),{code:'EEXIST'});assert.deepEqual(readFileSync(target),restoredBytes);
 writer.exec('ROLLBACK');writer.close();writer=null;
});
