import { db, identity, readWorkspace, response, currentCompanyContext } from '@/lib/server';
import { applyCommand, BankImportEvidenceError, bankImportEvidenceError, prepareBankImportFailure, canonicalBankAccount, emptyState, now, uid, validDate } from '@/lib/domain';
import {
  ProviderError, providerErrorCode, getApplication, listBusinessBanks, startAuth, createSession,
  getSession, getAccountDetails, deleteSession, getTransactions, providerCooldownDiagnostic,
  type ProviderAccount, type ProviderApplication, type ProviderPsu,
} from './enable-banking';
import { normalizeTransactions, stableAccountKey } from './transactions';
import {
  accounts, application, connection, encrypt, metadata, providerConfig, configurationStatus, saveApplicationMetadata,
  sessionId, storageReady, withBankLock, type BankApplicationRow, type BankConnectionRow, type BankFlowRow, type BankLease,
  bankCompanyContext, corporateAccountEvidence, consentMetadata, currentCompanyAuthorization, assertCompanyConsent,
  revocationSessionId, bankRedirectUrl, type ConsentMetadata,
} from './store';
import { cookieValue, digest, randomToken, validFlowToken } from './security';
import { RuntimeBankError } from './runtime-config';
import { BankPeriodError, bankSyncRange, bankUtcDate, fetchBankPeriods } from './sync-periods';
import { accountReadCooldown, mergeAccountReadCooldown } from './account-read-cooldown';
import { guardedBankRead } from './account-read-guard';
import { ConsentError, bankAccountScopeError, bankAccountScopeReason, bankAccountUsageDiagnostic, planAccountUsageDetailsRead, observeAccountUsageDetails, validateCallbackParameters, validateReadScopes, validateEnableConsent, validateLegacyEnableSelection, type BankAccountUsageDiagnostic, type BankAccountUsageCounts, type AccountUsageDetailsReadReason, type AccountUsageDetailsObservationReason } from '../bank-consent-policy.js';

// Only the exact revalidation attempt may publish its selected-usage snapshot,
// after the existing failed-event write has rechecked ownership and the lease.
const revalidationUsageDiagnostics = new WeakMap<ConsentError, BankAccountUsageDiagnostic>();
type UsageDetailsDiagnostic = Readonly<{
  version: 'selected-account-usage-details-v1'; targetCount: number; attemptedCount: number; observedCount: number;
} & ({status: 'observed'; reason: 'EXACT_SELECTED_DETAILS_OBSERVED'; usage: BankAccountUsageCounts} |
  {status: 'not_read'; reason: AccountUsageDetailsReadReason} |
  {status: 'unavailable'; reason: AccountUsageDetailsObservationReason | 'DETAILS_PROVIDER_UNAVAILABLE'})>;
const revalidationUsageDetailsDiagnostics = new WeakMap<ConsentError, UsageDetailsDiagnostic>();

/** This lease authorizes only diagnostic reads under an unchanged retained
 * grant. The account-read guard owns its pending/cooldown marker; every other
 * connection field and the active application's metadata remain fixed. */
function usageDetailsLease(owner:string,app:BankApplicationRow,conn:BankConnectionRow,base:BankLease,validUntil:string) {
  const fields:readonly (keyof BankConnectionRow)[] = ['id','owner','app_generation','environment','bank_name','country',
    'encrypted_session','encrypted_accounts','selected_accounts','valid_until','date_from','status','last_synced_at','last_error',
    'created_at','updated_at','auto_sync_enabled','auto_last_attempt_at','auto_next_at','control_last_attempt_at','retry_after','sync_failures','consent_metadata'];
  let requireRestoredMarker=false;
  const expected=(key:keyof BankConnectionRow)=>conn[key]??null;
  const assert=async()=>{
    await base.assert();
    const currentApp=await application(owner),current=await connection(owner);
    if(!currentApp||!current||currentApp.owner!==app.owner||currentApp.application_id!==app.application_id||currentApp.generation!==app.generation||currentApp.metadata!==app.metadata||
      fields.some(key=>(current[key]??null)!==expected(key))||requireRestoredMarker&&current.account_evidence_retry!==conn.account_evidence_retry)throw Error('BANK_USAGE_DETAILS_CONTEXT_CHANGED');
    const info=metadata(currentApp);
    if(info.active!==true||info.kid!==app.application_id||info.environment!==conn.environment||!Array.isArray(info.services)||!info.services.includes('AIS')||!Array.isArray(info.countries)||!info.countries.includes(conn.country))throw Error('BANK_USAGE_DETAILS_CONTEXT_CHANGED');
    await providerConfig(currentApp);
    if(!Number.isFinite(Date.parse(validUntil))||Date.parse(validUntil)<=Date.now())throw Error('BANK_USAGE_DETAILS_EXPIRED');
  };
  const lease:BankLease={
    assert,
    async write(statements){
      await assert();
      // Recheck the same context and deadline inside the atomic write, including
      // the final failed-audit. A successful response alone is not publishable.
      const fence=db().prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM bank_connections WHERE ${fields.map(key=>`${key} IS ?`).join(' AND ')}${requireRestoredMarker?' AND account_evidence_retry=?':''}) AND EXISTS(SELECT 1 FROM bank_applications WHERE owner=? AND application_id=? AND generation=? AND metadata=?) AND ?>strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 1 ELSE json('BANK_USAGE_DETAILS_CONTEXT_CHANGED') END`)
        .bind(...fields.map(expected),...(requireRestoredMarker?[conn.account_evidence_retry]:[]),owner,app.application_id,app.generation,app.metadata,validUntil);
      const result=(await base.write([fence,...statements])).slice(1);
      await assert();
      return result;
    },
    async run(statement){return (await lease.write([statement]))[0];},
  };
  return {lease,requireCompletedRead(){requireRestoredMarker=true;}};
}

type FlowContext = {
  version: 1; companyId: string; actorId: string; membershipVersion: string; mode: 'company' | 'legacy';
  flowId: string; requiredScopes: string[]; requestedValidUntil: string;
  renewConnectionId: string; previousSessionHash: string;
};

function checkedKeys(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new BankError('Förfrågan innehåller otillåtna uppgifter.', 400);
}
function flowContext(flow: BankFlowRow): FlowContext | null {
  if (!flow.context_json) return null; // Migration-era redirects require a new authorization start.
  const value = JSON.parse(flow.context_json) as FlowContext;
  const context = bankCompanyContext(flow.owner, value.companyId);
  if (value.version !== 1 || value.actorId !== context.actorId || value.membershipVersion !== context.membershipVersion || value.mode !== 'company') throw new ConsentError('COMPANY_ACCESS_DENIED', 403);
  return value;
}
async function assertFlowActor(flow: BankFlowRow, context: FlowContext | null) {
  const user = await identity(), actor=user.userId;
  if (actor !== flow.owner || context && bankCompanyContext(actor).actorId !== context.actorId) throw new ConsentError('COMPANY_ACCESS_DENIED', 403);
  bankCompanyContext(actor, context?.companyId);
  if (!Number.isFinite(Date.parse(flow.expires_at)) || Date.parse(flow.expires_at) <= Date.now()) throw new ConsentError('CONSENT_FLOW_EXPIRED', 409);
}
function flowCookie(stateHash: string) { return `${COOKIE}-${stateHash.slice(0, 32)}`; }

export { BANK_REDIRECT_URL } from './runtime-config';
const COOKIE = '__Secure-mg-bank-flow';
const FLOW_AGE_MS = 15 * 60_000;
const POSTPROCESS_WARNING='Bankhändelserna är sparade. Efterkontrollen behöver köras igen via betalningskontrollen.';
const COMMITTED_REPLY_WARNING='Bankkörningen är sparad. Svaret kunde inte bekräftas; kontrollera status innan nästa hämtning.';
const BANK_JOB_ERROR_CODES=new Set([
  'BANK_RATE_LIMIT','BANK_TIMEOUT','BANK_NETWORK_ERROR','BANK_RECONNECT_REQUIRED','BANK_AUTHORIZATION_EXPIRED',
  'BANK_PERIOD_UNAVAILABLE','BANK_DATE_RANGE_INVALID','BANK_ACCOUNT_UNAVAILABLE','BANK_ACTION_REQUIRED',
  'BANK_USER_CONTEXT_REQUIRED','BANK_UNAVAILABLE','BANK_SYNC_RESTART_REQUIRED','BANK_RESOURCE_UNAVAILABLE','BANK_SERVICE_ERROR',
  'BANK_INVALID_RESPONSE','BANK_INCOMPLETE_RESPONSE','BANK_SYNC_LIMIT',
  'INVALID_REQUEST','INVALID_PROVIDER_RESPONSE','INVALID_CONFIGURATION','INVALID_PRIVATE_KEY','RESPONSE_TOO_LARGE',
  'NO_LINKED_ACCOUNTS','CALLBACK_NOT_REGISTERED','PROVIDER_AUTHORIZATION_FAILED','PROVIDER_ACCESS_DENIED','PROVIDER_REDIRECT_DENIED',
]);
// Persist only known policy diagnostics. ConsentError permits a caller-supplied
// message, so reconstruct the canonical text instead of retaining that input.
const BANK_CONSENT_DIAGNOSTIC_CODES = new Set([
  'COMPANY_ACCESS_DENIED', 'INVALID_CONSENT_SCOPES', 'BANKGIRO_SCOPE_UNAVAILABLE',
  'BANK_CONSENT_INVALID', 'BANK_CONSENT_EXPIRED', 'BANK_ACCOUNT_SCOPE_INVALID',
  'BANK_TRANSACTION_SCOPE_REQUIRED', 'CORPORATE_AUTHORIZATION_REQUIRED',
]);
function bankConsentDiagnostic(error: unknown): { code: string; message: string } | null {
  try {
    if (!(error instanceof ConsentError)) return null;
    const code = error.code;
    if (typeof code !== 'string' || !BANK_CONSENT_DIAGNOSTIC_CODES.has(code)) return null;
    return { code, message: new ConsentError(code).message };
  } catch { return null; }
}
function bankJobErrorCode(error:unknown):string{
  const consent=bankConsentDiagnostic(error);if(consent)return consent.code;
  const code=providerErrorCode(error)??(error instanceof BankPeriodError?error.code:undefined);
  return typeof code==='string'&&BANK_JOB_ERROR_CODES.has(code)?code:'BANK_SYNC_FAILED';
}
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
  if(conn.sync_failures>=3)return null;
  // Re-anchor prior interval-based reservations to the fixed cloud schedule.
  // Browser checks cannot shift the next cloud run several hours forward.
  const scheduled=conn.auto_next_at && conn.auto_last_attempt_at ? Date.parse(nextAutomaticAttempt(Date.parse(conn.auto_last_attempt_at))) : 0;
  const next=Math.max(scheduled,Date.parse(conn.retry_after||'')||0);
  return next?new Date(next).toISOString():null;
}

export class BankError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function bankFailure(error: unknown): Response {
  const code = error instanceof Error ? error.message : '';
  if (code === 'AUTH_REQUIRED') return response({ error: 'Logga in med ChatGPT för att hantera din bankanslutning.', signIn: '/signin-with-chatgpt?return_to=%2Fbank' }, 401);
  if (code === 'ORIGIN_DENIED') return response({ error: 'Åtgärden måste startas från MG Fakturakoll.' }, 403);
  if (code === 'BANK_CONSENT_OUTCOME_UNKNOWN') return response({error:'Bankkontrollen kan ha sparats, men resultatet kunde inte bekräftas. Uppdatera anslutningens status innan du försöker igen.',code,status_unknown:true},503);
  if (code === 'BANK_LEASE_LOST') return response({ error: 'Bankkörningens lås har löpt ut. Uppgifterna från det försenade svaret sparades inte.' }, 409);
  if (code === 'BANK_BUSY') return response({ error: 'En bankåtgärd pågår redan. Vänta tills den är klar innan du försöker igen.' }, 409);
  if (code === 'BANK_STORAGE_UNAVAILABLE') return response({ error: 'Säker lagring för bankanslutningen är inte konfigurerad ännu.' }, 503);
  if (code === 'BANK_SECRET_UNREADABLE') return response({ error: 'Bankanslutningens skyddade uppgifter kunde inte läsas. Kontakta administratören.' }, 503);
  if (error instanceof RuntimeBankError || code === 'BANK_RUNTIME_CONFIGURATION_CHANGED') return response({ error: 'Banktjänsten behöver aktiveras av systemadministratören.' }, 409);
  if (error instanceof BankError) return response({ error: error.message }, error.status);
  if (error instanceof ConsentError) {
    const consentCode=error.code,reason=bankAccountScopeReason(error);
    const usageDiagnostic=consentCode==='BANK_ACCOUNT_SCOPE_INVALID'&&error.status===409&&reason==='ACCOUNT_USAGE_INVALID'?revalidationUsageDiagnostics.get(error):undefined;
    const usageDetailsDiagnostic=usageDiagnostic?revalidationUsageDetailsDiagnostics.get(error):undefined;
    return response({error:consentCode==='BANK_ACCOUNT_SCOPE_INVALID'?new ConsentError(consentCode).message:error.message,code:consentCode,...(reason?{reason}:{}),...(usageDiagnostic?{usageDiagnostic}:{}),...(usageDetailsDiagnostic?{usageDetailsDiagnostic}:{})},error.status);
  }
  if (error instanceof BankPeriodError) return response({error: error.message, code: error.code}, error.code === 'BANK_DATE_RANGE_INVALID' ? 400 : 409);
  if (error instanceof ProviderError) {
    const result = response({ error: error.message, code: error.code, ...(error.retryAfter?{retryAfter:error.retryAfter}:{}) }, error.status === 429 ? 429 : error.code === 'BANK_DATE_RANGE_INVALID' ? 400 : 502);
    if (Number.isSafeInteger(error.retryAfter) && error.retryAfter! > 0) result.headers.set('Retry-After', String(error.retryAfter));
    return result;
  }
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
  if (typeof value !== 'string' || !validDate(value) || value < '2000-01-01' || value > bankUtcDate()) throw new BankError('Välj ett startdatum mellan 1 januari 2000 och dagens UTC-datum.');
  return value;
}

function storedStatus(row: BankConnectionRow): string {
  return ['connected', 'pending_account', 'corporate_authorization_required'].includes(row.status) &&
    (!Number.isFinite(Date.parse(row.valid_until)) || Date.parse(row.valid_until) <= Date.now()) ? 'expired' : row.status;
}

function maskAccount(account: ProviderAccount, bank: {name: string; country: string}): string {
  const key = stableAccountKey(account, bank);
  // A primary identification hash is a stable identity, not an account number.
  const ending = key && !key.startsWith('enable-account:') ? key.replace(/\s/g, '').slice(-4) : '';
  return [account.name?.slice(0, 80) || 'Bankkonto', ending ? `•••• ${ending}` : 'kontonummer saknas'].join(' · ');
}

function safeApplication(app: ProviderApplication, redirectUrl: string | null) {
  return { name: app.name, environment: app.environment, active: app.active, redirectConfigured: !!redirectUrl&&app.redirect_urls.includes(redirectUrl) };
}

async function checkedApplication(row: NonNullable<Awaited<ReturnType<typeof application>>>, requireActive = true, lease?: BankLease) {
  const info = await getApplication(await providerConfig(row));
  if (info.kid !== row.application_id || info.environment !== metadata(row).environment || !info.services.includes('AIS') || !info.countries.includes('SE') || !info.redirect_urls.includes(bankRedirectUrl())) throw new BankError('Banktjänsten behöver aktiveras av systemadministratören. Kontrollera registrerad miljö, svensk läsåtkomst och returadress hos Enable Banking.', 409);
  await saveApplicationMetadata(row, info, lease);
  if (requireActive && !info.active) throw new BankError('Banktjänsten behöver aktiveras av systemadministratören. Enable Banking har ännu inte godkänt applikationen.', 409);
  return info;
}

export async function status(request: Request): Promise<Response> {
  const user = await identity();
  const params = new URL(request.url).searchParams;
  if (params.getAll('companyId').length > 1) throw new ConsentError('COMPANY_ACCESS_DENIED', 403);
  const company = bankCompanyContext(user.userId, params.get('companyId') ?? undefined, 'read');
  const [storedApp, conn, run] = await Promise.all([
    application(user.userId), connection(user.userId),
    db().prepare('SELECT created_at,imported,skipped,warnings,test FROM bank_sync_runs WHERE owner=? ORDER BY created_at DESC,rowid DESC LIMIT 1').bind(user.userId).first<{ created_at: string; imported: number; skipped: number; warnings: string; test: number }>(),
  ]);
  let app = storedApp;
  if (app && new URL(request.url).searchParams.get('refresh') === '1') {
    const info = await checkedApplication(app, false);
    const at = now(), updatedMetadata = JSON.stringify(info);
    app = { ...app, metadata: updatedMetadata, updated_at: at };
  }
  const selected: string[] = conn ? JSON.parse(conn.selected_accounts) : [];
  const bankAccounts = conn && storageReady() ? await accounts(conn) : [];
  const savedConsent = conn ? consentMetadata(conn) : null;
  const authority = conn ? await currentCompanyAuthorization(conn) : null;
  const needsAuthority = savedConsent?.mode === 'company' && authority?.status !== 'verified';
  const visibleConnectionStatus = conn ? storedStatus(conn) === 'corporate_authorization_required' && !needsAuthority ? 'pending_account' : storedStatus(conn) : null;
  const latestFlow = await db().prepare('SELECT * FROM bank_auth_flows WHERE owner=? ORDER BY created_at DESC,rowid DESC LIMIT 1').bind(user.userId).first<BankFlowRow>();
  const context = latestFlow ? flowContext(latestFlow) : null;
  const requiresRestart = latestFlow && ['pending', 'exchanging'].includes(latestFlow.status) && !context;
  const expiredFlow = latestFlow && ['pending', 'exchanging'].includes(latestFlow.status) && (Date.parse(latestFlow.expires_at) <= Date.now() || requiresRestart);
  const workspace = await readWorkspace(company.storageOwnerId);
  let redirectUrl:string|null=null;
  try{redirectUrl=bankRedirectUrl();}catch{/* A bad callback must not hide the existing connection's read-only status. */}
  const originMatches=!!redirectUrl&&new URL(redirectUrl).origin===new URL(request.url).origin;
  const callback={originMatches,canStartAuthorization:originMatches,
    reason:!redirectUrl?'Bankens returadress behöver konfigureras av administratören.':!originMatches?'Bankens returadress hör till en annan webbplats. Administratören behöver ange den här webbplatsens godkända returadress och registrera samma adress hos Enable Banking.':null};
  return response({
    company: { id: company.companyId, name: workspace.state.company.name, canManageBank: ['owner','admin'].includes(company.role), membershipMode: company.membershipVersion==='legacy-owner-v1'?'legacy_workspace':'company' },
    consentFlow: latestFlow ? { id: context?.flowId ?? null, companyId: context?.companyId ?? company.companyId,
      status: expiredFlow ? 'expired' : latestFlow.status, expiresAt: latestFlow.expires_at,
      reason: requiresRestart ? 'CONSENT_RESTART_REQUIRED' : expiredFlow ? latestFlow.status === 'pending' ? 'CALLBACK_NOT_RECEIVED' : 'AUTHORIZATION_OUTCOME_UNKNOWN' : latestFlow.result_code || null,
      connectionId: latestFlow.connection_id || null } : null,
    storageReady: storageReady(), configured: Boolean(app), activation: configurationStatus(),
    application: app ? safeApplication(metadata(app),redirectUrl) : null,
    redirectUrl, callback, syncMode: conn?.auto_sync_enabled === 1 ? 'automatic' : 'manual',
    automatic: { enabled: conn?.auto_sync_enabled === 1, intervalHours: 6, lastAttemptAt: conn?.auto_last_attempt_at ?? null, nextAttemptAt: conn ? automaticDueAt(conn) : null, blocked: (conn?.sync_failures||0)>=3, failures:conn?.sync_failures||0 },
    connection: conn ? {
      id: conn.id, bankName: conn.bank_name, environment: conn.environment, status: conn.encrypted_session && (!app || conn.app_generation !== app.generation) ? 'reauth_required' : needsAuthority && !['disconnected','revocation_pending','expired'].includes(storedStatus(conn)) ? 'corporate_authorization_required' : visibleConnectionStatus,
      consent: { version: 'bank-consent-v1', companyId: savedConsent?.companyId ?? company.companyId,
        mode: savedConsent?.mode ?? 'legacy', grantedScopes: savedConsent?.grantedScopes ?? ['accounts:read','transactions:read'],
        corporateAuthorization: authority, bankgiro: { status: 'unavailable', reason: 'BANKGIRO_SCOPE_UNAVAILABLE' } },
      validUntil: conn.valid_until, lastSyncedAt: conn.last_synced_at, lastError: conn.last_error,
      dateFrom: conn.date_from,
      postprocessWarning:run&&JSON.parse(run.warnings).includes(POSTPROCESS_WARNING)?POSTPROCESS_WARNING:null,
      accounts: bankAccounts.map(account => ({
        uid: account.uid, label: maskAccount(account, {name: conn.bank_name, country: conn.country}), currency: account.currency || '',
        selected: selected.includes(account.uid),
        importable: account.currency === 'SEK' && account.usage !== 'PRIV' && !needsAuthority &&
          (savedConsent?.mode !== 'company' || authority?.status === 'verified' && authority.accountUids.includes(account.uid)) &&
          Boolean(stableAccountKey(account, { name: conn.bank_name, country: conn.country })),
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
  return withBankLock(user.userId, async lease => {
    const conn = await connection(user.userId);
    if (conn?.encrypted_session) throw new BankError('Koppla från banken innan du tar bort applikationsuppgifterna.', 409);
    await lease.write([
      db().prepare('DELETE FROM bank_applications WHERE owner=?').bind(user.userId),
      db().prepare('DELETE FROM bank_auth_flows WHERE owner=?').bind(user.userId),
    ]);
    return response({ message: 'Applikationsuppgifterna är borttagna. Tidigare importerade bankhändelser finns kvar.' });
  });
}

export async function banks(request: Request): Promise<Response> {
  const user = await identity();
  bankCompanyContext(user.userId, new URL(request.url).searchParams.get('companyId') ?? undefined);
  const row = await application(user.userId);
  if (!row || !storageReady()) throw new BankError('Banktjänsten behöver aktiveras av systemadministratören.', 409);
  const config = await providerConfig(row);
  await checkedApplication(row);
  const entries = await listBusinessBanks(config);
  return response({ banks: entries.filter(bank => bank.country === 'SE' && bank.psu_types.includes('business')).map(bank => ({ name: bank.name, country: bank.country, maximumConsentSeconds: bank.maximum_consent_validity, corporateSupported: true, bankgiroSupported: false, authorization: 'provider_redirect' })) });
}

export async function connect(request: Request): Promise<Response> {
  const user = await identity(request), body = await jsonBody(request), from = dateFrom(body.dateFrom);
  checkedKeys(body, ['companyId', 'bankName', 'country', 'dateFrom', 'requiredScopes', 'renewConnectionId']);
  const company = bankCompanyContext(user.userId, body.companyId);
  const redirectUrl=bankRedirectUrl();
  if(new URL(request.url).origin!==new URL(redirectUrl).origin)throw new BankError('Bankens returadress hör till en annan webbplats. Administratören behöver uppdatera och registrera rätt returadress innan du ansluter banken.',409);
  const requiredScopes = validateReadScopes(body.requiredScopes);
  if (requiredScopes.includes('bankgiro:read')) throw new ConsentError('BANKGIRO_SCOPE_UNAVAILABLE', 409);
  if (body.renewConnectionId !== undefined && (typeof body.renewConnectionId !== 'string' || !body.renewConnectionId || body.renewConnectionId.length > 200)) throw new BankError('Välj anslutningen som ska förnyas.');
  if (typeof body.bankName !== 'string' || body.bankName.length > 200 || body.country !== 'SE') throw new BankError('Välj en svensk företagsbank i listan.');
  return withBankLock(user.userId, async lease => {
    const app = await application(user.userId);
    if (!app || !storageReady()) throw new BankError('Banktjänsten behöver aktiveras av systemadministratören.', 409);
    const existing = await connection(user.userId);
    if (body.renewConnectionId && (!existing?.encrypted_session || existing.id !== body.renewConnectionId)) throw new BankError('Anslutningen som ska förnyas finns inte för företaget.', 409);
    if (existing?.encrypted_session && !body.renewConnectionId) throw new BankError('Det finns redan en bankanslutning. Välj Förnya anslutningen.', 409);
    if (existing && body.renewConnectionId && existing.bank_name !== body.bankName) throw new BankError('Förnya med samma bank. Koppla från anslutningen för att byta bank.', 409);
    const pending = await db().prepare("SELECT count(*) AS total FROM bank_auth_flows WHERE owner=? AND status IN ('pending','exchanging') AND expires_at>?").bind(user.userId, now()).first<{ total: number }>();
    if ((pending?.total ?? 0) >= 5) throw new BankError('Fem anslutningsförsök pågår. Slutför ett försök eller vänta tills det löper ut.', 429);
    const config = await providerConfig(app), info = await checkedApplication(app, true, lease);
    const available = await listBusinessBanks(config);
    const bank = available.find(item => item.name === body.bankName && item.country === 'SE' && item.psu_types.includes('business'));
    if (!bank) throw new ConsentError('BUSINESS_BANK_UNAVAILABLE', 409);
    if (!Number.isFinite(bank.maximum_consent_validity) || bank.maximum_consent_validity < 60) throw new BankError('Banken kunde inte ange en giltig period för anslutningen.');
    const validUntil = new Date(Date.now() + Math.min(bank.maximum_consent_validity, 90 * 86400) * 1000 - 30_000).toISOString();
    const state = randomToken(), cookie = randomToken(), stateHash = await digest(state), at = now();
    const context: FlowContext = { version: 1, companyId: company.companyId, actorId: company.actorId, membershipVersion: company.membershipVersion,
      mode: 'company',
      flowId: uid(), requiredScopes, requestedValidUntil: validUntil, renewConnectionId: body.renewConnectionId as string || '',
      previousSessionHash: existing?.encrypted_session ? await digest(existing.encrypted_session) : '' };
    if ((await identity()).userId !== user.userId) throw new ConsentError('COMPANY_ACCESS_DENIED', 403);
    await lease.write([
      db().prepare('DELETE FROM bank_auth_flows WHERE owner=? AND expires_at<?').bind(user.userId, new Date(Date.now() - 86400_000).toISOString()),
      db().prepare(`INSERT INTO bank_auth_flows (state_hash,owner,cookie_hash,app_generation,bank_name,country,environment,redirect_uri,date_from,expires_at,status,created_at,context_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(stateHash, user.userId, await digest(cookie), app.generation, bank.name, bank.country, info.environment, redirectUrl, from, new Date(Date.now() + FLOW_AGE_MS).toISOString(), 'pending', at, JSON.stringify(context)),
    ]);
    try {
      const result = await startAuth(config, { bank: { name: bank.name, country: bank.country }, state, redirectUrl, validUntil });
      await lease.assert();
      if ((await identity()).userId !== user.userId) throw new ConsentError('COMPANY_ACCESS_DENIED', 403);
      return Response.json({ url: result.url, companyId: company.companyId, flowId: context.flowId, requiredScopes, authorization: 'provider_redirect', pkce: 'not_exposed_by_adapter' }, { headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'Set-Cookie': `${flowCookie(stateHash)}=${cookie}; Path=/api/bank/callback; Secure; HttpOnly; SameSite=Lax; Max-Age=900` } });
    } catch (error) {
      await lease.run(db().prepare("UPDATE bank_auth_flows SET status='failed',result_code='AUTHORIZATION_START_FAILED' WHERE state_hash=? AND owner=?").bind(stateHash, user.userId));
      throw error;
    }
  });
}

function callbackRedirect(result: string, cookieName?: string): Response {
  return new Response(null, { status: 303, headers: {
    Location: `/bank?result=${result}`, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
    ...(cookieName ? { 'Set-Cookie': `${cookieName}=; Path=/api/bank/callback; Secure; HttpOnly; SameSite=Lax; Max-Age=0` } : {}),
  } });
}

export async function callback(request: Request): Promise<Response> {
  const callbackUrl = new URL(request.url), params = callbackUrl.searchParams, state = params.get('state');
  if (params.getAll('state').length !== 1 || !validFlowToken(state)) return callbackRedirect('expired');
  let parsed: ReturnType<typeof validateCallbackParameters>;
  try { parsed = validateCallbackParameters(params); } catch { return callbackRedirect('failed'); }
  let owner: string;
  try { owner = (await identity()).userId; } catch { return callbackRedirect('signin_required'); }
  const stateHash = await digest(state);
  const flow = await db().prepare('SELECT * FROM bank_auth_flows WHERE state_hash=?').bind(stateHash).first<BankFlowRow>();
  if (!flow || flow.status !== 'pending' || flow.expires_at <= now()) return callbackRedirect('expired');
  const cookieName = flow.context_json ? flowCookie(stateHash) : COOKIE;
  const cookie = cookieValue(request, cookieName);
  if (!validFlowToken(cookie)) return callbackRedirect('expired');
  if (flow.owner !== owner || flow.cookie_hash !== await digest(cookie)) return callbackRedirect('wrong_user');
  if (callbackUrl.origin + callbackUrl.pathname !== flow.redirect_uri) return callbackRedirect('failed');
  if (!flow.context_json) return callbackRedirect('expired', cookieName);
  try {
    const context = flowContext(flow);
    return await withBankLock(owner, async lease => {
      await assertFlowActor(flow, context);
      const app = await application(owner);
      if (!app || app.generation !== flow.app_generation) return callbackRedirect('expired');
      const claimed = await lease.run(db().prepare("UPDATE bank_auth_flows SET status='exchanging' WHERE state_hash=? AND owner=? AND status='pending' AND expires_at>?").bind(stateHash, owner, now()));
      if (claimed.meta.changes !== 1) return callbackRedirect('expired');
      if (parsed.error) {
        const outcome = parsed.outcome || 'failed';
        await lease.run(db().prepare('UPDATE bank_auth_flows SET status=?,result_code=? WHERE state_hash=? AND owner=? AND status=\'exchanging\'').bind(outcome, outcome === 'cancelled' ? 'IDENTIFICATION_CANCELLED' : outcome === 'denied' ? 'BANK_ACCESS_DENIED' : 'BANK_AUTHORIZATION_FAILED', stateHash, owner));
        return callbackRedirect(outcome, cookieName);
      }
      const config = await providerConfig(app);
      let remoteSession = '', previousRemote = '', commitAttempted = false, replacedSessionRevoked = false;
      const existing = await connection(owner);
      const renewal = Boolean(context?.renewConnectionId);
      let resultStatus = 'connected';
      try {
        if (renewal) {
          if (!existing?.encrypted_session || existing.id !== context!.renewConnectionId || await digest(existing.encrypted_session) !== context!.previousSessionHash) throw new ConsentError('CONSENT_RENEWAL_CONFLICT', 409);
          previousRemote = await revocationSessionId(existing);
        } else if (existing?.encrypted_session) throw new BankError('Det finns redan en aktiv bankanslutning.', 409);
        const result = await createSession(config, parsed.code!);
        remoteSession = result.session_id;
        await assertFlowActor(flow, context);
        await lease.assert();
        if (previousRemote && remoteSession === previousRemote) throw new BankError('Banken återanvände det tidigare medgivandet.', 502);
        const checked = await getSession(config, result.session_id);
        await assertFlowActor(flow, context);
        await lease.assert();
        const grant = validateEnableConsent({ session: result, checked, bankName: flow.bank_name, country: flow.country,
          requestedValidUntil: context?.requestedValidUntil ?? result.access.valid_until, requestedScopes: context?.requiredScopes });
        const company = bankCompanyContext(owner, context?.companyId);
        const available = result.accounts.filter(account => grant.accountUids.includes(account.uid));
        const authority = corporateAccountEvidence(company, flow.bank_name, flow.country, available, grant.validUntil) ??
          { status: 'unverified' as const, reason: 'CORPORATE_AUTHORIZATION_REQUIRED' };
        const validUntil = authority.status === 'verified' ? authority.validUntil : grant.validUntil;
        const mode = context?.mode ?? 'legacy';
        if (renewal && mode === 'company' && authority.status !== 'verified') throw new ConsentError('CORPORATE_AUTHORIZATION_REQUIRED', 409);
        const consent: ConsentMetadata = { version: 'bank-consent-v1', mode, companyId: company.companyId, actorId: company.actorId,
          membershipVersion: company.membershipVersion, requestedScopes: context?.requiredScopes ?? ['accounts:read','transactions:read'],
          grantedScopes: grant.grantedScopes, validUntil, corporateAuthorization: authority };
        const syncScope = existing?.status === 'disconnected' ? await db().prepare('SELECT company_id,evidence_id,revision FROM company_bank_sync_scopes WHERE owner=?').bind(owner).first<{company_id:string;evidence_id:string;revision:number}>() : null;
        // Reconnecting the same owned bank retains its durable quota namespace.
        // The new corporate grant is still independently verified above.
        const reconnect = !!syncScope && !!existing && existing.status === 'disconnected' && !existing.encrypted_session && existing.bank_name === flow.bank_name && existing.country === flow.country && existing.environment === flow.environment;
        const preserveNamespace = renewal || reconnect;
        const id = preserveNamespace ? existing!.id : uid(), at = now();
        const status = mode === 'company' ? authority.status === 'verified' ? 'pending_account' : 'corporate_authorization_required' : 'connected';
        resultStatus = status === 'pending_account' ? 'select_account' : status;
        const encryptedSession = await encrypt(owner, `session:${id}`, result.session_id);
        const encryptedAccounts = await encrypt(owner, `accounts:${id}`, available);
        if (previousRemote) {
          await assertFlowActor(flow, context);
          // Remote deletion and the local replacement cannot be one atomic
          // transaction. Record the potentially closed old session before the
          // outbound request, so a lost response never leaves a usable claim.
          const paused = await lease.run(db().prepare(`UPDATE bank_connections SET status='reauth_required',auto_sync_enabled=0,auto_next_at=NULL,
            last_error='Förnyelsen påbörjade återkallelse av den tidigare sessionen. Kontrollera status eller förnya igen om svaret uteblir.',updated_at=?
            WHERE owner=? AND id=? AND encrypted_session=? AND ?>strftime('%Y-%m-%dT%H:%M:%fZ','now')
            AND EXISTS(SELECT 1 FROM bank_auth_flows WHERE state_hash=? AND owner=? AND status='exchanging' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
            .bind(now(), owner, existing!.id, existing!.encrypted_session, validUntil, stateHash, owner));
          if (paused.meta.changes !== 1) throw new ConsentError('CONSENT_FLOW_EXPIRED', 409);
          await lease.assert();
          try { await deleteSession(config, previousRemote); }
          catch (error) { if (!(error instanceof ProviderError) || error.code !== 'BANK_RECONNECT_REQUIRED') throw error; }
          replacedSessionRevoked = true;
        }
        await assertFlowActor(flow, context);
        if ((await application(owner))?.generation !== app.generation) throw new ConsentError('CONSENT_APPLICATION_CHANGED', 409);
        // The existing lease and this flow/connection predicate fence the same
        // atomic batch, including replacement races at D1's actual write boundary.
        const connectionPredicate = preserveNamespace ? 'EXISTS(SELECT 1 FROM bank_connections WHERE owner=? AND id=? AND encrypted_session=?)' : "NOT EXISTS(SELECT 1 FROM bank_connections WHERE owner=? AND encrypted_session<>'')";
        const fence = db().prepare(`INSERT INTO bank_locks(owner,token,expires_at) VALUES(?,
          (SELECT token FROM bank_locks WHERE owner=? AND EXISTS(SELECT 1 FROM bank_auth_flows WHERE state_hash=? AND owner=? AND status='exchanging' AND context_json=? AND cookie_hash=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
          AND ? > strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${connectionPredicate}),?) ON CONFLICT(owner) DO UPDATE SET token=excluded.token`)
          .bind(owner, owner, stateHash, owner, flow.context_json, flow.cookie_hash, validUntil, owner,
            ...(preserveNamespace ? [existing!.id, existing!.encrypted_session] : []), flow.expires_at);
        const scopeFence = reconnect ? [db().prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM company_bank_sync_scopes WHERE company_id=? AND owner=? AND evidence_id=? AND revision=?) THEN 1 ELSE json('COMPANY_SCOPE_MISMATCH') END").bind(syncScope!.company_id,owner,syncScope!.evidence_id,syncScope!.revision)] : [];
        commitAttempted = true;
        await lease.write([
          fence,
          ...scopeFence,
          db().prepare(`INSERT INTO bank_connections (id,owner,app_generation,environment,bank_name,country,encrypted_session,encrypted_accounts,selected_accounts,valid_until,date_from,status,created_at,updated_at,consent_metadata)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner) DO UPDATE SET id=excluded.id,app_generation=excluded.app_generation,environment=excluded.environment,bank_name=excluded.bank_name,country=excluded.country,encrypted_session=excluded.encrypted_session,encrypted_accounts=excluded.encrypted_accounts,selected_accounts=excluded.selected_accounts,valid_until=excluded.valid_until,date_from=excluded.date_from,status=excluded.status,last_synced_at=NULL,last_error=NULL,auto_sync_enabled=0,auto_next_at=NULL,auto_last_attempt_at=NULL,retry_after=${preserveNamespace?'bank_connections.retry_after':"''"},sync_failures=0,consent_metadata=excluded.consent_metadata,created_at=excluded.created_at,updated_at=excluded.updated_at`)
            .bind(id, owner, app.generation, flow.environment, flow.bank_name, flow.country, encryptedSession, encryptedAccounts, '[]', validUntil, flow.date_from, status, preserveNamespace?existing!.created_at:at, at, JSON.stringify(consent)),
          db().prepare("UPDATE bank_auth_flows SET status='completed',result_code=?,connection_id=? WHERE state_hash=? AND owner=? AND status='exchanging'").bind(authority.status === 'verified' ? 'BANK_CONSENT_APPROVED' : 'CORPORATE_AUTHORIZATION_REQUIRED', id, stateHash, owner),
        ]);
        return callbackRedirect(resultStatus, cookieName);
      } catch (error) {
        // A lost commit response must never revoke a session now used locally.
        if (commitAttempted) {
          try {
            const current = await connection(owner);
            if (current?.encrypted_session && await revocationSessionId(current) === remoteSession) return callbackRedirect(resultStatus, cookieName);
          } catch { return callbackRedirect('failed', cookieName); }
        }
        // A newer worker may own the remote session after this worker's lease
        // expires. Cleanup is a mutation too: uncertain ownership leaves the
        // unfinished flow visible until expiry and never revokes another run.
        try { await lease.assert(); } catch { return callbackRedirect('failed', cookieName); }
        if (remoteSession && remoteSession !== previousRemote) {
          try {
            const current = await connection(owner);
            if (current?.encrypted_session && await revocationSessionId(current) === remoteSession) return callbackRedirect('failed', cookieName);
            await lease.assert();
            await deleteSession(config, remoteSession);
          } catch { /* No local activation; the provider expiry remains the fallback. */ }
        }
        if (replacedSessionRevoked && existing) await lease.run(db().prepare("UPDATE bank_connections SET status='reauth_required',auto_sync_enabled=0,updated_at=? WHERE owner=? AND id=? AND encrypted_session=?").bind(now(), owner, existing.id, existing.encrypted_session));
        const reason = error instanceof ConsentError ? error.code : 'BANK_AUTHORIZATION_FAILED';
        await lease.run(db().prepare("UPDATE bank_auth_flows SET status='failed',result_code=? WHERE state_hash=? AND owner=? AND status='exchanging'").bind(reason, stateHash, owner));
        return callbackRedirect(reason === 'CORPORATE_AUTHORIZATION_REQUIRED' ? 'corporate_authorization_required' : 'failed', cookieName);
      }
    });
  } catch (error) {
    // A busy owner lock has not claimed this flow; preserve its browser binding
    // so the user can retry the same callback while it is still pending.
    return callbackRedirect(error instanceof Error && error.message === 'BANK_BUSY' ? 'retry' : 'failed', error instanceof Error && error.message === 'BANK_BUSY' ? undefined : cookieName);
  }
}

export async function selectAccounts(request: Request): Promise<Response> {
  const user = await identity(request), body = await jsonBody(request);
  checkedKeys(body, ['companyId','connectionId','accountUids','dateFrom']);
  const company = bankCompanyContext(user.userId, body.companyId);
  if (!Array.isArray(body.accountUids) || body.accountUids.length < 1 || body.accountUids.length > 20 || body.accountUids.some(id => typeof id !== 'string')) throw new BankError('Välj mellan 1 och 20 konton.');
  return withBankLock(user.userId, async lease => {
    const conn = await connection(user.userId), app = await application(user.userId);
    if (!conn || !app || app.generation !== conn.app_generation || conn.id !== body.connectionId || !['connected','pending_account','corporate_authorization_required'].includes(conn.status) || Date.parse(conn.valid_until) <= Date.now()) throw new BankError('Anslut banken igen innan du väljer konton.');
    await assertCompanyConsent(conn);
    const available = await accounts(conn), selected = [...new Set(body.accountUids as string[])];
    if (!selected.every(id => available.some(account => account.uid === id && account.currency === 'SEK' && account.usage !== 'PRIV' && stableAccountKey(account, { name: conn.bank_name, country: conn.country })))) throw new BankError('Endast tillgängliga SEK-konton med en stabil kontoidentifierare kan importeras.');
    const savedConsent = consentMetadata(conn);
    const authority = await currentCompanyAuthorization(conn);
    if (savedConsent?.mode === 'company' && (authority.status !== 'verified' || selected.some(id => !authority.accountUids.includes(id)))) throw new ConsentError('CORPORATE_AUTHORIZATION_REQUIRED', 409);
    const live = await guardedBankRead(user.userId, conn, lease, async () => getSession(await providerConfig(app), await revocationSessionId(conn)));
    const consentInput = { session: { accounts: available, access: { valid_until: conn.valid_until }, aspsp: { name: conn.bank_name, country: conn.country }, psu_type: 'business' },
      checked: live, bankName: conn.bank_name, country: conn.country, requestedValidUntil: conn.valid_until, requestedScopes: savedConsent?.requestedScopes };
    const grant = savedConsent?.mode === 'company' ? validateEnableConsent(consentInput)
      : validateLegacyEnableSelection({ ...consentInput, selectedAccountUids: selected });
    if (!selected.every(id => grant.accountUids.includes(id))) throw new BankError('Kontot ingår inte längre i bankens medgivande.', 409);
    if ((await identity()).userId !== company.actorId) throw new ConsentError('COMPANY_ACCESS_DENIED', 403);
    bankCompanyContext(user.userId, savedConsent?.companyId ?? company.companyId);
    const currentAuthority = await assertCompanyConsent(conn);
    const validUntil = currentAuthority ? new Date(Math.min(Date.parse(grant.validUntil), Date.parse(currentAuthority.validUntil))).toISOString() : grant.validUntil;
    const from = body.dateFrom === undefined ? conn.date_from : dateFrom(body.dateFrom);
    const previous: string[] = JSON.parse(conn.selected_accounts);
    const scopeChanged = from !== conn.date_from || previous.length !== selected.length || previous.some(id => !selected.includes(id));
    const updated = await lease.run(db().prepare("UPDATE bank_connections SET selected_accounts=?,date_from=?,status='connected',valid_until=?,last_synced_at=CASE WHEN ? THEN NULL ELSE last_synced_at END,updated_at=? WHERE owner=? AND id=? AND encrypted_session=? AND ? > strftime('%Y-%m-%dT%H:%M:%fZ','now')")
      .bind(JSON.stringify(selected), from, validUntil, Number(scopeChanged), now(), user.userId, conn.id, conn.encrypted_session, validUntil));
    if (updated.meta.changes !== 1) throw new BankError('Bankanslutningen ändrades. Läs aktuell status och försök igen.', 409);
    return response({ message: 'Konton och startdatum är sparade. Du kan nu hämta bankhändelser.' });
  });
}

export async function disconnect(request: Request): Promise<Response> {
  const user = await identity(request);
  const body = await jsonBody(request);
  checkedKeys(body, ['companyId','connectionId']);
  bankCompanyContext(user.userId, body.companyId);
  return withBankLock(user.userId, async lease => {
    const app = await application(user.userId), conn = await connection(user.userId);
    if (body.connectionId !== undefined && conn?.id !== body.connectionId) throw new BankError('Bankanslutningen tillhör inte företaget.', 404);
    if (!conn?.encrypted_session) {
      await lease.run(db().prepare("UPDATE bank_auth_flows SET status='cancelled',result_code='DISCONNECTED' WHERE owner=? AND status IN ('pending','exchanging')").bind(user.userId));
      return response({ message: 'Det finns ingen aktiv bankanslutning.' });
    }
    if (!app || app.generation !== conn.app_generation) {
      // Previously browser-uploaded keys are compromised and must never be used,
      // even to revoke a session. Detach locally and state the revocation limit.
      await lease.write([
        db().prepare("UPDATE bank_connections SET status='disconnected',auto_sync_enabled=0,auto_next_at=NULL,encrypted_session='',encrypted_accounts='',selected_accounts='[]',last_error=NULL,updated_at=? WHERE owner=? AND id=?").bind(now(), user.userId, conn.id),
        db().prepare('DELETE FROM bank_auth_flows WHERE owner=?').bind(user.userId),
        db().prepare("UPDATE bank_applications SET encrypted_key='' WHERE owner=?").bind(user.userId),
      ]);
      return response({ message: 'Den lokala bankkopplingen är borttagen. Det tidigare medgivandet kunde inte återkallas med en betrodd servernyckel. Återkalla det hos Swedbank eller Enable Banking innan du ansluter igen.', remoteRevoked: false });
    }
    const config = await providerConfig(app), remote = await revocationSessionId(conn);
    // A failed revocation retains the credentials so the user can retry. Do not
    // tell the user bank access was revoked when the provider did not confirm it.
    try { await deleteSession(config, remote); }
    catch (error) {
      // The provider explicitly reports this session as expired/closed/missing.
      // Network failures or rejected application credentials are not confirmation.
      if (!(error instanceof ProviderError) || error.code !== 'BANK_RECONNECT_REQUIRED') {
        // Retain encrypted credentials only for retrying revocation; stop local use.
        await lease.write([
          db().prepare("UPDATE bank_connections SET status='revocation_pending',auto_sync_enabled=0,auto_next_at=NULL,updated_at=? WHERE owner=? AND id=? AND encrypted_session=?").bind(now(), user.userId, conn.id, conn.encrypted_session),
          db().prepare("UPDATE bank_auth_flows SET status='cancelled',result_code='DISCONNECTED' WHERE owner=? AND status IN ('pending','exchanging')").bind(user.userId),
        ]);
        throw error;
      }
    }
    if ((await identity()).userId !== user.userId) throw new ConsentError('COMPANY_ACCESS_DENIED', 403);
    await lease.write([
      db().prepare("UPDATE bank_connections SET status='disconnected',auto_sync_enabled=0,auto_next_at=NULL,encrypted_session='',encrypted_accounts='',selected_accounts='[]',last_error=NULL,updated_at=? WHERE owner=? AND id=?").bind(now(), user.userId, conn.id),
      db().prepare('DELETE FROM bank_auth_flows WHERE owner=?').bind(user.userId),
    ]);
    return response({ message: 'Bankkopplingen är frånkopplad och leverantörens session är avslutad. Kontrollera i banken om ett separat bankmedgivande behöver återkallas. Tidigare importerade bankhändelser finns kvar.', providerSessionRevoked: true, bankRevocationConfirmed: false });
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
  const body = await jsonBody(request);
  checkedKeys(body, ['companyId']);
  bankCompanyContext(user.userId, body.companyId);
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
  checkedKeys(body, ['companyId','connectionId','enabled']);
  bankCompanyContext(user.userId, body.companyId);
  if (typeof body.enabled !== 'boolean' || typeof body.connectionId !== 'string') throw new BankError('Välj om automatisk hämtning ska vara på eller av.');
  return withBankLock(user.userId, async lease => {
    const conn = await connection(user.userId);
    if (!conn || conn.id !== body.connectionId || (body.enabled && (storedStatus(conn) !== 'connected' || !JSON.parse(conn.selected_accounts).length))) throw new BankError('Anslut och välj företagets konto först.');
    if (body.enabled) await assertCompanyConsent(conn);
    await lease.run(db().prepare('UPDATE bank_connections SET auto_sync_enabled=?,auto_next_at=NULL,updated_at=? WHERE owner=? AND id=?').bind(body.enabled ? 1 : 0, now(), user.userId, conn.id));
    return response({ enabled: body.enabled, message: body.enabled ? 'Automatisk bankhämtning är aktiverad.' : 'Automatisk bankhämtning är pausad.' });
  });
}

// Browser calls retain their real PSU context. A hosted task has no active PSU:
// never send the task runner's IP or browser identity to the bank as the user's.
export async function automaticSync(request?: Request): Promise<Response> {
  const user = await identity(request);
  const openPayments=await (await import('./openpayments-scheduler')).dispatchOpenPaymentsSchedule(user.userId,request);
  if(openPayments)return response(openPayments);
  const company=await (await import('./company-sync')).dispatchCompanyAutomaticSync(user.userId,{psu:request?psuHeaders(request):undefined,nextAutomaticAttempt});
  if(company)return response(company);
  const reports=await import('../bankgiro-ingest-service');
  const bankgiro=await reports.runBankgiroSource(user.userId);
  const result=await synchronizeOwner(user.userId, { automatic: true, psu: request ? psuHeaders(request) : undefined });
  return response({...await result.json() as Record<string,unknown>,bankgiro},result.status);
}

export async function automaticSyncStatus(): Promise<Response> {
  const user = await identity();
  const openPayments=await (await import('./openpayments-scheduler')).dispatchOpenPaymentsSchedule(user.userId,undefined,true);
  if(openPayments)return response(openPayments);
  const conn = await connection(user.userId);
  const run=await db().prepare('SELECT warnings FROM bank_sync_runs WHERE owner=? ORDER BY created_at DESC,rowid DESC LIMIT 1').bind(user.userId).first<{warnings:string}>();
  return response({ enabled: conn?.auto_sync_enabled === 1, connected: !!conn && storedStatus(conn) === 'connected', intervalHours: 6,
    lastSyncedAt: conn?.last_synced_at ?? null, lastAttemptAt: conn?.auto_last_attempt_at ?? null,
    nextAttemptAt: conn ? automaticDueAt(conn) : null, lastError: conn?.last_error ?? null, blocked:(conn?.sync_failures||0)>=3, failures:conn?.sync_failures||0,postprocessWarning:run&&JSON.parse(run.warnings).includes(POSTPROCESS_WARNING)?POSTPROCESS_WARNING:null });
}

/** Check the retained legacy grant after a local validation failure. This is
 * an explicit owner action, never an automatic bypass of a reconnect state.
 * Only a fresh provider-confirmed session can restore the existing selection;
 * no account, schedule, invoice or payment is created/changed. The retained
 * expiry may only be shortened to the bank's current earlier deadline. */
export async function revalidateConsent(request?: Request): Promise<Response> {
  const user=await identity(request),body=request?await jsonBody(request):{};
  checkedKeys(body,['companyId']);bankCompanyContext(user.userId,body.companyId);
  const owner=user.userId;
  const assertLegacy=async()=>{
    bankCompanyContext(owner,body.companyId);
    // Identity resolves the foundation's actual adoption, even before a bank
    // sync scope exists. Its database adapter atomically fences legacy writes
    // against a concurrent adoption; catalogue SQL stays inside that boundary.
    if((await identity()).userId!==owner||currentCompanyContext()||await db().prepare('SELECT company_id FROM company_bank_sync_scopes WHERE owner=?').bind(owner).first())throw new ConsentError('COMPANY_ACCESS_DENIED',403);
  };
  await assertLegacy();
  return withBankLock(owner,async ownerLease=>{
    const lease:BankLease={
      async assert(){await ownerLease.assert();await assertLegacy();},
      async write(statements){
        await assertLegacy();
        const fence=db().prepare("SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM company_bank_sync_scopes WHERE owner=?) THEN 1 ELSE json('COMPANY_SCOPE_MISMATCH') END").bind(owner);
        return (await ownerLease.write([fence,...statements])).slice(1);
      },
      async run(statement){return (await lease.write([statement]))[0];},
    };
    await lease.assert();
    const app=await application(owner),conn=await connection(owner);
    if(!app||!conn||app.generation!==conn.app_generation||conn.environment!==metadata(app).environment||!conn.encrypted_session)throw new BankError('En befintlig anslutning som behöver kontrolleras krävs.',409);
    if(consentMetadata(conn)?.mode==='company')throw new ConsentError('COMPANY_ACCESS_DENIED',403);
    if(!Number.isFinite(Date.parse(conn.valid_until))||Date.parse(conn.valid_until)<=Date.now())throw new ConsentError('BANK_CONSENT_EXPIRED',409);
    // The receipt identifies the exact retained grant without retaining any
    // clear-text session, account or payer data in the operational audit.
    const fingerprint=(row:BankConnectionRow,validUntil=row.valid_until)=>digest(JSON.stringify([owner,row.id,row.app_generation,row.encrypted_session,row.encrypted_accounts,row.selected_accounts,row.environment,row.bank_name,row.country,row.consent_metadata||'',validUntil]));
    const accepted=(status:string,checkedAt:string,replayed=false)=>response({status,revalidated:true,replayed,checkedAt,financialChanges:false,message:replayed?'Kontrollen av det befintliga medgivandet är redan sparad. Anslutningens aktuella status visas efter uppdatering. Inga fakturor eller betalningar har ändrats.':'Banken har bekräftat det befintliga medgivandet för de redan valda kontona. Inga fakturor eller betalningar har ändrats.'});
    if(conn.status==='connected'){
      const receipt=await db().prepare("SELECT detail,created_at FROM audit_events WHERE owner=? AND action='bank.consent.revalidated' ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(owner).first<{detail:string;created_at:string}>();
      let saved:Record<string,unknown>|null=null;try{saved=receipt?JSON.parse(receipt.detail):null;}catch{}
      if(receipt&&saved?.context_digest===await fingerprint(conn)&&Number.isFinite(Date.parse(receipt.created_at))&&Date.parse(receipt.created_at)<=Date.now())return accepted(storedStatus(conn),receipt.created_at,true);
    }
    if(conn.status!=='reauth_required')throw new BankError('En befintlig anslutning som behöver kontrolleras krävs.',409);
    if(conn.sync_failures>=3||Date.parse(conn.retry_after||'')>Date.now()||accountReadCooldown(conn.account_evidence_retry).blocked)throw new BankError('Bankens väntetid eller stoppade försök måste hanteras innan medgivandet kan kontrolleras.',409);
    const recent=await db().prepare("SELECT created_at FROM audit_events WHERE owner=? AND action='bank.consent.revalidation.started' ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(owner).first<{created_at:string}>();
    if(recent&&(!Number.isFinite(Date.parse(recent.created_at))||Date.now()-Date.parse(recent.created_at)<15*60000))throw new BankError('Medgivandet kontrollerades nyss. Vänta minst 15 minuter före ett nytt försök.',429);
    const savedAccounts=await accounts(conn),selected=JSON.parse(conn.selected_accounts),runId=uid();
    if(!Array.isArray(selected))throw bankAccountScopeError('SAVED_SELECTION_INVALID');
    if(!selected.length)throw bankAccountScopeError('SAVED_SELECTION_EMPTY');
    const event=(action:string,errorCode?:string)=>db().prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) VALUES(?,?,COALESCE((SELECT revision FROM workspaces WHERE owner=?),0),?,?,?)').bind(uid(),owner,owner,action,JSON.stringify({run_id:runId,...(errorCode?{error_code:errorCode}:{})}),now());
    await lease.run(event('bank.consent.revalidation.started'));
    let commitAttempted=false,receiptId='',contextDigest='',validationError:unknown;
    let detailsLease:BankLease|undefined,detailsDiagnostic:UsageDetailsDiagnostic|undefined;
    try{
      const config=await providerConfig(app);
      const live=await guardedBankRead(owner,conn,lease,async()=>getSession(config,await sessionId(conn)),undefined,{strictCooldown:true});
      let grant:ReturnType<typeof validateLegacyEnableSelection>;
      const consentInput={session:{accounts:savedAccounts,access:{valid_until:conn.valid_until},aspsp:{name:conn.bank_name,country:conn.country},psu_type:'business'},checked:live,bankName:conn.bank_name,country:conn.country,requestedValidUntil:conn.valid_until,requestedScopes:consentMetadata(conn)?.requestedScopes,selectedAccountUids:selected};
      try{grant=validateLegacyEnableSelection(consentInput);}
      catch(error){
        validationError=error;
        const diagnostic=bankAccountUsageDiagnostic(error);
        if(diagnostic&&diagnostic.saved.explicitNull>0){
          // Only this original failure/input pair may plan reads. Nothing is
          // substituted in the saved or fresh snapshots to make policy pass.
          const plan=planAccountUsageDetailsRead(error,consentInput);
          const validUntil=plan.status==='ready'?plan.validUntil:new Date(Math.min(Date.parse(conn.valid_until),Date.parse(live.access.valid_until))).toISOString();
          const guarded=usageDetailsLease(owner,app,conn,lease,validUntil);detailsLease=guarded.lease;
          const counts={omitted:0,orga:0,priv:0,explicitNull:0,otherString:0,wrongType:0};
          const progress={version:'selected-account-usage-details-v1' as const,targetCount:diagnostic.saved.explicitNull,attemptedCount:0,observedCount:0};
          try{
            await detailsLease.assert();
            if(plan.status==='not_read'){
              guarded.requireCompletedRead();
              detailsDiagnostic=Object.freeze({...progress,status:'not_read',reason:plan.reason});
            }else{
              for(const target of plan.targets){
                const fresh=await guardedBankRead(owner,conn,detailsLease,async()=>{
                  await detailsLease!.assert();progress.attemptedCount++;
                  return getAccountDetails(config,target.uid);
                },undefined,{strictCooldown:true});
                await detailsLease.assert();
                const observed=observeAccountUsageDetails(plan,target.uid,fresh);
                if(observed.status==='unavailable'){
                  detailsDiagnostic=Object.freeze({...progress,status:'unavailable',reason:observed.reason});break;
                }
                counts[observed.category]++;progress.observedCount++;
              }
              if(!detailsDiagnostic){
                guarded.requireCompletedRead();await detailsLease.assert();
                detailsDiagnostic=Object.freeze({...progress,status:'observed',reason:'EXACT_SELECTED_DETAILS_OBSERVED',usage:Object.freeze(counts)});
              }
            }
          }catch{
            // Provider text and partial usage counts never escape. A subsequent
            // context/audit failure also suppresses this fixed unavailable result.
            detailsDiagnostic=Object.freeze({...progress,status:'unavailable',reason:'DETAILS_PROVIDER_UNAVAILABLE'});
          }
        }
        throw error;
      }
      await lease.assert();await providerConfig(app);
      const fence=db().prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM bank_connections WHERE owner=? AND id=? AND app_generation=? AND encrypted_session=? AND encrypted_accounts=? AND selected_accounts=? AND environment=? AND bank_name=? AND country=? AND COALESCE(consent_metadata,'')=? AND status='reauth_required' AND valid_until=? AND retry_after=? AND sync_failures=? AND account_evidence_retry=? AND ?>strftime('%Y-%m-%dT%H:%M:%fZ','now')) THEN 1 ELSE json('BANK_CONSENT_CONTEXT_CHANGED') END`).bind(owner,conn.id,conn.app_generation,conn.encrypted_session,conn.encrypted_accounts,conn.selected_accounts,conn.environment,conn.bank_name,conn.country,conn.consent_metadata||'',conn.valid_until,conn.retry_after,conn.sync_failures,conn.account_evidence_retry,grant.validUntil);
      receiptId=uid();contextDigest=await fingerprint(conn,grant.validUntil);const checkedAt=now();
      const receipt=db().prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) VALUES(?,?,COALESCE((SELECT revision FROM workspaces WHERE owner=?),0),?,?,?)').bind(receiptId,owner,owner,'bank.consent.revalidated',JSON.stringify({run_id:runId,context_digest:contextDigest}),checkedAt);
      commitAttempted=true;
      await lease.write([fence,db().prepare("UPDATE bank_connections SET status='connected',valid_until=?,last_error=NULL,updated_at=? WHERE owner=? AND id=?").bind(grant.validUntil,checkedAt,owner,conn.id),receipt]);
      return accepted('connected',checkedAt);
    }catch(error){
      if(commitAttempted){
        // D1 may commit and then lose its reply. Its owner-bound success
        // receipt is authoritative, even after replacement of this lease.
        // An unreadable receipt leaves the outcome unknown, never failed.
        try{
          await assertLegacy();
          const receipt=await db().prepare("SELECT detail,created_at FROM audit_events WHERE owner=? AND id=? AND action='bank.consent.revalidated'").bind(owner,receiptId).first<{detail:string;created_at:string}>();
          if(receipt){
            const saved=JSON.parse(receipt.detail);
            if(saved.run_id!==runId||saved.context_digest!==contextDigest)throw Error('BANK_CONSENT_RECEIPT_INVALID');
            const current=await connection(owner);
            return accepted(current?storedStatus(current):'unavailable',receipt.created_at,true);
          }
        }catch{throw Error('BANK_CONSENT_OUTCOME_UNKNOWN');}
      }
      // Diagnostics contain only canonical codes and never clear a cooldown.
      try{
        await (detailsLease??lease).run(event('bank.consent.revalidation.failed',bankJobErrorCode(error)));
        if(error===validationError&&error instanceof ConsentError){
          const diagnostic=bankAccountUsageDiagnostic(error);
          if(diagnostic)revalidationUsageDiagnostics.set(error,diagnostic);
          if(diagnostic&&detailsDiagnostic)revalidationUsageDetailsDiagnostics.set(error,detailsDiagnostic);
        }
      }catch{}
      throw error;
    }
  });
}

async function synchronizeOwner(owner: string, options: { automatic?: boolean; control?:boolean; psu?: ProviderPsu }): Promise<Response> {
  const user = { userId: owner };
  let companyScopes=true;
  try{await db().prepare('SELECT company_id FROM company_bank_sync_scopes WHERE owner=?').bind(owner).first();}
  catch(error){if(error instanceof Error&&/no such table:\s*(?:main\.)?company_bank_sync_scopes\b/i.test(error.message))companyScopes=false;else throw error;}
  const assertLegacy=async()=>{
    if(companyScopes&&await db().prepare('SELECT company_id FROM company_bank_sync_scopes WHERE owner=?').bind(owner).first())throw new BankError('Den här arbetsytan tillhör ett företag. Bankhämtningen måste använda företagets aktuella behörighet och kontroller.',409);
  };
  await assertLegacy();
  return withBankLock(user.userId, async ownerLease => {
    // A company can be bound after the initial read. Fence every legacy write
    // under the same owner-lock transaction so manual/control paths cannot
    // bypass company authority while enrollment is changing concurrently.
    const lease:BankLease=companyScopes?{
      async assert(){await ownerLease.assert();await assertLegacy();},
      async write(statements){
        await assertLegacy();
        const fence=db().prepare("SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM company_bank_sync_scopes WHERE owner=?) THEN 1 ELSE json('COMPANY_SCOPE_MISMATCH') END").bind(owner);
        try{return (await ownerLease.write([fence,...statements])).slice(1);}
        catch(error){await assertLegacy();throw error;}
      },
      async run(statement){return (await lease.write([statement]))[0];},
    }:ownerLease;
    await lease.assert();
    const app = await application(user.userId), conn = await connection(user.userId);
    if (options.automatic && (!conn || conn.auto_sync_enabled !== 1)) return response({ automatic: true, due: false, reason: 'disabled', imported: 0 });
    if (!app || !conn || app.generation !== conn.app_generation || storedStatus(conn) !== 'connected') throw new BankError('En giltig bankanslutning behövs. Anslut banken igen.');
    await assertCompanyConsent(conn);
    if(options.automatic&&conn.sync_failures>=3)return response({automatic:true,due:false,reason:'blocked',imported:0,error:'Automatisk bankhämtning är stoppad efter tre avbrutna eller misslyckade försök. Kontrollera anslutningen och gör en manuell hämtning.'});
    if(!options.control&&Date.parse(conn.retry_after||'')>Date.now()){
      if(options.automatic||options.control)return response({automatic:!!options.automatic,due:false,reason:'not_due',nextAttemptAt:conn.retry_after,imported:0});
      throw Object.assign(new ProviderError('BANK_RATE_LIMIT','Banken har begränsat hämtningen. Vänta till nästa tillåtna försök.',429,true),{retryAfter:Math.ceil((Date.parse(conn.retry_after)-Date.now())/1000)});
    }
    if(options.control){
      const next=Math.max(Date.parse(conn.control_last_attempt_at||'')+6*3600_000||0,Date.parse(conn.last_synced_at||'')+6*3600_000||0,Date.parse(conn.auto_last_attempt_at||'')+6*3600_000||0,Date.parse(conn.auto_next_at||'')||0,Date.parse(conn.retry_after||'')||0);
      if(next>Date.now())return response({due:false,reason:'not_due',nextAttemptAt:new Date(next).toISOString(),imported:0});
    }
    const nextAttempt = automaticDueAt(conn);
    if (options.automatic && nextAttempt && Date.parse(nextAttempt) > Date.now()) return response({ automatic: true, due: false, reason: 'not_due', nextAttemptAt: nextAttempt, imported: 0 });
    if (conn.last_synced_at && Date.now() - Date.parse(conn.last_synced_at) < 60_000) throw new BankError('Uppgifterna hämtades nyss. Vänta en minut innan nästa hämtning.', 429);
    const selected: string[] = JSON.parse(conn.selected_accounts);
    if (!selected.length) throw new BankError('Välj vilka konton du vill hämta först.');
    // Freeze a validated UTC interval before any provider call or reservation.
    const {dateFrom: from, dateTo: to} = bankSyncRange(conn.date_from, conn.last_synced_at);
    const runId=uid(),mode=options.automatic?'automatic':options.control?'control':'manual';
    const jobEvent=(state:'started'|'completed'|'failed',errorCode?:string)=>{
      const statement=db().prepare(`INSERT INTO audit_events(id,owner,revision,action,detail,created_at)
        SELECT ?,?,COALESCE((SELECT revision FROM workspaces WHERE owner=?),0),?,?,?
        ${state==='completed'?'WHERE EXISTS(SELECT 1 FROM bank_sync_runs WHERE owner=? AND id=?)':''}`);
      const values=[uid(),owner,owner,`bank.job.${state}`,JSON.stringify({run_id:runId,mode,...(errorCode?{error_code:errorCode}:{})}),now()];
      return statement.bind(...values,...(state==='completed'?[owner,runId]:[]));
    };
    const reservations=[jobEvent('started')];
    if(options.control)reservations.push(db().prepare('UPDATE bank_connections SET control_last_attempt_at=? WHERE owner=? AND id=?').bind(now(),owner,conn.id));
    // Reserve the next attempt before contacting the provider. Retries, multiple
    // tabs and scheduled task replays cannot create an unbounded polling loop.
    if (options.automatic) reservations.push(db().prepare("UPDATE bank_connections SET auto_last_attempt_at=?,auto_next_at=?,sync_failures=sync_failures+1,last_error='Bankkörningen avbröts eller väntar på svar. Kontrollera anslutningen om felet kvarstår.' WHERE owner=? AND id=?")
      .bind(now(), nextAutomaticAttempt(), user.userId, conn.id));
    await lease.write(reservations);
    let needsReauthorization = false,commitAttempted=false;
    try {
      const config = await providerConfig(app), bankAccounts = await accounts(conn);
      await lease.assert();
      const live = await guardedBankRead(user.userId, conn, lease, async () => getSession(config, await sessionId(conn)));
      await lease.assert();
      let grant: ReturnType<typeof validateEnableConsent>;
      try {
        const savedConsent = consentMetadata(conn);
        const consentInput = { session: { accounts: bankAccounts, access: { valid_until: conn.valid_until }, aspsp: { name: conn.bank_name, country: conn.country }, psu_type: 'business' },
          checked: live, bankName: conn.bank_name, country: conn.country, requestedValidUntil: conn.valid_until, requestedScopes: savedConsent?.requestedScopes };
        grant = savedConsent?.mode === 'company' ? validateEnableConsent(consentInput)
          : validateLegacyEnableSelection({ ...consentInput, selectedAccountUids: selected });
      } catch (error) {
        needsReauthorization = true;
        await lease.run(db().prepare("UPDATE bank_connections SET status='reauth_required',last_error=?,updated_at=? WHERE owner=? AND id=?").bind('Bankens medgivande är inte längre giltigt. Anslut banken igen.', now(), user.userId, conn.id));
        throw error;
      }
      if (!selected.every(id => live.accounts.includes(id))) {
        needsReauthorization = true;
        throw new BankError('Ett valt konto ingår inte längre i bankens medgivande. Anslut banken igen.');
      }
      const initialAuthority = await assertCompanyConsent(conn);
      let consentExpiresAt = Math.min(Date.parse(grant.validUntil), Date.parse(initialAuthority?.validUntil ?? grant.validUntil));
      const consentFence = () => db().prepare(`INSERT INTO bank_locks(owner,token,expires_at) VALUES(?,
        (SELECT token FROM bank_locks WHERE owner=? AND EXISTS(SELECT 1 FROM bank_connections WHERE owner=? AND id=? AND encrypted_session=? AND status='connected' AND valid_until>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        AND ?>strftime('%Y-%m-%dT%H:%M:%fZ','now')),?) ON CONFLICT(owner) DO UPDATE SET token=excluded.token`)
        .bind(owner, owner, owner, conn.id, conn.encrypted_session, new Date(consentExpiresAt).toISOString(), new Date(consentExpiresAt).toISOString());
      const authorizeFetch = async () => {
        await lease.assert();
        const authority = await assertCompanyConsent(conn);
        consentExpiresAt = Math.min(consentExpiresAt, Date.parse(authority?.validUntil ?? grant.validUntil));
        if (!Number.isFinite(consentExpiresAt) || Date.now() >= consentExpiresAt) {
          needsReauthorization = true;
          throw new ProviderError('BANK_RECONNECT_REQUIRED', 'Bankmedgivandet gick ut under hämtningen. Anslut banken igen. Inga nya bankhändelser sparades.', 409);
        }
      };
      const rows: Record<string, unknown>[] = [], warnings = new Set<string>();
      let skipped = 0;
      const budget = {requests: 0, rows: 0};
      for (const id of selected) {
        const account = bankAccounts.find(item => item.uid === id);
        const canonicalKey = account && stableAccountKey(account, { name: conn.bank_name, country: conn.country });
        if (!account || account.currency !== 'SEK' || !canonicalKey) throw new BankError('Ett valt konto kan inte importeras. Kontrollera kontovalet.');
        // Use the same canonical bank identity as file imports. Provider UIDs
        // change after reauthorisation and must never be used for deduplication.
        const accountKey = canonicalKey;
        const periods = await fetchBankPeriods({dateFrom: from, dateTo: to, budget, authorize: authorizeFetch,
          isPeriodError: error => error instanceof ProviderError && error.code === 'BANK_PERIOD_UNAVAILABLE',
          fetchPage: input => guardedBankRead(user.userId, conn, lease, () => getTransactions(config, id, {...input, psu: options.psu})),
        });
        for (const period of periods) {
          const normalized = await normalizeTransactions(period.transactions, { accountKey, accountLabel: maskAccount(account, {name: conn.bank_name, country: conn.country}), bankName: conn.bank_name, dateFrom: period.dateFrom, dateTo: period.dateTo });
          // Invalid booked originals must keep this interval pending. Advancing
          // the incremental checkpoint would otherwise prevent a complete retry.
          if (normalized.skipped.invalid) throw new BankPeriodError('BANK_INCOMPLETE_RESPONSE', `Banken lämnade ogiltiga bokförda händelser för perioden ${period.dateFrom}–${period.dateTo}. Inga nya bankhändelser sparades. Hämta perioden igen eller komplettera med bankfil.`);
          rows.push(...normalized.rows);
          skipped += normalized.skipped.pending + normalized.skipped.nonSek + normalized.skipped.invalid;
          normalized.warnings.forEach(warning => warnings.add(warning));
        }
      }
      warnings.add('Bankgiro kan redovisas som en samlad insättning. Komplettera vid behov med camt.054 eller bankens betalningsspecifikation innan du matchar.');
      const test = conn.environment === 'SANDBOX', at = now();
      // Persist pending follow-up in the successful fetch transaction first.
      // A crash or expired lease after commit must leave a durable visible alert.
      const persistedWarnings=()=>JSON.stringify([...warnings,...(!test?[POSTPROCESS_WARNING]:[])]);
      let imported = 0;
      await authorizeFetch();
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
        try {
          result = applyCommand(old.state, command);
          if(new TextEncoder().encode(JSON.stringify(result.state)).length>1_800_000){const message='Registret har nått storleksgränsen. Inga nya bankhändelser sparades. Kontakta administratören för utökad lagring.';throw bankImportEvidenceError(old.state,result.state,message)||new BankError(message);}
        }
        catch (error) {
          if(error instanceof BankImportEvidenceError){
            const eventId=uid(),prepared=await prepareBankImportFailure(old.state,error.state,eventId);
            if(!prepared.replayed){
              const saved=await lease.write([
                db().prepare('INSERT INTO audit_events(id,owner,revision,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspaces WHERE owner=? AND revision=?)').bind(eventId,user.userId,old.revision+1,'bank.sync_rejected',JSON.stringify({message:error.message,connectionId:conn.id,from,to,retained_conflicts:prepared.conflicts,compact_hold:prepared.compact}),at,user.userId,old.revision),
                db().prepare('UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE owner=? AND revision=?').bind(prepared.payload,at,user.userId,old.revision),
                consentFence(),
              ]);
              if(saved[1].meta.changes!==1)throw new BankError('Registret ändrades under hämtningen. Uppdatera sidan och hämta igen. Inga bankhändelser skrevs över.',409);
            }
          }
          throw new BankError(error instanceof Error ? error.message : 'Bankhändelserna kunde inte importeras.');
        }
        imported = result.state.transactions.length - old.state.transactions.length;
        skipped += rows.length - imported;
        const payload = JSON.stringify(result.state);
        await lease.run(db().prepare('INSERT OR IGNORE INTO workspaces (owner,revision,payload,updated_at) VALUES (?,0,?,?)').bind(user.userId, JSON.stringify(emptyState()), at));
        const auditId = uid();
        await authorizeFetch();
        commitAttempted=true;
        const committed = await lease.write([
          db().prepare(`INSERT INTO audit_events (id,owner,revision,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM workspaces WHERE owner=? AND revision=?)`)
            .bind(auditId, user.userId, old.revision + 1, 'bank.sync', JSON.stringify({ message: `${imported} bankhändelser hämtade från ${conn.bank_name}`, command: { type: 'bank.sync', connectionId: conn.id, from, to, imported, skipped } }), at, user.userId, old.revision),
          db().prepare('UPDATE workspaces SET payload=?,revision=revision+1,updated_at=? WHERE owner=? AND revision=?').bind(payload, at, user.userId, old.revision),
          db().prepare(`INSERT INTO bank_sync_runs (id,owner,connection_id,imported,skipped,warnings,test,created_at) SELECT ?,?,?,?,?,?,0,? WHERE EXISTS (SELECT 1 FROM audit_events WHERE id=? AND owner=?)`)
            .bind(runId, user.userId, conn.id, imported, skipped, persistedWarnings(), at, auditId, user.userId),
          db().prepare("UPDATE bank_connections SET last_synced_at=?,last_error=NULL,retry_after='',sync_failures=0,updated_at=? WHERE owner=? AND id=? AND EXISTS (SELECT 1 FROM bank_sync_runs WHERE id=?)").bind(at, at, user.userId, conn.id, runId),
          // Completion is part of the accepted import, never a later write that
          // could relabel already committed bank data as a failed attempt.
          jobEvent('completed'),
          consentFence(),
        ]);
        if (committed[1].meta.changes !== 1) throw new BankError('Registret ändrades under hämtningen. Uppdatera sidan och hämta igen. Inga bankhändelser skrevs över.', 409);
      } else {
        // Sandbox is intentionally never written into the financial register.
        if (test) warnings.add(`${rows.length} testhändelser lästes. Inga testuppgifter sparades bland dina riktiga bankhändelser.`);
        else skipped += rows.length;
        await authorizeFetch();
        commitAttempted=true;
        await lease.write([
          db().prepare('INSERT INTO bank_sync_runs (id,owner,connection_id,imported,skipped,warnings,test,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(runId, user.userId, conn.id, 0, skipped, persistedWarnings(), test ? 1 : 0, at),
          db().prepare("UPDATE bank_connections SET last_synced_at=?,last_error=NULL,retry_after='',sync_failures=0,updated_at=? WHERE owner=? AND id=?").bind(at, at, user.userId, conn.id),
          jobEvent('completed'),
          consentFence(),
        ]);
      }
      // Retention is housekeeping; a failed cleanup must not report a committed
      // import as failed or overwrite its successful connection status.
      try {
        await lease.run(db().prepare('DELETE FROM bank_sync_runs WHERE owner=? AND id NOT IN (SELECT id FROM bank_sync_runs WHERE owner=? ORDER BY created_at DESC LIMIT 50)').bind(user.userId, user.userId));
      } catch { /* A later successful run can prune older history. */ }
      if(!test)try{await (await import('../customer-messages')).reconcileAndPrepare(user.userId);await lease.run(db().prepare('UPDATE bank_sync_runs SET warnings=? WHERE owner=? AND id=?').bind(JSON.stringify([...warnings]),user.userId,runId));}catch{warnings.add(POSTPROCESS_WARNING);}
      return response({ message: test ? `Testhämtningen är klar. ${rows.length} testhändelser lästes utan att påverka ditt register.` : `${imported} nya bankhändelser hämtades. Kontrollera underlagen före matchning.`, imported, skipped, warnings: [...warnings], test });
    } catch (error) {
      if(commitAttempted){
        // D1 can commit before its reply is lost. Its owner-bound receipt is
        // authoritative even if this worker's lease was replaced afterwards.
        // If the receipt cannot be read, leave the unknown outcome unchanged.
        let accepted:{imported:number;skipped:number;warnings:string;test:number}|null;
        try{accepted=await db().prepare('SELECT imported,skipped,warnings,test FROM bank_sync_runs WHERE owner=? AND id=?').bind(owner,runId).first();}
        catch{throw error;}
        if(accepted)return response({message:accepted.test?'Testhämtningen är sparad utan att påverka ditt register.':`${accepted.imported} nya bankhändelser hämtades. Kontrollera underlagen före matchning.`,imported:accepted.imported,skipped:accepted.skipped,warnings:[...JSON.parse(accepted.warnings),COMMITTED_REPLY_WARNING],test:!!accepted.test,metadata_warning:COMMITTED_REPLY_WARNING});
      }
      await lease.assert();
      const current = await connection(user.userId);
      if (!current || current.id !== conn.id || current.app_generation !== conn.app_generation || current.encrypted_session !== conn.encrypted_session) throw new Error('BANK_ACCOUNT_READ_CONTEXT_CHANGED');
      const exhausted=options.automatic&&conn.sync_failures+1>=3;
      const detail = bankConsentDiagnostic(error)?.message ?? (error instanceof BankError || error instanceof ProviderError || error instanceof BankPeriodError ? error.message : 'Bankhändelserna kunde inte hämtas. Försök igen.');
      const message = exhausted ? `Automatisk bankhämtning är stoppad efter tre avbrutna eller misslyckade försök. ${detail}` : detail;
      const expired = needsReauthorization || error instanceof ProviderError && error.code === 'BANK_RECONNECT_REQUIRED';
      const limited=error instanceof ProviderError&&(error.status===429||error.retryAfter!==undefined||error.retryBlocked===true);
      const retry=limited?(error.retryBlocked?'9999-12-31T23:59:59.999Z':new Date(Date.now()+Math.max(60,error.retryAfter||60)*1000).toISOString()):current.retry_after;
      // Keep actual supplier advice separate from the six-hour background
      // fallback. A successful transactions sync never clears this read guard.
      const accountRetry=mergeAccountReadCooldown(current.account_evidence_retry,providerCooldownDiagnostic(error));
      const failureState=db().prepare('UPDATE bank_connections SET last_error=?,status=?,retry_after=?,account_evidence_retry=?,sync_failures=CASE WHEN ? THEN 3 ELSE sync_failures END,updated_at=? WHERE owner=? AND id=?').bind(message, expired ? 'reauth_required' : current.status,retry,accountRetry,limited&&error.retryBlocked?1:0, now(), user.userId, conn.id);
      try{await lease.write([failureState,jobEvent('failed',bankJobErrorCode(error))]);}
      catch{
        // Operational history must not discard the provider's durable cooldown.
        // A replacement or expired lease still rejects this bounded fallback.
        await lease.run(failureState);
      }
      throw error;
    }
  });
}
