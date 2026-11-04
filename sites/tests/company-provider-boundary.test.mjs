import test from 'node:test';
import assert from 'node:assert/strict';
import {companyFixture} from './helpers/company-storage-fixture.mjs';
import {changeCompanyMembership} from '../lib/company-storage.js';

async function setup(t){const f=companyFixture(t);await f.create('company-a');await f.create('company-b','actor-b');f.a=await f.scope();f.b=await f.scope('actor-b','company-b');return f;}
async function insert(f,scope,id,companyId=scope.context.companyId){
 return f.database(scope).prepare(`INSERT INTO bank_provider_connections(id,owner,company_id,provider_kind,environment,app_generation,bank_id,bank_name,status,encrypted_state,selected_accounts,valid_until,revision,last_synced_at,last_error,request_key_hash,created_at,updated_at)
 VALUES(?,?,?,'open_payments','SANDBOX','generation','SYNTHBIC','Synthetic bank','creating','synthetic sealed state','[]','',1,'','',?,'2026-11-04','2026-11-04')`).bind(id,scope.owner,companyId,'request-'+id).run();
}
test('provider rows are scoped even when business SQL omits an owner predicate',async t=>{
 const f=await setup(t);await insert(f,f.a,'connection-a');await insert(f,f.b,'connection-b');
 const rows=await f.database(f.a).prepare('SELECT id,owner FROM bank_provider_connections').all();
 assert.deepEqual(rows.results.map(row=>row.id),['connection-a']);
 assert.equal((await f.database(f.a).prepare('SELECT id FROM bank_provider_connections WHERE owner=?').bind(f.b.owner).all()).results.length,0);
});
test('provider connection writes reject a foreign immutable company binding',async t=>{
 const f=await setup(t);await assert.rejects(()=>insert(f,f.a,'forged','company-b'),/COMPANY_BOUNDARY|COMPANY_PROVIDER/);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM bank_provider_connections').get().n,0);
});
test('raw and foreign-owner provider writes cannot bypass the company fence',async t=>{
 const f=await setup(t);await insert(f,f.a,'connection-a');await insert(f,f.b,'connection-b');
 await assert.rejects(()=>f.database(f.a).prepare('UPDATE bank_provider_connections SET status=?,revision=revision+1 WHERE owner=?').bind('revoked',f.b.owner).run(),/COMPANY_BOUNDARY|COMPANY_PROVIDER/);
 assert.throws(()=>f.sql.prepare("UPDATE bank_provider_connections SET status='revoked',revision=revision+1 WHERE id='connection-a'").run(),/COMPANY_BOUNDARY|COMPANY_PROVIDER/);
 assert.equal(f.sql.prepare("SELECT status FROM bank_provider_connections WHERE id='connection-b'").get().status,'creating');
});
test('accountant cannot mutate provider credentials through a generic write scope',async t=>{
 const f=await setup(t);await changeCompanyMembership(f.raw,f.a,{actorId:'accountant',role:'accountant',status:'active'});
 const reader=await f.scope('accountant');await assert.rejects(()=>insert(f,reader,'accountant-credential'),/COMPANY_BOUNDARY|COMPANY_PROVIDER/);
});
test('grant history cannot reserve a fingerprint against a missing connection',async t=>{
 const f=await setup(t);
 await assert.rejects(()=>f.database(f.a).prepare("INSERT INTO bank_provider_grant_claims(fingerprint,owner,company_id,connection_id,provider_kind,environment,created_at) VALUES(?,?,?,'missing','open_payments','SANDBOX','2026-11-04')").bind('f'.repeat(64),f.a.owner,'company-a').run(),/BANK_PROVIDER_CLAIM_CONNECTION/);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM bank_provider_grant_claims').get().n,0);
});
