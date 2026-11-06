import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase, storeTransactions, listInvoices, listTransactions, allocate} from '../src/db.js';
import {runReconciliation} from '../src/reconciliation.js';
import {approveSyntheticBankAccount, withSyntheticBankOriginal} from './bank-fixtures.js';
import {retainSyntheticInvoiceOriginal} from './invoice-fixtures.js';

const account = 'SE4280000890119146168423';
const party = 'Synthetic batch customer AB';

function fixture(t, invoices) {
  const folder = mkdtempSync(join(tmpdir(), 'mg-reconciliation-batch-'));
  const db = openDatabase(join(folder, 'synthetic.sqlite'));
  t.after(() => { db.close(); rmSync(folder, {recursive:true, force:true}); });
  approveSyntheticBankAccount(db, account);
  for (const invoice of invoices) {
    db.prepare('INSERT INTO invoices(id,direction,invoice_number,reference,party,total_cents,issued_at) VALUES(?,?,?,?,?,?,?)')
      .run(invoice.number, 'customer', invoice.number, invoice.number, invoice.party || party, invoice.total, '2026-10-01');
    retainSyntheticInvoiceOriginal(db, invoice.number);
  }
  return db;
}

function payment(reference, amount, extra = {}) {
  return withSyntheticBankOriginal({account, booked_at:'2026-10-26', currency:'SEK', payer:party,
    reference, amount_cents:amount, bank_reference:'SYNTHETIC-BATCH-' + reference, ...extra});
}

const bankRows = db => db.prepare('SELECT * FROM bank_transactions ORDER BY id').all();
const originals = db => db.prepare('SELECT * FROM documents ORDER BY id').all();
const allocations = db => db.prepare('SELECT * FROM allocations ORDER BY id').all();
const audits = db => db.prepare('SELECT * FROM audit_events ORDER BY rowid').all();
const paymentAudits = db => audits(db).filter(row => ['manual_match', 'automatic_match', 'automatic_verified_match'].includes(row.action));
const invoiceByNumber = (db, number) => listInvoices(db).find(invoice => invoice.invoice_number === number);
const transactionByReference = (db, reference) => listTransactions(db).find(row => row.bank_reference === reference);

function assertRetryIsReadOnly(db) {
  const before = {allocations:allocations(db), audits:audits(db), banks:bankRows(db), documents:originals(db)};
  runReconciliation(db);
  runReconciliation(db);
  assert.deepEqual(allocations(db), before.allocations);
  assert.deepEqual(audits(db), before.audits, 'A no-op reconciliation must not add any audit event.');
  assert.deepEqual(bankRows(db), before.banks);
  assert.deepEqual(originals(db), before.documents);
}

const batches = [
  ['same payer with exact 0597 and 0577', [
    {number:'0597', total:312500}, {number:'0577', total:312500}, {number:'0599', total:62500},
  ]],
  ['different payers with equal amounts', [
    {number:'0597', total:62500, party:'Synthetic Alpha AB'},
    {number:'0577', total:62500, party:'Synthetic Beta AB'},
    {number:'0599', total:62500, party:'Synthetic Gamma AB'},
  ]],
];

for (const [label, invoices] of batches) for (const reverse of [false, true]) {
  test(`SQLite batch: ${label}, ${reverse ? 'reverse' : 'forward'} import order`, t => {
    const db = fixture(t, reverse ? [...invoices].reverse() : invoices);
    const rows = invoices.map(invoice => payment(invoice.number, invoice.total, {payer:invoice.party || party}));
    const ordered = reverse ? [...rows].reverse() : rows;
    assert.equal(storeTransactions(db, ordered, 'enablebanking').imported, invoices.length);
    assert.equal(allocations(db).length, 0, 'Importing bank evidence alone must not allocate it.');
    const bankBefore = bankRows(db), documentsBefore = originals(db);

    const result = runReconciliation(db, {includeSummary:true});
    assert.equal(result.applied, invoices.length);
    assert.equal(allocations(db).length, invoices.length);
    for (const expected of invoices) {
      const invoice = invoiceByNumber(db, expected.number);
      const transaction = transactionByReference(db, 'SYNTHETIC-BATCH-' + expected.number);
      const actual = allocations(db).filter(row => row.invoice_id === invoice.id);
      assert.equal(actual.length, 1);
      assert.equal(actual[0].transaction_id, transaction.id, 'Exact references must retain their invoice identity.');
      assert.equal(actual[0].amount_cents, expected.total);
      assert.equal(invoice.paid_cents, expected.total);
      assert.equal(invoice.remaining_cents, 0);
      assert.equal(invoice.status, 'paid');
      assert.equal(transaction.available_cents, 0);
    }
    assert.equal(invoiceByNumber(db, '0599').total_cents, 62500);
    assert.equal(paymentAudits(db).filter(row => row.action === 'automatic_match').length, invoices.length);
    assert.equal(paymentAudits(db).filter(row => row.action === 'automatic_verified_match').length, invoices.length);
    assert.deepEqual(bankRows(db), bankBefore);
    assert.deepEqual(originals(db), documentsBefore);
    assertRetryIsReadOnly(db);

    const settled = allocations(db), committedAudits = paymentAudits(db);
    for (const replay of [ordered, [...ordered].reverse()]) {
      const imported = storeTransactions(db, replay, 'enablebanking');
      assert.equal(imported.imported, 0);
      assert.equal(imported.duplicate, invoices.length);
      assert.equal(imported.enriched, 0);
      assert.equal(imported.conflicts, 0);
      runReconciliation(db);
      assert.deepEqual(allocations(db), settled);
      // A new sync has an import receipt; it must not manufacture another payment audit.
      assert.deepEqual(paymentAudits(db), committedAudits);
      assert.deepEqual(bankRows(db), bankBefore);
      assert.deepEqual(originals(db), documentsBefore);
    }
    assertRetryIsReadOnly(db);
  });
}

test('SQLite batch: reviewed 250000 partial plus exact 62500 remainder preserves history and settles 312500 once', t => {
  const db = fixture(t, [{number:'0597', total:312500}]);
  const partial = payment('0597', 250000, {bank_reference:'SYNTHETIC-PARTIAL'});
  storeTransactions(db, [partial], 'enablebanking');
  const findings = runReconciliation(db);
  assert.ok(findings.some(finding => finding.kind === 'partial' && !finding.safe));
  assert.equal(invoiceByNumber(db, '0597').paid_cents, 0);
  assert.equal(transactionByReference(db, 'SYNTHETIC-PARTIAL').available_cents, 250000);
  assertRetryIsReadOnly(db);

  allocate(db, '0597', transactionByReference(db, 'SYNTHETIC-PARTIAL').id, 250000);
  const historical = allocations(db)[0], manualAudits = paymentAudits(db);
  assert.equal(invoiceByNumber(db, '0597').status, 'partial');
  assert.equal(invoiceByNumber(db, '0597').remaining_cents, 62500);
  assertRetryIsReadOnly(db);

  const remainder = payment('0597', 62500, {booked_at:'2026-10-27', bank_reference:'SYNTHETIC-REMAINDER'});
  storeTransactions(db, [remainder], 'enablebanking');
  const bankBefore = bankRows(db), documentsBefore = originals(db);
  assert.equal(runReconciliation(db, {includeSummary:true}).applied, 1);
  assert.deepEqual(allocations(db).find(row => row.id === historical.id), historical);
  assert.equal(allocations(db).length, 2);
  assert.equal(allocations(db).find(row => row.id !== historical.id).amount_cents, 62500);
  assert.equal(invoiceByNumber(db, '0597').paid_cents, 312500);
  assert.equal(invoiceByNumber(db, '0597').remaining_cents, 0);
  assert.equal(invoiceByNumber(db, '0597').status, 'paid');
  assert.ok(listTransactions(db).every(row => row.available_cents === 0));
  assert.deepEqual(paymentAudits(db).filter(row => row.action === 'manual_match'), manualAudits);
  const settled = allocations(db), committedAudits = paymentAudits(db);
  assert.equal(storeTransactions(db, [remainder, partial], 'enablebanking').duplicate, 2);
  runReconciliation(db);
  assert.deepEqual(allocations(db), settled);
  assert.deepEqual(paymentAudits(db), committedAudits);
  assert.deepEqual(bankRows(db), bankBefore);
  assert.deepEqual(originals(db), documentsBefore);
  assertRetryIsReadOnly(db);
});

test('SQLite batch: reviewed 70000 receipt pays 0599 only and retains 7500 excess', t => {
  const db = fixture(t, [{number:'0599', total:62500}, {number:'0600', total:7500}]);
  const row = payment('0599', 70000);
  storeTransactions(db, [row], 'enablebanking');
  const findings = runReconciliation(db);
  assert.ok(findings.some(finding => finding.invoice_id === '0599' && finding.kind === 'overpayment' && !finding.safe));
  assert.equal(allocations(db).length, 0);
  assertRetryIsReadOnly(db);

  const bankBefore = bankRows(db), documentsBefore = originals(db);
  allocate(db, '0599', transactionByReference(db, row.bank_reference).id, 62500);
  const reviewed = allocations(db), reviewedAudits = paymentAudits(db);
  runReconciliation(db);
  assert.equal(invoiceByNumber(db, '0599').paid_cents, 62500);
  assert.equal(invoiceByNumber(db, '0600').paid_cents, 0, 'Excess is not permission to settle another invoice for the same payer.');
  assert.equal(transactionByReference(db, row.bank_reference).available_cents, 7500);
  assert.equal(storeTransactions(db, [row], 'enablebanking').duplicate, 1);
  runReconciliation(db);
  assert.deepEqual(allocations(db), reviewed);
  assert.deepEqual(paymentAudits(db), reviewedAudits);
  assert.deepEqual(bankRows(db), bankBefore);
  assert.deepEqual(originals(db), documentsBefore);
  assertRetryIsReadOnly(db);
});

for (const reference of ['0577', '']) test(`SQLite batch: ${reference ? 'wrong 0577' : 'missing'} reference never consumes invoice 0597`, t => {
  const db = fixture(t, [{number:'0597', total:312500}]);
  const row = payment(reference, 312500, {bank_reference:'SYNTHETIC-UNRESOLVED'});
  storeTransactions(db, [row], 'enablebanking');
  const bankBefore = bankRows(db), invoiceBefore = db.prepare('SELECT * FROM invoices').get();
  const findings = runReconciliation(db);
  assert.ok(findings.some(finding => finding.kind === (reference ? 'wrong_reference' : 'missing_reference') && !finding.safe));
  assert.equal(allocations(db).length, 0);
  assert.equal(invoiceByNumber(db, '0597').remaining_cents, 312500);
  assert.equal(transactionByReference(db, row.bank_reference).available_cents, 312500);
  assert.equal(paymentAudits(db).length, 0);
  assert.equal(storeTransactions(db, [row], 'enablebanking').duplicate, 1);
  runReconciliation(db);
  assert.deepEqual(bankRows(db), bankBefore);
  assert.deepEqual(db.prepare('SELECT * FROM invoices').get(), invoiceBefore);
  assert.equal(paymentAudits(db).length, 0);
  assertRetryIsReadOnly(db);
});
