import test from 'node:test';
import {invoiceParserUrl} from './helpers/invoice-module-loader.mjs';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createCanvas} from '../../node_modules/@napi-rs/canvas/index.js';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import ts from 'typescript';
import {emptyState} from '../lib/domain.ts';
import {randomToken} from '../lib/banking/security.ts';
import {serverPdfText,PDF_LIMITS} from '../lib/server-pdf.ts';
import {runDocumentProcess} from '../../src/invoice-extraction.js';
import {text,textPdf,pdf} from '../../test/fixtures.js';
import {rasterPdf,archiveFooter} from '../../test/helpers/optical-invoice-fixtures.mjs';

const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const moduleUrl=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
class D1 {
  constructor(sql){this.sql=sql;}
  prepare(query){const db=this.sql;return {args:[],bind(...args){this.args=args;return this;},async first(){return db.prepare(query).get(...this.args)||null;},async all(){return {results:db.prepare(query).all(...this.args)};},async run(){return this.execute();},execute(){return {meta:{changes:Number(db.prepare(query).run(...this.args).changes)}};}};}
  async batch(rows){this.sql.exec('BEGIN');try{const out=rows.map(row=>row.execute());this.sql.exec('COMMIT');return out;}catch(e){this.sql.exec('ROLLBACK');throw e;}}
}
async function processingFixture(t,bytes){
  const sql=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('../drizzle',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(read('../drizzle/'+file));
  const key='__optical_pdf_'+crypto.randomUUID().replaceAll('-',''),owner='synthetic-owner',id='synthetic-footer-scan',sha256=createHash('sha256').update(bytes).digest('hex');
  const f={sql,owner,id,sha256,objects:new Map([[owner+'/'+id,bytes]]),db:new D1(sql),env:{DOCUMENT_CLOUD_OCR_ENABLED:'true',DOCUMENT_CLOUD_WORKER_TOKEN:randomToken(),DOCUMENT_WORKER_TOKEN:randomToken(),DOCUMENT_OWNER_EMAIL:'owner@example.test'}};
  f.env.BUCKET={get:async key=>{const bytes=f.objects.get(key);return bytes?{size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer}:null;}};
  globalThis[key]=f;t.after(()=>{delete globalThis[key];sql.close();});
  const ref=`globalThis[${JSON.stringify(key)}]`,domain=new URL('../lib/domain.ts',import.meta.url).href;
  const server=moduleUrl(`import {emptyState} from ${JSON.stringify(domain)};const f=${ref};export const db=()=>f.db;export const response=(body,status=200)=>Response.json(body,{status});export const identity=async()=>({userId:f.owner,email:'owner@example.test'});export const readWorkspace=async owner=>{const row=f.sql.prepare('SELECT revision,payload FROM workspaces WHERE owner=?').get(owner);return row?{revision:row.revision,state:JSON.parse(row.payload)}:{revision:0,state:emptyState()};};`);
  const fields=invoiceParserUrl();
  const imports={'cloudflare:workers':moduleUrl(`export const env=${ref}.env;`),'./server':server,'./domain':domain,'./banking/security':new URL('../lib/banking/security.ts',import.meta.url).href,'./invoice-fields.js':fields,'./server-pdf':new URL('../lib/server-pdf.ts',import.meta.url).href,'./customer-messages':moduleUrl("export async function reconcileAndPrepare(){throw Error('Unexpected automatic registration');}")};
  let source=ts.transpileModule(read('../lib/document-processing.ts'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  for(const [name,url] of Object.entries(imports))for(const q of ['"',"'"])source=source.replaceAll(q+name+q,JSON.stringify(url));
  f.api=await import(moduleUrl(source));
  const at=new Date().toISOString();
  sql.prepare('INSERT INTO document_automation(owner,email,enabled,auto_register,updated_at) VALUES(?,?,1,1,?)').run(owner,f.env.DOCUMENT_OWNER_EMAIL,at);
  sql.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run(id,owner,id+'.pdf','application/pdf',bytes.length,sha256,at);
  sql.prepare('INSERT INTO gmail_sources(source_id,owner,document_id,metadata,status,extraction,created_at) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),owner,id,JSON.stringify({direction:'supplier',direction_confident:true,subject:'Synthetic invoice',from:'supplier@example.test'}),'needs_review','{}',at);
  sql.prepare('INSERT INTO invoice_counterparties(owner,identity,email,bankgiro,evidence,verified_at) VALUES(?,?,?,?,?,?)').run(owner,f.api.counterpartyKey('supplier','Testbolaget AB','5560160680'),'supplier@example.test','123-4567','Explicit synthetic counterparty verification',at);
  f.call=async(action,body={})=>f.api.workerAction(new Request('https://site.example/api/ocr-worker/'+action,{method:'POST',headers:{Authorization:'Bearer '+f.env.DOCUMENT_CLOUD_WORKER_TOKEN,'X-MG-OCR-Runner':'cloud','Content-Type':'application/json'},body:JSON.stringify(body)}),action);
  return f;
}

test('actual server PDF parser hands a long-footer raster invoice to the OCR queue',async()=>{
  assert.ok(archiveFooter.replace(/\s/g,'').length>60);
  await assert.rejects(serverPdfText(new Uint8Array(rasterPdf({textLayer:archiveFooter}))),/local_ocr_required/);
});

test('actual Workerd also routes the footer raster to local OCR without outbound calls',async()=>{
  const bundled=await build({stdin:{contents:`import {serverPdfText} from './lib/server-pdf';export default {async fetch(req){try{return Response.json(await serverPdfText(new Uint8Array(await req.arrayBuffer())));}catch(e){return Response.json({error:e.message},{status:422});}}}`,resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'ts'},bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],conditions:['import','browser','default'],external:['node:*'],write:false,logLevel:'silent'});
  // Disables Miniflare's host-side cf.json fetch as well as worker egress.
  const mf=new Miniflare(convertV4MiniflareOptions({cf:false,modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],outboundService:()=>{throw Error('No network in PDF parser');}}));
  try{
    const result=await mf.dispatchFetch('https://test.example/',{method:'POST',body:rasterPdf({textLayer:archiveFooter})});
    assert.equal(result.status,422);assert.equal((await result.json()).error,'local_ocr_required');
  }finally{await mf.dispose();}
});

test('actual footer scan flows from server parsing through worker extraction and remains review-only',async t=>{
  const bytes=rasterPdf({textLayer:archiveFooter}),f=await processingFixture(t,bytes);
  const outcome=await f.api.processDocuments(f.owner);
  assert.equal(outcome.processed,0);assert.equal(outcome.counts.waiting_ocr,1);
  const queued=f.sql.prepare('SELECT state,engine,extraction FROM document_jobs').get();
  assert.equal(queued.state,'waiting_ocr');assert.equal(queued.engine,'local');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,0);
  const job=(await (await f.call('lease')).json()).job;assert.equal(job.id,f.id);assert.equal(job.sha256,f.sha256);
  const extracted=await runDocumentProcess(bytes,'application/pdf');assert.equal(extracted.method,'ocr');
  const completed=await f.call('complete',{id:job.id,lease:job.lease,sha256:job.sha256,...extracted});
  assert.equal(completed.status,200);assert.equal((await completed.json()).state,'needs_review');
  const saved=f.sql.prepare('SELECT state,automatic,extraction FROM document_jobs').get(),result=JSON.parse(saved.extraction);
  assert.equal(saved.state,'needs_review');assert.equal(saved.automatic,0);assert.equal(result.method,'ocr');
  assert.equal(result.fields.invoice_number.value,'0606');assert.equal(result.fields.total_cents.value,375000);
  assert.equal(result.fields.invoice_number.confidence,.85);assert.equal(result.fields.total_cents.confidence,.85);assert.equal(result.level,'yellow');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);
  assert.deepEqual(f.objects.get(f.owner+'/'+f.id),bytes);
});

test('actual native PDF text with a raster logo keeps server PDF provenance and the registration positive control',async t=>{
  const logo=createCanvas(120,120),ctx=logo.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,120,120);ctx.fillStyle='blue';ctx.fillRect(20,20,80,80);
  const bytes=rasterPdf({canvas:logo,textLayer:text}),parsed=await serverPdfText(new Uint8Array(bytes));
  assert.equal(parsed.method,'pdf');assert.equal(parsed.confidence,100);assert.match(parsed.text,/0606/);
  const f=await processingFixture(t,bytes),outcome=await f.api.processDocuments(f.owner);
  assert.equal(outcome.processed,1);assert.equal(outcome.counts.registered,1);
  const job=f.sql.prepare('SELECT state,automatic,extraction FROM document_jobs').get(),result=JSON.parse(job.extraction);
  assert.equal(job.state,'registered');assert.equal(job.automatic,1);assert.equal(result.method,'pdf');assert.equal(result.fields.invoice_number.confidence,.96);
  const workspace=JSON.parse(f.sql.prepare('SELECT payload FROM workspaces').get().payload);assert.equal(workspace.invoices.length,1);assert.equal(workspace.invoices[0].number,'0606');assert.equal(workspace.invoices[0].total,375000);assert.equal(workspace.allocations.length,0);
});

test('native non-invoice text without raster stays a PDF review result and server size/page/text limits remain',async()=>{
  const textOnly=textPdf(),parsed=await serverPdfText(new Uint8Array(textOnly));assert.equal(parsed.method,'pdf');
  const stream='BT /F1 10 Tf 40 780 Td ('+archiveFooter+') Tj ET';
  const footerOnly=pdf(['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`]);
  assert.equal((await serverPdfText(new Uint8Array(footerOnly))).method,'pdf');
  await assert.rejects(serverPdfText(new Uint8Array(PDF_LIMITS.bytes+1)),/local_ocr_required/);
  const ids=Array.from({length:11},(_,i)=>`${i+3} 0 R`).join(' '),manyPages=pdf(['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${ids}] /Count 11 >>`,...Array.from({length:11},()=> '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>')]);
  await assert.rejects(serverPdfText(new Uint8Array(manyPages)),/page_limit/);
  await assert.rejects(serverPdfText(new Uint8Array(rasterPdf({textLayer:'Archive '.repeat(20000),textFontSize:.001}))),/text_limit/);
});
