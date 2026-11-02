# Agent 2 — Swedbank/account-evidence verification

Date: 2026-11-02. Branch: `feature/mgeorge-swedbank-account-evidence`. Delivery: [PR #25](https://github.com/sharbel0022/Mgeorge/pull/25).
Runtime baseline: `73662187cddf9a5c504dea9bd8a1288bd929bc51`.
Integration base refreshed through shared-contract PR #22, report/synthetic acceptance PR #23 and receipt PR #24 to `a779b0dd8d184eaf6e6d6e636c555c967f15f3d5`. These updates preserve production code. The receipt's two progress-file conflicts were resolved by retaining both complete sections in a normal merge into this feature branch. The final PR head is the authoritative delivery commit; this report and the contract travel with that head.

## Delivered scope

- Node live-consent validation now checks bank, country, business PSU, selected account and the earliest stored/live expiry through pages and commit.
- Node originals/import rows, coverage, successful sync audit and job success commit in one SQLite transaction. Failure after that commit returns successful import plus a bounded follow-up warning, instead of inviting a duplicate retry of a supposedly failed import.
- Sites account reads share the existing owner lease. A separate durable account-read guard retains known, unknown and manual provider waits independently of the transaction scheduler fallback.
- Session/transaction/account reads persist a pending marker before contacting the provider. Failed result persistence, lost lease or process interruption cannot erase an observed or unresolved throttle. Successful sync cannot clear an older unresolved wait.
- The additive `BankAccountEvidence` v1 projection proves only current recipient-account identity. The exact contract, provider fields, migration, API changes and Agent 3/4 handoff are in [bank-account-evidence.md](bank-account-evidence.md).
- Optional provider `account_id` is accepted without inventing a number. A real returned alias can be tied to the same account through exact singular bank-provided hash continuity; fuzzy plural hashes are insufficient.
- Existing incremental windows, bounded date recovery, continuation, stable deduplication, raw JSON and SHA-256 preservation remain in use. No second banking or reconciliation engine was introduced.

## Shared files and integration requirements

Node shared edits: `src/server.js`, `src/db.js`, `src/bank.js`. `storeTransactions` has an optional sixth synchronous `beforeCommit` callback; existing callers retain their behavior. A failed callback or final authorization guard rolls back the import. The new optional sync `warnings` array reports committed imports with incomplete independent postprocessing.

Sites shared edits: banking account evidence/provider/store/service/details/MCP files, the Drizzle schema and generated migration 0016. New pure projection/cooldown modules and a small fenced read helper keep the contract explicit. No package, lockfile, environment variable, schedule, production credential or deployment configuration changes.

Migration `0016_agent2_account_read_guard.sql` adds `bank_connections.account_evidence_retry TEXT NOT NULL DEFAULT ''`. Coordinate numbering if another workstream allocates 0016. Preserve any separately known legacy unresolved wait: an empty migration default cannot reconstruct a provider response that older code never retained. Do not probe account details during an active/unknown wait to validate deployment.

Agent 3 must keep recipient-account proof separate from report/deposit identity and economic deduplication. Agent 4 must treat the current server projection as an identity prerequisite, never standalone allocation authority. `bankgiroMapping.status` stays `blocked`; `paymentReconciliationAllowed` is always false. New manual evidence requires its own reviewed `review` provenance contract. Existing Node UI warning presentation is a consumer handoff: `last_error` currently renders only for error-status connections, while successful import warnings are available through the response/status.

## Verification commands and results

All writes and provider responses in tests are synthetic. Local runtime: Linux, Node 24.22.1, npm 11.9.0. GitHub's required workflow uses Node 22. Its complete run [41536046223](https://github.com/sharbel0022/Mgeorge/actions/runs/41536046223) passed on the frozen implementation head **`04667ef28277091a2940eba7928128b693f721f5`**, tree **`3f360e1c2c3bd88e6311193acbd16a160bb1c6d5`**, against main **`a779b0dd8d184eaf6e6d6e636c555c967f15f3d5`**. Both job logs were downloaded and their named test totals checked. This subsequent receipt update changes documentation only; the final PR metadata identifies its head and fresh CI.

| Gate | Verified result |
| --- | --- |
| Root `npm ci --ignore-scripts` | Passed, locked dependencies. |
| Sites `npm run install:ci` | Passed; exact minimatch mitigation verified. |
| Root `npm run check` | Passed: 121 JavaScript files. |
| Root `npm audit --audit-level=high` | Passed: 0 vulnerabilities. |
| Sites `node scripts/minimatch-backport.mjs --check --require-target` | Passed: 1 target, 0 writes, verified. |
| Sites `npm audit --audit-level=high` | Passed: 16 moderate development dependency findings, 0 high/critical. |
| Sites `npm audit --omit=dev --audit-level=high` | Passed: 0 production findings. |
| Full Node 22 CI suite | **1,327/1,327 passed**, 0 fail/skip/cancel/todo. |
| Full Sites Node 22 CI suite | **2,497/2,497 passed**, 0 fail/skip/cancel/todo; includes final guard fixture and latest-main 0599 file. |
| Full local Node 24 suite | **1,327/1,327 passed**, 0 fail/skip/cancel/todo, after the unchanged bounded rerun. |
| Local direct Sites run | 2,490 passed / 1 runner-context failure: npm_execpath was absent; unchanged affected file passed12/12 with the actual npm entrypoint. The complete npm-driven CI above passed. |
| Sites `npm run check` | Passed on frozen production source. |
| Sites `npm run build` | Passed on frozen production source; no publication. |
| Updated-main joined 0599 chain | Passed: 6/6; added by main PR #23 and run separately after refresh. |
| Guard backup/restore compatibility | Passed: 61/61 existing recovery cases with a nonempty unknown guard fixture; encrypted snapshot and isolated SQLite row preserve the value, still blocking after 30 days. |
| Independent review | Passed within Agent 2 scope: initial Important persistence failure and Minor contact-reporting defect resolved; no Critical/Important finding remains. Full-suite/typecheck/build gates are separate. |

**Mandatory CI total: 3,824 passed, zero failed/skipped/cancelled/todo.** Relative to main's 1,309 Node and 2,337 Sites cases, this branch adds **18 Node +160 Sites =178 cases**, and strengthens existing backup/restore assertions.

Reproduce the repository's required suites through npm so its executable context is available:

```sh
npm test
cd sites
npm test
```

The local bounded Node command was `node --test --test-concurrency=2 test/*.test.js`. A direct Sites invocation also needs the real npm_execpath for the existing postinstall integration test; omitting npm's context caused the explicitly reported runner failure, not a mitigation or banking defect. No test was changed for it.

Focused runs overlap the full suites and must not be added to their counts. The account projection's 119 cases, account reader/cooldown's 58 cases, and service/details/integrity's 158 cases passed; the CI totals supersede those individual receipts. The local full Sites command had already expanded its file list when main added the six-case 0599 file; those six new cases were run separately. The recovery fixture was then strengthened and its entire 61-case file rerun. No production source changed after the final local full runs began; exact PR CI subsequently included the new main file and final fixture together.

### Regression coverage

- Real synthetic HTTP/SQLite Node chains cover expired/malformed live access, changed bank/country/business scope, expiry between pages and during commit, failed checkpoint/audit writes, post-commit follow-up failure and lease loss.
- Pure projection tests reject stale, incomplete, ambiguous, wrong-origin and malformed evidence, getter/proxy traps, wrong source paths and attempts to confer Bankgiro or reconciliation authority.
- Actual Sites UI/MCP/owner-store/provider tests cover missing/optional account numbers, exact supplied aliases, account mismatches, census limits, concurrency, aborts, explicit Retry-After deadlines and unknown waits persisting past generic fallback expiry.
- Failure injection covers a missing initial pending write, failed throttle-result write, and post-response lease loss. Equivalent sync and transaction-detail cases protect session, transaction-page and transaction-detail reads, including a previously known deadline.
- Existing complete suites retain date-window narrowing, empty continuation pages, deduplication, conflicting originals, hash validation, revoked consent and conservation of financial state.

### Failures and environmental limits, retained explicitly

The first full Node run completed with **1,326 passed / 1 failed**. Its only failure was `read ECONNRESET` in the existing scheduled-sync HTTP test, with no failed business assertion. The unchanged test file then passed **15/15**, the bounded full local rerun passed **1,327/1,327**, and the complete CI run passed the same count. Stale keep-alive reuse under host load is plausible but not proven as the cause. No assertion or timeout was weakened.

The first full Sites run passed **2,472/2,472** before the independent-review persistence correction. That count is historical for this branch and is not the final-code result. The review defect was reproduced, then new tests were observed failing before the durable pre-request guard was added. Three account-reader cases and 14 sync/details cases fail on the old behavior and exercise the corrected failure boundary; two additional tests preserve prior unknown/manual waits.

The later direct local Sites command completed **2,490/2,491**, with the sole failure trying a nonexistent fallback npm path under the managed Node distribution. Supplying its actual npm entrypoint made the unchanged 12-case minimatch entrypoint file pass. The normal npm-driven Node22 CI then passed the complete **2,497-case** updated suite; no product/test patch, skip, weakened assertion or dependency change was needed.

Early restricted-runtime attempts included denied local HTTP binding and a `fatal library error, lookup self`; those runs are not counted as product-test passes. Valid runs use the approved local execution environment and mocked provider fetches. One redundant earlier full Sites run was stopped during parallel work and is not counted. Existing full-project lint debt is unchanged and was not rerun or presented as passed; the previous integration report records 211 errors and 2,527 warnings.

## Review disposition and remaining external evidence

Independent review reproduced loss of an unknown throttle when its post-response write failed, and incorrect `providerContacted:false` after lease loss. Pending-before-read plus exact-marker completion closes the persistence window; contact state now survives the outer wrapper. The same reviewer independently inspected the complete correction in all three read paths and returned ready within scope, conditional on the separate whole-suite/typecheck/build gates. No Critical/Important finding remains; the Minor reporting defect is also resolved.

Still unavailable for the real account: a current matching bank-supplied recipient alias if absent, an explicit bank-backed Bankgiro/account association, verified resolution of any old unknown throttle, individual payer/reference data behind aggregated settlements, and an authorized source for those individual reports. Provider schema support for `BGNR` is not evidence that the real Swedbank account exposes it. The official provider documents and exact gaps are linked in the contract.

No live authenticated bank request, production financial write, invoice registration/allocation, customer message, payment, BankID automation, scraping, main push, merge or Sites deployment is part of this branch's verification. Production migration and live acceptance belong to the integrator's authorized delivery. The current 33-area score remains **255/330 = 7.73**; no numerical score is raised from synthetic evidence.

## Verifiable continuation point

Resume from PR #25 and this feature branch, reread current main and this contract, and freeze the current PR head before integration. Do not reset an unresolved guard automatically. Apply/reconcile migration 0016 before the new code, preserve existing Sites/DB/R2/secrets/schedules, verify exact-head required CI and coordinate normal merge with the integrator. Local raw run logs are under the ignored `.agent2-evidence/` directory; the committed tests and CI provide the reproducible evidence.

The local Git client had no HTTPS credential. The authorized GitHub connection published the identical Git tree, verified by exact local/remote tree SHA before each normal feature-ref update. No force-push or main-ref write was used. The feature checkout was aligned to the verified remote commit with identical source/index/working-tree bytes; unpublished local commit metadata was not presented as the delivered SHA.
