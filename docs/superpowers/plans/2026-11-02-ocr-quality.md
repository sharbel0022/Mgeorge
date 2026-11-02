# OCR, PDF and invoice understanding implementation plan

> Agentic workers: use systematic debugging, test driven development and verification before completion. The user authorized autonomous implementation and requires a development branch and reviewed PR, with no merge or Sites publication during parallel work.

**Goal:** Reduce incorrect invoice interpretations and unnecessary review while preserving original evidence and withholding uncertain values.

**Architecture:** Keep both existing runtimes and their registration boundaries. Strengthen the mirrored field parsers and PDF reconstruction; route manual Sites suggestions through the same parser. Add structured invoice detail evidence without changing financial storage, payment matching, Gmail scheduling, backup or UI ownership.

**Tech stack:** Existing Node ESM, TypeScript/Sites, PDF.js and local Tesseract. No new production dependency.

**Spec:** The user's OCR goal and subsequent parallel development rules in this session. Baseline `a9f88ae1c0f697376b3ecd140e1e80a64405125a`, tree `7658b96077f81ad43847c168d640e9d4d275ffa1`; exact objects obtained through GitHub and independently hash-verified. Frozen baseline checkout is used for identical-dataset comparison.

## Global constraints

- Only OCR/PDF/invoice understanding code, focused tests, measurement tools and the requested OCR documentation.
- Synthetic test data only; no customer originals, secrets, production mutations, bank calls, email sends or queue runs.
- Branch `codex/ocr-quality-20261102`; push only that branch, create a PR targeting main, no force push or automatic merge.
- No Sites publication; integration/publication belongs to the coordinated final delivery.
- Preserve leading zeroes and original text. Metadata may raise a conflict but may not supply invoice values.
- Unknown/ambiguous/contradictory values stay absent and cause review. OCR is not asserted to have universal precision.
- Shared PROGRESS and QUALITY-SCORECARD edits are deferred to integration to avoid simultaneous edits; this task's evidence and unchanged scores are recorded in `docs/OCR-QUALITY-IMPROVEMENT.md`.

## Review focus

- Identical visible PDF with permuted drawing order must not swap invoice number and reference or auto-register a wrong invoice.
- Empty or conflicting party/organization labels must not be ignored while the first valid label remains trusted.
- Discount prose must not disable arithmetic; rates, row sums and document sums need independent consistency checks.
- Continued or partial item tables must not silently drop rows or carry context across a new invoice.
- Manual import and metadata conflict checks must not truncate identifiers, consume neighboring labels or strip leading zeroes.

## Task 1: Source fields and invoice detail validation

**Files:** `src/invoice-extraction.js`, `sites/lib/invoice-fields.js`, mirrored invoice detail helper if needed, `src/document-triage.js`, `sites/lib/document-triage.js`; dedicated OCR regression files under both test directories.

**Interface:** Preserve `interpretInvoice(text, metadata)` and current scalar `fields`/`fieldNames`. Additional structured detail evidence is additive and retained in extraction JSON. Both engines must return identical normalized values and decision behavior for common text.

- [x] Write and run regressions for explicit empty/conflicting names, organization roles, metadata ID suffixes, OCR versus generic reference, false row totals and VAT, continuations, mixed rates and missing values. Confirm the real baseline failures.
- [x] Add source-bound identities, bounded table interpretation and conservative arithmetic validation; preserve legacy compatible registration values and add page/line evidence where observable.
- [x] Run both focused suites and document supported layouts and remaining abstentions.

## Task 2: PDF order and manual Sites import

**Files:** `src/pdf-text.js`, `sites/lib/pdf-text.js`, `sites/lib/local-ocr.ts`, invoice-only functions in `sites/lib/imports.ts`; dedicated PDF/manual regression tests and fixtures.

**Interface:** Preserve `reconstructPdfText(items)`, `pdfInvoiceText(bytes)` and manual form shape. Manual values are adapted from the same strict parser; bank CSV/CAMT logic is untouched.

- [x] Prove visually identical permuted PDF objects can swap IDs in the baseline; assert corrected fields or explicit review, including real processing/registration.
- [x] Reconstruct using reliable page geometry, retain safe behavior for missing/rotated/ambiguous geometry, and route browser PDF through the same reconstruction and optical fallback principles.
- [x] Replace permissive manual invoice regexes with strict parser outputs; invalid values remain blank with review evidence.
- [x] Run focused Node/Sites tests, including rendering, leading zeroes and manual metadata evidence.

## Task 3: Reproducible quality measurement

**Files:** dedicated synthetic corpus and evaluator under `test/helpers`, `scripts/measure-ocr-quality.mjs`, focused evaluator tests, `docs/measurements/ocr-quality-*`.

**Interface:** CLI accepts `--source-root` and `--output`, uses one fixed corpus for baseline/candidate, records dataset/runner/source hashes and runtime. Expected answers are literal, independently specified.

- [x] Define normal Swedish/English invoices, credit, multiple rates/rows/pages, missing/contradictory data, metadata traps and poor optical inputs.
- [x] Measure field precision and recall, exact document coverage, false green decisions, manual review and average time separately; clearly distinguish deterministic text from actual PDF/raster processing.
- [x] Run against frozen baseline and candidate with identical dataset and report per-engine counts and differences without dropping difficult cases.

## Task 4: Verification, review and PR

- [x] Run all root tests/syntax, Sites tests/TypeScript/build, exact minimatch check and dependency audits. Record failures, skips and environmental blockers rather than concealing them.
- [x] Obtain independent whole-change review, resolve material findings with regression evidence, stop redundant tests after relevant risks are resolved.
- [x] Write `docs/OCR-QUALITY-IMPROVEMENT.md` with mapping, root causes, supported scope, metrics, commands, baseline/candidate provenance, integration constraints and limitations.
- [x] Check current main and reconcile only necessary conflicts; push own branch and create a PR. Report branch, commit, PR, test evidence and files. Do not merge or publish Sites.

## Completion evidence

Implementation: `4bf4912d870d9ee3518a266b720f5fb5664b1f0e`. PR: [#19](https://github.com/sharbel0022/Mgeorge/pull/19), targeting unchanged `a9f88ae1c0f697376b3ecd140e1e80a64405125a`. Full suites: Node 1,137/1,137; Sites 1,996/1,996, zero failures/skips/cancellations. Syntax, typecheck, build, clean installs and high/critical audit gates pass. Independent code and measurement reviews are complete. Full results and limitations are in [OCR-QUALITY-IMPROVEMENT.md](../../OCR-QUALITY-IMPROVEMENT.md). No merge, main push or Sites publication.
