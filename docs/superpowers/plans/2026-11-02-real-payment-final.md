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
Interface: one candidate-field interpretation for number/reference/legacy OCR, explicit source/conflict; existing read preview remains no-fetch/no-write.

- [ ] RED: intact unregistered original says original present and registration absent; exact extracted reference with differing invoice number appears consistently; conflicts/multiple originals remain review and no financial writes.
- [ ] GREEN: minimally share candidate identifiers and correct factual wording; preserve stored extraction precedence, leading zeros and source separation.
- [ ] Focused suites/TS and independent review.

### Task3: Explicit account-check UI

Files: existing owner bank read route, existing payment verification component/dashboard, focused route/component tests.
Interface: explicit read-only request invokes readBankAccountEvidence with an owned transaction/report; panel opening stays stored-only. Result source/time/completeness/reason remain visible separately.

- [ ] RED: malformed/error/stale/mismatch/incomplete/ambiguous responses show unknown/blocked, no alias promotion, no state writes; only explicit action contacts provider.
- [ ] GREEN: reuse existing reader and panel, one necessary action, masked data, current revision invalidation; no new matching engine or persisted alias.
- [ ] 1440/390px real-component synthetic QA, keyboard/focus/overflow; independent review.

### Task4: Actual provider discrepancy and private recheck

- [ ] Use Task1 live stage/schema evidence before defining any compatibility fix. Add actual shape as synthetic RED regression and retain malformed-value rejection. Independent review and repeat owned read after publication.
- [ ] Reread private supplied workbook and invoice via authorized sources; recheck identity/source/amount/date/currency and complete current register. No real registration or relation creation.
- [ ] Identify A bank / B manual / C candidate relation; current missing evidence stays blocked. Verify economic-count assertions using real readers and synthetic state; no fabricated full-state comparison.

### Task5: Full gates and delivery

- [ ] Inspect existing moderate dependency findings; apply only justified compatible fixes, otherwise disclose exact residual scope.
- [ ] Fresh clean-install baseline and final Node/Sites/syntax/TS/audits/build, meaningful before/after measurements, scoped/final independent review. Fix findings with RED/GREEN.
- [ ] Write docs/REAL-PAYMENT-0599-FINAL-REPORT.md (sanitized), update PROGRESS/QUALITY-SCORECARD with measured evidence and honest scores. No numerical target inflation.
- [ ] Fetch/integrate latest main, nonforce push and verify exact CI. Check backup and saved rollback, build/publish matching Sites source and preserve runtime/policy/schedules/DB/R2.
- [ ] Read-only production recheck, attempted owner UI verification, delivery receipt with exact source/version/CI and precise external actions. No claims of background work or completed payment.

## Inventory ledger

Fresh main31aa90a; open PR9/10 are older independent work and will not be merged implicitly. Sites49/runtime9/audience/auth/schedules unchanged. Bank/backup schedules enabled, Gmail schedule paused and fetch stale. Backup manifest195/195 verified,112 older API records lack receipts in that backup scope. Current workspace revision41. Three evidence tools work; current target invoice absent with complete register result; bank report/receipt integrity pass. Live current-account reader returns INVALID_PROVIDER_RESPONSE/resourcesRead0; bounded diagnostic needed before a fix. New isolated worktree codex/real-payment-final; dependencies reinstalling after scratch reset.

Task1 scoped review passed after accessor-disclosure RED/GREEN fix: commits5f8f4df/677f48c. Fixed enum diagnostics do not relax null acceptance; live diagnosis follows exact tested publication. Task1 fullSites1328 before lastfix, focused57 and TS afterfix; controller finalfullgates recorded separately. No financial writes.
