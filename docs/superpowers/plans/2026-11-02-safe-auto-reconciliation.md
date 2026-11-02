# Safe auto reconciliation implementation plan

> **For agentic workers:** Use superpowers:executing-plans with test-first implementation and a fresh final code review. The user authorized continuous implementation, branch push and PR; merge and real financial actions are excluded.

**Goal:** Deliver a shared versioned safe reconciliation preview, adapters and regression evidence.

**Architecture:** A pure common contract inventories canonical bank observations and proposes allocations without writes. Node and Sites adapters retain their original/account proof boundaries. A separate pure approval validator detects stale or altered reviews while existing writers retain all transaction/CAS fences.

**Tech Stack:** Existing Node ES modules, TypeScript Sites, node:test, SQLite/D1 test harnesses; no added dependencies or migrations.

**Spec:** `docs/integration/reconciliation-contract.md`.

## Global constraints

- Branch `feature/mgeorge-safe-auto-reconciliation`; PR to main, no merge/publication.
- Exact string references preserve leading zeros; no invented OCR, payer, account alias or provider API.
- Synthetic test records only. No real economic writes, bank calls, messages or invoice registration.
- VERIFIED / REVIEW / BLOCKED evidence is separate from approval; all new APIs are read-only.

## Review focus

- Competing records or revoked relationships invalidate an otherwise unchanged selected pair.
- Manual verification cannot hide conflicting original payer/reference evidence.
- Pending and exhausted transactions must remain visible when old matchers return no findings.
- Report child/aggregate duplication and absent/cyclic parent lineage fail closed.
- Malformed money and overflowing sums cannot be clamped into valid proposals.

## Task 1: Shared contract and approval validation

Files: `sites/lib/reconciliation-contract.js`, `.d.ts`; shared synthetic corpus and Node/Sites wrappers.

- [x] Write and run failing behavior tests for exact full matching, zeros, source/account conflicts, payer relationships, report identity/counts, partial/excess/splits, duplicates, reversals, malformed amounts and stale approval.
- [x] Implement `buildReconciliationPreview(input)` and `validateReconciliationApproval(preview, approval, context)` with the specified shapes.
- [x] Run shared tests in both runtimes and record results.

## Task 2: Trusted read-only adapters and GET routes

Files: `src/reconciliation-preview.js`, `src/server.js`; `sites/lib/reconciliation-preview.ts`, `sites/app/api/reconciliation/preview/route.ts`; adapter tests.

- [x] Write failing adapter/route tests using actual SQLite and existing Sites loader fixtures; compare all state/audit/original rows before and after.
- [x] Consume existing parser/account checks without changing the shared import/reference interfaces.
- [x] Preserve blocked observations and manual relationship status; bind full authoritative context in snapshot.
- [x] Verify synthetic direct/report cases, owner isolation, missing source/consent, and denied provider/mutation paths.

## Task 3: Verification and integration delivery

- [x] Run root syntax, complete Node/Sites suites, Sites types/build, and required audits.
- [x] Run existing concurrency/consent/rollback tests with real synthetic persistence.
- [x] Fresh independent review; reproduce and fix material findings with regressions.
- [x] Recheck origin/main and report conflicts rather than overwrite parallel work.
- [x] Record exact results and remaining real-bank blockers; prepare the tested feature commit. The final commit SHA and PR number are recorded in GitHub delivery metadata.

## Execution ledger

- Start: base `73662187cddf9a5c504dea9bd8a1288bd929bc51`; user supplied explicit scope and autonomous execution authorization.
- Workspace: isolated full clone; no existing work modified. Dependencies installed using allowed network execution after the sandbox-only proxy failed.
- Design decision: partial/excess/split proposals remain REVIEW in the new v1 surface; existing allocation engine behavior is retained.
- Independent review: five P2 findings reproduced and fixed (dependent duplicate identities, closed parent/report membership, elapsed evidence expiry, original CAMT count, standalone credit-settlement normalization).
- Released contract update: fast-forwarded documentation-only main to `b65273500c214a4e16b880e3840dac90d8bd7401`; removed company-name policy inference and preserved contradictory explicit references. GET policy wiring awaits reviewed C1; no unreviewed storage/export was guessed.
- Frozen focused tests: shared 42 cases per runtime plus 9 integrity cases (93 pass); Node adapter 21 pass; Sites adapter 20 pass; no failed/skipped cases. Sites typecheck, 125-file root syntax and exact minimatch mitigation pass. Root/Sites production audit 0; full Sites audit 16 moderate, 0 high/critical.
- Read-only real case: exact selected reads and retained original current/unchanged at revision43 on 2026-11-02 21:53 UTC; account/deposit proof missing, registered exact invoice count0, allocations0. Broad reference search separately incomplete. No real original is committed or used as a mutable fixture.
- Final named-case Node22 gates: 1381 Node +2399 Sites =3780 pass, zero fail/skip/cancel/todo; syntax125, types, exact mitigation, production build and high-audit gates pass. The full Sites count includes six new acceptance cases after a documentation/test-only fast-forward to `a779b0dd8d184eaf6e6d6e636c555c967f15f3d5`; all previously checked runtime inputs were unchanged.
- Local harness limits were resolved without repository changes: a 240-second PDF/OCR interruption was rerun to 284/284 passing cases with a 600-second limit; the npm lifecycle-entrypoint fixture passed12/12 after supplying the actual npm executable context. Earlier interrupted attempts and wrapper-only reports are not counted. See the full [delivery receipt](../../integration/agent-4-safe-auto-reconciliation.md).
- Publication boundary: only the named feature branch and PR are authorized here. GitHub's final commit/PR metadata is the immutable delivery identifier; the integration lead owns merge and any later Sites publication.
