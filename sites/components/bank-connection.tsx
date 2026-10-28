"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { AlertCircle, ArrowRight, CheckCircle2, ChevronDown, FileText, Landmark, LogIn, RefreshCw, ShieldCheck, Unlink, Wallet } from "lucide-react";
import { confirmedBankConsent } from "@/lib/banking/status-view";
import { useBankRefresh } from './use-bank-refresh';

type BankAccount = { uid: string; label: string; currency: string; selected: boolean; importable: boolean };
type BankConnection = { id: string; bankName: string; environment: "SANDBOX" | "PRODUCTION"; status: string; validUntil: string; lastSyncedAt: string | null; lastError: string | null; accounts: BankAccount[]; dateFrom: string };
type BankStatus = {
  configured: boolean; storageReady: boolean;
  automatic?: { enabled: boolean; intervalHours: number; lastAttemptAt: string | null; nextAttemptAt: string | null };
  activation?: { configured: boolean; message: string };
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
function localDate(date = new Date()) { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
function initialDate() { const date = new Date(localDate() + "T12:00:00Z"); date.setUTCDate(date.getUTCDate() - 29); return date.toISOString().slice(0, 10); }
function dateLabel(value?: string | null) { return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Inte hämtat ännu"; }
function followBankUrl(value: string) {
  const url = new URL(value);
  if (!["https://auth.enablebanking.com", "https://tilisy.enablebanking.com"].includes(url.origin) || url.pathname !== "/ais/start" || url.username || url.password || url.hash) throw new BankApiError("Bankens inloggningsadress kunde inte verifieras.");
  window.location.assign(url.href);
}
const resultMessages: Record<string, string> = {
  connected: "Banken har bekräftat medgivandet. Välj företagets konto och hämta bankhändelser.",
  cancelled: "Bankanslutningen avbröts. Du kan koppla igen när du vill.",
  expired: "Anslutningsförsöket har gått ut. Börja med Koppla banken igen.",
  failed: "Bankanslutningen kunde inte slutföras. Kontrollera status och försök igen.",
  signin_required: "Logga in med det ChatGPT-konto som startade bankanslutningen.",
  wrong_user: "Använd samma ChatGPT-konto och webbläsare som när anslutningen startades.",
};

export default function BankConnection({ demo = false, onDataChanged }: { demo?: boolean; onDataChanged?: () => void }) {
  const [status, setStatus] = useState<BankStatus | null>(null), [loading, setLoading] = useState(!demo), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [signIn, setSignIn] = useState("");
  const [accountUids, setAccountUids] = useState<string[]>([]), [dateFrom, setDateFrom] = useState(initialDate), [confirmDisconnect, setConfirmDisconnect] = useState(false);
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
  const eligible = connection?.accounts.filter(a => a.importable && a.currency === "SEK") || [];
  const selected = eligible.filter(a => a.selected).map(a => a.uid);
  const configured = !!status?.configured && !!status.storageReady;
  const sandbox = (connection?.environment || status?.application?.environment) === "SANDBOX";
  const disabled = busy || loading;
  useBankRefresh(!demo && connected && selected.length > 0, busy || loading || accountUids.length !== selected.length || accountUids.some(id => !selected.includes(id)) || dateFrom !== connection?.dateFrom, () => { void loadStatus(); onDataChanged?.(); });
  async function startConnection() {
    if (!alive.current || demoMode.current) return;
    const available = await bankRequest<{ banks: { name: string; country: string }[] }>("/api/bank/banks");
    if (!alive.current || demoMode.current) return;
    const bank = available.banks.find(b => b.name === "Swedbank" && b.country === "SE") || available.banks.find(b => /^Swedbank\b/i.test(b.name) && b.country === "SE");
    if (!bank) throw new BankApiError("Swedbanks företagsanslutning är inte tillgänglig. Kontakta systemadministratören.");
    const result = await bankRequest<{ url: string }>("/api/bank/connect", "POST", { bankName: bank.name, country: "SE", dateFrom: initialDate() });
    if (alive.current && !demoMode.current) followBankUrl(result.url);
  }
  function synchronize(event: FormEvent) {
    event.preventDefault(); if (!connected || !connection) return;
    void run(async () => {
      if (!accountUids.length) throw new BankApiError("Välj företagets konto först.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || dateFrom > localDate()) throw new BankApiError("Välj ett giltigt startdatum.");
      if (selected.length !== accountUids.length || accountUids.some(id => !selected.includes(id)) || dateFrom !== connection.dateFrom) await bankRequest("/api/bank/accounts", "POST", { connectionId: connection.id, accountUids, dateFrom });
      if (!alive.current || demoMode.current) return;
      const result = await bankRequest<SyncResult>("/api/bank/sync", "POST", {});
      if (!alive.current || demoMode.current) return;
      setNotice(result.message); await loadStatus(); if (!result.test && alive.current && !demoMode.current) onDataChanged?.();
    });
  }
  const manualAlternative = <a className="btn bank-primary" href="/?view=bank&import=1"><FileText size={18} />Importera bankfil istället<ArrowRight size={17} /></a>;
  return <section className="bank-connection" aria-labelledby={formId + "-title"} aria-busy={loading || busy}>
    <header className="bank-page-heading"><div className="bank-eyebrow">MG FAKTURAKOLL</div><h1 id={formId + "-title"}>Bankanslutning</h1><p>Företagets bankhändelser, samlade i fakturakollen.</p></header>
    {error && <div className="bank-message bank-message-error" role="alert"><AlertCircle size={19} /><p>{error}</p></div>}
    {notice && <div className="bank-message bank-message-success" role="status"><CheckCircle2 size={19} /><p>{notice}</p></div>}
    {demo ? <div className="bank-card bank-welcome"><h2>Bankkopplingen är avstängd i demo</h2><p>Avsluta demoläget för att ansluta företagets bank.</p></div> : signIn ? <div className="bank-card bank-welcome"><h2>Koppla företagets bank</h2><a className="btn primary bank-primary" href={signIn} target="_top"><LogIn size={18} />Logga in och fortsätt</a></div> : !status ? <div className="bank-card bank-welcome" role="status">{loading ? <><RefreshCw className="spin" /><p>Hämtar anslutningsstatus…</p></> : <button className="btn" onClick={() => void loadStatus()}>Försök igen</button>}</div> : <div className="bank-card bank-connected">
      <div className="bank-connected-heading"><span className="bank-hero-icon"><Landmark size={27} /></span><div><h2>{connection?.bankName || "Swedbank"}</h2><p className="bank-connected-label">Status: {connected ? selected.length ? "Ansluten" : "Välj företagskonto" : connection ? "Behöver förnyas" : "Ej ansluten"}</p></div></div>
      {sandbox && <div className="bank-sandbox" role="note"><AlertCircle size={18} /><p>Testmiljö – testhändelser sparas inte i företagets fakturaregister.</p></div>}
      {!configured && <div className="bank-inline-error" role="status">Banktjänsten behöver aktiveras av systemadministratören.</div>}
      {connection?.lastError && <p className="bank-inline-error" role="alert">{connection.lastError}</p>}
      {!connection && <><button className="btn primary bank-primary" disabled={disabled || !configured} onClick={() => void run(startConnection)}><Landmark size={18} />{busy ? "Öppnar banken…" : "Koppla banken"}<ArrowRight size={17} /></button><p className="bank-help">Du skickas till bankens säkra inloggning för att godkänna att MG Fakturakoll får läsa dina bankhändelser.</p></>}
      {connection && connected && <form onSubmit={synchronize} aria-label="Hämta bankhändelser"><fieldset disabled={disabled || !configured}><legend className="sr-only">Konto och hämtningsperiod</legend>
        {selected.length > 0 && <div className="bank-saved-accounts">{eligible.filter(a => a.selected).map(a => <div key={a.uid}><Wallet size={18} /><strong>{a.label}</strong><span>{a.currency}</span></div>)}</div>}
        <details className="bank-inline-details" open={selected.length === 0}><summary><span>{selected.length ? "Ändra konto eller period" : "Välj företagets konto"}</span><ChevronDown size={16} /></summary><div className="bank-details-body"><div className="bank-accounts">{eligible.map(a => <label className="bank-account" key={a.uid}><input type="checkbox" checked={accountUids.includes(a.uid)} onChange={event => setAccountUids(current => event.target.checked ? [...current, a.uid] : current.filter(id => id !== a.uid))} /><Wallet size={18} /><span>{a.label}</span><strong>SEK</strong></label>)}</div><p className="bank-help">Välj konton som hör till M.George Vitvaror AB. Kontonumret visas maskerat.</p><label className="bank-field" htmlFor={formId + "-date"}><span>Hämta bankhändelser från</span><input id={formId + "-date"} type="date" value={dateFrom} min="2000-01-01" max={localDate()} onChange={event => setDateFrom(event.target.value)} required /></label></div></details>
        {!eligible.length && <p className="bank-inline-error">Banken lämnade inget företagskonto i SEK. Förnya medgivandet och välj rätt konto hos banken.</p>}
        <button className="btn primary bank-primary" disabled={!accountUids.length} type="submit"><RefreshCw size={18} className={busy ? "spin" : ""} />{busy ? "Hämtar bankhändelser…" : selected.length ? "Uppdatera bankhändelser" : "Anslut valt konto och hämta"}</button>
      </fieldset></form>}
      {connection && <><dl className="bank-facts"><div><dt>Senast uppdaterad</dt><dd>{dateLabel(connection.lastSyncedAt)}</dd></div><div><dt>Medgivandet gäller till</dt><dd>{dateLabel(connection.validUntil)}</dd></div></dl><button className="btn bank-primary" disabled={disabled || !configured} onClick={() => void run(async () => { const result = await bankRequest<{ message: string; remoteRevoked?: boolean }>("/api/bank/disconnect", "POST", {}); if (!alive.current || demoMode.current) return; if (result.remoteRevoked === false) { setNotice(result.message); await loadStatus(); return; } await startConnection(); })}><RefreshCw size={17} />Förnya anslutningen</button>{confirmDisconnect ? <div className="bank-confirm"><p>Koppla från banken? Tidigare importerade bankhändelser behålls.</p><button className="btn" disabled={disabled} onClick={() => setConfirmDisconnect(false)}>Avbryt</button><button className="btn bank-danger-button" disabled={disabled} onClick={() => void run(async () => { const result = await bankRequest<{ message: string }>("/api/bank/disconnect", "POST", {}); if (!alive.current || demoMode.current) return; setConfirmDisconnect(false); setNotice(result.message); await loadStatus(); })}>Ja, koppla från</button></div> : <button className="text-button bank-danger-link" disabled={disabled} onClick={() => setConfirmDisconnect(true)}><Unlink size={16} />Koppla från banken</button>}</>}
      {connection && connected && selected.length > 0 && <div className="bank-spaced"><label className="bank-account"><input type="checkbox" checked={!!status?.automatic?.enabled} disabled={disabled} onChange={event => { const enabled = event.target.checked; void run(async () => { await bankRequest('/api/bank/automatic', 'POST', { enabled, connectionId: connection.id }); await loadStatus(); }); }} /><span><strong>Automatisk bankhämtning</strong><br />Nya bankhändelser hämtas var sjätte timme när funktionen är aktiverad.</span></label>{status?.automatic?.enabled && <p className="bank-help">Nästa hämtning: {status.automatic.nextAttemptAt ? dateLabel(status.automatic.nextAttemptAt) : 'Vid nästa automatiska kontroll'}. Bankens medgivande behöver fortfarande förnyas när det går ut.</p>}</div>}
      <div className="bank-spaced">{manualAlternative}</div><p className="bank-fine-print"><ShieldCheck size={15} />Endast läsåtkomst. Inga betalningar utförs och inga BankID-koder eller banklösenord sparas.</p>
    </div>}
    {status?.lastRun && !demo && <section className="bank-last-run"><div className="bank-result-line"><CheckCircle2 size={19} /><div><strong>{status.lastRun.test ? "Testhämtningen är klar" : status.lastRun.imported + " nya bankhändelser"}</strong><p>{dateLabel(status.lastRun.createdAt)}</p></div></div>{!status.lastRun.test && <a className="text-button" href="/?view=bank">Visa bankhändelser<ArrowRight size={15} /></a>}{status.lastRun.warnings.length > 0 && <details className="bank-inline-details"><summary>Att kontrollera<ChevronDown size={16} /></summary><ul>{status.lastRun.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}</section>}
    {!demo && <p className="bank-bottom-note">Betalardetaljer saknas – importera betalningsspecifikation. Bankgiro kan innehålla flera kundbetalningar; komplettera med camt.054 innan du matchar.</p>}
  </section>;
}
