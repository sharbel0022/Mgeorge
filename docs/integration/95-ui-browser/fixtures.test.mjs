import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createSession, workspaceFixture, fixtureResponse, companyContext, scenarios, legacyBankStatusFixture } from './fixtures.mjs';
import { createCompanyClient } from '../../../sites/lib/company-client.js';
import { assertCompanyContext } from '../../../sites/lib/company-contract.js';
import { parseDirectory, parseSnapshot, parseAuthorization } from '../../../sites/lib/onboarding/contract.ts';
import { confirmedBankConsent } from '../../../sites/lib/banking/status-view.ts';
import { economySummary } from '../../../sites/lib/economy-summary.js';

const requireSites = createRequire(new URL('../../../sites/package.json', import.meta.url));
const ts = requireSites('typescript');
const presentationSource = await readFile(new URL('../../../sites/lib/payment-presentation.ts', import.meta.url), 'utf8');
let compiled = ts.transpileModule(presentationSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
for (const name of ['./domain', './reconciliation-engine.js', './payment-references.js']) {
  const replacement = new URL('../../../sites/lib/' + (name === './domain' ? 'domain.ts' : name.slice(2)), import.meta.url).href;
  for (const quote of ["'", '"']) compiled = compiled.replaceAll(quote + name + quote, JSON.stringify(replacement));
}
const { bankPaymentView } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const url = path => new URL(path, 'http://127.0.0.1:5195');

test('the standard fixture preserves leading zero references, original bank payer and unknown payer separately', () => {
  const session = createSession(), state = workspaceFixture(session);
  assert.equal(state.invoices.length, 7);
  assert.equal(state.invoices.filter(invoice => invoice.direction === 'payable').length, 2);
  const invoice = state.invoices.find(invoice => invoice.number === '0000599');
  assert.equal(invoice.ocr, '0000599');
  const transaction = state.transactions.find(item => item.id === 'qa-verified-bank-payer');
  const view = bankPaymentView(state, transaction);
  assert.equal(transaction.original.payerReference, '0000599');
  assert.equal(transaction.bankData.reference_number, '0000599');
  assert.equal(view.payer, 'Syntetisk Norrvik Studio AB');
  assert.equal(view.payerKnown, true);
  assert.equal(view.reference.value, '0000599');
  assert.equal(view.reference.kind, 'reference');
  assert.equal(view.reference.ocr, '');
  assert.equal(bankPaymentView(state, state.transactions.find(item => item.id === 'qa-missing-bankgiro')).payerKnown, false);
  assert.equal(state.allocations.length, 0, 'Evidence and suggestions do not book any allocation');
});

test('errors and pending state are distinct from successfully empty data, and retry is reproducible', () => {
  assert.deepEqual(fixtureResponse(createSession('loading'), 'GET', url('/api/state')), { pending: true });
  assert.equal(fixtureResponse(createSession('error'), 'GET', url('/api/state')).status, 503);
  const empty = fixtureResponse(createSession('empty'), 'GET', url('/api/state'));
  assert.equal(empty.status, 200); assert.equal(empty.body.state.invoices.length, 0); assert.equal(empty.body.state.transactions.length, 0);
  const missing = workspaceFixture(createSession('missing-bank'));
  assert.equal(missing.transactions.length, 0); assert.ok(missing.invoices.length);
  const transient = createSession('error-after-first-read');
  assert.deepEqual(Array.from({ length: 3 }, () => fixtureResponse(transient, 'GET', url('/api/state')).status), [200, 503, 200]);
  assert.equal(createSession('error-after-first-read').stateReads, 0);
});

test('the actual company client can initialize and select a different synthetic company', async () => {
  const session = createSession();
  const client = createCompanyClient({ baseUrl: 'http://127.0.0.1:5195/', fetch: async (input, init = {}) => {
    const result = fixtureResponse(session, init.method || 'GET', url(input), init.body ? JSON.parse(init.body) : {});
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json' } });
  } });
  await client.initialize();
  assert.equal(client.snapshot.status, 'ready'); assert.equal(client.snapshot.context.companyId, 'company-alpha');
  await client.switchCompany('company-beta');
  assert.equal(client.snapshot.context.companyId, 'company-beta'); assert.equal(client.snapshot.context.contextVersion, 2);
  assert.equal(workspaceFixture(session).company.name, 'Exempel Beta AB');
  assertCompanyContext(companyContext(session));
  client.dispose();
});

test('the actual onboarding contract accepts each synthetic company snapshot and pending handoff', () => {
  for (const scenario of Object.keys(scenarios)) {
    const session = createSession(scenario);
    if (scenario.startsWith('legacy-')) {
      assert.equal(fixtureResponse(session, 'GET', url('/api/companies')).body.legacy, true);
      assert.equal(fixtureResponse(session, 'GET', url('/api/onboarding/companies')).status, 404);
      continue;
    }
    parseDirectory(fixtureResponse(session, 'GET', url('/api/onboarding/companies')).body);
    const snapshot = parseSnapshot(fixtureResponse(session, 'GET', url('/api/companies/company-alpha/bank-onboarding')).body, session.companyId);
    assert.equal(snapshot.connection === null, ['missing-bank', 'onboarding'].includes(scenario));
    const result = fixtureResponse(session, 'POST', url('/api/companies/company-alpha/bank/connect'));
    const handoff = parseAuthorization(result.body, session.companyId);
    assert.match(handoff.authorization.redirectPath, /^\/api\/companies\/company-alpha\//);
  }
});

test('overview money comes from the actual read-only economy projection and all four summary cards have values', () => {
  const session = createSession(), before = workspaceFixture(session);
  const result = fixtureResponse(session, 'GET', url('/api/payment-control/overview')).body;
  assert.deepEqual(result.economy, economySummary(before, '2026-11-05'));
  assert.equal(result.economy.valid, true);
  assert.deepEqual([result.economy.received_month_cents, result.economy.remaining_cents, result.economy.payable_due_cents, result.counts.review], [0, 624500, 87500, 3]);
  assert.equal(result.economy.recent_payments.length, 0, 'No original evidence is promoted into a booked invoice payment');
  assert.deepEqual(workspaceFixture(session), before);
  const empty = fixtureResponse(createSession('empty'), 'GET', url('/api/payment-control/overview')).body;
  assert.equal(empty.economy.valid, true); assert.equal(empty.economy.remaining_cents, 0);
});

test('legacy consent fixtures distinguish confirmed, unknown and expired validity using the actual predicate', () => {
  const at = Date.parse('2026-11-05T12:00:00Z');
  for (const [scenario, confirmed] of [['legacy-connected', true], ['legacy-unknown-expiry', false], ['legacy-expired', false], ['legacy-disconnected', false]]) {
    const session = createSession(scenario), status = legacyBankStatusFixture(session, at);
    assert.equal(confirmedBankConsent(status, at), confirmed, scenario);
    if (scenario === 'legacy-unknown-expiry') assert.equal(status.connection.validUntil, '');
    if (scenario === 'legacy-disconnected') assert.equal(status.connection, null);
    const before = workspaceFixture(session);
    assert.equal(fixtureResponse(session, 'POST', url('/api/bank/auto-sync')).status, 200);
    assert.deepEqual(workspaceFixture(session), before);
    assert.equal(bankPaymentView(before, before.transactions.find(item => item.id === 'qa-missing-bankgiro')).payerKnown, false);
  }
});

test('all original payloads are rebuilt per read and unlisted/economic writes are rejected', () => {
  const session = createSession();
  const first = workspaceFixture(session); first.invoices[0].number = 'CHANGED';
  assert.notEqual(workspaceFixture(session).invoices[0].number, 'CHANGED');
  for (const [method, path] of [['POST', '/api/state'], ['POST', '/api/customer-messages/send'], ['GET', '/api/unknown'], ['GET', '/api/companies/company-beta/bank-onboarding']]) assert.ok(fixtureResponse(session, method, url(path)).status >= 400);
  const review = fixtureResponse(session, 'GET', url('/api/payment-control/overview')).body;
  assert.equal(review.queue.length, 3);
  for (const task of review.queue) {
    assert.ok(workspaceFixture(session).transactions.some(transaction => transaction.id === task.transaction_id));
    const report = fixtureResponse(session, 'GET', url('/api/bank/verification?transactionId=' + task.transaction_id)).body;
    assert.equal(report.changed, false); assert.equal(report.automaticEligible, false); assert.equal(report.bookedAllocationCount, 0);
  }
});
