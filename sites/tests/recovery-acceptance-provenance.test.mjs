import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {BACKUP_TABLES,backupStep} from '../lib/backup-engine.ts';
import {exportBackupBundle} from '../scripts/lib/backup-recovery.mjs';
import {restoreBackupIsolated} from '../scripts/restore-backup-isolated.mjs';
import {acceptIsolatedRecovery} from '../scripts/lib/recovery-acceptance.mjs';
import {createSyntheticFixture,fixtureOwner as owner,fixtureSnapshotAt as at} from '../scripts/lib/recovery-drill-fixture.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const boundary={version:'company-data-boundary-v1',companyId:'synthetic-company',storageOwner:owner,boundaryVersion:1};
async function recovery(t){
 const folder=mkdtempSync(join(tmpdir(),'mg-recovery-provenance-test-'));
 const f=createSyntheticFixture(4,16384),key='5'.repeat(64);
 t.after(()=>{f.sql.close();rmSync(folder,{recursive:true,force:true});});
 // Expectations are frozen from the source BEFORE backup or restore.
 const tables=BACKUP_TABLES.map(name=>({name,rows:f.sql.prepare('SELECT * FROM '+name+' WHERE owner=?').all(owner)}));
 const originals=f.documents.map(document=>({id:document.id,size:document.bytes.length,sha256:sha(document.bytes)}));
 let completed;
 for(let step=0;step<8;step++){
  completed=await backupStep(f.db,f.bucket,owner,key,at,5,{companyBoundary:boundary});
  assert.notEqual(completed.status,'failed',completed.error);
  if(completed.status==='complete')break;
 }
 assert.equal(completed.status,'complete');
 const bundleDirectory=join(folder,'bundle'),outputParent=join(folder,'restore');
 mkdirSync(bundleDirectory,{mode:0o700});mkdirSync(outputParent,{mode:0o700});
 const sourceFiles={};
 await exportBackupBundle(f.bucket,f.row(),key,owner,async(path,bytes)=>{
  const destination=join(bundleDirectory,path);
  mkdirSync(dirname(destination),{recursive:true,mode:0o700});
  writeFileSync(destination,bytes,{flag:'wx',mode:0o600});
  if(path==='bundle.json'||path==='manifest.bin'||path==='objects/snapshot.bin')sourceFiles[path==='objects/snapshot.bin'?'snapshot.bin':path]=sha(bytes);
 },{expectedCompanyBoundary:boundary});
 // Capture provenance from the authenticated export, never the restored receipt.
 const provenance={backupId:f.row().id,companyBoundary:structuredClone(boundary),snapshotSha256:f.row().snapshot_hash,sourceFiles};
 const restored=await restoreBackupIsolated({bundleDirectory,outputParent,key,expectedOwner:owner,expectedBackupId:provenance.backupId,expectedCompanyBoundary:boundary});
 const args={directory:restored.directory,owner,tables,originals,incidentAt:'2026-11-05T12:15:00.000Z',recoveryPointAt:at.toISOString(),provenance};
 const receiptPath=join(restored.directory,'receipt.json'),databasePath=join(restored.directory,'evidence.sqlite');
 return{args,receiptPath,databasePath};
}
function changeReceipt(f,change){
 const receipt=JSON.parse(readFileSync(f.receiptPath,'utf8'));change(receipt);
 writeFileSync(f.receiptPath,JSON.stringify(receipt));
}

test('independent acceptance accepts the authentic small fixture before any mutation',async t=>{
 const f=await recovery(t),result=acceptIsolatedRecovery(f.args);
 assert.equal(result.originals.hashesChecked,4);
 assert.equal(result.ledger.allocatedCents,62500);
 assert.equal(result.applicationTokenRecoveryBlocked,true);
});

test('independent acceptance requires provenance captured before restore',async t=>{
 const f=await recovery(t),{provenance,...withoutProvenance}=f.args;
 assert.ok(provenance.backupId);
 assert.throws(()=>acceptIsolatedRecovery(withoutProvenance),{code:'ERR_ASSERTION'});
});

for(const [name,change]of [
 ['backup identity',receipt=>{receipt.backupId='ffffffff-ffff-4fff-8fff-ffffffffffff';}],
 ['company binding',receipt=>{receipt.companyBoundary={...receipt.companyBoundary,companyId:'foreign-synthetic-company'};}],
 ['snapshot checksum',receipt=>{receipt.snapshotSha256='0'.repeat(64);}],
 ['restore format',receipt=>{receipt.format='untrusted-restore-format';}],
 ['claimed worker transform',receipt=>{receipt.transforms=[];}],
])test('independent acceptance rejects changed '+name+' with unchanged ledger and originals',async t=>{
 const f=await recovery(t);
 changeReceipt(f,change);
 assert.throws(()=>acceptIsolatedRecovery(f.args),{code:'ERR_ASSERTION'});
});

for(const filename of ['bundle.json','manifest.bin','snapshot.bin'])test('independent acceptance rejects changed retained source '+filename,async t=>{
 const f=await recovery(t),path=join(f.args.directory,'source',filename),bytes=readFileSync(path);
 bytes[bytes.length-1]^=1;writeFileSync(path,bytes);
 assert.throws(()=>acceptIsolatedRecovery(f.args),{code:'ERR_ASSERTION'});
});

test('independent acceptance rejects a missing retained snapshot',async t=>{
 const f=await recovery(t);rmSync(join(f.args.directory,'source','snapshot.bin'));
 assert.throws(()=>acceptIsolatedRecovery(f.args),{code:'ERR_ASSERTION'});
});

test('independent acceptance rejects an unlisted retained source file',async t=>{
 const f=await recovery(t);writeFileSync(join(f.args.directory,'source','unexpected.bin'),'synthetic foreign evidence');
 assert.throws(()=>acceptIsolatedRecovery(f.args),{code:'ERR_ASSERTION'});
});

for(const [name,change]of [
 ['allocation transaction reference',state=>{state.allocations[0].transactionId='unallocated';}],
 ['revoked Bankgiro original reference',state=>{state.bankgiroLinks[0].documentId=state.invoices[0].documentId;}],
])test('independent acceptance rejects changed '+name+' even with identical totals and refreshed receipt checksum',async t=>{
 const f=await recovery(t),database=new DatabaseSync(f.databasePath);
 try{
  const state=JSON.parse(database.prepare('SELECT payload FROM evidence_workspaces').get().payload);
  assert.equal(state.allocations[0].amount,62500);change(state);
  assert.equal(state.allocations[0].amount,62500);
  database.prepare('UPDATE evidence_workspaces SET payload=?').run(JSON.stringify(state));
 }finally{database.close();}
 changeReceipt(f,receipt=>{receipt.databaseSha256=sha(readFileSync(f.databasePath));});
 assert.throws(()=>acceptIsolatedRecovery(f.args),{code:'ERR_ASSERTION'});
});
