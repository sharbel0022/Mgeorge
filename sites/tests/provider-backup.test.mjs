import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createCipheriv,createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {BACKUP_TABLES,backupStep,sealBackup,unsealBackup,validateSnapshot} from '../lib/backup-engine.ts';
import {exportBackupBundle,verifyRecoveryBundle} from '../scripts/lib/backup-recovery.mjs';
import {restoreBackupIsolated} from '../scripts/restore-backup-isolated.mjs';

const legacy=['workspaces','audit_events','documents','bank_applications','bank_connections','bank_sync_runs','gmail_connections','customer_contacts','customer_messages','reconciliation_findings','customer_deliveries','gmail_sources','gmail_runs','document_automation','document_jobs','document_extractions','invoice_counterparties','document_registrations','payment_control_runs','payment_control_requests'];
const previous=[...legacy,'bankgiro_ingest_sources','bankgiro_ingest_jobs'];
const current=[...previous,'bank_provider_connections','bank_provider_grant_claims'];
const owner='synthetic-provider-backup-owner',companyId='synthetic-provider-company',id='00000000-0000-4000-8000-000000000031',documentId='00000000-0000-4000-8000-000000000032',key='6'.repeat(64),at='2026-11-04T12:00:00.000Z';
const boundary={version:'company-data-boundary-v1',companyId,storageOwner:owner,boundaryVersion:1};
const original=Buffer.from('SYNTHETIC PROVIDER ORIGINAL'),sha=value=>createHash('sha256').update(value).digest('hex');
const financial=JSON.stringify({schemaVersion:1,invoices:[{id:'invoice-31',total:62500,documentId}],transactions:[{id:'payment-31',amount:62500,currency:'SEK'}],allocations:[{id:'allocation-31',invoiceId:'invoice-31',transactionId:'payment-31',amount:62500}],credits:[{id:'old-credit',amount:500,revokedAt:at}],imports:[],receipts:[]});
// A backup retains this integration ciphertext as opaque evidence. No provider
// credential or integration codec key is needed by the recovery tool.
const cipher=createCipheriv('aes-256-gcm',Buffer.alloc(32,7),Buffer.alloc(12,8));
const encryptedState=Buffer.concat([cipher.update('SYNTHETIC_PRIVATE_PROVIDER_HANDLE'),cipher.final(),cipher.getAuthTag()]).toString('base64');
const connection=()=>({id:'provider-connection-31',owner,company_id:companyId,provider_kind:'open_payments',environment:'SANDBOX',app_generation:'synthetic-generation',bank_id:'synthetic-bank',bank_name:'Synthetic bank',status:'connected',encrypted_state:encryptedState,selected_accounts:'["synthetic-scoped-account"]',valid_until:'2026-12-04T12:00:00.000Z',revision:4,last_synced_at:at,last_error:null,request_key_hash:sha('synthetic-request'),created_at:at,updated_at:at,grant_fingerprint:sha('synthetic-current-grant')});
const claim=fingerprint=>({fingerprint,owner,company_id:companyId,connection_id:'provider-connection-31',provider_kind:'open_payments',environment:'SANDBOX',created_at:at});
const rows=(snapshot,name)=>snapshot.tables.find(table=>table.name===name).rows;
function snapshot(tables=current){
 const value={format:'MG-Sites-backup-1',owner,createdAt:at,companyBoundary:{...boundary},tables:tables.map(name=>({name,rows:[]}))};
 rows(value,'workspaces').push({owner,revision:43,payload:financial,updated_at:at});
 rows(value,'documents').push({id:documentId,owner,filename:'synthetic.txt',mime:'text/plain',size:original.length,sha256:sha(original),created_at:at});
 if(tables.includes('bank_provider_connections')){
  rows(value,'bank_provider_connections').push(connection());
  rows(value,'bank_provider_grant_claims').push(claim(sha('synthetic-current-grant')),claim(sha('synthetic-historical-grant')));
 }
 return value;
}
async function bundle(value){
 const checked=validateSnapshot(value,owner),plain=Buffer.from(JSON.stringify(checked)),prefix=`backups/${owner}/2026-11-04/${id}`;
 const objects=new Map([[prefix+'/snapshot.bin',await sealBackup(plain,key,owner,id,'snapshot')],[prefix+'/'+documentId+'.bin',await sealBackup(original,key,owner,id,'document:'+documentId)]]);
 const run={id,owner,day:'2026-11-04',state:'complete',snapshot_key:prefix+'/snapshot.bin',snapshot_hash:sha(plain),cursor:1,total_docs:1,bytes:original.length,verification_cursor:1,verified_bytes:original.length,verification_started_at:at,finished_at:at,created_at:at,api_evidence:JSON.stringify(checked.apiEvidence),lease:'',lease_until:'',last_error:''};
 const entries=new Map(),bucket={async get(path){const bytes=objects.get(path);return bytes?{arrayBuffer:async()=>bytes.slice().buffer}:null;}};
 await exportBackupBundle(bucket,run,key,owner,async(path,bytes)=>entries.set(path,bytes.slice()));
 return {entries,source:{list:async()=>[...entries.keys()],get:async path=>entries.get(path)?.slice()??null}};
}
async function rewriteBundle(entries,change){
 const value=JSON.parse(new TextDecoder().decode(await unsealBackup(entries.get('objects/snapshot.bin'),key,owner,id,'snapshot')));change(value);
 const plain=Buffer.from(JSON.stringify(value)),sealed=await sealBackup(plain,key,owner,id,'snapshot');entries.set('objects/snapshot.bin',sealed);
 const manifest=JSON.parse(new TextDecoder().decode(await unsealBackup(entries.get('manifest.bin'),key,owner,id,'recovery-manifest')));
 manifest.run.snapshot_hash=sha(plain);Object.assign(manifest.objects[0],{size:sealed.length,sha256:sha(sealed),plaintextSize:plain.length,plaintextSha256:sha(plain)});
 for(const table of manifest.tables)table.rows=rows(value,table.name).length;
 entries.set('manifest.bin',await sealBackup(Buffer.from(JSON.stringify(manifest)),key,owner,id,'recovery-manifest'));
}
function diskBundle(t,entries){
 const folder=mkdtempSync(join(tmpdir(),'mg-provider-backup-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const bundleDirectory=join(folder,'bundle'),outputParent=join(folder,'output');mkdirSync(bundleDirectory,{mode:0o700});mkdirSync(outputParent,{mode:0o700});
 for(const [path,bytes]of entries){mkdirSync(dirname(join(bundleDirectory,path)),{recursive:true,mode:0o700});writeFileSync(join(bundleDirectory,path),bytes,{mode:0o600});}
 return {bundleDirectory,outputParent};
}

test('current snapshots include both provider tables and retain every historical grant without changing financial JSON',()=>{
 assert.deepEqual(BACKUP_TABLES,current);
 const value=snapshot(),before=structuredClone(value),checked=validateSnapshot(value,owner,boundary);
 assert.deepEqual(value,before);assert.equal(checked.tables.length,24);
 assert.deepEqual(rows(checked,'bank_provider_grant_claims'),before.tables.at(-1).rows);
 assert.equal(rows(checked,'bank_provider_connections')[0].encrypted_state,encryptedState);
 assert.equal(rows(checked,'workspaces')[0].payload,financial);
});

for(const tableSet of [legacy,previous])test(`exact historical ${tableSet.length}-table snapshots retain their authenticated census`,()=>{
 const value=snapshot(tableSet),before=structuredClone(value),checked=validateSnapshot(value,owner);
 assert.equal(checked.tables.length,tableSet.length);assert.deepEqual(value,before);
 assert.equal(checked.tables.some(table=>table.name.startsWith('bank_provider_')),false);
});
for(const missing of ['bank_provider_connections','bank_provider_grant_claims'])test('partially missing provider snapshot rejects '+missing,()=>{
 const value=snapshot();value.tables=value.tables.filter(table=>table.name!==missing);
 assert.throws(()=>validateSnapshot(value,owner));
});

for(const [label,change]of [
 ['missing company boundary',value=>{delete value.companyBoundary;}],
 ['wrong boundary namespace',value=>{value.companyBoundary.companyId='synthetic-other-company';}],
 ['foreign provider company',value=>{rows(value,'bank_provider_connections')[0].company_id='synthetic-other-company';}],
 ['foreign provider owner',value=>{rows(value,'bank_provider_connections')[0].owner='synthetic-other-owner';}],
 ['missing current claim',value=>{rows(value,'bank_provider_grant_claims').shift();}],
 ['foreign historical company',value=>{rows(value,'bank_provider_grant_claims')[1].company_id='synthetic-other-company';}],
 ['foreign historical owner',value=>{rows(value,'bank_provider_grant_claims')[1].owner='synthetic-other-owner';}],
 ['missing retained connection',value=>{rows(value,'bank_provider_grant_claims')[1].connection_id='missing';}],
 ['different provider kind',value=>{rows(value,'bank_provider_grant_claims')[1].provider_kind='enable_banking';}],
 ['different provider environment',value=>{rows(value,'bank_provider_grant_claims')[1].environment='PRODUCTION';}],
 ['duplicate claim fingerprint',value=>{rows(value,'bank_provider_grant_claims').push({...rows(value,'bank_provider_grant_claims')[0]});}],
 ['duplicate connection identity',value=>{rows(value,'bank_provider_connections').push({...rows(value,'bank_provider_connections')[0]});}],
])test('provider backup fails closed for '+label,()=>{
 const value=snapshot();change(value);assert.throws(()=>validateSnapshot(value,owner));
});

test('historical grant claims remain valid after the current grant is cleared on revoke',()=>{
 const value=snapshot(),row=rows(value,'bank_provider_connections')[0];row.status='revoked';row.grant_fingerprint='';
 assert.equal(rows(validateSnapshot(value,owner),'bank_provider_grant_claims').length,2);
});

test('provider backup ciphertext rejects tampering before evidence recovery',async()=>{
 const {entries,source}=await bundle(snapshot());entries.get('objects/snapshot.bin')[60]^=1;
 await assert.rejects(()=>verifyRecoveryBundle(source,key,owner,id,{expectedCompanyBoundary:boundary}),/backup_recovery_/);
});

for(const tableSet of [legacy,previous,current])test(`${tableSet.length}-table bundle restores exact encrypted evidence with empty authority and callback tables`,async t=>{
 const value=snapshot(tableSet),{entries}=await bundle(value),paths=diskBundle(t,entries);
 assert.equal([...entries.values()].some(bytes=>Buffer.from(bytes).includes(Buffer.from('SYNTHETIC_PRIVATE_PROVIDER_HANDLE'))),false);
 const result=await restoreBackupIsolated({...paths,key,expectedOwner:owner,expectedBackupId:id,expectedCompanyBoundary:boundary});
 const sql=new DatabaseSync(join(result.directory,'evidence.sqlite'),{readOnly:true});
 try{
  assert.equal(sql.prepare('SELECT payload FROM evidence_workspaces').get().payload,financial);
  assert.deepEqual(readFileSync(join(result.directory,'originals',documentId+'.bin')),original);
  for(const name of ['companies','company_memberships','company_roles','company_user_contexts','company_worker_grants','company_operation_guard','bank_auth_flows','bank_locks','gmail_flows','gmail_locks'])assert.equal(sql.prepare('SELECT count(*) n FROM evidence_'+name).get().n,0,name);
  assert.equal(sql.prepare("SELECT count(*) n FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'evidence_%' AND name NOT LIKE 'sqlite_%'").get().n,0);
  assert.equal(sql.prepare('SELECT count(*) n FROM evidence_bank_provider_connections').get().n,tableSet===current?1:0);
  assert.equal(sql.prepare('SELECT count(*) n FROM evidence_bank_provider_grant_claims').get().n,tableSet===current?2:0);
  if(tableSet===current){
   assert.deepEqual({...sql.prepare('SELECT * FROM evidence_bank_provider_connections').get()},connection());
   assert.deepEqual(sql.prepare('SELECT * FROM evidence_bank_provider_grant_claims ORDER BY fingerprint').all().map(row=>({...row})),rows(value,'bank_provider_grant_claims').sort((a,b)=>a.fingerprint.localeCompare(b.fingerprint)));
   for(const name of ['company_provider_bank_provider_connections_insert','company_provider_bank_provider_grant_claims_insert','bank_provider_claim_immutable','bank_provider_claim_retained','bank_provider_identity_immutable','bank_provider_revision_fence'])assert.ok(sql.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?").get(name),name);
  }
  const receipt=JSON.parse(readFileSync(join(result.directory,'receipt.json'),'utf8'));
  assert.equal(receipt.mode,'evidence-only');assert.equal(receipt.tables.length,tableSet.length);assert.deepEqual(receipt.companyBoundary,boundary);
 }finally{sql.close();}
});

for(const [label,change]of [
 ['foreign historical namespace',value=>{rows(value,'bank_provider_grant_claims')[1].company_id='synthetic-other-company';}],
 ['missing current claim',value=>rows(value,'bank_provider_grant_claims').shift()],
])test('isolated restore rejects authenticated provider evidence with '+label+' before creating output',async t=>{
 const {entries}=await bundle(snapshot());await rewriteBundle(entries,change);const paths=diskBundle(t,entries);
 await assert.rejects(()=>restoreBackupIsolated({...paths,key,expectedOwner:owner,expectedBackupId:id,expectedCompanyBoundary:boundary}),/backup_recovery_/);
 assert.deepEqual(readdirSync(paths.outputParent),[]);
});

for(const generation of ['before-consent','before-fingerprint','partial-current'])test('historical bank connection evidence restores only an exact additive schema generation: '+generation,async t=>{
 const sql=new DatabaseSync(':memory:');let row;
 try{
  for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  sql.prepare('INSERT INTO bank_connections(id,owner,app_generation,environment,bank_name,country,encrypted_session,encrypted_accounts,selected_accounts,valid_until,date_from,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('legacy-bank',owner,'synthetic-generation','test','Synthetic bank','SE','synthetic-sealed-session','synthetic-sealed-accounts','[]',at,'2026-01-01','connected',at,at);
  row={...sql.prepare('SELECT * FROM bank_connections').get()};
 }finally{sql.close();}
 if(generation==='before-consent'){delete row.consent_metadata;delete row.session_fingerprint;}
 if(generation==='before-fingerprint')delete row.session_fingerprint;
 if(generation==='partial-current')delete row.consent_metadata;
 const value=snapshot(previous);rows(value,'bank_connections').push(row);const {entries}=await bundle(value),paths=diskBundle(t,entries);
 const restore=()=>restoreBackupIsolated({...paths,key,expectedOwner:owner,expectedBackupId:id,expectedCompanyBoundary:boundary});
 if(generation==='partial-current'){await assert.rejects(restore,/backup_recovery_/);assert.deepEqual(readdirSync(paths.outputParent),[]);return;}
 const result=await restore(),recovered=new DatabaseSync(join(result.directory,'evidence.sqlite'),{readOnly:true});
 try{assert.deepEqual({...recovered.prepare('SELECT * FROM evidence_bank_connections').get()},{...row,consent_metadata:row.consent_metadata??'',session_fingerprint:''});}finally{recovered.close();}
});

test('isolated restore cannot publish a receipt when a retained provider trigger disappears during disk readback',async t=>{
 const {entries}=await bundle(snapshot()),paths=diskBundle(t,entries),prepare=DatabaseSync.prototype.prepare;let changed=false;
 t.mock.method(DatabaseSync.prototype,'prepare',function(query,...args){
  const statement=prepare.call(this,query,...args);
  if(query!=='VACUUM INTO ?')return statement;
  return {run(path){const result=statement.run(path),written=new DatabaseSync(path);try{written.exec('DROP TRIGGER bank_provider_claim_immutable');changed=true;}finally{written.close();}return result;}};
 });
 await assert.rejects(()=>restoreBackupIsolated({...paths,key,expectedOwner:owner,expectedBackupId:id,expectedCompanyBoundary:boundary}),/backup_recovery_/);
 assert.equal(changed,true);
 for(const output of readdirSync(paths.outputParent))assert.equal(readdirSync(join(paths.outputParent,output)).includes('receipt.json'),false);
});

test('real owner-scoped backup captures both provider tables and excludes another company and transient flow state',async t=>{
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const insert=(name,row)=>{const keys=Object.keys(row);sql.prepare(`INSERT INTO ${name} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(key=>row[key]));};
 for(const [storageOwner,company]of [[owner,companyId],['synthetic-other-owner','synthetic-other-company']]){
  insert('companies',{id:company,name:'Synthetic company',storage_owner:storageOwner,ownership_verified_by:'synthetic-operator',ownership_evidence:'synthetic-admission',ownership_verified_at:at,created_at:at,updated_at:at});
 }
 const value=snapshot();
 for(const [storageOwner,company]of [[owner,companyId],['synthetic-other-owner','synthetic-other-company']]){
  insert('company_memberships',{company_id:company,actor_id:storageOwner,role:'admin',created_at:at,updated_at:at});
  insert('company_operation_guard',{slot:1,storage_owner:storageOwner,company_id:company,actor_id:storageOwner,context_version:1,membership_version:1,action:'manage_integrations',authorized:1});
  if(storageOwner===owner)for(const table of value.tables)for(const row of table.rows)insert(table.name,row);
  else{
   insert('bank_provider_connections',{...connection(),id:'other-provider-connection',owner:storageOwner,company_id:company,request_key_hash:sha('other-request'),grant_fingerprint:sha('other-grant')});
   insert('bank_provider_grant_claims',{...claim(sha('other-grant')),owner:storageOwner,company_id:company,connection_id:'other-provider-connection'});
  }
  sql.exec('DELETE FROM company_operation_guard');
 }
 const objects=new Map([[owner+'/'+documentId,new Uint8Array(original)]]),bucket={async get(path){const bytes=objects.get(path);return bytes?{arrayBuffer:async()=>bytes.slice().buffer}:null;},async put(path,bytes){objects.set(path,bytes.slice());}};
 const db={prepare(query){let args=[];return {bind(...values){args=values;return this;},async first(){return sql.prepare(query).get(...args)??null;},async run(){return {meta:{changes:sql.prepare(query).run(...args).changes}};},async all(){return {results:sql.prepare(query).all(...args)};}};},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.all());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 // The production scoped database wrapper supplies this effect-boundary guard.
 insert('company_operation_guard',{slot:1,storage_owner:owner,company_id:companyId,actor_id:owner,context_version:1,membership_version:1,action:'read',authorized:1});
 let result;for(let n=0;n<5;n++){result=await backupStep(db,bucket,owner,key,new Date(at),5,{companyBoundary:boundary});assert.notEqual(result.status,'failed',result.error);if(result.status==='complete')break;}
 assert.equal(result.status,'complete');
 const run=sql.prepare('SELECT * FROM backup_runs WHERE owner=?').get(owner),plain=await unsealBackup(objects.get(run.snapshot_key),key,owner,run.id,'snapshot'),saved=JSON.parse(new TextDecoder().decode(plain));
 assert.equal(saved.tables.length,24);assert.deepEqual(rows(saved,'bank_provider_connections'),[connection()]);assert.deepEqual(rows(saved,'bank_provider_grant_claims'),rows(value,'bank_provider_grant_claims'));
 assert.equal(saved.tables.some(table=>table.name==='bank_auth_flows'||table.name.startsWith('company_')),false);
 assert.equal(Buffer.from(plain).includes(Buffer.from('synthetic-other-owner')),false);
 assert.equal(rows(saved,'workspaces')[0].payload,financial);
});
