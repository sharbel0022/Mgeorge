# Multi-company foundation implementation plan

> **For agentic workers:** use the shared interfaces below, isolated synthetic tests, and a final independent security review. The user's implementation request authorizes this plan; production activation and merging are excluded.

**Goal:** isolate each customer's financial data while preserving the existing M.George installation and evidence.

**Architecture:** Node uses an explicit company catalogue and physically separate SQLite business databases. Sites reuses its existing immutable owner namespaces and adds verified company bindings, live memberships and authorization fences. Both reuse the existing invoice, bank, original, reconciliation and job engines.

**Tech stack:** existing Node SQLite, Cloudflare D1/R2, TypeScript/JavaScript and React; no new dependencies.

**Spec:** the user's twelve implementation requirements and eight isolation acceptance cases; final data/API mapping in `multitenancy.md` in this directory.

## Constraints and decisions

- Work only on `feature/saas-multitenant-foundation`, open a PR against main, never merge or publish the Site.
- No real business data, provider calls, schedules, consent changes or production migrations are used for validation.
- Existing identities, original bytes/hashes, allocations, consent and account evidence remain authoritative and unchanged.
- A company name, organisation number, client companyId or an invoice is never proof of ownership.
- Existing storage can be bound only through an explicit trusted operation recording the verified owner relationship. Unbound installations retain their existing single-owner behavior and reject company selectors.
- New companies start with neutral settings and an explicit-reference policy; they do not inherit M.George's company profile or policy.
- Prefer existing storage boundaries over rewriting all financial records: adding company predicates to hundreds of formerly global Node SQL statements would create avoidable isolation risk.

## Shared interfaces

`CompanyContext` has `version: 'company-context-v1'`, `companyId`, `storageOwner`, `actorId`, `role`, `membershipVersion`, `companyVersion`, `contextVersion`. Versions are positive safe integers. Roles are owner/admin/accountant/viewer. The context is server resolved, immutable and reauthorized at persistence boundaries.

`GET /api/companies` returns `{version, companies:[{id,name,role,membershipVersion}],activeCompanyId,contextVersion,context?}`. Unbound legacy returns an empty list, null active ID, `legacy:true`, version 1. `POST /api/companies/active` accepts `{companyId,contextVersion}` and returns `{context}` after authorization. Requests pin `X-Company-Id` and `X-Company-Context-Version`; original links use equivalent validated query selectors. Conflicting selectors fail closed.

Pure exports in `sites/lib/company-contract.js` validate context/boundary, enforce a shared role matrix and derive actor/company/version-specific cache keys. Shape validation is never evidence of authorization.

## Tasks

### 1. Shared contracts and reference policy (root)

- [x] Add failing synthetic tests for role denial, malformed/forged context, cache identities, job/restore boundaries and company-scoped reference policy.
- [x] Implement the pure contract module and TypeScript declarations. Keep formal OCR and source references unchanged.
- [x] Run the contract tests in both test runners.

### 2. Node catalogue, runtime and persistence (Node implementer)

- [x] Add real SQLite/HTTP tests for A/B invoice/bank/original isolation, role checks, revocation, session switching, job pinning, restore mismatch and legacy byte/row preservation.
- [x] Implement versioned catalogue, trusted binding/provisioning, per-company service instances, request/job contexts and live authorization.
- [x] Add authorized company list/switch endpoints and company-bound backup verification; retain legacy APIs and DB exports.
- [x] Run new Node tests and relevant existing API/backup/job tests.

### 3. Sites data boundary and migration (Sites implementer)

- [x] Add actual SQLite-backed D1 tests for legacy migration preservation, company binding/membership, A/B reads/writes, revocation and background fences.
- [x] Add an additive versioned migration and schema/snapshot metadata, explicit binding lifecycle and request/job authorization.
- [x] Wire all relevant API/private worker boundaries; preserve owner keys and R2 object names.
- [x] Run new Sites tests, relevant API/job/original tests and typecheck.

### 4. Active company UI and cache (UI implementer)

- [x] Add tests for delayed A responses after B switch, same record IDs, revocation and original URL context.
- [x] Implement company-bound request helper and selector; blank financial state and fully reload on switch.
- [x] Preserve legacy behavior and test both actual frontends.

### 5. Integration, review and delivery (root)

- [x] Document exact Companies/CompanyMemberships/CompanyRoles and financial entity mappings, new fields, migration/rollback and Agent 8's proposed contract edition.
- [x] Run locked installs, Node syntax/full tests/audit and Sites typecheck/full tests/audit/build (plus bridge tests used by Sites).
- [x] Independently review the branch, reproduce and fix material findings with regressions.
- [x] Record results and limitations in progress/scorecard without claiming live acceptance.
- [x] Prepare the reviewed feature-branch delivery, PR evidence and rollout requirements. Push only this branch and use `main` as the PR base; GitHub records the actual delivery and check state.

## Review focus

- Prepared statements or delayed callbacks executing after membership revocation or company switch.
- Default/global data paths, caches, OAuth state and background service instances crossing company boundaries.
- Owner strings from body/query/private tools being accepted as identity without verification.
- Restore deduplication or original lookup accidentally sharing an ID/hash across companies.
- Legacy fallback after a company has been explicitly bound or an actor's membership removed.

## Execution record

- Baseline: `14a042abd37fa455d08da9dfcc096ef4f603b512` (origin/main), freshly cloned; dedicated feature branch.
- Runtime discovery: Node 24.22.1 locally; repository CI targets Node 22 (minimum 22.13).
- No new SaaS rules were present in the repository; current `AGENTS.md`, `docs/integration/README.md` and the user's instructions govern this proposal.

- Final local receipt: **1,633 Node + 3,190 Sites + 47 bridge = 4,870 passed**, no failures/skips/cancellations/TODOs. Syntax, TypeScript, locked installs, audit gates, exact minimatch verification and production build passed.
- Independent security review reproduced one worker-credential fallback defect. The corrected historical-binding check and transaction fence have regression coverage; independent repro now denies revoked/wrong-runner access. No remaining reproduced Critical/Important findings in the reviewed scope.
- Full acceptance mapping, development audit findings and production/identity/rollback limits are recorded in `multitenancy.md`. Final PR CI is reported by GitHub for the exact pushed head, separately from this local receipt.
