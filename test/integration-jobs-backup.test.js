import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase} from '../src/db.js';
import {createBackup,restoreBackup,verifyBackup} from '../src/backup.js';
import {createIntegrationJobs} from '../src/integration-jobs.js';

test('encrypted recovery preserves the complete job schema, receipts and retry barriers before safely recovering an abandoned lease',t=>{
  const folder=mkdtempSync(join(tmpdir(),'mg-job-backup-')),source=join(folder,'source.sqlite');
  const archive=join(folder,'synthetic.mgbak'),target=join(folder,'restored.sqlite'),key='a'.repeat(64);
  const db=openDatabase(source);let restored;
  t.after(()=>{restored?.close();db.close();rmSync(folder,{recursive:true,force:true});});
  let at=Date.parse('2026-11-02T10:00:00.000Z');
  const jobs=createIntegrationJobs(db,{now:()=>at,leaseMs:1_000});

  const successful=jobs.claim('gmail');at+=10;successful.success();successful.release();
  const credentials=jobs.claim('gmail',{recordAttempt:false});credentials.success();credentials.release();
  const limited=jobs.claim('bank:synthetic-cooldown');
  limited.fail('Bankens anropsgräns är nådd. Försök igen senare.',120_000,false,'rate_limited');limited.release();
  const blocked=jobs.claim('bank:synthetic-unknown');
  blocked.fail('Hämtningen misslyckades. Kontrollera anslutningen och försök igen.',0,true,'retry_after_unknown');blocked.release();
  jobs.claim('bank:synthetic-abandoned',{scheduled:true,interval:60_000});
  at+=1_001;

  const census=sql=>sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  const schema=sql=>({definition:sql.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='integration_jobs'").get(),columns:sql.prepare('PRAGMA table_info(integration_jobs)').all()});
  const rows=sql=>sql.prepare('SELECT * FROM integration_jobs ORDER BY name').all();
  const before={census:census(db),schema:schema(db),rows:rows(db)};
  assert.equal(createBackup(source,archive,key).verified,true);
  assert.equal(verifyBackup(archive,key).verified,true);
  assert.equal(restoreBackup(archive,target,key).restored,true);
  restored=new DatabaseSync(target);

  // Recovery adds exactly one explicit app-token quarantine table. Every
  // pre-existing job table/column/row still has to match without exclusions.
  const expectedCensus=[...before.census.map(row=>({...row})),{name:'company_application_token_control'}].sort((a,b)=>a.name.localeCompare(b.name));
  assert.deepEqual(census(restored).map(row=>({...row})),expectedCensus);
  const gate={...restored.prepare('SELECT * FROM company_application_token_control').get()};
  assert.match(gate.restore_marker,/^[a-f0-9]{64}$/);
  assert.deepEqual(gate,{id:1,revision:1,recovery_required:1,restore_marker:gate.restore_marker,recovery_evidence:''});
  assert.equal(restored.prepare('SELECT COUNT(*) n FROM company_application_token_control').get().n,1);
  assert.deepEqual(schema(restored),before.schema);
  assert.deepEqual(rows(restored),before.rows);
  assert.deepEqual(rows(db),before.rows,'creating and restoring the archive does not activate source jobs');

  const recovered=createIntegrationJobs(restored,{now:()=>at,leaseMs:1_000});
  const statuses=new Map(recovered.summary().map(job=>[job.name,job.jobStatus]));
  const success=statuses.get('gmail');
  assert.equal(success.state,'succeeded');assert.equal(success.lastSuccessAt,'2026-11-02T10:00:00.010Z');
  assert.equal(success.lastAttemptAt,'2026-11-02T10:00:00.000Z');assert.equal(success.attemptCount,1);assert.equal(success.fenceVersion,2);
  assert.equal(success.evidenceStatus,'REVIEW');
  const cooldown=statuses.get('bank:synthetic-cooldown');
  assert.equal(cooldown.state,'retry_wait');assert.equal(cooldown.nextAttemptAt,'2026-11-02T10:02:00.010Z');
  assert.equal(cooldown.lastSuccessAt,null);assert.equal(cooldown.attemptCount,1);assert.equal(cooldown.fenceVersion,1);
  assert.throws(()=>recovered.claim('bank:synthetic-cooldown'),{code:'integration_wait'});
  assert.equal(recovered.due('bank:synthetic-cooldown',0,60_000),false);
  const unknown=statuses.get('bank:synthetic-unknown');
  assert.equal(unknown.state,'blocked');assert.equal(unknown.nextAttemptAt,null);assert.equal(unknown.lastSuccessAt,null);
  assert.equal(unknown.evidenceStatus,'BLOCKED');
  assert.throws(()=>recovered.claim('bank:synthetic-unknown'),{code:'integration_blocked'});
  assert.equal(recovered.due('bank:synthetic-unknown',0,60_000),false);
  const abandoned=statuses.get('bank:synthetic-abandoned');
  assert.equal(abandoned.state,'retry_wait');assert.equal(abandoned.errorCode,'integration_interrupted');
  assert.equal(abandoned.lastSuccessAt,null);assert.equal(abandoned.attemptCount,1);assert.equal(abandoned.fenceVersion,1);
  assert.equal(recovered.running('bank:synthetic-abandoned'),false);
  assert.equal(recovered.due('bank:synthetic-abandoned',0,60_000),false);
  assert.deepEqual(census(restored).map(row=>({...row})),expectedCensus,'coordinator reopen adds no additional table');
  assert.deepEqual({...restored.prepare('SELECT * FROM company_application_token_control').get()},gate,'job recovery does not reactivate app tokens');
  assert.deepEqual(schema(restored),before.schema);
  assert.deepEqual(rows(db),before.rows,'recovery changes only the isolated restored database');
});
