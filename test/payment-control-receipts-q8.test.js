import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPaymentControl,CONTROL_STEPS} from '../src/payment-control.js';

const originalId='request_original_00000001',aliasId='request_alias_00000000002';
function fixture(t){
 const folder=mkdtempSync(join(tmpdir(),'mg-control-receipts-')),path=join(folder,'synthetic.sqlite'),connections=[],controls=[],calls=[];
 let at=Date.now();
 const open=()=>{const sql=new DatabaseSync(path);sql.exec('PRAGMA busy_timeout=5000');connections.push(sql);return sql;};
 const db=open();
 const make=(sql=db,overrides={})=>{const adapters=Object.fromEntries(CONTROL_STEPS.map(([step])=>[step,async({owner})=>{calls.push({step,owner});return{state:'done'};}]));const control=createPaymentControl(sql,{adapters:{...adapters,...overrides},summarize:()=>({}),now:()=>at});controls.push(control);return control;};
 t.after(()=>{controls.forEach(control=>control.stop());connections.forEach(sql=>sql.close());rmSync(folder,{recursive:true,force:true});});
 return{db,path,open,make,calls,now:()=>at,advance:ms=>at+=ms};
}

test('an alias accepted during a running control survives completion, cooldown and restart',async t=>{
 const f=fixture(t);let release;const gate=new Promise(resolve=>release=resolve);
 const first=f.make(f.db,{gmail:async({owner})=>{f.calls.push({step:'gmail',owner});await gate;return{state:'done'};}});
 const original=first.start('alice',originalId,()=>{});await Promise.resolve();
 const accepted=first.start('alice',aliasId,()=>{});assert.equal(accepted.reused,true);assert.equal(accepted.job.id,original.job.id);
 release();await first.wait(original.job.id);first.stop();f.advance(61000);
 const restarted=f.make(f.open()),retry=restarted.start('alice',aliasId,()=>{});await restarted.wait(retry.job.id);
 assert.equal(retry.job.id,original.job.id);assert.equal(retry.reused,true);assert.equal(f.calls.length,5);
 assert.equal(f.db.prepare('SELECT COUNT(*) count FROM payment_control_runs').get().count,1);
});

test('an alias accepted during cooldown remains the same receipt after cooldown ends',async t=>{
 const f=fixture(t),first=f.make(),original=first.start('alice',originalId,()=>{});await first.wait(original.job.id);
 const accepted=first.start('alice',aliasId,()=>{});assert.equal(accepted.job.id,original.job.id);assert.equal(accepted.reused,true);
 first.stop();f.advance(61000);
 const restarted=f.make(f.open()),retry=restarted.start('alice',aliasId,()=>{});await restarted.wait(retry.job.id);
 assert.equal(retry.job.id,original.job.id);assert.equal(retry.reused,true);assert.equal(f.calls.length,5);
});

function childAlias(path,requestId,at){
 const source=`import {DatabaseSync} from 'node:sqlite';import {createPaymentControl,CONTROL_STEPS} from ${JSON.stringify(new URL('../src/payment-control.js',import.meta.url).href)};const db=new DatabaseSync(process.argv[1]);db.exec('PRAGMA busy_timeout=5000');const control=createPaymentControl(db,{now:()=>Number(process.argv[3]),summarize:()=>({}),adapters:Object.fromEntries(CONTROL_STEPS.map(([step])=>[step,async()=>{throw Error('An existing run must not execute another adapter');}]))});try{const result=control.start('alice',process.argv[2],()=>{});await control.wait(result.job.id);process.stdout.write(JSON.stringify({id:result.job.id,reused:result.reused}));}finally{control.stop();db.close();}`;
 return new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--input-type=module','-e',source,path,requestId,String(at)],{stdio:['ignore','pipe','pipe'],timeout:10000});let out='',error='';child.stdout.on('data',data=>out+=data);child.stderr.on('data',data=>error+=data);child.on('error',reject);child.on('close',code=>{if(code!==0)return reject(Error('Synthetic receipt process failed: '+error));try{resolve(JSON.parse(out));}catch(cause){reject(cause);}});});
}

test('independent concurrent processes persist distinct and repeated aliases to one active run',async t=>{
 const f=fixture(t);let release;const gate=new Promise(resolve=>release=resolve);
 const first=f.make(f.db,{gmail:async({owner})=>{f.calls.push({step:'gmail',owner});await gate;return{state:'done'};}});
 const original=first.start('alice',originalId,()=>{});await Promise.resolve();
 const secondAlias='request_alias_00000000003';
 let accepted;
 try{accepted=await Promise.all([childAlias(f.path,aliasId,f.now()),childAlias(f.path,secondAlias,f.now()),childAlias(f.path,aliasId,f.now())]);}
 finally{release();await first.wait(original.job.id);}
 assert.ok(accepted.every(result=>result.id===original.job.id&&result.reused));
 first.stop();f.advance(61000);const restarted=f.make(f.open());
 for(const requestId of [aliasId,secondAlias]){const retry=restarted.start('alice',requestId,()=>{});await restarted.wait(retry.job.id);assert.equal(retry.job.id,original.job.id);assert.equal(retry.reused,true);}
 assert.equal(f.db.prepare('SELECT COUNT(*) count FROM payment_control_requests').get().count,3);
 assert.equal(f.db.prepare('SELECT COUNT(*) count FROM payment_control_runs').get().count,1);assert.equal(f.calls.length,5);
});

test('legacy run request IDs are migrated without changing their completed history',async t=>{
 const f=fixture(t),first=f.make(),original=first.start('alice',originalId,()=>{});await first.wait(original.job.id);first.stop();
 const before=f.db.prepare('SELECT * FROM payment_control_runs').get();
 f.db.exec('DROP TABLE IF EXISTS payment_control_requests');f.advance(61000);
 const restarted=f.make(f.open()),retry=restarted.start('alice',originalId,()=>{});await restarted.wait(retry.job.id);
 assert.equal(retry.job.id,original.job.id);assert.equal(retry.reused,true);assert.equal(f.calls.length,5);
 assert.deepEqual(f.db.prepare('SELECT * FROM payment_control_runs').get(),before);
 assert.ok(f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='payment_control_requests'").get(),'legacy runs need durable original receipts');
 assert.deepEqual({...f.db.prepare('SELECT owner,request_id,run_id FROM payment_control_requests').get()},{owner:'alice',request_id:originalId,run_id:original.job.id});
});

test('a failed receipt write rolls back a new run before any adapter is scheduled',async t=>{
 const f=fixture(t);
 f.db.exec(`CREATE TABLE payment_control_requests(owner TEXT NOT NULL,request_id TEXT NOT NULL,run_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(owner,request_id));
 CREATE TRIGGER synthetic_receipt_failure BEFORE INSERT ON payment_control_requests BEGIN SELECT RAISE(ABORT,'synthetic receipt write failed'); END;`);
 const control=f.make();let failure,accepted;
 try{accepted=control.start('alice',originalId,()=>{});}catch(error){failure=error;}
 if(accepted)await control.wait(accepted.job.id);
 assert.match(failure?.message||'',/synthetic receipt write failed/);
 assert.equal(f.db.prepare('SELECT COUNT(*) count FROM payment_control_runs').get().count,0);assert.equal(f.calls.length,0);
});

test('receipt aliases are owner scoped and a genuinely new request after cooldown still runs',async t=>{
 const f=fixture(t),control=f.make(),original=control.start('alice',originalId,()=>{});await control.wait(original.job.id);
 assert.equal(control.start('alice',aliasId,()=>{}).job.id,original.job.id);
 const other=control.start('bob',aliasId,()=>{});await control.wait(other.job.id);assert.notEqual(other.job.id,original.job.id);
 f.advance(61000);
 const replay=control.start('alice',aliasId,()=>{});await control.wait(replay.job.id);assert.equal(replay.job.id,original.job.id);
 const fresh=control.start('alice','request_genuinely_new_00004',()=>{});await control.wait(fresh.job.id);
 assert.equal(fresh.reused,false);assert.notEqual(fresh.job.id,original.job.id);
 assert.equal(f.calls.filter(call=>call.owner==='alice').length,10);assert.equal(f.calls.filter(call=>call.owner==='bob').length,5);
 assert.throws(()=>control.start('alice',aliasId,()=>{throw Object.assign(Error('Session revoked'),{status:401});}),{status:401});
});
