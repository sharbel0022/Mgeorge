// Evidence restoration only. No server, provider, production database path,
// R2 binding, credential discovery, migration promotion or cleanup is exposed.
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {constants,lstatSync,realpathSync,openSync,fstatSync,readFileSync,closeSync,readdirSync,mkdtempSync,mkdirSync,chmodSync,writeFileSync,fsyncSync,linkSync} from 'node:fs';
import {resolve,join,relative,isAbsolute,sep,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {BACKUP_TABLES} from '../lib/backup-engine.ts';
import {verifyRecoveryBundle} from './lib/backup-recovery.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const OMITTED_TABLES=['bank_auth_flows','bank_locks','gmail_flows','gmail_locks','customer_reviews','backup_runs','bankgiro_ingest_leases'];
// Authorization is reconstructed only by separately verified administration.
// Evidence restoration must not reactivate a user, worker grant or tenant.
const CONTROL_TABLES=['companies','company_memberships','company_roles','company_user_contexts','company_worker_grants','company_operation_guard'];
const fail=code=>{throw Error('backup_recovery_'+code);};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const sameIdentity=(a,b)=>a.dev===b.dev&&a.ino===b.ino;

function trustedAncestors(path){
 if(process.platform==='win32')return; // POSIX modes do not establish Windows ACLs.
 const uid=BigInt(process.getuid());
 for(let current=path;;current=dirname(current)){
  const stat=lstatSync(current,{bigint:true});
  // A private leaf can be renamed through a writable ancestor. A trusted
  // sticky parent (e.g. /tmp) protects its root/current-user-owned child.
  if(stat.isSymbolicLink()||!stat.isDirectory()||(stat.uid!==0n&&stat.uid!==uid)||((stat.mode&0o022n)!==0n&&(stat.mode&0o1000n)===0n))fail('output_parent_unsafe');
  if(dirname(current)===current)break;
 }
}
function directory(path,privateParent=false){
 if(typeof path!=='string'||!path)fail('path_invalid');
 const absolute=resolve(path),stat=lstatSync(absolute,{bigint:true});
 if(stat.isSymbolicLink()||!stat.isDirectory()||realpathSync(absolute)!==absolute)fail('path_invalid');
 // A newly created private child is safe only under a trusted parent. There
 // is deliberately no option to restore over an existing database or folder.
 if(privateParent&&process.platform!=='win32'&&((stat.mode&0o022n)!==0n||(process.getuid&&stat.uid!==BigInt(process.getuid()))))fail('output_parent_unsafe');
 if(privateParent)trustedAncestors(absolute);
 return{path:absolute,stat};
}
function unchangedDirectory(reference,privateParent=false){
 const current=directory(reference.path,privateParent);
 if(!sameIdentity(current.stat,reference.stat))fail('path_changed');
}
function allowedFile(path){
 if(path==='bundle.json'||path==='manifest.bin'||path==='objects/snapshot.bin')return true;
 const match=/^objects\/([^/]+)\.bin$/.exec(path);return !!match&&UUID.test(match[1]);
}
function boundFile(path,before,opened){
 if(!opened.isFile())return false;
 if(process.platform!=='win32')return sameIdentity(before,opened);
 // Windows lstat can report dev=0 while fstat reports the volume serial.
 // Keep the volume check by comparing two handles, with pathname inode/link
 // checks on both sides. Ignoring dev would accept a different volume.
 const current=lstatSync(path,{bigint:true});
 if(!current.isFile()||current.ino!==opened.ino||before.ino!==opened.ino)return false;
 const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{
  const probe=fstatSync(fd,{bigint:true}),latest=lstatSync(path,{bigint:true});
  return probe.isFile()&&latest.isFile()&&latest.ino===probe.ino&&current.ino===probe.ino&&sameIdentity(probe,opened);
 }finally{closeSync(fd);}
}
function diskSource(reference){
 function file(path){
  if(!allowedFile(path))fail('path_invalid');
  unchangedDirectory(reference);
  if(path.startsWith('objects/'))directory(join(reference.path,'objects'));
  return join(reference.path,...path.split('/'));
 }
 return{
  async get(path,limit){
   const absolute=file(path),before=lstatSync(absolute,{bigint:true});
   if(before.isSymbolicLink()||!before.isFile()||before.size>BigInt(limit))fail('path_invalid');
   const fd=openSync(absolute,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
   try{
    const opened=fstatSync(fd,{bigint:true});
    if(!boundFile(absolute,before,opened)||opened.size>BigInt(limit))fail('path_changed');
    const bytes=readFileSync(fd);
    if(bytes.length>limit)fail('object_invalid');
    return new Uint8Array(bytes);
   }finally{closeSync(fd);}
  },
  async list(){
   unchangedDirectory(reference);const files=[];
   for(const entry of readdirSync(reference.path,{withFileTypes:true})){
    if(entry.isSymbolicLink())fail('path_invalid');
    if(entry.name==='objects'&&entry.isDirectory()){
     directory(join(reference.path,'objects'));
     for(const child of readdirSync(join(reference.path,'objects'),{withFileTypes:true})){
      const path='objects/'+child.name;
      if(!child.isFile()||child.isSymbolicLink()||!allowedFile(path))fail('path_invalid');
      files.push(path);
     }
    }else{
     if(!entry.isFile()||!allowedFile(entry.name))fail('path_invalid');
     files.push(entry.name);
    }
    if(files.length>5003)fail('census_invalid');
   }
   return files;
  },
 };
}
// Exact pre-0018 rows remain authenticated historical evidence. New authority
// fields default to unknown; restoring evidence never activates a live source.
const readinessDefaults={bankgiro_ingest_sources:{revoked_generations:'[]',registration_revision:0,registration_binding:null,authorization_verified_at:null,authorization_valid_until:null,last_success_at:null,last_failure_at:null,last_failure_code:null},bankgiro_ingest_jobs:{registration_binding:''}};
function recoveredRow(table,row){
 const defaults=readinessDefaults[table],retained=defaults&&Object.keys(defaults).every(key=>!Object.hasOwn(row,key))?{...row,...defaults}:row;
 // Captured lease tokens remain in the authenticated source snapshot, but no
 // recovered row may reuse a former worker's authority. Quota, embargo,
 // checkpoints and receipts are durable evidence and remain unchanged.
 return table==='company_bank_sync_jobs'?{...retained,lease_token:'',lease_until:0,lease_deadline:0,fence_version:retained.fence_version+1}:retained;
}
function checkDatabase(database,snapshot,prefix=''){
 if(database.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||database.prepare('PRAGMA foreign_key_check').all().length)fail('database_invalid');
 for(const table of snapshot.tables){
  const actual=database.prepare('SELECT * FROM '+quote(prefix+table.name)).all();
  const fields=database.prepare('PRAGMA table_info('+quote(prefix+table.name)+')').all().map(column=>column.name);
  const canonical=rows=>rows.map(row=>JSON.stringify(fields.map(field=>row[field]))).sort();
  if(JSON.stringify(canonical(actual))!==JSON.stringify(canonical(table.rows.map(row=>recoveredRow(table.name,row)))))fail('database_mismatch');
 }
}
function evidenceDatabase(snapshot){
 const database=new DatabaseSync(':memory:');
 try{
  // Only repository-owned migrations are executable SQL. No SQL from the
  // archive is executed; all row values use bound parameters.
  const migrations=new URL('../drizzle/',import.meta.url);
  for(const file of readdirSync(migrations).filter(name=>/^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort())database.exec(readFileSync(new URL(file,migrations),'utf8'));
  const tables=database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name);
  const expected=[...BACKUP_TABLES,...OMITTED_TABLES,...CONTROL_TABLES].sort();
  if(JSON.stringify(tables)!==JSON.stringify(expected))fail('schema_invalid');
  database.exec('BEGIN');
  for(const table of snapshot.tables){
   if(!BACKUP_TABLES.includes(table.name))fail('schema_invalid');
   const columns=database.prepare('PRAGMA table_info('+quote(table.name)+')').all(),names=columns.map(column=>column.name);
   const insert=database.prepare('INSERT INTO '+quote(table.name)+' ('+names.map(quote).join(',')+') VALUES ('+names.map(()=>'?').join(',')+')');
   for(const original of table.rows){
    const row=recoveredRow(table.name,original);
    if(Object.keys(row).length!==names.length||names.some(name=>!Object.hasOwn(row,name)))fail('schema_invalid');
    for(const column of columns){
     const value=row[column.name];
     if(value===null){if(column.notnull||column.pk)fail('schema_invalid');}
     else if(column.type==='TEXT'){if(typeof value!=='string')fail('schema_invalid');}
     else if(column.type==='INTEGER'){if(!Number.isSafeInteger(value))fail('schema_invalid');}
     else fail('schema_invalid');
    }
    insert.run(...names.map(name=>row[name]));
   }
  }
  database.exec('COMMIT');checkDatabase(database,snapshot);
  // Keep authenticated rows and the explicit lease invalidation above.
  // Missing application table names prevent this database being used live.
  for(const table of tables)database.exec('ALTER TABLE '+quote(table)+' RENAME TO '+quote('evidence_'+table));
  checkDatabase(database,snapshot,'evidence_');
  return database;
 }catch{
  database.close();fail('schema_invalid');
 }
}
function writePrivate(path,bytes,guard){
 guard();
 const fd=openSync(path,'wx',0o600);
 try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
 guard();
 if(sha(readFileSync(path))!==sha(bytes))fail('write_mismatch');
 guard();
}

/** Restore to a fresh, private evidence directory after complete validation.
 * The output is intentionally incompatible with the live application's table
 * names. A failed write may leave an incomplete private directory; this tool
 * never deletes pre-existing paths or publishes a success receipt on failure.
 * receipt.json is the only completion marker. receipt.pending is deliberately
 * retained after either failure or success; its presence proves no completion.
 * This trusts the invoking user and, on Windows, the caller-established ACLs;
 * pathname checks do not defeat a hostile process running as that same user.
 */
export async function restoreBackupIsolated({bundleDirectory,outputParent,key,expectedOwner,expectedBackupId,expectedCompanyBoundary}){
 let database;
 try{
  if(typeof key!=='string'||!/^[a-f0-9]{64}$/i.test(key))fail('key_unavailable');
  const input=directory(bundleDirectory),parent=directory(outputParent,true),nested=relative(input.path,parent.path);
  if(nested===''||(!isAbsolute(nested)&&nested!=='..'&&!nested.startsWith('..'+sep)))fail('output_parent_unsafe');
  const source=diskSource(input),verified=await verifyRecoveryBundle(source,key,expectedOwner,expectedBackupId,{expectedCompanyBoundary});
  // Schema checks, primary-key/unique constraints and exact-row comparisons
  // happen in memory before any output directory is created.
  database=evidenceDatabase(verified.snapshot);
  unchangedDirectory(input);unchangedDirectory(parent,true);
  const output=mkdtempSync(join(parent.path,'mg-sites-evidence-'));chmodSync(output,0o700);
  const outputIdentity=directory(output,true);
  const checkOutput=()=>{unchangedDirectory(parent,true);unchangedDirectory(outputIdentity,true);};
  checkOutput();
  mkdirSync(join(output,'originals'),{mode:0o700});mkdirSync(join(output,'source'),{mode:0o700});
  const originalsIdentity=directory(join(output,'originals'),true),sourceIdentity=directory(join(output,'source'),true);
  const guard=()=>{checkOutput();unchangedDirectory(originalsIdentity,true);unchangedDirectory(sourceIdentity,true);};
  const databasePath=join(output,'evidence.sqlite');guard();database.prepare('VACUUM INTO ?').run(databasePath);chmodSync(databasePath,0o600);guard();
  const file=openSync(databasePath,'r+');try{fsyncSync(file);}finally{closeSync(file);}
  const readback=new DatabaseSync(databasePath,{readOnly:true});try{checkDatabase(readback,verified.snapshot,'evidence_');}finally{readback.close();}
  for(const document of verified.snapshot.tables.find(table=>table.name==='documents').rows){
   writePrivate(join(output,'originals',document.id+'.bin'),await verified.readOriginal(document.id),guard);
  }
  writePrivate(join(output,'source','bundle.json'),verified.sourceHeader,guard);
  writePrivate(join(output,'source','manifest.bin'),verified.sourceManifest,guard);
  writePrivate(join(output,'source','snapshot.bin'),verified.sourceSnapshot,guard);
  const companyJobs=verified.snapshot.tables.find(table=>table.name==='company_bank_sync_jobs');
  const transforms=companyJobs?[{table:'company_bank_sync_jobs',kind:'invalidate_job_leases',rows:companyJobs.rows.length}]:[];
  const receipt={format:'MG-Sites-evidence-restore-1',mode:'evidence-only',schemaPrefix:'evidence_',owner:expectedOwner,backupId:expectedBackupId,...(verified.snapshot.companyBoundary?{companyBoundary:verified.snapshot.companyBoundary}:{}),restoredAt:new Date().toISOString(),snapshotSha256:verified.manifest.run.snapshot_hash,databaseSha256:sha(readFileSync(databasePath)),tables:verified.manifest.tables,transforms,originals:{count:verified.manifest.run.total_docs,bytes:verified.manifest.run.bytes}};
  const pending=join(output,'receipt.pending');
  writePrivate(pending,new TextEncoder().encode(JSON.stringify(receipt,null,2)+'\n'),guard);
  database.close();database=undefined;
  const result={directory:output,mode:'evidence-only',backupId:expectedBackupId,files:receipt.originals.count,bytes:receipt.originals.bytes};
  guard();
  // Publish only flushed, checked bytes. The exclusive same-filesystem link
  // preserves a competing receipt. Nothing fallible follows this commit point;
  // retaining the pending path avoids deleting a foreign replacement in cleanup.
  linkSync(pending,join(output,'receipt.json'));
  return result;
 }catch(error){
  if(error instanceof Error&&/^backup_recovery_[a-z_]+$/.test(error.message))throw error;
  fail('failed');
 }finally{database?.close();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const [bundleDirectory,outputParent,expectedOwner,expectedBackupId,expectedCompanyId,...extra]=process.argv.slice(2);
  if(!bundleDirectory||!outputParent||!expectedOwner||!expectedBackupId||extra.length)fail('usage');
  const expectedCompanyBoundary=expectedCompanyId?{version:'company-data-boundary-v1',companyId:expectedCompanyId,storageOwner:expectedOwner,boundaryVersion:1}:undefined;
  const result=await restoreBackupIsolated({bundleDirectory,outputParent,expectedOwner,expectedBackupId,expectedCompanyBoundary,key:process.env.MG_SITES_RECOVERY_KEY});
  console.log(JSON.stringify(result,null,2));
 }catch(error){
  console.error(error instanceof Error&&/^backup_recovery_[a-z_]+$/.test(error.message)?error.message:'backup_recovery_failed');process.exitCode=1;
 }
}
