import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {storeTransactions,listTransactions} from '../src/db.js';
import {withSyntheticBankOriginal} from './bank-fixtures.js';
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
  assert.equal(job.status,'partial');assert.equal(job.steps[0].state,'blocked');assert.equal(job.steps[1].state,'done');assert.equal(job.steps[2].state,'blocked');assert.equal(job.steps[4].state,'done');
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

test('allocation timestamp or a free note does not verify a payment without its original',async()=>{
  const invoice=(await call('/api/invoices','POST',{direction:'customer',invoice_number:'CHECKED-2',party:'Synthetic Partial',total_cents:10000,reference:'CHECKED-2'})).json;
  await call('/api/bank-transactions','POST',{account:'Test',booked_at:'2026-10-28',amount_cents:2500,payer:'Synthetic Partial',reference:'CHECKED-2'});
  const transaction=(await call('/api/bank-transactions')).json.items.find(t=>t.reference==='CHECKED-2');
  assert.equal((await call('/api/allocations','POST',{invoice_id:invoice.id,transaction_id:transaction.id,amount_cents:2500,confirm:true})).res.status,201);
  const stored=db.prepare('SELECT reconciled_at,reconciliation_note FROM invoices WHERE id=?').get(invoice.id);
  assert.ok(stored.reconciled_at);assert.equal(stored.reconciliation_note,'');
  assert.equal((await call('/api/payment-control/overview')).json.totals.verified_outstanding_cents,0);
  await call('/api/invoices','PATCH',{id:invoice.id,reconciled:true,confirm:true,reconciliation_note:'Kontoutdrag och period kontrollerade separat'});
  assert.equal((await call('/api/payment-control/overview')).json.totals.verified_outstanding_cents,0);
  const result=(await call('/api/invoices/'+invoice.id)).json.invoice;
  assert.equal(result.paid_cents,2500);assert.equal(result.remaining_cents,7500);
  assert.match(result.payment_evidence_issue,/original/i);assert.equal(result.absence_verified,false);
  const exported=(await call('/api/export')).json.invoices.find(i=>i.id===invoice.id);
  for(const field of ['paid_cents','remaining_cents','absence_verified','reconciliation_state','payment_evidence_issue'])assert.equal(exported[field],result[field],`Export must retain the same current ${field}`);
});
test('current bank original and separate absence review support a verified remaining balance',async()=>{
  const invoice=(await call('/api/invoices','POST',{direction:'customer',invoice_number:'CHECKED-ORIGINAL',party:'Synthetic Original',total_cents:10000,reference:'CHECKED-ORIGINAL'})).json;
  storeTransactions(db,[withSyntheticBankOriginal({account:'MG',booked_at:'2026-10-28',amount_cents:2500,currency:'SEK',payer:'Synthetic Original',reference:'CHECKED-ORIGINAL',bank_reference:'SYNTHETIC-CONTROL-ORIGINAL'})],'enablebanking');
  const transaction=listTransactions(db).find(t=>t.reference==='CHECKED-ORIGINAL');
  assert.equal((await call('/api/allocations','POST',{invoice_id:invoice.id,transaction_id:transaction.id,amount_cents:2500,confirm:true})).res.status,201);
  assert.equal((await call('/api/invoices','PATCH',{id:invoice.id,reconciled:true,confirm:true,reconciliation_note:'Synthetic original and period independently checked'})).res.status,200);
  const result=(await call('/api/invoices/'+invoice.id)).json.invoice;
  assert.equal(result.payment_evidence_issue,'');assert.equal(result.absence_verified,true);
  assert.equal((await call('/api/payment-control/overview')).json.totals.verified_outstanding_cents,7500);
});
test.after(()=>new Promise(r=>server.close(()=>{db.close();rmSync(dir,{recursive:true,force:true});r();})));
