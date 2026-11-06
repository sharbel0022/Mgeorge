# Document automation operations and recovery

## Scope and release boundary

This branch changes code and synthetic tests only. It does not change any live automation, OAuth consent, worker token, counterparty decision, invoice, payment or deployment. A merged commit and a Site deployment are different events. Passing CI does not prove recurring production execution.

The operator must use the approved deployment process and the exact reviewed source. Do not activate a second schedule to conceal a missing dispatch receipt.

## What proves a run

Keep the scheduler's run ID, scheduled time, start/end and code SHA together with the app invocation run ID and persisted result. A saved task definition, configuration flag, worker contact time or no_update result is insufficient. If the task platform returns older latest_result text, first compare its run ID and creation time with the latest run.

Gmail receipts identify the actual owner-authorized app call. They cannot identify which external scheduler called it. The app must continue to show external_schedule_verified:false until an independent platform-to-app correlation exists.

For OCR, a lease run ID binds owner, original and lease. An accepted receipt proves durable storage. Only its matching terminal state proves completion. accepted_pending is an interruption needing recovery; it is not a failed interpretation and not a completed or financially approved invoice.

## Failure classes

| Observation | Meaning | Next safe action |
| --- | --- | --- |
| 401/403, revoked consent, wrong owner/runner | Authentication or scope failure | Stop and restore authorization through the normal owner flow. |
| 429 or Retry-After | Provider-requested delay | Do not poll or resend immediately; observe the durable retry deadline. |
| Network/5xx or interrupted response | Transport outcome may be uncertain | Query the matching receipt; retry only the same payload while its lease remains valid and within the fixed budget. |
| Original hash/size mismatch | Integrity failure | Stop automatic registration and keep the original/evidence for review. |
| Extractor failure | OCR/PDF execution failure | Use the existing bounded attempt budget and backoff. |
| Missing invoice fields or unverified counterparty | Insufficient document evidence | Keep needs_review; no repeated automatic attempt can substitute for missing facts. |
| Accepted extraction, unfinished continuation | Saved result requiring recovery | Preserve history and recover to human review. Do not invoke the model again for that accepted run. |
| Registration after-check pending | The invoice commit already exists | Resume the authorized after-check; never insert another invoice or undo the committed outcome. |

## Controlled recovery procedure

1. Read gmail_sync_status and record the observation timestamp, queue states, active/expired leases, deferred/exhausted counts, oldest pending item and 24-hour throughput. This is read-only; no batch processing is needed for the preflight.
2. Verify the intended code SHA, passing checks, deployment provenance and worker authorization separately. Confirm the existing production schedule and its enabled state without modifying them.
3. Under the approved operating procedure, run one bounded worker pass. The cloud path may process up to two native PDFs plus at most six leased OCR originals. A smaller maxJobs limits leased OCR only; it does not remove the PDF pre-pass.
4. Record accepted, pending and failed outcomes independently. Stop on authentication loss, original corruption, unknown receipt state, a server retry deadline or an unexpected financial change.
5. Read status again in a separate call. Compare actual terminal documents and receipts, not just the number of requests. Review and missing-information counts may legitimately grow when queued documents are interpreted.
6. For an exhausted or review document, require an explicit document-scoped retry through the existing API. Preserve its source, original SHA, extraction history and all counterparty/financial guards. Do not reset the whole queue with SQL, clear registrations, raise retries indefinitely or mass-approve facts.
7. Observe multiple actual scheduled occurrences before accepting recurring reliability. Missing dispatch remains an external operations issue even if a manual bounded worker pass succeeds.

## Contract with the future AI adapter

The worker supplies verified original bytes and MIME. The adapter supplies a bounded text extraction with method and confidence; optional OCR evidence must remain tied to the same text and original hash. It must have a finite execution deadline, bounded memory, redacted errors and cancellation handling appropriate to its provider.

The adapter does not receive authority to overwrite id, lease, run_id, owner or sha256; it does not register invoices, choose counterparties, mark payments or mutate queue state. The server rechecks originals, interprets fields and applies the same economic rules.

A model's confidence is not an original, identity or bank-evidence check. Missing fields and conflicts remain needs_review. Model/provider retry policy must not create a nested unbounded retry loop: the adapter's provider attempts and the worker's result-upload retries are separate bounded budgets.

No OpenAI model adapter is changed in this PR. Agent 1 should consume this boundary and coordinate any new structured failure types before changing the extraction interface.

## Exact version 2 wire contract

The retained lease identity is {id, lease, sha256}. id is an ASCII document identifier of 1–100 characters; lease is a 43-character base64url token; sha256 is 64 lowercase hexadecimal characters. run_id is the **existing SHA-256 digest encoded as 43 base64url characters**, derived from owner, document and lease. It is an opaque correlation value, never a replacement credential.

- POST /api/ocr-worker/lease returns job:null or the legacy fields plus protocol:2, run_id and a canonical ISO-8601 lease_until.
- POST /api/ocr-worker/heartbeat accepts only the same identity for this owner/runner. Its body is read with a 4096-byte streaming limit. It returns ok:true, run_id and lease_until. Renewal is conditional on the still-live, unrecorded lease and unchanged original metadata, never changes attempts or claim time, and cannot run past ten minutes from claim.
- POST /api/ocr-worker/receipt uses the same body and limit. Accepted history returns accepted:true, settled, state, id, sha256, run_id, accepted_at; no extracted text or live lease is returned. Settlement requires the current result's run, runner and hash as well as a terminal state. An old receipt does not settle a replacement run.
- No accepted receipt plus the same live unrecorded lease returns accepted:false, retryable:true with id, sha256 and run_id. Replaced/expired leases and wrong digests or runners return a conflict, not permission to resend.
- POST /api/ocr-worker/complete retains the existing input and financial checks. Legacy completion replay remains rejected. Original storage unavailability returns 503 with Retry-After:60 and keeps the live job unchanged; proven size/hash corruption uses the existing bounded integrity-failure path.

The client starts an authenticated heartbeat before download and then uses one non-overlapping timer at 30-second intervals. It retries a transient heartbeat once after 250 ms. It stops for auth, ownership, rate-limit, redirect or Retry-After responses. The last heartbeat is joined before completion. Validated receipt decisions use private object identity; JSON fields named receipt_accepted or accepted_pending cannot manufacture a success.

Completion has at most three sends of the same immutable result, with exponential 250/500 ms backoff plus up to 249 ms jitter and a fresh receipt/lease check before another send. A receipt that says accepted ends resubmission even when continuation is pending. Extraction runs once per client lease, not once per completion send.

An expired accepted result recovers at every attempt. Each normal recovery pass examines at most two jobs; claim checks also protect an accepted candidate beyond that batch. Successful recovery goes to review and preserves history. Temporary original-read recovery is delayed at least 60 seconds, consumes no extra OCR attempt, and stops automatic retries after 24 hours from immutable acceptance time. It then stays in review with original_unavailable_review; integrity and missing-history defects are held as failed with their original evidence.

The durability guarantee starts at the database's accepted receipt. A process killed before any successful upload can require another extraction of the retained original. There is no durable cross-run client outbox in this change. The client can stop logically on lease loss while its existing extraction subprocess continues until its finite 90-second deadline; this does not authorize a later completion. These limits must also be respected by Agent 1's future adapter.

## Gmail receipt and membership contract

Scheduled Gmail responses, including safe error responses, include automation_receipt with run_id, invoked_at, completed_at, outcome and persisted. The first invocation record must persist before any provider work begins. persisted:true means both invocation and result observations were stored. With persisted:false, completed_at is only the local attempt's end time; it is not a durable completion proof. Preserve observation_warning and inspect status again.

schedule_observation.last_run_id and last_finished_at refer to the latest invocation and its matching result. last_completed_at remains historical successful completion and may belong to an older run. external_schedule_verified stays false because the application does not know which external scheduler caused an authorized call.

Both Gmail adapters support lookupSources(ids) returning {knownIds, rejectedIds}. At most 50 IDs encountered in current messages enter one lookup. Sites queries by owner and source_id without a status filter; Node uses its existing company-scoped database. Registered/rejected/review sources keep their decisions. A failed or malformed lookup must not advance the checkpoint. Existing message, part, attachment, byte, pagination and 120-second budgets remain active; the deadline is rechecked after each lookup. The extreme Sites bound can require up to 100 membership queries, so deployment quota must be checked rather than assumed.

## Release and rollback gates

1. Review the complete PR and exact source SHA; require every mandatory quality and security job to pass on that candidate.
2. Deploy through the existing approved process, retaining the same Site, D1, R2, grants and schedules. No migration or new secret is required.
3. Verify the deployed Sites source and worker SHA separately. The optional protocol supports either deployment order; older workers ignore added lease fields and newer workers retain the legacy path with older servers.
4. Inspect a bounded ordinary run and compare its receipt with app status and the original hash/registration evidence. This procedure is prepared here; it was not executed against production.
5. Observe at least two actual scheduled occurrences with matching platform and app receipts. The existence of a cron definition is insufficient.
6. On a new integrity, attribution, authorization or unexpected finance failure, stop the affected run through the approved operating process. Roll code back to the last verified version if required; retain all originals, accepted history and registration markers. Never roll data back merely to erase an uncertain acknowledgement.
