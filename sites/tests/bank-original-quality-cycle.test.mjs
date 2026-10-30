import {syntheticBankRow} from './helpers/bank-api-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {emptyState,applyCommand,balance} from '../lib/domain.ts';
import {parseBankgiroXML} from '../lib/bankgiro-parser.js';
const url=path=>new URL(path,import.meta.url).href,data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
function compiled(path,imports){let code=stripTypeScriptTypes(readFileSync(new URL(path,import.meta.url),'utf8'),{mode:'transform'});for(const [name,value]of Object.entries(imports))for(const quote of ['"',"'"])code=code.replaceAll(quote+name+quote,JSON.stringify(value));return data(code);}
const domain=url('../lib/domain.ts'),reconciliation=compiled('../lib/reconciliation.ts',{'./domain':domain,'./reconciliation-engine.js':url('../lib/reconciliation-engine.js')});
const xml='<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02"><BkToCstmrDbtCdtNtfctn><Ntfctn><Acct><Id><IBAN>SE4280000890119146168423</IBAN></Id></Acct><Ntry><Amt Ccy="SEK">625.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-26</Dt></BookgDt><AcctSvcrRef>QUALITY-ORIGINAL-BATCH</AcctSvcrRef><NtryDtls><TxDtls><Refs><TxId>QUALITY-ORIGINAL-CHILD</TxId></Refs><RltdPties><Dbtr><Nm>Synthetic customer AB</Nm></Dbtr></RltdPties><RmtInf><Strd><CdtrRefInf><Ref>000018</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls></Ntry></Ntfctn></BkToCstmrDbtCdtNtfctn></Document>';
async function fixture(t,mode='valid'){
 const key='__quality_original_'+crypto.randomUUID().replaceAll('-',''),sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE workspaces(owner TEXT PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT);CREATE TABLE documents(id TEXT PRIMARY KEY,owner TEXT,filename TEXT,mime TEXT,size INTEGER,sha256 TEXT,created_at TEXT);CREATE TABLE audit_events(id TEXT,owner TEXT,revision INTEGER,action TEXT,detail TEXT,created_at TEXT);');
 t.after(()=>{sql.close();delete globalThis[key];});
 const DB={prepare(statement){return{bind(...args){return{async first(){return sql.prepare(statement).get(...args)||null;},async all(){return{results:sql.prepare(statement).all(...args)};},async run(){return{meta:{changes:sql.prepare(statement).run(...args).changes}};}};}};},async batch(statements){sql.exec('BEGIN');try{const rows=[];for(const statement of statements)rows.push(await statement.run());sql.exec('COMMIT');return rows;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 const bytes=new TextEncoder().encode(xml),hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),objects=new Map([['synthetic-owner/original',bytes]]),f={sql,objects,reads:0,env:{DB,BUCKET:{async get(id){f.reads++;const bytes=objects.get(id);return bytes?{size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}:null;}}}};
 globalThis[key]=f;
 if(mode==='missing')objects.clear();if(mode==='corrupt')objects.set('synthetic-owner/original',new TextEncoder().encode(xml.replace('000018','000026')));
 sql.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?)').run('original',mode==='foreign'?'another-owner':'synthetic-owner','Synthetic.xml','application/xml',bytes.length,hash,'2026-10-30');
 let state=applyCommand(emptyState(),{type:'invoice.save',invoice:{direction:'receivable',party:'Synthetic customer AB',number:'0599',ocr:'000018',total:62500,issued:'2026-10-01',due:'2026-10-30',reviewed:true}}).state;
 state=applyCommand(state,{type:'transactions.import',rows:[{date:'2026-10-26',amount:62500,account:'SE4280000890119146168423',kind:'batch',bankReference:'QUALITY-ORIGINAL-BATCH',description:'Bankgiro inbetalning'}]}).state;
 state=applyCommand(state,{type:'bankgiro.import',documentId:'original',hash,name:'Synthetic.xml',rows:parseBankgiroXML(xml)}).state;
 sql.prepare('INSERT INTO workspaces VALUES(?,?,?,?)').run('synthetic-owner',1,JSON.stringify(state),'2026-10-30');
 const server=compiled('../lib/server.ts',{'cloudflare:workers':data(`export const env=globalThis[${JSON.stringify(key)}].env;`),'@/app/chatgpt-auth':data('export async function getChatGPTUser(){return {userId:"synthetic-owner"};}'),'./domain':domain});
 const evidence=compiled('../lib/reconciliation-evidence.ts',{'./server':server,'./domain':domain,'./reconciliation':reconciliation,'./reconciliation-engine.js':url('../lib/reconciliation-engine.js')});
 const route=await import(compiled('../app/api/state/route.ts',{'@/lib/server':server,'@/lib/domain':domain,'@/lib/reconciliation-evidence':evidence,'@/lib/bankgiro-service':data('export async function readBankgiroOriginal(){throw Error("Unused");}'),'@/lib/customer-messages':data('export async function reconcileAndPrepare(){}'),'@/lib/bankgiro-invoice-search':data('export async function searchBankgiroInvoice(){}')}));
 return {...f,state,evidence:await import(evidence),bytes,async post(command={type:'settings.save',name:'Synthetic company',email:'synthetic@example.test'},revision=1){const response=await route.POST(new Request('https://mg.test/api/state',{method:'POST',headers:{Origin:'https://mg.test','Content-Type':'application/json'},body:JSON.stringify({revision,requestId:crypto.randomUUID(),command})}));return {response,body:await response.json()};},readCount:()=>f.reads};
}
for(const mode of ['missing','corrupt','foreign'])test(`quality cycle: ${mode} retained Bankgiro original prevents an automatic allocation at the real state route`,async t=>{
 const f=await fixture(t,mode),{response,body}=await f.post();assert.equal(response.status,200);assert.equal(body.state.allocations.length,0);assert.equal(balance(body.state,body.state.invoices[0]),62500);
 assert.ok(body.state.transactions.some(row=>/original/i.test(row.bankOriginalIssue||'')));assert.deepEqual(body.state.transactions[1].original,f.state.transactions[1].original);
});
test('quality cycle: a valid owned original permits the same automatic allocation',async t=>{
 const f=await fixture(t),{response,body}=await f.post();assert.equal(response.status,200);assert.equal(body.state.allocations.length,1);assert.equal(balance(body.state,body.state.invoices[0]),0);assert.equal(f.readCount(),1);
});
test('quality cycle: a missing original also prevents a new explicit manual allocation',async t=>{
 const f=await fixture(t,'missing'),{response}=await f.post({type:'match.create',invoiceId:f.state.invoices[0].id,transactionId:f.state.transactions[1].id,amount:62500,note:'Kontrollerat underlag'});
 assert.equal(response.status,400);assert.equal(JSON.parse(f.sql.prepare('SELECT payload FROM workspaces').get().payload).allocations.length,0);assert.equal(f.sql.prepare('SELECT revision FROM workspaces').get().revision,1);
});

test('quality cycle: restored original clears only its availability hold and allocates once',async t=>{
 const f=await fixture(t,'missing');const blocked=await f.post();assert.equal(blocked.body.state.allocations.length,0);
 f.objects.set('synthetic-owner/original',f.bytes);const restored=await f.post(undefined,2);assert.equal(restored.response.status,200);assert.equal(restored.body.state.allocations.length,1);assert.ok(restored.body.state.transactions.every(row=>!row.bankOriginalIssue));
 const again=await f.post(undefined,3);assert.equal(again.body.state.allocations.length,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n,3);
});

test('quality cycle: original-aware comparison stays read only and reports no safe candidate for a missing file',async t=>{
 const f=await fixture(t,'missing'),before=structuredClone(f.state);const preview=await f.evidence.reconciliationPreviewWithOriginals('synthetic-owner',f.state);
 assert.equal(preview.changed,false);assert.equal(preview.automatic_candidates,0);assert.ok(preview.findings.some(f=>f.kind==='bank_original_review'&&!f.safe));assert.deepEqual(f.state,before);assert.equal(f.sql.prepare('SELECT revision FROM workspaces').get().revision,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n,0);
});

test('quality cycle: one original shared by parent and child is read once during an allocation',async t=>{
 const f=await fixture(t);const state=structuredClone(f.state),parent=state.transactions[0],child=state.transactions[1],record=state.imports.find(r=>r.id===child.importId);
 parent.evidence='bank_file';parent.importId=child.importId;parent.bankFileProof={version:'bank-file-original-v1',documentId:'original',sha256:record.hash,reviewedAt:'2026-10-30'};
 const result=await f.evidence.reconcileWithOriginals('synthetic-owner',state);assert.equal(result.state.allocations.length,1);assert.equal(f.readCount(),1);
});

test('quality cycle: a child cannot allocate while its parent original is missing',async t=>{
 const f=await fixture(t);const state=structuredClone(f.state),parent=state.transactions[0];parent.evidence='bank_file';parent.bankFileProof={version:'bank-file-original-v1',documentId:'missing-parent-original',sha256:'a'.repeat(64),reviewedAt:'2026-10-30'};
 const before=structuredClone(state),result=await f.evidence.reconcileWithOriginals('synthetic-owner',state);assert.equal(result.state.allocations.length,0);assert.ok(result.state.transactions[0].bankOriginalIssue);assert.deepEqual(state,before);
});

test('quality cycle: removing an unavailable payer link cannot release another unchecked original',async t=>{
 const f=await fixture(t,'missing');let state=structuredClone(f.state);state.invoices[0].total=100000;
 state=applyCommand(state,{type:'invoice.save',invoice:{direction:'receivable',party:'Other synthetic company AB',number:'0600',ocr:'000026',total:125000,issued:'2026-10-01',due:'2026-10-30',reviewed:true}}).state;
 state=applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({date:'2026-10-25',amount:62500,party:'Synthetic customer AB',payerReference:'000026',bankReference:'LINK-SOURCE',externalId:'LINK-SOURCE',account:state.transactions[1].account,kind:'payment',verified:true})]}).state;
 const source=state.transactions.at(-1);state=applyCommand(state,{type:'match.create',invoiceId:state.invoices[1].id,transactionId:source.id,amount:62500,note:'Tidigare manuellt styrkt relation'}).state;
 const savedSource=state.transactions.find(row=>row.id===source.id);savedSource.evidence='bank_file';savedSource.bankFileProof={version:'bank-file-original-v1',documentId:'missing-link-original',sha256:'b'.repeat(64),reviewedAt:'2026-10-30'};savedSource.bankOriginalIssue='Bankoriginalet saknas';
 const result=await f.evidence.reconcileWithOriginals('synthetic-owner',state);assert.equal(result.state.allocations.length,1);assert.equal(balance(result.state,result.state.invoices[0]),100000);assert.ok(result.state.transactions[1].bankOriginalIssue);
});
