import assert from 'node:assert/strict';

// Entirely synthetic. Expectations are literal invoice/payment/öre triples,
// independently chosen from the business scenarios, not from either engine.
const invoice = (id, extra = {}) => ({
  id, direction: 'customer', kind: 'invoice', currency: 'SEK',
  party: 'Synthetic Customer AB', organization_number: '', invoice_number: id,
  reference: id, issued_at: '2026-10-01', total_cents: 62500,
  remaining_cents: 62500, ...extra,
});
const payment = (reference, extra = {}) => ({
  id: 'pay-' + reference, account: 'synthetic-account', amount_cents: 62500,
  available_cents: 62500, currency: 'SEK', booked_at: '2026-10-26',
  payer: 'Synthetic Customer AB', reference, bank_reference: 'BANK-' + reference,
  verified: true, ...extra,
});
const pair = () => ({
  invoices: [invoice('0597'), invoice('0577')],
  transactions: [payment('0597'), payment('0577')],
});
const single = () => ({invoices: [invoice('0599')], transactions: [payment('0599')]});

export const reconciliationDecisionCases = [
  {id: 'exact-0599-625-sek', input: single, expected: [['0599', 'pay-0599', 62500]]},
  {id: 'same-payer-separate-exact-references', input: pair,
    expected: [['0577', 'pay-0577', 62500], ['0597', 'pay-0597', 62500]]},
  {id: 'different-payers-equal-amounts', input: () => {
    const data = pair(); data.invoices[1].party = data.transactions[1].payer = 'Other Synthetic Customer AB'; return data;
  }, expected: [['0577', 'pay-0577', 62500], ['0597', 'pay-0597', 62500]]},
  {id: 'same-payer-separate-exact-amounts', input: () => {
    const data = pair(); data.invoices[1].total_cents = data.invoices[1].remaining_cents = 250000;
    data.transactions[1].amount_cents = data.transactions[1].available_cents = 250000; return data;
  }, expected: [['0577', 'pay-0577', 250000], ['0597', 'pay-0597', 62500]]},
  {id: 'exact-reviewed-remaining-balance', input: () => {
    const data = single(); data.invoices[0].total_cents = 312500; data.invoices[0].paid_cents = 250000; return data;
  }, expected: [['0599', 'pay-0599', 62500]]},
  {id: 'wrong-0597-cannot-pay-0577', input: () => ({invoices: [invoice('0577')], transactions: [payment('0597')]}), expected: []},
  {id: 'leading-zero-is-identity', input: () => ({invoices: [invoice('599')], transactions: [payment('0599')]}), expected: []},
  {id: '2500-is-partial-of-3125', input: () => ({invoices: [invoice('0599', {total_cents: 312500, remaining_cents: 312500})], transactions: [payment('0599', {amount_cents: 250000, available_cents: 250000})]}), expected: []},
  {id: 'one-ore-short-is-partial', input: () => ({invoices: [invoice('0599')], transactions: [payment('0599', {amount_cents: 62499, available_cents: 62499})]}), expected: []},
  {id: 'excess-remains-review', input: () => ({invoices: [invoice('0599')], transactions: [payment('0599', {amount_cents: 70000, available_cents: 70000})]}), expected: []},
  {id: 'duplicate-exact-payment', input: () => {
    const data = single(); data.transactions.push(payment('0599', {id: 'second', bank_reference: 'BANK-SECOND'})); return data;
  }, expected: []},
  {id: 'two-partials-are-not-a-full-automatic-payment', input: () => ({
    invoices: [invoice('0599')], transactions: [payment('0599', {id: 'first', amount_cents: 25000, available_cents: 25000}), payment('0599', {id: 'second', bank_reference: 'BANK-SECOND', amount_cents: 37500, available_cents: 37500})],
  }), expected: []},
  {id: 'missing-reference-competes-with-known-payments', input: () => {
    const data = pair(); data.transactions.push(payment('', {id: 'unknown', bank_reference: 'BANK-UNKNOWN'})); return data;
  }, expected: []},
  {id: 'unverified-alternative-cannot-disambiguate', input: () => {
    const data = pair(); data.transactions[1].verified = false; return data;
  }, expected: []},
  {id: 'partial-alternative-cannot-disambiguate', input: () => {
    const data = pair(); data.transactions[1].amount_cents = data.transactions[1].available_cents = 25000; return data;
  }, expected: []},
  {id: 'excess-alternative-cannot-disambiguate', input: () => {
    const data = pair(); data.transactions[1].amount_cents = data.transactions[1].available_cents = 70000; return data;
  }, expected: []},
  {id: 'conflicting-bank-references-remain-review', input: () => {
    const data = pair(); data.transactions[1].reference_evidence = {candidates: [
      {value: '0577', rawValue: '0577', kind: 'structured', source: '$.reference_number', validity: 'unchecked'},
      {value: '0597', rawValue: '0597', kind: 'invoice', source: '$.invoice_number', validity: 'unchecked'},
    ]}; return data;
  }, expected: []},
  {id: 'invoice-derived-fallback-cannot-replace-bank-reference', input: () => {
    const data = single(); data.transactions[0].reference_evidence = {candidates: [
      {value: '0577', rawValue: '0577', kind: 'structured', source: '$.reference_number', validity: 'unchecked'},
    ]}; return data;
  }, expected: []},
  {id: 'aggregate-never-pays-individual-invoice', input: () => {
    const data = single(); data.transactions[0].is_aggregate = true; return data;
  }, expected: []},
  {id: 'incomplete-bankgiro-group-remains-held', input: () => {
    const data = single(); data.transactions[0].parent_bank_reference = 'BANK-PARENT';
    data.transactions.push(payment('', {id: 'parent', bank_reference: 'BANK-PARENT', is_aggregate: true, amount_cents: 100000, available_cents: 100000})); return data;
  }, expected: []},
  {id: 'same-payment-bank-id-is-not-two-receipts', input: () => {
    const data = pair(); data.transactions[1].bank_reference = data.transactions[0].bank_reference; return data;
  }, expected: []},
  {id: 'closed-reference-owner-cannot-be-bypassed', input: () => {
    const data = single(); data.invoices.push(invoice('closed', {invoice_number: '0599', reference: '0599', remaining_cents: 0})); return data;
  }, expected: []},
  {id: 'wrong-currency', input: () => {
    const data = single(); data.transactions[0].currency = 'EUR'; return data;
  }, expected: []},
  {id: 'payment-before-issue', input: () => {
    const data = single(); data.transactions[0].booked_at = '2026-09-30'; return data;
  }, expected: []},
  {id: 'refund-does-not-pay-receivable', input: () => {
    const data = single(); data.transactions[0].amount_cents = -62500; return data;
  }, expected: []},
  {id: 'conflicting-payer-organization', input: () => {
    const data = single(); data.invoices[0].organization_number = '5560000001'; data.transactions[0].payer_organization_number = '5560000002'; return data;
  }, expected: []},
];

export const safeAllocations = findings => findings.filter(f => f.safe).map(f => [f.invoice_id, f.transaction_id, f.amount_cents]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);

export function reconciliationDecisionContracts(test, analyze) {
  for (const scenario of reconciliationDecisionCases) test('decision corpus: ' + scenario.id, () => {
    const data = scenario.input(), before = structuredClone(data);
    assert.deepEqual(safeAllocations(analyze(data)), scenario.expected);
    assert.deepEqual(data, before, 'analysis cannot alter bank or invoice facts');
  });
  test('finding order is deterministic across invoice and payment arrival order', () => {
    const data = pair(), expected = analyze(data);
    assert.deepEqual(analyze({...data, invoices: [...data.invoices].reverse()}), expected);
    assert.deepEqual(analyze({...data, transactions: [...data.transactions].reverse()}), expected);
    assert.deepEqual(analyze({...data, invoices: [...data.invoices].reverse(), transactions: [...data.transactions].reverse()}), expected);
  });
  test('cross-candidates retain the reference conflict explanation', () => {
    const findings = analyze(pair());
    const cross = findings.filter(f => !f.safe && f.kind === 'reference_conflict');
    assert.equal(cross.length, 2); assert.ok(cross.every(f => /referens/i.test(f.reason)));
  });
  test('an unresolved competing payment preserves every earlier evidence hold', () => {
    const data = pair(); data.transactions[1].source_review_issue = data.transactions[1].review_reason = 'Synthetic source authorization is revoked';
    const findings = analyze(data);
    assert.deepEqual(safeAllocations(findings), []);
    assert.ok(findings.filter(f => f.transaction_id === 'pay-0577').every(f => f.reason === 'Synthetic source authorization is revoked'));
  });
  test('unverified exact duplicates keep a cautious duplicate classification and the missing-original reason', () => {
    const data = single(); data.transactions[0].verified = false;
    data.transactions.push(payment('0599', {id: 'second', bank_reference: 'BANK-SECOND', verified: false}));
    const findings = analyze(data);
    assert.deepEqual(safeAllocations(findings), []);
    assert.equal(findings.length, 2);
    assert.ok(findings.every(f => f.kind === 'possible_duplicate' && /original/i.test(f.reason)));
    assert.deepEqual(findings.map(f => f.competing_transaction_ids), [['second'], ['pay-0599']]);
  });
}
