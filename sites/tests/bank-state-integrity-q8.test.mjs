import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {emptyState,applyCommand,balance,available,invoiceStatus,paymentInvoiceAssessment} from '../lib/domain.ts';
import {economySummary} from '../lib/economy-summary.js';

const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const url=path=>new URL(path,import.meta.url).href;
function compiled(path,imports={}){
 let code=stripTypeScriptTypes(readFileSync(new URL(path,import.meta.url),'utf8'),{mode:'transform'});
 for(const [name,value]of Object.entries(imports))for(const quote of ['"',"'"])code=code.replaceAll(quote+name+quote,JSON.stringify(value));
 return data(code);
}
const domain=url('../lib/domain.ts'),engine=url('../lib/reconciliation-engine.js');
const reconciliation=compiled('../lib/reconciliation.ts',{'./domain':domain,'./reconciliation-engine.js':engine});
const {reconcileState}=await import(reconciliation);
const {buildPaymentOverview}=await import(compiled('../lib/payment-overview.ts',{'./domain':domain,'./reconciliation':reconciliation,'./economy-summary.js':url('../lib/economy-summary.js'),'./document-triage.js':url('../lib/document-triage.js')}));
const parsers=compiled('../lib/imports.ts',{'./domain':domain,'./local-ocr':data('export async function imageText(){} export async function pdfInvoiceText(){}'),'./payment-references.js':url('../lib/payment-references.js'),'./bankgiro-parser.js':url('../lib/bankgiro-parser.js')});
const account='iban:SE4280000890119146168423';
const invoice=(s=emptyState(),extra={})=>applyCommand(s,{type:'invoice.save',invoice:{direction:'receivable',party:'Synthetic customer AB',number:'0599',ocr:'000018',total:62500,issued:'2026-10-01',due:'2026-10-30',reviewed:true,...extra}}).state;
const bank=(s,extra={})=>applyCommand(s,{type:'transactions.import',trustedBankImport:true,rows:[{date:'2026-10-26',amount:62500,currency:'SEK',account,party:'Synthetic customer AB',payerReference:'000018',bankReference:'Q8-BANK-1',externalId:'Q8-BANK-1',source:'Enable Banking · Synthetic',kind:'payment',verified:true,...extra}]}).state;

async function fixture(t,state){
 const key='__q8_bank_state_'+crypto.randomUUID().replaceAll('-',''),sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE workspaces(owner TEXT PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT);CREATE TABLE documents(id TEXT PRIMARY KEY,owner TEXT,filename TEXT,mime TEXT,size INTEGER,sha256 TEXT,created_at TEXT);CREATE TABLE audit_events(id TEXT,owner TEXT,revision INTEGER,action TEXT,detail TEXT,created_at TEXT);');
 t.after(()=>{sql.close();delete globalThis[key];});
 const DB={prepare(statement){return{bind(...args){return{query:statement,values:args,async first(){return sql.prepare(statement).get(...args)||null;},async all(){return{results:sql.prepare(statement).all(...args)};},async run(){return{meta:{changes:sql.prepare(statement).run(...args).changes}};}};}};},async batch(statements){if(DB.beforeBatch)await DB.beforeBatch(statements);sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 const objects=new Map(),reads=[],f={sql,objects,reads,user:{userId:'synthetic-owner'},env:{DB,BUCKET:{async get(key){reads.push(key);const bytes=objects.get(key);return bytes?{size:bytes.byteLength,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}:null;}}}};
 globalThis[key]=f;
 sql.prepare('INSERT INTO workspaces VALUES(?,?,?,?)').run('synthetic-owner',1,JSON.stringify(state),'2026-10-30');
 const server=compiled('../lib/server.ts',{'cloudflare:workers':data(`export const env=globalThis[${JSON.stringify(key)}].env;`),'@/app/chatgpt-auth':data(`export async function getChatGPTUser(){return globalThis[${JSON.stringify(key)}].user;}`),'./domain':domain,'./imports':parsers});
 const evidence=compiled('../lib/reconciliation-evidence.ts',{'./server':server,'./domain':domain,'./reconciliation':reconciliation,'./reconciliation-engine.js':engine});
 const bankgiro=compiled('../lib/bankgiro-service.ts',{'./server':server,'./bankgiro-parser.js':url('../lib/bankgiro-parser.js'),'./domain':domain,'./banking/store':data('export async function connection(){return null;} export async function accounts(){return [];}'),'./banking/transactions':data('export function stableAccountKey(){return null;}')});
 const route=await import(compiled('../app/api/state/route.ts',{'@/lib/server':server,'@/lib/domain':domain,'@/lib/reconciliation-evidence':evidence,'@/lib/bankgiro-service':bankgiro,'@/lib/customer-messages':data('export async function reconcileAndPrepare(){}'),'@/lib/bankgiro-invoice-search':data('export async function searchBankgiroInvoice(){}')}));
 return {...f,evidence:await import(evidence),read(){const row=sql.prepare('SELECT revision,payload FROM workspaces WHERE owner=?').get('synthetic-owner');return{revision:row.revision,state:JSON.parse(row.payload)};},async original(id,body,filename='Synthetic.csv',owner='synthetic-owner'){
   const bytes=typeof body==='string'?new TextEncoder().encode(body):body,hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');objects.set(owner+'/'+id,bytes);sql.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?)').run(id,owner,filename,filename.endsWith('.xml')?'application/xml':'text/csv',bytes.byteLength,hash,'2026-10-30');return{documentId:id,hash,bytes};
  },async post(command={type:'settings.save',name:'Synthetic company',email:'synthetic@example.test'},options={}){
   const revision=options.revision??sql.prepare('SELECT revision FROM workspaces WHERE owner=?').get('synthetic-owner').revision;
   const response=await route.POST(new Request('https://mg.test/api/state',{method:'POST',headers:{Origin:'https://mg.test','Content-Type':'application/json'},body:JSON.stringify({revision,requestId:options.requestId||crypto.randomUUID(),command})}));return{response,body:await response.json()};
  }};
}

test('Q8: a manual match undo remains undone through automatic reconciliation and request replay',async t=>{
 const initial=reconcileState(bank(invoice())).state,previous=structuredClone(initial.allocations[0]),f=await fixture(t,initial);
 const command={type:'match.undo',id:previous.id,note:'The recorded invoice relation is disputed; review the original.'},requestId=crypto.randomUUID();
 const result=await f.post(command,{requestId});
 assert.equal(result.response.status,200);
 assert.equal(result.body.state.allocations.filter(a=>a.active).length,0);
 assert.equal(balance(result.body.state,result.body.state.invoices[0]),62500);
 assert.equal(available(result.body.state,result.body.state.transactions[0]),62500);
 assert.equal(result.body.state.allocations[0].active,false);
 assert.ok(result.body.state.allocations[0].reversedAt);
 const again=await f.post();assert.equal(again.response.status,200);assert.equal(again.body.state.allocations.filter(a=>a.active).length,0);
 const replay=await f.post(command,{revision:1,requestId});assert.equal(replay.response.status,200);assert.equal(replay.body.revision,3);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n,2);
 assert.deepEqual(f.read().state.allocations,again.body.state.allocations);
});

test('Q8: an allocated payment cannot silently change its verified payer or reference',async t=>{
 for(const change of [{party:'Different synthetic payer AB'},{payerReference:'000026'}]){
  const initial=reconcileState(bank(invoice())).state,f=await fixture(t,initial),before=f.read();
  const result=await f.post({type:'transaction.verify',id:initial.transactions[0].id,note:'New information needs review.',...change});
  assert.equal(result.response.status,400,JSON.stringify(change));
  assert.deepEqual(f.read(),before);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n,0);
 }
});

test('Q8: undoing one allocation preserves the other allocation from the same payment',async t=>{
 let initial=bank(invoice(invoice(),{number:'0600',ocr:'000026'}),{amount:125000});
 for(const item of initial.invoices)initial=applyCommand(initial,{type:'match.create',transactionId:initial.transactions[0].id,invoiceId:item.id,amount:62500,referenceCorrection:true,note:'Explicit distribution from the synthetic specification.'}).state;
 const keep=structuredClone(initial.allocations[1]),original=structuredClone(initial.transactions[0].original),f=await fixture(t,initial);
 const result=await f.post({type:'match.undo',id:initial.allocations[0].id,note:'Only the first allocation is disputed.'});
 assert.equal(result.response.status,200);assert.deepEqual(result.body.state.allocations.filter(a=>a.active),[keep]);
 assert.equal(balance(result.body.state,result.body.state.invoices[0]),62500);assert.equal(balance(result.body.state,result.body.state.invoices[1]),0);
 assert.deepEqual(result.body.state.transactions[0].original,original);
});

test('Q8: a fresh explicit payment verification can release a manual undo hold once',async t=>{
 const initial=reconcileState(bank(invoice())).state,f=await fixture(t,initial);
 const undone=await f.post({type:'match.undo',id:initial.allocations[0].id,note:'Recheck the identity.'});
 assert.equal(undone.body.state.allocations.filter(a=>a.active).length,0);
 const confirmed=await f.post({type:'transaction.verify',id:initial.transactions[0].id,note:'Rechecked the retained bank identity and exact reference.'});
 assert.equal(confirmed.response.status,200);assert.equal(confirmed.body.state.allocations.filter(a=>a.active).length,1);
 assert.equal(confirmed.body.state.allocations.length,2);assert.equal(confirmed.body.state.allocations[0].active,false);
 assert.equal(balance(confirmed.body.state,confirmed.body.state.invoices[0]),0);
 const again=await f.post();assert.equal(again.body.state.allocations.length,2);
});

const specification=(party='Synthetic customer AB',reference='000018',id='Q8-SPECIFICATION-CHILD')=>`<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02"><BkToCstmrDbtCdtNtfctn><Ntfctn><Acct><Id><IBAN>SE4280000890119146168423</IBAN></Id></Acct><Ntry><Amt Ccy="SEK">625.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-26</Dt></BookgDt><AcctSvcrRef>Q8-AGGREGATE</AcctSvcrRef><NtryDtls><TxDtls><Refs><TxId>${id}</TxId></Refs><RltdPties><Dbtr><Nm>${party}</Nm></Dbtr></RltdPties><RmtInf><Strd><CdtrRefInf><Ref>${reference}</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls></Ntry></Ntfctn></BkToCstmrDbtCdtNtfctn></Document>`;
test('Q8: contradictory Bankgiro originals hold the earlier payment before an invoice can consume it',async t=>{
 for(const [party,reference]of [['Different synthetic payer AB','000018'],['Synthetic customer AB','000026']]){
  const initial=bank(emptyState(),{party:'',payerReference:'',bankReference:'Q8-AGGREGATE',externalId:'Q8-AGGREGATE',kind:'batch',description:'Bankgiro inbetalning'}),f=await fixture(t,initial);
  await f.original('first-specification',specification(),'First.xml');await f.original('second-specification',specification(party,reference),'Second.xml');
  const first=await f.post({type:'bankgiro.import',documentId:'first-specification'});assert.equal(first.response.status,200);
  const original=structuredClone(first.body.state.transactions.find(row=>row.parentId).original);
  const second=await f.post({type:'bankgiro.import',documentId:'second-specification'});assert.equal(second.response.status,200);
  const result=await f.post({type:'invoice.save',invoice:{...invoice().invoices[0],id:undefined}});
  assert.equal(result.response.status,200);assert.equal(result.body.state.allocations.length,0,`${party}/${reference}`);
  assert.equal(balance(result.body.state,result.body.state.invoices[0]),62500);
  assert.deepEqual(result.body.state.transactions.find(row=>row.parentId).original,original);
  assert.ok(result.body.state.transactions.some(row=>row.bankEvidenceConflicts?.length));
  assert.equal(f.objects.size,2);
 }
});

const bankCsv=rows=>'Datum;Belopp;Betalare;OCR;Referens;Valuta;Transaktions-id;Konto\n'+rows.map(row=>row.join(';')+';SE4280000890119146168423').join('\n');
test('Q8: a rejected file import retains observed conflicts without its partial economic rows',async t=>{
 let initial=bank(bank(invoice()),{date:'2026-10-27',amount:10000,party:'Other synthetic customer',payerReference:'000026',bankReference:'Q8-IGNORED',externalId:'Q8-IGNORED'});
 initial=applyCommand(initial,{type:'transaction.ignore',id:initial.transactions[1].id}).state;
 const f=await fixture(t,initial),before=f.read(),content=bankCsv([
  ['2026-10-28','10,00','Fresh synthetic customer','000034','Q8-FRESH','SEK','Q8-FRESH'],
  ['2026-10-26','625,00','Contradictory synthetic payer','000018','Q8-BANK-1','SEK','Q8-BANK-1'],
  ['2026-10-27','100,00','Other synthetic customer','000026','Q8-IGNORED','SEK','Q8-IGNORED']
 ]),original=await f.original('rejected-conflict',content);
 const result=await f.post({type:'transactions.import',documentId:'rejected-conflict'});
 assert.equal(result.response.status,400);assert.match(result.body.error,/undantagen/i);
 const retained=f.read();assert.equal(retained.revision,2);assert.equal(retained.state.transactions.length,2);
 assert.deepEqual(retained.state.invoices,before.state.invoices);assert.deepEqual(retained.state.allocations,before.state.allocations);assert.deepEqual(retained.state.imports,before.state.imports);
 assert.deepEqual(retained.state.transactions[0].original,before.state.transactions[0].original);
 const conflict=retained.state.transactions[0].bankEvidenceConflicts?.[0];assert.ok(conflict);assert.equal(conflict.incoming.party,'Contradictory synthetic payer');assert.equal(conflict.incoming.bankFileProof.documentId,'rejected-conflict');assert.equal(conflict.incoming.bankFileProof.sha256,original.hash);
 assert.equal(new TextDecoder().decode(f.objects.get('synthetic-owner/rejected-conflict')),content);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n,1);
 const retry=await f.post({type:'transactions.import',documentId:'rejected-conflict'});assert.equal(retry.response.status,400);assert.equal(f.read().revision,2);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n,1);
 const ordinary=await f.post();assert.equal(ordinary.response.status,200);assert.equal(ordinary.body.state.allocations.length,0);assert.equal(balance(ordinary.body.state,ordinary.body.state.invoices[0]),62500);
});

test('Q8: a contradictory amount in a rejected original remains a durable hold',async t=>{
 const initial=bank(invoice()),f=await fixture(t,initial),content=bankCsv([['2026-10-26','700,00','Synthetic customer AB','000018','Q8-BANK-1','SEK','Q8-BANK-1']]);
 const original=await f.original('changed-amount',content);
 const result=await f.post({type:'transactions.import',documentId:'changed-amount'});assert.equal(result.response.status,400);
 const retained=f.read();assert.equal(retained.state.transactions[0].amount,62500);assert.equal(retained.state.transactions[0].bankEvidenceConflicts?.[0].incoming.amount,70000);assert.equal(retained.state.transactions[0].bankEvidenceConflicts[0].incoming.bankFileProof.sha256,original.hash);
 const ordinary=await f.post();assert.equal(ordinary.body.state.allocations.length,0);assert.equal(balance(ordinary.body.state,ordinary.body.state.invoices[0]),62500);
});

test('Q8: a new specification child ID cannot bypass a contradiction under the same aggregate',async t=>{
 const initial=bank(emptyState(),{party:'',payerReference:'',bankReference:'Q8-AGGREGATE',externalId:'Q8-AGGREGATE',kind:'batch',description:'Bankgiro inbetalning'}),f=await fixture(t,initial);
 await f.original('first-specification',specification(),'First.xml');await f.original('second-specification',specification('Different synthetic payer','000026','Q8-NEW-CHILD'),'Second.xml');
 assert.equal((await f.post({type:'bankgiro.import',documentId:'first-specification'})).response.status,200);
 const before=f.read();assert.equal((await f.post({type:'bankgiro.import',documentId:'second-specification'})).response.status,200);
 const result=await f.post({type:'invoice.save',invoice:{...invoice().invoices[0],id:undefined}});
 assert.equal(result.response.status,200);assert.equal(result.body.state.allocations.length,0);
 assert.ok(result.body.state.transactions[0].bankEvidenceConflicts?.length);
 assert.deepEqual(result.body.state.transactions[0].original,before.state.transactions[0].original);
 assert.equal(f.objects.size,2);
});

test('Q8: equal payment values do not hide newly invalid OCR evidence in another original',async t=>{
 const initial=bank(emptyState(),{party:'',payerReference:'',bankReference:'Q8-AGGREGATE',externalId:'Q8-AGGREGATE',kind:'batch',description:'Bankgiro inbetalning'}),f=await fixture(t,initial),first=specification('Synthetic customer AB','000019');
 await f.original('generic-reference',first,'First.xml');await f.original('invalid-ocr',first.replace('<CdtrRefInf>','<CdtrRefInf><Tp><CdOrPrtry><Prtry>OCR</Prtry></CdOrPrtry></Tp>'),'Second.xml');
 assert.equal((await f.post({type:'bankgiro.import',documentId:'generic-reference'})).response.status,200);
 assert.equal((await f.post({type:'bankgiro.import',documentId:'invalid-ocr'})).response.status,200);
 const result=await f.post({type:'invoice.save',invoice:{...invoice(emptyState(),{ocr:'000019'}).invoices[0],id:undefined}});
 assert.equal(result.response.status,200);assert.equal(result.body.state.allocations.length,0);
 assert.ok(result.body.state.transactions.some(row=>row.bankEvidenceConflicts?.length));
});

test('Q8: splitting a manually undone payment cannot erase its automatic matching hold',async t=>{
 let initial=reconcileState(bank(invoice())).state;
 initial=applyCommand(initial,{type:'match.undo',id:initial.allocations[0].id,note:'Payment allocation needs review.'}).state;
 const f=await fixture(t,initial),result=await f.post({type:'transaction.split',id:initial.transactions[0].id,rows:[{amount:62500,party:'Synthetic customer AB',payerReference:'000018'}]});
 assert.equal(result.response.status,200);assert.equal(result.body.state.allocations.filter(a=>a.active).length,0);assert.equal(balance(result.body.state,result.body.state.invoices[0]),62500);
 const child=result.body.state.transactions.find(row=>row.parentId),confirmed=await f.post({type:'transaction.verify',id:child.id,note:'Rechecked this individual payment against the specification.'});
 assert.equal(confirmed.response.status,200);assert.equal(confirmed.body.state.allocations.filter(a=>a.active).length,1);
});

test('Q8: a parent refund or reversal remains review evidence after its complete specification arrives',async t=>{
 for(const description of ['Bankgiro inbetalning · Refund','Bankgiro inbetalning · Payment reversal']){
  const initial=bank(invoice(),{party:'',payerReference:'',bankReference:'Q8-AGGREGATE',externalId:'Q8-AGGREGATE',kind:'batch',description}),f=await fixture(t,initial);
  await f.original('specification',specification(),'Synthetic.xml');
  const result=await f.post({type:'bankgiro.import',documentId:'specification'});
  assert.equal(result.response.status,200);assert.equal(result.body.state.allocations.length,0,description);assert.equal(balance(result.body.state,result.body.state.invoices[0]),62500);
 }
});

test('Q8: a contradiction on any ancestor blocks both automatic and manual allocation of its child',async t=>{
 const rows=[
  {key:'outer',date:'2026-10-26',amount:62500,account,party:'Outer synthetic collection',payerReference:'outer-reference',bankReference:'Q8-OUTER',externalId:'Q8-OUTER',kind:'batch'},
  {key:'inner',parentKey:'outer',date:'2026-10-26',amount:62500,account,party:'Inner synthetic collection',payerReference:'inner-reference',bankReference:'Q8-INNER',externalId:'Q8-INNER',kind:'batch'},
  {parentKey:'inner',date:'2026-10-26',amount:62500,account,party:'Synthetic customer AB',payerReference:'000018',bankReference:'Q8-CHILD',externalId:'Q8-CHILD',kind:'payment',verified:true}
 ];
 let initial=applyCommand(invoice(emptyState(),{total:100000}),{type:'transactions.import',trustedBankImport:true,rows}).state;
 initial=applyCommand(initial,{type:'transactions.import',trustedBankImport:true,rows:[{...rows[0],party:'Contradictory outer collection'}]}).state;
 const f=await fixture(t,initial),automatic=await f.post();assert.equal(automatic.response.status,200);assert.equal(automatic.body.state.allocations.length,0);
 const manual=await f.post({type:'match.create',invoiceId:initial.invoices[0].id,transactionId:initial.transactions[2].id,amount:62500,note:'A manual note cannot resolve inherited original conflicts.'});
 assert.equal(manual.response.status,400);assert.equal(f.read().state.allocations.length,0);assert.equal(balance(f.read().state,f.read().state.invoices[0]),100000);
});

test('Q8: conflicting specifications received before their aggregate cannot release the first report',async t=>{
 const f=await fixture(t,invoice());
 await f.original('first-specification',specification(),'First.xml');await f.original('second-specification',specification('Different synthetic payer','000026','Q8-NEW-CHILD'),'Second.xml');
 assert.equal((await f.post({type:'bankgiro.import',documentId:'first-specification'})).response.status,200);
 assert.equal((await f.post({type:'bankgiro.import',documentId:'second-specification'})).response.status,200);
 const result=await f.post({type:'transactions.import',rows:[{date:'2026-10-26',account,amount:62500,bankReference:'Q8-AGGREGATE',externalId:'Q8-AGGREGATE',kind:'batch',description:'Bankgiro inbetalning'}]});
 assert.equal(result.response.status,200);assert.equal(result.body.state.allocations.length,0);
 assert.equal(balance(result.body.state,result.body.state.invoices[0]),62500);assert.ok(result.body.state.transactions.find(row=>row.kind==='batch').bankEvidenceConflicts?.length);
 const before=f.read(),again=await f.post();assert.equal(again.response.status,200);assert.deepEqual(again.body.state.allocations,[]);assert.deepEqual(again.body.state.imports,before.state.imports);assert.equal(again.body.state.transactions.find(row=>row.kind==='batch').bankEvidenceConflicts.length,1);
});

test('Q8 review: a contradictory incoming child and its new parent cannot consume a second original',async t=>{
 const initial=bank(invoice(emptyState(),{total:70000}),{amount:70000,party:'',payerReference:'',bankReference:'Q8-AGGREGATE-B',externalId:'Q8-AGGREGATE-B',kind:'batch',description:'Bankgiro inbetalning'}),f=await fixture(t,initial);
 await f.original('first-child',specification('Earlier synthetic payer','000026','SAME-CHILD-ID').replace('Q8-AGGREGATE','Q8-AGGREGATE-A'),'First.xml');
 await f.original('contradictory-child',specification('Synthetic customer AB','000018','SAME-CHILD-ID').replace('Q8-AGGREGATE','Q8-AGGREGATE-B').replaceAll('625.00','700.00'),'Second.xml');
 assert.equal((await f.post({type:'bankgiro.import',documentId:'first-child'})).response.status,200);
 const result=await f.post({type:'bankgiro.import',documentId:'contradictory-child'});assert.equal(result.response.status,200);
 assert.equal(result.body.state.allocations.length,0);assert.equal(balance(result.body.state,result.body.state.invoices[0]),70000);
 const copies=result.body.state.transactions.filter(row=>row.externalId==='transaction:SAME-CHILD-ID'),incoming=copies.find(row=>row.amount===70000);
 assert.equal(copies.length,2);assert.ok(copies.every(row=>row.bankEvidenceConflicts?.length));assert.ok(result.body.state.transactions[0].bankEvidenceConflicts?.length);
 assert.equal(copies[0].original.amount,62500);assert.equal(copies[0].original.party,'Earlier synthetic payer');assert.equal(incoming.original.amount,70000);assert.equal(incoming.original.party,'Synthetic customer AB');
 assert.equal((await f.post({type:'transaction.verify',id:incoming.id,note:'A note cannot resolve a reused bank ID.'})).response.status,400);
 assert.equal((await f.post({type:'transaction.unsplit',id:initial.transactions[0].id})).response.status,200);
 assert.equal((await f.post({type:'transaction.split',id:initial.transactions[0].id,rows:[{amount:70000,party:'Synthetic customer AB',payerReference:'000018'}]})).response.status,400);
 assert.equal(f.read().state.allocations.length,0);assert.equal(f.objects.size,2);
});

test('Q8 review: a reused child ID keeps earlier allocations and cannot pay the new parent invoice',async t=>{
 let initial=invoice(invoice(emptyState(),{party:'Earlier synthetic payer',number:'0600',ocr:'000026'}),{total:70000});
 initial=bank(bank(initial,{party:'',payerReference:'',bankReference:'Q8-AGGREGATE-A',externalId:'Q8-AGGREGATE-A',kind:'batch',description:'Bankgiro inbetalning'}),{amount:70000,party:'',payerReference:'',bankReference:'Q8-AGGREGATE-B',externalId:'Q8-AGGREGATE-B',kind:'batch',description:'Bankgiro inbetalning'});
 const f=await fixture(t,initial);
 await f.original('allocated-child',specification('Earlier synthetic payer','000026','SAME-CHILD-ID').replace('Q8-AGGREGATE','Q8-AGGREGATE-A'),'First.xml');
 await f.original('contradictory-child',specification('Synthetic customer AB','000018','SAME-CHILD-ID').replace('Q8-AGGREGATE','Q8-AGGREGATE-B').replaceAll('625.00','700.00'),'Second.xml');
 const first=await f.post({type:'bankgiro.import',documentId:'allocated-child'});assert.equal(first.response.status,200);assert.equal(first.body.state.allocations.length,1);
 const before=structuredClone(first.body.state.allocations),second=await f.post({type:'bankgiro.import',documentId:'contradictory-child'});assert.equal(second.response.status,200);
 assert.deepEqual(second.body.state.allocations,before);assert.equal(balance(second.body.state,second.body.state.invoices[0]),0);assert.equal(balance(second.body.state,second.body.state.invoices[1]),70000);
 assert.ok(second.body.state.transactions.filter(row=>row.kind==='batch').every(row=>row.bankEvidenceConflicts?.length));
});

test('Q8 review: identical child values cannot relocate an original to a different aggregate',async t=>{
 const initial=bank(invoice(),{party:'',payerReference:'',bankReference:'Q8-AGGREGATE-B',externalId:'Q8-AGGREGATE-B',kind:'batch',description:'Bankgiro inbetalning'}),f=await fixture(t,initial);
 await f.original('first-child',specification('Synthetic customer AB','000018','SAME-CHILD-ID').replace('Q8-AGGREGATE','Q8-AGGREGATE-A'),'First.xml');
 await f.original('relocated-child',specification('Synthetic customer AB','000018','SAME-CHILD-ID').replace('Q8-AGGREGATE','Q8-AGGREGATE-B'),'Second.xml');
 assert.equal((await f.post({type:'bankgiro.import',documentId:'first-child'})).response.status,200);
 const first=f.read().state.transactions.find(row=>row.specification),result=await f.post({type:'bankgiro.import',documentId:'relocated-child'});
 assert.equal(result.response.status,400);const state=f.read().state;assert.equal(state.allocations.length,0);
 assert.equal(state.transactions.find(row=>row.id===first.id).parentId,'');assert.equal(state.transactions.find(row=>row.id===first.id).parentBankReference,'Q8-AGGREGATE-A');assert.ok(state.transactions[0].bankEvidenceConflicts?.length);
 const ordinary=await f.post();assert.equal(ordinary.response.status,200);assert.equal(ordinary.body.state.allocations.length,0);
});

test('Q8 review: duplicate original values without a child ID still compare reference and payer metadata',async t=>{
 const base=specification('Synthetic customer AB','000019').replace('<Refs><TxId>Q8-SPECIFICATION-CHILD</TxId></Refs>','');
 const organization=(xml,value)=>xml.replace('</Nm>',`</Nm><Id><OrgId><Othr><Id>${value}</Id></Othr></OrgId></Id>`);
 for(const [first,second]of [
  [base,base.replace('<CdtrRefInf>','<CdtrRefInf><Tp><CdOrPrtry><Prtry>OCR</Prtry></CdOrPrtry></Tp>')],
  [organization(base,'556123-4567'),organization(base,'556765-4321')],
  [base,base.replace('<NtryDtls>','<AddtlNtryInf>Payment reversal</AddtlNtryInf><NtryDtls>')]
 ]){
  const initial=bank(emptyState(),{party:'',payerReference:'',bankReference:'Q8-AGGREGATE',externalId:'Q8-AGGREGATE',kind:'batch',description:'Bankgiro inbetalning'}),f=await fixture(t,initial);
  await f.original('first-metadata',first,'First.xml');await f.original('second-metadata',second,'Second.xml');
  assert.equal((await f.post({type:'bankgiro.import',documentId:'first-metadata'})).response.status,200);
  assert.equal((await f.post({type:'bankgiro.import',documentId:'second-metadata'})).response.status,200);
  const result=await f.post({type:'invoice.save',invoice:{...invoice(emptyState(),{ocr:'000019'}).invoices[0],id:undefined}});
  assert.equal(result.response.status,200);assert.equal(result.body.state.allocations.length,0);assert.ok(result.body.state.transactions[0].bankEvidenceConflicts?.length);
 }
});

test('Q8 review: imported and late-linked specification children inherit a manual undo hold',async t=>{
 for(const pendingFirst of [false,true]){
  const initial=reconcileState(bank(invoice(),{bankReference:'Q8-AGGREGATE',externalId:'Q8-AGGREGATE'})).state,f=await fixture(t,initial),id=initial.transactions[0].id;
  await f.original('imported-specification',specification('Synthetic customer AB','000018','NEW-SPEC-CHILD'),'Synthetic.xml');
  if(pendingFirst){const pending=await f.post({type:'bankgiro.import',documentId:'imported-specification'});assert.equal(pending.response.status,200);assert.equal(pending.body.state.transactions.find(row=>row.specification).specificationStatus,'review');}
  assert.equal((await f.post({type:'match.undo',id:initial.allocations[0].id,note:'Review the invoice relation before allocating again.'})).response.status,200);
  assert.equal((await f.post({type:'transaction.split',id,rows:[{amount:62500,party:'Synthetic customer AB',payerReference:'000018'}]})).response.status,200);
  const unsplit=await f.post({type:'transaction.unsplit',id});assert.equal(unsplit.response.status,200);
  const result=pendingFirst?unsplit:await f.post({type:'bankgiro.import',documentId:'imported-specification'});
  assert.equal(result.response.status,200);assert.equal(result.body.state.allocations.filter(row=>row.active).length,0);assert.equal(balance(result.body.state,result.body.state.invoices[0]),62500);
  const child=result.body.state.transactions.find(row=>row.evidence==='bankgiro_file'&&!row.ignored);assert.ok(child.automaticMatchHold);assert.equal(child.parentId,id);
  const reviewed=await f.post({type:'transaction.verify',id:child.id,note:'Rechecked the individual original and the disputed invoice relation.'});
  assert.equal(reviewed.response.status,200);assert.equal(reviewed.body.state.allocations.filter(row=>row.active).length,1);assert.equal(reviewed.body.state.allocations.length,2);
 }
});

function nearCapacity(state,size=1799000){
 for(let n=0;n<600;n++)state.invoices.push(invoice(emptyState(),{number:'FILL-'+n,ocr:'',party:'Synthetic filler '+n,total:1,issued:'2026-10-29'}).invoices[0]);
 let remaining=size-Buffer.byteLength(JSON.stringify(state));
 for(const item of state.invoices.slice(-600)){const count=Math.min(3000,remaining);item.note='x'.repeat(count);remaining-=count;if(!remaining)break;}
 assert.equal(remaining,0);assert.equal(Buffer.byteLength(JSON.stringify(state)),size);return state;
}
const oversizedConflictCsv=amount=>bankCsv([['2026-10-26',amount,'Contradictory synthetic payer','000018','Q8-BANK-1','SEK','Q8-BANK-1']]).replace(';Konto',';Konto;Beskrivning')+';'+'d'.repeat(1000);

test('Q8 review: both rejected and otherwise-valid imports retain a compact conflict hold at the workspace cap',async t=>{
 for(const amount of ['700,00','625,00']){
  const initial=nearCapacity(bank(invoice())),f=await fixture(t,initial),before=f.read(),original=await f.original('capacity-conflict',oversizedConflictCsv(amount));
  const command={type:'transactions.import',documentId:'capacity-conflict'},result=await f.post(command);
  assert.equal(result.response.status,400);const saved=f.read();assert.equal(saved.revision,2);assert.ok(saved.state.bankEvidenceHold);
  const {bankEvidenceHold,...preserved}=saved.state;assert.deepEqual(preserved,before.state);assert.ok(Buffer.byteLength(JSON.stringify(saved.state))<=1800256);
  const event=f.sql.prepare('SELECT owner,action,detail FROM audit_events WHERE id=?').get(bankEvidenceHold.auditEventId);assert.equal(event.owner,'synthetic-owner');assert.equal(event.action,'bank.import_rejected');
  const detail=JSON.parse(event.detail),incoming=detail.retained_conflicts.flatMap(entry=>entry.conflicts).find(conflict=>conflict.incoming.bankFileProof?.documentId==='capacity-conflict').incoming;
  assert.equal(incoming.bankFileProof.sha256,original.hash);assert.equal(incoming.party,'Contradictory synthetic payer');assert.equal(incoming.description,'d'.repeat(1000));assert.equal(f.objects.size,1);
  const retry=await f.post(command);assert.equal(retry.response.status,400);assert.equal(f.read().revision,2);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n,1);
  const ordinary=await f.post();assert.equal(ordinary.response.status,200);assert.equal(ordinary.body.state.allocations.length,0);assert.deepEqual(ordinary.body.state.bankEvidenceHold,bankEvidenceHold);
  assert.equal(reconcileState(f.read().state).state.allocations.length,0);assert.equal((await f.evidence.reconciliationPreviewWithOriginals('synthetic-owner',f.read().state)).automatic_candidates,0);
  for(const blocked of [{type:'match.create',invoiceId:initial.invoices[0].id,transactionId:initial.transactions[0].id,amount:62500,note:'A note cannot clear a capacity hold.'},{type:'transaction.verify',id:initial.transactions[0].id,note:'A note cannot clear a capacity hold.'},{type:'transaction.split',id:initial.transactions[0].id,rows:[{amount:62500,party:'Synthetic customer AB',payerReference:'000018'}]}])assert.equal((await f.post(blocked)).response.status,400);
  assert.equal(f.read().state.allocations.length,0);assert.equal(balance(f.read().state,f.read().state.invoices[0]),62500);
 }
});

test('Q8 review: a workspace already at the cap has only a bounded protective marker reserve',async t=>{
 const initial=nearCapacity(bank(invoice()),1800000),f=await fixture(t,initial),before=f.read();await f.original('capacity-conflict',oversizedConflictCsv('700,00'));
 const result=await f.post({type:'transactions.import',documentId:'capacity-conflict'});assert.equal(result.response.status,400);const saved=f.read();assert.equal(saved.revision,2);assert.ok(saved.state.bankEvidenceHold);
 const {bankEvidenceHold,...preserved}=saved.state;assert.deepEqual(preserved,before.state);assert.ok(Buffer.byteLength(JSON.stringify(saved.state))<=1800256);assert.equal(reconcileState(saved.state).state.allocations.length,0);
 const blocked=await f.post({type:'transaction.verify',id:initial.transactions[0].id,note:'Cannot remove the cap safety marker.'});assert.equal(blocked.response.status,400);assert.deepEqual(f.read().state.bankEvidenceHold,bankEvidenceHold);
});

test('Q8 review: a cap hold and its full conflict audit cannot overwrite a concurrent state revision',async t=>{
 const f=await fixture(t,nearCapacity(bank(invoice()))),before=f.read();await f.original('capacity-conflict',oversizedConflictCsv('700,00'));
 f.env.DB.beforeBatch=statements=>{if(statements.some(statement=>statement.values.includes('bank.import_rejected'))){f.env.DB.beforeBatch=null;const concurrent=structuredClone(before.state);concurrent.company.name='Concurrent synthetic edit';f.sql.prepare('UPDATE workspaces SET revision=revision+1,payload=?').run(JSON.stringify(concurrent));}};
 const result=await f.post({type:'transactions.import',documentId:'capacity-conflict'});assert.equal(result.response.status,409);assert.equal(f.read().revision,2);assert.equal(f.read().state.company.name,'Concurrent synthetic edit');assert.equal(f.read().state.bankEvidenceHold,undefined);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n,0);assert.equal(f.read().state.allocations.length,0);
});

test('Q8 replay: rereading the exact verified file preserves its explicit review and allocation',async t=>{
 const f=await fixture(t,invoice()),content=bankCsv([['2026-10-26','625,00','Synthetic customer AB','000018','Q8-BANK-1','SEK','Q8-BANK-1']]);
 await f.original('verified-file',content);await f.original('identical-file-copy',content);
 const imported=await f.post({type:'transactions.import',documentId:'verified-file'});assert.equal(imported.response.status,200);assert.equal(imported.body.state.allocations.length,0);
 const verified=await f.post({type:'transaction.verify',id:imported.body.state.transactions[0].id,note:'Checked the original account, payer, direction, amount and reference.'});assert.equal(verified.response.status,200);assert.equal(verified.body.state.allocations.length,1);
 const review=verified.body.state.transactions[0].bankFileProof.reviewedAt,verification=structuredClone(verified.body.state.transactions[0].verification),allocations=structuredClone(verified.body.state.allocations);assert.ok(review);
 for(const documentId of ['verified-file','identical-file-copy']){
  const replay=await f.post({type:'transactions.import',documentId});assert.equal(replay.response.status,200);assert.equal(replay.body.state.transactions[0].bankFileProof.reviewedAt,review);
  assert.deepEqual(replay.body.state.transactions[0].verification,verification);assert.deepEqual(replay.body.state.allocations,allocations);assert.equal(replay.body.state.imports.length,1);assert.equal(replay.body.state.transactions.length,1);
 }
});

for(const [description,compact,amount,status]of [['compact rejected import',true,'700,00',400],['ordinary rejected import',false,'700,00',400],['accepted conflict-only import',false,'625,00',200]])test(`Q8 absence: ${description} invalidates derived absence without deleting the prior check`,async t=>{
 let initial=bank(invoice(emptyState(),{total:100000,due:'2026-10-20'}),{party:'Unrelated synthetic sender',payerReference:'OTHER-REF'});
 const id=initial.invoices[0].id;
 initial=applyCommand(initial,{type:'invoice.reconcile',id,confirm:true,note:'Prior synthetic account-period absence check.'}).state;
 const priorInvoice=structuredClone(initial.invoices[0]);
 assert.equal(invoiceStatus(initial,priorInvoice).key,'overdue');assert.equal(buildPaymentOverview(initial).totals.verified_outstanding_cents,100000);assert.equal(economySummary(initial).unreconciled_cents,0);
 const f=await fixture(t,compact?nearCapacity(initial):initial);
 await f.original('absence-conflict',oversizedConflictCsv(amount).replace('Contradictory synthetic payer','Synthetic customer AB'));
 const result=await f.post({type:'transactions.import',documentId:'absence-conflict'});assert.equal(result.response.status,status);
 const saved=f.read(),current=saved.state.invoices.find(i=>i.id===id),overview=buildPaymentOverview(saved.state),expected=100000+(compact?600:0);
 assert.equal(!!saved.state.bankEvidenceHold,compact);assert.deepEqual(current,priorInvoice);assert.equal(saved.state.allocations.length,0);
 assert.equal(invoiceStatus(saved.state,current).key,'unreconciled');assert.equal(overview.totals.verified_outstanding_cents,0);assert.equal(overview.totals.unreconciled_cents,expected);assert.equal(economySummary(saved.state).unreconciled_cents,expected);
 assert.doesNotMatch(overview.queue.find(item=>item.entity_id===id).reason,/efter verifierad kontroll/);
 const auditCount=f.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n;
 const blocked=await f.post({type:'invoice.reconcile',id,confirm:true,note:'A new free-text note cannot resolve conflicting originals.'});
 assert.equal(blocked.response.status,400);assert.match(blocked.body.error,/motstridiga/);assert.deepEqual(f.read(),saved);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n,auditCount);
 const ordinary=await f.post();assert.equal(ordinary.response.status,200);assert.equal(invoiceStatus(ordinary.body.state,ordinary.body.state.invoices.find(i=>i.id===id)).key,'unreconciled');assert.deepEqual(ordinary.body.state.invoices.find(i=>i.id===id),priorInvoice);
});

test('Q8 absence: an allocation timestamp alone is not a verified absence check',()=>{
 const state=invoice(emptyState(),{due:'2026-10-20'}),item=state.invoices[0];item.reconciledAt='2026-10-29T00:00:00.000Z';
 assert.equal(invoiceStatus(state,item).key,'unreconciled');assert.equal(buildPaymentOverview(state).totals.verified_outstanding_cents,0);assert.equal(economySummary(state).unreconciled_cents,62500);
});

for(const compact of [false,true])test(`Q8 payment proof: a ${compact?'compact':'retained'} conflict preserves historical allocations without claiming current verification`,async t=>{
 const initial=reconcileState(bank(invoice(emptyState(),{total:312500,vat:62500,net:250000,due:'2026-10-20'}),{amount:250000})).state;
 const f=await fixture(t,compact?nearCapacity(initial):initial),before=f.read();
 await f.original('allocated-conflict',oversizedConflictCsv('2600,00'));
 assert.equal((await f.post({type:'transactions.import',documentId:'allocated-conflict'})).response.status,400);
 const saved=f.read(),item=saved.state.invoices[0],payment=saved.state.transactions[0],overview=buildPaymentOverview(saved.state);
 assert.equal(!!saved.state.bankEvidenceHold,compact);assert.deepEqual(saved.state.allocations,before.state.allocations);assert.deepEqual(item,before.state.invoices[0]);assert.equal(balance(saved.state,item),62500);
 assert.notEqual(paymentInvoiceAssessment(saved.state,payment).status,'verified');assert.match(paymentInvoiceAssessment(saved.state,payment).message,/motstridiga/);
 assert.equal(invoiceStatus(saved.state,item).key,'review');assert.equal(overview.totals.paid_cents,250000);assert.equal(overview.totals.remaining_cents,62500+(compact?600:0));
 assert.doesNotMatch(overview.queue.find(entry=>entry.entity_id===item.id).reason,/verifierad delbetalning|Skillnaden motsvarar angiven moms/);assert.equal(economySummary(saved.state).received_month_cents,0);
});
