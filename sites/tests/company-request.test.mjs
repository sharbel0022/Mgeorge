import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {companyFixture} from './helpers/company-storage-fixture.mjs';
import {invoiceParserUrl} from './helpers/invoice-module-loader.mjs';
import {changeCompanyMembership,selectCompany,createWorkerGrant} from '../lib/company-storage.js';
const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const url=path=>new URL(path,import.meta.url).href;
function compile(path,imports){let code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;for(const [from,to]of Object.entries(imports))for(const quote of ['"',"'"])code=code.replaceAll(quote+from+quote,JSON.stringify(to));return data(code);}
async function fixture(t){
 const f=companyFixture(t),key='__company_request_'+crypto.randomUUID().replaceAll('-','');globalThis[key]=f;t.after(()=>delete globalThis[key]);f.user={userId:'actor-a',email:'synthetic@example.test',displayName:'Synthetic'};f.objects=new Map();f.reads=[];
 f.env={MG_SAAS_ONBOARDING_ENABLED:'true',DB:f.raw,BUCKET:{async get(key){f.reads.push(key);if(f.onObjectRead)await f.onObjectRead(key);const bytes=f.objects.get(key);return bytes?{body:bytes,size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer}:null;}}};
 const ref=`globalThis[${JSON.stringify(key)}]`,environment=data(`export const env=${ref}.env;`),domain=url('../lib/domain.ts');
 const server=compile('../lib/server.ts',{'cloudflare:workers':environment,'@/app/chatgpt-auth':data(`export async function getChatGPTUser(){return ${ref}.user;}`),'./domain':domain,'./company-storage.js':url('../lib/company-storage.js')});
 f.moduleUrls={server,environment,domain,ref};
 f.server=await import(server);f.wrap=handler=>f.server.withCompanyRequest(handler);
 const state=await import(compile('../app/api/state/route.ts',{'@/lib/server':server,'@/lib/domain':domain,'@/lib/reconciliation-evidence':data('export async function reconcileWithOriginals(){};export async function assertPaymentOriginal(){};export async function writePaymentState(){}'),'@/lib/customer-messages':data('export async function reconcileAndPrepare(){}'),'@/lib/bankgiro-service':data('export async function readBankgiroOriginal(){}'),'@/lib/bankgiro-invoice-search':data('export async function searchBankgiroInvoice(){}')}));
 f.state=f.wrap(state.GET);f.statePost=f.wrap(state.POST);
 const files=await import(compile('../app/api/files/route.ts',{'cloudflare:workers':environment,'@/lib/server':server,'@/lib/domain':domain}));f.files=f.wrap(files.GET);
 const companies=await import(compile('../app/api/companies/route.ts',{'@/lib/server':server}));f.list=f.wrap(companies.GET);f.create=f.wrap(companies.POST);
 const active=await import(compile('../app/api/companies/active/route.ts',{'@/lib/server':server}));f.active=f.wrap(active.POST);
 f.request=(path='/api/state',{companyId='company-a',version=1,method='GET',body,headers={}}={})=>new Request('https://synthetic.test'+path,{method,headers:{...(companyId?{'X-Company-Id':companyId,'X-Company-Context-Version':String(version)}:{}),...(method!=='GET'?{'Origin':'https://synthetic.test','Content-Type':'application/json'}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 f.seed=async()=>{await f.createCompany('company-a');await f.createCompany('company-b','actor-b');f.a=await f.scope();f.b=await f.scope('actor-b','company-b');for(const scope of [f.a,f.b]){
  const state={schemaVersion:1,company:{name:scope.context.companyId,email:''},invoices:[{id:'same-invoice',number:'0599',tenant:scope.context.companyId}],transactions:[{id:'same-payment',amount:100,tenant:scope.context.companyId}],allocations:[],credits:[],imports:[],receipts:[]};
  await f.database(scope).prepare('UPDATE workspaces SET payload=? WHERE owner=?').bind(JSON.stringify(state),scope.owner).run();
  const docId=scope===f.a?'00000000-0000-4000-8000-000000000001':'00000000-0000-4000-8000-000000000002',bytes=new TextEncoder().encode('Synthetic original '+scope.context.companyId);
  await f.database(scope).prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?)').bind(docId,scope.owner,'original.pdf','application/pdf',bytes.length,createHash('sha256').update(bytes).digest('hex'),'2026').run();f.objects.set(scope.owner+'/'+docId,bytes);
 }};
 // Keep the catalogue provisioning helper separate from the HTTP handler.
 f.createCompany=(id,actorId='actor-a')=>import('../lib/company-storage.js').then(m=>m.provisionCompany(f.raw,{id,name:'Synthetic '+id,actorId,verifiedBy:actorId,verificationEvidence:'Authenticated empty synthetic-company creation.'}));
 return f;
}
test('real state and original APIs expose only the authenticated selected company',async t=>{
 const f=await fixture(t);await f.seed();const r=await f.state(f.request());assert.equal(r.status,200);const body=await r.json();assert.equal(body.state.invoices[0].tenant,'company-a');assert.equal(body.state.transactions[0].tenant,'company-a');assert.equal(r.headers.get('X-Company-Id'),'company-a');
 const denied=await f.files(f.request('/api/files?id=00000000-0000-4000-8000-000000000002'));assert.equal(denied.status,404);assert.deepEqual(f.reads,[]);
 const own=await f.files(f.request('/api/files?id=00000000-0000-4000-8000-000000000001&companyId=company-a&companyContextVersion=1',{companyId:null}));assert.equal(own.status,200);assert.equal(await own.text(),'Synthetic original company-a');assert.deepEqual(f.reads,[f.a.owner+'/00000000-0000-4000-8000-000000000001']);
});
test('forged and conflicting request company selectors are rejected without a legacy fallback',async t=>{
 const f=await fixture(t);await f.seed();assert.equal((await f.state(f.request('/api/state',{companyId:'company-b'}))).status,403);
 const missing=await f.state(f.request('/api/state',{companyId:null}));assert.equal(missing.status,409);assert.equal((await missing.json()).code,'COMPANY_CONTEXT_REQUIRED');
 const conflict=await f.state(f.request('/api/state?companyId=company-b&companyContextVersion=1'));assert.equal(conflict.status,409);assert.equal(conflict.headers.get('X-Company-Context-Stale'),'1');
});
test('membership removal during an original fetch suppresses the response bytes',async t=>{
 const f=await fixture(t);await f.seed();await changeCompanyMembership(f.raw,f.a,{actorId:'backup-owner',role:'owner',status:'active'});
 f.onObjectRead=()=>f.sql.prepare("UPDATE company_memberships SET status='revoked',membership_version=membership_version+1 WHERE actor_id='actor-a'").run();
 const r=await f.files(f.request('/api/files?id=00000000-0000-4000-8000-000000000001'));assert.equal(r.status,403);assert.doesNotMatch(await r.text(),/Synthetic original/);
 assert.equal((await f.state(f.request())).status,403);assert.equal((await f.list(f.request('/api/companies',{companyId:null}))).status,403);
});
test('switching company during a response marks it stale and does not return A data',async t=>{
 const f=await fixture(t);await f.seed();await changeCompanyMembership(f.raw,f.b,{actorId:'actor-a',role:'admin',status:'active'});
 const handler=f.wrap(async()=>{await f.server.identity();const state=await f.server.readWorkspace(f.a.owner);await selectCompany(f.raw,'actor-a','company-b',1);return f.server.response(state);});
 const r=await handler(f.request());assert.equal(r.status,409);assert.equal(r.headers.get('X-Company-Context-Stale'),'1');assert.doesNotMatch(await r.text(),/same-invoice/);
 const b=await f.state(f.request('/api/state',{companyId:'company-b',version:2}));assert.equal((await b.json()).state.invoices[0].tenant,'company-b');
});
test('a prepared statement or database handle captured in A cannot be invoked by a later B request',async t=>{
 const f=await fixture(t);await f.seed();let statement,database;
 await f.wrap(async()=>{await f.server.identity();database=f.server.db();statement=database.prepare('SELECT payload FROM workspaces');return f.server.response({prepared:true});})(f.request());
 f.user.userId='actor-b';
 for(const read of [()=>statement.all(),()=>database.prepare('SELECT payload FROM workspaces').all()]){const r=await f.wrap(async()=>f.server.response(await read()))(f.request('/api/state',{companyId:'company-b'}));assert.equal(r.status,403);assert.doesNotMatch(await r.text(),/same-invoice/);}
});
test('roles are checked before settings or integration handlers can perform effects',async t=>{
 const f=await fixture(t);await f.seed();for(const [actorId,role]of [['viewer','viewer'],['accountant','accountant']])await changeCompanyMembership(f.raw,f.a,{actorId,role,status:'active'});
 f.user.userId='viewer';assert.equal((await f.state(f.request())).status,200);assert.equal((await f.statePost(f.request('/api/state',{method:'POST',body:{}}))).status,403);
 f.user.userId='accountant';for(const path of ['/api/state','/api/bank/connect','/api/gmail/automation']){let effect=false;const handler=f.wrap(async req=>{await f.server.identity(req);effect=true;return f.server.response({ok:true});});const r=await handler(f.request(path,{method:'POST',body:{command:{type:'settings.save',name:'spoof',email:'synthetic@example.test'}}}));assert.equal(r.status,403);assert.equal(effect,false);}
});
test('MCP pins request context even after its body is consumed and distinguishes read tools',async t=>{
 const f=await fixture(t);await f.seed();await changeCompanyMembership(f.raw,f.a,{actorId:'viewer',role:'viewer',status:'active'});f.user.userId='viewer';
 const handler=f.wrap(async req=>{await req.json();const user=await f.server.identity();return f.server.response(await f.server.readWorkspace(user.userId));});
 assert.equal((await handler(f.request('/mcp',{method:'POST',body:{method:'tools/call',params:{name:'payment_evidence'}}}))).status,200);
 assert.equal((await handler(f.request('/mcp',{method:'POST',body:{method:'tools/call',params:{name:'bank_auto_sync'}}}))).status,403);
});
test('OAuth return resolves the original actor and context from its retained flow',async t=>{
 const f=await fixture(t);await f.seed();const state='synthetic-oauth-state',hash=createHash('sha256').update(state).digest('base64url');
 await f.database(f.a).prepare('INSERT INTO gmail_flows(state_hash,owner,cookie_hash,expires_at) VALUES(?,?,?,?)').bind(hash,f.a.owner,'synthetic-cookie','2099-01-01').run();
 const row=f.sql.prepare('SELECT company_id,company_actor_id,company_context_version,company_membership_version FROM gmail_flows').get();assert.deepEqual({...row},{company_id:'company-a',company_actor_id:'actor-a',company_context_version:1,company_membership_version:1});
 const handler=f.wrap(async()=>f.server.response(await f.server.identity()));const path='/api/gmail/callback?state='+state;
 const own=await handler(f.request(path,{companyId:null}));assert.equal(own.status,200);assert.equal((await own.json()).userId,f.a.owner);
 await changeCompanyMembership(f.raw,f.a,{actorId:'other-admin',role:'admin',status:'active'});f.user.userId='other-admin';assert.equal((await handler(f.request(path,{companyId:null}))).status,403);assert.equal((await handler(f.request(path))).status,403);
 f.user.userId='actor-a';await changeCompanyMembership(f.raw,f.b,{actorId:'actor-a',role:'admin',status:'active'});await selectCompany(f.raw,'actor-a','company-b',1);assert.equal((await handler(f.request(path,{companyId:null}))).status,409);
});
test('OAuth flows cannot survive a changed membership even when the same company stays selected',async t=>{
 const f=await fixture(t);await f.seed();await changeCompanyMembership(f.raw,f.a,{actorId:'admin',role:'admin',status:'active'});const admin=await f.scope('admin'),state='member-version-flow';
 await f.database(admin).prepare('INSERT INTO gmail_flows(state_hash,owner,cookie_hash,expires_at) VALUES(?,?,?,?)').bind(createHash('sha256').update(state).digest('base64url'),admin.owner,'cookie','2099').run();
 await changeCompanyMembership(f.raw,f.a,{actorId:'admin',role:'owner',status:'active'});f.user.userId='admin';
 const handler=f.wrap(async()=>f.server.response(await f.server.identity()));assert.equal((await handler(f.request('/api/gmail/callback?state='+state,{companyId:null}))).status,409);assert.equal((await handler(f.request('/api/gmail/callback?state='+state))).status,409);
});

for(const bank of [false,true])test('company generation change invalidates retained '+(bank?'bank':'Gmail')+' callback before dispatch',async t=>{
 const f=await fixture(t);await f.seed();const state='company-generation-'+(bank?'bank':'gmail'),hash=createHash('sha256').update(state).digest('base64url');
 if(bank)await f.database(f.a).prepare("INSERT INTO bank_auth_flows(state_hash,owner,cookie_hash,app_generation,bank_name,country,environment,redirect_uri,date_from,expires_at,status,created_at) VALUES(?,?,?,'application','Synthetic bank','SE','SANDBOX','https://synthetic.test/api/bank/callback','2026-11-01','2099-01-01','pending','2026-11-04')").bind(hash,f.a.owner,'cookie').run();
 else await f.database(f.a).prepare('INSERT INTO gmail_flows(state_hash,owner,cookie_hash,expires_at) VALUES(?,?,?,?)').bind(hash,f.a.owner,'cookie','2099-01-01').run();
 let dispatched=0;const handler=f.wrap(async()=>{await f.server.identity();dispatched++;return f.server.response({ok:true});}),path='/api/'+(bank?'bank':'gmail')+'/callback?state='+state;
 assert.equal((await handler(f.request(path,{companyId:null}))).status,200);assert.equal(dispatched,1);
 f.sql.prepare("UPDATE companies SET status='suspended',company_version=company_version+1 WHERE id='company-a'").run();
 f.sql.prepare("UPDATE companies SET status='active',company_version=company_version+1 WHERE id='company-a'").run();
 const result=await handler(f.request(path,{companyId:null}));assert.equal(result.status,409);assert.equal(dispatched,1);
});
test('company directory and active endpoint authorize membership without client storageOwner',async t=>{
 const f=await fixture(t);await f.seed();await changeCompanyMembership(f.raw,f.a,{actorId:'viewer',role:'viewer',status:'active'});f.user.userId='viewer';const listed=await f.list(f.request('/api/companies',{companyId:null})),directory=await listed.json();assert.equal(directory.context.role,'viewer');assert.equal(directory.context.companyId,'company-a');
 const forged=await f.active(f.request('/api/companies/active',{companyId:null,method:'POST',body:{companyId:'company-b',contextVersion:1}}));assert.equal(forged.status,403);
 const extra=await f.active(f.request('/api/companies/active',{companyId:null,method:'POST',body:{companyId:'company-a',contextVersion:1,storageOwner:f.b.owner}}));assert.equal(extra.status,400);
});

for(const flag of [undefined,'false','TRUE',true])test('server activation gate rejects company creation for '+String(flag),async t=>{
 const f=await fixture(t);if(flag===undefined)delete f.env.MG_SAAS_ONBOARDING_ENABLED;else f.env.MG_SAAS_ONBOARDING_ENABLED=flag;
 const result=await f.create(f.request('/api/companies',{companyId:null,method:'POST',body:{name:'Synthetic empty company',confirmEmptyCompany:true}}));
 assert.equal(result.status,503);assert.equal(f.sql.prepare('SELECT count(*) n FROM companies').get().n,0);
});
test('explicit server activation permits empty-workspace creation without certifying bank authority',async t=>{
 const f=await fixture(t);f.env.MG_SAAS_ONBOARDING_ENABLED='true';
 const result=await f.create(f.request('/api/companies',{companyId:null,method:'POST',body:{name:'Synthetic empty company',confirmEmptyCompany:true}}));
 assert.equal(result.status,201);const row=f.sql.prepare('SELECT * FROM companies').get();
 assert.equal(f.sql.prepare('SELECT count(*) n FROM bank_connections').get().n,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM bank_provider_connections').get().n,0);
 assert.deepEqual(JSON.parse(f.sql.prepare('SELECT payload FROM workspaces WHERE owner=?').get(row.storage_owner).payload).company.invoiceReferencePolicies,[]);
});
test('a private worker needs an explicit credential-bound company grant and cannot choose another tenant',async t=>{
 const f=await fixture(t);await f.seed();const token='s'.repeat(43);f.env.DOCUMENT_CLOUD_WORKER_TOKEN=token;f.env.DOCUMENT_CLOUD_OCR_ENABLED='true';f.env.DOCUMENT_OWNER_EMAIL='worker@example.test';
 await f.database(f.a).prepare('UPDATE document_automation SET email=?,enabled=1,updated_at=? WHERE owner=?').bind('worker@example.test','now',f.a.owner).run();
 const handler=f.wrap(async()=>f.server.response(await f.server.db().prepare('SELECT payload FROM workspaces').all()));
 const req=companyId=>f.request('/api/ocr-worker/process',{companyId,method:'POST',body:{},headers:{Authorization:'Bearer '+token,'X-MG-OCR-Runner':'cloud'}});
 assert.equal((await handler(req(null))).status,403);await createWorkerGrant(f.raw,f.a,{runner:'cloud',credentialHash:createHash('sha256').update(token).digest('hex')});
 const r=await handler(req(null));assert.equal(r.status,200);assert.match(JSON.stringify(await r.json()),/company-a/);assert.equal((await handler(req('company-b'))).status,403);
});
test('separate worker credentials lease only their company originals and survive a UI switch without retargeting',async t=>{
 const f=await fixture(t);await f.seed();const {server,environment,domain}=f.moduleUrls;
 const processing=await import(compile('../lib/document-processing.ts',{'cloudflare:workers':environment,'./server':server,'./domain':domain,'./banking/security':url('../lib/banking/security.ts'),'./invoice-fields.js':invoiceParserUrl(),'./server-pdf':data('export async function serverPdfText(){throw Error("No provider is permitted in this test");}')}));
 const worker=f.wrap(req=>processing.workerAction(req,new URL(req.url).pathname.split('/').pop())),configure=f.wrap(req=>processing.processingAction(req,'automation'));
 const configured=await configure(f.request('/api/gmail/automation',{method:'POST',body:{enabled:true,auto_register:false}}));assert.equal(configured.status,200);assert.equal((await configured.json()).enabled,true);
 const aToken='a'.repeat(43),bToken='b'.repeat(43),aId='00000000-0000-4000-8000-000000000001',bId='00000000-0000-4000-8000-000000000002';
 for(const [scope,token,documentId]of [[f.a,aToken,aId],[f.b,bToken,bId]]){
  const database=f.database(scope);await database.prepare('UPDATE document_automation SET enabled=1 WHERE owner=?').bind(scope.owner).run();
  await createWorkerGrant(f.raw,scope,{runner:'cloud',credentialHash:createHash('sha256').update(token).digest('hex')});
  await database.prepare("INSERT INTO gmail_sources(owner,source_id,document_id,metadata,status,extraction,created_at) VALUES(?,?,?,?,'needs_review',?,?)").bind(scope.owner,'synthetic-source',documentId,'{}','{}','2026-01-01').run();
  await database.prepare("INSERT INTO document_jobs(owner,document_id,state,engine,available_at,updated_at) VALUES(?,?,'waiting_ocr','local',?,?)").bind(scope.owner,documentId,'2026-01-01','2026-01-01').run();
 }
 const req=(token,action,body)=>f.request('/api/ocr-worker/'+action,{companyId:null,method:action==='document'?'GET':'POST',body,headers:{Authorization:'Bearer '+token,'X-MG-OCR-Runner':'cloud'}});
 const aResponse=await worker(req(aToken,'lease',{})),bResponse=await worker(req(bToken,'lease',{}));assert.equal(aResponse.status,200);assert.equal(bResponse.status,200);const a=await aResponse.json(),b=await bResponse.json();assert.equal(a.job.id,aId);assert.equal(b.job.id,bId);
 const cross=await worker(req(aToken,'complete',{id:bId,lease:b.job.lease,sha256:'f'.repeat(64),text:'forged',method:'ocr',confidence:100}));assert.equal(cross.status,409);
 await changeCompanyMembership(f.raw,f.b,{actorId:'actor-a',role:'admin',status:'active'});await selectCompany(f.raw,'actor-a','company-b',1);
 const download=f.request('/api/ocr-worker/document?id='+aId,{companyId:null,headers:{Authorization:'Bearer '+aToken,'X-MG-OCR-Runner':'cloud','X-MG-OCR-Lease':a.job.lease}});const original=await worker(download);assert.equal(original.status,200);assert.equal(await original.text(),'Synthetic original company-a');
 const bBefore=f.sql.prepare('SELECT * FROM document_jobs WHERE owner=?').all(f.b.owner);f.sql.prepare("UPDATE company_worker_grants SET status='revoked',grant_version=grant_version+1 WHERE company_id='company-a'").run();assert.equal((await worker(req(aToken,'lease',{}))).status,403);assert.deepEqual(f.sql.prepare('SELECT * FROM document_jobs WHERE owner=?').all(f.b.owner),bBefore);
});
test('a known company credential never falls back to another legacy owner after revoke or with the wrong runner',async t=>{
 const f=await fixture(t);await f.seed();const token='s'.repeat(43);Object.assign(f.env,{DOCUMENT_CLOUD_WORKER_TOKEN:token,DOCUMENT_WORKER_TOKEN:token,DOCUMENT_CLOUD_OCR_ENABLED:'true',DOCUMENT_OWNER_EMAIL:'legacy-b@example.test'});
 f.sql.prepare('INSERT INTO document_automation(owner,email,enabled,updated_at) VALUES(?,?,1,?)').run('legacy-b','legacy-b@example.test','now');
 await f.database(f.a).prepare('UPDATE document_automation SET enabled=1 WHERE owner=?').bind(f.a.owner).run();await createWorkerGrant(f.raw,f.a,{runner:'cloud',credentialHash:createHash('sha256').update(token).digest('hex')});
 const handler=f.wrap(async req=>f.server.response(await f.server.companyWorkerIdentity(req))),request=runner=>f.request('/api/ocr-worker/lease',{companyId:null,method:'POST',body:{},headers:{Authorization:'Bearer '+token,'X-MG-OCR-Runner':runner}});
 const own=await handler(request('cloud'));assert.equal(own.status,200);assert.equal((await own.json()).owner,f.a.owner);
 assert.equal((await handler(request('local'))).status,403);
 f.sql.prepare("UPDATE company_worker_grants SET status='revoked',grant_version=grant_version+1 WHERE company_id='company-a'").run();
 for(const runner of ['cloud','local']){const denied=await handler(request(runner));assert.equal(denied.status,403);assert.doesNotMatch(await denied.text(),/legacy-b/);}
});
test('Bankgiro provider intake blocks a registry owner/company mismatch before leases or provider calls',async t=>{
 const f=await fixture(t);await f.seed();const {server,environment,domain,ref}=f.moduleUrls;f.sourceCalls=0;
 const service=await import(compile('../lib/bankgiro-ingest-service.ts',{'cloudflare:workers':environment,'./server':server,'./domain':domain,'./bankgiro-service':data('export async function readBankgiroOriginal(){throw Error("Must not read an original");}'),'./bankgiro-parser.js':url('../lib/bankgiro-parser.js'),'./reconciliation-evidence':data('export async function assertPaymentOriginal(){}export async function writePaymentState(){throw Error("Must not write financial data");}'),'./bankgiro-ingest.js':url('../lib/bankgiro-ingest.js'),'./bankgiro-ingest-store.js':url('../lib/bankgiro-ingest-store.js'),'./bankgiro-source.js':url('../lib/bankgiro-source.js'),'./bankgiro-source-registry.js':data(`export async function resolveBankgiroSource(){const f=${ref};return {id:'synthetic-source',mode:'production',configurationValid:true,registration:f.registration,revocation:f.revocation,async authorize(){f.sourceCalls++;throw Error('Must not contact provider');},async listReports(){f.sourceCalls++;},async fetchReport(){f.sourceCalls++;}};}`)}));
 const handler=f.wrap(async req=>{const user=await f.server.identity(req);return f.server.response(await service.runBankgiroSource(user.userId));});
 for(const registration of [{owner:f.a.owner,companyId:'company-b'},{owner:f.b.owner,companyId:'company-a'}]){f.registration=registration;const before=f.sql.prepare('SELECT total_changes() n').get().n,r=await handler(f.request('/api/bankgiro/source/run',{method:'POST',body:{}}));assert.equal(r.status,200);const result=await r.json();assert.equal(result.state,'BLOCKED');assert.equal(result.reason,'COMPANY_BOUNDARY_MISMATCH');assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,before);}
 for(const companyId of [undefined,'company-b']){f.registration=undefined;f.revocation={owner:f.a.owner,companyId,configurationRevision:2};const before=f.sql.prepare('SELECT total_changes() n').get().n,r=await handler(f.request('/api/bankgiro/source/run',{method:'POST',body:{}}));assert.equal((await r.json()).reason,'COMPANY_BOUNDARY_MISMATCH');assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,before);}
 assert.equal(f.sourceCalls,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM bankgiro_ingest_leases').get().n,0);
});
test('unbound legacy endpoints retain their exact workspace and an explicit legacy directory',async t=>{
 const f=await fixture(t),payload=JSON.stringify({schemaVersion:1,company:{name:'Synthetic legacy'},invoices:[],transactions:[],allocations:[{id:'preserved'}],credits:[],imports:[],receipts:[]});
 f.sql.prepare('INSERT INTO workspaces VALUES(?,9,?,?)').run('actor-a',payload,'original-time');const directory=await(await f.list(f.request('/api/companies',{companyId:null}))).json();assert.equal(directory.legacy,true);
 const r=await f.state(f.request('/api/state',{companyId:null}));assert.equal(r.status,200);assert.equal((await r.json()).revision,9);assert.equal(f.sql.prepare('SELECT payload FROM workspaces').get().payload,payload);
 const newCompany=await f.create(f.request('/api/companies',{companyId:null,method:'POST',body:{name:'Other',confirmEmptyCompany:true}}));assert.equal(newCompany.status,409);assert.equal(f.sql.prepare('SELECT payload FROM workspaces').get().payload,payload);
});
test('unconfigured company Gmail status is neutral and connect/sync cannot touch any provider',async t=>{
 const f=await fixture(t);await f.seed();f.providerCalls=[];const {server,environment,domain,ref}=f.moduleUrls;
 const gmail=await import(compile('../lib/gmail-service.ts',{'cloudflare:workers':environment,'./server':server,'./domain':domain,'./invoice-fields.js':url('../lib/invoice-fields.js'),'./document-processing':data(`export async function processingStatus(){return {enabled:false,schedule_minutes:60,scheduler_configured:false};}export async function processingSettings(){return {enabled:false};}export async function processDocuments(){}export async function processingAction(){}export async function registerProcessedInvoice(){}`),'./banking/store':data(`export function storageReady(){return true;}export async function encrypt(){throw Error('Unexpected encryption');}export async function decrypt(){throw Error('Unexpected token read');}`),'./banking/security':url('../lib/banking/security.ts'),'./gmail-adapter.js':data(`const f=${ref};export function hasGmailSendScope(){return false;}export function isGmailConfigured(){return true;}export function gmailAuthorizationUrl(){f.providerCalls.push('connect');throw Error('Unexpected provider');}export async function exchangeGmailCode(){f.providerCalls.push('exchange');}export async function gmailProfile(){f.providerCalls.push('profile');}export async function fetchGmailInvoiceDocuments(){f.providerCalls.push('fetch');throw Error('Unexpected fetch');}export async function revokeGmailTokens(){f.providerCalls.push('revoke');}`)}));
 const status=await f.wrap(()=>gmail.gmailStatus())(f.request('/api/gmail/status'));assert.equal(status.status,200);const body=await status.json();assert.equal(body.configured,false);assert.equal(body.email,'');assert.doesNotMatch(JSON.stringify(body),/mg\.vitvaror|M\.George/);
 for(const [path,fn]of [['connect',gmail.gmailConnect],['sync',gmail.gmailSync]]){const response=await f.wrap(fn)(f.request('/api/gmail/'+path,{method:'POST',body:{}}));assert.equal(response.status,409);}
 assert.deepEqual(f.providerCalls,[]);assert.equal(f.sql.prepare('SELECT count(*) n FROM gmail_flows').get().n,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM gmail_sources').get().n,0);
});
test('tenant Gmail adapter uses the registered mailbox for profile, import identity and sender',async t=>{
 const f=await fixture(t);const originalFetch=globalThis.fetch;t.after(()=>globalThis.fetch=originalFetch);const sent=[];f.env.GOOGLE_CLIENT_ID='synthetic';f.env.GOOGLE_CLIENT_SECRET='synthetic';f.env.GMAIL_ACCOUNT='legacy@example.test';
 const account='company-a@example.test',tokens={access_token:'synthetic',expires_at:Date.now()+3600000,scope:'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send'};
 globalThis.fetch=async(input,options)=>{const u=String(input);if(u.endsWith('/profile'))return Response.json({emailAddress:account});if(u.endsWith('/messages/send')){sent.push(Buffer.from(JSON.parse(options.body).raw,'base64url').toString());return Response.json({id:'sent'});}if(u.includes('/messages?'))return Response.json({messages:[{id:'synthetic-message'}]});if(u.includes('/messages/synthetic-message?'))return Response.json({labelIds:['INBOX'],internalDate:'1793700000000',payload:{headers:[{name:'From',value:'supplier@example.test'},{name:'To',value:account},{name:'Subject',value:'Synthetic invoice'}],parts:[{filename:'invoice.pdf',mimeType:'application/pdf',partId:'1',body:{size:14,data:Buffer.from('%PDF-synthetic').toString('base64url')}}]}});throw Error('Unexpected URL '+u);};
 const adapter=await import(compile('../lib/gmail-adapter.js',{'cloudflare:workers':f.moduleUrls.environment,'./document-triage.js':url('../lib/document-triage.js')}));
 assert.equal(new URL(adapter.gmailAuthorizationUrl('s'.repeat(43),'https://synthetic.test',{account})).searchParams.get('login_hint'),account);
 const imported=await adapter.fetchGmailInvoiceDocuments(tokens,{account});assert.equal(imported.documents.length,1);assert.match(imported.documents[0].source_id,/gmail:company-a@example.test:/);
 const send=await adapter.prepareGmailSend(tokens,{account});await send({recipient:'recipient@example.test',subject:'Synthetic',body:'Synthetic',rfc_message_id:'<00000000-0000-4000-8000-000000000001@mg-fakturakoll.local>'});assert.match(sent[0],/^From: company-a@example.test\r\n/);assert.doesNotMatch(sent[0],/legacy@example.test|mg\.vitvaror/);
});
