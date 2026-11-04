import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompanyDatabase,resolveCompanyScope,provisionCompany,companyDirectory,selectCompany,changeCompanyMembership,resolveWorkerScope,createWorkerGrant,assertScopeCurrent,ownerTables,resolveCompanyMailbox} from '../lib/company-storage.js';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

import {companyFixture as fixture} from './helpers/company-storage-fixture.mjs';
test('additive migration preserves every legacy financial byte and requires verified adoption',async t=>{
 const payload=JSON.stringify({company:{name:'Synthetic legacy company'},invoices:[{id:'same-invoice',number:'0599',total:100}],transactions:[{id:'same-bank',amount:100}],allocations:[{id:'kept'}]}),before=new Map();
 const f=fixture(t,{beforeCompanyMigration(sql){
  sql.prepare('INSERT INTO workspaces VALUES(?,7,?,?)').run('legacy-owner',payload,'2026-01-01');
  sql.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?)').run('original-id','legacy-owner','original.pdf','application/pdf',26,createHash('sha256').update('synthetic retained original').digest('hex'),'2026-01-01');
  sql.prepare('INSERT INTO bank_connections(id,owner,app_generation,environment,bank_name,country,encrypted_session,encrypted_accounts,selected_accounts,valid_until,date_from,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('synthetic-consent','legacy-owner','original-generation','PRODUCTION','Synthetic bank','SE','original-encrypted-consent','original-encrypted-account-proof','["synthetic-account"]','2099-01-01','2026-01-01','connected','2026-01-01','2026-01-01');
  sql.prepare('INSERT INTO document_registrations VALUES(?,?,?,?,?,?,?)').run('legacy-owner','original-id','original-identity','same-invoice','original-attempt',100,'2026-01-01');
  sql.prepare('INSERT INTO bankgiro_ingest_sources(owner,source_id,scope_id,authorization_generation,authorization_status,updated_at) VALUES(?,?,?,?,?,?)').run('legacy-owner','synthetic-source','original-scope','original-authority','VERIFIED',1);
  for(const table of ownerTables){const columns=sql.prepare('PRAGMA table_info('+table+')').all().map(c=>c.name);before.set(table,{columns,rows:sql.prepare('SELECT * FROM '+table).all()});}
 }});
 for(const [table,{columns,rows}]of before)assert.deepEqual(f.sql.prepare('SELECT '+columns.map(c=>'"'+c+'"').join(',')+' FROM '+table).all(),rows,table+' must retain every pre-migration column');
 const legacy=await resolveCompanyScope(f.raw,'legacy-owner',{});assert.equal(legacy.kind,'legacy');
 await assert.rejects(provisionCompany(f.raw,{id:'company-a',name:'A',actorId:'different-actor',legacyOwner:'legacy-owner',verifiedBy:'operator',verificationEvidence:'A name is insufficient.'}),/COMPANY_OWNERSHIP_PROOF_REQUIRED/);
 await provisionCompany(f.raw,{id:'company-a',name:'A',actorId:'legacy-owner',legacyOwner:'legacy-owner',verifiedBy:'operator',verificationEvidence:'Synthetic owner verification receipt',verifiedLegacyOwner:'legacy-owner'});
 assert.deepEqual({...f.sql.prepare('SELECT * FROM workspaces WHERE owner=?').get('legacy-owner')},{owner:'legacy-owner',revision:7,payload,updated_at:'2026-01-01'});
 await assert.rejects(assertScopeCurrent(f.raw,legacy),/COMPANY_CONTEXT_STALE/);
});
for(const [kind,seed]of [
 ['original',sql=>sql.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?)').run('retained-original','legacy-owner','original.pdf','application/pdf',12,'f'.repeat(64),'2026-01-01')],
 ['automation',sql=>sql.prepare('INSERT INTO document_automation(owner,email,enabled,updated_at) VALUES(?,?,1,?)').run('legacy-owner','legacy@example.test','2026-01-01')],
 ['bank consent',sql=>sql.prepare('INSERT INTO bank_connections(id,owner,app_generation,environment,bank_name,country,encrypted_session,encrypted_accounts,selected_accounts,valid_until,date_from,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('retained-consent','legacy-owner','retained-generation','PRODUCTION','Synthetic bank','SE','retained-session','retained-accounts','[]','2099-01-01','2026-01-01','connected','2026-01-01','2026-01-01')],
 ['audit history',sql=>sql.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?,?)').run('retained-audit','legacy-owner',1,'synthetic','{}','2026-01-01')],
])test('empty-company creation cannot conceal a legacy '+kind+' without a workspace',async t=>{
 const f=fixture(t);seed(f.sql);
 await assert.rejects(provisionCompany(f.raw,{id:'fresh-company',name:'Fresh',actorId:'legacy-owner',verifiedBy:'legacy-owner',verificationEvidence:'Authenticated creation of a separate empty company.'}),/COMPANY_LEGACY_BINDING_REQUIRED/);
 assert.equal((await companyDirectory(f.raw,'legacy-owner')).legacy,true);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM companies').get().n,0);
});
test('the empty-company prerequisite is checked atomically after a concurrent legacy save',async t=>{
 const f=fixture(t),payload='{"invoices":[{"id":"retained-invoice","total":125}]}';
 f.beforeBatch=()=>{f.beforeBatch=null;f.sql.prepare('INSERT INTO workspaces VALUES(?,7,?,?)').run('actor-a',payload,'2026-01-01');};
 await assert.rejects(f.create('company-a'),/COMPANY_LEGACY_BINDING_REQUIRED/);
 assert.equal(f.sql.prepare('SELECT payload FROM workspaces WHERE owner=?').get('actor-a').payload,payload);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM companies').get().n,0);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM company_operation_guard').get().n,0);
 assert.equal((await companyDirectory(f.raw,'actor-a')).legacy,true);
});
test('verified originals-only legacy adoption retains its namespace and original metadata',async t=>{
 const f=fixture(t);f.sql.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?)').run('retained-original','legacy-owner','original.pdf','application/pdf',12,'f'.repeat(64),'2026-01-01');
 const before=f.sql.prepare('SELECT * FROM documents').all();
 const input={id:'legacy-company',name:'Verified legacy company',actorId:'legacy-owner',legacyOwner:'legacy-owner',verifiedBy:'operator',verificationEvidence:'Synthetic verified original owner relationship'};
 await assert.rejects(provisionCompany(f.raw,input),/COMPANY_OWNERSHIP_PROOF_REQUIRED/);
 const result=await provisionCompany(f.raw,{...input,verifiedLegacyOwner:'legacy-owner'});
 assert.equal(result.storageOwner,'legacy-owner');
 const scope=await f.scope('legacy-owner','legacy-company');
 assert.deepEqual((await f.database(scope).prepare('SELECT * FROM documents').all()).results,before);
 assert.equal((await f.database(scope).prepare('SELECT revision FROM workspaces').first()).revision,0);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM company_operation_guard').get().n,0);
});
test('mailbox registration is company/owner bound and never falls back to M.George for a new company',async t=>{
 const f=fixture(t);await f.create('company-a');const {context}=await f.scope(),legacyAccount='legacy@example.test';
 assert.throws(()=>resolveCompanyMailbox(undefined,{context,legacyAccount}),/COMPANY_MAILBOX_UNVERIFIED/);
 assert.equal(resolveCompanyMailbox(undefined,{context,legacyAccount,required:false}),null);
 const registration={companyId:context.companyId,storageOwner:context.storageOwner,email:'a@example.test',verifiedBy:'operator',evidence:'Synthetic verified owner relationship'};
 assert.equal(resolveCompanyMailbox({version:1,accounts:[registration]},{context,legacyAccount}),'a@example.test');
 for(const record of [{...registration,storageOwner:'other-owner'},{...registration,evidence:''},{...registration,companyId:'company-b'}])assert.throws(()=>resolveCompanyMailbox({version:1,accounts:[record]},{context,legacyAccount}),/COMPANY_MAILBOX_UNVERIFIED/);
 assert.equal(resolveCompanyMailbox(undefined,{context,legacyOwner:context.storageOwner,legacyAccount}),legacyAccount);
 assert.equal(resolveCompanyMailbox(undefined,{context:null,legacyAccount}),legacyAccount);
});
test('company A cannot read B invoices, bank data or originals even if SQL omits owner',async t=>{
 const f=fixture(t);await f.create('company-a');await f.create('company-b','actor-b');
 const a=await f.scope(),b=await f.scope('actor-b','company-b'),aDb=f.database(a),bDb=f.database(b);
 for(const [scope,database]of [[a,aDb],[b,bDb]]){
  await database.prepare('UPDATE workspaces SET payload=? WHERE owner=?').bind(JSON.stringify({invoices:[{id:'same-invoice',tenant:scope.context.companyId}],transactions:[{id:'same-bank',tenant:scope.context.companyId}]}),scope.owner).run();
  await database.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?)').bind(scope.context.companyId+'-doc',scope.owner,'original.pdf','application/pdf',1,'f'.repeat(64),'2026-01-01').run();
 }
 const all=await aDb.prepare('SELECT payload FROM workspaces').all();assert.equal(all.results.length,1);assert.match(all.results[0].payload,/company-a/);assert.doesNotMatch(all.results[0].payload,/company-b/);
 assert.equal(await aDb.prepare('SELECT payload FROM workspaces WHERE owner=?').bind(b.owner).first(),null);
 assert.equal(await aDb.prepare('SELECT * FROM documents WHERE id=?').bind('company-b-doc').first(),null);
 const withQuery=await aDb.prepare('WITH x AS (SELECT * FROM documents) SELECT * FROM x').all();assert.equal(withQuery.results.length,1);assert.equal(withQuery.results[0].owner,a.owner);
});
test('forged selector, missing selector and removed membership never fall back to legacy',async t=>{
 const f=fixture(t);await f.create('company-a');await f.create('company-b','actor-b');
 await assert.rejects(resolveCompanyScope(f.raw,'actor-a',{companyId:'company-b',contextVersion:1}),/COMPANY_FORBIDDEN/);
 await assert.rejects(resolveCompanyScope(f.raw,'actor-a',{}),/COMPANY_CONTEXT_REQUIRED/);
 const a=await f.scope();await changeCompanyMembership(f.raw,a,{actorId:'backup-owner',role:'owner',status:'active'});f.sql.prepare("UPDATE company_memberships SET status='revoked',membership_version=membership_version+1 WHERE actor_id=?").run('actor-a');
 await assert.rejects(f.database(a).prepare('SELECT * FROM workspaces').all(),/COMPANY_FORBIDDEN|COMPANY_CONTEXT_STALE/);
 await assert.rejects(resolveCompanyScope(f.raw,'actor-a',{}),/COMPANY_FORBIDDEN|COMPANY_CONTEXT_REQUIRED/);
});
test('membership is checked inside the atomic write and another company cannot be mutated',async t=>{
 const f=fixture(t);await f.create('company-a');await f.create('company-b','actor-b');const a=await f.scope(),b=await f.scope('actor-b','company-b'),database=f.database(a);
 await changeCompanyMembership(f.raw,a,{actorId:'backup-owner',role:'owner',status:'active'});const before=f.sql.prepare('SELECT * FROM workspaces ORDER BY owner').all();
 await assert.rejects(database.prepare('UPDATE workspaces SET revision=99').run(),/COMPANY_BOUNDARY|COMPANY_FORBIDDEN/);
 assert.deepEqual(f.sql.prepare('SELECT * FROM workspaces ORDER BY owner').all(),before);
 await assert.rejects(database.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?,?)').bind('forged',b.owner,1,'write','{}','2026').run(),/COMPANY_BOUNDARY/);
 const delayed=database.prepare('UPDATE workspaces SET revision=revision+1 WHERE owner=?').bind(a.owner);
 f.beforeBatch=()=>{f.beforeBatch=null;f.sql.prepare("UPDATE company_memberships SET status='revoked',membership_version=membership_version+1 WHERE company_id=? AND actor_id=?").run(a.context.companyId,'actor-a');};
 await assert.rejects(delayed.run(),/COMPANY_FORBIDDEN|CHECK constraint/);
 assert.deepEqual(f.sql.prepare('SELECT * FROM workspaces ORDER BY owner').all(),before);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM company_operation_guard').get().n,0);
});
test('viewer reads but cannot write and accountant cannot manage company or memberships',async t=>{
 const f=fixture(t);await f.create('company-a');const owner=await f.scope();await changeCompanyMembership(f.raw,owner,{actorId:'viewer',role:'viewer',status:'active'});await changeCompanyMembership(f.raw,owner,{actorId:'accountant',role:'accountant',status:'active'});
 for(const actor of ['viewer','accountant'])await selectCompany(f.raw,actor,'company-a',1);
 const viewer=await f.scope('viewer'),accountant=await f.scope('accountant');assert.equal((await f.database(viewer).prepare('SELECT * FROM workspaces').all()).results.length,1);
 await assert.rejects(f.database(viewer).prepare('UPDATE workspaces SET revision=2 WHERE owner=?').bind(viewer.owner).run(),/COMPANY_FORBIDDEN/);
 await assert.rejects(resolveCompanyScope(f.raw,'accountant',{companyId:'company-a',contextVersion:2,action:'manage_company'}),/COMPANY_FORBIDDEN/);
 await assert.rejects(changeCompanyMembership(f.raw,accountant,{actorId:'viewer',role:'owner',status:'active'}),/COMPANY_FORBIDDEN/);
});
test('switching active company invalidates saved statements and concurrent context versions',async t=>{
 const f=fixture(t);await f.create('company-a');await f.create('company-b');const a=await f.scope(),database=f.database(a),statement=database.prepare('SELECT * FROM workspaces');
 const b=await selectCompany(f.raw,'actor-a','company-b',1);assert.equal(b.companyId,'company-b');assert.equal(b.contextVersion,2);
 await assert.rejects(statement.all(),/COMPANY_CONTEXT_STALE/);await assert.rejects(selectCompany(f.raw,'actor-a','company-a',1),/COMPANY_CONTEXT_STALE/);
 assert.equal((await f.database(await f.scope('actor-a','company-b')).prepare('SELECT * FROM workspaces').all()).results.length,1);
});
test('worker authorization pins company and is revoked by grant or originating membership',async t=>{
 const f=fixture(t);await f.create('company-a');await f.create('company-b');const a=await f.scope(),credential='a'.repeat(64);
 await f.database(a).prepare('UPDATE document_automation SET enabled=1 WHERE owner=?').bind(a.owner).run();
 await assert.rejects(resolveWorkerScope(f.raw,a.owner,'cloud',credential),/COMPANY_WORKER_FORBIDDEN/);
 await createWorkerGrant(f.raw,a,{runner:'cloud',credentialHash:credential});const worker=await resolveWorkerScope(f.raw,a.owner,'cloud',credential);
 await selectCompany(f.raw,'actor-a','company-b',1);await f.database(worker).prepare('UPDATE workspaces SET revision=revision+1 WHERE owner=?').bind(a.owner).run();
 const b=await f.scope('actor-a','company-b');await assert.rejects(f.database(worker).prepare('UPDATE workspaces SET revision=99 WHERE owner=?').bind(b.owner).run(),/COMPANY_BOUNDARY/);
 f.sql.prepare("INSERT INTO company_memberships(company_id,actor_id,role,created_at,updated_at) VALUES('company-a','backup-owner','owner','now','now')").run();
 f.sql.prepare("UPDATE company_memberships SET status='revoked',membership_version=membership_version+1 WHERE company_id=? AND actor_id=?").run('company-a','actor-a');
 await assert.rejects(f.database(worker).prepare('UPDATE workspaces SET revision=99 WHERE owner=?').bind(a.owner).run(),/COMPANY_FORBIDDEN|COMPANY_WORKER_FORBIDDEN/);
});
test('retired worker credentials can never be reassigned to another tenant',async t=>{
 const f=fixture(t);await f.create('company-a');await f.create('company-b','actor-b');const a=await f.scope(),b=await f.scope('actor-b','company-b');
 await createWorkerGrant(f.raw,a,{runner:'cloud',credentialHash:'c'.repeat(64)});await createWorkerGrant(f.raw,a,{runner:'cloud',credentialHash:'d'.repeat(64)});
 await assert.rejects(createWorkerGrant(f.raw,b,{runner:'cloud',credentialHash:'c'.repeat(64)}),/UNIQUE constraint/);
 assert.equal(f.sql.prepare("SELECT count(*) n FROM company_worker_grants WHERE company_id='company-b'").get().n,0);
 assert.throws(()=>f.sql.prepare("UPDATE company_worker_grants SET company_id='company-b' WHERE credential_sha256=?").run('c'.repeat(64)),/COMPANY_WORKER_CREDENTIAL_IMMUTABLE/);
 assert.throws(()=>f.sql.prepare('DELETE FROM company_worker_grants WHERE credential_sha256=?').run('c'.repeat(64)),/COMPANY_WORKER_CREDENTIAL_RETAINED/);
});
test('a running legacy worker loses its write grant if the credential becomes company-bound',async t=>{
 const f=fixture(t);await f.create('company-a');const a=await f.scope(),credential='e'.repeat(64);
 f.sql.prepare('INSERT INTO workspaces VALUES(?,1,?,?)').run('legacy-b','{"preserved":true}','before');
 const legacy=await resolveWorkerScope(f.raw,'legacy-b','cloud',credential),statement=f.database(legacy).prepare('UPDATE workspaces SET revision=2 WHERE owner=?').bind('legacy-b');
 await createWorkerGrant(f.raw,a,{runner:'cloud',credentialHash:credential});await assert.rejects(statement.run(),/COMPANY_FORBIDDEN/);
 assert.equal(f.sql.prepare("SELECT revision FROM workspaces WHERE owner='legacy-b'").get().revision,1);
});
test('quoted schema/table spellings and replacement cannot bypass the data boundary',async t=>{
 const f=fixture(t);await f.create('company-a');const database=f.database(await f.scope());
 for(const query of ["SELECT * FROM 'documents'","SELECT * FROM (('documents'))",'SELECT * FROM "main"."documents"','SELECT * FROM [main].[documents]','SELECT * FROM `main`.`documents`','INSERT OR REPLACE INTO documents VALUES(?,?,?,?,?,?,?)'])assert.throws(()=>database.prepare(query),/COMPANY_SQL_DENIED/);
 assert.equal((await database.prepare('SELECT * FROM "workspaces"').all()).results.length,1);
 assert.equal((await database.prepare('/* retained query */ WITH x AS (SELECT * FROM workspaces) SELECT * FROM x').all()).results.length,1);
});
test('last-owner safety is enforced inside the transaction after a concurrent revoke',async t=>{
 const f=fixture(t);await f.create('company-a');const a=await f.scope();await changeCompanyMembership(f.raw,a,{actorId:'owner-two',role:'owner',status:'active'});
 f.beforeBatch=()=>{f.beforeBatch=null;f.sql.prepare("UPDATE company_memberships SET status='revoked',membership_version=membership_version+1 WHERE company_id='company-a' AND actor_id='owner-two'").run();};
 await assert.rejects(changeCompanyMembership(f.raw,a,{actorId:'actor-a',role:'viewer',status:'active'}),/COMPANY_LAST_OWNER/);
 assert.equal(f.sql.prepare("SELECT role FROM company_memberships WHERE actor_id='actor-a'").get().role,'owner');
});
test('new companies have neutral explicit-reference workspaces and all owner tables are guarded',async t=>{
 const f=fixture(t);await f.create('company-a');const scope=await f.scope(),w=await f.database(scope).prepare('SELECT payload FROM workspaces').first();assert.doesNotMatch(w.payload,/M\.George|mg\.vitvaror/);assert.deepEqual(JSON.parse(w.payload).company.invoiceReferencePolicies,[]);
 const existing=f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name).filter(name=>f.sql.prepare('PRAGMA table_info('+name+')').all().some(c=>c.name==='owner'));
 assert.deepEqual([...ownerTables].sort(),existing.sort());
 assert.deepEqual(JSON.parse(readFileSync(new URL('../lib/company-owner-tables.json',import.meta.url),'utf8')).sort(),[...ownerTables].sort(),'Agent 8 manifest must match the actual runtime boundary');
 for(const table of ownerTables)for(const event of ['insert','update','delete'])assert.ok(f.sql.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name=?").get('company_boundary_'+table+'_'+event));
});
