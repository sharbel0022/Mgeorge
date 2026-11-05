import { useId } from 'react';
import { activeConsent, dateLabel, permissionLabels, type Company, type Bank, type Permission, type Snapshot } from '@/lib/onboarding/contract';

const roleLabels: Record<Company['role'], string> = { owner: 'Ägare', admin: 'Administratör', accountant: 'Redovisning', viewer: 'Läsbehörighet' };
function Timestamp({ value, empty }: { value: string | null; empty: string }) {
  return value ? <time dateTime={value}>{dateLabel(value)}</time> : <span>{empty}</span>;
}
function BankgiroCapability({ capability }: { capability: Bank['bankgiro'] }) {
  const labels: Record<string, string> = {
    included: 'Bankgiroinformation erbjuds. Tillgänglighet och medgivande bekräftas separat i anslutningens status.',
    separate: 'Bankgiroinformation kräver ett separat avtal eller en separat anslutning.',
    unsupported: 'Bankgiroinformation stöds inte av den här anslutningen.',
    unknown: 'Inte bekräftat om Bankgiroinformation erbjuds. Fråga banken eller leverantören.',
  };
  return <p className="onboarding-muted">{labels[capability] ?? labels.unknown}</p>;
}

export function CompanyPicker({ companies, value, onChange, onCreate, canCreate }: { companies: Company[]; value: string; onChange: (id: string) => void; onCreate: () => void; canCreate: boolean }) {
  const id = useId();
  const chosen = companies.find(company => company.id === value);
  return <section className="onboarding-card onboarding-company-picker" aria-label="Företagsval">
    <div className="onboarding-field"><label className="onboarding-label" htmlFor={id}>Välj företag</label>
      <select id={id} value={value} onChange={event => onChange(event.target.value)} aria-describedby={id + '-details'} disabled={!companies.length}>
        {!value && <option value="">{companies.length ? 'Välj ett företag' : 'Inga företag att visa'}</option>}
        {companies.map(company => <option key={company.id} value={company.id}>{company.name} · {company.organizationNumber ?? 'Organisationsnummer ej verifierat'} · {roleLabels[company.role]}</option>)}
      </select>
      <p id={id + '-details'} className="onboarding-muted">{chosen ? <>{chosen.name} · {chosen.organizationNumber ? 'Organisationsnummer ' + chosen.organizationNumber : 'Organisationsnummer ej verifierat'} · {roleLabels[chosen.role]}</> : 'Bankanslutningen hör till företaget du väljer.'}</p>
    </div>
    {canCreate && <button type="button" onClick={onCreate}>Lägg till företag</button>}
  </section>;
}

export function OnboardingSteps({ step }: { step: number }) {
  const labels = ['Företag', 'Bank och behörigheter', 'Bankens identifiering', 'Välj konton', 'Betalningar'];
  return <nav aria-label="Steg för bankanslutning"><ol className="onboarding-steps">{labels.map((label, index) => <li key={label} aria-current={step === index + 1 ? 'step' : undefined}><span aria-hidden="true">{index + 1}. </span>{label}{index + 1 < step && <span className="onboarding-muted"> · Klart</span>}</li>)}</ol></nav>;
}

export function BankChooser({ banks, value, onChange, disabled }: { banks: Bank[]; value: string; onChange: (id: string) => void; disabled: boolean }) {
  const id = useId();
  return <fieldset className="onboarding-field" disabled={disabled} aria-describedby={id}>
    <legend>Välj bank</legend><p id={id} className="onboarding-muted">Bankens stöd för företagskonton och läsåtkomst avgör hur du kan ansluta.</p>
    {!banks.length && <p className="onboarding-notice">Inga banker är bekräftade för detta företag. Kontakta företagets administratör eller leverantören.</p>}
    <div className="onboarding-choices">{banks.map((bank, index) => {
      const unavailable = !bank.available || !['redirect', 'decoupled'].includes(bank.authorization);
      const descriptionId = id + '-' + index;
      const reasons: Record<string, string> = { unsupported_bank: 'Banken stöds inte av leverantören.', provider_unavailable: 'Bankleverantören är inte tillgänglig just nu.', separate_agreement: 'Ett separat företagsavtal krävs.', configuration_required: 'Bankanslutningen behöver konfigureras av administratören.' };
      return <div className="onboarding-choice" key={bank.id}>
        <label><input type="radio" name="bank-choice" value={bank.id} checked={value === bank.id} disabled={disabled || unavailable} onChange={() => onChange(bank.id)} aria-describedby={descriptionId}/><strong>{bank.name}</strong> <span className="onboarding-muted">{bank.country} · {bank.providerLabel}</span></label>
        <div id={descriptionId}>{unavailable ? <p className="onboarding-muted">{bank.unavailableReason ? reasons[bank.unavailableReason] ?? 'Digital anslutning är inte tillgänglig.' : 'Digital anslutning är inte tillgänglig.'} Kontakta banken om företagsavtal eller använd företagets tillåtna importflöde.</p> : <p className="onboarding-muted">Identifieringen sker i bankens egen tjänst.</p>}</div>
      </div>;
    })}</div>
  </fieldset>;
}

export function PermissionsChooser({ bank, values, onChange, disabled }: { bank: Bank; values: Permission[]; onChange: (values: Permission[]) => void; disabled: boolean }) {
  const id = useId();
  const known = (Object.keys(permissionLabels) as Permission[]).filter(permission => bank.supportedPermissions.includes(permission));
  function toggle(permission: Permission, checked: boolean) {
    const next = known.filter(item => bank.requiredPermissions.includes(item) || (item === permission ? checked : values.includes(item)));
    onChange(next);
  }
  const seconds = bank.maximumConsentSeconds;
  const maximum = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  return <div className="onboarding-section">
    <fieldset className="onboarding-field" disabled={disabled} aria-describedby={id}>
      <legend>Kontodata · läsbehörigheter</legend><p id={id} className="onboarding-muted">Du väljer vilka uppgifter banken får lämna. Obligatoriska läsbehörigheter krävs av banken och kan inte väljas bort här.</p>
      <div className="onboarding-choices">{known.map((permission, index) => {
        const required = bank.requiredPermissions.includes(permission), label = permissionLabels[permission], descriptionId = id + '-' + index;
        return <div className="onboarding-choice" key={permission}><label><input type="checkbox" value={permission} checked={required || values.includes(permission)} disabled={disabled || required} onChange={event => toggle(permission, event.target.checked)} aria-describedby={descriptionId}/><strong>{label.label}</strong>{required && <span className="onboarding-badge">Obligatorisk</span>}</label><p id={descriptionId} className="onboarding-muted">{label.description}{required && ' Krävs för den valda bankens läsanslutning.'}</p></div>;
      })}</div>
      {!known.length && <p className="onboarding-notice">Inga läsbehörigheter har bekräftats för banken.</p>}
    </fieldset>
    {maximum !== null && <p className="onboarding-muted">Dokumenterad maximal giltighet: {maximum % 86400 === 0 ? `${maximum / 86400} dagar` : `${maximum} sekunder`}. Bankens faktiska giltighet bekräftas när medgivandet är klart.</p>}
    <div className="onboarding-section"><h3>Bankgiroinformation</h3><BankgiroCapability capability={bank.bankgiro}/><p className="onboarding-muted">Kontodata (AIS) ger inte i sig tillgång till individuella Bankgirobetalningar eller betalningsspecifikationer.</p></div>
  </div>;
}

export function ConnectionSummary({ snapshot, now = Date.now() }: { snapshot: Snapshot; now?: number }) {
  const connection = snapshot.connection;
  const active = activeConsent(snapshot, now);
  const expiry = connection?.validUntil ? Date.parse(connection.validUntil) : NaN;
  const expired = connection?.status === 'expired' || connection?.status === 'active' && Number.isFinite(expiry) && expiry <= now;
  const status = active ? 'Aktivt medgivande' : expired ? 'Medgivandet har gått ut' : connection?.status === 'revoked' ? 'Anslutningen är frånkopplad' : connection?.status === 'pending' ? 'Väntar på bankens bekräftelse' : connection?.status === 'error' ? 'Anslutningen behöver åtgärdas' : 'Inget bekräftat medgivande';
  const revocation = connection?.revocationStatus;
  const bankgiroActive = snapshot.bankgiro.state === 'available' && !!snapshot.bankgiro.validUntil && Date.parse(snapshot.bankgiro.validUntil) > now;
  const bankgiroLabels: Record<string, string> = { separate_agreement: 'Separat avtal krävs', unsupported: 'Bankgiroinformation stöds inte', pending: 'Väntar på bekräftelse', error: 'Bankgiroinformationen behöver åtgärdas', unknown: 'Tillgänglighet inte bekräftad', unavailable: 'Bankgiroinformation är inte tillgänglig', expired: 'Bankgiroavtalet har gått ut' };
  return <section className="onboarding-card" aria-label="Aktuell bankstatus">
    <h2>Bankanslutningens status</h2>
    {snapshot.environment === 'sandbox' && <p className="onboarding-notice"><strong>Testläge · sandbox</strong> Anslutningen gäller en testmiljö och visar inte bekräftade produktionsuppgifter.</p>}
    <p><span className="onboarding-badge">{status}</span>{connection && <> · {connection.bankName}</>}</p>
    {connection?.status === 'revoked' && <p className="onboarding-muted">{revocation === 'confirmed' ? 'Banken har bekräftat återkallelsen.' : revocation === 'pending' ? 'Bankens återkallelse väntar på bekräftelse. Kontrollera även åtkomsten hos banken.' : 'Bankens återkallelse är inte bekräftad. Kontrollera åtkomsten hos banken.'}</p>}
    <div className="onboarding-grid">
      <section className="onboarding-section"><h3>Kontodata (AIS)</h3><dl className="onboarding-facts">
        <div><dt>Medgivande giltigt till</dt><dd><Timestamp value={connection?.validUntil ?? null} empty="Giltighet inte bekräftad"/></dd></div>
        <div><dt>Senast lyckade hämtning</dt><dd><Timestamp value={snapshot.sync.lastSuccessAt} empty="Ingen lyckad hämtning bekräftad"/></dd></div>
        <div><dt>Nästa möjliga hämtning</dt><dd><Timestamp value={snapshot.sync.nextAllowedAt} empty="Ingen tid bekräftad"/></dd></div>
        <div><dt>Automatisk hämtning</dt><dd>{snapshot.sync.automaticEnabled ? 'Aktiverad för företaget' : 'Inte aktiverad'}</dd></div>
        <div><dt>Hämtningsstatus</dt><dd>{({ never: 'Inte hämtat ännu', queued: 'Väntar på hämtning', running: 'Hämtning pågår', succeeded: 'Senaste hämtningen lyckades', failed: 'Hämtningen misslyckades', blocked: 'Hämtningen är blockerad' } as Record<string, string>)[snapshot.sync.state] ?? 'Status inte bekräftad'}</dd></div>
      </dl><p className="onboarding-muted">Nästa möjliga tid är en begränsning för nya hämtningar. Automatisk hämtning innebär inget löfte om en viss tid eller frekvens.</p></section>
      <section className="onboarding-section"><h3>Bankgiroinformation</h3><p>{bankgiroActive ? 'Aktiv Bankgiroinformation' : snapshot.bankgiro.state === 'available' ? 'Aktiv giltighet för Bankgiroinformation är inte bekräftad' : bankgiroLabels[snapshot.bankgiro.state] ?? 'Tillgänglighet inte bekräftad'}</p><dl className="onboarding-facts">
        <div><dt>Avtal giltigt till</dt><dd><Timestamp value={snapshot.bankgiro.validUntil} empty="Giltighet inte bekräftad"/></dd></div>
        <div><dt>Senast lyckade hämtning</dt><dd><Timestamp value={snapshot.bankgiro.lastSuccessAt} empty="Ingen lyckad hämtning bekräftad"/></dd></div>
        <div><dt>Nästa möjliga hämtning</dt><dd><Timestamp value={snapshot.bankgiro.nextAllowedAt} empty="Ingen tid bekräftad"/></dd></div>
      </dl><p className="onboarding-muted">Bankgiroinformation och betalningsspecifikationer har eget stöd och kan kräva ett separat avtal.</p></section>
    </div>
  </section>;
}

export function AccountChooser({ snapshot, values, onChange, disabled }: { snapshot: Snapshot; values: string[]; onChange: (values: string[]) => void; disabled: boolean }) {
  const id = useId();
  function toggle(accountId: string, checked: boolean) {
    onChange(snapshot.accounts.filter(account => account.importable && (account.id === accountId ? checked : values.includes(account.id))).map(account => account.id));
  }
  return <fieldset className="onboarding-field" disabled={disabled} aria-describedby={id}><legend>Välj konton att läsa in</legend><p id={id} className="onboarding-muted">Endast valda konton som stöder import används för hämtningen.</p>
    {!snapshot.accounts.length && <p className="onboarding-notice">Inga konton har bekräftats av banken ännu.</p>}
    <div className="onboarding-choices">{snapshot.accounts.map((account, index) => <div className="onboarding-choice" key={account.id}><label><input type="checkbox" value={account.id} checked={values.includes(account.id)} disabled={disabled || !account.importable} onChange={event => toggle(account.id, event.target.checked)} aria-describedby={id + '-' + index}/><strong>{account.name}</strong> <code>{account.maskedNumber}</code> <span>{account.currency}</span></label><p id={id + '-' + index} className="onboarding-muted">{account.importable ? 'Kan väljas för läsåtkomst.' : 'Banken stöder inte import från detta konto.'}</p></div>)}</div>
  </fieldset>;
}

const referenceKinds: Record<string, string> = { ocr: 'Formell OCR', payment: 'Betalningsreferens', invoice: 'Fakturareferens', message: 'Meddelande', reference: 'Referens', unknown: 'Referens av okänd typ' };
const referenceSources: Record<string, string> = { bank_account: 'Bankkonto (AIS)', bankgiro: 'Bankgiroinformation', bankgiro_report: 'Bankgirobetalningsspecifikation', bankgiro_specification: 'Bankgirospecifikation', payment_specification: 'Betalningsspecifikation', specification: 'Betalningsspecifikation', unknown: 'Källa inte bekräftad' };
const reviewReasons: Record<string, string> = { missing_bankgiro: 'Bankgiroinformation eller betalningsspecifikation saknas.', missing_reference: 'Betalningsreferens saknas.', missing_payer: 'Betalaruppgift saknas.', conflicting_reference: 'Referenserna behöver kontrolleras.', conflicting_references: 'Referenserna behöver kontrolleras.', invalid_ocr: 'OCR-underlaget behöver kontrolleras.', aggregate: 'Samlingsbetalningen behöver en betalningsspecifikation.', conflict: 'Underlaget innehåller en konflikt som behöver granskas.', pending_review: 'Underlaget väntar på granskning.', missing_evidence: 'Verifieringsunderlag saknas.', unmatched: 'Betalningen behöver granskas.', ambiguous: 'Flera möjliga kopplingar behöver granskas.' };
function amountLabel(amountMinor: number, currency: string) {
  try {
    const formatter = new Intl.NumberFormat('sv-SE', { style: 'currency', currency });
    const exponent = formatter.resolvedOptions().maximumFractionDigits;
    if (typeof exponent !== 'number') throw new Error('Valutaskala saknas');
    return formatter.format(amountMinor / 10 ** exponent);
  } catch { return `${amountMinor} ${currency} i minsta valutaenhet (valutaskala inte bekräftad)`; }
}
export function PaymentOverview({ snapshot }: { snapshot: Snapshot }) {
  const ready = !!snapshot.sync.lastSuccessAt;
  return <section className="onboarding-card" aria-label="Betalningsöversikt"><h2>Betalningsöversikt</h2>
    {snapshot.environment === 'sandbox' && <p className="onboarding-notice">Testläge · betalningarna hör till en sandboxmiljö.</p>}
    {!ready && <p className="onboarding-notice">Vi inväntar den första lyckade hämtningen innan betalningsöversikten kan bekräftas. {snapshot.sync.state === 'queued' || snapshot.sync.state === 'running' ? 'Hämtningen väntar eller pågår.' : 'Välj konton och begär en hämtning när anslutningen är klar.'}</p>}
    {ready && <p className="onboarding-muted">Senast lyckade hämtning: <Timestamp value={snapshot.sync.lastSuccessAt} empty="Inte bekräftad"/>. Uppgifterna nedan bedöms utifrån sitt eget underlag.</p>}
    {!snapshot.payments.length && ready && <p className="onboarding-notice">Inga betalningar hittades i det hämtade underlaget för de valda kontona.</p>}
    {!!snapshot.payments.length && <>{!ready && <h3>Tidigare hämtade betalningar</h3>}<ul className="onboarding-payment-list">{snapshot.payments.map(payment => {
      const verified = payment.verification.status === 'verified' && !!payment.verification.evidenceId;
      const reference = payment.reference;
      return <li className="onboarding-payment" key={payment.id}>
        <div><span className="onboarding-label">{reference ? referenceKinds[reference.kind] ?? 'Referens av okänd typ' : 'Referens'}</span>{reference ? <strong><code>{reference.value}</code></strong> : <strong>Referens saknas</strong>}</div>
        <dl className="onboarding-facts"><div><dt>Betalare</dt><dd>{payment.payerName || 'Betalare okänd'}</dd></div><div><dt>Belopp</dt><dd>{amountLabel(payment.amountMinor, payment.currency)}</dd></div><div><dt>Datum</dt><dd><time dateTime={payment.date}>{new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(payment.date))}</time></dd></div><div><dt>Referenskälla</dt><dd>{reference ? referenceSources[reference.source] ?? 'Källa inte bekräftad' : 'Källa saknas'}</dd></div><div><dt>Verifiering</dt><dd><span className="onboarding-badge">{verified ? 'Verifierad' : 'Behöver granskas'}</span></dd></div></dl>
        {!verified && <p className="onboarding-muted">{payment.verification.reason ? reviewReasons[payment.verification.reason] ?? 'Underlaget behöver granskas innan betalningen kan verifieras.' : 'Tillräckligt verifieringsunderlag är inte bekräftat.'}</p>}
      </li>;
    })}</ul></>}
    {snapshot.paymentsHasMore && <p className="onboarding-muted">Fler betalningar finns i underlaget. Den här översikten visar en del av dem.</p>}
  </section>;
}
