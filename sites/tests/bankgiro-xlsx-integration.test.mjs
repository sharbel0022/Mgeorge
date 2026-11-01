import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {emptyState,applyCommand,economicTransactions,balance} from '../lib/domain.ts';
import {makeBankgiroXLSX,syntheticPayment} from './helpers/bankgiro-xlsx-fixture.mjs';
import {syntheticBankRow} from './helpers/bank-api-fixture.mjs';

const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const url=path=>new URL(path,import.meta.url).href;
function compiled(path,imports={}){
 imports={...Object.fromEntries(['document-triage','economy-summary'].map(name=>['./'+name+'.js',url('../lib/'+name+'.js')])),...imports};
 let code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 for(const [from,to] of Object.entries(imports))for(const quote of ['"',"'"])code=code.replaceAll(quote+from+quote,JSON.stringify(to));
 return data(code);
}
const domain=url('../lib/domain.ts'),parser=url('../lib/bankgiro-parser.js');
const auth=data('export async function getChatGPTUser(){return globalThis.xlsxIntegrationFixture.user;}');
const envModule=data('export const env=new Proxy({}, {get:(_,key)=>globalThis.xlsxIntegrationFixture.env[key]});');
const server=compiled('../lib/server.ts',{'cloudflare:workers':envModule,'@/app/chatgpt-auth':auth,'./domain':domain});
const service=compiled('../lib/bankgiro-service.ts',{'./server':server,'./bankgiro-parser.js':parser,'./domain':domain,'./banking/store':data('export async function connection(){return null;} export async function accounts(){return [];}'),'./banking/transactions':data('export function stableAccountKey(){return null;}')});
const reconciliation=compiled('../lib/reconciliation.ts',{'./domain':domain,'./reconciliation-engine.js':url('../lib/reconciliation-engine.js')});
const evidence=compiled('../lib/reconciliation-evidence.ts',{'./server':server,'./domain':domain,'./reconciliation':reconciliation,'./reconciliation-engine.js':url('../lib/reconciliation-engine.js')});
const preview=await import(compiled('../app/api/bankgiro/preview/route.ts',{'@/lib/server':server,'@/lib/bankgiro-service':service}));
const state=await import(compiled('../app/api/state/route.ts',{'@/lib/server':server,'@/lib/domain':domain,'@/lib/bankgiro-service':service,'@/lib/reconciliation-evidence':evidence,'@/lib/customer-messages':data('export async function reconcileAndPrepare(){}'),'@/lib/bankgiro-invoice-search':data('export async function searchBankgiroInvoice(){globalThis.xlsxIntegrationFixture.searches++;}') }));
const files=await import(compiled('../app/api/files/route.ts',{'cloudflare:workers':envModule,'@/lib/server':server,'@/lib/domain':domain}));
const sha256=bytes=>createHash('sha256').update(new Uint8Array(bytes)).digest('hex');

function fixture(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 sqlite.exec('CREATE TABLE workspaces(owner TEXT PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT);CREATE TABLE documents(id TEXT PRIMARY KEY,owner TEXT,filename TEXT,mime TEXT,size INTEGER,sha256 TEXT,created_at TEXT);CREATE TABLE audit_events(id TEXT,owner TEXT,revision INTEGER,action TEXT,detail TEXT,created_at TEXT);');
 const objects=new Map(),DB={prepare(sql){return {bind(...args){return {async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return {meta:{changes:sqlite.prepare(sql).run(...args).changes}};}};}};},async batch(statements){sqlite.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 const BUCKET={async put(key,bytes){objects.set(key,bytes);},async get(key){const bytes=objects.get(key);return bytes?{size:bytes.byteLength,body:bytes,arrayBuffer:async()=>bytes}:null;},async delete(key){objects.delete(key);}};
 let seed=applyCommand(emptyState(),{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({account:'synthetic-account',date:'2026-10-20',amount:syntheticPayment.amount,kind:'batch',description:'Bankgiro inbetalning',bankReference:'SYNTHETIC-AIS-ENTRY',party:'',payerReference:''})]}).state;
 seed=applyCommand(seed,{type:'invoice.save',invoice:{direction:'receivable',party:'En annan testkund AB',number:syntheticPayment.reference,ocr:'',total:syntheticPayment.amount,issued:'2026-10-01',due:'2026-10-31',reviewed:true}}).state;
 sqlite.prepare('INSERT INTO workspaces VALUES(?,?,?,?)').run('owner',1,JSON.stringify(seed),'2026-10-20');
 const f={user:{userId:'owner',displayName:'Synthetic user'},env:{DB,BUCKET},sqlite,objects,seed,searches:0};globalThis.xlsxIntegrationFixture=f;return f;
}
function uploadReq(bytes=makeBankgiroXLSX(),name='synthetic.xlsx'){
 const form=new FormData();form.set('file',new File([bytes],name));
 return new Request('https://mg.test/api/bankgiro/preview',{method:'POST',headers:{origin:'https://mg.test'},body:form});
}
function saveReq(command,revision=1,requestId=crypto.randomUUID()){
 return new Request('https://mg.test/api/state',{method:'POST',headers:{origin:'https://mg.test','Content-Type':'application/json'},body:JSON.stringify({revision,requestId,command})});
}
const stored=f=>JSON.parse(f.sqlite.prepare('SELECT payload FROM workspaces WHERE owner=?').get('owner').payload);
const revision=f=>f.sqlite.prepare('SELECT revision FROM workspaces WHERE owner=?').get('owner').revision;
const audits=f=>f.sqlite.prepare('SELECT COUNT(*) n FROM audit_events').get().n;
async function upload(bytes=makeBankgiroXLSX(),name='synthetic.xlsx'){
 const response=await files.POST(uploadReq(bytes,name)),result=await response.json();assert.equal(response.status,200,result.error);return result;
}
async function confirm(documentId,revision=1,extra={}){
 const response=await state.POST(saveReq({type:'bankgiro.import',documentId,...extra},revision)),result=await response.json();assert.equal(response.status,200,result.error);return result;
}

test('XLSX preview identifies payer/reference without any document, workspace or R2 writes',async t=>{
 const f=fixture(t),bytes=makeBankgiroXLSX(),response=await preview.POST(uploadReq(bytes)),result=await response.json();
 assert.equal(response.status,200,result.error);assert.equal(result.rows.length,1);assert.equal(result.rows[0].party,syntheticPayment.party);assert.equal(result.rows[0].payerReference,syntheticPayment.reference);assert.equal(result.preview.review,1);assert.equal(result.preview.linked,0);assert.equal(result.hash,sha256(bytes));
 assert.equal(f.objects.size,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM documents').get().n,0);assert.equal(audits(f),0);assert.equal(revision(f),1);assert.deepEqual(stored(f),f.seed);
});

test('XLSX original is retained and downloaded byte-for-byte with SHA-256 and correct MIME',async t=>{
 const f=fixture(t),bytes=makeBankgiroXLSX(),saved=await upload(bytes),doc=f.sqlite.prepare('SELECT * FROM documents WHERE id=?').get(saved.id);
 assert.equal(saved.sha256,sha256(bytes));assert.equal(doc.sha256,saved.sha256);assert.equal(doc.size,bytes.byteLength);assert.equal(doc.owner,'owner');assert.equal(doc.mime,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
 const response=await files.GET(new Request('https://mg.test/api/files?id='+saved.id));assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);assert.equal(f.objects.size,1);assert.equal(revision(f),1);
 const again=await upload(bytes,'renamed.xlsx');assert.equal(again.id,saved.id);assert.equal(again.duplicate,true);assert.equal(f.objects.size,1);
});

test('XLSX confirmation reparses original, preserves cell provenance and never trusts client financial fields',async t=>{
 const f=fixture(t),bytes=makeBankgiroXLSX(),saved=await upload(bytes),result=await confirm(saved.id,1,{hash:'forged',name:'forged.csv',rows:[{amount:1,date:'2020-01-01',party:'Forged',payerReference:'9999',account:'synthetic-account',bankReference:'SYNTHETIC-AIS-ENTRY',verified:true}],trustedBankImport:true,trustedBankFileImport:true});
 const imported=result.state.transactions.find(row=>row.specification);
 assert.equal(imported.party,syntheticPayment.party);assert.equal(imported.payerReference,syntheticPayment.reference);assert.equal(imported.amount,syntheticPayment.amount);assert.equal(imported.date,'2026-10-20');assert.equal(imported.verified,false);assert.equal(imported.specificationStatus,'review');
 assert.equal(imported.bankFileProof.documentId,saved.id);assert.equal(imported.bankFileProof.sha256,sha256(bytes));assert.equal(imported.reportEvidence.reportId,'41');assert.equal(imported.reportEvidence.paymentCount,'1');assert.equal(imported.reportEvidence.totalCents,String(syntheticPayment.amount));const cells=JSON.parse(imported.reportEvidence.sourceCells);assert.equal(cells.reference.address,'C19');assert.equal(cells.amount.address,'E19');
 assert.equal(imported.referenceEvidence.selected.kind,'structured');assert.equal(imported.referenceEvidence.candidates.some(candidate=>candidate.kind==='ocr'),false);assert.equal(result.state.imports.at(-1).name,'synthetic.xlsx');assert.equal(audits(f),1);assert.equal(f.searches,0);
 assert.deepEqual(result.state.transactions[0],f.seed.transactions[0]);assert.deepEqual(result.state.allocations,[]);assert.equal(balance(result.state,result.state.invoices[0]),syntheticPayment.amount);assert.equal(economicTransactions(result.state).reduce((sum,row)=>sum+row.amount,0),syntheticPayment.amount);
});

test('XLSX report without stable receiving account/entry identity cannot link by same date and amount',async t=>{
 const f=fixture(t),saved=await upload(),result=await confirm(saved.id,1,{targetId:f.seed.transactions[0].id});
 assert.equal(result.state.transactions.filter(row=>row.specification).every(row=>row.specificationStatus==='review'&&!row.parentId&&!row.verified),true);assert.deepEqual(result.state.allocations,[]);assert.deepEqual(result.state.transactions[0],f.seed.transactions[0]);assert.equal(balance(result.state,result.state.invoices[0]),syntheticPayment.amount);
});

test('XLSX recipient mismatch stays non-economic and does not modify AIS or invoice balances',async t=>{
 const f=fixture(t),saved=await upload(makeBankgiroXLSX({recipientBankgiro:'2222-3333'})),result=await confirm(saved.id,1,{targetId:f.seed.transactions[0].id}),row=result.state.transactions.find(row=>row.specification);
 assert.equal(row.recipientBankgiro,'2222-3333');assert.equal(row.specificationStatus,'review');assert.equal(row.verified,false);assert.equal(row.parentId,'');assert.deepEqual(result.state.allocations,[]);assert.deepEqual(result.state.transactions[0],f.seed.transactions[0]);assert.equal(economicTransactions(result.state).length,1);
});

test('XLSX repeated confirmation and overlapping report never create additional economic money',async t=>{
 const f=fixture(t),first=await upload(),a=await confirm(first.id),b=await confirm(first.id,2);
 assert.equal(a.state.transactions.length,b.state.transactions.length);assert.equal(a.state.imports.length,b.state.imports.length,'same SHA replay must not create another import record');assert.deepEqual(b.state.allocations,[]);
 const next=await upload(makeBankgiroXLSX({sequence:'42'}),'second-report.xlsx'),c=await confirm(next.id,3);
 assert.equal(economicTransactions(c.state).length,1);assert.equal(economicTransactions(c.state).reduce((sum,row)=>sum+row.amount,0),syntheticPayment.amount);assert.deepEqual(c.state.transactions[0],f.seed.transactions[0]);assert.equal(balance(c.state,c.state.invoices[0]),syntheticPayment.amount);assert.deepEqual(c.state.allocations,[]);
});

test('XLSX equal payment observations for different recipients retain both originals for review',async t=>{
 const f=fixture(t),first=await upload(),a=await confirm(first.id),second=await upload(makeBankgiroXLSX({recipientBankgiro:'2222-3333',sequence:'42'}),'other-recipient.xlsx'),b=await confirm(second.id,2),rows=b.state.transactions.filter(row=>row.specification);
 assert.equal(a.state.transactions.filter(row=>row.specification).length,1);assert.equal(rows.length,2,'recipient identity must not be lost in deduplication');assert.deepEqual(new Set(rows.map(row=>row.recipientBankgiro)),new Set(['1234-5678','2222-3333']));assert.deepEqual(new Set(rows.map(row=>row.bankFileProof.documentId)),new Set([first.id,second.id]));
 assert.equal(rows.every(row=>row.specificationStatus==='review'&&!row.verified),true);assert.equal(economicTransactions(b.state).length,1);assert.deepEqual(b.state.allocations,[]);assert.deepEqual(b.state.transactions[0],f.seed.transactions[0]);
});

test('XLSX auth and Origin guards reject preview/upload/confirmation before writes',async t=>{
 const f=fixture(t);f.user=null;
 for(const operation of [()=>preview.POST(uploadReq()),()=>files.POST(uploadReq()),()=>state.POST(saveReq({type:'bankgiro.import'}))])assert.equal((await operation()).status,401);
 f.user={userId:'owner'};
 for(const operation of [preview.POST,files.POST]){const request=uploadReq();request.headers.set('origin','https://attacker.test');assert.equal((await operation(request)).status,403);}
 const request=saveReq({type:'bankgiro.import'});request.headers.delete('origin');assert.equal((await state.POST(request)).status,403);
 assert.equal(f.objects.size,0);assert.equal(revision(f),1);assert.equal(audits(f),0);
});

test('XLSX retained originals cannot be downloaded or imported by another owner',async t=>{
 const f=fixture(t),saved=await upload();f.user={userId:'other'};
 assert.equal((await files.GET(new Request('https://mg.test/api/files?id='+saved.id))).status,404);assert.equal((await state.POST(saveReq({type:'bankgiro.import',documentId:saved.id},0))).status,400);assert.equal(revision(f),1);assert.equal(audits(f),0);assert.deepEqual(stored(f),f.seed);
});

test('XLSX tampered retained bytes fail checksum without changing finances or audit',async t=>{
 const f=fixture(t),saved=await upload(),key='owner/'+saved.id,bytes=new Uint8Array(f.objects.get(key)).slice();bytes[bytes.length-1]^=1;f.objects.set(key,bytes.buffer);
 const response=await state.POST(saveReq({type:'bankgiro.import',documentId:saved.id}));assert.equal(response.status,400);assert.match((await response.json()).error,/kontrollsumma/i);assert.deepEqual(stored(f),f.seed);assert.equal(revision(f),1);assert.equal(audits(f),0);
});

test('XLSX cancellation after preview or original upload creates no financial records',async t=>{
 const f=fixture(t);assert.equal((await preview.POST(uploadReq())).status,200);assert.deepEqual(stored(f),f.seed);assert.equal(f.objects.size,0);
 await upload();assert.equal(f.objects.size,1);assert.deepEqual(stored(f),f.seed);assert.equal(revision(f),1);assert.equal(audits(f),0);
});

test('XLSX concurrent confirmations atomically commit exactly one import and audit',async t=>{
 const f=fixture(t),saved=await upload(),command={type:'bankgiro.import',documentId:saved.id},responses=await Promise.all([state.POST(saveReq(command)),state.POST(saveReq(command))]);
 assert.deepEqual(responses.map(response=>response.status).sort(),[200,409]);assert.equal(stored(f).transactions.filter(row=>row.specification).length,1);assert.equal(revision(f),2);assert.equal(audits(f),1);assert.deepEqual(stored(f).allocations,[]);
});

test('XLSX stale preview revision cannot overwrite an intervening workspace change',async t=>{
 const f=fixture(t),saved=await upload();f.sqlite.prepare('UPDATE workspaces SET revision=2').run();
 assert.equal((await state.POST(saveReq({type:'bankgiro.import',documentId:saved.id}))).status,409);assert.deepEqual(stored(f),f.seed);assert.equal(audits(f),0);
});

test('XLSX invalid totals and corrupt data are rejected in preview with no writes',async t=>{
 const f=fixture(t);
 for(const bytes of [makeBankgiroXLSX({totalAmount:999}),new TextEncoder().encode('not a spreadsheet')]){
  const response=await preview.POST(uploadReq(bytes));assert.equal(response.status,400);
 }
 assert.deepEqual(stored(f),f.seed);assert.equal(f.objects.size,0);assert.equal(audits(f),0);assert.equal(revision(f),1);
});

test('XLSX invalid saved original cannot create any partial import or economic post',async t=>{
 const f=fixture(t),saved=await upload(makeBankgiroXLSX({declaredCount:2})),response=await state.POST(saveReq({type:'bankgiro.import',documentId:saved.id}));
 assert.equal(response.status,400);assert.deepEqual(stored(f),f.seed);assert.equal(audits(f),0);assert.equal(revision(f),1);assert.equal(f.objects.size,1);
});

test('XLSX identical request receipt prevents a second import despite stale revision',async t=>{
 const f=fixture(t),saved=await upload(),command={type:'bankgiro.import',documentId:saved.id},requestId=crypto.randomUUID(),first=await state.POST(saveReq(command,1,requestId));assert.equal(first.status,200);
 const original=stored(f),again=await state.POST(saveReq(command,1,requestId));assert.equal(again.status,200);assert.deepEqual(stored(f),original);assert.equal(audits(f),1);assert.equal(revision(f),2);
});

test('XLSX cannot bypass report review using the generic bank-file import command',async t=>{
 const f=fixture(t),saved=await upload(),response=await state.POST(saveReq({type:'transactions.import',documentId:saved.id,rows:[{account:'synthetic-account',date:'2026-10-20',amount:syntheticPayment.amount,party:syntheticPayment.party,payerReference:syntheticPayment.reference,verified:true}]}));
 assert.equal(response.status,400);assert.match((await response.json()).error,/Bankgirofil|Excelrapport/i);assert.deepEqual(stored(f),f.seed);assert.equal(audits(f),0);assert.equal(revision(f),1);
});

test('XLSX overlapping names and references with distinct sender Bankgiro retain both bank observations',async t=>{
 const f=fixture(t),first=await upload(),a=await confirm(first.id),second=await upload(makeBankgiroXLSX({sequence:'42',payments:[{...syntheticPayment,payerBankgiro:'111-2222'}]}),'other-sender.xlsx'),b=await confirm(second.id,2),rows=b.state.transactions.filter(row=>row.specification);
 assert.equal(a.state.transactions.filter(row=>row.specification).length,1);assert.equal(rows.length,2,'without individual bank IDs a changed sender Bankgiro must not disappear in deduplication');
 assert.deepEqual(new Set(rows.map(row=>row.payerBankgiro)),new Set([syntheticPayment.payerBankgiro,'111-2222']));assert.deepEqual(new Set(rows.map(row=>row.bankFileProof.documentId)),new Set([first.id,second.id]));assert.deepEqual(new Set(rows.map(row=>row.reportEvidence.reportId)),new Set(['41','42']));
 assert.equal(rows.every(row=>row.specificationStatus==='review'&&!row.verified),true);assert.equal(economicTransactions(b.state).length,1);assert.equal(economicTransactions(b.state).reduce((sum,row)=>sum+row.amount,0),syntheticPayment.amount);assert.deepEqual(b.state.allocations,[]);assert.deepEqual(b.state.transactions[0],f.seed.transactions[0]);assert.equal(balance(b.state,b.state.invoices[0]),syntheticPayment.amount);
});
