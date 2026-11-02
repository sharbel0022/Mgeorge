import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync, statSync, chmodSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parseEnv} from 'node:util';

const script=fileURLToPath(new URL('../scripts/configure-backup.mjs',import.meta.url));
const syntheticKey='21'.repeat(32);
function fixture(t,extra=''){
 const dir=mkdtempSync(join(tmpdir(),'mg-backup-config-test-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const backup=join(dir,'archives');mkdirSync(backup);
 const content=`BANK_DATA_KEY=${'35'.repeat(32)}\nSESSION_SECRET=synthetic-session-value\nMG_BACKUP_DIRECTORY='${backup}'\n${extra}`;
 writeFileSync(join(dir,'.env'),content,{mode:0o600});
 return {dir,backup,content,read:()=>readFileSync(join(dir,'.env'),'utf8')};
}
function run(f,hook){
 const args=[];
 if(hook){const file=join(f.dir,'fault.mjs');writeFileSync(file,hook);args.push('--import',file);}
 return spawnSync(process.execPath,[...args,script],{cwd:f.dir,encoding:'utf8',timeout:15000,env:process.env});
}

for(const line of ['', 'MG_BACKUP_KEY=\n'])test(`existing archives block new key generation when key is ${line?'empty':'missing'}`,t=>{
 const f=fixture(t,line),archive=join(f.backup,'mgeorge-2026-10-30.mgbak');
 const original=Buffer.from('synthetic retained archive');writeFileSync(archive,original);
 const result=run(f);
 assert.notEqual(result.status,0,'must not generate a different key for retained archives');
 assert.equal(f.read(),f.content);assert.deepEqual(readFileSync(archive),original);
});

test('a partial configuration write leaves all original secrets intact',t=>{
 const f=fixture(t,'MG_BACKUP_KEY=\n');
 const result=run(f,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
 const write=fs.writeFileSync;fs.writeFileSync=(path,data,...args)=>{write(path,String(data).slice(0,18),...args);throw Error('synthetic disk failure');};syncBuiltinESMExports();`);
 assert.notEqual(result.status,0);assert.equal(f.read(),f.content,'failed write must not truncate .env');
});

test('a configuration fsync failure cannot replace the previous configuration',t=>{
 const f=fixture(t,'MG_BACKUP_KEY=\n');
 const result=run(f,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';fs.fsyncSync=()=>{throw Error('synthetic flush failure');};syncBuiltinESMExports();`);
 assert.notEqual(result.status,0);assert.equal(f.read(),f.content);
});

test('a symlinked configuration is rejected without changing its target',t=>{
 const f=fixture(t,'MG_BACKUP_KEY=\n'),foreign=join(f.dir,'foreign-config');writeFileSync(foreign,f.content);
 rmSync(join(f.dir,'.env'));
 try{symlinkSync(foreign,join(f.dir,'.env'));}catch(error){if(process.platform==='win32'&&error.code==='EPERM'){t.skip('Windows file symlink privilege unavailable');return;}throw error;}
 const result=run(f);assert.notEqual(result.status,0);assert.equal(readFileSync(foreign,'utf8'),f.content);
});

test('valid existing key and quoted backup path survive configuration unchanged',t=>{
 const f=fixture(t,`MG_BACKUP_KEY=${syntheticKey}\n`),special=join(f.dir,'archive # retained');mkdirSync(special);
 const content=f.content.replace(`'${f.backup}'`,`'${special}'`);writeFileSync(join(f.dir,'.env'),content);
 const result=run(f);assert.equal(result.status,0,result.stderr);
 const parsed=parseEnv(f.read());assert.equal(parsed.MG_BACKUP_KEY,syntheticKey);assert.equal(parsed.MG_BACKUP_DIRECTORY,special);
 assert.equal(parsed.BANK_DATA_KEY,'35'.repeat(32));assert.equal(parsed.SESSION_SECRET,'synthetic-session-value');
 assert.ok(!result.stdout.includes(syntheticKey));
});

test('duplicate backup key assignments are rejected without choosing a hidden alternate key',t=>{
 const f=fixture(t,`MG_BACKUP_KEY=${syntheticKey}\nMG_BACKUP_KEY=${'43'.repeat(32)}\n`);
 const result=run(f);assert.notEqual(result.status,0);assert.equal(f.read(),f.content);
});

test('an existing configuration lock is preserved and blocks another writer',t=>{
 const f=fixture(t,'MG_BACKUP_KEY=\n'),lock=join(f.dir,'.env.backup-config.lock');
 writeFileSync(lock,'another writer');
 const result=run(f);assert.notEqual(result.status,0);assert.equal(f.read(),f.content);assert.equal(readFileSync(lock,'utf8'),'another writer');
});

test('silent short writes cannot publish a truncated configuration',t=>{
 const f=fixture(t,'MG_BACKUP_KEY=\n');
 const result=run(f,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
 const write=fs.writeFileSync;fs.writeFileSync=(path,data,...args)=>write(path,String(data).slice(0,18),...args);syncBuiltinESMExports();`);
 assert.notEqual(result.status,0);assert.equal(f.read(),f.content);
});

test('first setup creates one private key and repeated setup preserves it',t=>{
 const f=fixture(t,'MG_BACKUP_KEY=\n');
 if(process.platform!=='win32')chmodSync(join(f.dir,'.env'),0o644);
 let result=run(f);assert.equal(result.status,0,result.stderr);
 const first=parseEnv(f.read());assert.match(first.MG_BACKUP_KEY,/^[a-f0-9]{64}$/);assert.equal(first.MG_BACKUP_DIRECTORY,f.backup);
 if(process.platform!=='win32')assert.equal(statSync(join(f.dir,'.env')).mode&0o777,0o600);
 result=run(f);assert.equal(result.status,0,result.stderr);assert.deepEqual(parseEnv(f.read()),first);
 assert.deepEqual(readdirSync(f.backup),[]);
 assert.ok(!result.stdout.includes(first.MG_BACKUP_KEY));
});
