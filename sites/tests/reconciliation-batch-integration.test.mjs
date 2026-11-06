import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {applyCommand, available, balance, emptyState, paid} from '../lib/domain.ts';
import {syntheticBankRow} from './helpers/bank-api-fixture.mjs';
import {account, hash, ingestFixture} from './helpers/bankgiro-ingest-fixture.mjs';

const party = 'Synthetic batch customer AB';
const local = path => new URL(path, import.meta.url).href;
const data = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
function compiled(path, imports) {
  let code = stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'), {mode:'transform'});
  for (const [from, to] of Object.entries(imports)) for (const quote of ['"', "'"]) code = code.replaceAll(quote + from + quote, JSON.stringify(to));
  return data(code);
}

function payment(reference, amount, extra = {}) {
  return syntheticBankRow({account, date:'2026-10-26', amount, party, payerReference:reference,
    bankReference:'SYNTHETIC-BATCH-' + reference, ...extra});
}

async function fixture(t, invoices) {
  let state = emptyState();
  for (const invoice of invoices) state = applyCommand(state, {type:'invoice.save', invoice:{
    direction:'receivable', number:invoice.number, ocr:invoice.number, party:invoice.party || party,
    total:invoice.total, currency:'SEK', issued:'2026-10-01', due:'2099-12-31', reviewed:true,
    documentId:'synthetic-invoice-' + invoice.number,
  }}).state;
  // Real SQLite/D1 writes, retained-object reads, source census, account verifier,
  // and commit-time consent fences. Only fixture bindings/provider resources vary.
  const f = await ingestFixture(t, {state});
  for (const invoice of state.invoices) {
    const bytes = new TextEncoder().encode('Synthetic retained invoice ' + JSON.stringify(invoice));
    f.objects.set(f.owner + '/' + invoice.documentId, bytes);
    f.sql.prepare('INSERT INTO documents(id,owner,filename,mime,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(invoice.documentId, f.owner, invoice.documentId + '.txt', 'text/plain', bytes.length, hash(bytes), '2026-10-01');
  }
  const {server, reconciliation, evidence} = f.moduleUrls;
  f.evidence = await import(evidence);
  const messages = await import(compiled('../lib/customer-messages.ts', {
    './server':server, './domain':local('../lib/domain.ts'), './reconciliation':reconciliation,
    './reconciliation-evidence':evidence, './customer-message-text.js':local('../lib/customer-message-text.js'),
    './banking/security':local('../lib/banking/security.ts'),
    './banking/store':data('export async function encrypt(){throw Error("Unused encryption in reconciliation test");} export async function decrypt(){throw Error("Unused decryption in reconciliation test");}'),
    './gmail-adapter.js':data('export async function prepareGmailSend(){throw Error("Sending is forbidden in reconciliation tests");} export function hasGmailSendScope(){return false;}'),
  }));
  f.reconcile = () => messages.reconcileAndPrepare(f.owner);
  f.import = rows => {
    const current = f.read().state, before = structuredClone(current), originalRows = structuredClone(rows);
    const result = applyCommand(current, {type:'transactions.import', trustedBankImport:true, account, name:'Synthetic recurring sync', rows});
    assert.deepEqual(current, before, 'Import must not mutate its input workspace.');
    assert.deepEqual(rows, originalRows, 'Import must not rewrite received bank observations.');
    f.write(result.state);
    return result;
  };
  return f;
}

const invoiceByNumber = (state, number) => state.invoices.find(invoice => invoice.number === number);
const transactionByReference = (state, reference) => state.transactions.find(row => row.bankReference === reference);
const originalSnapshot = f => ({documents:f.sql.prepare('SELECT * FROM documents ORDER BY id').all(), objects:structuredClone(f.objects)});
const automaticAudits = f => f.audits().filter(row => row.action === 'automatic.reconciliation');

async function assertRetryIsReadOnly(f) {
  const before = f.read(), audits = f.audits(), originals = originalSnapshot(f);
  assert.equal((await f.reconcile()).automatic, 0);
  assert.equal((await f.reconcile()).automatic, 0);
  assert.deepEqual(f.read(), before, 'A no-op reconciliation must not rewrite the workspace or revision.');
  assert.deepEqual(f.audits(), audits, 'A no-op reconciliation must not add any audit or message event.');
  assert.deepEqual(originalSnapshot(f), originals);
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
  test(`Sites persisted batch: ${label}, ${reverse ? 'reverse' : 'forward'} import order`, async t => {
    const f = await fixture(t, reverse ? [...invoices].reverse() : invoices);
    const rows = invoices.map(invoice => payment(invoice.number, invoice.total, {party:invoice.party || party}));
    const ordered = reverse ? [...rows].reverse() : rows;
    f.import(ordered);
    const initial = f.read().state, input = structuredClone(initial), originals = originalSnapshot(f);
    assert.equal(initial.allocations.length, 0);
    const candidate = await f.evidence.reconcileWithOriginals(f.owner, initial);
    assert.equal(candidate.state.allocations.length, invoices.length);
    assert.deepEqual(initial, input, 'Original-aware reconciliation must not mutate the supplied state.');
    assert.deepEqual(candidate.state.transactions, input.transactions);

    assert.equal((await f.reconcile()).automatic, invoices.length);
    const settled = f.read().state;
    assert.equal(settled.allocations.length, invoices.length);
    for (const expected of invoices) {
      const invoice = invoiceByNumber(settled, expected.number);
      const transaction = transactionByReference(settled, 'SYNTHETIC-BATCH-' + expected.number);
      const actual = settled.allocations.filter(row => row.invoiceId === invoice.id && row.active);
      assert.equal(actual.length, 1);
      assert.equal(actual[0].transactionId, transaction.id, 'Exact references must retain their invoice identity.');
      assert.equal(actual[0].amount, expected.total);
      assert.equal(paid(settled, invoice.id), expected.total);
      assert.equal(balance(settled, invoice), 0);
      assert.equal(available(settled, transaction), 0);
    }
    assert.equal(invoiceByNumber(settled, '0599').total, 62500);
    assert.deepEqual(settled.transactions, initial.transactions);
    assert.deepEqual(originalSnapshot(f), originals);
    assert.equal(automaticAudits(f).length, 1);
    const decisions = JSON.parse(automaticAudits(f)[0].detail).decisions;
    assert.equal(decisions.length, invoices.length);
    assert.equal(new Set(decisions.map(item => item.invoice_id + ':' + item.transaction_id)).size, invoices.length);
    await assertRetryIsReadOnly(f);

    const committedAudits = f.audits();
    for (const replay of [ordered, [...ordered].reverse()]) {
      f.import(replay);
      const reimported = f.read().state;
      assert.equal(reimported.imports.at(-1).count, 0);
      assert.deepEqual(reimported.transactions, settled.transactions);
      assert.deepEqual(reimported.allocations, settled.allocations);
      assert.equal((await f.reconcile()).automatic, 0);
      assert.deepEqual(f.read().state.allocations, settled.allocations);
      assert.deepEqual(f.audits(), committedAudits);
      assert.deepEqual(originalSnapshot(f), originals);
    }
    await assertRetryIsReadOnly(f);
  });
}

test('Sites persisted batch: reviewed 250000 partial plus exact 62500 remainder preserves history and settles 312500 once', async t => {
  const f = await fixture(t, [{number:'0597', total:312500}]);
  const partial = payment('0597', 250000, {bankReference:'SYNTHETIC-PARTIAL'});
  f.import([partial]);
  const result = await f.reconcile();
  assert.equal(result.automatic, 0);
  assert.ok(result.findings.some(finding => finding.kind === 'partial' && !finding.safe));
  const unpaid = f.read().state, invoice = invoiceByNumber(unpaid, '0597');
  assert.equal(unpaid.allocations.length, 0);
  assert.equal(balance(unpaid, invoice), 312500);
  assert.equal(available(unpaid, unpaid.transactions[0]), 250000);
  await assertRetryIsReadOnly(f);

  const reviewed = applyCommand(unpaid, {type:'match.create', invoiceId:invoice.id, transactionId:unpaid.transactions[0].id,
    amount:250000, note:'Synthetic independently reviewed partial payment of 2500 SEK'}).state;
  f.write(reviewed);
  const historical = structuredClone(reviewed.allocations[0]);
  assert.equal(balance(reviewed, invoiceByNumber(reviewed, '0597')), 62500);
  await f.reconcile();
  await assertRetryIsReadOnly(f);

  const remainder = payment('0597', 62500, {date:'2026-10-27', bankReference:'SYNTHETIC-REMAINDER'});
  f.import([remainder]);
  const bankBefore = f.read().state.transactions, originals = originalSnapshot(f);
  assert.equal((await f.reconcile()).automatic, 1);
  const settled = f.read().state;
  assert.deepEqual(settled.allocations.find(row => row.id === historical.id), historical);
  assert.equal(settled.allocations.length, 2);
  assert.equal(settled.allocations.find(row => row.id !== historical.id).amount, 62500);
  assert.equal(paid(settled, invoice.id), 312500);
  assert.equal(balance(settled, invoiceByNumber(settled, '0597')), 0);
  assert.ok(settled.transactions.every(row => available(settled, row) === 0));
  assert.deepEqual(settled.transactions, bankBefore);
  assert.deepEqual(originalSnapshot(f), originals);
  const auditBefore = automaticAudits(f);
  f.import([remainder, partial]);
  assert.equal((await f.reconcile()).automatic, 0);
  assert.deepEqual(f.read().state.allocations, settled.allocations);
  assert.deepEqual(automaticAudits(f), auditBefore);
  await assertRetryIsReadOnly(f);
});

test('Sites persisted batch: reviewed 70000 receipt pays 0599 only and retains 7500 excess', async t => {
  const f = await fixture(t, [{number:'0599', total:62500}, {number:'0600', total:7500}]);
  const row = payment('0599', 70000);
  f.import([row]);
  const result = await f.reconcile();
  assert.equal(result.automatic, 0);
  assert.ok(result.findings.some(finding => finding.kind === 'overpayment' && !finding.safe));
  const before = f.read().state, invoice = invoiceByNumber(before, '0599');
  assert.equal(before.allocations.length, 0);
  await assertRetryIsReadOnly(f);

  const originals = originalSnapshot(f);
  const reviewed = applyCommand(before, {type:'match.create', invoiceId:invoice.id, transactionId:before.transactions[0].id,
    amount:62500, note:'Synthetic independently reviewed payment; 75 SEK remains unapplied'}).state;
  f.write(reviewed);
  assert.equal((await f.reconcile()).automatic, 0);
  const settled = f.read().state;
  assert.equal(paid(settled, invoice.id), 62500);
  assert.equal(balance(settled, invoiceByNumber(settled, '0599')), 0);
  assert.equal(paid(settled, invoiceByNumber(settled, '0600').id), 0);
  assert.equal(available(settled, settled.transactions[0]), 7500);
  assert.deepEqual(settled.transactions, before.transactions);
  assert.deepEqual(originalSnapshot(f), originals);
  f.import([row]);
  assert.equal((await f.reconcile()).automatic, 0);
  assert.deepEqual(f.read().state.allocations, reviewed.allocations);
  assert.equal(automaticAudits(f).length, 0);
  assert.equal(available(f.read().state, f.read().state.transactions[0]), 7500);
  await assertRetryIsReadOnly(f);
});

for (const reference of ['0577', '']) test(`Sites persisted batch: ${reference ? 'wrong 0577' : 'missing'} reference never consumes invoice 0597`, async t => {
  const f = await fixture(t, [{number:'0597', total:312500}]);
  const row = payment(reference, 312500, {bankReference:'SYNTHETIC-UNRESOLVED'});
  f.import([row]);
  const initial = f.read().state, result = await f.reconcile();
  assert.equal(result.automatic, 0);
  assert.ok(result.findings.some(finding => finding.kind === (reference ? 'wrong_reference' : 'missing_reference') && !finding.safe));
  assert.deepEqual(f.read().state, initial);
  assert.equal(available(initial, initial.transactions[0]), 312500);
  assert.equal(balance(initial, initial.invoices[0]), 312500);
  f.import([row]);
  assert.equal((await f.reconcile()).automatic, 0);
  const current = f.read().state;
  assert.deepEqual(current.transactions, initial.transactions);
  assert.deepEqual(current.invoices, initial.invoices);
  assert.deepEqual(current.allocations, []);
  assert.equal(automaticAudits(f).length, 0);
  await assertRetryIsReadOnly(f);
});

for (const invalid of ['changed invoice bytes', 'unselected bank account']) test(`Sites persisted batch checks real original/consent evidence: ${invalid}`, async t => {
  const f = await fixture(t, [{number:'0599', total:62500}]);
  f.import([payment('0599', 62500)]);
  if (invalid === 'changed invoice bytes') f.objects.set(f.owner + '/synthetic-invoice-0599', new TextEncoder().encode('Altered synthetic invoice'));
  else f.sql.prepare("UPDATE bank_connections SET selected_accounts='[]' WHERE owner=?").run(f.owner);
  const initial = f.read().state, before = structuredClone(initial);
  const result = await f.evidence.reconcileWithOriginals(f.owner, initial);
  assert.equal(result.state.allocations.length, 0);
  assert.ok(result.findings.every(finding => !finding.safe));
  assert.deepEqual(initial, before);
  assert.equal((await f.reconcile()).automatic, 0);
  assert.equal(f.read().state.allocations.length, 0);
  assert.equal(balance(f.read().state, f.read().state.invoices[0]), 62500);
  await assertRetryIsReadOnly(f);
});
