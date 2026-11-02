# Agent 5 — automation orchestration

## Scope and reviewed base

Branch: `feature/mgeorge-automation-orchestration`.

- Runtime baseline: `73662187cddf9a5c504dea9bd8a1288bd929bc51` (PR #21).
- Reviewed delivery base: `a779b0dd8d184eaf6e6d6e636c555c967f15f3d5`, incorporating contract PR #22, checkpoint PR #23 and closing receipt PR #24. These advances add coordinator documentation and six synthetic acceptance cases; production source is unchanged. Both sides' progress/scorecard sections were preserved when updating the branch; exact product/test byte parity was checked across the final documentation-only advance.
- Contract: [`mgeorge-integration-v1`](README.md), principally C5, with additive consumers for C2/C3/C6. The owning PR metadata and final delivery comment record the immutable delivered head and CI receipt; full local validation is recorded below.

This work strengthens the existing Node integration coordinator, Sites queue/lease boundaries, operational receipts and status projections. It preserves the Gmail and Swedbank acquisition/import paths, original retention, idempotency keys, financial engines and existing schedules. It introduces no second importer, scheduler, ledger or reconciliation engine. The preparation boundary for a future Bankgiro source is disabled in the production status reader because no real report adapter is configured.

The detailed interface references are [ImportJobStatus v1](import-job-status.md) and [Node job orchestration](node-job-orchestration.md).

## Exports, endpoints and consumers

| Surface | Exact implementation | Contract / consumer |
| --- | --- | --- |
| Shared operational status | `sites/lib/import-job-status.js`: `IMPORT_JOB_STATUS_VERSION`, `IMPORT_JOB_TYPES`, `IMPORT_JOB_STATES`, `importJobErrorCode`, `createImportJobStatus`; accompanying `.d.ts` | Version `1.0`, imported by both Node and Sites. Existing consumers retain their old fields. |
| Sites aggregate reader | `sites/lib/import-job-overview.ts`: `readImportJobStatuses(database, owner, configuration, {now})` | One owner-scoped D1 read batch; returns `{contractVersion, observedAt, jobs, bankgiroPreparation}`. It does not claim, process, import or reconcile work. |
| Sites HTTP entrypoint | `sites/app/api/import-jobs/route.ts`: authenticated `GET /api/import-jobs` | The server derives the owner before database access. No POST/activation route or browser-selected owner/source is accepted. Intended additive consumer: Agent 6's reviewed overview. |
| Node coordinator | `src/integration-jobs.js`: `createIntegrationJobs`; existing `state`, `running`, `due`, `claim`, `summary` methods | Existing `/api/settings` → `scheduler.jobs[]` and `/api/gmail/status` → `job` gain `jobStatus`. Existing sync services retain acquisition and financial responsibility. |
| Bankgiro preparation | `sites/lib/bankgiro-import-schedule.js`: `prepareBankgiroImportSchedule`; accompanying `.d.ts` | An internal proposed C3/C5 adapter boundary. Returns a plan only; does not call `readReports`, persist settings or create an external schedule. |

`ImportJobStatus` exposes only job type, lifecycle, operational evidence status, attempt/success/eligibility/lease timestamps, running state, known counters/generation and a safe error code. Its job types are `bank_sync`, `gmail_sync`, `document_ocr`, `backup`, `bankgiro_import`; states are `queued`, `running`, `retry_wait`, `succeeded`, `blocked`, `paused`, `failed`. Invalid or missing success evidence cannot produce `succeeded`. An expired running lease becomes a recoverable lease-loss status. Unknown timestamps and counters remain `null`.

`evidenceStatus` is `REVIEW` or `BLOCKED`, never financial `VERIFIED`. A successful fetch or accepted OCR result does not prove an account alias, payer identity, payment, formal OCR reference, report/deposit relationship or safe allocation. `observedAt` timestamps the read, and `nextAttemptAt` is eligibility rather than proof that a scheduler will execute.

## Persistence, defaults and recovery

### Node

The existing `integration_jobs` table receives a serialized additive upgrade under `BEGIN IMMEDIATE`: `job_state`, `last_success`, `attempt_count`, `fence_version`, `error_code`, `retry_after`, `retry_blocked`, `lease_deadline`, `record_attempt`, `last_scheduled_attempt`. No financial table or shared workspace schema changes.

Legacy rows acquire conservative lifecycle defaults; historical success is not reconstructed, unknown attempt counts remain null, existing retry evidence is retained, and old operational messages are sanitized. Invalid/unrepresentable retry deadlines become an explicit block rather than an immediate retry or a broken status response.

Claims reserve failure/attempt evidence before provider work, and each claim advances a monotonic generation alongside its private random token. Writes validate ownership and expiry before and after their synchronous transaction body. Expired/replaced owners cannot renew, write, complete or release a replacement. Success is idempotent and preserves its first completion timestamp; later failure cannot undo it. An abandoned process or unfinished release becomes retry-wait/blocked without inventing success.

The existing five-minute lease can renew only while owned and within a fixed fifteen-minute execution deadline. Gmail continuation/document-analysis authorization checks renew through this boundary. The bank adapter retains its existing shorter request budget. Provider waits survive process restart and constrain manual as well as scheduled retries. Three consecutive failed/interrupted attempts block unattended work; permitted explicit recovery retains provider barriers. Credential operations use `recordAttempt:false`, so reconnect/disconnect cannot masquerade as a successful fetch or clear a cooldown. Manual and scheduled attempt clocks remain distinct for historical bank catch-up.

### Sites

No D1 migration is introduced. Existing owner locks, document jobs, extraction history, backup runs and audit events remain authoritative.

- **Document queue:** failure/fallback writes now recheck the live lease using the database clock, processing state and active source at the write boundary. A late timeout cannot switch engines or reset retry attempts. `extraction.processing.run_id` is a one-way owner/document/lease digest; the first accepted receipt prevents another success or error for the same lease from replacing evidence. Raw lease credentials are not saved in extraction history. A new lease has a new run identity and may reprocess. Interrupted continuations retain the accepted receipt until normal expiry/reclaim; registration still applies its independent original, trust, revision and lease checks.
- **Bank operational receipts:** existing `audit_events` gains `bank.job.started`, `bank.job.completed`, `bank.job.failed`. Details contain generated `run_id`, mode and an allowlisted failure code. Starts are fenced before provider work; completion shares the accepted import transaction. If the commit reply is lost, the exact owner/run receipt supplies the accepted result without adding a contradictory failure or overwriting a replacement worker's state. An unreadable receipt preserves the unknown outcome. A failed audit insert has one lease-fenced essential-state fallback so logging failure cannot erase `Retry-After`.
- **Backup copies:** document-object writes use conditional creation (`If-None-Match: *`) and authenticated readback. A delayed expired worker cannot replace the exact ciphertext already verified by its replacement. Existing checkpoints and verification budgets remain in use. An invalid existing copy fails safely; this change does not silently overwrite it.

### Truthful timestamp and running-state projection

Bank success comes from the committed sync checkpoint; attempts use new started receipts and existing automatic/control timestamps. Gmail retains its persisted attempt time and committed fetch-run/legacy success evidence. OCR success comes from an immutable accepted worker-v3 extraction receipt matching the current owned original hash; later retries, registration or afterchecks cannot advance that timestamp. Backup success comes from a complete snapshot's `finished_at`, even when a later daily job fails.

Legacy Sites OCR and backup retries have no separate persistent attempt-start timestamp. Their `lastAttemptAt` remains null; job creation/progress timestamps and worker heartbeats are not substituted. Existing generic bank/Gmail owner locks also protect OAuth/account operations and do not bind a particular sync attempt to the token. Those projections therefore never use a generic live lock to assert `running:true`; unresolved attempts report `worker_unconfirmed` where applicable. Scope-bound Node, document and backup leases can establish running state. Persisted failure counts and explicit retry status take precedence over equal or regressed attempt/success clocks; an older successful result remains visible without mislabelling the current failure as success.

A stored Sites retry deadline establishes waiting time, not a specific provider error. Its cause remains null when the row cannot distinguish local backoff, unavailable service and rate limiting. Known attempt-bound codes in the Node coordinator remain available. No raw error text is parsed to infer the cause.

## Bankgiro source gate and coordination

The preparation contract accepts an internal source registration `{id, adapterId}` and a **server-owned** adapter registry. A real adapter must implement `verifySource({owner, sourceId})` and `readReports`. Preparation only verifies authority. A ready plan requires matching owner/source, provider-origin authorization, a nonempty evidence receipt, explicit `bankgiro_reports:read` capability, a check no older than five minutes and authorization still valid after the awaited verification returns. Defaults are disabled, a 60-minute interval and Europe/Stockholm. `externalScheduleCreated` is always false.

These names describe the proposed internal boundary, not an invented bank API. Agent 3 must provide the reviewed real source mapping, credentials/authority and canonical acquisition/import implementation. AIS connectivity, an uploaded spreadsheet, a browser flag or a manually attested report/account relationship cannot enable automatic report acquisition. The new GET reader supplies no source and therefore reports Bankgiro blocked. Future dispatch must recheck source authority and reuse existing retention/import/idempotency boundaries.

Agent 2 retains provider/consent/account/checkpoint ownership. Agents 1 and 4 retain intended-reference and financial matching rules; Agent 5 does not change their evidence semantics. Agent 6 can consume the reviewed additive status projection. The integration owner reviews overlapping changes and controls normal merges and publication. Shared product edits are limited to orchestration hunks in `src/server.js`, `sites/lib/banking/service.ts`, `sites/lib/document-processing.ts`, and the backup copy boundary. The source integrations and complete C1–C6 acceptance chain are not claimed delivered by this PR.

**Concrete C2 merge dependency:** Agent 2 head `8839807303ff32e7a160d08d7e3575919371ed15` calls `lease.success()` before a final `lease.assert()` guard and postprocessing. C5's terminal success deliberately disallows that sequence. A direct merge would reject/roll back the Node import. The [shared status contract](import-job-status.md#required-c2c5-merge-coordination) records the exact interaction and required combined regression; the coordination thread has been notified. The integrator must agree completion/aftercheck ordering with C2 while retaining the financial commit guard and terminal-write protection. Sites must combine C2 guarded reads/account cooldown with C5 run receipts and its committed-result recovery. No unreviewed C2 implementation is silently imported by this delivery.

The later C2 head `9dcf038567102514a14774b301cfa0078274b31b` changes documentation only and retains that collision. C3 now has a published source interface at `5c9b51bc12c0c7b37df07b0c8061e9b6313189f6`: `authorize`, `listReports`, `fetchReport`, plus the canonical `runBankgiroSource(owner)` worker and read-only `bankgiroSourceStatus(owner)`. Its production resolver still returns null. [The concrete C3 mapping table](import-job-status.md#published-c3-source-mapping) distinguishes those methods from C5's proposed `verifySource`/`readReports`, preserves source scope/generation, and identifies the provenance/capability/freshness facts that cannot be invented. Preparation never executes the C3 worker. C2/C3 migration `0016` numbering and C3 backup-census additions are further integrator-owned merge checks; C5 has no Sites migration collision.

## Synthetic test inventory

The current change adds **77 synthetic test cases: 28 shared/status/preparation + 15 Node + 17 document queue + 16 bank + 1 backup**. Counts include expanded table-driven cases and exclude edits to existing compatibility assertions. This inventory is not a repository-wide passing-test receipt.

| New test file or additions | New cases | Concrete coverage |
| --- | ---: | --- |
| `sites/tests/import-job-status.test.mjs` | 8 | Attempt/success separation; expired leases; pause/provider waits; unknown fields; privacy; invalid state/type; impossible calendar dates. |
| `sites/tests/import-job-overview.test.mjs` | 11 | Read-only owner snapshot; preserved prior success; expired/exhausted work; heartbeat and aftercheck distinctions; generic reconnect locks; equal/regressed timestamps with persisted failure evidence; blocked Bankgiro source. |
| `sites/tests/import-job-route.test.mjs` | 2 | Unauthenticated requests perform no DB access; authenticated owner selection and no activation route. |
| `sites/tests/bankgiro-import-schedule.test.mjs` | 7 | Missing adapter/source; scoped fresh authority; AIS/manual-evidence rejection; stale/expired/future/malformed evidence; sanitized failure; expiry during verification. |
| `test/integration-jobs-orchestration.test.js` | 12 | Attempt/success clocks, duplicate completion, durable cooldown, failure exhaustion, bounded renewal, transaction rollback on expiry, separate-process crash, privacy, credential operations, legacy upgrade and unrepresentable deadlines. |
| `test/integration-job-status-api.test.js` | 2 | Actual Node server: later failure preserves success; disconnect preserves the retry barrier without inventing a fetch. |
| `test/integration-jobs-backup.test.js` | 1 | Actual encrypted archive/isolated restore; exact job schema/rows/census; preserved success and fencing; provider/unknown cooldowns and abandoned-lease recovery after reopening. |
| Additions to `sites/tests/document-queue-recovery.test.mjs` | 17 | Local/cloud expired error callbacks; replacement/rejection races; three late PDF outcomes; identical/conflicting/error replays; preserved receipt after interruption/module reload; legitimate replacement-lease work. |
| Additions to `sites/tests/banking-security.test.mjs` | 16 | Three invocation modes, five safe error cases, completion/failure audit faults, four lost-commit-reply variants, skipped/stale attempts and post-commit housekeeping. |
| Addition to `sites/tests/backup.test.mjs` | 1 | `a delayed original write cannot replace the bytes already verified by a newer backup worker`. |
| **Total** | **77** | Isolated synthetic data; no production mutations. |

Existing Gmail/cloud OCR, integration ownership/API, bank-period/integrity and backup compatibility tests remain part of the required cumulative run. Existing cloud provenance assertions explicitly allow and validate the added hashed run ID. Existing bank assertions continue to distinguish financial audit entries from the new operational receipts.

The queue and bank/backup changes received independent scoped read-only reviews. Scoped tests use real SQLite transactions with controlled interleavings and synthetic provider/storage boundaries; the OCR compatibility path includes a real synthetic scan. Node crash coverage exits a separate process; Sites queue restart coverage reloads a worker module over retained SQLite state. Neither is evidence of live scheduler execution or deployed cloud acceptance.

## Safety and remaining limits

- Real case `0599`, production invoices, balances, original documents and allocations were not changed by these tests. No real invoice registration, customer mail, payment, BankID, consent renewal or manual provider sync was used as an acceptance test.
- Status and new operational receipts omit provider bodies, raw exceptions, account identifiers, payer/reference data, URLs and credentials. Existing authorized financial audit/original evidence remains in its established stores.
- No external automation was created, enabled, paused, edited or dispatched. Read-only schedule inventory is documented in `import-job-status.md`; configuration is not proof of a new successful run. No deployment or production/main write is performed by this work.
- A real authorized Bankgiro source, the reviewed source-agent mapping and its complete synthetic integration chain remain dependencies. Preparation success with a synthetic adapter is not production access.
- Legacy unknown attempt timestamps and generic OAuth-lock ownership remain explicit reporting limits. An accepted OCR receipt does not prove invoice registration, and a successful backup job is not a full production disaster-recovery exercise.
- No production restore, independent offsite-key/archive exercise, new-code external scheduler/cloud execution, full UI acceptance or quality-score increase is claimed.

## Final local validation and delivery receipt

Environment: Linux, Node **24.22.1**. The repository's separate PR workflow uses Node 22; its exact-head result is recorded in the owning PR after publication. Local full suites contain **3,723 distinct tests**, including the coordinator's six existing acceptance cases. Scoped results overlap these full suites and are not added to their totals.

| Gate | Actual result |
| --- | --- |
| Root `npm ci --ignore-scripts` | Passed; lockfile unchanged. |
| Sites `npm run install:ci` | Passed clean canonical install; lockfile unchanged. |
| Root `npm run check` | Passed: 124 JavaScript files. |
| Root `npm test -- --test-concurrency=4` | **1,324/1,324 passed**, zero fail/skip/cancel/todo. |
| Sites `node scripts/minimatch-backport.mjs --check --require-target` | Passed: one target, zero writes, exact verified bytes. |
| Sites `npm run check` | Passed TypeScript on the final source. |
| Sites `npm test -- --test-concurrency=2` | **2,399/2,399 passed**, zero fail/skip/cancel/todo, including the final retry-cause correction and all six coordinator cases. |
| Root `npm audit --audit-level=high` | Passed; zero findings. |
| Sites `npm audit --audit-level=high` | Passed; 16 inherited moderate development findings, no high/critical finding. |
| Sites `npm run build` | Passed on the final source; includes authenticated `/api/import-jobs`. No publication. |
| Diff and scope checks | Passed whitespace checks; packages/lockfiles, Site identity, financial engines and Sites schema unchanged by C5. |
| Independent review | No remaining blocker against this reviewed main baseline. Separate whole-product/scoped reviews accepted the queue/bank/backup work and the final status/restore corrections. The documented C2/C3 combination still requires its own integration review and cumulative tests. |

### Earlier failures and their resolution

- The initial Node full run found two named bank API failures, then a dependent fixture stalled. The test cleared only `bank_connections.retry_after`; C5 correctly retained the coordinator's persisted barrier. The fixture now first proves that clearing only the projection still gives 429 without another provider call, then expires both synthetic deadlines before checking consent expiry. Product cooldown protection was retained; the whole bank API file and final full suite pass.
- A direct `node --test` Sites run passed 2,390 of 2,391 but lacked npm's `npm_execpath`, so the existing postinstall subprocess could not locate the managed npm CLI. Canonical `npm test` supplies the required environment; no test was skipped or weakened.
- The first canonical four-worker Sites run passed 2,392 of 2,393; the existing default-100k minimatch CommonJS workload hit its unchanged 55-second subprocess limit during concurrent full tests/build. The final two-worker run without a concurrent build passed all 2,399 cases. Test workload and timeout limits are unchanged. The observed failure is retained here rather than represented as a passing run.
- New negative status cases reproduced false success when clocks coincide/regress and false rate-limit attribution from a retry deadline alone. The corrections passed all 28 shared/status/route/preparation cases and the final whole Sites suite. Initial copied dependency declarations were incomplete; they were discarded in favor of the clean locked installs and successful final typecheck/build.

### Reviewable continuation point

The requested branch is `feature/mgeorge-automation-orchestration`, target `main`, based on `a779b0dd8d184eaf6e6d6e636c555c967f15f3d5`. The delivered commit, PR number and exact Node 22 CI run are frozen in the PR description/delivery comment after push, avoiding a self-referential SHA in this document. Integration must preserve this branch's tests and the C2/C3 mapping notes, reconcile shared changes in a cumulative candidate, and obtain green resulting-main checks before deployment. There is no live source registration, external schedule activation, production financial write or promised background continuation in this delivery.
