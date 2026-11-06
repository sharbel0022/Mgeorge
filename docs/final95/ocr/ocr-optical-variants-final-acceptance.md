# Final known-corpus optical diagnostics and cell precision fix

This development investigation is complete. No OCR mode/model, provider operation, production record or cloud schedule was changed. V3 remains unopened. The ordinary AUTO producer remains the production candidate.

## Predeclared actual optical comparison

The plan was written before all calls: `ocr-development-2982/optical-variants-known-01/plan.json`, SHA256 `fab8c69cb157d3123328fd3eddfb87ebc80edaf7a24bd9fc2d47fe53334cfc77`. It froze transitive parser/layout source, harness source, runtime packages, both local traineddata artifacts, known V2 gold/manifest, original images and the exact already captured preprocessed rasters. No image was changed, retried or selected according to its result.

Two local variants each processed all 12 known images exactly once: installed Swedish `4.0.0_best_int` with AUTO and installed default Swedish traineddata with SPARSE_TEXT. **24 actual optical calls, 48 parser calls, zero worker/parser errors.** Each response includes the original OCR text, word objects, bounding boxes and actual confidence, JSON and V8 serialization, timing, configuration and receipt. Hashes were rechecked after completion.

All 24 calls reused the same previously captured 12 raster files, byte for byte; they are referenced by SHA256 in the new plan rather than duplicated. Those 12 unique preprocessed PNGs are already preserved in the original archive SHA256 `ac928abce83efff3ecfd00e6f334464d7959662c6a04b34c6ece4b77b33d8e17`. The new raw-observation archive is `final95-ocr-optical-variants-01-evidence.tar.gz`, **770907 bytes**, SHA256 **`96e954c2406fbbad580a3471910c6e7533f75f566370826d77e04f40102ce474`**. It contains all 24 responses, failures/receipts, plan, run log and the exact source graph used at that time.

## Precision finding and repair

The original alternative result is retained unchanged: SPARSE_TEXT returned **72/100 mandatory fields and 99/130 all fields, with one false positive** in each parser. For normal-04, the OCR label cell `Moms 25` and the separate value cell `533,40` were joined with an ordinary space. The full string then resembled a valid grouped monetary value, causing the wrong VAT value `2553340` cents. Its document remained red, but a wrong field value is still a defect.

The incremental repair preserves the proven label/value cell boundary as a tab. Spaces within the whole printed amount remain spaces. The ambiguous `25` in the label cell therefore cannot become a thousands group in the amount cell. No word, digit, glyph, confidence or arithmetic is changed. Whole genuine grouped VAT amounts still parse correctly. A synthetic negative plus a legitimate grouped-amount control were first run: **2/4 PASS, 2 FAIL**. After the fix, the final broad focused parser/layout/reliability suites passed **Node 364/364**, 1290.812854 ms, and **Sites 480/480**, 1923.487227 ms; all zero failed/cancelled/skipped/todo. Existing assertions were retained. Parent owns full repository integration gates.

The patch is `final95-ocr-summary-cell-boundary.patch`, with exact before/after hashes in `final95-ocr-summary-cell-boundary-files.json`. It changes only `sites/lib/ocr-layout.js` and adds four Node/Sites cases to `test/final95-summary-cell-layout.test.js`. `git apply --check` against root passed.

## Complete reassessment of every variant

`reparse-optical-variants.mjs` reads all 24 preserved raw observations again with the repaired planner. It performs **zero new optical calls and 48 parser calls**, preserves every raw response and actual confidence, hashes source and raw inputs before/after, and records all field changes. Receipt: `optical-variants-known-01/precision-replay.json`.

| Producer / replay scope | Mandatory normal | All-13 normal | FP | Mandatory stress | All-13 stress |
| --- | --- | --- | --- | --- | --- |
| Ordinary default Swedish AUTO, original captured observations | **70/100** | **93/130** | **0** | 8/20 | 10/26 |
| Alternative Swedish best-int AUTO, fresh observations | 70/100 | 93/130 | 0 | 8/20 | 10/26 |
| Default Swedish SPARSE_TEXT, fresh observations | 72/100 | 99/130 | 0 | 8/20 | 10/26 |

Node and Sites agree. The only field-value change across the complete alternative replay is the unsafe normal-04 VAT value becoming null; the field is now held, not falsely called recovered. No correct field is lost. All variants remain non-green. The default AUTO replay has no field-value or review-level change from its preceding 70/100 result. Different lexical evidence separators now correctly retain the physical cell boundary.

SPARSE_TEXT is **not selected or deployed**. These known development observations do not establish broader layout accuracy, production throughput or independent acceptance. The ordinary candidate's verified development result remains **70/100**, not 72/100. No fieldwise union/cherry-pick across OCR attempts is used, and no competing observation is silently discarded.

## Remaining acceptance gap

The ordinary candidate still lacks 30/100 mandatory fields in this known sample: 9 organizations, 6 parties, 8 VAT values, 2 due dates, and one each of net, total, invoice number, invoice date and currency. The accompanying per-field classification distinguishes unreadable optical rate glyphs, insufficient explicit party ownership, and missing structural/grammar contracts. Those are product/evaluation gaps, not bank-contract or provider-access blockers. The two measured optical alternatives do not remove them. Reaching 85/100 from 70/100 requires at least 15 additional correctly source-bound mandatory fields while maintaining precision, followed by an independently run, source-bound evaluation against the project's unchanged 85% recall / 98% precision acceptance requirements. No 9.5 quality claim is made from these diagnostics.
