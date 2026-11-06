import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { jsUrl, moduleDirectory } from './loader-under-test.mjs';
import { jsUrl as legacyUrl } from './legacy-loader-under-test.mjs';
const root=dirname(fileURLToPath(import.meta.url));

test('the same source bytes preserve old cache identity and namespace reuse, including Unicode and Buffer input',async()=>{
 const source='export const label="Åäö 😀";export const state={count:0};';
 for(const url of [legacyUrl,jsUrl]){
  const first=url(source),second=url(Buffer.from(source));
  assert.equal(first,second);assert.notEqual(url(source+'\n'),first);
  const [a,b]=await Promise.all([import(first),import(second)]);
  assert.strictEqual(a,b);a.state.count++;assert.equal(b.state.count,1);
  assert.equal(a.label,'Åäö 😀');
 }
 const file=new URL(jsUrl(source));
 assert.equal(readFileSync(file,'utf8'),source);
 assert.equal(statSync(file).mode&0o777,0o600);
 assert.equal(statSync(moduleDirectory).mode&0o777,0o700);
});

test('simultaneously imported fixture graphs keep distinct identities without embedding nested source in module URLs',async()=>{
 const rows=[];
 try{
  for(let n=0;n<16;n++){
   const key='__independentBankLoader_'+crypto.randomUUID().replaceAll('-','');
   globalThis[key]={value:n};
   const sources=[`export const fixture=globalThis[${JSON.stringify(key)}];`];
   let url=jsUrl(sources[0]);const urls=[url];
   for(let level=0;level<5;level++){
    const source=`export {fixture} from ${JSON.stringify(url)};`;
    sources.push(source);url=jsUrl(source);urls.push(url);
   }
   rows.push({key,n,url,urls,sources});
  }
  const loaded=await Promise.all(rows.map(async row=>{
   const [first,again]=await Promise.all([import(row.url),import(row.url)]);
   assert.strictEqual(first,again);assert.strictEqual(first.fixture,globalThis[row.key]);
   assert.equal(first.fixture.value,row.n);first.fixture.value+=1000;
   assert.ok(row.urls.every(url=>url.length===row.urls[0].length),'nested references stay a constant length');
   assert.ok(row.sources.every(source=>Buffer.byteLength(source)<1024));
   return first.fixture;
  }));
  assert.equal(new Set(loaded).size,16);
  for(const row of rows)assert.equal(globalThis[row.key].value,row.n+1000);
 }finally{for(const row of rows)delete globalThis[row.key];}
});

test('an existing content-addressed file containing different bytes fails closed',()=>{
 const source='export const untouched="independent corruption boundary";';
 const file=new URL(jsUrl(source));
 writeFileSync(file,'export const unexpected=true;');
 assert.throws(()=>jsUrl(source),{message:'Synthetic module hash collision'});
});

for(const mode of ['success','failure'])test('whole-file cleanup runs after '+mode+' and does not remove modules before late awaited imports',()=>{
 const command=['--import',join(root,'candidate/scripts/saas-test-isolation.mjs'),'--experimental-strip-types','--test','--test-reporter=tap','--test-concurrency=1',join(root,'lifecycle-'+mode+'.test.mjs')];
 const result=spawnSync(process.execPath,command,{cwd:root,env:process.env,encoding:'utf8',timeout:30000});
 const output=(result.stdout||'')+(result.stderr||'');
 writeFileSync(join(root,'logs/lifecycle-'+mode+'.tap'),output,{flag:'wx'});
 assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,mode==='failure'?1:0);
 const match=output.match(/OWN_TEMP_DIR=([^\r\n]+)/);assert.ok(match,'child must record its own directory');
 assert.notEqual(match[1],moduleDirectory);assert.equal(dirname(match[1]),dirname(moduleDirectory));
 assert.equal(existsSync(match[1]),false,'after hook removes only the completed child harness directory');
 assert.equal(existsSync(moduleDirectory),true,'parent harness still has its own independent directory');
 assert.match(output,/# tests 2\n/);assert.match(output,/# cancelled 0\n/);
});
