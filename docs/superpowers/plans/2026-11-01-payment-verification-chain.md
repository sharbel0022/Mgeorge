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

## Completion audit follow-up on main 88b8584

Previous goal turn: progress, with verified main/CI/Sites46 delivery. Current main differs from verified program commit a8453a1 only in documentation. Existing 625 Node + 1111 Sites evidence is reused as the pre-change baseline because code, dependencies and environment remain applicable; it is not a new test run.

Two explicit internal requirements still need implementation before classifying the remaining work as exclusively external:

- [x] Node manual original relation: support an exact IBAN/BBAN/CPAN alias explicitly supplied by this owner's active selected unambiguous SEK account resource. Files: `src/bankgiro-links.js` and its tests. Preserve reported account, raw evidence and hashes; do not change `exact_match`, economic import or automatic allocation. RED/green cases: valid alias, absent/ambiguous alias, wrong owner/deselection and alias removed after confirmation; unchanged finances. The read-only `project()` and `public/app.js` also retain the selected report's typed/raw/cell evidence and avoid displaying AIS-only invoice suggestions beside a different selected report reference.
- [x] Sites displayed-field provenance: select payer/ref/identifier evidence from the actual linked report or detail original used for that field. Files: `sites/lib/payment-presentation.ts`, `payment-verification.ts`, dashboard and relevant tests. Expose identifier value, scheme/issuer, original raw value and field path in the existing expandable controls. RED/green cases: separate detail COID/SE, linked report whose source differs from AIS/detail metadata, unavailable/invalid original remains blocked, unchanged inputs/finances. Read-only invoice selection and the owned invoice original read follow the selected field source too: report reference0599 cannot display/read the unselected detail reference0800's invoice; actual recorded allocations are preserved and explained separately.
- [x] Independent review and local full suites: 645 Node, 1126 Sites, syntax92, type/build/audit passed. Architecture, measurements/report/progress/affected scorecard evidence updated; scores unchanged.
- [x] Safe main delivery `cda00d9`, exact green CI `41354521234` and Sites 47 succeeded with identical source trees. Read-only production verification: unchanged complete state/economic projection, revision40, five invoices, zero allocations. Policy/auth/environment9/DB-R2 declarations/tables/schedules preserved. No real invoice/source relation/allocation or economic data writes. Receipt: `docs/PAYMENT-EVIDENCE-SOURCES-PUBLICATION.json`.

The authentic 625-case still needs authoritative account/report identity and the separately approved invoice/counterparty/allocation workflow after these internal fixes. No bank identity or account conversion may be fabricated.
