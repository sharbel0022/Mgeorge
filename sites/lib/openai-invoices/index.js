// Public server-side AI contract. Worker deployment remains self-contained in sites/.
export {invoiceAiConfigurationStatus} from './configuration.js';
export {invoiceAiPolicy,enrichInvoiceForReview,mergeInvoiceSuggestion} from './integration.js';
export {extractOpenAiInvoice,prepareOpenAiInvoice} from './adapter.js';
export {createNodeAuditStore,createD1AuditStore} from './audit-store.js';
export {getInvoiceAiProfile,invoiceAiCostMicroUsd,INVOICE_AI_PROFILES} from './profiles.js';
export {invoiceAiRecoveryFallback,INVOICE_AI_RECOVERY_CODES,readNodeInvoiceAiRecoveryStatus,readD1InvoiceAiRecoveryStatus} from './recovery.js';

// Loaded only by the Worker runtime; keeps Node's shared facade free of TS imports.
export async function enrichSitesInvoice(args){
 const runtime=await import('./sites.js');
 return runtime.enrichSitesInvoice(args);
}
