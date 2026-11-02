# Gmail and document automation implementation plan

> For agentic workers: use Superpowers debugging, TDD and verification-before-completion. User has authorized autonomous implementation; delivery is a development branch and PR only.

**Goal:** Durable, observable Gmail ingestion and document processing, without duplicate invoices or unsafe automatic registration.

**Architecture:** Retain immutable mailbox/message/part identity, SHA-256 original deduplication, owner isolation and existing lease fences. Add durable retry and automatic-entrypoint observations to the existing Gmail flow; preserve human review and existing external schedules.

**Tech stack:** Node.js/SQLite; Sites TypeScript/Cloudflare D1 and R2; node:test.

**Spec:** User's Gmail goal and subsequent parallel-development coordination instructions, summarized below.

## Constraints and scope

- Branch `fix/gmail-document-automation-20261102` from `a9f88ae1c0f697376b3ecd140e1e80a64405125a`.
- No main push, automatic merge, force-push, branch deletion or Sites publication.
- No customer email or uncertain invoice registration. No new or competing schedule.
- Shared OCR parsers, bank reconciliation, backup and general dashboard UI belong to parallel assignments; document findings without changing them.
- Synthetic test originals only. Preserve OAuth/session/owner boundaries and original bytes.
- A successful fetch, an automatic entrypoint invocation and a scheduler-originated run are distinct evidence.

## Review focus

- Retryable provider 403/429/5xx must retain a durable deadline without an immediate retry loop or false OAuth expiry.
- A repeated identical original concurrent with rejection/registration must inherit its current terminal status.
- Crash/restart after original persistence or extraction receipt must not lose the original or register a second invoice.
- Missing MIME metadata and malformed originals must not permanently starve later valid documents.
- An enabled external schedule or manual auto-sync tool call must not be represented as a verified scheduler run.

## Tasks

### 1. Gmail adapters and original import

Files: `src/gmail.js`, `sites/lib/gmail-adapter.js`, new adapter regression tests.
- [x] Write and run failing tests for 403 reason classification, 5xx non-JSON replies and missing attachment metadata.
- [x] Correct provider/attachment handling with unchanged source keys and bounded reads.
- [x] Verify malformed/large/duplicate parts, pagination, OAuth refresh and no replay of send POSTs.

### 2. Durable synchronization, status and concurrent source insertion

Files: `sites/lib/gmail-service.ts`, Gmail-scoped migration/schema only if required, `sites/tests/gmail.test.mjs` and focused tests; Node Gmail glue only where necessary.
- [x] Reproduce source-status race, pause/retry behavior and absent automatic-call observation.
- [x] Persist bounded exponential backoff with jitter; preserve provider Retry-After; separate reconnect/manual-intervention failures.
- [x] Record automatic entrypoint observations with explicit external-scheduler verification unknown to the application.
- [x] Select current terminal source status atomically during insertion; test reimport across restart.

UI contract: `schedule_observation` contains `last_invoked_at`, `last_completed_at`, `last_outcome`, `source: 'system_entrypoint'`, `external_schedule_verified: false`. It is not a scheduler receipt.

### 3. Document queue outcomes and recovery

Files: `sites/lib/document-processing.ts`, `src/invoice-review.js`, new queue regression tests.
- [x] Reproduce lease/retry/restart failure paths and post-commit result misreporting.
- [x] Fix demonstrated queue issues without weakening verification gates or changing shared OCR parsing.
- [x] Verify simultaneous claims, interrupted work, bounded retries, malformed originals and accepted commit receipts.

### 4. Gmail UI and delivery

Files: Gmail/document-status components, focused render tests, `docs/GMAIL-AUTOMATION-FIX-REPORT.md`.
- [x] Render distinct connection, last fetch, automatic invocation, processing and registered states; show unknown schedule provenance honestly.
- [x] Run root and Sites suites, syntax/type checks, dependency audits and production build; report any environment limits.
- [x] Independent review, inspect latest origin/main, integrate conflicts safely if needed.
- Delivery: commit/publish development branch only and open an unmerged PR. The final response and GitHub record supply the resulting SHA and PR URL; integration remains explicitly unauthorized during parallel work.

## Baseline observations

Read-only production status 2026-11-02: 191 review jobs, 2 queued; 190 unverified counterparties, 108 missing dates and 105 missing organization numbers. Successful fetch at 17:58:16.150Z. Existing hourly automation enabled; its latest recorded completed run remains 2026-10-29 15:00Z. No new schedule or production mutation performed.

## Progress ledger

- Baseline read: AGENTS.md, PROGRESS.md, QUALITY-SCORECARD.md, latest maintained-runtime delivery report and CI commands.
- Original Git clone failed in sandbox proxy; supported escalated read-only clone succeeded, then fresh fetch and dedicated branch creation verified.
- Ruling: date-month parser finding handed off to the separate OCR assignment following coordination instructions; no parser changes in this branch.
- Final verification: Node 1,132/1,132; Sites 2,020/2,020; syntax/type/build pass; root and Sites production audits 0, Sites development audit retains 16 moderate findings. Exact mitigation bytes verified.
- Independent review closed three concrete findings: repeatable transport headers, paused reference-call success semantics, and response-stream transport normalization. Each has regression coverage.
- External automation became verifiable during work: scheduled 2026-11-02 19:00Z, run 24458c56-57a4-8323-83b8-1ffbe09b4c71 completed 19:06:34Z, matching result reports eight imported originals. Later read-only app status: 210 review, zero pending queue; this is existing production, not this unpublished branch.
- Latest origin/main remains a9f88ae1c0f697376b3ecd140e1e80a64405125a. Git CLI has no write credentials; delivery uses the connected GitHub app with content-addressed tree verification, no main update or forced reference update.
