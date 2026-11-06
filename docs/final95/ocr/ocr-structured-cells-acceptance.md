# OCR: source-bound party blocks and summary cells

Incremental patch against `e4ff4de2df6d19aeae7c00b6c91cda127888e1d9`: `final95-ocr-structured-cells.patch`, SHA256 `6734bc602088ba1b8151d0dea51213f25478dc13827ea119ddcfba42e11c8210`. The six exact before/after file hashes are in `final95-ocr-structured-cells-files.json`. No root checkout or production data was edited by this workstream. `git apply --check` against that root passed.

## Reproduced defects and changes

1. A physically continuous, explicitly labelled supplier/name/address/organization block lost the organization owner at OCR paragraph gaps. The layout planner now preserves the role only across a street row, Swedish postcode row and labelled organization in the same bounded, unobstructed column. It cannot assign an unlabelled company letterhead or a detached footer identity. Native text retains its paragraph boundaries. Competing roles, a new legal entity, an account/amount label, another organization, column movement, distant footer and intervening OCR blocks are negative tests.
2. Explicit net/VAT/amount-due cells below a table were inaccessible when OCR returned the label column and value column separately. A complete three-row region now proves ownership of exactly one whole printed amount per cell. Article-description columns, intervening quantities, extra values, unknown suffixes, competing headings, malformed amounts and mismatched baselines remain unresolved. Only a separate complete field or closed prose on the left can be isolated. Every word object, spelling, bounding box and confidence survives exactly once. A damaged VAT annotation remains verbatim and fails the unchanged complete monetary validator; it is never repaired or derived.
3. Independent synthetic tests exposed a previous precision error: after several empty monetary headings, the last heading could acquire the first later number belonging to another column. Both Node and Sites now recognize that unresolved heading stack and clear the ambiguous monetary values. Proven reconstructed cells remain readable. Printed arithmetic disagreements stay disagreements; values are not recomputed.

## Verification

Initial party tests: **30/36 pass, six positive regressions fail**. Party plus existing geometry tests: **118/118 pass**; subsequently added two column checks and clarified a geometrically valid intervening-buyer observation.

Initial summary cases: **6/30 pass, 24 fail**. This revealed the existing wrong-number assignment, so four separate Swedish/English pure-text cases were added and reproduced RED. After the heading-census correction, **22/34 pass**, with only the twelve intended positive geometry cases still failing. The initial geometry implementation had four failing English/damaged-VAT cases because a generic downward pair also consumed a typed heading; that dependency was corrected without changing expectations. The combined suite passed **154/154**. An additional numeric-aside adversarial case reproduced **0/2 pass** and was tightened to require actual closed prose, then passed **2/2**.

Final broad focused commands in the isolated allowed corpus copy:

| Command | Result | Duration |
| --- | --- | --- |
| `NODE_ENV=test node --test --test-reporter=tap test/*.test.js` | 328/328 PASS; 0 failed/cancelled/skipped/todo | 1087.345925 ms |
| `NODE_ENV=test node --test --test-reporter=tap sites/tests/*.test.mjs` | 480/480 PASS; 0 failed/cancelled/skipped/todo | 1926.161733 ms |

These are the existing copied parser/layout/reliability suites plus the 74 new independent synthetic cases, not the whole repository's Node or Sites gate. Parent owns full integration gates after applying the patch. All earlier assertions remain intact.

## Same-observation development measurement

`structured-replay.mjs` reads the preserved actual OCR responses from the earlier, fully captured known-V2 optical run. It makes **zero new optical calls**, performs **24 parser calls**, hashes raw inputs before/after, binds all changed parser/layout modules including the new summary planner, and records exact reconstructed text and field changes. Final receipt: `ocr-development-2982/structured-summary-replay-final.json`.

| Population and scope | Before this patch | After | False positives |
| --- | --- | --- | --- |
| Normal, 10 mandatory fields × 10 documents | 61/100 | **70/100** | 0 |
| Normal, all 13 fields × 10 documents | 84/130 | **93/130** | 0 |
| Stress, 10 mandatory fields × 2 documents | 8/20 | 8/20 | 0 |
| Stress, all 13 fields × 2 documents | 10/26 | 10/26 | 0 |

Node and Sites agree. Nine newly correct fields per engine, no previously correct fields lost, no green OCR result. This is known development replay, not an independent holdout or a new first optical attempt. V3 was neither accessed nor run. The source artifact containing original OCR JSON and the 12 unique preprocessed recognition PNGs remains `final95-ocr-development-evidence.tar.gz`, SHA256 `ac928abce83efff3ecfd00e6f334464d7959662c6a04b34c6ece4b77b33d8e17`; no source image was modified.

## Remaining mandatory fields

Thirty remain absent: organization 9, party 6, VAT 8, due date 2, net 1, total 1, invoice number 1, invoice date 1, currency 1. Seven additional optional misses are four Bankgiro accounts and three payment references. Missing identities are not justified by simply assuming every company header or footer is the supplier. VAT contains damaged optical percentage text and lacks a safe typed amount/rate contract. Other cases need additional measured geometry or optical evidence. They remain technical/product debt and source ambiguity, not a bank/vendor-access blocker. Further optical/preprocessing development and a fresh independent evaluation are still needed; this patch does not claim the 85%/98% image-OCR acceptance gate.

Independent static review by `/root/inventory_quality` found no material blocking issue in all four product files and both test specifications. That review did not rerun tests or establish an independent OCR score.
