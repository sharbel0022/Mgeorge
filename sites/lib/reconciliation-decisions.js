// Shared post-processing only. The runtime engines establish original, consent,
// invoice, payer and reference eligibility before calling this function.
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

/** @param {any[]} findings @param {string} ruleVersion */
export function finalizeReconciliationFindings(findings, ruleVersion) {
  const safeInvoices = new Map();
  for (const finding of findings) {
    if (!finding.safe || !finding.invoice_id || !(finding.amount_cents > 0)) continue;
    const invoices = safeInvoices.get(finding.transaction_id) || new Set();
    invoices.add(finding.invoice_id);
    safeInvoices.set(finding.transaction_id, invoices);
  }

  // Only a uniquely eligible full match can rule out its weak cross-candidates.
  // An unverified/held/partial/excess alternative cannot prove that funds belong
  // elsewhere. Keep it in the competition census, even if its score is high.
  const boundInvoice = new Map();
  for (const [transactionId, invoices] of safeInvoices) {
    if (invoices.size === 1) boundInvoice.set(transactionId, [...invoices][0]);
  }
  const candidates = new Map();
  for (const finding of findings) {
    if (!finding.invoice_id) continue;
    const bound = boundInvoice.get(finding.transaction_id);
    if (bound && bound !== finding.invoice_id) continue;
    const transactions = candidates.get(finding.invoice_id) || new Set();
    transactions.add(finding.transaction_id);
    candidates.set(finding.invoice_id, transactions);
  }

  return findings.map(finding => {
    const result = {...finding, rule_version: ruleVersion};
    const competing = [...(candidates.get(finding.invoice_id) || [])]
      .filter(id => id !== finding.transaction_id).sort(compareText);
    const ambiguous = (safeInvoices.get(finding.transaction_id)?.size || 0) > 1;
    if (competing.length) result.competing_transaction_ids = competing;
    if ((result.safe || result.kind === 'correct') && (competing.length || ambiguous)) {
      const wasSafe = result.safe;
      result.safe = false;
      result.kind = 'possible_duplicate';
      if (wasSafe) result.reason = ambiguous
          ? 'Flera fakturor kan passa samma betalning; granska fördelningen.'
          : 'Flera betalningar kan avse fakturan; kontrollera möjlig dubbelbetalning.';
    }
    // Keep the source/reference/financial reason on an already unsafe finding.
    // Otherwise-correct unverified observations still need a duplicate warning.
    return result;
  }).sort((a, b) => Number(b.safe) - Number(a.safe)
    || b.score - a.score
    || compareText(a.transaction_id, b.transaction_id)
    || compareText(a.invoice_id, b.invoice_id)
    || compareText(a.kind, b.kind));
}
