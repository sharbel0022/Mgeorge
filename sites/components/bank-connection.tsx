"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { AlertCircle, ArrowRight, CheckCircle2, ChevronDown, FileText, Landmark, LogIn, RefreshCw, ShieldCheck, Unlink, Wallet } from "lucide-react";
import { confirmedBankConsent } from "@/lib/banking/status-view";
import { useBankRefresh } from './use-bank-refresh';
import SyncRecoveryNotice from './sync-recovery-notice';

type BankAccount = { uid: string; label: string; currency: string; selected: boolean; importable: boolean };
type BankConnection = { id: string; bankName: string; environment: "SANDBOX" | "PRODUCTION"; status: string; validUntil: string; lastSyncedAt: string | null; lastError: string | null; postprocessWarning?: string | null; metadataWarning?: string | null; accounts: BankAccount[]; dateFrom: string;
  consent?: { mode: 'company' | 'legacy'; corporateAuthorization: { status: string }; bankgiro: { status: string } } };
type BankStatus = {
  configured: boolean; storageReady: boolean;
  company?: { id: string; name: string; canManageBank: boolean };
  consentFlow?: { status: string; reason: string | null; expiresAt: string } | null;
  automatic?: { blocked?: boolean; failures?: number; enabled: boolean; intervalHours: number; lastAttemptAt: string | null; nextAttemptAt: string | null };
  activation?: { configured: boolean; message: string };
  callback?: { originMatches: boolean; canStartAuthorization: boolean; reason: string | null };
  application: null | { environment: "SANDBOX" | "PRODUCTION"; active: boolean };
  connection: BankConnection | null;
  lastRun: null | { createdAt: string; imported: number; skipped: number; warnings: string[]; test: boolean };
};
type SyncResult = { message: string; imported: number; skipped: number; warnings: string[]; test: boolean };
class BankApiError extends Error { constructor(message: string, readonly signIn?: string) { super(message); } }
async function bankRequest<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal });
  const payload: unknown = await response.json().catch(() => null);
  const data = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  if (response.status === 401) throw new BankApiError("Logga in med ChatGPT för att fortsätta.", "/signin-with-chatgpt?return_to=%2Fbank");
  if (!response.ok || !data || typeof data !== "object" || data.error) throw new BankApiError(typeof data?.error === "string" ? data.error : "Bankåtgärden kunde inte slutföras. Försök igen.");
  return data as T;
}
// Provider date filters are inclusive UTC dates; display timestamps stay Swedish.
function localDate(date = new Date()) { return date.toISOString().slice(0, 10); }
function initialDate() { const date = new Date(localDate() + "T12:00:00Z"); date.setUTCDate(date.getUTCDate() - 29); return date.toISOString().slice(0, 10); }
function dateLabel(value?: string | null, fallback = "Inte hämtat ännu") { return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : fallback; }
function followBankUrl(value: string) {
  const url = new URL(value);
  if (!["https://auth.enablebanking.com", "https://tilisy.enablebanking.com"].includes(url.origin) || url.pathname !== "/ais/start" || url.username || url.password || url.hash) throw new BankApiError("Bankens inloggningsadress kunde inte verifieras.");
  window.location.assign(url.href);
}
const resultMessages: Record<string, string> = {
  connected: "Banken har bekräftat medgivandet. Välj företagets konto och hämta bankhändelser.",
  select_account: "Banken har godkänt läsbehörigheten. Bekräfta vilket av företagets konton som ska anslutas.",
  corporate_authorization_required: "Bankens inloggning är klar, men kopplingen mellan kontot och företaget behöver verifieras innan anslutningen kan användas. Kontakta administratören.",
  cancelled: "Bankanslutningen avbröts. Du kan koppla igen när du vill.",
  denied: "Banken eller användaren godkände inte läsbehörigheten. Kontrollera företagets behörigheter hos banken och försök igen.",
  expired: "Anslutningsförsöket har gått ut. Börja med Koppla banken igen.",
  failed: "Bankanslutningen kunde inte slutföras. Kontrollera status och försök igen.",
  retry: "En annan bankåtgärd pågår. Vänta tills den är klar och kontrollera anslutningsstatus innan du försöker igen.",
  signin_required: "Logga in med det ChatGPT-konto som startade bankanslutningen.",
  wrong_user: "Använd samma ChatGPT-konto och webbläsare som när anslutningen startades.",
};

export default function BankConnection({ demo = false, onDataChanged }: { demo?: boolean; onDataChanged?: () => void }) {
  const [status, setStatus] = useState<BankStatus | null>(null), [loading, setLoading] = useState(!demo), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [signIn, setSignIn] = useState("");
  const [accountUids, setAccountUids] = useState<string[]>([]), [dateFrom, setDateFrom] = useState(initialDate), [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [bankOptions, setBankOptions] = useState<{ name: string; country: string }[]>([]), [bankName, setBankName] = useState('');
  const alive = useRef(true), operation = useRef(false), version = useRef(0), controller = useRef<AbortController | null>(null), demoMode = useRef(demo), formId = useId();
  const handleError = useCallback((cause: unknown) => {
    if (cause instanceof Error && cause.name === "AbortError") return;
    if (cause instanceof BankApiError && cause.signIn) { setStatus(null); setSignIn(cause.signIn); setError(""); return; }
    setError(cause instanceof Error ? cause.message : "Bankåtgärden kunde inte slutföras.");
  }, []);
  const loadStatus = useCallback(async () => {
    if (!alive.current || demoMode.current) return null;
    const current = ++version.current; controller.current?.abort(); const next = new AbortController(); controller.current = next; setLoading(true);
    try {
      const result = await bankRequest<BankStatus>("/api/bank/status", "GET", undefined, next.signal);
      if (!alive.current || demoMode.current || current !== version.current) return null;
      setStatus(result); setSignIn("");
      const eligible = result.connection?.accounts.filter(a => a.importable && a.currency === "SEK") || [], selected = eligible.filter(a => a.selected).map(a => a.uid);
      setAccountUids(selected.length ? selected : eligible.length === 1 ? [eligible[0].uid] : []);
      if (result.connection?.dateFrom) setDateFrom(result.connection.dateFrom);
      return result;
    } catch (cause) { if (alive.current && current === version.current && !demoMode.current) handleError(cause); return null; }
    finally { if (alive.current && current === version.current) setLoading(false); }
  }, [handleError]);
  useEffect(() => {
    let cancelled = false;
    alive.current = true; demoMode.current = demo;
    if (demo) { setStatus(null); setLoading(false); setSignIn(""); setError(""); setNotice(""); }
    else void (async () => {
      const result = new URLSearchParams(window.location.search).get("result");
      const verified = await loadStatus();
      if (cancelled || !alive.current || demoMode.current) return;
      if (result === "connected") {
        if (confirmedBankConsent(verified)) setNotice(resultMessages.connected);
      } else if (result === 'select_account') {
        if (verified?.connection?.status === 'pending_account') setNotice(resultMessages.select_account);
      } else if (result && resultMessages[result]) setNotice(resultMessages[result]);
    })();
    return () => { cancelled = true; alive.current = false; version.current++; controller.current?.abort(); };
  }, [demo, loadStatus]);
  const run = async (fn: () => Promise<void>) => {
    if (demoMode.current || operation.current || !alive.current) return;
    operation.current = true; version.current++; controller.current?.abort(); setLoading(false); setBusy(true); setError(""); setNotice("");
    try { await fn(); }
    catch (cause) { if (alive.current && !demoMode.current) { await loadStatus(); if (alive.current && !demoMode.current) handleError(cause); } }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  };
  const connection = status?.connection?.status === "disconnected" ? null : status?.connection;
  const connected = confirmedBankConsent(status);
  const readyForAccounts = connected || connection?.status === 'pending_account';
  const eligible = connection?.accounts.filter(a => a.importable && a.currency === "SEK") || [];
  const selected = eligible.filter(a => a.selected).map(a => a.uid);
  const configured = !!status?.configured && !!status.storageReady;
  const intervalHours = status?.automatic?.intervalHours;
  const automaticInterval = typeof intervalHours === 'number' && Number.isFinite(intervalHours) && intervalHours > 0
    ? (intervalHours === 1 ? 'en timmes' : new Intl.NumberFormat('sv-SE').format(intervalHours) + ' timmars') : null;
  const sandbox = (connection?.environment || status?.application?.environment) === "SANDBOX";
  const disabled = busy || loading;
  useBankRefresh(!demo && connected && selected.length > 0, busy || loading || accountUids.length !== selected.length || accountUids.some(id => !selected.includes(id)) || dateFrom !== connection?.dateFrom, () => { void loadStatus(); onDataChanged?.(); });
  async function loadBanks() {
    if (!alive.current || demoMode.current) return;
    const available = await bankRequest<{ banks: { name: string; country: string }[] }>("/api/bank/banks" + (status?.company ? '?companyId=' + encodeURIComponent(status.company.id) : ''));
    if (!alive.current || demoMode.current) return;
    if (!available.banks.length) throw new BankApiError('Ingen företagsbank är tillgänglig för den önskade läsanslutningen. Kontakta administratören.');
    setBankOptions(available.banks); setBankName(available.banks.length === 1 ? available.banks[0].name : '');
  }
  async function startConnection(renew = false) {
    if (!alive.current || demoMode.current) return;
    if(status?.callback?.originMatches===false)throw new BankApiError(status.callback.reason||'Bankens returadress behöver kontrolleras av administratören.');
    const selectedBank = renew ? connection?.bankName : bankName;
    if (!selectedBank || !status?.company?.canManageBank) throw new BankApiError('Välj företag och bank innan du begär läsbehörighet.');
    const result = await bankRequest<{ url: string }>("/api/bank/connect", "POST", { companyId: status.company.id,
      bankName: selectedBank, country: "SE", dateFrom: connection?.dateFrom || initialDate(), requiredScopes: ['accounts:read','transactions:read'],
      ...(renew && connection ? { renewConnectionId: connection.id } : {}) });
    if (alive.current && !demoMode.current) followBankUrl(result.url);
  }
  function synchronize(event: FormEvent) {
    event.preventDefault(); if (!readyForAccounts || !connection) return;
    void run(async () => {
      if (!accountUids.length) throw new BankApiError("Välj företagets konto först.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || dateFrom > localDate()) throw new BankApiError("Välj ett giltigt startdatum.");
      if (!connected || selected.length !== accountUids.length || accountUids.some(id => !selected.includes(id)) || dateFrom !== connection.dateFrom) await bankRequest("/api/bank/accounts", "POST", { companyId: status?.company?.id, connectionId: connection.id, accountUids, dateFrom });
      if (!alive.current || demoMode.current) return;
      const result = await bankRequest<SyncResult>("/api/bank/sync", "POST", { companyId: status?.company?.id });
      if (!alive.current || demoMode.current) return;
      setNotice(result.message); await loadStatus(); if (!result.test && alive.current && !demoMode.current) onDataChanged?.();
    });
  }
  const manualAlternative = <a className="btn bank-secondary" href="/?view=bank&import=1"><FileText size={18} />Importera bankfil istället<ArrowRight size={17} /></a>;
  return <section className="bank-connection" aria-labelledby={formId + "-title"} aria-busy={loading || busy}>
    <header className="bank-page-heading"><div className="bank-eyebrow">MG FAKTURAKOLL</div><h1 id={formId + "-title"}>Bankanslutning</h1><p>Företagets bankhändelser, samlade i fakturakollen.</p></header>
    {error && <div className="bank-message bank-message-error" role="alert"><AlertCircle size={19} /><p>{error}</p></div>}
    {notice && <div className="bank-message bank-message-success" role="status"><CheckCircle2 size={19} /><p>{notice}</p></div>}
    {demo ? <div className="bank-card bank-welcome"><h2>Bankkopplingen är avstängd i demo</h2><p>Avsluta demoläget för att ansluta företagets bank.</p></div> : signIn ? <div className="bank-card bank-welcome"><h2>Koppla företagets bank</h2><a className="btn primary bank-primary" href={signIn} target="_top"><LogIn size={18} />Logga in och fortsätt</a></div> : !status ? <div className="bank-card bank-welcome" role="status">{loading ? <><RefreshCw className="spin" /><p>Hämtar anslutningsstatus…</p></> : <button className="btn" onClick={() => void loadStatus()}>Försök igen</button>}</div> : <div className="bank-card bank-connected">
      <div className="bank-connected-heading"><span className="bank-hero-icon"><Landmark size={27} /></span><div><h2>{connection?.bankName || "Företagets bank"}</h2><p className="bank-connected-label">Status: {readyForAccounts ? selected.length ? "Ansluten" : "Bekräfta företagskonto" : connection?.status === "corporate_authorization_required" ? "Företagsbehörighet behöver verifieras" : connection?.status === "revocation_pending" ? "Frånkoppling väntar på bekräftelse" : connection ? "Behöver förnyas" : "Ej ansluten"}</p></div></div>
      {sandbox && <div className="bank-sandbox" role="note"><AlertCircle size={18} /><p>Testmiljö – testhändelser sparas inte i företagets fakturaregister.</p></div>}
      {!configured && <div className="bank-inline-error" role="status">Banktjänsten behöver aktiveras av systemadministratören.</div>}
      {status.callback?.reason && <p className="bank-inline-error" role="alert">{status.callback.reason}</p>}
      {connection?.metadataWarning && <p className="bank-inline-error" role="alert">{connection.metadataWarning}</p>}{connection?.postprocessWarning && <p className="bank-inline-error" role="alert">{connection.postprocessWarning}</p>}{connection?.lastError && <p className="bank-inline-error" role="alert">{connection.lastError}</p>}
      {connection?.status==='reauth_required'&&connection.consent?.mode==='legacy'&&status.company?.canManageBank&&Date.parse(connection.validUntil)>Date.now()&&<div className="bank-spaced"><button className="btn" disabled={disabled||!configured||status.automatic?.blocked} onClick={()=>void run(async()=>{const result=await bankRequest<{message:string}>('/api/bank/revalidate','POST',{companyId:status.company?.id});if(!alive.current||demoMode.current)return;setNotice(result.message);await loadStatus();})}>Kontrollera befintligt medgivande</button><p className="bank-help">Kontrollen frågar banken om de redan valda kontona fortfarande får läsas. Den ändrar inga fakturor eller betalningskopplingar.</p></div>}
      {status.company && <label className="bank-field" htmlFor={formId + '-company'}><span>Företag</span><select id={formId + '-company'} value={status.company.id} disabled><option value={status.company.id}>{status.company.name}</option></select></label>}
      {!connection && <div className="bank-spaced"><label className="bank-field" htmlFor={formId + '-bank'}><span>Bank med stöd för företagskonton</span><select id={formId + '-bank'} value={bankName} disabled={disabled || !bankOptions.length} onChange={event => setBankName(event.target.value)}><option value="">Välj bank</option>{bankOptions.map(bank => <option key={bank.country + ':' + bank.name} value={bank.name}>{bank.name}</option>)}</select></label><button className="btn" disabled={disabled || !configured} onClick={() => void run(loadBanks)}>Hämta bankalternativ</button><p className="bank-help">Läsbehörigheten gäller konton och bankhändelser. Bankgirodetaljer kräver separat behörighet.</p></div>}
      {connection?.status === 'corporate_authorization_required' && <p className="bank-inline-error" role="status">Bankens medgivande finns, men underlag som binder kontot till det valda företaget saknas. Ingen bankhämtning aktiveras. Kontakta administratören för verifiering.</p>}
      {connection?.status === 'revocation_pending' && <p className="bank-inline-error" role="status">Användningen av anslutningen är stoppad. Leverantören kunde inte bekräfta återkallelsen. Försök koppla från igen eller kontrollera medgivandet hos banken.</p>}
      {connection?.consent?.mode === 'legacy' && <p className="bank-help" role="status">Den äldre anslutningen saknar separat verifiering av företagsbehörighet. Förnya anslutningen för att genomföra den nya företagskontrollen.</p>}
      {status.consentFlow?.status === 'expired' && <p className="bank-help" role="status">Anslutningsförsöket löpte ut utan bekräftat slutresultat. Starta ett nytt försök.</p>}
      {!connection && <><button className="btn primary bank-primary" disabled={disabled || !configured || !bankName || !status.company?.canManageBank} onClick={() => void run(() => startConnection())}><Landmark size={18} />{busy ? "Öppnar banken…" : "Koppla banken"}<ArrowRight size={17} /></button><p className="bank-help">Du skickas till bankens godkända identifiering, med BankID där banken stöder det. Banken måste godkänna läsbehörigheten för företagets konton. BankID identifierar dig och är inte ensamt bevis på företagsbehörighet.</p></>}
      {connection && readyForAccounts && <form onSubmit={synchronize} aria-label="Hämta bankhändelser"><fieldset disabled={disabled || !configured}><legend className="sr-only">Konto och hämtningsperiod</legend>
        {selected.length > 0 && <div className="bank-saved-accounts">{eligible.filter(a => a.selected).map(a => <div key={a.uid}><Wallet size={18} /><strong>{a.label}</strong><span>{a.currency}</span></div>)}</div>}
        <details className="bank-inline-details" open={selected.length === 0}><summary><span>{selected.length ? "Ändra konto eller period" : "Välj företagets konto"}</span><ChevronDown size={16} /></summary><div className="bank-details-body"><div className="bank-accounts">{eligible.map(a => <label className="bank-account" key={a.uid}><input type="checkbox" checked={accountUids.includes(a.uid)} onChange={event => setAccountUids(current => event.target.checked ? [...current, a.uid] : current.filter(id => id !== a.uid))} /><Wallet size={18} /><span>{a.label}</span><strong>SEK</strong></label>)}</div><p className="bank-help">Välj konton som hör till {status.company?.name || 'företaget'}. Kontonumret visas maskerat.</p><label className="bank-field" htmlFor={formId + "-date"}><span>Hämta bankhändelser från</span><input id={formId + "-date"} type="date" value={dateFrom} min="2000-01-01" max={localDate()} onChange={event => setDateFrom(event.target.value)} required /></label></div></details>
        {!eligible.length && <p className="bank-inline-error">Banken lämnade inget företagskonto i SEK. Förnya medgivandet och välj rätt konto hos banken.</p>}
        <button className="btn primary bank-primary" disabled={!accountUids.length} type="submit"><RefreshCw size={18} className={busy ? "spin" : ""} />{busy ? "Hämtar bankhändelser…" : selected.length ? "Uppdatera bankhändelser" : "Anslut valt konto och hämta"}</button>
      </fieldset></form>}
      {connection && <><dl className="bank-facts"><div><dt>Senast uppdaterad</dt><dd>{dateLabel(connection.lastSyncedAt)}</dd></div><div><dt>Medgivandet gäller till</dt><dd>{dateLabel(connection.validUntil, "Giltighet inte bekräftad")}</dd></div></dl><button className={readyForAccounts ? "btn bank-secondary" : "btn primary bank-primary"} disabled={disabled || !configured} onClick={() => void run(() => startConnection(true))}><RefreshCw size={17} />Förnya anslutningen</button>{confirmDisconnect ? <div className="bank-confirm"><p>Koppla från banken? Tidigare importerade bankhändelser behålls.</p><button className="btn" disabled={disabled} onClick={() => setConfirmDisconnect(false)}>Avbryt</button><button className="btn bank-danger-button" disabled={disabled} onClick={() => void run(async () => { const result = await bankRequest<{ message: string }>("/api/bank/disconnect", "POST", { companyId: status.company?.id, connectionId: connection.id }); if (!alive.current || demoMode.current) return; setConfirmDisconnect(false); setNotice(result.message); await loadStatus(); })}>Ja, koppla från</button></div> : <button className="text-button bank-danger-link" disabled={disabled} onClick={() => setConfirmDisconnect(true)}><Unlink size={16} />Koppla från banken</button>}</>}
      {connection && connected && selected.length > 0 && <div className="bank-spaced"><label className="bank-account"><input type="checkbox" checked={!!status?.automatic?.enabled} disabled={disabled} onChange={event => { const enabled = event.target.checked; void run(async () => { await bankRequest('/api/bank/automatic', 'POST', { companyId: status.company?.id, enabled, connectionId: connection.id }); await loadStatus(); }); }} /><span><strong>Automatisk bankhämtning</strong><br />{automaticInterval ? `När funktionen är aktiverad planeras hämtning med ${automaticInterval} intervall.` : 'Hämtningsintervallet är inte bekräftat.'}</span></label>{status?.automatic?.blocked && <SyncRecoveryNotice channel="bank"/>}{status?.automatic?.enabled && !status.automatic.blocked && <p className="bank-help">Nästa planerade hämtning: {dateLabel(status.automatic.nextAttemptAt, 'Ingen tidpunkt är bekräftad')}. Bankens medgivande behöver fortfarande förnyas när det går ut.</p>}</div>}
      <div className="bank-spaced">{manualAlternative}</div><p className="bank-fine-print"><ShieldCheck size={15} />Endast läsåtkomst. Inga betalningar utförs och inga BankID-koder eller banklösenord sparas.</p>
    </div>}
    {status?.lastRun && !demo && <section className="bank-last-run"><div className="bank-result-line"><CheckCircle2 size={19} /><div><strong>{status.lastRun.test ? "Testhämtningen är klar" : status.lastRun.imported + " nya bankhändelser"}</strong><p>{dateLabel(status.lastRun.createdAt)}</p></div></div>{!status.lastRun.test && <a className="text-button" href="/?view=bank">Visa bankhändelser<ArrowRight size={15} /></a>}{status.lastRun.warnings.length > 0 && <details className="bank-inline-details"><summary>Att kontrollera<ChevronDown size={16} /></summary><ul>{status.lastRun.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}</section>}
    {!demo && <p className="bank-bottom-note">Om betalardetaljer saknas kan du komplettera med en betalningsspecifikation. Bankgiro kan innehålla flera kundbetalningar; använd underlaget för att kontrollera betalare och referenser innan du matchar.</p>}
  </section>;
}
