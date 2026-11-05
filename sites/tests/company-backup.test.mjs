import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {backupStep,validateSnapshot,BACKUP_TABLES,unsealBackup} from '../lib/backup-engine.ts';
import {exportBackupBundle,verifyRecoveryBundle} from '../scripts/lib/backup-recovery.mjs';
import {restoreBackupIsolated} from '../scripts/restore-backup-isolated.mjs';

const key='9'.repeat(64),at=new Date('2026-11-04T12:00:00Z');
const boundary=(companyId='company-a',storageOwner='owner-a')=>({version:'company-data-boundary-v1',companyId,storageOwner,boundaryVersion:1});
function fixture(t,owner='owner-a'){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const objects=new Map(),id='00000000-0000-4000-8000-000000000001',bytes=new TextEncoder().encode('%PDF synthetic company original');
 const sha=createHash('sha256').update(bytes).digest('hex');
 sql.prepare('INSERT INTO workspaces(owner,revision,payload,updated_at) VALUES(?,?,?,?)').run(owner,43,JSON.stringify({invoices:[],transactions:[],allocations:[]}),at.toISOString());
 sql.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run(id,owner,'synthetic.pdf','application/pdf',bytes.length,sha,at.toISOString());
 objects.set(owner+'/'+id,bytes);
 const db={prepare(query){let args=[];return{bind(...values){args=values;return this;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return{results:sql.prepare(query).all(...args)};},async run(){return{meta:{changes:sql.prepare(query).run(...args).changes}};}};},async batch(statements){sql.exec('BEGIN');try{const values=[];for(const s of statements)values.push(await s.all());sql.exec('COMMIT');return values;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const bucket={async get(path){const bytes=objects.get(path);return bytes?{size:bytes.length,async arrayBuffer(){return bytes.slice().buffer;}}:null;},async put(path,bytes){objects.set(path,new Uint8Array(bytes));}};
 return {sql,db,bucket,objects,owner,id,bytes,row:()=>sql.prepare('SELECT * FROM backup_runs WHERE owner=?').get(owner)};
}
async function finish(f,companyBoundary){for(let n=0;n<8;n++){const result=await backupStep(f.db,f.bucket,f.owner,key,at,5,{companyBoundary});assert.notEqual(result.status,'failed',result.error);if(result.status==='complete')return result;}assert.fail('incomplete backup');}
async function bundle(f){const entries=new Map();await exportBackupBundle(f.bucket,f.row(),key,f.owner,async(path,bytes)=>entries.set(path,bytes.slice()));return{entries,source:{async get(path){return entries.get(path)?.slice()??null;},async list(){return [...entries.keys()];}}};}

test('company snapshot binding survives encrypted backup and rejects another tenant with the same owner',async t=>{
 const f=fixture(t),before=f.sql.prepare('SELECT * FROM workspaces').all();await finish(f,boundary());
 const plain=await unsealBackup(f.objects.get(f.row().snapshot_key),key,f.owner,f.row().id,'snapshot'),snapshot=JSON.parse(new TextDecoder().decode(plain));
 assert.deepEqual(snapshot.companyBoundary,boundary());assert.deepEqual(f.sql.prepare('SELECT * FROM workspaces').all(),before);
 assert.throws(()=>validateSnapshot(snapshot,f.owner,boundary('company-b')),/company|boundary/i);
 const {source}=await bundle(f),verified=await verifyRecoveryBundle(source,key,f.owner,f.row().id,{expectedCompanyBoundary:boundary()});
 assert.deepEqual(await verified.readOriginal(f.id),f.bytes);
 await assert.rejects(()=>verifyRecoveryBundle(source,key,f.owner,f.row().id,{expectedCompanyBoundary:boundary('company-b')}),/backup_recovery_/);
});

test('a legacy snapshot is preserved but cannot be relabelled as a newly selected company',async t=>{
 const f=fixture(t);await finish(f);const original=f.objects.get(f.row().snapshot_key).slice(),{source}=await bundle(f);
 assert.equal((await verifyRecoveryBundle(source,key,f.owner,f.row().id)).snapshot.companyBoundary,undefined);
 await assert.rejects(()=>verifyRecoveryBundle(source,key,f.owner,f.row().id,{expectedCompanyBoundary:boundary()}),/backup_recovery_/);
 await assert.rejects(()=>backupStep(f.db,f.bucket,f.owner,key,at,5,{companyBoundary:boundary()}),/company|boundary/i);
 assert.deepEqual(f.objects.get(f.row().snapshot_key),original);
});

test('invalid namespace binding fails before a snapshot run or object can be created',async t=>{
 const f=fixture(t),objects=f.objects.size;
 await assert.rejects(()=>backupStep(f.db,f.bucket,f.owner,key,at,5,{companyBoundary:boundary('company-a','owner-b')}),/company|boundary/i);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM backup_runs').get().n,0);assert.equal(f.objects.size,objects);
 const empty={format:'MG-Sites-backup-1',owner:f.owner,tables:BACKUP_TABLES.map(name=>({name,rows:[]})),companyBoundary:boundary('company-a','owner-b')};
 assert.throws(()=>validateSnapshot(empty,f.owner),/company|boundary/i);
});

test('isolated restore verifies company before creating evidence output and records the original boundary',async t=>{
 const f=fixture(t);await finish(f,boundary());const {entries}=await bundle(f),folder=mkdtempSync(join(tmpdir(),'mg-company-restore-'));
 t.after(()=>rmSync(folder,{recursive:true,force:true}));const bundleDirectory=join(folder,'bundle'),outputParent=join(folder,'output');mkdirSync(bundleDirectory,{mode:0o700});mkdirSync(outputParent,{mode:0o700});
 for(const [path,bytes]of entries){mkdirSync(dirname(join(bundleDirectory,path)),{recursive:true,mode:0o700});writeFileSync(join(bundleDirectory,path),bytes,{mode:0o600});}
 const options={bundleDirectory,outputParent,key,expectedOwner:f.owner,expectedBackupId:f.row().id};
 await assert.rejects(()=>restoreBackupIsolated({...options,expectedCompanyBoundary:boundary('company-b')}),/backup_recovery_/);assert.deepEqual(readdirSync(outputParent),[]);
 const result=await restoreBackupIsolated({...options,expectedCompanyBoundary:boundary()});
 assert.deepEqual(JSON.parse(readFileSync(join(result.directory,'receipt.json'),'utf8')).companyBoundary,boundary());
 assert.deepEqual(new Uint8Array(readFileSync(join(result.directory,'originals',f.id+'.bin'))),f.bytes);
 const recovered=new DatabaseSync(join(result.directory,'evidence.sqlite'),{readOnly:true});
 try{for(const table of ['companies','company_memberships','company_user_contexts','company_worker_grants','company_operation_guard'])assert.equal(recovered.prepare('SELECT count(*) n FROM evidence_'+table).get().n,0);}finally{recovered.close();}
});
