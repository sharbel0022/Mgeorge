# Mgeorge SaaS master integration implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Integrate the seven reviewed producer deliveries into one safe codebase, preserving the existing workspace and independently reporting code, CI, deployment and real provider acceptance.

**Architecture:** Retain Node's separate company databases and Sites' immutable storage-owner namespaces. Adapt the producer contracts at trusted server boundaries; reuse existing financial, original-retention, source-intake and job engines. Keep unverified commercial onboarding disabled server-side.

**Tech stack:** Node >=22.13, SQLite, TypeScript, React/Vinext, D1/R2, existing Enable Banking, additional read-only Open Payments.

**Spec:** User-supplied MGEORGE MASTER INTEGRATION request, 2026-11-04; AGENTS.md. Frozen producer inventory: ../../saas/INTEGRATION-MATRIX.md.

## Global constraints

- No force push, deletion of active work, real financial mutations, customer mail or invented bank evidence.
- Preserve existing Site project, DB/R2, secrets, access policy, schedules, originals and balances.
- Review and test the current frozen head, then validate the cumulative merge and exact new main CI before the next merge.
- Use synthetic tests. Distinguish mock provider contracts from sandbox/provider/bank acceptance.
- Run current root, Sites and bridge workflow commands; record failures and platform limits.
- Commercial activation requires the documented external entitlement, authority and regulatory gates.

## Review focus

- Legacy storage with originals but no workspace row must remain accessible; test attempted empty-company creation.
- A revoked membership, old company selection or old consent must not authorize a delayed callback or worker response.
- Parsed JSON must not be described as an exact raw HTTP original; test whitespace/encoding retention through transport and intake.
- Reference policies and migration journals from independent branches need explicit cumulative adapters and upgrade tests.
- Unavailable bank/source coverage must remain unavailable in the integrated UI and preserve all invoice balances.

## Tasks

### Task 1: Inventory and migration/contract map

**Files:** docs/saas/INTEGRATION-MATRIX.md; docs/saas/producer-inventory.json.
**Interfaces:** Consumes current GitHub PR heads and exact-head Actions. Produces frozen merge order, changed-file inventory and review blockers.

- [x] Fetch current origin/main and open PRs; inspect current progress, scorecard and latest delivery.
- [x] Verify exact-head CI for #36–42 and preserve all producer refs.
- [ ] Record schemas, contracts, dependencies and reproduced conflicts in the matrix.

### Task 2: Foundation integration (#40)

**Files:** src/company-runtime.js; src/server.js; sites/lib/company-storage.js; sites/lib/server.ts; company tests and migrations.
**Interfaces:** Verified company context and immutable storage namespace from server membership.

- [ ] Review all producer changes; reproduce any concrete finding before a minimal fix.
- [ ] Run root/Sites/bridge cumulative gates and upgrade/legacy isolation tests.
- [ ] Merge only an approved current head through GitHub, then verify exact main CI.

### Task 3: Provider and consent integration (#36, #39)

**Files:** sites/lib/banking/*; src/bank-consent.js; shared consent policy; bank route/server adapters; cumulative D1 schema/journal.
**Interfaces:** Current company context -> provider resources -> actor/session/state-bound callbacks -> proved accounts.

- [ ] Verify documented read-only API contracts against official provider documentation.
- [ ] Test and adapt company/consent/provider boundaries; preserve Enable Banking.
- [ ] Resolve additive migration numbering and cumulative snapshots without dropping either branch.
- [ ] Repeat full gates, review and exact-head/main CI per PR.

### Task 4: Enrichment and sync integration (#41, #42)

**Files:** Open Payments raw capture, Bankgiro registry/intake, SaaS sync service, policy adapter, backup/restore census and migrations.
**Interfaces:** Authenticated exact HTTP receipt -> scoped report intake; trusted company/policy -> fenced existing bank sync and reconciliation.

- [ ] Test raw-original retention, company identity, policy adaptation and changed authority during awaits.
- [ ] Prove no duplicate economic deposit and no uncertain invoice allocation in joined synthetic scenarios.
- [ ] Measure 1/10/100-company synthetic work, memory, elapsed time and database operations.
- [ ] Repeat full gates, review and exact-head/main CI per PR.

### Task 5: Onboarding and security integration (#38, #37)

**Files:** sites/lib/onboarding/*; sites/components/onboarding/*; server routes; company membership adapters; security workflow/tests.
**Interfaces:** Existing verified company registry and provider lifecycle -> validated versioned UI responses.

- [ ] Reproduce missing backend endpoints/contract mismatches; implement adapters with server feature gate.
- [ ] Test roles, CSRF, stale responses, focus, errors, redirect and truthful Bankgiro/SCA states.
- [ ] Complete Draft #38 only after real backend integration and browser regression.
- [ ] Review security changes and run isolated joined security acceptance; repeat full gates and CI per PR.

### Task 6: Gmail/OCR diagnosis and operational evidence

**Files:** scripts/run-sites-cloud-ocr.mjs; .github/workflows/sites-cloud-ocr.yml; affected worker modules/tests.
**Interfaces:** Existing schedule and secret references -> owner/company-bound worker leases and safe receipts.

- [ ] Read latest complete failure logs and read-only production status; do not expose secret values.
- [ ] Reproduce and fix internal errors, with RED/GREEN regression tests.
- [ ] Record external configuration/credential/disabled-schedule blockers without fabricating runtime success.

### Task 7: Final delivery and existing-Site publication

**Files:** docs/SAAS-MULTITENANT-BANKID-FINAL-REPORT.md; PROGRESS.md; QUALITY-SCORECARD.md; matrix and exact delivery receipt.

- [ ] Run integrated root/Sites/bridge gates, migrations, backup/restore, security, browser and joined acceptance.
- [ ] Obtain independent whole-integration review; close reproducible Important findings.
- [ ] Merge approved code through safe PRs and verify exact integrated main CI.
- [ ] Inspect backup, rollback, runtime bindings/auth/schedules and inactive SaaS gate before publication.
- [ ] Publish exact tested source in existing Site only when publication gates permit; verify version/source and read-only postchecks.
- [ ] Report all ten requested statuses separately, unchanged justified numeric scores, blockers and exact continuation point.

## Execution ledger

- 2026-11-04: Native isolated worktree created from 14a042abd37fa455d08da9dfcc096ef4f603b512; original checkout preserved.
- Ruling: User explicitly requested autonomous implementation and authorized safe PR merges/publication. No additional design or routine merge permission is needed.
- Ruling: Producer reports are evidence to verify, not authority to activate production banking or modify financial data.
- Pre-flight conflicts: company/policy representations, raw HTTP provenance, consent migration0019 and foundation0019, sync journal idx19/snapshot0019. Each must be resolved and tested cumulatively.
