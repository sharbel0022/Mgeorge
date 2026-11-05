import test from 'node:test';
import assert from 'node:assert/strict';
import {companyFixture} from './helpers/company-storage-fixture.mjs';
import {createCompanyBankSyncStore} from '../lib/company-bank-sync-store.js';

test('actual company database admits its sync coordinator, filters other companies and fences job writes',async t=>{
 const f=companyFixture(t),scopes=[];
 for(const [id,actor]of [['company-a','actor-a'],['company-b','actor-b'],['company-c','actor-c']]){
  await f.create(id,actor);scopes.push(await f.scope(actor,id));
 }
 const stores=scopes.map(scope=>createCompanyBankSyncStore(f.database(scope)));
 for(let index=0;index<scopes.length;index++){
  const scope=scopes[index],companyId=scope.context.companyId,owner=scope.owner,store=stores[index];
  await store.bindScope({companyId,owner,evidenceId:'synthetic-immutable-company-binding'});
  await store.register({companyId,owner,provider:'open_payments',connectionId:'same-local-connection',accountKey:'same-bank-account-key',accountUid:'same-resource-id',consentId:'same-consent',generation:'synthetic-generation',revision:1,validUntil:'2099-01-01T00:00:00Z',authorizationStatus:'VERIFIED',ratePolicy:{verified:true,evidenceId:'synthetic-provider-budget',maxRequests:100,windowMs:86400000},bankgiroEnabled:false});
 }
 const aDb=f.database(scopes[0]),b=scopes[1];
 for(const table of ['company_bank_sync_scopes','company_bank_sync_jobs']){
  const rows=(await aDb.prepare('SELECT * FROM '+table).all()).results;
  assert.equal(rows.length,1);assert.equal(rows[0].company_id,'company-a');
  assert.equal(await aDb.prepare('SELECT * FROM '+table+' WHERE owner=?').bind(b.owner).first(),null);
 }
 await assert.rejects(aDb.prepare('INSERT INTO company_bank_sync_requests(id,company_id,owner,account_key,connection_id,provider,reserved_at) VALUES(?,?,?,?,?,?,?)').bind('cross-tenant','company-b',b.owner,'same-bank-account-key','same-local-connection','open_payments',Date.now()).run(),/COMPANY_BOUNDARY_VIOLATION/);
 assert.throws(()=>f.sql.prepare('UPDATE company_bank_sync_jobs SET attempts=100 WHERE owner=?').run(b.owner),/COMPANY_BOUNDARY_VIOLATION/);
 assert.equal((await stores[1].status({companyId:'company-b',owner:b.owner,accountKey:'same-bank-account-key'})).attempts,0);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM company_operation_guard').get().n,0);
});

test('company sync fence errors remain executable while quoted control tables stay blocked',async t=>{
 const f=companyFixture(t);await f.create('company-a');const database=f.database(await f.scope());
 const valid=await database.prepare("SELECT CASE WHEN 1=1 THEN 1 ELSE json('COMPANY_SCOPE_MISMATCH') END AS valid").first();
 assert.equal(valid.valid,1);
 for(const query of ["SELECT * FROM (('company_operation_guard'))","SELECT * FROM (('COMPANY_MEMBERSHIPS'))",'SELECT * FROM company_operation_guard','SELECT * FROM "main".company_bank_sync_jobs'])assert.throws(()=>database.prepare(query),/COMPANY_SQL_DENIED/);
});
