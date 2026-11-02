import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,openSync,closeSync,unlinkSync,mkdirSync,existsSync,lstatSync,fstatSync,fsyncSync,readSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const header=Buffer.from('MGBAK001');
function key(value){if(typeof value!=='string'||! /^[a-f0-9]{64}$/i.test(value))throw Error('MG_BACKUP_KEY måste innehålla exakt 64 hextecken.');return Buffer.from(value,'hex');}
const originalFailure=code=>Object.assign(Error(code==='backup_original_missing'?'Backupen saknar ett registrerat original.':code==='backup_original_hash_unavailable'?'Ett original saknar en giltig tidigare kontrollsumma. Backupen kan inte verifieras.':'Ett original i backupen stämmer inte med sin sparade kontrollsumma.'),{code});
function bankApiOriginalIntegrity(db){
 const columns=new Set(db.prepare('PRAGMA table_info(bank_transactions)').all().map(column=>column.name));
 const retained=[];
 if(columns.has('source'))retained.push("source='enablebanking'");
 if(columns.has('raw_bank_data'))retained.push("(raw_bank_data IS NOT NULL AND raw_bank_data NOT IN ('','{}'))");
 if(columns.has('raw_bank_data_sha256'))retained.push("(raw_bank_data_sha256 IS NOT NULL AND raw_bank_data_sha256<>'')");
 if(!retained.length)return;
 // API originals may be attached to older file rows. A retained hash also
 // identifies a lost original when its body has reverted to an empty default.
 const originals=db.prepare('SELECT id FROM bank_transactions WHERE '+retained.join(' OR ')).all();
 if(!originals.length)return;
 if(!columns.has('raw_bank_data'))throw originalFailure('backup_original_missing');
 if(!columns.has('raw_bank_data_sha256'))throw originalFailure('backup_original_hash_unavailable');
 const read=db.prepare('SELECT raw_bank_data content,raw_bank_data_sha256 hash FROM bank_transactions WHERE id=?');
 for(const {id} of originals){
  const {content,hash}=read.get(id);
  if(typeof content!=='string'||!content.trim()||content.trim()==='{}')throw originalFailure('backup_original_missing');
  if(typeof hash!=='string'||!/^[a-f0-9]{64}$/i.test(hash))throw originalFailure('backup_original_hash_unavailable');
  if(createHash('sha256').update(content).digest('hex')!==hash.toLowerCase())throw originalFailure('backup_original_hash_mismatch');
 }
}
function originalIntegrity(db,tables){
 for(const [table,hashColumn] of [['documents','fingerprint'],['import_jobs','content_sha256']]){
  if(!tables.some(row=>row.name===table))continue;
  const columns=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column=>column.name));
  // Old non-file job history has no original to validate. A bank-file job does,
  // even when a legacy schema or damaged record has lost its bytes/hash.
  const where=table==='documents'?'':` WHERE source='bank_file'${columns.has('content')?' OR content IS NOT NULL':''}`;
  const originals=db.prepare(`SELECT id FROM ${table}${where}`).all();
  if(!originals.length)continue;
  if(!columns.has('content'))throw originalFailure('backup_original_missing');
  if(!columns.has(hashColumn))throw originalFailure('backup_original_hash_unavailable');
  const read=db.prepare(`SELECT content,${hashColumn} hash FROM ${table} WHERE id=?`);
  for(const {id} of originals){
   const {content,hash}=read.get(id);
   if(!(content instanceof Uint8Array))throw originalFailure('backup_original_missing');
   if(typeof hash!=='string'||!/^[a-f0-9]{64}$/i.test(hash))throw originalFailure('backup_original_hash_unavailable');
   if(createHash('sha256').update(content).digest('hex')!==hash.toLowerCase())throw originalFailure('backup_original_hash_mismatch');
  }
 }
 bankApiOriginalIntegrity(db);
}
function integrity(file){const db=new DatabaseSync(file,{readOnly:true});try{const checks=db.prepare('PRAGMA integrity_check').all();if(checks.length!==1||Object.values(checks[0])[0]!=='ok')throw Error('Databasens integritetskontroll misslyckades.');const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();if(!tables.some(t=>t.name==='invoices')||!tables.some(t=>t.name==='bank_transactions'))throw Error('Backupen saknar MG:s register.');originalIntegrity(db,tables);return{tables:tables.length};}finally{db.close();}}
function unpack(archive,encryptionKey){const bytes=readFileSync(archive);if(bytes.length<36||!bytes.subarray(0,8).equals(header))throw Error('Okänt backupformat.');const decipher=createDecipheriv('aes-256-gcm',key(encryptionKey),bytes.subarray(8,20));decipher.setAAD(header);decipher.setAuthTag(bytes.subarray(20,36));return Buffer.concat([decipher.update(bytes.subarray(36)),decipher.final()]);}
function inspect(content){const folder=mkdtempSync(join(tmpdir(),'mg-backup-check-'));try{const file=join(folder,'restored.sqlite');writeFileSync(file,content,{mode:0o600});return integrity(file);}finally{rmSync(folder,{recursive:true,force:true});}}

/** SQLite VACUUM INTO creates a consistent snapshot, including committed WAL data. */
export function createBackup(database,archive,encryptionKey){
 const encryption=key(encryptionKey),folder=mkdtempSync(join(tmpdir(),'mg-backup-'));
 try{const snapshot=join(folder,'snapshot.sqlite'),db=new DatabaseSync(resolve(database),{readOnly:true});try{db.prepare('VACUUM INTO ?').run(snapshot);}finally{db.close();}
  integrity(snapshot);const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryption,iv);cipher.setAAD(header);const encrypted=Buffer.concat([cipher.update(readFileSync(snapshot)),cipher.final()]);writeFileSync(archive,Buffer.concat([header,iv,cipher.getAuthTag(),encrypted]),{flag:'wx',mode:0o600});
  return verifyBackup(archive,encryptionKey);
 }finally{rmSync(folder,{recursive:true,force:true});}
}
/** Authenticates, decrypts and opens an isolated restored database without changing production. */
export function verifyBackup(archive,encryptionKey){return{verified:true,...inspect(unpack(archive,encryptionKey))};}
function pathStatus(file){try{return lstatSync(file,{bigint:true});}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function assertRestoreDestinationAbsent(target,suffixes=['','-wal','-shm','-journal']){
 for(const suffix of suffixes){const file=`${target}${suffix}`;if(pathStatus(file))throw Object.assign(Error('Återställningsmålet eller dess SQLite-sidfiler finns redan.'),{code:'EEXIST',path:file});}
}
function sameFile(file,owned){const current=pathStatus(file);return current?.isFile()&&current.dev===owned.dev&&current.ino===owned.ino;}
const restoreMismatch=()=>Object.assign(Error('Den återställda filen stämmer inte med den verifierade backupen.'),{code:'backup_restore_mismatch'});
function verifyRestoredBytes(fd,content){
 if(fstatSync(fd).size!==content.length)throw restoreMismatch();
 const hash=createHash('sha256'),chunk=Buffer.allocUnsafe(Math.min(content.length,65536));
 for(let position=0;position<content.length;){const read=readSync(fd,chunk,0,Math.min(chunk.length,content.length-position),position);if(!read)throw restoreMismatch();hash.update(chunk.subarray(0,read));position+=read;}
 if(fstatSync(fd).size!==content.length||hash.digest('hex')!==createHash('sha256').update(content).digest('hex'))throw restoreMismatch();
}
export function restoreBackup(archive,target,encryptionKey){
 const content=unpack(archive,encryptionKey),verified=inspect(content);
 assertRestoreDestinationAbsent(target);
 // SQLite must never open the target: a foreign WAL could replace authenticated
 // financial state. Validate privately, then verify only the bytes we publish.
 const fd=openSync(target,'wx+',0o600);let owned;
 try{
  owned=fstatSync(fd,{bigint:true});
  writeFileSync(fd,content);fsyncSync(fd);verifyRestoredBytes(fd,content);
  assertRestoreDestinationAbsent(target,['-wal','-shm','-journal']);
  if(!sameFile(target,owned))throw restoreMismatch();
 }catch(error){
  // Preserve a foreign replacement and all sidecars. Like the final checks,
  // this assumes a trusted parent directory, not a hostile same-user writer.
  // Retry a failed initial stat only to identify a safe cleanup candidate. If
  // metadata remains unavailable, close the fd and leave the pathname intact.
  if(!owned)try{owned=fstatSync(fd,{bigint:true});}catch{}
  if(owned&&sameFile(target,owned))unlinkSync(target);
  throw error;
 }finally{closeSync(fd);}
 return{restored:true,...verified};
}

/** One verified snapshot per Stockholm date. Existing archives are authenticated, never overwritten. */
export function dailyBackup(database,directory,encryptionKey,at=new Date()){
 key(encryptionKey);mkdirSync(directory,{recursive:true,mode:0o700});
 const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
 const archive=join(directory,`mgeorge-${day}.mgbak`),existing=existsSync(archive);
 const result=existing?verifyBackup(archive,encryptionKey):createBackup(database,archive,encryptionKey);
 return{...result,day,created:!existing};
}
