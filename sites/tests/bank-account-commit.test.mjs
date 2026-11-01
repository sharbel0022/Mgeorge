import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {emptyState,applyCommand,balance} from '../lib/domain.ts';
import {syntheticBankRow} from './helpers/bank-api-fixture.mjs';
import {parseBankgiroXML} from '../lib/bankgiro-parser.js';

const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const url=path=>new URL(path,import.meta.url).href;
function compiled(path,imports){let code=stripTypeScriptTypes(readFileSync(new URL(path,import.meta.url),'utf8'),{mode:'transform'});for(const [from,to] of Object.entries(imports))for(const quote of ['"',"'"])code=code.replaceAll(quote+from+quote,JSON.stringify(to));return data(code);}
const domain=url('../lib/domain.ts'),engine=url('../lib/reconciliation-engine.js'),iban='SE4280000890119146168423';
const reconciliation=compiled('../lib/reconciliation.ts',{'./domain':domain,'./reconciliation-engine.js':engine});
const accountResource=[{uid:'selected',currency:'SEK',account_id:{iban}}];
const activeConnection={id:'synthetic-connection',owner:'synthetic-owner',app_generation:'synthetic-generation',environment:'PRODUCTION',bank_name:'Synthetic bank',country:'SE',encrypted_session:'synthetic-retained-session',encrypted_accounts:JSON.stringify(accountResource),selected_accounts:'["selected"]',valid_until:'2099-01-01T00:00:00Z',date_from:'2026-10-01',status:'connected',created_at:'2026-10-01',updated_at:'2026-10-01'};
function seed(){let state=applyCommand(emptyState(),{type:'invoice.save',invoice:{direction:'receivable',party:'Synthetic customer AB',number:'0599',ocr:'000018',total:62500,issued:'2026-10-01',due:'2026-10-30',reviewed:true}}).state;return applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({account:'iban:'+iban,date:'2026-10-26',amount:62500,party:'Synthetic customer AB',payerReference:'000018',bankReference:'SYNTHETIC-COMMIT-ENTRY',kind:'payment',verified:true})]}).state;}
async function fixture(t,state=seed()){
 const sqlite=new DatabaseSync(':memory:');for(const file of readdirSync(new URL('../drizzle',import.meta.url)).filter(file=>file.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const key='__consent_commit_'+crypto.randomUUID().replaceAll('-',''),f={sqlite,state,accountCalls:0,beforeBatch:null,onAccounts:null};globalThis[key]=f;t.after(()=>{sqlite.close();delete globalThis[key];});
 const DB={prepare(query){return{query,args:[],bind(...args){this.args=args;return this;},async first(){return sqlite.prepare(query).get(...this.args)||null;},async all(){return{results:sqlite.prepare(query).all(...this.args)};},async run(){return this.execute();},execute(){return{meta:{changes:Number(sqlite.prepare(query).run(...this.args).changes)}};}};},async batch(statements){if(f.beforeBatch)await f.beforeBatch(statements);sqlite.exec('BEGIN');try{const results=statements.map(statement=>statement.execute());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 sqlite.prepare('INSERT INTO workspaces(owner,revision,payload,updated_at) VALUES(?,?,?,?)').run('synthetic-owner',1,JSON.stringify(state),'2026-10-26');
 const fields=Object.keys(activeConnection);sqlite.prepare('INSERT INTO bank_connections('+fields.join(',')+') VALUES('+fields.map(()=>'?').join(',')+')').run(...Object.values(activeConnection));
 f.env={DB};const ref=`globalThis[${JSON.stringify(key)}]`;
 const server=compiled('../lib/server.ts',{'cloudflare:workers':data(`export const env=${ref}.env;`),'@/app/chatgpt-auth':data('export async function getChatGPTUser(){return {userId:"synthetic-owner"};}'),'./domain':domain});
 const store=data(`const f=${ref};export async function connection(owner){return f.sqlite.prepare('SELECT * FROM bank_connections WHERE owner=?').get(owner)||null;}export async function application(owner){return {owner,generation:'synthetic-generation'};}export async function accounts(connection){f.accountCalls++;const result=JSON.parse(connection.encrypted_accounts);if(f.onAccounts)await f.onAccounts();return result;}export async function encrypt(){throw Error('Unused');}export async function decrypt(){throw Error('Unused');}`);
 const service=compiled('../lib/bankgiro-service.ts',{'./server':server,'./domain':domain,'./bankgiro-parser.js':url('../lib/bankgiro-parser.js'),'./banking/store':store,'./banking/transactions':data('export function stableAccountKey(account){return "iban:"+account.account_id.iban;}')});
 const evidence=compiled('../lib/reconciliation-evidence.ts',{'./server':server,'./domain':domain,'./reconciliation':reconciliation,'./reconciliation-engine.js':engine,'./bankgiro-service':service});
 const route=await import(compiled('../app/api/state/route.ts',{'@/lib/server':server,'@/lib/domain':domain,'@/lib/reconciliation-evidence':evidence,'@/lib/bankgiro-service':service,'@/lib/customer-messages':data('export async function reconcileAndPrepare(){}'),'@/lib/bankgiro-invoice-search':data('export async function searchBankgiroInvoice(){}')}));
 const messages=await import(compiled('../lib/customer-messages.ts',{'./server':server,'./domain':domain,'./reconciliation':reconciliation,'./reconciliation-evidence':evidence,'./customer-message-text.js':url('../lib/customer-message-text.js'),'./banking/security':url('../lib/banking/security.ts'),'./banking/store':store,'./gmail-adapter.js':data('export async function prepareGmailSend(){throw Error("Must not send");}export function gmailAccount(){return "synthetic@example.test";}export function hasGmailSendScope(){return false;}')}));
 f.post=async(command={type:'settings.save',name:'Synthetic company',email:'synthetic@example.test'})=>{const revision=f.read().revision;const response=await route.POST(new Request('https://mg.test/api/state',{method:'POST',headers:{Origin:'https://mg.test','Content-Type':'application/json'},body:JSON.stringify({revision,requestId:crypto.randomUUID(),command})}));return{status:response.status,body:await response.json()};};
 f.read=()=>{const row=sqlite.prepare('SELECT revision,payload FROM workspaces WHERE owner=?').get('synthetic-owner');return{revision:row.revision,state:JSON.parse(row.payload)};};f.restore=()=>{for(const [field,value] of Object.entries(activeConnection))sqlite.prepare('UPDATE bank_connections SET '+field+'=?').run(value);};f.reconcile=()=>messages.reconcileAndPrepare('synthetic-owner');return f;
}
const races=[
 ['disconnect',f=>f.sqlite.prepare("UPDATE bank_connections SET status='disconnected'").run()],
 ['deselect',f=>f.sqlite.prepare("UPDATE bank_connections SET selected_accounts='[]'").run()],
 ['new account resource',f=>f.sqlite.prepare("UPDATE bank_connections SET encrypted_accounts='[]'").run()],
 ['new application generation',f=>f.sqlite.prepare("UPDATE bank_connections SET app_generation='replaced'").run()],
 ['expired consent',f=>f.sqlite.prepare("UPDATE bank_connections SET valid_until='2000-01-01'").run()],
 ['new connection identity',f=>f.sqlite.prepare("UPDATE bank_connections SET id='replaced'").run()]
];
for(const action of ['state','manual','customer'])for(const [label,mutate] of races)test(action+': '+label+' between check and financial commit rolls back workspace and audit',async t=>{
 const f=await fixture(t),before=f.read();let fired=false;
 f.beforeBatch=statements=>{if(!fired&&statements.some(statement=>/UPDATE workspaces SET payload/.test(statement.query))){fired=true;mutate(f);}};
 if(action==='customer')await assert.rejects(f.reconcile(),/medgivande|kontoval|anslutning/i);
 else{const result=await f.post(action==='manual'?{type:'match.create',invoiceId:f.state.invoices[0].id,transactionId:f.state.transactions[0].id,amount:62500,note:'Synthetic original and customer separately checked.'}:undefined);assert.equal(result.status,409,JSON.stringify(result.body));assert.match(result.body.error,/medgivande|kontoval|anslutning/i);}
 assert.equal(fired,true);assert.deepEqual(f.read(),before);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM audit_events').get().n,0);
 f.beforeBatch=null;f.restore();if(action==='customer')await f.reconcile();else assert.equal((await f.post()).status,200);
 assert.equal(f.read().state.allocations.length,1);assert.equal(balance(f.read().state,f.read().state.invoices[0]),0);
});
for(const action of ['state','customer'])test(action+': revocation while decoding accounts cannot authorize a later financial write',async t=>{
 const f=await fixture(t),before=f.read();let revoked=false;f.onAccounts=()=>{if(!revoked){revoked=true;f.sqlite.prepare("UPDATE bank_connections SET status='disconnected',selected_accounts='[]'").run();}};
 if(action==='customer')await assert.rejects(f.reconcile(),/medgivande|kontoval|anslutning/i);else assert.notEqual((await f.post()).status,200);
 assert.equal(revoked,true);assert.deepEqual(f.read(),before);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM audit_events').get().n,0);
});
test('an unrelated settings write with no new money preserves old allocations after disconnect',async t=>{
 const f=await fixture(t);assert.equal((await f.post()).status,200);const recorded=structuredClone(f.read().state.allocations);f.sqlite.prepare("UPDATE bank_connections SET status='disconnected'").run();
 assert.equal((await f.post()).status,200);assert.deepEqual(f.read().state.allocations,recorded);assert.equal(balance(f.read().state,f.read().state.invoices[0]),0);
});
test('the SQL fence enforces current expiry even if an earlier JavaScript clock accepted the unchanged snapshot',async t=>{
 const f=await fixture(t),before=f.read();f.sqlite.prepare("UPDATE bank_connections SET valid_until='2000-01-01T00:00:00Z'").run();t.mock.method(Date,'now',()=>Date.parse('1999-01-01T00:00:00Z'));
 const result=await f.post();assert.equal(result.status,409);assert.deepEqual(f.read(),before);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM audit_events').get().n,0);
});
for(const pending of [false,true])test((pending?'legacy report promotion':'new report import')+' is fenced with its financial state',async t=>{
 let state=seed();state.transactions=[];state.imports=[];
 state=applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({account:'iban:'+iban,date:'2026-10-26',amount:62500,party:'',payerReference:'',description:'Bankgiro inbetalning',bankReference:'SYNTHETIC-COMMIT-ENTRY'})]}).state;
 const xml='<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02"><BkToCstmrDbtCdtNtfctn><Ntfctn><Acct><Id><IBAN>'+iban+'</IBAN></Id></Acct><Ntry><Amt Ccy="SEK">625.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-26</Dt></BookgDt><AcctSvcrRef>SYNTHETIC-COMMIT-ENTRY</AcctSvcrRef><NtryDtls><TxDtls><Refs><TxId>SYNTHETIC-COMMIT-CHILD</TxId></Refs><RltdPties><Dbtr><Nm>Synthetic customer AB</Nm></Dbtr></RltdPties><RmtInf><Strd><CdtrRefInf><Ref>000018</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls></Ntry></Ntfctn></BkToCstmrDbtCdtNtfctn></Document>',bytes=new TextEncoder().encode(xml),hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
 if(pending){state=applyCommand(state,{type:'bankgiro.import',documentId:'synthetic-report',hash,name:'Synthetic.xml',rows:parseBankgiroXML(xml)}).state;for(const row of state.transactions.filter(row=>row.specification)){row.parentId='';row.specificationStatus='review';row.verified=false;}}
 const f=await fixture(t,state),before=f.read();f.env.BUCKET={async get(key){return key==='synthetic-owner/synthetic-report'?{size:bytes.length,arrayBuffer:async()=>bytes.buffer}:null;}};
 f.sqlite.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run('synthetic-report','synthetic-owner','Synthetic.xml','application/xml',bytes.length,hash,'2026-10-26');
 f.beforeBatch=statements=>{if(statements.some(statement=>/UPDATE workspaces SET payload/.test(statement.query)))f.sqlite.prepare("UPDATE bank_connections SET selected_accounts='[]'").run();};
 const command=pending?undefined:{type:'bankgiro.import',documentId:'synthetic-report'},blocked=await f.post(command);assert.equal(blocked.status,409,JSON.stringify(blocked.body));assert.deepEqual(f.read(),before);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM audit_events').get().n,0);
 f.beforeBatch=null;f.restore();const result=await f.post(command);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(f.read().state.transactions.find(row=>row.specification).specificationStatus,'linked');assert.equal(f.read().state.allocations.length,1);
});
