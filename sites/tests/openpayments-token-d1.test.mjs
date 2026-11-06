import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {unstable_splitSqlQuery} from 'wrangler';
import {workersBindingConfiguration} from './helpers/openpayments-workers-fixture.mjs';

const path=name=>fileURLToPath(new URL('../lib/'+name,import.meta.url));
const configuration={environment:'PRODUCTION',clientId:'synthetic-real-d1-app',clientSecret:'synthetic-secret',credentialGeneration:'g1',redirectUris:[]};
const marker='synthetic-real-d1-application-token';
const workerSource=`
import {configuredOpenPaymentsWorkersTransport} from ${JSON.stringify(path('banking/openpayments-workers-transport.js'))};
import {createSitesOpenPaymentsTokenCoordinator} from ${JSON.stringify(path('banking/openpayments-sites-token-coordinator.ts'))};
import {OpenPaymentsTokenClient} from ${JSON.stringify(path('banking/openpayments/token.js'))};
import {createOpenPaymentsHttpClient} from ${JSON.stringify(path('banking/openpayments/http.js'))};
import {validateOpenPaymentsConfig} from ${JSON.stringify(path('banking/openpayments/config.js'))};
import {createCompanyDatabase,resolveCompanyScope,provisionCompany,companyApplicationTokenFence} from ${JSON.stringify(path('company-storage.js'))};
export default {async fetch(request,env){
 try {
  const route=new URL(request.url).pathname,configuration=JSON.parse(env.SAAS_OPENPAYMENTS_CONFIG);
  const mtls=configuredOpenPaymentsWorkersTransport({configuration,environment:()=>env});
  const coordinator=createSitesOpenPaymentsTokenCoordinator({configuration,mtls,environment:()=>env});
  if(route==='/company'){
   const result=await provisionCompany(env.DB,{id:'synthetic-company',name:'Synthetic company',actorId:'synthetic-actor',verifiedBy:'synthetic-actor',verificationEvidence:'Isolated D1 test only'});
   return Response.json(result);
  }
  if(route==='/economic'){
   const capability=await coordinator.captureFence();
   const scope=await resolveCompanyScope(env.DB,'synthetic-actor',{companyId:'synthetic-company',contextVersion:1});
   const database=createCompanyDatabase(env.DB,()=>scope),fence=companyApplicationTokenFence(database,capability);
   await env.BARRIER.fetch('http://synthetic.test/ready');
   await database.batch([fence,database.prepare('UPDATE workspaces SET revision=revision+1,payload=? WHERE owner=?').bind('{"synthetic":"economic write"}',scope.owner),fence]);
   return Response.json({committed:true});
  }
  if(route==='/readiness'){await coordinator.assertCurrent();await coordinator.captureFence();return Response.json({ready:true});}
  const config=validateOpenPaymentsConfig(configuration);
  const client=new OpenPaymentsTokenClient(config,createOpenPaymentsHttpClient(config,{transport:mtls.transport}),Date.now,{identity:mtls.cacheIdentity,coordinator});
  const value=await client.accessToken();
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
  return Response.json({sha256});
 }catch(error){return Response.json({code:error.code||'SYNTHETIC_REJECTED'}, {status:409});}
}};
`;
const bundled=await build({stdin:{contents:workerSource,resolveDir:process.cwd(),sourcefile:'synthetic-real-d1-token-worker.mjs'},bundle:true,format:'esm',platform:'node',write:false});
const journal=JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json',import.meta.url),'utf8')).entries;
async function harness(t,{completeSchema=false}={}){
 const state={tokenPosts:0,outboundCalls:0,mode:'success',barrier:async()=>{}};
 const issuer=async request=>{
  assert.equal(new URL(request.url).origin,'https://auth.openbankingplatform.com');assert.equal(new URL(request.url).pathname,'/connect/token');assert.equal(request.method,'POST');
  const form=new URLSearchParams(await request.text());assert.equal(form.get('grant_type'),'client_credentials');state.tokenPosts++;
  if(state.mode==='rate')return Response.json({error:'synthetic rate limit'},{status:429,headers:{'Retry-After':'120'}});
  if(state.mode==='unknown')return Response.json({error:'synthetic unknown issuer outcome'},{status:503});
  return Response.json({access_token:marker,token_type:'Bearer',expires_in:3600,scope:form.get('scope')});
 };
 const common={modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'synthetic-'+crypto.randomUUID()},bindings:{SAAS_BANK_ENABLED:'true',BANK_DATA_ENCRYPTION_KEY:'A'.repeat(43),SAAS_OPENPAYMENTS_CONFIG:JSON.stringify(configuration),SAAS_OPENPAYMENTS_MTLS_BINDING_CONFIG:JSON.stringify(workersBindingConfiguration())},serviceBindings:{OPENPAYMENTS_MTLS:issuer,BARRIER:async()=>{await state.barrier();return new Response('ready');}},outboundService:()=>{state.outboundCalls++;throw Error('External egress is forbidden.');}};
 const instance=new Miniflare({...convertV4MiniflareOptions({workers:[{name:'synthetic-a',...common},{name:'synthetic-b',...common}]}),enableDevRegistry:false,telemetry:{enabled:false}});
 t.after(async()=>{await instance.dispose();assert.equal(state.outboundCalls,0);});
 const database=await instance.getD1Database('DB','synthetic-a');
 for(const entry of completeSchema?journal:journal.filter(entry=>entry.tag==='0025_application_tokens')){
  const sql=readFileSync(new URL('../drizzle/'+entry.tag+'.sql',import.meta.url),'utf8');
  await database.batch(unstable_splitSqlQuery(sql).map(statement=>database.prepare(statement)));
 }
 const a=await instance.getWorker('synthetic-a'),b=await instance.getWorker('synthetic-b');
 const call=async(worker,route='/token')=>{const response=await worker.fetch('http://localhost'+route);return{status:response.status,data:await response.json()};};
 return{state,database,a,b,call};
}

test('two real Worker isolates coordinate a cold app token and 1/10/100 requests through one D1',async t=>{
 const f=await harness(t),first=await Promise.all([f.call(f.a),f.call(f.b)]);
 for(const result of first)assert.equal(result.status,200,JSON.stringify(result.data));
 assert.equal(first[0].data.sha256,first[1].data.sha256);assert.equal(f.state.tokenPosts,1);
 for(const count of [1,10,100]){
  const results=await Promise.all(Array.from({length:count},(_,index)=>f.call(index%2?f.a:f.b)));
  for(const result of results){assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.sha256,first[0].data.sha256);}
  assert.equal(f.state.tokenPosts,1);
 }
 const stored=(await f.database.prepare('SELECT * FROM company_application_tokens').all()).results;
 assert.equal(stored.length,1);assert.ok(!JSON.stringify(stored).includes(marker));assert.ok(!JSON.stringify(stored).includes(configuration.clientSecret));
});

test('actual D1 readiness remains a stored read with no first-family insertion',async t=>{
 const f=await harness(t);assert.equal((await f.call(f.a,'/readiness')).status,200);assert.equal((await f.call(f.b,'/readiness')).status,200);
 assert.equal((await f.database.prepare('SELECT count(*) AS n FROM company_application_tokens').first()).n,0);assert.equal(f.state.tokenPosts,0);
});

test('issuer 429 persists its cooldown across independent Worker isolates',async t=>{
 const f=await harness(t);f.state.mode='rate';
 assert.equal((await f.call(f.a)).data.code,'PROVIDER_RATE_LIMIT');assert.equal((await f.call(f.b)).data.code,'PROVIDER_RATE_LIMIT');assert.equal(f.state.tokenPosts,1);
 assert.ok((await f.database.prepare('SELECT cooldown_until FROM company_application_tokens').first()).cooldown_until>Date.now());
});

test('unknown issuance cannot be blindly retried by the other Worker',async t=>{
 const f=await harness(t);f.state.mode='unknown';
 assert.notEqual((await f.call(f.a)).status,200);assert.equal((await f.call(f.b)).data.code,'APPLICATION_TOKEN_UNCERTAIN');assert.equal(f.state.tokenPosts,1);
 const row=await f.database.prepare('SELECT uncertain_until,lease_token FROM company_application_tokens').first();assert.ok(row.uncertain_until>=Date.now()+3500000);assert.equal(row.lease_token,'');
});

test('real D1 financial transaction rejects an epoch rotation after the last asynchronous read',async t=>{
 const f=await harness(t,{completeSchema:true});assert.equal((await f.call(f.a)).status,200);
 const company=await f.call(f.a,'/company');assert.equal(company.status,200,JSON.stringify(company.data));
 assert.equal((await f.call(f.a,'/economic')).status,200);
 const before=await f.database.prepare('SELECT * FROM workspaces WHERE owner=?').bind(company.data.storageOwner).first();
 let ready,release;const entered=new Promise(resolve=>{ready=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 f.state.barrier=async()=>{ready();await gate;};
 const pending=f.call(f.a,'/economic');await entered;
 await f.database.prepare('UPDATE company_application_tokens SET epoch=epoch+1').run();release();
 assert.notEqual((await pending).status,200);
 assert.deepEqual(await f.database.prepare('SELECT * FROM workspaces WHERE owner=?').bind(company.data.storageOwner).first(),before);
 assert.equal((await f.database.prepare('SELECT count(*) n FROM company_operation_guard').first()).n,0);
 assert.equal(f.state.tokenPosts,1);
});
