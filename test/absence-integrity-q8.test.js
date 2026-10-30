import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,storeTransactions,listInvoices,listTransactions,allocate} from '../src/db.js';
import {withSyntheticBankOriginal} from './bank-fixtures.js';
import {buildPaymentOverview,invoiceAnalysis} from '../src/payment-overview.js';
import {prepareMessages,listMessages,reviewMessage,paymentSnapshot} from '../src/customer-messages.js';
import {reconciliationData} from '../src/reconciliation.js';

function fixture(t,total=62500){
 const directory=mkdtempSync(join(tmpdir(),'mgeorge-q8-absence-')),db=openDatabase(join(directory,'synthetic.sqlite'));t.after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});
 db.prepare("INSERT INTO invoices(id,direction,invoice_number,party,total_cents,reference,due_at,vat_cents,net_cents) VALUES('invoice','customer','000018','Synthetic customer AB',?,'000018','2000-01-01',?,?)").run(total,total===312500?62500:12500,total===312500?250000:50000);
 return db;
}
function original(db,amount=62500){
 storeTransactions(db,[withSyntheticBankOriginal({account:'MG',booked_at:'2026-10-26',amount_cents:amount,currency:'SEK',payer:'Synthetic customer AB',reference:'000018',bank_reference:'SYNTHETIC-ABSENCE-Q8'})],'enablebanking');
 return listTransactions(db)[0];
}
function contradict(db,amount=70000){
 assert.throws(()=>storeTransactions(db,[withSyntheticBankOriginal({account:'MG',booked_at:'2026-10-26',amount_cents:amount,currency:'SEK',payer:'Another synthetic payer',reference:'000026',bank_reference:'SYNTHETIC-ABSENCE-Q8'})],'enablebanking'),error=>error.code==='conflicting_bank_record');
}
function historicalCheck(db){
 db.prepare("UPDATE invoices SET reconciled_at='2026-10-27T00:00:00Z',reconciliation_note='Original and period checked before this upgrade' WHERE id='invoice'").run();
}

test('q8 cycle2: unresolved originals invalidate historical absence presentation without erasing its audit facts',t=>{
 const db=fixture(t);original(db);contradict(db);historicalCheck(db);
 const invoice=listInvoices(db)[0];
 assert.equal(invoice.status,'unreconciled');assert.equal(invoice.reconciliation_state,'unreconciled');
 assert.equal(invoice.reconciled_at,'2026-10-27T00:00:00Z');assert.match(invoice.reconciliation_note,/before this upgrade/);
 assert.equal(invoice.paid_cents,0);assert.equal(invoice.remaining_cents,62500);
});
test('q8 cycle2: overview and explanation do not call a conflicted absence verified',t=>{
 const db=fixture(t);original(db);contradict(db);historicalCheck(db);
 const invoices=listInvoices(db),overview=buildPaymentOverview({invoices,transactions:listTransactions(db)});
 assert.equal(overview.totals.verified_outstanding_cents,0);assert.equal(overview.totals.unreconciled_cents,62500);
 assert.match(invoiceAnalysis(invoices[0])[0].reason,/inte fullständigt avstämd/);
});
test('q8 cycle2: excluding a contradicted original cannot manufacture an overdue reminder',t=>{
 const db=fixture(t);const transaction=original(db);contradict(db);historicalCheck(db);
 db.prepare('UPDATE bank_transactions SET excluded=1 WHERE id=?').run(transaction.id);
 prepareMessages(db);const drafts=listMessages(db).filter(message=>message.status==='draft');
 assert.deepEqual(drafts.map(message=>message.kind),['confirmation']);
 assert.doesNotMatch(drafts[0].body,/betalningsunderlag har kontrollerats/);
});
for(const [amount,kind] of [[250000,'possible_vat'],[350000,'overpayment']])test(`q8 cycle2: held historical allocations cannot create a new ${kind} verification claim`,t=>{
 const db=fixture(t,312500),transaction=original(db,amount);allocate(db,'invoice',transaction.id,Math.min(amount,312500));
 prepareMessages(db);assert.ok(listMessages(db).some(message=>message.kind===kind&&message.status==='draft'),'Positive original supports the first factual draft');
 const before=db.prepare('SELECT * FROM allocations').get();contradict(db,amount+10000);prepareMessages(db);
 const drafts=listMessages(db).filter(message=>message.status==='draft');
 assert.equal(drafts.some(message=>['partial','possible_vat','overpayment'].includes(message.kind)),false);
 assert.ok(drafts.some(message=>message.kind==='confirmation'));
 assert.deepEqual(db.prepare('SELECT * FROM allocations').get(),before);
 assert.equal(listInvoices(db)[0].paid_cents,Math.min(amount,312500));
});
test('q8 cycle2: a pre-upgrade partial draft with the current snapshot still needs valid payment proof',t=>{
 const db=fixture(t,312500),transaction=original(db,250000);allocate(db,'invoice',transaction.id,250000);contradict(db,260000);
 const snapshot=paymentSnapshot(db,'invoice');
 db.prepare("INSERT INTO customer_messages(id,invoice_id,kind,recipient,subject,body,snapshot) VALUES('legacy','invoice','possible_vat','recipient@example.test','Synthetic draft','Previously asserted verified payment',?)").run(snapshot);
 assert.throws(()=>reviewMessage(db,'legacy',1,'synthetic-admin','synthetic-session'),/underlag|verifier|gransk/i);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM message_reviews').get().n,0);
});
test('q8 cycle2: an explicit absence check remains usable without contradictory evidence',t=>{
 const db=fixture(t);historicalCheck(db);const invoice=listInvoices(db)[0];
 assert.equal(invoice.reconciliation_state,'verified');assert.equal(invoice.status,'overdue');
 assert.equal(buildPaymentOverview({invoices:[invoice]}).totals.verified_outstanding_cents,62500);
 prepareMessages(db);assert.ok(listMessages(db).some(message=>message.kind==='overdue'&&message.status==='draft'));
});
for(const [label,sql] of [
 ['missing retained hash',"UPDATE bank_transactions SET raw_bank_data_sha256=''"],
 ['changed original bytes',"UPDATE bank_transactions SET raw_bank_data=json_set(raw_bank_data,'$.debtor.name','Changed synthetic payer')"]
])test(`q8 cycle2: ${label} invalidates current paid proof while retaining ledger and legacy snapshot`,t=>{
 const db=fixture(t,312500),transaction=original(db,250000);allocate(db,'invoice',transaction.id,250000);
 const before=db.prepare('SELECT * FROM allocations').get();prepareMessages(db);
 assert.ok(listMessages(db).some(m=>m.kind==='possible_vat'&&m.status==='draft'));
 db.exec(sql);
 const invoice=reconciliationData(db).invoices[0];assert.match(invoice.payment_evidence_issue,/Original/);
 assert.equal(invoice.paid_cents,250000);assert.equal(invoice.remaining_cents,62500);
 const overview=buildPaymentOverview(reconciliationData(db));assert.equal(overview.totals.paid_cents,250000);assert.equal(overview.totals.verified_paid_cents,0);
 prepareMessages(db);assert.equal(listMessages(db).some(m=>m.status==='draft'&&['partial','possible_vat','overpayment'].includes(m.kind)),false);
 const snapshot=paymentSnapshot(db,'invoice');
 db.prepare("INSERT INTO customer_messages(id,invoice_id,kind,recipient,subject,body,snapshot) VALUES('missing-original-legacy','invoice','possible_vat','recipient@example.test','Synthetic legacy draft','Previously asserted proof',?)").run(snapshot);
 assert.throws(()=>reviewMessage(db,'missing-original-legacy',1,'synthetic-admin','synthetic-session'),/original|underlag|verifier|gransk/i);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM message_reviews').get().n,0);assert.deepEqual(db.prepare('SELECT * FROM allocations').get(),before);
});
