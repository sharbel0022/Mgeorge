import test from 'node:test';
import assert from 'node:assert/strict';
import * as registryModule from '../lib/bankgiro-source-registry.js';

const NOW=Date.parse('2026-11-03T12:00:00Z');
const iso=offset=>new Date(NOW+offset).toISOString();
const HASH='2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
const TOKEN='synthetic-private-token';
const registration=()=>({id:'source-1',owner:'owner-1',companyId:'company-1',bankgiro:'0599',scopeId:'scope-1',generation:'generation-1',mode:'production',enabled:true,transport:'https-v1',baseUrl:'https://reports.example.com/feed',tokenSecret:'REPORT_TOKEN',profileId:'approved-profile',allowedFormats:['csv','xml','xlsx'],intervalMinutes:15,entitlement:{status:'VERIFIED',origin:'provider_authorization',evidenceId:'local-evidence',checkedAt:iso(-86400000),validUntil:iso(86400000),capabilities:['bankgiro_reports:read']}});
const receipt=()=>({status:'VERIFIED',owner:'owner-1',sourceId:'source-1',companyId:'company-1',bankgiro:'0599',scopeId:'scope-1',generation:'generation-1',profileId:'approved-profile',evidenceId:'remote-evidence',checkedAt:iso(-1000),validUntil:iso(60000),origin:'provider_authorization',capabilities:['bankgiro_reports:read']});
const descriptor=()=>({reportId:'opaque-report-1',filename:'report.csv',sha256:HASH,byteLength:5});
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
function transport(overrides={}){
 return async (input,init)=>{
  const url=new URL(input);
  assert.equal(url.origin,'https://reports.example.com');
  assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');
  assert.equal(init.headers.Authorization,`Bearer ${TOKEN}`);
  assert.equal(init.headers['Accept-Encoding'],'identity');
  if(url.pathname==='/feed/v1/authorization')return overrides.authorization?.(url,init)??json(receipt());
  if(url.pathname==='/feed/v1/reports'){
   assert.equal(url.searchParams.get('limit'),'2');assert.equal(url.searchParams.get('cursor'),'cursor /?');
   return overrides.list?.(url,init)??json({reports:[descriptor()],nextCursor:null});
  }
  if(url.pathname==='/feed/v1/reports/opaque-report-1/content')return overrides.content?.(url,init)??new Response('hello',{headers:{'Content-Length':'5'}});
  assert.fail(`Unexpected synthetic protocol route ${url.pathname}`);
 };
}
function registry(reg=registration(),fetchImpl=transport(),options={}){
 assert.equal(typeof registryModule.createBankgiroSourceRegistry,'function','trusted registry must resolve registered HTTPS sources');
 return registryModule.createBankgiroSourceRegistry({configuration:{version:1,revision:7,registrations:[reg]},secrets:{REPORT_TOKEN:TOKEN},fetchImpl,now:()=>NOW,...options});
}
const safeError=code=>error=>{assert.equal(error.code,code);assert.equal(error.message,code);assert.equal(JSON.stringify(error).includes(TOKEN),false);assert.equal(JSON.stringify(error).includes('example.com'),false);return true;};

test('unconfigured resolver stays absent and valid scoped source returns immutable authority and exact original bytes',async()=>{
 assert.equal(await registryModule.resolveBankgiroSource('owner-1'),null);
 const reg=registration();const source=registry(reg).resolve('owner-1');
 assert.equal(source.configurationValid,true);assert.equal(source.mode,'production');assert.equal(source.intervalMinutes,15);
 assert.equal(source.registration.configurationRevision,7);assert.equal(Object.isFrozen(source.registration),true);
 assert.equal(Object.isFrozen(source.registration.entitlement.capabilities),true);
 reg.owner='foreign';reg.entitlement.capabilities.length=0;
 const authorization=await source.authorize({owner:'owner-1'});
 assert.equal(authorization.bankgiro,'0599');assert.equal(authorization.companyId,'company-1');
 const page=await source.listReports({owner:'owner-1',authorization,cursor:'cursor /?',limit:2});
 assert.equal(page.reports[0].byteLength,5);
 assert.deepEqual(await source.fetchReport({owner:'owner-1',authorization,report:page.reports[0]}),new TextEncoder().encode('hello'));
});

test('configured registry is owner isolated and accepts server JSON configuration without exposing secrets',async()=>{
 const config={version:1,revision:7,registrations:[registration()]};
 const r=registry(undefined,undefined,{configuration:JSON.stringify(config)});
 assert.ok(r.resolve('foreign'),'configured removal must resolve an explicit revocation');assert.equal(r.resolve('foreign').configurationValid,false);assert.deepEqual(r.resolve('foreign').revocation,{owner:'foreign',configurationRevision:7});assert.equal(r.resolve('owner-1').registration.owner,'owner-1');
 const source=r.resolve('owner-1');assert.equal(JSON.stringify(source).includes(TOKEN),false);
 assert.equal(JSON.stringify(source.registration).includes(TOKEN),false);
});

for(const [name,mutate] of [
 ['synthetic mode',r=>r.mode='synthetic'],['disabled',r=>r.enabled=false],['noncanonical Bankgiro',r=>r.bankgiro='05-99'],
 ['manual provenance',r=>r.entitlement.origin='manual'],['unverified local entitlement',r=>r.entitlement.status='UNVERIFIED'],
 ['expired local entitlement',r=>r.entitlement.validUntil=iso(0)],['future local evidence',r=>r.entitlement.checkedAt=iso(1)],
 ['missing read capability',r=>r.entitlement.capabilities=['ais:read']],['missing company',r=>delete r.companyId],
 ['invalid interval',r=>r.intervalMinutes=0],['missing credential',r=>r.tokenSecret='ABSENT'],['unsupported format',r=>r.allowedFormats=['pdf']],
 ['HTTP',r=>r.baseUrl='http://reports.example.com'],['credentials',r=>r.baseUrl='https://secret@reports.example.com'],
 ['fragment',r=>r.baseUrl='https://reports.example.com/#secret'],['query',r=>r.baseUrl='https://reports.example.com/?secret'],
 ['IPv4 private',r=>r.baseUrl='https://127.0.0.1'],['numeric loopback',r=>r.baseUrl='https://2130706433'],
 ['IPv6',r=>r.baseUrl='https://[::1]'],['localhost',r=>r.baseUrl='https://localhost'],['local suffix',r=>r.baseUrl='https://reports.internal'],
 ['ambiguous base path',r=>r.baseUrl='https://reports.example.com/feed/%2fother'],
 ])test(`trusted registry fails closed for ${name}`,async()=>{
  const reg=registration();mutate(reg);Object.freeze(reg);
  const source=registry(reg,()=>assert.fail('blocked source must never access network')).resolve('owner-1');
  assert.equal(source.configurationValid,false);
  await assert.rejects(source.authorize({owner:'owner-1'}),safeError('AUTHORIZATION_BLOCKED'));
 });

for(const configuration of ['{malformed',{}, {version:2,revision:7,registrations:[]},{version:1,revision:0,registrations:[]},{version:1,revision:7,registrations:[registration(),registration()]}])
 test('malformed/duplicate configuration produces safe blocked source',async()=>{
  const source=registry(undefined,()=>assert.fail('invalid config network call'),{configuration}).resolve('owner-1');
  assert.equal(source.configurationValid,false);
  await assert.rejects(source.authorize({owner:'owner-1'}),safeError('AUTHORIZATION_BLOCKED'));
 });

for(const [name,mutate] of [
 ['owner',a=>a.owner='foreign'],['source',a=>a.sourceId='foreign'],['company',a=>a.companyId='foreign'],
 ['Bankgiro leading zero',a=>a.bankgiro='599'],['scope',a=>a.scopeId='foreign'],['generation',a=>a.generation='foreign'],['profile',a=>a.profileId='foreign'],
 ['provenance',a=>a.origin='ais'],['capability',a=>a.capabilities=[]],['expiry',a=>a.validUntil=iso(0)],
 ['future check',a=>a.checkedAt=iso(1)],['stale check',a=>a.checkedAt=iso(-300001)],['evidence absent',a=>delete a.evidenceId]
 ])test(`fresh remote authorization refuses wrong ${name}`,async()=>{
  const auth=receipt();mutate(auth);
  const source=registry(undefined,transport({authorization:()=>json(auth)})).resolve('owner-1');
  await assert.rejects(source.authorize({owner:'owner-1'}),safeError('AUTHORIZATION_BLOCKED'));
 });

test('foreign caller and forged authorization never reach report endpoints',async()=>{
 const source=registry(undefined,()=>assert.fail('unauthorized network call')).resolve('owner-1');
 await assert.rejects(source.authorize({owner:'foreign'}),safeError('AUTHORIZATION_BLOCKED'));
 await assert.rejects(source.listReports({owner:'owner-1',authorization:receipt(),limit:2}),safeError('AUTHORIZATION_BLOCKED'));
 await assert.rejects(source.fetchReport({owner:'owner-1',authorization:receipt(),report:descriptor()}),safeError('AUTHORIZATION_BLOCKED'));
});

for(const [name,makeResponse,want] of [
 ['redirect',()=>new Response(null,{status:302,headers:{Location:'https://evil.example.com/secret'}}),'SOURCE_UNAVAILABLE'],
 ['partial content',()=>new Response('hello',{status:206}),'SOURCE_UNAVAILABLE'],
 ['encoded body',()=>new Response('hello',{headers:{'Content-Encoding':'gzip'}}),'INVALID_ORIGINAL'],
 ['short length',()=>new Response('hell',{headers:{'Content-Length':'5'}}),'INVALID_ORIGINAL'],
 ['long length',()=>new Response('hello!',{headers:{'Content-Length':'5'}}),'INVALID_ORIGINAL'],
 ['invalid length',()=>new Response('hello',{headers:{'Content-Length':'5x'}}),'INVALID_ORIGINAL'],
 ['oversize declared length',()=>new Response('hello',{headers:{'Content-Length':'15000001'}}),'INVALID_ORIGINAL'],
 ['digest mismatch',()=>new Response('jello',{headers:{'Content-Length':'5'}}),'HASH_MISMATCH'],
 ['empty original',()=>new Response(''),'INVALID_ORIGINAL'],
 ])test(`download rejects ${name}`,async()=>{
  const source=registry(undefined,transport({content:makeResponse})).resolve('owner-1');const authorization=await source.authorize({owner:'owner-1'});
  await source.listReports({owner:'owner-1',authorization,cursor:'cursor /?',limit:2});
  await assert.rejects(source.fetchReport({owner:'owner-1',authorization,report:descriptor()}),safeError(want));
 });

test('list rejects arbitrary download URL and unapproved report formats',async()=>{
 for(const extra of [{downloadUrl:'https://evil.example.com/original'},{filename:'report.pdf'},{byteLength:15000001}]){
  const source=registry(undefined,transport({list:()=>json({reports:[{...descriptor(),...extra}],nextCursor:null})})).resolve('owner-1');
  const authorization=await source.authorize({owner:'owner-1'});
  await assert.rejects(source.listReports({owner:'owner-1',authorization,cursor:'cursor /?',limit:2}),safeError('INVALID_PAGE'));
 }
});

test('JSON is bounded while streaming and reader is cancelled without consuming excess bytes',async()=>{
 let cancelled=false;
 const body=new ReadableStream({pull(c){c.enqueue(new Uint8Array(70000).fill(32));},cancel(){cancelled=true;}});
 const source=registry(undefined,transport({authorization:()=>new Response(body,{headers:{'Content-Type':'application/json'}})})).resolve('owner-1');
 await assert.rejects(source.authorize({owner:'owner-1'}),safeError('SOURCE_UNAVAILABLE'));
 assert.equal(cancelled,true);
});

test('binary is bounded while streaming and cancels the reader',async()=>{
 let cancelled=false;
 const body=new ReadableStream({pull(c){c.enqueue(new Uint8Array(1000000));},cancel(){cancelled=true;}});
 const source=registry(undefined,transport({content:()=>new Response(body)})).resolve('owner-1');const authorization=await source.authorize({owner:'owner-1'});
 await assert.rejects(source.fetchReport({owner:'owner-1',authorization,report:{...descriptor(),byteLength:undefined}}),safeError('INVALID_ORIGINAL'));
 assert.equal(cancelled,true);
});

test('caller abort cancels a stalled download and never exposes underlying errors',async()=>{
 let cancelled=false;let started;const ready=new Promise(resolve=>started=resolve);
 const body=new ReadableStream({start(){started();},cancel(){cancelled=true;}});
 const source=registry(undefined,transport({content:()=>new Response(body)})).resolve('owner-1');const authorization=await source.authorize({owner:'owner-1'});
 const controller=new AbortController();const pending=source.fetchReport({owner:'owner-1',authorization,report:descriptor(),signal:controller.signal});
 await ready;controller.abort(new Error(`secret ${TOKEN}`));await assert.rejects(pending,safeError('TIMEOUT'));assert.equal(cancelled,true);
});

test('429 preserves only validated Retry-After and never provider body or error text',async()=>{
 for(const value of ['864000',iso(86400000),'secret '+TOKEN]){
  const source=registry(undefined,transport({authorization:()=>new Response(TOKEN,{status:429,headers:{'Retry-After':value}})})).resolve('owner-1');
  await assert.rejects(source.authorize({owner:'owner-1'}),error=>{safeError('RATE_LIMITED')(error);assert.equal(error.status,429);assert.equal(error.retryAfter,value.startsWith('secret')?undefined:value);return true;});
 }
 const source=registry(undefined,async()=>{throw new Error(`https://reports.example.com/${TOKEN}`)}).resolve('owner-1');
 await assert.rejects(source.authorize({owner:'owner-1'}),safeError('SOURCE_UNAVAILABLE'));
});

test('external transport errors cannot impersonate safe internal failures',async()=>{
 for(const code of ['SOURCE_UNAVAILABLE','AUTHORIZATION_BLOCKED','INVALID_ORIGINAL','RATE_LIMITED']){
  const source=registry(undefined,async()=>{throw Object.assign(new Error(TOKEN),{code,url:'https://reports.example.com/'+TOKEN,status:429,retryAfter:TOKEN});}).resolve('owner-1');
  await assert.rejects(source.authorize({owner:'owner-1'}),safeError('SOURCE_UNAVAILABLE'));
 }
});

test('caller cannot remove a length declared by a discovered report before download',async()=>{
 const source=registry(undefined,transport({list:()=>json({reports:[{...descriptor(),byteLength:6}],nextCursor:null})})).resolve('owner-1');
 const authorization=await source.authorize({owner:'owner-1'});
 const page=await source.listReports({owner:'owner-1',authorization,cursor:'cursor /?',limit:2});
 delete page.reports[0].byteLength;
 await assert.rejects(source.fetchReport({owner:'owner-1',authorization,report:page.reports[0]}),safeError('INVALID_ORIGINAL'));
});

test('untrusted JSON encodings and malformed bodies do not expose response contents',async()=>{
 for(const response of [new Response(TOKEN,{headers:{'Content-Type':'application/json'}}),new Response('{}',{headers:{'Content-Type':'text/html'}}),new Response('{}',{headers:{'Content-Type':'application/json','Content-Encoding':'gzip'}}),new Response(new Uint8Array([0xff]),{headers:{'Content-Type':'application/json'}})]){
  const source=registry(undefined,transport({authorization:()=>response})).resolve('owner-1');
  await assert.rejects(source.authorize({owner:'owner-1'}),safeError('SOURCE_UNAVAILABLE'));
 }
});

test('abort during an uncooperative fetch returns promptly and cancels its late response',async()=>{
 let release,cancelled=false,requested;const ready=new Promise(resolve=>requested=resolve);
 const source=registry(undefined,async()=>{requested();return new Promise(resolve=>release=resolve);}).resolve('owner-1');
 const controller=new AbortController();const pending=source.authorize({owner:'owner-1',signal:controller.signal});
 await ready;controller.abort();await assert.rejects(pending,safeError('TIMEOUT'));
 release(new Response(new ReadableStream({cancel(){cancelled=true;}})));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(cancelled,true);
});

test('already aborted caller never sends a request',async()=>{
 const source=registry(undefined,()=>assert.fail('pre-aborted request')).resolve('owner-1');
 const controller=new AbortController();controller.abort();
 await assert.rejects(source.authorize({owner:'owner-1',signal:controller.signal}),safeError('TIMEOUT'));
});

test('stream failure is sanitized and reported without accepting a partial original',async()=>{
 const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('hel'));c.error(new Error(TOKEN));}});
 const source=registry(undefined,transport({content:()=>new Response(body)})).resolve('owner-1');
 const authorization=await source.authorize({owner:'owner-1'});
 await assert.rejects(source.fetchReport({owner:'owner-1',authorization,report:descriptor()}),safeError('SOURCE_UNAVAILABLE'));
});

test('authorization and local entitlement expiry during download discard the bytes',async()=>{
 for(const local of [false,true]){
  let clock=NOW;const reg=registration();if(local)reg.entitlement.validUntil=iso(1000);
  const source=registry(reg,transport({content:()=>{clock=NOW+60001;return new Response('hello');}}),{now:()=>clock}).resolve('owner-1');
  const authorization=await source.authorize({owner:'owner-1'});
  await assert.rejects(source.fetchReport({owner:'owner-1',authorization,report:descriptor()}),safeError('AUTHORIZATION_BLOCKED'));
 }
});

test('direct factory enforces HTTPS authority independently of registry',async()=>{
 const {createHttpsBankgiroSource}=await import('../lib/bankgiro-http-source.js');
 const reg=registration();reg.baseUrl='http://127.0.0.1/secret';
 assert.throws(()=>createHttpsBankgiroSource({registration:reg,token:TOKEN,now:()=>NOW}),safeError('AUTHORIZATION_BLOCKED'));
});

for(const baseUrl of ['https://@reports.example.com/feed','https://reports.example.com/feed?','https://reports.example.com/feed#'])
 test('configuration rejects empty URL credential/query/fragment syntax too',async()=>{
  const reg=registration();reg.baseUrl=baseUrl;
  const source=registry(reg,()=>assert.fail('ambiguous configured URL')).resolve('owner-1');
  assert.equal(source.configurationValid,false);
  await assert.rejects(source.authorize({owner:'owner-1'}),safeError('AUTHORIZATION_BLOCKED'));
 });

test('persistable authorization expires at the earlier local or remote grant deadline',async()=>{
 const reg=registration();reg.entitlement.validUntil=iso(10000);
 const source=registry(reg).resolve('owner-1');
 const authorization=await source.authorize({owner:'owner-1'});
 assert.equal(authorization.validUntil,'2026-11-03T12:00:10.000Z');
 const page=await source.listReports({owner:'owner-1',authorization,cursor:'cursor /?',limit:2});
 assert.equal(page.reports.length,1);
});


test('internal authority binding changes when endpoint or server credential binding changes',()=>{
 const initial=registry().resolve('owner-1').registration.transportBinding;
 assert.equal(typeof initial,'string');
 for(const mutate of [r=>r.baseUrl='https://reports.example.com/other',r=>r.tokenSecret='REPLACEMENT']){
  const reg=registration();mutate(reg);
  const source=registry(reg,transport(),{secrets:{REPORT_TOKEN:TOKEN,REPLACEMENT:TOKEN}}).resolve('owner-1');
  assert.notEqual(source.registration.transportBinding,initial);
  assert.equal(source.registration.transportBinding.includes(TOKEN),false);
 }
});

test('newer explicit disable/removal carries an immutable owner revocation receipt without network access',async()=>{
 for(const registrations of [[],[{...registration(),enabled:false}]]){
  const source=registry(undefined,()=>assert.fail('disabled network'),{configuration:{version:1,revision:8,registrations}}).resolve('owner-1');
  assert.ok(source,'configured removal must resolve an explicit revocation');assert.equal(source.configurationValid,false);
  assert.deepEqual(source.revocation,{owner:'owner-1',configurationRevision:8});
  assert.equal(Object.isFrozen(source.revocation),true);
  await assert.rejects(source.authorize({owner:'owner-1'}),safeError('AUTHORIZATION_BLOCKED'));
 }
});

test('bounded reader preserves bytes when a streaming transport reuses its chunk buffer',async()=>{
 const reused=new TextEncoder().encode('he');let chunk=0;
 const body=new ReadableStream({pull(controller){
  if(chunk++===0)controller.enqueue(reused);
  else{reused.fill(120);controller.enqueue(new TextEncoder().encode('llo'));controller.close();}
 }},{highWaterMark:0});
 const source=registry(undefined,transport({content:()=>new Response(body)})).resolve('owner-1');
 const authorization=await source.authorize({owner:'owner-1'});
 assert.deepEqual(await source.fetchReport({owner:'owner-1',authorization,report:descriptor()}),new TextEncoder().encode('hello'));
});

test('malformed Unicode report identity is rejected as an invalid page before constructing a URL',async()=>{
 const source=registry(undefined,transport({list:()=>json({reports:[{...descriptor(),reportId:'\ud800'}],nextCursor:null})})).resolve('owner-1');
 const authorization=await source.authorize({owner:'owner-1'});
 await assert.rejects(source.listReports({owner:'owner-1',authorization,cursor:'cursor /?',limit:2}),safeError('INVALID_PAGE'));
});

test('adapter deadline aborts an uncooperative transport even without a caller signal',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let entered,observedSignal;
 const ready=new Promise(resolve=>entered=resolve);
 const source=registry(undefined,async(_,init)=>{observedSignal=init.signal;entered();return new Promise(()=>{});}).resolve('owner-1');
 const pending=source.authorize({owner:'owner-1'});await ready;t.mock.timers.tick(10001);
 await assert.rejects(pending,safeError('TIMEOUT'));assert.equal(observedSignal.aborted,true);
});

test('429 numeric overflow never shortens provider embargo and leading-zero seconds remain valid',async()=>{
 for(const [raw,want] of [['9'.repeat(400),'8640000000000'],['00086400','00086400'],['0'.repeat(400),'0']]){
  const source=registry(undefined,transport({authorization:()=>new Response(null,{status:429,headers:{'Retry-After':raw}})})).resolve('owner-1');
  await assert.rejects(source.authorize({owner:'owner-1'}),error=>{assert.equal(error.status,429);assert.equal(error.retryAfter,want);return true;});
 }
});

for(const marker of [{synthetic:true},{mode:'synthetic'}])
 test('production source refuses a remotely declared synthetic authorization',async()=>{
  const source=registry(undefined,transport({authorization:()=>json({...receipt(),...marker})})).resolve('owner-1');
  await assert.rejects(source.authorize({owner:'owner-1'}),safeError('AUTHORIZATION_BLOCKED'));
 });

for(const [baseUrl,prefix] of [
 ['https://reports.example.com',''],['https://reports.example.com/',''],
 ['https://reports.example.com/feed','/feed'],['https://reports.example.com/feed/','/feed']
])test(`HTTPS protocol paths join correctly for configured base ${baseUrl}`,async()=>{
 const reg=registration();reg.baseUrl=baseUrl;
 const source=registry(reg,async(input,init)=>{
  const url=new URL(input);assert.equal(init.headers.Authorization,`Bearer ${TOKEN}`);
  assert.equal(url.pathname.startsWith('//'),false,'normalized endpoints never begin with a double slash');
  if(url.pathname===prefix+'/v1/authorization')return json(receipt());
  if(url.pathname===prefix+'/v1/reports')return json({reports:[descriptor()],nextCursor:null});
  if(url.pathname===prefix+'/v1/reports/opaque-report-1/content')return new Response('hello',{headers:{'Content-Length':'5'}});
  assert.fail('request must match the pinned normalized base path');
 }).resolve('owner-1');
 const authorization=await source.authorize({owner:'owner-1'});
 const page=await source.listReports({owner:'owner-1',authorization,limit:2});
 assert.deepEqual(await source.fetchReport({owner:'owner-1',authorization,report:page.reports[0]}),new TextEncoder().encode('hello'));
 const canonical=registration();canonical.baseUrl='https://reports.example.com'+prefix;
 assert.equal(source.registration.transportBinding,registry(canonical).resolve('owner-1').registration.transportBinding);
});

test('normalized content conflict is terminal identity evidence without exposing provider body',async()=>{
 const source=registry(undefined,transport({content:()=>new Response('REPORT_HASH_CONFLICT '+TOKEN,{status:409})})).resolve('owner-1');
 const authorization=await source.authorize({owner:'owner-1'});
 await assert.rejects(source.fetchReport({owner:'owner-1',authorization,report:descriptor()}),safeError('IDENTITY_CONFLICT'));
});

for(const endpoint of ['authorization','list'])test(`HTTP409 outside normalized report content is a safe source failure (${endpoint})`,async()=>{
 const source=registry(undefined,transport({[endpoint]:()=>new Response('REPORT_HASH_CONFLICT '+TOKEN,{status:409})})).resolve('owner-1');
 if(endpoint==='authorization')await assert.rejects(source.authorize({owner:'owner-1'}),safeError('SOURCE_UNAVAILABLE'));
 else{
  const authorization=await source.authorize({owner:'owner-1'});
  await assert.rejects(source.listReports({owner:'owner-1',authorization,cursor:'cursor /?',limit:2}),safeError('SOURCE_UNAVAILABLE'));
 }
});

test('content identity conflict blocks the shared worker without advancing cursor or changing retained financial state',async t=>{
 const [{ingestFixture,reportBytes,hash},{createBankgiroIngest},{createBankgiroIngestStore}]=await Promise.all([
  import('./helpers/bankgiro-ingest-fixture.mjs'),import('../lib/bankgiro-ingest.js'),import('../lib/bankgiro-ingest-store.js')
 ]);
 const f=await ingestFixture(t);f.sql.exec('DELETE FROM bankgiro_ingest_leases');
 let clock=Date.now(),changed=false;
 const original=reportBytes(),replacement=reportBytes([{amount:'625.00',payer:'Synthetic customer AB',reference:'0600',id:'SYNTHETIC-CHILD-1'}]);
 const reg=registration();reg.owner=f.owner;reg.entitlement.checkedAt=new Date(clock-1000).toISOString();reg.entitlement.validUntil=new Date(clock+86400000).toISOString();
 const source=registry(reg,async input=>{
  const url=new URL(input);
  if(url.pathname==='/feed/v1/authorization')return json({...receipt(),owner:f.owner,checkedAt:new Date(clock).toISOString(),validUntil:new Date(clock+60000).toISOString()});
  if(url.pathname==='/feed/v1/reports')return json({reports:[{reportId:'stable-report',filename:'report.xml',sha256:hash(changed?replacement:original)}],nextCursor:changed?'2':'1'});
  if(url.pathname==='/feed/v1/reports/stable-report/content')return changed?new Response('REPORT_HASH_CONFLICT '+TOKEN,{status:409}):new Response(original);
  assert.fail('unexpected synthetic normalized protocol route');
 },{now:()=>clock}).resolve(f.owner);
 f.source=source;
 const store=createBankgiroIngestStore(f.database,{now:()=>clock,leaseMs:120000});
 const build=()=>createBankgiroIngest({source,store,sink:f.sink,now:()=>clock});
 const initial=await build().run(f.owner);assert.equal(initial.counts.IMPORTED,1);assert.equal(initial.cursor,'1');
 const state=f.read(),audits=f.audits(),retained=Array.from(f.objects,([key,value])=>[key,Uint8Array.from(value)]);
 assert.equal(state.state.allocations.length,0);assert.equal(retained.length,1);
 changed=true;clock+=16*60000;
 const conflict=await build().run(f.owner);
 assert.equal(conflict.state,'BLOCKED');assert.equal(conflict.counts.BLOCKED,1);assert.equal(conflict.counts.RETRY,0);
 assert.equal(conflict.jobs.find(job=>job.status==='BLOCKED').lastError,'IDENTITY_CONFLICT');assert.equal(conflict.cursor,'1');
 assert.deepEqual(f.read(),state);assert.deepEqual(f.audits(),audits);assert.deepEqual(Array.from(f.objects),retained);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM documents').get().n,1);
 assert.equal(JSON.stringify(conflict).includes(TOKEN),false);
});
