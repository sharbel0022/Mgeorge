# Standard field aliases — bounded development correction

## Result and scope

The final product candidate is `100f9c3015da34f772ea0cba53d9871e978ebeab`, on base `effca7cb93d50356e59a03d8366809b5ca3d5f55`. The source change is confined to existing label lists in five files. New synthetic tests first reproduced the omitted aliases and then checked their negative boundaries. Full PR/main CI, independent review and any publication remain separate release gates; these focused results do not raise any quality score.

The original independent first result remains **62 TP / 0 FP / 46 FN out of 108 normal image fields (57.41% recall)** for each parser. Its artifacts were not edited or replaced.

The one authorized development replay on the already consumed text observations, on intermediate source `0132d45`, produced **66 TP / 0 FP / 42 FN (61.11%)** for each parser: four English `issued_at` values recovered, no previously correct field lost, and no new wrong field. Stress remains 10/18 correct with 0 FP. There are still no wholly correct normal invoices and no green normal decisions. This is a development measurement, not a new optical or independent result, and it does not meet the 85% recall target.

## Demonstrated defects and exact correction

| Finding | Source / function | Bounded correction |
| --- | --- | --- |
| `Issue date` was not an issue-date label and could remain inside a preceding name or organization value. | `src/invoice-extraction.js` and `sites/lib/invoice-fields.js`: `normalizeInvoiceLayout`, `issuedDateLabel`, sibling census; both `invoice-details.js` copies: `knownField`, `boundaryLabel`. | Add the ordinary English alias, including existing spaced-date normalization and column census. Its collector keeps explicit word boundaries, complete date validation, all duplicate occurrences, and the existing adjacent-line limit. |
| The organization collector already accepted UK and US spelling, while scalar/layout boundaries recognized only UK spelling. | Both `invoice-details.js`: existing `orgLabel` already uses `organi[sz]ation`; both scalar modules: `siblingLabel`; `sites/lib/ocr-layout.js`: `labelSource`. | Harmonize only the already supported two spellings. Organization number validation and ownership remain unchanged. |
| Two recipient labels already supported by `recipientLabel` did not participate in the OCR layout label census. | Both detail parsers: existing `Bill to` / `Fakturamottagare`; `sites/lib/ocr-layout.js`: `labelSource`. | Admit these layout aliases and scalar sibling boundaries only with their original printed colon. Every existing geometry, ownership, conflict and residual-segment rule is retained. |

Self-review found a concrete regression in the initial recipient layout addition: joining a colonless heading and its next-line name would create a bare inline form that the party parser does not support. Four separately frozen regressions reproduced the name loss. The final colon lookahead leaves those existing separate heading/name forms unchanged. It adds no bare-role inference, unlabelled letterhead inference or address-to-party inference.

An independent reviewer also identified the same explicit recipient labels missing from scalar sibling boundaries. A separately authorized final two-line fix now bounds a preceding amount by `Bill to:` or `Fakturamottagare:`. Its 28 frozen cases cover the four positive Node/Sites combinations plus absent-colon, residual-text, longer-label and unowned-organization negatives. No orphan organization number is promoted.

The layout tests preserve every original word object, bounding box and confidence once, and preserve the complete original token inventory. The scalar tests retain malformed or competing dates, longer label words, unknown suffixes, invalid organization checksums, foreign/unowned organization numbers, the OCR confidence cap and unbound-payment rejection.

## Frozen evidence

| Step | Commit / evidence | Observed result |
| --- | --- | --- |
| Existing focused baseline | `baseline.txt` | 68/68 |
| Initial 70-test RED freeze | `20c5969d0b6906aae1d18963ef810b064c393724`; `red.tap`, `red-receipt.json` | 40 pass, 30 expected assertion failures |
| Initial alias product | `0132d4537c5fd24e6a0af7f3cadf499a73706ed0`; `green.tap` | Same 70/70 |
| Recipient regression RED freeze | `fdf954df916d3ef700c529631a1291608aca2af4`; `recipient-boundary-red.tap` | 0/4, four demonstrated name-loss failures |
| Recipient guard product | `4c8a2e3f69c6b88b4b8d0bae299c6d30fc7d82ee` | 74 new synthetic cases pass |
| Explicit sibling RED freeze | `8f97b00`; `recipient-sibling-red.tap` | 24/28, four expected failures |
| Final product | `100f9c3015da34f772ea0cba53d9871e978ebeab`; `recipient-sibling-green.tap` | Same 28/28; 102 new cases in total |
| Final Node/parser/layout focus | `node-final-focus.tap` | 574/574; zero failures, cancellations, skips or TODOs |
| Final Sites/parser/layout focus | `sites-final-focus.tap` | 464/464; zero failures, cancellations, skips or TODOs |
| One stored-observation replay | `replay-claim.json`, `development-replay.json`, `replay-output.txt` | Exactly 14 Node + 14 Sites parser calls, zero OCR calls |

`verification.json` records exact commands, runtime, source hashes, commit chain, counts and log hashes. `artifact-sha256.json` binds the evidence files. Initial and intermediate failed attempts remain available; they are not recounted as independent observations or added to the final passing population. The Node-focused suite itself also exercises both parsers through the shared synthetic harness, so its count overlaps the separate Sites coverage.

## Replay limitations and remaining gaps

The replay ran exactly once on product commit `0132d45`, before the recipient layout guard and final scalar sibling correction. Neither later change was replayed. Its 66/108 result is bound to `0132d45`, not relabelled as a direct measurement of final `100f9c3`. Stored observations contain already reconstructed text and Bankgiro-specific evidence, not complete raw OCR word blocks. Consequently this replay measures scalar parsing only. It cannot establish the optical or layout benefit of the new label census, and no missing blocks were reconstructed or guessed.

The observed `VAT 2590` / `Moms 2590` rate corruption is retained verbatim. Existing summary-cell code intentionally preserves damaged rate text for complete validation; neither rate repair nor subtraction-based VAT filling is part of this change. Unlabelled supplier branding, ambiguous company roles, unresolved metadata columns and corrupt company-name glyphs remain reasons to abstain. Zero green decisions are also consistent with the existing maximum 0.85 OCR field confidence.

Colonless recipient aliases remain outside the new inline sibling recognition. Their complete original text must still validate. The layout guard preserves supported separate heading/name rows; it does not create a new colonless inline role grammar.

The independent first-pass harness was inspected without finding a wiring error: it passes the actual worker text, method, confidence, bound evidence and input hash to both actual parsers, matching the production wrapper. The reviewed worker lifecycle fix remains intact. No fresh OCR, image editing, confidence change, arithmetic change, dependency change, production data action or publication was performed in this worktree.
