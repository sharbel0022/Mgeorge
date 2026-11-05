/** Only account-information read capabilities are supported. */
export type ReadScope = 'accounts:read' | 'transactions:read' | 'bankgiro:read';
export type ConsentState = 'pending_authorization' | 'pending_account' | 'corporate_authorization_required' |
  'connected' | 'cancelled' | 'denied' | 'failed' | 'expired' | 'revoked';

/** Resolved by the server. Membership is separate from legal company identity. */
export type CompanyBankContext = {
  companyId: string;
  actorId: string;
  storageOwnerId: string;
  membershipVersion: string;
  role: 'owner' | 'admin' | 'member' | 'accountant' | 'viewer';
  active: boolean;
};

/** Server-authenticated bank/provider attestation, never browser input.
 * Adapter provenance is a precondition, not something this shape can prove. */
export type CorporateAuthorizationEvidence = {
  status: 'verified';
  origin: 'bank' | 'provider';
  evidenceId: string;
  companyId: string;
  actorId: string;
  bankName: string;
  country: string;
  accountUids: string[];
  checkedAt: string;
  validUntil: string;
};
export type CorporateAuthorization = CorporateAuthorizationEvidence |
  { status: 'unverified'; reason: 'CORPORATE_AUTHORIZATION_REQUIRED' };

/** UID is consent-specific; a stable key must come from the bank account adapter. */
export type ConnectedAccount = {
  uid: string;
  stableAccountKey?: string;
  companyId: string;
  consentId: string;
  selected: boolean;
  corporateAuthorization: CorporateAuthorization;
};
export type BankConsent = {
  id: string;
  version: 'bank-consent-v1';
  mode: 'company' | 'legacy';
  companyId: string;
  actorId: string;
  membershipVersion: string;
  bankName: string;
  country: string;
  state: ConsentState;
  requestedScopes: ReadScope[];
  grantedScopes: ReadScope[];
  accountUids: string[];
  validUntil: string;
  corporateAuthorization: CorporateAuthorization;
};

/** Closed diagnostics only; never account identifiers, provider text or hashes. */
export type BankAccountScopeReason = 'SAVED_SELECTION_EMPTY' | 'SAVED_SELECTION_INVALID' |
  'SAVED_ACCOUNTS_INVALID' | 'LIVE_ACCOUNTS_INVALID' | 'LIVE_ACCOUNT_DATA_INVALID' |
  'LIVE_ACCOUNT_SET_MISMATCH' | 'SELECTED_ACCOUNT_MISSING' | 'ACCOUNT_USAGE_INVALID' |
  'ACCOUNT_SET_MISMATCH' | 'ACCOUNT_IDENTITY_INVALID' | 'ACCOUNT_IDENTITY_CHANGED';
export class ConsentError extends Error {
  constructor(code: string, status?: number, safeMessage?: string);
  code: string;
  status: number;
  readonly reason?: BankAccountScopeReason;
}
export function bankAccountScopeError(reason: BankAccountScopeReason): ConsentError;
/** Returns only a reason privately bound by this policy, ignoring public fields. */
export function bankAccountScopeReason(error: unknown): BankAccountScopeReason | null;
export function legacyCompanyContext(actorId: string, requestedCompanyId?: unknown): CompanyBankContext;
export function assertCompanyBankAccess(context: CompanyBankContext, input: {
  actorId: string; companyId: string; action: 'read' | 'manage';
}): CompanyBankContext;
export type ConsentCallback = { state: string; code: string; error?: never; outcome?: never } |
  { state: string; code?: never; error: string; outcome: 'cancelled' | 'denied' | 'failed' };
export function validateCallbackParameters(params: URLSearchParams): ConsentCallback;
/** Undefined defaults to accounts and transactions. Both must be present because
 * adapters request transactions:true. Canonical order; subsets, duplicates,
 * unknown and payment scopes fail. Bankgiro may be requested but requires proof
 * unavailable from Enable Banking, so validateEnableConsent rejects that scope. */
export function validateReadScopes(value?: unknown): ReadScope[];

/** Inputs intentionally unknown: provider/saved data is validated at this boundary.
 * A session_id is not required; the exchange/loading adapter validates it.
 * Country defaults to SE. Dates are real calendar dates with 00-23 hour clocks
 * and either Z or a numeric timezone offset; now is epoch milliseconds.
 * Legacy omitted transaction flags are accepted only because authorization
 * adapters request transactions:true. Any explicit false/malformed flag fails.
 * Both checked.accounts and checked.accounts_data must agree with session UIDs.
 * Explicit private/unknown usage in either snapshot or fresh account data fails.
 * If both account snapshots include identification_hash, the singular values
 * must match exactly; plural identification_hashes cannot repair a conflict.
 * Granted scopes are exactly accounts:read and transactions:read on success.
 * Requested Bankgiro always fails: this provider session cannot prove that scope. */
export function validateEnableConsent(input: {
  session: unknown;
  checked: unknown;
  bankName: string;
  country?: string;
  requestedValidUntil: string;
  requestedScopes?: unknown;
  now?: number;
}): { validUntil: string; accountUids: string[]; grantedScopes: ReadScope[]; missingScopes: ReadScope[] };

/** Compatibility adapter only for an existing server-resolved legacy selection.
 * Full cached and current UID inventories are bounded/unique valid UUIDs; the
 * complete GET account/data sets must match before selection projection.
 * Every selected UID must exist in both inventories. The unchanged strict
 * validator then checks selected usage/identity and all consent invariants.
 * Does not establish legacy eligibility, company authority or new account access.
 * New callbacks and company consents must call validateEnableConsent directly. */
export function validateLegacyEnableSelection(input: Parameters<typeof validateEnableConsent>[0] & {
  selectedAccountUids: unknown;
}): ReturnType<typeof validateEnableConsent>;

/** Exact actor/company/bank/account-set evidence is required. Missing or invalid
 * evidence returns unverified; malformed/expired consent inputs throw.
 * Callers must authenticate the evidence through a trusted server adapter. */
export function corporateAuthorization(input: {
  companyId: string;
  actorId: string;
  bankName: string;
  country: string;
  accountUids: string[];
  validUntil: string;
  evidence?: unknown;
  now?: number;
}): CorporateAuthorization;

export function companyBankContext(current: unknown, storageOwner: string, requestedCompanyId?: unknown, action?: 'read' | 'manage'): CompanyBankContext;
