# Agent 4 — commercial SaaS architecture hardening

Date: 2026-11-05. Branch: `feature/95-saas`. Original base: `4ad205b`.

Delivery: [PR #50 against main](https://github.com/sharbel0022/Mgeorge/pull/50). After the first complete SaaS verification, concurrent main work from PR #48 (`bf24a3c52ffc637d1e7bbc4d4f64a1732dcd9fee`) was integrated into this branch. The two verification phases are distinguished below.

### Integration review with PR49 — 2026-11-05

The original producer head is `59e6f8f76617ba64903ff9afeeb8837248d3b653`. The pre-main verification receipt and 5,721 full-suite count below describe that head's source fingerprints. The producer's later main-integration receipt at `cb28f3978d2b7973893492313e0440c2209db59c` is retained separately; it does not include this PR49 synthesis. Independent integration review reproduced two remaining cases: losing a returned consent handle when its first persistence fails, and blocking a definitive rejected consent POST as though creation were uncertain. The combined implementation retains PR49 (`9a531daf4eb09a36d9212d4a38e7eef7fa251b28`) as a dependency and preserves its HTTP/provider ambiguity classification and known-handle fallback.

A fresh start never replaces known or uncertain authority. Explicit renewal or disconnection performs confirmed cleanup; normal cancellation, ambiguous DELETE and lost revocation replies remain recoverable through those actions. Definitive non-creation records `retrySafe: true` without rewriting the attempted `consentCreation: pending` phase or erasing its request/authorization correlation. Unknown creation stays blocked across new runtimes and request keys. Regression error assertions use the more precise `CONSENT_RECOVERY_REQUIRED` for missing unknown handles; all no-call/no-new-POST and retained-handle requirements remain in force. New tests exercise both review findings and the browser action gate. New combined-tree CI is required; earlier green checks do not certify the merge.

This delivery strengthens the integrated company architecture and repairs concrete consent-recovery defects. It does not certify commercial launch or a real bank connection. No deployment, production migration, original transfer, production consent or BankID operation is part of this work.

## Changes and their effect

The shared lifecycle previously allowed a failed or cancelled authorisation to be replaced while discarding its known remote consent handle. A fresh start is now blocked until explicit renewal or disconnection confirms deletion of that retained consent. An uncertain DELETE keeps the handle and `revocation_pending`, blocks replacement and permits a safe retry of the cleanup operation. Losing the reply after confirmed revocation was committed no longer strands the same idempotency key.

Creation has a durable phase in the existing encrypted JSON payload: `consentCreation` is `not_started`, `pending` or `known`. The `pending` phase is saved before the provider POST. If no handle returns and the outcome is uncertain, new creation and pretend revocation are blocked, and the browser tells the administrator to establish the provider outcome. A definite rejection records explicit retry safety while retaining the attempted phase. A returned handle survives a transient first persistence failure when the guarded fallback write succeeds. Existing unfinished records without creation evidence are treated conservatively. A failure before creation remains retryable; an attempt interrupted before creation can restart once its local attempt expires. Disconnecting a never-created consent cannot corrupt that safe retry state.

Expired redirects no longer present an actionable pending redirect. A known retained consent exposes renewal/cleanup; no local clock or callback parameter certifies approval. An expired attempt that provably never created a consent is projected without a bank connection so that the existing browser connect button and click-time authorization gate allow safe recovery.

New tests exercise the actual `OpenPaymentsProvider` adapter, AES-bound resource handles, lifecycle and browser contract using synthetic HTTP transport; no external provider endpoint is called. Two verified contexts use the same bank and the same provider resource IDs with different accounts: foreign account selection is refused, consent identities differ, and disconnecting one company leaves the other's state and sync authority unchanged.

The complete Node route census also reproduced two read-role defects. A viewer could not read bank status or export because these GET handlers attempted ordinary database writes. Bank status now projects expired/lost-session flow states without changing retained rows, and checks the authoritative control database for browser sessions. This also repairs the false `session_lost` result for a live company login whose partition contains no login sessions.

Export retains its audit trail through a no-argument `recordDataExport` capability. It checks the live read scope, company boundary, membership and session under synchronous catalog/partition locks, and can only append the fixed `data_exported` event with server-derived actor/company metadata. Ordinary SQL and financial writes remain denied to viewers. Six new real HTTP regressions exercise success, original flow preservation, foreign/stale selectors, denied writes and revocation before the audit boundary; existing local-mode and bank-consent HTTP tests are strengthened as well.

## Architecture and role contract retained

Node uses a control catalog and a physically separate SQLite partition per company. Sites uses immutable company/storage-owner bindings, transaction-bound D1 authorization and owner-prefixed R2 originals. The actor, company, storage owner and bank PSU remain separate identities. Browser selection does not establish membership or legal authority.

| Action | Owner | Admin | Accountant | Viewer |
| --- | --- | --- | --- | --- |
| Read company records | Yes | Yes | Yes | Yes |
| Write financial/application records | Yes | Yes | Yes | No |
| Manage bank/Gmail integrations | Yes | Yes | No | No |
| Manage company/reference settings | Yes | Yes | No | No |
| Manage memberships | Yes | No | No | No |
| Restore company backup | Yes | No | No | No |

Role changes advance authorization versions. Database writes and late asynchronous results recheck current membership and context. Last-owner protection and worker-grant versioning remain in force. Automatic sync retains company/account leases, provider budgets, durable receipts, consent checks and the existing scheduler.

## Requested scope and evidence

| Requirement | Delivery / verification | Practical limit |
| --- | --- | --- |
| 1. Review multitenancy | Separate Node and Sites source audits; preserve the existing authoritative catalog and storage boundaries. | Source review is not a deployed-infrastructure penetration test. |
| 2. Isolate accounts, invoices, payments, originals and jobs | Existing three-company acceptance uses colliding IDs, independent original bytes, encrypted state, caches, jobs and backups. | Synthetic fixtures do not establish production data/permission inventory. |
| 3. Consistent API boundaries | Complete Node and Sites route inventories trace data access to company, actor or worker authorization; the Node read-role failures found during the census are repaired. | Dedicated exhaustive role/IDOR permutations do not exist for every endpoint; the inventories name shared/service coverage precisely. |
| 4. Roles and membership | Existing four-role contract, last-owner protection and version invalidation retained; viewer bank status/export fixed without generic write authority. | Node membership/provisioning remains a trusted control-plane API. |
| 5. Several companies per user | Membership directory, explicit selection, stale-context rejection and late-response checks are exercised in existing acceptance tests. | Public Node multi-user registration remains absent. |
| 6. Session, CSRF, state and redirect | Existing real HTTP/request tests cover origin, actor/session pins, replay and context changes; Node status now reads the correct session store. | Real ingress and provider navigation require deployment acceptance. |
| 7. Consent lifecycle | Retained-handle cleanup, ambiguous DELETE, unknown POST outcome, expired authorization and crash recovery have new regressions. | Unknown remote creation requires provider-assisted reconciliation and a reviewed operator procedure. |
| 8. Onboarding and reconnect | Expired redirects stop being actionable; safe pre-POST recovery passes the actual browser parser/action gate; unknown creation has an explicit UI notice. | No real BankID or SCA journey was performed. |
| 9. Company-bound automatic imports | Existing Node/Sites schedulers, company/account leases, budgets, receipts and revocation fences reviewed and tested. | Actual schedules, quotas and successful production runs remain external evidence. |
| 10. Cross-tenant IDOR and concurrency | Real SQLite/D1-boundary acceptance, three-company collisions, 30 simultaneous same-account claims and 1/10/100-company scale fixtures. | D1/R2/provider infrastructure is synthetic where documented by the fixtures. |
| 11. Same bank, different accounts | New shared-provider regression uses two companies, the same bank and identical remote IDs; account selection and revocation remain independent. | Customer-specific bank entitlement is not inferred from the fixture. |
| 12. Commercial operations | Sourced launch requirements, recovery runbook, migration/rollback control, API inventories and a machine-readable verification receipt. | Contracts, legal classification, real corporate access and release activation are not approved by this PR. |

## Customer journey: what is available and what is not established

| Stage | Current implementation | Required real-world evidence |
| --- | --- | --- |
| Sign in | Sites authenticates through ChatGPT. | Production audience/session configuration and customer accessibility acceptance. |
| Create/select company | Authenticated creation of a separate empty workspace; membership-based selection. | Legal entity and representative checks are separate from workspace creation. |
| Select bank and read scope | Existing bank onboarding UI and server-controlled capabilities. | Customer/bank/provider capability and permitted SaaS use. |
| Bank authorisation | Provider redirect, state/session/company binding and callback validation. | Actual approved bank SCA, including BankID only where the provider/bank offers it. |
| Select accounts | Provider-confirmed accounts and explicit scoped selection. | Correct corporate account access for the real customer. |
| First overview and background sync | Existing company-bound import, original preservation and reconciliation. | Successful authorised first import, confirmed quotas, scheduler observation and independent reference evidence. |
| Reconnect/revoke | Recovery repairs described above; ambiguous operations remain blocked. | Provider-supported handling of unknown creation outcomes and real revocation acceptance. |

**Node public identity limitation:** its HTTPS password login still creates the single principal `administrator`, and settings declare `user_mode: 'single_administrator'`. Multiple distinct actors in Node acceptance tests are established through trusted test/operator setup. Public registration, invitation acceptance and independent-user authentication are not implemented in that runtime. It must not be offered as a public multi-customer SaaS entry point on the strength of downstream tenant tests. A separately reviewed identity/onboarding adapter is required for that deployment model. This iteration preserves the trusted control-plane restrictions.

Sites empty-workspace creation does not adopt historical M.George records and does not prove representation of an existing organisation. The new corporate bank flow still requires trusted registration, real contracts, corporate scope, verified redirect/certificate setup and customer authorization.

## Migration and rollback control

- No SQL migration, ORM schema, migration journal or existing original format changes in this branch.
- The lifecycle phase is additive metadata within the already encrypted `saas_bank_state` payload. Older active records with a retained handle continue to work. Older unfinished records without a handle cannot be classified as safe automatically.
- Existing upgrade tests apply the real migrations over retained synthetic legacy records and verify preservation. Company-bound backup tests preserve original bytes and reject another company's destination. A legacy workspace cannot be silently adopted by creating a new company.
- Tenant-aware production databases must never be reopened with an older tenant-unaware application. For rollback of these recovery changes, disable new SaaS bank starts first and reconcile any unknown/unfinished attempts; an older version lacks the new unknown-creation guard. Preserve the encrypted payload and all originals.
- Unknown creation recovery is an operator incident: retain company/connection/request correlation privately, establish the outcome with the authorised provider, and use a reviewed recovery operation only with that evidence. Do not delete state, change `pending` to `not_started`, fabricate a handle or mark a consent revoked because its local timer expired. No automatic reset endpoint is provided.

## Verification record

The first complete SaaS verification, commands, source fingerprints and log hashes are recorded in [the pre-main-integration receipt](evidence/2026-11-05/95-saas-verification.json). Local runtime: Linux, Node `v24.22.1`, npm `11.9.0`. These full-suite counts belong to the SaaS changes on `4ad205b`, before adding PR #48's incoming cases.

| Complete suite before concurrent main integration | Passed | Failed / skipped / cancelled / TODO |
| --- | ---: | --- |
| Node, after the read-role repair | 1,905 | 0 / 0 / 0 / 0 |
| Sites | 3,769 | 0 / 0 / 0 / 0 |
| Bankgiro bridge | 47 | 0 / 0 / 0 / 0 |
| **Total** | **5,721** | **0 / 0 / 0 / 0** |

Root syntax, Sites TypeScript, bridge syntax, the exact installed minimatch mitigation, all required high-severity audit gates and the Sites production build pass. Root, bridge and Sites production dependencies have zero audit findings. The full Sites audit retains eight moderate development-dependency findings and no high/critical findings; dependencies and lockfiles are unchanged.

The complete Sites suite, type check and successful serial build ran before the later Node-only read-flow repair. All 576 tracked/untracked nonignored Sites files have the same SHA-256 tree fingerprint afterward. The final complete Node suite and syntax check ran after that repair. The receipt preserves both whole-repository fingerprints rather than relabeling the earlier Sites execution as a later whole-tree run. Exact Node 22 PR checks are reported by GitHub for the pushed commit.

### Concurrent main integration and final PR checks

PR #48 introduced separate document/search/recovery work while this delivery was being verified. Its merge from `bf24a3c` was clean; the overlapping Node server change only adds the public workspace-search asset and preserves the new company read fixes. The incoming bank/tenant changes and the new `/api/bank/revalidate` route were reviewed separately. That route and its MCP equivalent require an eligible unbound legacy workspace; owner/admin company membership cannot use them to bypass the SaaS flow.

The [integration receipt](evidence/2026-11-05/95-saas-integration.json) records the combined code fingerprint: **155 Node + 419 Sites = 574 targeted tests passed**, no failures/skips/cancellations/TODO. Root syntax, Sites TypeScript and a new serial Sites production build also pass on that combined fingerprint. The complete Node 22 suites and production build for the final combined commit are reported in [PR #50 checks](https://github.com/sharbel0022/Mgeorge/pull/50/checks). The 5,721 pre-integration count above is not presented as the count for PR #48's additional cases or the combined tree.

Targeted runs completed in this development cycle (these overlap the complete suites):

| Scope | Result | Meaning |
| --- | --- | --- |
| Node migration, partition, durable jobs and three-company acceptance | 42 passed | Synthetic real SQLite data, overlap selectors, leases, original preservation and backup boundary checks. |
| Sites migration, storage, backups, three-company acceptance and scale | 55 passed | Actual SQL and synthetic R2; includes 1, 10 and 100 isolated companies with up to five concurrent jobs. |
| Shared lifecycle/runtime/expiry/UI/client targeted suite | 60 passed after review repair | Includes regression repairs and existing neighbouring cases; not added to full-suite totals. |
| Node read-role / HTTP / company / session targeted suite | 112 passed | Includes six new HTTP regressions and existing adjacent bank, session, partition and legacy tests; overlaps the full Node suite. |
| Independent shared-lifecycle review | One Important issue found and repaired | The safe pre-POST crash recovery was API-only because the browser refused an error connection. A failing regression through the actual snapshot parser/click gate was added and the projection repaired. |
| Independent Node read-flow review | No Critical/Important finding | Reviewer independently passed 40 touched HTTP cases, rejected an out-of-scope audit call, and injected a post-insert authorization failure to verify rollback and release of both locks before a successful retry. |

The first broad Node attempt overlapped an incomplete Sites installation and had six module-load failures (`xlsx` temporarily unavailable). It is not counted as a passing baseline. The first Sites install and a parallel build exited 137. A memory-bounded locked reinstall and a subsequent serial build completed successfully; the failed and successful build attempts have identical input fingerprints. Failed development attempts are retained separately in the receipt and are not counted as passing gates.

The targeted Node and Sites audits identified no additional reproduced isolation bypass. They are source reviews plus the executed acceptance suites, not an independent penetration test or proof that every possible handler condition has been exercised. The [Sites API boundary inventory](API-BOUNDARY-INVENTORY.md) now accounts for all 42 API files plus MCP, including the endpoint added by concurrent main work. The [Node HTTP boundary inventory](NODE-API-BOUNDARY-INVENTORY.md) maps the six pre-company paths, 34 literal business paths, nine object/action patterns and eight SaaS bank subpaths, including the read-role repairs above.

## Commercial activation decision

**Commercial launch remains NOT_APPROVED by this delivery.** Synthetic success is not provider acceptance, legal approval, a production migration receipt or a real customer's BankID signature. [Commercial launch requirements](COMMERCIAL-LAUNCH-REQUIREMENTS.md) list the contractual, regulatory, privacy and operational evidence to obtain.

Existing production-dependent quality scores remain unchanged. The next operational step after review/merge is a separately authorised staging/customer acceptance using verified provider setup and isolated company data; production activation requires the documented launch gates. This branch is delivered for PR review and does not change production feature flags or create consent on anyone's behalf.
