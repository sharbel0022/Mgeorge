import {matchingReferenceValues} from './payment-references.js';

export const BANK_EVIDENCE_CONFLICT_REASON = 'Bankunderlag med samma bankreferens innehåller motstridiga uppgifter. Granska båda originalen innan betalningen används.';
export const AUTOMATIC_MATCH_HOLD_REASON = 'En tidigare betalningskoppling har återtagits. Granska underlaget och bekräfta en ny koppling manuellt.';
const ANCESTOR_BANK_EVIDENCE_CONFLICT_REASON = 'En samlingspost som betalningen bygger på innehåller motstridiga bankuppgifter. Granska samlingspostens original innan betalningen används.';

export const hasBankEvidenceConflict = transaction => !!(transaction.bank_evidence_conflicts?.length || transaction.ancestor_bank_evidence_conflicts?.length);
export const bankEvidenceReviewReason = transaction => transaction.bank_evidence_conflicts?.length ? BANK_EVIDENCE_CONFLICT_REASON
  : transaction.ancestor_bank_evidence_conflicts?.length ? ANCESTOR_BANK_EVIDENCE_CONFLICT_REASON : '';

/** Explicit bank descriptions of a refund or reversal never prove invoice payment. */
export function bankFinancialReview(transaction,{ancestors=true}={}) {
  const raw = transaction.raw_bank_data || {};
  const inherited=ancestors?transaction.ancestor_bank_financial_reviews||[]:[];
  const text = [transaction.description, raw.bank_transaction_code?.description, raw.note,
    ...(Array.isArray(raw.remittance_information) ? raw.remittance_information : [])]
    .filter(value => typeof value === 'string').join(' ');
  if(inherited.some(review=>review.kind==='reversal'))return inherited.find(review=>review.kind==='reversal');
  if (/\breversal\b|\breversed\b|\bchargeback\b|återför|returbetal|\breturned\s+(?:payment|transfer)\b/iu.test(text))
    return {kind:'reversal', reason:'Bankunderlaget anger en återföring. Granska ursprungsbetalningen och rättelsen; händelsen får inte automatiskt reglera en faktura.'};
  if(inherited.some(review=>review.kind==='refund'))return inherited.find(review=>review.kind==='refund');
  if (/\brefund(?:ed|s)?\b|återbetal/iu.test(text))
    return {kind:'refund', reason:'Bankunderlaget anger en återbetalning. Granska kreditfaktura och ursprungsbetalning innan beloppet fördelas.'};
  if (/kortköp|kortuttag|\bcard\s+(?:purchase|withdrawal)\b|löneutbetal|\b(?:salary|payroll)\b|överföring\s+(?:(?:till|från|mellan)\s+)?(?:eget|egna)\s+kont|egen\s+överföring|\b(?:own|internal)\s+transfer\b/iu.test(text))
    return {kind:'other', reason:'Bankunderlaget anger kortköp, lön eller överföring mellan egna konton. Granska händelsetypen innan en faktura kopplas manuellt.'};
  return inherited.find(review=>review.kind==='other')||null;
}

const identity = value => String(value || '').normalize('NFKC').toLocaleLowerCase('sv-SE').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const reference = value => {
  const normalized = String(value || '').normalize('NFKC').trim().toUpperCase().replace(/[ \t]+/g, ' ');
  return /^\d[\d -]*$/.test(normalized) ? normalized.replace(/[ -]/g, '') : normalized;
};

export function sameBankPaymentIdentity(a,b) {
  const payer=identity(a.payer),paymentReference=reference(a.reference);
  return !!payer&&!!paymentReference&&payer===identity(b.payer)&&paymentReference===reference(b.reference);
}

/** Empty fields can be enriched; contradictory nonempty bank facts need a durable hold. */
export function bankEvidenceConflictFields(previous, incoming) {
  const fields = [];
  const compare = (field, normalize=reference) => {
    const before = normalize(previous[field]), after = normalize(incoming[field]);
    if (before && after && before !== after) fields.push(field);
  };
  compare('payer', identity);
  for (const field of ['reference', 'payer_organization_number', 'bankgiro', 'payer_bankgiro', 'parent_bank_reference']) compare(field);
  const before = matchingReferenceValues(previous.reference_evidence, previous.reference).map(reference);
  const after = matchingReferenceValues(incoming.reference_evidence, incoming.reference).map(reference);
  if (before.length && after.some(value => !before.includes(value))) fields.push('reference_evidence');
  const previousInvalid = new Set((previous.reference_evidence?.candidates || []).filter(candidate => candidate.validity==='checksum_invalid').map(candidate => reference(candidate.value)));
  const newlyInvalid = incoming.reference_evidence?.candidates?.some(candidate => candidate.validity==='checksum_invalid'&&!previousInvalid.has(reference(candidate.value)));
  if (newlyInvalid || incoming.reference_evidence?.incomplete&&!previous.reference_evidence?.incomplete) fields.push('reference_quality');
  if (!!previous.is_aggregate !== !!incoming.is_aggregate) fields.push('is_aggregate');
  if (bankFinancialReview(incoming)?.kind && bankFinancialReview(previous)?.kind !== bankFinancialReview(incoming).kind) fields.push('transaction_type');
  return fields;
}
