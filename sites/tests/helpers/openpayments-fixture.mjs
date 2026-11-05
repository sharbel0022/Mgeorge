/** Synthetic fixtures following the official v1 examples, never live bank data. */
import { seal, unseal } from '../../lib/banking/security.ts';
export const NOW = Date.parse('2026-11-04T12:00:00Z');
export const CONFIG = { environment: 'SANDBOX', clientId: 'synthetic-application', clientSecret: 'synthetic-secret', credentialGeneration: 'g1', redirectUris: ['https://app.example.test/api/bank/openpayments/callback'] };
export const BINDING = { owner: 'owner-a', companyId: 'company-a', connectionId: 'connection-a', provider: 'open_payments', environment: 'SANDBOX', generation: 'g1' };
export const CONTEXT = { binding: BINDING, corporateId: 'synthetic-company-a', psuId: 'synthetic-psu-a', bicFi: 'OPBKSE21', psu: { ipAddress: '192.0.2.10', userAgent: 'Synthetic test client' } };
export const CONSENT_ID = '11111111-1111-4111-8111-111111111111';
export const AUTH_ID = '22222222-2222-4222-8222-222222222222';
export const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';
export const ACCOUNT = { resourceId: ACCOUNT_ID, iban: 'SE4550000000058398257466', bban: '58398257466', currency: 'SEK', name: 'Synthetic corporate account', usage: 'ORGA', bankgiroNumber: '1234-5678' };
export const TX = { transactionId: 'transaction-lookup-1', entryReference: 'bank-entry-1', transactionAmount: { amount: '625.00', currency: 'SEK' }, bookingDate: '2026-11-03', debtorName: 'Synthetic Payer AB', remittanceInformationStructured: '0599' };
export const json = (value, status = 200, headers = {}) => new Response(status === 204 ? null : JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
const key = 'A'.repeat(43);
export const codec = { seal: (owner, purpose, value) => seal(key, owner, purpose, value), unseal: (owner, purpose, value) => unseal(key, owner, purpose, value) };
export function fixtureTransport(overrides = {}) {
  const calls = [], usedStates = new Set();
  let current = true, tokenCount = 0;
  const transport = { kind: 'sandbox', async request(url, init) {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const key = `${init.method} ${path}`;
    if (overrides[key]) return overrides[key](url, init);
    if (path === '/connect/token') {
      tokenCount++;
      const form = new URLSearchParams(init.body);
      return json({ access_token: form.get('grant_type') === 'authorization_code' ? 'activation-only' : 'application-only', token_type: 'Bearer', expires_in: 3600, scope: form.get('scope') });
    }
    if (path === '/psd2/aspspinformation/v1/aspsps') return json({ aspsps: [{ bicFi: 'OPBKSE21', name: 'Synthetic Demo Bank', logoUrl: 'https://example.test/demo.png' }] });
    if (path === '/psd2/aspspinformation/v1/aspsps/OPBKSE21') return json({ bicFi: 'OPBKSE21', name: 'Synthetic Demo Bank', supportedAuthorizationMethods: [{ name: 'OAuth2', uri: 'https://oauth.sandbox.openbankingplatform.com/.well-known/openid-configuration' }, { name: 'Decoupled', uri: '' }], accountInformation: { transactionHistoryMaxDays: 90 }, paymentInitiation: { signingBasketsSupported: true } });
    if (path === '/psd2/consent/v1/consents' && init.method === 'POST') return json({ consentId: CONSENT_ID, consentStatus: 'received', _links: { self: { href: `/psd2/consent/v1/consents/${CONSENT_ID}` } } }, 201);
    if (path === `/psd2/consent/v1/consents/${CONSENT_ID}`) {
      if (init.method === 'DELETE') return json({}, 204);
      return json({ consentStatus: 'valid', validUntil: '2026-12-01', recurringIndicator: true, frequencyPerDay: 4, access: {} });
    }
    if (path.endsWith(`/${CONSENT_ID}/status`)) return json({ consentStatus: 'valid' });
    if (path.endsWith(`/${CONSENT_ID}/authorisations`) && init.method === 'POST') return json({ authorisationId: AUTH_ID, scaStatus: 'received', scaMethods: [{ authenticationMethodId: 'mbid', authenticationType: 'PUSH_OTP', name: 'Synthetic BankID' }] }, 201);
    if (path.endsWith(`/authorisations/${AUTH_ID}`)) return json({ scaStatus: init.method === 'GET' ? 'finalised' : 'started', chosenScaMethod: { authenticationMethodId: 'mbid', authenticationType: 'PUSH_OTP', name: 'Synthetic BankID' }, challengeData: { data: ['synthetic-autostart'] } }, 200, { 'aspsp-sca-approach': 'DECOUPLED' });
    if (path === '/psd2/accountinformation/v1/accounts') return json({ accounts: [structuredClone(ACCOUNT)] });
    if (path === `/psd2/accountinformation/v1/accounts/${ACCOUNT_ID}`) return json(structuredClone(ACCOUNT));
    if (path.endsWith(`/${ACCOUNT_ID}/transactions`)) return json({ account: { iban: ACCOUNT.iban }, transactions: { booked: [structuredClone(TX)], _links: {} } });
    throw Error(`Unexpected synthetic request: ${key}`);
  } };
  const dependencies = {
    codec,
    async assertCurrent(binding) { if (!current || binding.companyId !== 'company-a') throw Error('Synthetic revoked company membership'); },
    async consumeRedirectState({ binding, state, flowId }) { const id = JSON.stringify([binding.owner, binding.companyId, binding.connectionId, state, flowId]); if (usedStates.has(id)) return false; usedStates.add(id); return true; },
  };
  return { transport, calls, dependencies, revoke() { current = false; }, get tokenCount() { return tokenCount; } };
}
