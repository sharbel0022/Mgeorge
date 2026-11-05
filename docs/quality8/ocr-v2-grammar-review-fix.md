# Correction after independent review of the V2 grammar changes

## Scope

Base source: `abe5c1e099143ca59015562c5047b252ba9952bb`.
Independent review and frozen tests: `8271da891e251fbd99a1ed8caf5bd005152c9c1c`.

The independent review found real false-green native-PDF cases and a separate false-hold regression in the earlier parser changes. This follow-up changes only the two scalar parsers and their two identical detail modules. The proposed geometry work was paused before any product geometry change.

No OCR call, holdout reinterpretation, image/gold change or V3 material access occurred. The first V2 result retains SHA-256 `13557c3012331fa0101fbe3e6fe498fd2fbf3346b8740cfe5fe4b83e8393b6e7`; its failed acceptance result is unchanged.

## Root causes and correction

1. The sibling-boundary grammar recognized some monetary labels more broadly than their own field census. It could trim an unreadable or competing inline `Summa moms` occurrence out of a net amount while never collecting that VAT occurrence. The scalar parsers now reuse the exact monetary-label grammar for both collection and sibling boundaries. The explicit compound `Summa moms` is collected at line start and inline; generic VAT/net words still require the existing colon when inline. Their unsupported suffixes stay visible instead of being discarded. The same collector patterns bound the party value.
2. The new expanded supplier heading could borrow an unknown colon-labelled following line as a company name. A next-line colon or column separator now prevents that borrowing. Explicit absence values such as `saknas`, `ej angiven` and `not provided` are held by a whole-value check, not a substring rejection of real company names.
3. `Supplier organization number` and `Seller org number` matched both the new bare-supplier prefix and the existing owner-qualified organization event. A recognized organization event at the start now prevents creation of a second empty name event.

No field is calculated from another field, no OCR character is repaired and no confidence or registration threshold changes. Structured article exclusion and the full source-text census remain in place.

## Same-input before and after evidence

`ocr-v2-grammar-review-fix.json` retains all ten original synthetic probe texts, their hashes, the actually recorded before-Node values on abe5 and fresh after-Node/after-Sites values. The after projections are identical across both parsers. The JSON also records the exact product-file hashes and the frozen test-file hashes.

| Original synthetic case | Before abe5 | After this correction |
| --- | --- | --- |
| Inline unreadable `Summa moms` after net | Green; unreadable occurrence disappeared | VAT null, yellow, explicit invalid-value issue |
| Inline conflicting `Summa moms` after net | Green; conflict disappeared | VAT null, red, explicit conflict issue |
| Bare supplier followed by complete inline VAT | Monetary text included in green company name | Exact company name and separately collected correct VAT |
| Supplier-name heading followed by an unknown contract label | Contract label became green company name | Party null, yellow |
| Explicitly missing supplier | Missing-value phrase became green company name | Party null, yellow |
| English owner-qualified organization labels | Extra empty name held the otherwise valid party | Correct name and organization retained |

The positive inline-VAT case can be green for native PDF only after both its name and VAT are correctly and separately collected. OCR retains the existing manual-review confidence ceiling.

## Regressions executed

The independent 64-case matrix was run byte-identically before and after the change. Its SHA-256 remains `135175e9990f0bbe6661e56a0f29efd3f9e05d0ce2034c22ccc168fc3cfd3f8e`. No input or assertion in that matrix was changed.

| Suite | Before on abe5 | After |
| --- | ---: | ---: |
| Independent Node/Sites × PDF/OCR matrix | 28 pass / 36 fail | 64/64 pass |
| New synthetic grammar-boundary matrix | 8 pass / 72 fail | 80/80 pass |
| Existing targeted parser regression | 290/290 pass in the prior run | 290/290 pass |
| Combined after run | — | **434/434 pass**, zero skips |

The new 80-case matrix includes both the reported regressions and general boundary failures, including unsupported inline VAT/net syntax, unknown following labels, explicit absence values, owner-qualified organization labels, and a competing amount beyond the displayed excerpt. Its results are not a claim that every failure was newly introduced by abe5.

Direct Node 24.22.1 executed the combined run with `NODE_ENV=test` and `--import ./scripts/saas-test-isolation.mjs`. Files were:

- `sites/tests/invoice-grammar-boundaries.test.mjs`
- The unchanged `sites/tests/review-v2-explicit-grammar-independent.test.mjs` from review commit 8271da8, loaded from the reviewer's isolated snapshot with `REVIEW_SOURCE_ROOT` pointing to this checkout
- `sites/tests/invoice-v2-explicit-grammar.test.mjs`
- `test/invoice-evidence-ocr.test.js` and `sites/tests/invoice-evidence-ocr.test.mjs`
- `test/invoice-scalar-layout-regression.test.js` and `sites/tests/invoice-scalar-layout-regression.test.mjs`
- `sites/tests/ocr-parser-independent-review.test.mjs`

Sites typecheck, exact byte parity of both detail modules and `git diff --check` also passed. All suites use text or synthetic word data; none invokes an optical worker.

## Remaining gate and limits

Independent follow-up review of the exact frozen correction is required before integration. Layout reconstruction and its diagnostic regressions remain a separate, paused improvement. Six unlabelled sender headers, ambiguous role columns, detached monetary values and damaged optical characters have not been solved by this grammar correction. There is no new holdout, recall, production or quality-score claim.
