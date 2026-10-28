/** Server-only, read-only Enable Banking adapter. No payment endpoints are allowed.
 * Protocol: https://enablebanking.com/docs/api/reference/
 */
export type ProviderConfig = { applicationId: string; privateKeyPem: string };
export type ProviderBankIdentity = { name: string; country: string };
export type ProviderPsu = { ipAddress?: string; userAgent?: string };
export type ProviderApplication = {
  name: string; description?: string; kid: string; environment: 'SANDBOX' | 'PRODUCTION';
  redirect_urls: string[]; active: boolean; countries: string[]; services: string[];
};
export type ProviderAuthMethod = {
  name: string; psu_type?: 'business' | 'personal'; approach?: string; hidden_method?: boolean;
  credentials?: { name: string; required?: boolean; title?: string; description?: string; template?: string }[];
};
export type ProviderBank = ProviderBankIdentity & {
  psu_types: string[]; auth_methods?: ProviderAuthMethod[]; maximum_consent_validity: number;
  required_psu_headers?: string[]; logo?: string; bic?: string; beta?: boolean;
};
export type ProviderAccountIdentification = { iban?: string | null; other?: { identification: string; scheme_name: string } | null };
export type ProviderAccount = {
  uid: string; account_id?: ProviderAccountIdentification | null;
  all_account_ids?: { identification: string; scheme_name: string }[];
  identification_hash?: string; identification_hashes?: string[];
  name?: string; details?: string; currency?: string; usage?: 'ORGA' | 'PRIV';
};
export type ProviderAccess = { valid_until: string; balances?: boolean; transactions?: boolean; accounts?: ProviderAccountIdentification[] };
export type ProviderSession = {
  session_id: string; accounts: ProviderAccount[]; aspsp: ProviderBankIdentity;
  psu_type: 'business' | 'personal'; access: ProviderAccess;
};
export type ProviderSessionStatus = 'AUTHORIZED' | 'CANCELLED' | 'CLOSED' | 'EXPIRED' | 'INVALID' | 'PENDING_AUTHORIZATION' | 'RETURNED_FROM_BANK' | 'REVOKED';
export type ProviderSessionStatusResponse = {
  status: ProviderSessionStatus; accounts: string[];
  accounts_data: { uid: string; identification_hash?: string; identification_hashes?: string[] }[];
  aspsp: ProviderBankIdentity; psu_type: 'business' | 'personal'; psu_id_hash?: string;
  access: ProviderAccess; created: string; authorized?: string; closed?: string;
};
export type ProviderTransaction = {
  entry_reference?: string | null; transaction_id?: string | null;
  transaction_amount: { amount: string; currency: string };
  credit_debit_indicator: 'CRDT' | 'DBIT'; status: 'BOOK' | 'CNCL' | 'HOLD' | 'OTHR' | 'PDNG' | 'RJCT' | 'SCHD';
  booking_date?: string | null; value_date?: string | null; transaction_date?: string | null;
  creditor?: { name?: string | null } | null; debtor?: { name?: string | null } | null;
  reference_number?: string | null; reference_number_schema?: string | null;
  remittance_information?: string[] | null; note?: string | null;
  bank_transaction_code?: { description?: string; code?: string; sub_code?: string } | null;
};
export type ProviderTransactions = { transactions: ProviderTransaction[]; continuation_key?: string | null };
export type ProviderRequestOptions = { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown; psu?: ProviderPsu };

const API_ORIGIN = 'https://api.enablebanking.com';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_PATH = /^\/sessions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRANSACTIONS_PATH = /^\/accounts\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/transactions$/i;

export class ProviderError extends Error {
  code: string;
  status: number;
  retryable: boolean;
  constructor(code: string, message: string, status = 502, retryable = false) {
    super(message); this.name = 'ProviderError'; this.code = code; this.status = status; this.retryable = retryable;
  }
}
const invalid = () => new ProviderError('INVALID_REQUEST', 'Bankförfrågan är ogiltig. Uppdatera sidan och försök igen.', 400);
const invalidResponse = () => new ProviderError('INVALID_PROVIDER_RESPONSE', 'Banktjänsten lämnade ett svar som inte kunde kontrolleras. Ingen import gjordes.');
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const stringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const isoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;

function checkedUrl(path: string, method: string): URL {
  if (typeof path !== 'string' || path.length > 8_192 || !path.startsWith('/') || path.startsWith('//') || /[\\#\u0000-\u0020\u007f]/.test(path)) throw invalid();
  const url = new URL(path, API_ORIGIN);
  if (url.origin !== API_ORIGIN || url.username || url.password || url.hash) throw invalid();
  let allowedKeys: string[] = [];
  if (method === 'GET' && url.pathname === '/application') { /* no query */ }
  else if (method === 'GET' && url.pathname === '/aspsps') allowedKeys = ['country', 'psu_type', 'service'];
  else if (method === 'POST' && (url.pathname === '/auth' || url.pathname === '/sessions')) { /* no query */ }
  else if ((method === 'GET' || method === 'DELETE') && SESSION_PATH.test(url.pathname)) { /* no query */ }
  else if (method === 'GET' && TRANSACTIONS_PATH.test(url.pathname)) allowedKeys = ['date_from', 'date_to', 'transaction_status', 'continuation_key'];
  else throw invalid();
  for (const key of url.searchParams.keys()) if (!allowedKeys.includes(key) || url.searchParams.getAll(key).length !== 1) throw invalid();
  if (url.pathname === '/aspsps') {
    if (url.searchParams.get('country') !== 'SE' || url.searchParams.get('psu_type') !== 'business' || url.searchParams.get('service') !== 'AIS') throw invalid();
  }
  if (TRANSACTIONS_PATH.test(url.pathname)) {
    const from = url.searchParams.get('date_from') ?? '', to = url.searchParams.get('date_to') ?? '';
    if (!isoDate(from) || !isoDate(to) || from > to || url.searchParams.get('transaction_status') !== 'BOOK') throw invalid();
    const continuation = url.searchParams.get('continuation_key');
    if (continuation !== null && (!continuation || continuation.length > 4_096 || /[\u0000-\u001f\u007f]/.test(continuation))) throw invalid();
  }
  return url;
}

function base64url(bytes: Uint8Array): string {
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signedToken(config: ProviderConfig): Promise<string> {
  if (!config || !UUID.test(config.applicationId) || typeof config.privateKeyPem !== 'string' || config.privateKeyPem.length > 16_384) {
    throw new ProviderError('INVALID_CONFIGURATION', 'Banktjänsten behöver aktiveras av systemadministratören.', 400);
  }
  try {
    const match = /^\s*-----BEGIN PRIVATE KEY-----\s+([A-Za-z0-9+/=\s]+)\s+-----END PRIVATE KEY-----\s*$/.exec(config.privateKeyPem);
    if (!match) throw new Error('Unsupported key format');
    const der = Uint8Array.from(atob(match[1].replace(/\s/g, '')), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    if ((key.algorithm as RsaHashedKeyAlgorithm).modulusLength < 2048) throw new Error('RSA key too short');
    const issued = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));
    const head = encode({ typ: 'JWT', alg: 'RS256', kid: config.applicationId });
    const body = encode({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: issued, exp: issued + 300 });
    const input = `${head}.${body}`;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input));
    return `${input}.${base64url(new Uint8Array(signature))}`;
  } catch {
    throw new ProviderError('INVALID_PRIVATE_KEY', 'Banktjänsten behöver aktiveras av systemadministratören. Serverns bankuppgifter kunde inte verifieras.', 400);
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel(); throw new ProviderError('RESPONSE_TOO_LARGE', 'Bankens svar var för stort. Välj en kortare period. Ingen import gjordes.');
  }
  if (!response.body) return null;
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let text = '', size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new ProviderError('RESPONSE_TOO_LARGE', 'Bankens svar var för stort. Välj en kortare period. Ingen import gjordes.'); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  if (!text.trim()) return null;
  try { return JSON.parse(text); } catch { if (!response.ok) return null; throw invalidResponse(); }
}

function mappedError(status: number, payload: unknown): ProviderError {
  const code = record(payload) && typeof payload.error === 'string' ? payload.error : '';
  if (['EXPIRED_SESSION', 'REVOKED_SESSION', 'CLOSED_SESSION', 'SESSION_DOES_NOT_EXIST', 'EXPIREDSESSION'].includes(code)) {
    return new ProviderError('BANK_RECONNECT_REQUIRED', 'Bankmedgivandet har gått ut eller avslutats. Anslut banken igen.', 409);
  }
  if (['WRONG_AUTHORIZATION_CODE', 'EXPIRED_AUTHORIZATION_CODE', 'ALREADY_AUTHORIZED', 'WRONG_SESSION_STATUS'].includes(code)) {
    return new ProviderError('BANK_AUTHORIZATION_EXPIRED', 'Bankinloggningen kunde inte slutföras. Börja om med Anslut bank.', 409);
  }
  if (code === 'NO_ACCOUNTS_ADDED') return new ProviderError('NO_LINKED_ACCOUNTS', 'Applikationen saknar tillåtna bankkonton. Kontrollera kontoaktiveringen hos Enable Banking.', 409);
  if (code === 'REDIRECT_URI_NOT_ALLOWED') return new ProviderError('CALLBACK_NOT_REGISTERED', 'Returadressen är inte registrerad hos Enable Banking. Kontrollera bankkopplingens inställningar.', 400);
  if (['WRONG_TRANSACTIONS_PERIOD', 'WRONG_DATE_INTERVAL', 'DATE_FROM_IN_FUTURE', 'DATE_TO_WITHOUT_DATE_FROM'].includes(code)) return new ProviderError('BANK_PERIOD_UNAVAILABLE', 'Banken kan inte lämna den valda perioden. Välj ett senare startdatum eller en kortare period.', 400);
  if (['ASPSP_ACCOUNT_NOT_ACCESSIBLE', 'ACCOUNT_DOES_NOT_EXIST'].includes(code)) return new ProviderError('BANK_ACCOUNT_UNAVAILABLE', 'Bankkontot är inte tillgängligt med det aktuella medgivandet. Anslut banken igen och välj företagets konto.', 409);
  if (code === 'ASPSP_PSU_ACTION_REQUIRED') return new ProviderError('BANK_ACTION_REQUIRED', 'Banken kräver en åtgärd från dig. Logga in hos banken och kontrollera meddelanden och behörigheter.', 409);
  if (status === 429 || code === 'ASPSP_RATE_LIMIT_EXCEEDED') return new ProviderError('BANK_RATE_LIMIT', 'Bankens gräns för hämtningar har nåtts. Vänta en stund innan du försöker igen.', 429, true);
  if (status === 408 || code === 'ASPSP_TIMEOUT') return new ProviderError('BANK_TIMEOUT', 'Banktjänsten svarade inte i tid. Försök igen om en stund.', 504, true);
  if (['PSU_HEADER_NOT_PROVIDED', 'PSU_HEADER_INVALID', 'PSUHEADERNOT_PROVIDED'].includes(code)) return new ProviderError('BANK_USER_CONTEXT_REQUIRED', 'Banken behöver en aktiv användarsession. Öppna sidan och försök hämta bankhändelser igen.', 409);
  if (status === 401 || ['AUTHORIZATION_NOT_PROVIDED', 'UNAUTHORIZED_ACCESS', 'WRONG_CREDENTIALS_PROVIDED'].includes(code)) return new ProviderError('PROVIDER_AUTHORIZATION_FAILED', 'Banktjänsten behöver aktiveras av systemadministratören. Enable Banking kunde inte verifiera serverns åtkomst.', 400);
  if (status === 403 || ['ACCESS_DENIED', 'UNAUTHORIZED_IP'].includes(code)) return new ProviderError('PROVIDER_ACCESS_DENIED', 'Enable Banking har inte aktiverat åtkomsten. Kontrollera applikationens status och avtal.', 403);
  if (code === 'WRONG_ASPSP_PROVIDED') return new ProviderError('BANK_UNAVAILABLE', 'Bankalternativet är inte längre tillgängligt. Hämta banklistan igen.', 409);
  if (code === 'WRONG_CONTINUATION_KEY') return new ProviderError('BANK_SYNC_RESTART_REQUIRED', 'Bankens sidnyckel har gått ut. Börja om hämtningen. Ingen import gjordes.', 409);
  return new ProviderError('BANK_SERVICE_ERROR', 'Banktjänsten kunde inte slutföra förfrågan. Ingen import gjordes.', 502, status >= 500);
}

export async function providerRequest<T>(config: ProviderConfig, path: string, options: ProviderRequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'; const url = checkedUrl(path, method);
  if (method !== 'POST' && options.body !== undefined) throw invalid();
  const jwt = await signedToken(config);
  const headers = new Headers({ Authorization: `Bearer ${jwt}`, Accept: 'application/json' });
  let body: string | undefined;
  if (options.body !== undefined) {
    try { body = JSON.stringify(options.body); } catch { throw invalid(); }
    if (!body || body.length > 16_384) throw invalid();
    headers.set('Content-Type', 'application/json');
  }
  const ip = options.psu?.ipAddress;
  if (ip) {
    if (ip.length > 64 || !/^[0-9a-fA-F.:]+$/.test(ip)) throw invalid();
    headers.set('Psu-Ip-Address', ip);
  }
  const userAgent = options.psu?.userAgent;
  if (userAgent) {
    if (userAgent.length > 1_024 || /[\u0000-\u001f\u007f]/.test(userAgent)) throw invalid();
    headers.set('Psu-User-Agent', userAgent);
  }
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // Workers supports manual redirects, but rejects redirect: 'error'. Never
    // follow a redirect with bank credentials or an authorization-code body.
    const response = await fetch(url.href, { method, headers, body, signal: controller.signal, redirect: 'manual', cache: 'no-store' });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new ProviderError('PROVIDER_REDIRECT_DENIED', 'Banktjänsten svarade med en oväntad omdirigering. Ingen import gjordes.');
    }
    const payload = await boundedJson(response);
    if (!response.ok) throw mappedError(response.status, payload);
    if (!record(payload)) throw invalidResponse();
    return payload as T;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (controller.signal.aborted) throw new ProviderError('BANK_TIMEOUT', 'Banktjänsten svarade inte i tid. Försök igen om en stund.', 504, true);
    // Keep deployment transport failures diagnosable without logging request
    // headers, JWTs, authorization codes, account IDs or upstream response data.
    const detail = error instanceof Error ? error.message : 'Unknown transport failure';
    console.error('BANK_PROVIDER_TRANSPORT_ERROR', detail
      .replace(/https?:\/\/\S+/gi, '[url]')
      .replace(/Bearer\s+\S+/gi, '[authorization]')
      .replace(/[A-Za-z0-9+/=_-]{24,}/g, '[redacted]')
      .slice(0, 240));
    throw new ProviderError('BANK_NETWORK_ERROR', 'Banktjänsten kunde inte nås. Ingen import gjordes.', 502, true);
  } finally { clearTimeout(timeout); }
}

export async function getApplication(config: ProviderConfig): Promise<ProviderApplication> {
  const app = await providerRequest<ProviderApplication>(config, '/application');
  if (!app || !['SANDBOX', 'PRODUCTION'].includes(app.environment) || typeof app.active !== 'boolean' || typeof app.name !== 'string' ||
    typeof app.kid !== 'string' || app.kid.toLowerCase() !== config.applicationId.toLowerCase() ||
    !stringArray(app.redirect_urls) || !stringArray(app.countries) || !stringArray(app.services)) throw invalidResponse();
  return app;
}

export async function listBusinessBanks(config: ProviderConfig): Promise<ProviderBank[]> {
  const data = await providerRequest<{ aspsps: ProviderBank[] }>(config, '/aspsps?country=SE&psu_type=business&service=AIS');
  if (!Array.isArray(data.aspsps) || data.aspsps.length > 1_000) throw invalidResponse();
  for (const bank of data.aspsps) {
    if (!record(bank) || typeof bank.name !== 'string' || !bank.name.trim() || bank.name.length > 200 || bank.country !== 'SE' ||
      !stringArray(bank.psu_types) || !bank.psu_types.includes('business') || !Number.isSafeInteger(bank.maximum_consent_validity) || bank.maximum_consent_validity <= 0) throw invalidResponse();
  }
  return data.aspsps;
}

export async function startAuth(config: ProviderConfig, input: { bank: ProviderBankIdentity; state: string; redirectUrl: string; validUntil: string }): Promise<{ url: string; authorization_id?: string; psu_id_hash?: string }> {
  if (!input.bank || input.bank.country !== 'SE' || typeof input.bank.name !== 'string' || !input.bank.name.trim() || input.bank.name.length > 200 ||
    !/^[A-Za-z0-9_-]{20,200}$/.test(input.state) || !Number.isFinite(Date.parse(input.validUntil)) || Date.parse(input.validUntil) <= Date.now()) throw invalid();
  let callback: URL; try { callback = new URL(input.redirectUrl); } catch { throw invalid(); }
  if (callback.protocol !== 'https:' || callback.username || callback.password || callback.hash || callback.search) throw invalid();
  const result = await providerRequest<{ url: string; authorization_id?: string; psu_id_hash?: string }>(config, '/auth', { method: 'POST', body: {
    access: { valid_until: input.validUntil, transactions: true, balances: false }, aspsp: input.bank,
    state: input.state, redirect_url: callback.href, psu_type: 'business', language: 'sv',
  } });
  let redirect: URL; try { redirect = new URL(result.url); } catch { throw invalidResponse(); }
  // Production Swedbank currently returns the provider's tilisy host, while
  // the API reference also documents auth.enablebanking.com. Match exact
  // origins and the AIS start path, never arbitrary subdomains or redirects.
  if (!['https://auth.enablebanking.com', 'https://tilisy.enablebanking.com'].includes(redirect.origin) || redirect.pathname !== '/ais/start' || redirect.username || redirect.password || redirect.hash || result.url.length > 8_192) throw invalidResponse();
  return result;
}

export async function createSession(config: ProviderConfig, code: string): Promise<ProviderSession> {
  if (typeof code !== 'string' || !code || code.length > 4_096 || /[\u0000-\u001f\u007f]/.test(code)) throw invalid();
  const result = await providerRequest<ProviderSession>(config, '/sessions', { method: 'POST', body: { code } });
  if (!UUID.test(result.session_id) || !Array.isArray(result.accounts) || result.accounts.length > 200 ||
    !record(result.aspsp) || typeof result.aspsp.name !== 'string' || result.aspsp.country !== 'SE' || result.psu_type !== 'business' ||
    !record(result.access) || typeof result.access.valid_until !== 'string' || !Number.isFinite(Date.parse(result.access.valid_until)) ||
    result.accounts.some(account => !record(account) || (account.uid != null && (typeof account.uid !== 'string' || !UUID.test(account.uid))))) throw invalidResponse();
  // A closed/blocked account may legitimately omit uid. It cannot be fetched,
  // but must not prevent another authorized account from being connected.
  return { ...result, accounts: result.accounts.filter((account): account is ProviderAccount => typeof account.uid === 'string' && UUID.test(account.uid)) };
}

export async function getSession(config: ProviderConfig, sessionId: string): Promise<ProviderSessionStatusResponse> {
  if (!UUID.test(sessionId)) throw invalid();
  const result = await providerRequest<ProviderSessionStatusResponse>(config, `/sessions/${sessionId}`);
  if (!['AUTHORIZED', 'CANCELLED', 'CLOSED', 'EXPIRED', 'INVALID', 'PENDING_AUTHORIZATION', 'RETURNED_FROM_BANK', 'REVOKED'].includes(result.status) ||
    !stringArray(result.accounts) || result.accounts.some(id => !UUID.test(id)) || !Array.isArray(result.accounts_data) ||
    !record(result.access) || typeof result.access.valid_until !== 'string' || !Number.isFinite(Date.parse(result.access.valid_until))) throw invalidResponse();
  return result;
}

export async function deleteSession(config: ProviderConfig, sessionId: string): Promise<{ message?: string }> {
  if (!UUID.test(sessionId)) throw invalid();
  return providerRequest(config, `/sessions/${sessionId}`, { method: 'DELETE' });
}

export async function getTransactions(config: ProviderConfig, accountUid: string, input: { dateFrom: string; dateTo: string; continuationKey?: string; psu?: ProviderPsu }): Promise<ProviderTransactions> {
  if (!UUID.test(accountUid)) throw invalid();
  const query = new URLSearchParams({ date_from: input.dateFrom, date_to: input.dateTo, transaction_status: 'BOOK' });
  if (input.continuationKey !== undefined) query.set('continuation_key', input.continuationKey);
  const result = await providerRequest<ProviderTransactions>(config, `/accounts/${accountUid}/transactions?${query}`, { psu: input.psu });
  if (!Array.isArray(result.transactions) || (result.continuation_key != null && (typeof result.continuation_key !== 'string' || !result.continuation_key || result.continuation_key.length > 4_096))) throw invalidResponse();
  return result;
}
