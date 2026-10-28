import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,openSync,closeSync,unlinkSync,mkdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const header=Buffer.from('MGBAK001');
function key(value){if(typeof value!=='string'||! /^[a-f0-9]{64}$/i.test(value))throw Error('MG_BACKUP_KEY måste innehålla exakt 64 hextecken.');return Buffer.from(value,'hex');}
function integrity(file){const db=new DatabaseSync(file,{readOnly:true});try{const checks=db.prepare('PRAGMA integrity_check').all();if(checks.length!==1||Object.values(checks[0])[0]!=='ok')throw Error('Databasens integritetskontroll misslyckades.');const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();if(!tables.some(t=>t.name==='invoices')||!tables.some(t=>t.name==='bank_transactions'))throw Error('Backupen saknar MG:s register.');return{tables:tables.length};}finally{db.close();}}
function unpack(archive,encryptionKey){const bytes=readFileSync(archive);if(bytes.length<36||!bytes.subarray(0,8).equals(header))throw Error('Okänt backupformat.');const decipher=createDecipheriv('aes-256-gcm',key(encryptionKey),bytes.subarray(8,20));decipher.setAAD(header);decipher.setAuthTag(bytes.subarray(20,36));return Buffer.concat([decipher.update(bytes.subarray(36)),decipher.final()]);}

/** SQLite VACUUM INTO creates a consistent snapshot, including committed WAL data. */
export function createBackup(database,archive,encryptionKey){
 const encryption=key(encryptionKey),folder=mkdtempSync(join(tmpdir(),'mg-backup-'));
 try{const snapshot=join(folder,'snapshot.sqlite'),db=new DatabaseSync(resolve(database),{readOnly:true});try{db.prepare('VACUUM INTO ?').run(snapshot);}finally{db.close();}
  integrity(snapshot);const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryption,iv);cipher.setAAD(header);const encrypted=Buffer.concat([cipher.update(readFileSync(snapshot)),cipher.final()]);writeFileSync(archive,Buffer.concat([header,iv,cipher.getAuthTag(),encrypted]),{flag:'wx',mode:0o600});
  return verifyBackup(archive,encryptionKey);
 }finally{rmSync(folder,{recursive:true,force:true});}
}
/** Authenticates, decrypts and opens an isolated restored database without changing production. */
export function verifyBackup(archive,encryptionKey){const folder=mkdtempSync(join(tmpdir(),'mg-backup-check-'));try{const file=join(folder,'restored.sqlite');writeFileSync(file,unpack(archive,encryptionKey),{mode:0o600});return{verified:true,...integrity(file)};}finally{rmSync(folder,{recursive:true,force:true});}}
export function restoreBackup(archive,target,encryptionKey){
 const content=unpack(archive,encryptionKey);verifyBackup(archive,encryptionKey);
 // Exclusive creation prevents replacing a running or existing database.
 const fd=openSync(target,'wx',0o600);try{writeFileSync(fd,content);}catch(error){closeSync(fd);unlinkSync(target);throw error;}closeSync(fd);return{restored:true,...integrity(target)};
}

/** One verified snapshot per Stockholm date. Existing archives are authenticated, never overwritten. */
export function dailyBackup(database,directory,encryptionKey,at=new Date()){
 key(encryptionKey);mkdirSync(directory,{recursive:true,mode:0o700});
 const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
 const archive=join(directory,`mgeorge-${day}.mgbak`),existing=existsSync(archive);
 const result=existing?verifyBackup(archive,encryptionKey):createBackup(database,archive,encryptionKey);
 return{...result,day,created:!existing};
}
