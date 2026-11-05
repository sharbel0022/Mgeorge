import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase,getSettings,storeDocument} from '../src/db.js';
import {createCompanyRuntime} from '../src/company-runtime.js';
import {createBackup,verifyBackup,restoreBackup} from '../src/backup.js';
import {createPaymentControl,CONTROL_STEPS} from '../src/payment-control.js';
import {DatabaseSync} from 'node:sqlite';

const verified={status:'verified',evidenceId:'synthetic-ownership-verification',verifiedBy:'synthetic-operator'};
function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'mg-company-'));
 const path=join(directory,'legacy.sqlite'),controlDb=openDatabase(path);
 const runtime=createCompanyRuntime({controlDb,legacyDatabasePath:path,companyDirectory:join(directory,'companies'),legacyPrincipal:'local-admin'});
 const close=()=>{runtime.close();controlDb.close();rmSync(directory,{recursive:true,force:true});};
 return {directory,path,controlDb,runtime,close};
}
function seed(db,tag){
 db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES(?,?,?,?,?)').run('same-invoice','customer','0599',tag,62500);
 db.prepare('INSERT INTO bank_transactions(id,fingerprint,account,booked_at,amount_cents,payer) VALUES(?,?,?,?,?,?)').run('same-payment','same-fingerprint','synthetic-account','2026-10-26',62500,tag);
 return storeDocument(db,{name:'synthetic.pdf',mime_type:'application/pdf',bytes:Buffer.from('%PDF-'+tag),invoice_id:'same-invoice'});
}
test('legacy registration is explicit and preserves all existing financial rows and originals',()=>{
 const f=fixture();try{
  seed(f.controlDb,'Legacy synthetic company');
  const tables=['invoices','bank_transactions','documents','allocations','bank_connections','app_settings'];
  const snapshot=()=>Object.fromEntries(tables.map(t=>[t,f.controlDb.prepare('SELECT * FROM '+t).all()]));
  const before=snapshot();
  assert.deepEqual(f.runtime.listCompanies('local-admin'),{version:'company-context-v1',companies:[],activeCompanyId:null,contextVersion:1,legacy:true});
  assert.throws(()=>f.runtime.resolve({actorId:'local-admin',companyId:'forged'}),{code:'company_access_denied'});
  assert.throws(()=>f.runtime.bindLegacyCompany({companyId:'legacy-co',name:'Legacy',actorId:'local-admin',storageOwner:'local-admin'}),{code:'company_verification_required'});
  f.runtime.bindLegacyCompany({companyId:'legacy-co',name:'Legacy',actorId:'local-admin',storageOwner:'local-admin',verification:verified});
  assert.deepEqual(snapshot(),before);
  assert.equal(f.runtime.resolve({actorId:'local-admin'}).companyId,'legacy-co');
  assert.throws(()=>f.runtime.bindLegacyCompany({companyId:'different-co',name:'Different',actorId:'local-admin',storageOwner:'local-admin',verification:verified}),{code:'company_boundary_conflict'});
 }finally{f.close();}
});
test('trusted provisioning returns both companies for one administrator without changing the active company',()=>{
 const f=fixture();try{
  const a=f.runtime.provisionCompany({companyId:'a',name:'Synthetic A',actorId:'local-admin',verification:verified});
  const b=f.runtime.provisionCompany({companyId:'b',name:'Synthetic B',actorId:'local-admin',verification:verified});
  assert.equal(a.companyId,'a');assert.equal(b.companyId,'b');assert.equal(Object.isFrozen(b),true);
  assert.deepEqual(f.runtime.listCompanies('local-admin').companies.map(c=>c.id),['a','b']);
  assert.equal(f.runtime.resolve({actorId:'local-admin'}).companyId,'a');
  assert.throws(()=>f.runtime.run(b,()=>seed(f.runtime.db,'B')),{code:'COMPANY_CONTEXT_STALE'});
  const selected=f.runtime.selectActiveCompany({actorId:'local-admin',companyId:'b',contextVersion:a.contextVersion});
  f.runtime.run(selected,()=>seed(f.runtime.db,'B'));assert.equal(f.runtime.resolve({actorId:'local-admin'}).companyId,'b');
 }finally{f.close();}
});
test('verified legacy binding commits while another company is active and requires an explicit selection',()=>{
 const f=fixture();try{
  const active=f.runtime.provisionCompany({companyId:'new',name:'Synthetic new',actorId:'local-admin',verification:verified});
  seed(f.controlDb,'Synthetic retained legacy');
  const before=f.controlDb.prepare('SELECT * FROM documents').all();
  const legacy=f.runtime.bindLegacyCompany({companyId:'legacy',name:'Synthetic legacy',actorId:'local-admin',storageOwner:'local-admin',verification:verified});
  assert.equal(legacy.companyId,'legacy');assert.equal(f.runtime.legacyBound(),true);
  assert.equal(f.runtime.resolve({actorId:'local-admin'}).companyId,'new');
  assert.deepEqual(f.controlDb.prepare('SELECT * FROM documents').all(),before);
  assert.throws(()=>f.runtime.run(legacy,()=>f.runtime.db.prepare('SELECT * FROM documents').all()),{code:'COMPANY_CONTEXT_STALE'});
  const selected=f.runtime.selectActiveCompany({actorId:'local-admin',companyId:'legacy',contextVersion:active.contextVersion});
  f.runtime.run(selected,()=>assert.deepEqual(f.runtime.db.prepare('SELECT * FROM documents').all(),before));
 }finally{f.close();}
});
for(const [kind,retain] of [
 ['invoice',db=>db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES(?,?,?,?,?)').run('legacy-invoice','customer','0599','Synthetic legacy',62500)],
 ['bank transaction',db=>db.prepare('INSERT INTO bank_transactions(id,fingerprint,account,booked_at,amount_cents,payer) VALUES(?,?,?,?,?,?)').run('legacy-payment','legacy-fingerprint','synthetic-account','2026-10-26',62500,'Synthetic legacy')],
 ['original',db=>storeDocument(db,{name:'legacy-synthetic.pdf',mime_type:'application/pdf',bytes:Buffer.from('%PDF-synthetic-legacy')})],
 ['bank consent',db=>db.prepare('INSERT INTO bank_connections(id,provider,bank_name,encrypted_session,accounts_json,valid_until,owner) VALUES(?,?,?,?,?,?,?)').run('legacy-connection','synthetic','Synthetic bank','synthetic-session','[]','2099-01-01','local-admin')],
 ['mail consent',db=>db.prepare('INSERT INTO gmail_connections(id,email,encrypted_tokens) VALUES(?,?,?)').run('legacy-gmail','synthetic@example.test','synthetic-token')],
 ['import register',db=>db.prepare('INSERT INTO import_jobs(id,source) VALUES(?,?)').run('legacy-import','synthetic-original')]
])test('new company provisioning cannot conceal an unbound legacy '+kind,()=>{
 const f=fixture();try{
  retain(f.controlDb);
  const tables=['invoices','bank_transactions','documents','allocations','bank_connections','gmail_connections','import_jobs','app_settings'];
  const snapshot=()=>Object.fromEntries(tables.map(table=>[table,f.controlDb.prepare('SELECT * FROM '+table).all()]));
  const before=snapshot();
  assert.throws(()=>f.runtime.provisionCompany({companyId:'new',name:'Synthetic new',actorId:'local-admin',verification:verified}),{code:'company_legacy_binding_required'});
  assert.deepEqual(snapshot(),before);assert.equal(f.controlDb.prepare('SELECT COUNT(*) n FROM companies').get().n,0);
  assert.equal(f.runtime.resolve({actorId:'local-admin'}),null);assert.equal(existsSync(join(f.directory,'companies')),false);
  f.runtime.bindLegacyCompany({companyId:'legacy',name:'Synthetic legacy',actorId:'local-admin',storageOwner:'local-admin',verification:verified});
  const created=f.runtime.provisionCompany({companyId:'new',name:'Synthetic new',actorId:'local-admin',verification:verified});
  assert.equal(created.companyId,'new');assert.equal(f.runtime.resolve({actorId:'local-admin'}).companyId,'legacy');assert.deepEqual(snapshot(),before);
 }finally{f.close();}
});
test('separate companies cannot read each other despite identical record IDs; new defaults are neutral',()=>{
 const f=fixture();try{
  for(const id of ['a','b'])f.runtime.provisionCompany({companyId:id,name:'Synthetic '+id,actorId:id,verification:verified});
  const a=f.runtime.resolve({actorId:'a'}),b=f.runtime.resolve({actorId:'b'});
  f.runtime.run(a,()=>seed(f.runtime.db,'A'));
  f.runtime.run(b,()=>seed(f.runtime.db,'B'));
  for(const [context,tag] of [[a,'A'],[b,'B']])f.runtime.run(context,()=>{
   assert.equal(f.runtime.db.prepare('SELECT party FROM invoices').get().party,tag);
   assert.equal(f.runtime.db.prepare('SELECT payer FROM bank_transactions').get().payer,tag);
   assert.equal(f.runtime.db.prepare('SELECT COUNT(*) n FROM documents').get().n,1);
   const settings=getSettings(f.runtime.db);assert.equal(settings.company_name,'Synthetic '+context.companyId);assert.equal(settings.email,'');assert.deepEqual(settings.invoice_reference_policies,[]);assert.equal(settings.gmail_sync_interval_minutes,0);
  });
  assert.throws(()=>f.runtime.resolve({actorId:'a',companyId:'b'}),{code:'company_access_denied'});
 }finally{f.close();}
});
test('membership removal and role downgrade invalidate captured contexts and prepared statements',()=>{
 const f=fixture();try{
  f.runtime.provisionCompany({companyId:'a',name:'Synthetic A',actorId:'owner',verification:verified});
  f.runtime.setMembership({companyId:'a',actorId:'member',role:'accountant'});
  const context=f.runtime.resolve({actorId:'member'});let statement;
  f.runtime.run(context,()=>{statement=f.runtime.db.prepare('SELECT * FROM invoices');});
  f.runtime.setMembership({companyId:'a',actorId:'member',role:'viewer'});
  assert.throws(()=>f.runtime.run(context,()=>statement.all()),{code:'company_authorization_changed'});
  const viewer=f.runtime.resolve({actorId:'member'});
  assert.throws(()=>f.runtime.run(viewer,()=>seed(f.runtime.db,'blocked')),{code:'company_permission_denied'});
  f.runtime.setMembership({companyId:'a',actorId:'member',role:'viewer',status:'revoked'});
  assert.throws(()=>f.runtime.run(viewer,()=>f.runtime.db.prepare('SELECT * FROM invoices').all()),{code:'company_access_denied'});
 }finally{f.close();}
});
test('instrumented database methods retain company authorization and prepared statement boundaries',t=>{
 const f=fixture();try{
  for(const id of ['a','b'])f.runtime.provisionCompany({companyId:id,name:'Synthetic '+id,actorId:id,verification:verified});
  f.runtime.setMembership({companyId:'a',actorId:'reader',role:'viewer'});
  const a=f.runtime.resolve({actorId:'a'}),b=f.runtime.resolve({actorId:'b'}),reader=f.runtime.resolve({actorId:'reader'});
  f.runtime.run(a,()=>seed(f.runtime.db,'A'));f.runtime.run(b,()=>seed(f.runtime.db,'B'));
  const prepare=f.runtime.db.prepare.bind(f.runtime.db);let preparations=0,statement;
  t.mock.method(f.runtime.db,'prepare',sql=>{preparations++;return prepare(sql);});
  f.runtime.run(reader,()=>{statement=f.runtime.db.prepare('SELECT party FROM invoices');assert.equal(statement.get().party,'A');});
  assert.equal(preparations,1);
  assert.throws(()=>f.runtime.run(b,()=>statement.get()),{code:'company_context_mismatch'});
  f.runtime.setMembership({companyId:'a',actorId:'reader',role:'viewer',status:'revoked'});
  assert.throws(()=>f.runtime.run(reader,()=>statement.get()),{code:'company_access_denied'});
 }finally{f.close();}
});
test('active company changes fence stale responses and statements and jobs cannot switch tenant',async()=>{
 const f=fixture();try{
  for(const id of ['a','b'])f.runtime.provisionCompany({companyId:id,name:'Synthetic '+id,actorId:'owner',verification:verified});
  const a=f.runtime.resolve({actorId:'owner',companyId:'a'});let prepared;
  f.runtime.run(a,()=>{prepared=f.runtime.db.prepare('SELECT * FROM invoices');});
  const b=f.runtime.selectActiveCompany({actorId:'owner',companyId:'b',contextVersion:a.contextVersion});
  assert.throws(()=>f.runtime.resolve({actorId:'owner',companyId:'a',contextVersion:a.contextVersion}),{code:'COMPANY_CONTEXT_STALE'});
  assert.throws(()=>f.runtime.run(b,()=>prepared.all()),{code:'company_context_mismatch'});
  const freshA=f.runtime.selectActiveCompany({actorId:'owner',companyId:'a',contextVersion:b.contextVersion});
  await f.runtime.run(freshA,async()=>{
   await Promise.resolve();
   assert.throws(()=>f.runtime.run(b,()=>f.runtime.db.prepare('SELECT * FROM invoices').all()),{code:'company_context_mismatch'});
   assert.equal(f.runtime.current().companyId,'a');
  });
 }finally{f.close();}
});
test('company-bound backups reject another destination company and retain exact original hashes',()=>{
 const f=fixture();try{
  f.runtime.provisionCompany({companyId:'a',name:'Synthetic A',actorId:'a',verification:verified});
  const a=f.runtime.resolve({actorId:'a'});f.runtime.run(a,()=>seed(f.runtime.db,'A'));
  const archive=join(f.directory,'synthetic.mgbak'),key='a'.repeat(64),target=join(f.directory,'restored.sqlite');
  createBackup(f.runtime.databasePath(a),archive,key,{expectedCompanyId:'a'});
  assert.equal(verifyBackup(archive,key,{expectedCompanyId:'a'}).companyId,'a');
  assert.throws(()=>restoreBackup(archive,target,key,{expectedCompanyId:'b'}),{code:'backup_company_mismatch'});
  assert.equal(existsSync(target),false);
  restoreBackup(archive,target,key,{expectedCompanyId:'a'});
  const restored=openDatabase(target);try{
   assert.equal(restored.prepare('SELECT COUNT(*) n FROM documents').get().n,1);
   assert.throws(()=>createCompanyRuntime({controlDb:restored,legacyDatabasePath:target,companyDirectory:join(f.directory,'wrong-control'),legacyPrincipal:'local-admin'}),{code:'company_boundary_conflict'},'restoring a tenant DB cannot turn it into an unbound legacy workspace');
  }finally{restored.close();}
 }finally{f.close();}
});
test('prepared statements created during service setup still recheck live membership',()=>{
 const f=fixture();try{
  f.runtime.provisionCompany({companyId:'a',name:'A',actorId:'owner',verification:verified});
  f.runtime.setMembership({companyId:'a',actorId:'member',role:'viewer'});
  f.runtime.configureServices(()=>({prepared:f.runtime.db.prepare('SELECT * FROM invoices')}));
  const context=f.runtime.resolve({actorId:'member'});let prepared;
  f.runtime.run(context,()=>{prepared=f.runtime.services().prepared;assert.deepEqual(prepared.all(),[]);});
  f.runtime.setMembership({companyId:'a',actorId:'member',role:'viewer',status:'revoked'});
  assert.throws(()=>prepared.all(),{code:'company_context_mismatch'});
  assert.throws(()=>f.runtime.run(context,()=>prepared.all()),{code:'company_access_denied'});
 }finally{f.close();}
});
test('INSERT OR REPLACE cannot relabel a company database or its catalog storage binding',()=>{
 const f=fixture();try{
  f.runtime.bindLegacyCompany({companyId:'a',name:'A',actorId:'local-admin',storageOwner:'local-admin',verification:verified});
  assert.throws(()=>f.controlDb.prepare('INSERT OR REPLACE INTO company_database_boundary(id,company_id,storage_owner,boundary_version,verification_ref,verified_by) VALUES(1,?,?,1,?,?)').run('b','other','synthetic','operator'),/company_boundary_immutable/);
  assert.throws(()=>f.controlDb.prepare("INSERT OR REPLACE INTO companies(company_id,name,storage_owner,database_key,verification_ref,verified_by) VALUES('a','B','other','legacy','synthetic','operator')").run(),/company_storage_identity_immutable/);
 }finally{f.close();}
});
test('a delayed payment-control worker cannot write after its initiating member is removed',async()=>{
 const f=fixture();try{
  f.runtime.provisionCompany({companyId:'a',name:'A',actorId:'owner',verification:verified});
  f.runtime.setMembership({companyId:'a',actorId:'worker',role:'admin'});
  let reached,release;const paused=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{reached=resolve;});
  const adapters=Object.fromEntries(CONTROL_STEPS.map(([step])=>[step,async()=>({state:'done'})]));
  adapters.gmail=async()=>{reached();await paused;f.runtime.db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES(?,?,?,?,?)').run('must-not-exist','customer','0599','A',62500);return {state:'done'};};
  f.runtime.configureServices(()=>({paymentControl:createPaymentControl(f.runtime.db,{adapters,summarize:()=>({})})}));
  const context=f.runtime.resolve({actorId:'worker'});let completion;
  f.runtime.runJob(context,()=>{const service=f.runtime.services().paymentControl;const result=service.start(context.storageOwner,'synthetic-company-run-0001',()=>f.runtime.assert('write'));completion=service.wait(result.job.id);});
  await started;f.runtime.setMembership({companyId:'a',actorId:'worker',role:'admin',status:'revoked'});release();
  await completion;
  f.runtime.run(f.runtime.resolve({actorId:'owner'}),()=>assert.equal(f.runtime.db.prepare('SELECT COUNT(*) n FROM invoices').get().n,0));
 }finally{f.close();}
});
test('scheduled maintenance pins an owner before an alphabetically earlier administrator',()=>{
 const f=fixture();try{
  f.runtime.provisionCompany({companyId:'a',name:'Synthetic A',actorId:'z-owner',verification:verified});
  f.runtime.setMembership({companyId:'a',actorId:'a-admin',role:'admin'});
  const [scheduled]=f.runtime.scheduledContexts();assert.equal(scheduled.actorId,'z-owner');assert.equal(scheduled.role,'owner');
  f.runtime.runJob(scheduled,()=>f.runtime.assert('restore'));
  const admin=f.runtime.resolve({actorId:'a-admin'});
  assert.throws(()=>f.runtime.runJob(admin,()=>f.runtime.assert('restore')),{code:'company_permission_denied'});
 }finally{f.close();}
});
test('scheduled companies stay isolated even when the worker has another active company',()=>{
 const f=fixture();try{
  for(const id of ['a','b'])f.runtime.provisionCompany({companyId:id,name:id,actorId:'owner',verification:verified});
  const active=f.runtime.resolve({actorId:'owner'}),scheduled=f.runtime.scheduledContexts();
  assert.equal(active.companyId,'a');assert.deepEqual(scheduled.map(c=>c.companyId),['a','b']);
  const b=scheduled.find(c=>c.companyId==='b');
  assert.throws(()=>f.runtime.resolve({actorId:'owner',companyId:'b',contextVersion:active.contextVersion}),{code:'COMPANY_CONTEXT_STALE'});
  assert.throws(()=>f.runtime.run(b,()=>seed(f.runtime.db,'B request')),{code:'COMPANY_CONTEXT_STALE'});
  f.runtime.runJob(b,()=>seed(f.runtime.db,'B job'));
  f.runtime.run(active,()=>assert.equal(f.runtime.db.prepare('SELECT COUNT(*) n FROM invoices').get().n,0));
  f.runtime.runJob(b,()=>assert.equal(f.runtime.db.prepare('SELECT party FROM invoices').get().party,'B job'));
 }finally{f.close();}
});
test('background work remains in its initiating company when the user selects another company',async()=>{
 const f=fixture();try{
  for(const id of ['a','b'])f.runtime.provisionCompany({companyId:id,name:id,actorId:'owner',verification:verified});
  const a=f.runtime.resolve({actorId:'owner',companyId:'a'});let release;
  const wait=new Promise(resolve=>{release=resolve;});
  const work=f.runtime.runJob(a,async()=>{await wait;seed(f.runtime.db,'A job');});
  const b=f.runtime.selectActiveCompany({actorId:'owner',companyId:'b',contextVersion:a.contextVersion});
  release();await work;
  f.runtime.run(b,()=>assert.equal(f.runtime.db.prepare('SELECT COUNT(*) n FROM invoices').get().n,0));
  f.runtime.run(f.runtime.selectActiveCompany({actorId:'owner',companyId:'a',contextVersion:b.contextVersion}),()=>assert.equal(f.runtime.db.prepare('SELECT party FROM invoices').get().party,'A job'));
 }finally{f.close();}
});
test('tenant write transactions serialize membership changes through the control database',()=>{
 const f=fixture();let other;try{
  f.runtime.provisionCompany({companyId:'a',name:'A',actorId:'owner',verification:verified});
  f.runtime.setMembership({companyId:'a',actorId:'member',role:'accountant'});
  const context=f.runtime.resolve({actorId:'member'});other=new DatabaseSync(f.path);other.exec('PRAGMA busy_timeout=0');
  f.runtime.run(context,()=>{
   f.runtime.db.exec('BEGIN IMMEDIATE');
   try{assert.throws(()=>other.prepare("UPDATE company_memberships SET status='revoked' WHERE actor_id='member'").run(),/locked/);seed(f.runtime.db,'serialized');f.runtime.db.exec('COMMIT');}
   catch(error){f.runtime.db.exec('ROLLBACK');throw error;}
  });
  other.prepare("UPDATE company_memberships SET status='revoked' WHERE actor_id='member'").run();
  assert.throws(()=>f.runtime.run(context,()=>f.runtime.db.prepare('SELECT * FROM invoices').all()),{code:'company_access_denied'});
 }finally{other?.close();f.close();}
});
test('viewer cannot disguise a multi-statement mutation as a SELECT exec',()=>{
 const f=fixture();try{
  f.runtime.provisionCompany({companyId:'a',name:'A',actorId:'owner',verification:verified});f.runtime.setMembership({companyId:'a',actorId:'viewer',role:'viewer'});
  const context=f.runtime.resolve({actorId:'viewer'});
  assert.throws(()=>f.runtime.run(context,()=>f.runtime.db.exec("SELECT 1; INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES('evil','customer','1','evil',1)")),{code:'company_permission_denied'});
 }finally{f.close();}
});
test('viewer can hold a read snapshot without receiving write permission',()=>{
 const f=fixture();try{
  f.runtime.provisionCompany({companyId:'a',name:'A',actorId:'owner',verification:verified});f.runtime.setMembership({companyId:'a',actorId:'viewer',role:'viewer'});
  f.runtime.run(f.runtime.resolve({actorId:'viewer'}),()=>{
   f.runtime.db.exec('SAVEPOINT read_only_snapshot');
   try{assert.equal(f.runtime.db.prepare('SELECT COUNT(*) n FROM invoices').get().n,0);assert.throws(()=>seed(f.runtime.db,'forbidden'),{code:'company_permission_denied'});f.runtime.db.exec('RELEASE read_only_snapshot');}
   catch(error){f.runtime.db.exec('ROLLBACK TO read_only_snapshot');f.runtime.db.exec('RELEASE read_only_snapshot');throw error;}
  });
 }finally{f.close();}
});
test('a transaction cannot survive an async yield and expose uncommitted data to another request',async()=>{
 const f=fixture();try{
  f.runtime.provisionCompany({companyId:'a',name:'A',actorId:'owner',verification:verified});const context=f.runtime.resolve({actorId:'owner'});
  await f.runtime.run(context,async()=>{
   f.runtime.db.exec('BEGIN IMMEDIATE');seed(f.runtime.db,'uncommitted');await Promise.resolve();
   try{assert.throws(()=>f.runtime.db.prepare('SELECT * FROM invoices').all(),{code:'company_async_transaction_forbidden'});}finally{try{f.runtime.db.exec('ROLLBACK');}catch{}}
  });
  f.runtime.run(context,()=>assert.equal(f.runtime.db.prepare('SELECT COUNT(*) n FROM invoices').get().n,0));
 }finally{f.close();}
});
