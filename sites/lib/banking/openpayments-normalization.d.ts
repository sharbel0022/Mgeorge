export interface OpenPaymentsNormalizationOptions {account:string;dateFrom:string;dateTo:string;}
export interface OpenPaymentsCanonicalRow {
 account:string;booked_at:string;amount_cents:number;currency:'SEK';payer:string;reference:string;bank_reference:string;provider_transaction_id:string;description:string;source:'open_payments';raw_bank_data:Record<string,unknown>;
 reference_evidence:Record<string,unknown>;payer_evidence:Record<string,unknown>;payer_organization_number:string;needs_review:1;is_aggregate:0|1;review_reason:string;
}
export interface OpenPaymentsWorkspaceRow {
 externalId:string;date:string;amount:number;currency:'SEK';party:string;payerReference:string;description:string;account:string;bankReference:string;source:'Open Payments';bankData:Record<string,unknown>;bankDataVersion:'openpayments-response-v1';bankDataSha256:string;payerEvidence:Record<string,unknown>;referenceEvidence:Record<string,unknown>;organizationNumber:string;kind:'batch'|'unknown';verified:false;
}
export function openPaymentsAccountIdentity(identity:unknown):string;
export function normalizeOpenPaymentsBookedTransaction(raw:unknown,options:OpenPaymentsNormalizationOptions):OpenPaymentsCanonicalRow;
export function normalizeOpenPaymentsBooked(rows:unknown,options:OpenPaymentsNormalizationOptions):OpenPaymentsCanonicalRow[];
export function normalizeOpenPaymentsWorkspaceRows(rows:unknown,options:OpenPaymentsNormalizationOptions):OpenPaymentsWorkspaceRow[];
