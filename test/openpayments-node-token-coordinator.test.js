import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createNodeOpenPaymentsTokenCoordinator} from '../src/banking/openpayments-token-coordinator.js';
import {createCompanyRuntime} from '../src/company-runtime.js';
import {openDatabase} from '../src/db.js';
import {decryptObject} from '../src/security.js';
process.env.BANK_DATA_KEY='b'.repeat(64);delete process.env.ENCRYPTION_KEY;
const schema=readFileSync(new URL('../sites/lib/banking/openpayments/token-coordinator.schema.sql',import.meta.url),'utf8');
const configuration={environment:'PRODUCTION',clientId:'synthetic-node-app',clientSecret:'synthetic-node-secret',credentialGeneration:'synthetic-g1',features:['bank_discovery']};
function fixture(t){
 const controlDb=new DatabaseSync(':memory:');controlDb.exec(schema);t.after(()=>controlDb.close());
 const environment={SAAS_BANK_ENABLED:'true',SAAS_OPENPAYMENTS_CONFIG:JSON.stringify(configuration),SAAS_OPENPAYMENTS_MTLS_CONFIG:'synthetic-config'};
 const transport={kind:'mtls',transportIdentity:'a'.repeat(64),certificateValidUntil:Date.now()+3600000,validateCertificate(){}};
 const create=overrides=>createNodeOpenPaymentsTokenCoordinator({controlDb,environment,configuration,transport,...overrides});
 const issue=async({assertBeforeSend})=>{await assertBeforeSend();return{value:'synthetic-sensitive-node-token',seconds:3600};};
 return{controlDb,environment,transport,create,issue};
}
test('Node coordinator stores bound AES-GCM in central controlDb and reads it across fresh adapters',async t=>{
 const f=fixture(t),a=f.create();await a.coordinator.access(f.issue);let calls=0;
 const token=await f.create().coordinator.access(async()=>{calls++;throw Error('must reuse');});assert.equal(calls,0);assert.equal(token.value,'synthetic-sensitive-node-token');
 const row=f.controlDb.prepare('SELECT * FROM company_application_tokens').get();assert.ok(!JSON.stringify(row).includes(token.value));
 const decoded=decryptObject(row.token_ciphertext);assert.equal(decoded.binding.familyKey,row.family_key);assert.equal(decoded.value.value,token.value);
});
test('Node coordinator rejects missing DB/schema and changed encryption key with zero issuer calls',async t=>{
 const f=fixture(t);assert.throws(()=>f.create({controlDb:null}),{code:'APPLICATION_TOKEN_STORAGE_UNAVAILABLE'});
 const adapter=f.create();f.controlDb.exec('DROP TABLE company_application_tokens');await assert.rejects(adapter.coordinator.access(f.issue),{code:'APPLICATION_TOKEN_STORAGE_UNAVAILABLE'});
 const before=process.env.BANK_DATA_KEY;t.after(()=>{process.env.BANK_DATA_KEY=before;});process.env.BANK_DATA_KEY='e'.repeat(64);
 await assert.rejects(adapter.coordinator.assertCurrent(),{code:'APPLICATION_TOKEN_STORAGE_UNAVAILABLE'});
});
test('Node financial guard pins global config/epoch/control revision with synchronous SQL inside a transaction',async t=>{
 const f=fixture(t),a=f.create();await a.coordinator.ensureRegistered();const guard=await a.captureGuard();guard();
 f.controlDb.exec('BEGIN IMMEDIATE');f.controlDb.exec('CREATE TABLE synthetic_financial(id INTEGER); INSERT INTO synthetic_financial VALUES(1); UPDATE company_application_tokens SET epoch=epoch+1');
 assert.throws(guard,{code:'APPLICATION_TOKEN_CONFIGURATION_CHANGED'});f.controlDb.exec('ROLLBACK');guard();
 f.controlDb.exec('UPDATE company_application_token_control SET revision=revision+1');assert.throws(guard,{code:'APPLICATION_TOKEN_CONFIGURATION_CHANGED'});
});
test('Node startup creates only central token metadata and tenant SQL cannot read or mutate it',t=>{
 const dir=mkdtempSync(join(tmpdir(),'mg-token-control-')),path=join(dir,'legacy.sqlite'),controlDb=openDatabase(path),runtime=createCompanyRuntime({controlDb,legacyDatabasePath:path});
 t.after(()=>{runtime.close();controlDb.close();rmSync(dir,{recursive:true,force:true});});
 assert.equal(controlDb.prepare('SELECT recovery_required FROM company_application_token_control').get().recovery_required,0);
 const verification={status:'verified',evidenceId:'synthetic-company-proof',verifiedBy:'operator'};
 const legacy=runtime.bindLegacyCompany({companyId:'legacy',storageOwner:'local-admin',actorId:'local-admin',name:'Synthetic legacy',verification});
 const other=runtime.provisionCompany({companyId:'other',actorId:'other-owner',name:'Synthetic other',verification});
 for(const context of [legacy,other])runtime.run(context,()=>{
  for(const query of ['SELECT * FROM company_application_tokens','SELECT * FROM "COMPANY_APPLICATION_TOKEN_CONTROL"','PRAGMA table_info(company_application_tokens)',"UPDATE company_application_token_control SET recovery_required=0","CREATE VIEW stolen AS SELECT * FROM company_application_tokens"]){assert.throws(()=>runtime.db.prepare(query),{code:'company_control_plane_access_denied'},query);assert.throws(()=>runtime.db.exec(query),{code:'company_control_plane_access_denied'},query);}
  assert.equal(runtime.db.prepare('SELECT count(*) n FROM invoices').get().n,0);
 });
 const tenant=new DatabaseSync(runtime.databasePath(other));t.after(()=>tenant.close());assert.equal(tenant.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'company_application_token%'").get().n,0);
});

test('Node restart never recreates a missing control gate over existing application state',t=>{
 for(const kind of ['empty-control','missing-control']){
  const dir=mkdtempSync(join(tmpdir(),'mg-token-restart-')),path=join(dir,'legacy.sqlite'),controlDb=openDatabase(path);controlDb.exec(schema);
  t.after(()=>{controlDb.close();rmSync(dir,{recursive:true,force:true});});
  if(kind==='empty-control')controlDb.exec('DELETE FROM company_application_token_control');else controlDb.exec('DROP TABLE company_application_token_control');
  assert.throws(()=>createCompanyRuntime({controlDb,legacyDatabasePath:path}),{code:'APPLICATION_TOKEN_STORAGE_UNAVAILABLE'});
  assert.equal(controlDb.prepare("SELECT count(*) n FROM sqlite_master WHERE name='company_application_token_control'").get().n,kind==='empty-control'?1:0);
  if(kind==='empty-control')assert.equal(controlDb.prepare('SELECT count(*) n FROM company_application_token_control').get().n,0);
 }
});
test('startup preserves an explicit restored control marker when rebuilding the empty state schema',t=>{
 const dir=mkdtempSync(join(tmpdir(),'mg-token-restore-start-')),path=join(dir,'legacy.sqlite'),controlDb=openDatabase(path);controlDb.exec(schema);
 controlDb.exec("UPDATE company_application_token_control SET recovery_required=1,restore_marker='synthetic-restored',revision=4; DROP TABLE company_application_tokens");
 const before=controlDb.prepare('SELECT * FROM company_application_token_control').get(),runtime=createCompanyRuntime({controlDb,legacyDatabasePath:path});t.after(()=>{runtime.close();controlDb.close();rmSync(dir,{recursive:true,force:true});});
 assert.deepEqual(controlDb.prepare('SELECT * FROM company_application_token_control').get(),before);assert.equal(controlDb.prepare('SELECT count(*) n FROM company_application_tokens').get().n,0);
});
