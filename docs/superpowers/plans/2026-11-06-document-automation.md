# Gmail and OCR automation reliability implementation plan

**Goal:** Make each bounded Gmail/OCR run observable and recoverable without modifying production schedules, customer data or the AI model adapter.

**Base:** f3c80629d4856c2f8ecbb1ed81be391a13ac6be8 (main, verified through GitHub).
**Branch:** feature/95-document-automation. Deliver a pull request to main; no merge or deployment.

## Design decisions

Extend the existing owner-scoped D1 queue and its atomic registration fences. A new queue service or a second scheduler would add migration and operating risk without fixing the observed dispatch gap. Keep three extraction attempts, existing original hashes, counterparty verification and financial checks. A durable accepted extraction is evidence of saved work, not permission to register a financial liability.

The new optional worker protocol advertises version 2 in the lease response. It adds bounded lease heartbeats and a receipt lookup authenticated by the same worker, owner, runner and lease. Old workers and old servers keep their existing protocol. No AI model adapter is changed.

Gmail runs return correlation receipts for the actual app invocation. A task platform's no_update or an active configuration is never treated as proof that the app ran. Historical scheduler attribution remains unknown without corresponding platform and app receipts.

## Tasks

- [x] Reproduce worker result acknowledgement loss and verify a receipt-aware client with at most three completion sends. Never re-extract an already accepted result. Respect authentication failures, rate limits and Retry-After.
- [x] Preserve accepted extraction receipts after interruption on every attempt; add bounded heartbeats, receipt lookup and transport/integrity separation without weakening original or registration checks.
- [x] Return and expose correlated Gmail invocation receipts, and replace unbounded historical source-ID materialization with bounded, owner-scoped membership lookups in both runtimes.
- [x] Verify restart, timeout, competing workers, stale leases, rejected originals, acknowledgement loss and non-green outcomes with synthetic tests, then independently review the combined branch (final CI review tracked on PR 67).
- [x] Document the adapter contract, operator recovery procedure, exact CI jobs and remaining external scheduler evidence. Open PR to main.

## Protocol contract

Lease version 2 keeps id, lease, mime, size and sha256 and adds protocol:2, run_id and lease_until. run_id is the existing hash of owner, document and lease; no live credential enters receipt history.

POST heartbeat accepts id, lease and sha256. It may extend only a live, unrecorded lease belonging to the authenticated runner and active source. It never shortens the lease, never revives an expired or replaced lease, and cannot exceed ten minutes from claim time. It returns ok, run_id and lease_until.

POST receipt accepts the same identifiers. A saved result returns accepted:true, settled, state, run_id, id, sha256 and accepted_at. Only a matching terminal job is settled. No accepted result plus an unchanged live lease returns accepted:false, retryable:true and matching identifiers. Other cases reject or remain explicitly uncertain. The client does not retry after a receipt says accepted.

Temporary storage or transport failure is not evidence of original corruption or bad OCR. A real size/hash mismatch remains a hard integrity error. Recovery of interrupted accepted work goes to human review, never to automatic financial approval.

## Review focus

- Delayed acknowledgements crossing a lease replacement must not change the replacement job.
- A saved result whose final transition fails must remain recoverable on attempt one as well as the final attempt.
- Heartbeats must stop and remain bounded when extraction, receipt reads or transport fail.
- Gmail deduplication must preserve rejected/registered source decisions without loading all historical rows.
- Missing or partial scheduler receipts must remain unknown; a manual fetch cannot certify a recurring schedule.

## Verification record

Initial unmodified worker baseline: 112/112 passed locally (Node 24.22.1).
The local Sites baseline was interrupted at the process/environment level and is not a pass.
The execution environment subsequently became unavailable. GitHub CI on the PR will be the authoritative fresh verification for the candidate. No customer documents, tokens or production processing are used in tests.

## Execution evidence

The execution environment returned and the combined synthetic focus suites passed: Node 223/223 and Sites 341/341. Independent review findings received dedicated failing tests and repairs. The actual original protocol run ID is a 43-character base64url, preserving existing receipt identity. Production observations, explicit durability limits and the controlled rollout/recovery gates are recorded in ../../automation/document-automation-reliability.md and ../../automation/recovery-runbook.md. The exact candidate's complete CI and approval state are tracked in PR 67; a completed implementation checklist does not claim production deployment or verified external scheduling.
