/** Trusted server contracts; not provider wire fields or browser enrollment inputs. */
export interface CompanySyncScope { companyId: string; owner: string; evidenceId: string; revision: number }
export interface CompanyReferencePolicy { companyId: string; owner: string; revision: number; companyName: string; mode: 'invoice_number' | 'ocr'; evidenceId: string }
export interface CompanySyncContext {
  companyId: string; owner: string; connectionId: string; provider: string;
  /** Stable opaque identity. Never a provider UID that changes on renewal. */
  accountKey: string; accountUid: string; consentId: string; generation: string;
  revision: number; validUntil: string; authorizationStatus: 'VERIFIED';
  ratePolicy: { verified: true; evidenceId: string; maxRequests: number; windowMs: number; scope?: 'account' | 'connection' };
  bankgiroEnabled: boolean;
}
export interface CompanySyncCoverage { ais: 'complete' | 'partial' | 'unknown'; bankgiro: 'verified' | 'unavailable' | 'unknown' | 'partial' | 'disabled'; paymentDataComplete: false }
export type CompanySyncOutcome = 'success' | 'partial' | 'blocked' | 'retry';
export interface CompanySyncGuard { assert(): unknown | Promise<unknown>; fence(): D1PreparedStatement }
export interface CompanySyncLease<C extends CompanySyncContext = CompanySyncContext> {
  context: C; deadline: number;
  assert(): Promise<unknown>; fence(): D1PreparedStatement; addGuard(guard: CompanySyncGuard): void;
  write(statements: D1PreparedStatement[]): Promise<unknown[]>; renew(): Promise<void>; reserveRequest(): Promise<{id: string}>;
  commit<T> (input: {key: string; sha256: string; statements: D1PreparedStatement[]; result: T; checkpoint?: unknown}): Promise<{duplicate: boolean; result: T}>;
  /** Node facade only: work is synchronous and joins the receipt transaction. */
  commitWork<T> (input: {key: string; sha256: string; work: () => T; checkpoint?: unknown}): Promise<{duplicate: boolean; result: T}>;
  finish(input: {status: CompanySyncOutcome; code?: string | null; nextAttemptAt?: number; coverage?: CompanySyncCoverage | null}): Promise<void>;
  release(): Promise<void>;
}
export interface CompanySyncStatus {
  companyId: string; owner: string; accountKey: string; connectionId: string;
  status: CompanySyncOutcome | 'queued' | 'running'; attempts: number;
  lastAttemptAt: number | null; lastSuccessAt: number | null; nextAttemptAt: number | null;
  code: string | null; coverage: CompanySyncCoverage; checkpoint: unknown;
}
export interface CompanySyncStore {
  bindScope(input: {companyId: string; owner: string; evidenceId: string}): Promise<CompanySyncScope>;
  scope(input: {companyId: string; owner: string}): Promise<CompanySyncScope>;
  setReferencePolicy(input: CompanyReferencePolicy): Promise<CompanyReferencePolicy>;
  referencePolicy(input: {companyId: string; owner: string}): Promise<CompanyReferencePolicy | null>;
  register(input: CompanySyncContext): Promise<void>; revoke(input: CompanySyncContext): Promise<void>;
  status(input: {companyId: string; owner: string; accountKey: string}): Promise<CompanySyncStatus | null>;
  receipt(input: {companyId: string; owner: string; accountKey: string}, key: string): Promise<{key: string; sha256: string; result: unknown} | null>;
  noteProviderCooldown(input: CompanySyncContext, observation: {requestId: string; nextAttemptAt: number; code: string}): Promise<void>;
  claim<C extends CompanySyncContext>(input: C): Promise<CompanySyncLease<C>>;
}
export function companySyncError(code: string, extra?: Record<string, unknown>): Error & {code: string};
export function validateCompanySyncContext<C extends CompanySyncContext>(value: C, at?: number): C;
export function createCompanyBankSyncStore(database: Pick<D1Database, 'prepare' | 'batch'>, options?: {now?: () => number; leaseMs?: number; maxRunMs?: number}): CompanySyncStore;
