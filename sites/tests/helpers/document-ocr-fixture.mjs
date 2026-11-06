import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {dataModule,invoiceParserUrl,libUrl} from './invoice-module-loader.mjs';
import {layoutContext} from '../../../test/helpers/pdf-layout-ocr.mjs';
import {createCompanyDatabase} from '../../lib/company-storage.js';

class D1{
  constructor(sql){this.sql=sql;}
  prepare(query){const db=this.sql;return {args:[],bind(...args){this.args=args;return this;},async first(){return db.prepare(query).get(...this.args)||null;},async all(){return {results:db.prepare(query).all(...this.args)};},async run(){return this.execute();},execute(){return {meta:{changes:Number(db.prepare(query).run(...this.args).changes)}};}};}
  async batch(rows){this.sql.exec('BEGIN');try{const result=rows.map(row=>row.execute());this.sql.exec('COMMIT');return result;}catch(error){this.sql.exec('ROLLBACK');throw error;}}
}
export async function documentOcrFixture(t,bytes,metadata={}){
  const sql=new DatabaseSync(':memory:');
  for(const name of readdirSync(new URL('../../drizzle',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../../drizzle/'+name,import.meta.url),'utf8'));
  const owner='synthetic-layout-owner',id=crypto.randomUUID(),key='__layout_'+id.replaceAll('-',''),sha=createHash('sha256').update(bytes).digest('hex');
  const f={sql,db:new D1(sql),owner,id,sha,bytes:Buffer.from(bytes),env:{DOCUMENT_AUTOMATION_ENABLED:'true',DOCUMENT_OWNER_EMAIL:'owner@example.test'}};
  const recoveryDb=createCompanyDatabase(f.db,()=>({kind:'legacy',owner,actorId:owner,action:'read',context:null}));
  f.db.invoiceAiRecoveryStatus=()=>recoveryDb.invoiceAiRecoveryStatus();
  f.env.BUCKET={get:async path=>path===owner+'/'+id?{size:f.bytes.length,arrayBuffer:async()=>Uint8Array.from(f.bytes).buffer}:null};
  globalThis[key]=f;t.after(()=>{delete globalThis[key];sql.close();});
  const ref='globalThis['+JSON.stringify(key)+']',domain=libUrl('domain.ts');
  const server=dataModule(`import {emptyState} from ${JSON.stringify(domain)};const f=${ref};export async function companyWorkerIdentity(){return null;}export async function companyWorkerConfigured(){return null;}export const db=()=>f.db;export const identity=async()=>({userId:f.owner,email:'owner@example.test'});export const response=(body,status=200)=>Response.json(body,{status});export async function readWorkspace(owner){const row=f.sql.prepare('SELECT revision,payload FROM workspaces WHERE owner=?').get(owner);return row?{revision:row.revision,state:JSON.parse(row.payload)}:{revision:0,state:emptyState()};}`);
  const imports={'cloudflare:workers':dataModule(`export const env=${ref}.env;`),'./server':server,'./domain':domain,'./banking/security':libUrl('banking/security.ts'),'./invoice-fields.js':invoiceParserUrl(),'./server-pdf':libUrl('server-pdf.ts'),'./openai-invoices/sites.js':libUrl('openai-invoices/sites.js'),'./customer-messages':dataModule('export async function reconcileAndPrepare(){}')};
  let source=ts.transpileModule(readFileSync(new URL('../../lib/document-processing.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  for(const [name,url]of Object.entries(imports))for(const quote of ["'",'"'])source=source.replaceAll(quote+name+quote,JSON.stringify(url));
  f.api=await import(dataModule(source));
  const at=new Date().toISOString();
  sql.prepare('INSERT INTO document_automation(owner,email,enabled,auto_register,updated_at) VALUES(?,?,1,1,?)').run(owner,f.env.DOCUMENT_OWNER_EMAIL,at);
  sql.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run(id,owner,'syntetiskt-underlag.pdf','application/pdf',bytes.length,sha,at);
  sql.prepare('INSERT INTO gmail_sources(source_id,owner,document_id,metadata,status,extraction,created_at) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),owner,id,JSON.stringify({...layoutContext,...metadata}),'needs_review','{}',at);
  sql.prepare('INSERT INTO invoice_counterparties(owner,identity,email,bankgiro,evidence,verified_at) VALUES(?,?,?,?,?,?)').run(owner,f.api.counterpartyKey('supplier','Testbolaget AB','5560160680'),'supplier@example.test','123-4567','Explicitly reviewed synthetic original',at);
  f.invoices=()=>{const row=sql.prepare('SELECT payload FROM workspaces WHERE owner=?').get(owner);return row?JSON.parse(row.payload).invoices:[];};
  return f;
}
