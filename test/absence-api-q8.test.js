import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {approveSyntheticBankAccount} from './bank-fixtures.js';

const directory=mkdtempSync(join(tmpdir(),'mgeorge-q8-absence-api-'));
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

test('q8 cycle2: a fresh human absence note cannot override unresolved imported originals',async()=>{
 const account='SE4280000890119146168423';approveSyntheticBankAccount(db,account);db.prepare("UPDATE bank_connections SET owner='local-admin'").run();
 const created=await call('/api/invoices','POST',{direction:'customer',invoice_number:'000018',party:'Syntetisk Kund AB',total_cents:100000,reference:'000018',issued_at:'2026-10-01',due_at:'2026-10-02'});assert.equal(created.status,201);
 const csv=amount=>`Datum;Belopp;Valuta;Betalare;OCR;Bankreferens;IBAN\n2026-10-26;${amount};SEK;Unrelated synthetic payer;999999;SYNTHETIC-ABSENCE-ROUTE;${account}\n`;
 const importFile=amount=>call('/api/import/commit','POST',{name:'synthetic-absence.csv',connection_id:'synthetic-bank',account_uid:'synthetic-account',content_base64:Buffer.from(csv(amount)).toString('base64'),confirm:true});
 assert.equal((await importFile('625.00')).status,200);
 const mark={id:created.body.id,reconciled:true,confirm:true,reconciliation_note:'Synthetic account and period checked'};
 assert.equal((await call('/api/invoices','PATCH',mark)).status,200,'An explicit check without a known contradiction remains available');
 assert.equal((await importFile('700.00')).status,409);
 const before=db.prepare('SELECT * FROM invoices WHERE id=?').get(created.body.id),audits=db.prepare('SELECT COUNT(*) n FROM audit_events').get().n;
 const attempt=await call('/api/invoices','PATCH',{...mark,reconciliation_note:'A new free-text note must not resolve bank evidence'});
 assert.equal(attempt.status,409);assert.match(attempt.body.error,/bankunderlag|motstrid/i);
 assert.deepEqual(db.prepare('SELECT * FROM invoices WHERE id=?').get(created.body.id),before);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_events').get().n,audits);
 assert.equal((await call('/api/invoices')).body.items.find(i=>i.id===created.body.id).reconciliation_state,'unreconciled');
});
