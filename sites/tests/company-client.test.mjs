import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompanyClient, installCompanyClientSurface} from '../lib/company-client.js';

const baseUrl='https://synthetic.example/';
const context=(companyId='synthetic-a',extra={})=>({version:'company-context-v1',companyId,storageOwner:'storage-'+companyId,actorId:'synthetic-user',role:'owner',membershipVersion:1,companyVersion:1,contextVersion:1,...extra});
const directory=(active=context())=>({version:'company-context-v1',companies:[{id:'synthetic-a',name:'Synthetic A',role:'owner',membershipVersion:1},{id:'synthetic-b',name:'Synthetic B',role:'owner',membershipVersion:1}],activeCompanyId:active.companyId,contextVersion:active.contextVersion,context:active});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('a revoked active company permits selecting a remaining membership without loading any private data',async()=>{
  const calls=[],available={version:'company-context-v1',companies:[{id:'synthetic-b',name:'Synthetic B',role:'owner',membershipVersion:1}],activeCompanyId:null,actorId:'synthetic-user',contextVersion:4,selectionRequired:true};
  const {client}=fixture({fetch:async(input,init)=>{calls.push({input,init});return Response.json(input==='/api/companies'?available:{context:context('synthetic-b',{contextVersion:5})});}});
  assert.equal((await client.initialize()).status,'selection_required');
  await assert.rejects(client.fetch('/api/state'),/COMPANY_CONTEXT/);assert.equal(calls.length,1);
  await assert.rejects(client.switchCompany('synthetic-a'),/COMPANY_CONTEXT/);assert.equal(calls.length,1);
  const next=await client.switchCompany('synthetic-b');assert.equal(next.companyId,'synthetic-b');
  assert.deepEqual(JSON.parse(calls[1].init.body),{companyId:'synthetic-b',contextVersion:4});
  assert.equal(new Headers(calls[1].init.headers).has('X-Company-Id'),false);
  assert.equal(client.snapshot.status,'switching');
});
function fixture(options={}){
  const calls=[],invalidations=[],transport=options.fetch||((input,init)=>{calls.push({input,init});return Promise.resolve(Response.json(directory()));});
  const client=createCompanyClient({fetch:transport,baseUrl,onInvalidate:reason=>invalidations.push(reason)});
  return {client,calls,invalidations};
}

test('company client binds every same-origin API request to the verified company and context version',async()=>{
  const {client,calls}=fixture();await client.initialize();await client.fetch('/api/state');
  const request=calls.at(-1);assert.equal(new Headers(request.init.headers).get('X-Company-Id'),'synthetic-a');assert.equal(new Headers(request.init.headers).get('X-Company-Context-Version'),'1');assert.equal(request.init.cache,'no-store');
  assert.equal(client.snapshot.context.companyId,'synthetic-a');assert.equal(client.snapshot.status,'ready');
});

test('external destinations and authentication routes receive no tenant decoration',async()=>{
  const {client,calls}=fixture();await client.initialize();
  for(const input of ['https://bank.example/api/data','/signin-with-chatgpt','/api/login','/api/logout','/api/me']){
    const init={method:'POST',headers:{'Content-Type':'application/json'},body:'{}',credentials:'omit'};
    await client.fetch(input,init);assert.equal(calls.at(-1).input,input);assert.equal(calls.at(-1).init,init);
  }
});

test('Request bodies, headers, credentials and caller cancellation survive tenant binding',async()=>{
  const {client,calls}=fixture();await client.initialize();const abort=new AbortController();
  const request=new Request(baseUrl+'api/state',{method:'POST',body:'{"synthetic":true}',headers:{'Content-Type':'application/json','X-Synthetic':'preserved'},credentials:'include',signal:abort.signal});
  await client.fetch(request,{redirect:'manual'});const sent=calls.at(-1),effective=new Request(sent.input,sent.init);
  assert.equal(await effective.text(),'{"synthetic":true}');assert.equal(effective.method,'POST');assert.equal(effective.credentials,'include');assert.equal(effective.redirect,'manual');assert.equal(effective.headers.get('X-Synthetic'),'preserved');
  abort.abort();assert.equal(sent.init.signal.aborted,true);
});

test('forged selector headers, duplicate selectors and original query selectors are rejected before transport',async()=>{
  const {client,calls}=fixture();await client.initialize();const baseline=calls.length;
  for(const [input,init] of [['/api/state',{headers:{'X-Company-Id':'synthetic-b'}}],['/api/state',{headers:{'X-Company-Context-Version':'2'}}],['/api/files?id=same&companyId=synthetic-b',{}],['/api/files?id=same&companyId=synthetic-a&companyId=synthetic-b',{}],['/api/files?id=same&companyContextVersion=2',{}]])await assert.rejects(client.fetch(input,init),/COMPANY_CONTEXT/);
  assert.equal(calls.length,baseline);
});

test('late responses from A are rejected after a switch starts even when IDs and revisions are identical',async()=>{
  const read=deferred(),change=deferred(),invalidations=[];const client=createCompanyClient({baseUrl,onInvalidate:reason=>invalidations.push(reason),fetch:(input)=>String(input)==='/api/companies'?Promise.resolve(Response.json(directory())):String(input)==='/api/companies/active'?change.promise:read.promise});
  await client.initialize();const pending=client.fetch('/api/state');const rejected=assert.rejects(pending,/COMPANY_CONTEXT_STALE/);const switching=client.switchCompany('synthetic-b');
  assert.equal(client.snapshot.status,'switching');assert.equal(invalidations.length,1);
  read.resolve(Response.json({revision:1,state:{invoices:[{id:'same',party:'Company A private'}]}}));await rejected;
  change.resolve(Response.json({context:context('synthetic-b',{contextVersion:2})}));await switching;
  assert.equal(client.snapshot.context.companyId,'synthetic-b');assert.equal(client.snapshot.status,'switching','Only a full remount may expose the new workspace');
});

test('a response body that finishes after invalidation cannot resurrect old company data',async()=>{
  const body=deferred();const {client}=fixture({fetch:async input=>String(input)==='/api/companies'?Response.json(directory()):{ok:true,status:200,headers:new Headers(),json:()=>body.promise}});
  await client.initialize();const response=await client.fetch('/api/bank/verification?transactionId=same');const reading=response.json(),rejected=assert.rejects(reading,/COMPANY_CONTEXT_STALE/);
  client.invalidate('changed');body.resolve({transactionId:'same',revision:1,private:'Company A'});await rejected;
});

test('authorization loss invalidates the entire workspace and blocks later requests',async()=>{
  let calls=0;const {client,invalidations}=fixture({fetch:async input=>{calls++;return String(input)==='/api/companies'?Response.json(directory()):Response.json({error:'revoked'},{status:403});}});
  await client.initialize();await assert.rejects(client.fetch('/api/state'),error=>error.status===403);assert.equal(client.snapshot.status,'blocked');assert.equal(invalidations.length,1);const baseline=calls;
  await assert.rejects(client.fetch('/api/state'),/COMPANY_CONTEXT/);assert.equal(calls,baseline);
});

test('response company or context mismatch fails closed without exposing the body',async()=>{
  for(const headers of [{'X-Company-Id':'synthetic-b'},{'X-Company-Context-Version':'2'}]){
    const {client}=fixture({fetch:async input=>String(input)==='/api/companies'?Response.json(directory()):Response.json({private:'unrelated'},{headers})});await client.initialize();await assert.rejects(client.fetch('/api/state'),/COMPANY_CONTEXT/);assert.equal(client.snapshot.status,'blocked');
  }
});

test('active-company switch only accepts a listed company and verifies the returned actor and newer version',async()=>{
  for(const returned of [context('synthetic-a',{contextVersion:2}),context('synthetic-b',{actorId:'other-user',contextVersion:2}),context('synthetic-b')]){
    const {client}=fixture({fetch:async input=>String(input)==='/api/companies'?Response.json(directory()):Response.json({context:returned})});await client.initialize();await assert.rejects(client.switchCompany('forged'),/COMPANY_CONTEXT/);assert.equal(client.snapshot.status,'ready');await assert.rejects(client.switchCompany('synthetic-b'),/COMPANY_CONTEXT/);assert.equal(client.snapshot.status,'blocked');
  }
});

test('legacy requires an explicit empty binding and preserves requests without manufacturing a company',async()=>{
  const calls=[];const {client}=fixture({fetch:async(input,init)=>{calls.push({input,init});return Response.json({version:'company-context-v1',companies:[],activeCompanyId:null,contextVersion:1,legacy:true});}});
  await client.initialize();assert.equal(client.snapshot.status,'legacy');assert.equal(client.snapshot.context,null);await client.fetch('/api/state');assert.equal(new Headers(calls.at(-1).init?.headers).has('X-Company-Id'),false);assert.equal(client.href('/api/files?id=synthetic'),'/api/files?id=synthetic');
  await assert.rejects(client.switchCompany('synthetic-a'),/COMPANY_CONTEXT/);
});

test('malformed, forbidden and unavailable directory responses never downgrade to legacy',async()=>{
  for(const result of [Response.json({companies:[]}),Response.json({...directory(),activeCompanyId:'synthetic-b'}),Response.json({...directory(),context:{...context(),contextVersion:0}}),Response.json({error:'forbidden'},{status:403}),Response.json({error:'missing'},{status:404})]){
    const {client}=fixture({fetch:async()=>result});await assert.rejects(client.initialize());assert.equal(client.snapshot.status,'blocked');await assert.rejects(client.fetch('/api/state'),/COMPANY_CONTEXT/);
  }
});

test('original URLs are company-bound without changing bytes, IDs or external destinations',async()=>{
  const {client}=fixture();await client.initialize();const link=new URL(client.href('/api/files?id=original-0599'),baseUrl);
  assert.equal(link.searchParams.get('id'),'original-0599');assert.equal(link.searchParams.get('companyId'),'synthetic-a');assert.equal(link.searchParams.get('companyContextVersion'),'1');
  assert.equal(client.href('https://external.example/api/files?id=original-0599'),'https://external.example/api/files?id=original-0599');assert.throws(()=>client.href('/api/files?id=same&companyId=synthetic-b'),/COMPANY_CONTEXT/);
});

test('membership, company, actor and context version changes invalidate an existing client',async()=>{
  for(const changed of [context('synthetic-b'),context('synthetic-a',{actorId:'other'}),context('synthetic-a',{membershipVersion:2}),context('synthetic-a',{companyVersion:2}),context('synthetic-a',{contextVersion:2})]){
    let calls=0;const {client}=fixture({fetch:async()=>Response.json(directory(++calls===1?context():changed))});await client.initialize();assert.equal(await client.revalidate(),false);assert.equal(client.snapshot.status,'blocked');
  }
});

test('surface installs a single bounded fetch adapter and restores fetch and listeners when disposed',async()=>{
  const surface=new EventTarget();surface.location=new URL(baseUrl);surface.document=new EventTarget();surface.document.querySelectorAll=()=>[];let rawCalls=0;const raw=async()=>{rawCalls++;return Response.json(directory());};surface.fetch=raw;
  const client=createCompanyClient({baseUrl,fetch:raw});await client.initialize();const dispose=installCompanyClientSurface(client,surface);assert.notEqual(surface.fetch,raw);await surface.fetch('/api/state');assert.equal(rawCalls,2);dispose();assert.equal(surface.fetch,raw);dispose();assert.equal(surface.fetch,raw);
});

test('decorating observed original links is idempotent and cannot create an observer loop',async()=>{
  const surface=new EventTarget();surface.location=new URL(baseUrl);surface.document=new EventTarget();surface.document.body={};surface.fetch=async()=>Response.json(directory());let callback,writes=0;
  const link={value:'/api/files?id=synthetic',matches:()=>true,getAttribute(){return this.value;},setAttribute(name,value){writes++;this.value=value;},querySelectorAll:()=>[]};surface.document.querySelectorAll=()=>[link];
  surface.MutationObserver=class{constructor(fn){callback=fn;}observe(){}disconnect(){}};
  const client=createCompanyClient({baseUrl,fetch:surface.fetch});await client.initialize();const dispose=installCompanyClientSurface(client,surface);assert.equal(writes,1);
  callback([{type:'attributes',target:link}]);callback([{type:'attributes',target:link}]);assert.equal(writes,1,'An unchanged href must not schedule another mutation');dispose();
});

test('stale context conflicts invalidate the client while ordinary workspace revision conflicts remain local',async()=>{
  for(const stale of [true,false]){
    const {client}=fixture({fetch:async input=>String(input)==='/api/companies'?Response.json(directory()):Response.json(stale?{code:'COMPANY_CONTEXT_STALE'}:{error:'Revision changed'},{status:409})});await client.initialize();
    if(stale){await assert.rejects(client.fetch('/api/state'),/COMPANY_CONTEXT_STALE/);assert.equal(client.snapshot.status,'blocked');}
    else{const response=await client.fetch('/api/state');assert.equal(response.status,409);assert.equal((await response.json()).error,'Revision changed');assert.equal(client.snapshot.status,'ready');}
  }
});

test('viewer background mutations are refused locally without hiding the readable workspace',async()=>{
  const calls=[];const bound=directory(context('synthetic-a',{role:'viewer'}));bound.companies[0].role='viewer';
  const {client}=fixture({fetch:async(input,init)=>{calls.push({input,init});return Response.json(bound);}});await client.initialize();const baseline=calls.length;
  for(const method of ['POST','PUT','PATCH','DELETE'])await assert.rejects(client.fetch('/api/bank/auto-sync',{method,body:'{}'}),error=>error.code==='COMPANY_FORBIDDEN'&&error.status===403);
  assert.equal(calls.length,baseline);assert.equal(client.snapshot.status,'ready');await client.fetch('/api/state');assert.equal(calls.length,baseline+1);
});

test('accountant keeps financial write access but cannot launch connector or payment-control synchronization',async()=>{
  const calls=[];const bound=directory(context('synthetic-a',{role:'accountant'}));bound.companies[0].role='accountant';
  const {client}=fixture({fetch:async(input,init)=>{calls.push({input,init});return Response.json(bound);}});await client.initialize();const baseline=calls.length;
  for(const path of ['/api/bank/auto-sync','/api/bank/sync','/api/gmail/sync','/api/bankgiro/source/run','/api/payment-control/run','/api/payment-control/step'])await assert.rejects(client.fetch(path,{method:'POST',body:'{}'}),error=>error.code==='COMPANY_FORBIDDEN');
  assert.equal(calls.length,baseline);assert.equal(client.snapshot.status,'ready');await client.fetch('/api/invoices',{method:'POST',body:'{}'});assert.equal(calls.length,baseline+1);
});
