# Node integration job orchestration

## Scope

`src/integration-jobs.js` coordinates the existing Gmail and bank service functions through the existing SQLite `integration_jobs` table. It does not import documents, normalize bank transactions, allocate payments, send mail, or create an external schedule. Those responsibilities remain in their existing services.

The additive `jobStatus` field in `/api/settings` → `scheduler.jobs[]` and `/api/gmail/status` → `job` follows `ImportJobStatus` version `1.0`, produced by `sites/lib/import-job-status.js`. Existing response fields remain available. The status is operational evidence: even a successful job has `evidenceStatus: "REVIEW"`; it never establishes a bank payment as `VERIFIED`.

## Persisted facts

| Field | Meaning |
| --- | --- |
| `last_attempt` / `lastAttemptAt` | Start of the latest actual sync attempt, whether manual or scheduled. |
| `last_success` / `lastSuccessAt` | Completion recorded by a valid current sync owner. A later failure preserves this timestamp. |
| `attempt_count` / `attemptCount` | Cumulative observed sync attempts; success does not reset the count. Legacy rows have an unknown count until their first attempt under this coordinator. Historic attempts are not reconstructed. |
| `failures` | Consecutive uncompleted/failed sync attempts. Each attempt reserves its failure count before contacting the provider, so a crashed process cannot avoid exhaustion. Success resets it. |
| `fence_version` / `fenceVersion` | Monotonically increasing claim generation, including credential-control operations. Used together with the private random lease token. |
| `next_attempt` / `nextAttemptAt` | Earliest scheduled retry, including local backoff and any longer provider delay. Blocked/successful snapshots expose no pending retry. |
| `retry_after` | Persisted lower bound for explicit provider/transient retry delays. A normal manual fetch cannot bypass this bound. |
| `job_state` | Durable sync lifecycle: initially queued, then running, succeeded, retry_wait, or blocked. |
| `error_code` | Allowlisted operational error; the shared contract further normalizes it. |

No historical success is inferred from a connected account, an existing checkpoint, a configured schedule, or a legacy row with zero failures. Connecting/disconnecting credentials uses the same exclusive lease with `recordAttempt: false`, preserving sync timestamps and retry barriers.

The scheduler also retains its separate `last_scheduled_attempt`. A successful manual request for an older bank period can therefore be followed by the existing scheduled catch-up immediately when required; recording its manual attempt does not falsely certify or delay coverage of the unrequested period.

## Ownership and recovery

Claims use a conditional SQLite update; competing processes cannot both obtain the same active integration lease. Every assertion, renewal, completion, and release checks the token and the monotonic generation. A replaced owner cannot release its replacement or update status.

`lease.write()` takes `BEGIN IMMEDIATE`, validates ownership, executes a synchronous callback, validates ownership and expiry again, and only then commits. An expired write rolls back. A completed attempt rejects further writes and late failures; repeating its success acknowledgement leaves the original completion timestamp unchanged.

The default lease lasts five minutes. Renewal is bounded by an absolute fifteen-minute execution deadline fixed at claim time. An expired lease cannot be renewed. Gmail continuation and document-analysis authorization checks renew only a still-owned lease after the existing authorization check. The bank adapter retains its existing shorter absolute request deadline.

Opening the coordinator, claiming, checking due work, or reading the summary recovers expired owners. An unfinished sync becomes `retry_wait` or `blocked`, records the fixed `integration_interrupted` error, and preserves its attempt count and retry deadline. No last-success time is created by recovery. A clean release without success/failure has the same conservative result.

After three consecutive failed or interrupted attempts, unattended execution is blocked. An explicit manual recovery remains possible when there is no active provider retry barrier or explicit retry block. A successful authorized recovery resets consecutive failures, while preserving the cumulative attempt count. An explicit provider block remains blocked rather than inventing a permissible retry time.

## Error and privacy boundary

The coordinator persists fixed, allowlisted messages instead of caller-provided exception text. Unknown codes become a generic operational code. Public summaries omit private lease tokens and all provider payloads/credentials. The migration sanitizes historical job messages; it changes orchestration metadata only. New or persisted retry/lease deadlines beyond the contract's representable date range become a durable block with no invented retry time, keeping status reads safe even with malformed legacy metadata.

The underlying provider services keep their existing safe user-facing diagnostics and checkpoint/deduplication behavior. The coordinator's completion timestamp is not an atomic certificate for every downstream financial or OCR fact. An interruption after some existing service work committed is retried through those same idempotent service boundaries.

## Synthetic verification

`test/integration-jobs-orchestration.test.js` verifies independent attempt/success timestamps, duplicate completion handling, manual and scheduled cooldowns, manual failure exhaustion, bounded renewal, rollback on expiry, a separate process exiting without release, safe persisted errors, credential-operation isolation, legacy upgrade behavior, and unrepresentable new/legacy retry deadlines.

`test/integration-job-status-api.test.js` exercises the actual server with synthetic provider responses: a later manual failure preserves last success and publishes a safe code; credential disconnection during a cooldown does not erase the retry deadline or invent a completed fetch.

`test/integration-jobs-backup.test.js` adds an actual encrypted archive/isolated restore check for the schema additions. Before opening the restored coordinator it compares the complete job schema, all job columns/rows and the unchanged table census. After reopening, it verifies preserved success/counters/generations, enforced provider and unknown cooldowns, and conservative recovery of an abandoned lease. This focused test passed; the existing whole-SQLite snapshot implementation required no product change.

Existing `integration-jobs`, `integration-job-api`, `gmail-api`, `gmail-retry-automation`, and `bank-sync-date-api` tests retain the cross-process ownership, delayed-response, real synthetic PDF import/deduplication, bank-period checkpoint, provider retry, and authorization regressions. The scoped combined run passed **52 tests, zero failures/skips/cancellations** on Node 24.22.1. Repository-wide validation is recorded by the combined delivery report; this scoped result does not stand in for that gate.

No live provider call, production database change, outgoing customer mail, bank payment, external schedule change, or deployed-runtime acceptance was performed by these tests. Existing production observations and quality-score limits remain unchanged.
