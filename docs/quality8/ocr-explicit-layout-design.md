# Explicit horizontal fields and recipient columns

This is a separate improvement above the independently reviewed parser base `ae56dc9a9e3d76697e38a196692a337ae0900b0d`. It is not an acceptance measurement or a new holdout. The sealed first V1/V2 measurements, images, gold files and measurement helpers are unchanged. V3 images, gold and generator have not been read.

## Product boundary

Only three product files change: `sites/lib/ocr-layout.js` and the byte-identical Node/Sites `invoice-details.js` modules. The scalar grammar, OCR engine, AUTO segmentation, worker, recognition parameters, confidence thresholds and Bankgiro evidence rules are unchanged.

The layout helper can join a standalone explicit field label with a unique value segment on its physical right. Both vertical and horizontal alternatives participate in one census before any pair is selected. Unknown colon headings, labels with multiple candidates, low-confidence headings and labels in excluded rows can block ownership. There is no closest-value rule, preference for one direction, or perfect-matching assumption that every heading must have a value.

The existing actual-word glyph height controls distance. A rightward gap must be nonnegative and no larger than 16 label glyph heights; minimum glyph height, overlap and centre alignment must agree on a physical row. Neither a tall value box nor a tall union can enlarge the search into another column. The wider ownership census only blocks a pair. All words in the corridor are considered, and every split source row must be fully accounted for, with iterative cancellation across dependent rows.

### Table boundary

A new negative case demonstrated that a large blank gap does not establish the end of a table: the article description `Netto` with quantity `1` and line amount `480,00` could otherwise be rearranged into a plausible document amount. The final change therefore does not authorize the new horizontal path anywhere in or below the physical top of an identified description/quantity table on the same page. A later bare heading, large gap or unrelated complete field cannot remove that boundary. The existing vertical path is retained, including its positive standalone-summary regression. Horizontal candidates still participate in the common ambiguity census even when the table boundary prevents their authorization.

This deliberately leaves some real horizontal totals unresolved. It does not claim to detect the table's end or infer which numeric column is a document summary. No reach was increased to fit the known V2 examples.

### Explicit party roles

`Faktureras till` is treated consistently as an explicit recipient label by layout and by both detail consumers. It supports a standalone heading, a colon value, and a value after the explicit role at the start of a line. Unknown next-line headings, absent values, role-prefix collisions and competing roles remain held. Unlabelled company names do not acquire a role.

Reconstructed fields use independent paragraphs. Blank lines and mixed-role rows cannot transfer the last emitted party section to an unowned organization number. Explicit owner-qualified organization labels remain usable. A split row containing two roles is not partially accepted when either name or an unknown suffix is unresolved.

Original words are retained exactly once by object identity with unchanged spelling, bounding boxes and confidence. Only whitespace and ordering can change. Malformed or ambiguous input keeps the raw source. Bankgiro still requires its original input/text/page/line/word binding and actual word confidence of at least 90.

## Validation and one approved old-contract change

The initial 56 new geometry/consumer cases were red on the reviewed base: 33 passed and 23 failed. Subsequent consumer and table counterexamples extend the new suite to 61 cases. The final focused text/word-only matrix passes **656/656**, with no skips. Sites TypeScript, Node/Sites detail byte parity and `git diff --check` also pass. The exact test list and file hashes are recorded in `ocr-explicit-layout-validation.json`.

One existing cross-axis test had previously expected vertical assignments for both `OCR` and `Att betala`. With rightward candidates enabled, its unchanged source contains two candidates for `Att betala`, and the right-hand number also has the `OCR` owner above it. Root reviewed the unchanged input and candidate loop and explicitly approved changing just this old expectation to exact raw preservation and a hold. The complete pre-change source, old expected/output and hashes remain frozen in `ocr-layout-cross-axis-review.json` (SHA-256 `eb3d4442ae5de625fa62119510a12eab0678f129f5846852298d274c0b058c70`). That receipt predates the assertion edit; its `oldAssertionUnchanged: true` describes that earlier freeze. The executable reproducer writes only a new output path. Additional Node/Sites consumer cases require both ambiguous amount and reference to remain null. No input was changed to make the old example pass.

## Optical-call deviation

An earlier broad regression command accidentally included `test/ocr-bankgiro-producer.test.js`, whose tests invoke the real local recognizer three times on two old synthetic fixtures. All three passed, but they were outside the intended saved-observation-only work. Root was informed immediately after detection. They are recorded separately in `ocr-explicit-layout-optical-deviation.json`, including fixture hashes and observed assertions. No V1/V2/V3 or customer image was recognized in those calls. Full raw responses and a complete execution-time source inventory were not captured. They are not a holdout, acceptance evidence or a reason to claim a score.

The final 656-case command excludes that entire producer file and performs no optical recognition. The separate known V2 replay runner operates only on the frozen full raw responses from diagnostic commit `e653a8d12fc276e2d6d0ecdbc1710101fd64b3d1`; it records zero recognition calls during that replay and retains the earlier three-call deviation explicitly.

## Known-data replay and release boundary

After the code commit is frozen, `scripts/quality8/replay-explicit-layout-diagnostic.mjs` can compare the actual before/after layout and Node/Sites parsers for saved normal 09 and 05. It checks all 37 packet file hashes, the exact source commit, the complete local optical dependency graph, actual original-word identity and the first V2 result/gold hashes. It does not import or call a worker. Measured durations cover parsing only, not recognition. Its 13-field, mandatory-10 and image-9 summaries concern only two already known diagnostic images; no stress cases are included and no population-wide acceptance can be inferred.

Independent code review remains a release gate. New blind V3 acceptance must bind the finally reviewed source; this work neither inspects that population nor substitutes a known-image regression for it.
