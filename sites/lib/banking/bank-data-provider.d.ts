export type BankProviderId = 'enable_banking' | 'open_payments';
export type ProviderEnvironment = 'SANDBOX' | 'PRODUCTION';
export interface ProviderBinding {
  readonly owner: string;
  readonly companyId: string;
  readonly connectionId: string;
  readonly provider: BankProviderId;
  readonly environment: ProviderEnvironment;
  readonly generation: string;
}
export interface ProviderResourceStorage {
  seal(owner: string, purpose: string, value: unknown): Promise<string>;
  unseal(owner: string, purpose: string, value: string): Promise<unknown>;
}
export interface ProviderContext {
  binding: ProviderBinding;
  corporateId: string;
  psuId: string;
  bicFi: string;
  corporateIdType?: string;
  affiliatedAspspId?: string;
  psu?: { ipAddress: string; userAgent: string };
}
export interface ProviderConnectionDependencies {
  /** Re-read authenticated membership, connection generation and revocation.
   * Throw on failure. The adapter checks both sides of asynchronous operations. */
  assertCurrent(binding: ProviderBinding): Promise<void>;
  codec: ProviderResourceStorage;
  /** Atomically consume the existing server flow once, bound to owner/cookie/state. */
  consumeRedirectState?(input: { binding: ProviderBinding; state: string; flowId: string }): Promise<boolean>;
}
export interface BankDataProvider {
  readonly id: BankProviderId;
  forCompany(context: ProviderContext, dependencies: ProviderConnectionDependencies): BankDataConnection;
}
export interface BankDataConnection {
  readonly provider: BankProviderId;
  readonly binding: ProviderBinding;
  listBanks(countries?: string[]): Promise<unknown>;
  discoverCapabilities(): Promise<unknown>;
  createConsent(input: { validUntil: string; frequencyPerDay?: number; redirectPreferred?: boolean }): Promise<unknown>;
  getConsentStatus(consentHandle: string): Promise<unknown>;
  revokeConsent(consentHandle: string): Promise<void>;
  listAccounts(consentHandle: string): Promise<unknown>;
  getAccount(accountHandle: string): Promise<unknown>;
  getTransactions(accountHandle: string, input: { dateFrom: string; dateTo: string; requireBankgiro?: boolean }): Promise<unknown>;
}
export class BankProviderError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfter?: number;
  readonly retryBlocked?: boolean;
  readonly mayHaveSucceeded?: boolean;
  constructor(code: string, status?: number, options?: { retryable?: boolean; retryAfter?: number; retryBlocked?: boolean; mayHaveSucceeded?: boolean });
}
export function createProviderBinding(value: ProviderBinding): Readonly<ProviderBinding>;
export function providerForConnection<T extends { id: BankProviderId }>(connection: { provider?: BankProviderId }, providers: Partial<Record<BankProviderId, T>>): T;
export function scopedResourceCodec(binding: ProviderBinding, codec: ProviderResourceStorage, now?: () => number): {
  seal(kind: 'consent' | 'account' | 'authorisation' | 'redirect', data: Record<string, unknown>, expiresAt: string): Promise<string>;
  open(kind: 'consent' | 'account' | 'authorisation' | 'redirect', handle: string): Promise<Record<string, unknown>>;
};
export function assertServerRuntime(): void;
export function isRecord(value: unknown): value is Record<string, unknown>;
export function safeText(value: unknown, max?: number): value is string;
export function snapshot<T>(value: T, code?: string): T;
export function validDate(value: unknown): value is string;
export function validInstant(value: unknown): value is string;
