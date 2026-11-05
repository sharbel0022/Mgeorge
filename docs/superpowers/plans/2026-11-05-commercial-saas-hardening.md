# Commercial SaaS Hardening Implementation Plan

> **For agentic workers:** Use the existing development and verification workflow to implement and review each task. Steps use checkbox syntax for tracking.

**Goal:** Close reproducible tenant-boundary and consent-recovery gaps in the integrated SaaS code and deliver a verified PR.

**Architecture:** Retain the authoritative company catalog, SQLite partitions, D1/R2 boundaries and shared provider lifecycle. Enforce live authority at asynchronous boundaries and keep ambiguous remote operations blocked with recoverable state.

**Tech Stack:** Node.js, SQLite, TypeScript/React, Cloudflare D1/R2, existing Open Payments adapter.

**Spec:** `docs/superpowers/specs/2026-11-05-commercial-saas-hardening-design.md`

## Global Constraints

- Branch `feature/95-saas`, PR against `main`; no production changes or real consents.
- Preserve original files and financial evidence. Synthetic data only in tests and repository evidence.
- Do not invent provider identity, BankID completion, legal authority or bank references.
- Keep the existing four-role contract and company storage identities.
- No dependency upgrades or parallel replacement tenant model.

## Review Focus

- Removed membership or company switch during a read must not release private data after authority changes.
- Cancelled/failed authorisation must not lose a known remote consent on restart; ambiguous deletion blocks replacement.
- Privileged control-plane operations must revalidate session and actor authority after asynchronous input.
- Two companies at the same bank must retain independent account and job state, including identical provider resource identifiers.
- Migration/restart must preserve legacy records and original bytes without silently adopting them into a new company.

### Task 1: Node boundary audit and regression repairs

**Files:** `src/company-runtime.js`, `src/server.js`, relevant Node storage/auth modules and `test/` regression files.

**Interfaces:** Consume the existing `assertCompanyContext`, company runtime and HTTP/session APIs. Preserve all public paths and storage schemas unless a reproduced defect requires an additive change.

- [x] Trace API permission selection, async session checks, membership updates, originals and background dispatch.
- [x] Reproduce the census findings: viewer status/export denied by incidental writes, and a live central login incorrectly reported as lost by the status handler. No new cross-tenant read/write bypass was reproduced.
- [x] Repair the read-role contract with a pure status projection and fixed-purpose export audit capability; add six actual HTTP regressions. Run existing real HTTP/SQLite company, migration and durable-job acceptance tests.
- [x] Record audited behaviour and the single-administrator public identity limitation.

### Task 2: Sites boundary audit and regression repairs

**Files:** `sites/lib/company-server.ts`, `sites/lib/company-storage.js`, `sites/lib/server.ts`, API/original handlers and `sites/tests/` regression files as findings require.

**Interfaces:** Keep authoritative `CompanyContext`, `RequestDb` and current-context guards; public clients cannot choose a storage owner.

- [x] Trace all API route families and owner/object access through company context and current permissions; after integrating concurrent main `bf24a3c`, record all 42 API files plus MCP and the new legacy-only revalidation path.
- [x] Assess concrete findings: no new Sites boundary bypass was reproduced; lifecycle findings are handled in Task 3.
- [x] Run existing D1/R2/route and migration acceptance tests without speculative boundary rewrites.
- [x] Verify existing stale-membership/company-selection and late-response guards through source review and acceptance tests.

### Task 3: Shared bank lifecycle recovery

**Files:** `sites/lib/banking/openpayments-lifecycle.js`, `sites/lib/banking/saas-bank-runtime.js`, `sites/tests/openpayments-lifecycle-recovery.test.mjs` and runtime tests.

**Interfaces:** Preserve `createOpenPaymentsLifecycle(options)` and `createSaasBankRuntime(options)` operations, encrypted handles, expected revisions and idempotency keys.

- [x] Reproduce failed/cancelled replacement losing a known consent using actual provider code and synthetic HTTP transport.
- [x] Preserve the old resource until confirmed DELETE; keep ambiguous revocation pending and prevent a second creation.
- [x] Expose appropriate recovery actions for interrupted/expired authorisations without treating callback/clock state as bank approval; block unknown creation outcomes.
- [x] Test same-key retries, concurrent attempts, revoked authority and separate companies using the same bank.

### Task 4: Migration, commercial documentation and final verification

**Files:** additive regression/migration tests where needed; `docs/saas/COMMERCIAL-LAUNCH-REQUIREMENTS.md`, delivery report, `PROGRESS.md`, `QUALITY-SCORECARD.md`.

**Interfaces:** Existing migrations, backup census, company scheduler and launch feature gates remain authoritative.

- [x] Verify migrated synthetic legacy data and immutable boundaries, including restart and original hashes.
- [x] Write sourced conditional requirements for providers, permissions, GDPR, financial regulation and operations.
- [x] Run root syntax/tests/audit, Sites types/tests/audit/build/mitigation check and bridge syntax/tests/audit: 1,905 Node + 3,769 Sites + 47 bridge = 5,721 passed, no failures/skips/cancellations/TODO. Source fingerprints and earlier failed environment attempts are preserved in the verification receipt.
- [x] Independently review the changed application/test diff and audit both tenant architectures; repair the one Important browser-recovery finding with an actual client-contract regression. The final expanded targeted suite passes 60 tests.
- [x] Commit and publish only the requested branch and open [PR #50 against main](https://github.com/sharbel0022/Mgeorge/pull/50). The uploaded Git tree is checked against the local tree. Integrate concurrent main `bf24a3c` on this branch and distinguish its combined-code checks from the earlier complete local suites; exact final CI is linked from the PR. Commercial launch remains blocked by the documented external requirements.
