import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {applyCommand, balance} from '../lib/domain.ts';
import {genericCompanyState} from './helpers/reference-policy-fixture.mjs';
import {syntheticBankTransaction} from './helpers/bank-api-fixture.mjs';

let source = stripTypeScriptTypes(readFileSync(new URL('../lib/reconciliation.ts', import.meta.url), 'utf8'), {mode: 'transform'});
for (const [name, path] of [['./domain', '../lib/domain.ts'], ['./reconciliation-engine.js', '../lib/reconciliation-engine.js']]) {
  source = source.replaceAll("'" + name + "'", JSON.stringify(new URL(path, import.meta.url).href));
}
const {analyze, reconcileState} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

function fixture({reference = '0599', party = 'Synthetic Customer AB'} = {}) {
  const state = applyCommand(genericCompanyState(), {type: 'invoice.save', invoice: {
    direction: 'receivable', number: '0599', ocr: '0599', party: 'Synthetic Customer AB',
    total: 62500, currency: 'SEK', issued: '2026-10-01', due: '2026-10-30', reviewed: true,
  }}).state;
  state.transactions = [syntheticBankTransaction({id: 'payment', amount: 62500,
    party, payerReference: reference, date: '2026-10-26', kind: 'payment', verified: true})];
  return state;
}
const verify = (state, fields = {}) => applyCommand(state, {type: 'transaction.verify', id: 'payment',
  party: 'Synthetic Customer AB', payerReference: '0599', note: 'Synthetic separate manual observation', ...fields}).state;
function assertHeld(state) {
  const before = structuredClone(state), result = reconcileState(state);
  assert.equal(result.state.allocations.length, state.allocations.length);
  assert.ok(result.findings.every(finding => !finding.safe));
  assert.deepEqual(result.state.transactions, before.transactions);
  assert.deepEqual(state, before);
  return result;
}

for (const reference of ['0577', '', '599']) test('manual reference cannot become bank evidence for a generic company: ' + JSON.stringify(reference), () => {
  const state = verify(fixture({reference})), result = assertHeld(state);
  assert.equal(balance(result.state, result.state.invoices[0]), 62500);
  assert.equal(state.transactions[0].bankData.reference_number, reference);
  if (reference) assert.ok(result.findings.some(f => f.reference_sources?.some(candidate => candidate.value === reference)));
});

test('manual payer substitution remains a review decision despite an exact bank reference', () => {
  const state = verify(fixture({party: 'Original Bank Payer AB'}));
  assertHeld(state);
  assert.equal(state.transactions[0].bankData.debtor.name, 'Original Bank Payer AB');
});

test('manual confirmation of unchanged intact bank facts remains eligible', () => {
  const state = verify(fixture()), result = reconcileState(state);
  assert.equal(result.state.allocations.length, 1);
  assert.equal(balance(result.state, result.state.invoices[0]), 0);
  assert.equal(reconcileState(result.state).state.allocations.length, 1);
});

test('unchanged manual confirmation cannot erase an invalid typed bank OCR', () => {
  let state = fixture();
  state.transactions = [syntheticBankTransaction({id: 'payment', amount: 62500,
    party: 'Synthetic Customer AB', payerReference: '0599', date: '2026-10-26',
    kind: 'payment', verified: true}, {reference_number_schema: 'SEBG'})];
  state = verify(state);
  assertHeld(state);
  assert.ok(analyze(state).some(f => f.reference_sources?.some(c => c.validity === 'checksum_invalid')));
});

test('manually registered and confirmed cash cannot create an automatic bank allocation', () => {
  let state = fixture(); state.transactions = [];
  state = applyCommand(state, {type: 'transactions.import', account: 'manual-account', rows: [{
    date: '2026-10-26', amount: 62500, party: 'Synthetic Customer AB', payerReference: '0599',
    currency: 'SEK', source: 'Manuellt registrerad', kind: 'payment', verified: false,
  }]}).state;
  state = applyCommand(state, {type: 'transaction.verify', id: state.transactions[0].id, note: 'Synthetic manual entry only'}).state;
  assertHeld(state);
});

test('manual split of an aggregate preserves one cash budget but requires allocation review', () => {
  let state = fixture();
  state.transactions = [syntheticBankTransaction({id: 'parent', amount: 62500, party: 'Bankgiro',
    payerReference: '', kind: 'batch', verified: false, description: 'Bankgiro samlingspost'})];
  state = applyCommand(state, {type: 'transaction.split', id: 'parent', rows: [{
    amount: 62500, party: 'Synthetic Customer AB', payerReference: '0599',
  }]}).state;
  assertHeld(state);
});

test('explicit manual allocation is preserved and never rewrites the bank reference', () => {
  let state = verify(fixture({reference: '0577'}));
  state = applyCommand(state, {type: 'match.create', invoiceId: state.invoices[0].id,
    transactionId: 'payment', amount: 62500, note: 'Synthetic reviewed correction with separate business evidence'}).state;
  const before = structuredClone(state), result = reconcileState(state);
  assert.deepEqual(result.state.allocations, before.allocations);
  assert.equal(balance(result.state, result.state.invoices[0]), 0);
  assert.equal(result.state.transactions[0].bankData.reference_number, '0577');
  assert.deepEqual(result.state.transactions, before.transactions);
});

test('manually substituted historical payer cannot teach a new automatic identity', () => {
  let state = verify(fixture({party: 'Original Bank Payer AB'}), {party: 'Manual Customer Alias'});
  state = applyCommand(state, {type: 'match.create', invoiceId: state.invoices[0].id,
    transactionId: 'payment', amount: 62500, note: 'Synthetic explicit reviewed historical match'}).state;
  state = applyCommand(state, {type: 'invoice.save', invoice: {
    direction: 'receivable', number: '0600', ocr: '0600', party: 'Synthetic Customer AB',
    total: 62500, currency: 'SEK', issued: '2026-10-01', due: '2026-10-30', reviewed: true,
  }}).state;
  state.transactions.push(syntheticBankTransaction({id: 'next', amount: 62500,
    party: 'Manual Customer Alias', payerReference: '0600', date: '2026-10-27',
    bankReference: 'SYNTHETIC-NEXT', kind: 'payment', verified: true}));
  const result = assertHeld(state);
  assert.equal(result.state.allocations.length, 1);
  assert.ok(analyze(state).filter(f => f.transaction_id === 'next').every(f => !f.safe));
});
