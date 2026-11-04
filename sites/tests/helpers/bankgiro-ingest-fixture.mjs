import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {emptyState,applyCommand} from '../../lib/domain.ts';
import {syntheticBankRow} from './bank-api-fixture.mjs';
import {syntheticConnection,retainSyntheticConsent} from './bank-account-fixture.mjs';

export const account='SE4280000890119146168423';
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const url=path=>new URL(path,import.meta.url).href;
function compiled(path,imports){
 let code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 for(const [from,to] of Object.entries(imports))for(const quote of ['"',"\u0027"])code=code.replaceAll(quote+from+quote,JSON.stringify(to));
 return data(code);
}
export function reportBytes(payments=[{amount:'625.00',payer:'Synthetic customer AB',reference:'0599',id:'SYNTHETIC-CHILD-1'}],total='625.00'){
 const details=payments.map(row=>`<TxDtls><Refs><TxId>${row.id}</TxId></Refs><AmtDtls><TxAmt><Amt Ccy="SEK">${row.amount}</Amt></TxAmt></AmtDtls><RltdPties><Dbtr><Nm>${row.payer}</Nm></Dbtr></RltdPties><RmtInf><Strd><CdtrRefInf><Ref>${row.reference}</Ref></CdtrRefInf></Strd></RmtInf></TxDtls>`).join('');
 return new TextEncoder().encode(`<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02"><BkToCstmrDbtCdtNtfctn><GrpHdr><MsgId>SYNTHETIC-MESSAGE</MsgId></GrpHdr><Ntfctn><Id>SYNTHETIC-REPORT</Id><Acct><Id><IBAN>${account}</IBAN></Id></Acct><Ntry><Amt Ccy="SEK">${total}</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-26</Dt></BookgDt><AcctSvcrRef>SYNTHETIC-DEPOSIT</AcctSvcrRef><NtryDtls>${details}</NtryDtls></Ntry></Ntfctn></BkToCstmrDbtCdtNtfctn></Document>`);
}
export function seedState({parent=true,invoice=true}={}){
 let state=emptyState();
 if(invoice)state=applyCommand(state,{type:'invoice.save',invoice:{direction:'receivable',party:'Synthetic customer AB',number:'0599',ocr:'',total:62500,issued:'2026-10-01',due:'2026-10-30',reviewed:true}}).state;
 if(parent)state=applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({account,date:'2026-10-26',amount:62500,bankReference:'SYNTHETIC-DEPOSIT',party:'',payerReference:'',description:'Bankgiro inbetalning',kind:'batch'})]}).state;
 return state;
}
export async function ingestFixture(t,options={}){
 assert.ok(existsSync(new URL('../../lib/bankgiro-ingest-service.ts',import.meta.url)),'Sites report ingestion needs a retained-original sink');
 const sql=new DatabaseSync(':memory:');
 for(const file of readdirSync(new URL('../../drizzle/',import.meta.url)).filter(file=>/^\d{4}.*\.sql$/.test(file)).sort())sql.exec(readFileSync(new URL('../../drizzle/'+file,import.meta.url),'utf8'));
 const key='__bankgiro_ingest_'+crypto.randomUUID().replaceAll('-',''),owner='synthetic-owner';
 const f={sql,owner,user:{userId:owner,displayName:'Synthetic owner'},source:null,objects:new Map(),beforeBatch:null,afterBatch:null,onPut:null,onRead:null};
 globalThis[key]=f;t.after(()=>{sql.close();delete globalThis[key];});
 f.database={prepare(query){return{query,args:[],bind(...args){this.args=args;return this;},async first(){return sql.prepare(query).get(...this.args)||null;},async all(){return{results:sql.prepare(query).all(...this.args)};},async run(){return this.execute();},execute(){return{success:true,meta:{changes:Number(sql.prepare(query).run(...this.args).changes)}};}};},async batch(statements){
  if(f.beforeBatch)await f.beforeBatch(statements);
  sql.exec('BEGIN');let results;try{results=statements.map(statement=>statement.execute());sql.exec('COMMIT');}catch(error){sql.exec('ROLLBACK');throw error;}
  if(f.afterBatch)await f.afterBatch(statements);return results;
 }};
 f.bucket={async put(id,bytes){f.objects.set(id,Uint8Array.from(new Uint8Array(bytes)));if(f.onPut)await f.onPut(id);},async get(id){if(f.onRead)await f.onRead(id);const bytes=f.objects.get(id);return bytes?{size:bytes.length,body:bytes,arrayBuffer:async()=>Uint8Array.from(bytes).buffer}:null;},async delete(id){f.objects.delete(id);}};
 f.env={DB:f.database,BUCKET:f.bucket};
 retainSyntheticConsent(sql,syntheticConnection(owner,account));
 sql.prepare('INSERT INTO workspaces(owner,revision,payload,updated_at) VALUES(?,?,?,?)').run(owner,1,JSON.stringify(options.state||seedState(options)),'2026-10-26');
 const ref=`globalThis[${JSON.stringify(key)}]`,domain=url('../../lib/domain.ts'),engine=url('../../lib/reconciliation-engine.js');
 const server=compiled('../../lib/server.ts',{'./company-storage.js':new URL('../../lib/company-storage.js',import.meta.url).href,'cloudflare:workers':data(`export const env=${ref}.env;`),'@/app/chatgpt-auth':data(`export async function getChatGPTUser(){return ${ref}.user;}`),'./domain':domain});
 const store=data(`const f=${ref};export async function connection(owner){return f.sql.prepare('SELECT * FROM bank_connections WHERE owner=?').get(owner)||null;}export async function application(owner){return {owner,generation:'synthetic-generation'};}export async function accounts(connection){return JSON.parse(connection.encrypted_accounts);}`);
 const transactions=compiled('../../lib/banking/transactions.ts',{'../domain':domain,'../payment-references.js':url('../../lib/payment-references.js'),'../payer-evidence.js':url('../../lib/payer-evidence.js')});
 const bankgiro=compiled('../../lib/bankgiro-service.ts',{'./server':server,'./domain':domain,'./bankgiro-parser.js':url('../../lib/bankgiro-parser.js'),'./banking/store':store,'./banking/transactions':transactions});
 const reconciliation=compiled('../../lib/reconciliation.ts',{'./domain':domain,'./reconciliation-engine.js':engine});
 const evidence=compiled('../../lib/reconciliation-evidence.ts',{'./server':server,'./domain':domain,'./reconciliation':reconciliation,'./reconciliation-engine.js':engine,'./bankgiro-service':bankgiro});
 const service=compiled('../../lib/bankgiro-ingest-service.ts',{'cloudflare:workers':data(`export const env=${ref}.env;`),'./server':server,'./domain':domain,'./bankgiro-service':bankgiro,'./bankgiro-parser.js':url('../../lib/bankgiro-parser.js'),'./reconciliation-evidence':evidence,'./bankgiro-ingest.js':url('../../lib/bankgiro-ingest.js'),'./bankgiro-ingest-store.js':url('../../lib/bankgiro-ingest-store.js'),'./bankgiro-source.js':url('../../lib/bankgiro-source.js'),'./bankgiro-source-registry.js':data(`export async function resolveBankgiroSource(){const f=${ref},source=f.source;if(!source||source.mode!=='production'||source.registration)return source;const registration={id:source.id,owner:f.owner,companyId:'synthetic-company',bankgiro:'0599',scopeId:f.authorization.scopeId,generation:f.authorization.generation,profileId:'synthetic-profile',configurationRevision:1,enabled:true};return {...source,configurationValid:true,registration,intervalMinutes:0,async authorize(input){return {...await source.authorize(input),companyId:registration.companyId,bankgiro:registration.bankgiro,profileId:registration.profileId,origin:'provider_authorization',capabilities:['bankgiro_reports:read'],checkedAt:new Date().toISOString()};}};}`)});
 f.moduleUrls={server,service,store,bankgiro,evidence,reconciliation};f.service=await import(service);f.sink=f.service.createSitesBankgiroSink();
 // Queue leases and the real sink must use the same company-aware D1 surface.
 // Keep f.database as the raw SQLite adapter for inspection/fault injection.
 const scopedDatabase=f.scopedDatabase=(await import(server)).db();
 f.makeLease=(principal=owner)=>{
  const token=crypto.randomUUID(),until=Date.now()+300000;
  sql.prepare('INSERT OR REPLACE INTO bankgiro_ingest_leases(owner,token,expires_at) VALUES(?,?,?)').run(principal,token,until);
  const fence=()=>scopedDatabase.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM bankgiro_ingest_leases WHERE owner=? AND token=? AND expires_at>unixepoch('subsec')*1000) THEN 1 ELSE json('expired lease') END").bind(principal,token);
  return{owner:principal,token,until,fence,async assert(){const row=sql.prepare('SELECT token,expires_at FROM bankgiro_ingest_leases WHERE owner=?').get(principal);if(row?.token!==token||row.expires_at<=Date.now())throw Object.assign(Error('Lease lost'),{code:'LEASE_LOST'});},async write(statements){return(await scopedDatabase.batch([fence(),...statements,fence()])).slice(1,-1);}};
 };
 f.lease=f.makeLease();
 f.authorization={status:'VERIFIED',owner,sourceId:'synthetic-source',scopeId:'synthetic-contract',generation:'generation-1',validUntil:'2099-01-01T00:00:00Z',evidenceId:'synthetic-transport-proof'};
 f.prepare=async(bytes=reportBytes(),extra={})=>{
  const report={reportId:extra.reportId||crypto.randomUUID(),filename:extra.filename||'Synthetic.xml',sha256:hash(bytes)},lease=extra.lease||f.lease;
  const retained=await f.sink.retain({owner,report,bytes,sha256:report.sha256,lease});
  const job={id:crypto.randomUUID(),owner,sourceId:'synthetic-source',scopeId:'synthetic-contract',reportId:report.reportId,sha256:report.sha256,filename:report.filename,documentId:retained.documentId,status:'PENDING',attempts:1,authorizationGeneration:'generation-1'};
  sql.prepare('INSERT OR IGNORE INTO bankgiro_ingest_sources(owner,source_id,scope_id,authorization_generation,authorization_status,updated_at) VALUES(?,?,?,?,?,?)').run(owner,job.sourceId,job.scopeId,job.authorizationGeneration,'VERIFIED',Date.now());
  sql.prepare('INSERT INTO bankgiro_ingest_jobs(id,owner,source_id,scope_id,report_id,sha256,filename,authorization_generation,document_id,status,attempts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(job.id,owner,job.sourceId,job.scopeId,job.reportId,job.sha256,job.filename,job.authorizationGeneration,job.documentId,'PENDING',1,Date.now(),Date.now());
  return{owner,job,documentId:retained.documentId,authorization:{...f.authorization},lease};
 };
 f.read=(principal=owner)=>{const row=sql.prepare('SELECT revision,payload FROM workspaces WHERE owner=?').get(principal);return row?{revision:row.revision,state:JSON.parse(row.payload)}:{revision:0,state:emptyState()};};
 f.write=state=>sql.prepare('UPDATE workspaces SET payload=?,revision=revision+1 WHERE owner=?').run(JSON.stringify(state),owner);
 f.audits=()=>sql.prepare('SELECT * FROM audit_events WHERE owner=?').all(owner);
 f.loadRoutes=async()=>{
  assert.ok(existsSync(new URL('../../app/api/bankgiro/source/status/route.ts',import.meta.url)),'source status needs its authenticated API');
  assert.ok(existsSync(new URL('../../app/api/bankgiro/source/run/route.ts',import.meta.url)),'source run needs its authenticated API');
  const imports={'@/lib/server':server,'@/lib/bankgiro-ingest-service':service};
  f.statusRoute=await import(compiled('../../app/api/bankgiro/source/status/route.ts',imports));
  f.runRoute=await import(compiled('../../app/api/bankgiro/source/run/route.ts',imports));
 };
 return f;
}
