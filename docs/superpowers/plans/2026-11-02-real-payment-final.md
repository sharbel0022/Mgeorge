# Complete payment verification implementation plan

> Use superpowers:subagent-driven-development. The user explicitly selected autonomous execution and delegated routine design/implementation decisions; no intermediate approval is required.

**Goal:** Deliver every reproducible internal payment-verification correction and a truthful read-only assessment of the real case.

**Architecture:** Existing Node/Sites payment engines and original/consent boundaries. Transient owner-only account evidence; shared candidate interpretation, no new financial writes or alias persistence.

**Tech stack:** Node JavaScript, Sites TypeScript/React, D1/R2, existing Enable Banking AIS adapter and MCP OAuth.

**Spec:** ../specs/2026-11-02-real-payment-final-design.md and the user's complete Work goal.

## Global constraints

- No real invoice registration, allocation, paid-state/saldo change, bank/Gmail sync, messages, consent/secret changes or destructive migrations.
- Real bank/customer originals, identifiers, account numbers, PDFs and hashes stay outside Git; fixtures are synthetic.
- Preserve Sites project/audience/auth/DB/R2/runtime/schedules. No arbitrary identity headers, direct DB bypass or session emulation.
- Amount/date/reference select candidates; only sufficient bank evidence establishes bank identity. Manual metadata never grants automatic financial authority.

## Review focus

- Provider errors must identify the failing boundary without exposing values or relaxing acceptance.
- Same legal customer does not prove same bank deposit; missing aliases/currency remain blocked.
- Candidate reference/number conflicts and several originals cannot yield a false verified invoice.
- Current account result is separate from stored consent; stale/error/incomplete/ambiguous results cannot promote stored evidence or mutate data.
- Two evidence rows must not be counted as two economic deposits; native UI must not contradict intact unregistered originals.

### Task1: Safe current-account diagnostics

Files: sites/lib/banking/enable-banking.ts, account-evidence.ts, focused provider/reader tests.
Interface: existing getSession/getAccountDetails return contract unchanged; readBankAccountEvidence adds fixed stage and sanitized validation issue/type only.

- [x] RED: session vs first-account schema failures distinguishable; null optional, missing required, wrong type, arbitrary error text/IDs cannot leak.
- [x] GREEN: fixed enum diagnostics, attempted/completed read counts, unchanged rejection/ownership/snapshot/no-write behavior.
- [ ] Focused tests/TS/full Sites, independent security review; publish exact tested code, one owned live retry to establish actual failure.

### Task2: Consistent invoice candidates and original status

Files: sites/lib/banking/invoice-candidates.ts, payment-verification.ts, evidence-read.ts and related tests; shared contracts only where necessary.
Interface: one candidate-field interpretation for number/reference/legacy OCR, explicit source/conflict; existing read preview remains no-fetch/no-write. Add per-payment `countedEconomically` from the existing `economicTransactions(state)` membership so a separate review observation cannot appear to be a second deposit. No new financial classification rule or aggregate relationship inference.

- [x] RED: intact unregistered original says original present and registration absent; exact extracted reference with differing invoice number appears consistently; conflicts/multiple originals remain review and no financial writes. AIS plus review report exposes true/false economic membership respectively; ignored, duplicate and parent-summary records agree with the existing engine.
- [x] GREEN: minimally share candidate identifiers and correct factual wording; preserve stored extraction precedence, leading zeros and source separation.
- [x] Focused suites/TS and independent review.

### Task3: Explicit account-check UI

Files: create sites/app/api/bank/account-evidence/route.ts; update sites/lib/payment-verification.ts, components/payment-verification.tsx and existing candidate presentation/dashboard; add focused route/component tests and one small pure presentation module if useful.
Interface: POST /api/bank/account-evidence uses identity(req), strict same-origin JSON/body limits and the existing readBankAccountEvidence({transactionId,documentId}); never accepts owner/account/credentials. The stored verification GET exposes an optional accountEvidenceTarget only for AIS plus one unambiguous report original; server revalidates it. Panel opening stays stored-only. Explicit button results remain transient and separate from stored consent/original/relationship. Positive display requires exact returned transaction/document IDs, current revision, snapshotCurrent/complete/accountMatch strictly true and matched status. Clear/abort on transaction/revision/demo changes, reject late responses and malformed payloads. Result source/time/completeness/reason and next action remain visible.

- [x] RED: malformed/error/stale/mismatch/incomplete/ambiguous responses show unknown/blocked, no alias promotion, no state writes; only explicit action contacts provider.
- [x] GREEN: reuse existing reader and panel, one necessary action, masked data, current revision invalidation; no new matching engine or persisted alias.
- [x] Show countedEconomically as evidence-row versus economic record, keep deposit A/B/C distinctions, and title the control from the actual unique invoice number/hint with proposal wording where needed. Use shared candidate identifiers so an extracted-reference candidate is not lost from the existing dashboard. No hard-coded real invoice/customer data.
- [ ] 1440/390px real-component synthetic QA, keyboard/focus/overflow; independent review.

### Task4: Actual provider discrepancy and private recheck

- [x] Use Task1 live stage/schema evidence before defining any compatibility fix. Add actual shape as synthetic RED regression and retain malformed-value rejection. Independent review and repeat owned read after publication.
- [x] Reread private supplied workbook and invoice via authorized sources; recheck identity/source/amount/date/currency and complete current register. No real registration or relation creation.
- [x] Identify A bank / B manual / C candidate relation; current missing evidence stays blocked. Verify economic-count assertions using real readers and synthetic state; no fabricated full-state comparison.

### Task5: Full gates and delivery

- [x] Inspect existing moderate dependency findings; apply only justified compatible fixes, otherwise disclose exact residual scope.
- [x] Fresh clean-install baseline and final Node/Sites/syntax/TS/audits/build, meaningful before/after measurements, scoped/final independent review. Fix findings with RED/GREEN.
- [x] Write docs/REAL-PAYMENT-0599-FINAL-REPORT.md (sanitized), update PROGRESS/QUALITY-SCORECARD with measured evidence and honest scores. No numerical target inflation.
- [x] Fetch/integrate latest main, nonforce push and verify exact CI. Check backup and saved rollback, build/publish matching Sites source and preserve runtime/policy/schedules/DB/R2.
- [x] Read-only production recheck, attempted owner UI verification, delivery receipt with exact source/version/CI and precise external actions. No claims of background work or completed payment.

## Inventory ledger

Fresh main31aa90a; open PR9/10 are older independent work and will not be merged implicitly. Sites49/runtime9/audience/auth/schedules unchanged. Bank/backup schedules enabled, Gmail schedule paused and fetch stale. Backup manifest195/195 verified,112 older API records lack receipts in that backup scope. Current workspace revision41. Three evidence tools work; current target invoice absent with complete register result; bank report/receipt integrity pass. Live current-account reader returns INVALID_PROVIDER_RESPONSE/resourcesRead0; bounded diagnostic needed before a fix. New isolated worktree codex/real-payment-final; dependencies reinstalling after scratch reset.

Task1 scoped review passed after accessor-disclosure RED/GREEN fix: commits5f8f4df/677f48c. Fixed enum diagnostics do not relax null acceptance; live diagnosis follows exact tested publication. Task1 fullSites1328 before lastfix, focused57 and TS afterfix; controller finalfullgates recorded separately. No financial writes.

Finala kodgrindar efter en samlad fixvåg: Sites1381/1381, TypeScript, syntax98, rent produktionsbygge. Avgränsad13-fallskorpus5/13→13/13 med13/13 oförändrade tillstånd på båda sidor. QA-source/stale chunks borttagna;347 färska dist-filer utan QA-referens. Browserpixel/inloggad UI blockerad och explicit ej passerad. Alla scoped reviews passerar; slutlig fixvågsrereview godkänner. Levererat main991214e, exakt CI41432323395 success, Sites51 success med identiskt källträd/runtime9. Ägarbunden efterkontroll revision41, konto2/2 komplett/missing, ägt fakturaoriginal byteidentiskt med Gmail, komplett register0träffar, AIS ekonomisk1/rapport0,0allokeringar och valda ekonomiska fält oförändrade. Privat registreringsförslag förberett ej insänt. [Leveranskvitto](../../REAL-PAYMENT-0599-DELIVERY.json). Browser-QA blockerad och ej passerad. Ingen riktig ekonomisk skrivning.
