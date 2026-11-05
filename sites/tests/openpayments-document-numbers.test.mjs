import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenPaymentsBankgiroCapture, readOpenPaymentsBankgiroCapture } from '../lib/bankgiro-openpayments-capture.js';
import { normalizeOpenPaymentsBankgiro } from '../lib/bankgiro-openpayments.js';
import { openPaymentsContext, openPaymentsChild, openPaymentsPage } from './helpers/openpayments-bankgiro-fixture.mjs';

const source = '$[0].transactions.bankgiro[0].remittanceInformationStructuredArray';
function captureDocuments(entries) {
  const context = openPaymentsContext();
  const original = openPaymentsPage({ children: [openPaymentsChild({
    remittanceInformationStructured: null,
    remittanceInformationStructuredArray: entries,
  })] });
  const body = JSON.stringify(original, null, 2);
  const capture = createOpenPaymentsBankgiroCapture({ context, captureId: 'synthetic-documents', pages: [{
    body: new TextEncoder().encode(body),
    requestPath: '/psd2/accountinformation/v1/accounts/synthetic-account/transactions?bookingStatus=booked',
    requestId: 'synthetic-request', receivedAt: '2026-10-27T12:00:00Z',
  }] });
  const restored = readOpenPaymentsBankgiroCapture(capture.bytes);
  assert.equal(restored.pages[0].body, body);
  assert.deepEqual(restored.normalization.rows[0].rawBankData, original.transactions.bankgiro[0]);
  return restored.normalization;
}

test('retained original bytes expose exact document numbers and their metadata separately from payment references', () => {
  const first = { typeCode: 'CINV', typeIssuer: 'Synthetic issuer', number: '0599', relatedDate: '2026-10-01' };
  const second = { typeProprietary: 'Synthetic document', number: '599' };
  const result = captureDocuments([{ referredDocumentInformation: first }, { referredDocumentInformation: second }]);
  const row = result.rows[0];
  assert.deepEqual(row.referenceEvidence.documentNumbers, [
    { kind: 'document', value: '0599', rawValue: '0599', source: source + '[0].referredDocumentInformation.number', documentSource: source + '[0].referredDocumentInformation', documentInformation: first },
    { kind: 'document', value: '599', rawValue: '599', source: source + '[1].referredDocumentInformation.number', documentSource: source + '[1].referredDocumentInformation', documentInformation: second },
  ]);
  assert.equal(row.payerReference, '');
  assert.equal(row.referenceEvidence.selected, null);
  assert.deepEqual(row.referenceEvidence.candidates, []);
  assert.equal(row.referenceEvidence.incomplete, true);
  assert.equal(result.coverage.status, 'partial');
  assert.equal(result.groups[0].complete, false);
  assert.ok(row.bankgiroEnrichmentIssue.includes('document_reference_requires_review'));
});

test('malformed document numbers are preserved in the original and held without coercion', () => {
  for (const number of [599, { value: '0599' }, ['0599'], '', ' 0599 ', '0'.repeat(301)]) {
    const result = captureDocuments([{ referredDocumentInformation: { number } }]);
    const row = result.rows[0];
    assert.equal(row.referenceEvidence.documentNumbers, undefined);
    assert.equal(row.payerReference, '');
    assert.equal(row.referenceEvidence.incomplete, true);
    assert.equal(result.coverage.status, 'partial');
    assert.ok(row.bankgiroEnrichmentIssue.includes('unsupported_structured_reference_object'));
  }
});

test('opaque creditor references, credit-note amounts and unknown document types retain review with document evidence', () => {
  for (const [entry, documentInformation] of [
    [{ referredDocumentInformation: { number: '0599' }, creditorReferenceInformation: { referenceTypeCode: 'SCOR', reference: { value: '00018' } } }, { number: '0599' }],
    [{ referredDocumentInformation: { typeCode: 'CREN', number: '0599' }, referredDocumentAmount: { creditNoteAmount: { amount: '625.00', currency: 'SEK' } } }, { typeCode: 'CREN', number: '0599' }],
    [{ referredDocumentInformation: { typeCode: 'UNRECOGNIZED', number: '0599' } }, { typeCode: 'UNRECOGNIZED', number: '0599' }],
    [{ referredDocumentInformation: { number: '0599', futureField: { reference: '00018' } } }, { number: '0599' }],
  ]) {
    const result = captureDocuments([entry]);
    const row = result.rows[0];
    assert.equal(row.referenceEvidence.documentNumbers[0].value, '0599');
    assert.deepEqual(row.referenceEvidence.documentNumbers[0].documentInformation, documentInformation);
    assert.equal(row.payerReference, '');
    assert.deepEqual(row.referenceEvidence.candidates, []);
    assert.equal(row.referenceEvidence.incomplete, true);
    assert.equal(result.coverage.status, 'partial');
    assert.equal(result.groups[0].complete, false);
  }
});

test('document metadata projects only bounded documented strings and keeps opaque information in the original', () => {
  const result = captureDocuments([{ referredDocumentInformation: {
    number: '0599', typeCode: 'UNRECOGNIZED',
    typeIssuer: { privateAccount: 'synthetic-private-account' },
    typeProprietary: 'x'.repeat(301), relatedDate: '2026-10-01\u0000',
    privateInformation: { account: 'synthetic-private-account', note: 'synthetic-private-note' },
  } }]);
  assert.deepEqual(result.rows[0].referenceEvidence.documentNumbers[0].documentInformation, { number: '0599', typeCode: 'UNRECOGNIZED' });
  assert.equal(JSON.stringify(result.rows[0].referenceEvidence.documentNumbers).includes('synthetic-private'), false);
  assert.equal(result.coverage.status, 'partial');
});

test('document evidence is bounded and excess original entries cannot become complete', () => {
  const result = captureDocuments(Array.from({ length: 41 }, (_, index) => ({ referredDocumentInformation: { number: '000' + index } })));
  assert.equal(result.rows[0].referenceEvidence.documentNumbers.length, 40);
  assert.equal(result.coverage.status, 'partial');
  assert.equal(result.rows[0].referenceEvidence.incomplete, true);
});

test('legacy scalar reference evidence keeps its exact retained shape without document metadata', () => {
  const result = normalizeOpenPaymentsBankgiro([openPaymentsPage()], openPaymentsContext());
  const candidate = { value: '0599', rawValue: '0599', source: '$[0].transactions.bankgiro[0].remittanceInformationStructured', kind: 'structured', priority: 90, validity: 'unchecked' };
  assert.deepEqual(result.rows[0].referenceEvidence, {
    version: 'payment-references-2026-11-01.1', candidates: [candidate], selected: candidate,
    incomplete: false, warnings: [],
  });
  assert.equal(result.coverage.status, 'available');
});
