import type { CompanyContext, CompanyAction } from '../company-contract.js';
import type { OpenPaymentsProvider, OpenPaymentsOriginal } from './openpayments-provider.js';
import type { ProviderResourceStorage } from './bank-data-provider.js';

export interface CompanyProviderLease {
  assert(): void | Promise<void>;
  /** The concrete existing Node/D1 bank lock retains its transaction-bound writer. */
  write?: (...args: any[]) => any;
  fence?: () => unknown;
}
export type ProviderConnectionStatus = 'creating' | 'authorization_required' | 'starting' | 'pending_authorization' | 'accounts_required' | 'connected' | 'review' | 'revocation_pending' | 'revoked' | 'expired';
/** Maps exactly to bank_provider_connections. encrypted_state is codec output;
 * selected_accounts is JSON containing public opaque selector IDs, never handles. */
export interface CompanyProviderConnectionRow {
  id: string; owner: string; company_id: string; provider_kind: 'open_payments';
  environment: 'SANDBOX' | 'PRODUCTION'; app_generation: string;
  bank_id: string; bank_name: string; status: ProviderConnectionStatus;
  encrypted_state: string; selected_accounts: string; valid_until: string;
  revision: number; last_synced_at: string; last_error: string;
  /** Stable actual provider/environment/consent identity digest; never a token. */
  grant_fingerprint: string;
  request_key_hash: string; created_at: string; updated_at: string;
}
/** A DTO over the EXISTING authorization-flow table. The adapter maps id to the
 * added public provider_flow_id and payload to encrypted provider_payload.
 * Pins also map to existing company/actor/context/membership columns. All other
 * private values remain inside encryptedPayload. No separate flow table. */
export interface CompanyProviderFlow {
  id: string; owner: string; companyId: string; connectionId: string;
  provider: 'open_payments'; environment: 'SANDBOX' | 'PRODUCTION'; appGeneration: string;
  initiatingContext: Readonly<CompanyContext>; browserHash: string;
  requestKeyHash: string; requestFingerprint: string;
  stateHash: string; encryptedPayload: string; expiresAt: string;
  status: 'creating' | 'method_required' | 'pending' | 'decoupled' | 'used' | 'review' | 'cancelled';
}
export interface CompanyProviderRepository {
  /** All reads are immutable owner/company scoped and perform live authority checks. */
  listConnections(context: Readonly<CompanyContext>): Promise<CompanyProviderConnectionRow[]>;
  getConnection(context: Readonly<CompanyContext>, id: string): Promise<CompanyProviderConnectionRow | null>;
  findFlowByRequestKey(context: Readonly<CompanyContext>, requestKeyHash: string): Promise<CompanyProviderFlow | null>;
  getFlow(context: Readonly<CompanyContext>, id: string): Promise<CompanyProviderFlow | null>;
  /** Atomic connection insert/CAS plus optional existing-flow insert/update.
   * expectedRevision=null inserts; otherwise current revision must equal it and
   * the supplied row's revision must be expectedRevision+1. expectedFlowStatus
   * absent inserts a new flow; otherwise update only that exact current status.
   * Adapters fence current membership/role/company/selection, scope, revision and
   * existing bank-lock ownership IN the same protected transaction. Duplicate
   * request keys fail atomically with PROVIDER_REQUEST_CONFLICT; a nonempty
   * grant_fingerprint already reserved by ANY other connection/company fails
   * with PROVIDER_GRANT_REUSED (global catalogue fence for partitioned Node).
   * Historical grant claims remain reserved across renewal/revocation.
   * A connected row's clamped valid_until must remain strictly after the SQL
   * execution clock; expiry aborts the complete connection/claim/flow batch.
   * Stale CAS fails with
   * PROVIDER_REVISION_CONFLICT. Lost commit responses must be resolved by readback.
   */
  commit(context: Readonly<CompanyContext>, change: {
    expectedRevision: number | null; connection: CompanyProviderConnectionRow;
    flow?: CompanyProviderFlow; expectedFlowStatus?: CompanyProviderFlow['status'];
  }, lease: CompanyProviderLease): Promise<void>;
  /** Durable single-use transition pending -> used, BEFORE provider token
   * activation. Compare exact encrypted payload, state/browser hashes, expiry,
   * initiating context and owner/company/provider/connection/app binding in the
   * same live-authority/lease-fenced transaction. Return false on any mismatch.
   * providerFlowId is checked against the encrypted payload by the core and is
   * audit context; it must never become callback-supplied authority. */
  consumeFlow(context: Readonly<CompanyContext>, expected: {
    id: string; expectedPayload: string; stateHash: string; browserHash: string;
    providerFlowId: string; expectedStatus: 'pending';
  }, lease: CompanyProviderLease): Promise<boolean>;
}
export interface CompanyProviderRegistration {
  verified: true; companyId: string; owner: string; evidenceId: string;
  environment: 'SANDBOX' | 'PRODUCTION'; appGeneration: string;
  validUntil: string; corporateId: string; psuId: string;
  corporateIdType?: string; affiliatedAspspId?: string;
  psu?: { ipAddress: string; userAgent: string };
  redirectUri: string;
  /** Trusted runtime attestation, in addition to provider constructor enforcement. */
  productionTransportVerified?: boolean;
}
export interface ProviderBrowserBinding { cookie: string; session: string }
export interface PublicProviderAccount {
  id: string; label: string; currency: string; selected: boolean;
  companyAccountVerified: false; bankgiroMappingVerified: false;
}
export interface PublicProviderConnection {
  id: string; provider: 'open_payments'; bank: { id: string; name: string };
  status: ProviderConnectionStatus; revision: number; validUntil: string;
  /** Current provider/registration permits the connection's lifecycle actions. */
  available: boolean;
  /** Separately gates new grants, callbacks, account selection and navigation. */
  onboardingAvailable: boolean; accounts: PublicProviderAccount[];
  methods: { id: string; name: string; type: string }[];
  flowId?: string; redirectPath?: string; error: string | null;
  payments: 'disabled'; paymentDataComplete: false;
}
export interface DurableProviderAcquisitionReceipt {
  version: 'provider-acquisition-receipt-v1'; id: string; companyId: string;
  connectionId: string; accountId: string; sha256: string; committedAt: string;
}
/** Private server-only handoff. It is never part of a public manager result.
 * A durable consumer must fence effectiveConsentValidUntil inside its own
 * protected commit as well as calling the supplied live assertCurrent guard. */
export interface PrivateProviderAcquisition {
  toJSON(): never;
  connectionId: string; accountId: string;
  /** Private minimum row/account/current bank consent deadline; never a public promise. */
  effectiveConsentValidUntil: string;
  booked: Record<string, unknown>[]; bankgiro: Record<string, unknown>[];
  originals: OpenPaymentsOriginal[];
  bankgiroEvidence: { status: string; completeness: 'unknown' };
  paymentReconciliationAllowed: false;
}
export interface CompanyProviderManagerOptions {
  provider?: OpenPaymentsProvider | null; repository: CompanyProviderRepository;
  codec: ProviderResourceStorage;
  currentContext(): CompanyContext | Promise<CompanyContext>;
  assertCurrent(context: Readonly<CompanyContext>, action: CompanyAction): void | Promise<void>;
  registration?(context: Readonly<CompanyContext>): CompanyProviderRegistration | null | Promise<CompanyProviderRegistration | null>;
  withBankLock<T>(owner: string, run: (lease: CompanyProviderLease) => Promise<T>): Promise<T>;
  /** Trusted live activation gate; false preserves owned read/revoke/acquisition. */
  onboardingEnabled?: boolean | (() => boolean | Promise<boolean>); now?: () => number; randomId?: () => string;
  hash?: (value: string) => string | Promise<string>;
  paths?: { redirect: string };
}
export function parseOpenPaymentsCallback(parameters: URLSearchParams | string): { code: string; scope: string; state: string };
export function createCompanyProviderManager(options: CompanyProviderManagerOptions): {
  discoverBanks(input?: { countries?: string[] }): Promise<{ provider: 'open_payments'; banks: { id: string; name: string }[]; payments: 'disabled' }>;
  start(input: { bankId: string; validUntil: string; requestKey: string; browser: ProviderBrowserBinding; renewConnectionId?: string; expectedRevision?: number }): Promise<PublicProviderConnection>;
  chooseMethod(input: { connectionId: string; revision: number; methodId: string; browser: ProviderBrowserBinding }): Promise<PublicProviderConnection>;
  status(input?: { connectionId?: string; refresh?: boolean }): Promise<PublicProviderConnection | { connections: PublicProviderConnection[] }>;
  callback(input: { flowId: string; parameters: URLSearchParams | string; browser: ProviderBrowserBinding }): Promise<PublicProviderConnection>;
  selectAccounts(input: { connectionId: string; revision: number; accountIds: string[] }): Promise<PublicProviderConnection>;
  revoke(input: { connectionId: string; revision: number }): Promise<PublicProviderConnection>;
  withRedirect<T>(input: { flowId: string; browser: ProviderBrowserBinding }, sendRedirect: (providerUrl: string) => T | Promise<T>): Promise<T>;
  acquireTransactions(input: { connectionId: string; accountId: string; dateFrom: string; dateTo: string; requireBankgiro?: boolean }, onAcquired: (data: PrivateProviderAcquisition, guard: { assertCurrent(): Promise<void>; lease: CompanyProviderLease }) => void | DurableProviderAcquisitionReceipt | Promise<void | DurableProviderAcquisitionReceipt>): Promise<{ status: 'acquired'; bookedCount: number; bankgiroCount: number; committed: boolean; receiptId?: string; paymentReconciliationAllowed: false }>;
};
