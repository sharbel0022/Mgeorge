export interface OpenPaymentsBankgiroContext {
 owner:string; companyId:string; sourceId:string; accountId:string; iban:string;
 scopeId?:string; bankgiro?:string; reportId?:string;
}
export interface OpenPaymentsEnrichmentEvidence {
 version:'openpayments-bankgiro-v1'; provider:'openpayments';
 owner:string; companyId:string; sourceId:string; scopeId:string; accountId:string;
 transactionId:string; parentTransactionId:string; aggregateId:unknown;
 transactionListId:string; aggregateTransactionListId:string;
 sourcePaths:string[]; accountSource:string; fieldEvidence:Record<string,unknown>;
 parentEntryReference:string; parentSource:string; groupComplete:boolean;
}
export interface OpenPaymentsBankgiroRow {
 kind:'payment'; specification:true; verified:false;
 key:string; externalId:string; parentKey:string;
 date:string; settlementDate:string; amount:number; currency:string; party:string;
 payerReference:string; bankReference:string; parentBankReference:string;
 recipientBankgiro:string; account:string; source:string; format:string;
 organizationNumber:string; payerAccount:string; remittanceMessage:string; description:string;
 payerEvidence:ReturnType<typeof import('./payer-evidence.js').normalizePayerEvidence>;
 referenceEvidence:ReturnType<typeof import('./payment-references.js').extractPaymentReferences>;
 reportEvidence:Record<string,string>;
 bankgiroEnrichmentIssue:string; enrichmentEvidence:OpenPaymentsEnrichmentEvidence;
 rawBankData:Record<string,unknown>; rawAccount:Record<string,unknown>|null;
}
export interface OpenPaymentsBankgiroGroup {
 key:string; parentTransactionId:string; parentEntryReference:string;
 amount:number|null; paymentCount:number; complete:boolean; issues:string[]; rowKeys:string[];
}
export interface OpenPaymentsBankgiroNormalization {
 version:'openpayments-bankgiro-v1'; provider:'openpayments'; context:OpenPaymentsBankgiroContext;
 rows:OpenPaymentsBankgiroRow[]; groups:OpenPaymentsBankgiroGroup[];
 coverage:{status:'available'|'partial'|'unavailable';reasons:string[]}; issues:string[];
}
/** Pure normalization of parsed originals; conveys no provider authority or invoice allocation. */
export function normalizeOpenPaymentsBankgiro(pages:readonly unknown[],context:OpenPaymentsBankgiroContext):OpenPaymentsBankgiroNormalization;
