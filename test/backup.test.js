import test from 'node:test';import assert from 'node:assert/strict';
import fs,{mkdtempSync,mkdirSync,rmSync,readFileSync,writeFileSync,copyFileSync,lstatSync,symlinkSync,readlinkSync,unlinkSync} from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import {join} from 'node:path';import {tmpdir} from 'node:os';import {DatabaseSync} from 'node:sqlite';
import {openDatabase,saveSettings,getSettings,listInvoices,storeDocument} from '../src/db.js';import {createBackup,verifyBackup,restoreBackup,dailyBackup} from '../src/backup.js';
import {MGEORGE_INVOICE_REFERENCE_POLICY} from '../src/invoice-reference-policy.js';
import {createDecipheriv} from 'node:crypto';
function fixture(t){const folder=mkdtempSync(join(tmpdir(),'mg-backup-test-'));const f={db:join(folder,'db.sqlite'),archive:join(folder,'backup.mgbak'),target:join(folder,'restored.sqlite'),key:'a'.repeat(64),close:()=>{}};t.after(()=>{f.close();rmSync(folder,{recursive:true,force:true});});return f;}
test('encrypted restore retains configured invoice policy and original reference conflicts without rewriting money',t=>{
 const f=fixture(t),db=openDatabase(f.db);f.close=()=>db.close();
 saveSettings(db,{...getSettings(db),invoice_reference_policies:[MGEORGE_INVOICE_REFERENCE_POLICY]});
 db.prepare("INSERT INTO invoices(id,direction,invoice_number,reference,party,total_cents) VALUES('policy','customer','0001','','Synthetic policy customer AB',62500)").run();
 const doc=storeDocument(db,{name:'synthetic-reference.txt',mime_type:'text/plain',bytes:Buffer.from('Synthetic original: invoice 0001, declared reference 0599'),invoice_id:'policy'});
 const extraction=JSON.stringify({fields:{invoice_number:{value:'0001'},reference:{value:'0599'}}});
 db.prepare('UPDATE documents SET extraction=? WHERE id=?').run(extraction,doc.id);
 const before=JSON.stringify(db.prepare('SELECT * FROM invoices').all());
 assert.equal(createBackup(f.db,f.archive,f.key).verified,true);
 assert.equal(restoreBackup(f.archive,f.target,f.key).restored,true);
 const restored=openDatabase(f.target);
 try{
  assert.deepEqual(getSettings(restored).invoice_reference_policies,[MGEORGE_INVOICE_REFERENCE_POLICY]);
  const invoice=listInvoices(restored)[0];assert.equal(invoice.invoice_number,'0001');assert.equal(invoice.reference,'');assert.equal(invoice.intendedPaymentReference,'0001');assert.equal(invoice.referencePolicy.status,'BLOCKED');assert.equal(invoice.remaining_cents,62500);
  assert.equal(restored.prepare('SELECT extraction FROM documents WHERE id=?').get(doc.id).extraction,extraction);
  assert.equal(restored.prepare('SELECT COUNT(*) n FROM allocations').get().n,0);
  assert.equal(JSON.stringify(restored.prepare('SELECT * FROM invoices').all()),before);
 }finally{restored.close();}
 assert.equal(JSON.stringify(db.prepare('SELECT * FROM invoices').all()),before);
});
test('encrypted snapshot restores committed WAL data and passes integrity without modifying source',t=>{const f=fixture(t),db=openDatabase(f.db);f.close=()=>db.close();db.prepare("INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES('i','customer','0599','Privat testkund',62500)").run();assert.equal(createBackup(f.db,f.archive,f.key).verified,true);assert.equal(readFileSync(f.archive).includes(Buffer.from('Privat testkund')),false);assert.equal(restoreBackup(f.archive,f.target,f.key).restored,true);const restored=new DatabaseSync(f.target,{readOnly:true});try{assert.equal(restored.prepare('SELECT invoice_number FROM invoices').get().invoice_number,'0599');}finally{restored.close();}assert.throws(()=>restoreBackup(f.archive,f.db,f.key));assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,1);});
test('wrong keys and altered ciphertext fail authentication and cannot produce a restored database',t=>{const f=fixture(t),db=openDatabase(f.db);db.close();createBackup(f.db,f.archive,f.key);assert.throws(()=>verifyBackup(f.archive,'b'.repeat(64)));const content=readFileSync(f.archive);content[40]^=1;writeFileSync(f.archive,content);assert.throws(()=>restoreBackup(f.archive,f.target,f.key));assert.throws(()=>readFileSync(f.target));});
test('backup requires a dedicated valid key and refuses to overwrite an existing backup',t=>{const f=fixture(t),db=openDatabase(f.db);db.close();assert.throws(()=>createBackup(f.db,f.archive,''));createBackup(f.db,f.archive,f.key);assert.throws(()=>createBackup(f.db,f.archive,f.key));assert.equal(verifyBackup(f.archive,f.key).verified,true);});
test('daily backups are idempotent and follow Stockholm midnight rather than UTC',t=>{const f=fixture(t),db=openDatabase(f.db);db.close();const dir=join(f.db,'..','daily');assert.equal(dailyBackup(f.db,dir,f.key,new Date('2026-10-28T22:59:00Z')).created,true);const again=dailyBackup(f.db,dir,f.key,new Date('2026-10-28T22:59:59Z'));assert.equal(again.day,'2026-10-28');assert.equal(again.created,false);const next=dailyBackup(f.db,dir,f.key,new Date('2026-10-28T23:00:00Z'));assert.equal(next.day,'2026-10-29');assert.equal(next.created,true);});

function archivedFixture(t){
 const f=fixture(t),db=openDatabase(f.db);f.close=()=>db.close();
 db.prepare("INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES('i','customer','BACKUP-GOOD','Synthetic archive invoice',62500)").run();
 createBackup(f.db,f.archive,f.key);return f;
}
// Only fault injection at the filesystem boundary is mocked. Archive validation,
// actual file writes and the restore implementation still run normally.
function withFilesystemFault(name,replacement,run){
 const original=fs[name];fs[name]=(...args)=>replacement(original,...args);syncBuiltinESMExports();
 try{return run();}finally{fs[name]=original;syncBuiltinESMExports();}
}
function fileSymlink(t,destination,link){
 try{symlinkSync(destination,link,'file');return true;}
 catch(error){
  if(process.platform!=='win32'||error.code!=='EPERM')throw error;
  t.skip('Windows denied file-symlink creation (EPERM); requires Developer Mode or SeCreateSymbolicLinkPrivilege.');return false;
 }
}

test('restore publishes the authenticated SQLite bytes with native file identities',t=>{
 const f=archivedFixture(t),archive=readFileSync(f.archive),decipher=createDecipheriv('aes-256-gcm',Buffer.from(f.key,'hex'),archive.subarray(8,20));
 decipher.setAAD(Buffer.from('MGBAK001'));decipher.setAuthTag(archive.subarray(20,36));
 const authenticated=Buffer.concat([decipher.update(archive.subarray(36)),decipher.final()]);
 assert.equal(restoreBackup(f.archive,f.target,f.key).restored,true);
 assert.deepEqual(readFileSync(f.target),authenticated);
 assert.deepEqual(readFileSync(f.archive),archive);
});

test('restore removes its fully written target when flushing the file fails',t=>{
 const f=archivedFixture(t),failure=Object.assign(Error('Synthetic flush failure'),{code:'EIO'});
 withFilesystemFault('fsyncSync',()=>{throw failure;},()=>assert.throws(()=>restoreBackup(f.archive,f.target,f.key),error=>error===failure));
 assert.throws(()=>lstatSync(f.target),{code:'ENOENT'});
 assert.equal(verifyBackup(f.archive,f.key).verified,true);
});

test('restore rejects an unrelated committed WAL without importing its financial state or changing it',t=>{
 const f=archivedFixture(t),foreignPath=join(f.db,'..','foreign.sqlite'),foreign=openDatabase(foreignPath);
 try{
  foreign.exec('PRAGMA wal_autocheckpoint=0');
  foreign.prepare("INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES('i','customer','UNRELATED-WAL','Synthetic unrelated invoice',99999)").run();
  copyFileSync(`${foreignPath}-wal`,`${f.target}-wal`);const before=readFileSync(`${f.target}-wal`);
  assert.throws(()=>restoreBackup(f.archive,f.target,f.key),{code:'EEXIST'});
  assert.throws(()=>lstatSync(f.target),{code:'ENOENT'});
  assert.deepEqual(readFileSync(`${f.target}-wal`),before);
 }finally{foreign.close();}
});

for(const suffix of ['', '-wal', '-shm', '-journal']){
 test(`restore preserves and refuses an existing ${suffix||'main file'}`,t=>{
  const f=archivedFixture(t),occupied=`${f.target}${suffix}`,before=Buffer.from('Synthetic caller-owned recovery artifact');
  writeFileSync(occupied,before);assert.throws(()=>restoreBackup(f.archive,f.target,f.key),{code:'EEXIST'});
  assert.deepEqual(readFileSync(occupied),before);
  if(suffix)assert.throws(()=>lstatSync(f.target),{code:'ENOENT'});
 });
 for(const dangling of [false,true])test(`restore refuses a ${dangling?'dangling':'live'} symlink at ${suffix||'the main file'} without touching its destination`,t=>{
  const f=archivedFixture(t),occupied=`${f.target}${suffix}`,destination=join(f.db,'..','caller-owned'),before=Buffer.from('Synthetic untouched symlink destination');
  if(!dangling)writeFileSync(destination,before);if(!fileSymlink(t,destination,occupied))return;
  assert.throws(()=>restoreBackup(f.archive,f.target,f.key),{code:'EEXIST'});
  assert.equal(lstatSync(occupied).isSymbolicLink(),true);assert.equal(readlinkSync(occupied),destination);
  if(dangling)assert.throws(()=>lstatSync(destination),{code:'ENOENT'});else assert.deepEqual(readFileSync(destination),before);
  if(suffix)assert.throws(()=>lstatSync(f.target),{code:'ENOENT'});
 });
 test(`restore refuses a directory link at ${suffix||'the main file'} without changing its contents`,t=>{
  const f=archivedFixture(t),occupied=`${f.target}${suffix}`,destination=join(f.db,'..','caller-directory'),before=Buffer.from('Synthetic directory-link canary');
  mkdirSync(destination);writeFileSync(join(destination,'canary'),before);symlinkSync(destination,occupied,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>restoreBackup(f.archive,f.target,f.key),{code:'EEXIST'});
  assert.equal(lstatSync(occupied).isSymbolicLink(),true);assert.deepEqual(readFileSync(join(destination,'canary')),before);
  if(suffix)assert.throws(()=>lstatSync(f.target),{code:'ENOENT'});
 });
}

test('restore detects a sidecar created after destination preflight and leaves it untouched',t=>{
 const f=archivedFixture(t),foreign=Buffer.from('Synthetic concurrent sidecar');
 withFilesystemFault('openSync',(open,path,...args)=>{
  if(path===f.target)writeFileSync(`${f.target}-wal`,foreign);
  return open(path,...args);
 },()=>assert.throws(()=>restoreBackup(f.archive,f.target,f.key),{code:'EEXIST'}));
 assert.throws(()=>lstatSync(f.target),{code:'ENOENT'});assert.deepEqual(readFileSync(`${f.target}-wal`),foreign);
});

test('restore removes only its incomplete newly created file after a write failure',t=>{
 const f=archivedFixture(t),failure=Object.assign(Error('Synthetic disk write failure'),{code:'EIO'});
 withFilesystemFault('writeFileSync',(write,path,content,...args)=>{
  if(typeof path!=='number')return write(path,content,...args);
  write(path,content.subarray(0,512),...args);throw failure;
 },()=>assert.throws(()=>restoreBackup(f.archive,f.target,f.key),error=>error===failure));
 assert.throws(()=>lstatSync(f.target),{code:'ENOENT'});assert.equal(verifyBackup(f.archive,f.key).verified,true);
});

for(const replaced of [false,true])test(`initial restore metadata failure closes its file and ${replaced?'preserves a foreign pathname':'removes its identified empty target'}`,t=>{
 const f=archivedFixture(t),failure=Object.assign(Error('Synthetic initial metadata failure'),{code:'EIO'}),foreign=Buffer.from('Synthetic replacement during metadata read');let opened;
 t.after(()=>{if(opened!==undefined)try{fs.closeSync(opened);}catch{}});
 withFilesystemFault('fstatSync',(stat,fd,...args)=>{
  if(opened!==undefined)return stat(fd,...args);
  opened=fd;if(replaced){unlinkSync(f.target);writeFileSync(f.target,foreign);}throw failure;
 },()=>assert.throws(()=>restoreBackup(f.archive,f.target,f.key),error=>error===failure));
 assert.throws(()=>fs.fstatSync(opened),{code:'EBADF'});
 if(replaced)assert.deepEqual(readFileSync(f.target),foreign);else assert.throws(()=>lstatSync(f.target),{code:'ENOENT'});
});

test('persistent restore metadata failure closes its file without deleting an unidentified pathname',t=>{
 const f=archivedFixture(t),failure=Object.assign(Error('Synthetic persistent metadata failure'),{code:'EIO'});let opened;
 t.after(()=>{if(opened!==undefined)try{fs.closeSync(opened);}catch{}});
 withFilesystemFault('fstatSync',(_stat,fd)=>{opened=fd;throw failure;},()=>assert.throws(()=>restoreBackup(f.archive,f.target,f.key),error=>error===failure));
 assert.throws(()=>fs.fstatSync(opened),{code:'EBADF'});assert.equal(lstatSync(f.target).size,0);
});

test('restore verifies the actual written bytes rather than accepting a different valid SQLite database',t=>{
 const f=archivedFixture(t);
 withFilesystemFault('writeFileSync',(write,path,content,...args)=>{
  if(typeof path!=='number')return write(path,content,...args);
  const altered=Buffer.from(content),position=altered.indexOf('Synthetic archive invoice');assert.notEqual(position,-1);
  altered[position]='X'.charCodeAt(0);return write(path,altered,...args);
 },()=>assert.throws(()=>restoreBackup(f.archive,f.target,f.key),{code:'backup_restore_mismatch'}));
 assert.throws(()=>lstatSync(f.target),{code:'ENOENT'});
});

for(const failedWrite of [false,true])test(`restore ${failedWrite?'failure cleanup preserves':'refuses success for'} a pathname replaced during writing`,t=>{
 const f=archivedFixture(t),foreign=Buffer.from('Synthetic replacement owned by another caller'),failure=Error('Synthetic write failure');
 withFilesystemFault('writeFileSync',(write,path,content,...args)=>{
  const result=write(path,content,...args);if(typeof path!=='number')return result;
  unlinkSync(f.target);write(f.target,foreign);
  if(failedWrite)throw failure;return result;
 },()=>assert.throws(()=>restoreBackup(f.archive,f.target,f.key),failedWrite?error=>error===failure:{code:'backup_restore_mismatch'}));
 assert.deepEqual(readFileSync(f.target),foreign);
});

test('restore refuses and preserves a directory link replacing its pathname during writing',t=>{
 const f=archivedFixture(t),destination=join(f.db,'..','foreign-directory'),before=Buffer.from('Synthetic replacement-link canary');
 mkdirSync(destination);writeFileSync(join(destination,'canary'),before);
 withFilesystemFault('writeFileSync',(write,path,content,...args)=>{
  const result=write(path,content,...args);if(typeof path!=='number')return result;
  unlinkSync(f.target);symlinkSync(destination,f.target,process.platform==='win32'?'junction':'dir');return result;
 },()=>assert.throws(()=>restoreBackup(f.archive,f.target,f.key),{code:'backup_restore_mismatch'}));
 assert.equal(lstatSync(f.target).isSymbolicLink(),true);assert.deepEqual(readFileSync(join(destination,'canary')),before);
});

if(process.platform==='win32')test('restore refuses success when the pathname changes while its Windows identity handle is opened',t=>{
 const f=archivedFixture(t),foreign=Buffer.from('Synthetic replacement during identity open');let replaced=false;
 withFilesystemFault('openSync',(open,path,flags,...args)=>{
  const fd=open(path,flags,...args);
  if(path===f.target&&flags==='r'&&!replaced){replaced=true;unlinkSync(f.target);writeFileSync(f.target,foreign);}
  return fd;
 },()=>assert.throws(()=>restoreBackup(f.archive,f.target,f.key),{code:'backup_restore_mismatch'}));
 assert.deepEqual(readFileSync(f.target),foreign);
});

test('restore preserves an unidentified pathname when its same-inode device evidence disagrees',t=>{
 const f=archivedFixture(t);let restoreFd;
 withFilesystemFault('openSync',(open,path,flags,...args)=>{
  const fd=open(path,flags,...args);if(path===f.target&&flags==='wx+')restoreFd=fd;return fd;
 },()=>withFilesystemFault(process.platform==='win32'?'fstatSync':'lstatSync',(stat,reference,...args)=>{
  const current=stat(reference,...args);
  if(process.platform==='win32'?reference!==restoreFd&&args[0]?.bigint:reference===f.target)current.dev+=1n;
  return current;
 },()=>assert.throws(()=>restoreBackup(f.archive,f.target,f.key),{code:'backup_restore_mismatch'})));
 const preserved=new DatabaseSync(f.target,{readOnly:true});
 try{assert.equal(preserved.prepare('SELECT invoice_number FROM invoices').get().invoice_number,'BACKUP-GOOD');}finally{preserved.close();}
});
