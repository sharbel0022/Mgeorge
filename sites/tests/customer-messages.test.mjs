import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {emptyState,applyCommand,paid,balance,invoiceStatus,prepareBankImportFailure,uid} from '../lib/domain.ts';
import {seal,unseal,randomToken,digest} from '../lib/banking/security.ts';
import {analyzeReconciliation} from '../lib/reconciliation-engine.js';

const read=p=>readFileSync(new URL(p,import.meta.url),'utf8'),data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
function moduleUrl(path,imports){imports={...Object.fromEntries(['document-triage','economy-summary'].map(n=>['./'+n+'.js',new URL('../lib/'+n+'.js',import.meta.url).href])),...imports};let s=ts.transpileModule(read(path),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;for(const [key,val]of Object.entries(imports))for(const q of ['"',"'"])s=s.replaceAll(q+key+q,JSON.stringify(val));return data(s);}
class LocalD1{
  constructor(sql){this.sql=sql;this.beforeBatch=null;}
  prepare(query){const self=this;return {query,args:[],bind(...args){this.args=args;return this;},async first(){return self.sql.prepare(query).get(...this.args)||null;},async all(){return {results:self.sql.prepare(query).all(...this.args)};},async run(){return this.execute();},execute(){const r=self.sql.prepare(query).run(...this.args);return {meta:{changes:Number(r.changes)}};}};}
  async batch(rows){if(this.beforeBatch)await this.beforeBatch(rows);this.sql.exec('BEGIN');try{const result=rows.map(r=>r.execute());this.sql.exec('COMMIT');return result;}catch(e){this.sql.exec('ROLLBACK');throw e;}}
}
const domainUrl=new URL('../lib/domain.ts',import.meta.url).href;
const reconciliationUrl=moduleUrl('../lib/reconciliation.ts',{'./domain':domainUrl,'./reconciliation-engine.js':new URL('../lib/reconciliation-engine.js',import.meta.url).href});
const reconciliation=await import(reconciliationUrl);
const origin='https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site';
async function fixture(t){
  const key='__messages_'+crypto.randomUUID().replaceAll('-',''),sql=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('../drizzle',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(read('../drizzle/'+file));
  const f={sql,objects:new Map(),owner:'owner-alice',user:{userId:'owner-alice'},key:randomToken(),posts:0,profileCalls:0,timeout:false,wrongAccount:false,cookie:'',env:{GOOGLE_CLIENT_ID:'synthetic',GOOGLE_CLIENT_SECRET:'synthetic',GMAIL_ACCOUNT:'mg.vitvaror@gmail.com'}};
  f.d1=new LocalD1(sql);globalThis[key]=f;t.after(()=>{delete globalThis[key];sql.close();});
  f.env.DB=f.d1;f.env.BUCKET={async get(id){const bytes=f.objects.get(id);return bytes?{size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}:null;}};
  const reference=`globalThis[${JSON.stringify(key)}]`,cf=data(`export const env=${reference}.env;`),securityUrl=new URL('../lib/banking/security.ts',import.meta.url).href;
  const originalServer=moduleUrl('../lib/server.ts',{'cloudflare:workers':cf,'@/app/chatgpt-auth':data(`export async function getChatGPTUser(){return ${reference}.user;}`),'./domain':domainUrl});
  const server=data(`export {readBankOriginalBytes} from ${JSON.stringify(originalServer)};import {emptyState} from ${JSON.stringify(domainUrl)};const f=${reference};export const db=()=>f.d1;export const response=(b,status=200)=>Response.json(b,{status});export async function identity(req){if(!f.user)throw Error('AUTH_REQUIRED');if(req&&req.method!=='GET'&&req.headers.get('origin')!==new URL(req.url).origin)throw Error('ORIGIN_DENIED');return f.user;}export async function readWorkspace(owner){const r=f.sql.prepare('SELECT * FROM workspaces WHERE owner=?').get(owner);return r?{revision:r.revision,state:JSON.parse(r.payload)}:{revision:0,state:emptyState()};}`);
  const store=data(`import {seal,unseal} from ${JSON.stringify(securityUrl)};const f=${reference};export const encrypt=(o,p,v)=>seal(f.key,o,p,v);export const decrypt=(o,p,v)=>unseal(f.key,o,p,v);`);
  const adapter=moduleUrl('../lib/gmail-adapter.js',{'cloudflare:workers':cf});
  const evidence=moduleUrl('../lib/reconciliation-evidence.ts',{'./server':server,'./domain':domainUrl,'./reconciliation':reconciliationUrl,'./reconciliation-engine.js':new URL('../lib/reconciliation-engine.js',import.meta.url).href});
  f.api=await import(moduleUrl('../lib/customer-messages.ts',{'./server':server,'./domain':domainUrl,'./reconciliation':reconciliationUrl,'./reconciliation-evidence':evidence,'./customer-message-text.js':new URL('../lib/customer-message-text.js',import.meta.url).href,'./banking/security':securityUrl,'./banking/store':store,'./gmail-adapter.js':adapter}));
  f.adapter=await import(adapter);
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(url.endsWith('/profile')){f.profileCalls++;if(f.preflight)await f.preflight();return Response.json({emailAddress:f.wrongAccount?'wrong@example.com':f.env.GMAIL_ACCOUNT});}
    if(url.endsWith('/messages/send')){f.posts++;f.raw=Buffer.from(JSON.parse(options.body).raw,'base64url').toString();if(f.timeout)throw Error('timeout');return Response.json({id:'gmail-test-'+f.posts});}
    throw Error('No live network allowed');
  });
  let state=applyCommand(emptyState(),{type:'invoice.save',invoice:{direction:'receivable',party:'Kund AB',number:'0597',ocr:'0597',total:312500,vat:62500,net:250000,issued:'2026-01-01',due:'2026-01-02',reviewed:true}}).state;
  // Due date cannot precede issue date in actual input.
  return Object.assign(f,{
    async retainOriginal(id,row){const text=`<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02"><BkToCstmrDbtCdtNtfctn><Ntfctn><Acct><Id><Othr><Id>${row.account||'MG'}</Id></Othr></Id></Acct><Ntry><Amt Ccy="SEK">${(row.amount/100).toFixed(2)}</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-26</Dt></BookgDt><AcctSvcrRef>${row.parentBankReference}</AcctSvcrRef><NtryDtls><TxDtls><Refs><TxId>${row.bankReference}</TxId></Refs><RltdPties><Dbtr><Nm>${row.party}</Nm></Dbtr></RltdPties><RmtInf><Strd><CdtrRefInf><Ref>${row.payerReference}</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls></Ntry></Ntfctn></BkToCstmrDbtCdtNtfctn></Document>`,bytes=new TextEncoder().encode(text),hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');f.objects.set(f.owner+'/'+id,bytes);sql.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run(id,f.owner,'synthetic.xml','application/xml',bytes.length,hash,'2026-10-30');return hash;},
    state:()=>JSON.parse(sql.prepare('SELECT payload FROM workspaces WHERE owner=?').get(f.owner).payload),
    put(s){const old=sql.prepare('SELECT revision FROM workspaces WHERE owner=?').get(f.owner);sql.prepare('INSERT INTO workspaces(owner,revision,payload,updated_at) VALUES(?,?,?,?) ON CONFLICT(owner) DO UPDATE SET revision=workspaces.revision+1,payload=excluded.payload,updated_at=excluded.updated_at').run(f.owner,old?old.revision+1:1,JSON.stringify(s),new Date().toISOString());},
    async call(action,body={},method='POST',requestOrigin=origin){const req=new Request(origin+'/api/customer-messages/'+action,{method,headers:{Origin:requestOrigin,'Content-Type':'application/json',...(f.cookie?{Cookie:f.cookie}:{})},body:method==='GET'?undefined:JSON.stringify(body)});const r=await f.api.messagesAction(req,action);if(r.headers.get('set-cookie'))f.cookie=r.headers.get('set-cookie').split(';')[0];return r.json();},
    async connect(scope='https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send'){sql.prepare('INSERT OR REPLACE INTO gmail_connections(owner,email,tokens) VALUES(?,?,?)').run(f.owner,f.env.GMAIL_ACCOUNT,await seal(f.key,f.owner,'gmail-tokens',{access_token:'test',refresh_token:'refresh',expires_at:Date.now()+3600000,scope}));},
    async queue(){await f.api.reconcileAndPrepare(f.owner);return (await f.api.messageList(f.owner)).items;},
    async review(m){return f.call('review',{id:m.id,version:m.version});},
    async send(m,r){return f.call('send',{id:m.id,version:m.version,review_id:r.review_id,approve:true});},
    pay(amount=250000,extra={}){let s=f.state();s=applyCommand(s,{type:'transactions.import',trustedBankImport:true,rows:[{date:'2026-10-26',amount,party:'Kund AB',payerReference:'0597',bankReference:crypto.randomUUID(),externalId:crypto.randomUUID(),kind:'unknown',source:'Enable Banking',account:'MG',...extra}]}).state;f.put(s);},
    init(){f.put(state);},
  });
}
// Use a historical real date on both sides of the invoice validation boundary.
// All records and keys in this file are synthetic.

test('D1 migration preserves existing workspace and creates isolated message tables',async t=>{
  const f=await fixture(t);f.init();const state=f.state();await f.queue();assert.deepEqual(f.state(),state);assert.ok(f.sql.prepare("SELECT name FROM sqlite_master WHERE name='customer_deliveries'").get());
});
test('partial payment leaves exactly 625 SEK and generates a cautious VAT draft',async t=>{
  const f=await fixture(t);f.init();f.pay();const items=await f.queue(),m=items.find(m=>m.status==='draft');assert.equal(m.kind,'possible_vat');assert.equal(m.facts.paid_cents,250000);assert.equal(m.facts.remaining_cents,62500);assert.match(m.body,/Kan betalningen ha avsett/);assert.equal(f.posts,0);
});
test('unknown payer with right amount remains unallocated and amount alone is never safe',async t=>{
  const f=await fixture(t);f.init();f.pay(312500,{party:'Okänd',payerReference:''});await f.queue();assert.equal(paid(f.state(),f.state().invoices[0].id),0);
});

test('late specification linking is audited but only new allocations count as verified payments',async t=>{
 const f=await fixture(t);f.init();
 const hash=await f.retainOriginal('synthetic-original',{amount:312500,party:'Kund AB',payerReference:'0597',bankReference:'LATE-CHILD',parentBankReference:'LATE-PARENT'});
 let s=f.state();s=applyCommand(s,{type:'bankgiro.import',rows:[{date:'2026-10-26',amount:312500,party:'Kund AB',payerReference:'0597',bankReference:'LATE-CHILD',parentBankReference:'LATE-PARENT',externalId:'transaction:LATE-CHILD',account:'MG',currency:'SEK',description:'Individuell specifikation',source:'synthetic.xml',kind:'payment',specification:true}],documentId:'synthetic-original',hash,name:'synthetic.xml'}).state;
 assert.equal(s.transactions[0].specificationStatus,'review');f.put(s);f.pay(312500,{kind:'batch',party:'',payerReference:'',bankReference:'LATE-PARENT',description:'Bankgiro inbetalning'});
 const result=await f.api.reconcileAndPrepare(f.owner);assert.equal(result.automatic,1);assert.equal(f.state().allocations.length,1);
 const detail=JSON.parse(f.sql.prepare("SELECT detail FROM audit_events WHERE owner=? AND action='automatic.reconciliation'").get(f.owner).detail);
 assert.equal(detail.decisions.length,2);assert.equal(detail.decisions.filter(d=>d.kind==='specification_linked').length,1);assert.equal(detail.decisions.filter(d=>d.invoice_id).length,1);
 const repeat=await f.api.reconcileAndPrepare(f.owner);assert.equal(repeat.automatic,0);assert.equal(f.state().allocations.length,1);
});

test('linking a bank specification without a matching invoice reports zero verified payments',async t=>{
 const f=await fixture(t);f.init();
 const hash=await f.retainOriginal('synthetic-original',{amount:62500,party:'Annan verifierad betalare AB',payerReference:'0604',bankReference:'UNMATCHED-CHILD',parentBankReference:'UNMATCHED-PARENT'});
 let s=f.state();s=applyCommand(s,{type:'bankgiro.import',rows:[{date:'2026-10-26',amount:62500,party:'Annan verifierad betalare AB',payerReference:'0604',bankReference:'UNMATCHED-CHILD',parentBankReference:'UNMATCHED-PARENT',account:'MG',currency:'SEK',description:'Individuell specifikation',source:'synthetic.xml',kind:'payment',specification:true}],documentId:'synthetic-original',hash,name:'synthetic.xml'}).state;
 f.put(s);f.pay(62500,{kind:'batch',party:'',payerReference:'',bankReference:'UNMATCHED-PARENT',description:'Bankgiro inbetalning'});
 const result=await f.api.reconcileAndPrepare(f.owner);assert.equal(result.automatic,0);assert.equal(f.state().allocations.length,0);assert.equal(f.state().transactions[0].specificationStatus,'linked');
 const detail=JSON.parse(f.sql.prepare("SELECT detail FROM audit_events WHERE owner=? AND action='automatic.reconciliation'").get(f.owner).detail);assert.equal(detail.decisions.length,1);assert.equal(detail.decisions[0].kind,'specification_linked');
});
test('wrong OCR belonging to another invoice is held, preserving original reference',async t=>{
  const f=await fixture(t);f.init();let s=f.state();s=applyCommand(s,{type:'invoice.save',invoice:{direction:'receivable',party:'Annan AB',number:'0577',ocr:'0577',total:312500,issued:'2026-01-01',due:'2026-10-01',reviewed:true}}).state;f.put(s);f.pay(250000,{payerReference:'0577'});const q=await f.queue();assert.ok(q.some(m=>m.kind==='wrong_reference'));assert.equal(paid(f.state(),f.state().invoices[0].id),0);assert.equal(f.state().transactions[0].original.payerReference,'0577');
});
test('correct payment, overpayment and two payments are distinguished',async t=>{
  const f=await fixture(t);f.init();f.pay(350000);let q=await f.queue();assert.equal(balance(f.state(),f.state().invoices[0]),0);assert.ok(q.some(m=>m.kind==='overpayment'));f.pay(312500);q=await f.queue();assert.ok(q.some(m=>m.kind==='possible_duplicate'));
});
test('unverified absence cannot become a demand for an unpaid debt',async t=>{
  const f=await fixture(t);f.init();const q=await f.queue();assert.equal(q[0].kind,'confirmation');assert.equal(invoiceStatus(f.state(),f.state().invoices[0]).key,'unreconciled');
});
async function verifiedDraft(f){f.init();await f.connect();const i=f.state().invoices[0];await f.call('contact',{invoice_id:i.id,email:'kund@example.com',evidence:'Testavtal',confirm:true});return (await f.queue()).find(m=>m.status==='draft');}
test('address verification, review, explicit approval and Gmail receipt persist through real D1 SQL',async t=>{
  const f=await fixture(t),m=await verifiedDraft(f),r=await f.review(m);const sent=await f.send(m,r);assert.equal(sent.status,'sent');assert.equal(f.posts,1);assert.match(f.raw,/To: kund@example.com/);const row=f.sql.prepare('SELECT * FROM customer_deliveries').get();assert.equal(row.gmail_message_id,'gmail-test-1');assert.ok(row.sent_at);assert.equal(f.sql.prepare('SELECT consumed FROM customer_reviews').get().consumed,1);
});
test('no approval, forged review, wrong browser and expired review cannot send',async t=>{
  const f=await fixture(t),m=await verifiedDraft(f),r=await f.review(m);
  await assert.rejects(f.call('send',{id:m.id,version:m.version,review_id:r.review_id}),/godkännande/);
  await assert.rejects(f.send(m,{review_id:'forged'}),/Godkännandet/);
  const cookie=f.cookie;f.cookie='mg_message_review='+randomToken();await assert.rejects(f.send(m,r),/Godkännandet/);f.cookie=cookie;
  f.sql.prepare("UPDATE customer_reviews SET expires_at='2000-01-01'").run();await assert.rejects(f.send(m,r),/Godkännandet/);assert.equal(f.posts,0);
});
test('edited draft requires a fresh current-version review',async t=>{
  const f=await fixture(t),m=await verifiedDraft(f),r=await f.review(m);await f.call('edit',{id:m.id,version:m.version,subject:'Nytt ämne',body:'Kontrollerad svensk text'});await assert.rejects(f.send(m,r),/ändrats/);const updated=(await f.queue()).find(x=>x.status==='draft');await assert.rejects(f.send(updated,r),/Godkännandet/);const fresh=await f.review(updated);await f.send(updated,fresh);assert.equal(f.posts,1);
});
test('payment after drafting prevents an old review from being sent',async t=>{
  const f=await fixture(t),m=await verifiedDraft(f),r=await f.review(m);f.pay();await assert.rejects(f.send(m,r),/ändrats/);assert.equal(f.posts,0);assert.equal((await f.queue()).find(x=>x.id===m.id).status,'stale');
});
test('double click and two reviews reserve exactly one Gmail send',async t=>{
  const f=await fixture(t),m=await verifiedDraft(f),r=await f.review(m),other=await f.review(m);const outcomes=await Promise.allSettled([f.send(m,r),f.send(m,other)]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.posts,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM customer_deliveries').get().n,1);
});
test('Gmail timeout locks unknown delivery and never generates or sends it again',async t=>{
  const f=await fixture(t),m=await verifiedDraft(f),r=await f.review(m);f.timeout=true;await assert.rejects(f.send(m,r),/oklar/);await assert.rejects(f.send(m,r),/ändrats/);assert.equal(f.posts,1);f.pay();await f.queue();assert.equal(f.sql.prepare('SELECT status FROM customer_deliveries').get().status,'unknown');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM customer_messages WHERE kind=?').get(m.kind).n,1);
});
test('a workspace change at the atomic reservation boundary stops send',async t=>{
  const f=await fixture(t),m=await verifiedDraft(f),r=await f.review(m);f.d1.beforeBatch=async rows=>{if(rows[0].query.includes('INSERT OR IGNORE INTO customer_deliveries')){f.d1.beforeBatch=null;f.sql.prepare('UPDATE workspaces SET revision=revision+1').run();}};await assert.rejects(f.send(m,r),/Godkännandet/);assert.equal(f.posts,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM customer_deliveries').get().n,0);
});
test('missing send scope and wrong Gmail account stop before consuming approval',async t=>{
  const f=await fixture(t),m=await verifiedDraft(f),r=await f.review(m);await f.connect('https://www.googleapis.com/auth/gmail.readonly');await assert.rejects(f.send(m,r),/gmail.send/);await f.connect();f.wrongAccount=true;await assert.rejects(f.send(m,r),/företagets Gmail/);assert.equal(f.posts,0);assert.equal(f.sql.prepare('SELECT consumed FROM customer_reviews').get().consumed,0);
});
test('owner isolation, CSRF and GET requests cannot approve or mutate messages',async t=>{
  const f=await fixture(t),m=await verifiedDraft(f);f.user={userId:'owner-bob'};assert.deepEqual((await f.api.messageList('owner-bob')).items,[]);await assert.rejects(f.review(m),/saknas/);f.user={userId:f.owner};await assert.rejects(f.call('review',{id:m.id,version:m.version},'POST','https://attacker.example'),/ORIGIN_DENIED/);const response=await f.api.messagesAction(new Request(origin+'/api/customer-messages/reconcile'),'reconcile');assert.equal(response.status,405);assert.equal(f.posts,0);
});
test('reject is persistent and reconciliation never sends messages',async t=>{
  const f=await fixture(t),m=await verifiedDraft(f);await f.call('reject',{id:m.id,version:m.version});await f.queue();await f.queue();assert.equal((await f.api.messageList(f.owner)).items[0].status,'rejected');assert.equal(f.posts,0);
});
test('a complete Bankgiro specification replaces its parent without double counting',async t=>{
  // Model an internally reparsed synthetic bank original, not an arbitrary browser document ID.
  const f=await fixture(t);f.init();const hash=await f.retainOriginal('synthetic-bank-file',{amount:312500,party:'Kund AB',payerReference:'0597',bankReference:'CHILD',parentBankReference:'PARENT',account:'Swedbank'});let s=f.state();s=applyCommand(s,{type:'transactions.import',documentId:'synthetic-bank-file',trustedBankFileImport:true,hash,rows:[{key:'parent',date:'2026-10-26',amount:312500,kind:'batch',bankReference:'PARENT',source:'bank.xml'}, {parentKey:'parent',date:'2026-10-26',amount:312500,kind:'payment',verified:true,party:'Kund AB',payerReference:'0597',bankReference:'CHILD',externalId:'child',source:'bank.xml'}]}).state;
  s=applyCommand(s,{type:'transaction.verify',id:s.transactions.find(t=>t.parentId).id,note:'Syntetiskt bankoriginal: konto, datum, riktning och kund kontrollerade'}).state;f.put(s);await f.queue();assert.equal(paid(f.state(),f.state().invoices[0].id),312500);assert.equal(f.state().allocations.length,1);assert.equal(f.state().transactions[0].kind,'batch');
});
test('API and bank file representations remain one economic payment',async t=>{
  const f=await fixture(t);f.init();f.pay(312500);await f.queue();let s=f.state();s=applyCommand(s,{type:'transactions.import',documentId:'synthetic-copy',rows:[{date:'2026-10-26',amount:312500,kind:'payment',verified:true,party:'Kund AB',payerReference:'0597',bankReference:'FILE',source:'bank.xml',account:'File alias'}]}).state;f.put(s);await f.queue();assert.equal(paid(f.state(),f.state().invoices[0].id),312500);assert.ok(f.state().transactions[1].duplicateOf);assert.equal(f.state().allocations.length,1);
});
test('one transfer for several invoices stays a manual split proposal',async t=>{
  const f=await fixture(t);f.init();let s=f.state();s=applyCommand(s,{type:'invoice.save',invoice:{direction:'receivable',party:'Kund AB',number:'0598',ocr:'0598',total:50000,issued:'2026-01-01',due:'2026-10-01',reviewed:true}}).state;f.put(s);f.pay(362500,{payerReference:'0597 0598'});await f.queue();assert.equal(f.state().allocations.length,0);assert.equal(reconciliation.analyze(f.state()).filter(f=>f.kind==='multiple_invoices').length,2);
});
test('a manually verified private payer can be reused for the same customer and account',async t=>{
  const f=await fixture(t);f.init();f.pay(312500,{party:'Anna Andersson'});let s=f.state();s=applyCommand(s,{type:'match.create',invoiceId:s.invoices[0].id,transactionId:s.transactions[0].id,amount:312500,note:'Kunden bekräftade betalaren'}).state;s=applyCommand(s,{type:'invoice.save',invoice:{direction:'receivable',party:'Kund AB',number:'0598',ocr:'0598',total:50000,issued:'2026-01-01',due:'2026-10-01',reviewed:true}}).state;f.put(s);f.pay(50000,{party:'Anna Andersson',payerReference:'0598'});await f.queue();assert.equal(paid(f.state(),f.state().invoices[1].id),50000);
});
test('missing OCR remains manual after bank evidence has been verified',async t=>{
  const f=await fixture(t);f.init();f.pay(312500,{payerReference:''});let s=f.state();s=applyCommand(s,{type:'transaction.verify',id:s.transactions[0].id,note:'Betalare och bokföring kontrollerade'}).state;f.put(s);await f.queue();assert.equal(f.state().allocations.length,0);assert.equal(reconciliation.analyze(f.state())[0].kind,'missing_reference');
});
test('verified absence can be recorded and new bank data invalidates it',async t=>{
  const f=await fixture(t);f.init();await f.call('absence',{invoice_id:f.state().invoices[0].id,note:'Bankkonto och specifikationer kontrollerade för hela perioden',confirm:true});assert.ok((await f.queue()).some(m=>m.kind==='overdue'&&m.status==='draft'));f.pay(10000,{party:'Annan',payerReference:''});assert.equal(invoiceStatus(f.state(),f.state().invoices[0]).key,'unreconciled');
});
function absenceConflict(state,compact){
 if(compact){const copy=structuredClone(state);copy.bankEvidenceHold={at:new Date().toISOString(),auditEventId:'synthetic-conflict-audit',fingerprint:'a'.repeat(64)};return copy;}
 return applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[{...state.transactions[0],party:'Contradictory synthetic sender',payerReference:'OTHER-CONFLICT'}]}).state;
}
for(const compact of [false,true])test(`Q8 absence: ${compact?'compact hold':'retained conflict'} permits only cautious confirmation drafts and blocks a new absence assertion`,async t=>{
 const f=await fixture(t);f.init();f.pay(10000,{party:'Unrelated synthetic sender',payerReference:'OTHER-REF'});
 const id=f.state().invoices[0].id;await f.call('absence',{invoice_id:id,note:'Synthetic account and full period checked.',confirm:true});
 const before=f.state(),old=(await f.queue()).find(m=>m.kind==='overdue'&&m.status==='draft');assert.ok(old);
 f.put(absenceConflict(before,compact));const held=f.state(),items=await f.queue();
 assert.equal(items.find(m=>m.id===old.id).status,'stale');assert.equal(items.some(m=>m.kind==='overdue'&&m.status==='draft'),false);
 const cautious=items.find(m=>m.kind==='confirmation'&&m.status==='draft');assert.ok(cautious);assert.doesNotMatch(cautious.body,/Våra betalningsunderlag har kontrollerats/);
 assert.deepEqual(f.state().invoices,held.invoices);assert.deepEqual(f.state().allocations,held.allocations);
 const revision=f.sql.prepare('SELECT revision FROM workspaces WHERE owner=?').get(f.owner).revision;
 await assert.rejects(f.call('absence',{invoice_id:id,note:'A free-text note cannot resolve conflicting originals.',confirm:true}),/motstridiga/);
 assert.equal(f.sql.prepare('SELECT revision FROM workspaces WHERE owner=?').get(f.owner).revision,revision);assert.deepEqual(f.state(),held);assert.equal(f.posts,0);
});
for(const compact of [false,true])test(`Q8 absence: a legacy overdue draft with the current ${compact?'compact hold':'conflict'} snapshot is stale and cannot be approved`,async t=>{
 const f=await fixture(t);f.init();await f.connect();f.pay(10000,{party:'Unrelated synthetic sender',payerReference:'OTHER-REF'});
 const id=f.state().invoices[0].id;await f.call('contact',{invoice_id:id,email:'synthetic@example.test',evidence:'Synthetic contact agreement.',confirm:true});await f.call('absence',{invoice_id:id,note:'Synthetic account and full period checked.',confirm:true});
 const m=(await f.queue()).find(m=>m.kind==='overdue'&&m.status==='draft'),review=await f.review(m);
 f.put(absenceConflict(f.state(),compact));const contact=f.sql.prepare('SELECT * FROM customer_contacts WHERE owner=? AND invoice_id=?').get(f.owner,id),snapshot=await f.api.evidenceSnapshot(f.state(),contact);
 // A draft produced by the previous timestamp-only policy can have the current
 // evidence hash. Content eligibility must be checked independently of that hash.
 f.sql.prepare('UPDATE customer_messages SET snapshot=? WHERE id=?').run(snapshot,m.id);f.sql.prepare('UPDATE customer_reviews SET snapshot=? WHERE id=?').run(snapshot,review.review_id);
 const prior=f.sql.prepare('SELECT * FROM customer_messages WHERE id=?').get(m.id),listed=(await f.api.messageList(f.owner)).items.find(item=>item.id===m.id);
 const reviewAttempt=await f.review(m).then(()=>null,error=>error),sendAttempt=await f.send(m,review).then(()=>null,error=>error);
 assert.equal(listed.status,'stale');assert.ok(reviewAttempt instanceof Error);assert.ok(sendAttempt instanceof Error);assert.equal(f.posts,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM customer_deliveries').get().n,0);assert.equal(f.sql.prepare('SELECT consumed FROM customer_reviews WHERE id=?').get(review.review_id).consumed,0);
 assert.deepEqual(f.sql.prepare('SELECT * FROM customer_messages WHERE id=?').get(m.id),prior);
 await f.queue();assert.equal(f.sql.prepare('SELECT status FROM customer_messages WHERE id=?').get(m.id).status,'stale');
 const after=f.sql.prepare('SELECT subject,body,snapshot FROM customer_messages WHERE id=?').get(m.id);assert.deepEqual({...after},{subject:prior.subject,body:prior.body,snapshot:prior.snapshot});
});
async function conflictOnAllocatedPayment(state,compact){
 const before=structuredClone(state);
 if(compact){
  for(let n=0;n<600;n++)before.invoices.push({...before.invoices[0],id:uid(),number:'SYN-FILL-'+n,ocr:'',party:'Synthetic filler '+n,total:1,net:null,vat:null,voided:true,reconciledAt:'',reconciliationNote:'',note:''});
  let left=1799000-Buffer.byteLength(JSON.stringify(before));for(const item of before.invoices.slice(-600)){const count=Math.min(3000,left);item.note='x'.repeat(count);left-=count;if(!left)break;}assert.equal(left,0);
 }
 const row=before.transactions[0],attempted=applyCommand(before,{type:'transactions.import',trustedBankImport:true,rows:[{...row,amount:row.amount+10000,party:'Contradictory synthetic customer',payerReference:'OTHER-REF',description:'d'.repeat(1000)}]}).state;
 const failure=await prepareBankImportFailure(before,attempted,uid());assert.equal(failure.compact,compact);assert.deepEqual(failure.state.allocations,before.allocations);return failure.state;
}
for(const compact of [false,true])test(`Q8 payment proof: ${compact?'compact hold':'retained conflict'} replaces fresh payment assertions with neutral confirmation`,async t=>{
 for(const [amount,kind]of [[250000,'possible_vat'],[240000,'partial'],[350000,'overpayment']]){
  const f=await fixture(t);f.init();f.pay(amount,{bankReference:'SYN-ALLOCATED',externalId:'SYN-ALLOCATED'});const prior=(await f.queue()).find(m=>m.kind===kind&&m.status==='draft');assert.ok(prior);
  const before=f.state(),held=await conflictOnAllocatedPayment(before,compact);f.put(held);const items=await f.queue();
  assert.equal(items.some(m=>['partial','possible_vat','overpayment'].includes(m.kind)&&m.status==='draft'),false);
  const cautious=items.find(m=>m.kind==='confirmation'&&m.status==='draft');assert.ok(cautious);assert.match(cautious.facts.payment_evidence_issue,/motstridiga/);assert.doesNotMatch(cautious.body,/verifierat betalningar|verifierad betalning|Skillnaden motsvarar/);
  assert.equal(cautious.facts.paid_cents,paid(before,before.invoices[0].id));assert.equal(cautious.facts.remaining_cents,balance(before,before.invoices[0]));assert.deepEqual(f.state().allocations,before.allocations);assert.deepEqual(f.state().invoices[0],before.invoices[0]);assert.equal(f.posts,0);
 }
});
for(const compact of [false,true])test(`Q8 payment proof: current-snapshot payment drafts cannot be reviewed or sent under ${compact?'compact hold':'retained conflict'}`,async t=>{
 for(const [amount,kind]of [[250000,'possible_vat'],[240000,'partial'],[350000,'overpayment']]){
  const f=await fixture(t);f.init();await f.connect();f.pay(amount,{bankReference:'SYN-ALLOCATED',externalId:'SYN-ALLOCATED'});await f.queue();const id=f.state().invoices[0].id;
  await f.call('contact',{invoice_id:id,email:'synthetic@example.test',evidence:'Synthetic contact agreement.',confirm:true});const m=(await f.queue()).find(m=>m.kind===kind&&m.status==='draft'),review=await f.review(m);
  f.put(await conflictOnAllocatedPayment(f.state(),compact));const contact=f.sql.prepare('SELECT * FROM customer_contacts WHERE owner=? AND invoice_id=?').get(f.owner,id),snapshot=await f.api.evidenceSnapshot(f.state(),contact);
  f.sql.prepare('UPDATE customer_messages SET snapshot=? WHERE id=?').run(snapshot,m.id);f.sql.prepare('UPDATE customer_reviews SET snapshot=? WHERE id=?').run(snapshot,review.review_id);
  const prior=f.sql.prepare('SELECT * FROM customer_messages WHERE id=?').get(m.id),listed=(await f.api.messageList(f.owner)).items.find(item=>item.id===m.id);
  const reviewAttempt=await f.review(m).then(()=>null,error=>error),sendAttempt=await f.send(m,review).then(()=>null,error=>error);
  assert.equal(listed.status,'stale');assert.ok(reviewAttempt instanceof Error);assert.ok(sendAttempt instanceof Error);assert.equal(f.posts,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM customer_deliveries').get().n,0);assert.equal(f.sql.prepare('SELECT consumed FROM customer_reviews WHERE id=?').get(review.review_id).consumed,0);assert.deepEqual(f.sql.prepare('SELECT * FROM customer_messages WHERE id=?').get(m.id),prior);
  await f.queue();assert.equal(f.sql.prepare('SELECT status FROM customer_messages WHERE id=?').get(m.id).status,'stale');
 }
});
test('Q8 payment proof: an unrelated row conflict preserves a valid payment claim while absence stays blocked',async t=>{
 const f=await fixture(t);f.init();f.pay(250000,{bankReference:'SYN-VALID',externalId:'SYN-VALID'});await f.queue();f.pay(10000,{party:'Unrelated synthetic sender',payerReference:'OTHER-REF',bankReference:'SYN-OTHER',externalId:'SYN-OTHER'});
 let state=f.state();const other=state.transactions.find(row=>row.externalId==='SYN-OTHER');state=applyCommand(state,{type:'transactions.import',trustedBankImport:true,rows:[{...other,party:'Contradictory unrelated sender'}]}).state;f.put(state);
 const m=(await f.queue()).find(item=>item.kind==='possible_vat'&&item.status==='draft');assert.ok(m);assert.equal(m.facts.payment_evidence_issue,'');assert.equal(m.facts.paid_cents,250000);assert.equal(m.facts.remaining_cents,62500);assert.match(m.body,/Vi har verifierat betalningar/);assert.ok((await f.review(m)).review_id);
 await assert.rejects(f.call('absence',{invoice_id:state.invoices[0].id,note:'An unrelated bank contradiction still prevents an account-wide absence conclusion.',confirm:true}),/motstridiga/);assert.equal(f.posts,0);
});
test('disconnect during provider preflight stops send and never restores old connection',async t=>{
  const f=await fixture(t),m=await verifiedDraft(f),r=await f.review(m);f.preflight=async()=>{f.sql.prepare('DELETE FROM gmail_connections').run();};await assert.rejects(f.send(m,r),/anslutningen ändrades/);assert.equal(f.posts,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM gmail_connections').get().n,0);
});
test('recipient verification changes at reservation cannot use an old approval',async t=>{
  const f=await fixture(t),m=await verifiedDraft(f),r=await f.review(m);f.d1.beforeBatch=async rows=>{if(rows[0].query.includes('INSERT OR IGNORE INTO customer_deliveries')){f.d1.beforeBatch=null;f.sql.prepare("UPDATE customer_contacts SET email='new@example.com',version=version+1").run();}};await assert.rejects(f.send(m,r),/Godkännandet/);assert.equal(f.posts,0);
});
test('upgrading OAuth requires explicit send choice and preserves readonly import scope',async t=>{
  const f=await fixture(t),state='s'.repeat(43);const url=new URL(f.adapter.gmailAuthorizationUrl(state,origin,{send:true}));assert.equal(url.searchParams.get('scope'),'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send');assert.equal(new URL(f.adapter.gmailAuthorizationUrl(state,origin)).searchParams.get('scope'),'https://www.googleapis.com/auth/gmail.readonly');
});

test('missing reference prepares an explicit request without claiming a verified payment',async t=>{
  const f=await fixture(t);f.init();f.pay(312500,{payerReference:''});
  const q=await f.queue(),m=q.find(m=>m.kind==='missing_reference');
  assert.ok(m);assert.match(m.body,/saknar fakturareferens/);assert.doesNotMatch(m.body,/undefined/);
  assert.equal(paid(f.state(),f.state().invoices[0].id),0);assert.equal(f.posts,0);
});

test('legacy conflicting VAT values do not cause a VAT assertion in drafts',async t=>{
  const f=await fixture(t);f.init();let s=f.state();s.invoices[0].vat=62500;s.invoices[0].net=250000;s.invoices[0].total=400000;s.credits.push({id:'legacy-credit',invoiceId:s.invoices[0].id,amount:87500,number:'C1',note:'synthetic',date:'2026-10-01',active:true});f.put(s);f.pay(250000);
  const q=await f.queue();assert.equal(q.some(m=>m.kind==='possible_vat'),false);assert.equal(f.posts,0);
});
