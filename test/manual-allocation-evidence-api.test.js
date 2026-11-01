import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {storeTransactions,listTransactions} from '../src/db.js';
import {approveSyntheticBankAccount,withSyntheticBankOriginal} from './bank-fixtures.js';
const directory=mkdtempSync(join(tmpdir(),'mg-manual-evidence-'));
Object.assign(process.env,{NODE_ENV:'test',APP_ORIGIN:'http://localhost:3000',DB_PATH:join(directory,'synthetic.sqlite'),SESSION_SECRET:'1'.repeat(64),BANK_DATA_KEY:'3'.repeat(64)});
delete process.env.MG_ADMIN_PASSWORD;delete process.env.ENCRYPTION_KEY;
const {server,db}=await import('../src/server.js');
const base=await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
const session=await fetch(base+'/api/me'),cookie=session.headers.get('set-cookie').split(';')[0];
test.after(()=>new Promise(resolve=>server.close(()=>{db.close();rmSync(directory,{recursive:true,force:true});resolve();})));
const account='SE4280000890119146168423';
let serial=0;
function fixture(){
  const id=`synthetic-${++serial}`;
  db.prepare('DELETE FROM bank_connections').run();approveSyntheticBankAccount(db,account);db.prepare("UPDATE bank_connections SET owner='local-admin'").run();
  db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents,reference,issued_at) VALUES(?,?,?,?,?,?,?)').run(id,'customer',id,'Synthetic invoice customer AB',62500,id,'2026-10-01');
  storeTransactions(db,[withSyntheticBankOriginal({account,booked_at:'2026-10-26',amount_cents:62500,currency:'SEK',payer:'Synthetic private payer',reference:id,bank_reference:id})],'enablebanking');
  return {invoice_id:id,transaction_id:listTransactions(db).find(t=>t.bank_reference===id).id,amount_cents:62500,confirm:true};
}
const stored=()=>({invoices:db.prepare('SELECT * FROM invoices').all(),transactions:db.prepare('SELECT * FROM bank_transactions').all(),allocations:db.prepare('SELECT * FROM allocations').all(),audit:db.prepare('SELECT * FROM audit_events').all()});
const call=async body=>{const response=await fetch(base+'/api/allocations',{method:'POST',headers:{Cookie:cookie,Origin:'http://localhost:3000','Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
for(const [name,change,pattern] of [
  ['missing original',input=>db.prepare("UPDATE bank_transactions SET raw_bank_data_sha256='' WHERE id=?").run(input.transaction_id),/original/i],
  ['missing account',()=>db.prepare('DELETE FROM bank_connections').run(),/konto|medgivande/i],
  ['foreign owner',()=>db.prepare("UPDATE bank_connections SET owner='another-admin'").run(),/konto|medgivande/i],
  ['expired consent',()=>db.prepare("UPDATE bank_connections SET valid_until='2000-01-01'").run(),/konto|medgivande/i],
  ['deselected account',()=>db.prepare("UPDATE bank_connections SET selected_account_uid=''").run(),/konto|medgivande/i],
])test(`explicit manual confirmation cannot allocate with ${name}`,async()=>{
  const input=fixture();change(input);const before=stored(),result=await call(input);
  assert.equal(result.status,409);assert.match(result.body.error,pattern);assert.deepEqual(stored(),before);
});
test('original and active owned account allow explicit administrator decision for another payer',async()=>{
  const before=db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='manual_match'").get().n;
  const input=fixture(),result=await call(input);assert.equal(result.status,201);
  assert.equal(db.prepare('SELECT SUM(amount_cents) paid FROM allocations WHERE invoice_id=?').get(input.invoice_id).paid,62500);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='manual_match'").get().n,before+1);
});
