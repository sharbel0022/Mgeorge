import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const folder=mkdtempSync(join(tmpdir(),'mgeorge-api-'));
process.env.NODE_ENV='test';process.env.APP_ORIGIN='http://localhost:3000';process.env.DB_PATH=join(folder,'db.sqlite');
process.env.MG_ADMIN_PASSWORD='TEST-PASSWORD-ONLY-NOT-FOR-PRODUCTION';
process.env.SESSION_SECRET='1'.repeat(64);process.env.BANK_DATA_KEY='2'.repeat(64);
const {server,db}=await import('../src/server.js');
const base=await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
let cookie='';
async function call(path,method='GET',body,origin='http://localhost:3000'){
  const res=await fetch(base+path,{method,headers:{...(body?{'Content-Type':'application/json','Origin':origin}:{}),...(cookie?{'Cookie':cookie}:{})},body:body?JSON.stringify(body):undefined,redirect:'manual'});
  const json=await res.json().catch(()=>({}));return {res,json};
}
test('health is public, other endpoints need login',async()=>{
  assert.equal((await call('/api/health')).res.status,200);
  assert.equal((await call('/api/invoices')).res.status,401);
});
test('login and CSRF protection',async()=>{
  assert.equal((await call('/api/login','POST',{password:'wrong'})).res.status,401);
  const result=await call('/api/login','POST',{password:process.env.MG_ADMIN_PASSWORD});assert.equal(result.res.status,200);
  cookie=result.res.headers.get('set-cookie').split(';')[0];assert.match(cookie,/mg_session=/);
  assert.equal((await call('/api/invoices','POST',{invoice_number:'1'},'https://attacker.example')).res.status,403);
});
test('new invoice, payment and matching via API',async()=>{
  const inv=await call('/api/invoices','POST',{direction:'customer',invoice_number:'0604',party:'Kund AB',total_cents:187500,issued_at:'2026-10-20',due_at:'2026-11-02',reference:'0604'});
  assert.equal(inv.res.status,201);const invoiceId=inv.json.id;
  const tx=await call('/api/bank-transactions','POST',{account:'Swedbank',booked_at:'2026-10-26',amount_cents:187500,payer:'Kund AB',reference:'0604'});
  assert.equal(tx.json.imported,1);
  const id=(await call('/api/bank-transactions')).json.items[0].id;
  assert.equal((await call('/api/allocations','POST',{invoice_id:invoiceId,transaction_id:id,amount_cents:187500,confirm:false})).res.status,400);
  assert.equal((await call('/api/allocations','POST',{invoice_id:invoiceId,transaction_id:id,amount_cents:187500,confirm:true})).res.status,201);
  assert.equal((await call('/api/invoices')).json.items[0].status,'paid');
  assert.equal((await call('/api/dashboard')).json.customer_paid_cents,187500);
});
test('preview and import are separate and deduplicate repeated bank files',async()=>{
  const csv='Datum;Belopp;Betalare;OCR\n2026-10-26;100,00;Other AB;7777';
  const body={name:'bank.csv',account:'Swedbank',content_base64:Buffer.from(csv).toString('base64')};
  assert.equal((await call('/api/import/preview','POST',body)).json.count,1);
  assert.equal((await call('/api/import/commit','POST',{...body,confirm:true})).json.imported,1);
  assert.equal((await call('/api/import/commit','POST',{...body,confirm:true})).json.duplicate,1);
});
test('bank status exposes no secrets, connection requires server-side keys',async()=>{
  const status=await call('/api/bank/status');assert.equal(status.json.configured,false);
  assert.equal((await call('/api/bank/connect','POST',{})).res.status,409);
});
test('cleanup',async()=>{await new Promise(resolve=>server.close(resolve));db.close();rmSync(folder,{recursive:true,force:true});});
