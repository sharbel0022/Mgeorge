import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ingestFixture} from './helpers/bankgiro-ingest-fixture.mjs';

async function fixture(t){
 const f=await ingestFixture(t),bytes=Buffer.from('%PDF-Synthetic reviewed invoice 0599, total 625.00 SEK'),sha=createHash('sha256').update(bytes).digest('hex');
 f.objects.set(f.owner+'/invoice-original',bytes);f.sql.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run('invoice-original',f.owner,'Invoice.pdf','application/pdf',bytes.length,sha,'2026-10-26');
 const initial=f.read().state;initial.invoices[0].documentId='invoice-original';f.write(initial);
 const input=await f.prepare(),imported=await f.sink.importReport(input);
 f.sql.prepare("UPDATE bankgiro_ingest_jobs SET status='IMPORTED',import_id=?,payment_count=1 WHERE id=?").run(imported.importId,input.job.id);
 const evidence=await import(f.moduleUrls.evidence);
 return Object.assign(f,{input,imported,evidence});
}
const conflict=f=>f.sql.prepare("INSERT INTO bankgiro_ingest_jobs(id,owner,source_id,scope_id,report_id,sha256,filename,authorization_generation,status,created_at,updated_at) SELECT 'conflicting-job',owner,source_id,scope_id,report_id,?,filename,authorization_generation,'IDENTITY_CONFLICT',created_at,updated_at FROM bankgiro_ingest_jobs WHERE id=?").run('b'.repeat(64),f.input.job.id);
for(const [label,change]of [
 ['conflicting report identity',conflict],
 ['revoked source',f=>f.sql.prepare("UPDATE bankgiro_ingest_sources SET authorization_status='REVOKED' WHERE owner=?").run(f.owner)],
 ['missing report census',f=>f.sql.prepare("UPDATE bankgiro_ingest_sources SET missing_report_ids='[\"missing-report\"]' WHERE owner=?").run(f.owner)],
 ['unfinished intake',f=>f.sql.prepare("UPDATE bankgiro_ingest_jobs SET status='RETRY' WHERE id=?").run(f.input.job.id)],
])test(`active reconciliation holds ${label} without storing a derived financial hold`,async t=>{
 const f=await fixture(t);change(f);const before=f.read(),result=await f.evidence.reconcileWithOriginals(f.owner,before.state);
 assert.equal(result.state.allocations.length,0);assert.ok(result.findings.every(row=>!row.safe));assert.ok(result.findings.some(row=>/BANKGIRO_SOURCE_/.test(row.reason)));assert.deepEqual(f.read(),before);assert.deepEqual(result.state.transactions,before.state.transactions);
});
test('completed source receipt with intact originals permits exactly one active allocation',async t=>{
 const f=await fixture(t),before=f.read(),result=await f.evidence.reconcileWithOriginals(f.owner,before.state);
 assert.equal(result.state.allocations.length,1);assert.equal(result.state.allocations[0].amount,62500);assert.equal((await f.evidence.reconcileWithOriginals(f.owner,result.state)).state.allocations.length,1);assert.deepEqual(f.read(),before);
});
for(const [label,change]of [
 ['source revocation',f=>f.sql.prepare("UPDATE bankgiro_ingest_sources SET authorization_status='REVOKED' WHERE owner=?").run(f.owner)],
 ['new conflicting report hash',conflict],
 ['changed completion status',f=>f.sql.prepare("UPDATE bankgiro_ingest_jobs SET status='RETRY' WHERE id=?").run(f.input.job.id)],
])test(`same D1 financial batch rejects ${label} after preflight`,async t=>{
 const f=await fixture(t),before=f.read(),result=await f.evidence.reconcileWithOriginals(f.owner,before.state),auditBefore=f.audits();assert.equal(result.state.allocations.length,1);
 let changed=false;f.beforeBatch=()=>{if(!changed){changed=true;change(f);}};
 const statements=[f.database.prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) VALUES(?,?,?,?,?,?)').bind('synthetic-auto-allocation',f.owner,before.revision+1,'automatic.reconciliation','{}','2026-10-26'),f.database.prepare('UPDATE workspaces SET payload=?,revision=revision+1 WHERE owner=? AND revision=?').bind(JSON.stringify(result.state),f.owner,before.revision)];
 await assert.rejects(f.evidence.writePaymentState(f.owner,before.revision,before.state,result.state,f.database,statements),{code:'BANKGIRO_SOURCE_CHANGED'});
 assert.equal(changed,true);assert.deepEqual(f.read(),before);assert.deepEqual(f.audits(),auditBefore);
});
test('a source issue present before the write cannot be bypassed with an earlier allocation result',async t=>{
 const f=await fixture(t),before=f.read(),result=await f.evidence.reconcileWithOriginals(f.owner,before.state);conflict(f);
 await assert.rejects(f.evidence.writePaymentState(f.owner,before.revision,before.state,result.state,f.database,[]),{code:'BANKGIRO_SOURCE_CHANGED'});assert.deepEqual(f.read(),before);
});
for(const amount of [25000,62500])test(`explicit reviewed ${amount<62500?'partial':'full'} allocation may use a held source only with a matching final snapshot`,async t=>{
 const f=await fixture(t);conflict(f);const before=f.read(),automatic=await f.evidence.reconcileWithOriginals(f.owner,before.state);assert.equal(automatic.state.allocations.length,0);
 const {applyCommand}=await import('../lib/domain.ts'),manual=applyCommand(before.state,{type:'match.create',invoiceId:before.state.invoices[0].id,transactionId:before.state.transactions.find(row=>row.specification).id,amount,note:'Synthetic explicit administrator decision after reviewing the source conflict'}).state;
 const manualAllocationIds=new Set(manual.allocations.filter(row=>!before.state.allocations.some(old=>old.id===row.id)).map(row=>row.id)),statements=[f.database.prepare('UPDATE workspaces SET payload=?,revision=revision+1 WHERE owner=? AND revision=?').bind(JSON.stringify(manual),f.owner,before.revision)];
 await f.evidence.writePaymentState(f.owner,before.revision,before.state,manual,f.database,statements,{manualAllocationIds});assert.equal(f.read().state.allocations[0].amount,amount);
});
test('an explicit manual source decision cannot survive a source change inside its final batch',async t=>{
 const f=await fixture(t);conflict(f);const before=f.read(),{applyCommand}=await import('../lib/domain.ts'),manual=applyCommand(before.state,{type:'match.create',invoiceId:before.state.invoices[0].id,transactionId:before.state.transactions.find(row=>row.specification).id,amount:25000,note:'Synthetic explicit administrator source review'}).state;
 const manualAllocationIds=new Set(manual.allocations.map(row=>row.id));f.beforeBatch=()=>{f.sql.prepare("UPDATE bankgiro_ingest_sources SET authorization_status='REVOKED' WHERE owner=?").run(f.owner);};
 await assert.rejects(f.evidence.writePaymentState(f.owner,before.revision,before.state,manual,f.database,[f.database.prepare('UPDATE workspaces SET payload=?,revision=revision+1 WHERE owner=? AND revision=?').bind(JSON.stringify(manual),f.owner,before.revision)],{manualAllocationIds}),{code:'BANKGIRO_SOURCE_CHANGED'});assert.deepEqual(f.read(),before);
});
test('a foreign-owner conflicting delivery appended inside the batch cannot block the owned receipt',async t=>{
 const f=await fixture(t),before=f.read(),result=await f.evidence.reconcileWithOriginals(f.owner,before.state);assert.equal(result.state.allocations.length,1);
 f.beforeBatch=()=>{f.sql.prepare("INSERT INTO bankgiro_ingest_jobs(id,owner,source_id,scope_id,report_id,sha256,filename,authorization_generation,status,created_at,updated_at) SELECT 'foreign-conflicting-job','foreign-owner',source_id,scope_id,report_id,?,filename,authorization_generation,'IDENTITY_CONFLICT',created_at,updated_at FROM bankgiro_ingest_jobs WHERE id=?").run('c'.repeat(64),f.input.job.id);};
 await f.evidence.writePaymentState(f.owner,before.revision,before.state,result.state,f.database,[f.database.prepare('UPDATE workspaces SET payload=?,revision=revision+1 WHERE owner=? AND revision=?').bind(JSON.stringify(result.state),f.owner,before.revision)]);
 assert.equal(f.read().state.allocations.length,1);assert.equal(f.read().revision,before.revision+1);
});
