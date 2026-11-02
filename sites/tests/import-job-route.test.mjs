import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
async function fixture(t,authenticated=true){
  const key='__import_job_route_'+crypto.randomUUID().replaceAll('-','');
  const f={authenticated,owners:[],reads:0,secret:'b'.repeat(64)};globalThis[key]=f;t.after(()=>delete globalThis[key]);
  const ref=`globalThis[${JSON.stringify(key)}]`;
  const server=data(`const f=${ref};export async function identity(){if(!f.authenticated)throw Error('AUTH_REQUIRED');return {userId:'authenticated-owner'};}export function db(){return {prepare(query){return {bind(owner){f.owners.push(owner);return {};}};},async batch(rows){f.reads++;return rows.map(()=>({results:[]}));}};}export const response=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});export const failure=error=>response({error:error.message==='AUTH_REQUIRED'?'Logga in.':'Unexpected'},error.message==='AUTH_REQUIRED'?401:500);`);
  const environment=data(`export const env={BACKUP_ENABLED:'true',BACKUP_ENCRYPTION_KEY:${ref}.secret,BUCKET:{}};`);
  let source=ts.transpileModule(readFileSync(new URL('../app/api/import-jobs/route.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  for(const [from,to] of Object.entries({'cloudflare:workers':environment,'@/lib/server':server,'@/lib/import-job-overview':new URL('../lib/import-job-overview.ts',import.meta.url).href})){
    for(const quote of ['"',"'"])source=source.replaceAll(quote+from+quote,JSON.stringify(to));
  }
  f.route=await import(data(source));return f;
}

test('unauthenticated job overview performs no database access',async t=>{
  const f=await fixture(t,false),result=await f.route.GET();
  assert.equal(result.status,401);assert.equal(f.reads,0);assert.deepEqual(f.owners,[]);
  assert.equal(result.headers.get('Cache-Control'),'private, no-store');
});

test('job overview always selects the authenticated owner and has no activation/write route',async t=>{
  const f=await fixture(t);const result=await f.route.GET(new Request('https://synthetic.example/api/import-jobs?owner=another-owner&enabled=true'));
  const body=await result.json();assert.equal(result.status,200);assert.equal(f.reads,1);
  assert.ok(f.owners.length>0&&f.owners.every(owner=>owner==='authenticated-owner'));
  assert.equal(body.bankgiroPreparation.enabled,false);assert.equal(typeof f.route.POST,'undefined');
  assert.doesNotMatch(JSON.stringify(body),new RegExp(f.secret+'|another-owner|authenticated-owner'));
  assert.equal(result.headers.get('Cache-Control'),'private, no-store');
});
