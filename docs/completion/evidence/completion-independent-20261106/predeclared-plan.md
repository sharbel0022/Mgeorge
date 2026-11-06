# Independent synthetic OCR evaluation — predeclared plan

Evaluation ID: completion-independent-20261106
Declared at: 2026-11-06T14:38:36.588411+00:00
Functional source baseline: 6b1d0c71214395d2d8294b5823bc015b97e51909

This is a newly authored synthetic corpus, not recovery of the unavailable historical V3 archive. The evaluator did not implement the parser. Before this declaration only the named quality harnesses, package metadata, worker entrypoint filenames, and the exported mandatory/critical field constants were inspected. No previous image, answer key, development result, or parser implementation was inspected.

## Population and execution

Author 16 normal invoices and 3 separate stress cases before executing OCR. Normal cases comprise eight Swedish and eight English invoices, four independently authored layouts, and clean print, grayscale, mild rotation, or light scan degradation. All data is synthetic. No real persons, organization identities, bank accounts, or payment instructions are included. Stress cases use severe low contrast, partial cropping, and contradictory payable totals. Ground truth retains source facts and marks every stress case review-required.

Rasterize exact authored text programmatically. Freeze image bytes, case metadata, answer key, rendering code, and this protocol with SHA256 before the first optical call. Run the existing local document worker sequentially once per case, and supply that identical optical observation to both the Node and Sites interpreters. No provider calls, production data, registration, network OCR, warmup document, or repeated first attempt is permitted. A failed attempt remains a recorded failure. Runtime setup may be repaired before any optical call; after any call, do not rerun that case as part of the first sample.

## Fields, comparisons and abstention

The existing mandatory field set is invoice_number, party, organization_number, issued_at, due_at, total_cents, net_cents, vat_cents, direction, currency. The critical set is invoice_number, party, organization_number, due_at, total_cents, net_cents, vat_cents, reference, bankgiro, direction, currency. The ordinary documents contain all ten mandatory fields; reference and bankgiro are absent and must not be invented. Exact canonical comparisons use NFKC, collapsed whitespace and case-insensitivity for party; trimmed case-insensitive invoice/currency identifiers; organization-number digit equality; ISO calendar-date equality; integer minor-unit amount equality; and exact direction enum equality. No edit distance or approximate tolerance is allowed. Null, missing or empty is an abstention. Incorrect nonempty emission counts one FP and one FN; correct nonempty emission counts one TP; abstention for an expected value counts one FN. Report mandatory image-derived nine-field metrics separately from ten-field metrics including context-supplied direction. Direction is trusted synthetic metadata and never claimed as OCR recall.

## Status and denominators

Report normal and stress populations separately for each parser. Normal primary target is precision >=98% and recall >=85% across the nine required image-derived fields. Precision=TP/(TP+FP); recall=TP/(TP+FN), with a zero denominator reported undefined. Also report complete-document exact accuracy, abstention and wrong-emission counts, per-field metrics, document statuses, duration and all errors. A document-process error makes the effective status red while preserving its original status. Green means the product's actual green decision, never a status invented by the evaluator. False green means green with a processing/parsing error, review-required input, or any incorrect/absent critical expected value or invented absent critical payment field. Every stress green is false green. Require zero false greens across all attempted cases; lack of green alone does not demonstrate safe useful automatic registration. Confidence intervals and small synthetic-sample limitations will be reported. No results-based corpus, threshold, gold, comparison or parser changes.

## Independence and receipts

Record timestamps, source and dependency hashes, attempt ledger, optical observation hashes/text, both parser outputs and scoring. Large raster files stay in the separately identified scratch evidence directory; compact provenance and results are committed with the report. Preserve the original first attempt unchanged. Any necessary deviation is appended in a separate audit note, never silently edited into the frozen plan.
