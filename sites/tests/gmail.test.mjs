import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {DatabaseSync} from 'node:sqlite';import ts from 'typescript';
import * as domain from '../lib/domain.ts';
import {seal,unseal,randomToken} from '../lib/banking/security.ts';
const source=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
function moduleUrl(path,imports){let code=ts.transpileModule(source(path),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;for(const [from,to]of Object.entries(imports))for(const q of ['"',"'"])code=code.replaceAll(q+from+q,JSON.stringify(to));return data(code);}
class D1{
  constructor(sql){this.sql=sql;}
  prepare(query){const sql=this.sql;return{args:[],bind(...args){this.args=args;return this;},async first(){return sql.prepare(query).get(...this.args)||null;},async all(){return{results:sql.prepare(query).all(...this.args)};},async run(){return this.execute();},execute(){const r=sql.prepare(query).run(...this.args);return{meta:{changes:Number(r.changes)}};}};}
  async batch(items){this.sql.exec('BEGIN');try{const results=items.map(x=>x.execute());this.sql.exec('COMMIT');return results;}catch(e){this.sql.exec('ROLLBACK');throw e;}}
}
async function fixture(t){
  const key='__gmail_'+crypto.randomUUID().replaceAll('-',''),sql=new DatabaseSync(':memory:');sql.exec(source('../drizzle/0000_confused_umar.sql'));sql.exec(source('../drizzle/0001_sudden_whirlwind.sql'));sql.exec(source('../drizzle/0002_brief_chronomancer.sql'));sql.exec(source('../drizzle/0003_needy_gravity.sql'));for(const file of (await import('node:fs')).readdirSync(new URL('../drizzle',import.meta.url)).filter(f=>/^000[4-9].*sql$/.test(f)))sql.exec(source('../drizzle/'+file));
  const f={sql,d1:new D1(sql),owner:'test-owner',key:randomToken(),wrongAccount:false,providerCalls:0,env:{GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret'}};f.user={userId:f.owner,email:"owner@example.test"};
  f.env.BUCKET={put:async()=>{},get:async()=>null,delete:async()=>{}};globalThis[key]=f;
  const reference=`globalThis[${JSON.stringify(key)}]`,cf=data(`export const env=${reference}.env;`);
  const domainUrl=new URL('../lib/domain.ts',import.meta.url).href,securityUrl=new URL('../lib/banking/security.ts',import.meta.url).href;
  const server=data(`import {emptyState} from ${JSON.stringify(domainUrl)};const f=${reference};export const db=()=>f.d1;export const response=(body,status=200)=>Response.json(body,{status});export async function identity(req){if(!f.user)throw Error('AUTH_REQUIRED');if(req&&req.method!=='GET'&&req.headers.get('origin')!==new URL(req.url).origin)throw Error('ORIGIN_DENIED');return f.user;}export async function readWorkspace(owner){const r=await f.d1.prepare('SELECT revision,payload FROM workspaces WHERE owner=?').bind(owner).first();return r?{revision:r.revision,state:JSON.parse(r.payload)}:{revision:0,state:emptyState()};}`);
  const store=data(`import {seal,unseal} from ${JSON.stringify(securityUrl)};const f=${reference};export const storageReady=()=>true;export const encrypt=(owner,purpose,value)=>seal(f.key,owner,purpose,value);export const decrypt=(owner,purpose,value)=>unseal(f.key,owner,purpose,value);`);
  const adapter=moduleUrl('../lib/gmail-adapter.js',{'cloudflare:workers':cf}),fields=moduleUrl('../lib/invoice-fields.js',{'./domain':domainUrl});
  const pdf=data(`export async function serverPdfText(){const f=${reference};if(f.pdfError)throw Error(f.pdfError);return f.pdfResult||{text:'',method:'pdf',confidence:100};}`);
  const processing=moduleUrl('../lib/document-processing.ts',{'cloudflare:workers':cf,'./server':server,'./domain':domainUrl,'./banking/security':securityUrl,'./invoice-fields.js':fields,'./server-pdf':pdf,'./customer-messages':data('export async function reconcileAndPrepare(){}')});
  f.processing=await import(processing);f.fields=await import(fields);
  f.api=await import(moduleUrl('../lib/gmail-service.ts',{'cloudflare:workers':cf,'./server':server,'./domain':domainUrl,'./banking/store':store,'./banking/security':securityUrl,'./gmail-adapter.js':adapter,'./invoice-fields.js':fields,'./document-processing':processing,'./customer-messages':data('export async function reconcileAndPrepare(){}')}));
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    assert.equal(options.redirect,'manual','Workers-compatible fetch must never forward credentials through redirects');
    f.providerCalls++;const path=new URL(url).pathname;
    if(f.redirectProvider)return new Response('private provider body',{status:302,headers:{Location:'https://untrusted.example/collect'}});
    if(path==='/token')return f.tokenError?Response.json(f.tokenError,{status:400}):Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,scope:'https://www.googleapis.com/auth/gmail.readonly'});
    if(path==='/revoke')return new Response('');
    if(path.endsWith('/profile'))return Response.json({emailAddress:f.wrongAccount?'wrong@gmail.com':'mg.vitvaror@gmail.com'});
    if(path.endsWith('/messages'))return Response.json({messages:[{id:'archived'}]});
    if(path.includes('/attachments/')){f.attachmentCalls=(f.attachmentCalls||0)+1;return Response.json({data:Buffer.from('%PDF-test-original').toString('base64url')});}
    return Response.json({labelIds:[],internalDate:String(Date.now()),payload:{headers:[{name:'Subject',value:f.subject||'Dokument'},{name:'From',value:'Supplier <supplier@example.com>'},{name:'To',value:'mg.vitvaror@gmail.com'}],parts:[{partId:'1',filename:f.filename||'document.pdf',mimeType:f.mime||'application/pdf',body:{attachmentId:'attachment-1'}}]}});
  });
  t.after(()=>{delete globalThis[key];sql.close();});return f;
}
const origin='https://invoice.example';
const post=(action,body={})=>new Request(origin+'/api/gmail/'+action,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
async function connect(f){const r=await f.api.gmailConnect(post('connect')),cookie=r.headers.get('set-cookie').split(';')[0],body=await r.json(),state=new URL(body.url).searchParams.get('state');return{cookie,state,callback:()=>new Request(origin+'/api/gmail/callback?state='+state+'&code=synthetic-code',{headers:{Cookie:cookie}})};}

test('OAuth diagnostics identify the failed stage without reflecting codes, cookies or provider secrets',async t=>{
  const f=await fixture(t),flow=await connect(f),logs=[];
  t.mock.method(console,'warn',(...args)=>logs.push(args));
  try{await f.api.gmailCallback(new Request(origin+'/api/gmail/callback?state='+flow.state+'&code=synthetic-private-code'));assert.fail('Missing cookie accepted');}
  catch(error){const result=await f.api.gmailFailure(error).json();assert.match(result.error,/samma webbläsare/);}
  assert.equal(f.providerCalls,0);
  f.tokenError={error:'invalid_client',error_description:'synthetic-private-provider-secret'};
  try{await f.api.gmailCallback(flow.callback());assert.fail('Invalid client accepted');}
  catch(error){const result=await f.api.gmailFailure(error).json();assert.match(result.error,/klient-id och klienthemlighet/);assert.ok(!JSON.stringify(result).includes('synthetic-private'));}
  assert.deepEqual(logs.map(args=>JSON.parse(args[1])),[{stage:'validate_return',code:'oauth_return_invalid'},{stage:'exchange_code',code:'invalid_client'}]);
  assert.ok(!JSON.stringify(logs).includes(flow.cookie));assert.ok(!JSON.stringify(logs).includes(flow.state));assert.ok(!JSON.stringify(logs).includes('synthetic-private'));
});

test('Google redirects are rejected before parsing or following a credential-bearing request',async t=>{
  const f=await fixture(t),flow=await connect(f);f.redirectProvider=true;
  await assert.rejects(f.api.gmailCallback(flow.callback()),error=>error.code==='unexpected_redirect'&&error.gmailStage==='exchange_code');
  assert.equal(f.providerCalls,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM gmail_connections').get().n,0);
});

test('Sites OAuth binds browser and user, rejects replay and wrong account, and encrypts tokens',async t=>{
  const f=await fixture(t),flow=await connect(f);assert.match(flow.cookie,/mg_gmail_flow=/);
  await assert.rejects(f.api.gmailCallback(new Request(origin+'/api/gmail/callback?state='+flow.state+'&code=code')),/retur/);
  assert.equal((await f.api.gmailCallback(flow.callback())).status,302);
  await assert.rejects(f.api.gmailCallback(flow.callback()),/retur/);
  const c=f.sql.prepare('SELECT * FROM gmail_connections').get();assert.ok(!c.tokens.includes('synthetic-refresh'));assert.equal((await unseal(f.key,f.owner,'gmail-tokens',c.tokens)).refresh_token,'synthetic-refresh');
  const other=await connect(f);f.wrongAccount=true;await assert.rejects(f.api.gmailCallback(other.callback()),e=>e.code==='account_mismatch');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM gmail_connections').get().n,1);
});
test('Sites Gmail originals are idempotent, scoped to owner and do not create debts before review',async t=>{
  const f=await fixture(t),flow=await connect(f);await f.api.gmailCallback(flow.callback());
  assert.equal((await (await f.api.gmailSync(post('sync'))).json()).imported,1);
  assert.equal((await (await f.api.gmailSync(post('sync'))).json()).duplicates,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM documents').get().n,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);
  const status=await (await f.api.gmailStatus()).json(),id=status.candidates[0].document_id;
  f.user={userId:'other-owner'};assert.equal((await (await f.api.gmailStatus()).json()).candidates.length,0);await assert.rejects(f.api.gmailReview(post('review',{document_id:id,confirm:true,invoice:{}})),/source/);
  f.user={userId:f.owner,email:"owner@example.test"};const invoice={direction:'payable',party:'Synthetic supplier AB',number:'0606',total:375000,issued:'2026-10-24',due:'2026-11-07',kind:'invoice'},fields={currency:'SEK',vat_cents:'750.00',net_cents:'3000.00'};
  await f.api.gmailReview(post('review',{document_id:id,extraction:{fields:{party:{value:'Original supplier'}}}}));
  assert.equal((await f.api.gmailReview(post('review',{document_id:id,confirm:true,invoice,fields}))).status,200);
  const saved=JSON.parse(f.sql.prepare('SELECT payload FROM workspaces').get().payload);assert.equal(saved.invoices.length,1);assert.equal(saved.allocations.length,0);
  await f.api.gmailReview(post('review',{document_id:id,confirm:true,invoice,fields}));assert.equal(JSON.parse(f.sql.prepare('SELECT payload FROM workspaces').get().payload).invoices.length,1);
  assert.equal(JSON.parse(f.sql.prepare('SELECT detail FROM audit_events').get().detail).extraction.fields.party.value,'Original supplier');
  f.user=null;await assert.rejects(f.api.gmailStatus(),/AUTH_REQUIRED/);
});
test('Sites rejects foreign currency and conflicting VAT before creating an invoice; scheduled sync respects cooldown',async t=>{
  const f=await fixture(t),flow=await connect(f);await f.api.gmailCallback(flow.callback());await f.api.gmailSync(post('sync'));
  assert.equal((await (await f.api.gmailSync(undefined,true)).json()).status,'not_due');
  const id=f.sql.prepare('SELECT id FROM documents').get().id;
  const invoice={direction:'payable',party:'Synthetic',number:'1',total:10000,issued:'2026-10-24',due:'2026-11-07'};
  await assert.rejects(f.api.gmailReview(post('review',{document_id:id,confirm:true,invoice,fields:{currency:'EUR'}})),/SEK/);
  await assert.rejects(f.api.gmailReview(post('review',{document_id:id,confirm:true,invoice,fields:{currency:'SEK',vat_cents:'50.00',net_cents:'90.00'}})),/Momsberäkningen/);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);
});

test('explicit payroll and branding are skipped before download while ambiguous scans remain candidates',async t=>{
  const f=await fixture(t),flow=await connect(f);await f.api.gmailCallback(flow.callback());
  f.subject='Lön oktober';assert.equal((await (await f.api.gmailSync(post('sync'))).json()).imported,0);assert.equal(f.attachmentCalls||0,0);
  f.subject='Faktura';f.filename='main-logo.png';f.mime='image/png';assert.equal((await (await f.api.gmailSync(post('sync'))).json()).imported,0);assert.equal(f.attachmentCalls||0,0);
  f.filename='image.png';await f.api.gmailSync(post('sync'));assert.equal(f.attachmentCalls,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);
  assert.ok((await (await f.api.gmailStatus()).json()).last_successful_fetch);
});

const syntheticText=(number='0007')=>`Faktura\nFakturanummer: ${number}\nLeverantör: Exempelbolaget AB\nOrg.nr: 556016-0680\nFakturadatum: 24/10/2026\nFörfallodag: 07/11/2026\nBelopp före moms: 2 500,00 SEK\nTotal moms: 625,00 SEK\nSumma att betala: 3 125,00 SEK\nBankgiro: 123-4567`;
async function processingFixture(t){
  const f=await fixture(t);Object.assign(f.env,{DOCUMENT_AUTOMATION_ENABLED:'true',DOCUMENT_OWNER_EMAIL:f.user.email,DOCUMENT_WORKER_TOKEN:randomToken()});
  f.bytes=Buffer.from('synthetic-document-bytes');f.sha=Buffer.from(await crypto.subtle.digest('SHA-256',f.bytes)).toString('hex');
  f.env.BUCKET.get=async()=>({size:f.bytes.length,arrayBuffer:async()=>f.bytes});
  f.pdfResult={text:syntheticText(),method:'pdf',confidence:100};await f.processing.processingSettings(f.user);
  f.doc=(id='doc-1',mime='application/pdf',meta={direction:'supplier',direction_confident:true,from:'supplier@example.test',to:'company@example.test',subject:'Synthetic invoice'})=>{f.sql.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run(id,f.owner,'synthetic',mime,f.bytes.length,f.sha,new Date().toISOString());f.sql.prepare('INSERT INTO gmail_sources(owner,source_id,document_id,metadata,created_at) VALUES(?,?,?,?,?)').run(f.owner,id,id,JSON.stringify(meta),new Date().toISOString());return id;};
  f.worker=(action,body={},token=f.env.DOCUMENT_WORKER_TOKEN)=>f.processing.workerAction(new Request(origin+'/api/ocr-worker/'+action,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)}),action);
  return f;
}
test('layout parsing keeps spaced leading zeroes, recipient identity, Swedish dates and explicit VAT',async t=>{
  const f=await fixture(t),text=syntheticText('0 0 0 7').replace('Leverantör: Exempelbolaget AB\nOrg.nr: 556016-0680\n','').concat('\nMottagare\nFöretags Namn: Exempelkunden AB\nOrg.nr: 556016-0680\n');
  const r=f.fields.interpretInvoice(text,{direction:'customer',direction_confident:true});
  assert.equal(r.fields.invoice_number.value,'0007');assert.equal(r.fields.party.value,'Exempelkunden AB');assert.equal(r.fields.due_at.value,'2026-11-07');assert.equal(r.fields.vat_cents.value,62500);assert.equal(r.fields.net_cents.value,250000);assert.equal(r.level,'green');assert.ok(r.text_excerpt.includes('0 0 0 7'));
  const bad=f.fields.interpretInvoice(text+'\n1 st 1 500,00 kr 25 % 250,00 kr 1 250,00 kr',{direction:'customer',direction_confident:true});assert.equal(bad.level,'red');assert.match(bad.issues.join(' '),/Radpris/);
});
test('durable cloud queue processes once, preserves original extraction and holds an unknown counterparty',async t=>{
  const f=await processingFixture(t);f.doc();await f.processing.processDocuments(f.owner);
  const job=f.sql.prepare('SELECT * FROM document_jobs').get();assert.equal(job.state,'needs_review');assert.equal(JSON.parse(job.extraction).fields.invoice_number.value,'0007');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);
  await f.processing.processDocuments(f.owner);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,1);
  assert.equal(JSON.parse(f.sql.prepare('SELECT extraction FROM gmail_sources').get().extraction).version,2);
});

test('European supplier totals and invoice dates keep grouping without inventing VAT or due dates',async t=>{
  const f=await fixture(t);
  const r=f.fields.interpretInvoice('Faktura\nFakturanummer: 000012\nFaktureringsdatum: 27.10.2026\nVarornas nettovärde 1.400,00 SEK\nLeveranskostnad netto 99,00 SEK\nTotalt netto 1.499,00 SEK\nTotalsumma 1.499,00 SEK\nSkattefri gemenskapsintern leverans',{direction:'supplier',direction_confident:true});
  assert.equal(r.fields.issued_at.value,'2026-10-27');assert.equal(r.fields.total_cents.value,149900);assert.equal(r.fields.net_cents.value,149900);assert.equal(r.fields.vat_cents.value,null);assert.equal(r.fields.due_at.value,null);assert.equal(r.level,'yellow');assert.ok(!r.issues.some(s=>s.includes('Motstridiga')));
  const malformed=f.fields.interpretInvoice('Faktura\nFakturanummer: 1\nTotalsumma: 1.499,001 SEK');assert.equal(malformed.fields.total_cents.value,null);
});
test('verified green invoices auto-register exactly once; copies and changed amounts never create another debt',async t=>{
  const f=await processingFixture(t),key=f.processing.counterpartyKey('supplier','Exempelbolaget AB','5560160680');
  f.sql.prepare('INSERT INTO invoice_counterparties(owner,identity,email,bankgiro,evidence,verified_at) VALUES(?,?,?,?,?,?)').run(f.owner,key,'supplier@example.test','123-4567','Synthetic verified supplier','2026-01-01');
  f.doc();await f.processing.processDocuments(f.owner);
  assert.equal(f.sql.prepare('SELECT state FROM document_jobs').get().state,'registered');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,1);
  let state=JSON.parse(f.sql.prepare('SELECT payload FROM workspaces').get().payload);assert.equal(state.invoices.length,1);assert.equal(state.invoices[0].number,'0007');assert.equal(state.allocations.length,0);
  f.doc('copy');await f.processing.processDocuments(f.owner);assert.equal(f.sql.prepare("SELECT state FROM document_jobs WHERE document_id='copy'").get().state,'duplicate');
  f.pdfResult.text=syntheticText().replace('3 125,00','3 500,00');f.doc('conflict');await f.processing.processDocuments(f.owner);state=JSON.parse(f.sql.prepare('SELECT payload FROM workspaces').get().payload);assert.equal(state.invoices.length,1);
});
test('a changed Bankgiro and OCR uncertainty cannot use trusted-party automatic registration',async t=>{
  const f=await processingFixture(t),key=f.processing.counterpartyKey('supplier','Exempelbolaget AB','5560160680');f.sql.prepare('INSERT INTO invoice_counterparties(owner,identity,email,bankgiro,evidence,verified_at) VALUES(?,?,?,?,?,?)').run(f.owner,key,'supplier@example.test','999-9999','Synthetic trust','2026-01-01');f.doc();await f.processing.processDocuments(f.owner);assert.equal(f.sql.prepare('SELECT state FROM document_jobs').get().state,'needs_review');
  f.doc('image','image/png');const leased=await (await f.worker('lease')).json();assert.ok(leased.job);const r=await f.worker('complete',{id:'image',lease:leased.job.lease,sha256:f.sha,text:syntheticText('0008'),method:'ocr',confidence:99});assert.equal(r.status,200);assert.equal(JSON.parse(f.sql.prepare("SELECT extraction FROM document_jobs WHERE document_id='image'").get().extraction).level,'yellow');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);
});
test('local leases are owner-bound, single-use and cannot access bank/mail tools',async t=>{
  const f=await processingFixture(t);f.doc('image','image/png');await assert.rejects(f.worker('lease',{},'invalid'),/WORKER_AUTH/);
  const one=await (await f.worker('lease')).json();assert.ok(one.job);assert.equal((await (await f.worker('lease')).json()).job,null);
  const body={id:'image',lease:one.job.lease,sha256:f.sha,text:syntheticText(),method:'ocr',confidence:95};assert.equal((await f.worker('complete',{...body,sha256:'0'.repeat(64)})).status,400);assert.equal((await f.worker('complete',body)).status,200);assert.equal((await f.worker('complete',body)).status,409);assert.equal((await f.worker('send',{})).status,404);
  assert.ok((await f.processing.processingStatus(f.owner)).worker_online);assert.equal((await f.processing.processingStatus('other')).registered,0);
});
test('expired leases recover after restart and stop retrying after the attempt limit',async t=>{
  const f=await processingFixture(t);f.doc('image','image/png');const first=await (await f.worker('lease')).json();f.sql.prepare("UPDATE document_jobs SET lease_until='2000-01-01'").run();const second=await (await f.worker('lease')).json();assert.notEqual(first.job.lease,second.job.lease);
  assert.equal((await f.worker('complete',{id:'image',lease:first.job.lease,sha256:f.sha,text:'',method:'ocr',confidence:0})).status,409);
  f.sql.prepare("UPDATE document_jobs SET lease_until='2000-01-01',attempts=3").run();assert.equal((await (await f.worker('lease')).json()).job,null);assert.equal(f.sql.prepare('SELECT state FROM document_jobs').get().state,'failed');
});
test('manual registration during a local lease makes a delayed result harmless',async t=>{
  const f=await processingFixture(t);f.doc('image','image/png');const one=await (await f.worker('lease')).json();
  await f.processing.registerProcessedInvoice(f.owner,'image',{direction:'payable',party:'Exempelbolaget AB',number:'0007',total:312500,issued:'2026-10-24',due:'2026-11-07',kind:'invoice'},{currency:'SEK',organization_number:'5560160680',vat_cents:62500,net_cents:250000});
  assert.equal((await f.worker('complete',{id:'image',lease:one.job.lease,sha256:f.sha,text:syntheticText(),method:'ocr',confidence:99})).status,409);assert.equal(JSON.parse(f.sql.prepare('SELECT payload FROM workspaces').get().payload).invoices.length,1);
});

test('rejecting a document cancels its lease and removes it from review counts without removing its original',async t=>{
  const f=await processingFixture(t);f.doc('image','image/png');const leased=await (await f.worker('lease')).json();
  assert.equal((await (await f.api.gmailReview(post('review',{document_id:'image',reject:true}))).json()).rejected,true);
  assert.equal((await f.worker('complete',{id:'image',lease:leased.job.lease,sha256:f.sha,text:syntheticText(),method:'ocr',confidence:99})).status,409);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM documents').get().n,1);assert.deepEqual((await f.processing.processingStatus(f.owner)).counts,{});
});
test('scheduled Gmail cooldown still drains pending text jobs',async t=>{
  const f=await processingFixture(t),flow=await connect(f);await f.api.gmailCallback(flow.callback());f.doc();f.sql.prepare('UPDATE gmail_connections SET last_attempt=?').run(new Date().toISOString());const r=await (await f.api.gmailSync(undefined,true)).json();assert.equal(r.status,'not_due');assert.equal(r.processing.processed,1);
});
