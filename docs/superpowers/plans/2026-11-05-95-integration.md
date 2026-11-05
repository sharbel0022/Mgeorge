# MG Fakturakoll: verified integration and release plan

> For agentic workers: execute the user's authorized integration work continuously; use independent review and verification before completion. Checkboxes record evidence, not optimism.

**Goal:** Integrate reviewed Agent 1–8 deliveries on `feature/95-integration`, re-evaluate the existing 33 criteria and decide release readiness with traceable evidence. The numerical target is at least 314/330; missing evidence cannot earn points.

**Architecture:** Preserve the existing Node and Sites implementations, company boundaries, financial engine and deployment identity. Freeze producer heads and test the exact combined source. Keep synthetic acceptance, remote CI and read-only production observations separate.

**Tech stack:** Node.js, SQLite, Sites/TypeScript/D1/R2, GitHub Actions and the existing banking adapters.

**Spec:** The user's Agent 9 integration/release assignment; `AGENTS.md`, `QUALITY-SCORECARD.md`, and `docs/SAAS-MULTITENANT-BANKID-FINAL-REPORT.md` supply repository context. The new evidence belongs in `docs/integration/95/` and does not rewrite historical receipts.

## Global constraints

- Never push unchecked code directly to main; use the ordinary PR process.
- Never modify financial production data, fetch the bank or activate a schedule as part of these read-only production checks.
- Treat actual payer, bank reference, intended invoice reference and manual review as different evidence.
- Commercial release requires all of the user's security, tenant, bank, Bankgiro, recovery, external-authority and acceptance gates.
- No claim of 9.5/10 without supported points. Existing 255/330 is a carried historical baseline unless each area can be re-certified.
- Existing local branch/worktree isolation and autonomous implementation are authorized by the user; no repeated planning approval is needed.

## Review focus

- A green earlier PR does not validate a changed head or integration result.
- Missing producer branches are not delivered merely because older SaaS work was merged.
- A successful deployment and backup manifest do not prove current bank access or full recovery.
- Revoked membership, stale callbacks and reused leases must not cross a company/write boundary.
- Aggregate deposits, leading zeros and proposal-only matches must preserve balances and source evidence.

## Task 1: Inventory and freeze

- [x] Fetch main and inspect all currently visible PRs and branches.
- [x] Create the requested isolated integration branch from `4ad205b84d1852ec7ed33cabd70fdadbe2f9d5c5`.
- [x] Record the producer matrix, exact SHA, review/CI state, dependencies and overlaps.
- [x] Refresh the inventory before finalizing so late deliveries are not silently missed.

## Task 2: Independent review and concrete corrections

- [x] Delegate separate security/data, bank/evidence and QA/scorecard reviews.
- [x] Reproduce concrete integration defects with synthetic tests before correcting them.
- [x] Keep producer-owned corrections on the relevant branch when a producer PR exists; keep integration-owned evidence changes here.
- [x] Accept only reviewed producer heads, in dependency order. If none is available, record that explicitly rather than inventing integration.

## Task 3: Exact-source acceptance

- [x] Run locked installs, Node and bridge syntax, Sites types and mitigation checks.
- [x] Run complete isolated Node/Sites/bridge suites and required audits/build.
- [x] Identify the synthetic full invoice/payment, migration, idempotency/concurrency and 1/10/100-company tests and their actual outcomes.
- [x] Record initial failures, environment limits and successful retries distinctly; do not erase a failed attempt.
- [x] Check remote CI on the final reviewable SHA; a pending/failed run remains a gate.

## Task 4: Read-only production and release assessment

- [x] Read current bank, Bankgiro, Gmail/OCR and backup status without financial writes.
- [x] Read current Sites version/deployment and live database table inventory.
- [ ] BLOCKED: exact Sites63 source-to-GitHub equivalence remains unverified. Native version/deployment is observed; the candidate is not deployed.
- [x] Complete each of the existing 33 rows: previous/new score, evidence, tests, remaining gaps and any justified increase.
- [x] Publish the integration/report PR and final decision with exact unclosed blockers and continuation steps.

## Execution notes

Initial discovery: all earlier PR36–44 are already merged. No `feature/95-*` producer branch or PR was present in the first inventory. Current main CI42059325916 is successful. Sites62 is published; bank status is disconnected and the Bankgiro source is absent. Production Gmail is currently connected/recent (the older report's paused status is historical). Backup `manifest_pass` is not a restored-service exercise.

Initial local Sites locked install exited 137 (`Killed`) before any product-code change. This failed attempt is retained in the external test log and must not be counted as a successful install. Root and bridge installs passed. Diagnose and retry only the failed installation without weakening the repository gates.

## Concrete correction: ambiguous Open Payments writes

The unresolved PR36 review is reproducible on current main. Successful POST/PUT
requests with unreadable response bodies lose `mayHaveSucceeded`; semantic
validation and local sealing after success have the same problem. The lifecycle
then stores `failed` and a new idempotency key can create another consent. A known
consent can also be discarded after a definite rejection at a later stage.

- [x] Add real HTTP/provider/runtime regression tests before production changes.
- [x] Observe RED: 23 tests, 2 existing controls pass, 21 assertions expose the defect.
- [x] Preserve sanitized ambiguity after dispatch/success, including semantic parsing and post-response guards.
- [x] Persist a blocked recovery state; preserve a known handle for explicit revocation.
- [x] Prevent legacy failed/cancelled rows with an unrevoked handle from being overwritten.
- [x] Verify a definite pre-consent failure remains retryable and confirmed revocation permits a new flow.
- [x] Obtain independent review and run all final gates on the final code.

Baseline local Node24 completed 1,899/1,899. Sites24 completed with 3,711 passes
and one failed test file (`banking-security.test.mjs`); the process-level cause is
being isolated using Node22, matching CI. This attempt is not a green suite.

## Final code and remaining external gates

Reviewed code0ce2604/tree50d1ec passed complete CI42091716726 and security42091716587. Seven produceragents delivered; Agent6 was not observed. Detailed33-row reassessment is250/330. Production checks are read-only and current as of19:14 UTC. Commercial launch is NOT APPROVED. Current report documents and an independently verified evidence bundle accompany the PR; any report-only successor receives a fresh fullCI receipt. Main/production were not changed by Agent9.
