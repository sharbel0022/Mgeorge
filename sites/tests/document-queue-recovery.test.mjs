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

for(const mode of ['local','cloud'])for(const phase of ['worker failure','original failure'])test(`${mode} ${phase} cannot requeue a lease that expires at the write boundary`,async t=>{
  const f=await fixture(t);await f.document('a');const job=await f.lease(mode),before=f.sql.prepare('SELECT * FROM document_jobs').get();
  const prepare=f.d1.prepare.bind(f.d1);let expired=false;
  f.d1.prepare=query=>{
    const statement=prepare(query);
    if(query.startsWith('UPDATE document_jobs SET state=?,error_code=?'))statement.run=async()=>{
      expired=true;f.sql.prepare("UPDATE document_jobs SET lease_until='2000-01-01'").run();return statement.execute();
    };
    return statement;
  };
  if(phase==='original failure')f.storageError=true;
  const result=await f.complete(job,phase==='worker failure',mode);
  assert.equal(expired,true);assert.equal(result.status,200);assert.deepEqual(await result.json(),{ignored:true});
  assert.deepEqual({...f.sql.prepare('SELECT * FROM document_jobs').get()},{...before,lease_until:'2000-01-01'});
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);
  assert.equal((await f.processing.processingStatus(f.owner)).cloud_last_completed,'');
});

for(const change of ['replacement','rejection'])test(`a delayed OCR failure respects a concurrent ${change} at the write boundary`,async t=>{
  const f=await fixture(t);await f.document('a');const job=await f.lease(),before=f.sql.prepare('SELECT * FROM document_jobs').get();
  const prepare=f.d1.prepare.bind(f.d1);let changed=false;
  f.d1.prepare=query=>{
    const statement=prepare(query);
    if(query.startsWith('UPDATE document_jobs SET state=?,error_code=?'))statement.run=async()=>{
      changed=true;
      if(change==='replacement')f.sql.prepare("UPDATE document_jobs SET lease='replacement'").run();
      else f.sql.prepare("UPDATE gmail_sources SET status='rejected'").run();
      return statement.execute();
    };
    return statement;
  };
  const result=await f.complete(job,true);
  assert.equal(changed,true);assert.equal(result.status,200);assert.deepEqual(await result.json(),{ignored:true});
  assert.deepEqual({...f.sql.prepare('SELECT * FROM document_jobs').get()},{...before,...(change==='replacement'?{lease:'replacement'}:{})});
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,0);
});

for(const error of ['parse_timeout','local_ocr_required','page_limit'])test(`an expired PDF ${error} response cannot change the engine or retry budget`,async t=>{
  const f=await fixture(t);await f.document('a','application/pdf');let claimed;
  f.onPdf=async()=>{
    f.sql.prepare("UPDATE document_jobs SET lease_until='2000-01-01'").run();claimed={...f.sql.prepare('SELECT * FROM document_jobs').get()};throw Error(error);
  };
  assert.equal((await f.processing.processDocuments(f.owner,1)).processed,0);
  assert.deepEqual({...f.sql.prepare('SELECT * FROM document_jobs').get()},claimed);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,0);
  f.onPdf=undefined;await f.restart();
  assert.equal((await f.processing.processDocuments(f.owner,1)).processed,1);
  const recovered=f.sql.prepare('SELECT * FROM document_jobs').get();assert.equal(recovered.state,'needs_review');assert.equal(recovered.attempts,2);assert.equal(recovered.engine,'cloud');
});

for(const mode of ['local','cloud'])for(const replay of ['same result','conflicting result','failure'])test(`${mode} overlapping ${replay} cannot replace the first accepted OCR receipt`,async t=>{
  const f=await fixture(t);await f.document('a');const job=await f.lease(mode),pause=pauseAfterReceipt(f);
  const body={id:job.id,lease:job.lease,sha256:job.sha256,text:'Faktura\nFakturanummer: 0001',method:'ocr',confidence:80};
  const first=f.worker('complete',body,mode);await pause.started;
  let duplicate;
  try{
    const extra=replay==='conflicting result'?{text:'Faktura\nFakturanummer: 0002'}:replay==='failure'?{text:'',confidence:0,error:true}:{};
    duplicate=await f.worker('complete',{...body,...extra},mode);
    assert.deepEqual(await duplicate.json(),{ignored:true});
    assert.equal(f.sql.prepare('SELECT state FROM document_jobs').get().state,'processing');
    assert.equal((await f.processing.processingStatus(f.owner)).cloud_last_completed,'');
  }finally{pause.release();await first;}
  assert.equal(duplicate.status,200);assert.equal((await(await first).json()).state,'needs_review');
  const history=f.sql.prepare('SELECT result FROM document_extractions').all(),current=f.sql.prepare('SELECT extraction FROM document_jobs').get().extraction;
  assert.equal(history.length,1);assert.equal(history[0].result,current);assert.equal(f.sql.prepare('SELECT extraction FROM gmail_sources').get().extraction,current);
  assert.equal(JSON.parse(current).fields.invoice_number.value,'0001');
  for(const credential of [job.lease,f.env.DOCUMENT_WORKER_TOKEN,f.env.DOCUMENT_CLOUD_WORKER_TOKEN])assert.ok(!current.includes(credential));
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);
});

test('an accepted OCR receipt survives interruption and module restart while a new lease can reprocess',async t=>{
  const f=await fixture(t);await f.document('a');const job=await f.lease(),prepare=f.d1.prepare.bind(f.d1);let interrupted=false;
  f.d1.prepare=query=>{
    const statement=prepare(query);
    if(query==='SELECT * FROM document_automation WHERE owner=?'){
      const first=statement.first.bind(statement);statement.first=async()=>{if(!interrupted){interrupted=true;throw Error('synthetic lost continuation');}return first();};
    }
    return statement;
  };
  await assert.rejects(f.complete(job),/synthetic lost continuation/);
  const receipt=f.sql.prepare('SELECT result FROM document_extractions').get().result;
  assert.equal(f.sql.prepare('SELECT state FROM document_jobs').get().state,'processing');
  await f.restart();assert.deepEqual(await(await f.complete(job)).json(),{ignored:true});
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,1);assert.equal(f.sql.prepare('SELECT extraction FROM document_jobs').get().extraction,receipt);
  f.sql.prepare("UPDATE document_jobs SET lease_until='2000-01-01'").run();
  const replacement=await f.lease();assert.notEqual(replacement.lease,job.lease);assert.equal((await f.complete(job)).status,409);
  assert.equal((await(await f.complete(replacement)).json()).state,'needs_review');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,2);assert.equal(f.sql.prepare('SELECT extraction FROM gmail_sources').get().extraction,receipt);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);
});

test('a server PDF continuation failure cannot requeue an already accepted receipt',async t=>{
  const f=await fixture(t);await f.document('a','application/pdf');const prepare=f.d1.prepare.bind(f.d1);let interrupted=false;
  f.d1.prepare=query=>{
    const statement=prepare(query);
    if(query==='SELECT * FROM document_automation WHERE owner=?'){
      const first=statement.first.bind(statement);statement.first=async()=>{if(!interrupted){interrupted=true;throw Error('synthetic lost continuation');}return first();};
    }
    return statement;
  };
  assert.equal((await f.processing.processDocuments(f.owner,1)).processed,0);
  const row=f.sql.prepare('SELECT * FROM document_jobs').get();assert.equal(row.state,'processing');assert.equal(row.attempts,1);assert.equal(row.error_code,'');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,1);assert.notEqual(row.extraction,'{}');
  assert.equal((await f.processing.processDocuments(f.owner,1)).processed,0);assert.equal(f.pdfCalls,1);
});

test('queue health separates runnable work, backoff, active and expired leases without mutating jobs',async t=>{
  const f=await fixture(t),at=Date.parse('2026-11-05T12:00:00.000Z');t.mock.method(Date,'now',()=>at);
  const past='2026-11-05T11:00:00.000Z',future='2026-11-05T12:05:00.000Z';
  const cases=[
    ['pdf','queued','cloud',0,past,''],['ocr','waiting_ocr','local',0,past,''],
    ['backoff','waiting_ocr','local',1,future,''],['busy','processing','local',1,past,future],
    ['expired','processing','local',2,past,past],['exhausted','processing','cloud',3,past,past],
    ['failed','failed','local',3,past,''],['rejected','waiting_ocr','local',0,past,''],
  ];
  for(const [id,state,engine,attempts,available,until] of cases){
    await f.document(id,engine==='cloud'?'application/pdf':'image/png');
    f.sql.prepare('UPDATE documents SET created_at=? WHERE id=?').run(past,id);
    f.sql.prepare('INSERT INTO document_jobs(owner,document_id,state,engine,attempts,available_at,lease_until,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(f.owner,id,state,engine,attempts,available,until,past);
  }
  f.sql.prepare("UPDATE gmail_sources SET status='rejected' WHERE document_id='rejected'").run();
  // Repeated source observations must not multiply a single document's work.
  f.sql.prepare('INSERT INTO gmail_sources(owner,source_id,document_id,metadata,created_at) VALUES(?,?,?,?,?)').run(f.owner,'second-source','ocr','{}',past);
  await f.document('other','image/png','other-owner');
  f.sql.prepare('INSERT INTO document_jobs(owner,document_id,state,engine,available_at,updated_at) VALUES(?,?,?,?,?,?)').run('other-owner','other','waiting_ocr','local',past,past);
  const before=f.sql.prepare('SELECT * FROM document_jobs ORDER BY owner,document_id').all();
  const status=await f.processing.processingStatus(f.owner);
  assert.deepEqual(status.queue_health,{
    basis:'current_jobs',observed_at:'2026-11-05T12:00:00.000Z',pending:6,ready_pdf:1,ready_ocr:1,deferred:1,
    active:1,expired_leases:1,exhausted:2,failed:1,oldest_pending_at:past,next_retry_at:future,
    ocr_worker_unavailable:true,
  });
  assert.deepEqual(f.sql.prepare('SELECT * FROM document_jobs ORDER BY owner,document_id').all(),before);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);
});

test('queue throughput counts distinct accepted documents in the observed day and excludes other owners and unfinished work',async t=>{
  const f=await fixture(t),at=Date.parse('2026-11-05T12:00:00.000Z');t.mock.method(Date,'now',()=>at);
  for(const [id,state] of [['done','needs_review'],['old','needs_review'],['inflight','processing'],['future','needs_review'],['rejected','needs_review']]){
    await f.document(id);
    f.sql.prepare('INSERT INTO document_jobs(owner,document_id,state,available_at,updated_at) VALUES(?,?,?,?,?)').run(f.owner,id,state,'2026-11-05T10:00:00Z','2026-11-05T10:00:00Z');
  }
  const insert=f.sql.prepare('INSERT INTO document_extractions(id,owner,document_id,result,created_at) VALUES(?,?,?,?,?)');
  for(const [id,document,time,owner=f.owner] of [
    ['a','done','2026-11-04T12:00:00.000Z'],['b','done','2026-11-05T11:00:00.000Z'],
    ['c','old','2026-11-04T11:59:59.999Z'],['d','inflight','2026-11-05T11:00:00.000Z'],
    ['e','future','2026-11-05T12:00:00.001Z'],['f','rejected','2026-11-05T11:00:00.000Z'],
    ['g','done','2026-11-05T11:00:00.000Z','other-owner'],
  ])insert.run(id,owner,document,'{}',time);
  f.sql.prepare("UPDATE gmail_sources SET status='rejected' WHERE document_id='rejected'").run();
  const status=await f.processing.processingStatus(f.owner);
  assert.deepEqual(status.throughput,{basis:'accepted_extractions_with_terminal_job',window_start:'2026-11-04T12:00:00.000Z',window_end:'2026-11-05T12:00:00.000Z',completed_documents:1});
});

test('queue health reports no unavailable worker for an empty or paused OCR queue',async t=>{
  const f=await fixture(t);
  assert.equal((await f.processing.processingStatus(f.owner)).queue_health.ocr_worker_unavailable,false);
  await f.document('waiting');await f.processing.enqueueDocuments(f.owner);
  assert.equal((await f.processing.processingStatus(f.owner)).queue_health.ocr_worker_unavailable,true);
  f.sql.prepare('UPDATE document_automation SET enabled=0').run();
  assert.equal((await f.processing.processingStatus(f.owner)).queue_health.ocr_worker_unavailable,false);
  f.sql.prepare('UPDATE document_automation SET enabled=1,cloud_worker_seen=?').run(new Date().toISOString());
  assert.equal((await f.processing.processingStatus(f.owner)).queue_health.ocr_worker_unavailable,false);
});

test('a final-attempt accepted extraction survives an interrupted continuation as review work without repeating OCR',async t=>{
  const f=await fixture(t);await f.document('last-attempt');await f.processing.enqueueDocuments(f.owner);
  f.sql.prepare('UPDATE document_jobs SET attempts=2').run();
  const job=await f.lease(),prepare=f.d1.prepare.bind(f.d1);let interrupted=false;
  f.d1.prepare=query=>{
    const statement=prepare(query);
    if(query==='SELECT * FROM document_automation WHERE owner=?'){
      const first=statement.first.bind(statement);statement.first=async()=>{if(!interrupted){interrupted=true;throw Error('synthetic final continuation failure');}return first();};
    }
    return statement;
  };
  await assert.rejects(f.complete(job),/synthetic final continuation failure/);
  const before=f.sql.prepare('SELECT * FROM document_jobs').get(),history=f.sql.prepare('SELECT * FROM document_extractions').all(),original=f.objects.get(f.owner+'/last-attempt');
  assert.equal(before.attempts,3);assert.equal(history.length,1);
  f.sql.prepare("UPDATE document_jobs SET lease_until='2000-01-01'").run();await f.restart();
  assert.equal(await f.lease(),null,'already accepted output needs review, not another OCR lease');
  const after=f.sql.prepare('SELECT * FROM document_jobs').get();
  assert.equal(after.state,'needs_review');assert.equal(after.error_code,'processing_interrupted_after_extraction');
  assert.equal(after.attempts,3);assert.equal(after.extraction,before.extraction);assert.equal(after.lease,'');assert.equal(after.lease_until,'');
  assert.deepEqual(f.sql.prepare('SELECT * FROM document_extractions').all(),history);
  assert.deepEqual(f.objects.get(f.owner+'/last-attempt'),original);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);
  assert.equal((await f.complete(job)).status,409);
});

for(const defect of ['previous lease receipt','missing history','changed original','rejected while reading'])test(`interrupted extraction recovery refuses ${defect}`,async t=>{
  const f=await fixture(t);await f.document('guarded');await f.processing.enqueueDocuments(f.owner);
  f.sql.prepare('UPDATE document_jobs SET attempts=2').run();const job=await f.lease();
  const prepare=f.d1.prepare.bind(f.d1);let interrupted=false;
  f.d1.prepare=query=>{const statement=prepare(query);if(query==='SELECT * FROM document_automation WHERE owner=?'){
    const first=statement.first.bind(statement);statement.first=async()=>{if(!interrupted){interrupted=true;throw Error('synthetic interruption');}return first();};
  }return statement;};
  await assert.rejects(f.complete(job),/synthetic interruption/);
  const receipt=f.sql.prepare('SELECT extraction FROM document_jobs').get().extraction;
  f.sql.prepare("UPDATE document_jobs SET lease_until='2000-01-01'").run();
  if(defect==='previous lease receipt')f.sql.prepare("UPDATE document_jobs SET lease='replacement-lease'").run();
  if(defect==='missing history')f.sql.prepare('DELETE FROM document_extractions').run();
  if(defect==='changed original')f.objects.set(f.owner+'/guarded',Buffer.from('different synthetic bytes'));
  if(defect==='rejected while reading'){
    const get=f.env.BUCKET.get;f.env.BUCKET.get=async key=>{f.sql.prepare("UPDATE gmail_sources SET status='rejected'").run();return get(key);};
  }
  await f.restart();assert.equal(await f.lease(),null);
  const after=f.sql.prepare('SELECT * FROM document_jobs').get();assert.equal(after.state,'failed');assert.equal(after.extraction,receipt);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);
});

for(const brokenFirstReceipt of [false,true])test(`restored final-attempt backlog recovers in bounded batches without failing unchecked receipts${brokenFirstReceipt?' after an invalid receipt':''}`,async t=>{
  const f=await fixture(t),leases=[];
  // Construct real accepted receipts before restoring their interrupted job
  // states. Older snapshots may contain more jobs than today's two live slots.
  for(const id of ['a','b','c']){
    await f.document(id);await f.processing.enqueueDocuments(f.owner);
    f.sql.prepare('UPDATE document_jobs SET attempts=2 WHERE document_id=?').run(id);
    const job=await f.lease();assert.equal(job.id,id);leases.push(job);
    assert.equal((await f.complete(job)).status,200);
  }
  for(const job of leases)f.sql.prepare("UPDATE document_jobs SET state='processing',lease=?,lease_until='2000-01-01',updated_at='2000-01-01' WHERE document_id=?").run(job.lease,job.id);
  if(brokenFirstReceipt)f.sql.prepare('DELETE FROM document_extractions WHERE document_id=?').run('a');
  const unchecked={...f.sql.prepare('SELECT * FROM document_jobs WHERE document_id=?').get('c')};
  const history=f.sql.prepare('SELECT * FROM document_extractions ORDER BY document_id').all();
  const originals=[...f.objects].map(([id,bytes])=>[id,Buffer.from(bytes)]);
  await f.processing.enqueueDocuments(f.owner);
  assert.deepEqual({...f.sql.prepare('SELECT * FROM document_jobs WHERE document_id=?').get('c')},unchecked,
    'the third receipt must remain available for the next bounded recovery pass');
  assert.equal(f.sql.prepare('SELECT state FROM document_jobs WHERE document_id=?').get('a').state,brokenFirstReceipt?'failed':'needs_review');
  assert.equal(f.sql.prepare('SELECT state FROM document_jobs WHERE document_id=?').get('b').state,'needs_review');
  await f.restart();await f.processing.enqueueDocuments(f.owner);
  assert.equal(f.sql.prepare('SELECT state FROM document_jobs WHERE document_id=?').get('c').state,'needs_review');
  assert.equal(await f.lease(),null,'accepted receipts must never create another OCR attempt');
  assert.deepEqual(f.sql.prepare('SELECT * FROM document_extractions ORDER BY document_id').all(),history);
  assert.deepEqual([...f.objects],originals);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_jobs WHERE attempts<>3').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);
});


async function realIngressWorker(t,f){
  const key='__ocr_ingress_'+crypto.randomUUID().replaceAll('-','');
  globalThis[key]=f;t.after(()=>{delete globalThis[key];});
  const reference='globalThis['+JSON.stringify(key)+']';
  let source=ts.transpileModule(readFileSync(new URL('../lib/server.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const imports={
    'cloudflare:workers':data('export const env={};'),
    '@/app/chatgpt-auth':data('export async function getChatGPTUser(){return null;}'),
    './domain':new URL('../lib/domain.ts',import.meta.url).href,
    './company-storage.js':new URL('../lib/company-storage.js',import.meta.url).href,
  };
  for(const [from,to] of Object.entries(imports))for(const quote of ['"',"'"])source=source.replaceAll(quote+from+quote,JSON.stringify(to));
  const {withCompanyRequest}=await import(data(source));
  let route=ts.transpileModule(readFileSync(new URL('../app/api/ocr-worker/[action]/route.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const worker=data('const f='+reference+';export const workerAction=(...args)=>{f.ingressDispatches++;return f.processing.workerAction(...args);};');
  route=route.replace("'@/lib/document-processing'",JSON.stringify(worker));
  const handle=withCompanyRequest((await import(data(route))).POST);f.ingressDispatches=0;
  return body=>handle(new Request('https://synthetic.example/api/ocr-worker/complete',{method:'POST',headers:{Authorization:'Bearer '+f.env.DOCUMENT_WORKER_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(body)}));
}

test('OCR completion accepts valid multibyte text through the real route and company ingress',async t=>{
  const f=await fixture(t);await f.document('utf8-completion');const job=await f.lease();
  const original=Buffer.from(f.objects.get(f.owner+'/'+job.id));
  const complete=await realIngressWorker(t,f),body={...job,text:'漢'.repeat(120000),method:'ocr',confidence:90};
  const raw=JSON.stringify(body);assert.ok(raw.length<350000&&Buffer.byteLength(raw)>350000&&Buffer.byteLength(raw)<600000);
  const result=await complete(body);assert.equal(result.status,200);assert.equal((await result.json()).state,'needs_review');
  assert.equal(f.ingressDispatches,1,'Exactly one completion reaches the existing worker handler');
  assert.equal(f.sql.prepare('SELECT state FROM document_jobs WHERE document_id=?').get(job.id).state,'needs_review');
  assert.deepEqual(f.objects.get(f.owner+'/'+job.id),original,'The retained original is unchanged');
});

test('OCR completion keeps the finite 600000-byte ingress ceiling before worker dispatch',async t=>{
  const f=await fixture(t),complete=await realIngressWorker(t,f);
  const body={text:'漢'.repeat(200000)};assert.ok(Buffer.byteLength(JSON.stringify(body))>600000);
  const result=await complete(body);assert.equal(result.status,413);assert.equal((await result.json()).code,'REQUEST_BODY_TOO_LARGE');
  assert.equal(f.ingressDispatches,0);
});

for(const [name,extra,status] of [
  ['OCR text characters',{text:'x'.repeat(150001)},400],
  ['raw JSON characters',{padding:'x'.repeat(350000)},413],
])test('OCR ingress preserves the existing domain limit for '+name,async t=>{
  const f=await fixture(t);await f.document('domain-limit');const job=await f.lease(),complete=await realIngressWorker(t,f);
  const result=await complete({...job,text:'Synthetic OCR',method:'ocr',confidence:90,...extra});
  assert.equal(result.status,status);assert.equal(f.ingressDispatches,1,'The unchanged domain validator rejects this finite request');
  assert.equal(f.sql.prepare('SELECT state FROM document_jobs WHERE document_id=?').get(job.id).state,'processing');
});
