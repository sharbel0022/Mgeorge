import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,storeTransactions,listTransactions,allocate} from '../src/db.js';
import {analyzeReconciliation,reconciliationData,runReconciliation} from '../src/reconciliation.js';
import {buildPaymentOverview} from '../src/payment-overview.js';
import {approveSyntheticBankAccount,withSyntheticBankOriginal} from './bank-fixtures.js';

const account='SE4280000890119146168423';
function fixture(t){
 const folder=mkdtempSync(join(tmpdir(),'mg-identity-evidence-')),db=openDatabase(join(folder,'synthetic.sqlite'));
 t.after(()=>{db.close();rmSync(folder,{recursive:true,force:true});});approveSyntheticBankAccount(db,account);return db;
}
function invoice(db,id,party,organization){
 db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,organization_number,total_cents,reference,issued_at) VALUES(?,?,?,?,?,?,?,?)').run(id,'customer',id,party,organization,10000,id,'2026-10-01');
}
function payment(db,id,payer){
 storeTransactions(db,[withSyntheticBankOriginal({account,booked_at:'2026-10-26',amount_cents:10000,currency:'SEK',payer,reference:id,bank_reference:'SYNTHETIC-'+id})],'enablebanking');
 return listTransactions(db).find(t=>t.reference===id).id;
}
test('Node learned payer identity is captured at allocation rather than derived from later invoice identity',t=>{
 const db=fixture(t);invoice(db,'SYN-A','Synthetic customer A AB','1111111111');
 allocate(db,'SYN-A',payment(db,'SYN-A','Synthetic third-party payer'),10000);
 invoice(db,'SYN-B','Different synthetic customer B AB','2222222222');payment(db,'SYN-B','Synthetic third-party payer');
 const allocations=db.prepare('SELECT * FROM allocations').all();
 assert.equal(analyzeReconciliation(reconciliationData(db)).find(f=>f.invoice_id==='SYN-B').safe,false);
 // The public edit route does not write organization_number. Even a direct
 // synthetic database edit cannot relabel the persisted allocation snapshot.
 db.prepare("UPDATE invoices SET organization_number='2222222222' WHERE id='SYN-A'").run();
 assert.equal(reconciliationData(db).links[0].organization_number,'1111111111');
 runReconciliation(db);assert.equal(db.prepare("SELECT COUNT(*) n FROM allocations WHERE invoice_id='SYN-B'").get().n,0);assert.deepEqual(db.prepare('SELECT * FROM allocations').all(),allocations);
});
test('Node current consent holds verified presentation while keeping booked money and restoring only its evidence status',t=>{
 const db=fixture(t);invoice(db,'SYN-PAID','Synthetic customer AB','1111111111');payment(db,'SYN-PAID','Synthetic customer AB');runReconciliation(db);
 const before=db.prepare('SELECT * FROM allocations').all(),originals=db.prepare('SELECT * FROM bank_transactions').all();
 const overview=()=>{const data=reconciliationData(db,{owner:'synthetic-owner'});return buildPaymentOverview({...data,suggestions:analyzeReconciliation(data)});};
 assert.equal(overview().totals.verified_paid_cents,10000);
 db.prepare("UPDATE bank_connections SET valid_until='2000-01-01'").run();
 const data=reconciliationData(db,{owner:'synthetic-owner'}),held=overview();
 assert.match(data.invoices[0].payment_evidence_issue,/konto|medgivande/i);assert.equal(data.transactions[0].verified,false);
 assert.equal(held.totals.verified_paid_cents,0);assert.equal(held.totals.verified_paid_count,0);assert.equal(held.totals.paid_cents,10000);assert.equal(held.totals.remaining_cents,0);
 assert.deepEqual(db.prepare('SELECT * FROM allocations').all(),before);assert.deepEqual(db.prepare('SELECT * FROM bank_transactions').all(),originals);
 db.prepare("UPDATE bank_connections SET valid_until='2099-01-01T00:00:00Z'").run();
 assert.equal(overview().totals.verified_paid_cents,10000);assert.deepEqual(db.prepare('SELECT * FROM allocations').all(),before);
});
