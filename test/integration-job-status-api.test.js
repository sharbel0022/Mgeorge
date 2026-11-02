import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {encryptObject} from '../src/security.js';
import {createIntegrationJobs} from '../src/integration-jobs.js';

const folder=mkdtempSync(join(tmpdir(),'mg-job-status-api-'));
Object.assign(process.env,{NODE_ENV:'test',APP_ORIGIN:'http://localhost:3000',DB_PATH:join(folder,'db.sqlite'),SESSION_SECRET:'1'.repeat(64),BANK_DATA_KEY:'2'.repeat(64),GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret'});
for(const name of ['MG_ADMIN_PASSWORD','ENABLE_BANKING_APPLICATION_ID','ENABLE_BANKING_PRIVATE_KEY','ENABLE_BANKING_PRIVATE_KEY_FILE'])delete process.env[name];
const {server,db}=await import('../src/server.js?integration-job-status-api');
const providerFetch=globalThis.fetch;
let base,mode='success',listCalls=0,revocations=0;
globalThis.fetch=async url=>{
  const path=new URL(url).pathname;
  if(path.endsWith('/profile'))return Response.json({emailAddress:'mg.vitvaror@gmail.com'});
  if(path.endsWith('/revoke')){revocations++;return new Response('',{status:200});}
  if(path.endsWith('/messages')){
    listCalls++;
    if(mode==='network')throw Error('synthetic-private-provider-payload');
    return Response.json({messages:[]});
  }
  throw Error('Unexpected synthetic provider endpoint');
};
test.before(async()=>{base=await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)));});
test.beforeEach(()=>{
  mode='success';listCalls=0;revocations=0;db.exec('DELETE FROM integration_jobs;DELETE FROM gmail_connections;');
  db.prepare('INSERT INTO gmail_connections(id,email,encrypted_tokens) VALUES(?,?,?)').run('synthetic-gmail','mg.vitvaror@gmail.com',encryptObject({access_token:'synthetic-token',refresh_token:'synthetic-refresh',expires_at:Date.now()+3_600_000,scope:'https://www.googleapis.com/auth/gmail.readonly'}));
});
const request=(path,method='GET')=>providerFetch(base+path,{method,...(method==='GET'?{}:{headers:{Origin:process.env.APP_ORIGIN,'Content-Type':'application/json'},body:'{}'})});
test.after(async()=>{globalThis.fetch=providerFetch;await new Promise(resolve=>server.close(resolve));db.close();rmSync(folder,{recursive:true,force:true});});

test('public Gmail job status preserves last success when a later manual provider attempt fails',async()=>{
  assert.equal((await request('/api/gmail/sync','POST')).status,200);
  const success=(await(await request('/api/gmail/status')).json()).job.jobStatus;
  assert.equal(success.state,'succeeded');assert.equal(success.attemptCount,1);assert.ok(success.lastSuccessAt);
  mode='network';assert.equal((await request('/api/gmail/sync','POST')).status,502);
  const failed=(await(await request('/api/gmail/status')).json()).job.jobStatus;
  assert.equal(failed.state,'retry_wait');assert.equal(failed.lastSuccessAt,success.lastSuccessAt);
  assert.equal(failed.attemptCount,2);assert.equal(failed.fenceVersion,2);
  assert.equal(failed.errorCode,'connection_error');assert.equal(failed.evidenceStatus,'REVIEW');
  assert.equal(listCalls,2);assert.doesNotMatch(JSON.stringify(failed),/synthetic-private|token|lease"/);
});

test('disconnecting credentials during a cooldown does not report a fetch success or discard the retry deadline',async()=>{
  const jobs=createIntegrationJobs(db),lease=jobs.claim('gmail');
  lease.fail('Gmail-hämtningen behöver kontrolleras',120_000,false,'rate_limited');lease.release();
  const before=jobs.summary()[0].jobStatus;
  const response=await request('/api/gmail/connection','DELETE');
  assert.equal(response.status,200);assert.equal((await response.json()).removed,true);
  assert.equal(revocations,1);assert.equal(listCalls,0);
  const after=(await(await request('/api/settings')).json()).scheduler.jobs[0].jobStatus;
  assert.equal(after.state,'retry_wait');assert.equal(after.lastSuccessAt,null);
  assert.equal(after.lastAttemptAt,before.lastAttemptAt);assert.equal(after.attemptCount,1);
  assert.equal(after.nextAttemptAt,before.nextAttemptAt);
  assert.throws(()=>jobs.claim('gmail'),{code:'integration_wait'});
});
