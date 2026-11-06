import {assertCompanyContext} from './company-contract.js';
/** Pure policy shared by the Sites and Node consent adapters. No identity,
 * membership, provider or evidence is fetched here: callers supply server data. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const SCOPES = ['accounts:read', 'transactions:read', 'bankgiro:read'];
const DEFAULT_SCOPES = ['accounts:read', 'transactions:read'];
const MAX_ACCOUNTS = 100;
const MESSAGES = {
  COMPANY_ACCESS_DENIED: 'Du saknar behörighet till företagets bankanslutning.',
  INVALID_CALLBACK: 'Bankens återkoppling kunde inte verifieras.',
  INVALID_CONSENT_SCOPES: 'De begärda läsbehörigheterna är ogiltiga.',
  BANKGIRO_SCOPE_UNAVAILABLE: 'Bankgirobehörighet kan inte styrkas av denna bankanslutning.',
  BANK_CONSENT_INVALID: 'Bankens medgivande kunde inte verifieras.',
  BANK_CONSENT_EXPIRED: 'Bankens medgivande har löpt ut eller har ogiltig giltighetstid.',
  BANK_ACCOUNT_SCOPE_INVALID: 'Bankens godkända konton kunde inte verifieras.',
  BANK_TRANSACTION_SCOPE_REQUIRED: 'Bankens medgivande ger inte den nödvändiga transaktionsbehörigheten.',
  CORPORATE_AUTHORIZATION_REQUIRED: 'Bankens behörighet för företaget behöver verifieras.',
  BUSINESS_BANK_UNAVAILABLE: 'Den valda banken är inte tillgänglig för företagsanslutning via den här integrationen.',
  CONSENT_FLOW_EXPIRED: 'Anslutningsförsöket har löpt ut. Starta ett nytt försök.',
  CONSENT_APPLICATION_CHANGED: 'Banktjänstens inställningar ändrades. Starta ett nytt anslutningsförsök.',
  CONSENT_RENEWAL_CONFLICT: 'Bankanslutningen ändrades under återanslutningen. Starta ett nytt försök.',
  BANK_DISCONNECT_PENDING: 'Slutför frånkopplingen innan bankanslutningen används igen.',
  SAAS_BANK_CONFIGURATION_INVALID: 'Banktjänstens företagskonfiguration kunde inte verifieras.',
  SAAS_BANK_DISABLED: 'Banktjänsten är inte aktiverad för företaget.',
  BANK_BUSY: 'En bankåtgärd pågår redan. Vänta tills den är klar innan du försöker igen.',
  BANK_STATE_CHANGED: 'Bankanslutningen ändrades under åtgärden. Kontrollera status och försök igen.',
  RESOURCE_SCOPE_MISMATCH: 'Bankresursen tillhör inte den godkända anslutningen.',
  BANK_AUTHENTICATION_METHOD_REQUIRED: 'Välj en av bankens tillgängliga autentiseringsmetoder.',
  IDEMPOTENCY_KEY_REQUIRED: 'Åtgärden saknar ett giltigt idempotens-ID.',
  IDEMPOTENCY_KEY_REUSED: 'Åtgärdens idempotens-ID har redan använts för andra uppgifter.',
  BANK_RATE_POLICY_REQUIRED: 'Bankens tillåtna hämtningsfrekvens behöver konfigureras.',
};
const GENERIC_MESSAGE = 'Bankanslutningen kunde inte verifieras.';
const ACCOUNT_SCOPE_REASONS = new Set([
  'SAVED_SELECTION_EMPTY', 'SAVED_SELECTION_INVALID', 'SAVED_ACCOUNTS_INVALID',
  'LIVE_ACCOUNTS_INVALID', 'LIVE_ACCOUNT_DATA_INVALID', 'LIVE_ACCOUNT_SET_MISMATCH',
  'SELECTED_ACCOUNT_MISSING', 'ACCOUNT_USAGE_INVALID', 'ACCOUNT_SET_MISMATCH',
  'ACCOUNT_IDENTITY_INVALID', 'ACCOUNT_IDENTITY_CHANGED',
]);
// Public error properties are not a provenance boundary. Only reasons created
// here may be serialized; arbitrary fields/getters on other errors are ignored.
const accountScopeReasons = new WeakMap();
const accountUsageDiagnostics = new WeakMap();
const accountUsageReadInputs = new WeakMap();
const accountUsageReadPlans = new WeakMap();
// Diagnostic provenance is internal. Mutable Error properties, custom text and
// objects with a forged prototype must never become operational evidence.
const DIAGNOSTICS = new WeakMap();
const ACCOUNT_REASONS = new Set([
  'SAVED_ACCOUNT_DATA_INVALID', 'CURRENT_ACCOUNT_DATA_INVALID',
  'SAVED_ACCOUNT_USAGE_INVALID', 'CURRENT_ACCOUNT_USAGE_INVALID',
  'SAVED_ACCOUNT_IDS_INVALID', 'CURRENT_ACCOUNT_IDS_INVALID', 'CURRENT_ACCOUNT_DETAILS_INVALID',
  'CURRENT_ACCOUNT_INVENTORY_MISMATCH', 'CONSENT_ACCOUNT_INVENTORY_CHANGED',
  'ACCOUNT_IDENTITY_CHANGED', 'SELECTED_ACCOUNT_IDS_INVALID', 'SELECTED_ACCOUNT_UNAVAILABLE',
]);

export class ConsentError extends Error {
  constructor(code, status = 400, safeMessage) {
    super(typeof safeMessage === 'string' && clean(safeMessage, 500) ? safeMessage : MESSAGES[code] ?? GENERIC_MESSAGE);
    this.name = 'ConsentError';
    this.code = code;
    this.status = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 400;
    if (typeof code === 'string' && Object.hasOwn(MESSAGES, code)) {
      DIAGNOSTICS.set(this, Object.freeze({ code, message: MESSAGES[code], status: this.status, reason: null }));
    }
  }
}

export function bankAccountScopeError(reason) {
  const error = new ConsentError('BANK_ACCOUNT_SCOPE_INVALID', 409);
  if (ACCOUNT_SCOPE_REASONS.has(reason)) {
    accountScopeReasons.set(error, reason);
    // Like other public Error fields this is presentation only. Diagnostics
    // below always read the private records, including after hostile mutation.
    Object.defineProperty(error, 'reason', { value: reason, enumerable: true, writable: true, configurable: true });
  }
  return error;
}
export function bankAccountScopeReason(error) {
  return accountScopeReasons.get(error) ?? null;
}
/** A bounded snapshot of validated selected resources, not authorization to
 * expose it. The caller must additionally bind it to its authenticated request. */
export function bankAccountUsageDiagnostic(error) {
  return accountUsageDiagnostics.get(error) ?? null;
}

// Diagnostic capabilities retain only immutable JSON data. Unknown properties
// cannot run getters/toJSON or change what an earlier policy error attested.
// Bounds are deliberately independent of the provider's HTTP response limit.
function diagnosticInputSnapshot(input) {
  let nodes = 0, characters = 0;
  const visiting = new Set();
  const copy = (value, depth = 0) => {
    if (++nodes > 20000 || depth > 20) throw Error('DIAGNOSTIC_INPUT_LIMIT');
    if (value === null || value === undefined || typeof value === 'boolean') return [value, [typeof value, value]];
    if (typeof value === 'string') {
      characters += value.length;
      if (characters > 8 * 1024 * 1024) throw Error('DIAGNOSTIC_INPUT_LIMIT');
      return [value, ['string', value]];
    }
    if (typeof value === 'number' && Number.isFinite(value)) return [value, ['number', value]];
    if (typeof value !== 'object' || visiting.has(value)) throw Error('DIAGNOSTIC_INPUT_INVALID');
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (prototype !== (array ? Array.prototype : Object.prototype) && prototype !== null) throw Error('DIAGNOSTIC_INPUT_INVALID');
    visiting.add(value);
    const properties = Object.getOwnPropertyDescriptors(value), result = array ? [] : Object.create(null), entries = [];
    for (const key of Reflect.ownKeys(properties)) {
      const property = properties[key];
      if (typeof key !== 'string' || !Object.hasOwn(property, 'value')) throw Error('DIAGNOSTIC_INPUT_INVALID');
      characters += key.length;
      if (characters > 8 * 1024 * 1024) throw Error('DIAGNOSTIC_INPUT_LIMIT');
      const [child, encoded] = copy(property.value, depth + 1);
      if (array && key === 'length') result.length = child;
      else Object.defineProperty(result, key, { value: child, enumerable: true });
      entries.push([key, encoded]);
    }
    visiting.delete(value);
    return [Object.freeze(result), [array ? 'array' : 'object', entries]];
  };
  const [snapshot, encoded] = copy(input);
  return { snapshot, fingerprint: JSON.stringify(encoded) };
}

const notRead = reason => Object.freeze({ status: 'not_read', reason });
const unavailableDetails = reason => Object.freeze({ status: 'unavailable', reason });
const INVALID_FIELD = Symbol('invalid diagnostic field');
function dataField(value, key) {
  if (!object(value)) return INVALID_FIELD;
  const property = Object.getOwnPropertyDescriptor(value, key);
  return property ? Object.hasOwn(property, 'value') ? property.value : INVALID_FIELD : key in value ? INVALID_FIELD : undefined;
}

/** A separate, narrower read capability. It cannot approve a consent or repair
 * its cached resources: the caller must keep and rethrow the original error. */
export function planAccountUsageDetailsRead(error, input, now = Date.now()) {
  try {
    const bound = accountUsageReadInputs.get(error);
    if (!bound || bound.input !== input || bankAccountScopeReason(error) !== 'ACCOUNT_USAGE_INVALID' ||
      dataField(error, 'code') !== 'BANK_ACCOUNT_SCOPE_INVALID' || dataField(error, 'status') !== 409 ||
      diagnosticInputSnapshot(input).fingerprint !== bound.fingerprint) return notRead('INPUT_NOT_BOUND');
    const value = bound.snapshot;
    const deadlines = [value.session.access.valid_until, value.checked.access.valid_until, value.requestedValidUntil].map(timestamp);
    if (!Number.isFinite(now) || deadlines.some(deadline => !Number.isFinite(deadline) || deadline <= now)) return notRead('CONSENT_EXPIRED');
    // Recheck the unchanged frozen input, including the full UID inventory. This
    // also prevents executable input behavior from masquerading as JSON data.
    let originalDenial = false;
    try { validateLegacyEnableSelection(value); }
    catch (checkedError) { originalDenial = bankAccountScopeReason(checkedError) === 'ACCOUNT_USAGE_INVALID'; }
    if (!originalDenial) return notRead('INPUT_NOT_BOUND');
    if (validateReadScopes(value.requestedScopes).includes('bankgiro:read')) return notRead('SCOPE_UNAVAILABLE');
    const saved = new Map(value.session.accounts.map(account => [account.uid, account]));
    const live = new Map(value.checked.accounts_data.map(account => [account.uid, account]));
    const targets = [], identities = new Map();
    for (const uid of value.selectedAccountUids) {
      const prior = saved.get(uid), current = live.get(uid);
      if (![undefined, null, 'ORGA'].includes(prior.usage) || ![undefined, 'ORGA'].includes(current.usage)) return notRead('USAGE_NOT_ELIGIBLE');
      const originalHash = prior.identification_hash, currentHash = current.identification_hash;
      if (originalHash === undefined || currentHash === undefined) return notRead('PRIMARY_IDENTITY_MISSING');
      if (!clean(originalHash, 4096) || !clean(currentHash, 4096)) return notRead('PRIMARY_IDENTITY_INVALID');
      if (originalHash !== currentHash) return notRead('PRIMARY_IDENTITY_CHANGED');
      if (prior.usage === null) { targets.push(Object.freeze({ uid })); identities.set(uid, { hash: originalHash, prior, current }); }
    }
    if (!targets.length) return notRead('USAGE_NOT_ELIGIBLE');
    if (targets.length > 5) return notRead('READ_LIMIT_EXCEEDED');
    const plan = Object.freeze({ status: 'ready', selectedCount: value.selectedAccountUids.length,
      validUntil: new Date(Math.min(...deadlines)).toISOString(), targets: Object.freeze(targets) });
    accountUsageReadPlans.set(plan, identities);
    return plan;
  } catch { return notRead('INPUT_NOT_BOUND'); }
}

function primaryIdentifiers(account) {
  const primary = dataField(account, 'account_id');
  if (primary === undefined || primary === null) return [];
  const iban = dataField(primary, 'iban'), other = dataField(primary, 'other'), result = [];
  if (iban === INVALID_FIELD || other === INVALID_FIELD || iban === undefined && other === undefined) return null;
  if (iban !== undefined) {
    if (!clean(iban, 34) || !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return null;
    result.push(['IBAN', iban]);
  }
  if (other !== undefined) {
    const scheme = dataField(other, 'scheme_name'), identification = dataField(other, 'identification');
    if (!clean(scheme, 35) || !/^[A-Z][A-Z0-9_]{0,34}$/.test(scheme) || !clean(identification, 80)) return null;
    result.push([scheme, identification]);
  }
  return result;
}

/** Observe only the exact requested resource under an authentic read plan.
 * The service separately fences live ownership, expiry and completion. */
export function observeAccountUsageDetails(plan, uid, details) {
  try {
    const expected = accountUsageReadPlans.get(plan)?.get(uid);
    if (!expected) return unavailableDetails('DETAILS_INPUT_NOT_BOUND');
    const responseUid = dataField(details, 'uid'), hash = dataField(details, 'identification_hash');
    if (responseUid !== undefined && (!clean(responseUid) || responseUid === INVALID_FIELD)) return unavailableDetails('DETAILS_IDENTITY_INVALID');
    if (responseUid !== undefined && responseUid !== uid) return unavailableDetails('DETAILS_IDENTITY_CHANGED');
    if (hash === undefined) return unavailableDetails('DETAILS_IDENTITY_MISSING');
    if (!clean(hash, 4096)) return unavailableDetails('DETAILS_IDENTITY_INVALID');
    if (hash !== expected.hash) return unavailableDetails('DETAILS_IDENTITY_CHANGED');
    const currency = dataField(details, 'currency'), type = dataField(details, 'cash_account_type'), usage = dataField(details, 'usage');
    const identifiers = primaryIdentifiers(details);
    if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency) || typeof type !== 'string' || !/^[A-Z0-9]{1,35}$/.test(type) ||
      usage === INVALID_FIELD || dataField(details, 'account_id') === null || !identifiers) return unavailableDetails('DETAILS_RESOURCE_INVALID');
    for (const account of [expected.prior, expected.current]) {
      if (account.currency !== undefined && account.currency !== currency) return unavailableDetails('DETAILS_ACCOUNT_CONFLICT');
      const priorIdentifiers = primaryIdentifiers(account);
      if (!priorIdentifiers) return unavailableDetails('DETAILS_RESOURCE_INVALID');
      identifiers.push(...priorIdentifiers);
    }
    // Equal hashes cannot resolve explicit same-scheme conflicts within or
    // between resources, even when the fresh response has no account_id.
    const valuesByScheme = new Map();
    for (const [scheme, value] of identifiers) {
      if (valuesByScheme.has(scheme) && valuesByScheme.get(scheme) !== value) return unavailableDetails('DETAILS_ACCOUNT_CONFLICT');
      valuesByScheme.set(scheme, value);
    }
    const category = usage === undefined ? 'omitted' : usage === 'ORGA' ? 'orga' : usage === 'PRIV' ? 'priv'
      : usage === null ? 'explicitNull' : typeof usage === 'string' ? 'otherString' : 'wrongType';
    return Object.freeze({ status: 'observed', category });
  } catch { return unavailableDetails('DETAILS_RESOURCE_INVALID'); }
}

function selectedUsageCounts(accounts) {
  const counts = { omitted: 0, orga: 0, priv: 0, explicitNull: 0, otherString: 0, wrongType: 0 };
  for (const account of accounts) {
    const property = Object.getOwnPropertyDescriptor(account, 'usage');
    // Provider and stored inputs are JSON. Accessors/inherited properties are
    // not diagnostic evidence; never re-read them or serialize unknown values.
    if (property ? !Object.hasOwn(property, 'value') : 'usage' in account) return null;
    const value = property?.value;
    const category = value === undefined ? 'omitted' : value === 'ORGA' ? 'orga' : value === 'PRIV' ? 'priv'
      : value === null ? 'explicitNull' : typeof value === 'string' ? 'otherString' : 'wrongType';
    counts[category]++;
  }
  return Object.freeze(counts);
}

/** Canonical non-sensitive evidence from an error actually created here. */
export function consentDiagnostic(error) {
  return DIAGNOSTICS.get(error) ?? null;
}

/** Reconstruct a persisted diagnostic using only this module's fixed values.
 * Callers must separately bind the stored event to the current connection. */
export function storedConsentDiagnostic(code, reason = null) {
  if (typeof code !== 'string' || !Object.hasOwn(MESSAGES, code)) return null;
  if (reason !== null && (code !== 'BANK_ACCOUNT_SCOPE_INVALID' || !ACCOUNT_REASONS.has(reason))) return null;
  return { code, message: MESSAGES[code], reason };
}

/** Read-only local assessment. A stored connected record is not a fresh
 * provider check, and this function never changes consent or retry state. */
export function storedEnableConnectionHealth(input, now = Date.now()) {
  const state = (status, blockedReason, nextAction, requiresReauthentication = false) => ({
    status, connected: status === 'connected', syncAllowed: status === 'connected',
    requiresReauthentication, blockedReason, nextAction, evidence: 'stored_connection',
  });
  if (!input || input.present !== true || ['disconnected', 'revoked'].includes(input.status)) {
    return state('disconnected', 'BANK_CONNECTION_REQUIRED', 'connect');
  }
  if (input.status === 'revocation_pending') return state('revocation_pending', 'BANK_DISCONNECT_PENDING', 'complete_revocation');
  if (input.storageReady !== true) return state('configuration_required', 'BANK_STORAGE_UNAVAILABLE', 'configure_service');
  if (input.applicationReady !== true) return state('configuration_required', 'BANK_CONFIGURATION_REQUIRED', 'configure_service');
  if (input.generationMatches !== true) return state('reauth_required', 'CONSENT_APPLICATION_CHANGED', 'reconnect', true);
  if (['reauth_required', 'renewal_required'].includes(input.status)) return state('reauth_required', 'BANK_RECONNECT_REQUIRED', 'reconnect', true);
  const expiry = timestamp(input.validUntil);
  if (input.status === 'expired' || !Number.isFinite(now) || !Number.isFinite(expiry) || expiry <= now) {
    return state('expired', 'BANK_CONSENT_EXPIRED', 'reconnect', true);
  }
  if (input.companyRequired === true && input.companyAuthorized !== true) {
    return state('corporate_authorization_required', 'CORPORATE_AUTHORIZATION_REQUIRED', 'verify_company_authority');
  }
  if (['pending_account', 'corporate_authorization_required', 'accounts'].includes(input.status) || !accountIds(input.selectedAccountUids)) {
    return state('pending_account', 'BANK_ACCOUNT_SELECTION_REQUIRED', 'select_accounts');
  }
  if (input.status !== 'connected') return state('error', 'BANK_SYNC_FAILED', 'inspect_connection');
  return state('connected', null, 'none');
}

function clean(value, max = 300) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !CONTROL.test(value);
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function deny(code, status = 400, reason = null) {
  const error = new ConsentError(code, status);
  if (reason !== null && code === 'BANK_ACCOUNT_SCOPE_INVALID' && ACCOUNT_REASONS.has(reason)) {
    DIAGNOSTICS.set(error, Object.freeze({ ...DIAGNOSTICS.get(error), reason }));
  }
  throw error;
}
// Keep the deployed public scope reason and the new stored diagnostic in
// separate private records. Both describe the same failed predicate; neither
// record can authorize a read or substitute for the other capability.
function denyAccountScope(reason, diagnosticReason = null) {
  const error = bankAccountScopeError(reason);
  if (ACCOUNT_REASONS.has(diagnosticReason)) {
    DIAGNOSTICS.set(error, Object.freeze({ ...DIAGNOSTICS.get(error), reason: diagnosticReason }));
  }
  throw error;
}
function timestamp(value) {
  if (typeof value !== 'string' || value.length > 50) return NaN;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!parts) return NaN;
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  // Date.parse normalizes some impossible dates (such as February 30) and
  // 24:00 to a different day. A consent timestamp must represent its own date.
  if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1] ||
    hour > 23 || minute > 59 || second > 59 || Number(parts[7] ?? 0) > 23 || Number(parts[8] ?? 0) > 59) return NaN;
  return Date.parse(value);
}
function accountIds(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_ACCOUNTS || !values.every(value => clean(value))) return null;
  return new Set(values).size === values.length ? [...values] : null;
}
function sameIds(left, right) {
  return left.length === right.length && left.every(id => right.includes(id));
}
function accountData(values) {
  return Array.isArray(values) && values.length > 0 && values.length <= MAX_ACCOUNTS && values.every(object);
}
function businessAccountData(values) {
  return accountData(values) && values.every(account => account.usage === undefined || account.usage === 'ORGA');
}

/** Compatibility context for the existing authenticated user's workspace.
 * This is membership context only, never proof of a legal company identity. */
export function legacyCompanyContext(actorId, requestedCompanyId) {
  if (!clean(actorId, 256)) deny('COMPANY_ACCESS_DENIED', 403);
  const companyId = `workspace:${actorId}`;
  if (requestedCompanyId !== undefined && requestedCompanyId !== companyId) deny('COMPANY_ACCESS_DENIED', 403);
  return { companyId, actorId, storageOwnerId: actorId, membershipVersion: 'legacy-owner-v1', role: 'owner', active: true };
}

/** The context must originate in a server membership resolver, not a request body. */
export function assertCompanyBankAccess(context, input) {
  if (!object(context) || !object(input) || !clean(input.actorId, 256) || !clean(input.companyId) ||
    context.actorId !== input.actorId || context.companyId !== input.companyId || context.active !== true ||
    !clean(context.storageOwnerId, 256) || !clean(context.membershipVersion) ||
    !['owner', 'admin', 'accountant', 'member', 'viewer'].includes(context.role) || !['read', 'manage'].includes(input.action) ||
    (input.action === 'manage' && !['owner', 'admin'].includes(context.role))) deny('COMPANY_ACCESS_DENIED', 403);
  return context;
}

/** Strict callback envelope. Descriptions are used only for the provider's exact
 * documented cancellation marker; neither descriptions nor unknown errors escape. */
export function validateCallbackParameters(params) {
  if (!(params instanceof URLSearchParams)) deny('INVALID_CALLBACK');
  const allowed = new Set(['state', 'code', 'error', 'error_description']);
  const seen = new Set();
  for (const [key, value] of params) {
    if (!allowed.has(key) || seen.has(key) || CONTROL.test(value)) deny('INVALID_CALLBACK');
    seen.add(key);
  }
  const state = params.get('state');
  if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state)) deny('INVALID_CALLBACK');
  const hasCode = params.has('code'), hasError = params.has('error');
  if (hasCode === hasError || (!hasError && params.has('error_description'))) deny('INVALID_CALLBACK');
  if (hasCode) {
    const code = params.get('code');
    if (!clean(code, 4096)) deny('INVALID_CALLBACK');
    return { state, code };
  }
  const error = params.get('error'), description = params.get('error_description');
  if (!clean(error, 128) || (description !== null && !clean(description, 1024))) deny('INVALID_CALLBACK');
  if (error === 'access_denied') {
    return { state, error, outcome: description === 'Cancelled by user' ? 'cancelled' : 'denied' };
  }
  const documented = ['invalid_request', 'unauthorized_client', 'unsupported_response_type', 'invalid_scope', 'server_error', 'temporarily_unavailable'];
  return { state, error: documented.includes(error) ? error : 'authorization_failed', outcome: 'failed' };
}

/** Account and transaction reads are required together, matching the adapters'
 * authorization request. Canonical ordering; duplicate/unknown/write scopes fail. */
export function validateReadScopes(value = DEFAULT_SCOPES) {
  if (!Array.isArray(value) || value.length < DEFAULT_SCOPES.length || value.length > SCOPES.length ||
    !value.every(scope => SCOPES.includes(scope)) || new Set(value).size !== value.length ||
    !DEFAULT_SCOPES.every(scope => value.includes(scope))) deny('INVALID_CONSENT_SCOPES');
  return SCOPES.filter(scope => value.includes(scope));
}

/** Validate the exchanged/saved snapshot against a fresh GET /sessions response.
 * Enable Banking's optional transactions field may be omitted in legacy session
 * responses. The adapters request transactions:true during authorization; an
 * explicit false (or malformed flag) in either response always fails closed.
 * Session IDs are validated by the adapter that exchanges/loads the session.
 * Business PSU/ORGA usage never establishes corporate account ownership. */
export function validateEnableConsent(input) {
  if (!object(input)) deny('BANK_CONSENT_INVALID', 409);
  const { session, checked, bankName, country = 'SE', requestedValidUntil, requestedScopes, now = Date.now() } = input;
  const scopes = validateReadScopes(requestedScopes);
  if (!Number.isFinite(now) || !clean(bankName) || !/^[A-Z]{2}$/.test(country) || !object(session) || !object(checked) || checked.status !== 'AUTHORIZED') deny('BANK_CONSENT_INVALID', 409);
  for (const response of [session, checked]) {
    if (!object(response.aspsp) || response.aspsp.name !== bankName || response.aspsp.country !== country ||
      response.psu_type !== 'business' || !object(response.access)) deny('BANK_CONSENT_INVALID', 409);
    if (response.access.transactions !== undefined && response.access.transactions !== true) deny('BANK_TRANSACTION_SCOPE_REQUIRED', 409);
  }
  const deadlines = [session.access.valid_until, checked.access.valid_until, requestedValidUntil].map(timestamp);
  if (deadlines.some(deadline => !Number.isFinite(deadline) || deadline <= now)) deny('BANK_CONSENT_EXPIRED', 409);
  if (!accountData(session.accounts)) denyAccountScope('SAVED_ACCOUNTS_INVALID', 'SAVED_ACCOUNT_DATA_INVALID');
  if (!accountData(checked.accounts_data)) denyAccountScope('LIVE_ACCOUNT_DATA_INVALID', 'CURRENT_ACCOUNT_DATA_INVALID');
  if (!businessAccountData(session.accounts)) denyAccountScope('ACCOUNT_USAGE_INVALID', 'SAVED_ACCOUNT_USAGE_INVALID');
  if (!businessAccountData(checked.accounts_data)) denyAccountScope('ACCOUNT_USAGE_INVALID', 'CURRENT_ACCOUNT_USAGE_INVALID');
  const sessionIds = accountIds(session.accounts.map(account => account.uid));
  const checkedIds = accountIds(checked.accounts);
  const dataIds = accountIds(checked.accounts_data.map(account => account.uid));
  if (!sessionIds) denyAccountScope('SAVED_ACCOUNTS_INVALID', 'SAVED_ACCOUNT_IDS_INVALID');
  if (!checkedIds) denyAccountScope('LIVE_ACCOUNTS_INVALID', 'CURRENT_ACCOUNT_IDS_INVALID');
  if (!dataIds) denyAccountScope('LIVE_ACCOUNT_DATA_INVALID', 'CURRENT_ACCOUNT_DETAILS_INVALID');
  if (!sameIds(checkedIds, dataIds)) denyAccountScope('ACCOUNT_SET_MISMATCH', 'CURRENT_ACCOUNT_INVENTORY_MISMATCH');
  if (!sameIds(sessionIds, checkedIds)) denyAccountScope('ACCOUNT_SET_MISMATCH', 'CONSENT_ACCOUNT_INVENTORY_CHANGED');
  const currentAccounts = new Map(checked.accounts_data.map(account => [account.uid, account]));
  for (const account of session.accounts) {
    const originalHash = account.identification_hash, currentHash = currentAccounts.get(account.uid).identification_hash;
    // The singular hash must agree exactly when both responses supply it.
    // Overlap in identification_hashes is not evidence that repairs a conflict.
    if (originalHash !== undefined && currentHash !== undefined) {
      if (!clean(originalHash, 4096) || !clean(currentHash, 4096)) denyAccountScope('ACCOUNT_IDENTITY_INVALID', 'ACCOUNT_IDENTITY_CHANGED');
      if (originalHash !== currentHash) denyAccountScope('ACCOUNT_IDENTITY_CHANGED', 'ACCOUNT_IDENTITY_CHANGED');
    }
  }
  // An AIS account/transaction session does not attest access to Bankgiro reports.
  if (scopes.includes('bankgiro:read')) deny('BANKGIRO_SCOPE_UNAVAILABLE', 409);
  return { validUntil: new Date(Math.min(...deadlines)).toISOString(), accountUids: sessionIds,
    grantedScopes: [...DEFAULT_SCOPES], missingScopes: [] };
}

/** Existing legacy selection only: callers must establish the retained legacy
 * connection before choosing this adapter. This does not authorize a company,
 * enroll an account, or replace strict full-set validation for new callbacks.
 * Validate the complete provider UID inventory before narrowing to the persisted
 * selection. Unavailable/unselected accounts never become an added grant. */
export function validateLegacyEnableSelection(input) {
  if (!object(input) || !object(input.session) || !object(input.checked)) deny('BANK_CONSENT_INVALID', 409);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const uids = values => { const ids = accountIds(values); return ids && ids.every(id => uuid.test(id)) ? ids : null; };
  const resourceIds = values => Array.isArray(values) && values.length <= MAX_ACCOUNTS && values.every(object) ? uids(values.map(account => account.uid)) : null;
  const savedIds = resourceIds(input.session.accounts), liveIds = uids(input.checked.accounts), dataIds = resourceIds(input.checked.accounts_data), selected = uids(input.selectedAccountUids);
  if (!savedIds) denyAccountScope('SAVED_ACCOUNTS_INVALID', 'SAVED_ACCOUNT_IDS_INVALID');
  if (!liveIds) denyAccountScope('LIVE_ACCOUNTS_INVALID', 'CURRENT_ACCOUNT_IDS_INVALID');
  if (!dataIds) denyAccountScope('LIVE_ACCOUNT_DATA_INVALID', 'CURRENT_ACCOUNT_DETAILS_INVALID');
  if (!selected) denyAccountScope(Array.isArray(input.selectedAccountUids) && !input.selectedAccountUids.length ? 'SAVED_SELECTION_EMPTY' : 'SAVED_SELECTION_INVALID', 'SELECTED_ACCOUNT_IDS_INVALID');
  if (!sameIds(liveIds, dataIds)) denyAccountScope('LIVE_ACCOUNT_SET_MISMATCH', 'CURRENT_ACCOUNT_INVENTORY_MISMATCH');
  if (!selected.every(id => savedIds.includes(id) && liveIds.includes(id))) denyAccountScope('SELECTED_ACCOUNT_MISSING', 'SELECTED_ACCOUNT_UNAVAILABLE');
  const chosen = new Set(selected);
  const projected = { ...input,
    session: { ...input.session, accounts: input.session.accounts.filter(account => chosen.has(account.uid)) },
    checked: { ...input.checked, accounts: input.checked.accounts.filter(id => chosen.has(id)),
      accounts_data: input.checked.accounts_data.filter(account => chosen.has(account.uid)) },
  };
  try { return validateEnableConsent(projected); }
  catch (error) {
    if (bankAccountScopeReason(error) === 'ACCOUNT_USAGE_INVALID') {
      // Diagnostic failures never replace or relax the original policy denial.
      try {
        const saved = selectedUsageCounts(projected.session.accounts), live = selectedUsageCounts(projected.checked.accounts_data);
        if (saved && live) accountUsageDiagnostics.set(error, Object.freeze({
          version: 'selected-account-usage-v1', selectedCount: selected.length, saved, live,
        }));
        if (saved && live) accountUsageReadInputs.set(error, { input, ...diagnosticInputSnapshot(input) });
      } catch { /* Keep the original denial without diagnostic evidence. */ }
    }
    throw error;
  }
}

/** Validate an attestation already authenticated by a trusted server adapter.
 * This pure function cannot establish its provenance. Never pass browser-supplied
 * evidence here, and never convert a person hash or business usage into evidence. */
export function corporateAuthorization(input) {
  if (!object(input)) deny('CORPORATE_AUTHORIZATION_REQUIRED', 409);
  const { companyId, actorId, bankName, country, validUntil, evidence, now = Date.now() } = input;
  const ids = accountIds(input.accountUids), expiry = timestamp(validUntil);
  if (!clean(companyId) || !clean(actorId, 256) || !clean(bankName) || !/^[A-Z]{2}$/.test(country) ||
    !ids || !Number.isFinite(now) || !Number.isFinite(expiry) || expiry <= now) deny('CORPORATE_AUTHORIZATION_REQUIRED', 409);
  const unverified = { status: 'unverified', reason: 'CORPORATE_AUTHORIZATION_REQUIRED' };
  if (!object(evidence)) return unverified;
  const evidenceIds = accountIds(evidence.accountUids), checkedAt = timestamp(evidence.checkedAt), evidenceExpiry = timestamp(evidence.validUntil);
  if (evidence.status !== 'verified' || !['bank', 'provider'].includes(evidence.origin) || !clean(evidence.evidenceId) ||
    evidence.companyId !== companyId || evidence.actorId !== actorId || evidence.bankName !== bankName || evidence.country !== country ||
    !evidenceIds || !sameIds(ids, evidenceIds) || !Number.isFinite(checkedAt) || checkedAt > now ||
    !Number.isFinite(evidenceExpiry) || evidenceExpiry <= now || checkedAt >= evidenceExpiry) return unverified;
  return { status: 'verified', origin: evidence.origin, evidenceId: evidence.evidenceId,
    companyId, actorId, bankName, country, accountUids: ids, checkedAt: new Date(checkedAt).toISOString(),
    validUntil: new Date(Math.min(expiry, evidenceExpiry)).toISOString() };
}

/** Adapts only a context already resolved and fenced by the foundation. */
export function companyBankContext(current, storageOwner, requestedCompanyId, action='manage') {
  if(!current)return assertCompanyBankAccess(legacyCompanyContext(storageOwner,requestedCompanyId),{actorId:storageOwner,companyId:`workspace:${storageOwner}`,action});
  const c=assertCompanyContext(current);
  if(c.storageOwner!==storageOwner||requestedCompanyId!==undefined&&requestedCompanyId!==c.companyId)throw new ConsentError('COMPANY_ACCESS_DENIED',403);
  const context={companyId:c.companyId,actorId:c.actorId,storageOwnerId:c.storageOwner,membershipVersion:String(c.membershipVersion),role:c.role,active:true};
  return assertCompanyBankAccess(context,{actorId:c.actorId,companyId:c.companyId,action});
}
