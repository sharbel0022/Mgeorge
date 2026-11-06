# Independent review: narrow a19 parser repair

**READY for commit `63edd9fa97bc0475237133021313963e402efc76` as the narrow a19 regression repair.** This verdict does not approve OCR observation A/B, broad parser completeness, production registration or a score increase.

## Frozen scope and inspection

Exact baseline `a19e0a8ce7a7ddedb85de1a8f9e21b617ba90b77`; RED `69f13839a83c77bec1e5e2e73c194d832b5de2f9`; product `63edd9fa97bc0475237133021313963e402efc76`; producer verification metadata read at `ae354424e5bd1613c805e1c66283c2a437459f2d`.

Independent git-archive snapshots are `parser-red/` and `parser-fix/`; all writes stayed in this review directory. The product diff is saved as `parser-product.diff`. Its only product changes are the two byte-identical `invoice-details.js` copies, SHA256 `a8bf7c0222dd9fc42a373de23cfe927089b69d1d05ab95a8f469cf157e1fc1d7`. The entire party/organization parser and small diff were read. Existing tests and assertions are unchanged against a19; the only test-file addition is the new party-role-name matrix. The product commit's diff check is clean. A broader baseline-to-product diff check also includes raw preserved RED logs with trailing whitespace; those raw logs were not normalized.

The change admits ordinary role words within a colon-labelled company name. Explicit colon roles still create distinct events; unknown colon fields, pipe columns and bare/tab/multiple-space competing role sections remain held. Unassigned invalid/different organization occurrences hold an independently owned identity of the sole named role without assigning the unowned occurrence. Equal valid duplicates do not introduce an artificial role conflict. The existing owner, source-order, inline, scalar and layout-table boundaries were exercised unchanged.

## Independent executed results

All GREEN selections below completed with zero failures, cancellations and skips. RED was deliberately reproduced and retained. Tests are overlapping synthetic behavior checks, not document accuracy. No new OCR, external LLM, production call, dependency installation or V3 access occurred.

| Log | Passed/selected | Exit | SHA256 |
| --- | ---: | ---: | --- |
| parser-logs/boundaries.log | 312/312 | 0 | `f618462f6ae2624ba1baf28db8c8d3cf401842407cb96beb093cb6343ae4a926` |
| parser-logs/gmail-mcp.log | 71/71 | 0 | `5b470c638cb432628d10bc685d1f9d3ab13735b75df0419181f4193ae73b5d22` |
| parser-logs/independent-risk.log | 12/12 | 0 | `8c5e6f7a7c10a4a9d99ad6e5f42612a55db361ce4c8b4c11e22c0f89e6f2d8d7` |
| parser-logs/table-census.log | 12/12 | 0 | `a362a2350e68fbd396aa064a7b514adc9b009c4412d2e45d12d1bc49ec14ace6` |
| parser-logs/red-names.log | 20/48 | 1 | `c024a4410314d5e3db33c4c149f1f1d66dc60b9c588d6483975596490987f541` |
| parser-logs/residual-census-base.jsonl | diagnostic/— | 0 | `4d14591ded01c3ea1844013518dfb85c11cecaa5ac147dbcd63a91428a6c2bc2` |
| parser-logs/residual-census-fix.jsonl | diagnostic/— | 0 | `7de8088d6be93cb0bbffa1e286f639646731772315fe38eb74e7d6670fba5ff9` |

The new 48-case name matrix reproduced 20 pass / 28 fail on the frozen RED baseline and is included in the 312/312 GREEN boundary gate. The full real Gmail preview plus MCP read suites passed 71/71, including the unchanged explicit-approval test previously failing on a19. Twelve own checks cover internal opposite-role names, unknown inline colon, no identity donation, equal valid duplicates, corrupt unowned value before an owned value and different unowned value after a scalar boundary, for Node and Sites. The separate old table-census gate also passed.

Exact commands, working directories, runtime, counts and raw hashes are in `parser-review-receipt.json`. Own risk source is `parser-risk.test.mjs`.

## Retained baseline limitation, not introduced by this repair

`parser-residual-census.mjs` demonstrates a narrower limit to the phrase “complete organization census”. With direction customer, this source prefix is followed by ordinary valid invoice fields:

```text
FAKTURA
Leverantör: Syntetiska Utställaren AB
Kundens organisationsnummer: 556016-0680

Organisationsnummer: 556016-0681
```

Both exact a19 and the repair, on Node and Sites, return `party: null`, customer organization `5560160680`, and `level: yellow` with an issue and missing party name. The late corrupt unassigned value does not clear the explicit customer organization when only the supplier has a name. The new conflict set is keyed to the sole named role, rather than every owner-qualified role with an organization. The changed issue text now identifies the invalid unassigned occurrence, but the retained field behavior matches baseline.

This is not a new regression, not a green/automatic-registration bypass and not a blocker to the stated narrow CI repair. It remains a documented limitation: the repair must not be described as solving every unnamed-party census configuration. Raw outputs are saved for baseline and fix separately. No assertion was weakened to obtain READY.
