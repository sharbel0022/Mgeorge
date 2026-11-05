import { BankProviderError, assertServerRuntime, isRecord, validDate } from '../bank-data-provider.js';
import { OPENPAYMENTS_ORIGINS } from './config.js';

const HEADER_ALLOWLIST = new Set(['accept', 'authorization', 'content-type', 'x-request-id', 'x-bicfi', 'psu-id', 'psu-corporate-id', 'psu-corporate-id-type', 'psu-ip-address', 'psu-user-agent', 'tpp-redirect-preferred', 'tpp-redirect-uri', 'consent-id', 'x-affiliatedaspsp-id', 'x-consentid', 'x-consentauthorisationid']);
const ID = '[A-Za-z0-9_-]{1,200}';
const CONSENT = new RegExp(`^/psd2/consent/v1/consents(?:/${ID}(?:/status|/authorisations(?:/${ID})?)?)?$`);
const ACCOUNT = new RegExp(`^/psd2/accountinformation/v1/accounts(?:/${ID}(?:/transactions)?)?$`);
const ASPSP = /^\/psd2\/aspspinformation\/v1\/aspsps(?:\/[A-Z]{6}[A-Z2-9][A-NP-Z0-9](?:[A-Z0-9]{3})?)?$/;
const denied = () => new BankProviderError('FEATURE_NOT_ALLOWED', 403);
function requestUrl(config, service, path, method, body) {
  if (!['api', 'auth'].includes(service) || typeof path !== 'string' || path.length > 8192 || !path.startsWith('/') || path.startsWith('//') || /[\\#\u0000-\u0020]/.test(path)) throw denied();
  const origin = OPENPAYMENTS_ORIGINS[config.environment][service], url = new URL(origin + path);
  if (url.origin !== origin || url.pathname !== path.split('?')[0] || url.username || url.password || /%/.test(url.pathname)) throw denied();
  if (service === 'auth') {
    if (path !== '/connect/token' || method !== 'POST') throw denied();
    return url.href;
  }
  const pathname = url.pathname, keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length || (method !== 'GET' && url.search)) throw denied();
  let allowed = false;
  if (ASPSP.test(pathname) && config.features.includes('bank_discovery')) {
    allowed = method === 'GET' && keys.every(key => key === 'isoCountryCodes') && (!url.search || pathname.endsWith('/aspsps'));
    const countries = url.searchParams.get('isoCountryCodes');
    if (countries !== null && !/^[A-Z]{2}(?:,[A-Z]{2}){0,9}$/.test(countries)) allowed = false;
  } else if (CONSENT.test(pathname) && config.features.includes('consents')) {
    const root = '/psd2/consent/v1/consents';
    allowed = !url.search && (
      method === 'GET' && pathname !== root ||
      method === 'POST' && (pathname === root || pathname.endsWith('/authorisations')) ||
      method === 'PUT' && new RegExp(`/authorisations/${ID}$`).test(pathname) ||
      method === 'DELETE' && new RegExp(`^${root}/${ID}$`).test(pathname)
    );
    if (method === 'POST' && pathname === root) {
      let payload; try { payload = JSON.parse(body); } catch { throw denied(); }
      if (!isRecord(payload) || payload.combinedServiceIndicator !== undefined && payload.combinedServiceIndicator !== false) throw denied();
    }
  } else if (ACCOUNT.test(pathname) && method === 'GET') {
    if (pathname.endsWith('/transactions')) {
      allowed = config.features.includes('transactions') && keys.every(key => ['bookingStatus', 'dateFrom', 'dateTo', 'entryReferenceFrom', 'continuationKey'].includes(key)) &&
        url.searchParams.get('bookingStatus') === 'booked';
      for (const field of ['dateFrom', 'dateTo']) if (url.searchParams.has(field) && !validDate(url.searchParams.get(field))) allowed = false;
      if (url.searchParams.has('dateFrom') && url.searchParams.has('dateTo') && url.searchParams.get('dateFrom') > url.searchParams.get('dateTo')) allowed = false;
    } else {
      allowed = config.features.includes('accounts') && keys.every(key => key === 'withBalance') && (!url.searchParams.has('withBalance') || url.searchParams.get('withBalance') === 'false');
    }
  }
  if (!allowed || method === 'GET' && body !== undefined) throw denied();
  return url.href;
}

function retryAdvice(value, now) {
  const raw = value?.trim() ?? '';
  const numeric = /^\d+$/.test(raw);
  const date = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),/.test(raw) ? Date.parse(raw) : NaN;
  const seconds = numeric ? Number(raw) : Number.isFinite(date) ? Math.ceil((date - now()) / 1000) : 60;
  if (!Number.isFinite(seconds) || seconds > 365 * 86400) return { retryable: false, retryBlocked: true };
  return { retryable: true, retryAfter: Math.max(1, Math.ceil(seconds)) };
}
const cancelBody = response => { try { response.body?.cancel().catch(() => {}); } catch {} };

async function readJson(response, signal, maxBytes) {
  if (response.status === 204) return {};
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) { cancelBody(response); throw new BankProviderError('PROVIDER_RESPONSE_INVALID'); }
  if (!/^application\/(?:[a-z0-9.-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) { cancelBody(response); throw new BankProviderError('PROVIDER_RESPONSE_INVALID'); }
  const reader = response.body?.getReader();
  if (!reader) throw new BankProviderError('PROVIDER_RESPONSE_INVALID');
  const abort = () => { try { reader.cancel().catch(() => {}); } catch {} };
  signal.addEventListener('abort', abort, { once: true });
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new BankProviderError('PROVIDER_ABORTED');
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { abort(); throw new BankProviderError('PROVIDER_RESPONSE_INVALID'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!isRecord(data)) throw Error();
    return data;
  } catch (error) {
    if (error instanceof BankProviderError) throw error;
    throw new BankProviderError('PROVIDER_RESPONSE_INVALID');
  } finally { signal.removeEventListener('abort', abort); try { reader.releaseLock(); } catch {} }
}

/** Fixed origin, read-only route gate, bounded bytes/deadline. No implicit retry. */
export function createOpenPaymentsHttpClient(config, { transport, timeoutMs = 20_000, maxResponseBytes = 2 * 1024 * 1024, now = Date.now } = {}) {
  assertServerRuntime();
  if (!OPENPAYMENTS_ORIGINS[config?.environment] || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20_000 || !Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 2 * 1024 * 1024) throw new BankProviderError('PROVIDER_CONFIGURATION_INVALID', 409);
  if (config.environment === 'PRODUCTION' && (transport?.kind !== 'mtls' || typeof transport?.validateCertificate !== 'function')) throw new BankProviderError('INVALID_CLIENT_CERTIFICATE', 409);
  const selected = transport ?? { kind: 'sandbox', request: (url, init) => fetch(url, init) };
  if (typeof selected.request !== 'function') throw new BankProviderError('PROVIDER_CONFIGURATION_INVALID', 409);
  return Object.freeze({
    async send({ path, service = 'api', method = 'GET', headers: values, body, signal }) {
      const url = requestUrl(config, service, path, method, body), headers = new Headers(values);
      if ([...headers.keys()].some(header => !HEADER_ALLOWLIST.has(header))) throw denied();
      headers.set('Accept', 'application/json'); headers.set('X-Request-ID', crypto.randomUUID());
      if (signal?.aborted) throw new BankProviderError('PROVIDER_ABORTED', 499);
      const controller = new AbortController(), write = method === 'POST' || method === 'PUT';
      let timer, onAbort, timedOut = false;
      const interrupted = new Promise((_, reject) => {
        onAbort = () => { controller.abort(); reject(new BankProviderError('PROVIDER_ABORTED', 499, { mayHaveSucceeded: write })); };
        signal?.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new BankProviderError('PROVIDER_TIMEOUT', 504, { retryable: !write, mayHaveSucceeded: write })); }, timeoutMs);
      });
      const run = async () => {
        try {
          if (config.environment === 'PRODUCTION') {
            try { await selected.validateCertificate(); }
            catch (error) { throw new BankProviderError(error?.code === 'CLIENT_CERTIFICATE_EXPIRED' ? 'CLIENT_CERTIFICATE_EXPIRED' : 'INVALID_CLIENT_CERTIFICATE', 409); }
          }
          if (controller.signal.aborted) throw new BankProviderError('PROVIDER_ABORTED', 499);
          const response = await selected.request(url, { method, headers, body, signal: controller.signal, redirect: 'manual', cache: 'no-store' });
          if (!(response instanceof Response)) throw new BankProviderError('PROVIDER_RESPONSE_INVALID');
          if (controller.signal.aborted) { cancelBody(response); throw new BankProviderError(timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ABORTED', 504); }
          const status = response.status;
          if (status >= 300 && status < 400) { cancelBody(response); throw new BankProviderError('PROVIDER_RESPONSE_INVALID'); }
          if (status === 401 || status === 403 || status === 429 || status >= 500) {
            cancelBody(response);
            if (status === 401) throw new BankProviderError(service === 'auth' ? 'INVALID_CLIENT_CREDENTIALS' : 'INVALID_ACCESS_TOKEN', 401);
            if (status === 403) throw new BankProviderError('PROVIDER_FORBIDDEN', 403);
            const advice = retryAdvice(response.headers.get('retry-after'), now);
            if (status === 429) throw new BankProviderError('PROVIDER_RATE_LIMIT', 429, advice);
            throw new BankProviderError('PROVIDER_SERVICE_ERROR', 502, { ...advice, retryable: !write && advice.retryable, mayHaveSucceeded: write });
          }
          const data = await readJson(response, controller.signal, maxResponseBytes);
          if (!response.ok) {
            if (service === 'auth' && data.error === 'invalid_client') throw new BankProviderError('INVALID_CLIENT_CREDENTIALS', 401);
            if (service === 'auth' && ['invalid_grant', 'invalid_scope', 'unauthorized_client'].includes(data.error)) throw new BankProviderError('INVALID_OAUTH_RESULT', 403);
            throw new BankProviderError('PROVIDER_REQUEST_REJECTED', 502);
          }
          return { data, headers: response.headers, requestId: headers.get('X-Request-ID') };
        } catch (error) {
          if (error instanceof BankProviderError) throw error;
          if (['INVALID_CLIENT_CERTIFICATE', 'CLIENT_CERTIFICATE_EXPIRED'].includes(error?.code)) throw new BankProviderError(error.code, 409);
          throw new BankProviderError('PROVIDER_UNAVAILABLE_NETWORK', 502, { retryable: !write, mayHaveSucceeded: write });
        }
      };
      try { return await Promise.race([run(), interrupted]); }
      finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
    },
  });
}
