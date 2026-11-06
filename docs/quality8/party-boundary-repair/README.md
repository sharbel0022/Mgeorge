# Repair of explicit-name and later bare-role boundaries

Product source `96d1404d4b7bb4a791f0313c8cd95a29eec5a8c7`, based on the original parser repair `dd968c1`. Node and Sites contain byte-identical detail-parser code, SHA256 `db76b24ff1e68701f624b395588627b634767f9034289b163855dbc3b9226255`.

## Problem and changes

The second full PR58 run exposed 12 existing recipient-boundary failures. The earlier explicit-colon exception correctly preserved names containing role words but also accepted a second bare role after a complete first company name. The initial repair adds only negative boundary evidence: a printed company ending followed by another whole role word cannot be accepted as one name. It does not split the text into invented party identities or assign another owner. Literal role words within ordinary names remain unchanged.

Independent review of initial product `0f550950` found two additional problems. A bare role after a parenthesized company ending could still produce a green composite name. Also, an ambiguous name retained the earlier section role and could donate it to an unqualified organization label on the same or following line. Final product `96d1404` recognizes the closing parenthesis/bracket and clears section ownership for an ambiguous name. Separately explicit organization-owner labels continue to provide their own ownership evidence.

## Frozen tests and outcomes

- Original producer RED: 140 tests, 100 pass, 40 fail (the old 12 plus 28 new); the source and unchanged assertions are preserved in `0b19269`.
- A single-letter company prefix exposed four additional failures in the initial prototype. Its source snapshot and RED are retained; it was fixed before the first frozen product candidate.
- Initial product `0f550950`: 144/144 focused tests. Affected gates on that exact initial source: Node corpus 357/357, Sites corpus 352/352, boundaries 408/408, MCP reader 34/34. These overlap and are not added together.
- Independent original cases: 164 total, 144 pass, 20 fail on `0f550950`. The exact fixture bytes are retained in `sites/tests/fixtures/review-party-boundary-cases.json`; only repository and fixture paths changed in the integrated test adapter. Producer reproduction and original test-source hash are preserved in `9f7440f`.
- Final product `96d1404`: 308/308 focused tests, including the same 164 independent cases and all 144 prior cases. Independent recheck and full integrated CI are still separate gates.

Existing test assertions and invoice fixtures were not weakened. The change is a conservative grammar constraint, not universal company-name disambiguation. Unknown layout or unsupported text can still require review.

## Known-data regression replay

The unchanged runner executes 52 direct parser calls, 0 new optical calls, against the exact source `96d1404`. All 52 field sets, evidence, issue arrays, levels and party results are byte-for-byte equivalent in JSON value to source 63edd9f. Stored PSM3 text remains 57/100 mandatory fields and 79/130 All13 with 0 false field values. PSM6 remains separate diagnostic evidence with its original two All13 false positives; it is not adopted. This does not improve the measured OCR rating or constitute a fresh holdout pass. V3 remains sealed.

The complete result, comparison and raw process output are retained beside this report. Root's full PR/main verification and publication receipt must be consulted before making any integrated or production claim.
