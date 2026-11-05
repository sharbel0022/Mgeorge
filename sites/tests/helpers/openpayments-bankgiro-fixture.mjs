export const OPENPAYMENTS_IBAN = 'SE4550000000058398257466';

export function openPaymentsContext(overrides = {}) {
  return {
    owner: 'synthetic-owner', companyId: 'synthetic-company', sourceId: 'synthetic-source',
    scopeId: 'synthetic-scope', accountId: 'synthetic-account', iban: OPENPAYMENTS_IBAN,
    bankgiro: '1234567', reportId: 'synthetic-report', ...overrides,
  };
}

export function openPaymentsChild(overrides = {}) {
  return {
    transactionId: 'CHILD-1', entryReference: 'BANK-CHILD-1',
    aggregateTransactionId: 'PARENT-1', aggregateId: 1, aggregateAmount: '625.00',
    transactionAmount: { amount: '625.00', currency: 'SEK' }, bookingDate: '2026-10-26',
    debtorName: 'Synthetic customer AB', remittanceInformationStructured: '0599',
    creditorAccount: { iban: OPENPAYMENTS_IBAN, bankgiroNumber: '123-4567' },
    isAliasPayin: true, isEnriched: true, ...overrides,
  };
}

export function openPaymentsBooked(overrides = {}) {
  return {
    transactionId: 'PARENT-1', entryReference: 'BANK-PARENT-1',
    transactionAmount: { amount: '625.00', currency: 'SEK' }, bookingDate: '2026-10-26',
    ...overrides,
  };
}

export function openPaymentsPage({ children = [openPaymentsChild()], booked = [openPaymentsBooked()], account = { iban: OPENPAYMENTS_IBAN }, next, ...extra } = {}) {
  return {
    account,
    transactions: { booked, bankgiro: children, _links: next ? { next } : {} },
    ...extra,
  };
}
