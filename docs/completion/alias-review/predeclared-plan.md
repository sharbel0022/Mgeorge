# Independent standard-alias boundary review — frozen plan

Baseline product: `f5d178ea816d276457685fbc0421cf144f7cf655`.

The reviewer authored these 40 text fixtures and 13 manual word-box fixtures from the requested label contract and baseline source, before reading the implementation diff or running a parser. The same 53 observations are checked against both public Node/Sites parsers (106 checks). No blind corpus, original images, gold fields, extracted text, predictions, or individual observations were opened. This is a directed safety review, not a statistical benchmark or accuracy estimate.

The permitted new semantics are the exact `Issue date` label, the existing `Organization number` spelling in sibling/layout census, and explicit `Bill to:` / `Fakturamottagare:` recipient labels already supported by party collection. No new geometry, role inference, optical processing, financial repair, arithmetic, or bank evidence is requested.

Text checks cover positive aliases, equal aliases, contradictory/invalid/missing labels, a contradiction beyond 20,000 characters, adjacent line versus paragraph/page gaps, prefixed/suffixed/nonlabel tokens, unconsumed scalar residuals, foreign recipient organization numbers, mixed owner rows, and unsupported role labels. Synthetic organization numbers were independently calculated as Luhn-valid values, unrelated to any production party.

Word boxes are handwritten, with fixed geometry and confidence. Checks cover unique alignment, current British spelling, competing owners/candidates, excessive distance, source text absent from boxes, unknown tokens, and preservation of all original word object references, spelling, confidence and boxes. Word-box checks exercise the real layout function and both real parsers without invoking OCR. OCR field status has an existing confidence cap, so the review does not infer absence of false greens merely from an OCR yellow status.

`layout_unrepresented_residual` deliberately appends an unrepresented raw source line in the runner. This is part of the frozen input specification. No expectations will be weakened after execution. If a fixture or expectation is invalid, the first result remains in the record and the reason must be reported separately.

The runner is a docs-only, explicit test entry point and is not automatically included in application suites. Source is selected only through its harness-only `ALIAS_REVIEW_ROOT`; no production bypass variable is introduced. Run unchanged fixtures/runner on the baseline and exact frozen candidate. Record commands, exit codes, counts, duration, source commits/trees, source hashes, and fixture/runner hashes. Scope is bounded pure text/word-box tests, not full CI. Parent owns full CI and release.
