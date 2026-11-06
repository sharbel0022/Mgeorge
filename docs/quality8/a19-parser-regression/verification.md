# a19 parser regression repair: own verification

Product source: `63edd9fa97bc0475237133021313963e402efc76`.
Baseline: `a19e0a8ce7a7ddedb85de1a8f9e21b617ba90b77`.
Pre-fix RED freeze: `69f13839a83c77bec1e5e2e73c194d832b5de2f9`.

This is a separate repair based on a19. It can be cherry-picked without observation A or B. The product commit changes only the byte-identical `src/invoice-details.js` and `sites/lib/invoice-details.js` implementations.

## Causes and changes

The party parser treated an occurrence of a role word anywhere inside an already colon-labelled name as another role. That rejected legitimate original values such as `Original supplier AB` and `Synthetic customer AB`. It also removed the party needed by the existing MCP candidate reader, so correct references could not become candidates. A colon-labelled name now retains ordinary internal role words. A second explicit role label remains a separate event; unsupported colons, pipes, bare competing roles and unresolved tab/space columns remain held. No alias, party ownership inference or candidate-read bypass was added.

A separate complete-census defect let an unassigned late organization occurrence fall outside the already-owned number's validation. An invalid extra value could leave that old number populated; an identical valid duplicate unnecessarily added an unclear-role issue. Unassigned values now participate in conflict checks without supplying ownership. Only values identical to an independently established owned value can be treated as harmless duplicates. Invalid or different unassigned values hold that owned result. Existing two-role and unknown-sender boundaries retain their previous conservative behavior.

The old Gmail fixture was valid: its failure exposed the name grammar bug. Existing tests, assertions and fixture facts were not weakened or replaced. New grammar tests cover ordinary role words in both same-role and opposite-role company names, explicit sibling roles, bare roles and unknown/column boundaries.

## Fresh verification

| Selection | Before | After |
| --- | ---: | ---: |
| Affected Node document quality, exact-field corpus and reference integration, including actual native-text PDFs | 348/357 | 357/357 |
| Affected Sites document quality, exact-field corpus and whole Gmail preview | 343/352 | 352/352 |
| New general party-name grammar matrix | 20/48 | 48/48, included in the boundary gate |
| Named a19 ownership/inline/source-order/role/scalar gates plus new name matrix | — | 312/312 |
| Focused old parser/registration regressions | — | 142/142 |
| Whole actual MCP evidence-read suite | — | 34/34 |
| Verified Sites typecheck of this repair project | — | exit 0 |

The sets overlap; their totals are not an independent-document accuracy score. All selected tests reported zero failures, cancellations or skipped cases after repair. The optical PNG test was explicitly excluded before execution and is not counted as selected. Native-text PDF assertions checked their actual PDF method. No new OCR, external LLM call, fixture regeneration or V3 inspection was used. Existing registration tests operated on their synthetic fixtures in isolated databases; they did not create production invoices or bank facts.

The first typecheck wrapper invocation stopped at its installation guard because this isolated checkout shared `node_modules` by symlink. Its refusal is retained separately. The supported verified runner at the real dependency installation then typechecked the repair checkout with `--project`; no supply-chain guard or dependency was changed.

`red-receipt.json` and `green-receipt.json` record exact commands, runtime, source/log hashes and result counts. Both raw RED and GREEN logs are retained. The source files were compared to the product commit after the checks, the two parser copies are byte-identical, and `git diff --check` was clean. These are own implementation checks; independent review and full integration remain root-owned gates.
