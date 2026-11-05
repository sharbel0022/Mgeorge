import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {digest} from '../src/security.js';

const directory=mkdtempSync(join(tmpdir(),'mg-company-read-http-'));
Object.assign(process.env,{NODE_ENV:'test',APP_ORIGIN:'https://read.example.test',MG_ADMIN_PASSWORD:'synthetic-read-password',DB_PATH:join(directory,'legacy.sqlite'),MG_COMPANY_DIRECTORY:join(directory,'companies'),SESSION_SECRET:'1'.repeat(64),BANK_DATA_KEY:'2'.repeat(64),SAAS_BANK_ENABLED:'false'});
const originalFetch=globalThis.fetch;let providerCalls=0;
globalThis.fetch=async()=>{providerCalls++;throw Error('No provider call is permitted for local status/export reads');};
const app=await import('../src/server.js');
const {server,db,companyRuntime:runtime}=app;
const base=await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
after(async()=>{globalThis.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));runtime.close();db.close();rmSync(directory,{recursive:true,force:true});});

function session(actor){
 const value='synthetic-read-session-'+actor;
 runtime.controlDb.prepare('INSERT INTO sessions(id_hash,expires_at,principal) VALUES(?,?,?)').run(digest(value),Date.now()+600000,actor);
 return {cookie:'mg_session='+value,hash:digest(value)};
}
function fixture(tag){
 const owner=tag+'-owner',otherOwner=tag+'-other-owner',viewer=tag+'-viewer';
 const verification={status:'verified',evidenceId:'synthetic-read-proof',verifiedBy:'synthetic-operator'};
 const a=runtime.provisionCompany({companyId:tag+'-a',name:'Synthetic A',actorId:owner,verification});
 const b=runtime.provisionCompany({companyId:tag+'-b',name:'Synthetic B',actorId:otherOwner,verification});
 runtime.setMembership({companyId:a.companyId,actorId:viewer,role:'viewer'});
 runtime.setMembership({companyId:b.companyId,actorId:viewer,role:'viewer'});
 for(const [context,party]of [[a,'Synthetic A'],[b,'Synthetic B']])runtime.run(context,()=>{
  db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents) VALUES(?,?,?,?,?)').run('same-invoice','customer','0599',party,62500);
 });
 return {a,b,owner,viewer,ownerSession:session(owner),viewerSession:session(viewer),read:operation=>runtime.run(a,()=>operation(db))};
}
function call(path,{cookie,method='GET',body,headers={}}={}){
 return new Promise((resolve,reject)=>{
  const content=body===undefined?undefined:JSON.stringify(body);
  const req=request(base+path,{method,headers:{Host:'read.example.test',...(cookie?{Cookie:cookie}:{}),...(content?{'Content-Type':'application/json',Origin:process.env.APP_ORIGIN}:{}),...headers}},res=>{
   const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(Buffer.concat(chunks))}));
  });req.on('error',reject);req.end(content);
 });
}
function seedFlows(f){
 const at=Date.now();
 f.read(db=>{
  for(const [id,status,expiresAt,sessionHash,reason]of [
   ['live','pending',at+600000,f.ownerSession.hash,''],
   ['lost','pending',at+600000,digest('synthetic-missing-session'),''],
   ['expired','pending',at-1000,f.ownerSession.hash,''],
   ['consuming-expired','consuming',at-1000,f.ownerSession.hash,''],
   ['cancelled','cancelled',at-1000,digest('synthetic-missing-session'),'access_denied'],
  ])db.prepare('INSERT INTO bank_states(state_hash,expires_at,session_hash,owner,flow_id,status,terminal_reason) VALUES(?,?,?,?,?,?,?)').run(digest(f.a.companyId+'-'+id),expiresAt,sessionHash,f.a.storageOwner,id,status,reason);
 });
 return f.read(db=>db.prepare('SELECT * FROM bank_states ORDER BY rowid').all());
}
function assertProjectedFlows(body){
 const flows=Object.fromEntries(body.consentFlows.map(flow=>[flow.id,flow]));
 assert.equal(flows.live.status,'pending','a live control-database login is not missing from the company partition');
 assert.equal(flows.lost.status,'session_lost');assert.equal(flows.lost.reason,'SESSION_ENDED');
 for(const id of ['expired','consuming-expired']){assert.equal(flows[id].status,'expired');assert.equal(flows[id].reason,'CONSENT_FLOW_EXPIRED');}
 assert.equal(flows.cancelled.status,'cancelled');assert.equal(flows.cancelled.reason,'access_denied');
}

test('viewer reads local bank status without writing flows or losing a live company login',async()=>{
 const f=fixture('status-viewer'),before=seedFlows(f),calls=providerCalls;
 assert.equal(f.read(db=>db.prepare('SELECT count(*) n FROM sessions').get().n),0);
 const response=await call('/api/bank/status',{cookie:f.viewerSession.cookie});
 assert.equal(response.status,200,JSON.stringify(response.body));
 assert.equal(response.headers['x-company-id'],f.a.companyId);assertProjectedFlows(response.body);
 assert.deepEqual(f.read(db=>db.prepare('SELECT * FROM bank_states ORDER BY rowid').all()),before);
 assert.equal(providerCalls,calls);
});

test('owner status reads use the same pure terminal projection and preserve all stored flow evidence',async()=>{
 const f=fixture('status-owner'),before=seedFlows(f),calls=providerCalls;
 const response=await call('/api/bank/status',{cookie:f.ownerSession.cookie});
 assert.equal(response.status,200,JSON.stringify(response.body));assertProjectedFlows(response.body);
 assert.deepEqual(f.read(db=>db.prepare('SELECT * FROM bank_states ORDER BY rowid').all()),before);
 assert.equal(providerCalls,calls);
});

test('viewer export returns only its company and records a fixed audit event without general write permission',async()=>{
 const f=fixture('export-viewer'),calls=providerCalls;
 const response=await call('/api/export',{cookie:f.viewerSession.cookie});
 assert.equal(response.status,200,JSON.stringify(response.body));assert.equal(response.headers['x-company-id'],f.a.companyId);
 assert.deepEqual(response.body.invoices.map(invoice=>invoice.party),['Synthetic A']);
 const events=f.read(db=>db.prepare("SELECT action,details FROM audit_events WHERE action='data_exported'").all());
 assert.equal(events.length,1);assert.deepEqual(JSON.parse(events[0].details),{companyId:f.a.companyId,actorId:f.viewer,membershipVersion:1});
 assert.ok(response.body.audit.some(event=>event.action==='data_exported'&&event.details===events[0].details));
 assert.equal(runtime.run(f.b,()=>db.prepare("SELECT count(*) n FROM audit_events WHERE action='data_exported'").get().n),0);
 assert.equal((await call('/api/invoices',{cookie:f.viewerSession.cookie,method:'POST',body:{direction:'customer',invoice_number:'no-write',party:'Denied',total_cents:100}})).status,403);
 const viewer=runtime.resolve({actorId:f.viewer});
 assert.throws(()=>runtime.run(viewer,()=>db.prepare("UPDATE invoices SET party='Denied'").run()),{code:'company_permission_denied'});
 assert.throws(()=>runtime.run(viewer,()=>db.prepare("INSERT INTO audit_events(id,action,details) VALUES('forged','data_exported','{}')").run()),{code:'company_permission_denied'});
 assert.equal(f.read(db=>db.prepare('SELECT count(*) n FROM invoices').get().n),1);assert.equal(providerCalls,calls);
});

test('foreign and stale company selectors cannot read status or export and create no audit event',async()=>{
 const f=fixture('read-selectors');
 for(const path of ['/api/bank/status','/api/export']){
  assert.equal((await call(path,{cookie:f.viewerSession.cookie,headers:{'X-Company-Id':'missing-company'}})).status,403);
  assert.equal((await call(path,{cookie:f.viewerSession.cookie,headers:{'X-Company-Id':f.b.companyId}})).status,409);
 }
 const current=runtime.resolve({actorId:f.viewer});
 runtime.selectActiveCompany({actorId:f.viewer,companyId:f.b.companyId,contextVersion:current.contextVersion});
 for(const path of ['/api/bank/status','/api/export'])assert.equal((await call(path,{cookie:f.viewerSession.cookie,headers:{'X-Company-Id':f.a.companyId,'X-Company-Context-Version':String(current.contextVersion)}})).status,409);
 assert.equal(f.read(db=>db.prepare("SELECT count(*) n FROM audit_events WHERE action='data_exported'").get().n),0);
 assert.equal(runtime.run(f.b,()=>db.prepare("SELECT count(*) n FROM audit_events WHERE action='data_exported'").get().n),0);
});

for(const revoked of ['membership','session'])test('export rechecks '+revoked+' at the fixed audit boundary before disclosing the response',async()=>{
 const f=fixture('audit-'+revoked),original=runtime.recordDataExport;
 assert.equal(typeof original,'function');
 runtime.recordDataExport=function(){
  if(revoked==='membership')runtime.controlDb.prepare("UPDATE company_memberships SET status='revoked',membership_version=membership_version+1 WHERE company_id=? AND actor_id=?").run(f.a.companyId,f.viewer);
  else runtime.controlDb.prepare('DELETE FROM sessions WHERE id_hash=?').run(f.viewerSession.hash);
  return original.call(runtime);
 };
 try{
  const response=await call('/api/export',{cookie:f.viewerSession.cookie});
  assert.equal(response.status,revoked==='session'?401:403,JSON.stringify(response.body));
  assert.equal(response.body.invoices,undefined);
  assert.equal(f.read(db=>db.prepare("SELECT count(*) n FROM audit_events WHERE action='data_exported'").get().n),0);
 }finally{runtime.recordDataExport=original;}
});
