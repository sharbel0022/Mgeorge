# Payment 0599 / Bankgiro verification plan

Date: 2026-11-02. Base: a9f88ae1c0f697376b3ecd140e1e80a64405125a.
Branch: fix/payment-0599-bankgiro-verification-20261102.

## Scope and authorization

Only Bankgiro originals, account evidence, payment references, invoice-review suggestions and directly related reconciliation gates. The user's later coordination instruction supersedes direct-main delivery: push only this branch, open a PR, do not merge, force-push, delete other work or deploy Sites. Production reads are permitted; no real invoice registration, source-link confirmation, allocation or payment is authorized.

Existing architecture is retained. Explicit typed bank account resources may support an alias; digit inference, date/amount coincidence and invoice customer names are not bank evidence. An original's integrity, its bank relationship, and business approval remain separate.

## Investigation and chosen changes

1. Reproduce exact-IBAN resource ambiguity in Node.
2. Reproduce Sites retaining a resolved account after its original recipient alias disappears, changes resource or becomes ambiguous. Validate both identifiers during reconciliation and at the financial commit boundary.
3. Use the same strict reference comparator for registered invoices and unregistered originals, preserving leading zeroes.
4. Distinguish an ELIN deposit identifier (recipient bankgiro, year, normalized sequence) from the existing report-content fingerprint. Use it only to prevent competing source reservations.
5. Reject non-text sender cells and preserve the actual separately labelled sequence value cell.
6. Explain the exact missing bank account/deposit/currency/date evidence in the existing verification projection.

No new financial engine, bank synchronization flow, Gmail automation, OCR pipeline, schema, dependencies or production data migration is needed.

## Verification

Add synthetic behavioral regressions first and run the existing branch CI to observe failures. Then implement narrowly and rerun both full suites with installation, syntax/type checks, dependency audit gates and Sites production build. Retain tests for one economic deposit, unchanged originals, missing/conflicting evidence, zero-preserving references, alias recovery, reimport, parallel requests and atomic rollback.

The execution environment is unavailable. Tests must be run by the existing GitHub Actions workflow on the exact branch commit; code review or older main results are not substitutes.

Read current owned evidence and distinguish fresh retained-original integrity/registry results from historical provider reads. Do not retry bank account details while a prior bank wait time is unknown.

## Delivery

Write docs/PAYMENT-0599-VERIFICATION-REPORT.md with sanitized findings, precise test and commit/run evidence, remaining external blockers and the Swedbank evidence request. Check main again before PR handoff. Keep integration and deployment pending coordinated review.
