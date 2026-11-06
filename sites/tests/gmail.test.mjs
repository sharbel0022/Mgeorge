import test,{after} from 'node:test';import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';import {DatabaseSync} from 'node:sqlite';import ts from 'typescript';
import {createHash} from 'node:crypto';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
import * as domain from '../lib/domain.ts';
import {seal,unseal,randomToken} from '../lib/banking/security.ts';
const source=p=>readFileSync(new URL(p,import.meta.url),'utf8');
// Keep dependent source out of each ESM cache key. Identical module text keeps
// one identity, while every fixture still has its own environment and state.
const moduleDirectory=mkdtempSync(join(tmpdir(),'mg-gmail-modules-'));
after(()=>rmSync(moduleDirectory,{recursive:true,force:true}));
const data=code=>{
  const bytes=Buffer.from(code),file=join(moduleDirectory,createHash('sha256').update(bytes).digest('hex')+'.mjs');
  if(existsSync(file)){
    if(!readFileSync(file).equals(bytes))throw Error('Synthetic module hash collision');
  }else writeFileSync(file,bytes,{mode:0o600,flag:'wx'});
  return pathToFileURL(file).href;
};
function moduleUrl(path,imports){imports={...Object.fromEntries(['document-triage','economy-summary','invoice-details','ocr-bankgiro-evidence'].map(n=>['./'+n+'.js',new URL('../lib/'+n+'.js',import.meta.url).href])),...imports};let code=ts.transpileModule(source(path),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;for(const [from,to]of Object.entries(imports))for(const q of ['"',"'"])code=code.replaceAll(q+from+q,JSON.stringify(to));return data(code);}
class D1{
  constructor(sql){this.sql=sql;}
  prepare(query){const sql=this.sql;return{query,args:[],bind(...args){this.args=args;return this;},async first(){return sql.prepare(query).get(...this.args)||null;},async all(){return{results:sql.prepare(query).all(...this.args)};},async run(){return this.execute();},execute(){const r=sql.prepare(query).run(...this.args);return{meta:{changes:Number(r.changes)}};}};}
  async batch(items){this.sql.exec('BEGIN');try{const results=items.map(x=>x.execute());this.sql.exec('COMMIT');return results;}catch(e){this.sql.exec('ROLLBACK');throw e;}}
}
async function fixture(t,{realAftercheck=false,automatic=false}={}){
  const key='__gmail_'+crypto.randomUUID().replaceAll('-',''),sql=new DatabaseSync(':memory:');sql.exec(source('../drizzle/0000_confused_umar.sql'));sql.exec(source('../drizzle/0001_sudden_whirlwind.sql'));sql.exec(source('../drizzle/0002_brief_chronomancer.sql'));sql.exec(source('../drizzle/0003_needy_gravity.sql'));for(const file of (await import('node:fs')).readdirSync(new URL('../drizzle',import.meta.url)).filter(f=>/^\d{4}.*sql$/.test(f)&&f.slice(0,4)>='0004'))sql.exec(source('../drizzle/'+file));
  const f={sql,d1:new D1(sql),owner:'test-owner',key:randomToken(),wrongAccount:false,providerCalls:0,env:{GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret'}};f.user={userId:f.owner,email:"owner@example.test"};if(automatic)Object.assign(f.env,{DOCUMENT_AUTOMATION_ENABLED:'true',DOCUMENT_OWNER_EMAIL:f.user.email,DOCUMENT_SCHEDULER_CONFIGURED:'true'});
  const objects=new Map();
  f.env.BUCKET={put:async(key,bytes)=>{f.bucketPuts=(f.bucketPuts||0)+1;objects.set(key,Buffer.from(bytes));},get:async key=>{const bytes=objects.get(key);return bytes?{size:bytes.length,body:bytes,arrayBuffer:async()=>Uint8Array.from(bytes).buffer}:null;},delete:async key=>{f.bucketDeletes=(f.bucketDeletes||0)+1;objects.delete(key);}};globalThis[key]=f;
  const reference=`globalThis[${JSON.stringify(key)}]`,cf=data(`export const env=${reference}.env;`);
  const domainUrl=new URL('../lib/domain.ts',import.meta.url).href,securityUrl=new URL('../lib/banking/security.ts',import.meta.url).href;
  f.env.DB=f.d1;
  const server=realAftercheck?moduleUrl('../lib/server.ts',{'./company-storage.js':new URL('../lib/company-storage.js',import.meta.url).href,'cloudflare:workers':cf,'@/app/chatgpt-auth':data(`export async function getChatGPTUser(){return ${reference}.user;}`),'./domain':domainUrl}):data(`import {emptyState} from ${JSON.stringify(domainUrl)};const f=${reference};export async function companyWorkerIdentity(){return null;}export async function companyWorkerConfigured(){return null;}export const db=()=>f.d1;export const response=(body,status=200)=>Response.json(body,{status});export async function companyGmailAccount(){return 'mg.vitvaror@gmail.com';}export async function identity(req){if(!f.user)throw Error('AUTH_REQUIRED');if(req&&req.method!=='GET'&&req.headers.get('origin')!==new URL(req.url).origin)throw Error('ORIGIN_DENIED');return f.user;}export async function readWorkspace(owner){const r=await f.d1.prepare('SELECT revision,payload FROM workspaces WHERE owner=?').bind(owner).first();return r?{revision:r.revision,state:JSON.parse(r.payload)}:{revision:0,state:emptyState()};}`);
  const store=data(`import {seal,unseal} from ${JSON.stringify(securityUrl)};const f=${reference};export const storageReady=()=>true;export const encrypt=(owner,purpose,value)=>seal(f.key,owner,purpose,value);export const decrypt=(owner,purpose,value)=>unseal(f.key,owner,purpose,value);`);
  const adapter=moduleUrl('../lib/gmail-adapter.js',{'cloudflare:workers':cf}),fields=moduleUrl('../lib/invoice-fields.js',{'./domain':domainUrl});
  f.adapter=await import(adapter);
  const pdf=data(`export async function serverPdfText(){const f=${reference};if(f.pdfError)throw Error(f.pdfError);return f.pdfResult||{text:'',method:'pdf',confidence:100};}`);
  let customer=data(`export async function reconcileAndPrepare(){if(${reference}.reconcileError)throw Error('synthetic postprocessing failure');}`);
  if(realAftercheck){
    const reconciliation=moduleUrl('../lib/reconciliation.ts',{'./domain':domainUrl,'./reconciliation-engine.js':new URL('../lib/reconciliation-engine.js',import.meta.url).href});
    const evidence=moduleUrl('../lib/reconciliation-evidence.ts',{'./server':server,'./domain':domainUrl,'./reconciliation':reconciliation,'./reconciliation-engine.js':new URL('../lib/reconciliation-engine.js',import.meta.url).href});
    customer=moduleUrl('../lib/customer-messages.ts',{'./server':server,'./domain':domainUrl,'./reconciliation':reconciliation,'./reconciliation-evidence':evidence,'./customer-message-text.js':new URL('../lib/customer-message-text.js',import.meta.url).href,'./banking/security':securityUrl,'./banking/store':store,'./gmail-adapter.js':adapter});f.customerApi=await import(customer);
  }
  const processing=moduleUrl('../lib/document-processing.ts',{'cloudflare:workers':cf,'./server':server,'./domain':domainUrl,'./banking/security':securityUrl,'./invoice-fields.js':fields,'./server-pdf':pdf,'./customer-messages':customer});
  f.processing=await import(processing);f.fields=await import(fields);f.processingUrl=processing;f.serverUrl=server;
  f.apiUrl=moduleUrl('../lib/gmail-service.ts',{'cloudflare:workers':cf,'./server':server,'./domain':domainUrl,'./banking/store':store,'./banking/security':securityUrl,'./gmail-adapter.js':adapter,'./invoice-fields.js':fields,'./document-processing':processing,'./customer-messages':customer});
  f.api=await import(f.apiUrl);
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    assert.equal(options.redirect,'manual','Workers-compatible fetch must never forward credentials through redirects');
    f.providerCalls++;const path=new URL(url).pathname;
    if(f.retryAfter)return Response.json({error:{message:'private-provider-secret'}},{status:429,headers:{'Retry-After':f.retryAfter}});
    if(f.redirectProvider)return new Response('private provider body',{status:302,headers:{Location:'https://untrusted.example/collect'}});
    if(path==='/token'){if(f.tokenReached)f.tokenReached();if(f.pauseToken)await f.pauseToken;return f.tokenError?Response.json(f.tokenError,{status:400}):Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,scope:'https://www.googleapis.com/auth/gmail.readonly'});}
    if(path==='/revoke'){if(f.revokeReached)f.revokeReached();if(f.pauseRevoke)await f.pauseRevoke;return new Response('');}
    if(path.endsWith('/profile'))return Response.json({emailAddress:f.wrongAccount?'wrong@gmail.com':'mg.vitvaror@gmail.com'});
    if(path.endsWith('/messages')){if(f.messageReached)f.messageReached();if(f.pauseMessages)await f.pauseMessages;return Response.json({messages:[{id:'archived'}]});}
    if(path.includes('/attachments/')){f.attachmentCalls=(f.attachmentCalls||0)+1;return Response.json({data:Buffer.from('%PDF-test-original').toString('base64url')});}
    return Response.json({labelIds:[],internalDate:String(Date.now()),payload:{headers:[{name:'Subject',value:f.subject||'Dokument'},{name:'From',value:'Supplier <supplier@example.com>'},{name:'To',value:'mg.vitvaror@gmail.com'}],parts:[{partId:'1',filename:f.filename||'document.pdf',mimeType:f.mime||'application/pdf',body:{attachmentId:'attachment-1'}}]}});
  });
  t.after(()=>{delete globalThis[key];sql.close();});return f;
}
const origin='https://invoice.example';
const post=(action,body={})=>new Request(origin+'/api/gmail/'+action,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
async function connect(f){const r=await f.api.gmailConnect(post('connect')),cookie=r.headers.get('set-cookie').split(';')[0],body=await r.json(),state=new URL(body.url).searchParams.get('state');return{cookie,state,callback:()=>new Request(origin+'/api/gmail/callback?state='+state+'&code=synthetic-code',{headers:{Cookie:cookie}})};}

test('Gmail automation: pausing prevents provider fetches and leaves durable queue work intact',async t=>{
  const f=await processingFixture(t),flow=await connect(f);await f.api.gmailCallback(flow.callback());f.doc();
  f.sql.prepare('UPDATE document_automation SET enabled=0').run();const calls=f.providerCalls;
  const result=await(await f.api.gmailSync(undefined,true)).json();
  assert.equal(result.status,'paused');assert.equal(f.providerCalls,calls);
  assert.equal(f.sql.prepare('SELECT last_attempt FROM gmail_connections').get().last_attempt,'');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM documents').get().n,1);
  // Reference-search callers treat HTTP success as evidence of an actual fetch.
  const referenceSearch=await f.api.gmailSync(undefined,true,'000018');
  assert.equal(referenceSearch.ok,false);assert.equal(referenceSearch.status,409);assert.equal((await referenceSearch.json()).status,'paused');assert.equal(f.providerCalls,calls);
});

test('Gmail automation: connection outages persist exponential retry deadlines across module restart',async t=>{
  const f=await fixture(t,{automatic:true}),flow=await connect(f);await f.api.gmailCallback(flow.callback());
  const originalFetch=globalThis.fetch;let outageCalls=0;
  t.mock.method(globalThis,'fetch',async()=>{outageCalls++;throw Error('synthetic private network detail');});
  for(const [attempt,minDelay]of [[1,900000],[2,1800000]]){
    const before=Date.now();await assert.rejects(f.api.gmailSync(undefined,true),e=>e.code==='connection_error');
    const row=f.sql.prepare('SELECT * FROM gmail_connections').get();
    assert.equal(row.sync_failures,attempt);assert.equal(row.status,'retry_wait');
    assert.ok(Date.parse(row.retry_after)>=before+minDelay);assert.ok(Date.parse(row.retry_after)<=Date.now()+minDelay+1000);
    f.sql.prepare("UPDATE gmail_connections SET last_attempt='2000-01-01'").run();
    const restarted=await import(f.apiUrl+'#retry-'+attempt),calls=outageCalls;
    assert.equal((await(await restarted.gmailSync(undefined,true)).json()).status,'not_due');
    assert.equal((await restarted.gmailSync(post('sync'))).status,429);assert.equal(outageCalls,calls);
    const status=await(await restarted.gmailStatus(true)).json();assert.equal(status.sync_health.state,'waiting');
    f.sql.prepare("UPDATE gmail_connections SET retry_after='' ").run();
  }
  globalThis.fetch=originalFetch;
  await f.api.gmailSync(post('sync'));
  const recovered=f.sql.prepare('SELECT status,sync_failures,retry_after FROM gmail_connections').get();
  assert.deepEqual({...recovered},{status:'connected',sync_failures:0,retry_after:''});
});

test('Gmail automation: revoked refresh credentials stop unattended retries until reconnection',async t=>{
  const f=await fixture(t,{automatic:true}),flow=await connect(f);await f.api.gmailCallback(flow.callback());
  const expired={access_token:'synthetic-expired',refresh_token:'synthetic-revoked',expires_at:0,scope:'https://www.googleapis.com/auth/gmail.readonly'};
  f.sql.prepare('UPDATE gmail_connections SET tokens=?').run(await seal(f.key,f.owner,'gmail-tokens',expired));
  f.tokenError={error:'invalid_grant'};await assert.rejects(f.api.gmailSync(undefined,true),e=>e.code==='renewal_required');
  f.sql.prepare("UPDATE gmail_connections SET last_attempt='2000-01-01'").run();const calls=f.providerCalls;
  const result=await(await f.api.gmailSync(undefined,true)).json();assert.equal(result.status,'reconnect_required');assert.equal(f.providerCalls,calls);
  const status=await(await f.api.gmailStatus(true)).json();assert.equal(status.next_eligible_sync,null);
});

test('Gmail automation: interrupted response body persists backoff and blocks early manual retry',async t=>{
  const f=await fixture(t,{automatic:true}),flow=await connect(f);await f.api.gmailCallback(flow.callback());let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"messages":'));},pull(controller){controller.error(Error('synthetic-private-stream-outage'));}}));});
  const before=Date.now();await assert.rejects(f.api.gmailSync(undefined,true),error=>error.code==='connection_error');
  const row=f.sql.prepare('SELECT status,retry_after FROM gmail_connections').get();assert.equal(row.status,'retry_wait');assert.ok(Date.parse(row.retry_after)>=before+900000);
  const reached=calls,restarted=await import(f.apiUrl+'#stream-restart');
  assert.equal((await restarted.gmailSync(post('sync'))).status,429);assert.equal(calls,reached);
});

test('Gmail automation: observations distinguish manual fetch, automatic invocation and external scheduler proof',async t=>{
  const f=await fixture(t,{automatic:true}),flow=await connect(f);await f.api.gmailCallback(flow.callback());
  let status=await(await f.api.gmailStatus(true)).json();assert.equal(status.schedule_observation.last_invoked_at,null);
  await f.api.gmailSync(post('sync'));status=await(await f.api.gmailStatus(true)).json();
  assert.ok(status.last_successful_fetch);assert.equal(status.schedule_observation.last_invoked_at,null);
  f.sql.prepare("UPDATE gmail_connections SET last_attempt='' ").run();
  await f.api.gmailSync(undefined,true);status=await(await f.api.gmailStatus(true)).json();
  assert.ok(status.schedule_observation.last_invoked_at);assert.ok(status.schedule_observation.last_completed_at);
  assert.equal(status.schedule_observation.last_outcome,'completed');
  assert.equal(status.schedule_observation.source,'system_entrypoint');
  assert.equal(status.schedule_observation.external_schedule_verified,false);assert.equal(status.sync_health.schedule_verified,false);
  const completed=status.schedule_observation.last_completed_at;
  await f.api.gmailSync(undefined,true);status=await(await f.api.gmailStatus(true)).json();
  assert.equal(status.schedule_observation.last_outcome,'not_due');assert.equal(status.schedule_observation.last_completed_at,completed);
  f.user={userId:'another-owner'};status=await(await f.api.gmailStatus(true)).json();assert.equal(status.schedule_observation.last_invoked_at,null);
});

for(const freshness of ['stale','not_verified'])test(`Gmail automatic eligibility permits a due ${freshness} connection without claiming schedule health`,async t=>{
  const f=await fixture(t,{automatic:true}),flow=await connect(f);await f.api.gmailCallback(flow.callback());
  await f.processing.processingSettings(f.user);
  f.sql.prepare('UPDATE gmail_connections SET last_synced=?,last_attempt=?').run(freshness==='stale'?'2000-01-01T00:00:00.000Z':'','');
  const before={...f.sql.prepare('SELECT * FROM gmail_connections').get()},calls=f.providerCalls;
  const status=await(await f.api.gmailStatus(true)).json();
  assert.equal(status.sync_health.state,freshness);assert.equal(status.fetch_ready,false);
  assert.equal(status.sync_eligibility.eligible,true);assert.equal(status.sync_eligibility.reason,'eligible');
  assert.ok(Number.isFinite(Date.parse(status.sync_eligibility.next_eligible_at)));
  assert.equal(status.sync_health.schedule_verified,false);assert.equal(status.schedule_observation.external_schedule_verified,false);
  assert.equal(status.background_ready,false);assert.equal(f.providerCalls,calls,'status must not contact Gmail');
  assert.deepEqual({...f.sql.prepare('SELECT * FROM gmail_connections').get()},before);
  const fetched=await(await f.api.gmailSync(undefined,true)).json();assert.equal(fetched.imported,1);
  const after=await(await f.api.gmailStatus(true)).json();
  assert.equal(after.fetch_ready,true);assert.equal(after.sync_eligibility.eligible,false);
  assert.equal(after.sync_eligibility.reason,'minimum_interval');assert.equal(after.background_ready,false);
});

for(const [name,change,reason] of [
  ['pause',f=>f.sql.prepare('UPDATE document_automation SET enabled=0').run(),'paused'],
  ['revoked grant',f=>f.sql.prepare("UPDATE gmail_connections SET status='renewal_required'").run(),'reconnect_required'],
  ['missing scope',f=>f.sql.prepare("UPDATE gmail_connections SET status='missing_scope'").run(),'reconnect_required'],
  ['failure limit',f=>f.sql.prepare('UPDATE gmail_connections SET sync_failures=3').run(),'blocked'],
  ['recorded block',f=>f.sql.prepare("UPDATE gmail_connections SET status='blocked'").run(),'blocked'],
  ['different mailbox',f=>f.sql.prepare("UPDATE gmail_connections SET email='foreign@example.test'").run(),'mailbox_mismatch'],
  ['removed connection',f=>f.sql.prepare('DELETE FROM gmail_connections').run(),'disconnected'],
  ['missing OAuth setup',f=>{delete f.env.GOOGLE_CLIENT_ID;},'not_configured'],
])test(`Gmail eligibility does not turn ${name} into a stale-connection retry`,async t=>{
  const f=await fixture(t,{automatic:true}),flow=await connect(f);await f.api.gmailCallback(flow.callback());
  await f.processing.processingSettings(f.user);change(f);const calls=f.providerCalls;
  const status=await(await f.api.gmailStatus(true)).json();
  assert.deepEqual(status.sync_eligibility,{eligible:false,reason,next_eligible_at:null});assert.equal(f.providerCalls,calls);
});

test('Gmail eligibility preserves provider cooldown and active-run deadlines without exposing the lease',async t=>{
  const f=await fixture(t,{automatic:true}),flow=await connect(f);await f.api.gmailCallback(flow.callback());
  await f.processing.processingSettings(f.user);
  const retry=new Date(Date.now()+1200000).toISOString(),lockUntil=new Date(Date.now()+300000).toISOString();
  f.sql.prepare('UPDATE gmail_connections SET retry_after=?').run(retry);
  let status=await(await f.api.gmailStatus(true)).json();
  assert.deepEqual(status.sync_eligibility,{eligible:false,reason:'retry_after',next_eligible_at:retry});
  f.sql.prepare('INSERT INTO gmail_locks(owner,token,expires_at) VALUES(?,?,?)').run(f.owner,'synthetic-secret-lease',lockUntil);
  status=await(await f.api.gmailStatus(true)).json();
  assert.deepEqual(status.sync_eligibility,{eligible:false,reason:'running',next_eligible_at:retry});
  assert.ok(!JSON.stringify(status).includes('synthetic-secret-lease'));
  f.sql.prepare("UPDATE gmail_connections SET retry_after='' ").run();
  status=await(await f.api.gmailStatus(true)).json();
  assert.deepEqual(status.sync_eligibility,{eligible:false,reason:'running',next_eligible_at:lockUntil});
  f.sql.prepare("UPDATE gmail_locks SET expires_at='2000-01-01'").run();
  status=await(await f.api.gmailStatus(true)).json();assert.equal(status.sync_eligibility.eligible,true);
  f.user={userId:'separate-synthetic-owner',email:'other@example.test'};
  status=await(await f.api.gmailStatus(true)).json();assert.equal(status.sync_eligibility.eligible,false);assert.equal(status.sync_eligibility.reason,'disconnected');
  assert.equal(status.connection,null);assert.equal(status.last_successful_fetch,'');
});

for(const expiry of ['unknown-private-deadline','9999-99-99T99:99:99.999Z','2099-01-01'])test(`Gmail status fails closed for a noncanonical active lock deadline: ${expiry}`,async t=>{
  const f=await fixture(t,{automatic:true}),flow=await connect(f);await f.api.gmailCallback(flow.callback());
  await f.processing.processingSettings(f.user);
  f.sql.prepare('INSERT INTO gmail_locks(owner,token,expires_at) VALUES(?,?,?)').run(f.owner,'synthetic-private-lock',expiry);
  const calls=f.providerCalls,before={...f.sql.prepare('SELECT * FROM gmail_locks').get()};
  const response=await f.api.gmailStatus(true);assert.equal(response.status,200);
  const status=await response.json();
  assert.deepEqual(status.sync_eligibility,{eligible:false,reason:'lock_expiry_unknown',next_eligible_at:null});
  assert.equal(f.providerCalls,calls);assert.deepEqual({...f.sql.prepare('SELECT * FROM gmail_locks').get()},before);
  assert.ok(!JSON.stringify(status).includes(expiry));assert.ok(!JSON.stringify(status).includes('synthetic-private-lock'));
});

test('Gmail automation: rejected attachment reasons survive replay and are scoped without exposing message data',async t=>{
  const f=await fixture(t),flow=await connect(f);await f.api.gmailCallback(flow.callback());
  const originalFetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const path=new URL(url).pathname;
    if(path.endsWith('/messages'))return Response.json({messages:[{id:'bad'},{id:'large'},{id:'good'}]});
    if(path.endsWith('/messages/bad'))return Response.json({payload:{parts:[{partId:'1',filename:'private-invalid.pdf',mimeType:'application/pdf',body:{data:Buffer.from('not a PDF').toString('base64url')}}]}});
    if(path.endsWith('/messages/large'))return Response.json({payload:{parts:[{partId:'1',filename:'private-large.pdf',mimeType:'application/pdf',body:{size:16*1024*1024,attachmentId:'large-attachment'}}]}});
    return originalFetch(url,options);
  });
  await f.api.gmailSync(post('sync'));
  let status=await(await f.api.gmailStatus(true)).json();
  assert.deepEqual(status.attachment_rejections,{total:2,reasons:[{code:'attachment_format_invalid',count:1},{code:'attachment_too_large',count:1}]});
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM documents').get().n,1);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM gmail_sources WHERE document_id='' AND status='rejected'").get().n,2);
  assert.ok(!JSON.stringify(status.attachment_rejections).includes('private-'));
  await f.api.gmailSync(post('sync'));
  status=await(await f.api.gmailStatus(true)).json();assert.equal(status.attachment_rejections.total,2);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM documents').get().n,1);
  f.sql.prepare("INSERT INTO gmail_sources(owner,source_id,document_id,metadata,status,created_at) VALUES(?,?,'',?,'rejected',?)").run(f.owner,'legacy','{malformed',new Date().toISOString());
  status=await(await f.api.gmailStatus(true)).json();assert.equal(status.attachment_rejections.total,3);assert.deepEqual(status.attachment_rejections.reasons.at(-1),{code:'unclassified',count:1});
  f.user={userId:'another-owner'};status=await(await f.api.gmailStatus(true)).json();assert.deepEqual(status.attachment_rejections,{total:0,reasons:[]});
});

test('Gmail automation: a lost observation receipt never reverses an accepted fetch and remains visibly unconfirmed',async t=>{
  const f=await fixture(t,{automatic:true}),flow=await connect(f);await f.api.gmailCallback(flow.callback());
  const prepare=f.d1.prepare.bind(f.d1);let interrupted=false;
  f.d1.prepare=query=>{
    const statement=prepare(query),run=statement.run.bind(statement);
    statement.run=async()=>{
      if(!interrupted&&query.startsWith('INSERT INTO audit_events')&&statement.args.includes('gmail.automatic.result')){interrupted=true;throw Error('synthetic lost receipt');}
      return run();
    };
    return statement;
  };
  const result=await(await f.api.gmailSync(undefined,true)).json();assert.equal(result.imported,1);assert.match(result.observation_warning,/körningskvitto/);assert.equal(result.automation_receipt.persisted,false);assert.equal(result.automation_receipt.outcome,'completed');
  const status=await(await f.api.gmailStatus(true)).json();assert.ok(status.last_successful_fetch);assert.ok(status.schedule_observation.last_invoked_at);
  assert.equal(status.schedule_observation.last_completed_at,null);assert.equal(status.schedule_observation.last_outcome,'running_or_interrupted');assert.equal(status.schedule_observation.last_run_id,result.automation_receipt.run_id);assert.equal(status.schedule_observation.last_finished_at,null);
  f.sql.prepare("UPDATE gmail_connections SET last_attempt='' ").run();await f.api.gmailSync(undefined,true);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM documents').get().n,1);
});

for(const terminal of ['rejected','registered'])test(`Gmail automation: concurrent ${terminal} decision is inherited by a repeated original`,async t=>{
  const f=await fixture(t),flow=await connect(f);await f.api.gmailCallback(flow.callback());await f.api.gmailSync(post('sync'));
  const documentId=f.sql.prepare('SELECT id FROM documents').get().id;
  const originalFetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async(url,options)=>new URL(url).pathname.endsWith('/messages')?Response.json({messages:[{id:'reimport'}]}):originalFetch(url,options));
  const originalBatch=f.d1.batch.bind(f.d1);let decided=false;
  f.d1.batch=async items=>{
    if(!decided&&items.some(s=>/^INSERT OR IGNORE INTO gmail_sources/.test(s.query))){
      decided=true;
      const body=terminal==='rejected'?{document_id:documentId,reject:true}:{document_id:documentId,confirm:true,invoice:{direction:'payable',party:'Synthetic supplier AB',number:'race-001',total:62500,issued:'2026-10-24',due:'2026-11-07',kind:'invoice'},fields:{currency:'SEK',vat_cents:'125.00',net_cents:'500.00'}};
      assert.equal((await f.api.gmailReview(post('review',body))).status,200);
    }
    return originalBatch(items);
  };
  const result=await(await f.api.gmailSync(post('sync'))).json();assert.equal(result.imported,0);assert.equal(result.duplicates,1);assert.equal(decided,true);
  const sources=f.sql.prepare('SELECT document_id,status FROM gmail_sources ORDER BY source_id').all();
  assert.equal(sources.length,2);assert.ok(sources.every(row=>row.document_id===documentId&&row.status===terminal));
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM documents').get().n,1);
  await f.processing.enqueueDocuments(f.owner);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM document_jobs WHERE state IN ('queued','waiting_ocr','processing')").get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,terminal==='registered'?1:0);
});

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
  assert.equal((await f.api.gmailReview(post('review',{document_id:id,confirm:true,invoice,fields,extraction:{fields:{party:{value:'Original supplier'}}}}))).status,200);
  const saved=JSON.parse(f.sql.prepare('SELECT payload FROM workspaces').get().payload);assert.equal(saved.invoices.length,1);assert.equal(saved.allocations.length,0);
  await f.api.gmailReview(post('review',{document_id:id,confirm:true,invoice,fields}));assert.equal(JSON.parse(f.sql.prepare('SELECT payload FROM workspaces').get().payload).invoices.length,1);
  assert.equal(JSON.parse(f.sql.prepare('SELECT detail FROM audit_events').get().detail).extraction.fields.party.value,'Original supplier');
  f.user=null;await assert.rejects(f.api.gmailStatus(),/AUTH_REQUIRED/);
});
test('a delayed Sites Gmail fetch cannot write after a replacement owns its lease',async t=>{
  const f=await fixture(t),flow=await connect(f);await f.api.gmailCallback(flow.callback());const before=f.sql.prepare('SELECT tokens,last_synced FROM gmail_connections').get();
  let release;f.pauseMessages=new Promise(resolve=>{release=resolve;});const reached=new Promise(resolve=>{f.messageReached=resolve;});
  const pending=f.api.gmailSync(post('sync'));await reached;
  f.sql.prepare("UPDATE gmail_locks SET token='replacement',expires_at=? WHERE owner=?").run(new Date(Date.now()+60000).toISOString(),f.owner);
  release();await assert.rejects(pending,error=>error.code==='gmail_lease_lost');
  assert.equal(f.sql.prepare('SELECT tokens FROM gmail_connections').get().tokens,before.tokens);assert.equal(f.sql.prepare('SELECT last_synced FROM gmail_connections').get().last_synced,before.last_synced);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM documents').get().n,0);assert.equal(f.bucketPuts||0,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM gmail_runs').get().n,0);assert.equal(f.sql.prepare('SELECT token FROM gmail_locks').get().token,'replacement');
});
test('D1 rechecks the Gmail token inside the mutation batch after an earlier valid assertion',async t=>{
  const f=await fixture(t),flow=await connect(f);await f.api.gmailCallback(flow.callback());const before=f.sql.prepare('SELECT tokens FROM gmail_connections').get().tokens;
  let replace=false;f.messageReached=()=>{replace=true;};const original=f.d1.batch.bind(f.d1);
  f.d1.batch=items=>{if(replace){replace=false;f.sql.prepare("UPDATE gmail_locks SET token='replacement',expires_at=?").run(new Date(Date.now()+60000).toISOString());}return original(items);};
  await assert.rejects(f.api.gmailSync(post('sync')),error=>error.code==='gmail_lease_lost');
  assert.equal(f.sql.prepare('SELECT tokens FROM gmail_connections').get().tokens,before);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM documents').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM gmail_runs').get().n,0);assert.equal(f.sql.prepare('SELECT token FROM gmail_locks').get().token,'replacement');
});
test('an expired Sites Gmail lease cannot save a response even without a replacement process',async t=>{
  const f=await fixture(t),flow=await connect(f);await f.api.gmailCallback(flow.callback());f.messageReached=()=>f.sql.prepare("UPDATE gmail_locks SET expires_at='2000-01-01'").run();
  await assert.rejects(f.api.gmailSync(post('sync')),error=>error.code==='gmail_lease_lost');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM documents').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM gmail_runs').get().n,0);
});
test('delayed OAuth and disconnect callbacks cannot overwrite or remove a replacement Gmail connection',async t=>{
  const f=await fixture(t),first=await connect(f);await f.api.gmailCallback(first.callback());const before=f.sql.prepare('SELECT tokens FROM gmail_connections').get().tokens;
  const flow=await connect(f);let release;f.pauseToken=new Promise(resolve=>{release=resolve;});let reached=new Promise(resolve=>{f.tokenReached=resolve;});const connecting=f.api.gmailCallback(flow.callback());await reached;
  f.sql.prepare("UPDATE gmail_locks SET token='replacement',expires_at=?").run(new Date(Date.now()+60000).toISOString());release();await assert.rejects(connecting,error=>error.code==='gmail_lease_lost');assert.equal(f.sql.prepare('SELECT tokens FROM gmail_connections').get().tokens,before);
  f.sql.prepare('DELETE FROM gmail_locks').run();f.pauseToken=null;f.tokenReached=null;
  f.pauseRevoke=new Promise(resolve=>{release=resolve;});reached=new Promise(resolve=>{f.revokeReached=resolve;});const disconnecting=f.api.gmailDisconnect(post('disconnect'));await reached;
  f.sql.prepare("UPDATE gmail_locks SET token='replacement',expires_at=?").run(new Date(Date.now()+60000).toISOString());release();await assert.rejects(disconnecting,error=>error.code==='gmail_lease_lost');assert.equal(f.sql.prepare('SELECT tokens FROM gmail_connections').get().tokens,before);assert.equal(f.sql.prepare('SELECT token FROM gmail_locks').get().token,'replacement');
});
test('a lost response after document registration cannot delete its referenced original',async t=>{
  const f=await fixture(t),flow=await connect(f);await f.api.gmailCallback(flow.callback());const original=f.d1.batch.bind(f.d1);let interrupted=false;
  f.d1.batch=async items=>{const result=await original(items);if(f.bucketPuts&&!interrupted){interrupted=true;throw Error('synthetic lost D1 reply');}return result;};
  await assert.rejects(f.api.gmailSync(post('sync')),/synthetic lost D1 reply/);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM documents').get().n,1);assert.equal(f.bucketPuts,1);assert.equal(f.bucketDeletes||0,0);
  f.d1.batch=original;await f.api.gmailSync(post('sync'));assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM documents').get().n,1);assert.equal(f.bucketPuts,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM gmail_sources').get().n,1);
});
test('Sites rejects foreign currency and conflicting VAT before creating an invoice; scheduled sync respects cooldown',async t=>{
  const f=await fixture(t,{automatic:true}),flow=await connect(f);await f.api.gmailCallback(flow.callback());await f.api.gmailSync(post('sync'));
  assert.equal((await (await f.api.gmailSync(undefined,true)).json()).status,'not_due');
  const id=f.sql.prepare('SELECT id FROM documents').get().id;
  const invoice={direction:'payable',party:'Synthetic',number:'1',total:10000,issued:'2026-10-24',due:'2026-11-07'};
  await assert.rejects(f.api.gmailReview(post('review',{document_id:id,confirm:true,invoice,fields:{currency:'EUR'}})),/SEK/);
  await assert.rejects(f.api.gmailReview(post('review',{document_id:id,confirm:true,invoice,fields:{currency:'SEK',vat_cents:'50.00',net_cents:'90.00'}})),/Momsberäkningen/);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);
});
test('Sites persists the Gmail provider wait across scheduled and manual retries',async t=>{
  const f=await fixture(t,{automatic:true}),flow=await connect(f);await f.api.gmailCallback(flow.callback());f.retryAfter='7200';
  await assert.rejects(f.api.gmailSync(undefined,true),error=>error.code==='rate_limited'&&error.retryAfter===7200&&!error.message.includes('private-provider-secret'));
  const row=f.sql.prepare('SELECT * FROM gmail_connections').get();assert.ok(Date.parse(row.retry_after)>=Date.now()+7199_000);
  f.sql.prepare("UPDATE gmail_connections SET last_attempt='2000-01-01'").run();const calls=f.providerCalls;
  assert.equal((await (await f.api.gmailSync(undefined,true)).json()).status,'not_due');
  assert.equal((await f.api.gmailSync(post('sync'))).status,429);assert.equal(f.providerCalls,calls);
  assert.ok(Date.parse((await (await f.api.gmailStatus()).json()).next_eligible_sync)>=Date.now()+7199_000);
});
test('Sites Gmail preserves HTTP dates and stops unreasonable provider delays',async t=>{
  const f=await fixture(t);f.retryAfter=new Date(Date.now()+7200_000).toUTCString();
  await assert.rejects(f.adapter.gmailProfile({access_token:'synthetic'}),error=>error.code==='rate_limited'&&error.retryAfter>=7199&&error.retryAfter<=7200);
  f.retryAfter='99999999999999999999999999';await assert.rejects(f.adapter.gmailProfile({access_token:'synthetic'}),error=>error.retryBlocked===true&&error.retryAfter<=365*86400);
});

test('an ambiguous payroll subject retains its original without creating a debt',async t=>{
  const f=await fixture(t),flow=await connect(f);await f.api.gmailCallback(flow.callback());
  f.subject='Lön oktober';assert.equal((await (await f.api.gmailSync(post('sync'))).json()).imported,1);assert.equal(f.attachmentCalls,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM documents').get().n,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);
  assert.ok((await (await f.api.gmailStatus()).json()).last_successful_fetch);
});

const syntheticText=(number='0007')=>`Faktura\nFakturanummer: ${number}\nLeverantör: Exempelbolaget AB\nOrg.nr: 556016-0680\nFakturadatum: 24/10/2026\nFörfallodag: 07/11/2026\nBelopp före moms: 2 500,00 SEK\nTotal moms: 625,00 SEK\nSumma att betala: 3 125,00 SEK\nBankgiro: 123-4567`;
async function processingFixture(t,options){
  const f=await fixture(t,options);Object.assign(f.env,{DOCUMENT_AUTOMATION_ENABLED:'true',DOCUMENT_OWNER_EMAIL:f.user.email,DOCUMENT_WORKER_TOKEN:randomToken()});
  f.bytes=Buffer.from('synthetic-document-bytes');f.sha=Buffer.from(await crypto.subtle.digest('SHA-256',f.bytes)).toString('hex');
  f.env.BUCKET.get=async()=>({size:f.bytes.length,arrayBuffer:async()=>f.bytes});
  f.pdfResult={text:syntheticText(),method:'pdf',confidence:100};await f.processing.processingSettings(f.user);
  f.doc=(id='doc-1',mime='application/pdf',meta={direction:'supplier',direction_confident:true,from:'supplier@example.test',to:'company@example.test',subject:'Synthetic invoice'})=>{f.sql.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)').run(id,f.owner,'synthetic',mime,f.bytes.length,f.sha,new Date().toISOString());f.sql.prepare('INSERT INTO gmail_sources(owner,source_id,document_id,metadata,created_at) VALUES(?,?,?,?,?)').run(f.owner,id,id,JSON.stringify(meta),new Date().toISOString());return id;};
  f.worker=(action,body={},token=f.env.DOCUMENT_WORKER_TOKEN)=>f.processing.workerAction(new Request(origin+'/api/ocr-worker/'+action,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)}),action);
  return f;
}
test('Gmail review navigation: deduplicates sources before the 200-document cap and includes an old focused document',async t=>{
  const f=await processingFixture(t);
  for(let n=0;n<350;n++){const id='review-'+String(n).padStart(4,'0');f.doc(id);f.sql.prepare('UPDATE gmail_sources SET created_at=? WHERE document_id=?').run(new Date(Date.UTC(2026,0,1,0,0,n)).toISOString(),id);}
  for(let n=0;n<210;n++)f.sql.prepare('INSERT INTO gmail_sources(owner,source_id,document_id,metadata,created_at) VALUES(?,?,?,?,?)').run(f.owner,'repeat-'+String(n).padStart(4,'0'),'review-0349',JSON.stringify({subject:'repeat-'+n}),'2026-11-04T00:00:00Z');
  let objectReads=0;f.env.BUCKET.get=async()=>{objectReads++;throw Error('Status must not read originals');};
  const changes=f.sql.prepare('SELECT total_changes() n').get().n;
  const recent=(await(await f.api.gmailStatus()).json()).candidates;
  assert.equal(recent.length,200);assert.equal(new Set(recent.map(row=>row.document_id)).size,200);
  assert.equal(recent[0].document_id,'review-0349');assert.equal(JSON.parse(recent[0].metadata).subject,'repeat-209');
  assert.equal(recent.at(-1).document_id,'review-0150');assert.equal(recent.some(row=>row.document_id==='review-0000'),false);
  const route=await import(moduleUrl('../app/api/gmail/[action]/route.ts',{'@/lib/gmail-service':f.apiUrl}));
  const focused=(await(await route.GET(new Request(origin+'/api/gmail/status?document=review-0000'))).json()).candidates;
  assert.equal(focused.length,200);assert.equal(new Set(focused.map(row=>row.document_id)).size,200);
  assert.equal(focused[0].document_id,'review-0000');assert.equal(focused[1].document_id,'review-0349');assert.equal(focused.at(-1).document_id,'review-0151');
  assert.equal(objectReads,0);assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,changes);
});
test('Gmail review navigation: focus cannot expose foreign or rejected documents and invalid IDs are ignored',async t=>{
  const f=await processingFixture(t);f.doc('owned-document');f.doc('rejected-document');
  f.sql.prepare("UPDATE gmail_sources SET status='rejected' WHERE document_id='rejected-document'").run();
  f.sql.prepare("INSERT INTO gmail_sources(owner,source_id,document_id,metadata,status,created_at) VALUES(?,'older-rejected-source','rejected-document','{}','needs_review','2000-01-01')").run(f.owner);
  const owner=f.owner;f.owner='foreign-owner';f.doc('foreign-document');f.owner=owner;
  f.sql.prepare("INSERT INTO gmail_sources(owner,source_id,document_id,metadata,created_at) VALUES(?,'cross-owner-source','foreign-document','{}','2026-11-05')").run(owner);
  const route=await import(moduleUrl('../app/api/gmail/[action]/route.ts',{'@/lib/gmail-service':f.apiUrl}));
  let objectReads=0;f.env.BUCKET.get=async()=>{objectReads++;throw Error('Status must not read originals');};
  const changes=f.sql.prepare('SELECT total_changes() n').get().n;
  for(const focus of ['foreign-document','rejected-document','missing-document',"' OR 1=1 --",'../owned-document','x'.repeat(101)]){
    const status=await(await route.GET(new Request(origin+'/api/gmail/status?document='+encodeURIComponent(focus)))).json();
    assert.deepEqual(status.candidates.map(row=>row.document_id),['owned-document']);
  }
  assert.equal(objectReads,0);assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,changes);
  f.user=null;const denied=await route.GET(new Request(origin+'/api/gmail/status?document=owned-document'));
  assert.equal(denied.status,401);assert.equal((await denied.json()).candidates,undefined);
});
test('Gmail review navigation: a focused summary remains bounded and never loads candidates or originals',async t=>{
  const f=await processingFixture(t);f.doc('owned-document');
  const queries=[],prepare=f.d1.prepare.bind(f.d1);f.d1.prepare=query=>{queries.push(query);return prepare(query);};
  f.env.BUCKET.get=async()=>{throw Error('Summary must not read originals');};
  const changes=f.sql.prepare('SELECT total_changes() n').get().n;
  const route=await import(moduleUrl('../app/api/gmail/[action]/route.ts',{'@/lib/gmail-service':f.apiUrl}));
  const summary=await(await route.GET(new Request(origin+'/api/gmail/status?summary=1&document=owned-document'))).json();
  assert.equal(summary.candidates,undefined);assert.equal(summary.runs,undefined);
  assert.equal(queries.some(query=>query.includes('s.metadata')||query.includes('SELECT revision,payload FROM workspaces')),false);
  assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,changes);
});
test('Q8: a preview-shaped review request cannot persist extraction, history or an invoice',async t=>{
  const f=await processingFixture(t);f.doc();
  const response=await f.api.gmailReview(post('review',{document_id:'doc-1',extraction:{fields:{party:{value:'Preview only'}}}}));
  assert.equal(response.status,200);assert.equal((await response.json()).saved,false);
  assert.equal(f.sql.prepare('SELECT extraction FROM gmail_sources').get().extraction,'{}');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);
});
for(const decision of ['confirm','reject'])test('Q8: explicit '+decision+' preserves the first browser extraction and history without overwriting it on replay',async t=>{
  const f=await processingFixture(t);f.doc();
  const extraction={fields:{party:{value:'Original supplier',confidence:.65}},text_excerpt:'Synthetic original evidence'};
  const invoice={direction:'payable',party:'Corrected supplier',number:'0007',total:312500,issued:'2026-10-24',due:'2026-11-07',kind:'invoice'},fields={currency:'SEK',vat_cents:'625.00',net_cents:'2500.00'};
  const body={document_id:'doc-1',[decision]:true,invoice,fields,extraction};
  await f.api.gmailReview(post('review',body));
  assert.deepEqual(JSON.parse(f.sql.prepare('SELECT extraction FROM gmail_sources').get().extraction),extraction);
  const savedHistory=f.sql.prepare('SELECT result FROM document_extractions').get();assert.ok(savedHistory,'The explicit decision must retain the original interpretation in history');assert.deepEqual(JSON.parse(savedHistory.result),extraction);
  await f.api.gmailReview(post('review',{...body,extraction:{fields:{party:{value:'Replacement'}}}}));
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,1);assert.deepEqual(JSON.parse(f.sql.prepare('SELECT extraction FROM gmail_sources').get().extraction),extraction);
  if(decision==='confirm')assert.deepEqual(JSON.parse(f.sql.prepare("SELECT detail FROM audit_events WHERE action='gmail.invoice.review'").get().detail).extraction,extraction);
  else assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);
});
test('Q8: confirmed review keeps existing worker extraction and history when browser values differ',async t=>{
  const f=await processingFixture(t);f.doc();await f.processing.processDocuments(f.owner);
  const before=f.sql.prepare('SELECT extraction FROM gmail_sources').get().extraction,history=f.sql.prepare('SELECT id,result FROM document_extractions').all();
  await f.api.gmailReview(post('review',{document_id:'doc-1',confirm:true,extraction:{fields:{party:{value:'New browser parse'}}},invoice:{direction:'payable',party:'Corrected supplier',number:'0007',total:312500,issued:'2026-10-24',due:'2026-11-07',kind:'invoice'},fields:{currency:'SEK',vat_cents:'625.00',net_cents:'2500.00'}}));
  assert.equal(f.sql.prepare('SELECT extraction FROM gmail_sources').get().extraction,before);assert.deepEqual(f.sql.prepare('SELECT id,result FROM document_extractions').all(),history);
});
test('Q8: review diagnostics expose only overlapping owner-scoped reason counts from saved interpretations',async t=>{
  const f=await processingFixture(t),base=f.fields.interpretInvoice(syntheticText(),{direction:'supplier',direction_confident:true});
  const add=(id,extraction,state='needs_review',status='needs_review')=>{f.doc(id);f.sql.prepare('UPDATE gmail_sources SET status=? WHERE document_id=?').run(status,id);f.sql.prepare('INSERT INTO document_jobs(owner,document_id,state,available_at,extraction,updated_at) VALUES(?,?,?,?,?,?)').run(f.owner,id,state,'2026-10-30',JSON.stringify(extraction),'2026-10-30');};
  add('private-no-text',{});
  const missing=structuredClone(base);for(const key of ['due_at','organization_number','total_cents'])missing.fields[key].value=null;add('private-missing',missing);
  const unknown=structuredClone(base);unknown.issues=['Motparten behöver verifieras för automatisk registrering.'];add('private-unknown-party',unknown);
  add('private-duplicate',base,'duplicate');const low=structuredClone(base);low.fields.party.confidence=.5;add('private-low-confidence',low);
  add('private-other',base);add('private-rejected',missing,'needs_review','rejected');add('private-registered',base,'registered','registered');
  const own=f.owner;f.owner='other-owner';add('foreign-private-document',missing);f.owner=own;
  let objectReads=0;f.env.BUCKET.get=async()=>{objectReads++;throw Error('Status must not read originals');};
  const before=f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,status=await (await f.api.gmailStatus(true)).json(),reasons=status.processing.review_reasons;
  assert.ok(reasons);assert.equal(reasons.basis,'stored_extraction');assert.equal(reasons.total,6);assert.equal(reasons.analyzed,6);assert.equal(reasons.truncated,false);
  assert.deepEqual(reasons.counts,{uninterpreted:1,missing_invoice_number:0,missing_party:0,missing_dates:1,missing_organization:1,missing_amount:1,missing_vat_or_net:0,unverified_counterparty:1,possible_duplicate:1,arithmetic_conflict:0,identity_conflict:0,table_incomplete:0,interrupted_after_extraction:0,low_confidence:1,other_review:1});
  assert.doesNotMatch(JSON.stringify(status),/private-|foreign-|Exempelbolaget|Fakturanummer|supplier@example|text_excerpt|fields/);assert.equal(objectReads,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,before);
});
test('Q8: review reason analysis is capped and reports partial coverage without returning document data',async t=>{
  const f=await processingFixture(t);
  for(let n=0;n<503;n++){const id='private-'+String(n).padStart(4,'0');f.doc(id);f.sql.prepare("INSERT INTO document_jobs(owner,document_id,state,available_at,extraction,updated_at) VALUES(?,?,'needs_review','2026-10-30','{}','2026-10-30')").run(f.owner,id);}
  const reasons=(await f.processing.processingStatus(f.owner)).review_reasons;
  assert.ok(reasons);assert.equal(reasons.limit,500);assert.equal(reasons.total,503);assert.equal(reasons.analyzed,500);assert.equal(reasons.truncated,true);assert.equal(reasons.counts.uninterpreted,500);assert.doesNotMatch(JSON.stringify(reasons),/private-/);assert.ok(JSON.stringify(reasons).length<1500);
});
test('Q8: malformed or oversized saved extraction has an honest diagnostic without breaking status',async t=>{
  const f=await processingFixture(t);
  for(const [id,extraction] of [['invalid','{broken'],['large',JSON.stringify({text_excerpt:'private '.repeat(8000),fields:{}})],['wrong-shape','{"fields":[]}']]){f.doc(id);f.sql.prepare("INSERT INTO document_jobs(owner,document_id,state,available_at,extraction,updated_at) VALUES(?,?,'failed','2026-10-30',?,'2026-10-30')").run(f.owner,id,extraction);}
  const reasons=(await f.processing.processingStatus(f.owner)).review_reasons;
  assert.ok(reasons);assert.equal(reasons.analyzed,3);assert.equal(reasons.counts.uninterpreted,3);assert.equal(reasons.counts.missing_dates,0);assert.doesNotMatch(JSON.stringify(reasons),/private|broken/);
});
test('review diagnostics distinguish arithmetic, identity, incomplete tables and interrupted accepted results',async t=>{
  const f=await processingFixture(t),base=f.fields.interpretInvoice(syntheticText(),{direction:'supplier',direction_confident:true});
  for(const [id,issue,tableStatus,errorCode] of [
    ['math','Momsberäkningen stämmer inte med totalbeloppet.','absent',''],
    ['identity','Motstridiga värden för mottagarens organisationsnummer. Kontrollera originalets identiteter.','absent',''],
    ['table','','incomplete',''],['interrupted','','absent','processing_interrupted_after_extraction'],
  ]){
    f.doc(id);const extraction={...base,issues:issue?[issue]:[],details:{...base.details,table_status:tableStatus}};
    f.sql.prepare("INSERT INTO document_jobs(owner,document_id,state,available_at,extraction,error_code,updated_at) VALUES(?,?,'needs_review','2026-10-30',?,?,'2026-10-30')").run(f.owner,id,JSON.stringify(extraction),errorCode);
  }
  const reasons=(await f.processing.processingStatus(f.owner)).review_reasons;
  for(const key of ['arithmetic_conflict','identity_conflict','table_incomplete','interrupted_after_extraction'])assert.equal(reasons.counts[key],1,key);
  assert.equal(reasons.counts.other_review,0);assert.equal(reasons.analyzed,4);
});
test('Q8: manual registration stays committed with a durable after-check warning when reconciliation fails',async t=>{
  const f=await processingFixture(t);f.doc();f.reconcileError=true;
  const route=await import(moduleUrl('../app/api/gmail/[action]/route.ts',{'@/lib/gmail-service':f.apiUrl}));
  const invoice={direction:'payable',party:'Exempelbolaget AB',number:'0007',total:312500,issued:'2026-10-24',due:'2026-11-07',kind:'invoice'};
  const fields={currency:'SEK',organization_number:'5560160680',vat_cents:'625.00',net_cents:'2500.00'};
  const response=await route.POST(post('review',{document_id:'doc-1',confirm:true,invoice,fields})),result=await response.json();
  assert.equal(response.status,200);assert.equal(result.registered,true);assert.equal(result.aftercheck_pending,true);assert.match(result.warning,/registrerad.*[Ee]fterkontroll/s);
  const state=JSON.parse(f.sql.prepare('SELECT payload FROM workspaces').get().payload),job=f.sql.prepare('SELECT * FROM document_jobs').get();
  assert.equal(state.invoices.length,1);assert.equal(result.invoice_id,state.invoices[0].id);
  assert.equal(job.state,'registered');assert.equal(job.invoice_id,result.invoice_id);assert.equal(job.error_code,'registration_aftercheck_pending');assert.equal(job.attempts,0);
  const status=await (await f.api.gmailStatus(true)).json();assert.equal(status.processing.aftercheck_pending,1);assert.equal(status.processing.registered,1);assert.equal(status.processing.counts.registered,1);
  const replay=await (await route.POST(post('review',{document_id:'doc-1',confirm:true,invoice,fields}))).json();
  assert.equal(replay.registered,true);assert.equal(replay.duplicate,true);assert.equal(replay.aftercheck_pending,true);assert.equal(replay.invoice_id,result.invoice_id);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,1);assert.equal(JSON.parse(f.sql.prepare('SELECT payload FROM workspaces').get().payload).invoices.length,1);
  assert.equal((await f.processing.processingStatus('other-owner')).aftercheck_pending,0);
  await f.processing.processingAction(post('retry',{document_id:'doc-1'}),'retry');
  assert.equal((await f.processing.processDocuments(f.owner)).processed,0);assert.equal(f.sql.prepare('SELECT error_code FROM document_jobs').get().error_code,'registration_aftercheck_pending');
});
test('Q8 review: concurrent confirmation acknowledges one receipt for the same document while another document stays blocked',async t=>{
  const f=await processingFixture(t);f.doc();f.reconcileError=true;
  const route=await import(moduleUrl('../app/api/gmail/[action]/route.ts',{'@/lib/gmail-service':f.apiUrl}));
  const body={document_id:'doc-1',confirm:true,invoice:{direction:'payable',party:'Exempelbolaget AB',number:'0007',total:312500,issued:'2026-10-24',due:'2026-11-07',kind:'invoice'},fields:{currency:'SEK',organization_number:'5560160680',vat_cents:'625.00',net_cents:'2500.00'}};
  const responses=await Promise.all([route.POST(post('review',body)),route.POST(post('review',body))]);
  assert.deepEqual(responses.map(r=>r.status),[200,200]);const results=await Promise.all(responses.map(r=>r.json()));
  assert.ok(results.every(r=>r.registered===true&&r.aftercheck_pending===true));assert.equal(new Set(results.map(r=>r.invoice_id)).size,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,1);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='gmail.invoice.review'").get().n,1);assert.equal(JSON.parse(f.sql.prepare('SELECT payload FROM workspaces').get().payload).invoices.length,1);
  const receipt=f.sql.prepare('SELECT * FROM document_registrations').get();f.doc('other-document');
  const rejected=await route.POST(post('review',{...body,document_id:'other-document'}));assert.equal(rejected.status,409);assert.match((await rejected.json()).error,/redan registrerad/);
  assert.deepEqual(f.sql.prepare('SELECT * FROM document_registrations').get(),receipt);assert.equal(f.sql.prepare("SELECT status FROM gmail_sources WHERE document_id='other-document'").get().status,'needs_review');
  f.user={userId:'other-owner'};const foreign=await route.POST(post('review',body));assert.equal(foreign.status,409);assert.equal((await foreign.json()).invoice_id,undefined);
});
test('Q8 review: a final processing timestamp failure preserves a committed invoice and reports missing metadata',async t=>{
  const f=await processingFixture(t);f.doc();f.reconcileError=true;
  f.sql.prepare('INSERT INTO invoice_counterparties(owner,identity,email,bankgiro,evidence,verified_at) VALUES(?,?,?,?,?,?)').run(f.owner,f.processing.counterpartyKey('supplier','Exempelbolaget AB','5560160680'),'supplier@example.test','123-4567','Synthetic verified supplier','2026-01-01');
  const prepare=f.d1.prepare.bind(f.d1);f.d1.prepare=query=>{const statement=prepare(query);if(query.startsWith('UPDATE document_automation SET last_cloud_run='))statement.run=async()=>{throw Error('synthetic private final timestamp failure');};return statement;};
  const result=await f.processing.processDocuments(f.owner);
  assert.equal(result.processed,1);assert.equal(result.registered,1);assert.equal(result.aftercheck_pending,1);assert.match(result.metadata_warning,/sparat.*tidsstämpel/s);assert.doesNotMatch(result.metadata_warning,/synthetic private/);
  assert.equal(result.last_processed,'');assert.equal(f.sql.prepare('SELECT last_cloud_run FROM document_automation').get().last_cloud_run,'');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,1);assert.equal(f.sql.prepare('SELECT error_code FROM document_jobs').get().error_code,'registration_aftercheck_pending');assert.equal(JSON.parse(f.sql.prepare('SELECT payload FROM workspaces').get().payload).invoices.length,1);
});
test('Q8 review: real cloud pull accepts saved OCR review evidence when its completion timestamp cannot be saved',async t=>{
  const f=await processingFixture(t);f.doc('pdf');f.pdfError='parse_timeout';f.reconcileError=true;
  f.sql.prepare('INSERT INTO invoice_counterparties(owner,identity,email,bankgiro,evidence,verified_at) VALUES(?,?,?,?,?,?)').run(f.owner,f.processing.counterpartyKey('supplier','Exempelbolaget AB','5560160680'),'supplier@example.test','123-4567','Synthetic verified supplier','2026-01-01');
  Object.assign(f.env,{DOCUMENT_CLOUD_OCR_ENABLED:'true',DOCUMENT_CLOUD_WORKER_TOKEN:'C'.repeat(43)});f.env.BUCKET.get=async()=>({size:f.bytes.length,body:f.bytes,arrayBuffer:async()=>f.bytes});
  const prepare=f.d1.prepare.bind(f.d1);f.d1.prepare=query=>{const statement=prepare(query);if(query.startsWith('UPDATE document_automation SET cloud_worker_completed='))statement.run=async()=>{throw Error('synthetic private completion timestamp failure');};return statement;};
  const {runSitesOcr}=await import('../../src/sites-ocr-pull.js');let completion;
  const result=await runSitesOcr({origin:'https://synthetic.example',token:f.env.DOCUMENT_CLOUD_WORKER_TOKEN,mode:'cloud'},{maxJobs:1,extract:async()=>({text:syntheticText(),method:'pdf',confidence:100}),fetchImpl:async(url,options)=>{
    try{const action=new URL(url).pathname.split('/').pop(),response=await f.processing.workerAction(new Request(url,options),action);if(action==='complete')completion=await response.clone().json();return response;}catch{return Response.json({error:'unavailable'},{status:500});}
  }});
  assert.deepEqual(result,{processed:1,failed:0});assert.equal(completion.state,'needs_review');assert.equal(completion.registered,undefined);assert.equal(completion.aftercheck_pending,undefined);assert.match(completion.metadata_warning,/sparat.*tidsstämpel/s);assert.doesNotMatch(completion.metadata_warning,/synthetic private/);
  assert.equal((await f.processing.processingStatus(f.owner)).cloud_last_completed,'');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);assert.equal(f.sql.prepare('SELECT error_code FROM document_jobs').get().error_code,'');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);
  const history=f.sql.prepare('SELECT result FROM document_extractions').all();assert.equal(history.length,1);assert.equal(JSON.parse(history[0].result).method,'ocr');assert.equal(JSON.parse(history[0].result).fields.invoice_number.confidence,.85);
});
test('Q8 review: a failed registration marker rolls back the entire financial commit',async t=>{
  const f=await processingFixture(t);f.doc();f.sql.exec("CREATE TRIGGER stop_marker BEFORE INSERT ON document_jobs BEGIN SELECT RAISE(ABORT,'synthetic marker failure'); END");
  await assert.rejects(f.processing.registerProcessedInvoice(f.owner,'doc-1',{direction:'payable',party:'Exempelbolaget AB',number:'0007',total:312500,issued:'2026-10-24',due:'2026-11-07',kind:'invoice'},{currency:'SEK',organization_number:'5560160680',vat_cents:62500,net_cents:250000}),/synthetic marker failure/);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_jobs').get().n,0);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='gmail.invoice.review'").get().n,0);assert.equal(f.sql.prepare('SELECT status FROM gmail_sources').get().status,'needs_review');assert.equal(JSON.parse(f.sql.prepare('SELECT payload FROM workspaces').get().payload).invoices.length,0);
});
test('Q8 review: a final processing metadata failure without accepted work still rejects',async t=>{
  const f=await processingFixture(t);f.doc();f.env.BUCKET.get=async()=>null;
  const prepare=f.d1.prepare.bind(f.d1);f.d1.prepare=query=>{const statement=prepare(query);if(query.startsWith('UPDATE document_automation SET last_cloud_run='))statement.run=async()=>{throw Error('synthetic timestamp failure before acceptance');};return statement;};
  await assert.rejects(f.processing.processDocuments(f.owner),/synthetic timestamp failure before acceptance/);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);assert.equal(f.sql.prepare('SELECT error_code FROM document_jobs').get().error_code,'original_integrity');
});
test('Q8 review: cloud metadata error handling cannot accept invalid OCR or a damaged original',async t=>{
  const f=await processingFixture(t);f.doc('scan','image/png');Object.assign(f.env,{DOCUMENT_CLOUD_OCR_ENABLED:'true',DOCUMENT_CLOUD_WORKER_TOKEN:'C'.repeat(43)});
  const call=(action,body={})=>f.processing.workerAction(new Request(origin+'/api/ocr-worker/'+action,{method:'POST',headers:{Authorization:'Bearer '+f.env.DOCUMENT_CLOUD_WORKER_TOKEN,'X-MG-OCR-Runner':'cloud','Content-Type':'application/json'},body:JSON.stringify(body)}),action);
  const job=(await (await call('lease')).json()).job;let metadataWrites=0;const prepare=f.d1.prepare.bind(f.d1);f.d1.prepare=query=>{const statement=prepare(query);if(query.startsWith('UPDATE document_automation SET cloud_worker_completed='))statement.run=async()=>{metadataWrites++;throw Error('unexpected completion metadata');};return statement;};
  const body={id:job.id,lease:job.lease,sha256:'0'.repeat(64),text:syntheticText(),method:'pdf',confidence:100};assert.equal((await call('complete',body)).status,400);
  f.env.BUCKET.get=async()=>null;assert.equal((await call('complete',{...body,sha256:f.sha})).status,409);
  assert.equal(metadataWrites,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,0);assert.equal((await f.processing.processingStatus(f.owner)).cloud_last_completed,'');
});
test('Q8 finalizer: final status read failure preserves accepted work without inventing queue counts or timestamps',async t=>{
  const f=await processingFixture(t);f.doc();f.reconcileError=true;
  f.sql.prepare('INSERT INTO invoice_counterparties(owner,identity,email,bankgiro,evidence,verified_at) VALUES(?,?,?,?,?,?)').run(f.owner,f.processing.counterpartyKey('supplier','Exempelbolaget AB','5560160680'),'supplier@example.test','123-4567','Synthetic verified supplier','2026-01-01');
  const prepare=f.d1.prepare.bind(f.d1);f.d1.prepare=query=>{const statement=prepare(query);if(query.startsWith('SELECT enabled,auto_register,worker_seen,'))statement.first=async()=>{throw Error('private final status read unavailable');};return statement;};
  const response=await f.processing.processingAction(post('process'),'process'),result=await response.json();
  assert.equal(response.status,200);assert.equal(result.processed,1);assert.equal(result.status_unknown,true);assert.match(result.metadata_warning,/sparat.*status/s);assert.doesNotMatch(JSON.stringify(result),/private/);
  for(const key of ['counts','registered','last_processed','cloud_last_completed','enabled','review_reasons'])assert.equal(key in result,false,key+' must remain unknown');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,1);assert.equal(f.sql.prepare('SELECT error_code FROM document_jobs').get().error_code,'registration_aftercheck_pending');assert.equal(JSON.parse(f.sql.prepare('SELECT payload FROM workspaces').get().payload).invoices.length,1);
});
test('Q8 finalizer: final status read failure before accepted work remains an error',async t=>{
  const f=await processingFixture(t);const prepare=f.d1.prepare.bind(f.d1);f.d1.prepare=query=>{const statement=prepare(query);if(query.startsWith('SELECT enabled,auto_register,worker_seen,'))statement.first=async()=>{throw Error('status unavailable before acceptance');};return statement;};
  await assert.rejects(f.processing.processDocuments(f.owner),/status unavailable before acceptance/);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,0);
});
for(const phase of ['next claim','failure write','OCR fallback write'])test('Q8 finalizer: a later '+phase+' failure cannot hide an earlier accepted invoice',async t=>{
  const f=await processingFixture(t);f.doc('first');f.doc('second');f.reconcileError=true;
  f.sql.prepare('INSERT INTO invoice_counterparties(owner,identity,email,bankgiro,evidence,verified_at) VALUES(?,?,?,?,?,?)').run(f.owner,f.processing.counterpartyKey('supplier','Exempelbolaget AB','5560160680'),'supplier@example.test','123-4567','Synthetic verified supplier','2026-01-01');
  const prepare=f.d1.prepare.bind(f.d1);let claims=0;f.d1.prepare=query=>{const statement=prepare(query);
    if(query.startsWith('SELECT document_jobs.*,d.mime,d.size,d.sha256')){const first=statement.first;statement.first=async function(){claims++;if(claims===2){if(phase==='next claim')throw Error('private next claim failure');f.pdfError=phase==='failure write'?'page_limit':'parse_timeout';}return first.call(this);};}
    if(phase==='failure write'&&query.startsWith('UPDATE document_jobs SET state=?,error_code='))statement.run=async()=>{throw Error('private failure recording unavailable');};
    if(phase==='OCR fallback write'&&query.startsWith("UPDATE document_jobs SET state='waiting_ocr',engine='local'"))statement.run=async()=>{throw Error('private fallback recording unavailable');};
    return statement;
  };
  const result=await f.processing.processDocuments(f.owner);assert.equal(result.processed,1);assert.equal(result.status_unknown,true);assert.equal('counts' in result,false);assert.match(result.metadata_warning,/sparat.*status/s);assert.doesNotMatch(JSON.stringify(result),/private/);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,1);assert.equal(f.sql.prepare("SELECT state FROM document_jobs WHERE document_id='first'").get().state,'registered');assert.notEqual(f.sql.prepare("SELECT state FROM document_jobs WHERE document_id='second'").get().state,'registered');
});
test('Q8 finalizer: real cloud process consumer keeps the accepted server count and stops on unknown status',async t=>{
  const f=await processingFixture(t);f.doc();f.reconcileError=true;Object.assign(f.env,{DOCUMENT_CLOUD_OCR_ENABLED:'true',DOCUMENT_CLOUD_WORKER_TOKEN:'C'.repeat(43)});
  f.sql.prepare('INSERT INTO invoice_counterparties(owner,identity,email,bankgiro,evidence,verified_at) VALUES(?,?,?,?,?,?)').run(f.owner,f.processing.counterpartyKey('supplier','Exempelbolaget AB','5560160680'),'supplier@example.test','123-4567','Synthetic verified supplier','2026-01-01');
  const prepare=f.d1.prepare.bind(f.d1);f.d1.prepare=query=>{const statement=prepare(query);if(query.startsWith('SELECT enabled,auto_register,worker_seen,'))statement.first=async()=>{throw Error('private status read failure');};return statement;};
  const {runSitesOcr}=await import('../../src/sites-ocr-pull.js'),calls=[];let serverResult;
  const result=await runSitesOcr({origin:'https://synthetic.example',token:f.env.DOCUMENT_CLOUD_WORKER_TOKEN,mode:'cloud'},{fetchImpl:async(url,options)=>{const action=new URL(url).pathname.split('/').pop();calls.push(action);try{const response=await f.processing.workerAction(new Request(url,options),action);if(action==='process')serverResult=await response.clone().json();return response;}catch{return Response.json({error:'unavailable'},{status:409});}},extract:async()=>{throw Error('No new extraction after unknown status');}});
  assert.deepEqual(result,{processed:1,failed:0,status_unknown:true});assert.deepEqual(calls,['process']);assert.equal(serverResult.processed,1);assert.equal(serverResult.status_unknown,true);assert.equal('waiting' in serverResult,false);assert.equal('failed' in serverResult,false);assert.equal('counts' in serverResult,false);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,1);
});
for(const phase of ['completion stamp','lock cleanup'])for(const unknown of [false,true])test('Q8 finalizer: Gmail '+phase+' failure retains accepted processing with '+(unknown?'unknown':'known')+' queue status',async t=>{
  const f=await processingFixture(t),flow=await connect(f);await f.api.gmailCallback(flow.callback());f.doc();
  f.sql.prepare('UPDATE gmail_sources SET source_id=?').run('gmail:mg.vitvaror@gmail.com:archived:1');
  f.sql.prepare('INSERT INTO invoice_counterparties(owner,identity,email,bankgiro,evidence,verified_at) VALUES(?,?,?,?,?,?)').run(f.owner,f.processing.counterpartyKey('supplier','Exempelbolaget AB','5560160680'),'supplier@example.test','123-4567','Synthetic verified supplier','2026-01-01');
  const prepare=f.d1.prepare.bind(f.d1),batch=f.d1.batch.bind(f.d1);f.d1.prepare=query=>{const statement=prepare(query);
    if(unknown&&query.startsWith('SELECT enabled,auto_register,worker_seen,'))statement.first=async()=>{throw Error('private queue status unavailable');};
    if(phase==='lock cleanup'&&query.startsWith('DELETE FROM gmail_locks WHERE owner=? AND token=?'))statement.run=async()=>{throw Error('private cleanup unavailable');};
    return statement;
  };
  if(phase==='completion stamp')f.d1.batch=async items=>{if(items.some(item=>item.query.startsWith("UPDATE gmail_runs SET status='completed'")))throw Error('private completion stamp unavailable');return batch(items);};
  const response=await f.api.gmailSync(post('sync')),result=await response.json();
  assert.equal(response.status,200);assert.equal(result.processing.processed,1);assert.equal(result.processing.status_unknown,unknown);assert.equal(result.status_unknown,true);assert.match(result.metadata_warning,/sparat.*Gmail.*slutstatus/s);assert.doesNotMatch(JSON.stringify(result),/private/);
  if(unknown){assert.equal('counts' in result.processing,false);assert.match(result.processing.metadata_warning,/sparat.*status/s);}
  assert.equal(result.imported,0);assert.equal(result.duplicates,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,1);assert.equal(JSON.parse(f.sql.prepare('SELECT payload FROM workspaces').get().payload).invoices.length,1);
  assert.equal(f.sql.prepare('SELECT status FROM gmail_runs').get().status,phase==='completion stamp'?'completed_pending':'completed');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM gmail_locks').get().n,phase==='lock cleanup'?1:0);
});
test('Q8 finalizer: Gmail cleanup failure before accepted processing remains an error',async t=>{
  const f=await fixture(t),flow=await connect(f);await f.api.gmailCallback(flow.callback());f.reconcileError=true;
  const prepare=f.d1.prepare.bind(f.d1);f.d1.prepare=query=>{const statement=prepare(query);if(query.startsWith('DELETE FROM gmail_locks WHERE owner=? AND token=?'))statement.run=async()=>{throw Error('cleanup unavailable before accepted processing');};return statement;};
  await assert.rejects(f.api.gmailSync(post('sync')),/cleanup unavailable before accepted processing/);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,0);assert.equal(f.sql.prepare('SELECT status FROM gmail_runs').get().status,'completed_pending');
});
test('Q8: an automatic invoice committed before a failed after-check counts as processed',async t=>{
  const f=await processingFixture(t);f.doc();f.reconcileError=true;
  f.sql.prepare('INSERT INTO invoice_counterparties(owner,identity,email,bankgiro,evidence,verified_at) VALUES(?,?,?,?,?,?)').run(f.owner,f.processing.counterpartyKey('supplier','Exempelbolaget AB','5560160680'),'supplier@example.test','123-4567','Synthetic verified supplier','2026-01-01');
  const result=await f.processing.processDocuments(f.owner);
  assert.equal(result.processed,1);assert.equal(result.registered,1);assert.equal(result.aftercheck_pending,1);
  assert.equal(f.sql.prepare('SELECT state FROM document_jobs').get().state,'registered');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,1);
  assert.equal(JSON.parse(f.sql.prepare('SELECT payload FROM workspaces').get().payload).invoices.length,1);
});
test('Q8: real registration and reconciliation recover the same receipt and remove the warning on reload',async t=>{
  const f=await processingFixture(t,{realAftercheck:true});f.doc();
  const body={document_id:'doc-1',confirm:true,invoice:{direction:'payable',party:'Exempelbolaget AB',number:'0007',total:312500,issued:'2026-10-24',due:'2026-11-07',kind:'invoice'},fields:{currency:'SEK',organization_number:'5560160680',vat_cents:'625.00',net_cents:'2500.00'}};
  const batch=f.d1.batch.bind(f.d1);f.d1.batch=async rows=>{if(rows.some(r=>/\bUPDATE reconciliation_findings\b/.test(r.query)))throw Error('Synthetic derived-check outage');return batch(rows);};
  const committed=await (await f.api.gmailReview(post('review',body))).json();assert.equal(committed.registered,true);assert.equal(committed.aftercheck_pending,true);
  const receipt=f.sql.prepare('SELECT * FROM document_registrations').get();assert.equal((await (await f.api.gmailStatus(true)).json()).processing.aftercheck_pending,1);
  f.d1.batch=batch;await f.customerApi.reconcileAndPrepare(f.owner);
  const replay=await (await f.api.gmailReview(post('review',body))).json();assert.equal(replay.registered,true);assert.equal(replay.aftercheck_pending,false);assert.equal(replay.invoice_id,committed.invoice_id);
  assert.equal((await (await f.api.gmailStatus(true)).json()).processing.aftercheck_pending,0);assert.deepEqual(f.sql.prepare('SELECT * FROM document_registrations').get(),receipt);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,0);
  f.doc('doc-2');const next=await (await f.api.gmailReview(post('review',{...body,document_id:'doc-2',invoice:{...body.invoice,number:'0008'}}))).json();assert.equal(next.registered,true);assert.equal(next.aftercheck_pending,false);assert.equal(next.warning,undefined);
  assert.equal(JSON.parse(f.sql.prepare('SELECT payload FROM workspaces').get().payload).invoices.length,2);assert.equal(f.providerCalls,0);
});
test('Q8: real cloud pull accepts a server-PDF committed invoice when only its after-check needs recovery',async t=>{
  const f=await processingFixture(t);f.doc('pdf');f.reconcileError=true;
  f.sql.prepare('INSERT INTO invoice_counterparties(owner,identity,email,bankgiro,evidence,verified_at) VALUES(?,?,?,?,?,?)').run(f.owner,f.processing.counterpartyKey('supplier','Exempelbolaget AB','5560160680'),'supplier@example.test','123-4567','Synthetic verified supplier','2026-01-01');
  Object.assign(f.env,{DOCUMENT_CLOUD_OCR_ENABLED:'true',DOCUMENT_CLOUD_WORKER_TOKEN:'C'.repeat(43)});
  f.env.BUCKET.get=async()=>({size:f.bytes.length,body:f.bytes,arrayBuffer:async()=>f.bytes});
  const {runSitesOcr}=await import('../../src/sites-ocr-pull.js');
  const result=await runSitesOcr({origin:'https://synthetic.example',token:f.env.DOCUMENT_CLOUD_WORKER_TOKEN,mode:'cloud'},{maxJobs:1,extract:async()=>{throw Error('Native server PDF must not be sent to OCR');},fetchImpl:async(url,options)=>f.processing.workerAction(new Request(url,options),new URL(url).pathname.split('/').pop())});
  assert.equal(result.processed,1);assert.equal(result.failed,0);assert.equal(result.aftercheck_pending,true);const status=await f.processing.processingStatus(f.owner);assert.ok(status.last_processed);assert.equal(status.cloud_last_completed,'');assert.equal(status.aftercheck_pending,1);
  assert.equal(f.sql.prepare('SELECT state FROM document_jobs').get().state,'registered');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,1);
  const extraction=JSON.parse(f.sql.prepare('SELECT extraction FROM document_jobs').get().extraction);assert.equal(extraction.method,'pdf');assert.equal(extraction.fields.invoice_number.confidence,.96);
});
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
  assert.equal(JSON.parse(f.sql.prepare('SELECT extraction FROM gmail_sources').get().extraction).version,3);
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

for(const [first,second] of [['AB-0594','AB0594'],['AB/0594','AB_0594']])test(`document queue: ${second} is distinct from ${first} even with a legacy registration key`,async t=>{
  const f=await processingFixture(t),key=f.processing.counterpartyKey('supplier','Exempelbolaget AB','5560160680');
  f.sql.prepare('INSERT INTO invoice_counterparties(owner,identity,email,bankgiro,evidence,verified_at) VALUES(?,?,?,?,?,?)').run(f.owner,key,'supplier@example.test','123-4567','Synthetic verified supplier','2026-01-01');
  f.pdfResult.text=syntheticText(first);f.doc('legacy');await f.processing.processDocuments(f.owner);
  f.sql.prepare("UPDATE document_registrations SET identity=? WHERE document_id='legacy'").run('["payable","5560160680","ab0594"]');
  f.pdfResult.text=syntheticText(second);f.doc('next');await f.processing.processDocuments(f.owner);
  assert.equal(f.sql.prepare("SELECT state FROM document_jobs WHERE document_id='next'").get().state,'registered');
  assert.deepEqual(JSON.parse(f.sql.prepare('SELECT payload FROM workspaces').get().payload).invoices.map(invoice=>invoice.number),[first,second]);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,2);
  assert.equal(f.sql.prepare("SELECT identity FROM document_registrations WHERE document_id='legacy'").get().identity,'["payable","5560160680","ab0594"]');
  f.pdfResult.text=syntheticText(second.toLowerCase());f.doc('copy');await f.processing.processDocuments(f.owner);
  assert.equal(f.sql.prepare("SELECT state FROM document_jobs WHERE document_id='copy'").get().state,'duplicate');
  assert.equal(JSON.parse(f.sql.prepare('SELECT payload FROM workspaces').get().payload).invoices.length,2);
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

test('invoice reference policy preserves the original declaration when a review changes editable fields',async t=>{
  const f=await processingFixture(t);f.doc('policy-original','application/pdf',{direction:'customer',direction_confident:true,from:'company@example.test',to:'customer@example.test',subject:'Synthetic own invoice'});
  const extraction={fields:{invoice_number:{value:'0599'},reference:{value:'0600'}},details:{supplier:{name:'M.George Vitvaror AB'}}};
  f.sql.prepare('UPDATE gmail_sources SET extraction=? WHERE document_id=?').run(JSON.stringify(extraction),'policy-original');
  const invoice={direction:'receivable',party:'Synthetic customer AB',number:'0599',ocr:'0599',total:312500,issued:'2026-10-24',due:'2026-11-07',kind:'invoice'};
  const fields={currency:'SEK',organization_number:'5560160680',vat_cents:62500,net_cents:250000};
  await assert.rejects(f.processing.registerProcessedInvoice(f.owner,'policy-original',invoice,fields,{automatic:true,sha256:f.sha}),/referens/i);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);
  await f.processing.registerProcessedInvoice(f.owner,'policy-original',invoice,fields);
  const state=JSON.parse(f.sql.prepare('SELECT payload FROM workspaces').get().payload),saved=state.invoices[0];
  assert.equal(saved.number,'0599');assert.equal(saved.ocr,'0599');
  assert.deepEqual(saved.referenceOriginal,{invoice_number:'0599',reference:'0600',issuer_name:'M.George Vitvaror AB'});
  assert.equal(domain.invoiceReferenceDecision(state,saved).status,'BLOCKED');
  assert.equal(domain.balance(state,saved),312500);assert.equal(state.allocations.length,0);
  assert.equal(f.sql.prepare('SELECT extraction FROM gmail_sources').get().extraction,JSON.stringify(extraction));
});

for(const missing of [true,false])test('reviewed invoice registration requires the retained original to be '+(missing?'available':'unchanged'),async t=>{
  const f=await processingFixture(t);f.doc();
  if(missing)f.env.BUCKET.get=async()=>null;
  else f.bytes=Buffer.alloc(f.bytes.length,88);
  await assert.rejects(f.processing.registerProcessedInvoice(f.owner,'doc-1',{direction:'payable',party:'Exempelbolaget AB',number:'0007',total:312500,issued:'2026-10-24',due:'2026-11-07',kind:'invoice'},{currency:'SEK',organization_number:'5560160680',vat_cents:62500,net_cents:250000}),/Originalunderlaget/);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);
  assert.equal(f.sql.prepare('SELECT status FROM gmail_sources').get().status,'needs_review');
  assert.equal(f.sql.prepare('SELECT sha256 FROM documents').get().sha256,f.sha);
});

test('automatic registration rechecks retained original after PDF interpretation',async t=>{
  const f=await processingFixture(t),key=f.processing.counterpartyKey('supplier','Exempelbolaget AB','5560160680');
  f.sql.prepare('INSERT INTO invoice_counterparties(owner,identity,email,bankgiro,evidence,verified_at) VALUES(?,?,?,?,?,?)').run(f.owner,key,'supplier@example.test','123-4567','Synthetic verified supplier','2026-01-01');f.doc();
  const prepare=f.d1.prepare.bind(f.d1);let changed=false;
  f.d1.prepare=query=>{
    const statement=prepare(query);
    if(query==='SELECT * FROM document_automation WHERE owner=?'){
      const first=statement.first.bind(statement);
      statement.first=async()=>{const result=await first();f.bytes=Buffer.alloc(f.bytes.length,88);changed=true;return result;};
    }
    return statement;
  };
  await f.processing.processDocuments(f.owner);
  assert.equal(changed,true);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM workspaces').get().n,0);
  assert.equal(f.sql.prepare('SELECT state FROM document_jobs').get().state,'needs_review');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,1,'earlier interpretation remains in history');
});

test('document metadata changed at the registration write boundary cannot use an earlier original check',async t=>{
  const f=await processingFixture(t);f.doc();
  const batch=f.d1.batch.bind(f.d1);let changed=false;
  f.d1.batch=async items=>{if(!changed){changed=true;f.sql.prepare("UPDATE documents SET sha256=? WHERE id='doc-1'").run('0'.repeat(64));}return batch(items);};
  await assert.rejects(f.processing.registerProcessedInvoice(f.owner,'doc-1',{direction:'payable',party:'Exempelbolaget AB',number:'0007',total:312500,issued:'2026-10-24',due:'2026-11-07',kind:'invoice'},{currency:'SEK',organization_number:'5560160680',vat_cents:62500,net_cents:250000}),/Originalunderlaget/);
  assert.equal(changed,true);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);
  assert.equal(JSON.parse(f.sql.prepare('SELECT payload FROM workspaces').get().payload).invoices.length,0);
  assert.equal(f.sql.prepare('SELECT status FROM gmail_sources').get().status,'needs_review');
});

test('automatic server-PDF registration rechecks lease expiry under the database write clock',async t=>{
  const f=await processingFixture(t),key=f.processing.counterpartyKey('supplier','Exempelbolaget AB','5560160680');
  f.sql.prepare('INSERT INTO invoice_counterparties(owner,identity,email,bankgiro,evidence,verified_at) VALUES(?,?,?,?,?,?)').run(f.owner,key,'supplier@example.test','123-4567','Synthetic verified supplier','2026-01-01');f.doc();
  const at=Date.now();
  t.mock.timers.enable({apis:['Date'],now:at-60000});
  const batch=f.d1.batch.bind(f.d1);let writes=0;
  f.d1.batch=async items=>{writes++;if(writes===2)f.sql.prepare('UPDATE document_jobs SET lease_until=?').run(new Date(at-1000).toISOString());return batch(items);};
  await f.processing.processDocuments(f.owner);
  assert.equal(writes,2);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_registrations').get().n,0);
  assert.equal(JSON.parse(f.sql.prepare('SELECT payload FROM workspaces').get().payload).invoices.length,0);
  assert.equal(f.sql.prepare('SELECT status FROM gmail_sources').get().status,'needs_review');
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


test('Sites Gmail scheduled failures stop after three persisted attempts and a manual success recovers',async t=>{
 const f=await fixture(t,{automatic:true}),flow=await connect(f);await f.api.gmailCallback(flow.callback());f.retryAfter='1';
 for(let n=1;n<=3;n++){
  f.sql.prepare("UPDATE gmail_connections SET last_attempt='',retry_after=''").run();
  await assert.rejects(f.api.gmailSync(undefined,true),e=>e.code==='rate_limited');
  assert.equal(f.sql.prepare('SELECT sync_failures FROM gmail_connections').get().sync_failures,n);
 }
 const calls=f.providerCalls;assert.equal((await(await f.api.gmailSync(undefined,true)).json()).status,'blocked');assert.equal(f.providerCalls,calls);
 const status=await(await f.api.gmailStatus()).json();assert.equal(status.connection.blocked,true);assert.equal(status.next_eligible_sync,null);
 f.retryAfter='';f.sql.prepare("UPDATE gmail_connections SET retry_after=''").run();await f.api.gmailSync(post('sync'));
 assert.equal(f.sql.prepare('SELECT sync_failures FROM gmail_connections').get().sync_failures,0);assert.equal(f.sql.prepare('SELECT status FROM gmail_connections').get().status,'connected');
});

test('three interrupted Sites Gmail reservations cannot silently retry forever',async t=>{
 const f=await fixture(t,{automatic:true}),flow=await connect(f);await f.api.gmailCallback(flow.callback());
 f.messageReached=()=>f.sql.prepare("UPDATE gmail_locks SET token='replacement',expires_at=?").run(new Date(Date.now()+60000).toISOString());
 for(let n=1;n<=3;n++){
  f.sql.prepare('DELETE FROM gmail_locks').run();f.sql.prepare("UPDATE gmail_connections SET last_attempt=''").run();
  await assert.rejects(f.api.gmailSync(undefined,true),e=>e.code==='gmail_lease_lost');
  assert.equal(f.sql.prepare('SELECT sync_failures FROM gmail_connections').get().sync_failures,n);
 }
 f.sql.prepare('DELETE FROM gmail_locks').run();assert.equal((await(await f.api.gmailSync(undefined,true)).json()).status,'blocked');
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM documents').get().n,0);
});


test('committed Gmail retrieval stays successful if document after-checks need retrying',async t=>{
 const f=await fixture(t,{automatic:true}),flow=await connect(f);await f.api.gmailCallback(flow.callback());f.reconcileError=true;
 const result=await(await f.api.gmailSync(undefined,true)).json();assert.equal(result.imported,1);assert.match(result.warning,/Efterkontrollen/);assert.equal(result.processing.status,'pending');assert.equal(f.sql.prepare('SELECT status FROM gmail_connections').get().status,'connected');assert.equal(f.sql.prepare('SELECT sync_failures FROM gmail_connections').get().sync_failures,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM gmail_runs').get().n,1);assert.equal(f.sql.prepare('SELECT status FROM gmail_runs').get().status,'completed_pending');
 const status=await(await f.api.gmailStatus()).json();assert.equal(status.connection.status,'connected');assert.match(status.connection.postprocess_warning,/Efterkontrollen/);assert.ok(status.last_successful_fetch);assert.equal(status.connection.sync_failures,0);
 f.reconcileError=false;await f.api.gmailSync(post('sync'));const recovered=await(await f.api.gmailStatus()).json();assert.equal(recovered.connection.postprocess_warning,null);
});

test('read-only Gmail status does not initialize automation or expose sealed credentials',async t=>{
 const f=await fixture(t),flow=await connect(f);await f.api.gmailCallback(flow.callback());
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_automation').get().n,0);
 const status=await(await f.api.gmailStatus(true)).json();
 assert.equal(status.connection.status,'connected');
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM document_automation').get().n,0);
 assert.equal(status.connection.tokens,undefined);
 assert.doesNotMatch(JSON.stringify(status),/synthetic-refresh|synthetic-access/);
});

test('Gmail MCP status is bounded and excludes invoice bodies and document workspace reads',async t=>{
 const f=await fixture(t),flow=await connect(f);await f.api.gmailCallback(flow.callback());
 f.sql.prepare("INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES('private-document',?,'invoice.pdf','application/pdf',10,'synthetic-hash','2026-10-30')").run(f.owner);
 f.sql.prepare("INSERT INTO gmail_sources(owner,source_id,document_id,metadata,status,extraction,created_at) VALUES(?,'source','private-document','{}','needs_review',?,'2026-10-30')").run(f.owner,JSON.stringify({text_excerpt:'synthetic-private-document '.repeat(2000)}));
 const service=data(`export async function automaticSync(){throw Error('unexpected mutation');}export async function automaticSyncStatus(){return Response.json({});}export function bankFailure(){return Response.json({error:'unexpected'},{status:409});}`);
 const rpc=await import(moduleUrl('../lib/banking/mcp.ts',{'./service':service,'../gmail-service':f.apiUrl}));
 let documentReads=0;const prepare=f.d1.prepare.bind(f.d1);
 f.d1.prepare=query=>{if(/SELECT s\.document_id|SELECT revision,payload/.test(query))documentReads++;return prepare(query);};
 const body=await(await rpc.bankRpc({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'gmail_sync_status',arguments:{}}})).json();
 assert.equal(body.result.isError,undefined);
 assert.equal(body.result.structuredContent.connection.status,'connected');
 assert.equal(body.result.structuredContent.candidates,undefined);
 assert.equal(documentReads,0);
 assert.doesNotMatch(JSON.stringify(body),/synthetic-private-document/);
 assert.ok(JSON.stringify(body).length<12000);
 f.user=null;
 const denied=await(await rpc.bankRpc({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'gmail_sync_status',arguments:{}}})).json();
 assert.equal(denied.result.isError,true);
});

test('rating8: a recent manual Gmail fetch cannot prove background readiness while the external schedule is unverified',async t=>{
 const f=await fixture(t,{automatic:true}),flow=await connect(f);await f.api.gmailCallback(flow.callback());
 await f.api.gmailSync(post('sync'));
 const result=await(await f.api.gmailStatus(true)).json();
 assert.equal(result.sync_health.state,'recent');
 assert.equal(result.schedule_observation.external_schedule_verified,false);
 assert.equal(result.background_ready,false);
 assert.equal(result.fetch_ready,true);
 assert.ok(result.background_health.reasons.includes('external_schedule_unverified'));
});

test('rating8: stalled OCR remains visible after a successful Gmail fetch without exposing documents',async t=>{
 const f=await processingFixture(t,{automatic:true}),flow=await connect(f);await f.api.gmailCallback(flow.callback());
 Object.assign(f.env,{DOCUMENT_CLOUD_OCR_ENABLED:'true',DOCUMENT_CLOUD_WORKER_TOKEN:randomToken()});
 f.doc('private-synthetic-image','image/png');await f.processing.enqueueDocuments(f.owner);
 f.sql.prepare("INSERT INTO gmail_runs(id,owner,status,created_at) VALUES('fresh-fetch',?,'completed',?)").run(f.owner,new Date().toISOString());
 const result=await(await f.api.gmailStatus(true)).json();
 assert.equal(result.sync_health.state,'recent');assert.equal(result.background_ready,false);
 assert.ok(result.background_health.reasons.includes('ocr_worker_unavailable'));
 assert.doesNotMatch(JSON.stringify(result),/private-synthetic-image/);
 f.sql.prepare('UPDATE document_automation SET cloud_worker_seen=? WHERE owner=?').run(new Date().toISOString(),f.owner);
 const fresh=await(await f.api.gmailStatus(true)).json();
 assert.equal(fresh.background_health.reasons.includes('ocr_worker_unavailable'),false);
 assert.equal(fresh.background_ready,false,'OCR heartbeat is not external schedule proof');
 f.sql.prepare("UPDATE document_automation SET cloud_worker_seen='',worker_seen=? WHERE owner=?").run(new Date().toISOString(),f.owner);
 const fallback=await(await f.api.gmailStatus(true)).json();
 assert.equal(fallback.background_health.reasons.includes('ocr_worker_unavailable'),false,'A live local fallback can drain the same OCR queue');
});

test('Gmail status distinguishes configured scheduling from observed successful execution',async t=>{
 const f=await fixture(t),flow=await connect(f);await f.api.gmailCallback(flow.callback());
 f.env.DOCUMENT_SCHEDULER_CONFIGURED='true';f.env.DOCUMENT_SCHEDULE_MINUTES='60';
 f.sql.prepare('INSERT INTO document_automation(owner,email,enabled,updated_at) VALUES(?,?,1,?)').run(f.owner,f.user.email,new Date().toISOString());
 const inspect=async()=>await(await f.api.gmailStatus(true)).json();
 let result=await inspect();assert.equal(result.sync_health.state,'not_verified');assert.equal(result.background_ready,false);assert.equal(result.sync_health.schedule_verified,false);
 const insert=f.sql.prepare("INSERT INTO gmail_runs(id,owner,found,imported,duplicates,status,created_at) VALUES('health-run',?,0,0,0,'completed',?)");
 insert.run(f.owner,new Date(Date.now()-24*3600000).toISOString());
 result=await inspect();assert.equal(result.sync_health.state,'stale');assert.equal(result.background_ready,false);
 f.sql.prepare('UPDATE gmail_runs SET created_at=?').run(new Date().toISOString());
 result=await inspect();assert.equal(result.sync_health.state,'recent');assert.equal(result.fetch_ready,true);assert.equal(result.background_ready,false);assert.equal(result.sync_health.schedule_verified,false);
 f.sql.prepare('UPDATE gmail_runs SET created_at=?').run(new Date(Date.now()+3600000).toISOString());
 result=await inspect();assert.equal(result.sync_health.state,'not_verified');assert.equal(result.background_ready,false);
 f.sql.prepare('UPDATE gmail_runs SET created_at=?').run(new Date().toISOString());
 f.sql.prepare("UPDATE gmail_connections SET sync_failures=3,status='blocked'").run();
 result=await inspect();assert.equal(result.sync_health.state,'blocked');assert.equal(result.next_eligible_sync,null);
 f.sql.prepare("UPDATE gmail_connections SET sync_failures=0,status='connected',retry_after=?").run(new Date(Date.now()+3600000).toISOString());
 result=await inspect();assert.equal(result.sync_health.state,'waiting');assert.equal(result.background_ready,false);
 f.sql.prepare("UPDATE gmail_connections SET retry_after='' ").run();
 f.sql.prepare('UPDATE document_automation SET enabled=0').run();
 result=await inspect();assert.equal(result.sync_health.state,'paused');assert.equal(result.background_ready,false);
 f.sql.prepare('UPDATE document_automation SET enabled=1').run();f.env.DOCUMENT_SCHEDULER_CONFIGURED='false';
 result=await inspect();assert.equal(result.sync_health.state,'not_configured');assert.equal(result.background_ready,false);
 f.sql.prepare('DELETE FROM gmail_connections').run();
 result=await inspect();assert.equal(result.sync_health.state,'disconnected');assert.equal(result.background_ready,false);
});

// These cases exercise real scoped UPDATE effects through MCP, not a mocked retry.
async function retryMcp(f,args,method='tools/call'){
 const service=data(`export async function automaticSync(){throw Error('unexpected bank');}export async function automaticSyncStatus(){throw Error('unexpected bank');}export function bankFailure(error){return Response.json({error:error.message==='AUTH_REQUIRED'?'AUTH_REQUIRED':'operation_failed'},{status:409});}`);
 const rpc=await import(moduleUrl('../lib/banking/mcp.ts',{'./service':service,'../server':f.serverUrl,'../document-processing':f.processingUrl,'../backups':data(`export async function runOwnerBackup(){throw Error('unexpected backup');}`)}));
 return (await rpc.bankRpc({jsonrpc:'2.0',id:1,method,params:method==='tools/call'?{name:'retry_invoice_document',arguments:args}:{}})).json();
}
function retryRow(f,{id='retry-doc',state='needs_review',engine='cloud',status='needs_review'}={}){
 f.doc(id);f.sql.prepare('UPDATE gmail_sources SET status=? WHERE owner=? AND document_id=?').run(status,f.owner,id);
 f.sql.prepare('INSERT INTO document_jobs(owner,document_id,state,engine,attempts,available_at,lease,lease_until,extraction,error_code,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(f.owner,id,state,engine,3,'2000-01-01','retained-lease','2099-01-01','{"retained":"synthetic interpretation"}','retained-error','2000-01-01');
}
const retrySnapshot=f=>Object.fromEntries(['documents','gmail_sources','document_extractions','document_registrations','invoice_counterparties','workspaces','audit_events'].map(table=>[table,f.sql.prepare('SELECT * FROM '+table).all()]));

test('retry MCP advertises one document selector and an explicit queue mutation',async t=>{
 const f=await processingFixture(t),result=await retryMcp(f,{},'tools/list'),tool=result.result.tools.find(t=>t.name==='retry_invoice_document');
 assert.ok(tool);assert.deepEqual(Object.keys(tool.inputSchema.properties),['documentId']);assert.deepEqual(tool.inputSchema.required,['documentId']);assert.equal(tool.inputSchema.additionalProperties,false);assert.equal(tool.annotations.readOnlyHint,false);assert.equal(tool.annotations.idempotentHint,false);
});
for(const [engine,want]of [['cloud','queued'],['local','waiting_ocr']])for(const state of ['failed','needs_review','duplicate'])test(`retry MCP returns ${state}/${engine} to ${want} without interpreting or approving it`,async t=>{
 const f=await processingFixture(t);retryRow(f,{state,engine});const before=retrySnapshot(f),providerCalls=f.providerCalls;
 let originalReads=0;f.env.BUCKET.get=async()=>{originalReads++;throw Error('retry must not read originals');};
 const result=await retryMcp(f,{documentId:'retry-doc'});
 assert.equal(result.result?.isError,undefined);assert.deepEqual(result.result?.structuredContent,{ok:true,requeued:true});
 const row=f.sql.prepare('SELECT * FROM document_jobs').get();assert.equal(row.state,want);assert.equal(row.attempts,0);assert.equal(row.lease,'');assert.equal(row.lease_until,'');assert.notEqual(row.available_at,'2000-01-01');assert.equal(row.extraction,'{"retained":"synthetic interpretation"}');assert.equal(row.error_code,'retained-error');assert.equal(row.invoice_id,'');assert.equal(row.automatic,0);
 assert.deepEqual(retrySnapshot(f),before);assert.equal(originalReads,0);assert.equal(f.providerCalls,providerCalls);
 const after={...row},again=await retryMcp(f,{documentId:'retry-doc'});assert.deepEqual(again.result?.structuredContent,{ok:true,requeued:false});assert.deepEqual({...f.sql.prepare('SELECT * FROM document_jobs').get()},after);assert.deepEqual(retrySnapshot(f),before);
});
for(const state of ['processing','registered','queued','waiting_ocr'])test(`retry MCP leaves ${state} and its lease untouched`,async t=>{
 const f=await processingFixture(t);retryRow(f,{state});const before=f.sql.prepare('SELECT * FROM document_jobs').all(),dataBefore=retrySnapshot(f);
 const result=await retryMcp(f,{documentId:'retry-doc'});assert.deepEqual(result.result?.structuredContent,{ok:true,requeued:false});assert.deepEqual(f.sql.prepare('SELECT * FROM document_jobs').all(),before);assert.deepEqual(retrySnapshot(f),dataBefore);
});
for(const variant of ['foreign-owner','missing-job','rejected-source','registered-source','missing-source'])test(`retry MCP does not requeue ${variant} or reveal why it was unavailable`,async t=>{
 const f=await processingFixture(t);if(variant==='foreign-owner')f.owner='other-owner';retryRow(f);if(variant==='foreign-owner')f.owner=f.user.userId;
 if(variant==='missing-job')f.sql.prepare('DELETE FROM document_jobs').run();
 if(variant==='missing-source')f.sql.prepare('DELETE FROM gmail_sources').run();
 if(variant==='rejected-source'||variant==='registered-source')f.sql.prepare('UPDATE gmail_sources SET status=?').run(variant==='rejected-source'?'rejected':'registered');
 const before=f.sql.prepare('SELECT * FROM document_jobs').all(),dataBefore=retrySnapshot(f),result=await retryMcp(f,{documentId:'retry-doc'});
 assert.deepEqual(result.result?.structuredContent,{ok:true,requeued:false});assert.deepEqual(f.sql.prepare('SELECT * FROM document_jobs').all(),before);assert.deepEqual(retrySnapshot(f),dataBefore);assert.doesNotMatch(JSON.stringify(result),/other-owner|retained-lease|retained-error|synthetic interpretation/);
});
for(const args of [{},{documentId:''},{documentId:'../retry-doc'},{documentId:'x'.repeat(101)},{documentId:7},{documentId:['retry-doc']},{documentId:'retry-doc',owner:'other-owner'},{documentId:'retry-doc',force:true},{documentId:'retry-doc',fields:{}},[],null])test(`retry MCP rejects malformed or privileged arguments ${JSON.stringify(args).slice(0,80)}`,async t=>{
 const f=await processingFixture(t);retryRow(f);const before=f.sql.prepare('SELECT * FROM document_jobs').all(),dataBefore=retrySnapshot(f),result=await retryMcp(f,args);
 assert.equal(result.error?.code,-32602);assert.deepEqual(f.sql.prepare('SELECT * FROM document_jobs').all(),before);assert.deepEqual(retrySnapshot(f),dataBefore);
});
test('retry MCP requires authentication before changing a document queue',async t=>{
 const f=await processingFixture(t);retryRow(f);const before=f.sql.prepare('SELECT * FROM document_jobs').all(),dataBefore=retrySnapshot(f);f.user=null;
 const result=await retryMcp(f,{documentId:'retry-doc'});assert.equal(result.result?.isError,true);assert.deepEqual(result.result?.structuredContent,{error:'AUTH_REQUIRED'});assert.deepEqual(f.sql.prepare('SELECT * FROM document_jobs').all(),before);assert.deepEqual(retrySnapshot(f),dataBefore);
});
test('retry UI keeps its origin check and returns the same guarded queue result',async t=>{
 const f=await processingFixture(t);retryRow(f);const before=f.sql.prepare('SELECT * FROM document_jobs').all();
 const bad=new Request(origin+'/api/gmail/retry',{method:'POST',headers:{Origin:'https://foreign.example','Content-Type':'application/json'},body:JSON.stringify({document_id:'retry-doc'})});
 await assert.rejects(f.processing.processingAction(bad,'retry'),/ORIGIN_DENIED/);assert.deepEqual(f.sql.prepare('SELECT * FROM document_jobs').all(),before);
 const good=await(await f.processing.processingAction(post('retry',{document_id:'retry-doc'}),'retry')).json();assert.deepEqual(good,{ok:true,requeued:true});assert.equal(f.sql.prepare('SELECT state FROM document_jobs').get().state,'queued');
});

test('reviewer: simultaneous retries update exactly once',async t=>{
 const f=await processingFixture(t);retryRow(f);const before=retrySnapshot(f);
 const results=await Promise.all([retryMcp(f,{documentId:'retry-doc'}),retryMcp(f,{documentId:'retry-doc'})]);
 assert.deepEqual(results.map(x=>x.result.structuredContent.requeued).sort(),[false,true]);assert.deepEqual(retrySnapshot(f),before);
});
test('reviewer: active source of another owner cannot authorize retry',async t=>{
 const f=await processingFixture(t);retryRow(f);f.sql.prepare('UPDATE gmail_sources SET owner=?').run('foreign-owner');
 const before=f.sql.prepare('SELECT * FROM document_jobs').all();
 assert.deepEqual((await retryMcp(f,{documentId:'retry-doc'})).result.structuredContent,{ok:true,requeued:false});assert.deepEqual(f.sql.prepare('SELECT * FROM document_jobs').all(),before);
});
test('reviewer: registered job preserves actual receipt and nonempty invoice linkage',async t=>{
 const f=await processingFixture(t);retryRow(f,{state:'registered'});
 f.sql.prepare("UPDATE document_jobs SET invoice_id='invoice-1',automatic=1").run();
 f.sql.prepare("INSERT INTO document_registrations VALUES(?,?,'identity','invoice-1','attempt',12345,'2026')").run(f.owner,'retry-doc');
 const before=retrySnapshot(f),jobs=f.sql.prepare('SELECT * FROM document_jobs').all();
 assert.deepEqual((await retryMcp(f,{documentId:'retry-doc'})).result.structuredContent,{ok:true,requeued:false});assert.deepEqual(retrySnapshot(f),before);assert.deepEqual(f.sql.prepare('SELECT * FROM document_jobs').all(),jobs);
});
test('reviewer: server PDF engine follows existing nonlocal route',async t=>{
 const f=await processingFixture(t);retryRow(f,{engine:'server_pdf'});
 assert.deepEqual((await retryMcp(f,{documentId:'retry-doc'})).result.structuredContent,{ok:true,requeued:true});assert.equal(f.sql.prepare('SELECT state FROM document_jobs').get().state,'queued');
});

for(const status of ['needs_review','registered','rejected'])test('Gmail sync checks only encountered owner-scoped source IDs and preserves '+status+' deduplication',async t=>{
  const f=await fixture(t),flow=await connect(f);await f.api.gmailCallback(flow.callback());
  const insert=f.sql.prepare('INSERT INTO gmail_sources(owner,source_id,document_id,metadata,status,created_at) VALUES(?,?,?,?,?,?)');
  for(let i=0;i<3000;i++)insert.run(f.owner,'historical-'+i,'','{}','rejected','2020-01-01');
  insert.run(f.owner,'gmail:mg.vitvaror@gmail.com:archived:1','','{}',status,'2020-01-01');
  const prepare=f.d1.prepare.bind(f.d1),lookups=[];
  f.d1.prepare=query=>{
    const statement=prepare(query);
    if(/^SELECT source_id FROM gmail_sources/.test(query)){
      assert.match(query,/owner=\? AND source_id IN \(/,'membership must not read the full historical source table');
      const all=statement.all.bind(statement);
      statement.all=async()=>{assert.equal(statement.args[0],f.owner);assert.ok(statement.args.length>1&&statement.args.length<=51);lookups.push([...statement.args]);return all();};
    }
    return statement;
  };
  const result=await(await f.api.gmailSync(post('sync'))).json();
  assert.equal(result.imported,0);assert.equal(result.duplicates,1);assert.equal(f.attachmentCalls||0,0);
  assert.deepEqual(lookups,[[f.owner,'gmail:mg.vitvaror@gmail.com:archived:1']]);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM gmail_sources').get().n,3001);
});

test('Gmail bounded source lookup does not let another owner suppress an original',async t=>{
  const f=await fixture(t),flow=await connect(f);await f.api.gmailCallback(flow.callback());
  f.sql.prepare('INSERT INTO gmail_sources(owner,source_id,document_id,metadata,status,created_at) VALUES(?,?,?,?,?,?)').run('another-owner','gmail:mg.vitvaror@gmail.com:archived:1','','{}','registered','2020-01-01');
  const result=await(await f.api.gmailSync(post('sync'))).json();
  assert.equal(result.imported,1);assert.equal(result.duplicates,0);assert.equal(f.attachmentCalls,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM gmail_sources WHERE owner=?').get(f.owner).n,1);
});

test('Gmail scheduled receipt identifies exactly its persisted invocation and result, including not-due runs',async t=>{
  const f=await fixture(t,{automatic:true}),flow=await connect(f);await f.api.gmailCallback(flow.callback());
  const first=await(await f.api.gmailSync(undefined,true)).json(),receipt=first.automation_receipt;
  assert.ok(receipt);assert.equal(receipt.persisted,true);assert.equal(receipt.outcome,'completed');
  const events=f.sql.prepare("SELECT action,detail,created_at FROM audit_events WHERE action LIKE 'gmail.automatic.%' ORDER BY rowid").all();
  assert.equal(events.length,2);
  assert.equal(JSON.parse(events[0].detail).run_id,receipt.run_id);assert.equal(events[0].created_at,receipt.invoked_at);
  assert.equal(JSON.parse(events[1].detail).run_id,receipt.run_id);assert.equal(events[1].created_at,receipt.completed_at);
  const second=await(await f.api.gmailSync(undefined,true)).json(),later=second.automation_receipt;
  assert.equal(later.outcome,'not_due');assert.equal(later.persisted,true);assert.notEqual(later.run_id,receipt.run_id);
  const observation=(await(await f.api.gmailStatus(true)).json()).schedule_observation;
  assert.equal(observation.last_run_id,later.run_id);assert.equal(observation.last_invoked_at,later.invoked_at);
  assert.equal(observation.last_finished_at,later.completed_at);assert.equal(observation.last_completed_at,receipt.completed_at);
  assert.equal(observation.external_schedule_verified,false);
});

test('Gmail observation keeps an unfinished latest run separate from historical successful completion',async t=>{
  const f=await fixture(t,{automatic:true}),flow=await connect(f);await f.api.gmailCallback(flow.callback());
  const insert=f.sql.prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) VALUES(?,?,0,?,?,?)');
  insert.run('old-invoke',f.owner,'gmail.automatic.invoked',JSON.stringify({run_id:'old-run'}),'2020-01-01T00:00:00.000Z');
  insert.run('old-result',f.owner,'gmail.automatic.result',JSON.stringify({run_id:'old-run',outcome:'completed'}),'2020-01-01T00:01:00.000Z');
  insert.run('latest-invoke',f.owner,'gmail.automatic.invoked',JSON.stringify({run_id:'latest-run'}),'2020-01-02T00:00:00.000Z');
  const observation=(await(await f.api.gmailStatus(true)).json()).schedule_observation;
  assert.equal(observation.last_run_id,'latest-run');assert.equal(observation.last_finished_at,null);
  assert.equal(observation.last_completed_at,'2020-01-01T00:01:00.000Z');assert.equal(observation.last_outcome,'running_or_interrupted');
  assert.equal(observation.external_schedule_verified,false);
});

test('Gmail scheduled failures retain their correlated safe receipt through the error response',async t=>{
  const f=await fixture(t,{automatic:true}),flow=await connect(f);await f.api.gmailCallback(flow.callback());f.retryAfter='3600';
  let failure;
  await assert.rejects(async()=>{try{await f.api.gmailSync(undefined,true);}catch(error){failure=error;throw error;}},error=>error.code==='rate_limited');
  const response=f.api.gmailFailure(failure),body=await response.json(),receipt=body.automation_receipt;
  assert.equal(response.status,429);assert.ok(receipt);assert.equal(receipt.outcome,'error');assert.equal(receipt.persisted,true);
  const observation=(await(await f.api.gmailStatus(true)).json()).schedule_observation;
  assert.equal(observation.last_run_id,receipt.run_id);assert.equal(observation.last_finished_at,receipt.completed_at);
  assert.equal(observation.last_outcome,'error');assert.equal(observation.last_completed_at,null);
  assert.doesNotMatch(JSON.stringify(body),/private-provider-secret|synthetic-access|synthetic-refresh/);
});

test('Gmail failed invocation persistence returns an unconfirmed receipt and prevents provider work',async t=>{
  const f=await fixture(t,{automatic:true}),flow=await connect(f);await f.api.gmailCallback(flow.callback());
  const prepare=f.d1.prepare.bind(f.d1),calls=f.providerCalls,before={...f.sql.prepare('SELECT * FROM gmail_connections').get()};
  f.d1.prepare=query=>{
    const statement=prepare(query),run=statement.run.bind(statement);
    statement.run=async()=>{
      if(query.startsWith('INSERT INTO audit_events')&&statement.args.includes('gmail.automatic.invoked'))throw Error('synthetic invocation storage outage');
      return run();
    };
    return statement;
  };
  let failure;
  await assert.rejects(async()=>{try{await f.api.gmailSync(undefined,true);}catch(error){failure=error;throw error;}});
  const body=await f.api.gmailFailure(failure).json(),receipt=body.automation_receipt;
  assert.ok(receipt);assert.equal(receipt.persisted,false);assert.equal(receipt.outcome,'error');
  assert.ok(Number.isFinite(Date.parse(receipt.invoked_at)));assert.ok(Number.isFinite(Date.parse(receipt.completed_at)));
  assert.equal(f.providerCalls,calls);assert.deepEqual({...f.sql.prepare('SELECT * FROM gmail_connections').get()},before);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM audit_events').get().n,0);
  assert.doesNotMatch(JSON.stringify(body),/synthetic invocation storage outage/);
});
