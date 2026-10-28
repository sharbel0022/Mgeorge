import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'mg-payment-control-'));
Object.assign(process.env,{NODE_ENV:'test',APP_ORIGIN:'http://localhost:3000',DB_PATH:join(dir,'test.sqlite'),SESSION_SECRET:'1'.repeat(64),BANK_DATA_KEY:'2'.repeat(64)});
for(const key of Object.keys(process.env))if(/^(GOOGLE_|ENABLE_BANKING_|ENABLEBANKING_|MG_ADMIN_PASSWORD)/.test(key))delete process.env[key];
const {server,db}=await import('../src/server.js');
const base=await new Promise(r=>server.listen(0,'127.0.0.1',()=>r(`http://127.0.0.1:${server.address().port}`)));
let cookie='';
async function call(path,method='GET',body,origin='http://localhost:3000'){
  const res=await fetch(base+path,{method,headers:{...(body?{'Content-Type':'application/json','Origin':origin}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
  if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
  return {res,json:await res.json()};
}
test('one authenticated click runs existing pipeline, preserves settings, and sends no mail',async()=>{
  await call('/api/me');const settings=await call('/api/settings');
  await call('/api/invoices','POST',{direction:'customer',invoice_number:'DEMO-1',party:'Synthetic Bistro',total_cents:312500,issued_at:'2026-10-01',due_at:'2026-11-01'});
  const start=await call('/api/payment-control/run','POST',{request_id:'api_request_0000000001'});
  assert.equal(start.res.status,202);let job;
  for(let n=0;n<40;n++){job=(await call('/api/payment-control/runs/'+start.json.job.id)).json.job;if(job.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(job.status,'partial');assert.equal(job.steps[0].state,'blocked');assert.equal(job.steps[1].state,'blocked');assert.equal(job.steps[4].state,'done');
  const overview=(await call('/api/payment-control/overview')).json;
  assert.equal(overview.totals.unreconciled_cents,312500);assert.equal(overview.run.id,start.json.job.id);
  assert.equal(db.prepare('SELECT count(*) AS n FROM message_deliveries').get().n,0);
  assert.deepEqual((await call('/api/settings')).json,settings.json);
  const again=await call('/api/payment-control/run','POST',{request_id:'api_request_0000000001'});
  assert.equal(again.json.reused,true);assert.equal(again.json.job.id,start.json.job.id);
});
test('foreign origin and unsupported approval fields cannot start a control',async()=>{
  assert.equal((await call('/api/payment-control/run','POST',{request_id:'api_request_0000000002'},'https://attacker.example')).res.status,403);
  assert.equal((await call('/api/payment-control/run','POST',{request_id:'api_request_0000000002',approve:true})).res.status,400);
  assert.equal((await call('/api/payment-control/run','POST',{request_id:'bad'})).res.status,400);
  const overview=(await call('/api/payment-control/overview')).json;
  assert.doesNotMatch(JSON.stringify(overview),/encrypted_tokens|encrypted_session|PRIVATE KEY|request_session_hash/);
});
test('new UI assets are served with the existing restrictive content security policy',async()=>{
  for(const path of ['/payment-control.js','/payment-control.css']){
    const response=await fetch(base+path);
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-security-policy'),/script-src 'self'/);
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assert.ok((await response.text()).length>100);
  }
});
test.after(()=>new Promise(r=>server.close(()=>{db.close();rmSync(dir,{recursive:true,force:true});r();})));
