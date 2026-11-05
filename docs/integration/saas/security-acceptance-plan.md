# SaaS security acceptance implementation plan

> For agentic workers: execute scoped tasks with behavioral regression tests and an independent whole-branch review. Preserve all producer contracts; Agent 8 owns integration decisions.

**Goal:** Deliver independent security hardening, isolated acceptance evidence and explicit commercial launch gates for Mgeorge.

**Architecture:** Keep the existing Node single-administrator installation and Sites owner-bound D1/R2 implementation. Exercise actual services, SQL, cryptography and financial rules with synthetic identity/provider boundaries. Distinguish this evidence from the company membership, corporate provider and consent contracts that are not present at the inspected baseline.

**Tech stack:** Node.js built-in test runner/SQLite, existing Sites TypeScript test harnesses, GitHub Actions.

**Spec:** User assignment “AGENT 7: SAAS-SÄKERHET, EFTERLEVNAD OCH TESTAUTOMATISERING”, 2026-11-04; its 18 audit areas, A/B/C acceptance matrix and required `security-acceptance.md` govern this plan.

**Baseline:** `14a042abd37fa455d08da9dfcc096ef4f603b512`. Feature branch: `feature/saas-security-acceptance`. No SaaS producer branch or open PR was returned by the initial GitHub inventory. `docs/integration/README.md` is the existing integration contract, not a newly approved SaaS contract.

## Constraints and decisions

- Use only synthetic identities, originals, consent and banking data; no production reads or writes are required.
- Keep M.George's production installation, data, secrets, schedules and deployment unchanged.
- Push this branch and open a PR against `main`; integration and deployment remain with Agent 8.
- Add no tenant schema, role names or provider contract on another agent's behalf.
- Existing single-owner test success cannot establish multiple companies per user, delegated membership or real bank coverage.
- Record observed gaps, exact verification commands and external confirmations without declaring legal approval.
- Selected approach: narrow fixes plus tests against existing boundaries. A replacement authorization/data layer conflicts with Agent 1/3 ownership; documentation alone would leave reproducible security defects unfixed.

## Review focus

1. Provider exception text containing short credentials, personal data or newline injection must never enter logs.
2. A delayed request must not escape the current identity/owner boundary when authorization changes.
3. A/B/C records sharing invoice numbers or source identifiers must remain separate in actual queries and original storage.
4. Missing originals, revoked consent and ambiguous suggestions must produce no financial effect.
5. CI must exercise the new suites without live credentials, and must not present pending multi-company acceptance as passed.

## Task 1 — transport privacy and independently reproduced security boundaries

Files: `sites/lib/banking/enable-banking.ts`, `sites/tests/saas-transport-privacy.test.mjs`, existing transport diagnostic test in `sites/tests/banking-provider.test.mjs`; further concrete findings recorded before their fix.

Consumes: existing `providerRequest(config, path, options)`; produces no new public API or stored format.

- [x] Add five behavioral transport-error cases for short credentials, personal identity, account/email, log injection and embedded payloads.
- [x] Run `node --experimental-strip-types --test tests/saas-transport-privacy.test.mjs` in `sites/`; all five fail because private values reach the log sink.
- [x] Emit only the stable `BANK_PROVIDER_TRANSPORT_ERROR` event; update the prior diagnostic test to assert the safe event and absence of arbitrary upstream text.
- [x] Run focused privacy/provider tests and record any other independent reproducible audit finding before changing its security boundary.

## Task 2 — A/B/C acceptance against the available implementation

Files: new `sites/tests/saas-owner-isolation.test.mjs` and a test-only helper if required; existing security/original/consent/job suites.

Consumes: real Sites owner-scoped SQL/storage/services and current cryptographic format. Produces test evidence, not an invented company API.

- [x] Seed three synthetic owner workspaces with distinct originals and the same invoice number.
- [x] Test own-resource success and cross-owner denial through real service/query boundaries, including altered IDs and missing originals.
- [x] Include current consent, callback, replay, concurrency, duplicate and unsafe-matching evidence in the executable suite selection.
- [x] Explicitly mark multi-role/company membership and unimplemented bank/provider coverage as blocked integration acceptance.

## Task 3 — CI and reproducible evidence

Files: `.github/workflows/payment-control-ci.yml`, dedicated security acceptance workflow/runner if needed; `docs/integration/saas/security-acceptance.md`.

Consumes: existing package scripts and new tests; produces isolated regression jobs and exact verification receipt.

- [x] Preserve existing root/Sites/bridge installation, checks, audit, test and build gates.
- [x] Pin third-party CI actions to verified immutable commits and add feature-branch security acceptance coverage without production secrets.
- [x] Run locked installations, relevant RED/GREEN tests, whole suites, syntax/type checks, audits and build; report environment failures separately from product failures.
- [x] Conduct independent static review of the whole branch, fix significant findings with regressions, and verify final runtime changes. Remote exact-head CI remains a publication check.

## Task 4 — security/operational/regulatory handoff

Files: `docs/integration/saas/security-acceptance.md`, `PROGRESS.md`, `QUALITY-SCORECARD.md`.

- [x] Cover all requested security areas in a risk matrix with owners, evidence and launch gates.
- [x] Use current official FI/EU/GDPR/provider sources; distinguish verified rules from architecture-dependent legal conclusions and required supplier/jurist/FI confirmations.
- [x] Provide customer bank-data/DPA/subprocessor, retention/deletion, incident, backup/recovery and key-rotation requirements.
- [x] Record unmet cross-agent acceptance without raising production scores on synthetic evidence.
- [x] Commit and publish the requested branch; open [PR #37](https://github.com/sharbel0022/Mgeorge/pull/37). Exact-head GitHub CI is checked as the final publication receipt.

## Execution ledger

- Baseline clone is a dedicated scratch checkout on the requested feature branch. No other branch is modified.
- Root/bridge locked installations succeeded. First Sites installation and a bounded retry exited 137 under observed shared cgroup memory pressure. A concurrent initial Node baseline run hit partially installed Sites `xlsx`; that run is invalid as a product baseline. Dependency installation is now serialized with bounded npm sockets/heap; tests will be rerun after it completes.
- Privacy RED: all five new cases failed on actual provider transport logging. No provider network request was made.
- Login boundary RED: both declared and chunked 8 KiB padding were accepted with HTTP 200. The unauthenticated login used the 22 MB document budget. Added an 8 KiB streamed/declared limit (enough for the existing 1,024-character password limit), with positive login, CSRF and non-administrator denial controls. This changes no company-role contract.
- Sites installation completed with the unchanged lockfile and exact minimatch guard after serializing sockets and bounding the installer heap. Earlier exit-137/partial-install results are not product evidence.
- Privacy GREEN: 5 new cases and 57 existing provider cases passed. Login GREEN: 7 new boundary cases and 4 existing allocation cases passed. Fresh full guarded Node run: 1,575/1,575, no failures/skips/cancellations/TODO.
- An initial full Sites run was stopped by automatic approval review because Miniflare attempted `workers.cloudflare.com/cf.json`. Inspection located the automatic host-side metadata fetch. Both actual Workerd/PDF fixtures now set `cf: false`; all 6 PDF cases passed with the loopback guard and metadata fetching disabled. The rejected run is not final test evidence.
- Independent audit reproduced an authenticated multipart bypass: a small valid file plus an ignored field exceeded 17 MB with no/understated Content-Length and was accepted. RED: 2 failed bypass assertions, 2 positive/existing-limit checks passed. A 16 MB streamed request cap now cancels overflow before parsing; GREEN: 4 new boundary cases plus 14 concurrency/integrity cases passed.
- New A/B/C owner suite: 15 passed. It uses real migrations, SQLite queries, API routes, domain import, owner/purpose encryption and bank leases. It covers six directed cross-owner attacks, matching invoice numbers, same-byte dedup, Bankgiro only for A, unavailable/tampered originals, lost identity, three synthetic bank/consent records and independent A/B leases. It does not manufacture a company-membership API or claim real-bank onboarding.
- A direct-Node full Sites run reached one existing installer-test failure because this environment's npm CLI is not colocated with the Node executable and `npm_execpath` was absent. The unchanged installer fixture must run in npm's script context. A subsequent `npm test -- --import ...` run passed tests but treated the import path as an additional test file; it did not prove that the guard was preloaded. Dedicated additive `test:isolated` scripts now place all Node flags before the file glob and retain npm's context. Neither intermediate run is used as final isolation evidence; no assertion is weakened or skipped.
- Final isolated results: 1,575 Node +3,145 Sites +47 bridge =4,767 passed, no fail/skip/cancel/TODO. The separate runner reports 92 Node +388 Sites =480 passed and explicitly retains `BLOCKED_PENDING_PRODUCER_INTEGRATION` / `NOT_APPROVED`. Checks/types, immutable Actions/YAML, exact minimatch guard and Sites build passed. Root/Sites-production/bridge production audits: 0 findings; full Sites audit: 8 moderate, 0 high/critical.
- Independent static reviewer inspected production code, fixtures, runner, guard, workflows, package commands and report; no confirmed critical/important finding remained. External action identities and legal sources were verified separately by root, not by that reviewer. PROGRESS and QUALITY-SCORECARD now record the new evidence without changing scores.
- Command-line Git push had no HTTPS credentials. Publication used the authorized GitHub connector instead, with the same parent and an exact tree match: local/published implementation tree `4d0f950de27c09945a725fc45afc7d26a6542f45`, published implementation commit `663a0652ef8a826c157a4cb093f7f9cff4e9d19c`. Only `feature/saas-security-acceptance` was created; PR #37 targets main. No remote force update, merge or deployment was performed. A subsequent documentation-only receipt records this publication.
