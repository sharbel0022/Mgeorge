# OpenAI invoice intelligence — verified results and remaining acceptance

PR: https://github.com/sharbel0022/Mgeorge/pull/64  
Base: `f3c80629d4856c2f8ecbb1ed81be391a13ac6be8`  
Branch: `feature/95-openai-invoices`  
Date: 2026-11-06

**The guarded implementation and test tooling are available for review. No improvement from OpenAI, lower review rate, project model access or independent 85% recall / 98% precision acceptance has been established. Customer processing remains disabled.**

## Existing system inventory

| Component | Existing responsibility and integration point |
| --- | --- |
| `src/invoice-worker.js`, `src/invoice-extraction.js` | Local document/PDF/image/OCR processing; a successful source-bound read supplies the actual page count before AI is eligible |
| `src/pdf-text.js`, `src/image-dimensions.js`, `src/ocr-raster-size.js` | PDF text handling and bounded image/raster dimensions |
| `src/invoice-review.js`, `src/invoice-details.js` | Invoice interpretation, party and line-item extraction, financial checks and review/registration decisions |
| `src/db.js` | Durable documents, invoice registration and original reference evidence; AI-origin references are excluded from original evidence |
| `sites/lib/document-processing.ts`, `sites/lib/server-pdf.ts` | Sites document processing with D1, R2 original integrity, worker leases and registration guards |
| `sites/lib/openai-invoices/` | New shared adapter, profiles, schema, policy, merger, durable reservations and Sites preflight/integration |
| `src/openai-invoice-integration.js` | New Node adapter boundary using current document ownership and original integrity |

Existing parsing runs first. AI suggestions remain separate from parser party/line details and formal payment-reference proof. Every AI-assisted result requires human review.

## Full CI receipt for source commit 76f4c182

All eight checks passed on `76f4c18254c47210708b662fd78d1916ec5fd597`. The workflow tested a PR merge checkout; the benchmark freeze records `8fef8862072076555019998115ba8fd57622ce75`.

| Check | Observed result |
| --- | --- |
| Node 22.23.4 complete suite | 3,094 tests, 3,094 passed, 0 failed, 0 skipped |
| Node 24.22.1 complete suite | 3,094 tests, 3,094 passed, 0 failed, 0 skipped |
| Sites complete suite | 5,827 tests, 5,827 passed, 0 failed, 0 skipped |
| Sites types, audits and production build | Passed |
| Security acceptance | Passed |
| Bankgiro SFTP integration | Passed |
| Chromium synthetic onboarding | Passed |
| Synthetic 1/10/100-company performance | Passed |
| Dedicated AI invoice job | 82 Node and 7 Sites targeted tests passed; actual optical development run completed |

Sources: [payment control run](https://github.com/sharbel0022/Mgeorge/actions/runs/42311074866), [security run](https://github.com/sharbel0022/Mgeorge/actions/runs/42311074856), [AI guard and optical run](https://github.com/sharbel0022/Mgeorge/actions/runs/42311074847), [machine-readable CI receipt](evidence/ci-76f4.json).

These receipts are bound to that source revision. A subsequent review correction described below must pass the full current-head checks shown on the PR; the previous green run is not evidence for later code.

## Independent review and regression correction

Review identified a P2: scalar comparisons did not include existing parser parties and line items. A conflicting parsed recipient, supplier or row could therefore coexist with AI-filled header amounts. Automatic registration and bank evidence were still blocked, but the populated proposal was unsafe to present without an explicit conflict.

The correction checks both nested party organizations, the configured own company, bounded parsed rows, quantities, line amounts, parsed VAT rates and complete-table aggregates. It blocks filling on contradictions, incomplete/conflicting table status or mismatched row counts. The same local checks apply to new results, both cached-result paths and benchmark merging. Original parser details and the AI candidate remain available separately; no additional parser data is sent to OpenAI.

Seven regression cases were added, including a consistent-facts control. Actual Node 24.22.1 execution against the earlier merger produced **22 tests: 16 passed, 6 failed**. With the correction, **22/22 passed**. The dependency-free adapter/audit/integration/inventory/benchmark test subset then passed **84/84**. These are targeted local-copy tests, not a substitute for the complete repository CI.

- [RED output](evidence/nested-conflicts-red.txt)
- [GREEN output](evidence/nested-conflicts-green.txt)

The independent reviewer inspected the correction and regression tests and reported no unresolved critical or important issue within this focused change. That source review did not execute the tests or verify live OpenAI behavior.

Other reviewed corrections include explicit no-cache generation, no retry after ambiguous provider failures, authorization immediately before each provider request, and aborting oversized HTTP responses.

## Actual optical development measurement

The run on source commit `76f4c182` processed four generated documents: Swedish and English invoices, each as a PNG and a scanned/raster-only PDF. The two format variants share underlying invoice content. The primary rubric contains thirteen existing register fields. Recipient detail and line-item accuracy are not established by this corpus.

| Arm | Precision | Recall | Complete correct documents | False approvals | Review needed | Mean latency | API cost per document |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Existing OCR | 100% (46/46) | 88.46% (46/52) | 1/4 (25%) | 0 observed; no documents approved | 4/4 (100%) | 1,889.28 ms | $0 external API |
| OpenAI low profile | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured |
| OpenAI stronger profile | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured |
| Hybrid | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured | Not measured |

Existing OCR p95 latency was 1,908.72 ms and total extraction time was 7,557.13 ms. Shared input validation is reported separately. Local compute and infrastructure cost were not measured. Zero false approvals in four documents with zero approvals does not establish a general false-approval rate.

The missing AI arms are explicitly `unavailable`, with reason `LIVE_NOT_REQUESTED` and `metrics: null`. They must not be interpreted as zero errors, free inference, or a measured hybrid baseline.

**Acceptance is false:** `NOT_INDEPENDENT_OPTICAL`; all four arms were not measured. This small, optimized synthetic development replay cannot prove the user's independent target, even though its scalar OCR percentages numerically exceed 85%/98%. No AI improvement or reduction in review has been measured.

### Preserved run evidence

- [Readable report](evidence/development-report-76f4.json)
- [Exact CI artifact ZIP](evidence/development-run-76f4.zip): synthetic PNG/PDF originals, manifest, freeze, observation marker, access report and original report
- [Original Actions artifact](https://github.com/sharbel0022/Mgeorge/actions/runs/42311074847/artifacts/13549105270)

ZIP: 407,187 bytes; SHA-256 `60f7dd9d8eef8aa88b32509315b41ad88fff47210893166ebec48cf3eb05df17`.  
Manifest SHA-256: `ad89ff64237e57609f88c0729265716c789d7e4db341e0446733fdc4ce611a30`.  
Freeze SHA-256: `f2c6ba4e89f18e5e4ac80015423bb08d3751acc549e61bbbf1318f5ba7c58bbb`.  
Measurement window: `2026-11-06T23:19:43.222Z` to `2026-11-06T23:19:50.961Z`.

The retained ZIP is unchanged from the CI download. It contains only synthetic development material. Reproduction requires the frozen source and dependencies; a later corrected merger has different source hashes and must use a new freeze. See [the protocol](benchmark-protocol.md).

## Access and acceptance limits

The actual inventory command found no usable project API key or admin billing key. A later check in the restored executor also found no `OPENAI_API_KEY`, `OPENAI_ADMIN_KEY` or `OPENAI_PROJECT_ID`. The inspected Site environment revision 10 had no OpenAI key. See [the access report](project-access-report.json).

Officially documented model IDs and prices are not proof of project access. `gpt-6-luna` and `gpt-6.1-sol` are explicit candidate profiles; no immutable dated snapshot is invented. The cheapest suitable *available* model cannot be established without project inventory and measured extraction results.

Remaining work requires:

1. A project-scoped server credential and authorized billing visibility, supplied through secret management.
2. Read-only model inventory, billing/credit/budget verification, then actual bounded token-count and inference checks.
3. An independently curated, optically annotated holdout with authorized data scope; existing optimized fixtures cannot serve as its substitute.
4. All four measured arms, a predeclared complete-field/line-item rubric, and inspection of false approvals, latency, billed usage and review rate.
5. Approved privacy, security and cost controls before any real customer processing.

The application budget is a conservative internal reservation policy, not a verified provider-side credit balance or guaranteed hard spending cap. `store:false` does not by itself establish zero retention or GDPR compliance. Operational limitations and official sources are documented in [OPERATIONS.md](OPERATIONS.md).

No merge, production deployment, live model call or customer-data activation was performed as part of this work.
