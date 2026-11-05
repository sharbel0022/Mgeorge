import test from 'node:test';
import {invoiceParserUrl} from './helpers/invoice-module-loader.mjs';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {emptyState} from '../lib/domain.ts';
import {randomToken} from '../lib/banking/security.ts';
import {serverPdfText} from '../lib/server-pdf.ts';
import {runSitesOcr} from '../../src/sites-ocr-pull.js';
import {image as syntheticInvoiceImage,pdf} from '../../test/fixtures.js';
import {packet,digest} from '../../test/helpers/ocr-bankgiro-cases.mjs';

const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const validInvoiceText='Faktura\nFakturanummer: 0007\nLeverantör: Exempelbolaget AB\nOrg.nr: 556016-0680\nFakturadatum: 24/10/2026\nFörfallodag: 07/11/2026\nBelopp före moms: 2 500,00 SEK\nTotal moms: 625,00 SEK\nSumma att betala: 3 125,00 SEK\nBankgiro: 123-4567';
class D1 {
  constructor(sql){this.sql=sql;}
  prepare(query){const db=this.sql;return {args:[],bind(...args){this.args=args;return this;},async first(){return db.prepare(query).get(...this.args)||null;},async all(){return {results:db.prepare(query).all(...this.args)};},async run(){return this.execute();},execute(){return {meta:{changes:Number(db.prepare(query).run(...this.args).changes)}};}};}
  async batch(rows){this.sql.exec('BEGIN');try{const out=rows.map(row=>row.execute());this.sql.exec('COMMIT');return out;}catch(e){this.sql.exec('ROLLBACK');throw e;}}
}
async function fixture(t,{nativePdf=false}={}){
  const sql=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('../drizzle',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(read('../drizzle/'+file));
  const key='__cloud_ocr_'+crypto.randomUUID().replaceAll('-',''),owner='synthetic-owner';
  const f={sql,owner,objects:new Map(),pdfCalls:0,parsePdf:nativePdf?serverPdfText:async()=>{throw Error('local_ocr_required');},env:{DOCUMENT_CLOUD_OCR_ENABLED:'true',DOCUMENT_CLOUD_WORKER_TOKEN:randomToken(),DOCUMENT_WORKER_TOKEN:randomToken(),DOCUMENT_OWNER_EMAIL:'owner@example.test'}};
  f.db=new D1(sql);f.env.BUCKET={get:async key=>{const bytes=f.objects.get(key);return bytes?{size:bytes.length,body:bytes,arrayBuffer:async()=>Uint8Array.from(bytes).buffer}:null;}};
  globalThis[key]=f;t.after(()=>{delete globalThis[key];sql.close();});
  const ref=`globalThis[${JSON.stringify(key)}]`,domain=new URL('../lib/domain.ts',import.meta.url).href;
  const server=data(`import {emptyState} from ${JSON.stringify(domain)};const f=${ref};export async function companyWorkerIdentity(){return null;}export async function companyWorkerConfigured(){return null;}export const db=()=>f.db;export const response=(body,status=200)=>Response.json(body,{status});export const identity=async()=>({userId:f.owner,email:'owner@example.test'});export const readWorkspace=async owner=>{const row=f.sql.prepare('SELECT revision,payload FROM workspaces WHERE owner=?').get(owner);return row?{revision:row.revision,state:JSON.parse(row.payload)}:{revision:0,state:emptyState()};};`);
  const fields=invoiceParserUrl();
  const imports={'cloudflare:workers':data(`export const env=${ref}.env;`),'./server':server,'./domain':domain,'./banking/security':new URL('../lib/banking/security.ts',import.meta.url).href,'./invoice-fields.js':fields,'./server-pdf':data(`export async function serverPdfText(bytes){${ref}.pdfCalls++;return ${ref}.parsePdf(bytes);}`),'./customer-messages':data("export async function reconcileAndPrepare(){throw Error('Unexpected automatic registration');}")};
  let source=ts.transpileModule(read('../lib/document-processing.ts'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  for(const [name,url] of Object.entries(imports))for(const q of ['"',"'"])source=source.replaceAll(q+name+q,JSON.stringify(url));
  f.api=await import(data(source));
  sql.prepare('INSERT INTO document_automation(owner,email,enabled,auto_register,updated_at) VALUES(?,?,1,0,?)').run(owner,f.env.DOCUMENT_OWNER_EMAIL,new Date().toISOString());
  f.add=(id='synthetic-scan',mime='image/png',documentOwner=owner)=>{
    const bytes=Buffer.from('synthetic document '+id),hash=createHash('sha256').update(bytes).digest('hex'),at=new Date().toISOString();
    sql.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run(id,documentOwner,id+'.png',mime,bytes.length,hash,at);
    sql.prepare('INSERT INTO gmail_sources(source_id,owner,document_id,metadata,status,extraction,created_at) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),documentOwner,id,JSON.stringify({direction:'customer',direction_confident:true,subject:'Synthetic invoice',to:'customer@example.test'}),'needs_review','{}',at);
    f.objects.set(documentOwner+'/'+id,bytes);return {id,sha256:hash,bytes};
  };
  f.call=async(action,body={},mode='cloud',token=mode==='cloud'?f.env.DOCUMENT_CLOUD_WORKER_TOKEN:f.env.DOCUMENT_WORKER_TOKEN)=>{
    const isGet=action==='document',params=isGet?'?id='+encodeURIComponent(body.id):'';
    const req=new Request('https://site.example/api/ocr-worker/'+action+params,{method:isGet?'GET':'POST',headers:{Authorization:'Bearer '+token,'X-MG-OCR-Runner':mode,'Content-Type':'application/json',...(body.lease?{'X-MG-OCR-Lease':body.lease}:{})},body:isGet?undefined:JSON.stringify(body)});
    return f.api.workerAction(req,action);
  };
  f.lease=async(mode='cloud')=>(await (await f.call('lease',{},mode)).json()).job;
  f.complete=(job,extra={})=>f.call('complete',{id:job.id,lease:job.lease,sha256:job.sha256,method:'ocr',confidence:90,text:'Faktura 0599\nTotalt att betala 625,00 SEK',...extra});
  return f;
}

function enableTrustedAutomation(f){
  f.sql.prepare('UPDATE document_automation SET auto_register=1').run();
  f.sql.prepare('UPDATE gmail_sources SET metadata=?').run(JSON.stringify({direction:'supplier',direction_confident:true,subject:'Synthetic invoice',from:'supplier@example.test'}));
  f.sql.prepare('INSERT INTO invoice_counterparties(owner,identity,email,bankgiro,evidence,verified_at) VALUES(?,?,?,?,?,?)').run(f.owner,f.api.counterpartyKey('supplier','Exempelbolaget AB','5560160680'),'supplier@example.test','123-4567','Explicitly verified synthetic original and counterparty','2026-01-01');
}

for(const mode of ['local','cloud'])for(const scenario of ['high','low','missing','other-original','other-text','real-four-digit'])test(`${mode} bankgiro word proof remains tied to the leased original: ${scenario}`,async t=>{
  const f=await fixture(t),doc=f.add();enableTrustedAutomation(f);const job=await f.lease(mode);
  const value=scenario==='real-four-digit'?'1223-4567':'123-4567',text=validInvoiceText.replace('123-4567',value);
  const evidence=scenario==='missing'?undefined:packet(text,{inputHash:job.sha256,value,confidence:scenario==='low'?0:95});
  if(scenario==='other-original')evidence.inputSha256=digest('a different synthetic original');
  if(scenario==='other-text')evidence.textSha256=digest('a different synthetic OCR result');
  const response=await f.call('complete',{...job,text,confidence:99,method:'ocr',ocrEvidence:evidence},mode);
  assert.equal(response.status,200);assert.equal((await response.json()).state,'needs_review');
  const row=f.sql.prepare('SELECT * FROM document_jobs').get(),stored=f.sql.prepare('SELECT result FROM document_extractions').get(),result=JSON.parse(row.extraction);
  assert.equal(result.fields.bankgiro.value,['high','real-four-digit'].includes(scenario)?value:null);
  assert.match(result.fields.bankgiro.evidence,new RegExp(value));assert.equal(result.text_excerpt,text);
  assert.deepEqual(JSON.parse(stored.result).fields.bankgiro,result.fields.bankgiro);
  if(!['high','real-four-digit'].includes(scenario))assert.match(result.fields.bankgiro.warning,/Bankgiro.*ordunderlag/);
  assert.equal(result.fields.invoice_number.confidence,.85);assert.notEqual(result.level,'green');assert.equal(row.automatic,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);
  assert.deepEqual(f.objects.get(f.owner+'/'+doc.id),doc.bytes);
});

test('verified native PDF original retains server extraction confidence and automatic registration',async t=>{
  const f=await fixture(t,{nativePdf:true}),doc=f.add('native-pdf','application/pdf');enableTrustedAutomation(f);
  const stream='BT /F1 14 Tf 40 780 Td 22 TL\n'+validInvoiceText.split('\n').map((line,n)=>(n?'T* ':'')+'('+line.replace(/[()\\]/g,'\\$&')+') Tj').join('\n')+'\nET';
  const bytes=pdf(['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',`<< /Length ${Buffer.byteLength(stream,'latin1')} >>\nstream\n${stream}\nendstream`]);
  f.objects.set(f.owner+'/'+doc.id,bytes);f.sql.prepare('UPDATE documents SET size=?,sha256=? WHERE id=?').run(bytes.length,createHash('sha256').update(bytes).digest('hex'),doc.id);
  const result=await f.api.processDocuments(f.owner);assert.equal(result.processed,1);
  const job=f.sql.prepare('SELECT * FROM document_jobs').get(),extraction=JSON.parse(job.extraction);
  assert.equal(job.state,'registered',JSON.stringify(extraction.issues));assert.equal(job.automatic,1);assert.equal(extraction.method,'pdf');assert.equal(extraction.fields.invoice_number.confidence,.96);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,1);
  const workspace=JSON.parse(f.sql.prepare('SELECT payload FROM workspaces').get().payload);assert.equal(workspace.invoices.length,1);assert.equal(workspace.invoices[0].number,'0007');assert.equal(workspace.invoices[0].total,312500);assert.equal(workspace.allocations.length,0);
  assert.deepEqual(f.objects.get(f.owner+'/'+doc.id),bytes);
});

for(const mode of ['cloud','local'])for(const [method,confidence] of [['pdf',0],['pdf',99],['ocr',0],['ocr',99]])test(`${mode} image completion cannot promote ${method}/${confidence} into trusted PDF registration`,async t=>{
  const f=await fixture(t),doc=f.add();enableTrustedAutomation(f);const job=await f.lease(mode);
  const completed=await f.call('complete',{...job,text:validInvoiceText,method,confidence},mode);
  assert.equal(completed.status,200);const outcome=await completed.json();assert.notEqual(outcome.registered,true);assert.equal(outcome.state,'needs_review');
  const row=f.sql.prepare('SELECT * FROM document_jobs').get(),extraction=JSON.parse(row.extraction);
  assert.equal(extraction.method,'ocr');assert.equal(extraction.fields.invoice_number.value,'0007');assert.equal(extraction.fields.total_cents.value,312500);
  assert.equal(extraction.fields.invoice_number.confidence,confidence===0?0:.85);assert.equal(row.automatic,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);
  assert.deepEqual(f.objects.get(f.owner+'/'+doc.id),doc.bytes);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,1);
  assert.equal((await f.call('complete',{...job,text:validInvoiceText,method,confidence},mode)).status,409);
});

test('PDF returned to the OCR queue accepts worker PDF text only at OCR confidence',async t=>{
  const f=await fixture(t),doc=f.add('queued-pdf','application/pdf');enableTrustedAutomation(f);
  const processed=await (await f.call('process')).json();assert.equal(processed.waiting,1);
  const job=await f.lease();assert.equal(job.mime,'application/pdf');
  const outcome=await (await f.complete(job,{method:'pdf',confidence:0,text:validInvoiceText})).json();assert.notEqual(outcome.registered,true);assert.equal(outcome.state,'needs_review');
  const extraction=JSON.parse(f.sql.prepare('SELECT extraction FROM document_jobs').get().extraction);
  assert.equal(extraction.method,'ocr');assert.equal(extraction.fields.invoice_number.confidence,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);
  assert.deepEqual(f.objects.get(f.owner+'/'+doc.id),doc.bytes);
});

for(const method of [undefined,null,'unknown','PDF'])test(`worker completion rejects missing or unknown method ${String(method)} before saving evidence`,async t=>{
  const f=await fixture(t);f.add();enableTrustedAutomation(f);const job=await f.lease();
  assert.equal((await f.complete(job,{method,confidence:0,text:validInvoiceText})).status,400);
  assert.equal(f.sql.prepare('SELECT state FROM document_jobs').get().state,'processing');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);
  assert.equal((await (await f.complete(job,{confidence:0,text:validInvoiceText})).json()).state,'needs_review');
});

for(const [label,offset,local,cloud] of [
  ['future by a millisecond',1,false,false],['future by a day',86400000,false,false],['future by ten years',315360000000,false,false],
  ['now',0,true,true],['inside local contact window',-179999,true,true],['at local expiry',-180000,false,true],
  ['inside cloud contact window',-2699999,false,true],['at cloud expiry',-2700000,false,false],
  ['missing',null,false,false],['invalid','not-a-date',false,false],
])test('Q8: OCR contact status rejects invalid ages and keeps exact windows: '+label,async t=>{
  const f=await fixture(t),at=Date.parse('2026-10-30T12:00:00.000Z');t.mock.method(Date,'now',()=>at);
  const seen=typeof offset==='number'?new Date(at+offset).toISOString():offset||'';
  f.sql.prepare('UPDATE document_automation SET worker_seen=?,cloud_worker_seen=?').run(seen,seen);
  const status=await f.api.processingStatus(f.owner);
  assert.equal(status.worker_online,local);assert.equal(status.cloud_worker_recent,cloud);assert.equal(status.worker_last_seen,seen);assert.equal(status.cloud_worker_last_seen,seen);assert.equal(status.cloud_last_completed,'');
});

test('cloud OCR requires its own enabled credential, and never authorizes ambiguous owners',async t=>{
  const f=await fixture(t);f.add();
  await assert.rejects(f.call('lease',{},'cloud',f.env.DOCUMENT_WORKER_TOKEN),/WORKER_AUTH/);
  await assert.rejects(f.call('lease',{},'local',f.env.DOCUMENT_CLOUD_WORKER_TOKEN),/WORKER_AUTH/);
  f.env.DOCUMENT_CLOUD_OCR_ENABLED='false';await assert.rejects(f.call('lease'),/WORKER_AUTH/);
  f.env.DOCUMENT_CLOUD_OCR_ENABLED='true';
  const cloud=f.env.DOCUMENT_CLOUD_WORKER_TOKEN;f.env.DOCUMENT_CLOUD_WORKER_TOKEN=f.env.DOCUMENT_WORKER_TOKEN;await assert.rejects(f.call('lease'),/WORKER_AUTH/);f.env.DOCUMENT_CLOUD_WORKER_TOKEN=cloud;
  f.sql.prepare('INSERT INTO document_automation(owner,email,enabled,updated_at) VALUES(?,?,1,?)').run('other-owner',f.env.DOCUMENT_OWNER_EMAIL.toUpperCase(),new Date().toISOString());
  await assert.rejects(f.call('lease'),/WORKER_AUTH/);
});

test('parallel local and cloud claims have one winner and bind document access to runner',async t=>{
  const f=await fixture(t),doc=f.add();
  const jobs=await Promise.all([f.lease('cloud'),f.lease('local')]);assert.equal(jobs.filter(Boolean).length,1);
  const index=jobs.findIndex(Boolean),job=jobs[index],mode=index===0?'cloud':'local',other=index===0?'local':'cloud';
  const file=await f.call('document',job,mode);assert.equal(file.status,200);assert.equal(file.headers.get('cache-control'),'no-store');assert.equal(Buffer.from(await file.arrayBuffer()).toString(),doc.bytes.toString());
  assert.equal((await f.call('document',job,other)).status,409);
  const until=f.sql.prepare('SELECT lease_until FROM document_jobs').get().lease_until;assert.ok(Date.parse(until)-Date.now()>(mode==='cloud'?290000:170000));
});

test('a delayed claim cannot consume another workers retry cooldown',async t=>{
 const f=await fixture(t);f.add();await f.api.enqueueDocuments(f.owner);
 const prepare=f.db.prepare.bind(f.db);let delayed=false;
 f.db.prepare=query=>{
  const statement=prepare(query);
  if(query.startsWith("UPDATE document_jobs SET state='processing'")){
   const run=statement.run.bind(statement);
   statement.run=async()=>{if(!delayed){delayed=true;f.sql.prepare("UPDATE document_jobs SET attempts=1,available_at=?").run(new Date(Date.now()+60000).toISOString());}return run();};
  }
  return statement;
 };
 assert.equal(await f.lease(),null);assert.equal(f.sql.prepare('SELECT attempts FROM document_jobs').get().attempts,1);
});

test('cloud runs text PDF discovery and scans without any local heartbeat',async t=>{
  const f=await fixture(t);f.add('scanned-pdf','application/pdf');
  const process=await (await f.call('process')).json();assert.equal(f.pdfCalls,1);assert.equal(process.waiting,1);
  const job=await f.lease();assert.equal(job.id,'scanned-pdf');assert.equal(f.sql.prepare('SELECT attempts FROM document_jobs').get().attempts,1);
  const status=await f.api.processingStatus(f.owner);assert.equal(status.ocr_mode,'cloud');assert.equal(status.worker_online,false);assert.equal(status.cloud_worker_recent,true);assert.equal(status.cloud_last_completed,'');
  assert.equal((await f.call('process',{},'local')).status,404);
});

test('completed cloud OCR keeps extraction provenance and requires review, replay is rejected',async t=>{
  const f=await fixture(t),doc=f.add(),job=await f.lease();const result=await (await f.complete(job)).json();
  assert.equal(result.state,'needs_review');const row=f.sql.prepare('SELECT * FROM document_jobs').get(),extraction=JSON.parse(row.extraction);
  const {run_id,...provenance}=extraction.processing;
  assert.equal(extraction.method,'ocr');assert.deepEqual(provenance,{runner:'cloud',sha256:doc.sha256,version:'document-worker-v3'});
  assert.match(run_id,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(run_id,job.lease);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,1);
  assert.equal((await f.complete(job)).status,409);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);
  assert.ok((await f.api.processingStatus(f.owner)).cloud_last_completed);
});

test('wrong digest, confidence, foreign document and expired lease cannot complete',async t=>{
  const f=await fixture(t);f.add();f.add('foreign','image/png','other-owner');const job=await f.lease();
  assert.equal((await f.complete(job,{sha256:'0'.repeat(64)})).status,400);
  assert.equal((await f.complete(job,{confidence:101})).status,400);
  assert.equal((await f.call('document',{id:'foreign',lease:job.lease})).status,409);
  f.sql.prepare("UPDATE document_jobs SET lease_until='2000-01-01T00:00:00.000Z'").run();
  assert.equal((await f.complete(job)).status,409);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,0);
  const replacement=await f.lease();assert.notEqual(replacement.lease,job.lease);assert.equal((await f.complete(job)).status,409);
});

for(const changed of ['missing','same-size corruption','changed size'])test('OCR completion rejects an original that became '+changed+' during its lease',async t=>{
  const f=await fixture(t),doc=f.add(),job=await f.lease(),key=f.owner+'/'+doc.id;
  const original=f.sql.prepare('SELECT * FROM documents WHERE owner=? AND id=?').get(f.owner,doc.id);
  if(changed==='missing')f.objects.delete(key);
  else f.objects.set(key,changed==='same-size corruption'?Buffer.alloc(doc.bytes.length,88):Buffer.concat([doc.bytes,Buffer.from('changed')]));
  const result=await f.complete(job);
  assert.equal(result.status,409);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);
  assert.equal(f.sql.prepare('SELECT extraction FROM gmail_sources').get().extraction,'{}');
  assert.deepEqual(f.sql.prepare('SELECT * FROM documents WHERE owner=? AND id=?').get(f.owner,doc.id),original);
  const failed=f.sql.prepare('SELECT state,error_code,lease,attempts FROM document_jobs').get();
  assert.deepEqual({...failed},{state:'waiting_ocr',error_code:'original_integrity',lease:'',attempts:1});
  assert.equal((await f.api.processingStatus(f.owner)).cloud_last_completed,'');
  assert.equal(await f.lease(),null,'integrity failures obey the persistent retry cooldown');
  f.objects.set(key,doc.bytes);
  f.sql.prepare("UPDATE document_jobs SET available_at='2000-01-01T00:00:00.000Z'").run();
  const retry=await f.lease();assert.ok(retry);assert.notEqual(retry.lease,job.lease);
  assert.equal((await f.complete(job)).status,409,'a repaired original cannot revive the old lease');
  const completed=await (await f.complete(retry)).json();assert.equal(completed.state,'needs_review');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,1);
  assert.deepEqual(f.objects.get(key),doc.bytes);
});

test('OCR completion rejects false stored size even when the worker repeats the recorded digest',async t=>{
  const f=await fixture(t);f.add();const job=await f.lease();
  f.sql.prepare('UPDATE documents SET size=size+1').run();
  assert.equal((await f.complete(job)).status,409);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,0);
  assert.equal(f.sql.prepare('SELECT error_code FROM document_jobs').get().error_code,'original_integrity');
});

for(const change of ['hash','size','owner'])test('OCR receipt rejects a document '+change+' changed after original verification',async t=>{
  const f=await fixture(t),doc=f.add(),job=await f.lease();
  const batch=f.db.batch.bind(f.db);let changed=false;
  f.db.batch=async items=>{
    if(!changed){
      changed=true;
      if(change==='hash')f.sql.prepare('UPDATE documents SET sha256=? WHERE id=?').run('0'.repeat(64),doc.id);
      if(change==='size')f.sql.prepare('UPDATE documents SET size=size+1 WHERE id=?').run(doc.id);
      if(change==='owner')f.sql.prepare('UPDATE documents SET owner=? WHERE id=?').run('other-owner',doc.id);
    }
    return batch(items);
  };
  assert.equal((await (await f.complete(job)).json()).ignored,true);
  assert.equal(changed,true);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,0);
  assert.equal(f.sql.prepare('SELECT extraction FROM document_jobs').get().extraction,'{}');
  assert.equal(f.sql.prepare('SELECT extraction FROM gmail_sources').get().extraction,'{}');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);
  assert.equal((await f.api.processingStatus(f.owner)).cloud_last_completed,'');
  assert.deepEqual(f.objects.get(f.owner+'/'+doc.id),doc.bytes);
});

test('OCR completion uses the database clock when the application clock is behind',async t=>{
  const f=await fixture(t);f.add();const job=await f.lease(),at=Date.now();
  f.sql.prepare('UPDATE document_jobs SET lease_until=?').run(new Date(at-1000).toISOString());
  t.mock.timers.enable({apis:['Date'],now:at-60000});
  assert.equal((await f.complete(job)).status,409);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,0);
  assert.equal(f.sql.prepare('SELECT extraction FROM gmail_sources').get().extraction,'{}');
});

test('an OCR lease that expires at the write boundary cannot save extraction or history',async t=>{
  const f=await fixture(t);f.add();const job=await f.lease(),at=Date.now();
  t.mock.timers.enable({apis:['Date'],now:at-60000});
  const batch=f.db.batch.bind(f.db);let delayed=false;
  f.db.batch=async items=>{if(!delayed){delayed=true;f.sql.prepare('UPDATE document_jobs SET lease_until=?').run(new Date(at-1000).toISOString());}return batch(items);};
  assert.equal((await (await f.complete(job)).json()).ignored,true);
  assert.equal(delayed,true);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,0);
  assert.equal(f.sql.prepare('SELECT extraction FROM gmail_sources').get().extraction,'{}');
  assert.equal(f.sql.prepare('SELECT extraction FROM document_jobs').get().extraction,'{}');
});

test('an interpretation accepted within a lease retains its history when the deadline passes inside the batch',async t=>{
  const f=await fixture(t);f.add();const job=await f.lease();
  const batch=f.db.batch.bind(f.db);let delayed=false;
  f.db.batch=async items=>{
    if(!delayed){
      delayed=true;const execute=items[0].execute.bind(items[0]);
      items[0].execute=()=>{const result=execute();f.sql.prepare('UPDATE document_jobs SET lease_until=?').run(new Date(Date.now()-1000).toISOString());return result;};
    }
    return batch(items);
  };
  assert.equal((await (await f.complete(job)).json()).ignored,true);
  const current=f.sql.prepare('SELECT extraction FROM document_jobs').get().extraction;
  assert.notEqual(current,'{}');
  const history=f.sql.prepare('SELECT result FROM document_extractions').all();
  assert.equal(history.length,1);
  assert.equal(history[0].result,current);
  assert.equal((await f.api.processingStatus(f.owner)).cloud_last_completed,'');
});

test('an OCR lease that expires after saving evidence cannot falsely complete the job',async t=>{
  const f=await fixture(t);f.add();const job=await f.lease(),at=Date.now();
  t.mock.timers.enable({apis:['Date'],now:at-60000});
  const prepare=f.db.prepare.bind(f.db);let expired=false;
  f.db.prepare=query=>{
    const statement=prepare(query);
    if(query==='SELECT * FROM document_automation WHERE owner=?'){
      const first=statement.first.bind(statement);
      statement.first=async()=>{const result=await first();expired=true;f.sql.prepare('UPDATE document_jobs SET lease_until=?').run(new Date(at-1000).toISOString());return result;};
    }
    return statement;
  };
  assert.equal((await (await f.complete(job)).json()).ignored,true);
  assert.equal(expired,true);
  assert.equal(f.sql.prepare('SELECT state FROM document_jobs').get().state,'processing');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,1,'valid earlier evidence remains in history');
  assert.equal((await f.api.processingStatus(f.owner)).cloud_last_completed,'');
});

test('three failures exhaust bounded retries and preserve original, then explicit retry resets attempts',async t=>{
  const f=await fixture(t),doc=f.add();
  for(let n=0;n<3;n++){const job=await f.lease();assert.ok(job);assert.equal((await f.complete(job,{text:'',error:true})).status,200);f.sql.prepare("UPDATE document_jobs SET available_at='2000-01-01T00:00:00.000Z'").run();}
  assert.equal(await f.lease(),null);const row=f.sql.prepare('SELECT * FROM document_jobs').get();assert.equal(row.state,'failed');assert.equal(row.attempts,3);assert.equal(row.error_code,'cloud_ocr_failed');assert.deepEqual(f.objects.get(f.owner+'/'+doc.id),doc.bytes);
  const req=new Request('https://site.example/api/document-processing/retry',{method:'POST',body:JSON.stringify({document_id:doc.id})});await f.api.processingAction(req,'retry');assert.ok(await f.lease());
});

test('pause, rejected source, and exhausted abandoned lease are respected by both workers',async t=>{
  const f=await fixture(t);f.add();const job=await f.lease();
  f.sql.prepare("UPDATE gmail_sources SET status='rejected'").run();assert.equal((await f.complete(job)).status,409);assert.equal((await f.call('document',job)).status,409);
  f.sql.prepare("UPDATE gmail_sources SET status='needs_review'").run();f.sql.prepare("UPDATE document_jobs SET lease_until='2000-01-01',attempts=3").run();assert.equal(await f.lease(),null);assert.equal(f.sql.prepare('SELECT state FROM document_jobs').get().state,'failed');
  f.sql.prepare('UPDATE document_automation SET enabled=0').run();await assert.rejects(f.call('lease'),/WORKER_AUTH/);await assert.rejects(f.call('lease',{},'local'),/WORKER_AUTH/);
});

test('configuration alone never reports a recent or successful cloud run',async t=>{
  const f=await fixture(t),status=await f.api.processingStatus(f.owner);assert.equal(status.cloud_ocr_configured,true);assert.equal(status.cloud_worker_recent,false);assert.equal(status.cloud_last_completed,'');
  f.sql.prepare("UPDATE document_automation SET cloud_worker_seen='2000-01-01T00:00:00.000Z'").run();assert.equal((await f.api.processingStatus(f.owner)).cloud_worker_recent,false);
});

test('real cloud pull runner reads a scan from Sites and saves reviewed OCR without a local heartbeat',async t=>{
  const f=await fixture(t),document=f.add('actual-synthetic-invoice-scan');
  const bytes=syntheticInvoiceImage().toBuffer('image/png'),sha256=createHash('sha256').update(bytes).digest('hex');
  f.objects.set(f.owner+'/'+document.id,bytes);
  f.sql.prepare('UPDATE documents SET size=?,sha256=? WHERE owner=? AND id=?').run(bytes.length,sha256,f.owner,document.id);
  f.sql.prepare('UPDATE gmail_sources SET metadata=? WHERE owner=? AND document_id=?').run(JSON.stringify({direction:'supplier',direction_confident:true,subject:'Syntetisk faktura 0606',original_filename:'synthetic-invoice.png',from:'supplier@example.test'}),f.owner,document.id);
  const calls=[];
  const fetchImpl=async(url,options)=>{
    assert.equal(new URL(url).origin,'https://site.example');assert.equal(options.redirect,'manual');
    assert.equal(options.headers.Authorization,'Bearer '+f.env.DOCUMENT_CLOUD_WORKER_TOKEN);assert.equal(options.headers['X-MG-OCR-Runner'],'cloud');
    const action=new URL(url).pathname.split('/').pop();calls.push(action);
    return f.api.workerAction(new Request(url,options),action);
  };
  const result=await runSitesOcr({origin:'https://site.example',token:f.env.DOCUMENT_CLOUD_WORKER_TOKEN,mode:'cloud'},{fetchImpl});
  assert.deepEqual(result,{processed:1,failed:0});assert.deepEqual(calls,['process','lease','document','complete','lease']);
  const job=f.sql.prepare('SELECT * FROM document_jobs WHERE owner=? AND document_id=?').get(f.owner,document.id),extraction=JSON.parse(job.extraction);
  assert.equal(job.state,'needs_review');assert.equal(job.lease,'');assert.equal(job.automatic,0);
  assert.equal(extraction.method,'ocr');assert.equal(extraction.fields.invoice_number.value,'0606');assert.equal(extraction.fields.total_cents.value,375000);assert.equal(extraction.level,'yellow');
  const {run_id,...provenance}=extraction.processing;
  assert.deepEqual(provenance,{runner:'cloud',sha256,version:'document-worker-v3'});assert.match(run_id,/^[A-Za-z0-9_-]{43}$/);
  const stored=f.sql.prepare('SELECT * FROM document_extractions WHERE owner=? AND document_id=?').all(f.owner,document.id);
  assert.equal(stored.length,1);assert.equal(JSON.parse(stored[0].result).fields.invoice_number.value,'0606');
  assert.equal(JSON.parse(f.sql.prepare('SELECT extraction FROM gmail_sources WHERE owner=? AND document_id=?').get(f.owner,document.id).extraction).method,'ocr');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);
  assert.deepEqual(f.objects.get(f.owner+'/'+document.id),bytes);
  const status=await f.api.processingStatus(f.owner);assert.equal(status.worker_online,false);assert.equal(status.worker_last_seen,'');assert.equal(status.cloud_worker_recent,true);assert.ok(status.cloud_last_completed);
});
