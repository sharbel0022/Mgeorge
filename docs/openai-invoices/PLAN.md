# OpenAI invoice intelligence — implementation and acceptance plan

Base: `f3c80629d4856c2f8ecbb1ed81be391a13ac6be8`. Branch: `feature/95-openai-invoices`.
PR: https://github.com/sharbel0022/Mgeorge/pull/64

## Design

Retain deterministic PDF/Tesseract extraction as the first stage. The shared server adapter calls OpenAI Responses with strict structured output and produces untrusted invoice suggestions with page/quote provenance. Node and Sites validate financial values and keep every AI-assisted result in human review. Original bytes and independently sourced bank evidence remain intact.

## Implementation

- [x] Shared bounded adapter, explicit versioned profiles, strict schema and independent output validation.
- [x] Atomic durable audit reservations and receipt reuse, document/day budgets, no automatic replay of uncertain requests.
- [x] Node/Sites hooks behind server-only approvals and owner allowlists, with original, lease and registration guards.
- [x] Four-arm benchmark tooling with frozen provenance, a separate persistent live-budget journal, unavailable-arm statuses, and development/independent eligibility.
- [x] Read-only project model/cost inventory with explicit unknown credit and provider-budget statuses.
- [x] Independent safety review; fix cache-write pricing, ambiguous retries, mid-request authorization and oversized-response cleanup.
- [ ] Final full CI for the final combined revision (current result is attached to PR checks).
- [ ] Real model comparison and independent optical acceptance — blocked by missing project credentials and a qualified independent corpus.

## Verification recorded before the final combined CI

The first implementation commit `3fc3370a5292fc83095d379cb865ccb95af7dbd9` passed all eight checks: 3,067 Node tests on each supported Node version, 5,827 Sites tests, types, production build, audits, security acceptance, browser, bank integration and synthetic company performance. These results do not substitute for testing later changes.

The restored minimal Node 24 runtime executed the updated adapter/audit/integration/inventory tests: 63 passed. Its oversized-body cleanup regression first failed, then passed after the request error path was corrected. The benchmark metric/ledger suite executed 14 tests: 14 passed. Full CI on the final source remains the release gate.

## Acceptance limits

No OpenAI API key, admin billing key or project ID exists in the checked execution environment; the inspected Site environment revision 10 also had no OpenAI key. See [the actual access report](project-access-report.json). Model listing, billed costs, credits and provider budget remain NOT_VERIFIED.

No paid model evaluation or customer processing has occurred. The initial local dependency installation failed when the original executor became unavailable; it is not a passing test run. A later restored runtime permitted isolated Node tests, while GitHub CI runs the complete locked suites.

The default benchmark executes four generated optical development documents through existing OCR. Missing AI runs remain null. Its primary rubric covers thirteen legacy register fields, not complete recipient and line-item accuracy. Development replay cannot prove the independent 85% recall / 98% precision goal, and this PR makes no measured-improvement claim.

Real customer processing remains disabled. All live data, scope, privacy, security and spending decisions require the server approval gates described in [OPERATIONS.md](OPERATIONS.md).
