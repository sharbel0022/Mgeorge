export const RECONCILIATION_CONTRACT_VERSION: 'mgeorge-reconciliation-v1';
export function invoiceReferencePolicyFromContext(context: unknown, companyId: string): InvoiceReferencePolicy | null;
export type ReconciliationStatus = 'VERIFIED' | 'REVIEW' | 'BLOCKED';
export type OriginalEvidence = {status:ReconciliationStatus; source:'bank_api'|'bank_file'|'bankgiro_file'|'unknown'; id:string; sha256:string; reason?:string};
export type InvoiceReferencePolicy = {version:string; companyId:string; invoiceNumberIsPaymentReference:true; preserveLeadingZeros:true; comparison:'exact'; source:string};
export type BankAccountEvidence = {status:ReconciliationStatus; ownerId:string; accountId:string; currency:string; source:'bank_account_resource'|'missing'; proofId:string; validUntil?:string; reason?:string};
export type PaymentReference = {value:string; rawValue:string; source:string; kind:string; validity?:string; schema?:string};
export type BankTransaction = {
 id:string; bankId:string; accountId:string; amountMinor:number; currency:string; bookedDate:string;
 kind:'payment'|'aggregate'; economic:boolean; ignored:boolean; duplicateOf:string;
 original:OriginalEvidence; accountEvidence:BankAccountEvidence; payerEvidence:Record<string,any>|null;
 references:PaymentReference[]; referenceIncomplete:boolean; parentId:string; reportId:string;
 reversal:boolean; holdReason:string; conflict:boolean;
};
export type IndividualPayment = BankTransaction & {kind:'payment'};
export type BankgiroReport = {id:string; bankDepositId:string; accountId:string; currency:string; bookedDate:string; totalMinor:number; paymentCount:number; paymentIds:string[]; original:OriginalEvidence};
export type ReportDepositRelationship = {id:string; reportId:string; transactionId:string; method:'bank_identity'|'manual_review'; status:ReconciliationStatus; active:boolean};
export type ReconciliationInvoice = {id:string; companyId:string; number:string; explicitReference:string; referenceClaims?:string[]; referenceClaimsComplete?:boolean; customerName:string; customerOrganizationNumber:string; direction:'receivable'|'payable'; currency:string; totalMinor:number; creditMinor:number; reviewed:boolean; voided:boolean; issuedDate:string; evidenceIssue:string};
export type ReconciliationAllocation = {id:string; invoiceId:string; transactionId:string; amountMinor:number; active:boolean; effect:'payment'|'refund'};
export type CustomerRelationship = {id:string; invoiceId:string; accountId:string; payerName:string; payerOrganizationNumber:string; approved:boolean; active:boolean; evidence:string};
export type ImportJobStatus = {id:string; status:'complete'|'pending'|'blocked'; complete:boolean};
export type ReconciliationInput = {
 contractVersion:string; ownerId:string; companyId:string; revision:number|string; checkedAt:string; complete:boolean;
 referencePolicy:InvoiceReferencePolicy|null; transactions:BankTransaction[]; invoices:ReconciliationInvoice[];
 allocations:ReconciliationAllocation[]; reports:BankgiroReport[]; relationships:ReportDepositRelationship[];
 customerRelationships:CustomerRelationship[]; importJobs:ImportJobStatus[]; evidenceContext?:unknown;
};
export type ReconciliationProposal = {invoiceId:string; amountMinor:number; currency:string; invoiceRemainingBeforeMinor:number; invoiceRemainingAfterMinor:number; settlement:'full'|'partial'|'excess'|'multiple'};
export type ReconciliationDecision = {
 transactionId:string; status:ReconciliationStatus; bankEvidenceStatus:ReconciliationStatus;
 reasonCodes:string[]; payer:Record<string,any>|null; references:PaymentReference[];
 candidateInvoiceIds:string[]; conflictingInvoiceIds:string[]; allocations:ReconciliationProposal[]; availableMinor:number;
 unallocatedMinor:number; reportedAmountMinor:number; economic:boolean; evidenceValidUntil:string|null;
};
export type ReconciliationPreview = {
 contractVersion:typeof RECONCILIATION_CONTRACT_VERSION; mode:'preview'; changed:false; writesAllowed:false; approvalRequired:true;
 ownerId:string; companyId:string; checkedAt:string; status:ReconciliationStatus; reasonCodes:string[];
 snapshot:{revision:number|string; sha256:string}; decisions:ReconciliationDecision[];
};
export type ReconciliationApproval = {
 contractVersion:string; source:'stored_business_approval'; ownerId:string; approvedBy:string; approved:true;
 requestId:string; expiresAt:string; snapshotSha256:string; revision:number|string;
 decisions:{transactionId:string; allocations:{invoiceId:string; amountMinor:number; currency:string}[]}[];
};
export function buildReconciliationPreview(input:ReconciliationInput):Promise<ReconciliationPreview>;
export function adaptInvoiceReferenceEvidence(facts:unknown):{referenceClaims:string[];issue:string;complete:boolean};
export function validateReconciliationApproval(preview:ReconciliationPreview, approval:ReconciliationApproval|null|undefined, context:{ownerId:string; now:string; consumedRequestIds?:string[]}):{valid:boolean; reasonCodes:string[]; writesAllowed:false};
