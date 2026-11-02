import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,openSync,closeSync,unlinkSync,linkSync,mkdirSync,existsSync,lstatSync,fstatSync,fsyncSync,readSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';

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
function originalReferenceIntegrity(db,tables){
 const names=new Set(tables.map(table=>table.name));
 const invalid=()=>Object.assign(Error('Backupen innehåller en ogiltig originalreferens.'),{code:'backup_original_reference_invalid'});
 const parse=value=>{try{return JSON.parse(value);}catch{throw invalid();}};
 const list=value=>{if(value===undefined||value===null)return [];if(!Array.isArray(value))throw invalid();return value;};
 const columns=table=>new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column=>column.name));
 const originals=(table,hashColumn)=>{
  if(!names.has(table))return new Map();
  const fields=columns(table),optional=name=>fields.has(name)?name:`NULL AS ${name}`;
  return new Map(db.prepare(`SELECT id,${fields.has(hashColumn)?hashColumn:'NULL'} AS hash,${fields.has('content')?"typeof(content)='blob'":'0'} AS has_content,${optional('extraction')},${optional('owner')},${optional('metadata')},${optional('source')} FROM ${table}`).all().map(row=>[row.id,row]));
 };
 const documents=originals('documents','fingerprint'),imports=originals('import_jobs','content_sha256');
 const reference=(registry,id,hash,required=false,file=false)=>{
  if(id===undefined||id===null||id===''){if(required)throw originalFailure('backup_original_missing');return;}
  const original=typeof id==='string'?registry.get(id):undefined;
  if(!original||file&&!original.has_content)throw originalFailure('backup_original_missing');
  if(hash!==undefined&&hash!==null&&hash!==''){
   if(typeof hash!=='string'||!/^[a-f0-9]{64}$/i.test(hash))throw originalFailure('backup_original_hash_unavailable');
   if(typeof original.hash!=='string'||hash.toLowerCase()!==original.hash.toLowerCase())throw originalFailure('backup_original_hash_mismatch');
  }
 };
 const document=(id,hash,required=false)=>reference(documents,id,hash,required);
 const imported=(id,hash,required=false,file=false)=>reference(imports,id,hash,required,file);
 if(names.has('bankgiro_ingest_jobs'))for(const row of db.prepare('SELECT owner,status,document_id,import_id,sha256 FROM bankgiro_ingest_jobs').all()){
  const terminal=['IMPORTED','REVIEW','DUPLICATE'].includes(row.status);
  if(typeof row.owner!=='string'||!row.owner||typeof row.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(row.sha256))throw invalid();
  document(row.document_id,row.sha256,terminal);
  imported(row.import_id,row.sha256,terminal,true);
  if(row.document_id){const original=documents.get(row.document_id);if(original.source!=='bankgiro_source'||parse(original.metadata)?.owner!==row.owner)throw invalid();}
  if(row.import_id&&imports.get(row.import_id)?.owner!==row.owner)throw invalid();
 }
 const conflictOriginals=value=>{for(const conflict of list(value))for(const id of list(conflict?.original_import_ids))imported(id,undefined,true,true);};
 // These typed pointers are not declared as SQLite foreign keys. API/manual
 // jobs may have no file bytes, while a retained conflict file must have them.
 const transactionColumns=columns('bank_transactions');
 if(transactionColumns.has('import_id'))for(const row of db.prepare('SELECT import_id FROM bank_transactions').all())imported(row.import_id);
 if(transactionColumns.has('bank_evidence_conflicts'))for(const row of db.prepare('SELECT bank_evidence_conflicts FROM bank_transactions').all())conflictOriginals(parse(row.bank_evidence_conflicts));
 if(names.has('bank_specification_links'))for(const row of db.prepare('SELECT import_id,original_sha256 FROM bank_specification_links').all()){
  if(typeof row.original_sha256!=='string'||!/^[a-f0-9]{64}$/i.test(row.original_sha256))throw originalFailure('backup_original_hash_unavailable');
  // Revocation preserves the reviewed original and its checksum as history.
  imported(row.import_id,row.original_sha256,true,true);
 }
 for(const row of documents.values())if(row.extraction)document(row.id,parse(row.extraction)?.processing?.sha256,true);
 if(!names.has('audit_events'))return;
 const documentActions=new Set(['document_uploaded','document_attached','document_extracted','document_duplicate_linked','invoice_review_approved','invoice_auto_registered','document_dismissed','document_restored']);
 const invoiceActions=new Set(['invoice_created','invoice_updated','invoice_reconciled']);
 const importActions=new Set(['bank_import_rejected','bank_evidence_original_attached','bank_evidence_conflict','bankgiro_xlsx_review_saved','bank_specification_linked','bank_specification_link_revoked','aggregate_replaced','absence_check_invalidated']);
 for(const row of db.prepare('SELECT action,details FROM audit_events').all()){
  if(!documentActions.has(row.action)&&!invoiceActions.has(row.action)&&!importActions.has(row.action))continue;
  const detail=parse(row.details);
  // Only known producer fields are references. Historical attachments and
  // file imports remain required even after the current source is replaced.
  if(documentActions.has(row.action))document(detail?.id,row.action==='document_extracted'?detail?.extraction?.processing?.sha256:undefined,true);
  if(invoiceActions.has(row.action))document(detail?.document_id);
  if(['bank_import_rejected','bank_specification_link_revoked'].includes(row.action))imported(detail?.import_id,undefined,true,true);
  if(row.action==='bank_evidence_original_attached')imported(detail?.original_import_id,undefined,true,true);
  if(row.action==='bank_evidence_conflict')for(const id of list(detail?.original_import_ids))imported(id,undefined,true,true);
  if(row.action==='bankgiro_xlsx_review_saved')imported(detail?.import_id,detail?.sha256,true,true);
  if(row.action==='bank_specification_linked')imported(detail?.import_id,detail?.original_sha256,true,true);
  if(row.action==='aggregate_replaced'){imported(detail?.specification_import_id,undefined,false,true);imported(detail?.before?.import_id);imported(detail?.after?.import_id);}
  if(row.action==='absence_check_invalidated')imported(detail?.import_id);
 }
}
function integrity(file){const db=new DatabaseSync(file,{readOnly:true});try{const checks=db.prepare('PRAGMA integrity_check').all();if(checks.length!==1||Object.values(checks[0])[0]!=='ok')throw Error('Databasens integritetskontroll misslyckades.');if(db.prepare('PRAGMA foreign_key_check').all().length)throw Object.assign(Error('Backupen innehåller brutna registerreferenser.'),{code:'backup_foreign_key_violation'});const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();if(!tables.some(t=>t.name==='invoices')||!tables.some(t=>t.name==='bank_transactions'))throw Error('Backupen saknar MG:s register.');originalIntegrity(db,tables);originalReferenceIntegrity(db,tables);return{tables:tables.length};}finally{db.close();}}
function unpack(archive,encryptionKey){const bytes=readFileSync(archive);if(bytes.length<36||!bytes.subarray(0,8).equals(header))throw Error('Okänt backupformat.');const decipher=createDecipheriv('aes-256-gcm',key(encryptionKey),bytes.subarray(8,20));decipher.setAAD(header);decipher.setAuthTag(bytes.subarray(20,36));return Buffer.concat([decipher.update(bytes.subarray(36)),decipher.final()]);}
function inspect(content){const folder=mkdtempSync(join(tmpdir(),'mg-backup-check-'));try{const file=join(folder,'restored.sqlite');writeFileSync(file,content,{mode:0o600});return integrity(file);}finally{rmSync(folder,{recursive:true,force:true});}}

/** SQLite VACUUM INTO creates a consistent snapshot, including committed WAL data. */
export function createBackup(database,archive,encryptionKey){
 const encryption=key(encryptionKey),folder=mkdtempSync(join(tmpdir(),'mg-backup-'));
 try{const snapshot=join(folder,'snapshot.sqlite'),db=new DatabaseSync(resolve(database),{readOnly:true});try{db.prepare('VACUUM INTO ?').run(snapshot);}finally{db.close();}
  integrity(snapshot);const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryption,iv);cipher.setAAD(header);const encrypted=Buffer.concat([cipher.update(readFileSync(snapshot)),cipher.final()]);
  // Stage on the archive's filesystem. A crash while writing cannot reserve the
  // daily filename with partial ciphertext; link publishes verified bytes only
  // and, unlike rename, never overwrites an existing or concurrent archive.
  const staging=mkdtempSync(join(dirname(resolve(archive)),'.mg-backup-'));
  try{
   const staged=join(staging,'archive.mgbak'),fd=openSync(staged,'wx',0o600);
   try{writeFileSync(fd,Buffer.concat([header,iv,cipher.getAuthTag(),encrypted]));fsyncSync(fd);}finally{closeSync(fd);}
   const verified=verifyBackup(staged,encryptionKey);linkSync(staged,archive);return verified;
  }finally{rmSync(staging,{recursive:true,force:true});}
 }finally{rmSync(folder,{recursive:true,force:true});}
}
/** Authenticates, decrypts and opens an isolated restored database without changing production. */
export function verifyBackup(archive,encryptionKey){return{verified:true,...inspect(unpack(archive,encryptionKey))};}
function pathStatus(file){try{return lstatSync(file,{bigint:true});}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function assertRestoreDestinationAbsent(target,suffixes=['','-wal','-shm','-journal']){
 for(const suffix of suffixes){const file=`${target}${suffix}`;if(pathStatus(file))throw Object.assign(Error('Återställningsmålet eller dess SQLite-sidfiler finns redan.'),{code:'EEXIST',path:file});}
}
function sameFile(file,owned){
 const current=pathStatus(file);if(!current?.isFile())return false;
 if(process.platform!=='win32')return current.dev===owned.dev&&current.ino===owned.ino;
 // Windows pathname stats can report dev=0 while descriptor stats report the
 // volume serial. Compare two descriptors without dropping the volume check;
 // lstat still rejects links and must identify the file that was opened.
 let fd;
 try{
  fd=openSync(file,'r');const opened=fstatSync(fd,{bigint:true}),latest=pathStatus(file);
  return opened.isFile()&&latest?.isFile()&&current.ino===opened.ino&&latest.ino===opened.ino&&opened.dev===owned.dev&&opened.ino===owned.ino;
 }
 catch(error){if(error.code==='ENOENT')return false;throw error;}
 finally{if(fd!==undefined)closeSync(fd);}
}
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
 const archive=join(directory,`mgeorge-${day}.mgbak`);
 if(existsSync(archive))return{...verifyBackup(archive,encryptionKey),day,created:false};
 try{return{...createBackup(database,archive,encryptionKey),day,created:true};}
 catch(error){
  if(error.code!=='EEXIST')throw error;
  // Another daily run may have published first. Preserve its bytes and only
  // accept it after authentication and full original/reference validation.
  return{...verifyBackup(archive,encryptionKey),day,created:false};
 }
}
