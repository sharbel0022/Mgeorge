import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,storeDocument} from '../src/db.js';
import {createCompanyRuntime} from '../src/company-runtime.js';
import {createBackup,restoreBackup} from '../src/backup.js';

const columns=['id','owner','company_id','provider_kind','environment','app_generation','bank_id','bank_name','status','encrypted_state','selected_accounts','valid_until','revision','last_synced_at','last_error','request_key_hash','created_at','updated_at','grant_fingerprint'];
const flowColumns=['provider_kind','provider_payload','provider_connection_id','provider_flow_id','provider_request_key_hash'];
const verification={status:'verified',evidenceId:'synthetic-owner-verification',verifiedBy:'operator'};
function temporary(){return mkdtempSync(join(tmpdir(),'mg-provider-storage-'));}
function fixture(t){
 const directory=temporary(),path=join(directory,'legacy.sqlite'),controlDb=openDatabase(path),runtime=createCompanyRuntime({controlDb,legacyDatabasePath:path});
 t.after(()=>{runtime.close();controlDb.close();rmSync(directory,{recursive:true,force:true});});
 const a=runtime.provisionCompany({companyId:'company-a',name:'Synthetic A',actorId:'alice',verification}),b=runtime.provisionCompany({companyId:'company-b',name:'Synthetic B',actorId:'ben',verification});
 return{directory,controlDb,runtime,a,b,db:runtime.db};
}
function insertConnection(f,c,id){return f.runtime.run(c,()=>{
 const row={id,owner:c.storageOwner,company_id:c.companyId,provider_kind:'open_payments',environment:'SANDBOX',app_generation:'synthetic-generation',bank_id:'SYNTHBIC',bank_name:'Synthetic bank',status:'creating',encrypted_state:'synthetic sealed state',selected_accounts:'[]',valid_until:'',revision:1,last_synced_at:'',last_error:'',request_key_hash:'request-'+id,created_at:'2026-11-04',updated_at:'2026-11-04',grant_fingerprint:''};
 f.db.prepare('INSERT INTO bank_provider_connections('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').run(...columns.map(name=>row[name]));
});}
function reserve(f,c,id,fingerprint){return f.runtime.run(c,()=>{
 f.db.exec('BEGIN IMMEDIATE');try{
  if(f.runtime.retainedProviderGrantInUse(fingerprint,id))throw Object.assign(Error('PROVIDER_GRANT_REUSED'),{code:'PROVIDER_GRANT_REUSED'});
  f.db.prepare('INSERT OR IGNORE INTO bank_provider_grant_claims VALUES(?,?,?,?,?,?,?)').run(fingerprint,c.storageOwner,c.companyId,id,'open_payments','SANDBOX','2026-11-04');
  f.db.prepare("UPDATE bank_provider_connections SET grant_fingerprint=?,status='connected',revision=revision+1 WHERE id=?").run(fingerprint,id);f.db.exec('COMMIT');
 }catch(e){f.db.exec('ROLLBACK');throw e;}
});}
function available(f,c,fingerprint,id){return f.runtime.run(c,()=>f.runtime.retainedProviderGrantInUse(fingerprint,id));}

test('new installation has the exact provider DTO and additive one-use flow selectors',t=>{
 const directory=temporary(),db=openDatabase(join(directory,'new.sqlite'));t.after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});
 assert.deepEqual(db.prepare('PRAGMA table_info(bank_provider_connections)').all().map(c=>c.name),columns);
 assert.deepEqual(db.prepare('PRAGMA table_info(bank_provider_grant_claims)').all().map(c=>c.name),['fingerprint','owner','company_id','connection_id','provider_kind','environment','created_at']);
 assert.equal(db.prepare('PRAGMA table_info(bank_provider_grant_claims)').all().find(c=>c.name==='fingerprint').notnull,1);
 for(const [hash,owner]of [['one','owner-a'],['two','owner-a'],['three','owner-b']])db.prepare('INSERT INTO bank_states(state_hash,expires_at,owner) VALUES(?,1,?)').run(hash,owner);
 const defaults=db.prepare('SELECT '+flowColumns.join(',')+' FROM bank_states WHERE state_hash=?').get('one');assert.deepEqual({...defaults},{provider_kind:'enable_banking',provider_payload:'',provider_connection_id:'',provider_flow_id:'',provider_request_key_hash:''});
 db.prepare('UPDATE bank_states SET provider_flow_id=?,provider_request_key_hash=? WHERE state_hash=?').run('public-flow','request-hash','one');
 assert.throws(()=>db.prepare('UPDATE bank_states SET provider_flow_id=? WHERE state_hash=?').run('public-flow','two'),/UNIQUE/);
 assert.throws(()=>db.prepare('UPDATE bank_states SET provider_request_key_hash=? WHERE state_hash=?').run('request-hash','two'),/UNIQUE/);
 db.prepare('UPDATE bank_states SET provider_flow_id=?,provider_request_key_hash=? WHERE state_hash=?').run('public-flow','request-hash','three');
});
test('real upgrade retains every legacy invoice original consent and both OAuth pins',t=>{
 const directory=temporary(),path=join(directory,'legacy.sqlite');t.after(()=>rmSync(directory,{recursive:true,force:true}));let db=openDatabase(path);
 db.prepare("INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES('invoice','customer','00599','Synthetic legacy',62500)").run();
 db.prepare("INSERT INTO bank_transactions(id,fingerprint,account,booked_at,amount_cents) VALUES('payment','retained-payment','synthetic-account','2026-11-04',62500)").run();
 db.prepare("INSERT INTO allocations(id,invoice_id,transaction_id,amount_cents) VALUES('allocation','invoice','payment',12500)").run();
 storeDocument(db,{name:'retained.pdf',mime_type:'application/pdf',bytes:Buffer.from('%PDF-synthetic-retained-original'),invoice_id:'invoice'});
 db.prepare('INSERT INTO bank_connections(id,provider,bank_name,encrypted_session,accounts_json,valid_until,owner,consent_json) VALUES(?,?,?,?,?,?,?,?)').run('consent','enablebanking','Swedbank','retained sealed session','retained sealed accounts','2099-01-01','local-admin','{"originalConsent":true}');
 db.prepare('INSERT INTO bank_states(state_hash,expires_at,owner,context_json,company_context_json) VALUES(?,1,?,?,?)').run('retained-flow','local-admin','{"consentPin":1}','{"companyPin":1}');
 // Recreate the actual predecessor shape, then exercise openDatabase's upgrade.
 db.exec('DROP INDEX IF EXISTS bank_provider_flow_id; DROP INDEX IF EXISTS bank_provider_flow_request; DROP TABLE IF EXISTS bank_provider_grant_claims; DROP TABLE IF EXISTS bank_provider_connections;');
 for(const name of flowColumns)if(db.prepare('PRAGMA table_info(bank_states)').all().some(c=>c.name===name))db.exec('ALTER TABLE bank_states DROP COLUMN '+name);
 const before=new Map(['invoices','bank_transactions','allocations','documents','bank_connections','bank_states'].map(table=>[table,{columns:db.prepare('PRAGMA table_info('+table+')').all().map(c=>c.name),rows:db.prepare('SELECT * FROM '+table).all()}]));db.close();
 db=openDatabase(path);try{
  for(const [table,snapshot]of before)assert.deepEqual(db.prepare('SELECT '+snapshot.columns.join(',')+' FROM '+table).all(),snapshot.rows,table+' legacy columns must remain byte-exact');
  assert.equal(db.prepare('SELECT provider_kind FROM bank_states').get().provider_kind,'enable_banking');
  assert.equal(db.prepare('PRAGMA table_info(bank_provider_connections)').all().length,19);
 }finally{db.close();}
 db=openDatabase(path);try{assert.equal(db.prepare('SELECT count(*) n FROM bank_provider_grant_claims').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM invoices').get().n,1);}finally{db.close();}
});
test('historical grants reject cross-company and cross-connection reuse after renewal and revocation',t=>{
 const f=fixture(t);assert.equal(typeof f.runtime.retainedProviderGrantInUse,'function');
 for(const [c,id]of [[f.a,'same-id'],[f.a,'other-id'],[f.b,'same-id']])insertConnection(f,c,id);
 reserve(f,f.a,'same-id','a'.repeat(64));assert.equal(available(f,f.a,'a'.repeat(64),'same-id'),false);
 assert.equal(available(f,f.a,'a'.repeat(64),'other-id'),true);assert.equal(available(f,f.b,'a'.repeat(64),'same-id'),true);
 assert.throws(()=>reserve(f,f.b,'same-id','a'.repeat(64)),{code:'PROVIDER_GRANT_REUSED'});
 reserve(f,f.a,'same-id','b'.repeat(64));f.runtime.run(f.a,()=>f.db.prepare("UPDATE bank_provider_connections SET status='revoked',revision=revision+1 WHERE id='same-id'").run());
 assert.equal(available(f,f.b,'a'.repeat(64),'same-id'),true);assert.equal(available(f,f.b,'b'.repeat(64),'same-id'),true);assert.equal(available(f,f.a,'a'.repeat(64),'same-id'),false);
 f.controlDb.prepare("UPDATE companies SET status='suspended' WHERE company_id='company-a'").run();assert.equal(available(f,f.b,'a'.repeat(64),'same-id'),true);
});
test('claim history is immutable and same-owned retries retain the first receipt',t=>{
 const f=fixture(t);insertConnection(f,f.a,'connection');reserve(f,f.a,'connection','c'.repeat(64));
 f.runtime.run(f.a,()=>{
  const before=f.db.prepare('SELECT * FROM bank_provider_grant_claims').get();
  assert.throws(()=>f.db.prepare("UPDATE bank_provider_grant_claims SET created_at='changed'").run(),/BANK_PROVIDER_CLAIM_IMMUTABLE/);
  assert.throws(()=>f.db.prepare('DELETE FROM bank_provider_grant_claims').run(),/BANK_PROVIDER_CLAIM_RETAINED/);
  f.db.prepare('INSERT OR IGNORE INTO bank_provider_grant_claims VALUES(?,?,?,?,?,?,?)').run('c'.repeat(64),f.a.storageOwner,f.a.companyId,'connection','open_payments','SANDBOX','later-retry');
  f.db.prepare('INSERT OR REPLACE INTO bank_provider_grant_claims VALUES(?,?,?,?,?,?,?)').run('c'.repeat(64),f.a.storageOwner,f.a.companyId,'connection','open_payments','SANDBOX','attempted-replacement');
  assert.deepEqual(f.db.prepare('SELECT * FROM bank_provider_grant_claims').get(),before);
 });
});
test('company evidence backup retains historical grant ownership through renewal and revocation',t=>{
 const f=fixture(t);insertConnection(f,f.a,'connection');reserve(f,f.a,'connection','1'.repeat(64));reserve(f,f.a,'connection','2'.repeat(64));
 f.runtime.run(f.a,()=>f.db.prepare("UPDATE bank_provider_connections SET status='revoked',revision=revision+1 WHERE id='connection'").run());
 const before=f.runtime.run(f.a,()=>f.db.prepare('SELECT * FROM bank_provider_grant_claims ORDER BY fingerprint').all());
 const archive=join(f.directory,'synthetic.mgbak'),target=join(f.directory,'restored.sqlite'),key='9'.repeat(64);
 createBackup(f.runtime.databasePath(f.a),archive,key,{expectedCompanyId:f.a.companyId});restoreBackup(archive,target,key,{expectedCompanyId:f.a.companyId});
 const restored=new DatabaseSync(target,{readOnly:true});try{
  assert.deepEqual(restored.prepare('SELECT * FROM bank_provider_grant_claims ORDER BY fingerprint').all(),before);
  assert.equal(restored.prepare('SELECT status FROM bank_provider_connections').get().status,'revoked');
  assert.equal(restored.prepare('SELECT company_id,storage_owner FROM company_database_boundary').get().storage_owner,f.a.storageOwner);
 }finally{restored.close();}
});
test('grant scans require current integration authority and reject malformed fingerprint inputs',async t=>{
 const f=fixture(t);assert.equal(typeof f.runtime.retainedProviderGrantInUse,'function');
 f.runtime.setMembership({companyId:'company-a',actorId:'viewer',role:'viewer'});const viewer=f.runtime.resolve({actorId:'viewer'});
 assert.throws(()=>available(f,viewer,'d'.repeat(64),'id'),{code:'company_permission_denied'});
 assert.throws(()=>f.runtime.retainedProviderGrantInUse('d'.repeat(64),'id'),{code:'company_access_denied'});
 for(const [fingerprint,id]of [['bad','id'],['D'.repeat(64),'id'],['d'.repeat(64),'../foreign']])assert.equal(available(f,f.a,fingerprint,id),true);
 let release;const gate=new Promise(resolve=>release=resolve),pending=f.runtime.run(f.a,async()=>{await gate;return f.runtime.retainedProviderGrantInUse('d'.repeat(64),'id');});
 f.runtime.setMembership({companyId:'company-a',actorId:'backup-owner',role:'owner'});f.runtime.setMembership({companyId:'company-a',actorId:'alice',role:'owner',status:'revoked'});release();
 await assert.rejects(pending,{code:'company_access_denied'});
});
test('old empty partitions are compatible and missing nonempty grant history fails closed',t=>{
 const f=fixture(t);assert.equal(typeof f.runtime.retainedProviderGrantInUse,'function');
 f.runtime.run(f.b,()=>f.db.exec('DROP TABLE bank_provider_grant_claims; DROP TABLE bank_provider_connections;'));
 assert.equal(available(f,f.a,'e'.repeat(64),'id'),false);
 const path=f.runtime.databasePath(f.b),old=openDatabase(path);old.close();insertConnection(f,f.b,'unknown-history');
 f.runtime.run(f.b,()=>f.db.exec('DROP TABLE bank_provider_grant_claims;'));
 assert.equal(available(f,f.a,'e'.repeat(64),'id'),true);
});
test('foreign row bindings and missing immutable partitions cannot authorize a grant',t=>{
 const f=fixture(t);assert.equal(typeof f.runtime.retainedProviderGrantInUse,'function');insertConnection(f,f.b,'connection-b');
 const path=f.runtime.databasePath(f.b),raw=new DatabaseSync(path);
 try{raw.prepare('INSERT INTO bank_provider_grant_claims VALUES(?,?,?,?,?,?,?)').run('f'.repeat(64),f.a.storageOwner,f.a.companyId,'connection-b','open_payments','SANDBOX','2026-11-04');}finally{raw.close();}
 assert.equal(available(f,f.a,'f'.repeat(64),'connection-b'),true);
 const key='00000000-0000-4000-8000-000000000099';f.controlDb.prepare('INSERT INTO companies(company_id,name,storage_owner,database_key,verification_ref,verified_by) VALUES(?,?,?,?,?,?)').run('missing-partition','Missing','company:missing',key,'synthetic-proof','operator');
 assert.equal(available(f,f.a,'0'.repeat(64),'id'),true);
});
test('a verified legacy-bound partition reserves historical grants for other companies',t=>{
 const f=fixture(t),legacy=f.runtime.bindLegacyCompany({companyId:'legacy-company',name:'Verified legacy',storageOwner:'local-admin',actorId:'local-admin',verification});
 insertConnection(f,legacy,'legacy-connection');reserve(f,legacy,'legacy-connection','3'.repeat(64));
 assert.equal(available(f,f.a,'3'.repeat(64),'legacy-connection'),true);assert.equal(available(f,legacy,'3'.repeat(64),'legacy-connection'),false);
});
test('a corrupt immutable partition boundary fails closed without exposing any grant data',t=>{
 const f=fixture(t),raw=new DatabaseSync(f.runtime.databasePath(f.b));try{raw.exec('DROP TABLE company_database_boundary');}finally{raw.close();}
 assert.equal(available(f,f.a,'4'.repeat(64),'id'),true);
});
