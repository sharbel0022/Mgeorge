// A company rule describes the intended reference. It cannot certify bank evidence.
export const INVOICE_REFERENCE_POLICY_VERSION = 'invoice-reference-policy-v1';
export const MGEORGE_INVOICE_REFERENCE_POLICY = Object.freeze({
  version: INVOICE_REFERENCE_POLICY_VERSION,
  id: 'mgeorge-own-invoice-number-v1',
  companyName: 'M.George Vitvaror AB',
  referenceSource: 'invoice_number',
  direction: 'customer',
  matchMode: 'exact',
});

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const trimSpaces = value => value.replace(/^ +| +$/g, '');
const textValue = value => typeof value === 'string' ? trimSpaces(value) || null : null;
const absent = value => value === undefined || value === null || typeof value === 'string' && /^ *$/.test(value);
const identifier = value => {
  const text = textValue(value);
  return text !== null && /^[A-Za-z0-9][A-Za-z0-9/_-]{0,99}$/.test(text) ? text : null;
};
const companyKey = value => {
  if (typeof value !== 'string' || value.length > 240 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]|[^\S ]/u.test(value)) return null;
  return trimSpaces(value).replace(/ +/g, ' ').toLowerCase() || null;
};

/** Canonical comparison identity; raw observations must be retained separately. */
export function canonicalInvoiceReference(value) {
  return identifier(value);
}

/** Compare whole, bounded identifiers. Never coerce numbers or remove separators. */
export function strictInvoiceReferenceMatch(a, b) {
  const left = identifier(a), right = identifier(b);
  return left !== null && right !== null && left === right;
}

/** Validate the complete configuration before selecting a rule; ambiguity is an error. */
export function validateInvoiceReferencePolicies(policies) {
  if (!Array.isArray(policies)) throw new TypeError('Fakturareferenspolicy måste vara en lista.');
  const ids = new Set(), scopes = new Set();
  return Array.from(policies, policy => {
    if (!isRecord(policy)
      || policy.version !== INVOICE_REFERENCE_POLICY_VERSION
      || typeof policy.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(policy.id)
      || !companyKey(policy.companyName)
      || !['invoice_number', 'explicit_reference'].includes(policy.referenceSource)
      || policy.direction !== 'customer' || policy.matchMode !== 'exact') {
      throw new TypeError('Ogiltig fakturareferenspolicy.');
    }
    const scope = companyKey(policy.companyName);
    if (ids.has(policy.id) || scopes.has(scope)) throw new TypeError('Fakturareferenspolicy har dubbla identifierare eller företagsregler.');
    ids.add(policy.id);
    scopes.add(scope);
    return {
      version: policy.version,
      id: policy.id,
      companyName: policy.companyName,
      referenceSource: policy.referenceSource,
      direction: policy.direction,
      matchMode: policy.matchMode,
    };
  });
}

const issueReasons = Object.freeze({
  invalid_policy_configuration: 'Fakturareferenspolicyn är ogiltig eller tvetydig och måste granskas.',
  invalid_company_configuration: 'Företagsidentiteten saknas eller är ogiltig; ingen referensregel kan användas säkert.',
  invoice_number_missing: 'Fakturanummer saknas.',
  invoice_number_invalid: 'Fakturanumret måste vara en fullständig textidentifierare med högst 100 tecken.',
  declared_reference_invalid: 'Den registrerade betalningsreferensen har ogiltigt format.',
  declared_reference_conflict: 'Den registrerade betalningsreferensen motsäger företagets regel om fakturanummer.',
  explicit_reference_missing: 'Företagets regel kräver en uttryckligen angiven betalningsreferens.',
  original_invalid: 'De angivna originaluppgifterna har ogiltigt format.',
  original_invoice_number_invalid: 'Originalets fakturanummer har ogiltigt format.',
  original_invoice_number_conflict: 'Originalets fakturanummer skiljer sig från det registrerade fakturanumret.',
  original_reference_invalid: 'Originalets betalningsreferens har ogiltigt format.',
  original_reference_conflict: 'Originalets betalningsreferens skiljer sig från den avsedda betalningsreferensen.',
  original_issuer_invalid: 'Originalets utställaridentitet har ogiltigt format.',
  original_issuer_conflict: 'Originalets utställare är ett annat företag än det som referensregeln gäller för.',
});

/** Select the existing company configuration without inventing an invoice. */
export function resolveInvoiceReferenceConfiguration(context = {}) {
  const settings = isRecord(context) ? context : {};
  let policies;
  try {
    policies = validateInvoiceReferencePolicies(settings.policies === undefined
      ? [MGEORGE_INVOICE_REFERENCE_POLICY] : settings.policies);
  } catch {
    return {policy: null, issue: 'invalid_policy_configuration'};
  }
  if (policies.length === 0) return {policy: null, issue: ''};
  const identity = isRecord(settings.company) ? companyKey(settings.company.name) : null;
  if (!identity) return {policy: null, issue: 'invalid_company_configuration'};
  return {policy: policies.find(candidate => companyKey(candidate.companyName) === identity) || null, issue: ''};
}

/**
 * Resolve an intended invoice reference without changing inputs or interpreting
 * bank OCR. A BLOCKED decision must never be replaced by legacy matching.
 */
export function resolveInvoiceReference(invoice, context = {}) {
  const input = isRecord(invoice) ? invoice : {};
  const declaredPaymentReference = textValue(input.reference);
  const result = {
    version: INVOICE_REFERENCE_POLICY_VERSION,
    policyId: null,
    applies: false,
    status: 'REVIEW',
    invoiceNumber: textValue(input.invoice_number),
    intendedPaymentReference: declaredPaymentReference,
    declaredPaymentReference,
    source: declaredPaymentReference === null ? 'none' : 'explicit_invoice_reference',
    issues: [],
    reason: 'Ingen företagsregel används. Endast en uttryckligen angiven betalningsreferens behålls.',
  };

  // The own-invoice policy never changes supplier or unknown-direction records.
  if (input.direction !== 'customer') return result;

  const blockConfiguration = issue => ({
    ...result,
    applies: true,
    status: 'BLOCKED',
    intendedPaymentReference: null,
    source: 'none',
    issues: [issue],
    reason: issueReasons[issue],
  });
  const {policy, issue} = resolveInvoiceReferenceConfiguration(context);
  if (issue) return blockConfiguration(issue);
  if (!policy) return result;
  const identity = companyKey(context.company.name);

  const issues = [];
  const number = identifier(input.invoice_number);
  const reference = identifier(input.reference);
  if (!number) issues.push(absent(input.invoice_number) ? 'invoice_number_missing' : 'invoice_number_invalid');
  if (!absent(input.reference) && !reference) issues.push('declared_reference_invalid');
  if (policy.referenceSource === 'explicit_reference' && absent(input.reference)) issues.push('explicit_reference_missing');
  const intended = policy.referenceSource === 'invoice_number' ? number : reference;
  if (policy.referenceSource === 'invoice_number' && number && reference && number !== reference) {
    issues.push('declared_reference_conflict');
  }

  if (input.original !== undefined && input.original !== null) {
    if (!isRecord(input.original)) {
      issues.push('original_invalid');
    } else {
      const original = input.original;
      if (!absent(original.invoice_number)) {
        const originalNumber = identifier(original.invoice_number);
        if (!originalNumber) issues.push('original_invoice_number_invalid');
        else if (number && originalNumber !== number) issues.push('original_invoice_number_conflict');
      }
      if (!absent(original.reference)) {
        const originalReference = identifier(original.reference);
        if (!originalReference) issues.push('original_reference_invalid');
        else if (intended && originalReference !== intended) issues.push('original_reference_conflict');
      }
      if (!absent(original.issuer_name)) {
        const issuer = companyKey(original.issuer_name);
        if (!issuer) issues.push('original_issuer_invalid');
        else if (issuer !== identity) issues.push('original_issuer_conflict');
      }
    }
  }

  return {
    ...result,
    policyId: policy.id,
    applies: true,
    status: issues.length ? 'BLOCKED' : 'REVIEW',
    intendedPaymentReference: intended,
    source: policy.referenceSource === 'invoice_number' ? 'invoice_number_policy' : 'explicit_invoice_reference',
    issues,
    reason: issues.length ? issues.map(issue => issueReasons[issue]).join(' ')
      : policy.referenceSource === 'invoice_number'
        ? 'Fakturanumret är avsedd betalningsreferens enligt företagets regel. Bankbetalningen måste styrkas separat.'
        : 'Den uttryckligen angivna referensen är avsedd betalningsreferens enligt företagets regel. Bankbetalningen måste styrkas separat.',
  };
}

export function matchesInvoiceReference(decision, value) {
  return Boolean(decision?.applies && decision.status !== 'BLOCKED'
    && strictInvoiceReferenceMatch(decision.intendedPaymentReference, value));
}
