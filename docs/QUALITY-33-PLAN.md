# MG Fakturakoll — 33-area quality implementation plan

> Execution: autonomous work authorized by the user's 2026-10-30 specification. Use Superpowers debugging, test-driven development and verification. Independent Node, Sites and document investigations run in parallel; integration and publication remain with the coordinating agent.

**Goal:** Improve all 33 requested areas using reproducible evidence, prioritizing financial correctness. A local passing test does not certify actual bank provenance or production operation.

**Architecture:** Preserve the existing Node/SQLite implementation and Sites/Workers/D1/R2 implementation. Extend the current import, evidence, reconciliation and document pipelines, with additive state only. Preserve existing site identity, storage, access policy, runtime secrets and schedules.

**Tech stack:** Node.js, JavaScript, TypeScript, React, Vinext, SQLite, D1, R2; existing node:test suites and Workers integration harnesses.

**Spec:** User-supplied 33-area goal, summarized in `QUALITY-SCORECARD.md`; prior implementation and external bank constraints in `docs/V4-DELIVERY.md` and `docs/V4-SWEDBANK-CHANNELS.md`.

## Global constraints

- Base: `origin/main` `b5a25e7`; existing Sites project and version 31.
- Only synthetic, isolated test data. Never load a production `.env` for tests.
- No customer messages, bank payments, bank-consent changes, deletion of originals, key rotation, or production restoration.
- Suggestions do not change balances. Never derive a real payer or reference from amount similarity.
- Keep leading zeros and original evidence. Conflicts must stay reviewable.
- Commit/push tested work to main without force; verify GitHub and Sites separately.
- Never raise a score without new technical evidence; label unverified production requirements.

## Review focus

1. Refunds or non-invoice bank movements with plausible invoice references must not settle receivables automatically.
2. A stable transaction identifier with contradictory payer/reference evidence must not silently retain trusted matching status.
3. Excluded aggregate parents must still enforce conservation when a second detail report arrives.
4. A valid invoice field plus an explicitly invalid/conflicting field must not be treated as clean.
5. Status checks must be bounded, disclose no invoice text, and distinguish configured automation from recent successful execution.

## Task 1 — Baseline and production evidence inventory

Files: `PROGRESS.md`, `QUALITY-SCORECARD.md`, this plan.

- [x] Read latest main, prior reports, test commands and existing Sites metadata.
- [x] Inspect read-only bank, Gmail and backup status; keep private details out of source control.
- [x] Open the existing Sites source using its authorized repository workflow.
- [x] Run the clean baseline with required local test-socket permissions; record actual counts and failures.
- [x] Inventory each area against explicit criteria, test paths and production limitations.

## Task 2 — Node payment integrity

Files: `src/db.js`, `src/reconciliation.js`, relevant existing overview helpers, `test/node-payments-quality-cycle.test.js`.

Interfaces: `importTransactions`, `analyzeReconciliation`, `runReconciliation` and existing allocation APIs remain compatible; any conflict state is additive.

- [x] Reproduce a card refund that currently settles a receivable, a contradictory stable-ID reimport, and aggregate detail over-counting with synthetic SQLite.
- [x] Add failing regression tests with independently calculated balances.
- [x] Stop automatic settlement on refund/reversal evidence; retain visible review reasons.
- [x] Preserve contradictory evidence without overwriting original facts or removing existing allocations; block further unsafe allocation.
- [x] Validate all children against the parent, including already excluded parents, inside the import transaction.
- [x] Run focused tests, then all Node tests and syntax checks.

## Task 3 — Sites payment integrity and parity

Files: `sites/lib/domain.ts`, `sites/lib/reconciliation.ts`, `sites/lib/reconciliation-engine.js`, relevant bank presentation helpers, `sites/tests/sites-payments-quality-cycle.test.mjs`.

Interfaces: existing workspace commands and revision checks; optional JSON fields preserve older state and originals.

- [x] Reproduce Sites equivalents before changes; test aggregate attack even where the existing guard already works.
- [x] Quarantine conflicting stable-ID evidence and stop automatic/manual allocation until original review resolves it.
- [x] Block refund/reversal false matches and preserve positive ordinary-payment cases.
- [x] Test duplicate import, repeated reconciliation, preserved prior allocations and visible conflict findings.
- [x] Run focused tests, all Sites tests and TypeScript checks.

## Task 4 — Document conflict and original integrity

Files: `src/invoice-extraction.js`, `src/document-triage.js`, Sites parser/triage copies; later `src/invoice-review.js` and `sites/lib/document-processing.ts` if independent reproduction confirms the reported gaps. Tests: `test/document-quality-cycle.test.js`, `sites/tests/document-quality-cycle.test.mjs` and existing integration fixtures.

Interfaces: retain existing extraction field objects and levels; ambiguous evidence must prevent automatic registration.

- [x] Reproduce invalid secondary dates/org numbers/amounts and explicit subject-number conflicts.
- [x] Reproduce ambiguous documents incorrectly discarded by non-invoice title classification.
- [x] Fix both parser/triage copies with red-green tests; preserve leading zeros.
- [x] Reproduce missing original-hash validation and bankgiro/counterparty trust gaps before touching registration.
- [x] Require original integrity and previously verified compatible counterparty details for automatic registration.
- [x] Run focused tests and both complete affected suites.

## Task 5 — Bounded and truthful status

Files: `sites/lib/gmail-service.ts`, `sites/lib/banking/mcp.ts`, relevant status tests; UI consumers only where needed.

Interfaces: `gmailStatus(summary)` keeps the document-review API available. The read-only MCP tool returns the summary, not document bodies. Freshness derives from observed successful fetch time, connection state and configured cadence, not a configuration flag alone.

- [x] Reproduce that a status MCP call returns private extraction text and performs unnecessary document/workspace reads.
- [x] Test summary-only response and authentication; test stale, missing, future, blocked and recent successful execution.
- [x] Return bounded status, counts and explicit execution state with no raw document contents.
- [x] Do not enable a paused external schedule based only on runtime settings; record the observed external pause.
- [x] Run focused and full Sites checks.

## Task 6 — Integration, browser checks and independent review

- [x] Run required root and Sites checks/tests, both audits and production build.
- [x] Use the supported managed Sites preview and cloud browser, if available, for 320/390/768/1024/1440 widths, keyboard, bank evidence and review flows with demo data.
- [x] Review changes independently, fix material findings with regression tests, and re-run affected gates.
- [x] Record external blockers and evidence-backed scores for all 33 areas; no all-9.5 claim without required production proof.

## Task 7 — Main and existing-Site delivery

- [x] Refresh main, reconcile concurrent work, commit and push without force.
- [x] Verify exact GitHub SHA and Actions checks.
- [x] Sync only the tested Sites changes into the existing source checkout, preserving configuration and runtime binding identity.
- [x] Package and publish using the supported Sites workflow; verify returned version/deployment.
- [x] Perform bounded read-only production checks and save the exact continuation state.

## Execution rulings

- Use the freshly cloned isolated checkout and a short-lived branch; no user workstation state is shared.
- Existing bank and Gmail permissions are not evidence that an individual Swedbank report profile is available. This remains an external requirement.
- An observed paused Gmail schedule is not silently re-enabled; first report its actual state and inspect whether the running code can accurately show staleness.
- Initial test commands encountered sandbox-denied localhost sockets; rerun the same clean baseline with authorized local test execution. This is an environment failure, not a passing test.

## Verified implementation outcome — 2026-10-30

- Clean base: Node312/312 and Sites394/394. Final code: Node377/377, Sites456/456,0failed/0skipped; JavaScript63files, TypeScript, both audits and production build passed.
- Independent review raised and closed persistent conflict, inherited hold, rollback retention, original-validation fixed-point, truthful overview and blocked-status issues. Final code verdict: no outstanding Critical/Important finding in the bounded diff.
- Browser evidence and limitations: `docs/screenshots/quality-33/ui-verification.json`; actual dialog focus restoration reproduced and fixed. Temporary QA HTML removed.
- Full change/evidence/continuation report: `docs/QUALITY-33-DELIVERY.md`. All33scores are in `QUALITY-SCORECARD.md`; no complete-goal certification.

## Publication outcome

- Program main 791bfae7fea426eabf277948b4be4be4b445711d; both Actions jobs success in 41077406198.
- Sites source df99151555015dd5cb3e99247f6baef094847577, version 32, deployment appgdep_6ae4b30ac7b08191a538a3bf9eb0877a succeeded; runtime 9 unchanged.
- Read-only production status passed; public signed-out browser view checked. Authenticated browser workflow remains explicitly unverified because the separate browser requires OpenAI sign-in.
- Full evidence and continuation: QUALITY-33-DELIVERY.md and QUALITY-33-PUBLICATION.json. All implementation-plan tasks are accounted for; this does not close all 33 quality criteria.
