# Swedbank synchronization recovery plan

> Execution: autonomous, on `fix/swedbank-sync-date-recovery`, under the user's updated parallel-development rules. Never push to main, merge, or publish Sites from this task.

**Goal:** Recover internally repairable date-period failures while preserving bank history, exact coverage, idempotency and provider cooldowns.

**Architecture:** Keep the existing Enable Banking read-only adapters, ownership checks, transactional importers and durable leases. Bound requests and adapt only a documented unavailable-period response. Use inclusive UTC dates; never silently replace a requested historical range with recent data. Node needs coverage evidence distinct from the last attempt's wall-clock time. Sites imports the entire requested interval atomically.

**Spec:** The user's Swedbank repair request and subsequent six-conversation coordination instruction. Baseline `a9f88ae1c0f697376b3ecd140e1e80a64405125a`.

## Global constraints

- Synthetic data for all writing tests; no real bank call used as a test.
- Preserve original transactions, financial validation, consent and owner isolation.
- No shared progress/scorecard edits while six areas are developed concurrently; report this task in `docs/SWEDBANK-SYNC-FIX-REPORT.md`.
- No package, dependency, generic backup, Gmail, OCR or reconciliation changes.
- Explicit errors for unsupported history; no invented bank success.

## Review focus

1. Rate limits during date fallback must stop immediately and persist the longest applicable wait.
2. A failure after an earlier successful page/window must not commit a partial interval or move the checkpoint.
3. Changing selected accounts or requesting older history must not inherit coverage for the wrong account/range.
4. Dates near UTC midnight, leap days, month/year boundaries and Swedish DST must not shift, repeat or skip dates.
5. Lost leases and concurrent edits must block both further provider calls and stale commits.

## Task 1 — Date and provider classification

- [x] Reproduce invalid/unavailable date conflation and six-hour fallback failures; characterize existing body timeouts and reproduce lost cooldowns during error-body parsing.
- [x] Distinguish malformed intervals from unavailable periods; prioritize rate limits; preserve trusted read-only error diagnostics.
- [x] Add pure UTC range/window tests, then implement bounded exact-coverage paging and subdivision.

## Task 2 — Sites service

- [x] Reproduce manual full-history fetching, stale coverage after settings changes, missing pre-request lease checks and unavailable-period failure.
- [x] Integrate range recovery, UTC dates, incremental manual/automatic fetching and checkpoint reset after scope changes.
- [x] Verify empty continuation pages, overlap deduplication, retry/expiry/timeout, interrupted resumes and history preservation against real synthetic SQL and domain code.

## Task 3 — Node service

- [x] Reproduce historical fetch advancing the current cursor and silent >90-day clipping.
- [x] Implement bank-scoped confirmed coverage and bounded exact recovery without touching generic jobs/backup/financial logic.
- [x] Verify persisted cooldowns, interrupted-import replay, stable duplicate handling and lease fences.

## Task 4 — Review and delivery

- [x] Run both full suites, syntax/TypeScript, audits and Sites build; retain failure evidence and distinguish environment blockers. Node: 1,105/1,105; Sites: 1,957/1,957.
- [x] Independent review, repair concrete findings with regressions, document exact limitations.

Post-commit delivery gates: fetch main again, reconcile any needed bank conflicts without overwriting other work, publish only the task branch, create a PR and inspect Actions on its exact commit. Record branch, SHA, PR, test results and changed files in the PR and delivery response. Integration/publication remains for coordinated review.
