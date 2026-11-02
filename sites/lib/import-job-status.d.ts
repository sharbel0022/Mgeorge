export type ImportJobType = 'bank_sync' | 'gmail_sync' | 'document_ocr' | 'backup' | 'bankgiro_import';
export type ImportJobState = 'queued' | 'running' | 'retry_wait' | 'succeeded' | 'blocked' | 'paused' | 'failed';
export interface ImportJobStatus {
  contractVersion: '1.0';
  jobType: ImportJobType;
  state: ImportJobState;
  /** Operational readiness only. Never a classification of bank facts. */
  evidenceStatus: 'REVIEW' | 'BLOCKED';
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  nextAttemptAt: string | null;
  leaseExpiresAt: string | null;
  running: boolean;
  attemptCount: number | null;
  fenceVersion: number | null;
  errorCode: string | null;
}
export interface ImportJobStatusInput {
  jobType: ImportJobType;
  state: string;
  lastAttemptAt?: unknown;
  lastSuccessAt?: unknown;
  nextAttemptAt?: unknown;
  leaseExpiresAt?: unknown;
  attemptCount?: unknown;
  fenceVersion?: unknown;
  errorCode?: unknown;
}
export const IMPORT_JOB_STATUS_VERSION: '1.0';
export const IMPORT_JOB_TYPES: readonly ImportJobType[];
export const IMPORT_JOB_STATES: readonly ImportJobState[];
export function importJobErrorCode(value: unknown): string | null;
export function createImportJobStatus(input: ImportJobStatusInput, options?: {now?: number | (() => number)}): ImportJobStatus;
