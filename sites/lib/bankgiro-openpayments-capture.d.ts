import type {normalizeOpenPaymentsBankgiro} from './bankgiro-openpayments.js';
export const OPENPAYMENTS_CAPTURE_VERSION: 'openpayments-bankgiro-capture-v1';
export const OPENPAYMENTS_PROFILE: 'openpayments-bankgiro-v1';
export interface OpenPaymentsCaptureContext {
 owner:string; companyId:string; sourceId:string; scopeId:string;
 accountId:string; iban:string; bankgiro?:string;
}
export interface OpenPaymentsCapturePage {
 /** Exact UTF-8 JSON response, without reserialization. */
 body:string; sha256:string; requestPath:string; requestId:string; receivedAt:string;
}
export interface OpenPaymentsCapture {
 version:typeof OPENPAYMENTS_CAPTURE_VERSION; captureId:string;
 context:OpenPaymentsCaptureContext; pages:OpenPaymentsCapturePage[]; reportId:string;
 normalization:ReturnType<typeof normalizeOpenPaymentsBankgiro>;
}
export function createOpenPaymentsBankgiroCapture(input:{context:OpenPaymentsCaptureContext;captureId:string;pages:(Omit<OpenPaymentsCapturePage,'sha256'|'body'>&{body:string|Uint8Array|ArrayBuffer})[]}):OpenPaymentsCapture&{bytes:Uint8Array;sha256:string;filename:string};
export function readOpenPaymentsBankgiroCapture(bytes:Uint8Array|ArrayBuffer|string):OpenPaymentsCapture;
/** Returns a bounded evidence receipt only after validating the trusted current authority. */
export function assertOpenPaymentsBankgiroAuthority(capture:OpenPaymentsCapture,authorization:unknown,scope:{owner:string;companyId:string|undefined;sourceId:string;scopeId:string;now?:number}):Record<string,unknown>;
export function bankgiroEnrichmentFallback(input:{companyId?:string;coverage?:{status:string};sftp?:{companyId:string;status:string;origin:string;agreementId:string;validUntil:string};now?:number}):{source:'api'|'camt054c_sftp'|'manual_file';message:string};
