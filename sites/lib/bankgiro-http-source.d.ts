/** Internal normalized delivery protocol; these are not bank API fields. */
export interface BankgiroEntitlement {
  status: 'VERIFIED';
  origin: 'provider_authorization';
  evidenceId: string;
  checkedAt: string;
  validUntil: string;
  capabilities: readonly string[];
}
export interface BankgiroHttpsRegistration {
  id: string;
  owner: string;
  companyId: string;
  bankgiro: string;
  scopeId: string;
  generation: string;
  mode: 'production';
  enabled: true;
  transport: 'https-v1';
  baseUrl: string;
  tokenSecret: string;
  profileId: string;
  allowedFormats: readonly ('csv' | 'xml' | 'xlsx')[];
  intervalMinutes: number;
  entitlement: BankgiroEntitlement;
  configurationRevision?: number;
}
export type BankgiroRegisteredAuthority = Readonly<Omit<BankgiroHttpsRegistration, 'baseUrl' | 'tokenSecret' | 'entitlement'> & {
  entitlement: Readonly<BankgiroEntitlement>;
  /** Internal nonsecret endpoint/credential-binding identity, never a credential. */
  transportBinding: string;
}>;
export interface BankgiroHttpsAuthorization extends BankgiroEntitlement {
  owner: string;
  sourceId: string;
  companyId: string;
  bankgiro: string;
  scopeId: string;
  generation: string;
  profileId: string;
}
export interface BankgiroHttpsReportDescriptor {
  reportId: string;
  filename: string;
  sha256: string;
  byteLength?: number;
  availableAt?: string;
}
export interface BankgiroHttpsReportPage {
  reports: BankgiroHttpsReportDescriptor[];
  nextCursor: string | null;
  nextPollAt?: string;
  missingReportIds?: string[];
}
export interface BankgiroHttpsSource {
  readonly id: string;
  readonly mode: 'production';
  readonly configurationValid: true;
  readonly registration: BankgiroRegisteredAuthority;
  readonly intervalMinutes: number;
  authorize(input: {owner: string; signal?: AbortSignal}): Promise<BankgiroHttpsAuthorization>;
  listReports(input: {owner: string; authorization: BankgiroHttpsAuthorization; cursor?: string | null; limit?: number; signal?: AbortSignal}): Promise<BankgiroHttpsReportPage>;
  fetchReport(input: {owner: string; authorization: BankgiroHttpsAuthorization; report: BankgiroHttpsReportDescriptor; signal?: AbortSignal}): Promise<Uint8Array>;
}
export function createHttpsBankgiroSource(input: {
  registration: BankgiroHttpsRegistration;
  token: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): BankgiroHttpsSource;
