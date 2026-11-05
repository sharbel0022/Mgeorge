// Fictional companies and banking data. Never used as a product fallback.
export const fixtureNow = Date.parse('2026-11-04T12:00:00.000Z');
export function directoryFixture() {
  return { version: 1, csrfToken: 'synthetic-csrf-token-0123456789', canCreate: true, companies: [
    { id: 'company-alpha', name: 'Exempel Alfa AB', organizationNumber: '559900-0001', role: 'owner' },
    { id: 'company-beta', name: 'Exempel Beta AB', organizationNumber: '559900-0002', role: 'admin' },
  ] };
}
export function snapshotFixture(companyId = 'company-alpha', at = fixtureNow) {
  return { version: 1, companyId, revision: 3, checkedAt: new Date(at).toISOString(), environment: 'production',
    actions: { connect: true, renew: true, disconnect: true, selectAccounts: true, sync: true },
    banks: [{ id: 'test-bank', name: 'Exempelbanken', country: 'SE', providerLabel: 'Testleverantör', available: true,
      authorization: 'redirect', supportedPermissions: ['accounts:read', 'transactions:read'], requiredPermissions: ['accounts:read', 'transactions:read'],
      maximumConsentSeconds: 7776000, bankgiro: 'separate', unavailableReason: null }],
    connection: { id: 'connection-alpha', companyId, bankId: 'test-bank', bankName: 'Exempelbanken', status: 'active',
      validUntil: new Date(at + 86400000).toISOString(), permissions: ['accounts:read', 'transactions:read'] },
    accounts: [{ id: 'account-alpha', companyId, name: 'Företagskonto', maskedNumber: '•••• 1234', currency: 'SEK', selected: true, importable: true }],
    sync: { state: 'succeeded', automaticEnabled: true, lastSuccessAt: new Date(at - 60000).toISOString(), nextAllowedAt: new Date(at + 21600000).toISOString(), errorCode: null },
    bankgiro: { state: 'separate_agreement', lastSuccessAt: null, nextAllowedAt: null, validUntil: null },
    authorization: null,
    payments: [{ id: 'payment-alpha', companyId, date: '2026-11-03', amountMinor: 62500, currency: 'SEK', payerName: null,
      reference: { value: '0000599', kind: 'payment', source: 'bank_account' }, verification: { status: 'review', evidenceId: null, reason: 'missing_bankgiro' } }],
    paymentsHasMore: false, manualImportPath: null,
  };
}
export function authorizationFixture(companyId = 'company-alpha', at = fixtureNow) {
  return { version: 1, companyId, authorization: { id: 'authorization-123', companyId, mode: 'redirect', state: 'pending',
    expiresAt: new Date(at + 600000).toISOString(), redirectPath: `/api/companies/${companyId}/bank/authorizations/authorization-123/redirect` } };
}
