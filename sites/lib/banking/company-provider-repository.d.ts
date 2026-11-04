import type {CompanyContext,CompanyAction} from '../company-contract.js';
import type {ProviderResourceStorage,BankProviderError} from './bank-data-provider.js';
import type {CompanyProviderRepository,CompanyProviderLease} from './company-provider-manager.js';

export interface ProviderRepositoryDatabase {
  prepare(query:string): {bind(...args:unknown[]):any};
}
export interface ProviderRepositoryWrite {
  context:Readonly<CompanyContext>; statements:any[]; lease:CompanyProviderLease;
  grantFingerprint:string; connectionId:string;
  /** Node must compare this with the trusted request session accessor inside
   * its synchronous writer. It is distinct from the combined browserHash. */
  sessionHash?:string;
}
export interface CompanyProviderRepositoryOptions {
  /** Actual company-scoped db() facade; never the raw unscoped D1 binding. */
  database:ProviderRepositoryDatabase;
  codec:ProviderResourceStorage;
  currentContext():CompanyContext|Promise<CompanyContext>;
  assertCurrent(context:Readonly<CompanyContext>,action:CompanyAction):void|Promise<void>;
  flowDialect?:'sites'|'node'; now?:()=>number; randomId?:()=>string;
  /** Node-only actual authenticated application session hash. Absent permits
   * reads and connection-only commits, but never flow writes/consumption. */
  sessionHash?:()=>string|Promise<string>;
  /** Default Sites writer is lease.write(statements). A supplied Node writer
   * must synchronously use its existing lease.write(callback), recheck current
   * authority/session inside that transaction, and invoke the runtime-owned
   * retainedProviderGrantInUse fingerprint boolean while its catalogue writer
   * is held, before executing the statement batch. Never await in SQLite txn. */
  write?:(input:ProviderRepositoryWrite)=>Promise<any[]>|any[];
}
/** provider_payload contains a separate authenticated encrypted full-DTO
 * envelope, preserving manager's inner encryptedPayload byte-for-byte. Node
 * session_hash retains the actual application session; the combined browserHash
 * remains inside the envelope. Only consumeFlow may transition pending -> used.
 * Its random encrypted consumption receipt resolves lost replies without
 * allowing a second caller to claim another caller's successful consumption.
 * Fixed BankProviderError codes: RESOURCE_SCOPE_MISMATCH,
 * PROVIDER_REVISION_CONFLICT, PROVIDER_REQUEST_CONFLICT, PROVIDER_GRANT_REUSED,
 * PROVIDER_STORAGE_UNAVAILABLE, PROVIDER_COMMIT_UNCONFIRMED,
 * PROVIDER_FLOW_SESSION_REQUIRED, PROVIDER_RESPONSE_INVALID. */
export function createCompanyProviderRepository(options:CompanyProviderRepositoryOptions):CompanyProviderRepository;
export function providerRepositoryError(code:string,status?:number):BankProviderError;
