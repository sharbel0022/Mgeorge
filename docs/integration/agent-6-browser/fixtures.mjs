import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const repo = path.resolve(process.env.MGEORGE_QA_REPO || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'));
const moduleAt = p => import(pathToFileURL(path.join(repo, p)).href);
const { emptyState } = await moduleAt('sites/lib/domain.ts');
const { syntheticBankTransaction } = await moduleAt('sites/tests/helpers/bank-api-fixture.mjs');
const { paymentFieldInvoiceFixture } = await moduleAt('sites/tests/helpers/payment-field-source-fixture.mjs');

export const revision = 7;
export const ids = {
  reference: 'qa-payer-ref',
  missingAccount: 'qa-missing-account',
  multiple: 'qa-multiple-payers',
  missingBankgiro: 'qa-missing-bankgiro',
};

export function emptyFixture() {
  const state = emptyState();
  state.company = { name: 'Syntetiskt QA-bolag AB', email: 'qa@example.invalid' };
  return state;
}

function bank(id, amount, extra = {}) {
  return syntheticBankTransaction({
    id, amount, date: '2026-10-26', account: 'synthetic-owned-account',
    bankReference: 'SYNTHETIC-' + id, party: '', payerReference: '',
    description: 'Bankgiro inbetalning', kind: 'batch', verified: false,
    ...extra,
  });
}

function report(id, amount, party, reference, group, total, count, account = 'synthetic-owned-account') {
  const proof = { version: 'bank-file-original-v1', documentId: 'qa-' + group + '-original', sha256: 'a'.repeat(64) };
  const row = {
    id, date: '2026-10-26', amount, currency: 'SEK', party, payerReference: reference,
    bankReference: '', description: '', account, kind: 'payment', source: 'Bankgiro Excel · syntetisk QA',
    externalId: '', verified: false, evidence: 'bankgiro_file', duplicateOf: '', ignored: false,
    parentId: '', importId: 'qa-' + group + '-import', createdAt: '',
    specification: true, specificationStatus: 'review', specificationGroup: group,
    specificationCount: count, specificationTotal: total, bankFileProof: proof,
    reportEvidence: { paymentCount: String(count), totalCents: String(total), sequence: 'SYNTHETIC' },
    recipientAccount: account,
  };
  row.original = Object.fromEntries(['party','payerReference','description','amount','date','account','bankReference'].map(k => [k,row[k]]));
  return row;
}

export function paymentFixture() {
  const state = emptyFixture();
  const missingReport = report('qa-report-no-account', 88000, 'Syntetisk betalare Beta AB', '0599', 'missing-account', 88000, 1, '');
  const first = report('qa-report-multi-a', 62500, 'Syntetisk betalare Bravo AB', '0599', 'multiple-payers', 125000, 2);
  const second = report('qa-report-multi-b', 62500, 'Syntetisk betalare Charlie AB', '0088', 'multiple-payers', 125000, 2);
  state.transactions = [
    bank(ids.reference, 62500, { party: 'Syntetisk betalare Alfa AB', payerReference: '0599', description: 'Syntetisk betalning', kind: 'payment' }),
    bank(ids.missingAccount, 88000),
    missingReport,
    bank(ids.multiple, 125000),
    first, second,
    bank(ids.missingBankgiro, 99000, { account: '' }),
  ];
  for (const row of [missingReport, first]) {
    state.imports.push({ id: row.importId, hash: row.bankFileProof.sha256, documentId: row.bankFileProof.documentId, name: 'Synthetic-' + row.specificationGroup + '.xlsx', count: row.specificationCount, account: 'Bankgiro', createdAt: '' });
  }
  state.invoices = ['0599', '0088'].map((number, i) => ({
    id: 'qa-invoice-' + number, direction: 'receivable', number, party: 'Syntetisk fakturakund ' + (i + 1) + ' AB',
    organizationNumber: '', email: 'customer-' + (i + 1) + '@example.invalid', source: 'Syntetiskt QA-underlag',
    ocr: number, total: 62500, currency: 'SEK', issued: '2026-10-01',
    due: '2026-11-30', reviewed: true, voided: false, note: '', documentId: '',
  }));
  return state;
}

export function verification(transactionId, variant = 'ready', atRevision = revision) {
  const labels = ['Banktransaktion mottagen', 'Bankgirooriginal mottaget', 'Originalintegritet', 'Mottagarkonto', 'Samma insättning', 'Betalare', 'Betalningsreferens', 'Faktura', 'Kundrelation', 'Fakturabelopp och saldo', 'Avstämning'];
  const stepIds = ['received', 'report', 'original', 'account', 'deposit', 'payer', 'reference', 'invoice', 'customer', 'amount', 'reconciliation'];
  const multiple = transactionId === ids.multiple;
  const missingBankgiro = transactionId === ids.missingBankgiro;
  const checkAt = '2026-11-02T12:00:00.000Z';
  const steps = labels.map((label, index) => ({
    id: stepIds[index], label, status: 'review', statusLabel: 'Behöver granskas',
    source: 'Syntetiskt bevarat original', checkedAt: checkAt, rule: 'qa-read-only-v1',
    reason: 'Syntetiska bankuppgifter och fakturauppgifter granskas separat.',
    next: 'Granska bevarade original före ett separat beslut.',
    facts: index === 6 ? [{ label: 'Betalningsreferens', value: '0599' }, { label: 'OCR', value: 'Saknas i bankunderlaget' }] : [],
  }));
  steps[3] = { ...steps[3], status: 'blocked', statusLabel: 'Mottagarkontot saknas', reason: 'Mottagarkontot är inte verifierat i det syntetiska bankunderlaget.' };
  steps[4] = { ...steps[4], status: 'blocked', statusLabel: 'Insättningen inte verifierad', reason: 'Datum och belopp bevisar inte att detta är samma insättning.' };
  steps[10] = { ...steps[10], status: 'blocked', statusLabel: 'Ingen avstämning gjord', reason: 'Ingen allokering eller saldoförändring har gjorts.' };
  if (multiple) steps[5] = { ...steps[5], statusLabel: 'Flera betalare i rapporten', reason: 'Rapporten innehåller två betalare. Inget enskilt namn är verifierat som betalare för samlingsinsättningen.', facts: [{ label: 'Rapportens betalare 1', value: 'Syntetisk betalare Bravo AB' }, { label: 'Rapportens betalare 2', value: 'Syntetisk betalare Charlie AB' }] };
  if (missingBankgiro) steps[1] = { ...steps[1], status: 'missing', statusLabel: 'Bankgirodetaljer saknas', reason: 'Individuella betalningsspecifikationer saknas.' };
  const report = {
    transactionId, revision: atRevision, mode: 'preview', changed: false, checkedAt: checkAt,
    countedEconomically: !transactionId.startsWith('qa-report-'), automaticEligible: false,
    bookedAllocationCount: 0, invoiceHint: { number: '0599', proposal: true }, steps,
  };
  if (!missingBankgiro) report.accountEvidenceTarget = { transactionId, documentId: transactionId === ids.multiple ? 'qa-multiple-payers-original' : 'qa-missing-account-original' };
  if (variant === 'malformed') return { ...report, steps: { malformed: true } };
  if (variant === 'foreign') return { ...report, transactionId: 'qa-foreign-transaction' };
  return report;
}

export function overview(state = paymentFixture()) {
  const queue = [
    { id: 'qa-task-account', type: 'specification', entity_id: ids.missingAccount, transaction_id: ids.missingAccount, title: 'Saknat mottagarkonto', reason: 'Kontouppgifterna behöver granskas.', action: 'Granska betalning', priority: 1, amount_cents: 88000, date: '2026-10-26' },
    { id: 'qa-task-multiple', type: 'specification', entity_id: ids.multiple, transaction_id: ids.multiple, title: 'Flera betalare i samma rapport', reason: 'Två skilda betalare behöver granskas separat.', action: 'Granska betalning', priority: 2, amount_cents: 125000, date: '2026-10-26' },
    { id: 'qa-task-missing', type: 'specification', entity_id: ids.missingBankgiro, transaction_id: ids.missingBankgiro, title: 'Bankgirodetaljer saknas', reason: 'Individuellt underlag saknas.', action: 'Granska betalning', priority: 3, amount_cents: 99000, date: '2026-10-26' },
  ];
  return { run: null, counts: { review: state.transactions.length ? queue.length : 0, processing: 0 }, totals: {}, queue: state.transactions.length ? queue : [], connections: { gmail: { connected: false }, bank: { connected: false }, ocr: {} }, last_successful_control: null };
}

export function candidates() {
  return {
    [ids.missingAccount]: [{ documentId: 'qa-invoice-original', invoiceId: '', source: 'gmail', reason: 'Syntetiskt granskningsförslag', number: '0599', party: 'Syntetisk fakturakund AB', amount: 88000, issued: '2026-10-01', needsReview: true }],
    [ids.missingBankgiro]: [{ documentId: 'qa-invoice-original', invoiceId: '', source: 'gmail', reason: 'Syntetiskt granskningsförslag', number: '0599', party: 'Syntetisk fakturakund AB', amount: 99000, issued: '2026-10-01', needsReview: true }],
  };
}

export function manualLinkedFixture() {
  const fixture = paymentFieldInvoiceFixture();
  fixture.state.company = { name: 'Syntetiskt QA-bolag AB', email: 'qa@example.invalid' };
  const invoice = fixture.state.invoices.find(item => item.number === '0599');
  fixture.state.allocations.push({
    id: 'qa-historical-manual-allocation', transactionId: fixture.target.id, invoiceId: invoice.id,
    amount: 62500, effect: 'payment', active: true, note: 'Synthetic retained historical decision',
    createdAt: '2026-10-27T12:00:00.000Z',
  });
  return fixture;
}
