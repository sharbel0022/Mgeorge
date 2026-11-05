import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync,symlinkSync,renameSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {BACKUP_TABLES,backupStep,unsealBackup,sealBackup} from '../lib/backup-engine.ts';
import {accountReadCooldown} from '../lib/banking/account-read-cooldown.ts';

const owner='synthetic-isolated-recovery-owner',key='5'.repeat(64),at=new Date('2026-11-02T12:00:00Z');
const uuid=index=>`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function recovery(){
 try{return await import('../scripts/lib/backup-recovery.mjs');}
 catch(error){if(error.code==='ERR_MODULE_NOT_FOUND')assert.fail('The read-only authenticated Sites recovery implementation is missing');throw error;}
}
function database(){
 const sql=new DatabaseSync(':memory:');
 for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 return sql;
}
function insert(sql,name,row){const keys=Object.keys(row);sql.prepare(`INSERT INTO ${name} (${keys.map(k=>'"'+k+'"').join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]));}
function fixture(t,count=7){
 const sql=database();t.after(()=>sql.close());const objects=new Map(),puts=[],gets=[];
 const bucket={async get(path){gets.push(path);const bytes=objects.get(path);return bytes?{async arrayBuffer(){return bytes.slice().buffer;}}:null;},async put(path,bytes){puts.push(path);objects.set(path,new Uint8Array(bytes));}};
 const db={prepare(query){let args=[];return{bind(...values){args=values;return this;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return{results:sql.prepare(query).all(...args)};},async run(){return{meta:{changes:sql.prepare(query).run(...args).changes}};}};},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.all());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 const documents=Array.from({length:count},(_,n)=>({id:uuid(n),bytes:Buffer.from('%PDF-Synthetic recovery original '+n)}));
 const state={schemaVersion:1,invoices:[{id:'invoice',number:'SYNTHETIC-01',party:'Synthetic recovery customer',total:62500,documentId:uuid(0)}],transactions:[{id:'payment',amount:62500,currency:'SEK',bankDetails:{documentId:uuid(1)}}],allocations:[{id:'allocation',invoiceId:'invoice',transactionId:'payment',amount:62500}],credits:[{id:'historical-credit',amount:500,revokedAt:at.toISOString()}],imports:[{id:'report',documentId:uuid(2),hash:sha(documents[2].bytes)}],receipts:[],bankgiroLinks:[{id:'revoked-link',documentId:uuid(2),sha256:sha(documents[2].bytes),revokedAt:at.toISOString()}]};
 insert(sql,'workspaces',{owner,revision:42,payload:JSON.stringify(state),updated_at:at.toISOString()});
 insert(sql,'workspaces',{owner:'another-synthetic-owner',revision:1,payload:JSON.stringify({...state,private:'OTHER_OWNER_PRIVATE'}),updated_at:at.toISOString()});
 for(const document of documents){insert(sql,'documents',{id:document.id,owner,filename:'synthetic.pdf',mime:'application/pdf',size:document.bytes.length,sha256:sha(document.bytes),created_at:at.toISOString()});objects.set(owner+'/'+document.id,new Uint8Array(document.bytes));}
 const rows={
  audit_events:{id:'audit',revision:41,action:'invoice.save',detail:JSON.stringify({command:{type:'invoice.save',invoice:{documentId:uuid(2)}},automatic:[]}),created_at:at.toISOString()},
  bank_applications:{application_id:'synthetic-app',encrypted_key:'synthetic-encrypted-key',metadata:'{}',generation:'generation',created_at:at.toISOString(),updated_at:at.toISOString()},
  bank_connections:{id:'connection',app_generation:'generation',environment:'test',bank_name:'Synthetic bank',country:'SE',encrypted_session:'synthetic-encrypted-session',encrypted_accounts:'synthetic-encrypted-accounts',selected_accounts:'[]',valid_until:at.toISOString(),date_from:'2026-01-01',status:'connected',account_evidence_retry:JSON.stringify({status:'unknown',checkedAt:at.toISOString(),provenance:'retry_after_missing'}),auto_sync_enabled:1,created_at:at.toISOString(),updated_at:at.toISOString()},
  bank_sync_runs:{id:'bank-run',connection_id:'connection',imported:1,skipped:0,warnings:'[]',test:1,created_at:at.toISOString()},
  gmail_connections:{email:'synthetic@example.invalid',tokens:'synthetic-encrypted-tokens'},
  customer_contacts:{invoice_id:'invoice',email:'synthetic@example.invalid',identity:'identity',evidence:'{}',updated_at:at.toISOString()},
  customer_messages:{id:'message',invoice_id:'invoice',kind:'receipt',recipient:'synthetic@example.invalid',subject:'Synthetic',body:'Synthetic',snapshot:'synthetic-snapshot',created_at:at.toISOString(),updated_at:at.toISOString()},
  reconciliation_findings:{id:'finding',invoice_id:'invoice',transaction_id:'payment',kind:'manual',details:'{}',created_at:at.toISOString()},
  customer_deliveries:{id:'delivery',message_id:'message',review_id:'review',version:1,snapshot:'synthetic-snapshot',recipient:'synthetic@example.invalid',subject:'Synthetic',body:'Synthetic',status:'sent',rfc_message_id:'synthetic-rfc-id',approved_at:at.toISOString(),sent_at:at.toISOString()},
  gmail_sources:{source_id:'source',document_id:uuid(0),metadata:'{}',status:'registered',created_at:at.toISOString()},
  gmail_runs:{id:'gmail-run',found:1,imported:1,duplicates:0,status:'complete',created_at:at.toISOString()},
  document_automation:{email:'synthetic@example.invalid',enabled:1,auto_register:1,updated_at:at.toISOString()},
  document_jobs:{document_id:uuid(0),state:'completed',available_at:at.toISOString(),invoice_id:'invoice',automatic:1,updated_at:at.toISOString()},
  document_extractions:{id:'extraction',document_id:uuid(0),result:JSON.stringify({processing:{sha256:sha(documents[0].bytes)}}),created_at:at.toISOString()},
  invoice_counterparties:{identity:'identity',email:'synthetic@example.invalid',evidence:'{}',verified_at:at.toISOString()},
  document_registrations:{document_id:uuid(0),identity:'identity',invoice_id:'invoice',attempt:'attempt',total:62500,created_at:at.toISOString()},
  payment_control_runs:{id:'control',status:'complete',steps:'[]',started_at:at.toISOString(),finished_at:at.toISOString(),updated_at:at.toISOString()},
  payment_control_requests:{request_id:'request',run_id:'control',created_at:at.toISOString()},
  saas_bank_state:{revision:1,payload:'synthetic-encrypted-consent-state'},
  bankgiro_ingest_sources:{source_id:'synthetic-source',scope_id:'synthetic-scope',authorization_generation:'synthetic-generation',cursor:'delivery-2',updated_at:at.getTime()},
  bankgiro_ingest_jobs:{id:'synthetic-report-job',source_id:'synthetic-source',scope_id:'synthetic-scope',report_id:'0000599',sha256:sha(documents[2].bytes),filename:'synthetic.xml',authorization_generation:'synthetic-generation',document_id:uuid(2),status:'REVIEW',created_at:at.getTime(),updated_at:at.getTime()},
  company_bank_sync_scopes:{company_id:'synthetic-company',evidence_id:'synthetic-company-binding',reference_policy:JSON.stringify({companyId:'synthetic-company',owner,revision:1,companyName:'Synthetic recovery AB',mode:'invoice_number',evidenceId:'synthetic-policy'}),created_at:at.getTime()},
  company_bank_sync_jobs:{company_id:'synthetic-company',account_key:'synthetic-account',provider:'synthetic-bank',connection_id:'connection',authority_hash:'a'.repeat(64),generation_hash:'b'.repeat(64),authority_revision:1,valid_until:at.getTime()+86400000,lease_token:'synthetic-former-worker',lease_until:at.getTime()+60000,lease_deadline:at.getTime()+90000,fence_version:4,status:'retry',next_attempt_at:at.getTime()+60000,error_code:'PROVIDER_429',checkpoint:'{"cursor":"synthetic-page"}'},
  company_bank_sync_requests:{id:'synthetic-company-request',company_id:'synthetic-company',account_key:'synthetic-account',connection_id:'connection',provider:'synthetic-bank',reserved_at:at.getTime()},
  company_bank_sync_receipts:{company_id:'synthetic-company',account_key:'synthetic-account',receipt_key:'synthetic-page',sha256:'c'.repeat(64),result:'{"imported":1}',committed_at:at.getTime()},
 };
 for(const [name,row]of Object.entries(rows))insert(sql,name,{owner,...row});
 insert(sql,'bank_locks',{owner,token:'synthetic-live-lock',expires_at:at.toISOString()});
 return{sql,db,bucket,objects,puts,gets,documents,state,row:()=>sql.prepare('SELECT * FROM backup_runs WHERE owner=?').get(owner)};
}
async function complete(f){for(let i=0;i<20;i++){const result=await backupStep(f.db,f.bucket,owner,key,at);if(result.status==='complete')return result;assert.notEqual(result.status,'failed',result.error);}assert.fail('backup did not complete');}
function source(entries){return{async list(){return [...entries.keys()];},async get(path){return entries.get(path)?.slice()||null;}};}
async function exported(f){const api=await recovery(),entries=new Map();await api.exportBackupBundle(f.bucket,f.row(),key,owner,async(path,bytes)=>{assert.equal(entries.has(path),false);entries.set(path,bytes.slice());});return entries;}

test('authenticated export retains every durable table, historical original and revoked reference without writes to source',async t=>{
 const f=fixture(t);await complete(f);const before=JSON.stringify(BACKUP_TABLES.map(name=>f.sql.prepare(`SELECT * FROM ${name} WHERE owner=?`).all(owner))),originals=new Map([...f.objects].map(([path,bytes])=>[path,bytes.slice()])),puts=f.puts.length;
 const api=await recovery(),entries=await exported(f),result=await api.verifyRecoveryBundle(source(entries),key,owner,f.row().id);
 assert.equal(result.manifest.run.id,f.row().id);assert.equal(result.manifest.run.state,'complete');assert.equal(result.manifest.tables.length,BACKUP_TABLES.length);
 assert.deepEqual(result.manifest.tables.map(table=>[table.name,table.rows]),BACKUP_TABLES.map(name=>[name,name==='documents'?7:1]));
 assert.equal(result.snapshot.tables.find(table=>table.name==='workspaces').rows[0].payload,JSON.stringify(f.state));
 assert.equal(result.snapshot.tables.find(table=>table.name==='bank_connections').rows[0].account_evidence_retry,f.sql.prepare('SELECT account_evidence_retry FROM bank_connections').get().account_evidence_retry);
 assert.equal(result.manifest.objects.length,8);assert.equal(entries.size,10);
 assert.equal([...entries.values()].some(bytes=>Buffer.from(bytes).includes(Buffer.from('Synthetic recovery customer'))),false);
 assert.equal(f.puts.length,puts);assert.deepEqual(f.objects,originals);
 assert.equal(JSON.stringify(BACKUP_TABLES.map(name=>f.sql.prepare(`SELECT * FROM ${name} WHERE owner=?`).all(owner))),before);
});

for(const [label,change]of [
 ['unfinished copy',row=>{row.state='running';}],
 ['legacy copy-only verification',row=>{row.verification_started_at='';}],
 ['incomplete verification',row=>{row.verification_cursor--;}],
 ['wrong document census',row=>{row.total_docs++;}],
 ['wrong byte census',row=>{row.bytes++;row.verified_bytes++;}],
 ['different owner',row=>{row.owner='another-synthetic-owner';}],
 ['different run directory',row=>{row.snapshot_key=row.snapshot_key.replace(row.id,uuid(999));}],
 ['active worker lease',row=>{row.lease='still-active';}],
 ['API evidence census mismatch',row=>{row.api_evidence=JSON.stringify({version:'retained-api-receipts-v1',scope:'retained_json_checksums',records_checked:99,records_without_receipt:0});}],
])test('read-only inspection rejects '+label,async t=>{
 const f=fixture(t);await complete(f);const row={...f.row()};change(row);const writes=f.puts.length,api=await recovery();
 await assert.rejects(()=>api.inspectBackup(f.bucket,row,key,owner),/backup_recovery_/);
 assert.equal(f.puts.length,writes);
});

async function changeManifest(entries,backupId,change){
 const bytes=await unsealBackup(entries.get('manifest.bin'),key,owner,backupId,'recovery-manifest'),manifest=JSON.parse(new TextDecoder().decode(bytes));
 change(manifest);entries.set('manifest.bin',await sealBackup(new TextEncoder().encode(JSON.stringify(manifest)),key,owner,backupId,'recovery-manifest'));
}
for(const [label,change]of [
 ['duplicate object',manifest=>{manifest.objects.push({...manifest.objects[1]});}],
 ['missing declared original',manifest=>{manifest.objects.pop();}],
 ['extra declared original',manifest=>{manifest.objects.push({...manifest.objects[1],path:'objects/'+uuid(100)+'.bin'});}],
 ['duplicate table census',manifest=>{manifest.tables[1]={...manifest.tables[0]};}],
 ['incorrect table row count',manifest=>{manifest.tables[0].rows++;}],
 ['incorrect object length',manifest=>{manifest.objects[1].size++;}],
 ['incorrect object checksum',manifest=>{manifest.objects[1].sha256='a'.repeat(64);}],
 ['incorrect plaintext checksum',manifest=>{manifest.objects[1].plaintextSha256='a'.repeat(64);}],
 ['incorrect plaintext length',manifest=>{manifest.objects[1].plaintextSize++;}],
 ['unsafe object pathname',manifest=>{manifest.objects[1].path='../outside.bin';}],
 ['foreign original source prefix',manifest=>{manifest.objects[1].sourceKey='backups/another-owner/foreign.bin';}],
 ['owner disagreement',manifest=>{manifest.owner='another-synthetic-owner';}],
 ['backup ID disagreement',manifest=>{manifest.backupId=uuid(999);}],
 ['snapshot metadata disagreement',manifest=>{manifest.run.snapshot_hash='a'.repeat(64);}],
])test('authenticated but inconsistent manifest rejects '+label,async t=>{
 const f=fixture(t);await complete(f);const api=await recovery(),entries=await exported(f);await changeManifest(entries,f.row().id,change);
 await assert.rejects(()=>api.verifyRecoveryBundle(source(entries),key,owner,f.row().id),/backup_recovery_/);
});

for(const damage of ['missing original','corrupt original','swapped originals','extra file','duplicate file census','wrong key','wrong owner','wrong run','corrupt manifest'])test('portable bundle rejects '+damage,async t=>{
 const f=fixture(t);await complete(f);const api=await recovery(),entries=await exported(f);let input=source(entries),candidateKey=key,candidateOwner=owner,candidateId=f.row().id;
 if(damage==='missing original')entries.delete('objects/'+uuid(0)+'.bin');
 if(damage==='corrupt original')entries.get('objects/'+uuid(0)+'.bin')[45]^=1;
 if(damage==='swapped originals')entries.set('objects/'+uuid(0)+'.bin',entries.get('objects/'+uuid(1)+'.bin'));
 if(damage==='extra file')entries.set('objects/'+uuid(99)+'.bin',new Uint8Array([1]));
 if(damage==='duplicate file census')input={...input,async list(){return [...entries.keys(),'objects/'+uuid(0)+'.bin'];}};
 if(damage==='wrong key')candidateKey='6'.repeat(64);
 if(damage==='wrong owner')candidateOwner='another-synthetic-owner';
 if(damage==='wrong run')candidateId=uuid(999);
 if(damage==='corrupt manifest')entries.get('manifest.bin')[45]^=1;
 await assert.rejects(()=>api.verifyRecoveryBundle(input,candidateKey,candidateOwner,candidateId),/backup_recovery_/);
});

test('interrupted export never emits a complete bundle marker or changes original storage',async t=>{
 const f=fixture(t);await complete(f);const api=await recovery(),entries=new Map(),before=new Map([...f.objects].map(([path,bytes])=>[path,bytes.slice()]));let count=0;
 await assert.rejects(()=>api.exportBackupBundle(f.bucket,f.row(),key,owner,async(path,bytes)=>{if(++count===3)throw Error('synthetic export interruption');entries.set(path,bytes.slice());}),/synthetic export interruption/);
 assert.equal(entries.has('bundle.json'),false);assert.deepEqual(f.objects,before);
 const repaired=await exported(f);assert.equal((await api.verifyRecoveryBundle(source(repaired),key,owner,f.row().id)).manifest.run.total_docs,7);
});

test('export checks the inspected ciphertext again before publishing its completion marker',async t=>{
 const f=fixture(t);await complete(f);const api=await recovery(),entries=new Map(),path=f.row().snapshot_key.replace('snapshot.bin',uuid(1)+'.bin');
 await assert.rejects(()=>api.exportBackupBundle(f.bucket,f.row(),key,owner,async(name,bytes)=>{entries.set(name,bytes.slice());if(name==='objects/snapshot.bin')f.objects.get(path)[45]^=1;}),/backup_recovery_/);
 assert.equal(entries.has('bundle.json'),false);
});

async function isolated(){
 try{return await import('../scripts/restore-backup-isolated.mjs');}
 catch(error){if(error.code==='ERR_MODULE_NOT_FOUND')assert.fail('The fresh-directory Sites evidence restore tool is missing');throw error;}
}
function diskBundle(t,entries){
 const folder=mkdtempSync(join(tmpdir(),'mg-sites-recovery-test-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const bundleDirectory=join(folder,'bundle'),outputParent=join(folder,'output');mkdirSync(bundleDirectory,{mode:0o700});mkdirSync(outputParent,{mode:0o700});
 for(const [path,bytes]of entries){mkdirSync(dirname(join(bundleDirectory,path)),{recursive:true,mode:0o700});writeFileSync(join(bundleDirectory,path),bytes,{flag:'wx',mode:0o600});}
 return{folder,bundleDirectory,outputParent};
}
const sortedRows=rows=>rows.map(row=>({...row})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
const restoredRows=(sql,name)=>sortedRows(sql.prepare(`SELECT * FROM "evidence_${name}"`).all());
test('a resumed interrupted backup restores every exact financial row and original into a real isolated SQLite evidence database',async t=>{
 const f=fixture(t),expected=BACKUP_TABLES.map(name=>({name,rows:sortedRows(f.sql.prepare(`SELECT * FROM ${name} WHERE owner=?`).all(owner))}));
 assert.equal((await backupStep(f.db,f.bucket,owner,key,at,2)).copied,2);
 const frozen=f.row().snapshot_key;let interrupt=true;
 const bucket={...f.bucket,async get(path){if(interrupt&&path===owner+'/'+uuid(3))throw Error('synthetic interrupted original read');return f.bucket.get(path);}};
 const failed=await backupStep(f.db,bucket,owner,key,at,2);assert.equal(failed.status,'failed');assert.equal(failed.copied,3);interrupt=false;
 f.sql.prepare("UPDATE backup_runs SET lease='synthetic-expired-worker',lease_until='2000-01-01T00:00:00.000Z' WHERE owner=?").run(owner);
 await complete(f);assert.equal(f.row().snapshot_key,frozen);assert.equal(f.row().attempts,2);
 const entries=await exported(f),paths=diskBundle(t,entries),api=await isolated(),sourceBefore=new Map([...f.objects].map(([path,bytes])=>[path,bytes.slice()]));
 const sentinel=join(paths.outputParent,'existing-production.sqlite');writeFileSync(sentinel,'must remain untouched');
 const result=await api.restoreBackupIsolated({...paths,key,expectedOwner:owner,expectedBackupId:f.row().id});
 assert.equal(dirname(result.directory),paths.outputParent);assert.match(result.directory,/mg-sites-evidence-/);
 assert.equal(readFileSync(sentinel,'utf8'),'must remain untouched');
 const restored=new DatabaseSync(join(result.directory,'evidence.sqlite'),{readOnly:true});
 try{
  for(const table of expected){const rows=table.name==='company_bank_sync_jobs'?table.rows.map(row=>({...row,lease_token:'',lease_until:0,lease_deadline:0,fence_version:row.fence_version+1})):table.rows;assert.deepEqual(restoredRows(restored,table.name),rows,table.name+' authenticated rows with explicit lease invalidation');}
  const guard=restored.prepare('SELECT account_evidence_retry FROM evidence_bank_connections').get().account_evidence_retry;
  assert.equal(JSON.parse(guard).status,'unknown');assert.equal(accountReadCooldown(guard,at.getTime()+30*86400_000).blocked,true,'a restored unknown bank wait cannot expire as a generic retry');
  assert.throws(()=>restored.prepare('SELECT * FROM workspaces').all(),/no such table/);
  assert.equal(restored.prepare('SELECT COUNT(*) n FROM evidence_bank_locks').get().n,0);
  assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(restored.prepare('PRAGMA foreign_key_check').all().length,0);
  const state=JSON.parse(restored.prepare('SELECT payload FROM evidence_workspaces').get().payload);assert.equal(state.allocations[0].amount,62500);assert.equal(state.credits[0].amount,500);assert.ok(state.bankgiroLinks[0].revokedAt);
 }finally{restored.close();}
 for(const document of f.documents){const restored=readFileSync(join(result.directory,'originals',document.id+'.bin'));assert.deepEqual(restored,document.bytes);assert.equal(sha(restored),sha(document.bytes));}
 assert.deepEqual(readFileSync(join(result.directory,'source','snapshot.bin')),Buffer.from(entries.get('objects/snapshot.bin')));
 assert.deepEqual(readFileSync(join(result.directory,'source','manifest.bin')),Buffer.from(entries.get('manifest.bin')));
 const receipt=JSON.parse(readFileSync(join(result.directory,'receipt.json'),'utf8'));assert.equal(receipt.mode,'evidence-only');assert.equal(receipt.originals.count,7);assert.equal(receipt.tables.length,BACKUP_TABLES.length);assert.deepEqual(receipt.transforms,[{table:'company_bank_sync_jobs',kind:'invalidate_job_leases',rows:1}]);assert.equal(receipt.databaseSha256,sha(readFileSync(join(result.directory,'evidence.sqlite'))));assert.equal(JSON.stringify(receipt).includes(key),false);
 if(process.platform!=='win32'){assert.equal(statSync(result.directory).mode&0o077,0);assert.equal(statSync(join(result.directory,'evidence.sqlite')).mode&0o077,0);}
 assert.deepEqual(f.objects,sourceBefore);for(const table of expected)assert.deepEqual(sortedRows(f.sql.prepare(`SELECT * FROM ${table.name} WHERE owner=?`).all(owner)),table.rows);
});

async function rewriteSnapshot(entries,id,change){
 const before=entries.get('objects/snapshot.bin'),snapshot=JSON.parse(new TextDecoder().decode(await unsealBackup(before,key,owner,id,'snapshot')));
 change(snapshot);const plain=new TextEncoder().encode(JSON.stringify(snapshot)),sealed=await sealBackup(plain,key,owner,id,'snapshot');entries.set('objects/snapshot.bin',sealed);
 await changeManifest(entries,id,manifest=>{manifest.run.snapshot_hash=sha(plain);Object.assign(manifest.objects[0],{size:sealed.length,sha256:sha(sealed),plaintextSize:plain.length,plaintextSha256:sha(plain)});manifest.tables.forEach(table=>{const found=snapshot.tables.find(t=>t.name===table.name);if(found)table.rows=found.rows.length;});});
}
for(const [label,change]of [
 ['unknown SQL column',snapshot=>{snapshot.tables[0].rows[0]['unsafe_column); DROP TABLE documents; --']='synthetic';}],
 ['missing stored column',snapshot=>{delete snapshot.tables[0].rows[0].updated_at;}],
 ['incorrect SQLite type',snapshot=>{snapshot.tables[0].rows[0].revision='42';}],
 ['duplicate durable primary key',snapshot=>{const table=snapshot.tables.find(table=>table.name==='audit_events');table.rows.push({...table.rows[0]});}],
 ['unknown table',snapshot=>{snapshot.tables[0].name='unexpected';}],
])test('isolated restore refuses '+label+' before creating output',async t=>{
 const f=fixture(t);await complete(f);const entries=await exported(f);await rewriteSnapshot(entries,f.row().id,change);const paths=diskBundle(t,entries),api=await isolated();
 await assert.rejects(()=>api.restoreBackupIsolated({...paths,key,expectedOwner:owner,expectedBackupId:f.row().id}),/backup_recovery_/);assert.deepEqual(readdirSync(paths.outputParent),[]);
});

for(const target of ['bundle directory','manifest','snapshot','original','objects directory','output parent'])test('isolated restore refuses a symlink at '+target+' before creating output',async t=>{
 const f=fixture(t);await complete(f);const paths=diskBundle(t,await exported(f)),api=await isolated();
 const path=target==='bundle directory'?paths.bundleDirectory:target==='manifest'?join(paths.bundleDirectory,'manifest.bin'):target==='snapshot'?join(paths.bundleDirectory,'objects/snapshot.bin'):target==='original'?join(paths.bundleDirectory,'objects',uuid(0)+'.bin'):target==='objects directory'?join(paths.bundleDirectory,'objects'):paths.outputParent;
 const retained=join(paths.folder,'retained-'+target.replaceAll(' ','-')),type=statSync(path).isDirectory()?'dir':'file';renameSync(path,retained);
 try{symlinkSync(retained,path,type);}catch(error){if(process.platform==='win32'&&error.code==='EPERM'){t.skip('Windows denied creation of the actual symbolic-link fixture');return;}throw error;}
 await assert.rejects(()=>api.restoreBackupIsolated({...paths,key,expectedOwner:owner,expectedBackupId:f.row().id}),/backup_recovery_/);
 assert.deepEqual(readdirSync(target==='output parent'?retained:paths.outputParent),[]);assert.equal(existsSync(retained),true);
});

test('an extra or missing input file cannot produce an output directory',async t=>{
 const f=fixture(t);await complete(f);const entries=await exported(f);entries.set('unexpected.bin',new Uint8Array([1,2,3]));const paths=diskBundle(t,entries),api=await isolated();
 await assert.rejects(()=>api.restoreBackupIsolated({...paths,key,expectedOwner:owner,expectedBackupId:f.row().id}),/backup_recovery_/);assert.deepEqual(readdirSync(paths.outputParent),[]);
 rmSync(join(paths.bundleDirectory,'unexpected.bin'));rmSync(join(paths.bundleDirectory,'objects',uuid(0)+'.bin'));
 await assert.rejects(()=>api.restoreBackupIsolated({...paths,key,expectedOwner:owner,expectedBackupId:f.row().id}),/backup_recovery_/);assert.deepEqual(readdirSync(paths.outputParent),[]);
});

test('the command line restores a bundle with an environment key and never prints the key',async t=>{
 const f=fixture(t);await complete(f);const paths=diskBundle(t,await exported(f));await isolated();
 const child=spawnSync(process.execPath,['--experimental-strip-types',fileURLToPath(new URL('../scripts/restore-backup-isolated.mjs',import.meta.url)),paths.bundleDirectory,paths.outputParent,owner,f.row().id],{encoding:'utf8',env:{...process.env,MG_SITES_RECOVERY_KEY:key}});
 assert.ifError(child.error);assert.equal(child.status,0,child.stderr);assert.equal((child.stdout+child.stderr).includes(key),false);const result=JSON.parse(child.stdout);assert.equal(result.mode,'evidence-only');assert.equal(existsSync(join(result.directory,'evidence.sqlite')),true);
});

async function filesystemFaults(changes,run){
 const original={};for(const [name,change]of Object.entries(changes)){original[name]=fs[name];fs[name]=change(fs[name]);}syncBuiltinESMExports();
 try{return await run();}finally{for(const [name,value]of Object.entries(original))fs[name]=value;syncBuiltinESMExports();}
}
test('a private output leaf beneath a non-sticky writable ancestor is refused before output',async t=>{
 if(process.platform==='win32'){t.skip('POSIX permission model; Windows ACLs are not simulated as POSIX mode bits');return;}
 const f=fixture(t);await complete(f);const paths=diskBundle(t,await exported(f)),api=await isolated();
 const ancestor=join(paths.folder,'unsafe-parent');mkdirSync(ancestor,{mode:0o700});fs.chmodSync(ancestor,0o777);const outputParent=join(ancestor,'private-output');mkdirSync(outputParent,{mode:0o700});
 await assert.rejects(()=>api.restoreBackupIsolated({...paths,outputParent,key,expectedOwner:owner,expectedBackupId:f.row().id}),/backup_recovery_/);assert.deepEqual(readdirSync(outputParent),[]);
});
test('an output directory replaced during an original read cannot receive a success receipt',async t=>{
 const f=fixture(t);await complete(f);const paths=diskBundle(t,await exported(f)),api=await isolated();let replaced=false,output;
 await filesystemFaults({readFileSync:read=>(...args)=>{
  const bytes=read(...args),entry=typeof args[0]==='number'&&readdirSync(paths.outputParent).find(name=>name.startsWith('mg-sites-evidence-'));
  if(entry&&!replaced){replaced=true;output=join(paths.outputParent,entry);const retained=join(paths.folder,'retained-output');renameSync(output,retained);fs.cpSync(retained,output,{recursive:true});fs.chmodSync(output,0o700);}
  return bytes;
 }},async()=>{await assert.rejects(()=>api.restoreBackupIsolated({...paths,key,expectedOwner:owner,expectedBackupId:f.row().id}),/backup_recovery_/);});
 assert.equal(replaced,true);assert.equal(existsSync(join(output,'receipt.json')),false);assert.equal(existsSync(join(paths.folder,'retained-output','receipt.json')),false);
});
test('Windows-shaped pathname and descriptor metadata can restore without dropping volume identity',async t=>{
 const f=fixture(t);await complete(f);const paths=diskBundle(t,await exported(f)),api=await isolated(),platform=Object.getOwnPropertyDescriptor(process,'platform');
 // This exercises real SQLite and bytes on this host while modelling the
 // documented Win32 metadata shape; it is not a Windows runtime claim.
 Object.defineProperty(process,'platform',{...platform,value:'win32'});
 try{await filesystemFaults({
  lstatSync:stat=>(...args)=>{const result=stat(...args);if(result.isFile())result.dev=args[1]?.bigint?0n:0;return result;},
  fstatSync:stat=>(...args)=>{const result=stat(...args);if(result.isFile())result.dev=args[1]?.bigint?123456n:123456;return result;},
 },async()=>{const result=await api.restoreBackupIsolated({...paths,key,expectedOwner:owner,expectedBackupId:f.row().id});assert.equal(result.mode,'evidence-only');assert.equal(existsSync(join(result.directory,'receipt.json')),true);});}
 finally{Object.defineProperty(process,'platform',platform);}
});
test('a descriptor with a different Windows volume is refused even if its inode matches',async t=>{
 const f=fixture(t);await complete(f);const paths=diskBundle(t,await exported(f)),api=await isolated(),platform=Object.getOwnPropertyDescriptor(process,'platform');let opens=0,foreign;
 Object.defineProperty(process,'platform',{...platform,value:'win32'});
 try{await filesystemFaults({
  openSync:open=>(...args)=>{const fd=open(...args);if(args[0]===join(paths.bundleDirectory,'bundle.json')&&++opens===2)foreign=fd;return fd;},
  lstatSync:stat=>(...args)=>{const result=stat(...args);if(result.isFile())result.dev=args[1]?.bigint?0n:0;return result;},
  fstatSync:stat=>(...args)=>{const result=stat(...args);if(result.isFile())result.dev=BigInt(args[0]===foreign?654321:123456);return result;},
 },async()=>{await assert.rejects(()=>api.restoreBackupIsolated({...paths,key,expectedOwner:owner,expectedBackupId:f.row().id}),/backup_recovery_/);assert.equal(opens,2,'the second descriptor must provide the independent volume identity');assert.deepEqual(readdirSync(paths.outputParent),[]);});}
 finally{Object.defineProperty(process,'platform',platform);}
});
test('the newly restored SQLite file is flushed through a writable handle',async t=>{
 const f=fixture(t);await complete(f);const paths=diskBundle(t,await exported(f)),api=await isolated(),flags=new Map();
 await filesystemFaults({
  openSync:open=>(...args)=>{const fd=open(...args);flags.set(fd,args[1]);return fd;},
  fsyncSync:flush=>fd=>{if(flags.get(fd)==='r')throw Object.assign(Error('synthetic Windows read-only flush denial'),{code:'EBADF'});return flush(fd);},
 },async()=>{const result=await api.restoreBackupIsolated({...paths,key,expectedOwner:owner,expectedBackupId:f.row().id});assert.equal(existsSync(join(result.directory,'receipt.json')),true);});
});

function isRestoreReceipt(bytes){try{return JSON.parse(Buffer.from(bytes).toString('utf8'))?.format==='MG-Sites-evidence-restore-1';}catch{return false;}}
for(const damage of ['partial write','flush failure','readback failure','stored byte corruption'])test('receipt '+damage+' never publishes the completion marker',async t=>{
 const f=fixture(t);await complete(f);const paths=diskBundle(t,await exported(f)),api=await isolated(),opened=new Map();let receiptFd,receiptPath,injected=false,flushed=false;
 await filesystemFaults({
  openSync:open=>(...args)=>{const fd=open(...args);opened.set(fd,args[0]);return fd;},
  writeFileSync:write=>(file,bytes,...args)=>{
   if(isRestoreReceipt(bytes)){
    receiptFd=file;receiptPath=opened.get(file);
    if(damage==='partial write'){injected=true;write(file,Buffer.from(bytes).subarray(0,23),...args);throw Object.assign(Error('synthetic partial receipt write'),{code:'EIO'});}
   }
   return write(file,bytes,...args);
  },
  fsyncSync:flush=>fd=>{
   if(fd===receiptFd&&damage==='flush failure'){injected=true;throw Object.assign(Error('synthetic receipt flush failure'),{code:'EIO'});}
   const result=flush(fd);
   if(fd===receiptFd){flushed=true;if(damage==='stored byte corruption'){injected=true;fs.writeSync(fd,new Uint8Array([33]),0,1,0);}}
   return result;
  },
  readFileSync:read=>(file,...args)=>{
   if(flushed&&(file===receiptPath||file===receiptFd)&&damage==='readback failure'){injected=true;throw Object.assign(Error('synthetic receipt readback failure'),{code:'EIO'});}
   return read(file,...args);
  },
 },async()=>{await assert.rejects(()=>api.restoreBackupIsolated({...paths,key,expectedOwner:owner,expectedBackupId:f.row().id}),/backup_recovery_/);});
 assert.equal(injected,true,'the fault must reach the receipt publication phase');
 const outputs=readdirSync(paths.outputParent);assert.equal(outputs.length,1);assert.equal(existsSync(join(paths.outputParent,outputs[0],'receipt.json')),false,'a rejected restore must not publish its receipt');
 for(const document of f.documents)assert.deepEqual(readFileSync(join(paths.outputParent,outputs[0],'originals',document.id+'.bin')),document.bytes);
});

test('a forced process interruption during receipt staging leaves no completion marker and a fresh retry succeeds',async t=>{
 const f=fixture(t);await complete(f);const paths=diskBundle(t,await exported(f)),api=await isolated(),marker=join(paths.folder,'interruption-observed');
 const childCode=`
  import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
  const [moduleURL,bundleDirectory,outputParent,expectedOwner,expectedBackupId,marker]=process.argv.slice(1);
  const write=fs.writeFileSync;
  fs.writeFileSync=(file,bytes,...args)=>{
   let receipt=false;try{receipt=JSON.parse(Buffer.from(bytes).toString('utf8'))?.format==='MG-Sites-evidence-restore-1';}catch{}
   if(receipt){write(file,Buffer.from(bytes).subarray(0,23),...args);write(marker,'interrupted during receipt write',{mode:0o600});process.kill(process.pid,'SIGKILL');}
   return write(file,bytes,...args);
  };
  syncBuiltinESMExports();
  const {restoreBackupIsolated}=await import(moduleURL);
  await restoreBackupIsolated({bundleDirectory,outputParent,expectedOwner,expectedBackupId,key:process.env.MG_SITES_RECOVERY_KEY});
 `;
 const child=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',childCode,new URL('../scripts/restore-backup-isolated.mjs',import.meta.url).href,paths.bundleDirectory,paths.outputParent,owner,f.row().id,marker],{encoding:'utf8',timeout:30000,env:{...process.env,MG_SITES_RECOVERY_KEY:key}});
 assert.ifError(child.error);assert.notEqual(child.status,0);assert.equal(readFileSync(marker,'utf8'),'interrupted during receipt write');
 const interrupted=join(paths.outputParent,readdirSync(paths.outputParent)[0]);assert.equal(existsSync(join(interrupted,'receipt.json')),false);
 const result=await api.restoreBackupIsolated({...paths,key,expectedOwner:owner,expectedBackupId:f.row().id});assert.notEqual(result.directory,interrupted);assert.equal(existsSync(join(result.directory,'receipt.json')),true);assert.equal(existsSync(join(interrupted,'receipt.json')),false);
});

test('exclusive receipt publication preserves a concurrently created foreign completion path',async t=>{
 const f=fixture(t);await complete(f);const paths=diskBundle(t,await exported(f)),api=await isolated(),foreign=Buffer.from('synthetic foreign receipt');let destination;
 await filesystemFaults({linkSync:link=>(from,to)=>{if(to.endsWith('/receipt.json')||to.endsWith('\\receipt.json')){destination=to;writeFileSync(to,foreign,{flag:'wx',mode:0o600});}return link(from,to);}},async()=>{
  await assert.rejects(()=>api.restoreBackupIsolated({...paths,key,expectedOwner:owner,expectedBackupId:f.row().id}),/backup_recovery_/);
 });
 assert.equal(typeof destination,'string');assert.deepEqual(readFileSync(destination),foreign);
});

test('receipt publication never deletes a foreign replacement of its staging path',async t=>{
 const f=fixture(t);await complete(f);const paths=diskBundle(t,await exported(f)),api=await isolated(),foreign=Buffer.from('synthetic foreign staged receipt');let staged;
 const result=await filesystemFaults({linkSync:link=>(from,to)=>{
  const result=link(from,to);
  if(to.endsWith('/receipt.json')||to.endsWith('\\receipt.json')){staged=from;renameSync(from,from+'.retained');writeFileSync(from,foreign,{flag:'wx',mode:0o600});}
  return result;
 }},()=>api.restoreBackupIsolated({...paths,key,expectedOwner:owner,expectedBackupId:f.row().id}));
 assert.equal(typeof staged,'string');assert.deepEqual(readFileSync(staged),foreign);assert.equal(JSON.parse(readFileSync(join(result.directory,'receipt.json'),'utf8')).mode,'evidence-only');
});
