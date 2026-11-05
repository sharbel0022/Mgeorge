# Independent review of payment presentation d59ead9

## Scope and verdict

- Reviewed commit: `d59ead933a2704e43cf8e6a45d1e65beeae3cc5d`.
- Compared with: `9ce08a5`.
- Verdict: **HOLD** pending one Important finding with three reproducible combinations.
- Review is read-only for product code. All added examples are synthetic local fixtures.

## Strengths

The UI fixture now supplies the invoice-original identifier required by the existing saved-evidence contract. Its previous assertions are unchanged. A new negative test confirms that a historical allocation without that identifier contributes neither verified received money nor a verified recent-payment row.

The payment presentation keeps independent bank-original, account, missing-detail, duplicate, ignored, missing-payer and missing-reference checks ahead of payment-type review. The new detail-original gate also runs without depending on an allocation. The changes do not authorize writes or alter historical allocations.

## Findings

### Critical

None observed.

### Important: a type-review shortcut can hide independent retained-reference and allocation-direction failures

Location: `sites/lib/payment-presentation.ts`, lines 81–85 and 128–129. Related existing short circuit: `recordedPaymentSourceIssue` in `sites/lib/domain.ts`, lines 250–262.

`recordedPaymentSourceIssue` returns the payment-type review reason before it evaluates all saved reference evidence and the allocation direction. Equality with `bankPaymentReviewReason` therefore does not prove that payment type is the only problem. The selected-reference checks in presentation cannot replace the complete retained-source checks.

The independently frozen file `sites/tests/review-payment-presentation-d59.test.mjs` reproduces three failures on the reviewed commit:

1. A complete AIS original retains reference `00724`; a backed detail original supplies `00723`; the allocated invoice is `00723`. The genuine `invoiceReferenceMatchIssue` reports a mismatch, but presentation returns `REVIEW` with only the chargeback explanation.
2. A backed detail original contains an incomplete reference census (101 synthetic remittance entries), while the complete AIS reference remains `00723`. The genuine `invoiceReferenceMatchIssue` reports incomplete evidence, but presentation again returns only chargeback `REVIEW`.
3. A positive incoming transaction has a historical `refund` allocation against a receivable invoice. Payment-type review hides the independently inconsistent allocation direction.

All three should retain a hard source/reference/direction hold and its actionable explanation. No false `VERIFIED`, accounting mutation or changed stored balance was observed. The defect is a downgrade and loss of independent hold information, not a demonstrated financial write bypass.

Requested correction: fully evaluate independent source, reference and direction failures before treating a payment-type reason as a pure review instruction. A clean chargeback must remain `REVIEW`.

### Minor

None observed in this bounded diff.

## Executed checks

Using direct Node 24.22.1:

```sh
/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --test \
  sites/tests/payment-control-ui.test.mjs \
  sites/tests/payment-overview-ui.test.mjs
```

Result: **62/62 pass**.

```sh
/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --test \
  sites/tests/review-economy-evidence-independent.test.mjs \
  sites/tests/review-economy-projection-boundaries.test.mjs \
  sites/tests/economy-payment-source-boundaries.test.mjs \
  sites/tests/economy-payment-evidence-independent.test.mjs
```

Result: **47/47 pass**.

```sh
/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --test \
  sites/tests/review-payment-presentation-d59.test.mjs
```

Result on d59ead9: **12/15 pass, 3 fail**, exactly the combinations above. Every independent scenario checks that the state and recorded balance remain unchanged. The test file SHA-256 is `b2485b71bf3f64a31ec615621f1e95270e370d44d98ad6c0c1f7f0d1b68828e1`.

## Declined to judge

- Live bank-original byte availability, current provider consent and deployed data: no external or production calls were made.
- Authenticated browser appearance and interactive navigation: the existing UI tests render real components locally; no live browser acceptance was performed.
- Full repository CI: this review ran only the stated focused suites. Parent owns the integration gates.

The new regression is intentionally red on the reviewed source and should be integrated together with the correction. This report does not claim a completed correction or release approval.
