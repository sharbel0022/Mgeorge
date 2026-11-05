# Manual multiple-invoice allocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Approve a complete explicit manual invoice allocation vector atomically in Node and Sites.

**Architecture:** A shared pure manual policy consumes trusted source projections and the unchanged read-only C4 assessment. Separate server review/commit adapters bind the exact vector to current evidence. Existing SQLite and D1 transactions atomically persist money, audit and durable replay receipt.

**Tech Stack:** Existing JavaScript/TypeScript, Node 24 SQLite, Cloudflare D1/R2, vanilla Node UI and React Sites UI. No dependency changes.

**Spec:** `docs/quality8/manual-multiple-design.md`

## Global Constraints

- Two to twenty distinct invoices; exact complete preserved reference coverage.
- All amounts are positive safe-integer minor units; no amount exceeds availability/debt.
- Leave payment remainder or invoice remainder, never both in this operation.
- C4 automatic approval, single-invoice policy and bank payer evidence remain unchanged.
- No production financial execution, customer data, dependency or scorecard changes.

## Review Focus

- An old receipt remains readable after consent revocation; changed request payload cannot reuse it.
- A closed/held original reference owner still blocks ambiguous ownership.
- Half-write/audit/fence failures must leave no partial money or receipt.
- A UI edit after review must require a new complete quote.
- R2 byte verification is distinct from atomic D1 metadata fencing.

### Task 1: Shared manual policy and binding

**Files:** new `sites/lib/manual-multiple-allocation.js`, shared `test/helpers/manual-multiple-allocation-cases.mjs`, Node/Sites test entrypoints.

**Interfaces:** `manualMultipleCandidates(input, preview, transactionId)`, `manualMultiplePlan(input, preview, request)`, `manualMultipleBinding(input, plan)` and strict request parsing.

- [x] Add failing positive/negative contract cases, including 30,001+43,099 and 10,001+20,002+43,097 minor units.
- [x] Run isolated tests and retain RED output (64 absent-contract failures).
- [x] Implement complete reference coverage, evidence restrictions, exact vector validation and deterministic binding.
- [x] Run the shared Node/Sites cases: 64/64; unchanged C4 suites included: 170/170 total. Commit the independently testable policy.

### Task 2: Trusted source reads and atomic server commits

**Files:** `src/reconciliation-preview.js`, new `src/manual-multiple-allocation.js`, `src/server.js`; `sites/lib/reconciliation-preview.ts`, new `sites/lib/manual-multiple-allocation-service.ts`, new `sites/app/api/manual-allocations/route.ts` and `preview/route.ts`; dedicated Node/Sites integration tests.

**Interfaces:** GET discovery, POST `/api/manual-allocations/preview` returns a bound quote; POST `/api/manual-allocations` consumes confirmation/request ID/quote/exact vector and returns a durable manual receipt. GET by request ID returns the owned historical receipt.

- [x] Add missing-route, stale-snapshot, original/consent/census, concurrency, rollback and replay regressions before implementing writes (Node 15 missing-route failures; Sites 16).
- [x] Reuse fresh trusted source projections; verify every referenced invoice original.
- [x] Implement synchronous final Node transaction and one fenced Sites batch/CAS with persistent audit receipt.
- [x] Prove identical replay, changed-intent conflict, lost response recovery, revocation and half-failure rollback on real synthetic SQLite fixtures. Node 21 + Sites 19 API cases; 120/120 with existing Sites preview/C4. TypeScript passes.
- [x] Commit and hand frozen commit to recovery for independent attacks. UI remains a separate delivery gate.

### Task 3: Explicit review and approval UI

**Files:** new `sites/components/manual-multiple-allocation.tsx`, `sites/app/dashboard.tsx`, Node `public/app.js` plus a small public manual-review controller if needed; focused UI tests.

**Interfaces:** Existing transaction/proposal context opens discovery; editable rows lead to immutable server quote and explicit final approval; completion reloads owned state and displays manual receipt.

- [x] Add failing UI tests for entry, all rows/rest, required confirmation, quote invalidation and no automatic write. Missing shared/UI modules and five actual Node UI cases first failed; the old repeat-one-invoice advice was directly asserted.
- [x] Implement both entrypoints and visible manual provenance without changing C4 status. Exact immutable approval, original links and historical receipts are available in the existing bank details.
- [x] Test Node/Sites parity and invalid/lost responses; run focused type/syntax checks. 156/156 combined implementation cases, 103/103 overlapping UI/regression cases; TypeScript and shipped JavaScript syntax pass on 98fb9a1.
- [ ] Resolve independent review findings, document evidence/limits and commit.

Independent adapter review reproduced unclassified HTTP 400 after a committed
Sites batch and temporarily absent receipt. Follow-up 798f878 has two RED→GREEN
regressions and explicit 503 outcome-unknown classification. The shared browser
flow additionally preserves its exact request after unclassified 400/500/503 and
subsequent receipt 404. Final core/UI review remains a separate release gate.

Independent UI review then caught two Important defects before publication:
the client rejected actual Node SHA-256 revisions, and a late old controller
could erase a newer pending recovery record. Actual API-to-client regressions
and old/new-controller ownership regressions failed before the narrow fix.
The follow-up accepts only canonical hash or safe integer revisions, retains
strict quote equality and permits cleanup only for an active controller's exact
owned pending record. Its 14 new cases pass; the combined focused suite is now
170/170, with TypeScript and classic-adapter parity passing. Independent review
of the follow-up commit remains required; the earlier 156-case suite alone did
not prove the real Node UI integration.
