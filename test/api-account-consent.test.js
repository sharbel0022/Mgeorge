import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,storeTransactions,listTransactions,listInvoices,allocate} from '../src/db.js';
import {reconciliationData,analyzeReconciliation,runReconciliation} from '../src/reconciliation.js';
import {encryptObject} from '../src/security.js';
import {withSyntheticBankOriginal,approveSyntheticBankAccount} from './bank-fixtures.js';
import {retainSyntheticInvoiceOriginal} from './invoice-fixtures.js';

const account='SE4280000890119146168423';
function fixture(t){
  const folder=mkdtempSync(join(tmpdir(),'mg-api-consent-')),db=openDatabase(join(folder,'db.sqlite'));
  t.after(()=>{db.close();rmSync(folder,{recursive:true,force:true});});
  db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents,reference,issued_at) VALUES(?,?,?,?,?,?,?)').run('invoice','customer','0599','Synthetic customer AB',62500,'0599','2026-10-01');
  retainSyntheticInvoiceOriginal(db,'invoice');
  storeTransactions(db,[withSyntheticBankOriginal({account,booked_at:'2026-10-26',amount_cents:62500,currency:'SEK',payer:'Synthetic customer AB',reference:'0599',bank_reference:'SYNTHETIC-AIS-ENTRY'})],'enablebanking');
  return db;
}
const financial=db=>({invoices:listInvoices(db).map(({id,paid_cents,remaining_cents})=>({id,paid_cents,remaining_cents})),allocations:db.prepare('SELECT * FROM allocations').all(),transactions:db.prepare('SELECT * FROM bank_transactions').all()});
const mutate={
  missing:db=>db.prepare('DELETE FROM bank_connections').run(),
  expired:db=>db.prepare("UPDATE bank_connections SET valid_until='2000-01-01T00:00:00Z'").run(),
  ownerless:db=>db.prepare("UPDATE bank_connections SET owner=''").run(),
  deselected:db=>db.prepare("UPDATE bank_connections SET selected_account_uid=''").run(),
  disconnected:db=>db.prepare("UPDATE bank_connections SET status='disconnected'").run(),
  error:db=>db.prepare("UPDATE bank_connections SET status='error'").run(),
  'other account':db=>db.prepare('UPDATE bank_connections SET accounts_json=?').run(encryptObject([{uid:'synthetic-account',account_id:{iban:'SE4550000000058398257466'},currency:'SEK'}])),
  'wrong currency':db=>db.prepare('UPDATE bank_connections SET accounts_json=?').run(encryptObject([{uid:'synthetic-account',account_id:{iban:account},currency:'EUR'}])),
  'ambiguous selected resource':db=>db.prepare('UPDATE bank_connections SET accounts_json=?').run(encryptObject([0,1].map(()=>({uid:'synthetic-account',account_id:{iban:account},currency:'SEK'})))),
  'unreadable account evidence':db=>db.prepare("UPDATE bank_connections SET accounts_json='invalid'").run(),
};
for(const [name,change] of Object.entries(mutate))test(`intact AIS original with ${name} account consent cannot allocate`,t=>{
  const db=fixture(t);approveSyntheticBankAccount(db,account);change(db);const before=financial(db),data=reconciliationData(db);
  assert.ok(data.transactions[0].raw_bank_data_sha256,'The bank receipt is present; missing consent is a separate prerequisite.');
  assert.equal(data.transactions[0].verified,false);
  assert.match(data.transactions[0].account_consent_issue,/konto|medgivande/i);
  assert.ok(analyzeReconciliation(data).every(item=>!item.safe));
  runReconciliation(db);assert.deepEqual(financial(db),before,'A blocked decision cannot change originals, allocations or balances.');
});
test('current owned selected SEK account permits one AIS allocation and preserves the original',t=>{
  const db=fixture(t);approveSyntheticBankAccount(db,account);const before=listTransactions(db)[0];
  assert.equal(reconciliationData(db).transactions[0].verified,true);runReconciliation(db);runReconciliation(db);
  assert.equal(listInvoices(db)[0].paid_cents,62500);assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,1);
  assert.equal(reconciliationData(db).invoices[0].status,'paid');
  assert.equal(listTransactions(db)[0].raw_bank_data_sha256,before.raw_bank_data_sha256);
});
test('expired consent retains booked money but does not claim verified paid status or teach a payer relation',t=>{
  const db=fixture(t);approveSyntheticBankAccount(db,account);const tx=listTransactions(db)[0];allocate(db,'invoice',tx.id,62500);
  const before=financial(db);mutate.expired(db);const data=reconciliationData(db);
  assert.equal(data.invoices[0].status,'unreconciled');assert.equal(data.invoices[0].reconciliation_state,'unreconciled');
  assert.match(data.invoices[0].payment_evidence_issue,/konto|medgivande/i);
  assert.equal(data.links.length,0);runReconciliation(db);assert.deepEqual(financial(db),before);
  db.prepare("UPDATE bank_connections SET valid_until='2099-01-01T00:00:00Z'").run();
  assert.equal(reconciliationData(db).invoices[0].status,'paid');assert.deepEqual(financial(db),before);
});
test('explicit administrative booking remains recorded while unavailable original is shown as unverified',t=>{
  const db=fixture(t),tx=listTransactions(db)[0];db.prepare("UPDATE bank_transactions SET raw_bank_data_sha256=''").run();allocate(db,'invoice',tx.id,62500);
  const before=financial(db),invoice=reconciliationData(db).invoices[0];
  assert.equal(invoice.status,'unreconciled');assert.equal(invoice.paid_cents,62500);assert.equal(invoice.remaining_cents,0);
  assert.ok(invoice.payment_evidence_issue);assert.deepEqual(financial(db),before);
});
