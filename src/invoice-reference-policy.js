// Both applications execute the same pure policy and identifier comparison.
export {
  INVOICE_REFERENCE_POLICY_VERSION,
  MGEORGE_INVOICE_REFERENCE_POLICY,
  resolveInvoiceReference,
  resolveInvoiceReferenceConfiguration,
  canonicalInvoiceReference,
  strictInvoiceReferenceMatch,
  matchesInvoiceReference,
  validateInvoiceReferencePolicies,
} from '../sites/lib/invoice-reference-policy.js';
