# Inline organisation context: source-bound fix

This is a synthetic text and saved-word regression, not an OCR measurement or a release approval. The product baseline is `d3af7858c7cf9e170277f6fec616f592a8206c0f`; the unchanged reproductions, original new-test expectations and full failed draft gate were frozen first in `69b2dd0b0a82c219f5b632ce5cec757869c4d572`.

## Defect and rule

An unsupported explicit field such as `Avsändare:` or `Utställd av:` can precede an organization event on the same source row. Previously, the row's organization event skipped the empty-event branch that cleared a stale recipient section. A complete native invoice could therefore become green with the recipient name and the other entity's organization number.

The parser now inspects the exact source span before every identity event and after the last event. An unknown labelled field interrupts inherited ownership even when a known organization follows on the same row. Explicit owner-qualified organizations retain their own owner; an intervening different explicit owner cannot leave a stale section for a later unqualified number. Raw text, all identity occurrences, and original evidence remain intact. Neither Avsändare nor Utställd av is promoted to a legal counterparty role.

Known inline scalar suffixes follow the same rule with or without a colon. The real scalar collector grammar supplies the supported colon positions; no parallel monetary alias list is introduced. A line starting with a scalar field still ends an inherited identity section, including registered aliases such as Belopp exkl. moms. The two detail modules remain byte-identical. The new callback is optional and defaults to treating all unrecognized colons as boundaries.

## Test-contract correction, explicitly retained

The first draft broke four older positive cases named `complete inline explicit VAT has the same name and scalar boundary`. Its complete 852-test log (848 pass, 4 fail) remains in `ocr-organization-inline-draft-before.txt`. The old test file and its assertions were never changed. Those four positives now pass.

One newly added expectation was inconsistent with those older positives: `Faktureras till: Syntetiska Mottagaren AB Valuta: SEK`, followed by the organization on the next line, had been expected to lose the organization. Root approved reclassifying only this new case, with its input unchanged, because a known inline scalar introduces no other party. Both original 24-case and 28-case sources and hashes remain in `ocr-organization-inline-contract-before.json`. Separate scalar rows and unknown explicit fields remain negative cases. No old assertions and no independent frozen assertions were changed.

## Verification

| Gate | Before | Final |
| --- | --- | --- |
| Independent frozen inline matrix, 16 cases | Root ran 8 pass / 8 fail on exact d3af785 | 16 / 16 in the final gate |
| Current own context matrix, 44 cases | New known-colon cases reproduced 8 failures; new registered-row cases reproduced another 8 failures in the respective drafts | 44 / 44 |
| Existing text, layout, word evidence and parser matrices | Full earlier draft log preserved | 868 / 868; zero skips, cancels or todos |
| Sites typecheck | — | Exit 0 |
| Detail-module byte parity and diff whitespace | — | Pass |

The independent 16-case file is exactly 2,411 bytes, SHA-256 `ad1434c22d55d954e350482a9fc56cd15b8ec3d29b680c4ca280c8f6b58126d3`. Its author was the independent reviewer; root ran its frozen before test because the reviewer's execution environment was unavailable. Recovery ran the final gate. The reviewer must still assess the frozen product source; these local results do not claim a reviewer execution that did not occur.

`ocr-organization-inline-final.json` records all four product hashes, each gate file hash, the exact command, full additional draft-red logs, runtime and attribution. `ocr-organization-inline-final-gate.txt` contains the complete final result: 868 tests passed in 3,767.7705 ms. The one historical external test path in that command is the unchanged independent grammar matrix persisted in commit `8271da891e251fbd99a1ed8caf5bd005152c9c1c`.

## Scope limits

Only the two parser modules and their two detail modules change. There are no worker/layout changes, new optical calls, V3 reads, fixture/gold changes or production calls. The earlier three optical calls remain recorded as a separate deviation; they are not erased by this task's zero-call count. Prior V1/V2 results and known-image replays are unchanged and are not relabelled as results for this source. The patch makes no recall or rating claim. The legacy no-named-role direction fallback is retained; final integration and independent review remain separate gates.
