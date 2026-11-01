# Bankgiro original verification implementation plan

> For agentic workers: use Superpowers TDD and independent review. Execute under the user's existing autonomous implementation, main-push and Sites-publication authorization.

**Goal:** Compare the private supplied bank report with retained AIS and invoice evidence without changing financial records, and correct proven evidence defects.

**Architecture:** Reuse the shared XLSX parser, both existing applications and read-only original inspection. A report observation, account alias, manual source association and invoice allocation remain separate. Keep operational SEK compatibility while recording whether the original actually states currency.

**Tech stack:** Node, TypeScript, SheetJS, SQLite, Sites D1/R2.

**Spec:** Current user request; AGENTS.md; docs/PAYMENT-VERIFICATION-ACCEPTANCE.md.

## Global constraints

- No real financial writes, allocations, imports or paid-state changes.
- Never publish originals, original hashes, real accounts, payer identities or private document identifiers in Git.
- Preserve existing Sites identity, audience, secrets, storage and schedules.

## Review focus

- Unknown or ambiguous provider account aliases must stay blocked across all resources.
- Generic report date must not claim a booking, settlement or value date.
- Absent currency must not become explicit currency evidence.
- Existing XLSX observations without new evidence must remain reviewable and cannot gain stronger link rights.
- Complete sums and matching references must not create financial records.

### Task 1: Account alias validation

Files: sites/lib/bankgiro-service.ts; sites/tests/bankgiro-retained-preview.test.mjs.

- [x] Reproduce unknown-scheme and cross-resource alias ambiguity with synthetic provider resources.
- [x] Require typed identifiers and uniqueness across every resource before selection/currency checks.
- [x] Run retained-preview/API tests; 42 passed, full pre-integration Sites 1138 passed and TypeScript passed.

### Task 2: Honest XLSX currency and date evidence

Files: sites/lib/bankgiro-xlsx.js; sites/lib/domain.ts; src/importers.js; src/bankgiro-links.js; synthetic fixture and relevant tests.

- [x] Add failing parser and both-app link tests for missing currency and generic report date.
- [x] Preserve reportDate/dateKind and currencySource; optional explicitly labelled Valuta may supply SEK, with cell provenance. Missing currency blocks new source links.
- [x] Make positive manual-link synthetic fixtures explicitly state currency, retaining the original-layout fixture without currency for negative cases.
- [x] Run targeted suites and full Node/Sites, syntax, typecheck, audits and production build.

### Task 3: Private evidence and delivery

- [x] Read original directly and hash without modifying it; compare retained AIS/report/invoice originals through authorized read-only surfaces.
- [x] Report observed facts and exact blockers, including any unavailable authenticated access.
- [x] Independent review of integrated diff; fix important findings with red/green tests.
- [ ] Update progress and affected quality scores with bounded claims; push exact main state and publish existing Sites; verify receipts.

Execution evidence: 646/646 Node; 1142/1142 Sites; syntax92; TS/build passed; root/prod Sites audits0; Sites full16 moderate/0 high/critical. Final independent review: no important findings. Current full AIS/account-resource/register read remains explicitly blocked; no financial writes.
