import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createIntegrationJobs} from '../src/integration-jobs.js';

function fixture(t,options={}){
  const dir=mkdtempSync(join(tmpdir(),'mg-job-status-')),path=join(dir,'jobs.sqlite'),db=new DatabaseSync(path);
  let at=1_000_000;
  const jobs=createIntegrationJobs(db,{now:()=>at,leaseMs:1_000,...options});
  const peers=[];
  t.after(()=>{for(const peer of peers)peer.close();db.close();rmSync(dir,{recursive:true,force:true});});
  return {db,jobs,path,advance(ms){at+=ms;},status(){return jobs.summary()[0]?.jobStatus;},reopen(){const peer=new DatabaseSync(path);peers.push(peer);return createIntegrationJobs(peer,{now:()=>at,leaseMs:1_000,...options});}};
}

test('manual attempts record durable attempt time independently from successful fetch time',t=>{
  const f=fixture(t),first=f.jobs.claim('gmail');
  assert.equal(f.status()?.state,'running');
  assert.equal(f.status().lastAttemptAt,'1970-01-01T00:16:40.000Z');
  assert.equal(f.status().lastSuccessAt,null);
  assert.equal(f.status().attemptCount,1);
  f.advance(50);first.success();first.release();
  const succeeded=f.status();
  assert.equal(succeeded.state,'succeeded');
  assert.equal(succeeded.lastSuccessAt,'1970-01-01T00:16:40.050Z');
  assert.equal(succeeded.evidenceStatus,'REVIEW');
  f.advance(50);const second=f.jobs.claim('gmail');
  second.fail('Gmail-hämtningen behöver kontrolleras');second.release();
  const restarted=f.reopen().summary()[0].jobStatus;
  assert.equal(restarted.state,'retry_wait');
  assert.equal(restarted.lastAttemptAt,'1970-01-01T00:16:40.100Z');
  assert.equal(restarted.lastSuccessAt,succeeded.lastSuccessAt);
  assert.equal(restarted.attemptCount,2);
  assert.equal(restarted.fenceVersion,2);
});

test('a completed attempt cannot accept a second provider write or advance its success time',t=>{
  const f=fixture(t),lease=f.jobs.claim('gmail');let writes=0;
  lease.success();const completed=f.status()?.lastSuccessAt;
  f.advance(10);lease.success();
  assert.equal(f.status()?.lastSuccessAt,completed);
  assert.throws(()=>lease.write(()=>{writes++;}),{code:'integration_lease_lost'});
  assert.throws(()=>lease.fail('a delayed failure'),{code:'integration_lease_lost'});
  assert.equal(writes,0);lease.release();
});

test('provider retry deadlines survive reopening and stop manual as well as scheduled attempts',t=>{
  const f=fixture(t),lease=f.jobs.claim('gmail');
  lease.fail('Gmail-hämtningen behöver kontrolleras',120_000,false,'rate_limited');lease.release();
  const restarted=f.reopen();
  assert.throws(()=>restarted.claim('gmail'),error=>error.code==='integration_wait'&&error.retryAfter===120);
  assert.throws(()=>restarted.claim('gmail',{scheduled:true,interval:60_000}),{code:'integration_wait'});
  assert.equal(restarted.summary()[0].jobStatus?.nextAttemptAt,'1970-01-01T00:18:40.000Z');
  assert.equal(restarted.summary()[0].jobStatus.errorCode,'rate_limited');
  f.advance(120_001);const retry=restarted.claim('gmail');retry.success();retry.release();
  assert.equal(f.status().nextAttemptAt,null);
});

test('manual failures count toward unattended exhaustion while an explicit recovery can succeed',t=>{
  const f=fixture(t);
  for(let n=0;n<3;n++){
    const lease=f.jobs.claim('gmail');lease.fail('Gmail-hämtningen behöver kontrolleras');lease.release();f.advance(300_001);
  }
  assert.equal(f.jobs.summary()[0].blocked,true);
  assert.equal(f.status()?.state,'blocked');
  assert.throws(()=>f.reopen().claim('gmail',{scheduled:true,interval:60_000}),{code:'integration_blocked'});
  const recovery=f.jobs.claim('gmail');recovery.success();recovery.release();
  assert.equal(f.status().state,'succeeded');
  assert.equal(f.status().attemptCount,4);
});

test('renewal extends only a current lease and cannot exceed its absolute execution deadline',t=>{
  const f=fixture(t,{maxRunMs:2_500}),old=f.jobs.claim('gmail');
  assert.equal(typeof old.renew,'function');
  f.advance(750);old.renew();
  assert.equal(f.jobs.state('gmail').lease_until,1_001_750);
  f.advance(750);old.renew();
  assert.equal(f.jobs.state('gmail').lease_until,1_002_500);
  f.advance(750);old.renew();
  assert.equal(f.jobs.state('gmail').lease_until,1_002_500);
  f.advance(251);
  assert.throws(()=>old.renew(),{code:'integration_lease_lost'});
  const replacement=f.reopen().claim('gmail');
  assert.equal(f.status()?.fenceVersion,2);
  assert.throws(()=>old.renew(),{code:'integration_lease_lost'});
  old.release();replacement.assert();replacement.release();
});

test('a write that outlives its lease rolls back every synchronous database change',t=>{
  const f=fixture(t);f.db.exec('CREATE TABLE retained_originals(id TEXT PRIMARY KEY)');const lease=f.jobs.claim('gmail');
  assert.throws(()=>lease.write(()=>{f.db.prepare('INSERT INTO retained_originals VALUES(?)').run('synthetic-original');f.advance(1_001);}),{code:'integration_lease_lost'});
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM retained_originals').get().n,0);
  assert.equal(f.status()?.lastSuccessAt,null);
});

test('crashed process attempts recover durably without manufacturing a successful run',t=>{
  const f=fixture(t);
  const source=`import {DatabaseSync} from 'node:sqlite';import {createIntegrationJobs} from ${JSON.stringify(new URL('../src/integration-jobs.js',import.meta.url).href)};const db=new DatabaseSync(process.argv[1]);createIntegrationJobs(db,{now:()=>1000000,leaseMs:1000}).claim('gmail',{scheduled:true,interval:60000});db.close();`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',source,f.path],{encoding:'utf8',timeout:10_000});
  assert.equal(child.status,0,child.stderr);f.advance(1_001);
  const restarted=f.reopen(),status=restarted.summary()[0].jobStatus;
  assert.equal(status?.state,'retry_wait');
  assert.equal(status.errorCode,'integration_interrupted');
  assert.equal(status.lastSuccessAt,null);
  assert.equal(status.attemptCount,1);
  assert.equal(restarted.due('gmail',0,60_000),false);
  f.advance(60_000);assert.equal(restarted.due('gmail',0,60_000),true);
  const retry=restarted.claim('gmail',{scheduled:true,interval:60_000});retry.success();retry.release();
  assert.equal(restarted.summary()[0].jobStatus.attemptCount,2);
});

test('raw errors, URLs and tokens never enter the durable job record or public status',t=>{
  const f=fixture(t),lease=f.jobs.claim('gmail');
  lease.fail('Bearer synthetic-secret-token https://provider.invalid/account?iban=synthetic-private-account');lease.release();
  const text=JSON.stringify({row:f.jobs.state('gmail'),summary:f.jobs.summary()});
  assert.doesNotMatch(text,/synthetic-secret|synthetic-private|provider\.invalid|Bearer/);
  assert.equal(f.status()?.errorCode,'integration_failed');
  assert.equal(Object.hasOwn(f.jobs.summary()[0],'lease'),false);
});

test('credential-control success neither invents a fetch success nor clears its persisted retry barrier',t=>{
  const f=fixture(t),fetch=f.jobs.claim('gmail');
  fetch.fail('Gmail-hämtningen behöver kontrolleras',120_000,false,'rate_limited');fetch.release();
  f.advance(10);
  const control=f.jobs.claim('gmail',{recordAttempt:false});control.success();control.release();
  const status=f.status();
  assert.equal(status?.lastSuccessAt,null);
  assert.equal(status.lastAttemptAt,'1970-01-01T00:16:40.000Z');
  assert.equal(status.attemptCount,1);
  assert.equal(status.state,'retry_wait');
  assert.throws(()=>f.reopen().claim('gmail'),{code:'integration_wait'});
});

test('legacy coordinator upgrades preserve retry evidence without inventing historical success',t=>{
  const dir=mkdtempSync(join(tmpdir(),'mg-job-legacy-')),db=new DatabaseSync(join(dir,'jobs.sqlite'));
  t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
  db.exec("CREATE TABLE integration_jobs(name TEXT PRIMARY KEY,lease TEXT NOT NULL DEFAULT '',lease_until INTEGER NOT NULL DEFAULT 0,failures INTEGER NOT NULL DEFAULT 0,last_attempt INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '');INSERT INTO integration_jobs(name,failures,last_attempt,next_attempt,last_error) VALUES('gmail',1,1000000,1200000,'Gmail-hämtningen behöver kontrolleras');");
  const jobs=createIntegrationJobs(db,{now:()=>1_100_000}),status=jobs.summary()[0].jobStatus;
  assert.equal(status?.state,'retry_wait');
  assert.equal(status.lastAttemptAt,'1970-01-01T00:16:40.000Z');
  assert.equal(status.lastSuccessAt,null);
  assert.equal(status.attemptCount,null);
  assert.equal(jobs.due('gmail',0,60_000),false);
});

test('an unrepresentable provider retry deadline blocks retry without breaking the public status',t=>{
  const f=fixture(t),lease=f.jobs.claim('gmail');
  lease.fail('Gmail-hämtningen behöver kontrolleras',8_640_000_000_000_000,false,'rate_limited');lease.release();
  let snapshot;
  assert.doesNotThrow(()=>{snapshot=f.jobs.summary()[0].jobStatus;});
  assert.equal(snapshot.state,'blocked');assert.equal(snapshot.nextAttemptAt,null);
  assert.equal(snapshot.evidenceStatus,'BLOCKED');
  assert.throws(()=>f.reopen().claim('gmail'),{code:'integration_blocked'});
});

test('an unrepresentable legacy retry deadline remains blocked and never crashes status reads',t=>{
  const dir=mkdtempSync(join(tmpdir(),'mg-job-legacy-overflow-')),db=new DatabaseSync(join(dir,'jobs.sqlite'));
  t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
  db.exec("CREATE TABLE integration_jobs(name TEXT PRIMARY KEY,lease TEXT NOT NULL DEFAULT '',lease_until INTEGER NOT NULL DEFAULT 0,failures INTEGER NOT NULL DEFAULT 0,last_attempt INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '');INSERT INTO integration_jobs(name,failures,last_attempt,next_attempt,last_error) VALUES('gmail',1,1000000,8640000001000000,'Gmail-hämtningen behöver kontrolleras');");
  const jobs=createIntegrationJobs(db,{now:()=>1_100_000});let status;
  assert.doesNotThrow(()=>{status=jobs.summary()[0].jobStatus;});
  assert.equal(status.state,'blocked');assert.equal(status.nextAttemptAt,null);
  assert.throws(()=>jobs.claim('gmail'),{code:'integration_blocked'});
});
