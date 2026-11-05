import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {generateKeyPairSync} from 'node:crypto';
import {digest} from '../src/security.js';
import {storeDocument} from '../src/db.js';
import {createCompanyClient} from '../sites/lib/company-client.js';

const directory=mkdtempSync(join(tmpdir(),'mg-company-http-'));
process.env.NODE_ENV='test';process.env.APP_ORIGIN='https://company.example.test';
process.env.MG_ADMIN_PASSWORD='synthetic-owner-password';process.env.DB_PATH=join(directory,'legacy.sqlite');
process.env.SESSION_SECRET='1'.repeat(64);process.env.BANK_DATA_KEY='2'.repeat(64);
process.env.GOOGLE_CLIENT_ID='synthetic-client';process.env.GOOGLE_CLIENT_SECRET='synthetic-secret';process.env.GMAIL_ACCOUNT='synthetic-legacy@example.test';
delete process.env.MG_COMPANY_GMAIL_ACCOUNTS;
const app=await import('../src/server.js');
const {server,db}=app;
const base=await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
after(async()=>{await new Promise(resolve=>server.close(resolve));app.companyRuntime?.close();db.close();rmSync(directory,{recursive:true,force:true});});
const verification={status:'verified',evidenceId:'synthetic-operator-evidence',verifiedBy:'operator'};
const originals=new Map();
function session(actor){const value='synthetic-session-'+actor;db.prepare('INSERT OR REPLACE INTO sessions(id_hash,expires_at,principal) VALUES(?,?,?)').run(digest(value),Date.now()+600000,actor);return 'mg_session='+value;}
function call(path,{actor='alice',method='GET',body,headers={}}={}){
 return new Promise((resolve,reject)=>{
  const req=request(base+path,{method,headers:{Host:'company.example.test',Cookie:session(actor),...(body!==undefined?{'Content-Type':'application/json',Origin:process.env.APP_ORIGIN}:{}),...Object.fromEntries(new Headers(headers))}},res=>{
   const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const bytes=Buffer.concat(chunks);let body;try{body=JSON.parse(bytes);}catch{body=bytes.toString();}resolve({status:res.statusCode,body,headers:res.headers});});
  });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
 });
}
test('HTTP data APIs bind authenticated actors to separate physical company databases',async()=>{
 assert.equal(typeof app.companyRuntime?.provisionCompany,'function','server exposes trusted operator provisioning, not a client-selected database');
 for(const [companyId,actor] of [['company-a','alice'],['company-b','bob']]){
  app.companyRuntime.provisionCompany({companyId,name:companyId,actorId:actor,verification});
  const context=app.companyRuntime.resolve({actorId:actor});
  app.companyRuntime.run(context,()=>{
   app.companyRuntime.db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES(?,?,?,?,?)').run('same-invoice','customer','0599',companyId,62500);
   app.companyRuntime.db.prepare('INSERT INTO bank_transactions(id,fingerprint,account,booked_at,amount_cents,payer) VALUES(?,?,?,?,?,?)').run('same-payment','same-fingerprint','synthetic-account','2026-10-26',62500,companyId);
   originals.set(companyId,storeDocument(app.companyRuntime.db,{name:'synthetic.pdf',mime_type:'application/pdf',bytes:Buffer.from('%PDF-'+companyId),invoice_id:'same-invoice'}).id);
  });
 }
 for(const [actor,expected] of [['alice','company-a'],['bob','company-b']]){
  const invoices=await call('/api/invoices',{actor});assert.equal(invoices.status,200,JSON.stringify(invoices.body));assert.equal(invoices.body.items[0].party,expected);
  const bank=await call('/api/bank-transactions',{actor});assert.equal(bank.status,200,JSON.stringify(bank.body));assert.equal(bank.body.items[0].payer,expected);
  assert.equal(bank.headers['x-company-id'],expected);
 }
});
test('original downloads enforce company membership and preserve a company response boundary',async()=>{
 const a=originals.get('company-a'),b=originals.get('company-b');
 assert.equal((await call('/api/documents/'+b)).status,404);
 assert.equal((await call('/api/documents/'+a+'?companyId=company-b')).status,403);
 const original=await call('/api/documents/'+b+'?companyId=company-b&companyContextVersion=1',{actor:'bob'});
 assert.equal(original.status,200);assert.equal(original.body,'%PDF-company-b');assert.equal(original.headers['x-company-id'],'company-b');
});
test('forged selectors and invoice payload tenant switches fail closed',async()=>{
 for(const path of ['/api/invoices?companyId=company-b','/api/bank-transactions?companyId=company-b'])assert.equal((await call(path)).status,403);
 assert.equal((await call('/api/invoices',{headers:{'X-Company-Id':'company-b'}})).status,403);
 assert.equal((await call('/api/invoices',{method:'POST',body:{companyId:'company-b',direction:'customer',invoice_number:'0999',party:'Forbidden',total_cents:100}})).status,400);
 assert.equal((await call('/api/invoices?companyId=company-a',{headers:{'X-Company-Id':'company-b'}})).status,400);
});
test('new companies never inherit the standalone legacy Gmail mailbox',async()=>{
 const response=await call('/api/gmail/status');assert.equal(response.status,200,JSON.stringify(response.body));
 assert.equal(response.body.email,'');assert.equal(response.body.configured,false);
 assert.equal((await call('/api/gmail/connect',{method:'POST',body:{}})).status,409);
});
test('company service bundles preserve serialized scheduler and backup status fields',async()=>{
 const response=await call('/api/settings');assert.equal(response.status,200);
 assert.equal(response.body.scheduler.running,false);assert.equal(response.body.scheduler.last_run,'');
 assert.equal(typeof response.body.backup.enabled,'boolean');assert.equal(response.body.backup.last_verified,'');assert.equal(response.body.backup.retry_after,0);
});
test('Bankgiro intake and scheduled work reject a source with the right storage owner but another company',async t=>{
 const context=app.companyRuntime.resolve({actorId:'alice'}),previous=process.env.BANKGIRO_SOURCE_CONFIG,secret=process.env.SYNTHETIC_COMPANY_REPORT_TOKEN;
 t.after(()=>{if(previous===undefined)delete process.env.BANKGIRO_SOURCE_CONFIG;else process.env.BANKGIRO_SOURCE_CONFIG=previous;if(secret===undefined)delete process.env.SYNTHETIC_COMPANY_REPORT_TOKEN;else process.env.SYNTHETIC_COMPANY_REPORT_TOKEN=secret;});
 const at=Date.now();
 process.env.SYNTHETIC_COMPANY_REPORT_TOKEN='synthetic-company-report-token';
 process.env.BANKGIRO_SOURCE_CONFIG=JSON.stringify({version:1,revision:1,registrations:[{id:'synthetic-source',owner:context.storageOwner,companyId:'company-b',bankgiro:'0599',scopeId:'synthetic-scope',generation:'synthetic-generation',mode:'production',enabled:true,transport:'https-v1',baseUrl:'https://reports.example.com/feed',tokenSecret:'SYNTHETIC_COMPANY_REPORT_TOKEN',profileId:'synthetic-profile',allowedFormats:['xml'],intervalMinutes:15,entitlement:{status:'VERIFIED',origin:'provider_authorization',evidenceId:'synthetic-only-verification',checkedAt:new Date(at-1000).toISOString(),validUntil:new Date(at+3600000).toISOString(),capabilities:['bankgiro_reports:read']}}]});
 let providerCalls=0;t.mock.method(globalThis,'fetch',async()=>{providerCalls++;throw Error('No provider access is permitted for a mismatched company');});
 const snapshot=()=>app.companyRuntime.run(context,()=>Object.fromEntries(['invoices','bank_transactions','documents','bankgiro_ingest_sources','bankgiro_ingest_jobs','bankgiro_ingest_leases','audit_events'].map(table=>[table,app.companyRuntime.db.prepare('SELECT * FROM '+table).all()])));
 const before=snapshot(),status=await call('/api/bankgiro/source/status'),run=await call('/api/bankgiro/source/run',{method:'POST',body:{}});
 const scheduled=await app.companyRuntime.runJob(context,()=>app.runScheduledBankgiro());
 assert.equal(providerCalls,0);
 for(const result of [status,run]){assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.state,'BLOCKED');assert.equal(result.body.reason,'COMPANY_BOUNDARY_MISMATCH');assert.equal(result.body.enabled,false);assert.deepEqual(result.body.jobs,[]);}
 assert.equal(scheduled.state,'BLOCKED');assert.equal(scheduled.reason,'COMPANY_BOUNDARY_MISMATCH');assert.deepEqual(snapshot(),before);
});
test('a matching company source remains usable and only a matching explicit revocation changes its authority',async t=>{
 const actor='source-owner',context=app.companyRuntime.provisionCompany({companyId:'company-source',name:'Synthetic source company',actorId:actor,verification});
 const previous=process.env.BANKGIRO_SOURCE_CONFIG,secret=process.env.SYNTHETIC_COMPANY_REPORT_TOKEN;
 t.after(()=>{if(previous===undefined)delete process.env.BANKGIRO_SOURCE_CONFIG;else process.env.BANKGIRO_SOURCE_CONFIG=previous;if(secret===undefined)delete process.env.SYNTHETIC_COMPANY_REPORT_TOKEN;else process.env.SYNTHETIC_COMPANY_REPORT_TOKEN=secret;});
 const at=Date.now(),entitlement={status:'VERIFIED',origin:'provider_authorization',evidenceId:'synthetic-only-verification',checkedAt:new Date(at-1000).toISOString(),validUntil:new Date(at+3600000).toISOString(),capabilities:['bankgiro_reports:read']};
 const registration={id:'synthetic-matching-source',owner:context.storageOwner,companyId:context.companyId,bankgiro:'0599',scopeId:'synthetic-scope',generation:'synthetic-generation',mode:'production',enabled:true,transport:'https-v1',baseUrl:'https://reports.example.com/feed',tokenSecret:'SYNTHETIC_COMPANY_REPORT_TOKEN',profileId:'synthetic-profile',allowedFormats:['xml'],intervalMinutes:15,entitlement};
 const configure=(revision,patch={})=>{process.env.BANKGIRO_SOURCE_CONFIG=JSON.stringify({version:1,revision,registrations:[{...registration,...patch}]});};
 process.env.SYNTHETIC_COMPANY_REPORT_TOKEN='synthetic-company-report-token';configure(1);
 let providerCalls=0;t.mock.method(globalThis,'fetch',async input=>{
  providerCalls++;const url=new URL(input);assert.equal(url.origin,'https://reports.example.com');
  if(url.pathname==='/feed/v1/authorization')return Response.json({...entitlement,owner:context.storageOwner,companyId:context.companyId,sourceId:registration.id,bankgiro:registration.bankgiro,scopeId:registration.scopeId,generation:registration.generation,profileId:registration.profileId});
  assert.equal(url.pathname,'/feed/v1/reports');return Response.json({reports:[],nextCursor:null});
 });
 const imported=await call('/api/bankgiro/source/run',{actor,method:'POST',body:{}});
 assert.equal(imported.status,200);assert.equal(imported.body.authorization.status,'VERIFIED');assert.ok(imported.body.lastSuccessAt);assert.ok(providerCalls>0);
 const source=()=>app.companyRuntime.run(context,()=>app.companyRuntime.db.prepare('SELECT * FROM bankgiro_ingest_sources WHERE source_id=?').get(registration.id));
 const before=source(),calls=providerCalls;configure(2,{enabled:false,companyId:'company-b'});
 const wrong=await call('/api/bankgiro/source/run',{actor,method:'POST',body:{}});
 assert.equal(wrong.body.reason,'COMPANY_BOUNDARY_MISMATCH');assert.deepEqual(source(),before);assert.equal(providerCalls,calls);
 configure(2,{enabled:false});const revoked=await call('/api/bankgiro/source/run',{actor,method:'POST',body:{}});
 assert.equal(revoked.status,200);assert.equal(revoked.body.state,'BLOCKED');assert.equal(source().authorization_status,'BLOCKED');assert.equal(source().registration_revision,2);assert.equal(providerCalls,calls);
 configure(3,{enabled:false,companyId:undefined});const missing=await call('/api/bankgiro/source/run',{actor,method:'POST',body:{}});
 assert.equal(missing.body.reason,'COMPANY_BOUNDARY_MISMATCH');assert.equal(source().registration_revision,2);
 process.env.BANKGIRO_SOURCE_CONFIG=JSON.stringify({version:1,revision:3,registrations:[]});
 const removed=await call('/api/bankgiro/source/run',{actor,method:'POST',body:{}});
 assert.equal(removed.body.state,'BLOCKED');assert.equal(source().registration_revision,3);assert.equal(providerCalls,calls);
});
test('viewer may read but cannot write or administer integrations; revocation is immediate',async()=>{
 app.companyRuntime.setMembership({companyId:'company-a',actorId:'viewer',role:'viewer'});
 assert.equal((await call('/api/invoices',{actor:'viewer'})).status,200);
 assert.equal((await call('/api/settings',{actor:'viewer'})).status,200);
 assert.equal((await call('/api/reconciliation/preview',{actor:'viewer'})).status,200);
 assert.equal((await call('/api/invoices',{actor:'viewer',method:'POST',body:{direction:'customer',invoice_number:'0998',party:'Forbidden',total_cents:100}})).status,403);
 assert.equal((await call('/api/bank/connect',{actor:'viewer',method:'POST',body:{}})).status,403);
 app.companyRuntime.setMembership({companyId:'company-a',actorId:'viewer',role:'viewer',status:'revoked'});
 assert.equal((await call('/api/invoices',{actor:'viewer'})).status,403);
});
test('another authorized membership still requires an explicit active company switch',async()=>{
 for(const companyId of ['company-a','company-b'])app.companyRuntime.setMembership({companyId,actorId:'selector-user',role:'viewer'});
 const actor='selector-user',before=await call('/api/companies',{actor});
 assert.equal(before.body.activeCompanyId,'company-a');
 const headers={'X-Company-Id':'company-b','X-Company-Context-Version':String(before.body.contextVersion)};
 for(const path of ['/api/invoices','/api/bank-transactions']){
  const refused=await call(path,{actor,headers});assert.equal(refused.status,409);assert.equal(refused.body.code,'COMPANY_CONTEXT_STALE');
 }
 assert.equal((await call('/api/documents/'+originals.get('company-b')+'?companyId=company-b&companyContextVersion='+before.body.contextVersion,{actor})).status,409);
 const switched=await call('/api/companies/active',{actor,method:'POST',body:{companyId:'company-b',contextVersion:before.body.contextVersion}});
 assert.equal(switched.status,200);const fresh=switched.body.context;
 const allowed=await call('/api/invoices',{actor,headers:{'X-Company-Id':fresh.companyId,'X-Company-Context-Version':String(fresh.contextVersion)}});
 assert.equal(allowed.status,200);assert.equal(allowed.body.items[0].party,'company-b');
});
test('switching active company fences old tab/cache headers and responds with fresh context',async()=>{
 app.companyRuntime.setMembership({companyId:'company-b',actorId:'alice',role:'accountant'});
 const before=await call('/api/companies');assert.equal(before.status,200);assert.equal(before.body.companies.length,2);
 const switched=await call('/api/companies/active',{method:'POST',body:{companyId:'company-b',contextVersion:before.body.contextVersion}});
 assert.equal(switched.status,200,JSON.stringify(switched.body));assert.equal(switched.body.context.companyId,'company-b');
 assert.equal((await call('/api/invoices',{headers:{'X-Company-Id':'company-a','X-Company-Context-Version':String(before.body.contextVersion)}})).status,409);
 const current=await call('/api/invoices');assert.equal(current.status,200);assert.equal(current.body.items[0].party,'company-b');
 assert.equal((await call('/api/settings',{method:'PATCH',body:{company_name:'Blocked settings'}})).status,403);
});
test('the shared company browser client bootstraps from the actual HTTP directory contract',async()=>{
 const client=createCompanyClient({baseUrl:base,fetch:async(path,init={})=>{
  const response=await call(path,{actor:'bob',method:init.method,body:init.body?JSON.parse(init.body):undefined,headers:init.headers});
  return new Response(JSON.stringify(response.body),{status:response.status,headers:response.headers});
 }});
 try{
  await client.initialize();assert.equal(client.snapshot.status,'ready');assert.equal(client.snapshot.context.companyId,'company-b');
  const response=await client.fetch('/api/invoices');assert.equal((await response.json()).items[0].party,'company-b');
 }finally{client.dispose();}
});
test('a revoked active membership cannot fall through to old data and permits an explicit remaining company selection',async()=>{
 app.companyRuntime.setMembership({companyId:'company-a',actorId:'manager',role:'accountant'});
 app.companyRuntime.setMembership({companyId:'company-b',actorId:'manager',role:'viewer'});
 app.companyRuntime.setMembership({companyId:'company-a',actorId:'manager',role:'accountant',status:'revoked'});
 const directory=await call('/api/companies',{actor:'manager'});
 assert.equal(directory.body.activeCompanyId,null);assert.equal(directory.body.context,undefined);assert.equal(directory.body.actorId,'manager');assert.equal(directory.body.selectionRequired,true);
 assert.deepEqual(directory.body.companies.map(c=>c.id),['company-b']);assert.equal((await call('/api/invoices',{actor:'manager'})).status,403);
 const selected=await call('/api/companies/active',{actor:'manager',method:'POST',body:{companyId:'company-b',contextVersion:directory.body.contextVersion}});
 assert.equal(selected.status,200);assert.equal((await call('/api/invoices',{actor:'manager'})).body.items[0].party,'company-b');
});

async function oauthFixture(t,provider,tag){
 const actor='oauth-'+tag,companyId='company-'+tag,otherCompanyId=companyId+'-other';
 const context=app.companyRuntime.provisionCompany({companyId,name:companyId,actorId:actor,verification});
 app.companyRuntime.provisionCompany({companyId:otherCompanyId,name:otherCompanyId,actorId:actor,verification});
 app.companyRuntime.setMembership({companyId,actorId:actor+'-backup',role:'owner'});
 const keys=['MG_COMPANY_GMAIL_ACCOUNTS','ENABLE_BANKING_APPLICATION_ID','ENABLE_BANKING_PRIVATE_KEY','ENABLE_BANKING_ENVIRONMENT'],saved=keys.map(key=>[key,process.env[key]]);
 t.after(()=>{for(const [key,value]of saved)if(value===undefined)delete process.env[key];else process.env[key]=value;});
 process.env.MG_COMPANY_GMAIL_ACCOUNTS=JSON.stringify({[companyId]:'company-oauth@example.test'});
 process.env.ENABLE_BANKING_APPLICATION_ID='synthetic-company-application';process.env.ENABLE_BANKING_ENVIRONMENT='SANDBOX';
 process.env.ENABLE_BANKING_PRIVATE_KEY=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}}).privateKey;
 let state,providerCalls=0;
 t.mock.method(globalThis,'fetch',async(input,options={})=>{
  providerCalls++;const url=new URL(input);
  if(url.origin==='https://oauth2.googleapis.com'&&url.pathname==='/token')return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,scope:'https://www.googleapis.com/auth/gmail.readonly'});
  if(url.origin==='https://gmail.googleapis.com'&&url.pathname.endsWith('/profile'))return Response.json({emailAddress:'company-oauth@example.test'});
  assert.equal(url.origin,'https://api.enablebanking.com');
  if(url.pathname==='/application')return Response.json({kid:'synthetic-company-application',environment:'SANDBOX',active:true,countries:['SE'],services:['AIS'],redirect_urls:[process.env.APP_ORIGIN+'/api/bank/callback']});
  if(url.pathname==='/aspsps')return Response.json({aspsps:[{name:'Swedbank',country:'SE',psu_types:['business'],maximum_consent_validity:90*86400}]});
  if(url.pathname==='/auth'){state=JSON.parse(options.body).state;return Response.json({url:'https://auth.enablebanking.com/ais/start?sessionid=synthetic'});}
  if(url.pathname==='/sessions'&&options.method==='POST')return Response.json({session_id:'synthetic-session-'+tag,accounts:[{uid:'synthetic-account',currency:'SEK',usage:'ORGA',account_id:{iban:'SE4280000890119146168423'}}],aspsp:{name:'Swedbank',country:'SE'},psu_type:'business',access:{valid_until:new Date(Date.now()+3600000).toISOString()}});
  if(url.pathname.startsWith('/sessions/')&&options.method!=='DELETE')return Response.json({status:'AUTHORIZED',accounts:['synthetic-account'],accounts_data:[{uid:'synthetic-account'}],aspsp:{name:'Swedbank',country:'SE'},psu_type:'business',access:{valid_until:new Date(Date.now()+3600000).toISOString()}});
  throw Error('Unexpected synthetic provider request');
 });
 const start=await call('/api/'+provider+'/connect',{actor,method:'POST',body:{}});assert.equal(start.status,200,JSON.stringify(start.body));
 if(provider==='gmail')state=new URL(start.body.url).searchParams.get('state');
 return {actor,companyId,otherCompanyId,context,state,calls:()=>providerCalls,callback:()=>call('/api/'+provider+'/callback?state='+state+'&code=synthetic-code',{actor}),connectionCount:()=>app.companyRuntime.run(app.companyRuntime.resolve({actorId:actor}),()=>db.prepare('SELECT count(*) n FROM '+(provider==='gmail'?'gmail_connections':'bank_connections')).get().n)};
}
for(const provider of ['bank','gmail'])for(const change of ['switch','revocation','company-version'])test(provider+' OAuth cannot revive an old flow after '+change,async t=>{
 const f=await oauthFixture(t,provider,provider+'-'+change),calls=f.calls();
 if(change==='switch'){
  app.companyRuntime.selectActiveCompany({actorId:f.actor,companyId:f.otherCompanyId,contextVersion:1});
  app.companyRuntime.selectActiveCompany({actorId:f.actor,companyId:f.companyId,contextVersion:2});
 }else if(change==='revocation'){
  app.companyRuntime.setMembership({companyId:f.companyId,actorId:f.actor,role:'owner',status:'revoked'});
  app.companyRuntime.setMembership({companyId:f.companyId,actorId:f.actor,role:'owner',status:'active'});
 }else app.companyRuntime.controlDb.prepare('UPDATE companies SET company_version=company_version+1 WHERE company_id=?').run(f.companyId);
 const result=await f.callback();assert.ok([403,409].includes(result.status),JSON.stringify(result));
 assert.equal(f.calls(),calls);assert.equal(f.connectionCount(),0);
});
for(const provider of ['bank','gmail'])test(provider+' OAuth retains its initiating company and completes once with current authority',async t=>{
 const f=await oauthFixture(t,provider,provider+'-current');
 const result=await f.callback();assert.equal(result.status,302,JSON.stringify(result.body));assert.equal(f.connectionCount(),1);
 assert.equal((await f.callback()).status,403);assert.equal(f.connectionCount(),1);
});
test('a legacy Gmail redirect cannot gain a company binding through later verified adoption',async()=>{
 const actor='administrator',start=await call('/api/gmail/connect',{actor,method:'POST',body:{}});assert.equal(start.status,200);
 const state=new URL(start.body.url).searchParams.get('state');
 app.companyRuntime.bindLegacyCompany({companyId:'verified-legacy',name:'Verified legacy',actorId:actor,storageOwner:actor,verification});
 const result=await call('/api/gmail/callback?state='+state+'&error=access_denied',{actor});
 assert.equal(result.status,409);assert.equal(result.body.code,'COMPANY_CONTEXT_STALE');
});

test('Open Payments HTTP is disabled by default and rejects a foreign company before banking',async()=>{
 const actor='saas-synthetic-owner',companyId='saas-synthetic-company';
 app.companyRuntime.provisionCompany({companyId,name:'Synthetic SaaS Company',actorId:actor,verification});
 const status=await call(`/api/companies/${companyId}/bank`,{actor});assert.equal(status.status,200);assert.equal(status.body.actions.connect,false);assert.deepEqual(status.body.banks,[]);assert.equal(status.body.sync.errorCode,'configuration_required');
 assert.equal((await call('/api/companies/company-a/bank',{actor})).status,403);
 const start=await call(`/api/companies/${companyId}/bank/connect`,{actor,method:'POST',headers:{'Idempotency-Key':'synthetic-start-request'},body:{bankId:'OPBKSE21',permissions:['accounts:read','transactions:read'],expectedRevision:0}});assert.equal(start.status,409);assert.equal(start.body.code,'SAAS_BANK_DISABLED');
});
