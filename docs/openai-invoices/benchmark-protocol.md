# Invoice AI benchmark protocol v1

## Status and purpose

This runner compares the current OCR pipeline with the low model profile, the stronger model profile, and OCR with selective AI assistance. It produces measurements only for executed attempts. Implementation-time status is recorded separately in [benchmark-not-measured.json](./benchmark-not-measured.json).

At implementation time the executor was unavailable and no API key was available. No Node test, optical OCR measurement, paid model call, or improvement estimate was produced in that environment. CI must execute the commands below; its report supersedes that implementation-time status for the particular frozen corpus and implementation.

The generated corpus is a **development replay** of four synthetic documents: Swedish and English invoices, each as a PNG and a raster-only PDF. The PNG/PDF variants share invoice content. They are useful for plumbing and regression checks, but provide neither independent sampling nor representative accuracy evidence. Their familiar labels and values must never be relabeled as independent acceptance data.

## Execute the development comparison

From the repository root, after installing the locked root dependencies:

~~~sh
node --test test/openai-invoice-benchmark.test.js
node scripts/openai-invoices-benchmark.mjs synthetic --directory /tmp/openai-invoice-dev
node scripts/openai-invoices-benchmark.mjs freeze --manifest /tmp/openai-invoice-dev/manifest.json --freeze /tmp/openai-invoice-dev/frozen.json
node scripts/openai-invoices-benchmark.mjs run --manifest /tmp/openai-invoice-dev/manifest.json --freeze /tmp/openai-invoice-dev/frozen.json --output /tmp/openai-invoice-dev/report.json
~~~

Use a new, empty directory for every execution. Files use exclusive creation. Each freeze can start observations only once. A failed/interrupted run consumes its freeze too; retain its marker and explain the failure before making another attempt.

The default command executes real current OCR on the originals and records the AI arms as unavailable. It makes no OpenAI requests. An all-failed OCR arm writes its report and exits with code 1 so CI cannot silently treat a broken OCR installation as a passing baseline. Upload the entire manifest, freeze, observation marker and report as CI artifacts, even when the run fails. Never commit customer originals or private gold labels.

Actual reproducibility requires the same locked dependencies, Node version, platform, OCR assets and font environment. The freeze records root/Sites lockfiles, source hashes, installed OCR dependency versions/package hashes, Node/platform/architecture and relevant server-policy configuration digests. It does not archive the entire operating system or prove bit-identical rendering across machines. Keep the generated original bytes and their hashes.

## Four arms and production behavior

| Arm | Behavior | Default without live permission |
| --- | --- | --- |
| existing_ocr | runDocumentProcess followed by interpretInvoice, including current OCR bank-reference evidence | Actually attempted |
| openai_low | Approved luna-v1 profile through extractOpenAiInvoice, then mergeInvoiceSuggestion into an empty parser result | Unavailable, metrics null |
| openai_strong | Approved sol-v1 profile through the same adapter and merger | Unavailable, metrics null |
| hybrid | Rerun current OCR; retain a green result without an API call, otherwise use luna-v1 and the shared merger | Unavailable, metrics null |

The profile names correspond to the fixed, versioned application profiles. They are comparison candidates; this benchmark does not establish that the lower profile is the cheapest suitable model available to a particular project.

Standalone AI results are assessed after the same conservative field merger used by the application. The current merger preserves conflicts, never grants bank-reference proof, and requires human review for AI proposals. Consequently this experiment evaluates usable application output, not an unconstrained raw-model transcription. An AI review rate of 100% may be the deliberate product policy. It must be observed from an executed arm before it is reported.

For a live hybrid run, provider failure preserves the actual OCR fallback. Missing credentials or live authorization prevent the whole hybrid arm from running; its already-measured OCR sibling is not mislabeled as a measured hybrid.

## Live execution

Add --live together with --ledger /absolute/persistent/private/benchmark.sqlite only after configuring the application's existing invoiceAiPolicy approval, owner, company-identity, API-key and budget settings. The runner calls that policy for the two fixed model profiles; it does not bypass those server controls. The context owner and company organization in the manifest must match the approved server identity.

Before any paid request, the read-only inventory helper checks /v1/models. An unavailable inventory or a missing required model produces an unavailable arm. Inventory does not establish a credit balance, guarantee inference permission or prove model suitability. No credential is written to artifacts or console output.

Live data scope is limited to either:

- Explicit synthetic material, always classified as development or regression.
- A separately authorized independent holdout with dataClass "approved_anonymized", corpusType "independent" and a nonempty dataApprovalId, together with every normal server approval.

These scope fields are declarations for review, not proof of anonymization. The operator must verify that the exact original bytes are authorized for processing. No customer documents are transmitted by the default or CI commands.

Live execution requires a dedicated persistent SQLite ledger, supplied by --ledger or OPENAI_INVOICES_BENCHMARK_LEDGER. The path must be absolute. The ledger uses the shared audit-store reservation implementation: a full document-cap reservation is durably written before any token-count or generation request, and is never refunded after a cheap response, a failed response or an unknown cost. Restarts and new freezes retain that day's reservations. Immutable receipts use keys bound to the protocol, freeze, arm, original hash and model profile. Keep the same ledger across all benchmark runs; do not rotate or delete it to reset an active budget.

New ledgers are created with mode 0600 and a dedicated SQLite application_id and marker. Existing foreign databases are inspected read-only and rejected before writes. The benchmark does not write to the application's own database. This journal is distinct from production accounting; provider-side spending limits remain useful.

## Manifest and freezing

A manifest has version 1, an identifier, provenance, context and records. Each record contains:

- A neutral stable ID, a relative original path, MIME type, actual page count, lowercase SHA-256, and modality "optical" or "text".
- Explicit scalar gold values under gold.fields, using the application's field names and integer öre for monetary fields.
- Optional annotated detail groups using the existing OCR metric helper's schema.
- A requireReview boolean, which is independent ground truth for whether automatic approval would be unsafe.

The runner rejects path escapes, symlinks outside the manifest directory, duplicate byte hashes, missing truth and mismatched hashes. Before inference it checks image signatures/dimensions or the PDF signature/page count. A PDF labeled optical must have no extractable text layer.

freeze binds the canonical manifest, including all gold labels, the original hashes, source and relevant configuration. run verifies that freeze before creating an exclusive observations marker and repeats the source/input checks afterwards. Mutating labels, originals, implementation, dependencies or policy invalidates the run. The API key itself is deliberately excluded from the policy digest.

Only bytes, MIME type, page count and source hash enter the provider-input builder. Gold, family labels, source paths, meaningful filenames and fixture IDs do not enter prompts. Hybrid may additionally supply actual OCR observations. The same frozen company role is used for all arms.

Source-file and installed-package metadata hashes do not hash every native runtime binary, OCR language artifact or operating-system file. Use an immutable CI image/lockfile installation and retain environment details when comparing separate machines.

Hashes and timestamps are tamper-evidence within this workflow. They do not establish who authored a corpus, prevent someone from making a false declaration, or prove that no person has previously inspected it.

## Requirements for an independent optical acceptance run

Independent records must all be optical. The provenance must explicitly declare synthetic false, optimized false, previouslyUsed false and attestedIndependent true; identify a custodian; name a held-out date preceding the freeze; and reference a hashed provenance-evidence file. Each record needs a unique documentGroup, all thirteen scalar fields explicitly labeled (including nulls), and an independent gold reviewer.

Before collecting any prediction, a reviewer must confirm and record:

1. Authors/curators and label reviewers were separate from implementation tuning. The holdout was not selected from observed successes or previously optimized fixtures.
2. Supplier/layout/language/quality strata and failure cases reflect the intended workload. Exact document duplicates and alternate renderings of the same invoice are not independent samples.
3. Labels are checked against optical originals. Unreadable or genuinely absent values are null; requireReview includes ambiguity, mismatches, unsupported currency and other unsafe-registration cases.
4. The sample size and stratified reporting plan were chosen in advance. Very small cohorts cannot justify broad performance claims.
5. The source/configuration and corpus are frozen before the first prediction. Any later tuning makes that observed corpus development/regression data; obtain a new holdout for the next acceptance decision.

Existing optimized OCR cohorts, including historical measurements, remain regression evidence. Neither a new directory, a new date nor a new manifest hash restores their independence.

## Metric definitions

The runner reuses test/helpers/ocr-quality-metrics.mjs to preserve the existing scoring rubric.

- A correct non-null value contributes one true positive.
- An incorrect returned non-null value contributes one false positive and, when truth was non-null, one false negative.
- A missing expected value contributes one false negative.
- A spurious value where truth is null contributes one false positive.
- A correct null contributes neither true positive nor recall denominator.
- Precision is TP/(TP+FP). Recall is TP/(TP+FN). An empty denominator is null, never 100%.
- A complete-correct document has every explicitly annotated field correct and no processing error. This does not certify unannotated detail groups.
- A false approval is green with any incorrect/missing reviewed value, or green when requireReview is true. Rates are provided both per attempted document and among approvals; the latter is null when no approvals occurred.
- Manual-review rate is the proportion without a green result.
- Processing errors remain in the denominator as missing fields and manual review. An unavailable arm has no observations and metrics null.
- Latency is measured wall time for extraction, including OCR again for hybrid. Shared original validation is measured separately and excluded from extraction latency. Arms run in fixed sequential order with no result cache; this small single-pass comparison is not a statistical latency study.
- API cost is adapter-reported usage priced by the frozen adapter configuration, not a billing receipt or a credit-balance measurement. Missing cost is null; known cost and cost coverage remain separately visible. Current OCR has zero external API cost. Infrastructure/CPU cost is NOT_MEASURED.

**Scored scope:** the thirteen core fields are the existing register fields, including bankgiro. They do not cover every requested supplier/recipient address or contact field, nor complete line-item semantics. The generated fixtures annotate no detail tables. Therefore the 85%/98% thresholds in this report do not establish full-invoice extraction quality. A full-invoice acceptance study needs a predeclared expanded gold schema and independent detail annotations before predictions are collected.

The report contains per-field, scalar/detail, family and modality breakdowns. Development cohorts can deliberately omit unsupported gold detail groups; interpretation must state the scored scope. Independent acceptance requires all thirteen core scalar labels.

## Acceptance decision

The report's hybrid acceptance requires an eligible independent optical corpus, a verified freeze/source, measured error-free results for all four comparison arms, hybrid field recall of at least 0.85, hybrid field precision of at least 0.98, and zero false approvals. Per-arm pass flags are also shown so the comparison is inspectable.

Development/regression runs always have acceptance eligible false and passed false, even if every value happens to be correct. Unavailable arms prevent a complete comparison. No lower precision threshold, historical result, estimated improvement or assumed model performance can satisfy the target.

Keep raw reports private when they contain invoice truth or observations. Console diagnostics use fixed categories; exception text, provider bodies and credentials are not emitted.
