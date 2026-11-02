import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
function compiled(path,imports){
 let code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 for(const [name,url]of Object.entries(imports))for(const quote of ['"',"'"])code=code.replaceAll(quote+name+quote,JSON.stringify(url));
 return data(code);
}
const environment=data('export const env=new Proxy({}, {get:(_,key)=>globalThis.uploadIntegrityFixture.env[key]});');
const auth=data('export async function getChatGPTUser(){return globalThis.uploadIntegrityFixture.user;}');
const server=compiled('../lib/server.ts',{'cloudflare:workers':environment,'@/app/chatgpt-auth':auth,'./domain':new URL('../lib/domain.ts',import.meta.url).href});
const files=await import(compiled('../app/api/files/route.ts',{'cloudflare:workers':environment,'@/lib/server':server,'@/lib/domain':new URL('../lib/domain.ts',import.meta.url).href}));
const original=new TextEncoder().encode('Synthetic immutable invoice original 0599\n625,00 SEK');

function fixture(t,{insertFailure='',readFailure=false,deleteFailure=false}={}){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>{sqlite.close();delete globalThis.uploadIntegrityFixture;});
 sqlite.exec('CREATE TABLE documents(id TEXT PRIMARY KEY,owner TEXT,filename TEXT,mime TEXT,size INTEGER,sha256 TEXT,created_at TEXT)');
 const objects=new Map();let failed=false;
 const DB={prepare(sql){return {bind(...args){return {
  async first(){if(failed&&readFailure)throw Error('D1_ERROR: synthetic read unavailable');return sqlite.prepare(sql).get(...args)||null;},
  async run(){
   if(!failed&&insertFailure==='before'){failed=true;throw Error('D1_ERROR: synthetic write rejected');}
   const result=sqlite.prepare(sql).run(...args);
   if(!failed&&insertFailure==='after'){failed=true;throw Error('D1_ERROR: synthetic response lost after commit');}
   return {success:true,meta:{changes:Number(result.changes)}};
  }
 };}};}};
 const BUCKET={async put(key,bytes){objects.set(key,new Uint8Array(bytes).slice());},async get(key){const bytes=objects.get(key);return bytes?{size:bytes.byteLength,body:bytes,arrayBuffer:async()=>bytes.slice().buffer}:null;},async delete(key){if(deleteFailure)throw Error('R2_ERROR: synthetic cleanup failed');objects.delete(key);}};
 const f={sqlite,objects,user:{userId:'owner',displayName:'Synthetic'},env:{DB,BUCKET}};globalThis.uploadIntegrityFixture=f;return f;
}
function upload(){const form=new FormData();form.set('file',new File([original],'synthetic-0599.txt'));return new Request('https://mg.test/api/files',{method:'POST',headers:{origin:'https://mg.test'},body:form});}
const count=f=>f.sqlite.prepare('SELECT COUNT(*) n FROM documents').get().n;
async function assertReadable(id){const response=await files.GET(new Request('https://mg.test/api/files?id='+id));assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),original);}

test('lost successful insert response preserves the registered original through retry and owner-only download',async t=>{
 const f=fixture(t,{insertFailure:'after'}),first=await files.POST(upload());
 assert.equal(first.status,500);assert.equal(count(f),1);assert.equal(f.objects.size,1,'a committed document must retain its original');
 const row=f.sqlite.prepare('SELECT id FROM documents').get();await assertReadable(row.id);
 const retry=await files.POST(upload()),body=await retry.json();assert.equal(retry.status,200);assert.equal(body.id,row.id);assert.equal(body.duplicate,true);assert.equal(count(f),1);assert.equal(f.objects.size,1);await assertReadable(row.id);
 f.user={userId:'other'};assert.equal((await files.GET(new Request('https://mg.test/api/files?id='+row.id))).status,404);
});

test('confirmed insert rejection cleans only the unreferenced uploaded original',async t=>{
 const f=fixture(t,{insertFailure:'before'});f.objects.set('other/retained',new Uint8Array([1,2,3]));
 assert.equal((await files.POST(upload())).status,500);assert.equal(count(f),0);assert.deepEqual([...f.objects.keys()],['other/retained']);
 const retry=await files.POST(upload()),body=await retry.json();assert.equal(retry.status,200);assert.equal(count(f),1);await assertReadable(body.id);
});

for(const insertFailure of ['before','after'])test(`unavailable insert outcome read preserves bytes after ${insertFailure}-commit failure`,async t=>{
 const f=fixture(t,{insertFailure,readFailure:true}),response=await files.POST(upload());
 assert.equal(response.status,500);assert.equal(count(f),insertFailure==='after'?1:0);assert.equal(f.objects.size,1,'unknown D1 outcome must not destroy an original');assert.deepEqual([...f.objects.values()][0],original);
});

test('cleanup failure does not replace the safe response to a rejected insert',async t=>{
 const f=fixture(t,{insertFailure:'before',deleteFailure:true}),response=await files.POST(upload());
 assert.equal(response.status,500);assert.equal(count(f),0);assert.equal(f.objects.size,1);assert.doesNotMatch(JSON.stringify(await response.json()),/synthetic|D1_ERROR|R2_ERROR/);
});

test('ordinary upload and same-owner duplicate preserve the same exact original',async t=>{
 const f=fixture(t),response=await files.POST(upload()),first=await response.json();assert.equal(response.status,200);await assertReadable(first.id);
 const second=await (await files.POST(upload())).json();assert.equal(second.id,first.id);assert.equal(second.duplicate,true);assert.equal(count(f),1);assert.equal(f.objects.size,1);
});
