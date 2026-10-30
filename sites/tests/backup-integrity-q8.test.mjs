import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {backupStep,backupStatus,sealBackup,unsealBackup,validateSnapshot} from '../lib/backup-engine.ts';

const owner='synthetic-backup-owner',key='a'.repeat(64),at=new Date('2026-10-30T10:00:00Z');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const id=index=>`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
function database(){
 const sql=new DatabaseSync(':memory:');
 for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 return sql;
}
function fixture(t,count=6){
 const sql=database();t.after(()=>sql.close());const objects=new Map(),gets=[],puts=[];
 const bucket={async get(path){gets.push(path);const bytes=objects.get(path);return bytes?{async arrayBuffer(){return bytes.slice().buffer;}}:null;},async put(path,bytes){puts.push(path);objects.set(path,new Uint8Array(bytes));}};
 const db={prepare(query){let args=[];return{bind(...values){args=values;return this;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return{results:sql.prepare(query).all(...args)};},async run(){return{meta:{changes:sql.prepare(query).run(...args).changes}};}};},async batch(statements){sql.exec('BEGIN');try{const out=[];for(const statement of statements)out.push(await statement.all());sql.exec('COMMIT');return out;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 const state={schemaVersion:1,invoices:[{id:'invoice',number:'SYNTHETIC-01',party:'Synthetic customer',total:62500}],transactions:[{id:'payment',amount:62500,currency:'SEK'}],allocations:[{id:'allocation',invoiceId:'invoice',transactionId:'payment',amount:62500}],credits:[],imports:[],receipts:[]};
 sql.prepare('INSERT INTO workspaces(owner,revision,payload,updated_at) VALUES(?,?,?,?)').run(owner,7,JSON.stringify(state),at.toISOString());
 sql.prepare('INSERT INTO workspaces(owner,revision,payload,updated_at) VALUES(?,?,?,?)').run('other-synthetic-owner',1,JSON.stringify({...state,private:'OTHER_OWNER'}),at.toISOString());
 for(let index=0;index<count;index++){
  const bytes=Buffer.from('%PDF-Synthetic retained original '+index);
  sql.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run(id(index),owner,'synthetic.pdf','application/pdf',bytes.length,hash(bytes),at.toISOString());
  objects.set(owner+'/'+id(index),new Uint8Array(bytes));
 }
 const row=()=>sql.prepare('SELECT * FROM backup_runs WHERE owner=?').get(owner);
 return{sql,db,bucket,objects,gets,puts,state,row,path:index=>row().snapshot_key.replace('snapshot.bin',id(index)+'.bin')};
}
async function finish(f,bucket=f.bucket,limit=5){
 let result;
 for(let step=0;step<20;step++){
  result=await backupStep(f.db,bucket,owner,key,at,limit);
  if(['complete','failed'].includes(result.status))return result;
 }
 assert.fail('synthetic backup did not finish within its bounded steps');
}

for(const damage of ['missing','corrupt','wrong owner'])test(`previously copied ${damage} original cannot become a completed resumed backup`,async t=>{
 const f=fixture(t),first=await backupStep(f.db,f.bucket,owner,key,at);
 assert.equal(first.status,'running');assert.equal(first.copied,5);
 const path=f.path(0),original=f.objects.get(owner+'/'+id(0)).slice(),snapshot=f.objects.get(f.row().snapshot_key).slice();
 if(damage==='missing')f.objects.delete(path);
 else if(damage==='corrupt'){const bytes=f.objects.get(path).slice();bytes[45]^=1;f.objects.set(path,bytes);}
 else f.objects.set(path,await sealBackup(original,key,'other-synthetic-owner',f.row().id,'document:'+id(0)));
 const result=await finish(f);
 assert.equal(result.status,'failed');assert.equal(result.verified_at,'');
 assert.equal((await backupStatus(f.db,owner)).last_verified,null);
 assert.deepEqual(f.objects.get(owner+'/'+id(0)),original,'source originals must be preserved');
 assert.deepEqual(f.objects.get(f.row().snapshot_key),snapshot,'the frozen snapshot must not be replaced');
});

test('copying and full-manifest verification use distinct bounded phases and restore exact money and original bytes',async t=>{
 const f=fixture(t),before=f.sql.prepare('SELECT payload FROM workspaces WHERE owner=?').get(owner).payload,steps=[];
 for(let count=0;count<10;count++){
  const getStart=f.gets.length,putStart=f.puts.length,result=await backupStep(f.db,f.bucket,owner,key,at);
  const originalsRead=f.gets.slice(getStart).filter(path=>path.startsWith(owner+'/'));
  const copiesRead=f.gets.slice(getStart).filter(path=>path.startsWith('backups/')&&!path.endsWith('/snapshot.bin'));
  assert.ok(originalsRead.length<=5);assert.ok(copiesRead.length<=5,'verification cannot become an unbounded final read');
  if(result.verification_started_at)assert.equal(f.puts.length,putStart,'verification does not rewrite encrypted originals');
  steps.push(result);if(result.status==='complete')break;
 }
 assert.equal(steps[0].status,'running');assert.equal(steps[0].copied,5);
 assert.equal(steps[1].status,'verifying');assert.equal(steps[1].copied,6);assert.equal(steps[1].verified_files,0);assert.equal(steps[1].verified_at,'');
 assert.equal(steps[2].status,'verifying');assert.equal(steps[2].verified_files,5);assert.ok(steps[2].verification_started_at);
 const completed=steps.at(-1);assert.equal(completed.status,'complete');assert.equal(completed.verified_files,6);
 assert.equal(completed.verification_scope,'manifest_pass');assert.equal(completed.verified_bytes,completed.bytes);
 assert.ok(completed.verified_at>=completed.verification_started_at);assert.equal(steps.length,4);
 const row=f.row(),snapshot=validateSnapshot(JSON.parse(new TextDecoder().decode(await unsealBackup(f.objects.get(row.snapshot_key),key,owner,row.id,'snapshot'))),owner);
 assert.equal(JSON.stringify(snapshot).includes('OTHER_OWNER'),false);
 const isolated=database();
 try{
  for(const table of snapshot.tables)for(const record of table.rows){const columns=Object.keys(record);isolated.prepare(`INSERT INTO ${table.name} (${columns.map(column=>'"'+column+'"').join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...Object.values(record));}
  assert.equal(isolated.prepare('SELECT payload FROM workspaces').get().payload,before);
  assert.equal(isolated.prepare('SELECT COUNT(*) count FROM documents').get().count,6);
  const restoredState=JSON.parse(isolated.prepare('SELECT payload FROM workspaces').get().payload);
  assert.equal(restoredState.allocations.reduce((sum,allocation)=>sum+allocation.amount,0),62500);
  for(const document of snapshot.tables.find(table=>table.name==='documents').rows){
   const bytes=await unsealBackup(f.objects.get(row.snapshot_key.replace('snapshot.bin',document.id+'.bin')),key,owner,row.id,'document:'+document.id);
   assert.equal(bytes.length,document.size);assert.equal(hash(bytes),document.sha256);
   assert.deepEqual(bytes,f.objects.get(owner+'/'+document.id));
  }
  assert.equal(isolated.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{isolated.close();}
 assert.equal(f.sql.prepare('SELECT payload FROM workspaces WHERE owner=?').get(owner).payload,before);
});

test('an interrupted verification pass restarts and detects a lost earlier verified object before completion',async t=>{
 const f=fixture(t);await backupStep(f.db,f.bucket,owner,key,at);assert.equal((await backupStep(f.db,f.bucket,owner,key,at)).status,'verifying');
 const saved=f.objects.get(f.path(0)).slice();let fail=true;
 const bucket={...f.bucket,async get(path){if(fail&&path===f.path(2))throw Error('synthetic interrupted storage read');return f.bucket.get(path);}};
 const interrupted=await backupStep(f.db,bucket,owner,key,at);
 assert.equal(interrupted.status,'failed');assert.equal(interrupted.verified_files,2);assert.equal(interrupted.copied,6);
 fail=false;f.objects.delete(f.path(0));
 const retried=await backupStep(f.db,bucket,owner,key,at);
 assert.equal(retried.status,'failed');assert.equal(retried.error,'backup_copy_missing');assert.equal(retried.verified_files,0);
 f.objects.set(f.path(0),saved);const recovered=await finish(f);
 assert.equal(recovered.status,'complete');assert.equal(recovered.attempts,2);assert.equal(recovered.copied,6);assert.equal(recovered.verified_files,6);
 assert.equal(recovered.bytes,recovered.verified_bytes);
});

test('a stale verification worker cannot checkpoint or release its replacement lease',async t=>{
 const f=fixture(t,2);assert.equal((await backupStep(f.db,f.bucket,owner,key,at)).status,'verifying');
 let reached,resume,paused=false;const ready=new Promise(resolve=>reached=resolve),gate=new Promise(resolve=>resume=resolve);
 const bucket={...f.bucket,async get(path){if(path===f.path(0)&&!paused){paused=true;reached();await gate;}return f.bucket.get(path);}};
 const stale=backupStep(f.db,bucket,owner,key,at);await ready;
 f.sql.prepare("UPDATE backup_runs SET lease_until='2000-01-01T00:00:00Z' WHERE owner=?").run(owner);
 const replacement=await backupStep(f.db,f.bucket,owner,key,at),before=f.row();
 assert.equal(replacement.status,'complete');assert.equal(replacement.attempts,1);
 resume();await stale;
 assert.deepEqual(f.row(),before);assert.equal(f.row().verification_cursor,2);
});

test('completion rechecks lease expiry inside the final database write',async t=>{
 const f=fixture(t,0),prepare=f.db.prepare.bind(f.db);let expired=false;
 const db={...f.db,prepare(query){const statement=prepare(query);if(query.startsWith('UPDATE backup_runs SET state=?,finished_at=')){const run=statement.run;statement.run=async()=>{if(!expired){expired=true;f.sql.prepare("UPDATE backup_runs SET lease_until='2000-01-01T00:00:00Z'").run();}return run.call(statement);};}return statement;}};
 const result=await backupStep(db,f.bucket,owner,key,at);
 assert.equal(result.status,'failed');assert.equal(result.error,'backup_lease_lost');assert.equal(result.verified_at,'');
 assert.equal((await backupStatus(f.db,owner)).last_verified,null);
});

for(const field of ['bytes','total_docs'])test(`stored ${field} must agree with the frozen manifest before a resumed backup can complete`,async t=>{
 const f=fixture(t);await backupStep(f.db,f.bucket,owner,key,at);
 f.sql.prepare(`UPDATE backup_runs SET ${field}=${field}+1 WHERE owner=?`).run(owner);
 const result=await finish(f);
 assert.equal(result.status,'failed');assert.equal(result.error,'backup_checkpoint_invalid');assert.equal(result.verified_at,'');
});

test('historical completed copies keep their original timestamp and expose their earlier verification scope',async t=>{
 const f=fixture(t,0),timestamp='2026-10-29T23:01:00.000Z';
 f.sql.prepare("INSERT INTO backup_runs(id,owner,day,state,cursor,total_docs,bytes,created_at,updated_at,finished_at) VALUES(?,?,?,'complete',1,1,123,?,?,?)").run('synthetic-legacy-backup',owner,'2026-10-30',timestamp,timestamp,timestamp);
 const result=await backupStep(f.db,f.bucket,owner,key,at);
 assert.equal(result.status,'complete');assert.equal(result.verified_at,timestamp);assert.equal(result.verification_started_at,'');
 assert.equal(result.verification_scope,'copy_readback');assert.equal(result.verified_files,0);
 assert.equal(f.gets.length,0);assert.equal(f.puts.length,0);
});
