import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createIntegrationJobs} from '../src/integration-jobs.js';

function fixture(t){const dir=mkdtempSync(join(tmpdir(),'mg-jobs-')),path=join(dir,'db.sqlite'),a=new DatabaseSync(path),b=new DatabaseSync(path);let at=1000000;t.after(()=>{a.close();b.close();rmSync(dir,{recursive:true,force:true});});return{a:createIntegrationJobs(a,{now:()=>at,leaseMs:1000}),b:createIntegrationJobs(b,{now:()=>at,leaseMs:1000}),advance(ms){at+=ms;}};}
test('leases span independent database connections and stale owners cannot write or release replacements',t=>{const f=fixture(t),old=f.a.claim('bank:one');assert.throws(()=>f.b.claim('bank:one'),{code:'integration_busy'});f.advance(1001);const current=f.b.claim('bank:one');assert.throws(()=>old.assert(),{code:'integration_lease_lost'});assert.throws(()=>old.success(),{code:'integration_lease_lost'});assert.throws(()=>old.fail('delayed failure'),{code:'integration_lease_lost'});old.release();assert.equal(f.a.running('bank:one'),true);current.assert();current.release();assert.equal(f.a.running('bank:one'),false);});
test('scheduled crashes preserve cooldown and stop after three attempts until a manual success',t=>{const f=fixture(t);for(let n=0;n<3;n++){const lease=f.a.claim('gmail',{scheduled:true,interval:60000});assert.equal(f.b.due('gmail',0,60000),false);f.advance(1001);assert.throws(()=>lease.assert(),{code:'integration_lease_lost'});f.advance(300000);}assert.equal(f.b.summary()[0].blocked,true);assert.throws(()=>f.b.claim('gmail',{scheduled:true,interval:60000}),{code:'integration_blocked'});const manual=f.b.claim('gmail');manual.success();manual.release();assert.equal(f.a.summary()[0].blocked,false);assert.equal(f.a.state('gmail').last_error,'');});
test('failed scheduled attempts retain backoff and safe alarm after reopening the coordinator',t=>{const f=fixture(t),lease=f.a.claim('gmail',{scheduled:true,interval:900000});lease.fail('Gmail-hämtningen behöver kontrolleras',1800000);lease.release();assert.equal(f.b.due('gmail',0,900000),false);assert.equal(f.b.summary()[0].last_error,'Gmail-hämtningen behöver kontrolleras');f.advance(1800001);assert.equal(f.b.due('gmail',0,900000),true);});
test('an actual second Node process cannot acquire an active bank lease',t=>{
 const dir=mkdtempSync(join(tmpdir(),'mg-jobs-process-')),path=join(dir,'db.sqlite'),db=new DatabaseSync(path),jobs=createIntegrationJobs(db),lease=jobs.claim('bank:synthetic');
 t.after(()=>{lease.release();db.close();rmSync(dir,{recursive:true,force:true});});
 const source=`import {DatabaseSync} from 'node:sqlite';import {createIntegrationJobs} from ${JSON.stringify(new URL('../src/integration-jobs.js',import.meta.url).href)};const db=new DatabaseSync(process.argv[1]);try{createIntegrationJobs(db).claim('bank:synthetic');process.exitCode=2;}catch(e){if(e.code!=='integration_busy')throw e;}finally{db.close();}`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',source,path],{encoding:'utf8',timeout:10000});assert.equal(child.status,0,child.stderr);lease.assert();
});
test('a replacement installed before the write transaction prevents every stale credential or status write',t=>{
 const dir=mkdtempSync(join(tmpdir(),'mg-jobs-write-fence-')),path=join(dir,'db.sqlite'),sql=new DatabaseSync(path),other=new DatabaseSync(path);let replace=false,writes=0;
 t.after(()=>{sql.close();other.close();rmSync(dir,{recursive:true,force:true});});
 const db={prepare:text=>sql.prepare(text),exec(text){if(replace&&text==='BEGIN IMMEDIATE'){replace=false;other.prepare("UPDATE integration_jobs SET lease='replacement',lease_until=?,last_error='new owner' WHERE name='gmail'").run(Date.now()+60000);}return sql.exec(text);}};
 const jobs=createIntegrationJobs(db),lease=jobs.claim('gmail');lease.assert();replace=true;
 assert.throws(()=>lease.write(()=>{writes++;}),{code:'integration_lease_lost'});assert.equal(writes,0);
 assert.throws(()=>lease.success(),{code:'integration_lease_lost'});assert.throws(()=>lease.fail('old failure'),{code:'integration_lease_lost'});lease.release();
 assert.equal(jobs.state('gmail').lease,'replacement');assert.equal(jobs.state('gmail').last_error,'new owner');
});
