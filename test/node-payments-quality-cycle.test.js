import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase, storeTransactions, listTransactions, listInvoices, allocate} from '../src/db.js';
import {normalizeBankApiTransaction, parseCAMT, parseCSV} from '../src/importers.js';
import {analyzeReconciliation, reconciliationData, runReconciliation} from '../src/reconciliation.js';
import {buildPaymentOverview} from '../src/payment-overview.js';
import {approveSyntheticBankAccount, withSyntheticBankOriginal} from './bank-fixtures.js';
import {syntheticCamt, account} from '../sites/tests/helpers/camt-integrity.mjs';

function fixture(t) {
  const folder = mkdtempSync(join(tmpdir(), 'mg-node-quality-'));
  const path = join(folder, 'db.sqlite');
  let db = openDatabase(path);
  t.after(() => { db.close(); rmSync(folder, {recursive:true, force:true}); });
  return {get db() { return db; }, reopen() { db.close(); db = openDatabase(path); return db; }};
}

function invoice(db, {id='invoice', direction='customer', number='0604', party='Synthetic Customer AB', total=10000, kind='invoice'}={}) {
  db.prepare('INSERT INTO invoices(id,direction,invoice_number,party,total_cents,reference,issued_at,kind) VALUES(?,?,?,?,?,?,?,?)')
    .run(id, direction, number, party, total, number, '2026-10-01', kind);
}

const apiOriginal = (extra={}) => ({
  status:'BOOK', entry_reference:'SYNTHETIC-TRANSACTION', transaction_id:'SYNTHETIC-LOOKUP',
  booking_date:'2026-10-26', credit_debit_indicator:'CRDT',
  transaction_amount:{amount:'100.00', currency:'SEK'},
  debtor:{name:'Synthetic Customer AB'}, creditor:{name:'Synthetic Customer AB'},
  reference_number:'0604', ...extra,
});
const importApi = (db, original) => storeTransactions(db, [normalizeBankApiTransaction(original, account)], 'enablebanking');
const findings = db => analyzeReconciliation(reconciliationData(db));

function specification({child='SYNTHETIC-CHILD-A', party='Synthetic Customer A AB', reference='0604', amount='625.00'}={}) {
  return syntheticCamt.replaceAll('625.00', amount).replace('SYNTHETIC-CHILD', child)
    .replace('Syntetisk Kund AB', party).replace('<Ref>000018</Ref>', `<Ref>${reference}</Ref>`)
    .replace('<Tp><CdOrPrtry><Prtry>OCR</Prtry></CdOrPrtry></Tp>', '');
}
const importXml = (db, xml, name='synthetic.xml') => storeTransactions(db, parseCAMT(xml, account), `file:${name}`, {content:Buffer.from(xml), mime_type:'application/xml'});
const aggregate = () => withSyntheticBankOriginal({account, booked_at:'2026-10-26', amount_cents:62500, currency:'SEK', payer:'Bankgirot', reference:'', bank_reference:'SYNTHETIC-ENTRY', is_aggregate:true});

for (const [description, direction] of [['Card refund','customer'], ['Återbetalning kortköp','customer'], ['Payment reversal','customer'], ['Återföring','supplier'], ['Card purchase','customer'], ['Löneutbetalning','supplier'], ['Överföring eget konto','supplier']]) {
  test(`quality cycle: ${description} remains a visible exception instead of settling an ordinary ${direction} invoice`, t => {
    const {db} = fixture(t); invoice(db, {direction});
    importApi(db, apiOriginal({credit_debit_indicator:direction==='supplier'?'DBIT':'CRDT', bank_transaction_code:{description}}));
    runReconciliation(db);
    assert.equal(listInvoices(db)[0].paid_cents, 0, 'Refund/reversal evidence must not reduce an ordinary invoice balance');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM allocations').get().n, 0);
    const review = findings(db).find(f => f.invoice_id==='invoice');
    assert.equal(review?.safe, false); assert.equal(review?.kind, 'financial_review');
    const overview = buildPaymentOverview({invoices:listInvoices(db), transactions:listTransactions(db), suggestions:findings(db)});
    assert.ok(overview.queue.some(item => item.entity_id===listTransactions(db)[0].id && /återbetal|återför|gransk/i.test(item.reason)));
  });
}

test('quality cycle: deleting a refund description cannot bypass the retained API original', t => {
  const {db} = fixture(t); invoice(db);
  importApi(db, apiOriginal({bank_transaction_code:{description:'Card refund'}}));
  db.prepare("UPDATE bank_transactions SET description=''").run();
  runReconciliation(db);
  assert.equal(listInvoices(db)[0].paid_cents, 0);
});

test('quality cycle: a retained CSV refund remains review-only', t => {
  const {db} = fixture(t); invoice(db); approveSyntheticBankAccount(db, account);
  const csv = `Datum;Belopp;Valuta;Betalare;Referens;Bankreferens;IBAN;Beskrivning\n2026-10-26;100.00;SEK;Synthetic Customer AB;0604;SYNTHETIC-REFUND;${account};Card refund\n`;
  storeTransactions(db, parseCSV(csv, account), 'file:synthetic-refund.csv', {content:Buffer.from(csv), mime_type:'text/csv'});
  runReconciliation(db);
  assert.equal(listInvoices(db)[0].paid_cents, 0);
  assert.equal(findings(db)[0].kind, 'financial_review');
});

test('quality cycle: removing a retained file refund description cannot restore automatic matching', t => {
  const {db} = fixture(t); invoice(db); approveSyntheticBankAccount(db, account);
  const csv = `Datum;Belopp;Valuta;Betalare;Referens;Bankreferens;IBAN;Beskrivning\n2026-10-26;100.00;SEK;Synthetic Customer AB;0604;SYNTHETIC-REFUND;${account};Card refund\n`;
  storeTransactions(db, parseCSV(csv, account), 'file:synthetic-refund.csv', {content:Buffer.from(csv), mime_type:'text/csv'});
  db.prepare("UPDATE bank_transactions SET description=''").run();
  runReconciliation(db);
  assert.equal(listInvoices(db)[0].paid_cents, 0);
});

test('quality cycle: an explicit refund can settle a reviewed credit note but cannot settle an ordinary invoice', t => {
  const {db} = fixture(t);
  invoice(db, {direction:'supplier'}); invoice(db, {id:'credit', kind:'credit', number:'K0604'});
  importApi(db, apiOriginal({credit_debit_indicator:'DBIT', bank_transaction_code:{description:'Refund'}}));
  const transaction = listTransactions(db)[0];
  assert.throws(() => allocate(db, 'invoice', transaction.id, 10000), /återbetal|återför|kredit/i);
  allocate(db, 'credit', transaction.id, 10000);
  assert.equal(listInvoices(db).find(i => i.id==='invoice').paid_cents, 0);
  assert.equal(listInvoices(db).find(i => i.id==='credit').paid_cents, 10000);
});

test('quality cycle: contradictory payer and reference on the same bank ID survive restart without overwriting originals or paying an invoice', t => {
  const f = fixture(t); invoice(f.db);
  const original = apiOriginal(); importApi(f.db, original);
  const before = listTransactions(f.db)[0];
  const changed = apiOriginal({debtor:{name:'Other Synthetic Customer AB'}, reference_number:'0999'});
  importApi(f.db, changed); importApi(f.db, changed);
  const db = f.reopen(); runReconciliation(db);
  assert.equal(listInvoices(db)[0].paid_cents, 0);
  const [after] = listTransactions(db);
  assert.equal(after.id, before.id); assert.equal(after.payer, before.payer); assert.equal(after.reference, before.reference);
  assert.deepEqual(after.raw_bank_data, original); assert.deepEqual(after.reference_evidence, before.reference_evidence);
  assert.equal(after.bank_evidence_conflicts?.length, 1);
  assert.deepEqual(after.bank_evidence_conflicts[0].incoming.raw_bank_data, changed);
  assert.equal(findings(db)[0].safe, false); assert.equal(findings(db)[0].kind, 'bank_evidence_conflict');
  assert.match(after.review_reason, /motstrid/i);
  assert.throws(() => allocate(db, 'invoice', after.id, 10000), /motstrid/i);
});

test('quality cycle: a new conflicting reference candidate is retained even when the selected reference is unchanged', t => {
  const {db} = fixture(t); invoice(db); importApi(db, apiOriginal());
  importApi(db, apiOriginal({details:{invoice_number:'0999'}}));
  runReconciliation(db);
  assert.equal(listInvoices(db)[0].paid_cents, 0);
  assert.equal(listTransactions(db)[0].bank_evidence_conflicts?.length, 1);
});

test('quality cycle: a later collective classification cannot leave an ordinary payment automatically eligible', t => {
  const {db} = fixture(t); invoice(db); importApi(db, apiOriginal());
  importApi(db, apiOriginal({debtor:{name:'Bankgirot'}, reference_number:'', bank_transaction_code:{description:'Bankgiro samlingspost'}}));
  runReconciliation(db);
  assert.equal(listInvoices(db)[0].paid_cents, 0);
  assert.equal(listTransactions(db)[0].bank_evidence_conflicts?.length, 1);
});

test('quality cycle: attaching an API original cannot overwrite the reference sources from a retained file', t => {
  const {db} = fixture(t); approveSyntheticBankAccount(db, account);
  const csv = `Datum;Belopp;Valuta;Betalare;Referens;Bankreferens;IBAN\n2026-10-26;100.00;SEK;Synthetic Customer AB;0604;SYNTHETIC-TRANSACTION;${account}\n`;
  storeTransactions(db, parseCSV(csv, account), 'file:synthetic-reference.csv', {content:Buffer.from(csv), mime_type:'text/csv'});
  const before = listTransactions(db)[0]; importApi(db, apiOriginal());
  const after = listTransactions(db)[0];
  assert.deepEqual(after.reference_evidence, before.reference_evidence);
  assert.equal(after.import_id, before.import_id); assert.equal(after.reference, '0604');
  assert.equal(reconciliationData(db).transactions[0].verified, true);
});

test('quality cycle: equivalent bank references and changing provider lookup IDs remain harmless duplicates', t => {
  const {db} = fixture(t); invoice(db);
  importApi(db, apiOriginal());
  assert.equal(importApi(db, apiOriginal({transaction_id:'SYNTHETIC-RENEWED-LOOKUP', debtor:{name:'SYNTHETIC CUSTOMER AB'}})).duplicate, 1);
  assert.equal(listTransactions(db)[0].bank_evidence_conflicts?.length || 0, 0);
  runReconciliation(db); assert.equal(listInvoices(db)[0].paid_cents, 10000);
});

test('quality cycle: a conflicting duplicate preserves an already confirmed allocation and records a review warning', t => {
  const {db} = fixture(t); invoice(db); importApi(db, apiOriginal()); runReconciliation(db);
  const allocation = db.prepare('SELECT * FROM allocations').get();
  importApi(db, apiOriginal({debtor:{name:'Other Synthetic Customer AB'}})); runReconciliation(db);
  assert.deepEqual(db.prepare('SELECT * FROM allocations').get(), allocation);
  assert.equal(listInvoices(db)[0].paid_cents, 10000);
  const transaction = listTransactions(db)[0];
  assert.equal(transaction.bank_evidence_conflicts?.length, 1); assert.match(transaction.review_reason, /motstrid/i);
  const overview = buildPaymentOverview({invoices:listInvoices(db), transactions:[transaction], suggestions:findings(db)});
  assert.ok(overview.queue.some(item => item.entity_id===transaction.id));
});

for (const [name, changed] of [['amount', {transaction_amount:{amount:'125.00', currency:'SEK'}}], ['date', {booking_date:'2026-10-27'}], ['direction', {credit_debit_indicator:'DBIT'}]]) {
  test(`quality cycle: a same-ID ${name} contradiction rolls back new money and durably holds the prior original`, t => {
    const {db} = fixture(t); invoice(db); importApi(db, apiOriginal());
    const before = listTransactions(db)[0];
    const batch = [apiOriginal({entry_reference:'OTHER-SYNTHETIC-ENTRY'}), apiOriginal(changed)].map(raw => normalizeBankApiTransaction(raw, account));
    assert.throws(() => storeTransactions(db, batch, 'enablebanking'), error => error.code==='conflicting_bank_record');
    runReconciliation(db);
    assert.equal(listInvoices(db)[0].paid_cents, 0);
    const [after] = listTransactions(db);
    assert.equal(listTransactions(db).length, 1); assert.equal(after.amount_cents, before.amount_cents);
    assert.equal(after.booked_at, before.booked_at); assert.deepEqual(after.raw_bank_data, before.raw_bank_data);
    assert.equal(after.bank_evidence_conflicts?.length, 1);
  });
}

test('quality cycle: a contradicted allocation cannot teach payer identity for a later invoice', t => {
  const {db} = fixture(t); invoice(db);
  importApi(db, apiOriginal({debtor:{name:'Synthetic Private Payer'}}));
  allocate(db, 'invoice', listTransactions(db)[0].id, 10000);
  importApi(db, apiOriginal({debtor:{name:'Other Synthetic Payer'}}));
  invoice(db, {id:'next', number:'0605'});
  importApi(db, apiOriginal({entry_reference:'NEXT-SYNTHETIC-PAYMENT', debtor:{name:'Synthetic Private Payer'}, reference_number:'0605'}));
  runReconciliation(db);
  assert.equal(listInvoices(db).find(i => i.id==='next').paid_cents, 0);
  assert.equal(listInvoices(db).find(i => i.id==='invoice').paid_cents, 10000);
});

test('quality cycle: a second specification cannot spend an excluded collective deposit twice', t => {
  const {db} = fixture(t); approveSyntheticBankAccount(db, account);
  invoice(db, {id:'A', party:'Synthetic Customer A AB', total:62500});
  invoice(db, {id:'B', party:'Synthetic Customer B AB', number:'0605', total:62500});
  storeTransactions(db, [aggregate()], 'enablebanking');
  const first = specification(), firstImport = importXml(db, first, 'synthetic-first.xml'); runReconciliation(db);
  const priorAllocation = db.prepare('SELECT * FROM allocations').get();
  assert.equal(listTransactions(db).find(t => t.bank_reference==='SYNTHETIC-ENTRY').excluded, 1);
  const second = specification({child:'SYNTHETIC-CHILD-B', party:'Synthetic Customer B AB', reference:'0605'});
  assert.throws(() => importXml(db, second, 'synthetic-second.xml'), error => error.code==='conflicting_payment_specification');
  runReconciliation(db);
  assert.equal(listInvoices(db).find(i => i.id==='B').paid_cents, 0);
  assert.deepEqual(db.prepare('SELECT * FROM allocations').get(), priorAllocation);
  assert.deepEqual(Buffer.from(db.prepare('SELECT content FROM import_jobs WHERE id=?').get(firstImport.import_id).content), Buffer.from(first));
  assert.equal(listTransactions(db).length, 2);
  assert.equal(importXml(db, first, 'synthetic-duplicate.xml').duplicate, 1);
  assert.equal(db.prepare('SELECT SUM(amount_cents) n FROM allocations').get().n, 62500);
});

test('quality cycle: a retained specification total prevents duplicate funds before the collective bank entry arrives', t => {
  const {db} = fixture(t); approveSyntheticBankAccount(db, account);
  const first = specification(); importXml(db, first);
  assert.throws(() => importXml(db, specification({child:'SYNTHETIC-CHILD-B'})), error => error.code==='conflicting_payment_specification');
  assert.equal(storeTransactions(db, [aggregate()], 'enablebanking').imported, 1);
  assert.equal(listTransactions(db).length, 2);
  assert.equal(listTransactions(db).find(t => t.bank_reference==='SYNTHETIC-ENTRY').excluded, 1);
});

test('quality cycle: partial collective details remain blocked until they conserve the parent total', t => {
  const {db} = fixture(t); invoice(db, {total:62500}); storeTransactions(db, [aggregate()], 'enablebanking');
  const child = amount => ({account, booked_at:'2026-10-26', amount_cents:amount, currency:'SEK', payer:'Synthetic Customer AB', reference:'0604', bank_reference:'SYNTHETIC-CHILD-'+amount, parent_bank_reference:'SYNTHETIC-ENTRY'});
  storeTransactions(db, [child(25000)], 'manual');
  assert.throws(() => allocate(db, 'invoice', listTransactions(db).find(t => !t.is_aggregate).id, 25000), /ofullständig/i);
  assert.throws(() => storeTransactions(db, [child(40000)], 'manual'), error => error.code==='conflicting_payment_specification');
  assert.equal(storeTransactions(db, [child(37500)], 'manual').imported, 1);
  assert.equal(listTransactions(db).find(t => t.bank_reference==='SYNTHETIC-ENTRY').excluded, 1);
});

test('quality review: a new invalid OCR with an unchanged reference value durably blocks matching', t => {
  const f = fixture(t); invoice(f.db, {number:'0605'});
  importApi(f.db, apiOriginal({reference_number:'0605'}));
  const before = listTransactions(f.db)[0];
  const changed = apiOriginal({reference_number:'0605', ocr:'0605'});
  assert.ok(normalizeBankApiTransaction(changed, account).reference_evidence.candidates.some(candidate => candidate.validity==='checksum_invalid'));
  importApi(f.db, changed);
  const db = f.reopen(); runReconciliation(db);
  assert.equal(listInvoices(db)[0].paid_cents, 0);
  const transaction = listTransactions(db)[0];
  assert.equal(transaction.bank_evidence_conflicts.length, 1);
  assert.deepEqual(transaction.reference_evidence, before.reference_evidence);
  assert.deepEqual(transaction.raw_bank_data, before.raw_bank_data);
  assert.throws(() => allocate(db, 'invoice', transaction.id, 10000), /motstrid/i);
});

test('quality review: incomplete new reference analysis cannot leave the earlier original automatically usable', t => {
  const {db} = fixture(t); invoice(db, {number:'0605'});
  importApi(db, apiOriginal({reference_number:'0605'}));
  let details = {invoice_number:'0605'};
  for (let n=0; n<14; n++) details={nested:details};
  const changed = apiOriginal({reference_number:'0605', details});
  assert.equal(normalizeBankApiTransaction(changed, account).reference_evidence.incomplete, true);
  importApi(db, changed); runReconciliation(db);
  assert.equal(listInvoices(db)[0].paid_cents, 0);
  assert.equal(listTransactions(db)[0].bank_evidence_conflicts.length, 1);
});

test('quality review: an excluded parent conflict blocks its child in automatic and manual matching with a visible reason', t => {
  const f = fixture(t); const db = f.db; approveSyntheticBankAccount(db, account);
  invoice(db, {party:'Synthetic Customer A AB', total:62500});
  storeTransactions(db, [aggregate()], 'enablebanking'); importXml(db, specification());
  const child = listTransactions(db).find(transaction => transaction.bank_reference==='SYNTHETIC-CHILD-A');
  assert.equal(listTransactions(db).find(transaction => transaction.is_aggregate).excluded, 1);
  assert.throws(() => storeTransactions(db, [{...aggregate(), amount_cents:50000}], 'enablebanking'), error => error.code==='conflicting_bank_record');
  const reopened = f.reopen(); runReconciliation(reopened);
  assert.equal(listInvoices(reopened)[0].paid_cents, 0);
  assert.throws(() => allocate(reopened, 'invoice', child.id, 62500), /motstrid|samlings/i);
  const found = findings(reopened).find(item => item.transaction_id===child.id);
  assert.equal(found.safe, false); assert.equal(found.kind, 'bank_evidence_conflict');
  const transaction = listTransactions(reopened).find(item => item.id===child.id);
  assert.equal(transaction.status, 'review'); assert.match(transaction.review_reason, /motstrid|samlings/i);
  const overview = buildPaymentOverview({invoices:listInvoices(reopened), transactions:listTransactions(reopened), suggestions:findings(reopened)});
  assert.ok(overview.queue.some(item => item.entity_id===child.id && /motstrid|samlings/i.test(item.reason)));
});

test('quality review: a parent conflict preserves a child allocation but revokes its learned payer evidence', t => {
  const {db} = fixture(t); approveSyntheticBankAccount(db, account);
  invoice(db, {total:62500}); storeTransactions(db, [aggregate()], 'enablebanking');
  importXml(db, specification({party:'Synthetic Private Payer'}));
  const child = listTransactions(db).find(transaction => !transaction.is_aggregate);
  allocate(db, 'invoice', child.id, 62500);
  const allocation = db.prepare('SELECT * FROM allocations').get();
  assert.throws(() => storeTransactions(db, [{...aggregate(), amount_cents:50000}], 'enablebanking'), error => error.code==='conflicting_bank_record');
  invoice(db, {id:'next', number:'0605'});
  importApi(db, apiOriginal({entry_reference:'NEXT-SYNTHETIC-PAYMENT', debtor:{name:'Synthetic Private Payer'}, reference_number:'0605'}));
  runReconciliation(db);
  assert.equal(listInvoices(db).find(item => item.id==='next').paid_cents, 0);
  assert.deepEqual(db.prepare('SELECT * FROM allocations WHERE id=?').get(allocation.id), allocation);
  assert.equal(listInvoices(db).find(item => item.id==='invoice').paid_cents, 62500);
  const overview = buildPaymentOverview({invoices:listInvoices(db), transactions:listTransactions(db), suggestions:findings(db)});
  assert.ok(overview.queue.some(item => item.entity_id===child.id && /motstrid|samlings/i.test(item.reason)));
});

test('quality review: all encountered identity conflicts survive a later financial failure without importing new money', t => {
  const f = fixture(t); const db = f.db; invoice(db); importApi(db, apiOriginal());
  importApi(db, apiOriginal({entry_reference:'UNRELATED-SYNTHETIC-B', reference_number:'other', debtor:{name:'Other Synthetic AB'}, transaction_amount:{amount:'500.00', currency:'SEK'}}));
  const originals = listTransactions(db).map(transaction => ({id:transaction.id, raw:transaction.raw_bank_data}));
  const changed = [apiOriginal({debtor:{name:'Contradictory Synthetic AB'}}), apiOriginal({entry_reference:'UNRELATED-SYNTHETIC-B', reference_number:'other', debtor:{name:'Other Synthetic AB'}, transaction_amount:{amount:'600.00', currency:'SEK'}})]
    .map(raw => normalizeBankApiTransaction(raw, account));
  for (let n=0; n<2; n++) assert.throws(() => storeTransactions(db, changed, 'enablebanking'), error => error.code==='conflicting_bank_record');
  const reopened = f.reopen(); runReconciliation(reopened);
  assert.equal(listInvoices(reopened)[0].paid_cents, 0);
  const transactions = listTransactions(reopened);
  assert.equal(transactions.length, 2);
  for (const transaction of transactions) {
    assert.equal(transaction.bank_evidence_conflicts.length, 1);
    assert.deepEqual(transaction.raw_bank_data, originals.find(original => original.id===transaction.id).raw);
  }
  assert.equal(reopened.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='bank_evidence_conflict'").get().n, 2);
});

test('quality review: an identity conflict survives a later specification-conservation rollback', t => {
  const {db} = fixture(t); invoice(db); approveSyntheticBankAccount(db, account); importApi(db, apiOriginal());
  storeTransactions(db, [aggregate()], 'enablebanking'); importXml(db, specification());
  const before = listTransactions(db);
  const changed = specification({child:'SYNTHETIC-TRANSACTION', party:'Contradictory Synthetic AB', amount:'100.00'}).replaceAll('SYNTHETIC-ENTRY', 'SYNTHETIC-OTHER-ENTRY');
  const extraEntry = specification({child:'SYNTHETIC-CHILD-B'}).match(/<Ntry>[\s\S]*?<\/Ntry>/)[0];
  const xml = changed.replace('</Ntfctn>', `${extraEntry}</Ntfctn>`);
  assert.throws(() => importXml(db, xml, 'synthetic-conflicting-batch.xml'), error => error.code==='conflicting_payment_specification');
  runReconciliation(db);
  assert.equal(listInvoices(db)[0].paid_cents, 0);
  const after = listTransactions(db);
  assert.equal(after.length, before.length);
  const transaction = after.find(item => item.bank_reference==='SYNTHETIC-TRANSACTION');
  assert.equal(transaction.bank_evidence_conflicts.length, 1);
  assert.equal(transaction.payer, 'Synthetic Customer AB');
  assert.deepEqual(transaction.raw_bank_data, before.find(item => item.id===transaction.id).raw_bank_data);
});
