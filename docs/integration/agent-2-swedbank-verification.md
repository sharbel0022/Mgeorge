# Agent 2 — Swedbank/account-evidence verification

Date: 2026-11-02. Branch: `feature/mgeorge-swedbank-account-evidence`.
Runtime baseline: `73662187cddf9a5c504dea9bd8a1288bd929bc51`.
Integration base refreshed through shared-contract PR #22 to `12c9868606a0a45b31b722ddee8f897541687e64` after reading the new report and synthetic acceptance test from PR #23. Both updates preserve production code. The final PR head is the authoritative delivery commit; this report and the contract travel with that head.

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

All writes and provider responses in tests are synthetic. Local runtime: Linux, Node 24.22.1, npm 11.9.0. GitHub's required workflow uses Node 22; local results do not substitute for its exact PR-head checks.

| Gate | Result at this checkpoint |
| --- | --- |
| Root `npm ci --ignore-scripts` | Passed, locked dependencies. |
| Sites `npm run install:ci` | Passed; exact minimatch mitigation verified. |
| Root `npm run check` | Passed: 121 JavaScript files. |
| Root `npm audit --audit-level=high` | Passed: 0 vulnerabilities. |
| Sites `node scripts/minimatch-backport.mjs --check --require-target` | Passed: 1 target, 0 writes, verified. |
| Sites `npm audit --audit-level=high` | Passed: 16 moderate development dependency findings, 0 high/critical. |
| Sites `npm audit --omit=dev --audit-level=high` | Passed: 0 production findings. |
| Final root full test suite | Running; update before delivery. |
| Final Sites full test suite | Running on the frozen correction; update before delivery. |
| Sites `npm run check` | Passed on frozen production source. |
| Sites `npm run build` | Passed on frozen production source; no publication. |
| Updated-main joined 0599 chain | Passed: 6/6; added by main PR #23 and run separately after refresh. |
| Guard backup/restore compatibility | Passed: 61/61 existing recovery cases with a nonempty unknown guard fixture; encrypted snapshot and isolated SQLite row preserve the value, still blocking after 30 days. |
| Independent review | Passed within Agent 2 scope: initial Important persistence failure and Minor contact-reporting defect resolved; no Critical/Important finding remains. Full-suite/typecheck/build gates are separate. |

The final local full-suite commands place the concurrency option before the file arguments:

```sh
node --test --test-concurrency=2 test/*.test.js
cd sites
node --experimental-strip-types --test --test-concurrency=2 tests/*.test.mjs
```

Focused runs overlap the full suites and must not be added to their counts. The account projection's 119 cases, account reader/cooldown's 58 cases, and service/details/integrity's 158 cases passed; the final full-suite totals supersede those individual receipts. The local full Sites command had already expanded its file list when main added the six-case 0599 file; those six new cases were therefore run separately. The recovery fixture was then strengthened and its entire 61-case file rerun. No production source changed after the final full runs began; exact PR CI must include the new main file and final fixture together.

### Regression coverage

- Real synthetic HTTP/SQLite Node chains cover expired/malformed live access, changed bank/country/business scope, expiry between pages and during commit, failed checkpoint/audit writes, post-commit follow-up failure and lease loss.
- Pure projection tests reject stale, incomplete, ambiguous, wrong-origin and malformed evidence, getter/proxy traps, wrong source paths and attempts to confer Bankgiro or reconciliation authority.
- Actual Sites UI/MCP/owner-store/provider tests cover missing/optional account numbers, exact supplied aliases, account mismatches, census limits, concurrency, aborts, explicit Retry-After deadlines and unknown waits persisting past generic fallback expiry.
- Failure injection covers a missing initial pending write, failed throttle-result write, and post-response lease loss. Equivalent sync and transaction-detail cases protect session, transaction-page and transaction-detail reads, including a previously known deadline.
- Existing complete suites retain date-window narrowing, empty continuation pages, deduplication, conflicting originals, hash validation, revoked consent and conservation of financial state.

### Failures and environmental limits, retained explicitly

The first full Node run completed with **1,326 passed / 1 failed**. Its only failure was `read ECONNRESET` in the existing scheduled-sync HTTP test, with no failed business assertion. The unchanged test file then passed **15/15**. A bounded full rerun is the final gate; stale keep-alive reuse under host load is plausible but not proven as the cause. No assertion or timeout was weakened.

The first full Sites run passed **2,472/2,472** before the independent-review persistence correction. That count is historical for this branch and is not the final-code result. The review defect was reproduced, then new tests were observed failing before the durable pre-request guard was added. Three account-reader cases and 14 sync/details cases fail on the old behavior and exercise the corrected failure boundary; two additional tests preserve prior unknown/manual waits.

Early restricted-runtime attempts included denied local HTTP binding and a `fatal library error, lookup self`; those runs are not counted as product-test passes. Valid runs use the approved local execution environment and mocked provider fetches. One redundant earlier full Sites run was stopped during parallel work and is not counted. Existing full-project lint debt is unchanged and was not rerun or presented as passed; the previous integration report records 211 errors and 2,527 warnings.

## Review disposition and remaining external evidence

Independent review reproduced loss of an unknown throttle when its post-response write failed, and incorrect `providerContacted:false` after lease loss. Pending-before-read plus exact-marker completion closes the persistence window; contact state now survives the outer wrapper. The same reviewer independently inspected the complete correction in all three read paths and returned ready within scope, conditional on the separate whole-suite/typecheck/build gates. No Critical/Important finding remains; the Minor reporting defect is also resolved.

Still unavailable for the real account: a current matching bank-supplied recipient alias if absent, an explicit bank-backed Bankgiro/account association, verified resolution of any old unknown throttle, individual payer/reference data behind aggregated settlements, and an authorized source for those individual reports. Provider schema support for `BGNR` is not evidence that the real Swedbank account exposes it. The official provider documents and exact gaps are linked in the contract.

No live authenticated bank request, production financial write, invoice registration/allocation, customer message, payment, BankID automation, scraping, main push, merge or Sites deployment is part of this branch's verification. Production migration and live acceptance belong to the integrator's authorized delivery. The current 33-area score remains **255/330 = 7.73**; no numerical score is raised from synthetic evidence.

## Verifiable continuation point

Resume from this feature branch, reread current main and this contract, and use the final PR head as the frozen code identity. Do not reset an unresolved guard automatically. Apply/reconcile migration 0016 before the new code, preserve existing Sites/DB/R2/secrets/schedules, run exact-head required CI and coordinate normal merge with the integrator. Local raw run logs are under the ignored `.agent2-evidence/` directory; the committed tests and CI provide the reproducible evidence.
