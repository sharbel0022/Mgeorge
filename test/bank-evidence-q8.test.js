import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase, storeTransactions, listTransactions, listInvoices, allocate, deleteAllocation} from '../src/db.js';
import {normalizeBankApiTransaction, parseCAMT, parseCSV} from '../src/importers.js';
import {reconciliationData, runReconciliation} from '../src/reconciliation.js';
import {approveSyntheticBankAccount} from './bank-fixtures.js';
import {digest} from '../src/security.js';
import {syntheticCamt, account} from '../sites/tests/helpers/camt-integrity.mjs';

function fixture(t) {
  const folder = mkdtempSync(join(tmpdir(), 'mgeorge-q8-bank-'));
  const path = join(folder, 'synthetic.sqlite');
  let db = openDatabase(path);
  t.after(() => { db.close(); rmSync(folder, {recursive:true, force:true}); });
  return {get db() { return db; }, reopen() { db.close(); db = openDatabase(path); return db; }};
}

function invoice(db, {id='invoice', number='0604', party='Synthetic Invoice Customer AB', total=62500}={}) {
  db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents,reference,issued_at) VALUES(?,?,?,?,?,?,?)')
    .run(id, 'customer', number, party, total, number, '2026-10-01');
}

const apiOriginal = (extra={}) => ({
  status:'BOOK', entry_reference:'SYNTHETIC-PRIOR', transaction_id:'SYNTHETIC-LOOKUP',
  booking_date:'2026-10-26', credit_debit_indicator:'CRDT',
  transaction_amount:{amount:'625.00', currency:'SEK'},
  debtor:{name:'Synthetic Private Payer'}, reference_number:'0604', ...extra,
});
const importApi = (db, original, bankAccount=account) => storeTransactions(db, [normalizeBankApiTransaction(original, bankAccount)], 'enablebanking');
const importXml = (db, xml, name='synthetic-q8.xml') => storeTransactions(db, parseCAMT(xml, account), `file:${name}`, {content:Buffer.from(xml), mime_type:'application/xml'});

for (const failure of ['missing API hash', 'altered API original', 'missing file original']) {
  test(`q8: a learned payer relationship cannot outlive its ${failure}`, t => {
    const {db} = fixture(t); invoice(db);
    let imported;
    if (failure==='missing file original') {
      approveSyntheticBankAccount(db, account);
      const csv = `Datum;Belopp;Valuta;Betalare;Referens;Bankreferens;IBAN\n2026-10-26;625.00;SEK;Synthetic Private Payer;0604;SYNTHETIC-PRIOR;${account}\n`;
      imported = storeTransactions(db, parseCSV(csv, account), 'file:synthetic-prior.csv', {content:Buffer.from(csv), mime_type:'text/csv'});
    } else importApi(db, apiOriginal());
    const prior = listTransactions(db)[0];
    allocate(db, 'invoice', prior.id, 62500);
    const allocation = db.prepare('SELECT * FROM allocations').get();
    invoice(db, {id:'next', number:'0605'});
    importApi(db, apiOriginal({entry_reference:'SYNTHETIC-NEXT', reference_number:'0605'}));
    assert.equal(reconciliationData(db).links.length, 1, 'The original supports the learned relationship before corruption');
    if (failure==='missing API hash') db.prepare("UPDATE bank_transactions SET raw_bank_data_sha256='' WHERE id=?").run(prior.id);
    if (failure==='altered API original') db.prepare('UPDATE bank_transactions SET raw_bank_data=? WHERE id=?').run(JSON.stringify(apiOriginal({debtor:{name:'Other Synthetic Payer'}})), prior.id);
    if (failure==='missing file original') db.prepare('UPDATE import_jobs SET content=NULL WHERE id=?').run(imported.import_id);
    assert.equal(reconciliationData(db).transactions.find(row => row.id===prior.id).verified, false);
    runReconciliation(db);
    assert.equal(listInvoices(db).find(row => row.id==='next').paid_cents, 0, 'Unverifiable prior evidence must not identify the next private payment');
    assert.deepEqual(db.prepare('SELECT * FROM allocations WHERE id=?').get(allocation.id), allocation);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n, 1);
  });
}

test('q8: an XML individual does not excuse a contradictory aggregate that was never its original collection', t => {
  const f = fixture(t); const db = f.db;
  approveSyntheticBankAccount(db, account);
  invoice(db, {number:'000018', party:'Syntetisk Kund AB'});
  importXml(db, syntheticCamt);
  const original = listTransactions(db)[0];
  assert.equal(reconciliationData(db).transactions[0].verified, true);
  importApi(db, apiOriginal({entry_reference:'SYNTHETIC-CHILD', debtor:{name:'Bankgirot'}, reference_number:'', bank_transaction_code:{description:'Bankgiro samlingspost'}}));
  const reopened = f.reopen();
  runReconciliation(reopened);
  assert.equal(listInvoices(reopened)[0].paid_cents, 0, 'The original individual cannot remain usable after a new contradictory classification');
  const after = listTransactions(reopened)[0];
  assert.equal(after.id, original.id);
  assert.equal(after.bank_evidence_conflicts.length, 1);
  assert.equal(reconciliationData(reopened).transactions[0].verified, false);
  assert.equal(after.payer, original.payer); assert.equal(after.reference, original.reference);
});

test('q8: a rejected financial conflict retains its exact file and links it to the durable hold once', t => {
  const f = fixture(t); const db = f.db; invoice(db);
  importApi(db, apiOriginal({entry_reference:'SYNTHETIC-CHILD'}));
  const prior = listTransactions(db)[0]; allocate(db, 'invoice', prior.id, 62500);
  const allocation = db.prepare('SELECT * FROM allocations').get();
  const xml = syntheticCamt.replaceAll('625.00', '624.99');
  for (let attempt=0; attempt<2; attempt++) assert.throws(() => importXml(db, xml, 'synthetic-rejected.xml'), error => error.code==='conflicting_bank_record');
  const reopened = f.reopen();
  const originals = reopened.prepare('SELECT * FROM import_jobs WHERE content_sha256=?').all(digest(Buffer.from(xml)));
  assert.equal(originals.length, 1, 'Rejected original bytes must survive rollback without duplicate copies on retry');
  assert.equal(originals[0].name, 'synthetic-rejected.xml');
  assert.equal(originals[0].mime_type, 'application/xml');
  assert.equal(originals[0].source, 'bank_file');
  assert.equal(originals[0].status, 'blocked');
  assert.equal(originals[0].imported, 0);
  assert.deepEqual(Buffer.from(originals[0].content), Buffer.from(xml));
  const after = listTransactions(reopened)[0];
  assert.deepEqual(after.bank_evidence_conflicts[0].original_import_ids, [originals[0].id]);
  assert.equal(after.bank_evidence_conflicts.length, 1);
  assert.equal(after.amount_cents, 62500); assert.equal(after.id, prior.id);
  assert.deepEqual(after.raw_bank_data, prior.raw_bank_data);
  assert.deepEqual(reopened.prepare('SELECT * FROM allocations').get(), allocation);
  assert.equal(reopened.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='bank_evidence_conflict'").get().n, 1);
});

test('q8: identity conflicts keep distinct original files linked without duplicating the financial hold', t => {
  const {db} = fixture(t); importXml(db, syntheticCamt, 'synthetic-first.xml');
  const original = listTransactions(db)[0];
  const changed = syntheticCamt.replace('Syntetisk Kund AB', 'Other Synthetic Customer AB');
  const first = importXml(db, changed, 'synthetic-conflict.xml');
  const variant = changed.replace('<Ntfctn>', '<Ntfctn><!-- Separate original with the same conflicting facts -->');
  const second = importXml(db, variant, 'synthetic-conflict-variant.xml');
  importXml(db, variant, 'synthetic-conflict-retry.xml');
  const after = listTransactions(db)[0];
  assert.equal(after.bank_evidence_conflicts.length, 1);
  assert.deepEqual(after.bank_evidence_conflicts[0].original_import_ids, [first.import_id, second.import_id]);
  assert.equal(after.import_id, original.import_id);
  assert.equal(after.payer, original.payer);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='bank_evidence_conflict'").get().n, 1);
});

test('q8: an overfull replacement specification retains rejected bytes without creating another payment', t => {
  const f = fixture(t); const db = f.db;
  importApi(db, apiOriginal({entry_reference:'SYNTHETIC-ENTRY', debtor:{name:'Bankgirot'}, reference_number:'', bank_transaction_code:{description:'Bankgiro samlingspost'}}));
  importXml(db, syntheticCamt, 'synthetic-first.xml');
  const before = listTransactions(db);
  const rejected = syntheticCamt.replace('SYNTHETIC-CHILD', 'SYNTHETIC-CHILD-OTHER');
  for (let attempt=0; attempt<2; attempt++) assert.throws(() => importXml(db, rejected, 'synthetic-overfull.xml'), error => error.code==='conflicting_payment_specification');
  const reopened = f.reopen();
  const retained = reopened.prepare("SELECT * FROM import_jobs WHERE status='blocked' AND content_sha256=?").all(digest(Buffer.from(rejected)));
  assert.equal(retained.length, 1, 'The rejected specification remains available for review');
  assert.deepEqual(Buffer.from(retained[0].content), Buffer.from(rejected));
  assert.equal(retained[0].imported, 0);
  assert.deepEqual(listTransactions(reopened), before);
});

test('q8: explicit undo survives restart and import replay until a new manual allocation is confirmed', t => {
  const f = fixture(t); const db = f.db;
  invoice(db, {party:'Synthetic Private Payer'}); const raw = apiOriginal(); importApi(db, raw);
  runReconciliation(db);
  const prior = listTransactions(db)[0], allocation = db.prepare('SELECT * FROM allocations').get();
  assert.equal(listInvoices(db)[0].paid_cents, 62500);
  deleteAllocation(db, allocation.id);
  const reopened = f.reopen(); importApi(reopened, raw); runReconciliation(reopened);
  assert.equal(listInvoices(reopened)[0].paid_cents, 0, 'An explicit undo cannot be silently reversed by the next control');
  const held = listTransactions(reopened)[0];
  assert.ok(held.automatic_match_hold?.at); assert.match(held.review_reason, /återtag|manuell/i);
  assert.equal(held.status, 'review');
  assert.deepEqual(held.raw_bank_data, prior.raw_bank_data);
  assert.equal(reopened.prepare('SELECT COUNT(*) n FROM allocations').get().n, 0);
  const undo = JSON.parse(reopened.prepare("SELECT details FROM audit_events WHERE action='undo_match'").get().details);
  assert.equal(undo.id, allocation.id); assert.equal(undo.amount_cents, 62500);
  allocate(reopened, 'invoice', held.id, 62500);
  assert.equal(listInvoices(reopened)[0].paid_cents, 62500, 'A conscious manual allocation remains possible');
  assert.deepEqual(listTransactions(reopened)[0].automatic_match_hold, held.automatic_match_hold);
  assert.equal(reopened.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='automatic_match'").get().n, 1);
});

test('q8: undoing one part of a payment prevents its remaining allocation from teaching payer identity', t => {
  const {db} = fixture(t);
  invoice(db, {total:31250}); invoice(db, {id:'second', number:'0605', total:31250});
  importApi(db, apiOriginal()); const prior = listTransactions(db)[0];
  allocate(db, 'invoice', prior.id, 31250); allocate(db, 'second', prior.id, 31250);
  const retained = db.prepare("SELECT * FROM allocations WHERE invoice_id='second'").get();
  deleteAllocation(db, db.prepare("SELECT id FROM allocations WHERE invoice_id='invoice'").get().id);
  invoice(db, {id:'next', number:'0606'});
  db.prepare("UPDATE invoices SET issued_at='2026-10-27' WHERE id='next'").run();
  importApi(db, apiOriginal({entry_reference:'SYNTHETIC-NEXT', reference_number:'0606', booking_date:'2026-10-28'}));
  runReconciliation(db);
  assert.equal(listInvoices(db).find(row => row.id==='next').paid_cents, 0, 'A withdrawn shared-payment decision cannot identify another payment');
  assert.deepEqual(db.prepare('SELECT * FROM allocations WHERE id=?').get(retained.id), retained);
  assert.equal(listInvoices(db).find(row => row.id==='second').paid_cents, 31250);
});

test('q8: a replaced collection with an unverifiable original cannot authorize its individual child', t => {
  const {db} = fixture(t); approveSyntheticBankAccount(db, account);
  invoice(db, {number:'000018', party:'Syntetisk Kund AB'});
  importApi(db, apiOriginal({entry_reference:'SYNTHETIC-ENTRY', debtor:{name:'Bankgirot'}, reference_number:'', bank_transaction_code:{description:'Bankgiro samlingspost'}}));
  importXml(db, syntheticCamt);
  const parent = listTransactions(db).find(row => row.is_aggregate), child = listTransactions(db).find(row => !row.is_aggregate);
  assert.equal(parent.excluded, 1);
  assert.equal(reconciliationData(db).transactions.find(row => row.id===child.id).verified, true);
  db.prepare("UPDATE bank_transactions SET raw_bank_data_sha256='' WHERE id=?").run(parent.id);
  runReconciliation(db);
  assert.equal(listInvoices(db)[0].paid_cents, 0, 'A child must retain the trust constraints of its replaced collection');
  assert.equal(reconciliationData(db).transactions.find(row => row.id===child.id).verified, false);
});

for (const note of ['Refund', 'Payment reversal']) {
  test(`q8: a replaced collection marked ${note} cannot settle an ordinary invoice through a child`, t => {
    const {db} = fixture(t); approveSyntheticBankAccount(db, account);
    invoice(db, {number:'000018', party:'Syntetisk Kund AB'});
    importApi(db, apiOriginal({entry_reference:'SYNTHETIC-ENTRY', debtor:{name:'Bankgirot'}, reference_number:'', bank_transaction_code:{description:'Bankgiro samlingspost'}, note}));
    importXml(db, syntheticCamt);
    const child = listTransactions(db).find(row => !row.is_aggregate);
    runReconciliation(db);
    assert.equal(listInvoices(db)[0].paid_cents, 0, 'A specification cannot hide an explicit refund or reversal in its parent original');
    assert.throws(() => allocate(db, 'invoice', child.id, 62500), /återbetal|återför/i);
    assert.match(listTransactions(db).find(row => row.id===child.id).review_reason, /återbetal|återför/i);
  });
}

for (const automatic of [false, true]) {
  test(`q8: account-scoped bank IDs allow ${automatic?'automatic':'manual'} matching of independent payments`, t => {
    const {db} = fixture(t);
    invoice(db, {party:'Synthetic Customer A AB'});
    importApi(db, apiOriginal({entry_reference:'ACCOUNT-LOCAL-001', debtor:{name:'Synthetic Customer A AB'}}));
    allocate(db, 'invoice', listTransactions(db)[0].id, 62500);
    invoice(db, {id:'second', number:'0605', party:'Synthetic Customer B AB'});
    importApi(db, apiOriginal({entry_reference:'ACCOUNT-LOCAL-001', debtor:{name:'Synthetic Customer B AB'}, reference_number:'0605'}), 'SE4550000000058398257466');
    const second = listTransactions(db).find(row => row.account==='SE4550000000058398257466');
    if (automatic) runReconciliation(db);
    else allocate(db, 'second', second.id, 62500);
    assert.equal(listInvoices(db).find(row => row.id==='second').paid_cents, 62500);
    assert.equal(db.prepare('SELECT SUM(amount_cents) n FROM allocations').get().n, 125000);
    assert.equal(listTransactions(db).length, 2);
  });
}

test('q8: cross-account copies with equivalent payer and numeric reference still require duplicate review', t => {
  const {db} = fixture(t);
  invoice(db, {party:'Synthetic Customer AB', total:125000, number:'000018'});
  importApi(db, apiOriginal({entry_reference:'ORIGINAL-ENTRY', debtor:{name:'Synthetic Customer AB'}, reference_number:'000018'}));
  allocate(db, 'invoice', listTransactions(db)[0].id, 62500);
  importApi(db, apiOriginal({entry_reference:'DIFFERENT-ENTRY', debtor:{name:'SYNTHETIC CUSTOMER AB'}, reference_number:'000-018'}), 'SE4550000000058398257466');
  const copy = listTransactions(db).find(row => row.account==='SE4550000000058398257466');
  assert.throws(() => allocate(db, 'invoice', copy.id, 62500), /dubblett|annat.*underlag/i);
  assert.equal(listInvoices(db)[0].paid_cents, 62500);
});

for (const type of ['Refund', 'Payment reversal']) for (const automatic of [false, true]) {
  test(`q8 review: same-row file completion preserves ${type} for ${automatic?'automatic':'manual'} matching`, t => {
    const f = fixture(t); const db = f.db; approveSyntheticBankAccount(db, account);
    invoice(db, {number:'000018', party:'Syntetisk Kund AB'});
    const csv = `Datum;Belopp;Valuta;Betalare;Referens;Bankreferens;IBAN;Beskrivning\n2026-10-26;625.00;SEK;Bankgirot;;SYNTHETIC-CHILD;${account};Bankgiro ${type}\n`;
    const source = storeTransactions(db, parseCSV(csv, account), 'file:synthetic-collection.csv', {content:Buffer.from(csv), mime_type:'text/csv'});
    const prior = listTransactions(db)[0]; assert.equal(prior.is_aggregate, 1);
    const xml = syntheticCamt.replace('<NtryDtls>', '<AddtlNtryInf>Bankgiro inbetalning</AddtlNtryInf><NtryDtls>');
    const specification = importXml(db, xml, 'synthetic-completion.xml');
    assert.equal(specification.enriched, 1);
    const reopened = f.reopen();
    if (automatic) {
      runReconciliation(reopened);
      assert.equal(listInvoices(reopened)[0].paid_cents, 0, 'Completing the same row cannot erase the earlier collection type');
    } else assert.throws(() => allocate(reopened, 'invoice', prior.id, 62500), /återbetal|återför/i);
    const after = listTransactions(reopened)[0];
    assert.equal(after.id, prior.id); assert.equal(after.status, 'review');
    assert.match(after.review_reason, /återbetal|återför/i);
    assert.equal(reopened.prepare('SELECT COUNT(*) n FROM allocations').get().n, 0);
    assert.deepEqual(Buffer.from(reopened.prepare('SELECT content FROM import_jobs WHERE id=?').get(source.import_id).content), Buffer.from(csv));
    assert.deepEqual(Buffer.from(reopened.prepare('SELECT content FROM import_jobs WHERE id=?').get(specification.import_id).content), Buffer.from(xml));
  });
}

test('q8 review: an ordinary file collection completed in place still matches once', t => {
  const {db} = fixture(t); approveSyntheticBankAccount(db, account);
  invoice(db, {number:'000018', party:'Syntetisk Kund AB'});
  const csv = `Datum;Belopp;Valuta;Betalare;Referens;Bankreferens;IBAN;Beskrivning\n2026-10-26;625.00;SEK;Bankgirot;;SYNTHETIC-CHILD;${account};Bankgiro inbetalning\n`;
  storeTransactions(db, parseCSV(csv, account), 'file:synthetic-collection.csv', {content:Buffer.from(csv), mime_type:'text/csv'});
  const originalId = listTransactions(db)[0].id;
  const xml = syntheticCamt.replace('<NtryDtls>', '<AddtlNtryInf>Bankgiro inbetalning</AddtlNtryInf><NtryDtls>');
  assert.equal(importXml(db, xml).enriched, 1);
  runReconciliation(db); runReconciliation(db);
  assert.equal(listInvoices(db)[0].paid_cents, 62500);
  assert.equal(listTransactions(db)[0].id, originalId);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n, 1);
});

test('q8 review: a historical allocated refund completion cannot teach a later payer relationship', t => {
  const {db}=fixture(t);approveSyntheticBankAccount(db,account);invoice(db,{number:'000018'});
  const csv=`Datum;Belopp;Valuta;Betalare;Referens;Bankreferens;IBAN;Beskrivning\n2026-10-26;625.00;SEK;Bankgirot;;SYNTHETIC-CHILD;${account};Bankgiro Refund\n`;
  storeTransactions(db,parseCSV(csv,account),'file:synthetic-legacy-collection.csv',{content:Buffer.from(csv),mime_type:'text/csv'});
  importXml(db,syntheticCamt.replace('<NtryDtls>','<AddtlNtryInf>Bankgiro inbetalning</AddtlNtryInf><NtryDtls>'));
  const prior=listTransactions(db)[0];
  // Represent a pre-upgrade allocation created by the reproduced completion bug.
  db.prepare('INSERT INTO allocations(id,invoice_id,transaction_id,amount_cents) VALUES(?,?,?,?)').run('legacy-allocation','invoice',prior.id,62500);
  db.prepare('INSERT INTO payer_links(id,invoice_id,payer,account,evidence,verified_by,party) VALUES(?,?,?,?,?,?,?)').run('legacy-link','invoice',prior.payer,account,'Previously allocated original','allocation','Synthetic Invoice Customer AB');
  const allocation=db.prepare('SELECT * FROM allocations').get();
  invoice(db,{id:'next',number:'0605'});
  importApi(db,apiOriginal({entry_reference:'SYNTHETIC-LATER-PAYMENT',reference_number:'0605',debtor:{name:'Syntetisk Kund AB'}}));
  runReconciliation(db);
  assert.equal(listInvoices(db).find(row=>row.id==='next').paid_cents,0,'Historical refund allocations must not identify later ordinary payments');
  assert.deepEqual(db.prepare('SELECT * FROM allocations WHERE id=?').get(allocation.id),allocation);
  assert.equal(listInvoices(db).find(row=>row.id==='invoice').paid_cents,62500);
});

function markAbsenceChecked(db,id='invoice') {
  db.prepare('UPDATE invoices SET reconciled_at=?,reconciliation_note=? WHERE id=?').run('2026-10-27T00:00:00Z','Syntetiskt original och period granskade',id);
}

test('q8 review: a conflict-only import invalidates absence checks and preserves unrelated allocations', t => {
  const {db}=fixture(t); invoice(db); invoice(db,{id:'paid',number:'0605'});
  importApi(db,apiOriginal({entry_reference:'SYNTHETIC-PAID',reference_number:'0605'}));
  const paidTransaction=listTransactions(db)[0];allocate(db,'paid',paidTransaction.id,62500);
  const allocation=db.prepare('SELECT * FROM allocations').get(),paidBefore=listInvoices(db).find(row=>row.id==='paid');
  importApi(db,apiOriginal());markAbsenceChecked(db);
  const changed=importApi(db,apiOriginal({debtor:{name:'Other Synthetic Payer'}}));
  assert.equal(changed.imported,0);assert.equal(changed.conflicts,1);
  const checked=listInvoices(db).find(row=>row.id==='invoice');
  assert.equal(checked.reconciled_at,'','New contradictory evidence invalidates the earlier absence conclusion');
  assert.equal(checked.reconciliation_note,'');assert.equal(checked.reconciliation_state,'unreconciled');
  assert.deepEqual(db.prepare('SELECT * FROM allocations').get(),allocation);
  assert.deepEqual(listInvoices(db).find(row=>row.id==='paid'),paidBefore);
  const event=JSON.parse(db.prepare("SELECT details FROM audit_events WHERE action='absence_check_invalidated'").get().details);
  assert.equal(event.before.reconciliation_note,'Syntetiskt original och period granskade');
  assert.equal(event.import_id,changed.import_id);
});

for(const source of ['API','file']) {
  test(`q8 review: a rejected ${source} financial conflict invalidates absence checks durably`, t => {
    const f=fixture(t);const db=f.db;invoice(db);
    importApi(db,apiOriginal({entry_reference:'SYNTHETIC-CHILD'}));markAbsenceChecked(db);
    const reject=source==='API'?()=>importApi(db,apiOriginal({entry_reference:'SYNTHETIC-CHILD',transaction_amount:{amount:'624.99',currency:'SEK'}})):()=>importXml(db,syntheticCamt.replaceAll('625.00','624.99'),'synthetic-rejected-check.xml');
    for(let attempt=0;attempt<2;attempt++)assert.throws(reject,error=>error.code==='conflicting_bank_record');
    const reopened=f.reopen(),checked=listInvoices(reopened)[0];
    assert.equal(checked.reconciled_at,'','Rollback of new money must not restore a stale absence conclusion');
    assert.equal(checked.reconciliation_note,'');assert.equal(checked.paid_cents,0);
    assert.equal(reopened.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='absence_check_invalidated'").get().n,1);
    assert.equal(listTransactions(reopened).length,1);assert.equal(listTransactions(reopened)[0].amount_cents,62500);
  });
}

test('q8 review: a rejected replacement specification invalidates absence checks without importing funds', t => {
  const {db}=fixture(t);invoice(db);
  importApi(db,apiOriginal({entry_reference:'SYNTHETIC-ENTRY',debtor:{name:'Bankgirot'},reference_number:'',bank_transaction_code:{description:'Bankgiro samlingspost'}}));
  importXml(db,syntheticCamt);const transactions=listTransactions(db);markAbsenceChecked(db);
  assert.throws(()=>importXml(db,syntheticCamt.replace('SYNTHETIC-CHILD','SYNTHETIC-OTHER-CHILD'),'synthetic-rejected-specification.xml'),error=>error.code==='conflicting_payment_specification');
  assert.equal(listInvoices(db)[0].reconciled_at,'');
  assert.equal(listInvoices(db)[0].reconciliation_note,'');
  assert.deepEqual(listTransactions(db),transactions);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n,0);
});

test('q8 review: a conflict invalidates an explicit check of the remaining balance without reversing its partial payment', t => {
  const {db}=fixture(t);invoice(db,{total:100000});importApi(db,apiOriginal());
  allocate(db,'invoice',listTransactions(db)[0].id,62500);
  const allocation=db.prepare('SELECT * FROM allocations').get();markAbsenceChecked(db);
  importApi(db,apiOriginal({reference_number:'0999'}));
  const checked=listInvoices(db)[0];
  assert.equal(checked.reconciliation_note,'','A partial allocation does not preserve a stale absence check for the remaining balance');
  assert.equal(checked.reconciled_at,'');
  assert.equal(checked.paid_cents,62500);assert.equal(checked.remaining_cents,37500);
  assert.deepEqual(db.prepare('SELECT * FROM allocations').get(),allocation);
});

test('q8 review: an unchanged import replay preserves an explicit absence check', t => {
  const {db}=fixture(t);invoice(db);const raw=apiOriginal();importApi(db,raw);markAbsenceChecked(db);
  const before=listInvoices(db)[0];const result=importApi(db,raw);
  assert.equal(result.duplicate,1);assert.equal(result.conflicts,0);
  assert.deepEqual(listInvoices(db)[0],before);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='absence_check_invalidated'").get().n,0);
});
