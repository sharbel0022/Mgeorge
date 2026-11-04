import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {BACKUP_TABLES,backupStep,validateSnapshot,unsealBackup} from '../lib/backup-engine.ts';
import {createCompanyBankSyncStore} from '../lib/company-bank-sync-store.js';
import {exportBackupBundle,verifyRecoveryBundle} from '../scripts/lib/backup-recovery.mjs';
import {restoreBackupIsolated} from '../scripts/restore-backup-isolated.mjs';

const companyTables=['company_bank_sync_scopes','company_bank_sync_jobs','company_bank_sync_requests','company_bank_sync_receipts'];
const oldTables=['workspaces','audit_events','documents','bank_applications','bank_connections','bank_sync_runs','gmail_connections','customer_contacts','customer_messages','reconciliation_findings','customer_deliveries','gmail_sources','gmail_runs','document_automation','document_jobs','document_extractions','invoice_counterparties','document_registrations','payment_control_runs','payment_control_requests'];
const intermediateTables=[...oldTables,'bankgiro_ingest_sources','bankgiro_ingest_jobs'];
const allTables=[...intermediateTables,...companyTables];
const OWNER='synthetic-company-backup-owner',KEY='6'.repeat(64),AT=Date.parse('2026-11-04T12:00:00Z');
const adapter=sql=>({
 prepare(query){return {query,args:[],bind(...args){this.args=args;return this;},async first(){return sql.prepare(query).get(...this.args)||null;},async all(){return {results:sql.prepare(query).all(...this.args)};},async run(){return this.execute();},execute(){const statement=sql.prepare(query);return statement.columns().length?{results:statement.all(...this.args),meta:{changes:0}}:{meta:{changes:Number(statement.run(...this.args).changes)}};}};},
 async batch(statements){sql.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>s.execute());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}},
});
const context=(company='A',owner=OWNER)=>({companyId:'company-'+company,owner,connectionId:'connection-'+company,provider:'synthetic-bank',accountKey:'account-'+company,accountUid:'uid-'+company,consentId:'consent-'+company,generation:'generation-1',revision:1,validUntil:'2099-01-01T00:00:00Z',authorizationStatus:'VERIFIED',ratePolicy:{verified:true,evidenceId:'synthetic-policy',maxRequests:2,windowMs:3600000},bankgiroEnabled:false});

async function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 const db=adapter(sql),store=createCompanyBankSyncStore(db,{now:()=>AT}),value=context(),foreign=context('B','foreign-owner');
 for(const current of [value,foreign]){
  sql.prepare('INSERT INTO workspaces(owner,revision,payload,updated_at) VALUES(?,?,?,?)').run(current.owner,1,JSON.stringify({schemaVersion:1,invoices:[],transactions:[],allocations:[],imports:[]}),new Date(AT).toISOString());
  await store.bindScope({...current,evidenceId:'synthetic-binding-'+current.companyId});
  await store.setReferencePolicy({...current,companyName:'Synthetic '+current.companyId+' AB',mode:'invoice_number',evidenceId:'synthetic-reference-policy'});
  await store.register(current);
  const lease=await store.claim(current);await lease.reserveRequest();await lease.reserveRequest();
  await lease.commit({key:'same-receipt-key',sha256:'a'.repeat(64),statements:[],result:{imported:1,companyId:current.companyId},checkpoint:{from:'2026-11-01',to:'2026-11-04',complete:true}});
  await lease.finish({status:'retry',code:'PROVIDER_429',nextAttemptAt:AT+60000});
 }
 const active={...value,accountKey:'active-account',accountUid:'active-uid'};await store.register(active);const activeLease=await store.claim(active);
 const objects=new Map(),bucket={async get(path){const bytes=objects.get(path);return bytes?{arrayBuffer:async()=>bytes.slice().buffer}:null;},async put(path,bytes){objects.set(path,new Uint8Array(bytes));}};
 return {sql,db,store,value,active,activeLease,objects,bucket,snapshot:()=>({format:'MG-Sites-backup-1',owner:OWNER,createdAt:new Date(AT).toISOString(),tables:allTables.map(name=>({name,rows:sql.prepare('SELECT * FROM '+name+' WHERE owner=?').all(OWNER).map(row=>({...row}))}))})};
}
async function completed(f){let result;for(let n=0;n<5;n++){result=await backupStep(f.db,f.bucket,OWNER,KEY,new Date(AT));if(result.status==='complete')return f.sql.prepare('SELECT * FROM backup_runs WHERE owner=?').get(OWNER);assert.notEqual(result.status,'failed',result.error);}assert.fail('synthetic backup did not complete');}
async function restored(t,f){
 const run=await completed(f),entries=new Map();await exportBackupBundle(f.bucket,run,KEY,OWNER,async(path,bytes)=>entries.set(path,bytes));
 const source={list:async()=>[...entries.keys()],get:async path=>entries.get(path)?.slice()??null},verified=await verifyRecoveryBundle(source,KEY,OWNER,run.id);
 const folder=mkdtempSync(join(tmpdir(),'company-sync-backup-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const bundle=join(folder,'bundle'),output=join(folder,'output');mkdirSync(bundle,{mode:0o700});mkdirSync(join(bundle,'objects'),{mode:0o700});mkdirSync(output,{mode:0o700});
 for(const [path,bytes]of entries)writeFileSync(join(bundle,path),bytes,{mode:0o600});
 const result=await restoreBackupIsolated({bundleDirectory:bundle,outputParent:output,key:KEY,expectedOwner:OWNER,expectedBackupId:run.id}),sql=new DatabaseSync(join(result.directory,'evidence.sqlite'),{readOnly:true});t.after(()=>sql.close());
 return {sql,verified,result,receipt:JSON.parse(readFileSync(join(result.directory,'receipt.json'),'utf8'))};
}
function isolatedCoordinator(t,copy,now){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec(readFileSync(new URL('../drizzle/0023_saas_bank_sync.sql',import.meta.url),'utf8'));sql.exec('CREATE TABLE synthetic_imports(id TEXT)');
 for(const name of companyTables)for(const row of copy.sql.prepare('SELECT * FROM evidence_'+name).all()){const names=Object.keys(row);sql.prepare('INSERT INTO '+name+' ('+names.join(',')+') VALUES ('+names.map(()=>'?').join(',')+')').run(...names.map(name=>row[name]));}
 return {sql,store:createCompanyBankSyncStore(adapter(sql),{now})};
}

test('new snapshots retain all four owned company tables and never another company scope',async t=>{
 const f=await fixture(t);assert.deepEqual(BACKUP_TABLES,allTables);
 const before=f.snapshot(),run=await completed(f),snapshot=JSON.parse(new TextDecoder().decode(await unsealBackup(f.objects.get(run.snapshot_key),KEY,OWNER,run.id,'snapshot')));
 assert.equal(snapshot.tables.length,26);for(const name of companyTables)assert.deepEqual(snapshot.tables.find(row=>row.name===name).rows,before.tables.find(row=>row.name===name).rows);
 assert.equal(JSON.stringify(snapshot).includes('company-B'),false);assert.equal(JSON.stringify(snapshot).includes('foreign-owner'),false);assert.deepEqual(f.snapshot(),before);
});

for(const names of [oldTables,intermediateTables])test('exact historical '+names.length+' table snapshot remains unchanged and creates no company authority',async t=>{
 const f=await fixture(t),value=f.snapshot();value.tables=value.tables.filter(table=>names.includes(table.name));const before=structuredClone(value);
 assert.equal(validateSnapshot(value,OWNER).tables.length,names.length);assert.deepEqual(value,before);
});

for(const [label,change]of [
 ['foreign row owner',s=>{s.company_bank_sync_receipts[0].owner='foreign-owner';}],
 ['foreign receipt company',s=>{s.company_bank_sync_receipts[0].company_id='company-B';}],
 ['foreign policy company',s=>{const p=JSON.parse(s.company_bank_sync_scopes[0].reference_policy);p.companyId='company-B';s.company_bank_sync_scopes[0].reference_policy=JSON.stringify(p);}],
 ['foreign policy owner',s=>{const p=JSON.parse(s.company_bank_sync_scopes[0].reference_policy);p.owner='foreign-owner';s.company_bank_sync_scopes[0].reference_policy=JSON.stringify(p);}],
 ['missing scope',s=>{s.company_bank_sync_scopes.length=0;}],
 ['missing receipt job',s=>{s.company_bank_sync_jobs.splice(0,1);}],
 ['checkpoint without any receipt',s=>{s.company_bank_sync_receipts.length=0;}],
 ['request for another connection',s=>{s.company_bank_sync_requests[0].connection_id='another-connection';}],
 ['request for another provider',s=>{s.company_bank_sync_requests[0].provider='another-provider';}],
 ['duplicate job identity',s=>{s.company_bank_sync_jobs.push({...s.company_bank_sync_jobs[0]});}],
 ['duplicate request identity',s=>{s.company_bank_sync_requests.push({...s.company_bank_sync_requests[0]});}],
 ['duplicate receipt identity',s=>{s.company_bank_sync_receipts.push({...s.company_bank_sync_receipts[0]});}],
 ['invalid receipt hash',s=>{s.company_bank_sync_receipts[0].sha256='not-a-checksum';}],
 ['malformed receipt JSON',s=>{s.company_bank_sync_receipts[0].result='{';}],
])test('company backup rejects '+label,async t=>{
 const f=await fixture(t),value=f.snapshot(),rows=Object.fromEntries(value.tables.map(table=>[table.name,table.rows]));change(rows);
 assert.throws(()=>validateSnapshot(value,OWNER),/backup_(?:owner_mismatch|company_sync_invalid)/);
});

test('partial company table census cannot masquerade as a historical snapshot',async t=>{
 const f=await fixture(t);for(const name of companyTables){const value=f.snapshot();value.tables=value.tables.filter(table=>table.name!==name);assert.throws(()=>validateSnapshot(value,OWNER),/backup_snapshot_invalid/);}
});

test('isolated recovery retains policies, quota, receipts, checkpoint and 429 while invalidating captured leases',async t=>{
 const f=await fixture(t),before=f.snapshot(),copy=await restored(t,f);
 for(const name of ['company_bank_sync_scopes','company_bank_sync_requests','company_bank_sync_receipts'])assert.deepEqual(copy.sql.prepare('SELECT * FROM evidence_'+name).all().map(row=>({...row})),before.tables.find(table=>table.name===name).rows,name);
 const saved=before.tables.find(table=>table.name==='company_bank_sync_jobs').rows;
 for(const row of copy.sql.prepare('SELECT * FROM evidence_company_bank_sync_jobs').all()){
  const source=saved.find(item=>item.account_key===row.account_key);assert.deepEqual({...row},{...source,lease_token:'',lease_until:0,lease_deadline:0,fence_version:source.fence_version+1});
 }
 assert.deepEqual(copy.verified.snapshot.tables.find(table=>table.name==='company_bank_sync_jobs').rows,saved);
 assert.deepEqual(copy.receipt.transforms,[{table:'company_bank_sync_jobs',kind:'invalidate_job_leases',rows:2}]);
 assert.throws(()=>copy.sql.prepare('SELECT * FROM company_bank_sync_jobs').all(),/no such table/);assert.deepEqual(f.snapshot(),before);
});

test('recovered coordination evidence still enforces 429, consumed quota and receipt replay in an isolated synthetic store',async t=>{
 const f=await fixture(t),copy=await restored(t,f);let time=AT+1;const {sql,store}=isolatedCoordinator(t,copy,()=>time);
 await assert.rejects(store.claim(f.value),error=>error.code==='RETRY_NOT_DUE');
 time=AT+60001;const lease=await store.claim(f.value);await assert.rejects(lease.reserveRequest(),error=>error.code==='PROVIDER_BUDGET_EXHAUSTED');
 const result=await lease.commit({key:'same-receipt-key',sha256:'a'.repeat(64),statements:[adapter(sql).prepare('INSERT INTO synthetic_imports VALUES(?)').bind('must-not-replay')],result:{imported:99}});
 assert.equal(result.duplicate,true);assert.deepEqual(result.result,{imported:1,companyId:'company-A'});assert.equal(sql.prepare('SELECT count(*) n FROM synthetic_imports').get().n,0);
 const oldFence=f.activeLease.fence();assert.throws(()=>sql.prepare(oldFence.query).all(...oldFence.args),/malformed JSON/);
});

test('recovered unknown provider embargo remains blocked after consent renewal',async t=>{
 const f=await fixture(t);await f.activeLease.finish({status:'retry',code:'PROVIDER_429',nextAttemptAt:Infinity});
 const copy=await restored(t,f),{sql,store}=isolatedCoordinator(t,copy,()=>AT+86400000);
 const row=sql.prepare('SELECT * FROM company_bank_sync_jobs WHERE account_key=?').get(f.active.accountKey);assert.equal(row.retry_blocked,2);assert.equal(row.error_code,'RETRY_AFTER_UNKNOWN');
 const renewed={...f.active,generation:'generation-2',revision:2,consentId:'renewed-consent'};await store.register(renewed);
 await assert.rejects(store.claim(renewed),error=>error.code==='RETRY_AFTER_UNKNOWN');
 assert.equal(sql.prepare('SELECT count(*) n FROM company_bank_sync_requests WHERE account_key=?').get(f.active.accountKey).n,0);
});
