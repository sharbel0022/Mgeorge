// This command can only generate synthetic data. It accepts no credentials,
// source paths, cloud bindings or production restore destination.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {BACKUP_TABLES,backupStep} from '../lib/backup-engine.ts';
import {exportBackupBundle,verifyRecoveryBundle} from './lib/backup-recovery.mjs';
import {restoreBackupIsolated} from './restore-backup-isolated.mjs';
import {acceptIsolatedRecovery,sortedRecoveryRows} from './lib/recovery-acceptance.mjs';
import {createSyntheticFixture,fixtureOwner as owner,fixtureSnapshotAt as at,fixtureDocumentId as uuid} from './lib/recovery-drill-fixture.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const milliseconds=start=>Math.round((performance.now()-start)*1000)/1000;
const boundary={version:'company-data-boundary-v1',companyId:'synthetic-company',storageOwner:owner,boundaryVersion:1};
const census=f=>BACKUP_TABLES.map(name=>({name,rows:sortedRecoveryRows(f.sql.prepare(`SELECT * FROM ${name} WHERE owner=?`).all(owner))}));
const sourceDatabaseFingerprint=f=>sha(JSON.stringify(BACKUP_TABLES.map(name=>({name,rows:sortedRecoveryRows(f.sql.prepare(`SELECT * FROM ${name}`).all())}))));
const objectFingerprint=objects=>sha(JSON.stringify([...objects].map(([path,bytes])=>[path,sha(bytes)]).sort(([a],[b])=>a.localeCompare(b))));
function configuration(options){
 if(!options||typeof options!=='object'||Array.isArray(options))throw Error('recovery_drill_configuration_invalid');
 const {documentCount=7,totalOriginalBytes=documentCount*4096,incidentAt='2026-11-05T12:15:00.000Z'}=options;
 if(Object.keys(options).some(key=>!['documentCount','totalOriginalBytes','incidentAt'].includes(key))||!Number.isInteger(documentCount)||documentCount<4||documentCount>4000||!Number.isSafeInteger(totalOriginalBytes)||totalOriginalBytes<documentCount*128||totalOriginalBytes>512_000_000||Math.ceil(totalOriginalBytes/documentCount)>15_000_000||typeof incidentAt!=='string'||!Number.isFinite(Date.parse(incidentAt))||new Date(incidentAt).toISOString()!==incidentAt||Date.parse(incidentAt)<at.getTime()+300_000||Date.parse(incidentAt)>at.getTime()+900_000)throw Error('recovery_drill_configuration_invalid');
 return{documentCount,totalOriginalBytes,incidentAt};
}
export async function runSyntheticRecoveryDrill(options={}){
 const {documentCount,totalOriginalBytes,incidentAt}=configuration(options),startedAt=new Date().toISOString(),started=performance.now();
 const folder=mkdtempSync(join(tmpdir(),'mg-synthetic-recovery-drill-')),key=randomBytes(32).toString('hex');
 let f;
 try{
  f=createSyntheticFixture(documentCount,totalOriginalBytes);
  // Freeze the expected rows and SHA-256 values independently of the backup.
  const expectedTables=census(f),expectedOriginals=f.documents.map(document=>({id:document.id,size:document.bytes.length,sha256:sha(document.bytes)}));
  const backupStarted=performance.now();let steps=1;
  assert.equal((await backupStep(f.db,f.bucket,owner,key,at,2,{companyBoundary:boundary})).copied,2);
  const frozenSnapshot=f.row().snapshot_key;
  const changed=structuredClone(f.state);changed.invoices.push({id:'post-snapshot-write',number:'SYNTHETIC-AFTER-CUTOFF',total:99999});
  f.sql.prepare('UPDATE workspaces SET payload=?,revision=43,updated_at=? WHERE owner=?').run(JSON.stringify(changed),'2026-11-05T12:05:00.000Z',owner);
  const sourceRowsAfterIncident=sourceDatabaseFingerprint(f);
  const interruptedBucket={...f.bucket,async get(path){if(path===owner+'/'+uuid(3))throw Error('synthetic interrupted source read');return f.bucket.get(path);}};
  const interrupted=await backupStep(f.db,interruptedBucket,owner,key,at,2,{companyBoundary:boundary});steps++;
  assert.equal(interrupted.status,'failed');assert.equal(interrupted.copied,3);
  let completed;
  for(let attempt=0;attempt<Math.ceil(documentCount/5)*2+4;attempt++){
   completed=await backupStep(f.db,f.bucket,owner,key,at,5,{companyBoundary:boundary});steps++;
   assert.notEqual(completed.status,'failed',completed.error);
   if(completed.status==='complete')break;
  }
  assert.equal(completed.status,'complete');assert.equal(completed.verified_files,documentCount);assert.equal(completed.verified_bytes,totalOriginalBytes);
  assert.equal(f.row().snapshot_key,frozenSnapshot);
  const backupMilliseconds=milliseconds(backupStarted),sourceFingerprint=objectFingerprint(f.objects),writes=f.puts.length;
  const bundleDirectory=join(folder,'bundle'),outputParent=join(folder,'restore');mkdirSync(bundleDirectory,{mode:0o700});mkdirSync(outputParent,{mode:0o700});
  const exportStarted=performance.now();
  await exportBackupBundle(f.bucket,f.row(),key,owner,async(path,bytes)=>{
   const destination=join(bundleDirectory,path);mkdirSync(dirname(destination),{recursive:true,mode:0o700});writeFileSync(destination,bytes,{flag:'wx',mode:0o600});
  },{expectedCompanyBoundary:boundary});
  const exportMilliseconds=milliseconds(exportStarted);
  const diskSource={async get(path){return new Uint8Array(readFileSync(join(bundleDirectory,path)));},async list(){return['bundle.json','manifest.bin',...readdirSync(join(bundleDirectory,'objects')).map(name=>'objects/'+name)];}};
  const verified=await verifyRecoveryBundle(diskSource,key,owner,f.row().id,{expectedCompanyBoundary:boundary});
  assert.equal(verified.snapshot.createdAt,at.toISOString());
  const restoreArgs={bundleDirectory,outputParent,key,expectedOwner:owner,expectedBackupId:f.row().id,expectedCompanyBoundary:boundary};
  const rejectionChecks=[];
  async function rejectRestore(label,overrides={}){
   await assert.rejects(()=>restoreBackupIsolated({...restoreArgs,...overrides}),/backup_recovery_/);
   assert.deepEqual(readdirSync(outputParent),[]);
   rejectionChecks.push({case:label,stage:'restore',rejected:true,outputCreated:false});
  }
  await rejectRestore('wrong_key',{key:(key[0]==='0'?'1':'0')+key.slice(1)});
  await rejectRestore('wrong_owner',{expectedOwner:'another-synthetic-owner'});
  await rejectRestore('wrong_company',{expectedCompanyBoundary:{...boundary,companyId:'another-synthetic-company'}});
  const originalPath=join(bundleDirectory,'objects',uuid(0)+'.bin'),sealed=readFileSync(originalPath),corrupt=Buffer.from(sealed);corrupt[corrupt.length-1]^=1;
  try{writeFileSync(originalPath,corrupt);await rejectRestore('corrupt_original');}finally{writeFileSync(originalPath,sealed);}
  try{rmSync(originalPath);await rejectRestore('missing_original');}finally{writeFileSync(originalPath,sealed,{flag:'wx',mode:0o600});}
  // Start RTO only when the independently exported encrypted bundle is locally
  // available. It ends after SQLite, tenant, ledger and original acceptance.
  const restoreStarted=performance.now(),restored=await restoreBackupIsolated(restoreArgs);
  const acceptanceArgs={directory:restored.directory,owner,tables:expectedTables,originals:expectedOriginals,incidentAt,recoveryPointAt:verified.snapshot.createdAt};
  const accepted=acceptIsolatedRecovery(acceptanceArgs),restoreAndAcceptanceMilliseconds=milliseconds(restoreStarted);
  assert.equal(accepted.ledger.invoices,2);assert.equal(accepted.ledger.invoiceCents,75000);assert.equal(accepted.ledger.allocatedCents,62500);
  const objectives={isolatedRtoMilliseconds:60000,simulatedRpoMilliseconds:900000};
  assert.ok(restoreAndAcceptanceMilliseconds<=objectives.isolatedRtoMilliseconds,'isolated RTO objective exceeded');assert.ok(accepted.rpoMilliseconds<=objectives.simulatedRpoMilliseconds,'simulated RPO objective exceeded');
  // Negative acceptance checks alter only this synthetic evidence directory.
  // Even a refreshed receipt checksum must not conceal changed ledger rows.
  const databasePath=join(restored.directory,'evidence.sqlite'),databaseBytes=readFileSync(databasePath),receiptPath=join(restored.directory,'receipt.json'),receiptBytes=readFileSync(receiptPath);
  function updateReceipt(){const receipt=JSON.parse(receiptBytes);receipt.databaseSha256=sha(readFileSync(databasePath));writeFileSync(receiptPath,JSON.stringify(receipt));}
  function rejectAcceptance(label,change){
   try{change();assert.throws(()=>acceptIsolatedRecovery(acceptanceArgs),{code:'ERR_ASSERTION'});rejectionChecks.push({case:label,stage:'acceptance',rejected:true});}
   finally{writeFileSync(databasePath,databaseBytes);writeFileSync(receiptPath,receiptBytes);}
  }
  rejectAcceptance('altered_ledger',()=>{const db=new DatabaseSync(databasePath);try{const row=db.prepare('SELECT payload FROM evidence_workspaces').get(),state=JSON.parse(row.payload);state.allocations[0].amount++;db.prepare('UPDATE evidence_workspaces SET payload=?').run(JSON.stringify(state));}finally{db.close();}updateReceipt();});
  const plaintextPath=join(restored.directory,'originals',uuid(0)+'.bin'),plaintext=readFileSync(plaintextPath);
  try{const changed=Buffer.from(plaintext);changed[changed.length-1]^=1;rejectAcceptance('altered_plaintext_original',()=>writeFileSync(plaintextPath,changed));}finally{writeFileSync(plaintextPath,plaintext);}
  rejectAcceptance('foreign_owner_row',()=>{const db=new DatabaseSync(databasePath);try{db.prepare('UPDATE evidence_audit_events SET owner=?').run('another-synthetic-owner');}finally{db.close();}updateReceipt();});
  rejectAcceptance('reactivated_application_issuer',()=>{const db=new DatabaseSync(databasePath);try{db.exec('UPDATE evidence_company_application_token_control SET recovery_required=0');}finally{db.close();}updateReceipt();});
  rejectAcceptance('retained_application_token',()=>{const db=new DatabaseSync(databasePath);try{db.prepare('INSERT INTO evidence_company_application_tokens(family_key,config_hash,token_ciphertext,token_version,expires_at) VALUES(?,?,?,?,?)').run('a'.repeat(64),'b'.repeat(64),'synthetic-ciphertext','synthetic-version',4102444800000);}finally{db.close();}updateReceipt();});
  acceptIsolatedRecovery(acceptanceArgs);
  assert.equal(sourceDatabaseFingerprint(f),sourceRowsAfterIncident);assert.equal(objectFingerprint(f.objects),sourceFingerprint);assert.equal(f.puts.length,writes);
  return{format:'MG-Sites-synthetic-recovery-drill-1',scope:'synthetic-isolated-evidence-only',productionRestoreTested:false,startedAt,completedAt:new Date().toISOString(),runtime:{node:process.version,platform:process.platform,architecture:process.arch},accepted:true,objectives,timing:{backupAndResumeMilliseconds:backupMilliseconds,exportMilliseconds,restoreAndAcceptanceMilliseconds,totalDrillMilliseconds:milliseconds(started),rtoIncludes:['authenticated bundle validation','fresh SQLite evidence database','original write and readback','independent row, owner, ledger and SHA-256 acceptance'],rtoExcludes:['operator response','cloud download or regional outage','key custody or access recovery','production application activation']},simulatedRecovery:{clock:'synthetic scenario, not a production measurement',recoveryPointAt:verified.snapshot.createdAt,postSnapshotWriteAt:'2026-11-05T12:05:00.000Z',incidentAt,rpoMilliseconds:accepted.rpoMilliseconds,postSnapshotWritesExcluded:changed.invoices.length-accepted.ledger.invoices},resume:{interruptionObserved:true,snapshotPreserved:true,steps,attempts:f.row().attempts},tables:accepted.tables,originals:accepted.originals,ledger:accepted.ledger,rejectionChecks,sourceUnchanged:true,otherOwnerExcluded:accepted.otherOwnerExcluded,authorizationAndTransientRowsAbsent:accepted.authorizationAndTransientRowsAbsent,workerLeasesInvalidated:accepted.workerLeasesInvalidated,applicationTokenRecoveryBlocked:accepted.applicationTokenRecoveryBlocked};
 }finally{f?.sql.close();rmSync(folder,{recursive:true,force:true});}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const arguments_=process.argv.slice(2);
  if(arguments_.length!==0&&(arguments_.length!==2||arguments_.some(value=>!/^\d+$/.test(value))))throw Error('recovery_drill_configuration_invalid');
  const options=arguments_.length?{documentCount:Number(arguments_[0]),totalOriginalBytes:Number(arguments_[1])}:{};
  process.stdout.write(JSON.stringify(await runSyntheticRecoveryDrill(options),null,2)+'\n');
 }catch(error){process.stderr.write(error?.message==='recovery_drill_configuration_invalid'?'recovery_drill_configuration_invalid\n':'recovery_drill_failed\n');process.exitCode=1;}
}
