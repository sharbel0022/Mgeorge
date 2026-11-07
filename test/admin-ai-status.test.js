import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {digest} from '../src/security.js';

const folder=mkdtempSync(join(tmpdir(),'mg-admin-ai-status-'));
Object.assign(process.env,{NODE_ENV:'test',APP_ORIGIN:'https://ai-admin.example.test',MG_ADMIN_PASSWORD:'synthetic-admin-password',DB_PATH:join(folder,'db.sqlite'),SESSION_SECRET:'1'.repeat(64),BANK_DATA_KEY:'2'.repeat(64),OPENAI_ENABLED:'false',OPENAI_API_KEY:'synthetic-secret-must-not-be-returned'});
const app=await import('../src/server.js');
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+app.server.address().port;
after(async()=>{await new Promise(resolve=>app.server.close(resolve));app.companyRuntime.close();app.db.close();rmSync(folder,{recursive:true,force:true});});
const verification={status:'verified',evidenceId:'synthetic-evidence',verifiedBy:'operator'};
app.companyRuntime.provisionCompany({companyId:'status-a',name:'Synthetic A',actorId:'owner-a',verification});
app.companyRuntime.provisionCompany({companyId:'status-b',name:'Synthetic B',actorId:'owner-b',verification});
for(const role of ['admin','accountant','viewer'])app.companyRuntime.setMembership({companyId:'status-a',actorId:role,role});
function call(actor,path='/api/admin/ai-status',extraHeaders={}){
 let cookie='';
 if(actor){const value='synthetic-'+actor;app.db.prepare('INSERT OR REPLACE INTO sessions(id_hash,expires_at,principal) VALUES(?,?,?)').run(digest(value),Date.now()+60000,actor);cookie='mg_session='+value;}
 return new Promise((resolve,reject)=>{
  const req=request(base+path,{headers:{Host:'ai-admin.example.test',...(cookie?{Cookie:cookie}:{}),...extraHeaders}},res=>{const parts=[];res.on('data',part=>parts.push(part));res.on('end',()=>{const text=Buffer.concat(parts).toString();resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(text),text});});});req.on('error',reject);req.end();
 });
}
test('AI diagnostics return a secret-free disabled status to current owner and admin',async()=>{
 for(const actor of ['owner-a','admin']){const r=await call(actor);assert.equal(r.status,200);assert.equal(r.body.status,'disabled');assert.equal(r.body.liveVerified,false);assert.equal(r.body.policyStatus,'disabled');assert.equal(r.text.includes(process.env.OPENAI_API_KEY),false);assert.equal(r.text.includes('OPENAI_API_KEY'),false);assert.match(r.headers['cache-control'],/no-store/);}
});
test('AI diagnostics reject anonymous, accountant and viewer access',async()=>{
 assert.equal((await call()).status,401);
 for(const actor of ['accountant','viewer'])assert.equal((await call(actor)).status,403);
});
test('AI diagnostics reject cross-company and cross-origin requests',async()=>{
 assert.equal((await call('owner-a','/api/admin/ai-status?companyId=status-b&companyContextVersion=1')).status,403);
 assert.equal((await call('owner-a','/api/admin/ai-status',{Origin:'https://attacker.example.test'})).status,403);
});
test('missing key or invalid model cannot prevent server health or expose configured secrets',async()=>{
 process.env.OPENAI_ENABLED='true';process.env.OPENAI_MODEL='invalid model identifier';delete process.env.OPENAI_API_KEY;
 const r=await call('owner-a');assert.equal(r.status,200);assert.equal(r.body.status,'blocked');assert.equal(r.body.liveVerified,false);
 assert.equal((await call('owner-a','/api/health')).status,200);
});
test('revoked admin cannot read AI operational diagnostics',async()=>{
 app.companyRuntime.setMembership({companyId:'status-a',actorId:'admin',role:'admin',status:'revoked'});
 assert.equal((await call('admin')).status,403);
});

function approvedAi(t,owners){
 const patch={OPENAI_ENABLED:'true',OPENAI_MODEL:'gpt-6-luna',OPENAI_API_KEY:'synthetic-status-key-never-return',OPENAI_INVOICES_PRIVACY_APPROVED:'true',OPENAI_INVOICES_SECURITY_APPROVED:'true',OPENAI_INVOICES_COST_APPROVED:'true',OPENAI_INVOICES_APPROVAL_ID:'synthetic-status-approval',OPENAI_INVOICES_ALLOWED_OWNERS:JSON.stringify(owners),OPENAI_INVOICES_COMPANY_ORGANIZATIONS:JSON.stringify(Object.fromEntries(owners.map(owner=>[owner,'5560160680'])))};
 const before=Object.fromEntries(Object.keys(patch).map(name=>[name,process.env[name]]));Object.assign(process.env,patch);t.after(()=>{for(const name of Object.keys(patch))if(before[name]===undefined)delete process.env[name];else process.env[name]=before[name];});
}
test('enabled legacy AI diagnostics use the same node:legacy owner as document processing',async t=>{
 approvedAi(t,['node:legacy']);const result=await call('administrator');
 assert.equal(result.status,200);assert.equal(result.body.status,'configured');assert.equal(result.body.policyStatus,'enabled');assert.equal(result.body.policyCode,null);assert.equal(result.text.includes(process.env.OPENAI_API_KEY),false);
});
test('legacy actor approval cannot enable AI diagnostics for the processing owner',async t=>{
 approvedAi(t,['administrator']);const result=await call('administrator');
 assert.equal(result.status,200);assert.equal(result.body.status,'configured');assert.equal(result.body.policyStatus,'blocked');assert.equal(result.body.policyCode,'OWNER_NOT_APPROVED');
});
test('enabled company AI diagnostics bind approval to its exact storage owner',async t=>{
 const own=app.companyRuntime.resolve({actorId:'owner-a'}).storageOwner,other=app.companyRuntime.resolve({actorId:'owner-b'}).storageOwner;
 assert.notEqual(own,'owner-a');assert.notEqual(own,other);approvedAi(t,[own]);
 const result=await call('owner-a');assert.equal(result.status,200);assert.equal(result.body.status,'configured');assert.equal(result.body.policyStatus,'enabled');assert.equal(result.body.policyCode,null);
 for(const approved of ['owner-a',other]){
  process.env.OPENAI_INVOICES_ALLOWED_OWNERS=JSON.stringify([approved]);process.env.OPENAI_INVOICES_COMPANY_ORGANIZATIONS=JSON.stringify({[approved]:'5560160680'});
  const blocked=await call('owner-a');assert.equal(blocked.status,200);assert.equal(blocked.body.policyStatus,'blocked');assert.equal(blocked.body.policyCode,'OWNER_NOT_APPROVED');
 }
});
