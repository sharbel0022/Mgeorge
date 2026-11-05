import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { directoryFixture, snapshotFixture, fixtureNow } from './helpers/saas-onboarding-fixture.mjs';

function compiled(path, imports = {}) {
  let source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  for (const [name, target] of Object.entries({ react: import.meta.resolve('react'), 'react/jsx-runtime': import.meta.resolve('react/jsx-runtime'), ...imports })) {
    for (const quote of ['"', "'"]) source = source.replaceAll(quote + name + quote, JSON.stringify(target));
  }
  return 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
}
const contract = compiled('../lib/onboarding/contract.ts');
const ui = await import(compiled('../components/onboarding/bank-onboarding-views.tsx', { '@/lib/onboarding/contract': contract }));
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
const noop = () => { throw Error('Rendering must remain pure'); };

test('company picker has a native label, actual organizations and accurate roles', () => {
  const companies = directoryFixture().companies.concat({ id: 'viewer', name: 'Läsföretag AB', organizationNumber: '559900-0003', role: 'viewer' });
  const html = render(ui.CompanyPicker, { companies, value: 'viewer', onChange: noop, onCreate: noop, canCreate: true });
  assert.match(html, /<label[^>]*for="[^"]+"[^>]*>Välj företag<\/label>/);
  assert.match(html, /<select/); assert.match(html, /559900-0003/); assert.match(html, /Läsbehörighet/);
  assert.match(html, /Lägg till företag/); assert.match(html, /Ägare/); assert.match(html, /Administratör/);
  const restricted = render(ui.CompanyPicker, { companies: [], value: '', onChange: noop, onCreate: noop, canCreate: false });
  assert.doesNotMatch(restricted, /<button/); assert.match(restricted, /Inga företag/);
});

test('progress names the current step without representing later steps as complete', () => {
  const html = render(ui.OnboardingSteps, { step: 3 });
  assert.equal((html.match(/aria-current="step"/g) || []).length, 1);
  assert.match(html, /<ol/); assert.match(html, /Bankens identifiering/); assert.doesNotMatch(html, /<h1/);
});

test('unavailable bank is disabled and explains the bank-provided reason and alternative', () => {
  const bank = { ...snapshotFixture().banks[0], available: false, unavailableReason: 'separate_agreement', authorization: 'separate' };
  const html = render(ui.BankChooser, { banks: [bank], value: '', onChange: noop, disabled: false });
  assert.match(html, /name="bank-choice"/); assert.match(html, /type="radio"[^>]*disabled=""/);
  assert.match(html, /Exempelbanken/); assert.match(html, /företagsavtal krävs/); assert.match(html, /Kontakta banken/);
});

test('required read permissions are visibly locked and optional known scopes remain choices', () => {
  const bank = { ...snapshotFixture().banks[0], supportedPermissions: ['accounts:read', 'transactions:read', 'bankgiro:read'], requiredPermissions: ['accounts:read'] };
  const html = render(ui.PermissionsChooser, { bank, values: [], onChange: noop, disabled: false });
  assert.match(html, /type="checkbox"[^>]*disabled=""[^>]*checked=""/);
  assert.match(html, /Obligatorisk/); assert.match(html, /Kontodata/); assert.match(html, /Bankgiroinformation/);
  assert.match(html, /separat avtal/); assert.match(html, /90 dagar/); assert.match(html, /faktiska giltighet/);
  const unknown = render(ui.PermissionsChooser, { bank: { ...bank, maximumConsentSeconds: null, bankgiro: 'unknown' }, values: [], onChange: noop, disabled: true });
  assert.match(unknown, /Inte bekräftat/); assert.doesNotMatch(unknown, /90 dagar/);
  const unsupported = render(ui.PermissionsChooser, { bank: { ...bank, bankgiro: 'unsupported' }, values: [], onChange: noop, disabled: false });
  assert.match(unsupported, /stöds inte/);
});

test('summary distinguishes consent activity, expiry and remotely unconfirmed revocation', () => {
  const snapshot = snapshotFixture();
  const before = JSON.stringify(snapshot);
  const active = render(ui.ConnectionSummary, { snapshot, now: fixtureNow });
  assert.match(active, /Aktivt medgivande/); assert.match(active, /Kontodata/); assert.match(active, /Bankgiroinformation/);
  assert.match(active, /Senast lyckade hämtning/); assert.match(active, /Nästa möjliga hämtning/);
  assert.doesNotMatch(active, /var sjätte timme|var 6|garanterat|schemalagd/);
  assert.equal(JSON.stringify(snapshot), before);
  const expired = render(ui.ConnectionSummary, { snapshot, now: fixtureNow + 172800000 });
  assert.match(expired, /Medgivandet har gått ut/); assert.doesNotMatch(expired, /Aktivt medgivande/);
  snapshot.connection.status = 'revoked'; snapshot.connection.revocationStatus = 'unknown';
  const revoked = render(ui.ConnectionSummary, { snapshot, now: fixtureNow });
  assert.match(revoked, /återkallelse.*inte bekräftad/i); assert.doesNotMatch(revoked, /Banken har bekräftat återkallelsen/);
  snapshot.connection.revocationStatus = 'confirmed';
  assert.match(render(ui.ConnectionSummary, { snapshot, now: fixtureNow }), /Banken har bekräftat återkallelsen/);
});

test('unknown bankgiro availability and missing sync times never become enabled service or schedule', () => {
  const snapshot = snapshotFixture(); snapshot.connection = null;
  snapshot.sync = { ...snapshot.sync, state: 'never', automaticEnabled: false, lastSuccessAt: null, nextAllowedAt: null };
  snapshot.bankgiro = { state: 'available', lastSuccessAt: null, nextAllowedAt: null, validUntil: new Date(fixtureNow - 1000).toISOString() };
  const html = render(ui.ConnectionSummary, { snapshot, now: fixtureNow });
  assert.match(html, /Inget bekräftat medgivande/); assert.match(html, /Ingen lyckad hämtning/); assert.match(html, /Ingen tid bekräftad/);
  assert.doesNotMatch(html, /Aktiv Bankgiroinformation/);
  snapshot.environment = 'sandbox';
  assert.match(render(ui.ConnectionSummary, { snapshot, now: fixtureNow }), /Testläge/);
});

test('account selection uses masked account values and disables unsupported imports without balances', () => {
  const snapshot = snapshotFixture(); snapshot.accounts.push({ ...snapshot.accounts[0], id: 'unsupported', name: 'Spärrat konto', importable: false });
  const html = render(ui.AccountChooser, { snapshot, values: ['account-alpha'], onChange: noop, disabled: false });
  assert.match(html, /Företagskonto/); assert.match(html, /•••• 1234/); assert.match(html, /SEK/);
  assert.match(html, /type="checkbox"[^>]*checked=""/); assert.match(html, /type="checkbox"[^>]*disabled=""/);
  assert.match(html, /stöder inte import/); assert.doesNotMatch(html, /Saldo|0,00/);
  snapshot.accounts = [];
  assert.match(render(ui.AccountChooser, { snapshot, values: [], onChange: noop, disabled: false }), /Inga konton/);
});

test('payment reference preserves leading zeros and known type and source without invoice substitutes', () => {
  const snapshot = snapshotFixture(); snapshot.payments[0].invoice = { number: 'FAKE-999', customer: 'Falsk fakturakund' };
  const html = render(ui.PaymentOverview, { snapshot });
  assert.match(html, /<strong><code>0000599<\/code><\/strong>/); assert.match(html, /Betalningsreferens/); assert.match(html, /Bankkonto/);
  assert.match(html, /Betalare okänd/); assert.match(html, /Behöver granskas/); assert.match(html, /Bankgiro/);
  assert.match(html, /625,00/); assert.match(html, /<ul/); assert.match(html, /<dl/); assert.match(html, /<time/);
  assert.doesNotMatch(html, /FAKE-999|Falsk fakturakund|Verifierad<|<table|<h1/);
  snapshot.payments[0].reference = null;
  assert.match(render(ui.PaymentOverview, { snapshot }), /Referens saknas/);
});

test('verified payment requires an explicit evidence identifier and verified status', () => {
  const snapshot = snapshotFixture(); snapshot.payments[0].verification = { status: 'verified', evidenceId: null, reason: null };
  assert.doesNotMatch(render(ui.PaymentOverview, { snapshot }), />Verifierad</);
  snapshot.payments[0].verification.evidenceId = 'bank-evidence-123';
  assert.match(render(ui.PaymentOverview, { snapshot }), />Verifierad</);
  snapshot.payments[0].verification.status = 'review';
  assert.doesNotMatch(render(ui.PaymentOverview, { snapshot }), />Verifierad</);
});

test('pending first sync does not present a ready overview or invented totals; existing rows are historical', () => {
  const snapshot = snapshotFixture(); snapshot.sync.lastSuccessAt = null; snapshot.sync.state = 'queued';
  const html = render(ui.PaymentOverview, { snapshot });
  assert.match(html, /första lyckade hämtningen/); assert.match(html, /Tidigare hämtade betalningar/);
  assert.doesNotMatch(html, /Översikten är redo|0,00|Totalt/);
  snapshot.payments = [];
  const empty = render(ui.PaymentOverview, { snapshot });
  assert.doesNotMatch(empty, /Inga betalningar hittades/); assert.match(empty, /första lyckade hämtningen/);
  snapshot.sync.lastSuccessAt = new Date(fixtureNow).toISOString(); snapshot.sync.state = 'succeeded';
  assert.match(render(ui.PaymentOverview, { snapshot }), /Inga betalningar hittades/);
});

test('unknown consent duration and pending or failed consent stay unconfirmed', () => {
  const snapshot = snapshotFixture(); snapshot.connection.validUntil = null;
  assert.doesNotMatch(render(ui.ConnectionSummary, { snapshot, now: fixtureNow }), /Aktivt medgivande/);
  assert.match(render(ui.ConnectionSummary, { snapshot, now: fixtureNow }), /Giltighet inte bekräftad/);
  snapshot.connection.status = 'pending';
  assert.match(render(ui.ConnectionSummary, { snapshot, now: fixtureNow }), /Väntar på bankens bekräftelse/);
  snapshot.connection.status = 'error';
  assert.match(render(ui.ConnectionSummary, { snapshot, now: fixtureNow }), /Anslutningen behöver åtgärdas/);
  snapshot.connection.status = 'revoked'; snapshot.connection.revocationStatus = 'pending';
  const pending = render(ui.ConnectionSummary, { snapshot, now: fixtureNow });
  assert.match(pending, /återkallelse väntar på bekräftelse/); assert.doesNotMatch(pending, /Banken har bekräftat återkallelsen/);
});

test('Bankgiro availability requires a future validity and permissions explain included capability', () => {
  const snapshot = snapshotFixture(); snapshot.bankgiro.state = 'available';
  let html = render(ui.ConnectionSummary, { snapshot, now: fixtureNow });
  assert.doesNotMatch(html, />Aktiv Bankgiroinformation</);
  snapshot.bankgiro.validUntil = new Date(fixtureNow + 1000).toISOString();
  html = render(ui.ConnectionSummary, { snapshot, now: fixtureNow });
  assert.match(html, />Aktiv Bankgiroinformation</);
  const permissionHtml = render(ui.PermissionsChooser, { bank: { ...snapshot.banks[0], bankgiro: 'included', maximumConsentSeconds: null }, values: [], onChange: noop, disabled: false });
  assert.match(permissionHtml, /Bankgiroinformation erbjuds/); assert.match(permissionHtml, /Kontodata \(AIS\) ger inte i sig/);
  assert.doesNotMatch(permissionHtml, /maximal giltighet/);
});

test('OCR and invoice reference labels keep their distinct observed values and sources', () => {
  const snapshot = snapshotFixture(); snapshot.payments[0].reference = { value: '000018', kind: 'ocr', source: 'bankgiro_report' };
  let html = render(ui.PaymentOverview, { snapshot });
  assert.match(html, /Formell OCR/); assert.match(html, /<code>000018<\/code>/); assert.match(html, /Bankgirobetalningsspecifikation/);
  snapshot.payments[0].reference = { value: '0599', kind: 'invoice', source: 'bank_account' };
  snapshot.payments[0].payerName = '<script>Inläst betalare</script>';
  snapshot.payments[0].verification.reason = 'conflict';
  html = render(ui.PaymentOverview, { snapshot });
  assert.match(html, /Fakturareferens/); assert.doesNotMatch(html, /Formell OCR|<script>/);
  assert.match(html, /&lt;script&gt;Inläst betalare/); assert.match(html, /konflikt som behöver granskas/);
});

test('payment booking dates render a calendar date without an invented booking time', () => {
  const snapshot = snapshotFixture();
  const html = render(ui.PaymentOverview, { snapshot });
  const bookingDate = html.match(/<time dateTime="2026-11-03">([^<]*)<\/time>/)?.[1];
  assert.ok(bookingDate, 'the bank-provided calendar date remains the semantic datetime');
  assert.doesNotMatch(bookingDate, /\d{1,2}:\d{2}/, 'a date-only payment must not acquire a time of day');
  assert.equal(bookingDate, new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date('2026-11-03T00:00:00Z')));
});

test('payment amounts honor JPY zero digits and KWD three digits rather than assuming cents', () => {
  const snapshot = snapshotFixture();
  snapshot.payments[0].amountMinor = 125; snapshot.payments[0].currency = 'JPY';
  let html = render(ui.PaymentOverview, { snapshot });
  assert.match(html, /<dt>Belopp<\/dt><dd>125\s*JPY<\/dd>/);
  snapshot.payments[0].amountMinor = 1250; snapshot.payments[0].currency = 'KWD';
  html = render(ui.PaymentOverview, { snapshot });
  assert.match(html, /<dt>Belopp<\/dt><dd>1,250\s*KWD<\/dd>/);
});
