import type { ImportJobStatus } from './import-job-status.js';

/** Internal integration types, not provider API fields. Server-owned only. */
export interface BankgiroSourceRegistration { id: string; adapterId: string }
export interface BankgiroSourceAuthorization {
  owner: string;
  sourceId: string;
  status: 'VERIFIED' | 'REVIEW' | 'BLOCKED';
  origin: 'provider_authorization';
  evidenceId: string;
  checkedAt: string;
  validUntil: string;
  capabilities: readonly string[];
}
export interface BankgiroReportAdapter {
  verifySource(scope: {owner: string; sourceId: string}): Promise<BankgiroSourceAuthorization>;
  /** Agent 3 binds the real acquisition implementation. Preparation never calls it. */
  readReports: (...args: any[]) => Promise<unknown>;
}
export interface BankgiroImportPreparation {
  contractVersion: '1.0';
  jobType: 'bankgiro_import';
  timezone: 'Europe/Stockholm';
  intervalMinutes: number;
  enabled: boolean;
  activationAllowed: boolean;
  externalScheduleCreated: false;
  jobStatus: ImportJobStatus;
}
export function prepareBankgiroImportSchedule(input: {
  owner: string;
  sourceStatus?: Record<string, any>;
  intervalMinutes?: number;
  source?: BankgiroSourceRegistration | null;
  adapters?: ReadonlyMap<string, BankgiroReportAdapter>;
  requestedEnabled?: boolean;
  now?: number | (() => number);
}): Promise<BankgiroImportPreparation>;
