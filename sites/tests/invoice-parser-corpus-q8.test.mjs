import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {context,invoiceText,columnInvoice,adjacentOcr,hyphenDates,ambiguousHeaderCases,percentVat,identityCases,dateCases,moneyCases,invoicePdf} from '../../test/helpers/invoice-parser-corpus.mjs';
import {serverPdfText} from '../lib/server-pdf.ts';

const file=path=>new URL(path,import.meta.url).href;
const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const parserUrl=data(readFileSync(new URL('../lib/invoice-fields.js',import.meta.url),'utf8').replace("'./domain'",JSON.stringify(file('../lib/domain.ts'))).replace("'./document-triage.js'",JSON.stringify(file('../lib/document-triage.js'))));
const {interpretInvoice}=await import(parserUrl);

for(const item of identityCases)test('Q8 Sites synthetic invoice identity: '+item.name,()=>{
 const result=interpretInvoice(item.text,context);
 assert.equal(result.text_excerpt,item.text);
 if(item.held){assert.notEqual(result.level,'green');assert.equal(result.fields.invoice_number.value,null);}
 else{assert.equal(result.level,'green');assert.equal(result.fields.invoice_number.value,item.number);assert.equal(result.fields.reference.value,item.reference);assert.equal(result.fields.total_cents.value,375000);}
 if(item.ambiguousColumns)assert.equal(result.fields.reference.value,null);
});

for(const item of dateCases)test('Q8 Sites synthetic Swedish invoice date: '+item.name,()=>{
 const result=interpretInvoice(item.text,context);assert.equal(result.fields.invoice_number.value,'0606');assert.equal(result.text_excerpt,item.text);
 if(item.held){assert.notEqual(result.level,'green');assert.equal(result.fields[item.held].value,null);}
 else{assert.equal(result.level,'green');assert.equal(result.fields.issued_at.value,item.issued);assert.equal(result.fields.due_at.value,item.due);}
});

for(const item of moneyCases)test('Q8 Sites synthetic invoice money unit: '+item.name,()=>{
 const result=interpretInvoice(item.text,context);
 assert.notEqual(result.level,'green');assert.equal(result.fields.vat_cents.value,null);assert.equal(result.text_excerpt,item.text);
});

class MemoryD1{
 constructor(sql){this.sql=sql;}
 prepare(query){const sql=this.sql;return {args:[],bind(...args){this.args=args;return this;},async first(){return sql.prepare(query).get(...this.args)||null;},async all(){return {results:sql.prepare(query).all(...this.args)};},async run(){return this.execute();},execute(){const result=sql.prepare(query).run(...this.args);return {meta:{changes:Number(result.changes)}};}};}
 async batch(items){this.sql.exec('BEGIN');try{const result=items.map(item=>item.execute());this.sql.exec('COMMIT');return result;}catch(error){this.sql.exec('ROLLBACK');throw error;}}
}
async function fixture(t,{trusted=true}={}){
 const sql=new DatabaseSync(':memory:');
 for(const name of readdirSync(new URL('../drizzle',import.meta.url)).filter(name=>/^\d{4}.*\.sql$/.test(name)).sort())sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 const key='__invoice_corpus_'+crypto.randomUUID().replaceAll('-',''),f={sql,d1:new MemoryD1(sql),owner:'synthetic-corpus-owner',objects:new Map(),pdfCalls:0};
 f.env={DOCUMENT_AUTOMATION_ENABLED:'true',DOCUMENT_OWNER_EMAIL:'owner@example.test',BUCKET:{get:async key=>{const bytes=f.objects.get(key);return bytes?{size:bytes.length,arrayBuffer:async()=>bytes}:null;}}};
 f.parsePdf=async bytes=>{f.pdfCalls++;return serverPdfText(Uint8Array.from(bytes));};
 globalThis[key]=f;t.after(()=>{delete globalThis[key];sql.close();});
 const ref='globalThis['+JSON.stringify(key)+']',domain=file('../lib/domain.ts');
 const server=data('import {emptyState} from '+JSON.stringify(domain)+';const f='+ref+';export const db=()=>f.d1;export const response=(body,status=200)=>Response.json(body,{status});export const identity=async()=>({userId:f.owner,email:"owner@example.test"});export async function readWorkspace(owner){const row=await f.d1.prepare("SELECT revision,payload FROM workspaces WHERE owner=?").bind(owner).first();return row?{revision:row.revision,state:JSON.parse(row.payload)}:{revision:0,state:emptyState()};}');
 let source=ts.transpileModule(readFileSync(new URL('../lib/document-processing.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const imports={'cloudflare:workers':data('export const env='+ref+'.env;'),'./server':server,'./domain':domain,'./banking/security':file('../lib/banking/security.ts'),'./invoice-fields.js':parserUrl,'./server-pdf':data('export const serverPdfText=bytes=>'+ref+'.parsePdf(bytes);'),'./customer-messages':data('export async function reconcileAndPrepare(){}')};
 for(const [name,url]of Object.entries(imports))for(const quote of ['"',"'"])source=source.replaceAll(quote+name+quote,JSON.stringify(url));
 f.processing=await import(data(source));await f.processing.processingSettings({userId:f.owner,email:'owner@example.test'});
 if(trusted)sql.prepare('INSERT INTO invoice_counterparties(owner,identity,email,bankgiro,evidence,verified_at) VALUES(?,?,?,?,?,?)').run(f.owner,f.processing.counterpartyKey('supplier','Testbolaget AB','5560160680'),'supplier@example.test','123-4567','Explicitly verified synthetic original and counterparty',new Date().toISOString());
 f.add=(text,id=crypto.randomUUID(),pdfOptions={})=>{
  const bytes=invoicePdf(text,pdfOptions),sha=createHash('sha256').update(bytes).digest('hex'),at=new Date().toISOString();f.objects.set(f.owner+'/'+id,bytes);
  sql.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run(id,f.owner,'syntetiskt-underlag.pdf','application/pdf',bytes.length,sha,at);
  sql.prepare('INSERT INTO gmail_sources(owner,source_id,document_id,metadata,created_at) VALUES(?,?,?,?,?)').run(f.owner,'source-'+id,id,JSON.stringify(context),at);
  return {id,bytes,sha};
 };
 f.invoices=()=>{const row=sql.prepare('SELECT payload FROM workspaces WHERE owner=?').get(f.owner);return row?JSON.parse(row.payload).invoices:[];};
 return f;
}

test('Q8 actual Sites PDF pipeline registers exact labelled identity and Swedish dates, then quarantines a second copy',async t=>{
 const f=await fixture(t),doc=f.add(hyphenDates);await f.processing.processDocuments(f.owner);
 assert.equal(f.pdfCalls,1);assert.equal(f.invoices().length,1);const [invoice]=f.invoices();
 assert.equal(invoice.number,'0606');assert.equal(invoice.ocr,'000018');assert.equal(invoice.total,375000);assert.equal(invoice.issued,'2026-10-24');assert.equal(invoice.due,'2026-11-07');
 assert.deepEqual(f.objects.get(f.owner+'/'+doc.id),doc.bytes);assert.equal(f.sql.prepare('SELECT sha256 FROM documents WHERE id=?').get(doc.id).sha256,doc.sha);
 const duplicate=f.add(invoiceText+'\nSyntetisk kopia');await f.processing.processDocuments(f.owner);
 assert.equal(f.invoices().length,1);assert.equal(f.sql.prepare('SELECT state FROM document_jobs WHERE document_id=?').get(duplicate.id).state,'duplicate');
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,1);
});

test('Q8 actual Sites PDF pipeline never assigns invoice/OCR roles from content-stream order',async t=>{
 for(const reverseColumnValueOrder of [false,true]){
  const f=await fixture(t),doc=f.add(columnInvoice,undefined,{reverseColumnValueOrder});await f.processing.processDocuments(f.owner);
  const job=f.sql.prepare('SELECT state,extraction FROM document_jobs WHERE document_id=?').get(doc.id),result=JSON.parse(job.extraction);
  assert.equal(result.method,'pdf');assert.equal(job.state,'needs_review');assert.equal(result.fields.invoice_number.value,null);assert.equal(result.fields.reference.value,null);assert.equal(f.invoices().length,0);
 }
});

test('Q8 actual Sites PDFs with punctuated or multiline heading lists remain unregistered',async t=>{
 for(const item of ambiguousHeaderCases){
  const f=await fixture(t),doc=f.add(item.text);await f.processing.processDocuments(f.owner);
  const job=f.sql.prepare('SELECT state,extraction FROM document_jobs WHERE document_id=?').get(doc.id),result=JSON.parse(job.extraction);
  assert.equal(result.method,'pdf');assert.equal(job.state,'needs_review',item.name);assert.equal(result.fields.invoice_number.value,null,item.name);assert.equal(result.fields.reference.value,null,item.name);assert.equal(f.invoices().length,0,item.name);
 }
});

test('Q8 actual Sites PDF cannot auto-register contradictory VAT using the percentage as its amount',async t=>{
 const f=await fixture(t),doc=f.add(percentVat);await f.processing.processDocuments(f.owner);
 const job=f.sql.prepare('SELECT state,extraction FROM document_jobs WHERE document_id=?').get(doc.id),result=JSON.parse(job.extraction);
 assert.equal(result.method,'pdf');assert.equal(job.state,'needs_review');assert.equal(result.fields.vat_cents.value,null);assert.equal(f.invoices().length,0);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);
});

test('Q8 actual Sites PDF pipeline keeps a missing invoice number out of automatic registration',async t=>{
 const f=await fixture(t),doc=f.add(adjacentOcr);await f.processing.processDocuments(f.owner);
 const job=f.sql.prepare('SELECT state,extraction FROM document_jobs WHERE document_id=?').get(doc.id),extraction=JSON.parse(job.extraction);
 assert.equal(f.pdfCalls,1);assert.equal(extraction.method,'pdf');assert.equal(extraction.fields.invoice_number.value,null);
 assert.equal(job.state,'needs_review');assert.equal(f.invoices().length,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);
});

test('Q8 actual Sites PDF pipeline still requires an explicitly verified counterparty',async t=>{
 const f=await fixture(t,{trusted:false}),doc=f.add(hyphenDates);await f.processing.processDocuments(f.owner);
 const job=f.sql.prepare('SELECT state,extraction FROM document_jobs WHERE document_id=?').get(doc.id);
 assert.equal(job.state,'needs_review');assert.equal(f.invoices().length,0);assert.ok(JSON.parse(job.extraction).issues.some(issue=>issue.includes('Motparten behöver verifieras')));
});

test('Q8 actual Sites PDF pipeline preserves credit and inconsistent VAT review requirements',async t=>{
 for(const text of [hyphenDates.replace('Faktura\n','Kreditfaktura\n').replace('3 750,00','-3 750,00'),hyphenDates.replace('Moms: 750,00','Moms: 700,00')]){
  const f=await fixture(t),doc=f.add(text);await f.processing.processDocuments(f.owner);
  assert.equal(f.invoices().length,0);assert.equal(f.sql.prepare('SELECT state FROM document_jobs WHERE document_id=?').get(doc.id).state,'needs_review');
 }
});
