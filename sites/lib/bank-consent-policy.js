/** Pure policy shared by the Sites and Node consent adapters. No identity,
 * membership, provider or evidence is fetched here: callers supply server data. */
import {assertCompanyContext} from './company-contract.js';
export {saasOnboardingEnabled} from './company-contract.js';
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
};
const GENERIC_MESSAGE = 'Bankanslutningen kunde inte verifieras.';

export class ConsentError extends Error {
  constructor(code, status = 400, safeMessage) {
    super(typeof safeMessage === 'string' && clean(safeMessage, 500) ? safeMessage : MESSAGES[code] ?? GENERIC_MESSAGE);
    this.name = 'ConsentError';
    this.code = code;
    this.status = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 400;
  }
}

function clean(value, max = 300) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !CONTROL.test(value);
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function deny(code, status = 400) { throw new ConsentError(code, status); }
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
function businessAccountData(values) {
  return Array.isArray(values) && values.length > 0 && values.length <= MAX_ACCOUNTS &&
    values.every(account => object(account) && (account.usage === undefined || account.usage === 'ORGA'));
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
    !clean(context.storageOwnerId, 256) || !(clean(context.membershipVersion) || Number.isSafeInteger(context.membershipVersion) && context.membershipVersion > 0) ||
    !['owner', 'admin', 'accountant', 'viewer'].includes(context.role) || !['read', 'manage'].includes(input.action) ||
    (input.action === 'manage' && !['owner', 'admin'].includes(context.role))) deny('COMPANY_ACCESS_DENIED', 403);
  return context;
}

/** Map an already resolved server context. This pure adapter does not establish
 * live membership and must never receive a context copied from request JSON. */
export function companyBankContext(current,actorId,requestedCompanyId,action='manage'){
  if(current==null){
    const legacy=legacyCompanyContext(actorId,requestedCompanyId);
    return Object.freeze(assertCompanyBankAccess(legacy,{actorId,companyId:legacy.companyId,action}));
  }
  let canonical;try{canonical=assertCompanyContext(current);}catch{deny('COMPANY_ACCESS_DENIED',403);}
  const context=Object.freeze({...canonical,storageOwnerId:canonical.storageOwner,active:true});
  return assertCompanyBankAccess(context,{actorId,companyId:requestedCompanyId??canonical.companyId,action});
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
  if (!businessAccountData(session.accounts) || !businessAccountData(checked.accounts_data)) deny('BANK_ACCOUNT_SCOPE_INVALID', 409);
  const sessionIds = accountIds(session.accounts.map(account => account.uid));
  const checkedIds = accountIds(checked.accounts);
  const dataIds = accountIds(checked.accounts_data.map(account => account.uid));
  if (!sessionIds || !checkedIds || !dataIds || !sameIds(sessionIds, checkedIds) || !sameIds(sessionIds, dataIds)) deny('BANK_ACCOUNT_SCOPE_INVALID', 409);
  const currentAccounts = new Map(checked.accounts_data.map(account => [account.uid, account]));
  for (const account of session.accounts) {
    const originalHash = account.identification_hash, currentHash = currentAccounts.get(account.uid).identification_hash;
    // The singular hash must agree exactly when both responses supply it.
    // Overlap in identification_hashes is not evidence that repairs a conflict.
    if (originalHash !== undefined && currentHash !== undefined &&
      (!clean(originalHash, 4096) || !clean(currentHash, 4096) || originalHash !== currentHash)) deny('BANK_ACCOUNT_SCOPE_INVALID', 409);
  }
  // An AIS account/transaction session does not attest access to Bankgiro reports.
  if (scopes.includes('bankgiro:read')) deny('BANKGIRO_SCOPE_UNAVAILABLE', 409);
  return { validUntil: new Date(Math.min(...deadlines)).toISOString(), accountUids: sessionIds,
    grantedScopes: [...DEFAULT_SCOPES], missingScopes: [] };
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
