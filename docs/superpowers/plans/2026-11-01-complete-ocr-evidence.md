# Complete OCR and payment evidence implementation plan

> Execute continuously under the user's explicit iterative implementation, testing, main push and existing-Sites publication authorization. Superpowers TDD and independent task/final reviews apply.

**Goal:** Correct reproducible OCR/reference/invoice defects and make existing private evidence verifiable without financial writes. Exact results on a declared corpus are measurable; universal 100% optical recognition is not a valid acceptance claim.

**Architecture:** Preserve both existing engines, shared financial/evidence boundaries and owner-bound Sites OAuth. Improve complete-token parsing and optical fallback; remote worker metadata cannot create PDF confidence. Expose bounded existing read-only verifiers through the same MCP ingress, with no new credentials, scope, public-data route or migration.

**Spec:** Current user request, AGENTS.md, previous Bankgiro original verification report and delivery receipt.

## Global constraints

- No real invoice registration, source association, allocation, balance change, email or bank payment. Prior explicit no-financial-write instruction persists.
- Real originals/accounts/names/hashes remain outside Git; only synthetic fixtures and sanitized measurements are committed.
- Preserve Sites project, audience, OAuth, DB/R2, runtime secrets and schedules.
- Preserve leading zeros; never truncate malformed identifiers to a valid prefix, join ambiguous IDs, infer payer identity or manufacture bank-account relations.
- OCR results remain proposals requiring review when uncertain; confidence is not evidence of correct identity.

## Review focus

- Delimited valid references alongside neighboring labels versus malformed trailing tokens.
- Duplicate valid/unreadable invoice fields and multiple amounts on one line.
- Remote worker method/confidence cannot bypass image/OCR review.
- Scanned PDF with a digital footer still needs optical recognition; native text controls must stay intact.
- New MCP reads are owner-only, bounded, complete/incomplete explicit and demonstrably free of network/financial/storage writes.

### Task 1: Complete bank reference tokens

Files: src/payment-references.js, sites/lib/payment-references.js, focused Node/Sites tests.
Interface: existing extractPaymentReferences/matchingReferenceValues; existing exact-reference engine consumes only valid evidence.

- [x] RED: OCR 000018x, 000018.9, 000018/99 and malformed invoice ref cannot become valid prefixes or safe matching. Ordinary adjacent labelled valid refs remain exact.
- [x] GREEN: minimally correct both engines, preserve malformed raw evidence/warnings/incomplete state and leading zeros.
- [x] Run targeted tests and independent task review.

### Task 2: Exact invoice-field evidence

Files: src/invoice-extraction.js, sites/lib/invoice-fields.js and focused parser/processing tests.
Interface: interpretInvoice/parseInvoiceText field/confidence/issue contract stays compatible.

- [x] RED: ambiguous 0594 0595, unreadable duplicate OCR, OCR absorbing Bankgiro, malformed full token, multiple total values and case-insensitive conflicting currencies cannot be green/automatically registered.
- [x] GREEN: preserve legitimate character-spaced digits only when unambiguous; inspect every labelled occurrence and full value; preserve valid ordinary inputs.
- [x] Verify both engines and actual isolated document-processing gates; independent task review.

### Task 3: Remote OCR method trust

Files: sites/lib/document-processing.ts and cloud/local worker tests.
Interface: authenticated lease completion cannot self-promote to PDF trust. Original digest, owner, lease and confidence caps remain enforced.

- [x] RED: owned image with zero-confidence completion claiming pdf must not automatically register; positive ordinary OCR still processes as review.
- [x] GREEN: derive trusted provenance from server/original processing boundary, reject or conservatively classify worker claims; test PDF queue compatibility and missing/unknown methods.
- [x] Run focused suites and independent task review.

### Task 4: Scanned PDF optical fallback

Files: src/invoice-worker.js and actual raster/PDF extraction tests.
Interface: runDocumentProcess retains bytes/page/pixel/text/time limits and returns truthful method/confidence.

- [x] RED: synthetic scanned invoice plus digital footer longer than60 characters must still read invoice number and total through OCR.
- [x] GREEN: detect raster content that lacks usable invoice text, retain native-PDF positive controls and no OCR-confidence promotion.
- [x] Measure actual optical extraction on reproducible synthetic inputs, independent task review.

### Task 5: Bounded private read-only evidence tools

Files: sites/lib/banking/mcp.ts, new focused read service and tests. Reuse readPaymentVerification, bankPaymentInvoiceAssessment, bankgiroRetainedPreview and owner-bound current stored resources only.
Interface: payment_evidence and retained_report_evidence, strict selectors, explicit incomplete/ambiguity/pagination and byte budgets; no caller-supplied owner/account/context.

- [x] RED: current authenticated reader absent; foreign/missing IDs fail before R2, writes/fetch forbidden, ambiguous exact refs never selected by money/date, oversize replies explicit.
- [x] GREEN: same OAuth ingress, legacy tools remain argument-free; no new scope/secret/migration. Include reference lookup registry/source candidates and bounded transaction selector to find an AIS candidate without declaring it matched.
- [x] Verify transport/auth, complete state unchanged and original-integrity failures; independent task review.

### Task 6: Integrate, measure and deliver

- [x] Full Node/Sites, syntax, TypeScript, audit gates and production build; independent integrated review; fix important findings with RED/GREEN and repeat gates for changed inputs.
- [x] Update scorecard/progress with exact measured before/after and limits; push approved exact tree, verify exact CI, publish existing Sites and verify deployment/source parity.
- [ ] Confirm republished same-Site MCP tool discovery, inspect the actual private case through read-only tools, compare supplied original and invoice evidence. Missing external bank/customer evidence remains a blocker, never invented.
- [ ] If actual evidence reveals another reproducible internal defect, fix/test/review and publish again; retain a precise continuation point for any genuinely unavailable external fact.

## Ledger

Start main dfd852666cf3462588a82797717822347602e196; source equivalent to verified code8962254/Sites48. Dependencies already installed; earlier exact full gates reused only as baseline where unchanged. Parallel implementers have disjoint file ownership; controller integrates and reviews shared contracts.

Task1: fix round1/5: comma/semicolon numeric suffixes preserved, RED16→GREEN119; scoped spec/quality review passed. Task3: spec/quality review passed, worker claims remain OCR; targeted109 green. Task4: fix round1/5 opened: Sites native-footer extraction bypasses Node optical fallback, same actual raster reproduced. Task2: fix round1/5 opened: malformed currency labels, hyphen invoice delimiters and same-line explicit VAT/net labels need complete occurrence auditing. These are internal defects to fix, not external evidence blockers.
Task5: fix round1/5 opened after independent real-fixture review: exact-reference lookup must include all preserved references in the selected source, not just display winner; negative complete=true absence otherwise misleading. No security boundary finding; read-only/auth/size protections passed review.
Task4 routing ruling: Sites uses conservative structural invoice-field presence only for OCR routing, alongside real raster operators. The existing invoice parser remains the only field validator; no domain import/bundler expansion is needed for routing. If routing is wrong, cost is extra OCR/review or missed OCR, never added trust or automatic payment.
Task4: fix round1/5 addressed Sites footer/raster routing; scoped spec/quality pass, actual server→queue→OCR→review preserves originals/zero registrations. Task5: fix round1/5 addressed hidden secondary refs and ambiguity; scoped spec/quality pass,16/16 focused and full1260/1260 passed. Task2 round1 fixes stable,152 Node/149 Sites focused, scoped rereview pending. No code/financial deployment yet in this cycle.
Task2: fix round1/5 addressed all three explicit-label findings; scoped reviewer independently20/20checks, spec/quality pass. Initial parser-only corpus46/46 was not a universal proof: review expanded full label cases and actual full-field optical measurement found JPEG BG digit error. Optical measured54/55OCRfields,4/5OCRdocs exact, plus22/22nativePDFfields. Document remained yellow, no automatic registration. Read-only normalization spike underway before any general preprocessor change.

### Task 7: Current bank-supplied account evidence (read-only)

A primary Enable Banking API source documents GET /accounts/{account_id}/details returning optional all_account_ids. Stored consent resources may lack aliases. Do not derive Swedbank IBAN from domestic formatting: official transfer formats are not an IBAN algorithm.

Files: existing Sites provider adapter, a new owner-scoped current-account reader, MCP declaration/dispatch, focused adapter/reader tests. Interface: bank_account_evidence requires an owned AIS transaction and owned retained report ID/hash; account UIDs come only from active selected consent. Explicitly contacts the existing provider using existing AIS authority, never writes D1/R2/locks/financial data, and reports incomplete/error/ambiguity rather than inferring aliases. Existing payment_evidence/retained_report_evidence remain stored-only/no-network.

- [ ] RED unknown endpoint/tool, invalid/path/query/method rejection, owner/consent/app/selected/receipt/original gates before fetch; bank-supplied alias positive and missing/conflicting/mismatched account negative.
- [ ] GREEN bounded current account-details reads, exact primary selected-account identity/currency, known alias uniqueness and explicit source/time/completeness; no account resources/keys/session/full accounts in replies. Recheck consent/snapshot after reads; no stale positive result.
- [ ] Independent security/correctness review and complete gates. Call only after published discovery as part of authorized read verification. Lack of returned alias remains an external fact, never fabricated.
Final integrated review found P1 integer-money concatenation and P1 actual serialized reference contract; both are implemented with RED/GREEN by original owners. Additional full Bankgiro/org suffix acceptance was elevated to P1 under user's allfieldscope and corrected with formatted-identifier positives. Actual private native-PDF check is now being repeated through both routing/parser boundaries; source data remains outside Git. Task6 generic enlargement fixed JPEG falseBGdigit; high interpolation prevented an observedPNGregression; independent taskreview pending. No 100%universal claim is permitted.

### Task 8: Preserve native PDF text fragments

Actual private original exposed an internal decoder defect: worker/server appended a blank after every PDF text item, manufacturing spaces inside500,00 and2026. Read-only reconstruction honoring explicit native space items/hasEOL gives9/9 privately checked fields, with no issues, before any confidence promotion. Correct both extraction boundaries with synthetic actual fragmented-PDF tests and column/word/EOL controls; preserve strict monetary grouping and source bytes. Keep any necessary geometry fallback conservative; never infer column-to-label identity. Original remains private and no real processing/registration is invoked.

Task6: independent normalization review passed; measured77/77 readablefields, actualOCR55/55 and ink22/22, unreadable2/2held.12Mcap applies percanvas, peakRSS/concurrency notmeasured; performance observationnotSLA. Final integrated P1wave correctedmonetarygroups/completeBGorg/currentreferencecontract; privatelegitformattedIDs nowread when nativefragmentspacingspreserved. Task8TDDinprogress beforefinalgates.

Final implementation ledger: Tasks1–5 complete and scoped reviews passed. Task6 normalization scoped pass, all11fields readable77/77/optical55/55, controlsheld. Task7 exact live/stored membership P1 reproducedRED then fixedGREEN95, independent fixreview passed; no newUID fetched or stored on mismatch. Task8 scoped spec/quality pass; explicit/EOL/column/unknowngeometry controls and actual fragmentedPDF positives. Private actual invoice9/9 fields through both extraction/parserboundaries, PDF method/noissues/yellowcurrency; workbook12/12 unchangedbytes. Primary public register resolves differingnames tosamelegalentity. Final fullgates/publication/read-onlyproductionverification inprogress.

Delivery: code `ee3d8aa3716fc818d7703335c5aabba2b32954d5` on main; exact Actions41362005970 succeeded with clean installations,775 Node and1323 Sites tests, syntax97, TypeScript and build. Sites49 succeeded from source0444e2e13efea60150fc3917ee6c533d0c461ce6; tree5a0dd51890c431a3247d67a07f366368098a6821 equals the GitHub Sites subtree. Runtime9, policy, auth, schedules and DB/R2 declarations are preserved. Workspace revision40 and updated timestamp are unchanged.

Three published readers remain undefined in this chat while eight legacy tools remain connected. The native payload is truncated, direct unauthenticated metadata receives HTTP403/1010, and the local browser is unavailable. No identity bypass or financial write was used. A new chat refreshing the same connected plugin is the precise continuation. Account alias, report/deposit identity, missing currency evidence and the complete current register remain unverified. See COMPLETE-OCR-EVIDENCE-DELIVERY.json.
