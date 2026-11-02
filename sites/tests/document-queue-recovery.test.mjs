import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {randomToken} from '../lib/banking/security.ts';

const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
class D1{
  constructor(sql){this.sql=sql;}
  prepare(query){const sql=this.sql;return {query,args:[],bind(...args){this.args=args;return this;},async first(){return sql.prepare(query).get(...this.args)||null;},async all(){return {results:sql.prepare(query).all(...this.args)};},async run(){return this.execute();},execute(){return {meta:{changes:Number(sql.prepare(query).run(...this.args).changes)}};}};}
  async batch(items){this.sql.exec('BEGIN');try{const results=items.map(item=>item.execute());this.sql.exec('COMMIT');return results;}catch(error){this.sql.exec('ROLLBACK');throw error;}}
}
async function fixture(t){
  const sql=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('../drizzle',import.meta.url)).filter(file=>/^\d{4}.*\.sql$/.test(file)).sort())sql.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  const key='__queue_recovery_'+crypto.randomUUID().replaceAll('-',''),f={sql,d1:new D1(sql),owner:'synthetic-queue-owner',pdfCalls:0,objects:new Map()};
  f.env={DOCUMENT_AUTOMATION_ENABLED:'true',DOCUMENT_OWNER_EMAIL:'owner@example.test',DOCUMENT_WORKER_TOKEN:randomToken(),BUCKET:{get:async key=>{
    if(f.storageError)throw Error('synthetic private storage outage');
    const bytes=f.objects.get(key);return bytes?{size:bytes.length,arrayBuffer:async()=>bytes}:null;
  }}};
  globalThis[key]=f;t.after(()=>{delete globalThis[key];sql.close();});
  const reference='globalThis['+JSON.stringify(key)+']',domainUrl=new URL('../lib/domain.ts',import.meta.url).href;
  const server=data('import {emptyState} from '+JSON.stringify(domainUrl)+';const f='+reference+';export const db=()=>f.d1;export const response=(body,status=200)=>Response.json(body,{status});export const identity=async()=>({userId:f.owner,email:"owner@example.test"});export async function readWorkspace(owner){const row=await f.d1.prepare("SELECT revision,payload FROM workspaces WHERE owner=?").bind(owner).first();return row?{revision:row.revision,state:JSON.parse(row.payload)}:{revision:0,state:emptyState()};}');
  let fields=readFileSync(new URL('../lib/invoice-fields.js',import.meta.url),'utf8');
  for(const [from,to] of Object.entries({'./domain':domainUrl,'./document-triage.js':new URL('../lib/document-triage.js',import.meta.url).href,'./invoice-details.js':new URL('../lib/invoice-details.js',import.meta.url).href}))fields=fields.replaceAll("'"+from+"'",JSON.stringify(to));
  let source=ts.transpileModule(readFileSync(new URL('../lib/document-processing.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const imports={
    'cloudflare:workers':data('export const env='+reference+'.env;'),
    './server':server,'./domain':domainUrl,
    './banking/security':new URL('../lib/banking/security.ts',import.meta.url).href,
    './invoice-fields.js':data(fields),
    './server-pdf':data('export async function serverPdfText(){const f='+reference+';f.pdfCalls++;await f.onPdf?.(f.pdfCalls);return {text:"Synthetic unreadable invoice",method:"pdf",confidence:100};}'),
    './customer-messages':data('export async function reconcileAndPrepare(){}'),
  };
  for(const [from,to] of Object.entries(imports))for(const quote of ['"',"'"])source=source.replaceAll(quote+from+quote,JSON.stringify(to));
  f.restart=async()=>{f.processing=await import(data(source+'\n// '+crypto.randomUUID()));};
  await f.restart();await f.processing.processingSettings({userId:f.owner,email:'owner@example.test'});
  f.document=async(id,mime='image/png',owner=f.owner)=>{
    const bytes=Buffer.from('synthetic retained original '+id),sha=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),at=new Date().toISOString();
    f.objects.set(owner+'/'+id,bytes);
    sql.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run(id,owner,'synthetic',mime,bytes.length,sha,at);
    sql.prepare('INSERT INTO gmail_sources(owner,source_id,document_id,metadata,created_at) VALUES(?,?,?,?,?)').run(owner,'source-'+id,id,JSON.stringify({direction:'supplier',direction_confident:false,from:'synthetic@example.test',subject:'Synthetic document'}),at);
    return {id,sha};
  };
  f.worker=(action,body={})=>f.processing.workerAction(new Request('https://synthetic.example/api/ocr-worker/'+action,{method:'POST',headers:{Authorization:'Bearer '+f.env.DOCUMENT_WORKER_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(body)}),action);
  f.lease=async()=> (await (await f.worker('lease')).json()).job;
  f.complete=(job,error=false)=>f.worker('complete',{id:job.id,lease:job.lease,sha256:job.sha256,text:'',method:'ocr',confidence:0,...(error?{error:true}:{})});
  return f;
}

test('only one OCR lease is active while another document waits; restart reclaims expiry once',async t=>{
  const f=await fixture(t);await f.document('a');await f.document('b');
  const first=await f.lease();assert.equal(first.id,'a');
  assert.equal(await f.lease(),null,'another document must wait for the active OCR slot');
  f.sql.prepare("UPDATE document_jobs SET lease_until='2000-01-01' WHERE document_id='a'").run();
  await f.restart();
  const replacement=await f.lease();assert.equal(replacement.id,'a');assert.notEqual(replacement.lease,first.lease);
  assert.equal((await f.complete(first)).status,409);
  assert.equal((await f.complete(replacement)).status,200);
  assert.equal((await f.complete(replacement)).status,409);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,1);
  assert.equal((await f.lease()).id,'b');
});

test('overlapping server PDF runs keep one active slot for the owner and engine',async t=>{
  const f=await fixture(t);await f.document('a','application/pdf');await f.document('b','application/pdf');
  let release,reached;const waiting=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{reached=resolve;});
  f.onPdf=async call=>{if(call===1){reached();await waiting;}};
  const first=f.processing.processDocuments(f.owner,1);await started;
  let second;try{second=await f.processing.processDocuments(f.owner,1);}finally{release();await first;}
  assert.equal(second.processed,0);
  assert.equal(f.pdfCalls,1);
  assert.equal(f.sql.prepare("SELECT state FROM document_jobs WHERE document_id='b'").get().state,'queued');
  assert.equal((await f.processing.processDocuments(f.owner,1)).processed,1);
});

test('claim rechecks the engine slot when another runner wins after candidate selection',async t=>{
  const f=await fixture(t);await f.document('b');
  let release,reached,paused=false;
  const waiting=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{reached=resolve;}),prepare=f.d1.prepare.bind(f.d1);
  f.d1.prepare=query=>{const statement=prepare(query);
    if(query.startsWith("UPDATE document_jobs SET state='processing'"))statement.run=async()=>{
      if(!paused&&statement.args[5]==='b'){paused=true;reached();await waiting;}
      return statement.execute();
    };
    return statement;
  };
  const delayed=f.lease();await started;
  await f.document('a');await f.processing.enqueueDocuments(f.owner);
  f.sql.prepare("UPDATE document_jobs SET available_at='2000-01-01' WHERE document_id='a'").run();
  let winner,loser;
  try{winner=await f.lease();}finally{release();loser=await delayed;}
  assert.equal(winner.id,'a');assert.equal(loser,null);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM document_jobs WHERE state='processing'").get().n,1);
  assert.equal(f.sql.prepare("SELECT attempts FROM document_jobs WHERE document_id='b'").get().attempts,0);
});

test('an active OCR slot does not block server PDF extraction for the same owner',async t=>{
  const f=await fixture(t);await f.document('image');await f.document('pdf','application/pdf');
  assert.equal((await f.lease()).id,'image');
  assert.equal((await f.processing.processDocuments(f.owner,1)).processed,1);
  assert.equal(f.sql.prepare("SELECT state FROM document_jobs WHERE document_id='image'").get().state,'processing');
  assert.equal(f.sql.prepare("SELECT state FROM document_jobs WHERE document_id='pdf'").get().state,'needs_review');
});

test('another owner can process while a server PDF lease is active',async t=>{
  const f=await fixture(t);await f.document('a','application/pdf');await f.document('b','application/pdf','other-synthetic-owner');
  let release,reached;const waiting=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{reached=resolve;});
  f.onPdf=async call=>{if(call===1){reached();await waiting;}};
  const first=f.processing.processDocuments(f.owner,1);await started;
  let other;try{other=await f.processing.processDocuments('other-synthetic-owner',1);}finally{release();await first;}
  assert.equal(other.processed,1);assert.equal(f.pdfCalls,2);
});

test('OCR errors respect durable backoff, reject stale completions, and stop after three attempts',async t=>{
  const f=await fixture(t);await f.document('a');
  let previous;
  for(let attempt=1;attempt<=3;attempt++){
    const job=await f.lease();assert.ok(job);
    if(previous)assert.equal((await f.complete(previous,true)).status,409);
    const before=Date.now();assert.equal((await f.complete(job,true)).status,200);
    const row=f.sql.prepare('SELECT * FROM document_jobs').get();assert.equal(row.attempts,attempt);assert.equal(row.error_code,'local_ocr_failed');
    assert.equal(row.state,attempt<3?'waiting_ocr':'failed');assert.ok(Date.parse(row.available_at)>before);assert.ok(Date.parse(row.available_at)<=Date.now()+180000);
    assert.equal(await f.lease(),null);
    f.sql.prepare("UPDATE document_jobs SET available_at='2000-01-01'").run();
    await f.restart();previous=job;
  }
  assert.equal(await f.lease(),null);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,0);
  assert.equal(f.objects.size,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);
});

test('changed originals never reach PDF extraction and stop after the bounded retry budget',async t=>{
  const f=await fixture(t);await f.document('a','application/pdf');f.objects.set(f.owner+'/a',Buffer.from('changed original bytes'));
  for(let attempt=1;attempt<=3;attempt++){
    const result=await f.processing.processDocuments(f.owner,1),row=f.sql.prepare('SELECT * FROM document_jobs').get();
    assert.equal(result.processed,0);assert.equal(row.attempts,attempt);assert.equal(row.error_code,'original_integrity');
    assert.equal(row.state,attempt<3?'queued':'failed');assert.equal((await f.processing.processDocuments(f.owner,1)).processed,0);
    assert.equal(f.sql.prepare('SELECT attempts FROM document_jobs').get().attempts,attempt);
    f.sql.prepare("UPDATE document_jobs SET available_at='2000-01-01'").run();
  }
  assert.equal((await f.processing.processDocuments(f.owner,1)).processed,0);assert.equal(f.pdfCalls,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM documents').get().n,1);assert.equal(f.objects.size,1);
});
