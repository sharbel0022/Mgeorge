/** Server adapter boundary. These are internal contracts, not bank API fields. */
const messages = {
  INVALID_PROVIDER_BINDING: 'Bankanslutningens företagsbindning är ogiltig.',
  RESOURCE_SCOPE_MISMATCH: 'Bankresursen tillhör inte den aktuella anslutningen.',
  RESOURCE_EXPIRED: 'Bankresursens giltighetstid har gått ut.',
  PROVIDER_UNAVAILABLE: 'Den valda bankleverantören är inte tillgänglig.',
  PROVIDER_CONFIGURATION_INVALID: 'Bankleverantörens serverkonfiguration är ogiltig.',
  SCOPE_NOT_ALLOWED: 'Bankintegrationen tillåter endast godkända behörigheter för läsning.',
  FEATURE_NOT_ALLOWED: 'Funktionen ingår inte i bankintegrationens tillåtna läsåtkomst.',
  CREDENTIALS_EXPIRED: 'Bankleverantörens serveruppgifter har gått ut.',
  INVALID_CLIENT_CERTIFICATE: 'Bankleverantörens klientcertifikat är ogiltigt eller saknas.',
  CLIENT_CERTIFICATE_EXPIRED: 'Bankleverantörens klientcertifikat har gått ut.',
  PROVIDER_TIMEOUT: 'Bankleverantören svarade inte inom tidsgränsen.',
  PROVIDER_ABORTED: 'Bankförfrågan avbröts.',
  PROVIDER_UNAVAILABLE_NETWORK: 'Bankleverantören kunde inte nås.',
  PROVIDER_RESPONSE_INVALID: 'Bankleverantören lämnade ett ogiltigt svar.',
  INVALID_ACCESS_TOKEN: 'Bankleverantören avvisade serverns åtkomsttoken.',
  INVALID_OAUTH_RESULT: 'Bankleverantörens autentisering kunde inte verifieras.',
  INVALID_CLIENT_CREDENTIALS: 'Bankleverantören avvisade serverns klientuppgifter.',
  PROVIDER_FORBIDDEN: 'Bankleverantören medger inte den begärda läsåtkomsten.',
  PROVIDER_RATE_LIMIT: 'Bankleverantörens anropsgräns är nådd.',
  PROVIDER_SERVICE_ERROR: 'Bankleverantören är tillfälligt otillgänglig.',
  PROVIDER_REQUEST_REJECTED: 'Bankleverantören avvisade förfrågan.',
  CONSENT_NOT_VALID: 'Bankmedgivandet är inte giltigt för läsning.',
  AUTHORIZATION_INVALID: 'Bankgodkännandet kunde inte verifieras.',
  BANKGIRO_NOT_AVAILABLE: 'Bankgiroberikning är inte verifierad för företaget och kontot.',
};

export class BankProviderError extends Error {
  constructor(code, status = 502, options = {}) {
    super(messages[code] ?? 'Bankförfrågan kunde inte genomföras.');
    this.name = 'BankProviderError';
    this.code = Object.hasOwn(messages, code) ? code : 'PROVIDER_REQUEST_REJECTED';
    this.status = status;
    this.retryable = options.retryable === true;
    if (Number.isSafeInteger(options.retryAfter) && options.retryAfter > 0) this.retryAfter = options.retryAfter;
    if (options.retryBlocked === true) this.retryBlocked = true;
    if (options.mayHaveSucceeded === true) this.mayHaveSucceeded = true;
  }
}

export function assertServerRuntime() {
  if (typeof window !== 'undefined') throw new BankProviderError('PROVIDER_CONFIGURATION_INVALID', 409);
}

export const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);
export const safeText = (value, max = 256) => typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u0020\u007f]/.test(value);
export function snapshot(value, code = 'PROVIDER_RESPONSE_INVALID') {
  try { return structuredClone(value); } catch { throw new BankProviderError(code); }
}
export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function validInstant(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}
export function providerForConnection(connection, providers) {
  // Only an absent legacy discriminator defaults. Explicit unknown values never
  // fall through to another provider with unrelated consent/account credentials.
  const id = connection.provider === undefined ? 'enable_banking' : connection.provider;
  const provider = ['enable_banking', 'open_payments'].includes(id) && Object.hasOwn(providers, id) ? providers[id] : null;
  if (!provider || provider.id !== id) throw new BankProviderError('PROVIDER_UNAVAILABLE', 409);
  return provider;
}

export function createProviderBinding(input) {
  assertServerRuntime();
  const value = snapshot(input, 'INVALID_PROVIDER_BINDING');
  const keys = ['owner', 'companyId', 'connectionId', 'provider', 'environment', 'generation'];
  if (!isRecord(value) || keys.some(key => !safeText(value[key])) ||
      !['enable_banking', 'open_payments'].includes(value.provider) || !['SANDBOX', 'PRODUCTION'].includes(value.environment)) {
    throw new BankProviderError('INVALID_PROVIDER_BINDING', 403);
  }
  return Object.freeze(Object.fromEntries(keys.map(key => [key, value[key]])));
}

/** Uses the existing owner/purpose AES-GCM storage functions by injection.
 * Handles can be stored alongside existing encrypted_session/encrypted_accounts;
 * plaintext provider IDs and tokens must not be used as browser authority. */
export function scopedResourceCodec(input, codec, now = Date.now) {
  const binding = createProviderBinding(input);
  if (typeof codec?.seal !== 'function' || typeof codec?.unseal !== 'function') throw new BankProviderError('PROVIDER_CONFIGURATION_INVALID', 409);
  const scope = JSON.stringify([binding.companyId, binding.connectionId, binding.provider, binding.environment, binding.generation]);
  const purpose = kind => {
    if (!['consent', 'account', 'authorisation', 'redirect'].includes(kind)) throw new BankProviderError('RESOURCE_SCOPE_MISMATCH', 403);
    return `provider-resource-v1:${scope}:${kind}`;
  };
  async function open(kind, handle, requireUnexpired) {
    let value;
    try {
      if (typeof handle !== 'string' || handle.length > 32_768 || !handle) throw Error();
      value = await codec.unseal(binding.owner, purpose(kind), handle);
      if (!isRecord(value) || value.version !== 1 || !validInstant(value.expiresAt) || !isRecord(value.data)) throw Error();
    } catch { throw new BankProviderError('RESOURCE_SCOPE_MISMATCH', 403); }
    if (requireUnexpired && Date.parse(value.expiresAt) <= now()) throw new BankProviderError('RESOURCE_EXPIRED', 409);
    return snapshot(value.data);
  }
  return Object.freeze({
    async seal(kind, data, expiresAt) {
      if (!validInstant(expiresAt) || Date.parse(expiresAt) <= now()) throw new BankProviderError('RESOURCE_EXPIRED', 409);
      return codec.seal(binding.owner, purpose(kind), { version: 1, expiresAt, data: snapshot(data) });
    },
    open: (kind, handle) => open(kind, handle, true),
    // Only consent cleanup may decode expired authority. Authentication, purpose
    // and every owner/company/connection/generation binding remain unchanged.
    openConsentForRevocation: handle => open('consent', handle, false),
  });
}
