import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {approveSyntheticBankAccount} from './bank-fixtures.js';
import {reconciliationData} from '../src/reconciliation.js';

const directory=mkdtempSync(join(tmpdir(),'mgeorge-q8-bank-route-'));
Object.assign(process.env,{NODE_ENV:'test',APP_ORIGIN:'http://localhost:3000',DB_PATH:join(directory,'synthetic.sqlite'),SESSION_SECRET:'1'.repeat(64),BANK_DATA_KEY:'3'.repeat(64)});
for(const key of Object.keys(process.env))if(/^(GOOGLE_|ENABLE_BANKING_|ENABLEBANKING_|MG_ADMIN_PASSWORD|ENCRYPTION_KEY)/.test(key))delete process.env[key];
const {server,db}=await import('../src/server.js');
const base=await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
let cookie='';
async function call(path,method='GET',body){
  const response=await fetch(base+path,{method,headers:{...(body?{'Content-Type':'application/json',Origin:'http://localhost:3000'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
  if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
  return {status:response.status,body:await response.json()};
}
test.after(()=>new Promise(resolve=>server.close(()=>{db.close();rmSync(directory,{recursive:true,force:true});resolve();})));

test('q8 review: the real CSV import route preserves its MIME parameters and supports verified matching',async()=>{
  const account='SE4280000890119146168423';
  approveSyntheticBankAccount(db,account);
  db.prepare("UPDATE bank_connections SET owner='local-admin'").run();
  const created=await call('/api/invoices','POST',{direction:'customer',invoice_number:'000018',party:'Syntetisk Kund AB',total_cents:62500,reference:'000018',issued_at:'2026-10-01'});
  assert.equal(created.status,201);
  const csv=`Datum;Belopp;Valuta;Betalare;OCR;Bankreferens;IBAN\n2026-10-26;625.00;SEK;Syntetisk Kund AB;000018;SYNTHETIC-CSV-ROUTE;${account}\n`;
  const request={name:'synthetic-route.csv',connection_id:'synthetic-bank',account_uid:'synthetic-account',content_base64:Buffer.from(csv).toString('base64'),confirm:true};
  const imported=await call('/api/import/commit','POST',request);
  assert.equal(imported.status,200);assert.equal(imported.body.imported,1);
  const retained=db.prepare('SELECT mime_type,content FROM import_jobs WHERE id=?').get(imported.body.import_id);
  assert.equal(retained.mime_type,'text/csv; charset=utf-8');
  assert.deepEqual(Buffer.from(retained.content),Buffer.from(csv));
  assert.equal((await call('/api/reconciliation','POST',{})).status,200);
  const invoices=(await call('/api/invoices')).body.items;
  assert.equal(invoices.find(invoice=>invoice.id===created.body.id).paid_cents,62500,'A server-retained CSV with correct source facts must remain usable');
  assert.equal(reconciliationData(db).transactions[0].verified,true);
  assert.equal((await call('/api/import/commit','POST',request)).body.duplicate,1);
  await call('/api/reconciliation','POST',{});
  assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,1);
});
