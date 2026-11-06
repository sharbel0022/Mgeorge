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
  f.env={DOCUMENT_AUTOMATION_ENABLED:'true',DOCUMENT_OWNER_EMAIL:'owner@example.test',DOCUMENT_WORKER_TOKEN:randomToken(),DOCUMENT_CLOUD_OCR_ENABLED:'true',DOCUMENT_CLOUD_WORKER_TOKEN:randomToken(),BUCKET:{get:async key=>{
    if(f.storageError)throw Error('synthetic private storage outage');
    const bytes=f.objects.get(key);return bytes?{size:bytes.length,arrayBuffer:async()=>bytes}:null;
  }}};
  globalThis[key]=f;t.after(()=>{delete globalThis[key];sql.close();});
  const reference='globalThis['+JSON.stringify(key)+']',domainUrl=new URL('../lib/domain.ts',import.meta.url).href;
  const server=data('import {emptyState} from '+JSON.stringify(domainUrl)+';const f='+reference+';export async function companyWorkerIdentity(){return null;}export async function companyWorkerConfigured(){return null;}export const db=()=>f.d1;export const response=(body,status=200)=>Response.json(body,{status});export const identity=async()=>({userId:f.owner,email:"owner@example.test"});export async function readWorkspace(owner){const row=await f.d1.prepare("SELECT revision,payload FROM workspaces WHERE owner=?").bind(owner).first();return row?{revision:row.revision,state:JSON.parse(row.payload)}:{revision:0,state:emptyState()};}');
  let fields=readFileSync(new URL('../lib/invoice-fields.js',import.meta.url),'utf8');
  for(const [from,to] of Object.entries({'./domain':domainUrl,'./document-triage.js':new URL('../lib/document-triage.js',import.meta.url).href,'./invoice-details.js':new URL('../lib/invoice-details.js',import.meta.url).href,'./ocr-bankgiro-evidence.js':new URL('../lib/ocr-bankgiro-evidence.js',import.meta.url).href}))fields=fields.replaceAll("'"+from+"'",JSON.stringify(to));
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
  f.worker=(action,body={},mode='local')=>f.processing.workerAction(new Request('https://synthetic.example/api/ocr-worker/'+action,{method:'POST',headers:{Authorization:'Bearer '+(mode==='cloud'?f.env.DOCUMENT_CLOUD_WORKER_TOKEN:f.env.DOCUMENT_WORKER_TOKEN),'X-MG-OCR-Runner':mode,'Content-Type':'application/json'},body:JSON.stringify(body)}),action);
  f.lease=async(mode='local')=> (await (await f.worker('lease',{},mode)).json()).job;
  f.complete=(job,error=false,mode='local')=>f.worker('complete',{id:job.id,lease:job.lease,sha256:job.sha256,text:'',method:'ocr',confidence:0,...(error?{error:true}:{})},mode);
  return f;
}

function pauseAfterReceipt(f){
  let release,reached,paused=false;
  const waiting=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{reached=resolve;}),prepare=f.d1.prepare.bind(f.d1);
  f.d1.prepare=query=>{
    const statement=prepare(query);
    if(query==='SELECT * FROM document_automation WHERE owner=?'){
      const first=statement.first.bind(statement);
      statement.first=async()=>{if(!paused){paused=true;reached();await waiting;}return first();};
    }
    return statement;
  };
  return {started,release:()=>release()};
}


import {runSitesOcr} from '../../src/sites-ocr-pull.js';

const identityOf=job=>({id:job.id,lease:job.lease,sha256:job.sha256});
test('version 2 leases expose an opaque run receipt identity and a bounded deadline',async t=>{
  const f=await fixture(t);await f.document('v2');const job=await f.lease();
  assert.equal(job.protocol,2);assert.match(job.run_id,/^[A-Za-z0-9_-]{43}$/);
  assert.ok(Date.parse(job.lease_until)>Date.now());assert.ok(Date.parse(job.lease_until)<=Date.now()+180000);
  assert.notEqual(job.run_id,job.lease);
});
for(const mode of ['local','cloud'])test(mode+' heartbeat extends only its live lease without changing claim time or attempts',async t=>{
  const f=await fixture(t);await f.document('renew');const job=await f.lease(mode);
  f.sql.prepare('UPDATE document_jobs SET lease_until=?').run(new Date(Date.now()+30000).toISOString());
  const before={...f.sql.prepare('SELECT * FROM document_jobs').get()};
  const response=await f.worker('heartbeat',identityOf(job),mode);assert.equal(response.status,200);
  const receipt=await response.json(),after=f.sql.prepare('SELECT * FROM document_jobs').get();
  assert.equal(receipt.ok,true);assert.equal(receipt.run_id,job.run_id);
  assert.ok(Date.parse(after.lease_until)>Date.parse(before.lease_until));
  assert.ok(Date.parse(after.lease_until)<=Date.parse(before.updated_at)+600000);
  assert.equal(after.updated_at,before.updated_at);assert.equal(after.attempts,before.attempts);assert.equal(after.lease,before.lease);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);
});
test('heartbeat cannot exceed the absolute ten-minute claim horizon',async t=>{
  const f=await fixture(t);await f.document('cap');const job=await f.lease();
  const started=new Date(Date.now()-9*60000).toISOString();
  f.sql.prepare('UPDATE document_jobs SET updated_at=?,lease_until=?').run(started,new Date(Date.now()+30000).toISOString());
  assert.equal((await f.worker('heartbeat',identityOf(job))).status,200);
  const row=f.sql.prepare('SELECT * FROM document_jobs').get();
  assert.ok(Date.parse(row.lease_until)<=Date.parse(started)+600000);
  f.sql.prepare('UPDATE document_jobs SET updated_at=?').run(new Date(Date.now()-11*60000).toISOString());
  const before={...f.sql.prepare('SELECT * FROM document_jobs').get()};
  assert.equal((await f.worker('heartbeat',identityOf(job))).status,409);
  assert.deepEqual({...f.sql.prepare('SELECT * FROM document_jobs').get()},before);
});
for(const defect of ['expired','replaced','wrong runner','rejected source','wrong digest'])test('heartbeat rejects '+defect+' without reviving the job',async t=>{
  const f=await fixture(t);await f.document('fenced');const job=await f.lease();
  if(defect==='expired')f.sql.prepare("UPDATE document_jobs SET lease_until='2000-01-01'").run();
  if(defect==='replaced')f.sql.prepare("UPDATE document_jobs SET lease='replacement'").run();
  if(defect==='rejected source')f.sql.prepare("UPDATE gmail_sources SET status='rejected'").run();
  const before={...f.sql.prepare('SELECT * FROM document_jobs').get()};
  const response=await f.worker('heartbeat',{...identityOf(job),...(defect==='wrong digest'?{sha256:'0'.repeat(64)}:{})},defect==='wrong runner'?'cloud':'local');
  assert.equal(response.status,409);assert.deepEqual({...f.sql.prepare('SELECT * FROM document_jobs').get()},before);
});
test('an accepted receipt is inspectable after completion without replaying or exposing extracted text',async t=>{
  const f=await fixture(t);await f.document('receipt');const job=await f.lease();
  assert.equal((await f.complete(job)).status,200);
  const response=await f.worker('receipt',identityOf(job));assert.equal(response.status,200);
  const receipt=await response.json();
  assert.equal(receipt.accepted,true);assert.equal(receipt.settled,true);assert.equal(receipt.state,'needs_review');
  assert.equal(receipt.run_id,job.run_id);assert.equal(receipt.id,job.id);assert.equal(receipt.sha256,job.sha256);
  assert.ok(Number.isFinite(Date.parse(receipt.accepted_at)));assert.equal(receipt.text,undefined);assert.equal(receipt.extraction,undefined);
  assert.equal((await f.complete(job)).status,409,'legacy completion replay remains rejected');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,1);
  assert.ok(!JSON.stringify(f.sql.prepare('SELECT result FROM document_extractions').all()).includes(job.lease));
});
test('a missing receipt certifies retryability only while the same unrecorded lease is live',async t=>{
  const f=await fixture(t);await f.document('missing');const job=await f.lease();
  const missing=await(await f.worker('receipt',identityOf(job))).json();
  assert.deepEqual(missing,{accepted:false,retryable:true,id:job.id,sha256:job.sha256,run_id:job.run_id});
  f.sql.prepare("UPDATE document_jobs SET lease_until='2000-01-01'").run();
  assert.equal((await f.worker('receipt',identityOf(job))).status,409);
});
test('heartbeat cannot extend an accepted result while its continuation is pending',async t=>{
  const f=await fixture(t);await f.document('accepted');const job=await f.lease(),pause=pauseAfterReceipt(f);
  const completing=f.complete(job);await pause.started;
  try{
    const before={...f.sql.prepare('SELECT * FROM document_jobs').get()};
    assert.equal((await f.worker('heartbeat',identityOf(job))).status,409);
    const receipt=await(await f.worker('receipt',identityOf(job))).json();
    assert.equal(receipt.accepted,true);assert.equal(receipt.settled,false);assert.equal(receipt.state,'processing');
    assert.deepEqual({...f.sql.prepare('SELECT * FROM document_jobs').get()},before);
  }finally{pause.release();await completing;}
});
test('a temporary original-store outage preserves the live completion instead of labelling it corrupt',async t=>{
  const f=await fixture(t);await f.document('temporary');const job=await f.lease(),before={...f.sql.prepare('SELECT * FROM document_jobs').get()};
  f.storageError=true;const response=await f.complete(job);
  assert.equal(response.status,503);assert.ok(Number(response.headers.get('Retry-After'))>0);
  assert.deepEqual({...f.sql.prepare('SELECT * FROM document_jobs').get()},before);
  f.storageError=false;assert.equal((await f.complete(job)).status,200);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);
});
for(const attempt of [1,2])test('accepted extraction on attempt '+attempt+' survives restart without another extraction attempt',async t=>{
  const f=await fixture(t);await f.document('interrupted');const job=await f.lease();
  f.sql.prepare('UPDATE document_jobs SET attempts=?').run(attempt);
  const prepare=f.d1.prepare.bind(f.d1);let interrupted=false;
  f.d1.prepare=query=>{
    const statement=prepare(query);
    if(query==='SELECT * FROM document_automation WHERE owner=?'){
      const first=statement.first.bind(statement);
      statement.first=async()=>{if(!interrupted){interrupted=true;throw Error('synthetic continuation interruption');}return first();};
    }
    return statement;
  };
  await assert.rejects(f.complete(job));assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,1);
  const history=f.sql.prepare('SELECT * FROM document_extractions').all();
  f.sql.prepare("UPDATE document_jobs SET lease_until='2000-01-01'").run();await f.restart();
  await f.processing.enqueueDocuments(f.owner);
  const row=f.sql.prepare('SELECT * FROM document_jobs').get();
  assert.equal(row.state,'needs_review');assert.equal(row.attempts,attempt);assert.equal(row.error_code,'processing_interrupted_after_extraction');
  assert.equal(await f.lease(),null);assert.deepEqual(f.sql.prepare('SELECT * FROM document_extractions').all(),history);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);
});
test('an accepted extraction cannot remain in automatic storage-recovery retries indefinitely',async t=>{
  const f=await fixture(t);await f.document('old-receipt');const job=await f.lease(),pause=pauseAfterReceipt(f);
  const completing=f.complete(job);await pause.started;
  f.sql.prepare("UPDATE document_jobs SET lease_until='2000-01-01',attempts=3").run();
  pause.release();await completing;
  f.sql.prepare("UPDATE document_extractions SET created_at='2000-01-01T00:00:00.000Z'").run();
  const history=f.sql.prepare('SELECT * FROM document_extractions').all();f.storageError=true;
  await f.processing.enqueueDocuments(f.owner);
  const row=f.sql.prepare('SELECT * FROM document_jobs').get();
  assert.equal(row.state,'needs_review');assert.equal(row.error_code,'original_unavailable_review');
  assert.notEqual(JSON.parse(row.extraction).level,'green');
  assert.equal(await f.lease(),null);assert.deepEqual(f.sql.prepare('SELECT * FROM document_extractions').all(),history);
});
for(const lost of ['before acceptance','after acceptance'])test('real worker and queue recover a response lost '+lost+' with one durable result',async t=>{
  const f=await fixture(t);await f.document('end-to-end');
  const get=f.env.BUCKET.get;f.env.BUCKET.get=async key=>{const object=await get(key);return object?{...object,body:new Response(f.objects.get(key)).body}:null;};
  let sends=0,extractions=0;
  const fetchImpl=async(url,options)=>{
    const action=new URL(url).pathname.split('/').pop();
    if(action==='complete'){
      sends++;
      if(lost==='before acceptance'&&sends===1)throw Error('synthetic request interrupted');
    }
    const response=await f.processing.workerAction(new Request(url,options),action);
    if(action==='complete'&&lost==='after acceptance'&&sends===1)throw Error('synthetic response interrupted');
    return response;
  };
  const result=await runSitesOcr({origin:'https://synthetic.example',token:f.env.DOCUMENT_WORKER_TOKEN,mode:'local'},{fetchImpl,extract:async()=>{extractions++;return {text:'Synthetic incomplete invoice',method:'ocr',confidence:50};}});
  assert.deepEqual(result,{processed:1,failed:0});assert.equal(extractions,1);
  assert.equal(sends,lost==='before acceptance'?2:1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);
});

test('a replacement run cannot settle an older accepted receipt',async t=>{
  const f=await fixture(t);await f.document('replaced-receipt');const old=await f.lease();
  await f.complete(old);await f.processing.retryInvoiceDocument(f.owner,old.id);
  const replacement=await f.lease();assert.notEqual(replacement.run_id,old.run_id);await f.complete(replacement);
  const oldReceipt=await(await f.worker('receipt',identityOf(old))).json();
  const newReceipt=await(await f.worker('receipt',identityOf(replacement))).json();
  assert.equal(oldReceipt.accepted,true);assert.equal(oldReceipt.settled,false);
  assert.equal(newReceipt.accepted,true);assert.equal(newReceipt.settled,true);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,2);
});
test('concurrent completion after receipt acceptance stays pending without another history row',async t=>{
  const f=await fixture(t);await f.document('overlap');const job=await f.lease(),pause=pauseAfterReceipt(f);
  const completing=f.complete(job);await pause.started;
  try{
    assert.deepEqual(await(await f.complete(job)).json(),{ignored:true});
    const receipt=await(await f.worker('receipt',identityOf(job))).json();
    assert.equal(receipt.accepted,true);assert.equal(receipt.settled,false);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,1);
  }finally{pause.release();await completing;}
});
for(const attempt of [1,2])test('three accepted expired jobs at attempt '+attempt+' remain protected beyond the recovery batch',async t=>{
  const f=await fixture(t),jobs=[];
  for(const id of ['a','b','c']){
    await f.document(id);const job=await f.lease();await f.complete(job);jobs.push(job);
  }
  const history=f.sql.prepare('SELECT * FROM document_extractions ORDER BY document_id').all();
  for(const job of jobs)f.sql.prepare("UPDATE document_jobs SET state='processing',attempts=?,lease=?,lease_until='2000-01-01' WHERE document_id=?").run(attempt,job.lease,job.id);
  assert.equal(await f.lease(),null);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_jobs WHERE attempts<>?').get(attempt).n,0);
  assert.deepEqual(f.sql.prepare('SELECT * FROM document_extractions ORDER BY document_id').all(),history);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);
});
for(const change of ['expiry','replacement','original'])test('heartbeat rechecks '+change+' under the write lock',async t=>{
  const f=await fixture(t);await f.document('write-race');const job=await f.lease(),prepare=f.d1.prepare.bind(f.d1);
  let concurrent;
  f.d1.prepare=query=>{
    const statement=prepare(query);
    if(query.startsWith('UPDATE document_jobs SET lease_until=?')){const run=statement.run.bind(statement);statement.run=async()=>{
      if(change==='expiry')f.sql.prepare("UPDATE document_jobs SET lease_until='2000-01-01'").run();
      if(change==='replacement')f.sql.prepare("UPDATE document_jobs SET lease='replacement'").run();
      if(change==='original')f.sql.prepare('UPDATE documents SET sha256=?').run('0'.repeat(64));
      concurrent={...f.sql.prepare('SELECT * FROM document_jobs').get()};return run();
    };}
    return statement;
  };
  assert.equal((await f.worker('heartbeat',identityOf(job))).status,409);
  assert.ok(concurrent);assert.deepEqual({...f.sql.prepare('SELECT * FROM document_jobs').get()},concurrent);
});
test('an original-store exception named like corruption remains a transport failure',async t=>{
  const f=await fixture(t);await f.document('untrusted-error');const job=await f.lease();
  f.env.BUCKET.get=async()=>{throw Error('original_integrity');};
  assert.equal((await f.complete(job)).status,503);
  const row=f.sql.prepare('SELECT * FROM document_jobs').get();
  assert.equal(row.state,'processing');assert.equal(row.lease,job.lease);assert.equal(row.error_code,'');
});
test('a lost OCR-failure acknowledgement never fabricates an accepted extraction receipt',async t=>{
  const f=await fixture(t);await f.document('ocr-failure');const job=await f.lease();
  assert.deepEqual(await(await f.complete(job,true)).json(),{ok:true});
  assert.equal((await f.worker('receipt',identityOf(job))).status,409);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,0);
  assert.equal(f.sql.prepare('SELECT attempts FROM document_jobs').get().attempts,1);
});
test('current failure counts separate transport, OCR, integrity and missing document information',async t=>{
  const f=await fixture(t);
  for(const [id,error,state] of [['transport','original_unavailable','queued'],['ocr','cloud_ocr_failed','failed'],['integrity','original_integrity','failed'],['information','','needs_review']]){
    await f.document(id);
    f.sql.prepare('INSERT INTO document_jobs(owner,document_id,state,engine,error_code,available_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(f.owner,id,state,'local',error,new Date().toISOString(),new Date().toISOString());
  }
  const before=f.sql.prepare('SELECT * FROM document_jobs ORDER BY document_id').all();
  const status=await f.processing.processingStatus(f.owner);
  assert.deepEqual(status.failure_summary,{basis:'current_jobs',transport:1,ocr:1,integrity:1,interrupted:0,document_review:1});
  assert.deepEqual(f.sql.prepare('SELECT * FROM document_jobs ORDER BY document_id').all(),before);
});

for(const defect of ['missing receipt','changed original metadata','missing original metadata'])test('an early accepted result with '+defect+' is held without an automatic retry loop',async t=>{
  const f=await fixture(t);await f.document('held');const job=await f.lease();await f.complete(job);
  const original=f.sql.prepare('SELECT extraction FROM document_jobs').get().extraction;
  f.sql.prepare("UPDATE document_jobs SET state='processing',lease=?,lease_until='2000-01-01'").run(job.lease);
  if(defect==='missing receipt')f.sql.prepare('DELETE FROM document_extractions').run();
  else if(defect==='missing original metadata')f.sql.prepare('DELETE FROM documents').run();
  else f.sql.prepare('UPDATE documents SET sha256=?').run('0'.repeat(64));
  assert.equal(await f.lease(),null);
  const row=f.sql.prepare('SELECT * FROM document_jobs').get();
  assert.equal(row.state,'failed');assert.equal(row.attempts,1);assert.equal(row.extraction,original);
  assert.equal(row.error_code,defect==='missing receipt'?'result_receipt_missing':'original_integrity');
  assert.equal(await f.lease(),null);
});

test('accepted recovery losing its original snapshot never falls through to generic lease expiry',async t=>{
  const f=await fixture(t);await f.document('metadata-race');const job=await f.lease();await f.complete(job);
  const extraction=JSON.parse(f.sql.prepare('SELECT extraction FROM document_jobs').get().extraction);extraction.level='green';
  f.sql.prepare("UPDATE document_jobs SET state='processing',attempts=3,lease=?,lease_until='2000-01-01',extraction=?").run(job.lease,JSON.stringify(extraction));
  const before={...f.sql.prepare('SELECT * FROM document_jobs').get()},history=f.sql.prepare('SELECT * FROM document_extractions').all(),get=f.env.BUCKET.get;
  f.env.BUCKET.get=async key=>{f.sql.prepare('UPDATE documents SET sha256=?').run('0'.repeat(64));return get(key);};
  await f.processing.enqueueDocuments(f.owner);
  assert.deepEqual({...f.sql.prepare('SELECT * FROM document_jobs').get()},before);
  f.env.BUCKET.get=get;await f.processing.enqueueDocuments(f.owner);
  const after=f.sql.prepare('SELECT * FROM document_jobs').get();
  assert.equal(after.state,'failed');assert.equal(after.error_code,'original_integrity');assert.equal(after.attempts,3);
  assert.equal(JSON.parse(after.extraction).level,'yellow');
  assert.deepEqual(f.sql.prepare('SELECT * FROM document_extractions').all(),history);
});
for(const action of ['heartbeat','receipt']){
  test(action+' enforces its body limit in bytes before decoding',async t=>{
    const f=await fixture(t);await f.document('body-bytes');const job=await f.lease();
    const body={...identityOf(job),padding:'ö'.repeat(2500)},before={...f.sql.prepare('SELECT * FROM document_jobs').get()};
    assert.ok(JSON.stringify(body).length<4096);
    assert.equal((await f.worker(action,body)).status,413);
    assert.deepEqual({...f.sql.prepare('SELECT * FROM document_jobs').get()},before);
  });
  test(action+' stops an oversized stream without consuming its entire body',async t=>{
    const f=await fixture(t);let pulls=0,cancelled=false;
    const stream=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(1024).fill(32));if(pulls===50)controller.close();},cancel(){cancelled=true;}});
    const request=new Request('https://synthetic.example/api/ocr-worker/'+action,{method:'POST',headers:{Authorization:'Bearer '+f.env.DOCUMENT_WORKER_TOKEN,'X-MG-OCR-Runner':'local'},body:stream,duplex:'half'});
    assert.equal((await f.processing.workerAction(request,action)).status,413);
    assert.ok(pulls<=6,'body consumption stays within the limit plus one stream chunk');assert.equal(cancelled,true);
  });
}

test('rejected accepted jobs cannot monopolize bounded recovery ahead of active review work',async t=>{
  const f=await fixture(t),jobs=[];
  for(const id of ['a','b','c']){await f.document(id);const job=await f.lease();await f.complete(job);jobs.push(job);}
  for(const job of jobs)f.sql.prepare("UPDATE document_jobs SET state='processing',attempts=3,lease=?,lease_until='2000-01-01' WHERE document_id=?").run(job.lease,job.id);
  f.sql.prepare("UPDATE gmail_sources SET status='rejected' WHERE document_id IN ('a','b')").run();
  const rejected=f.sql.prepare("SELECT * FROM document_jobs WHERE document_id IN ('a','b') ORDER BY document_id").all();
  const history=f.sql.prepare('SELECT * FROM document_extractions ORDER BY document_id').all();
  await f.processing.enqueueDocuments(f.owner);await f.processing.enqueueDocuments(f.owner);
  assert.equal(f.sql.prepare("SELECT state FROM document_jobs WHERE document_id='c'").get().state,'needs_review');
  assert.deepEqual(f.sql.prepare("SELECT * FROM document_jobs WHERE document_id IN ('a','b') ORDER BY document_id").all(),rejected);
  assert.deepEqual(f.sql.prepare('SELECT * FROM document_extractions ORDER BY document_id').all(),history);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);
});
