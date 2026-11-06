import test from 'node:test';
import assert from 'node:assert/strict';
import {companyFixture} from './helpers/company-storage-fixture.mjs';
import {createOpenPaymentsTokenFence,openPaymentsTokenFenceStatement} from '../lib/banking/openpayments/token-coordinator-fence.js';
import {companyApplicationTokenFence} from '../lib/company-storage.js';

const familyKey='a'.repeat(64),configHash='b'.repeat(64);
async function fixture(t){
 const f=companyFixture(t);await f.create('company-a');const scope=await f.scope(),database=f.database(scope);
 f.sql.prepare('INSERT INTO company_application_tokens(family_key,config_hash) VALUES(?,?)').run(familyKey,configHash);
 const capability=createOpenPaymentsTokenFence({database:f.raw,familyKey,configHash,epoch:1,controlRevision:1});
 return{f,scope,database,capability};
}
test('fixed application fence is opaque and refuses forged or copied capabilities',async t=>{
 const {f,capability}=await fixture(t);assert.equal(JSON.stringify(capability),'{}');assert.ok(Object.isFrozen(capability));
 for(const candidate of [{},structuredClone(capability),Object.create(capability),{familyKey,configHash,epoch:1,controlRevision:1}]){
  assert.throws(()=>openPaymentsTokenFenceStatement(candidate,f.raw));
 }
 assert.equal((await openPaymentsTokenFenceStatement(capability,f.raw).all()).results.length,1);
});
test('application fence cannot be moved to a different raw database or an unrecognized tenant wrapper',async t=>{
 const {f,database,capability}=await fixture(t),other=companyFixture(t);
 assert.throws(()=>openPaymentsTokenFenceStatement(capability,other.raw));
 assert.throws(()=>companyApplicationTokenFence(other.database({kind:'legacy',owner:'x',actorId:'x',action:'read',context:null}),capability));
 assert.throws(()=>companyApplicationTokenFence({...database},capability));
 assert.throws(()=>openPaymentsTokenFenceStatement(capability,{...f.raw}));
});
for(const field of ['familyKey','configHash','epoch','controlRevision'])test('application fence validates the fixed '+field+' binding',async t=>{
 const {f}=await fixture(t),input={database:f.raw,familyKey,configHash,epoch:1,controlRevision:1};
 for(const value of [null,{},0,1.5,'SELECT * FROM workspaces'])assert.throws(()=>createOpenPaymentsTokenFence({...input,[field]:value}));
});
test('tenant batches can use the fixed fence while ordinary global-table SQL remains denied',async t=>{
 const {f,scope,database,capability}=await fixture(t),before=f.sql.prepare('SELECT revision FROM workspaces WHERE owner=?').get(scope.owner).revision;
 const fence=companyApplicationTokenFence(database,capability);
 assert.deepEqual(Object.keys(fence),[]);
 await database.batch([fence,database.prepare('UPDATE workspaces SET revision=revision+1 WHERE owner=?').bind(scope.owner),fence]);
 assert.equal(f.sql.prepare('SELECT revision FROM workspaces WHERE owner=?').get(scope.owner).revision,before+1);
 for(const table of ['company_application_tokens','company_application_token_control']){
  assert.throws(()=>database.prepare('SELECT * FROM '+table),/COMPANY_SQL_DENIED/);
  assert.throws(()=>database.prepare('DELETE FROM '+table),/COMPANY_SQL_DENIED/);
 }
});
for(const mutation of ["UPDATE company_application_tokens SET epoch=2","UPDATE company_application_tokens SET config_hash='"+'c'.repeat(64)+"'","UPDATE company_application_token_control SET revision=2","UPDATE company_application_token_control SET recovery_required=1","DELETE FROM company_application_tokens"]){
 test('registry race before the economic batch rolls back all writes: '+mutation,async t=>{
  const {f,scope,database,capability}=await fixture(t),before=f.sql.prepare('SELECT * FROM workspaces WHERE owner=?').get(scope.owner),guard=companyApplicationTokenFence(database,capability);
  let rotations=0;f.beforeBatch=()=>{f.beforeBatch=null;rotations++;f.sql.exec(mutation);};
  await assert.rejects(database.batch([guard,database.prepare('UPDATE workspaces SET revision=revision+1,payload=? WHERE owner=?').bind('{"synthetic":"must roll back"}',scope.owner),guard]));
  assert.equal(rotations,1);assert.deepEqual(f.sql.prepare('SELECT * FROM workspaces WHERE owner=?').get(scope.owner),before);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM company_operation_guard').get().n,0);
 });
}
test('an after-write application fence rolls back earlier mutations in the same batch',async t=>{
 const {f,scope,database,capability}=await fixture(t),before=f.sql.prepare('SELECT * FROM workspaces WHERE owner=?').get(scope.owner),guard=companyApplicationTokenFence(database,capability);
 f.sql.prepare('UPDATE company_application_token_control SET revision=2').run();
 await assert.rejects(database.batch([database.prepare('UPDATE workspaces SET revision=revision+1 WHERE owner=?').bind(scope.owner),guard]));
 assert.deepEqual(f.sql.prepare('SELECT * FROM workspaces WHERE owner=?').get(scope.owner),before);
});
