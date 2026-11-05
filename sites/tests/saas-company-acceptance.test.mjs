import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerFixture,companies} from './helpers/saas-owner-fixture.mjs';
import {provisionCompany,resolveCompanyScope,companyDirectory,selectCompany,changeCompanyMembership,createCompanyDatabase} from '../lib/company-storage.js';
import {seal,unseal} from '../lib/banking/security.ts';
import {createCompanyClient} from '../lib/company-client.js';
const actor='synthetic-shared-actor';
async function fixture(t){
 const f=await ownerFixture(t),raw=f.env.DB;assert.equal(companies.length,3,'acceptance requires three actual company fixtures');f.contexts=new Map();
 for(const [i,entry]of companies.entries()){
  let company=entry;
  const id='actual-company-'+company.label.toLowerCase();company={...company,id};
  await provisionCompany(raw,{id,name:'Synthetic '+company.label,actorId:company.owner,legacyOwner:company.owner,verifiedLegacyOwner:company.owner,verifiedBy:'synthetic-operator',verificationEvidence:'Synthetic explicit legacy workspace adoption evidence'});
  const scope=await resolveCompanyScope(raw,company.owner,{companyId:id,contextVersion:1});
  await changeCompanyMembership(raw,scope,{actorId:actor,role:['admin','accountant','viewer'][i],status:'active'});
  const database=createCompanyDatabase(raw,async()=>scope),payload=await seal(f.env.BANK_DATA_ENCRYPTION_KEY,company.owner,'saas-bank-state',{id:'same-consent-id',companyId:id,status:'active',private:'consent-'+company.label});
  await database.prepare('INSERT INTO saas_bank_state(owner,revision,payload) VALUES(?,1,?)').bind(company.owner,payload).run();
  await database.prepare('INSERT INTO document_jobs(owner,document_id,available_at,updated_at) VALUES(?,?,?,?)').bind(company.owner,'same-job-id','2026-11-01','2026-11-01').run();
  f.contexts.set(id,{...company,scope});
 }
 f.select=async(id,who=actor)=>{let d=await companyDirectory(raw,who);if(d.activeCompanyId!==id)await selectCompany(raw,who,id,d.contextVersion);d=await companyDirectory(raw,who);f.user={userId:who,displayName:'Synthetic shared actor'};return d.context;};
 f.request=(context,path='/api/state',options={})=>new Request('https://mg.test'+path,{...options,headers:{'x-company-id':context.companyId,'x-company-context-version':String(context.contextVersion),...(options.method&&options.method!=='GET'?{origin:'https://mg.test'}:{}),...options.headers}});
 f.run=(request,handler)=>f.server.withCompanyRequest(handler)(request);
 f.readState=request=>f.run(request,()=>f.state.GET());
 return f;
}

test('three actual companies with shared actor isolate identical invoices, consent IDs, jobs and private R2 originals',async t=>{
 const f=await fixture(t),financialBefore=f.sqlite.prepare('SELECT owner,revision,payload FROM workspaces ORDER BY owner').all();
 for(const company of f.contexts.values()){
  const c=await f.select(company.id);assert.equal(c.role,{A:'admin',B:'accountant',C:'viewer'}[company.label]);assert.equal(company.scope.context.role,'owner');const result=await f.readState(f.request(c));assert.equal(result.status,200);const body=await result.json();assert.equal(body.state.company.name,'Synthetic company '+company.label);assert.equal(body.state.invoices[0].number,'000018');assert.equal(body.state.allocations.length,0);
  const scoped=await f.run(f.request(c),async()=>{await f.server.identity();return f.server.response({connections:(await f.server.db().prepare('SELECT owner,id FROM bank_connections').all()).results,consents:(await f.server.db().prepare('SELECT owner,payload FROM saas_bank_state').all()).results,jobs:(await f.server.db().prepare('SELECT owner,document_id FROM document_jobs').all()).results});});
  const privateRows=await scoped.json();for(const name of ['connections','consents','jobs']){assert.equal(privateRows[name].length,1);assert.equal(privateRows[name][0].owner,company.owner);}
  const value=await unseal(f.env.BANK_DATA_ENCRYPTION_KEY,company.owner,'saas-bank-state',privateRows.consents[0].payload);assert.equal(value.companyId,company.id);
  for(const foreign of [...f.contexts.values()].filter(x=>x.id!==company.id)){
   const original=f.records.get(foreign.owner).invoice,reads=f.reads.length;
   const forbidden=await f.run(f.request(c,'/api/files?id='+original.id),req=>f.files.GET(req));assert.equal(forbidden.status,404);assert.equal(f.reads.length,reads,'foreign metadata never permits R2 access');
   await assert.rejects(unseal(f.env.BANK_DATA_ENCRYPTION_KEY,foreign.owner,'saas-bank-state',privateRows.consents[0].payload));
  }
  const own=f.records.get(company.owner).invoice,download=await f.run(f.request(c,'/api/files?id='+own.id),req=>f.files.GET(req));assert.equal(download.status,200);assert.deepEqual(new Uint8Array(await download.arrayBuffer()),own.bytes);assert.equal(download.headers.get('cache-control'),'private, no-store');
 }
 assert.deepEqual(f.sqlite.prepare('SELECT owner,revision,payload FROM workspaces ORDER BY owner').all(),financialBefore);
});

test('stale selection and revoked membership deny captured SQL and HTTP responses after an await',async t=>{
 const f=await fixture(t),a=await f.select('actual-company-a'),request=f.request(a);let release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);
 const response=f.run(request,async()=>{await f.server.identity();const statement=f.server.db().prepare('SELECT payload FROM saas_bank_state');entered();await gate;return f.server.response(await statement.all());});await ready;
 await f.select('actual-company-b');release();const rejected=await response;assert.equal(rejected.status,409);assert.equal((await f.readState(request)).status,409);
 const b=await f.select('actual-company-b'),before=f.sqlite.prepare('SELECT * FROM saas_bank_state ORDER BY owner').all();
 const owner=f.contexts.get('actual-company-b');await changeCompanyMembership(f.env.DB,owner.scope,{actorId:actor,role:'accountant',status:'revoked'});
 assert.equal((await f.readState(f.request(b))).status,403);assert.deepEqual(f.sqlite.prepare('SELECT * FROM saas_bank_state ORDER BY owner').all(),before);
});

test('viewer cannot upload originals and accountant cannot manage integration even with forged role or owner',async t=>{
 const f=await fixture(t),viewer=await f.select('actual-company-c'),before=f.objects.size,form=new FormData();form.set('file',new File(['synthetic denied bytes'],'denied.txt'));form.set('role','owner');
 const upload=await f.run(f.request(viewer,'/api/files',{method:'POST',body:form}),req=>f.files.POST(req));assert.equal(upload.status,403);assert.equal(f.objects.size,before);
 const accountant=await f.select('actual-company-b'),attempt=await f.run(f.request(accountant,'/api/bank/disconnect',{method:'POST'}),async()=>{await f.server.identity();return f.server.response({unexpected:true});});assert.equal(attempt.status,403);
 const forged=f.request(accountant,'/api/state?companyId=actual-company-a&companyContextVersion='+accountant.contextVersion);assert.equal((await f.readState(forged)).status,409);
});

test('browser company switch invalidates private cached state and rejects an old actual server response',async t=>{
 const f=await fixture(t);await f.select('actual-company-a');let release,entered,hold=false;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r),cache=new Map();
 const transport=async(input,init={})=>{
  if(input==='/api/companies')return Response.json(await companyDirectory(f.env.DB,actor));
  if(input==='/api/companies/active'){const body=JSON.parse(init.body);return Response.json({context:await selectCompany(f.env.DB,actor,body.companyId,body.contextVersion)});}
  const response=await f.readState(new Request(new URL(input,'https://mg.test'),init));if(hold){entered();await gate;}return response;
 };
 const client=createCompanyClient({baseUrl:'https://mg.test/',onInvalidate:()=>cache.clear(),fetch:transport});
 await client.initialize();cache.set('state',await (await client.fetch('/api/state')).json());assert.equal(cache.get('state').state.company.name,'Synthetic company A');
 hold=true;const old=client.fetch('/api/state');await ready;await client.switchCompany('actual-company-b');assert.equal(cache.size,0);release();await assert.rejects(old,/COMPANY_CONTEXT/);
 hold=false;client.dispose();const reloaded=createCompanyClient({baseUrl:'https://mg.test/',fetch:transport});await reloaded.initialize();const current=await (await reloaded.fetch('/api/state')).json();assert.equal(current.state.company.name,'Synthetic company B');assert.equal(JSON.stringify(current).includes('Synthetic company A'),false);
});

test('membership revoked during a real R2 original read prevents response delivery',async t=>{
 const f=await fixture(t),c=await f.select('actual-company-a'),company=f.contexts.get(c.companyId),original=f.records.get(company.owner).invoice;
 let release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r),read=f.env.BUCKET.get;
 f.env.BUCKET.get=async key=>{const object=await read(key);entered();await gate;return object;};
 const pending=f.run(f.request(c,'/api/files?id='+original.id),req=>f.files.GET(req));await ready;
 await changeCompanyMembership(f.env.DB,company.scope,{actorId:actor,role:'admin',status:'revoked'});release();const result=await pending;assert.equal(result.status,403);assert.equal((await result.text()).includes('Synthetic original'),false);assert.ok(f.objects.has(company.owner+'/'+original.id));
});
