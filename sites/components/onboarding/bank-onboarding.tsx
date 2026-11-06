'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { activeConsent, callbackMessage, freshSnapshot, parseAuthorization, parseCompany, parseDirectory, parseSnapshot, selectedPermissions, type Company, type Directory, type Permission, type Snapshot, type Authorization } from '@/lib/onboarding/contract';
import { createOnboardingClient, mutationAllowed, OnboardingError, type BankAction } from '@/lib/onboarding/client';
import { useCompanyWorkspace } from '@/components/company-workspace';
import { RequestScope } from '@/lib/onboarding/request-scope';
import { AccountChooser, BankChooser, CompanyPicker, ConnectionSummary, OnboardingSteps, PaymentOverview, PermissionsChooser } from './bank-onboarding-views';

const client = createOnboardingClient();
type Ticket = ReturnType<RequestScope['begin']>;
const safeError = (error: unknown) => error instanceof OnboardingError ? error : new OnboardingError('invalid');
const aborted = (error: unknown) => error instanceof Error && error.name === 'AbortError';

function updateCompanyLocation(id: string) {
  const url = new URL(window.location.href);
  for (const key of ['result', 'state', 'code', 'error', 'error_description']) url.searchParams.delete(key);
  url.searchParams.set('company', id);
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}

function CreateCompany({ csrfToken, onCreated, onCancel, onReload, onAccessLost }: { csrfToken: string; onCreated: (companyId: string) => void; onCancel: () => void; onReload: () => void; onAccessLost: (error: OnboardingError) => void }) {
  const id = useId(), scope = useRef(new RequestScope()), pending = useRef(false);
  const [name, setName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [uncertain, setUncertain] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); const current = scope.current; return () => current.invalidate(); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending.current || uncertain) return;
    if (name.trim().length < 2) { setError('Ange företagets namn.'); return; }
    const ticket = scope.current.begin('company-registration'); pending.current = true; setBusy(true); setError('');
    try {
      const value = await client.createCompany({ name: name.trim(), confirmEmptyCompany: true }, csrfToken, ticket.signal);
      if (!scope.current.current(ticket)) return;
      if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('company' in value)) throw new OnboardingError('invalid');
      const created = parseCompany(value.company);
      // Membership is fetched again before any company-specific data is read.
      onCreated(created.id);
    } catch (cause) {
      if (!scope.current.current(ticket) || aborted(cause)) return;
      const failure = safeError(cause);
      if (failure.kind === 'signin' || failure.kind === 'forbidden') onAccessLost(failure);
      else { setError('Registreringen kunde inte bekräftas. Läs in företagslistan innan du skickar en ny begäran.'); setUncertain(true); }
    } finally { if (scope.current.current(ticket)) { pending.current = false; setBusy(false); } }
  }
  return <section className="onboarding-card" aria-labelledby={id + '-title'}>
    <h2 ref={heading} tabIndex={-1} id={id + '-title'}>Lägg till företag</h2>
    <p className="onboarding-muted">Skapa en separat tom företagsarbetsyta. Organisationsnummer och rätt till bankåtkomst måste verifieras separat före bankanslutning. Befintliga uppgifter flyttas inte.</p>
    <form onSubmit={submit} aria-busy={busy}>
      <div className="onboarding-field"><label htmlFor={id + '-name'}>Företagsnamn</label><input id={id + '-name'} autoComplete="organization" value={name} maxLength={200} required onChange={event => setName(event.target.value)} disabled={busy}/></div>
      <div role="alert">{error && <div className="onboarding-error"><p>{error}</p>{uncertain && <button type="button" onClick={onReload}>Läs in företagslistan</button>}</div>}</div>
      <div className="onboarding-actions"><button className="onboarding-primary" disabled={busy || uncertain} type="submit">{busy ? 'Registrerar företag…' : 'Skapa företag'}</button><button type="button" onClick={busy || uncertain ? onReload : onCancel}>Avbryt</button></div>
    </form>
  </section>;
}

function DisconnectConfirmation({ company, bankName, busy, onCancel, onConfirm }: { company: Company; bankName: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null), title = useId();
  useEffect(() => {
    const element = dialog.current, opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal(); cancel.current?.focus();
    return () => { element?.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  return <dialog ref={dialog} className="onboarding-dialog" aria-labelledby={title} aria-describedby={title + '-body'} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const first = controls[0], last = controls.at(-1), active = document.activeElement;
    if (event.shiftKey && active === first && last) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last && first) { event.preventDefault(); first.focus(); }
  }} onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h2 id={title}>Koppla bort {bankName}?</h2><p id={title + '-body'}>Nya hämtningar för <strong>{company.name}</strong> stoppas. Tidigare hämtade uppgifter behålls. Du kan också återkalla åtkomsten hos banken; bankens bekräftelse visas i anslutningsstatusen.</p>
    <div className="onboarding-actions"><button ref={cancel} type="button" onClick={onCancel}>Behåll anslutningen</button><button type="button" className="onboarding-primary" disabled={busy} onClick={onConfirm}>{busy ? 'Kopplar bort…' : 'Ja, koppla bort banken'}</button></div>
  </dialog>;
}

function CompanyBankPanel({ company, csrfToken, callbackResult, onAccessLost }: { company: Company; csrfToken: string; callbackResult: string | null; onAccessLost: (error: OnboardingError) => void }) {
  const scope = useRef(new RequestScope()), pending = useRef(false), reading = useRef<Ticket | null>(null), revision = useRef(-1);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState<BankAction | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [bankId, setBankId] = useState(''), [permissions, setPermissions] = useState<Permission[]>([]);
  const [accountDraft, setAccountDraft] = useState<string[] | null>(null), [confirmDisconnect, setConfirmDisconnect] = useState(false), [handoff, setHandoff] = useState<Authorization | null>(null), [now, setNow] = useState(Date.now);
  const reportFailure = useCallback((cause: unknown) => {
    const failure = safeError(cause); setSnapshot(null); setHandoff(null); setAccountDraft(null); setConfirmDisconnect(false);
    if (failure.kind === 'signin' || failure.kind === 'forbidden') onAccessLost(failure); else setError(failure.message);
  }, [onAccessLost]);
  const read = useCallback(async (ticket: Ticket) => {
    const raw = await client.snapshot(company.id, ticket.signal);
    if (!scope.current.current(ticket)) return null;
    const next = parseSnapshot(raw, company.id);
    if (next.revision < revision.current) throw new OnboardingError('conflict');
    revision.current = next.revision; setSnapshot(next); setError(''); setNotice(''); setNow(Date.now());
    if (next.authorization?.state !== 'pending') setHandoff(null);
    return next;
  }, [company.id]);
  const load = useCallback(async () => {
    if (pending.current || reading.current) return;
    const ticket = scope.current.begin(company.id); reading.current = ticket; setLoading(true);
    try { await read(ticket); }
    catch (cause) { if (scope.current.current(ticket) && !aborted(cause)) reportFailure(cause); }
    finally { if (reading.current === ticket) reading.current = null; if (scope.current.current(ticket)) setLoading(false); }
  }, [company.id, read, reportFailure]);
  const currentAuthorization = handoff ?? snapshot?.authorization;
  const waiting = currentAuthorization?.state === 'pending' && Date.parse(currentAuthorization.expiresAt) > now;
  useEffect(() => { void load(); const current = scope.current; return () => { current.invalidate(); reading.current = null; }; }, [load]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    const timer = window.setInterval(refresh, waiting ? 5000 : 30000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); window.clearInterval(clock); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [load, waiting]);

  async function act(action: BankAction, body: Record<string, unknown>) {
    if (pending.current || !snapshot || !mutationAllowed(snapshot, company.role, action)) return;
    const ticket = scope.current.begin(company.id); reading.current = null; pending.current = true; setBusy(action); setLoading(false); setError(''); setNotice('');
    let navigating = false;
    try {
      const value = await client.mutate(company.id, action, { ...body, expectedRevision: snapshot.revision }, csrfToken, ticket.signal);
      if (!scope.current.current(ticket)) return;
      if (action === 'connect' || action === 'renew') {
        const response = parseAuthorization(value, company.id);
        if (response.authorization.mode === 'redirect') {
          // Only the exact company-bound server handoff path passes validation.
          // The provider integration performs and validates the external redirect.
          setHandoff(response.authorization);
          window.location.assign(response.authorization.redirectPath!); navigating = true; return;
        }
        setHandoff(response.authorization);
      } else {
        if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('companyId' in value) || value.companyId !== company.id || !('accepted' in value) || value.accepted !== true) throw new OnboardingError('invalid');
        setSnapshot(null); setAccountDraft(null); setConfirmDisconnect(false);
        const updated = await read(ticket);
        if (!updated || !scope.current.current(ticket)) return;
        if (action === 'accounts') {
          const selected = updated.accounts.filter(account => account.selected).map(account => account.id);
          if (!Array.isArray(body.accountIds) || selected.length !== body.accountIds.length || body.accountIds.some(id => !selected.includes(id))) throw new OnboardingError('conflict');
          setNotice('Kontovalet har bekräftats. Betalningsöversikten visas när den första hämtningen har lyckats.');
        }
        else if (action === 'sync') setNotice(updated.sync.state === 'succeeded' && updated.sync.lastSuccessAt ? 'Hämtningsstatus har uppdaterats.' : 'Begäran har tagits emot. Vi inväntar resultatet av hämtningen.');
        else setNotice('Begäran om frånkoppling har hanterats. Kontrollera medgivandets aktuella status nedan.');
      }
    } catch (cause) { if (scope.current.current(ticket) && !aborted(cause)) reportFailure(cause); }
    finally { if (scope.current.current(ticket) && !navigating) { pending.current = false; setBusy(null); } }
  }

  const fresh = snapshot && freshSnapshot(snapshot, now), data = fresh ? snapshot : null;
  const connected = !!data && activeConsent(data, now), bank = data?.banks.find(item => item.id === bankId);
  const accountIds = accountDraft ?? data?.accounts.filter(account => account.selected).map(account => account.id) ?? [];
  const locked = loading || !!busy || !['owner', 'admin'].includes(company.role) || !data;
  const pendingAuth = handoff ?? data?.authorization;
  const pendingAuthActive = pendingAuth?.state === 'pending' && Date.parse(pendingAuth.expiresAt) > now;
  const callbackNotice = callbackMessage(callbackResult, data, now);
  const authorizationNotice = pendingAuthActive ? 'Fortsätt enligt bankens anvisningar. Vi inväntar bankens bekräftelse.' : data?.authorization?.state === 'cancelled' ? 'Bankens identifiering avbröts. Du kan starta en ny anslutning.' : data?.authorization?.state === 'failed' ? 'Bankens identifiering misslyckades. Läs status och försök igen.' : data?.authorization?.state === 'completed' && connected ? 'Banken har bekräftat företagets anslutning.' : '';
  const syncing = data?.sync.state === 'queued' || data?.sync.state === 'running';
  const changedAccounts = !!data && (accountIds.length !== data.accounts.filter(account => account.selected).length || data.accounts.some(account => account.selected !== accountIds.includes(account.id)));
  const step = !data ? 2 : data.sync.lastSuccessAt && connected ? 5 : connected ? 4 : pendingAuthActive ? 3 : 2;
  function chooseBank(id: string) { setBankId(id); const found = data?.banks.find(item => item.id === id); setPermissions(found?.requiredPermissions ?? []); }

  return <div className="onboarding-company-content" aria-label={`Bankanslutning för ${company.name}`}>
    <OnboardingSteps step={step}/>
    <div className="onboarding-live" role="status" aria-live="polite">{notice || authorizationNotice || callbackNotice || (loading ? 'Läser företagets aktuella bankstatus…' : '')}</div>
    <div role="alert">{(error || snapshot && !fresh) && <div className="onboarding-error"><p>{error || 'Statusen har blivit för gammal. Läs in aktuell status för att fortsätta.'}</p><button type="button" onClick={() => void load()} disabled={loading}>Läs in aktuell status</button></div>}</div>
    {!data && !error && !snapshot && <div className="onboarding-card" aria-busy={loading}><p>{loading ? 'Hämtar bankanslutningen…' : 'Ingen bankstatus har kunnat bekräftas.'}</p></div>}
    {data && <>
      <ConnectionSummary snapshot={data} now={now}/>
      {data.sync.errorCode === 'configuration_required' && <p className="onboarding-notice" role="status">Bankanslutning är inte aktiverad för företaget. Leverantörens avtal, företagsbehörighet och bankens stödda identifiering måste vara verifierade innan anslutningen kan startas.</p>}
      {!['owner', 'admin'].includes(company.role) && <p className="onboarding-notice">Du har läsbehörighet. En företagsadministratör hanterar bankanslutningen.</p>}
      {(!connected || !data.connection) && <section className="onboarding-card" aria-labelledby="onboarding-bank-heading">
        <h2 id="onboarding-bank-heading">Anslut företagets bank</h2>
        <p className="onboarding-muted">Välj bank och läsbehörighet. Identifieringen sker hos banken. BankID används om banken erbjuder det.</p>
        <BankChooser banks={data.banks} value={bankId} onChange={chooseBank} disabled={locked || !!pendingAuthActive}/>
        {bank && <><PermissionsChooser bank={bank} values={permissions} onChange={setPermissions} disabled={locked || !!pendingAuthActive}/>
          {bank.available && ['redirect', 'decoupled'].includes(bank.authorization) ? <button type="button" className="onboarding-primary" disabled={locked || !data.actions.connect || !!pendingAuthActive || !!data.connection && data.connection.status !== 'revoked'} onClick={() => {
            try { const requested = selectedPermissions(bank, permissions); void act('connect', { bankId: bank.id, permissions: requested }); }
            catch { setError('Välj bankens obligatoriska läsbehörigheter för att fortsätta.'); }
          }}>{busy === 'connect' ? 'Startar bankens identifiering…' : 'Öppna bankens identifiering'}</button> : <p className="onboarding-notice">En enda digital anslutning är inte tillgänglig här. Kontakta banken om företagsavtal eller använd företagets tillåtna importflöde.</p>}
        </>}
        <p className="onboarding-muted">Mgeorge begär endast läsåtkomst. Du godkänner aldrig en betalning i den här guiden. BankID-koder och banklösenord fylls inte i här.</p>
      </section>}
      {pendingAuthActive && <section className="onboarding-card" aria-label="Väntar på banken"><h2>Fortsätt hos banken</h2><p>Vi väntar på bankens bekräftelse. Följ bankens anvisningar och avbryt där om du inte vill fortsätta.</p><p role="status">Medgivandet visas när det har verifierats.</p>{busy && pendingAuth?.mode === 'redirect' ? <a href={`/bank?company=${company.id}`}>Återgå och kontrollera status om banken inte öppnas</a> : <button type="button" disabled={loading || !!busy} onClick={() => void load()}>Kontrollera anslutningen</button>}</section>}
      {pendingAuth?.state === 'pending' && !pendingAuthActive && <p className="onboarding-notice" role="status">Tiden för bankens identifiering har gått ut. Starta en ny anslutning.</p>}
      {data.connection && <section className="onboarding-card" aria-labelledby="onboarding-accounts-heading">
        <h2 id="onboarding-accounts-heading">Konton för {company.name}</h2>
        <AccountChooser snapshot={data} values={accountIds} onChange={setAccountDraft} disabled={locked || !connected || !data.actions.selectAccounts}/>
        <div className="onboarding-actions">
          {changedAccounts && <button type="button" className="onboarding-primary" disabled={locked || !connected || !accountIds.length || !data.actions.selectAccounts || accountIds.some(id => !data.accounts.some(account => account.id === id && account.importable))} onClick={() => void act('accounts', { connectionId: data.connection!.id, accountIds })}>{busy === 'accounts' ? 'Sparar konton…' : 'Bekräfta valda konton'}</button>}
          {!changedAccounts && connected && data.accounts.some(account => account.selected) && <button type="button" className="onboarding-primary" disabled={locked || !mutationAllowed(data, company.role, 'sync', now)} onClick={() => void act('sync', { connectionId: data.connection!.id })}>{busy === 'sync' || syncing ? 'Hämtningen väntar eller pågår…' : data.sync.lastSuccessAt ? 'Uppdatera betalningsöversikten' : 'Hämta första betalningarna'}</button>}
        </div>
        {connected && data.accounts.some(account => account.selected) && !data.accounts.some(account => account.selected && account.importable) && <p className="onboarding-notice">Välj minst ett konto som stöder import innan du hämtar betalningar.</p>}
        <div className="onboarding-actions onboarding-secondary-actions">
          {data.connection.status !== 'revoked' && <button type="button" disabled={locked || !data.actions.renew || !!pendingAuthActive} onClick={() => void act('renew', { connectionId: data.connection!.id })}>{busy === 'renew' ? 'Startar förnyelse…' : 'Förnya anslutningen'}</button>}
          {data.connection.status !== 'revoked' && <button type="button" disabled={locked || !data.actions.disconnect} onClick={() => setConfirmDisconnect(true)}>Koppla bort banken</button>}
          <button type="button" disabled={loading || !!busy} onClick={() => void load()}>Läs in status</button>
        </div>
        <p className="onboarding-muted">Du kan återkalla läsåtkomsten med ”Koppla bort banken” eller i bankens egen tjänst. Sparade underlag behålls.</p>
      </section>}
      <PaymentOverview snapshot={data}/>
      {data.manualImportPath && <p className="onboarding-manual"><a href={data.manualImportPath}>Importera bankunderlag för {company.name}</a></p>}
      {confirmDisconnect && data.connection && <DisconnectConfirmation company={company} bankName={data.connection.bankName} busy={!!busy} onCancel={() => setConfirmDisconnect(false)} onConfirm={() => void act('disconnect', { connectionId: data.connection!.id })}/>}
    </>}
  </div>;
}

export default function BankOnboarding({ legacy }: { legacy?: ReactNode }) {
  const workspace = useCompanyWorkspace();
  const scope = useRef(new RequestScope()), acceptedSaas = useRef(false), selection = useRef(0);
  const [directory, setDirectory] = useState<Directory | null>(null), [mode, setMode] = useState<'loading' | 'legacy' | 'ready' | 'error' | 'signin'>('loading');
  const [companyId, setCompanyId] = useState(''), [creating, setCreating] = useState(false), [error, setError] = useState(''), [callbackResult, setCallbackResult] = useState<string | null>(null), [selectionKey, setSelectionKey] = useState(0);
  const pickerFocus = useRef<HTMLDivElement>(null);
  const accessLost = useCallback((failure: OnboardingError) => {
    scope.current.invalidate(); setDirectory(null); setCompanyId(''); setCreating(false); setCallbackResult(null); setMode(failure.kind === 'signin' ? 'signin' : 'error'); setError(failure.message);
  }, []);
  const load = useCallback(async (preferred?: string) => {
    const ticket = scope.current.begin('directory'); setMode('loading'); setDirectory(null); setCreating(false); setError('');
    try {
      const value = await client.directory(ticket.signal);
      if (!scope.current.current(ticket)) return;
      if (value === null) {
        if (acceptedSaas.current || new URLSearchParams(window.location.search).has('company')) throw new OnboardingError('unavailable');
        setMode('legacy'); return;
      }
      const parsed = parseDirectory(value); acceptedSaas.current = true;
      const params = new URLSearchParams(window.location.search), requested = preferred ?? params.get('company') ?? parsed.activeCompanyId;
      const chosen = requested ? parsed.companies.find(company => company.id === requested) : parsed.activeCompanyId === undefined ? parsed.companies[0] : undefined;
      if (chosen && workspace && chosen.id !== workspace.activeCompanyId) { await workspace.switchCompany(chosen.id); return; }
      setDirectory(parsed); setCompanyId(chosen?.id ?? ''); setSelectionKey(++selection.current); setMode('ready');
      setCallbackResult(!preferred && chosen ? params.get('result') : null);
      if (requested && !chosen) setError('Det valda företaget finns inte i din aktuella företagslista. Välj ett företag som du har åtkomst till.');
      if (preferred && chosen) updateCompanyLocation(chosen.id);
    } catch (cause) { if (scope.current.current(ticket) && !aborted(cause)) accessLost(safeError(cause)); }
  }, [accessLost, workspace]);
  useEffect(() => {
    void load(); const current = scope.current;
    const restore = (event: PageTransitionEvent) => { if (event.persisted) void load(); };
    window.addEventListener('pageshow', restore);
    return () => { current.invalidate(); window.removeEventListener('pageshow', restore); };
  }, [load]);
  function choose(id: string) {
    if (!directory?.companies.some(company => company.id === id)) return;
    if (workspace && id !== workspace.activeCompanyId) { setMode('loading'); setDirectory(null); setCompanyId(''); scope.current.invalidate(); void workspace.switchCompany(id); return; }
    setCompanyId(id); setCreating(false); setError(''); setCallbackResult(null); setSelectionKey(++selection.current); updateCompanyLocation(id);
  }
  function cancelCreate() { setCreating(false); window.requestAnimationFrame(() => pickerFocus.current?.querySelector<HTMLButtonElement>('button')?.focus()); }
  if (mode === 'legacy') return <><div className="onboarding-legacy-note" role="note"><strong>Din befintliga bankanslutning</strong><p>Företagsregistrering och växling mellan företag är ännu inte tillgängliga i den här installationen. Den befintliga arbetsytans bankanslutning visas nedan.</p><button type="button" onClick={() => void load()}>Kontrollera tillgänglighet igen</button></div>{legacy}</>;
  const company = directory?.companies.find(item => item.id === companyId);
  return <section className="onboarding-shell" aria-labelledby="onboarding-title">
    <a href="#onboarding-content" className="skip-link">Hoppa till bankanslutningen</a>
    <header className="onboarding-header"><span className="onboarding-eyebrow">MG FAKTURAKOLL</span><h1 id="onboarding-title">Ditt företag. Din bank. En översikt.</h1><p>Anslut företagets bank och se vilka betalningar som kan verifieras.</p><span className="onboarding-badge">Endast läsåtkomst</span></header>
    {mode === 'loading' && <div className="onboarding-card" role="status" aria-busy="true">Läser dina företag…</div>}
    {mode === 'signin' && <div className="onboarding-card"><h2>Logga in för att fortsätta</h2><p>Efter inloggning kan du skapa eller välja företag och ansluta dess bank.</p><a className="onboarding-primary" href="/signin-with-chatgpt?return_to=%2Fbank" target="_top">Logga in och fortsätt</a></div>}
    <div role="alert">{error && <div className="onboarding-error"><p>{error}</p>{mode === 'error' && <button type="button" onClick={() => void load()}>Läs in företagslistan igen</button>}</div>}</div>
    {mode === 'ready' && directory && <>
      <div ref={pickerFocus}><CompanyPicker companies={directory.companies} value={companyId} activeWorkspaceCompanyId={workspace?.activeCompanyId} onChange={choose} canCreate={directory.canCreate} onCreate={() => { setCreating(true); setCallbackResult(null); }}/></div>
      <div id="onboarding-content" tabIndex={-1}>
        {creating ? <><OnboardingSteps step={1}/><CreateCompany csrfToken={directory.csrfToken} onCreated={id => workspace ? window.location.replace('/bank?company=' + encodeURIComponent(id)) : void load(id)} onCancel={cancelCreate} onReload={() => void load()} onAccessLost={accessLost}/></> : company ? <CompanyBankPanel key={company.id + ':' + selectionKey} company={company} csrfToken={directory.csrfToken} callbackResult={callbackResult} onAccessLost={accessLost}/> : <div className="onboarding-card"><OnboardingSteps step={1}/><h2>{directory.companies.length ? 'Välj företag för att fortsätta' : 'Välkommen till Mgeorge'}</h2><p>{directory.companies.length ? 'Bankuppgifter visas först när ett företag har valts.' : directory.canCreate ? 'Lägg till ditt första företag för att komma igång.' : 'Du har inga företag att visa. Be företagets administratör om åtkomst.'}</p>{directory.canCreate && !directory.companies.length && <button type="button" className="onboarding-primary" onClick={() => setCreating(true)}>Lägg till ditt första företag</button>}</div>}
      </div>
      {directory.legacy && legacy && <section aria-label="Befintlig arbetsyta"><h2>Din befintliga bankanslutning</h2><p>Den här anslutningen hör till din ursprungliga arbetsyta. Ny företagsregistrering flyttar inga befintliga uppgifter.</p>{legacy}</section>}
    </>}
  </section>;
}
