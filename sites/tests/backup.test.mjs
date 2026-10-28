import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';import {readFileSync,readdirSync} from 'node:fs';import {createHash} from 'node:crypto';
import {backupStep,backupStatus,sealBackup,unsealBackup,validateSnapshot,BACKUP_TABLES} from '../lib/backup-engine.ts';
const key='a'.repeat(64),owner='owner-a',date=new Date('2026-10-28T20:00:00Z');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function database(){const sql=new DatabaseSync(':memory:');for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));return sql;}
function fixture(t,count=7){const sql=database();t.after(()=>sql.close());const objects=new Map();let puts=0,gets=0;
 const bucket={async put(k,b){puts++;objects.set(k,new Uint8Array(b));},async get(k){gets++;const b=objects.get(k);return b?{async arrayBuffer(){return b.slice().buffer;}}:null;}};
 const db={prepare(text){let values=[];return{bind(...v){values=v;return this;},async first(){return sql.prepare(text).get(...values)||null;},async all(){return{results:sql.prepare(text).all(...values)};},async run(){return{meta:{changes:sql.prepare(text).run(...values).changes}};}};},async batch(statements){sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.all());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const state={schemaVersion:1,invoices:[{id:'invoice',number:'0599',party:'Fiktiv kund',total:62500}],transactions:[],allocations:[],credits:[],imports:[],receipts:[]};
 sql.prepare('INSERT INTO workspaces(owner,revision,payload,updated_at) VALUES(?,?,?,?)').run(owner,4,JSON.stringify(state),date.toISOString());sql.prepare('INSERT INTO workspaces(owner,revision,payload,updated_at) VALUES(?,?,?,?)').run('owner-b',1,JSON.stringify({...state,secret:'OTHER_OWNER_PRIVATE'}),date.toISOString());
 for(let n=0;n<count;n++){const id=`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,bytes=Buffer.from('Syntetisk PDF '+n);sql.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run(id,owner,'original.pdf','application/pdf',bytes.length,sha(bytes),date.toISOString());objects.set(owner+'/'+id,new Uint8Array(bytes));}
 return{db,sql,bucket,objects,state,stats:()=>({puts,gets})};}
test('backup encrypts authenticated envelopes and rejects wrong owner, object, key and tampering',async()=>{const plain=new TextEncoder().encode('Privat ekonomiskt original'),encrypted=await sealBackup(plain,key,owner,'backup-id','snapshot');assert.equal(Buffer.from(encrypted).includes(Buffer.from(plain)),false);assert.deepEqual(await unsealBackup(encrypted,key,owner,'backup-id','snapshot'),plain);for(const [k,o,id,name]of [['b'.repeat(64),owner,'backup-id','snapshot'],[key,'owner-b','backup-id','snapshot'],[key,owner,'backup-id','document:other'],[key,owner,'other-id','snapshot']])await assert.rejects(()=>unsealBackup(encrypted,k,o,id,name));encrypted[40]^=1;await assert.rejects(()=>unsealBackup(encrypted,key,owner,'backup-id','snapshot'));});
test('snapshot and every original are resumable, authenticated and restorable into an isolated database',async t=>{const f=fixture(t),before=f.sql.prepare('SELECT payload FROM workspaces WHERE owner=?').get(owner).payload;let r=await backupStep(f.db,f.bucket,owner,key,date);assert.equal(r.status,'running');assert.equal(r.copied,5);r=await backupStep(f.db,f.bucket,owner,key,date);assert.equal(r.status,'complete');assert.equal(r.files,7);assert.equal(r.copied,7);assert.ok(r.verified_at);const puts=f.stats().puts;assert.equal((await backupStep(f.db,f.bucket,owner,key,date)).id,r.id);assert.equal(f.stats().puts,puts);assert.equal(f.sql.prepare('SELECT payload FROM workspaces WHERE owner=?').get(owner).payload,before);
 const row=f.sql.prepare('SELECT * FROM backup_runs').get();const snapshot=JSON.parse(new TextDecoder().decode(await unsealBackup(f.objects.get(row.snapshot_key),key,owner,row.id,'snapshot')));assert.ok(!JSON.stringify(snapshot).includes('OTHER_OWNER_PRIVATE'));validateSnapshot(snapshot,owner);
 const restored=database();try{for(const table of snapshot.tables)for(const row of table.rows){const cols=Object.keys(row);restored.prepare(`INSERT INTO ${table.name} (${cols.map(c=>'"'+c+'"').join(',')}) VALUES (${cols.map(()=>'?').join(',')})`).run(...Object.values(row));}assert.equal(restored.prepare('SELECT payload FROM workspaces').get().payload,before);assert.equal(restored.prepare('SELECT COUNT(*) n FROM documents').get().n,7);assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');}finally{restored.close();}
 for(const file of snapshot.tables.find(t=>t.name==='documents').rows){const blob=f.objects.get(row.snapshot_key.replace('snapshot.bin',file.id+'.bin'));assert.deepEqual(await unsealBackup(blob,key,owner,row.id,'document:'+file.id),f.objects.get(owner+'/'+file.id));}
 assert.equal((await backupStatus(f.db,'owner-b')).latest,null);
});
test('missing original fails visibly, then resumes from the last copied file without changing finances',async t=>{const f=fixture(t,2),missing=owner+'/00000000-0000-4000-8000-000000000001',content=f.objects.get(missing);f.objects.delete(missing);let r=await backupStep(f.db,f.bucket,owner,key,date);assert.equal(r.status,'failed');assert.equal(r.copied,1);assert.equal(r.error,'backup_original_missing');f.objects.set(missing,content);r=await backupStep(f.db,f.bucket,owner,key,date);assert.equal(r.status,'complete');assert.equal(r.copied,2);assert.equal(r.attempts,1);});
test('altered source hashes prevent a false successful backup and retries are bounded',async t=>{const f=fixture(t,1);f.objects.set(owner+'/00000000-0000-4000-8000-000000000000',new Uint8Array([1,2,3]));for(let n=0;n<3;n++)assert.equal((await backupStep(f.db,f.bucket,owner,key,date)).status,'failed');const gets=f.stats().gets;assert.equal((await backupStep(f.db,f.bucket,owner,key,date)).attempts,3);assert.equal(f.stats().gets,gets);assert.equal((await backupStatus(f.db,owner)).last_verified,null);});
test('an active lease prevents duplicate work and new Stockholm dates create separate snapshots',async t=>{const f=fixture(t,0);let r=await backupStep(f.db,f.bucket,owner,key,date);assert.equal(r.status,'complete');r=await backupStep(f.db,f.bucket,owner,key,new Date('2026-10-28T23:00:00Z'));assert.equal(r.day,'2026-10-29');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM backup_runs').get().n,2);f.sql.prepare("UPDATE backup_runs SET state='running',lease='other',lease_until=? WHERE day='2026-10-29'").run(new Date(Date.now()+60000).toISOString());assert.equal((await backupStep(f.db,f.bucket,owner,key,new Date('2026-10-28T23:00:00Z'))).busy,true);});
test('invalid key and owner-contaminated snapshots fail before producing a valid backup',async t=>{const f=fixture(t,0);await assert.rejects(()=>backupStep(f.db,f.bucket,owner,'bad',date));assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM backup_runs').get().n,0);const s={format:'MG-Sites-backup-1',owner,tables:BACKUP_TABLES.map(name=>({name,rows:[]}))};s.tables[0].rows.push({owner:'other'});assert.throws(()=>validateSnapshot(s,owner));});

function pauseInitialRead(db){
 let resume,reached,paused=false;
 const ready=new Promise(resolve=>{reached=resolve;}),gate=new Promise(resolve=>{resume=resolve;});
 return {ready,resume:()=>resume(),db:{...db,prepare(text){const statement=db.prepare(text);if(text==='SELECT * FROM backup_runs WHERE owner=? AND day=?'){
  const first=statement.first;statement.first=async function(){const row=await first.call(this);if(!paused){paused=true;reached();await gate;}return row;};
 }return statement;}}};
}

test('a delayed reader cannot overwrite an already verified snapshot after another worker completes',async t=>{
 const f=fixture(t,0),barrier=pauseInitialRead(f.db),late=backupStep(barrier.db,f.bucket,owner,key,date);
 await barrier.ready;
 const completed=await backupStep(f.db,f.bucket,owner,key,date),row=f.sql.prepare('SELECT * FROM backup_runs').get();
 const original=f.objects.get(row.snapshot_key).slice(),puts=f.stats().puts;
 f.sql.prepare('UPDATE workspaces SET revision=99 WHERE owner=?').run(owner);
 barrier.resume();const delayed=await late;
 assert.equal(completed.status,'complete');assert.equal(delayed.status,'complete');assert.equal(delayed.id,completed.id);
 assert.deepEqual(f.objects.get(row.snapshot_key),original,'a verified backup ID must retain its original encrypted snapshot');
 assert.equal(f.stats().puts,puts);
});

test('a delayed reader resumes from the current checkpoint instead of copying an old cursor',async t=>{
 const f=fixture(t,7),barrier=pauseInitialRead(f.db),late=backupStep(barrier.db,f.bucket,owner,key,date);
 await barrier.ready;const first=await backupStep(f.db,f.bucket,owner,key,date);assert.equal(first.copied,5);
 const original=f.objects.get(f.sql.prepare('SELECT snapshot_key FROM backup_runs').get().snapshot_key).slice();
 barrier.resume();const completed=await late;
 assert.equal(completed.status,'complete');assert.equal(completed.copied,7);assert.equal(completed.bytes,Array.from({length:7},(_,n)=>Buffer.byteLength('Syntetisk PDF '+n)).reduce((a,b)=>a+b,0));
 assert.deepEqual(f.objects.get(f.sql.prepare('SELECT snapshot_key FROM backup_runs').get().snapshot_key),original);
});

test('an expired worker cannot overwrite the replacement snapshot or release its lease',async t=>{
 const f=fixture(t,0);let resume,reached,paused=false;
 const gate=new Promise(resolve=>{resume=resolve;}),ready=new Promise(resolve=>{reached=resolve;});
 const bucket={...f.bucket,async put(path,bytes,options){if(path.endsWith('/snapshot.bin')&&!paused){paused=true;reached();await gate;}return f.bucket.put(path,bytes,options);}};
 const expired=backupStep(f.db,bucket,owner,key,date);await ready;
 f.sql.prepare("UPDATE backup_runs SET lease_until='2000-01-01T00:00:00Z'").run();
 f.sql.prepare('UPDATE workspaces SET revision=99 WHERE owner=?').run(owner);
 const replacement=await backupStep(f.db,bucket,owner,key,date),row=f.sql.prepare('SELECT * FROM backup_runs').get(),original=f.objects.get(row.snapshot_key).slice();
 resume();await expired;
 assert.equal(replacement.status,'complete');assert.deepEqual(f.objects.get(row.snapshot_key),original);
 assert.equal(f.sql.prepare('SELECT snapshot_key FROM backup_runs').get().snapshot_key,row.snapshot_key);
 const restored=JSON.parse(new TextDecoder().decode(await unsealBackup(original,key,owner,row.id,'snapshot')));
 assert.equal(restored.tables.find(table=>table.name==='workspaces').rows[0].revision,99);
});

test('a delayed reader respects a retry limit reached by another worker',async t=>{
 const f=fixture(t,1),barrier=pauseInitialRead(f.db);f.objects.delete(owner+'/00000000-0000-4000-8000-000000000000');
 const late=backupStep(barrier.db,f.bucket,owner,key,date);await barrier.ready;
 for(let n=0;n<3;n++)await backupStep(f.db,f.bucket,owner,key,date);
 const stats=f.stats();barrier.resume();const stopped=await late;
 assert.equal(stopped.attempts,3);assert.equal(stopped.status,'failed');assert.deepEqual(f.stats(),stats);
});
