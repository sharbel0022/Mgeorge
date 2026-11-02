# Agent 3 — automatic Bankgiro ingestion

Branch: `feature/mgeorge-bankgiro-auto-ingest`.

Runtime baseline: `73662187cddf9a5c504dea9bd8a1288bd929bc51`. The feature branch was subsequently fast-forwarded to reviewed integration-contract main `b65273500c214a4e16b880e3840dac90d8bd7401` (PR #22). Those upstream changes were documentation only. The feature is delivered by its own PR; merge and publication belong to Agent 7.

## Outcome and production boundary

An authorized report adapter can deliver originals into the existing import pipeline through a durable, bounded queue. This is implemented and tested with isolated synthetic sources. **The production resolver returns null. No real Bankgiro report feed is configured, fetched or claimed to be working.** Existing manual Excel import remains available.

The blocking external dependencies are the customer's actual Swedbank reporting agreement, permitted entity/account/Bankgiro scope, exact ISO 20022 reporting profile, authorized delivery transport and credentials, host verification, report identity/replay/completeness rules, and an end-to-end verified receipt. A BankID browser robot is not an option. Existing Enable Banking AIS access does not establish this separate entitlement.

The primary-source research, exact adapter contract, `IndividualPayment` mapping and activation requirements are in [bankgiro-source.md](bankgiro-source.md). The shared contract remains [mgeorge-integration-v1](README.md).

## Implementation

The shared worker discovers at most 50 reports in a page and processes at most 10 queued jobs per invocation. Individual provider/sink awaits have a 10-second timeout bounded by the remaining 45-second run budget. Owner-wide leases expire after 120 seconds and guard database writes. A timed-out operation ends the invocation and loses its lease; it cannot keep writing while another report runs.

Original bytes are bounded at 15 MB and checked against the declared SHA-256. Source/report identity and owner/hash are separate deduplication checks. Same-identity/different-byte reports remain retained conflicts without a second financial import. Repeated hashes, alternate names and unknown committed responses reuse existing import receipts. All monetary interpretation stays in the existing parser/domain.

The committed delivery cursor stays behind a report that has not entered an accepted retained-original workflow. A page can be replayed over multiple bounded invocations; the cursor advances only after every descriptor is retained and `IMPORTED`, `REVIEW` or `DUPLICATE`. Explicit delivery gaps survive restart, and late reports are not filtered out by booking date. A missing or empty report page never proves that a payment is absent.

Source and job retry timing survive restart. Rate limits apply to source requests, including authorization probes. A worker re-reads the current embargo after obtaining its lease. A normal future listing poll does not prevent already discovered jobs from progressing.

Sites imports through `readBankgiroOriginal`, `specificationPreview`, `assertPaymentOriginal`, `applyCommand` and `writePaymentState`. Reports without a verified aggregate relation remain review observations. Complete conserved groups may replace the already verified aggregate with individual children, using existing rules. Intake never runs invoice matching, invoice search or allocation.

Node imports through `parseBankFile` and `storeTransactions`, preserving actual original account/currency evidence and existing duplicate/aggregate rules. XLSX and insufficient account/currency evidence remain review records. Bank originals use a distinct document state so invoice automation cannot mistake them for invoices. Existing absence checks may be invalidated by new bank evidence as required by the current import model.

Both sinks check current source authorization, queued identity, original owner/hash, lease and expiry at the write boundary. Sites also preserves workspace revision/CAS and applicable account-consent fencing. Local source configuration/revocation must update the durable source generation/status atomically; a future adapter cannot leave stale local authorization behind.

## Integration surface and shared files

The full signatures and persisted fields are in the source contract. New server routes in both runtimes are `GET /api/bankgiro/source/status` and `POST /api/bankgiro/source/run`. The latter accepts an empty object only. Sites additionally exposes private MCP `bankgiro_source_status` and `bankgiro_auto_ingest` with server-derived owner identity.

The status projection includes source state, safe reason, queue counts, report IDs/status and next permitted time. It excludes opaque cursors, account/scope identifiers, authorization generations, filenames, hashes, originals and credentials. The bank views show disabled, waiting, review and blocked states, with manual Excel as fallback. Reading status never invokes a provider or import.

| Shared area | Minimal change | Integration owner/action |
| --- | --- | --- |
| `src/db.js` | Once-only shared queue migration, owned import receipts, final transaction guard | Agent 7 reviews alongside other database changes |
| `src/server.js` | Authenticated source routes; report step inside existing scheduler timer | Agent 5 composes with existing control steps; no second timer |
| `sites/db/schema.ts`, Drizzle `0016` and metadata | Three additive source/job/lease tables | Agent 7 resolves migration-number collisions before merge |
| Sites backup/export/isolated restore; Node backup integrity | Preserve durable receipts, validate original pointers, retain old-backup compatibility | No live production restore; leases are transient |
| `sites/lib/banking/mcp.ts` | Two additive authenticated tools | Agent 5 may invoke bounded ingestion; no new production schedule configured |
| Dashboard, bank page, layout | Small status component and scoped styles | Agent 6 retains overview/primary-action ownership |

There are no parser, reconciliation-engine, dependency, lockfile, production binding, Site identity or credential changes. `State.schemaVersion` remains 1. The interface proposal is additive; downstream agents must use the reviewed signatures rather than inventing provider fields.

Agent 2 continues to own current bank account evidence. Source `scopeId` is a reporting namespace and never an inferred account alias. Agent 4 continues to own deposit relationships/reference matching and later evidence rechecks. An intake-complete review receipt does not prevent a later authorized domain review of the retained original.

## Regression matrix

| User scenario | Isolated synthetic evidence |
| --- | --- |
| Individual payment | Actual retained CSV/camt parsing, integer öre, exact `0599`, no invoice allocation |
| Multiple payers | Complete two-payer group and conserved aggregate relationship; missing details remain missing |
| Aggregate deposit | Existing parent/child rules; aggregate-only reports and absent AIS relation stay reviewable |
| Repeated report | Same hash, changed filename, alternate source, manual-import receipt, lost commit response |
| Late report | Old booking date delivered through a later source page without being dropped |
| Missing report | Explicit delivery-gap receipt survives restart and is cleared by actual delivery |
| Invalid format | Retained malformed original becomes BLOCKED; invalid page/size/hash cannot create money |
| Rate limit | Retry-After, durable source embargo, delayed contender and queued-job timing |
| Interrupted fetch | Timed-out provider/sink, lost lease, unchanged committed cursor and retained job |
| Automatic resume | New engine/process resumes durable jobs, 50-report page over five bounded runs |
| Authorization/concurrency | Revocation/generation, owner, expiry, same-token lease expiry, CAS, consent and job/original mutation |
| Recovery | New and historical backup schemas, exact original/queue references, isolated restore, empty transient leases |

Test-first reproductions also closed independent-review findings: stale rate-limit reads, timed-out sinks retaining write authority, premature cursor advancement, Node backup omission of queue references, renamed replay after uncertain commit, parser-accepted domain-invalid input, and stale worker updates undoing a locally revoked/replaced source authorization. Public job timestamps were corrected to UTC ISO. The independent reviewers reran their reproductions after each fix and closed the findings. Focused counts are not a substitute for the full gates.

## Verification and delivery receipt

| Local verification | Actual result |
| --- | --- |
| All five Bankgiro-specific Sites suites, final authority-CAS implementation | **93/93 pass**, zero fail/skip/cancel: shared queue 39, Sites service 40, backup 5, MCP 4, status rendering 5 |
| Final Node adapter plus backup-reference integrity suite | **57/57 pass**, zero fail/skip/cancel: adapter 15 and original-reference suite 42; adapter **15/15** rerun passed after the final shared authority-CAS refinement |
| Dashboard/navigation plus new status/MCP regression run | **63/63 pass**, zero fail/skip/cancel; overlaps the feature subsets above |
| Root syntax check | **123 files passed** |
| Sites TypeScript check | Exit **0** after service/API/status changes |
| Final Sites production build | Exit **0**, both new API routes present in the build inventory; no deployment |
| Root dependency audit at required high threshold | **0 findings**, exit 0 |
| Sites dependency audit at required high threshold | **16 moderate, 0 high/critical**, exit 0; no dependency or lockfile changes |
| Migration inventory | Generated Drizzle `0016` and snapshot: 29 Sites tables, including the three new queue tables |
| Independent review | Core/backup races and sink edge cases reproduced then closed; source-revocation races separately verified in six isolated scenarios |

The exact feature head, PR number and **full mandatory Node 22 GitHub CI** receipt are recorded in the PR metadata/checks and final delivery response. That gate performs clean locked installations, both full suites, syntax/TypeScript, both audits, the exact installed minimatch guard and the production build. A feature branch is not ready to merge until those exact-head checks are green. Source and PR identifiers live in GitHub metadata rather than a self-referential commit identifier in this file.

Local full-run limitations are preserved rather than counted as passes. The first Sites run was 2356/2412 passed with 56 failures: 54 existing dashboard/navigation tests could not resolve the newly added child component in their isolated import harnesses. Adding that child to the existing inert-child mapping preserved their assertions and the 63-case rerun passed. Two unchanged minimatch 100k-workload tests reached their existing 55-second subprocess timeout, including a separate rerun (26/28 passed). Their limits/assertions were not changed; the required clean Node 22 CI gate must decide that full-suite outcome. The earlier local root full run was stopped after code refinements and prolonged execution; it is not a passed full gate. Initial unprivileged attempts also encountered local listener/subprocess `EPERM`; later permitted test processes ran the named tests normally.

No merge, deployment or bank activation is performed by this feature branch. Production retrieval remains disabled pending a real authorized source and the integration lead's cumulative review.

## Known limits

- No real bank source, customer agreement, original bank profile or scheduled production execution has been verified.
- Swedbank's MIG index was reachable, but its linked detailed PDFs were not retrieved in the research. The existing generic parser is not certified against a particular customer's exact bank profile.
- A blocked report requires reviewed remediation; there is no client-controlled force/reset/source-configuration API.
- Sources must support stable identities and replay of an unacknowledged page. An adapter whose remote service cannot do so needs a verified staging/receipt design before registration.
- The local authorization-generation fence depends on the future adapter/configuration lifecycle honoring its documented atomic revocation requirement. External bank revocation and a local database commit cannot form one transaction.
- The status view has synthetic rendering tests. This branch does not claim a new authenticated production-browser or physical-device acceptance run.
- Merge, cumulative seven-agent verification, deployment and real bank activation are separate integration steps. No customer message, bank payment or real invoice registration/allocation was performed.
