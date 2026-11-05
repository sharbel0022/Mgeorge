import { paymentFixture, emptyFixture, overview, candidates, verification, revision } from '../agent-6-browser/fixtures.mjs';
import { directoryFixture, snapshotFixture, authorizationFixture } from '../../../sites/tests/helpers/saas-onboarding-fixture.mjs';
import { syntheticBankTransaction } from '../../../sites/tests/helpers/bank-api-fixture.mjs';
import { apiPayerEvidence } from '../../../sites/lib/payer-evidence.js';
import { economySummary } from '../../../sites/lib/economy-summary.js';

export const scenarios = Object.freeze({
  standard: 'Synthetic invoices, bank transactions and review evidence; two selectable companies.',
  loading: 'The company boundary resolves, but workspace state stays pending.',
  error: 'The workspace state endpoint returns a synthetic 503.',
  empty: 'Valid company with no invoices or bank transactions.',
  'missing-bank': 'Invoices remain available; no bank connection or imported bank transactions.',
  onboarding: 'Two companies and a disconnected bank onboarding flow.',
  'error-after-first-read': 'State read 1 succeeds, read 2 returns 503, subsequent retry succeeds.',
  'legacy-connected': 'The actual legacy BankConnection surface with fresh confirmed consent and a selected synthetic account.',
  'legacy-unknown-expiry': 'The actual legacy BankConnection surface with an unknown consent expiry; it cannot claim an active connection.',
  'legacy-expired': 'The actual legacy BankConnection surface with expired consent; renewal is required.',
  'legacy-disconnected': 'The actual legacy BankConnection surface with no connection and a synthetic bank chooser.',
});

export function createSession(scenario = 'standard') {
  if (!Object.hasOwn(scenarios, scenario)) throw new Error('Unknown synthetic scenario');
  return { scenario, companyId: 'company-alpha', contextVersion: 1, stateReads: 0, revision, selected: true, connected: !['missing-bank', 'onboarding', 'legacy-disconnected'].includes(scenario), automaticEnabled: false, dateFrom: '2026-10-07' };
}

export function companyContext(session) {
  return { version: 'company-context-v1', companyId: session.companyId, storageOwner: 'synthetic-owner-' + session.companyId,
    actorId: 'synthetic-actor', role: session.companyId === 'company-beta' ? 'admin' : 'owner', membershipVersion: 1, companyVersion: 1, contextVersion: session.contextVersion };
}

export function workspaceFixture(session) {
  const state = session.scenario === 'empty' ? emptyFixture() : paymentFixture();
  state.company.name = session.companyId === 'company-beta' ? 'Exempel Beta AB' : 'Exempel Alfa AB';
  if (session.scenario !== 'empty') {
    const invoice = state.invoices[0];
    state.invoices = [
      ...state.invoices,
      ...[
        ['0000599', 'receivable', 'Syntetisk Norrvik Studio AB', 124500, '2026-10-20', true],
        ['2026-1042', 'receivable', 'Syntetisk Viken Design AB', 375000, '2026-11-30', true],
        ['2026-1043', 'receivable', 'Syntetisk Berg & Co AB', 189000, '2026-10-30', false],
        ['L-2026-188', 'payable', 'Syntetisk Kontorsservice AB', 87500, '2026-11-12', true],
        ['L-2026-189', 'payable', 'Syntetisk Molntjänst AB', 24900, '2026-10-22', false],
      ].map(([number, direction, party, total, due, reviewed]) => ({ ...invoice, id: 'qa-invoice-' + number, number, ocr: number === '0000599' ? '0000599' : '', direction, party, total, due, reviewed })),
    ];
    const debtor = { name: 'Syntetisk Norrvik Studio AB', organisation_id: { identification: '559900-0099', scheme_name: 'COID', issuer: 'SE' } };
    state.transactions.unshift(syntheticBankTransaction({ id: 'qa-verified-bank-payer', date: '2026-11-03', amount: 124500,
      account: 'synthetic-owned-account', bankReference: 'SYNTHETIC-LEADING-ZERO-PAYMENT', party: debtor.name, payerReference: '0000599',
      description: 'Syntetisk individuell bankbetalning', kind: 'payment', verified: true, payerEvidence: apiPayerEvidence({ debtor }, true) }, { debtor }));
  }
  if (session.scenario === 'missing-bank') { state.transactions = []; state.imports = []; }
  return state;
}

const ok = body => ({ status: 200, body });
export function legacyBankStatusFixture(session, at = Date.now()) {
  const connection = session.connected ? { id: 'synthetic-legacy-connection', bankName: 'Exempelbanken', environment: 'PRODUCTION', status: 'connected',
    validUntil: session.scenario === 'legacy-unknown-expiry' ? '' : new Date(at + (session.scenario === 'legacy-expired' ? -60000 : 86400000)).toISOString(),
    lastSyncedAt: '2026-11-03T11:59:00.000Z', lastError: null, dateFrom: session.dateFrom,
    accounts: [{ uid: 'account-alpha', label: 'Företagskonto •••• 1234', currency: 'SEK', selected: session.selected, importable: true }],
    consent: { mode: 'company', corporateAuthorization: { status: 'verified' }, bankgiro: { status: 'missing' } },
  } : null;
  return { configured: true, storageReady: true, company: { id: session.companyId, name: workspaceFixture(session).company.name, canManageBank: true },
    consentFlow: null, application: { environment: 'PRODUCTION', active: true }, connection, lastRun: null,
    automatic: { enabled: session.automaticEnabled, blocked: false, intervalHours: 6, lastAttemptAt: null, nextAttemptAt: null },
    activation: { configured: true, message: 'Syntetisk isolerad bankanslutning.' } };
}

export function fixtureResponse(session, method, url, body = {}) {
  const pathname = url.pathname;
  if (method === 'GET' && pathname === '/api/companies') {
    if (session.scenario.startsWith('legacy-')) return ok({ version: 'company-context-v1', legacy: true, companies: [], activeCompanyId: null, contextVersion: session.contextVersion, context: null });
    return ok({ version: 'company-context-v1', companies: directoryFixture().companies.map(company => ({ ...company, membershipVersion: 1, companyVersion: 1 })),
      activeCompanyId: session.companyId, contextVersion: session.contextVersion, context: companyContext(session) });
  }
  if (method === 'POST' && pathname === '/api/companies/active') {
    if (!directoryFixture().companies.some(company => company.id === body.companyId) || body.contextVersion !== session.contextVersion) return { status: 409, body: { code: 'COMPANY_CONTEXT_STALE', error: 'Synthetic company context changed.' } };
    session.companyId = body.companyId; session.contextVersion++;
    return ok({ context: companyContext(session) });
  }
  if (method === 'GET' && pathname === '/api/onboarding/companies') {
    if (session.scenario.startsWith('legacy-')) return { status: 404, body: { code: 'SYNTHETIC_LEGACY_INSTALLATION', error: 'Synthetic installation deliberately uses the existing bank surface.' } };
    return ok({ ...directoryFixture(), activeCompanyId: session.companyId, contextVersion: session.contextVersion, legacy: false });
  }
  const companyRoute = pathname.match(/^\/api\/companies\/(company-alpha|company-beta)\/(.+)$/);
  if (companyRoute) {
    if (companyRoute[1] !== session.companyId) return { status: 409, body: { code: 'COMPANY_CONTEXT_STALE', error: 'Synthetic company mismatch.' } };
    const action = companyRoute[2];
    if (method === 'GET' && action === 'bank-onboarding') {
      const snapshot = snapshotFixture(session.companyId, Date.now());
      snapshot.revision = session.revision; snapshot.accounts[0].selected = session.selected;
      if (!session.connected) { snapshot.connection = null; snapshot.accounts = []; snapshot.payments = []; snapshot.sync = { state: 'never', automaticEnabled: false, lastSuccessAt: null, nextAllowedAt: null, errorCode: null }; }
      return ok(snapshot);
    }
    if (method === 'POST' && ['bank/connect', 'bank/renew'].includes(action)) return ok(authorizationFixture(session.companyId, Date.now()));
    if (method === 'POST' && action === 'bank/disconnect') { session.connected = false; session.revision++; return ok({ version: 1, companyId: session.companyId, revision: session.revision, accepted: true }); }
    if (method === 'POST' && action === 'bank/accounts') { session.selected = (body.accountIds || []).length > 0; session.revision++; return ok({ version: 1, companyId: session.companyId, revision: session.revision, accepted: true }); }
  }
  if (method === 'GET' && pathname === '/api/state') {
    session.stateReads++;
    if (session.scenario === 'loading') return { pending: true };
    if (session.scenario === 'error' || (session.scenario === 'error-after-first-read' && session.stateReads === 2)) return { status: 503, body: { error: 'Syntetiskt anslutningsfel. Försök igen.' } };
    return ok({ state: workspaceFixture(session), revision: session.revision, audit: [] });
  }
  if (method === 'GET' && pathname === '/api/payment-control/overview') {
    const state = workspaceFixture(session), result = overview(state);
    result.economy = economySummary(state, '2026-11-05');
    return ok(result);
  }
  if (method === 'GET' && pathname === '/api/bank/invoice-candidates') return ok({ candidates: candidates() });
  if (method === 'GET' && pathname === '/api/bank/verification') {
    const transactionId = url.searchParams.get('transactionId') || '';
    const transaction = workspaceFixture(session).transactions.find(item => item.id === transactionId);
    if (!transaction) return { status: 404, body: { error: 'Unknown synthetic bank transaction.' } };
    const report = verification(transactionId, 'ready', session.revision);
    if (transactionId === 'qa-verified-bank-payer') {
      report.invoiceHint = { number: '0000599', proposal: true };
      report.steps[5] = { ...report.steps[5], statusLabel: 'Bankens individuella betalare', reason: 'Det syntetiska bankoriginalet anger betalaren. Detta är ingen fakturaavstämning.', facts: [{ label: 'Betalare i bankoriginalet', value: transaction.original.party }] };
      report.steps[6].facts = [{ label: 'Betalningsreferens', value: '0000599' }, { label: 'OCR', value: 'Saknas i bankunderlaget' }];
      delete report.accountEvidenceTarget;
    }
    return ok(report);
  }
  if (method === 'GET' && pathname === '/api/bank/history') return ok({ entries: [], next: null });
  if (method === 'GET' && pathname === '/api/customer-messages/list') return ok({ items: [] });
  if (method === 'GET' && pathname === '/api/gmail/status') return ok({ connected: false, send_enabled: false, review: 0, processing: { pending: 0, error: 0 } });
  if (method === 'GET' && pathname === '/api/files') return { status: 404, body: { error: 'Syntetiskt original saknas avsiktligt; inget kundoriginal används.' } };
  if (method === 'GET' && pathname === '/api/bank/status') return ok(legacyBankStatusFixture(session));
  if (method === 'GET' && pathname === '/api/bank/banks') return ok({ banks: [{ name: 'Exempelbanken', country: 'SE' }] });
  if (method === 'POST' && pathname === '/api/bank/auto-sync') return ok({ skipped: true, reason: 'synthetic_read_only', imported: 0, message: 'Isolated fixture: no upstream bank request or financial change.' });
  if (method === 'POST' && pathname === '/api/bank/connect') return { status: 503, body: { error: 'Syntetiskt test: bankens externa identifiering öppnas inte av denna fixtureserver.' } };
  if (method === 'POST' && pathname === '/api/bank/accounts') {
    if (!Array.isArray(body.accountUids) || body.accountUids.some(id => id !== 'account-alpha') || typeof body.dateFrom !== 'string') return { status: 400, body: { error: 'Invalid synthetic account selection.' } };
    session.selected = body.accountUids.includes('account-alpha'); session.dateFrom = body.dateFrom; return ok({ accepted: true });
  }
  if (method === 'POST' && pathname === '/api/bank/automatic') { session.automaticEnabled = body.enabled === true; return ok({ accepted: true }); }
  if (method === 'POST' && pathname === '/api/bank/disconnect') { session.connected = false; return ok({ message: 'Den syntetiska anslutningen har kopplats från. Sparade underlag behålls.' }); }
  if (method === 'POST' && pathname === '/api/bank/sync') return ok({ message: 'Syntetisk kontroll klar. Inga bankanrop eller ekonomiska ändringar gjordes.', imported: 0, skipped: 0, warnings: [], test: true });
  if (method === 'GET' && pathname === '/api/bankgiro/source/status') return ok({ enabled: false, sourceId: null, mode: 'synthetic', state: 'DISABLED', reason: 'Synthetic fixture has no report agreement.', nextPollAt: null, missingReportIds: [], counts: { PENDING: 0, RETRY: 0, IMPORTED: 0, REVIEW: 0, DUPLICATE: 0, BLOCKED: 0 }, authorization: null, lastSuccessAt: null, lastFailureAt: null, lastFailureCode: null, jobs: [], lastError: null });
  return { status: 404, body: { error: 'Unlisted request rejected by the isolated synthetic UI harness.', code: 'SYNTHETIC_ROUTE_NOT_FOUND' } };
}
