export declare const INVOICE_REFERENCE_POLICY_VERSION: 'invoice-reference-policy-v1';

export interface InvoiceReferencePolicy {
  version: typeof INVOICE_REFERENCE_POLICY_VERSION;
  id: string;
  companyName: string;
  referenceSource: 'invoice_number' | 'explicit_reference';
  direction: 'customer';
  matchMode: 'exact';
}

export interface InvoiceReferenceInput {
  invoice_number: string;
  reference?: string | null;
  direction: string;
  original?: {
    invoice_number?: string | null;
    reference?: string | null;
    issuer_name?: string | null;
  } | null;
}

export interface InvoiceReferenceContext {
  company?: {name: string; organizationNumber?: string};
  policies?: InvoiceReferencePolicy[];
}

export interface InvoiceReferenceDecision {
  version: typeof INVOICE_REFERENCE_POLICY_VERSION;
  policyId: string | null;
  applies: boolean;
  status: 'REVIEW' | 'BLOCKED';
  invoiceNumber: string | null;
  intendedPaymentReference: string | null;
  declaredPaymentReference: string | null;
  source: 'invoice_number_policy' | 'explicit_invoice_reference' | 'none';
  issues: string[];
  reason: string;
}

export declare const MGEORGE_INVOICE_REFERENCE_POLICY: Readonly<InvoiceReferencePolicy>;

/** Inputs are validated at runtime; numbers are never coerced into identifiers. */
export declare function resolveInvoiceReference(invoice: unknown, context?: unknown): InvoiceReferenceDecision;
export declare function resolveInvoiceReferenceConfiguration(context?: unknown): {policy: InvoiceReferencePolicy | null; issue: string};
export declare function canonicalInvoiceReference(value: unknown): string | null;
export declare function strictInvoiceReferenceMatch(a: unknown, b: unknown): boolean;
export declare function matchesInvoiceReference(decision: InvoiceReferenceDecision | null | undefined, value: unknown): boolean;
export declare function validateInvoiceReferencePolicies(policies: unknown): InvoiceReferencePolicy[];
