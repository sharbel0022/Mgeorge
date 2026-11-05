import type { BankDataProvider, BankDataConnection, ProviderBinding, ProviderContext, ProviderConnectionDependencies, ProviderEnvironment } from './bank-data-provider.js';

export type OpenPaymentsFeature = 'bank_discovery' | 'consents' | 'accounts' | 'transactions' | 'bankgiro_enrichment';
export type OpenPaymentsScope = 'aspspinformation' | 'accountinformation' | 'bankgiroinformation' | 'corporate';
export interface OpenPaymentsConfig {
  environment: ProviderEnvironment;
  clientId: string;
  clientSecret: string;
  credentialGeneration: string;
  credentialsValidUntil?: string;
  apiVersion?: 'v1';
  scopes?: OpenPaymentsScope[];
  features?: OpenPaymentsFeature[];
  redirectUris?: string[];
}
export interface OpenPaymentsTransport {
  readonly kind: 'sandbox' | 'mtls';
  validateCertificate?(): void | Promise<void>;
  request(url: string, init: RequestInit): Promise<Response>;
}
export interface OpenPaymentsOptions {
  transport?: OpenPaymentsTransport;
  now?: () => number;
  timeoutMs?: number;
  maxResponseBytes?: number;
}
/** Exact UTF-8 HTTP body; its byte digest differs from canonical bankDataSha256. */
export interface OpenPaymentsRawResponse {
  body: string;
  sha256: string;
  requestPath: string;
  requestId: string;
  receivedAt: string;
}
export interface OpenPaymentsOriginal {
  provider: 'open_payments';
  binding: Readonly<ProviderBinding>;
  bankDataVersion: 'openpayments-response-v1';
  bankData: Record<string, unknown>;
  bankDataSha256: string;
  representation: 'provider_json';
  rawResponse: Readonly<OpenPaymentsRawResponse>;
  operation: string;
  requestId: string;
  receivedAt: string;
}
export type OpenPaymentsConsentStatus = 'received' | 'rejected' | 'valid' | 'revokedByPsu' | 'expired' | 'terminatedByTpp' | 'partiallyAuthorised';
export type OpenPaymentsScaStatus = 'received' | 'psuIdentified' | 'psuAuthenticated' | 'scaMethodSelected' | 'started' | 'unconfirmed' | 'finalised' | 'failed' | 'exempted';
export interface OpenPaymentsAccountIdentity {
  currency: string;
  iban?: string;
  bban?: string;
  accountNumber?: string;
  clearingNumber?: string;
  bankgiroNumber?: string;
  plusgiroNumber?: string;
}
export interface OpenPaymentsAccount {
  handle: string;
  identity: OpenPaymentsAccountIdentity;
  name: string;
  bankgiroMappingVerified: false;
}
export interface OpenPaymentsCapabilities {
  provider: 'open_payments';
  binding: ProviderBinding;
  bank: { id: string; name: string };
  corporateAccountAccess: 'requires_company_consent';
  accountInformation: { transactionHistoryMaxDays?: number; extendedTransactionHistoryMaxDays?: number; extendedTransactionHistoryAvailableWindowMinutes?: number };
  authorizationMethods: ('redirect' | 'decoupled')[];
  bankgiro: { status: 'unknown' | 'not_configured'; reason: string };
  payments: 'disabled';
  checkedAt: string;
  original: OpenPaymentsOriginal;
}
export interface OpenPaymentsConnection extends BankDataConnection {
  readonly provider: 'open_payments';
  listBanks(countries?: string[]): Promise<{ banks: { id: string; name: string }[]; original: OpenPaymentsOriginal }>;
  discoverCapabilities(): Promise<OpenPaymentsCapabilities>;
  createConsent(input: { validUntil: string; frequencyPerDay?: number; redirectPreferred?: boolean }): Promise<{ handle: string; status: OpenPaymentsConsentStatus; original: OpenPaymentsOriginal }>;
  getConsentStatus(handle: string): Promise<{ status: OpenPaymentsConsentStatus; original: OpenPaymentsOriginal }>;
  revokeConsent(handle: string): Promise<void>;
  createAuthorisation(consentHandle: string): Promise<{ handle: string; methods: { authenticationMethodId: string; authenticationType: string; name: string }[]; scaStatus: OpenPaymentsScaStatus; original: OpenPaymentsOriginal }>;
  startAuthorisation(handle: string, input: { authenticationMethodId: string; redirectUri?: string }): Promise<
    { approach: 'redirect'; scaStatus: OpenPaymentsScaStatus; redirectUrl: string; flowHandle: string; consentValid: false } |
    { approach: 'decoupled'; scaStatus: OpenPaymentsScaStatus; challengeData: Record<string, unknown>; consentValid: false }
  >;
  getAuthorisationStatus(handle: string): Promise<{ scaStatus: OpenPaymentsScaStatus; challengeData: Record<string, unknown>; consentValid: false }>;
  completeRedirect(handle: string, callback: { code: string; scope: string; state: string }): Promise<{ status: OpenPaymentsConsentStatus; original: OpenPaymentsOriginal }>;
  listAccounts(consentHandle: string): Promise<{ accounts: OpenPaymentsAccount[]; validUntil: string; original: OpenPaymentsOriginal }>;
  getAccount(accountHandle: string): Promise<{ identity: OpenPaymentsAccountIdentity; bankgiroMappingVerified: false; original: OpenPaymentsOriginal }>;
  getTransactions(accountHandle: string, input: { dateFrom: string; dateTo: string; requireBankgiro?: boolean }): Promise<{
    booked: Record<string, unknown>[];
    bankgiro: Record<string, unknown>[];
    originals: OpenPaymentsOriginal[];
    bankgiroEvidence: { status: 'not_requested' | 'returned_by_provider' | 'not_returned'; completeness: 'unknown' };
    paymentReconciliationAllowed: false;
  }>;
}
export class OpenPaymentsProvider implements BankDataProvider {
  readonly id: 'open_payments';
  constructor(configuration: OpenPaymentsConfig, options?: OpenPaymentsOptions);
  forCompany(context: ProviderContext, dependencies: ProviderConnectionDependencies): OpenPaymentsConnection;
}
