import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { readImportJobStatuses } from '../lib/import-job-overview.ts';

const now=Date.parse('2026-11-02T12:00:00.000Z');
const past='2026-11-02T10:00:00.000Z', attempt='2026-11-02T11:00:00.000Z', future='2026-11-02T13:00:00.000Z';
function fixture(t){
  const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
  for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(n=>/^\d{4}.*\.sql$/.test(n)).sort())sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
  const database={prepare(query){return {query,args:[],bind(...args){this.args=args;return this;}};},async batch(statements){sql.exec('BEGIN');try{const result=statements.map(s=>({results:sql.prepare(s.query).all(...s.args)}));sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  const seed=(table,row)=>{const columns=Object.keys(row);sql.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...Object.values(row));};
  const owner='synthetic-owner';
  return {sql,database,seed,owner,read:(config={})=>readImportJobStatuses(database,owner,config,{now})};
}

test('overview is read-only, has no invented success and prepares Bankgiro as blocked',async t=>{
  const f=fixture(t);const before=f.sql.prepare('SELECT total_changes() n').get().n;
  const result=await f.read();
  assert.equal(result.contractVersion,'1.0');assert.equal(result.jobs.length,5);
  assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,before);
  assert.ok(result.jobs.every(job=>job.lastSuccessAt===null));
  assert.equal(result.jobs.find(j=>j.jobType==='bankgiro_import').state,'blocked');
  assert.equal(result.bankgiroPreparation.enabled,false);assert.equal(result.bankgiroPreparation.externalScheduleCreated,false);
});

test('Gmail failure preserves last committed fetch and ignores another owners jobs',async t=>{
  const f=fixture(t);
  f.seed('document_automation',{owner:f.owner,email:'owner@example.test',enabled:1,updated_at:attempt});
  f.seed('gmail_connections',{owner:f.owner,email:'owner@example.test',tokens:'must-not-leak',last_attempt:attempt,last_synced:past,status:'retry_wait',retry_after:future,sync_failures:1});
  f.seed('gmail_runs',{id:'own-run',owner:f.owner,status:'completed',created_at:past});
  f.seed('gmail_runs',{id:'other-run',owner:'other-owner',status:'completed',created_at:'2026-11-02T11:59:59.000Z'});
  const result=await f.read();const job=result.jobs.find(j=>j.jobType==='gmail_sync');
  assert.equal(job.state,'retry_wait');assert.equal(job.lastAttemptAt,attempt);assert.equal(job.lastSuccessAt,past);assert.equal(job.nextAttemptAt,future);
  assert.equal(job.errorCode,null,'a persisted retry deadline does not prove a provider rate limit');
  assert.doesNotMatch(JSON.stringify(result),/must-not-leak|owner@example|other-owner|own-run/);
});

test('expired Gmail worker with a newer attempt is recoverable, never successful or running',async t=>{
  const f=fixture(t);
  f.seed('document_automation',{owner:f.owner,email:'owner@example.test',enabled:1,updated_at:attempt});
  f.seed('gmail_connections',{owner:f.owner,email:'owner@example.test',tokens:'secret',last_attempt:attempt,last_synced:past,status:'connected'});
  f.seed('gmail_locks',{owner:f.owner,token:'stale-private-token',expires_at:attempt});
  const job=(await f.read()).jobs.find(j=>j.jobType==='gmail_sync');
  assert.equal(job.state,'retry_wait');assert.equal(job.running,false);assert.equal(job.lastSuccessAt,past);
});

test('OCR heartbeat is not successful processing and waiting work is not an active worker',async t=>{
  const f=fixture(t);
  f.seed('document_automation',{owner:f.owner,email:'owner@example.test',enabled:1,worker_seen:attempt,cloud_worker_seen:attempt,last_cloud_run:attempt,updated_at:attempt});
  f.seed('documents',{id:'synthetic-document',owner:f.owner,filename:'synthetic.pdf',mime:'application/pdf',size:10,sha256:'a'.repeat(64),created_at:past});
  f.seed('gmail_sources',{owner:f.owner,source_id:'synthetic-source',document_id:'synthetic-document',metadata:'{}',created_at:past});
  f.seed('document_jobs',{owner:f.owner,document_id:'synthetic-document',state:'queued',available_at:future,attempts:1,error_code:'parse_timeout',updated_at:attempt});
  const job=(await f.read()).jobs.find(j=>j.jobType==='document_ocr');
  assert.equal(job.state,'retry_wait');assert.equal(job.lastSuccessAt,null);assert.equal(job.lastAttemptAt,null);assert.equal(job.running,false);
  f.sql.prepare("UPDATE document_jobs SET state='needs_review',extraction='{}',updated_at=?").run(attempt);
  assert.equal((await f.read()).jobs.find(j=>j.jobType==='document_ocr').lastSuccessAt,null);
  f.sql.prepare("UPDATE document_jobs SET extraction='{\"level\":\"yellow\"}'").run();
  f.seed('document_extractions',{id:'accepted-ocr',owner:f.owner,document_id:'synthetic-document',result:JSON.stringify({level:'yellow',processing:{version:'document-worker-v3',sha256:'a'.repeat(64)}}),created_at:attempt});
  const completed=(await f.read()).jobs.find(j=>j.jobType==='document_ocr');
  assert.equal(completed.lastSuccessAt,attempt);assert.equal(completed.state,'succeeded');assert.equal(completed.evidenceStatus,'REVIEW');
});

test('latest failed backup does not erase the previous complete snapshot',async t=>{
  const f=fixture(t);
  f.seed('backup_runs',{id:'old-backup',owner:f.owner,day:'2026-11-01',state:'complete',created_at:past,updated_at:past,finished_at:past});
  f.seed('backup_runs',{id:'latest-backup',owner:f.owner,day:'2026-11-02',state:'failed',attempts:3,last_error:'private-storage-url',created_at:attempt,updated_at:attempt});
  const job=(await f.read({backupEnabled:true,backupConfigured:true})).jobs.find(j=>j.jobType==='backup');
  assert.equal(job.state,'failed');assert.equal(job.lastSuccessAt,past);assert.equal(job.errorCode,'job_failed');
});

test('manual bank attempt evidence is separate from success and generic locks cannot certify the running job',async t=>{
  const f=fixture(t);
  f.seed('bank_connections',{id:'synthetic-bank',owner:f.owner,app_generation:'g',environment:'PRODUCTION',bank_name:'synthetic',country:'SE',encrypted_session:'private-session',encrypted_accounts:'private-accounts',valid_until:future,date_from:'2026-10-01',status:'connected',last_synced_at:past,auto_sync_enabled:1,created_at:past,updated_at:past});
  f.seed('audit_events',{id:'synthetic-attempt',owner:f.owner,revision:0,action:'bank.job.started',detail:JSON.stringify({run_id:'private-id',mode:'manual'}),created_at:attempt});
  f.seed('bank_locks',{owner:f.owner,token:'private-token',expires_at:future});
  const result=await f.read();const job=result.jobs.find(j=>j.jobType==='bank_sync');
  assert.equal(job.state,'retry_wait');assert.equal(job.lastAttemptAt,attempt);assert.equal(job.lastSuccessAt,past);assert.equal(job.running,false);
  assert.equal(job.errorCode,'worker_unconfirmed');
  assert.doesNotMatch(JSON.stringify(result),/private-session|private-accounts|private-token|private-id/);
  f.sql.prepare('DELETE FROM bank_locks').run();
  f.sql.prepare('UPDATE bank_connections SET retry_after=?').run(future);
  const waiting=(await f.read()).jobs.find(j=>j.jobType==='bank_sync');
  assert.equal(waiting.state,'retry_wait');assert.equal(waiting.nextAttemptAt,future);
  assert.equal(waiting.lastSuccessAt,past);assert.equal(waiting.errorCode,null,'retry advice may concern provider unavailability rather than rate limiting');
});

test('an expired exhausted OCR attempt is failed rather than apparently runnable work',async t=>{
  const f=fixture(t);
  f.seed('document_automation',{owner:f.owner,email:'owner@example.test',enabled:1,updated_at:attempt});
  f.seed('documents',{id:'exhausted',owner:f.owner,filename:'synthetic.pdf',mime:'application/pdf',size:10,sha256:'a'.repeat(64),created_at:past});
  f.seed('gmail_sources',{owner:f.owner,source_id:'exhausted-source',document_id:'exhausted',metadata:'{}',created_at:past});
  f.seed('document_jobs',{owner:f.owner,document_id:'exhausted',state:'processing',attempts:3,available_at:past,lease:'expired-secret',lease_until:attempt,updated_at:attempt});
  const job=(await f.read()).jobs.find(j=>j.jobType==='document_ocr');
  assert.equal(job.state,'failed');assert.equal(job.running,false);assert.equal(job.errorCode,'retry_exhausted');
});

test('OCR success survives retry and failure and cannot be advanced by registration aftercheck updates',async t=>{
  const f=fixture(t);
  f.seed('document_automation',{owner:f.owner,email:'owner@example.test',enabled:1,updated_at:attempt});
  f.seed('documents',{id:'retained',owner:f.owner,filename:'synthetic.pdf',mime:'application/pdf',size:10,sha256:'a'.repeat(64),created_at:past});
  f.seed('gmail_sources',{owner:f.owner,source_id:'retained-source',document_id:'retained',metadata:'{}',created_at:past});
  const extraction=JSON.stringify({processing:{version:'document-worker-v3',sha256:'a'.repeat(64)}});
  f.seed('document_extractions',{id:'original-receipt',owner:f.owner,document_id:'retained',result:extraction,created_at:past});
  f.seed('document_jobs',{owner:f.owner,document_id:'retained',state:'queued',available_at:attempt,extraction,updated_at:attempt});
  for(const state of ['queued','failed','registered']){
    f.sql.prepare('UPDATE document_jobs SET state=?,updated_at=?').run(state,attempt);
    const job=(await f.read()).jobs.find(j=>j.jobType==='document_ocr');
    assert.equal(job.lastSuccessAt,past,state);
  }
});

test('a reconnect lock cannot turn an earlier interrupted Gmail attempt into a running sync',async t=>{
  const f=fixture(t);
  f.seed('document_automation',{owner:f.owner,email:'owner@example.test',enabled:1,updated_at:attempt});
  f.seed('gmail_connections',{owner:f.owner,email:'owner@example.test',tokens:'secret',last_attempt:attempt,last_synced:past,status:'connected'});
  f.seed('gmail_locks',{owner:f.owner,token:'new-oauth-lock',expires_at:future});
  const job=(await f.read()).jobs.find(j=>j.jobType==='gmail_sync');
  assert.equal(job.running,false);assert.equal(job.state,'retry_wait');assert.equal(job.errorCode,'worker_unconfirmed');
});

test('known bank failure cannot appear successful when attempt timestamps coincide or the clock moves back',async t=>{
  const f=fixture(t);
  f.seed('bank_connections',{id:'failed-bank',owner:f.owner,app_generation:'g',environment:'PRODUCTION',bank_name:'synthetic',country:'SE',encrypted_session:'private-session',encrypted_accounts:'private-accounts',valid_until:future,date_from:'2026-10-01',status:'connected',last_synced_at:attempt,auto_last_attempt_at:attempt,auto_sync_enabled:1,sync_failures:1,created_at:past,updated_at:attempt});
  for(const attemptAt of [attempt,past]){
    f.sql.prepare('UPDATE bank_connections SET auto_last_attempt_at=?').run(attemptAt);
    const job=(await f.read()).jobs.find(j=>j.jobType==='bank_sync');
    assert.equal(job.state,'retry_wait',attemptAt);assert.equal(job.running,false);
    assert.equal(job.lastSuccessAt,attempt);assert.equal(job.lastAttemptAt,attemptAt);
  }
});

test('Gmail retry evidence cannot appear successful when timestamps coincide or the clock moves back',async t=>{
  const f=fixture(t);
  f.seed('document_automation',{owner:f.owner,email:'owner@example.test',enabled:1,updated_at:attempt});
  f.seed('gmail_connections',{owner:f.owner,email:'owner@example.test',tokens:'private-token',last_attempt:attempt,last_synced:attempt,status:'retry_wait',retry_after:past,sync_failures:1});
  for(const attemptAt of [attempt,past]){
    f.sql.prepare('UPDATE gmail_connections SET last_attempt=?').run(attemptAt);
    const job=(await f.read()).jobs.find(j=>j.jobType==='gmail_sync');
    assert.equal(job.state,'retry_wait',attemptAt);assert.equal(job.running,false);
    assert.equal(job.lastSuccessAt,attempt);assert.equal(job.lastAttemptAt,attemptAt);
  }
  f.sql.prepare('UPDATE gmail_connections SET sync_failures=0').run();
  assert.equal((await f.read()).jobs.find(j=>j.jobType==='gmail_sync').state,'retry_wait');
});

test('stored source receipt preparation is read-only and uses actual acknowledged success',async()=>{
 const {prepareBankgiroImportSchedule}=await import('../lib/bankgiro-import-schedule.js');let calls=0;
 const sourceStatus={enabled:true,state:'IDLE',authorization:{status:'VERIFIED',verifiedAt:past,validUntil:future},lastSuccessAt:past,lastFailureAt:null,lastFailureCode:null,nextPollAt:future,counts:{}};
 const result=await prepareBankgiroImportSchedule({owner:'synthetic-owner',sourceStatus,intervalMinutes:15,adapters:new Map([['poison',{verifySource(){calls++;throw Error('must not call')}}]]),now});
 assert.equal(result.enabled,true);assert.equal(result.jobStatus.lastSuccessAt,past);assert.equal(result.intervalMinutes,15);assert.equal(calls,0);
});

test('stored report preparation preserves current blocked jobs and retry semantics over older success',async()=>{const {prepareBankgiroImportSchedule}=await import('../lib/bankgiro-import-schedule.js');const base={enabled:true,authorization:{status:'VERIFIED',validUntil:future},lastSuccessAt:past,nextPollAt:future};const blocked=await prepareBankgiroImportSchedule({owner:'synthetic-owner',sourceStatus:{...base,state:'BLOCKED',counts:{BLOCKED:1},lastError:null},now});assert.equal(blocked.jobStatus.state,'blocked');const retry=await prepareBankgiroImportSchedule({owner:'synthetic-owner',sourceStatus:{...base,state:'BACKOFF',lastError:'RATE_LIMITED'},now});assert.equal(retry.jobStatus.state,'retry_wait');assert.equal(retry.jobStatus.errorCode,'provider_rate_limited');});
