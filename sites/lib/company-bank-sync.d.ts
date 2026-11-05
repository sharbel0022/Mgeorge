import type { CompanySyncContext, CompanySyncStore, CompanySyncLease, CompanySyncGuard, CompanySyncCoverage, CompanySyncOutcome } from './company-bank-sync-store.js';
export interface CompanySyncSelector { companyId: string; connectionId: string; accountKey: string; expectedGeneration?: string; expectedRevision?: number }
export interface CompanySyncStage<C extends CompanySyncContext = CompanySyncContext> {
  context: C; lease: CompanySyncLease<C>; deadline: number; signal: AbortSignal;
  request<T>(operation: (options: {signal: AbortSignal; deadline: number}) => Promise<T>): Promise<T>;
  assertCurrent(): Promise<void>;
}
export interface CompanySyncResult { companyId: string | null; connectionId: string | null; status: CompanySyncOutcome; code: string | null; nextAttemptAt: number | null; imported: number; duplicate: number; coverage: CompanySyncCoverage }
export function createCompanyBankSyncRunner<C extends CompanySyncContext>(options: {
  store: CompanySyncStore;
  resolveContext(selector: CompanySyncSelector): C | Promise<C>;
  currentGuard(context: C): CompanySyncGuard | Promise<CompanySyncGuard>;
  sync(stage: CompanySyncStage<C>): Promise<{complete: boolean; receiptKey: string; imported: number; duplicate: number}>;
  enrich?(stage: CompanySyncStage<C>): Promise<{state: 'verified' | 'partial' | 'unavailable'}>;
  reconcile?(stage: CompanySyncStage<C>): Promise<{status: 'completed' | 'held' | 'stale'; applied?: number; review?: number}>;
  now?: () => number; requestTimeoutMs?: number; maxRunMs?: number;
}): {run(selector: CompanySyncSelector): Promise<CompanySyncResult>};
export function runCompanyBankSyncBatch(options: {jobs: CompanySyncSelector[]; run(selector: CompanySyncSelector): Promise<CompanySyncResult>; maxConcurrent?: number; maxJobs?: number}): Promise<{results: CompanySyncResult[]; remaining: number}>;
