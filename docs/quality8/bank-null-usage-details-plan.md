# Selected account usage details implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. Root has approved the design and autonomous execution; no further user approval is required for local implementation/tests.

**Goal:** Observe current usage for at most five already selected null-usage accounts while retaining the original 409 denial.

**Architecture:** Extend the existing pure consent-policy error provenance with an immutable input-bound diagnostic read plan. The existing revalidation service alone consumes that plan under its retained owner/lease/context guards and serializes only completed, privately bound aggregate observations.

**Tech Stack:** Existing JavaScript/TypeScript, Node 24, D1 fixtures and HTTP MCP. No dependency changes.

**Spec:** [Approved design](bank-null-usage-details-design.md), frozen `23b4d71ae21d745471ac60c82e8b081f25731cb9`, baseline `41aadcef5fc6f65cc73979997b195c7b4f12eec1`.

## Global constraints

- `validateEnableConsent`, `businessAccountData` and account-evidence `active()` remain byte-identical.
- Never synthesize ORGA, delete null, activate the connection, update the account cache, extend consent, or change financial rows.
- Use only original error provenance and the exact original input; public fields and foreign errors cannot authorize reads.
- Full inventory and all selected primary hashes must pass before any details read; only selected saved-null targets, at most five, may be read.
- Recheck complete owner/application/connection context and deadlines before and after every outbound read; preserve persistent cooldown and lease behavior.
- All implementation tests are synthetic and isolated. Root owns full CI, release and the sole real follow-up.

## Review focus

- A genuine error replayed with another input, or mutated input after validation, must not yield a read plan.
- A later selected account's missing/conflicting primary hash must prevent the first details call.
- Five targets are complete; six cause zero reads, not a partially reported census.
- Concurrent changes after the last response but before failed-audit must suppress diagnostics.
- Fresh ORGA or a partial successful batch must never clear the original usage denial or persistent uncertainty.

## Task 1: Freeze policy and transport negatives

**Files:** new `sites/tests/bank-usage-details-policy.test.mjs`; append focused cases to `sites/tests/banking-security.test.mjs` and `sites/tests/bank-account-evidence.test.mjs`.

**Interfaces:** `planAccountUsageDetailsRead(error, input, now?)` returns a privately branded frozen plan or fixed `not_read` result; `observeAccountUsageDetails(plan, uid, details)` returns one fixed usage category or a fixed denial, never raw values.

- [x] Write the approved inventory, usage, scope, hash, input-binding, limit and response-conflict cases before product edits.
- [x] Write real service/MCP cases for one/five/over-limit reads, original 409 preservation, foreign error, context changes, cooldown and audit failure.
- [x] Add the existing account-evidence negative for reauth_required with an otherwise ORGA mock response.
- [x] Run and hash the frozen RED population. Distinguish missing feature failures from incorrect test assumptions before product edits.

## Task 2: Implement pure read planning and observation

**Files:** `sites/lib/bank-consent-policy.js`, `sites/lib/bank-consent-policy.d.ts`.

- [x] Retain a bounded immutable JSON-data snapshot for eligible genuine usage errors, privately bound to the exact input object. Reject accessors, unsupported data or changed input for diagnostic purposes without replacing the original policy denial.
- [x] Implement `planAccountUsageDetailsRead(error, input, now = Date.now())` using the original proven frame and all remaining scope/hash/deadline checks. Return only selected saved-null targets after all selected hashes pass; over five yields no plan.
- [x] Implement `observeAccountUsageDetails(plan, uid, details)` with private plan provenance, exact primary-hash/UID checks and explicit primary identifier/currency conflict holds. Return only a closed category/reason.
- [x] Run policy RED cases to GREEN and verify the unchanged strict validator/business predicate against baseline.

## Task 3: Consume the plan only in revalidation

**Files:** `sites/lib/banking/service.ts`; fixture mappings in `sites/tests/banking-security.test.mjs` as required.

- [x] Name the original consent input once; use exactly that object for existing validation and diagnostic planning inside its own catch.
- [x] Read targets sequentially with the existing `getAccountDetails` adapter and strict `guardedBankRead`, under a diagnostic lease that fences the immutable owner/app/connection context and effective deadline on each assertion/write.
- [x] Stop on the first provider, context or identity failure. Publish aggregate categories only for a complete matching target set and an intact final context/failed-audit.
- [x] Preserve the original thrown ConsentError and existing safe usage diagnostic. Bind new `usageDetailsDiagnostic` through a separate private map and exact code/status/reason gates.
- [x] Run the frozen real service/MCP negatives and positives to GREEN. Confirm no new endpoint, arbitrary selector, cache mutation or success activation.

## Task 4: Evidence and handoff

- [x] Run focused policy, Node/Sites consent adapter, account-evidence, revalidation/MCP and provider/cooldown regressions with the existing isolation preloader; run Sites typecheck.
- [x] Compare unchanged predicate/function bytes and prior decision matrices; preserve all original assertions.
- [x] Record exact RED/GREEN population, runtime, hashes and remaining uncertainty in `docs/quality8/bank-null-usage-details-evidence.{md,json}`.
- [x] Commit locally and send root the exact SHA for independent review. Do not contact a real bank or publish.
