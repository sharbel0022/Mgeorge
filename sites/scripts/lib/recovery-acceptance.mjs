// Independent acceptance of an isolated restore against a pre-backup census.
// The receipt alone cannot prove that the intended ledger was recovered.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const EMPTY_TABLES=['bank_auth_flows','bank_locks','gmail_flows','gmail_locks','customer_reviews','backup_runs','bankgiro_ingest_leases','companies','company_memberships','company_roles','company_user_contexts','company_worker_grants','company_operation_guard','company_application_tokens'];
export const sortedRecoveryRows=rows=>rows.map(row=>Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b)))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
export function acceptIsolatedRecovery({directory,owner,tables,originals,incidentAt,recoveryPointAt,provenance}){
 // These expectations must be retained from the authenticated export BEFORE
 // restore. A receipt cannot establish its own backup identity or source hashes.
 assert.ok(provenance&&typeof provenance==='object'&&!Array.isArray(provenance),'pre-restore provenance required');
 assert.match(provenance.backupId,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
 assert.match(provenance.snapshotSha256,/^[a-f0-9]{64}$/);
 const sourceFiles=['bundle.json','manifest.bin','snapshot.bin'];
 assert.ok(provenance.sourceFiles&&typeof provenance.sourceFiles==='object'&&!Array.isArray(provenance.sourceFiles));
 assert.deepEqual(Object.keys(provenance.sourceFiles).sort(),sourceFiles);
 const receipt=JSON.parse(readFileSync(join(directory,'receipt.json'),'utf8'));
 assert.equal(receipt.format,'MG-Sites-evidence-restore-1');
 assert.equal(receipt.mode,'evidence-only');assert.equal(receipt.schemaPrefix,'evidence_');assert.equal(receipt.owner,owner);
 assert.equal(receipt.backupId,provenance.backupId);
 assert.deepEqual(receipt.companyBoundary,provenance.companyBoundary);
 assert.equal(receipt.snapshotSha256,provenance.snapshotSha256);
 const companyJobs=tables.find(table=>table.name==='company_bank_sync_jobs');
 assert.deepEqual(receipt.transforms,companyJobs?[{table:'company_bank_sync_jobs',kind:'invalidate_job_leases',rows:companyJobs.rows.length}]:[]);
 assert.deepEqual(readdirSync(join(directory,'source')).sort(),sourceFiles);
 for(const filename of sourceFiles){
  assert.match(provenance.sourceFiles[filename],/^[a-f0-9]{64}$/);
  assert.equal(sha(readFileSync(join(directory,'source',filename))),provenance.sourceFiles[filename],'retained source mismatch: '+filename);
 }
 const timestamp=value=>{assert.equal(typeof value,'string');const time=Date.parse(value);assert.ok(Number.isFinite(time));assert.equal(new Date(time).toISOString(),value);return time;};
 const rpoMilliseconds=timestamp(incidentAt)-timestamp(recoveryPointAt);assert.ok(rpoMilliseconds>=0);
 const databasePath=join(directory,'evidence.sqlite'),sql=new DatabaseSync(databasePath,{readOnly:true});
 let state;
 try{
  assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.deepEqual(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row=>row.name).sort(),[...tables.map(table=>table.name),...EMPTY_TABLES,'company_application_token_control'].map(name=>'evidence_'+name).sort());
  // The sole nonempty control row is a fixed recovery barrier, not restored
  // authority. Validate it in full instead of relaxing the schema census.
  assert.deepEqual(sql.prepare('SELECT * FROM evidence_company_application_token_control').all().map(row=>({...row})),[{id:1,revision:2,recovery_required:1,restore_marker:'isolated-evidence-restore',recovery_evidence:''}]);
  for(const table of tables){
   assert.match(table.name,/^[a-z_]+$/);
   const rows=sql.prepare(`SELECT * FROM "evidence_${table.name}"`).all();
   assert.ok(rows.every(row=>row.owner===owner),'foreign owner in recovered table');
   // Revocation of old worker leases is an intentional recovery transform.
   const expected=table.name==='company_bank_sync_jobs'?table.rows.map(row=>({...row,lease_token:'',lease_until:0,lease_deadline:0,fence_version:row.fence_version+1})):table.rows;
   assert.deepEqual(sortedRecoveryRows(rows),sortedRecoveryRows(expected),'restored row mismatch: '+table.name);
   if(table.name==='workspaces')state=JSON.parse(rows[0].payload);
  }
  // The migration seeds four role names; they confer no membership or grant.
  for(const name of EMPTY_TABLES.filter(name=>name!=='company_roles'))assert.equal(sql.prepare(`SELECT COUNT(*) count FROM evidence_${name}`).get().count,0);
  assert.deepEqual(sql.prepare('SELECT role FROM evidence_company_roles ORDER BY role').all().map(row=>row.role),['accountant','admin','owner','viewer']);
 }finally{sql.close();}
 assert.equal(receipt.databaseSha256,sha(readFileSync(databasePath)));
 assert.deepEqual(receipt.tables,tables.map(table=>({name:table.name,rows:table.rows.length})));
 const filenames=originals.map(original=>original.id+'.bin').sort();assert.deepEqual(readdirSync(join(directory,'originals')).sort(),filenames);
 let bytes=0;
 for(const original of originals){
  const content=readFileSync(join(directory,'originals',original.id+'.bin'));
  assert.equal(content.length,original.size);assert.equal(sha(content),original.sha256);bytes+=content.length;
 }
 assert.deepEqual(receipt.originals,{count:originals.length,bytes});
 const sum=(rows,field)=>rows.reduce((total,row)=>{assert.ok(Number.isSafeInteger(row[field]));const next=total+row[field];assert.ok(Number.isSafeInteger(next));return next;},0);
 const ledger={invoices:state.invoices.length,invoiceCents:sum(state.invoices,'total'),transactions:state.transactions.length,transactionCents:sum(state.transactions,'amount'),allocations:state.allocations.length,allocatedCents:sum(state.allocations,'amount'),revokedCredits:state.credits.filter(row=>row.revokedAt).length,revokedBankgiroLinks:state.bankgiroLinks.filter(row=>row.revokedAt).length};
 return{tables:receipt.tables,originals:{count:originals.length,bytes,hashesChecked:originals.length},ledger,rpoMilliseconds,otherOwnerExcluded:true,authorizationAndTransientRowsAbsent:true,workerLeasesInvalidated:true,applicationTokenRecoveryBlocked:true,sourceProvenanceVerified:true};
}
