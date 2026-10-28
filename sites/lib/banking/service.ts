import { db, identity, readWorkspace, response } from '@/lib/server';
import { applyCommand, canonicalBankAccount, emptyState, now, today, uid, validDate } from '@/lib/domain';
import {
  ProviderError, getApplication, listBusinessBanks, startAuth, createSession,
  getSession, deleteSession, getTransactions,
  type ProviderAccount, type ProviderApplication, type ProviderPsu,
} from './enable-banking';
import { normalizeTransactions, stableAccountKey } from './transactions';
import {
  accounts, application, connection, encrypt, metadata, providerConfig, configurationStatus, saveApplicationMetadata,
  sessionId, storageReady, withBankLock, type BankConnectionRow, type BankFlowRow,
} from './store';
import { cookieValue, digest, randomToken, validFlowToken } from './security';
import { RuntimeBankError } from './runtime-config';

export const BANK_REDIRECT_URL = 'https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site/api/bank/callback';
const COOKIE = '__Secure-mg-bank-flow';
const FLOW_AGE_MS = 15 * 60_000;
const MAX_ROWS = 1000;
const MAX_PAGES = 25;
const stockholmClock = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function clockParts(at: number) { return Object.fromEntries(stockholmClock.formatToParts(at).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)])); }
function stockholmOffset(at: number) {
  const p = clockParts(at);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at / 1000) * 1000;
}
export function nextAutomaticAttempt(at = Date.now()): string {
  const p = clockParts(at), midnight = Date.UTC(p.year, p.month - 1, p.day);
  for (let day = 0; day < 2; day++) for (const hour of [3, 9, 15, 21]) {
    const wallTime = midnight + day * 86400_000 + hour * 3600_000 + 6 * 60_000;
    let instant = wallTime - stockholmOffset(at);
    for (let pass = 0; pass < 3; pass++) instant = wallTime - stockholmOffset(instant);
    if (instant > at) return new Date(instant).toISOString();
  }
  throw new Error('BANK_SCHEDULE_UNAVAILABLE');
}
function automaticDueAt(conn: BankConnectionRow): string | null {
  // Re-anchor prior interval-based reservations to the fixed cloud schedule.
  // Browser checks cannot shift the next cloud run several hours forward.
  return conn.auto_next_at && conn.auto_last_attempt_at ? nextAutomaticAttempt(Date.parse(conn.auto_last_attempt_at)) : null;
}

export class BankError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function bankFailure(error: unknown): Response {
  const code = error instanceof Error ? error.message : '';
  if (code === 'AUTH_REQUIRED') return response({ error: 'Logga in med ChatGPT för att hantera din bankanslutning.', signIn: '/signin-with-chatgpt?return_to=%2Fbank' }, 401);
  if (code === 'ORIGIN_DENIED') return response({ error: 'Åtgärden måste startas från MG Fakturakoll.' }, 403);
  if (code === 'BANK_BUSY') return response({ error: 'En bankåtgärd pågår redan. Vänta tills den är klar innan du försöker igen.' }, 409);
  if (code === 'BANK_STORAGE_UNAVAILABLE') return response({ error: 'Säker lagring för bankanslutningen är inte konfigurerad ännu.' }, 503);
  if (code === 'BANK_SECRET_UNREADABLE') return response({ error: 'Bankanslutningens skyddade uppgifter kunde inte läsas. Kontakta administratören.' }, 503);
  if (error instanceof RuntimeBankError || code === 'BANK_RUNTIME_CONFIGURATION_CHANGED') return response({ error: 'Banktjänsten behöver aktiveras av systemadministratören.' }, 409);
  if (error instanceof BankError) return response({ error: error.message }, error.status);
  if (error instanceof ProviderError) return response({ error: error.message, code: error.code }, error.status === 429 ? 429 : 502);
  return response({ error: 'Bankåtgärden kunde inte slutföras. Försök igen. Dina tidigare fakturor och bankhändelser är kvar.' }, 500);
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new BankError('Förfrågan måste innehålla JSON.');
  const reader = request.body?.getReader();
  if (!reader) throw new BankError('Förfrågan är tom.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.length;
    if (size > 24_000) { await reader.cancel(); throw new BankError('Förfrågan är för stor.', 413); }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
    return parsed;
  } catch { throw new BankError('Förfrågan har ett ogiltigt format.'); }
}

function dateFrom(value: unknown): string {
  if (typeof value !== 'string' || !validDate(value) || value < '2000-01-01' || value > today()) throw new BankError('Välj ett startdatum mellan 1 januari 2000 och idag.');
  return value;
}

function storedStatus(row: BankConnectionRow): string {
  return row.status === 'connected' && Date.parse(row.valid_until) <= Date.now() ? 'expired' : row.status;
}

function maskAccount(account: ProviderAccount, bank: {name: string; country: string}): string {
  const key = stableAccountKey(account, bank);
  // A primary identification hash is a stable identity, not an account number.
  const ending = key && !key.startsWith('enable-account:') ? key.replace(/\s/g, '').slice(-4) : '';
  return [account.name?.slice(0, 80) || 'Bankkonto', ending ? `•••• ${ending}` : 'kontonummer saknas'].join(' · ');
}

function safeApplication(app: ProviderApplication) {
  return { name: app.name, environment: app.environment, active: app.active, redirectConfigured: app.redirect_urls.includes(BANK_REDIRECT_URL) };
}

async function checkedApplication(row: NonNullable<Awaited<ReturnType<typeof application>>>, requireActive = true) {
  const info = await getApplication(await providerConfig(row));
  if (info.kid !== row.application_id || info.environment !== metadata(row).environment || !info.services.includes('AIS') || !info.countries.includes('SE') || !info.redirect_urls.includes(BANK_REDIRECT_URL)) throw new BankError('Banktjänsten behöver aktiveras av systemadministratören. Kontrollera registrerad miljö, svensk läsåtkomst och returadress hos Enable Banking.', 409);
  await saveApplicationMetadata(row, info);
  if (requireActive && !info.active) throw new BankError('Banktjänsten behöver aktiveras av systemadministratören. Enable Banking har ännu inte godkänt applikationen.', 409);
  return info;
}

export async function status(request: Request): Promise<Response> {
  const user = await identity();
  const [storedApp, conn, run] = await Promise.all([
    application(user.userId), connection(user.userId),
    db().prepare('SELECT created_at,imported,skipped,warnings,test FROM bank_sync_runs WHERE owner=? ORDER BY created_at DESC LIMIT 1').bind(user.userId).first<{ created_at: string; imported: number; skipped: number; warnings: string; test: number }>(),
  ]);
  let app = storedApp;
  if (app && new URL(request.url).searchParams.get('refresh') === '1') {
    const info = await checkedApplication(app, false);
    const at = now(), updatedMetadata = JSON.stringify(info);
    app = { ...app, metadata: updatedMetadata, updated_at: at };
  }
  const selected: string[] = conn ? JSON.parse(conn.selected_accounts) : [];
  const bankAccounts = conn && storageReady() ? await accounts(conn) : [];
  return response({
    storageReady: storageReady(), configured: Boolean(app), activation: configurationStatus(),
    application: app ? safeApplication(metadata(app)) : null,
    redirectUrl: BANK_REDIRECT_URL, syncMode: conn?.auto_sync_enabled === 1 ? 'automatic' : 'manual',
    automatic: { enabled: conn?.auto_sync_enabled === 1, intervalHours: 6, lastAttemptAt: conn?.auto_last_attempt_at ?? null, nextAttemptAt: conn ? automaticDueAt(conn) : null },
    connection: conn ? {
      id: conn.id, bankName: conn.bank_name, environment: conn.environment, status: conn.encrypted_session && (!app || conn.app_generation !== app.generation) ? 'reauth_required' : storedStatus(conn),
      validUntil: conn.valid_until, lastSyncedAt: conn.last_synced_at, lastError: conn.last_error,
      dateFrom: conn.date_from,
      accounts: bankAccounts.map(account => ({
        uid: account.uid, label: maskAccount(account, {name: conn.bank_name, country: conn.country}), currency: account.currency || '',
        selected: selected.includes(account.uid),
        importable: account.currency === 'SEK' && Boolean(stableAccountKey(account, { name: conn.bank_name, country: conn.country })),
      })),
    } : null,
    lastRun: run ? { createdAt: run.created_at, imported: run.imported, skipped: run.skipped, warnings: JSON.parse(run.warnings), test: Boolean(run.test) } : null,
  });
}

export async function saveConfig(request: Request): Promise<Response> {
  await identity(request);
  // Intentionally do not read or persist a browser-supplied private key.
  throw new BankError('Banktjänsten behöver aktiveras av systemadministratören. Anslutningsuppgifter tas endast emot som skyddade serverhemligheter.', 405);
}

export async function removeConfig(request: Request): Promise<Response> {
  const user = await identity(request);
  return withBankLock(user.userId, async () => {
    const conn = await connection(user.userId);
    if (conn?.encrypted_session) throw new BankError('Koppla från banken innan du tar bort applikationsuppgifterna.', 409);
    await db().batch([
      db().prepare('DELETE FROM bank_applications WHERE owner=?').bind(user.userId),
      db().prepare('DELETE FROM bank_auth_flows WHERE owner=?').bind(user.userId),
    ]);
    return response({ message: 'Applikationsuppgifterna är borttagna. Tidigare importerade bankhändelser finns kvar.' });
  });
}

export async function banks(request: Request): Promise<Response> {
  const user = await identity(), row = await application(user.userId);
  if (!row || !storageReady()) throw new BankError('Banktjänsten behöver aktiveras av systemadministratören.', 409);
  const config = await providerConfig(row);
  await checkedApplication(row);
  const entries = await listBusinessBanks(config);
  return response({ banks: entries.filter(bank => bank.country === 'SE' && /^Swedbank\b/i.test(bank.name) && bank.psu_types.includes('business')).map(bank => ({ name: bank.name, country: bank.country, maximumConsentSeconds: bank.maximum_consent_validity })) });
}

export async function connect(request: Request): Promise<Response> {
  const user = await identity(request), body = await jsonBody(request), from = dateFrom(body.dateFrom);
  if (typeof body.bankName !== 'string' || body.bankName.length > 200 || body.country !== 'SE') throw new BankError('Välj en svensk företagsbank i listan.');
  return withBankLock(user.userId, async () => {
    const app = await application(user.userId);
    if (!app || !storageReady()) throw new BankError('Banktjänsten behöver aktiveras av systemadministratören.', 409);
    const existing = await connection(user.userId);
    if (existing?.encrypted_session) throw new BankError('Koppla först från den befintliga anslutningen. Därefter kan du ansluta banken igen.', 409);
    const config = await providerConfig(app), info = await checkedApplication(app);
    const available = await listBusinessBanks(config);
    const bank = available.find(item => item.name === body.bankName && /^Swedbank\b/i.test(item.name) && item.country === 'SE' && item.psu_types.includes('business'));
    if (!bank) throw new BankError('Den valda banken är inte tillgänglig för företagskonton i din anslutning.');
    if (!Number.isFinite(bank.maximum_consent_validity) || bank.maximum_consent_validity < 60) throw new BankError('Banken kunde inte ange en giltig period för anslutningen.');
    const validUntil = new Date(Date.now() + Math.min(bank.maximum_consent_validity, 90 * 86400) * 1000 - 30_000).toISOString();
    const state = randomToken(), cookie = randomToken(), stateHash = await digest(state), at = now();
    await db().batch([
      db().prepare('DELETE FROM bank_auth_flows WHERE owner=? OR expires_at<?').bind(user.userId, at),
      db().prepare(`INSERT INTO bank_auth_flows (state_hash,owner,cookie_hash,app_generation,bank_name,country,environment,redirect_uri,date_from,expires_at,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(stateHash, user.userId, await digest(cookie), app.generation, bank.name, bank.country, info.environment, BANK_REDIRECT_URL, from, new Date(Date.now() + FLOW_AGE_MS).toISOString(), 'pending', at),
    ]);
    try {
      const result = await startAuth(config, { bank: { name: bank.name, country: bank.country }, state, redirectUrl: BANK_REDIRECT_URL, validUntil });
      return Response.json({ url: result.url }, { headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'Set-Cookie': `${COOKIE}=${cookie}; Path=/api/bank/callback; Secure; HttpOnly; SameSite=Lax; Max-Age=900` } });
    } catch (error) {
      await db().prepare("UPDATE bank_auth_flows SET status='failed' WHERE state_hash=? AND owner=?").bind(stateHash, user.userId).run();
      throw error;
    }
  });
}

function callbackRedirect(result: string): Response {
  return new Response(null, { status: 303, headers: {
    Location: `/bank?result=${result}`, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
    'Set-Cookie': `${COOKIE}=; Path=/api/bank/callback; Secure; HttpOnly; SameSite=Lax; Max-Age=0`,
  } });
}

export async function callback(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams, state = params.get('state'), cookie = cookieValue(request, COOKIE);
  if (params.getAll('state').length !== 1 || !validFlowToken(state) || !validFlowToken(cookie)) return callbackRedirect('expired');
  let owner: string;
  try { owner = (await identity()).userId; } catch { return callbackRedirect('signin_required'); }
  const stateHash = await digest(state);
  const flow = await db().prepare('SELECT * FROM bank_auth_flows WHERE state_hash=?').bind(stateHash).first<BankFlowRow>();
  if (!flow || flow.status !== 'pending' || flow.expires_at <= now()) return callbackRedirect('expired');
  if (flow.owner !== owner || flow.cookie_hash !== await digest(cookie)) return callbackRedirect('wrong_user');
  try {
    return await withBankLock(owner, async () => {
      const app = await application(owner);
      if (!app || app.generation !== flow.app_generation) return callbackRedirect('expired');
      const claimed = await db().prepare("UPDATE bank_auth_flows SET status='exchanging' WHERE state_hash=? AND owner=? AND status='pending' AND expires_at>?").bind(stateHash, owner, now()).run();
      if (claimed.meta.changes !== 1) return callbackRedirect('expired');
      if (params.has('error')) {
        await db().prepare("UPDATE bank_auth_flows SET status='cancelled' WHERE state_hash=?").bind(stateHash).run();
        return callbackRedirect('cancelled');
      }
      const code = params.get('code');
      if (params.getAll('code').length !== 1 || !code || code.length > 4096) return callbackRedirect('failed');
      const config = await providerConfig(app);
      let remoteSession = '';
      try {
        const result = await createSession(config, code);
        remoteSession = result.session_id;
        if (result.aspsp.name !== flow.bank_name || result.aspsp.country !== flow.country || result.psu_type !== 'business' || !Array.isArray(result.accounts) || result.accounts.length > 100 || !result.accounts.length) throw new BankError('Banken lämnade inga tillgängliga företagskonton.');
        const checked = await getSession(config, result.session_id);
        if (checked.status !== 'AUTHORIZED' || checked.aspsp.name !== flow.bank_name || checked.aspsp.country !== flow.country || checked.psu_type !== 'business') throw new BankError('Bankanslutningen är inte godkänd.');
        const expiry = Date.parse(checked.access.valid_until);
        if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new BankError('Bankanslutningen har gått ut.');
        const ids = result.accounts.map(account => account.uid);
        if (new Set(ids).size !== ids.length || !ids.every(id => typeof id === 'string' && checked.accounts.includes(id))) throw new BankError('Kontona kunde inte verifieras.');
        const id = uid(), at = now();
        const encryptedSession = await encrypt(owner, `session:${id}`, result.session_id);
        const encryptedAccounts = await encrypt(owner, `accounts:${id}`, result.accounts);
        const existing = await connection(owner);
        if (existing?.encrypted_session) throw new BankError('Det finns redan en aktiv bankanslutning.');
        await db().batch([
          db().prepare(`INSERT INTO bank_connections (id,owner,app_generation,environment,bank_name,country,encrypted_session,encrypted_accounts,selected_accounts,valid_until,date_from,status,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner) DO UPDATE SET id=excluded.id,app_generation=excluded.app_generation,environment=excluded.environment,bank_name=excluded.bank_name,country=excluded.country,encrypted_session=excluded.encrypted_session,encrypted_accounts=excluded.encrypted_accounts,selected_accounts=excluded.selected_accounts,valid_until=excluded.valid_until,date_from=excluded.date_from,status=excluded.status,last_synced_at=NULL,last_error=NULL,auto_next_at=NULL,auto_last_attempt_at=NULL,created_at=excluded.created_at,updated_at=excluded.updated_at`)
            .bind(id, owner, app.generation, flow.environment, flow.bank_name, flow.country, encryptedSession, encryptedAccounts, '[]', new Date(expiry).toISOString(), flow.date_from, 'connected', at, at),
          db().prepare("UPDATE bank_auth_flows SET status='completed' WHERE state_hash=? AND owner=?").bind(stateHash, owner),
        ]);
        return callbackRedirect('connected');
      } catch {
        if (remoteSession) { try { await deleteSession(config, remoteSession); } catch { /* No local use of an unverified or unsaved provider session. */ } }
        await db().prepare("UPDATE bank_auth_flows SET status='failed' WHERE state_hash=? AND owner=?").bind(stateHash, owner).run();
        return callbackRedirect('failed');
      }
    });
  } catch { return callbackRedirect('failed'); }
}

export async function selectAccounts(request: Request): Promise<Response> {
  const user = await identity(request), body = await jsonBody(request);
  if (!Array.isArray(body.accountUids) || body.accountUids.length < 1 || body.accountUids.length > 20 || body.accountUids.some(id => typeof id !== 'string')) throw new BankError('Välj mellan 1 och 20 konton.');
  return withBankLock(user.userId, async () => {
    const conn = await connection(user.userId);
    if (!conn || conn.id !== body.connectionId || storedStatus(conn) !== 'connected') throw new BankError('Anslut banken igen innan du väljer konton.');
    const available = await accounts(conn), selected = [...new Set(body.accountUids as string[])];
    if (!selected.every(id => available.some(account => account.uid === id && account.currency === 'SEK' && stableAccountKey(account, { name: conn.bank_name, country: conn.country })))) throw new BankError('Endast tillgängliga SEK-konton med en stabil kontoidentifierare kan importeras.');
    const from = body.dateFrom === undefined ? conn.date_from : dateFrom(body.dateFrom);
    await db().prepare('UPDATE bank_connections SET selected_accounts=?,date_from=?,updated_at=? WHERE owner=? AND id=?').bind(JSON.stringify(selected), from, now(), user.userId, conn.id).run();
    return response({ message: 'Konton och startdatum är sparade. Du kan nu hämta bankhändelser.' });
  });
}

export async function disconnect(request: Request): Promise<Response> {
  const user = await identity(request);
  return withBankLock(user.userId, async () => {
    const app = await application(user.userId), conn = await connection(user.userId);
    if (!conn?.encrypted_session) return response({ message: 'Det finns ingen aktiv bankanslutning.' });
    if (!app || app.generation !== conn.app_generation) {
      // Previously browser-uploaded keys are compromised and must never be used,
      // even to revoke a session. Detach locally and state the revocation limit.
      await db().batch([
        db().prepare("UPDATE bank_connections SET status='disconnected',auto_sync_enabled=0,auto_next_at=NULL,encrypted_session='',encrypted_accounts='',selected_accounts='[]',last_error=NULL,updated_at=? WHERE owner=? AND id=?").bind(now(), user.userId, conn.id),
        db().prepare('DELETE FROM bank_auth_flows WHERE owner=?').bind(user.userId),
        db().prepare("UPDATE bank_applications SET encrypted_key='' WHERE owner=?").bind(user.userId),
      ]);
      return response({ message: 'Den lokala bankkopplingen är borttagen. Det tidigare medgivandet kunde inte återkallas med en betrodd servernyckel. Återkalla det hos Swedbank eller Enable Banking innan du ansluter igen.', remoteRevoked: false });
    }
    const config = await providerConfig(app), remote = await sessionId(conn);
    // A failed revocation retains the credentials so the user can retry. Do not
    // tell the user bank access was revoked when the provider did not confirm it.
    try { await deleteSession(config, remote); }
    catch (error) {
      // The provider explicitly reports this session as expired/closed/missing.
      // Network failures or rejected application credentials are not confirmation.
      if (!(error instanceof ProviderError) || error.code !== 'BANK_RECONNECT_REQUIRED') throw error;
    }
    await db().batch([
      db().prepare("UPDATE bank_connections SET status='disconnected',auto_sync_enabled=0,auto_next_at=NULL,encrypted_session='',encrypted_accounts='',selected_accounts='[]',last_error=NULL,updated_at=? WHERE owner=? AND id=?").bind(now(), user.userId, conn.id),
      db().prepare('DELETE FROM bank_auth_flows WHERE owner=?').bind(user.userId),
    ]);
    return response({ message: 'Bankanslutningen är återkallad. Tidigare importerade bankhändelser finns kvar.' });
  });
}

function psuHeaders(request: Request) {
  const ip = request.headers.get('cf-connecting-ip');
  const ipAddress = ip && ip.length <= 45 && /^[0-9a-f:.]+$/i.test(ip) ? ip : undefined;
  const userAgent = request.headers.get('user-agent')?.slice(0, 500);
  return { ipAddress, userAgent };
}

export async function sync(request: Request): Promise<Response> {
  const user = await identity(request);
  return synchronizeOwner(user.userId, { psu: psuHeaders(request) });
}

// The main control is manual and works with cloud schedules paused. Its attempt
// reservation is separate from the automatic timetable and survives failures.
export async function syncControl(request:Request):Promise<Response>{
  const user=await identity(request);
  return synchronizeOwner(user.userId,{control:true,psu:psuHeaders(request)});
}

export async function setAutomaticSync(request: Request): Promise<Response> {
  const user = await identity(request), body = await jsonBody(request);
  if (typeof body.enabled !== 'boolean' || typeof body.connectionId !== 'string') throw new BankError('Välj om automatisk hämtning ska vara på eller av.');
  return withBankLock(user.userId, async () => {
    const conn = await connection(user.userId);
    if (!conn || conn.id !== body.connectionId || (body.enabled && (storedStatus(conn) !== 'connected' || !JSON.parse(conn.selected_accounts).length))) throw new BankError('Anslut och välj företagets konto först.');
    await db().prepare('UPDATE bank_connections SET auto_sync_enabled=?,auto_next_at=NULL,updated_at=? WHERE owner=? AND id=?').bind(body.enabled ? 1 : 0, now(), user.userId, conn.id).run();
    return response({ enabled: body.enabled, message: body.enabled ? 'Automatisk bankhämtning är aktiverad.' : 'Automatisk bankhämtning är pausad.' });
  });
}

// Browser calls retain their real PSU context. A hosted task has no active PSU:
// never send the task runner's IP or browser identity to the bank as the user's.
export async function automaticSync(request?: Request): Promise<Response> {
  const user = await identity(request);
  return synchronizeOwner(user.userId, { automatic: true, psu: request ? psuHeaders(request) : undefined });
}

export async function automaticSyncStatus(): Promise<Response> {
  const user = await identity(), conn = await connection(user.userId);
  return response({ enabled: conn?.auto_sync_enabled === 1, connected: !!conn && storedStatus(conn) === 'connected', intervalHours: 6,
    lastSyncedAt: conn?.last_synced_at ?? null, lastAttemptAt: conn?.auto_last_attempt_at ?? null,
    nextAttemptAt: conn ? automaticDueAt(conn) : null, lastError: conn?.last_error ?? null });
}

async function synchronizeOwner(owner: string, options: { automatic?: boolean; control?:boolean; psu?: ProviderPsu }): Promise<Response> {
  const user = { userId: owner };
  return withBankLock(user.userId, async () => {
    const app = await application(user.userId), conn = await connection(user.userId);
    if (options.automatic && (!conn || conn.auto_sync_enabled !== 1)) return response({ automatic: true, due: false, reason: 'disabled', imported: 0 });
    if (!app || !conn || app.generation !== conn.app_generation || storedStatus(conn) !== 'connected') throw new BankError('En giltig bankanslutning behövs. Anslut banken igen.');
    if(options.control){
      const next=Math.max(Date.parse(conn.control_last_attempt_at||'')+6*3600_000||0,Date.parse(conn.last_synced_at||'')+6*3600_000||0,Date.parse(conn.auto_last_attempt_at||'')+6*3600_000||0,Date.parse(conn.auto_next_at||'')||0);
      if(next>Date.now())return response({due:false,reason:'not_due',nextAttemptAt:new Date(next).toISOString(),imported:0});
    }
    const nextAttempt = automaticDueAt(conn);
    if (options.automatic && nextAttempt && Date.parse(nextAttempt) > Date.now()) return response({ automatic: true, due: false, reason: 'not_due', nextAttemptAt: nextAttempt, imported: 0 });
    if (conn.last_synced_at && Date.now() - Date.parse(conn.last_synced_at) < 60_000) throw new BankError('Uppgifterna hämtades nyss. Vänta en minut innan nästa hämtning.', 429);
    const selected: string[] = JSON.parse(conn.selected_accounts);
    if (!selected.length) throw new BankError('Välj vilka konton du vill hämta först.');
    if(options.control)await db().prepare('UPDATE bank_connections SET control_last_attempt_at=? WHERE owner=? AND id=?').bind(now(),owner,conn.id).run();
    // Reserve the next attempt before contacting the provider. Retries, multiple
    // tabs and scheduled task replays cannot create an unbounded polling loop.
    if (options.automatic) await db().prepare('UPDATE bank_connections SET auto_last_attempt_at=?,auto_next_at=? WHERE owner=? AND id=?')
      .bind(now(), nextAutomaticAttempt(), user.userId, conn.id).run();
    const config = await providerConfig(app), bankAccounts = await accounts(conn);
    let needsReauthorization = false;
    try {
      const live = await getSession(config, await sessionId(conn));
      const expiry = Date.parse(live.access.valid_until);
      if (live.status !== 'AUTHORIZED' || !Number.isFinite(expiry) || expiry <= Date.now() || live.aspsp.name !== conn.bank_name || live.aspsp.country !== conn.country || live.psu_type !== 'business') {
        needsReauthorization = true;
        await db().prepare("UPDATE bank_connections SET status='reauth_required',last_error=?,updated_at=? WHERE owner=? AND id=?").bind('Bankens medgivande är inte längre giltigt. Anslut banken igen.', now(), user.userId, conn.id).run();
        throw new BankError('Bankens medgivande är inte längre giltigt. Anslut banken igen.');
      }
      if (!selected.every(id => live.accounts.includes(id))) {
        needsReauthorization = true;
        throw new BankError('Ett valt konto ingår inte längre i bankens medgivande. Anslut banken igen.');
      }
      const rows: Record<string, unknown>[] = [], warnings = new Set<string>();
      let skipped = 0, rawCount = 0, pageCount = 0;
      const to = today();
      const overlap = conn.last_synced_at ? new Date(Date.parse(conn.last_synced_at.slice(0, 10) + 'T12:00:00Z') - 3 * 86400_000).toISOString().slice(0, 10) : conn.date_from;
      const from = options.automatic && overlap > conn.date_from ? overlap : conn.date_from;
      for (const id of selected) {
        const account = bankAccounts.find(item => item.uid === id);
        const canonicalKey = account && stableAccountKey(account, { name: conn.bank_name, country: conn.country });
        if (!account || account.currency !== 'SEK' || !canonicalKey) throw new BankError('Ett valt konto kan inte importeras. Kontrollera kontovalet.');
        // Use the same canonical bank identity as file imports. Provider UIDs
        // change after reauthorisation and must never be used for deduplication.
        const accountKey = canonicalKey;
        let continuationKey: string | undefined;
        const seen = new Set<string>();
        do {
          if (++pageCount > MAX_PAGES) throw new BankError('Perioden innehåller för många sidor. Välj ett senare startdatum och hämta igen. Inga nya bankhändelser har sparats.');
          const page = await getTransactions(config, id, { dateFrom: from, dateTo: to, continuationKey, psu: options.psu });
          if (!Array.isArray(page.transactions)) throw new BankError('Banken lämnade ett oväntat svar. Inga nya bankhändelser har sparats.');
          rawCount += page.transactions.length;
          if (rawCount > MAX_ROWS) throw new BankError('Perioden innehåller fler än 1 000 bankhändelser. Välj ett senare startdatum och hämta igen. Inga nya bankhändelser har sparats.');
          const normalized = await normalizeTransactions(page.transactions, { accountKey, accountLabel: maskAccount(account, {name: conn.bank_name, country: conn.country}), bankName: conn.bank_name, dateFrom: from, dateTo: to });
          rows.push(...normalized.rows);
          skipped += normalized.skipped.pending + normalized.skipped.nonSek + normalized.skipped.invalid;
          normalized.warnings.forEach(warning => warnings.add(warning));
          continuationKey = page.continuation_key || undefined;
          if (continuationKey) {
            if (typeof continuationKey !== 'string' || seen.has(continuationKey)) throw new BankError('Bankens sidindelning kunde inte slutföras. Inga nya bankhändelser har sparats.');
            seen.add(continuationKey);
          }
        } while (continuationKey);
      }
      warnings.add('Bankgiro kan redovisas som en samlad insättning. Komplettera vid behov med camt.054 eller bankens betalningsspecifikation innan du matchar.');
      const test = conn.environment === 'SANDBOX', at = now();
      let imported = 0;
      const runId = uid();
      const old = !test ? await readWorkspace(user.userId) : null;
      const candidateRows = rows.filter(row => {
        if (!old || !row.externalId) return true;
        const existing = old.state.transactions.find(item => canonicalBankAccount(item.account) === canonicalBankAccount(String(row.account || '')) && item.externalId === row.externalId);
        // An explicit prior exclusion stays excluded. Changed financial values
        // still enter the domain validator and stop the entire conflicting import.
        return !(existing?.ignored && existing.amount === row.amount && existing.date === row.date && existing.currency === row.currency);
      });
      if (!test && old && candidateRows.length) {
        let result: ReturnType<typeof applyCommand>;
        const command = { type: 'transactions.import', trustedBankImport:true, rows: candidateRows, account: 'Enable Banking', name: `${conn.bank_name} · bankhämtning ${from}–${to}` };
        try { result = applyCommand(old.state, command); }
        catch (error) { throw new BankError(error instanceof Error ? error.message : 'Bankhändelserna kunde inte importeras.'); }
        imported = result.state.transactions.length - old.state.transactions.length;
        skipped += rows.length - imported;
        const payload = JSON.stringify(result.state);
        if (new TextEncoder().encode(payload).length > 1_800_000) throw new BankError('Registret har nått storleksgränsen. Inga nya bankhändelser sparades. Kontakta administratören för utökad lagring.');
        await db().prepare('INSERT OR IGNORE INTO workspaces (owner,revision,payload,updated_at) VALUES (?,0,?,?)').bind(user.userId, JSON.stringify(emptyState()), at).run();
        const auditId = uid();
        const committed = await db().batch([
          db().prepare(`INSERT INTO audit_events (id,owner,revision,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM workspaces WHERE owner=? AND revision=?)`)
            .bind(auditId, user.userId, old.revision + 1, 'bank.sync', JSON.stringify({ message: `${imported} bankhändelser hämtade från ${conn.bank_name}`, command: { type: 'bank.sync', connectionId: conn.id, from, to, imported, skipped } }), at, user.userId, old.revision),
          db().prepare('UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE owner=? AND revision=?').bind(payload, at, user.userId, old.revision),
          db().prepare(`INSERT INTO bank_sync_runs (id,owner,connection_id,imported,skipped,warnings,test,created_at) SELECT ?,?,?,?,?,?,0,? WHERE EXISTS (SELECT 1 FROM audit_events WHERE id=? AND owner=?)`)
            .bind(runId, user.userId, conn.id, imported, skipped, JSON.stringify([...warnings]), at, auditId, user.userId),
          db().prepare('UPDATE bank_connections SET last_synced_at=?,last_error=NULL,updated_at=? WHERE owner=? AND id=? AND EXISTS (SELECT 1 FROM bank_sync_runs WHERE id=?)').bind(at, at, user.userId, conn.id, runId),
        ]);
        if (committed[1].meta.changes !== 1) throw new BankError('Registret ändrades under hämtningen. Uppdatera sidan och hämta igen. Inga bankhändelser skrevs över.', 409);
      } else {
        // Sandbox is intentionally never written into the financial register.
        if (test) warnings.add(`${rows.length} testhändelser lästes. Inga testuppgifter sparades bland dina riktiga bankhändelser.`);
        else skipped += rows.length;
        await db().batch([
          db().prepare('INSERT INTO bank_sync_runs (id,owner,connection_id,imported,skipped,warnings,test,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(runId, user.userId, conn.id, 0, skipped, JSON.stringify([...warnings]), test ? 1 : 0, at),
          db().prepare('UPDATE bank_connections SET last_synced_at=?,last_error=NULL,updated_at=? WHERE owner=? AND id=?').bind(at, at, user.userId, conn.id),
        ]);
      }
      // Retention is housekeeping; a failed cleanup must not report a committed
      // import as failed or overwrite its successful connection status.
      try {
        await db().prepare('DELETE FROM bank_sync_runs WHERE owner=? AND id NOT IN (SELECT id FROM bank_sync_runs WHERE owner=? ORDER BY created_at DESC LIMIT 50)').bind(user.userId, user.userId).run();
      } catch { /* A later successful run can prune older history. */ }
      if(!test)await (await import('../customer-messages')).reconcileAndPrepare(user.userId);
      return response({ message: test ? `Testhämtningen är klar. ${rows.length} testhändelser lästes utan att påverka ditt register.` : `${imported} nya bankhändelser hämtades. Kontrollera underlagen före matchning.`, imported, skipped, warnings: [...warnings], test });
    } catch (error) {
      const message = error instanceof BankError || error instanceof ProviderError ? error.message : 'Bankhändelserna kunde inte hämtas. Försök igen.';
      const expired = needsReauthorization || error instanceof ProviderError && error.code === 'BANK_RECONNECT_REQUIRED';
      await db().prepare('UPDATE bank_connections SET last_error=?,status=?,updated_at=? WHERE owner=? AND id=?').bind(message, expired ? 'reauth_required' : conn.status, now(), user.userId, conn.id).run();
      throw error;
    }
  });
}
