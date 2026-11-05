import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {BACKUP_TABLES,validateSnapshot,sealBackup} from '../lib/backup-engine.ts';
import {exportBackupBundle,verifyRecoveryBundle} from '../scripts/lib/backup-recovery.mjs';
import {restoreBackupIsolated} from '../scripts/restore-backup-isolated.mjs';

const legacy=['workspaces','audit_events','documents','bank_applications','bank_connections','bank_sync_runs','gmail_connections','customer_contacts','customer_messages','reconciliation_findings','customer_deliveries','gmail_sources','gmail_runs','document_automation','document_jobs','document_extractions','invoice_counterparties','document_registrations','payment_control_runs','payment_control_requests'];
const extended=[...legacy,'bankgiro_ingest_sources','bankgiro_ingest_jobs'];
const companyTables=['company_bank_sync_scopes','company_bank_sync_jobs','company_bank_sync_requests','company_bank_sync_receipts'];
const owner='synthetic-bankgiro-backup-owner',id='00000000-0000-4000-8000-000000000003',documentId='00000000-0000-4000-8000-000000000004',key='a'.repeat(64),at='2026-11-02T12:00:00.000Z';
const original=Buffer.from('SYNTHETIC BANKGIRO ORIGINAL'),hash=value=>createHash('sha256').update(value).digest('hex');
function snapshot(includeQueue=true){
 const tables=(includeQueue?extended:legacy).map(name=>({name,rows:[]})),rows=name=>tables.find(t=>t.name===name).rows;
 rows('workspaces').push({owner,revision:0,payload:JSON.stringify({schemaVersion:1,invoices:[],transactions:[],allocations:[],credits:[],imports:[],receipts:[]}),updated_at:at});
 rows('documents').push({id:documentId,owner,filename:'synthetic.csv',mime:'text/csv',size:original.length,sha256:hash(original),created_at:at});
 if(includeQueue){
  rows('bankgiro_ingest_sources').push({owner,source_id:'fixture',scope_id:'synthetic-scope',authorization_generation:'generation-1',authorization_status:'VERIFIED',cursor:'delivery-2',missing_report_ids:'[]',next_poll_at:Date.parse(at)+60000,attempts:0,last_error:null,updated_at:Date.parse(at)});
  rows('bankgiro_ingest_jobs').push({id:'job-1',owner,source_id:'fixture',scope_id:'synthetic-scope',report_id:'0000599',sha256:hash(original),filename:'synthetic.csv',available_at:at,authorization_generation:'generation-1',document_id:documentId,status:'REVIEW',attempts:1,next_attempt_at:null,last_error:null,import_id:'import-1',payment_count:1,created_at:Date.parse(at),updated_at:Date.parse(at)});
 }
 return {format:'MG-Sites-backup-1',owner,createdAt:at,tables};
}
test('new backups retain both durable Bankgiro tables while a transient lease is excluded',()=>{
 assert.deepEqual(BACKUP_TABLES,[...extended,'saas_bank_state',...companyTables]);
 const value=validateSnapshot(snapshot(),owner);
 assert.equal(value.tables.find(t=>t.name==='bankgiro_ingest_jobs').rows[0].report_id,'0000599');
 assert.equal(value.tables.some(t=>t.name==='bankgiro_ingest_leases'),false);
});
test('legacy snapshots remain intact and a partial new schema is rejected',()=>{
 const old=snapshot(false),before=structuredClone(old);
 assert.equal(validateSnapshot(old,owner).tables.length,20);assert.deepEqual(old,before);
 const partial=snapshot();partial.tables.pop();assert.throws(()=>validateSnapshot(partial,owner));
});
test('queue originals must belong to the snapshot owner and match the exact retained hash',()=>{
 for(const change of [
  value=>{value.tables.find(t=>t.name==='bankgiro_ingest_jobs').rows[0].owner='foreign';},
  value=>{value.tables.find(t=>t.name==='bankgiro_ingest_jobs').rows[0].document_id='missing';},
  value=>{value.tables.find(t=>t.name==='bankgiro_ingest_jobs').rows[0].sha256='f'.repeat(64);},
 ]){const value=snapshot();change(value);assert.throws(()=>validateSnapshot(value,owner));}
});
for(const queue of [false,true])test(`historical ${queue?22:20}-table encrypted bundle restores originals and intake state without activating a source`,async t=>{
 const value=validateSnapshot(snapshot(queue),owner),plain=Buffer.from(JSON.stringify(value)),prefix=`backups/${owner}/2026-11-02/${id}`;
 const objects=new Map([[prefix+'/snapshot.bin',await sealBackup(plain,key,owner,id,'snapshot')],[prefix+'/'+documentId+'.bin',await sealBackup(original,key,owner,id,'document:'+documentId)]]);
 const run={id,owner,day:'2026-11-02',state:'complete',snapshot_key:prefix+'/snapshot.bin',snapshot_hash:hash(plain),cursor:1,total_docs:1,bytes:original.length,verification_cursor:1,verified_bytes:original.length,verification_started_at:at,finished_at:at,created_at:at,api_evidence:JSON.stringify(value.apiEvidence),lease:'',lease_until:'',last_error:''};
 const entries=new Map(),bucket={async get(path){const bytes=objects.get(path);return bytes?{arrayBuffer:async()=>bytes.slice().buffer}:null;}};
 await exportBackupBundle(bucket,run,key,owner,async(path,bytes)=>entries.set(path,bytes));
 const source={list:async()=>[...entries.keys()],get:async path=>entries.get(path)?.slice()??null};
 const verified=await verifyRecoveryBundle(source,key,owner,id);assert.equal(verified.snapshot.tables.length,queue?22:20);
 const directory=mkdtempSync(join(tmpdir(),'mg-bankgiro-backup-'));
 let sql;
 t.after(()=>{sql?.close();rmSync(directory,{recursive:true,force:true});});
 const bundle=join(directory,'bundle'),output=join(directory,'restored');mkdirSync(bundle,{mode:0o700});mkdirSync(output,{mode:0o700});mkdirSync(join(bundle,'objects'),{mode:0o700});
 for(const [path,bytes]of entries)writeFileSync(join(bundle,path),bytes,{mode:0o600});
 const restored=await restoreBackupIsolated({bundleDirectory:bundle,outputParent:output,key,expectedOwner:owner,expectedBackupId:id});
 sql=new DatabaseSync(join(restored.directory,'evidence.sqlite'),{readOnly:true});
 assert.equal(sql.prepare('SELECT count(*) n FROM evidence_bankgiro_ingest_jobs').get().n,queue?1:0);
 assert.equal(sql.prepare('SELECT count(*) n FROM evidence_bankgiro_ingest_leases').get().n,0);
 assert.equal(sql.prepare('SELECT count(*) n FROM evidence_documents').get().n,1);
 for(const name of companyTables){assert.equal(sql.prepare('SELECT count(*) n FROM evidence_'+name).get().n,0);assert.throws(()=>sql.prepare('SELECT * FROM '+name).all(),/no such table/);}
 if(queue)assert.equal(sql.prepare('SELECT report_id FROM evidence_bankgiro_ingest_jobs').get().report_id,'0000599');
});
