# Company bank consent implementation plan

**Goal:** Extend the existing bank routes with company-bound, single-use authorization, verified read consent, safe renewal and honest corporate-authority status.

**Architecture:** Keep both existing runtimes and their stores, encryption, provider adapter and leases. Share pure security policy between Node and Sites. Bind each flow to the authenticated actor, server-resolved company, browser, provider generation, bank, purpose, scopes and expiry. Provider business consent and verified company ownership are separate facts.

**Tech stack:** Node/SQLite; Sites TypeScript/D1/Web Crypto; existing Enable Banking AIS adapter; synthetic node:test fixtures.

**Spec:** The user's Agent 3 request; concrete contracts and acceptance receipt in `docs/integration/saas/bank-consent.md`.

## Constraints and decisions

- Base `14a042a`; only `feature/saas-bank-consent` may be pushed; PR to main, no merge or publication.
- Preserve production data, originals, allocations, runtime secrets and schedules. Test only synthetic data.
- There is no released SaaS membership model on this base. Resolve the existing company as `workspace:<authenticated owner>`; reject unknown client company identifiers. Agent 1 must replace this narrow resolver with its authoritative membership boundary before multiple companies are enabled. Never create a competing tenant registry.
- Existing legacy connections remain compatible. Every newly started flow requires independently evidenced company/account binding before account confirmation, including requests that omit companyId; only previously persisted connections retain legacy compatibility; pre-migration in-flight callbacks must restart. `business`, `ORGA`, account names and BankID/PSU identity alone cannot supply it.
- Bank-owned redirect/SCA only. No BankID codes, credentials or proprietary BankID session implementation. Do not invent PKCE parameters unsupported by Enable Banking.
- Reuse `/api/bank/connect`, `/callback`, `/status`, `/accounts` and the runtime's existing disconnect route. Renewal uses `connect` with an explicit connection identifier.
- Provider evidence/configuration is server-only, current and exact. Missing Bankgiro scope is disclosed and cannot be promoted from AIS access.

## Review focus

1. Replaced/revoked membership, browser identity or connection while a provider response is in flight: no late write.
2. Two tabs, callbacks or renewals for one company: independent states, one accepted connection update, no unowned session cleanup.
3. Lost callback or response after commit: status is readable and no code exchange is retried blindly.
4. Partial/contradictory scope, account and expiry responses: fail closed; preserve earlier data.
5. Corporate mapping absent, wrong or expired: new company connection is never reported usable, regardless of successful SCA.

## Tasks

- [x] Shared policy and types: test callback ambiguity, company/actor/role binding, scope restrictions, corporate evidence and earliest consent expiry before implementing the pure validators.
- [x] Node route integration: additive persistence, lifecycle reasons, concurrent states, current session validation, renewal/disconnection fencing and HTTP regressions.
- [x] Sites route integration: additive migration, company/browser flow binding, compare-and-set exchange, safe consent projection, renewal preserving old data until replacement succeeds, account confirmation and revocation.
- [x] Existing UI: company/bank/read-consent explanations, truthful corporate/Bankgiro status and renewal through the existing start route.
- [x] Document authoritative provider behavior, exact API/types, migration/rollback and Agent 1/2 adapter responsibilities in the requested integration document.
- [x] Run required Node/Sites/bridge checks, audits, complete suites and Sites build. Independently review the diff and address findings. Delivery uses the already authorized feature-branch push and PR, with no merge or publication.

## Execution notes

- Initial root and bridge locked installs succeeded. Initial Sites install was killed with exit 137; the environment reports cgroup OOM kills. Retrying with bounded npm heap and socket concurrency without changing dependencies or lockfiles.
- Research, shared policy and Node integration are delegated with non-overlapping file ownership; Sites implementation and final integration remain with the primary agent.

- The bounded Sites reinstall succeeded without dependency or lockfile changes. The first root baseline was invalidated by concurrent dependency installation; after installation the full baseline passed 1565/1565. Final feature verification is recorded in the integration receipt.
- Additional RED/GREEN boundary tests reproduced omitted-company downgrade, revoked transaction scope, corporate-evidence expiry and cleanup after lease loss. All new authorizations now fail closed for missing corporate evidence; subsequent reads recheck authority before and after provider responses.

- Final frozen implementation: 1587/1587 Node, 3227/3227 Sites and 47/47 bridge; zero fail/skip/cancel/todo. Syntax (138 files), Sites types, exact minimatch guard, high-audit gates and production build pass. Sites audit retains eight moderate development findings, zero high/critical. Both independent reviewers closed all concrete findings in their reviewed scope.
