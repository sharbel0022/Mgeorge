// Offline recovery only. This module has no database mutation, R2 put/delete,
// application route, runtime environment or production credential interface.
import {backupTableSet,sealBackup,unsealBackup,validateSnapshot} from '../../lib/backup-engine.ts';

const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const BUNDLE_FORMAT='MG-Sites-recovery-bundle-1',MANIFEST_FORMAT='MG-Sites-recovery-manifest-1';
const MAX_SNAPSHOT=12_000_000,MAX_DOCUMENT=15_000_000,MAX_MANIFEST=4_000_000,MAX_ROWS=5000;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,HASH=/^[a-f0-9]{64}$/;
const RUN_FIELDS=['id','owner','day','state','snapshot_key','snapshot_hash','cursor','total_docs','bytes','verification_cursor','verified_bytes','verification_started_at','finished_at','created_at','api_evidence'];
const OBJECT_FIELDS=['name','path','sourceKey','size','sha256','plaintextSize','plaintextSha256'];
const fail=code=>{throw Error('backup_recovery_'+code);};
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,fields)=>record(value)&&Object.keys(value).length===fields.length&&fields.every(field=>Object.hasOwn(value,field));
const nonnegative=value=>Number.isSafeInteger(value)&&value>=0;
const iso=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString()===value;
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
const dayOf=value=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));

function identity(owner,id){
 if(typeof owner!=='string'||owner.length<1||owner.length>512||/[\x00-\x1f\x7f]/.test(owner))fail('owner_mismatch');
 if(typeof id!=='string'||!UUID.test(id))fail('run_invalid');
}
function parse(bytes,limit){
 if(!(bytes instanceof Uint8Array)||bytes.length>limit)fail('format_invalid');
 try{return JSON.parse(decoder.decode(bytes));}catch{fail('format_invalid');}
}
function sourcePrefix(run){
 const prefix=`backups/${encodeURIComponent(run.owner)}/${run.day}/${run.id}`;
 if(run.snapshot_key===prefix+'/snapshot.bin')return prefix;
 if(typeof run.snapshot_key!=='string'||!run.snapshot_key.startsWith(prefix+'/')||!run.snapshot_key.endsWith('/snapshot.bin'))fail('run_invalid');
 const lease=run.snapshot_key.slice(prefix.length+1,-'/snapshot.bin'.length);
 if(!UUID.test(lease))fail('run_invalid');
 return prefix+'/'+lease;
}
function validateRun(run,owner,id){
 identity(owner,id);
 if(!exact(run,RUN_FIELDS)||run.owner!==owner||run.id!==id)fail('owner_mismatch');
 if(run.state!=='complete'||typeof run.day!=='string'||!/^\d{4}-\d\d-\d\d$/.test(run.day)||!iso(run.created_at)||!iso(run.verification_started_at)||!iso(run.finished_at)||run.finished_at<run.verification_started_at||!HASH.test(run.snapshot_hash))fail('run_invalid');
 if(!['cursor','total_docs','bytes','verification_cursor','verified_bytes'].every(field=>nonnegative(run[field]))||run.total_docs>MAX_ROWS||run.cursor!==run.total_docs||run.verification_cursor!==run.total_docs||run.bytes!==run.verified_bytes||typeof run.api_evidence!=='string')fail('census_invalid');
 sourcePrefix(run);
 return run;
}
function capturedRun(value,owner){
 if(!record(value)||value.owner!==owner||value.lease!==''||value.lease_until!==''||value.last_error!=='')fail('run_invalid');
 return validateRun(Object.fromEntries(RUN_FIELDS.map(field=>[field,value[field]])),owner,value.id);
}
async function decrypt(bytes,key,owner,id,name,limit){
 if(!(bytes instanceof Uint8Array)||bytes.length<52||bytes.length>limit+52)fail('object_invalid');
 try{return await unsealBackup(bytes,key,owner,id,name);}catch{fail('authentication_failed');}
}
async function readBucket(bucket,path,limit){
 try{
  const object=await bucket.get(path);
  if(!object)fail('object_missing');
  if(object.size!==undefined&&(!nonnegative(object.size)||object.size>limit))fail('object_invalid');
  const bytes=new Uint8Array(await object.arrayBuffer());
  if(bytes.length>limit)fail('object_invalid');
  return bytes;
 }catch(error){if(error instanceof Error&&/^backup_recovery_/.test(error.message))throw error;fail('read_failed');}
}
async function readSource(source,path,limit){
 let bytes;
 try{bytes=await source.get(path,limit);}catch{fail('read_failed');}
 if(bytes===null||bytes===undefined)fail('object_missing');
 if(!(bytes instanceof Uint8Array)||bytes.length>limit)fail('object_invalid');
 return bytes;
}
function checkedSnapshot(bytes,run,expectedCompanyBoundary){
 let snapshot;
 try{snapshot=validateSnapshot(parse(bytes,MAX_SNAPSHOT),run.owner,expectedCompanyBoundary);}catch{fail('snapshot_invalid');}
 if(!iso(snapshot.createdAt)||dayOf(snapshot.createdAt)!==run.day||snapshot.tables.some(table=>table.rows.length>MAX_ROWS))fail('snapshot_invalid');
 const files=snapshot.tables.find(table=>table.name==='documents').rows;
 if(files.some(file=>!UUID.test(file.id)))fail('snapshot_invalid');
 const totalBytes=files.reduce((sum,file)=>sum+file.size,0);
 if(run.total_docs!==files.length||run.bytes!==totalBytes)fail('census_invalid');
 let evidence;
 try{evidence=JSON.parse(run.api_evidence);}catch{fail('census_invalid');}
 if(!exact(evidence,Object.keys(snapshot.apiEvidence))||Object.keys(snapshot.apiEvidence).some(field=>evidence[field]!==snapshot.apiEvidence[field]))fail('census_invalid');
 return snapshot;
}
const tableCensus=snapshot=>backupTableSet(snapshot.tables.map(table=>table.name)).map(name=>({name,rows:snapshot.tables.find(table=>table.name===name).rows.length}));
function descriptors(snapshot,run,snapshotSize){
 const prefix=sourcePrefix(run);
 return [
  {name:'snapshot',path:'objects/snapshot.bin',sourceKey:run.snapshot_key,plaintextSize:snapshotSize,plaintextSha256:run.snapshot_hash},
  ...snapshot.tables.find(table=>table.name==='documents').rows.map(file=>({name:'document:'+file.id,path:'objects/'+file.id+'.bin',sourceKey:prefix+'/'+file.id+'.bin',plaintextSize:file.size,plaintextSha256:file.sha256.toLowerCase()})),
 ];
}
async function checkObject(bytes,entry,key,owner,id){
 if(bytes.length!==entry.size||await sha(bytes)!==entry.sha256)fail('object_invalid');
 const plain=await decrypt(bytes,key,owner,id,entry.name,entry.name==='snapshot'?MAX_SNAPSHOT:MAX_DOCUMENT);
 if(plain.length!==entry.plaintextSize||await sha(plain)!==entry.plaintextSha256)fail('object_invalid');
 return plain;
}
function validateManifest(manifest,owner,id){
 if(!exact(manifest,['format','owner','backupId','run','tables','objects'])||manifest.format!==MANIFEST_FORMAT||manifest.owner!==owner||manifest.backupId!==id)fail('manifest_invalid');
 validateRun(manifest.run,owner,id);
 let tableSet;try{tableSet=backupTableSet(manifest.tables?.map(table=>table?.name));}catch{fail('census_invalid');}
 if(manifest.tables.some((table,index)=>!exact(table,['name','rows'])||table.name!==tableSet[index]||!nonnegative(table.rows)||table.rows>MAX_ROWS))fail('census_invalid');
 if(!Array.isArray(manifest.objects)||manifest.objects.length!==manifest.run.total_docs+1)fail('census_invalid');
 for(const entry of manifest.objects){
  if(!exact(entry,OBJECT_FIELDS)||typeof entry.name!=='string'||typeof entry.path!=='string'||typeof entry.sourceKey!=='string'||!nonnegative(entry.size)||!nonnegative(entry.plaintextSize)||!HASH.test(entry.sha256)||!HASH.test(entry.plaintextSha256)||entry.size!==entry.plaintextSize+52||entry.plaintextSize>(entry.name==='snapshot'?MAX_SNAPSHOT:MAX_DOCUMENT))fail('manifest_invalid');
 }
 if(new Set(manifest.objects.map(entry=>entry.path)).size!==manifest.objects.length||new Set(manifest.objects.map(entry=>entry.name)).size!==manifest.objects.length)fail('census_invalid');
 const first=manifest.objects[0];
 if(first.name!=='snapshot'||first.path!=='objects/snapshot.bin'||first.sourceKey!==manifest.run.snapshot_key||first.plaintextSha256!==manifest.run.snapshot_hash)fail('manifest_invalid');
 return manifest;
}
function validateBinding(manifest,snapshot,snapshotSize){
 const expected=descriptors(snapshot,manifest.run,snapshotSize),census=tableCensus(snapshot);
 if(expected.length!==manifest.objects.length||census.length!==manifest.tables.length||census.some((table,index)=>table.name!==manifest.tables[index].name||table.rows!==manifest.tables[index].rows))fail('census_invalid');
 for(let index=0;index<expected.length;index++)for(const [field,value]of Object.entries(expected[index]))if(manifest.objects[index][field]!==value)fail('manifest_invalid');
}

/** Independently reauthenticate a completed snapshot and every retained original.
 * The supplied run row must come from an owner-scoped, trusted metadata read.
 * No historical `complete` flag alone is treated as evidence of readable bytes.
 */
export async function inspectBackup(bucket,row,key,owner,{expectedCompanyBoundary}={}){
 const run=capturedRun(row,owner),snapshotBytes=await readBucket(bucket,run.snapshot_key,MAX_SNAPSHOT+52);
 const plain=await decrypt(snapshotBytes,key,owner,run.id,'snapshot',MAX_SNAPSHOT);
 if(await sha(plain)!==run.snapshot_hash)fail('snapshot_invalid');
 const snapshot=checkedSnapshot(plain,run,expectedCompanyBoundary),objects=[];
 for(const entry of descriptors(snapshot,run,plain.length)){
  const bytes=entry.name==='snapshot'?snapshotBytes:await readBucket(bucket,entry.sourceKey,MAX_DOCUMENT+52);
  const object={...entry,size:bytes.length,sha256:await sha(bytes)};
  await checkObject(bytes,object,key,owner,run.id);objects.push(object);
 }
 return{manifest:{format:MANIFEST_FORMAT,owner,backupId:run.id,run,tables:tableCensus(snapshot),objects},snapshot};
}

/** Stream only authenticated ciphertext to an isolated writer. The final
 * bundle.json is a completion marker; interrupted exports remain incomplete.
 */
export async function exportBackupBundle(bucket,row,key,owner,write,options={}){
 const {manifest}=await inspectBackup(bucket,row,key,owner,options);
 const manifestBytes=encoder.encode(JSON.stringify(manifest));
 if(manifestBytes.length>MAX_MANIFEST)fail('manifest_invalid');
 for(const entry of manifest.objects){
  const bytes=await readBucket(bucket,entry.sourceKey,entry.size);
  await checkObject(bytes,entry,key,owner,manifest.backupId);
  await write(entry.path,bytes);
 }
 await write('manifest.bin',await sealBackup(manifestBytes,key,owner,manifest.backupId,'recovery-manifest'));
 await write('bundle.json',encoder.encode(JSON.stringify({format:BUNDLE_FORMAT,owner,backupId:manifest.backupId,manifest:'manifest.bin'})));
 return{format:BUNDLE_FORMAT,backupId:manifest.backupId,files:manifest.run.total_docs,bytes:manifest.run.bytes};
}

/** Verify the exact portable file census before a restore may create output.
 * Re-reading a verified object is still authenticated, closing read/write gaps.
 */
export async function verifyRecoveryBundle(source,key,owner,backupId,{expectedCompanyBoundary}={}){
 identity(owner,backupId);
 const header=parse(await readSource(source,'bundle.json',4096),4096);
 if(!exact(header,['format','owner','backupId','manifest'])||header.format!==BUNDLE_FORMAT||header.owner!==owner||header.backupId!==backupId||header.manifest!=='manifest.bin')fail('manifest_invalid');
 const sealed=await readSource(source,'manifest.bin',MAX_MANIFEST+52);
 const manifest=validateManifest(parse(await decrypt(sealed,key,owner,backupId,'recovery-manifest',MAX_MANIFEST),MAX_MANIFEST),owner,backupId);
 const snapshotBytes=await readSource(source,'objects/snapshot.bin',MAX_SNAPSHOT+52);
 const plain=await checkObject(snapshotBytes,manifest.objects[0],key,owner,backupId),snapshot=checkedSnapshot(plain,manifest.run,expectedCompanyBoundary);
 validateBinding(manifest,snapshot,plain.length);
 let paths;
 try{paths=await source.list();}catch{fail('read_failed');}
 const expected=['bundle.json','manifest.bin',...manifest.objects.map(entry=>entry.path)];
 if(!Array.isArray(paths)||paths.length!==expected.length||paths.some(path=>typeof path!=='string')||new Set(paths).size!==paths.length||paths.some(path=>!expected.includes(path)))fail('census_invalid');
 for(const entry of manifest.objects.slice(1))await checkObject(await readSource(source,entry.path,entry.size),entry,key,owner,backupId);
 // The source files remain untrusted after this return. Call readOriginal for
 // each actual write rather than retrieving unchecked bytes from the source.
 return{
  manifest,snapshot,
  sourceHeader:encoder.encode(JSON.stringify(header)),sourceManifest:sealed,sourceSnapshot:snapshotBytes,
  async readOriginal(documentId){
   const entry=manifest.objects.find(entry=>entry.name==='document:'+documentId);
   if(!entry)fail('object_missing');
   return checkObject(await readSource(source,entry.path,entry.size),entry,key,owner,backupId);
  },
 };
}
