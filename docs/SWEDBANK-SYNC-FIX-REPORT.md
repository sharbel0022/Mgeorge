# Swedbank sync repair

Date: 2026-11-02. Task branch: `fix/swedbank-sync-date-recovery`.

Base: `a9f88ae1c0f697376b3ecd140e1e80a64405125a` (`origin/main`). The user's later coordination instruction supersedes the original direct-main/publication instruction: this task is delivered as a PR, without automatic merge or Sites deployment.

## Observed production state

A read-only call to the existing site's `bank_auto_sync_status` returned `enabled=true`, `connected=true`, `blocked=false`, `failures=0`, and the exact reported error:

> Banken kan inte lämna den valda perioden. Välj ett senare startdatum eller en kortare period.

The saved last successful fetch was `2026-11-02T14:07:28.306Z` (15:07:28 in Sweden); the saved last automatic attempt was `14:07:25.819Z`. The response reported the next eligible scheduled attempt at `20:06:00Z` (21:06 in Sweden). These are saved status fields, not proof of a new fetch or a complete transaction ledger. No live bank synchronization, transaction import, consent renewal or account-detail retry was initiated by this task. The read confirms the stored production error, but does not establish which exact upstream rejection originally produced it.

## Bank flow map and reproduced defects

| Layer | Existing flow | Reproduced issue / repair |
| --- | --- | --- |
| Sites provider | `sites/lib/banking/enable-banking.ts` signs bounded AIS requests | Invalid dates and unavailable history shared one error code; HTTP 429 could lose its cooldown during body parsing; missing rate timing used a one-minute fallback. Distinguish date errors, prioritize header-established cooldowns, retain supplied delays and use a six-hour application fallback when timing is unavailable. |
| Sites service | Browser/MCP → `service.ts` → provider → normalizer → transactional workspace/run update | Manual refresh repeatedly requested the configured historical start; local Swedish dates could be future UTC dates. Use a frozen UTC interval and a three-day incremental overlap. Changing accounts/start date resets scope coverage. |
| Sites range recovery | New `sites/lib/banking/sync-periods.ts` | Recover an unavailable period with smaller exact windows, fresh pagination chains and bounded attempts; never silently omit earlier dates. |
| Node provider | `src/bank.js` → Enable Banking | The old 91-day rejection prevented long exact history retrieval. Add bounded windows, specific period error handling, complete-page staging, timeout/deadline and cooldown checks. |
| Node orchestration | `src/server.js` → durable integration lease → provider → existing importer | Explicit historical success updated a wall-clock timestamp that the scheduler treated as current coverage; downtime was clipped to 90 days. Track completed ranges independently and remove silent clipping. |
| Node coverage | New `src/bank-sync-state.js`, inside the existing encrypted session envelope | Store merged fully fetched intervals per stable account. Disjoint history cannot move the contiguous checkpoint over a gap. No new database table, backup format, settings field or migration is introduced. |
| Bank UI | `public/app.js`, `sites/components/bank-connection.tsx` | Use UTC date bounds. Ordinary Node refresh must omit custom dates so it uses server-confirmed incremental coverage; explicitly opened date controls request the entered interval. Show sanitized bank errors and incomplete coverage. |

Six new Sites service regressions were run against the original service source: all six failed. The same behaviors pass after the repair. Provider regressions also reproduced invalid-date conflation, future dates reaching the fetch boundary and lost rate-limit classification. Review found and reproduced additional error-body/cooldown and mid-pagination consent-expiry defects before their fixes.

Five further Node regressions reproduced provider credential failures being misreported as expired customer consent. Only explicit renewal signals or actual session/expiry checks now request reconnection; application access failures retain a safe administrative error. Generic 404/410 responses alone no longer invent consent expiry.

## Date and retry decisions

Bank queries use inclusive UTC calendar dates. Windows start at the previous successful window's end plus one day. Pure date arithmetic covers leap days, month/year changes and Swedish daylight-saving transitions without converting bank dates through local time.

The initial request window is at most **90 inclusive days**, an application resource policy rather than a claimed Swedbank retention guarantee. Only `WRONG_TRANSACTIONS_PERIOD` permits shrinking: the attempted width is halved, the same start date is retried with no continuation key, and the smaller width is reused for the remainder. At most six reductions permit 90 → 45 → 22 → 11 → 5 → 2 → 1 days. Failed-window rows are discarded before retrying. Rate limits, invalid dates, expired consent, timeouts, malformed responses and lost leases leave this path immediately.

All requested windows/pages must complete before import. Exhausted limits or unavailable single dates produce an explicit incomplete/error result; the existing history and successful checkpoint remain intact. Sites shares a 25-request/1,000-row budget across selected accounts. Node retains its 15-request/5,000-row budget and an overall bank deadline shorter than its five-minute lease. Provider preparation pages with zero rows and a continuation key remain part of the same pagination chain.

`Retry-After` seconds and valid HTTP dates are retained, including waits longer than one day. Missing/invalid rate timing uses a six-hour application fallback, not a fabricated supplier deadline. Extreme waits require manual review. HTTP 429 and HTTP 503 carrying cooldown headers are classified before reading a potentially broken/oversized body. Persisted cooldowns block subsequent ordinary, automatic and control attempts. Existing read-only trusted retry diagnostics continue to distinguish supplier-provided timing from application fallback.

## History, idempotency and concurrency

Node coverage is stored only in the existing encrypted bank session, keyed by stable account identity; a browser cannot forge it through ordinary settings. Reauthorization can retain coverage for the same stable account while changed provider account UIDs are not used as deduplication identities. A legacy last-sync timestamp is only a conservative recovery hint, not evidence that a historical gap was fetched.

Sites retains its atomic workspace/audit/run/checkpoint transaction. Existing transactional lease fences, optimistic workspace revisions, immutable original validation and financial conflict checks remain in force. Both paths assert lease/session/consent authority before subsequent bank calls; known expiry during a slow fetch blocks further calls and success recording.

The existing Node importer commits its complete financial import before the separate encrypted coverage/audit transaction. An interruption between those commits leaves conservative old coverage; the next run safely repeats and deduplicates the fetch. This task does not rewrite generic transaction/backup machinery. Tests cover failed provider pages/windows before any import, repeated complete imports, concurrent owners/runs and replaced leases.

Stable bank entry references plus stable account identity remain the basis for unambiguous deduplication. Existing conservative handling for transactions without stable identifiers remains: two genuinely identical payments must not be silently collapsed. Historical Swedbank data can therefore still require review or a bank-file supplement.

## Provider documentation checked

- [Enable Banking API reference](https://enablebanking.com/docs/api/reference/): inclusive UTC dates, distinct error codes, transient detail IDs versus stable entry references, and request strategy semantics.
- [Sweden / Swedbank integration notes](https://enablebanking.com/docs/markets/se/#historic-transaction-limitations): older history may take minutes, use empty continuation pages and omit entry references; very long history may fail. This is not a guaranteed numeric retention cap.
- [Enable Banking FAQ](https://enablebanking.com/docs/faq/): genuine active-user context only, common background-fetch restrictions, six-hour guidance after bank rate limiting, and early consent expiry.
- [Transactions strategy announcement](https://enablebanking.com/blog/2024/03/11/changelog-february-2024): `longest` may adjust the historical start and ignores `date_to`. It is deliberately not used to claim complete retrieval of an exact requested interval.

## Verification

All writing tests use synthetic data, temporary databases and generated test credentials. No production bank request or financial mutation was used for verification. Local full-suite failures are retained explicitly instead of being relabeled as success.

Initial environment findings: sandboxed localhost binding failed with `EPERM`; the authorized local-server test run was moved to the supported elevated executor. Unbounded concurrent full suites produced terminated workers/pending-promise failures and were interrupted. Suites were subsequently run with one test file at a time. A first bounded Sites full run produced 1,950 passes out of 1,953 with three unrelated minimatch-test failures: two fixed 55-second child-process timeouts under load and an incorrect npm executable fallback when invoked outside npm. The unchanged two-file rerun passed **40/40**, using the observed `npm_execpath` and sequential file execution. The final complete Sites suite then passed **1,957/1,957**. No source, timeout, assertion or audit threshold in those minimatch tests was changed.

| Check | Result |
| --- | --- |
| Node bank/provider/UI/lease regressions | **152 passed, 0 failed, 0 skipped** |
| Complete Node suite | **1,105 passed, 0 failed, 0 skipped**; 57 test files |
| Sites focused bank regressions | **129 passed**, then **4/4** additional review regressions passed after expected failures |
| Complete Sites suite | **1,957 passed, 0 failed, 0 skipped** |
| Node `npm run check` | Passed; 108 JavaScript files checked |
| Sites `npm run check` | Passed |
| Sites production build | Passed |
| Installed minimatch backport verification | Passed; one target verified, zero writes |
| Root `npm audit --audit-level=high` | Passed; zero findings |
| Sites `npm audit --audit-level=high` | Passed; zero high/critical findings, 16 existing moderate development findings |
| `git diff --check` | Passed |

Both complete local runs use the repository's complete test-file glob, with `--test-concurrency=1` to avoid oversubscribing this shared environment. For direct Node invocation, `npm_execpath` is set to the installed npm CLI so the existing npm lifecycle tests retain their normal context:

```sh
# Repository root
node --test --test-concurrency=1 test/*.test.js

# sites/
node --experimental-strip-types --test --test-concurrency=1 tests/*.test.mjs
```

The existing GitHub Actions workflow retains its ordinary `npm test` commands and Node 22 runtime. Local verification used Node 24.22.1. No dependency, workflow, test selection or audit threshold was changed. Independent code review inspected the provider, period recovery, coverage, service and UI changes; its three concrete findings were reproduced and fixed before the final suites.

### Requested regression coverage

| Scenario | Principal regression coverage |
| --- | --- |
| Invalid/reversed/future dates | Node `bank-date-recovery` / `bank-sync-date-api`; Sites `bank-sync-periods` / `banking-provider`: validation occurs before provider access or checkpoint changes. |
| Historical, short and long ranges | Exact inclusive windows, leap day, year boundary, Swedish DST, UTC midnight and empty continuation pages; no silent 90-day clipping. |
| Overlapping retrievals | Existing bank API and Sites SQL/domain integrity tests preserve stable identity and avoid inserting the same identified transaction twice. |
| Rate limits | Seconds/HTTP-date parsing, fallback timing, interrupted error bodies, 503 cooldowns, persisted waits across restart and no retries caused by date adaptation. |
| Expired consent | Stored/live expiry, mid-pagination expiry and revoked sessions stop later calls and writes; credential errors are distinguished from customer consent. |
| API timeout | Header/body timeout characterization and regressions, bounded total Node deadline, no date retry and no success checkpoint. |
| Identical transactions in repeated fetches | Original stable-entry deduplication and financial-conflict suites remain intact; missing immutable references are retained without invented identities. |
| Failed and resumed sync | A failed later window does not import earlier staged rows; restart resumes the missing coverage with overlap; historical success cannot certify an unrequested gap. |
| Concurrent jobs | Existing durable job/owner isolation suites plus new replaced-lease and pre-request authorization regressions. |

## Parallel integration and operational limits

- Only the Swedbank task branch is eligible for this task's pushes. Main was re-fetched during development and still matched the base at that check.
- Shared `PROGRESS.md`, `QUALITY-SCORECARD.md`, schema/migration, backup, Gmail, OCR and reconciliation files are not part of this change. This task-specific report carries the required progress/evidence to avoid conflicts with the other conversations.
- Review and integration must account for narrow shared-file edits in `src/server.js` and `public/app.js`, and provider retry-policy assertions used by bank-evidence tests.
- No merge, force-push, branch deletion or Sites publication is performed. The existing Sites project is retained for later coordinated publication.
- Unavailable bank history, a consent requiring BankID renewal, missing stable historical identifiers, provider resource limits or provider downtime cannot be converted into a claimed successful sync by this code. The admin receives the failing period/action and existing data remains preserved.
- Actual successful synchronization with the new code remains an operational acceptance step after the coordinated merge and publication. The live status read above is not that acceptance test.

Delivery references: [task branch](https://github.com/sharbel0022/Mgeorge/tree/fix/swedbank-sync-date-recovery), [pull requests for this branch](https://github.com/sharbel0022/Mgeorge/pulls?q=is%3Apr+head%3Afix%2Fswedbank-sync-date-recovery), and [Actions for this branch](https://github.com/sharbel0022/Mgeorge/actions?query=branch%3Afix%2Fswedbank-sync-date-recovery). The exact commit SHA, PR URL and terminal Actions verdict are recorded in the PR and the task delivery response after publication of the branch. This report does not certify a deployment or a live bank sync.
