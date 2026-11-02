import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {applyCommand,balance,economicTransactions,invoicePaymentEvidenceIssue} from '../lib/domain.ts';
import {genericCompanyState as emptyState} from './helpers/reference-policy-fixture.mjs';
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
 f.writePaymentState=(await import(evidence)).writePaymentState;
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


const reportAlias='8000000123456789';
const selectedAliasResource=()=>({uid:'selected',currency:'SEK',account_id:{iban},all_account_ids:[{scheme_name:'BBAN',identification:reportAlias}]});
function setAliasResources(f,resources){f.sqlite.prepare('UPDATE bank_connections SET encrypted_accounts=?').run(JSON.stringify(resources));}
function setSyntheticState(f,state){f.sqlite.prepare('UPDATE workspaces SET payload=?,revision=revision+1 WHERE owner=?').run(JSON.stringify(state),'synthetic-owner');}
function addAliasPayment(state){
 return applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({account:'iban:'+iban,date:'2026-10-26',amount:62500,party:'',payerReference:'',description:'Bankgiro inbetalning',bankReference:'SYNTHETIC-ALIAS-DEPOSIT'})]}).state;
}
function addAliasInvoice(state){
 return applyCommand(state,{type:'invoice.save',invoice:{direction:'receivable',party:'Synthetic customer AB',number:'0599',ocr:'',total:62500,issued:'2026-10-01',due:'2026-10-30',reviewed:true}}).state;
}
async function aliasFixture(t,linked=false){
 let state=emptyState();if(linked)state=addAliasPayment(state);const f=await fixture(t,state);
 setAliasResources(f,[selectedAliasResource()]);
 const xml='<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02"><BkToCstmrDbtCdtNtfctn><Ntfctn><Acct><Id><Othr><Id>'+reportAlias+'</Id></Othr></Id></Acct><Ntry><Amt Ccy="SEK">625.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-26</Dt></BookgDt><AcctSvcrRef>SYNTHETIC-ALIAS-DEPOSIT</AcctSvcrRef><NtryDtls><TxDtls><Refs><TxId>SYNTHETIC-ALIAS-CHILD</TxId></Refs><RltdPties><Dbtr><Nm>Synthetic customer AB</Nm></Dbtr></RltdPties><RmtInf><Strd><CdtrRefInf><Ref>0599</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls></Ntry></Ntfctn></BkToCstmrDbtCdtNtfctn></Document>',bytes=new TextEncoder().encode(xml),hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
 f.env.BUCKET={async get(key){return key==='synthetic-owner/synthetic-alias-report'?{size:bytes.length,arrayBuffer:async()=>bytes.buffer}:null;}};
 f.sqlite.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run('synthetic-alias-report','synthetic-owner','Synthetic-alias.xml','application/xml',bytes.length,hash,'2026-10-26');
 const imported=await f.post({type:'bankgiro.import',documentId:'synthetic-alias-report'});assert.equal(imported.status,200,JSON.stringify(imported.body));
 const importedRow=f.read().state.transactions.find(row=>row.specification);assert.equal(importedRow.specificationStatus,linked?'linked':'review');assert.equal(importedRow.recipientAccount,reportAlias);assert.equal(importedRow.account,'iban:'+iban);
 assert.equal(f.read().state.allocations.length,0);
 state=f.read().state;if(!linked)state=addAliasPayment(state);state=addAliasInvoice(state);setSyntheticState(f,state);
 f.originalBytes=bytes;f.originalHash=hash;return f;
}
const invalidAliasResources=[
 ['removed',()=>[{uid:'selected',currency:'SEK',account_id:{iban}}]],
 ['reassigned',()=>[{uid:'selected',currency:'SEK',account_id:{iban}},{...selectedAliasResource(),uid:'unselected',account_id:{iban:'SE4550000000058398257466'}}]],
 ['duplicated',()=>[selectedAliasResource(),{...selectedAliasResource(),uid:'unselected',account_id:{iban:'SE4550000000058398257466'}}]],
 ['duplicated on another currency',()=>[selectedAliasResource(),{...selectedAliasResource(),uid:'unselected',currency:'EUR',account_id:{iban:'SE4550000000058398257466'}}]],
 ['untyped',()=>[{...selectedAliasResource(),all_account_ids:[{scheme_name:'OTHER',identification:reportAlias}]}]],
 ['similar digits',()=>[{...selectedAliasResource(),all_account_ids:[{scheme_name:'BBAN',identification:'8000000123456780'}]}]]
];
for(const linked of [false,true])for(const [label,resources] of invalidAliasResources)test((linked?'linked':'pending')+' report with '+label+' current bank alias cannot allocate invoice 0599',async t=>{
 const f=await aliasFixture(t,linked),before=f.read().state,original=structuredClone(before.transactions.find(row=>row.specification).original);setAliasResources(f,resources());
 const result=await f.post();assert.equal(result.status,200,JSON.stringify(result.body));const state=f.read().state,row=state.transactions.find(item=>item.specification);
 assert.equal(state.allocations.length,0);assert.equal(balance(state,state.invoices[0]),62500);assert.equal(row.specificationStatus,linked?'linked':'review');
 assert.match(row.bankAccountIssue||row.bankgiroAccountIssue,/konto|medgivande/i);assert.equal(row.payerReference,'0599');assert.equal(row.party,'Synthetic customer AB');assert.equal(row.recipientAccount,reportAlias);assert.deepEqual(row.original,original);assert.equal(row.bankFileProof.sha256,f.originalHash);
 assert.deepEqual(new Uint8Array(await(await f.env.BUCKET.get('synthetic-owner/synthetic-alias-report')).arrayBuffer()),f.originalBytes);
});
for(const linked of [false,true])test((linked?'linked':'pending')+' report recovers only when its explicit bank alias returns, then replay allocates once',async t=>{
 const f=await aliasFixture(t,linked);setAliasResources(f,invalidAliasResources[0][1]());assert.equal((await f.post()).status,200);assert.equal(f.read().state.allocations.length,0);
 setAliasResources(f,[{...selectedAliasResource(),all_account_ids:[{scheme_name:'BBAN',identification:'8000 0001-2345 6789'}]}]);
 assert.equal((await f.post()).status,200);const first=f.read().state,row=first.transactions.find(item=>item.specification);
 assert.equal(row.specificationStatus,'linked');assert.equal(first.allocations.length,1);assert.equal(balance(first,first.invoices[0]),0);assert.equal(row.recipientAccount,reportAlias);assert.equal(row.payerReference,'0599');assert.equal(row.bankFileProof.sha256,f.originalHash);
 assert.equal((await f.post()).status,200);assert.deepEqual(f.read().state.allocations,first.allocations);
});
for(const linked of [false,true])test((linked?'linked':'pending')+' report without retained recipient identity cannot reuse only its resolved IBAN',async t=>{
 const f=await aliasFixture(t,linked),state=f.read().state;delete state.transactions.find(row=>row.specification).recipientAccount;setSyntheticState(f,state);
 assert.equal((await f.post()).status,200);assert.equal(f.read().state.allocations.length,0);assert.equal(balance(f.read().state,f.read().state.invoices[0]),62500);
});
test('alias removal during initial account decoding is rejected again before any financial commit',async t=>{
 const f=await aliasFixture(t),before=f.read(),audit=f.sqlite.prepare('SELECT COUNT(*) n FROM audit_events').get().n;let fired=false;
 f.onAccounts=()=>{if(!fired){fired=true;setAliasResources(f,invalidAliasResources[0][1]());}};
 const result=await f.post();assert.equal(fired,true);assert.equal(result.status,409,JSON.stringify(result.body));assert.deepEqual(f.read(),before);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM audit_events').get().n,audit);
});
test('alias removal inside the commit window rolls back promotion, allocation and audit atomically',async t=>{
 const f=await aliasFixture(t),before=f.read(),audit=f.sqlite.prepare('SELECT COUNT(*) n FROM audit_events').get().n;let fired=false;
 f.beforeBatch=statements=>{if(!fired&&statements.some(statement=>/UPDATE workspaces SET payload/.test(statement.query))){fired=true;setAliasResources(f,invalidAliasResources[0][1]());}};
 const result=await f.post();assert.equal(fired,true);assert.equal(result.status,409,JSON.stringify(result.body));assert.deepEqual(f.read(),before);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM audit_events').get().n,audit);
});
test('concurrent reconciliation of one retained alias report allocates once and reimport preserves exact reference',async t=>{
 const f=await aliasFixture(t),results=await Promise.all([f.post(),f.post()]);
 assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);const first=f.read().state;
 assert.equal(first.allocations.length,1);assert.equal(balance(first,first.invoices[0]),0);assert.equal(first.transactions.filter(row=>row.specification).length,1);
 const replay=await f.post({type:'bankgiro.import',documentId:'synthetic-alias-report'});assert.equal(replay.status,200,JSON.stringify(replay.body));
 const state=f.read().state;assert.deepEqual(state.allocations,first.allocations);assert.equal(state.transactions.filter(row=>row.specification).length,1);assert.equal(state.transactions.find(row=>row.specification).payerReference,'0599');assert.equal(state.transactions.find(row=>row.specification).bankFileProof.sha256,f.originalHash);
});


const secondReportAlias='8000000987654321';
const bothReportAliases=()=>[{...selectedAliasResource(),all_account_ids:[{scheme_name:'BBAN',identification:reportAlias},{scheme_name:'BBAN',identification:secondReportAlias}]}];
// Distinct payer and amount isolate alias validation from the existing
// multiple-payment review rule; both reports still share one primary account.
async function twoAliasFixture(t){
 const f=await aliasFixture(t,true);let state=f.read().state;const firstInvoices=structuredClone(state.invoices);state.invoices=[];
 state=applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[syntheticBankRow({account:'iban:'+iban,date:'2026-10-27',amount:75000,party:'',payerReference:'',description:'Bankgiro inbetalning',bankReference:'SYNTHETIC-SECOND-ALIAS-DEPOSIT'})]}).state;
 setSyntheticState(f,state);setAliasResources(f,bothReportAliases());
 const xml=new TextDecoder().decode(f.originalBytes).replace('>'+reportAlias+'<','>'+secondReportAlias+'<').replaceAll('SYNTHETIC-ALIAS-','SYNTHETIC-SECOND-ALIAS-').replaceAll('2026-10-26','2026-10-27').replace('<Ref>0599</Ref>','<Ref>0600</Ref>').replace('<Amt Ccy="SEK">625.00</Amt>','<Amt Ccy="SEK">750.00</Amt>').replace('<Nm>Synthetic customer AB</Nm>','<Nm>Second synthetic customer AB</Nm>');
 const bytes=new TextEncoder().encode(xml),hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),oldGet=f.env.BUCKET.get.bind(f.env.BUCKET);
 f.env.BUCKET={async get(key){return key==='synthetic-owner/synthetic-second-alias-report'?{size:bytes.length,arrayBuffer:async()=>bytes.buffer}:oldGet(key);}};
 f.sqlite.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run('synthetic-second-alias-report','synthetic-owner','Synthetic-second-alias.xml','application/xml',bytes.length,hash,'2026-10-27');
 const imported=await f.post({type:'bankgiro.import',documentId:'synthetic-second-alias-report'});assert.equal(imported.status,200,JSON.stringify(imported.body));
 state=f.read().state;state.invoices=firstInvoices;state=applyCommand(state,{type:'invoice.save',invoice:{direction:'receivable',party:'Second synthetic customer AB',number:'0600',ocr:'',total:75000,issued:'2026-10-01',due:'2026-10-30',reviewed:true}}).state;setSyntheticState(f,state);
 const rows=state.transactions.filter(row=>row.specification);assert.deepEqual(rows.map(row=>[row.recipientAccount,row.specificationStatus,row.payerReference]).sort((a,b)=>a[2].localeCompare(b[2])),[[reportAlias,'linked','0599'],[secondReportAlias,'linked','0600']]);assert.equal(state.allocations.length,0);return f;
}
test('per-call account cache does not reuse one valid report alias for another alias on the same primary account',async t=>{
 const f=await twoAliasFixture(t),before=f.read().state;setAliasResources(f,[selectedAliasResource()]);
 const result=await f.post();assert.equal(result.status,200,JSON.stringify(result.body));const state=f.read().state,first=state.invoices.find(i=>i.number==='0599'),second=state.invoices.find(i=>i.number==='0600'),held=state.transactions.find(row=>row.recipientAccount===secondReportAlias);
 assert.equal(state.allocations.length,1);assert.equal(state.allocations[0].invoiceId,first.id);assert.equal(balance(state,first),0);assert.equal(balance(state,second),75000);assert.match(held.bankAccountIssue,/konto|medgivande/i);
 assert.equal(held.specificationStatus,'linked');assert.equal(held.payerReference,'0600');assert.deepEqual(held.original,before.transactions.find(row=>row.id===held.id).original);
});
test('commit validates every recipient alias before deduplicating a shared account consent',async t=>{
 const f=await twoAliasFixture(t),before=f.read(),auditBefore=f.sqlite.prepare('SELECT COUNT(*) n FROM audit_events').get().n;let proposed=before.state;
 for(const reference of ['0599','0600']){const invoice=proposed.invoices.find(i=>i.number===reference),row=proposed.transactions.find(row=>row.specification&&row.payerReference===reference);proposed=applyCommand(proposed,{type:'match.create',invoiceId:invoice.id,transactionId:row.id,amount:invoice.total,note:'Synthetic separately checked proposal.'}).state;}
 const statements=()=>[
  f.env.DB.prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspaces WHERE owner=? AND revision=?)').bind(crypto.randomUUID(),'synthetic-owner',before.revision+1,'synthetic.alias-commit','{}','2026-10-27','synthetic-owner',before.revision),
  f.env.DB.prepare('UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE owner=? AND revision=?').bind(JSON.stringify(proposed),'2026-10-27','synthetic-owner',before.revision)
 ];
 setAliasResources(f,[selectedAliasResource()]);
 await assert.rejects(f.writePaymentState('synthetic-owner',before.revision,before.state,proposed,f.env.DB,statements()),/medgivande|konto/i);
 assert.deepEqual(f.read(),before);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM audit_events').get().n,auditBefore);
 setAliasResources(f,bothReportAliases());await f.writePaymentState('synthetic-owner',before.revision,before.state,proposed,f.env.DB,statements());
 assert.deepEqual(f.read().state.allocations,proposed.allocations);assert.equal(f.read().state.allocations.length,2);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM audit_events').get().n,auditBefore+1);
});
test('an alias hold preserves an existing partial allocation and economic child membership',async t=>{
 const f=await aliasFixture(t,true);let state=f.read().state;const row=state.transactions.find(row=>row.specification),invoice=state.invoices[0];
 state=applyCommand(state,{type:'match.create',invoiceId:invoice.id,transactionId:row.id,amount:25000,note:'Synthetic previously booked partial payment.'}).state;setSyntheticState(f,state);
 const before=f.read().state,membership=economicTransactions(before).map(row=>[row.id,row.amount,row.parentId]);setAliasResources(f,[{uid:'selected',currency:'SEK',account_id:{iban}}]);
 const response=await f.post();assert.equal(response.status,200,JSON.stringify(response.body));const held=f.read().state,current=held.transactions.find(item=>item.id===row.id);
 assert.deepEqual(held.allocations,before.allocations);assert.equal(balance(held,held.invoices[0]),37500);assert.match(invoicePaymentEvidenceIssue(held,invoice.id),/konto|medgivande/i);
 assert.equal(current.specificationStatus,'linked');assert.equal(current.parentId,row.parentId);assert.equal(current.verified,row.verified);assert.equal(current.payerReference,'0599');assert.deepEqual(current.original,row.original);
 assert.deepEqual(economicTransactions(held).map(row=>[row.id,row.amount,row.parentId]),membership);assert.equal(economicTransactions(held).reduce((sum,row)=>sum+row.amount,0),62500);
 assert.deepEqual(held.transactions.find(item=>item.id===row.parentId),before.transactions.find(item=>item.id===row.parentId));
 setAliasResources(f,[selectedAliasResource()]);assert.equal((await f.post()).status,200);const restored=f.read().state;assert.equal(balance(restored,restored.invoices[0]),0);assert.equal(restored.allocations.length,2);assert.deepEqual(restored.allocations[0],before.allocations[0]);
 assert.equal((await f.post()).status,200);assert.deepEqual(f.read().state.allocations,restored.allocations);
});
