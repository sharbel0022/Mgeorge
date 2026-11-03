# ImportJobStatus v1 — Agent 5 automation orchestration

Current additive readiness work: [transport, trusted registration, durable authority and scheduler integration](../BANKGIRO-AUTOMATIC-SOURCE-READINESS.md). The dated producer proposal below remains historical where superseded by that receipt. Real production report access stays unconfigured.

## Scope and design

Branch: `feature/mgeorge-automation-orchestration`. Runtime baseline: `73662187cddf9a5c504dea9bd8a1288bd929bc51`, verified against GitHub `main` on 2026-11-02. Delivery base: `a779b0dd8d184eaf6e6d6e636c555c967f15f3d5`, incorporating contract PR #22, six-case checkpoint PR #23 and documentation receipt PR #24. Those advances change coordinator documentation and add six synthetic Sites acceptance cases, with no production source changes. This is an additive proposal for the integration owner; it does not change provider payloads, payment references, reconciliation decisions or external schedules.

Reuse the existing durable Node SQLite integration leases, Sites D1 owner leases, document queue and backup checkpoints. Do not introduce another importer or financial ledger. SQL writes must validate the live ownership token in the same transaction as their mutations. A renewal must not revive an expired lease. A retry cannot override a provider's persisted waiting time. A successful attempt is distinct from an invocation, heartbeat or failed attempt.

## Contract (version 1.0)

The shared serializer is `sites/lib/import-job-status.js`, also imported by Node. `createImportJobStatus(input, {now})` returns only these allowlisted operational fields:

| Field | Type / meaning |
| --- | --- |
| `contractVersion` | Literal `"1.0"`. |
| `jobType` | `bank_sync`, `gmail_sync`, `document_ocr`, `backup`, `bankgiro_import`. |
| `state` | `queued`, `running`, `retry_wait`, `succeeded`, `blocked`, `paused`, `failed`. |
| `evidenceStatus` | `REVIEW` or `BLOCKED`; never certification of bank facts. |
| `lastAttemptAt` | ISO UTC string or `null`; persisted start of an actual attempt. |
| `lastSuccessAt` | ISO UTC string or `null`; committed successful result. |
| `nextAttemptAt` | ISO UTC string or `null`; earliest known eligibility, not a guarantee of scheduler execution. |
| `leaseExpiresAt` | ISO UTC string or `null`; no lease token is exposed. |
| `running` | True only with `state=running` and a live lease. |
| `attemptCount` | Non-negative safe integer or `null` when not known. |
| `fenceVersion` | Non-negative safe integer or `null`; Nodes' monotonic lease generation. Existing Sites random tokens remain private. |
| `errorCode` | Allowlisted non-sensitive code or `null`; no raw exceptions, IDs, URLs, tokens, email, account data or provider bodies. |

`succeeded` requires a known successful timestamp. Invalid/missing success evidence cannot produce success. An expired `running` lease becomes `retry_wait` with `lease_lost`. Unknown timestamps/counters remain `null`; a read never manufactures execution evidence. `VERIFIED` in the other shared contracts remains reserved for their original-source evidence. Job success never upgrades `BankAccountEvidence`, `PaymentReference`, `ReportDepositRelationship` or `ReconciliationDecision`.

### Concrete consumers and timestamp sources

- **Sites:** new authenticated `GET /api/import-jobs`, implemented by `sites/lib/import-job-overview.ts::readImportJobStatuses(database, owner, configuration, {now})`. One D1 read batch obtains an owner-scoped snapshot. It does not call acquisition, processing, reconciliation or backup writers. There is no POST/activation route. The response contains `{contractVersion, observedAt, jobs, bankgiroPreparation}`; `observedAt` is a read timestamp, never a run timestamp.
- **Node:** existing `/api/settings` scheduler summary retains its old fields and adds `scheduler.jobs[].jobStatus`; `/api/gmail/status` also carries the existing job summary with its additive `jobStatus`. `src/integration-jobs.js` imports the same serializer. The additive table upgrade and exact lease API are documented in [Node orchestration](node-job-orchestration.md).
- **Bank:** last attempt is the newest fenced `bank.job.started` receipt or existing automatic/control attempt timestamp. Last success remains `bank_connections.last_synced_at`, committed with the import/run receipt. A provider error or newer failed attempt cannot advance it.
- **Gmail:** last attempt comes from `gmail_connections.last_attempt`; last success prefers committed `gmail_runs` completed/completed_pending receipts, preserving the legacy successful-fetch fallback. Existing page cursors and aftercheck warnings are unchanged.
- **OCR:** last success is the immutable accepted `document_extractions.created_at` receipt with worker-v3 provenance and the current owned original hash. It survives retry/failure and is not advanced by later registration or aftercheck updates. A receipt proves accepted OCR output, not a registered or paid invoice. Separately stored attempt timestamps do not exist in the legacy queue; `lastAttemptAt` remains null, rather than reusing `updated_at` or worker heartbeats.
- **Backup:** last success is the latest complete snapshot's `finished_at`, even when a newer daily job fails. Its step retries do not have a separate persistent attempt-start timestamp, so `lastAttemptAt` is null. `created_at` is daily-job creation and `updated_at` is progress; neither is relabelled as the latest retry.

Existing Sites bank and Gmail locks also cover OAuth/account operations and do not bind their token to a public attempt receipt. A live generic owner lock therefore **does not produce `running:true`** for these two projections. An unresolved newer attempt with such a lock is `retry_wait / worker_unconfirmed`; its generic exclusivity expiry remains visible. Node, document and backup jobs have a scope-bound lease and can report `running`. This conservative reporting limitation changes no locking or fetch behavior. A future reviewed source integration may add a durable attempt-to-generation binding.

A future retry deadline alone also does not prove rate limiting: the legacy fields cover provider unavailability and local transient backoff. These Sites projections preserve `retry_wait` and the known eligibility timestamp with `errorCode:null` when the cause is not established. Node may expose an allowlisted rate-limit code recorded for its actual attempt. Persisted failure counts and an explicit retry state take precedence over equal or regressed attempt/success clocks; the earlier committed success remains visible.

### Privacy-safe operational receipts

Bank adds `bank.job.started`, `bank.job.completed` and `bank.job.failed` to existing owner-bound `audit_events`. Detail is generated `run_id`, mode (`automatic`, `manual`, `control`) and an allowlisted error code for failure. Completion is part of the successful import transaction; lost replies use its durable owner/run receipt. Audit failure must not erase a provider cooldown. No provider body, account number, payer, reference, credential or raw exception is added to these events.

OCR adds `extraction.processing.run_id`, a one-way owner/document/lease digest, to the existing worker-v3 provenance. It fences overlapping replies without retaining the lease credential. A new lease can produce a fresh result; repeated responses for the same lease cannot create another accepted receipt or replace its result.

## Observed schedulers (read-only inventory)

On 2026-11-02, ChatGPT Automations and the existing Site's linked automation list returned the **same three IDs**, not six independent schedules:

| Work | Existing schedule, Europe/Stockholm | Owner / entrypoint | Observed identity |
| --- | --- | --- | --- |
| Gmail fetch and document processing | Hourly, minute 00 | ChatGPT task linked to Sites; `gmail_auto_sync`. | `Automation_6efa3aafab4081918c48001acc562f96` |
| Swedbank AIS | 03:06, 09:06, 15:06, 21:06 daily | ChatGPT task linked to Sites; `bank_auto_sync`, then status. | `Automation_42c8434b303c819199621e83f4b8fec1` |
| Encrypted backup | 02:15 daily | ChatGPT task linked to Sites; bounded `backup_step`, then status. | `Automation_c8747435cd908191bc323aabc2a5704d` |
| Cloud OCR | GitHub Actions cron `7,22,37,52 * * * *` (UTC) | Main only, `MG_CLOUD_OCR_ENABLED == 'true'`, concurrency group `sites-cloud-ocr`, at most six leased documents. The workflow file proves configured code, not current repository-variable value or live completion. | `.github/workflows/sites-cloud-ocr.yml` |
| Self-hosted Node | Existing 60-second timer | Saved bank/Gmail intervals, backup and existing queue. This is a separate installation, not a second writer to Sites data. | `src/server.js` |

Site identity was read from `sites/.openai/hosting.json`; existing version 57 and the three enabled linked schedules were observed. No schedule was created, enabled, paused, edited or run by this work. Enabled external tasks and in-app pause/consent/worker readiness are separate controls.

## Coordination with source owners (Agents 2 and 3)

- Agent 2 keeps bank acquisition, provider contracts, consent and selected-account evidence authoritative. Agent 5 wraps/projections use existing leases and stored retry deadlines. No provider endpoint or field is introduced.
- Agent 3 supplies the future authorized Bankgiro report source. The preparation interface is an **internal adapter contract**, not a claim about a bank/provider API. A server-registered adapter must freshly verify authorization and report-download capability for the exact owner/source. Browser-supplied flags, AIS connectivity, uploaded spreadsheets or a manually attested account/report relationship cannot enable scheduled downloading.
- The Bankgiro plan remains disabled until that integration exists and passes its gate. It never creates an external automation. Reuse the existing canonical original-retention/import path and idempotency keys; do not start another economic flow.
- Shared changes are proposed in this PR. The integration owner must review concurrent source-agent PRs before merging; no other conversation is presumed to have accepted a contract solely because this document exists.

The coordinator's `mgeorge-integration-v1` contract in [PR #22](https://github.com/sharbel0022/Mgeorge/pull/22), reviewed head `75418773829e49e99bf7db64c34e8e0ba8577af2`, was read and its merge `b65273500c214a4e16b880e3840dac90d8bd7401` incorporated. A coordination comment there announces these exact additive surfaces and requests Agent 3's concrete source mapping. No source-agent API is silently renamed. High-collision edits are limited to orchestration hunks in `src/server.js`, `sites/lib/banking/service.ts` and `sites/lib/document-processing.ts`; the financial engines and shared workspace schema are unchanged.

### Required C2/C5 merge coordination

Read-only review of Agent 2's `feature/mgeorge-swedbank-account-evidence` at `8839807303ff32e7a160d08d7e3575919371ed15` found an actual semantic collision. C2 calls `lease.success()` inside its new `storeTransactions(..., guard, beforeCommit)` callback, then invokes a guard that calls `lease.assert()`. It also uses the lease for postprocessing after success. C5 makes success terminal and rejects those later assertions/writes, so a naïve merge would roll back the Node import. The integration owner and C2 must agree an atomic completion/final-guard boundary and a distinct aftercheck lifecycle. Preserve terminal write protection, owner/generation/expiry and consent checks; neither weakening the generic guard nor dropping C2's final bank check is an acceptable resolution. Require a combined synthetic committed-import/lost-reply/aftercheck-failure/replacement-lease regression before merging the two workstreams. This dependency is announced in [the contract coordination thread](https://github.com/sharbel0022/Mgeorge/pull/22#issuecomment-6589907548); C2's branch is not included or modified here.

The Sites merge must retain C2's guarded provider reads, current-connection/session checks and account-evidence cooldown together with C5's safe job receipts and essential-state fallback. C5's exact committed-run recovery must precede stale-lease rejection. C2's recipient-account evidence does not grant Bankgiro report-download capability. The later C2 head `9dcf038567102514a14774b301cfa0078274b31b` changes documentation only; the lifecycle collision remains present there.

### Published C3 source mapping

C3 subsequently published [its concrete source contract](https://github.com/sharbel0022/Mgeorge/blob/5c9b51bc12c0c7b37df07b0c8061e9b6313189f6/docs/integration/bankgiro-source.md) at `5c9b51bc12c0c7b37df07b0c8061e9b6313189f6`. It supplies `authorize({owner, signal})`, `listReports({owner, authorization, cursor, limit, signal})` and `fetchReport({owner, authorization, report, signal})`. Its authorization contains `status`, `owner`, `sourceId`, `scopeId`, `generation`, `validUntil` and `evidenceId`. These are the actual published internal interfaces, not bank API claims.

| C5 preparation boundary | Required reviewed C3 mapping |
| --- | --- |
| `verifySource({owner, sourceId})` | Bounded `authorize` call with exact owner/source validation; retain C3 `scopeId` and `generation` through preparation and actual dispatch. |
| Acquisition implementation | Future execution delegates to C3 `runBankgiroSource(owner)` and its existing retention/cursor/lease/deduplication boundaries. Preparation must not call run, list or fetch. |
| `checkedAt`, provider-origin provenance, report-read capability | C3 does not supply these named fields. Agree a fresh authorization receipt and trusted-adapter entitlement mapping; do not fabricate them from `mode:production`, method existence, public `enabled`/`IDLE` or AIS account evidence. |
| Read-only status | C3 `bankgiroSourceStatus(owner)` contacts no source and is not fresh authorization. Its resolver still returns null for every owner; synthetic sources remain excluded from production. |

A direct cast of C3's source into the current C5 adapter is intentionally insufficient. The preparation remains blocked until the wrapper/contract mapping is reviewed and a real authorized source is registered. C2 and C3 also both propose migration `0016`; the integrator must reconcile their journal/snapshot and C3's filename reference, preserving C3 backup coverage. C5 adds no Sites migration and must not introduce another report queue or timer when these branches are combined.

### Bankgiro preparation interface (proposal for C3/C5)

`sites/lib/bankgiro-import-schedule.js::prepareBankgiroImportSchedule({owner, source, adapters, requestedEnabled, now})` returns a **prepared plan**, not an external schedule or executed job. Defaults are disabled, 60-minute cadence, Europe/Stockholm. The production read endpoint supplies no source and therefore stays blocked.

`source` is the internal `BankgiroSourceRegistration` `{id, adapterId}`. `adapters` must be a server-owned registry. A registered adapter has `verifySource({owner, sourceId})` and a real `readReports` acquisition implementation; preparation never calls `readReports`. `verifySource` resolves a source authorization receipt containing owner, sourceId, status, origin, evidenceId, checkedAt, validUntil and capabilities. These are **internal proposed names**, not fields claimed to exist in a bank API. Ready requires `VERIFIED`, `origin=provider_authorization`, a nonempty evidence receipt, `bankgiro_reports:read`, matching owner/source, a check no more than five minutes old, and unexpired authorization after the awaited verification returns. AIS connectivity and manual report/account attestations do not qualify.

`enabled:true` means that the returned plan passed the requested preparation gate; no setting, scheduler or data is persisted. `externalScheduleCreated` is always false. Any future activation/dispatch must re-evaluate the real adapter's authority and use Agent 3's reviewed canonical source/importer. No real adapter, endpoint, credential or provider response was invented for this delivery.

## Verification and handoff

Final local validation on Node 24.22.1 passed **1,324 Node + 2,399 Sites = 3,723 tests**, with zero failures, skips, cancellations or todos. This includes 77 new Agent 5 cases and the six baseline acceptance cases already merged by the coordinator. Locked installs, 124-file syntax check, TypeScript, exact minimatch mitigation, high-audit gates and production build passed. Full Sites audit retains 16 moderate development findings; no high/critical finding or dependency change was introduced.

The [Agent 5 delivery report](agent-5-automation-orchestration.md) records commands, initial failed validation attempts and their resolution, the independent review, exact integration dependencies and limits. The owning PR metadata and delivery comment identify the frozen commit and exact-head CI receipt; a Git commit does not claim its own unknown SHA. Only synthetic data are used. No real invoices, allocations, customer messages, payments, BankID or access-control changes are part of these tests.
