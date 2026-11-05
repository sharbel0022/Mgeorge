# Real bank connection implementation plan

> **For agentic workers:** Execute the scoped tasks with test-first repairs, independent review and whole-branch verification. The user has explicitly requested autonomous implementation and a PR; no design handoff or production activation is required.

**Goal:** Harden the existing Swedbank/Enable Banking and Open Payments read-only connection paths without manufacturing a live bank success.

**Architecture:** Retain the existing owner/company authorization, durable consent lifecycle, account fences, scheduler, original capture and transactional imports. Repair provider boundaries and reconnection configuration, add allowlisted diagnostic detail, and preserve fail-closed handling. No parallel bank implementation or new payment capability.

**Tech stack:** Existing Node ESM/SQLite and Sites TypeScript/D1/R2; current locked dependencies and built-in test runners.

**Spec:** User's AGENT 1 request, repository `AGENTS.md`, current `docs/SAAS-MULTITENANT-BANKID-FINAL-REPORT.md` and the dated bank incident receipt.

## Constraints

- Branch `feature/95-bank`; baseline `4ad205b84d1852ec7ed33cabd70fdadbe2f9d5c5`; PR to main, never push main.
- No real provider account/transaction calls without valid consent; no payments, no status resets, no production data changes or deployment.
- Synthetic tests only. Never commit customer records, account identifiers, credentials, tokens or raw provider errors.
- Preserve backward compatibility, selected-account consent checks, corporate evidence, owner/company isolation and persistent quotas.
- A future stored expiry is not current authorization. Unknown provider outcomes and missing evidence stay blocked.
- Production readiness score remains limited until actual credentials/certificates/agreements, signing and provider acceptance are verified.

## Evidence and design decisions

Read-only status returned connected=false, last success 2026-11-05T08:05:14.646Z and last attempt 14:04:35.832Z. Existing main records BANK_ACCOUNT_SCOPE_INVALID and reauth_required; the exact live account predicate was not retained. PR43 already fixed a reproducible legacy selected-account compatibility regression and must be preserved.

The Sites callback is hardcoded to the prior site host. Use server-owned validated configuration and the provider's current registration, never request Host/Origin as authority. Retain the exact redirect URI in each flow.

Ruling: enhance existing provider modules rather than replace them; the current implementation already supplies the transaction/authorization fences and a replacement would risk established evidence semantics.
Ruling: parallel tasks have explicit non-overlapping file ownership; root integrates shared policy/status changes after the service owner hands back its files.

Integration update: during final verification, main advanced through PR #48 to `bf24a3c52ffc637d1e7bbc4d4f64a1732dcd9fee`. Merge its existing changes without editing unrelated areas. Reconcile its callback UI and explicit legacy-consent revalidation with strict callback configuration, truthful health and current authorization guards. Re-run affected tests and full CI against the merged application code; earlier counts remain historical evidence for their original source only.

## Review focus

- Changed callback host and in-flight old flow: exact stored redirect, same origin, trusted configuration; no token exchange on mismatch.
- Expiry/revocation/company membership change during asynchronous operations: reject further reads and commits; preserve historical successful runs.
- Provider malformed pagination, duplicate IDs and ambiguous mutation responses: bounded failure with no partial success or automatic code replay.
- Account inventory differences: preserve strict new-consent validation and narrow legacy selection compatibility; do not infer account identity.
- Hostile provider errors or error properties: allowlisted codes/details and canonical messages only, with no raw values in logs/status.

## Tasks

### 1. Inventory and official documentation
- [x] Map Node/Sites bank lifecycle, provider, account selection, sync and diagnostics.
- [x] Verify current official Enable Banking, Open Payments and relevant Swedbank requirements; record URLs, dates, supported facts and unknowns.
- [x] Capture non-sensitive read-only operational status and preserve the distinction between historical incident evidence and fresh observations.

### 2. Enable Banking transport integrity
Files: `src/bank.js`, `sites/lib/banking/enable-banking.ts`, focused bank-transport-95 tests.
- [x] Reproduce concrete error/pagination/retry defects against controlled transport fixtures.
- [x] Implement bounded provider reads, preserve exact request context and conservative retry semantics.
- [x] Verify malformed pages, rate limits, expiry/permission errors and interrupted responses cannot produce a successful partial import.

### 3. Safe consent reconnection
Files: bank-specific portions of `src/server.js`, `src/bank-consent.js`, `sites/lib/banking/service.ts`, a focused redirect helper if needed, regression tests.
- [x] Reproduce stale/hardcoded callback and renewal failure paths.
- [x] Resolve callback only from trusted validated configuration, verify provider registration, preserve exact flow URI and reject replay/context mismatch.
- [x] Preserve existing consent and history on failed/cancelled replacement; never activate unverified company/account access.

### 4. Safe diagnostics and truthful status
Files: `sites/lib/bank-consent-policy.js` and declarations, dedicated diagnostic/status helper, service/Node integration after handoff, regression tests.
- [x] Reproduce loss of account-validation specificity and misleading retry/connection status.
- [x] Add fixed diagnostic reasons for failed policy predicates without retaining input values.
- [x] Project read-only connection state/recovery actions consistently with current local consent, configuration and company requirements; preserve old response fields.
- [x] Persist only canonical diagnostic fields and verify hostile error text/getters do not escape.

### 5. Open Payments review and scoped repair
Files: only existing bank provider modules and directly relevant tests as justified by a reproduced failure.
- [x] Compare token, consent/SCA and transaction handling with official requirements.
- [x] Repair demonstrated gaps with failing regressions; retain mTLS, read-only scope/route allowlists, company binding, quota accounting and idempotent durable lifecycle.
- [x] Document unresolved external provider requirements precisely.

### 6. Verify, review and deliver
- [x] Targeted RED/GREEN checks plus required root syntax/test/audit and Sites install/type/test/audit/build; bridge gate where shared verification requires it.
- [x] Independent review of the frozen diff; repair material findings and rerun affected/full gates as warranted.
- [x] Update PROGRESS and relevant scorecard evidence without claiming unverified production acceptance.
- [x] Commit and push only `feature/95-bank`, create PR against main, inspect exact-head CI, report files/tests/PR/external gates.

Integrated code `5f71a3c4840739bcf0786693a00b4213ab59ceba`, CI merge `9264e1515fd1a431dbf3455e0e1c30860091c240`, identical tree `80214932045cb75df02d54c8324f4df0a5443ee0`: 2,013 Node + 3,938 Sites + 47 bridge = 5,998 passing tests, plus 1,148 overlapping security checks. Syntax/types/audits/production build passed. [Final report](../../integration/bank-95/README.md) and [machine-readable receipt](../../integration/bank-95/verification.json). PR #45 remains a proposed merge into main; no production activation or bank acceptance is claimed.
