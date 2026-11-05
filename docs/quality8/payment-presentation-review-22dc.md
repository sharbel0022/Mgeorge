# Independent follow-up review: payment evidence ordering

## Verdict

**READY for integration**, within the reviewed presentation and source-assessment scope.

Reviewed source: `22dc7496e7b30ee0df12260a3b7cf4fe86447534`, directly above `d59ead933a2704e43cf8e6a45d1e65beeae3cc5d`. No reviewer-authored product changes were made. The earlier HOLD and three reproductions remain documented in `payment-presentation-review-d59.md` and its initial test commit `1a4b1c23c43e77753f7242c2a9b71dd610ee2e8d`.

## Correction verified

The domain source assessor now evaluates original integrity, current account restrictions, separate detail backing, payer and reference presence, company context, allocation direction, all retained reference evidence, invoice policy, voiding and competing invoice ownership before it returns a payment-type review. The same validators and rejection conditions remain in use. The existing allocation evidence assessor, including its explicit-refund exception, runs at the end.

All three original counterexamples now produce `BLOCKED` with an actionable independent source reason:

- Conflicting retained AIS and detail references: the retained-reference mismatch is returned.
- Incomplete retained detail evidence with otherwise complete AIS reference: the incomplete-reference hold is returned.
- Historical refund effect with an incompatible incoming direction: the direction hold is returned.

A clean chargeback remains `REVIEW`. Independent original, account, detail, duplicate, ignored and invoice-policy holds remain effective. Complete explicit refunds retain their exact accounting projection in the existing positive regressions. Every new independent scenario preserves state and historical balances.

## Regression integrity

The final regression is `sites/tests/review-payment-presentation-d59.test.mjs`.

Its scenario input and required `BLOCKED` outcomes are unchanged from the first independent review. One diagnostic assertion intentionally proving the old early-return behavior was updated: instead of requiring equality to the payment-type reason, it now requires the hard retained-reference reason and inequality to the payment-type reason. This assertion change is not a relaxed acceptance condition.

- Original 15-case test SHA-256: `b2485b71bf3f64a31ec615621f1e95270e370d44d98ad6c0c1f7f0d1b68828e1`.
- Final 15-case test SHA-256: `02904af1acfec5d5838c97c519b2258c11326ab29d43a99fc566a427f6cb45d9`.
- Before on d59ead9: 12 pass, 3 fail.
- After on 22dc749: 15 pass, 0 fail.

## Executed verification

Direct Node 24.22.1, one combined focused run:

```sh
/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --test \
  sites/tests/review-payment-presentation-d59.test.mjs \
  sites/tests/payment-control-ui.test.mjs \
  sites/tests/payment-overview-ui.test.mjs \
  sites/tests/review-economy-evidence-independent.test.mjs \
  sites/tests/review-economy-projection-boundaries.test.mjs \
  sites/tests/economy-payment-source-boundaries.test.mjs \
  sites/tests/economy-payment-evidence-independent.test.mjs
```

Result: **124/124 pass**, zero failures and skips, approximately 2.0 seconds. This consists of the independent 15-case matrix, 62 payment-control/overview cases and 47 existing independent overview/economy cases. Product files in the review checkout match the exact reviewed source commit. `git diff --check` passes.

## Findings

- Strengths: the fix addresses the underlying ordering instead of bypassing the new presentation checks; the original-reference and direction checks retain their full predicates; no accounting write path changes.
- Critical: none observed.
- Important: the prior finding and all three reproductions are closed; no remaining finding in this bounded review.
- Minor: none observed.

## Declined to judge

No live bank/provider calls, production invoice or payment writes, fresh original-byte verification, authenticated browser acceptance or full repository CI were performed by this reviewer. The parent owns deployment and the final integration gates. This READY assessment is independent code/test review, not production operational evidence or a quality-score claim.
