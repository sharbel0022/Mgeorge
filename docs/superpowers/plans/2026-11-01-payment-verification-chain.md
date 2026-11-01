# Payment verification chain implementation plan

> **For agentic workers:** Use test-driven implementation and independent review for each responsibility. The user explicitly authorized implementation, main delivery and safe publication; do not introduce another design or publishing approval gate.

**Goal:** Explain the existing payment chain, close reproduced allocation-control gaps in Node and Sites, and expose a read-only payment verification detail without changing real balances.

**Architecture:** Keep the existing SQLite and Sites workspace engines. Current account consent is an additional allocation prerequisite, independent from retained-original integrity. A payment detail reads existing verifiers and matching previews; it never imports, registers, links or allocates.

**Tech stack:** Existing Node 22, SQLite, TypeScript/React, D1/R2, existing synthetic test harnesses and Sites project.

**Spec:** User-supplied complete payment-chain request; repository AGENTS.md, PROGRESS.md and QUALITY-SCORECARD.md. Start: fa524c2b3d06530d1b75b48df45ae14b28ab1182; previous verified code dba8f426bfe96076c269c88c096f5f4cee665484 differs only in documentation.

## Global constraints

- Preserve bank originals, bank payer/reference fields, leading zeroes, booked allocations and audit history.
- Suggestions and manually reviewed source relations cannot authorize financial allocations.
- Only exact provider-backed account identities/aliases; no inferred account conversion.
- No real invoice registration/allocation, payment, outgoing email, destructive migration, new database or Site identity.
- Run root and Sites installations, syntax/type checks, full tests, audit gates and production build from current CI scripts.
- Preserve audience, authentication, DB/R2, secrets and existing schedules on publication.
- Report synthetic evidence separately from authentic production verification; no unsupported 9.5 rating.

## Review focus

- Missing, expired, foreign, deselected or ambiguous receiving-account consent must stop new allocations.
- Parent payments and earlier payments teaching customer relations must not bypass the same prerequisite.
- Retained balances and history remain unchanged when evidence becomes unavailable.
- Missing/unread invoice originals must not be presented as verified merely because a register record exists.
- Read-only detail endpoints must authenticate the owner and perform no state writes or provider fetches.

## Tasks

1. Node allocation boundary (`src/reconciliation.js`, relevant tests): reproduce automatic allocation without a bank connection, add negative/positive current-account cases, implement minimum gate, correct contradictory paid/evidence status while retaining amounts. Update synthetic fixtures requiring valid consent; retain explicit manual-administrator semantics as a separately documented limit.
2. Sites allocation boundary (`sites/lib/reconciliation-evidence.ts`, relevant tests): reproduce zero account checks for an AIS candidate, reuse `bankgiroAutomaticAccountIssue` for candidates/lineage/learned sources, cache within request, test consent failure/recovery and unchanged persisted state. Also apply current-account validation to explicit new AIS match assertions; no retrospective money changes.
3. Payment detail (`sites/lib/payment-verification.ts`, a GET route, component and dashboard integration, tests): expose eleven explainable checks with status, used facts, source, check timestamp, rule, reason and next step. Reuse original/account/matching helpers; mark unknown evidence honestly and keep approval actions separate.
4. Documentation and measurement: create `docs/PAYMENT-VERIFICATION-ARCHITECTURE.md` with flow, decision, data and desktop/mobile diagrams; create `docs/END-TO-END-PAYMENT-VERIFICATION.md` with exact synthetic before/after evidence, mapping of all 21 scenarios, read-only 625-case findings, external blockers and continuation. Reuse existing metrics and add focused identical before/after consent corpus.
5. Independent whole-change review; resolve reproduced findings. Run all mandatory checks and relevant browser tests; no additional broad retesting after unchanged inputs unless justified.
6. Fetch main again, integrate safely, commit/push without force, check both Actions jobs on exact SHA. Confirm backup/rollback. Synchronize exact Sites subtree to existing source repository, package/deploy, verify exact version/runtime/access/schedules and read-only production state. Record actual results in progress, affected scorecard entries and publication receipt.

## Execution ledger

- [x] Read request, AGENTS, progress, scorecard and latest linked delivery evidence.
- [x] Fetch origin/main and compare previous verified code; clean start, dedicated codex branch.
- [x] Parallel Node/Sites/test inventory; allocation without current consent reproduced in both engines.
- [x] Implement and review tasks 1–3.
- [x] Complete architecture, measurements and real-case read-only assessment.
- [x] Pass mandatory checks and independent final review: 625 Node, 1111 Sites, syntax92, TS/build/audit.
- [x] Deliver main a8453a1 with exact green CI and Sites46; record unchanged revision40 and external requirements.
- [ ] External completion: authoritative receiving-account/report identity, ordinary invoice registration/counterparty review and separate administrator allocation decision. No test allocation in production.

Ruling: Continue directly under the user's detailed execution instruction. Existing engines and explicit administrative manual-allocation semantics are retained; new automatic consent bypasses are closed. Production case remains review-only until actual external evidence and separate administrator authorization exist.
