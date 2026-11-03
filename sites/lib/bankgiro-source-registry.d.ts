import type { BankgiroHttpsRegistration, BankgiroHttpsSource } from './bankgiro-http-source.js';
export interface BankgiroSourceConfiguration {
  version: 1;
  revision: number;
  registrations: BankgiroHttpsRegistration[];
}
export interface BlockedBankgiroSource {
  readonly id: string;
  readonly mode: 'production';
  readonly configurationValid: false;
  readonly registration: null;
  readonly intervalMinutes: number;
  readonly revocation?: Readonly<{owner: string; configurationRevision: number}>;
  authorize(...input: unknown[]): Promise<never>;
  listReports(...input: unknown[]): Promise<never>;
  fetchReport(...input: unknown[]): Promise<never>;
}
export type ResolvedBankgiroSource = BankgiroHttpsSource | BlockedBankgiroSource;
export interface BankgiroSourceRegistryOptions {
  /** Trusted server-owned configuration, never HTTP request JSON. */
  configuration?: BankgiroSourceConfiguration | string | unknown;
  secrets?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  runtime?: unknown;
}
export function createBankgiroSourceRegistry(options?: BankgiroSourceRegistryOptions): {
  resolve(owner: string): ResolvedBankgiroSource | null;
};
export function resolveBankgiroSource(owner: string, options?: BankgiroSourceRegistryOptions): Promise<ResolvedBankgiroSource | null>;
