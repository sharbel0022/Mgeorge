import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,readdirSync,lstatSync,openSync,closeSync,fsyncSync,renameSync,unlinkSync,rmSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import {parseEnv} from 'node:util';

// Run only in a trusted local installation directory. Both staging and the lock
// match .env.* and are excluded from Git; no key is printed or passed to a child.
const file=resolve('.env'),lock=file+'.backup-config.lock';
const fail=message=>{throw Error(message);};
const identity=path=>lstatSync(path,{bigint:true});
const sameFile=(path,before)=>{try{const now=identity(path);return now.isFile()&&now.dev===before.dev&&now.ino===before.ino;}catch{return false;}};
let lockFd,ownedLock,staging;
try{
 lockFd=openSync(lock,'wx',0o600);ownedLock=identity(lock);
 const before=identity(file);if(!before.isFile())fail('Configuration must be a regular file; links were preserved.');
 const original=readFileSync(file,'utf8'),values=parseEnv(original);
 for(const name of ['MG_BACKUP_KEY','MG_BACKUP_DIRECTORY']){
  const matches=original.match(new RegExp('^[ \\t]*(?:export[ \\t]+)?'+name+'[ \\t]*=','gm'))||[];
  if(matches.length>1)fail('Duplicate backup settings must be resolved before configuration.');
 }
 const folder=values.MG_BACKUP_DIRECTORY||join(process.env.LOCALAPPDATA||process.env.HOME,'MGFakturakoll','backups');
 if(/[\0\r\n]/.test(folder))fail('Backup directory must be a single valid path.');
 let encryptionKey=values.MG_BACKUP_KEY;
 if(encryptionKey&&!/^[a-f0-9]{64}$/i.test(encryptionKey))fail('Existing backup key is invalid; it was preserved.');
 if(!encryptionKey){
  let entries=[];
  try{entries=readdirSync(folder);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(entries.some(name=>/\.mgbak(?:$|[.-])/i.test(name)))fail('Retained backups exist. Recover their original key before configuration; no replacement key was generated.');
  encryptionKey=randomBytes(32).toString('hex');
 }
 let content=original;
 const setMissing=(name,value)=>{
  if(values[name])return;
  const pattern=new RegExp('^[ \\t]*(?:export[ \\t]+)?'+name+'[ \\t]*=.*$','m');
  content=pattern.test(content)?content.replace(pattern,()=>name+'='+value):content.trimEnd()+'\n'+name+'='+value+'\n';
 };
 setMissing('MG_BACKUP_KEY',encryptionKey);
 // Node's dotenv parser preserves backslashes in single quotes. Existing
 // nonempty assignments remain byte-for-byte intact, including their quotes.
 if(!values.MG_BACKUP_DIRECTORY){
  const quote=folder.includes("'")?'"':"'";
  if(folder.includes(quote))fail('Backup directory cannot be represented safely in this configuration.');
  setMissing('MG_BACKUP_DIRECTORY',quote+folder+quote);
 }
 const parsed=parseEnv(content);
 if(parsed.MG_BACKUP_KEY!==encryptionKey||parsed.MG_BACKUP_DIRECTORY!==folder)fail('Backup configuration could not be represented without changing its values.');
 for(const [name,value] of Object.entries(values))if(!name.startsWith('MG_BACKUP_')&&parsed[name]!==value)fail('Unrelated configuration changed; original was preserved.');
 mkdirSync(folder,{recursive:true,mode:0o700});
 staging=mkdtempSync(join(dirname(file),'.env.backup-config-'));
 const pending=join(staging,'config');writeFileSync(pending,content,{flag:'wx',mode:0o600});
 const fd=openSync(pending,'r+');try{fsyncSync(fd);}finally{closeSync(fd);}
 if(readFileSync(pending,'utf8')!==content)fail('Configuration write verification failed; original was preserved.');
 if(!sameFile(file,before)||readFileSync(file,'utf8')!==original)fail('Configuration changed concurrently; the other version was preserved.');
 // Atomic same-filesystem replacement; failure never truncates the original.
 renameSync(pending,file);
 console.log('Local encrypted backup configuration saved; existing integration keys preserved.');
}catch(error){
 const message=error.code==='EEXIST'?'Backup configuration is locked. Verify the other writer or interrupted setup before retrying.':error.message;
 console.error(message);process.exitCode=1;
}finally{
 if(staging)try{rmSync(staging,{recursive:true,force:true});}catch{}
 if(lockFd!==undefined)try{closeSync(lockFd);}catch{}
 if(ownedLock&&sameFile(lock,ownedLock))try{unlinkSync(lock);}catch{}
}
