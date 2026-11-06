# Independent review — PR #60

**Reviewed candidate:** `8c744db37816411d8ad8b70c5b94202c74c37e62` against `237dd45e7e1b40513d2dd25ccff59bb08f023264`, repository `sharbel0022/Mgeorge`.

**Ready to merge: No for this exact candidate.** The production change is appropriately narrow, but the new test has an important timeout-cleanup defect: the runner can report the 15-second timeout while the test's child and SQLite holder remain alive. Repair that failure path, obtain review of the small repair, and require the normal full PR checks on the resulting head before merging and the required main/release gates before production. I have performed an independent static review of immutable GitHub contents. I have not executed this candidate and do not supply independent execution evidence. Root subsequently reported successful Node 22.23.4 PR CI, including the new contention regression (5158.643886 ms), the original two-process test (243.47559 ms), and all reported Node/Sites/bridge checks. I have not independently retrieved those CI logs. That normal-path GREEN does not resolve the timeout-cleanup finding below.

## Strengths

1. **The product change applies the existing busy policy early enough.** The only production edit moves `PRAGMA busy_timeout=5000` ahead of `foreign_keys=ON` and `journal_mode=WAL`. It retains the same five-second policy and the same schema initialization. This directly addresses a startup statement encountering contention before its connection has installed the intended busy handler. It introduces no new Node API, dependency, business rule, or schema change. [src/db.js:19–23](https://github.com/sharbel0022/Mgeorge/blob/8c744db37816411d8ad8b70c5b94202c74c37e62/src/db.js#L19-L23)

2. **The normal-path lock barrier is convincing.** The test prepares and closes a migrated database, opens a separate holder, confirms WAL mode, sets exclusive locking, begins the exclusive transaction, and actually updates the invoice before spawning the contender. It retains that holder until the contender's `close` event. The contender therefore cannot start before the lock is acquired, and the test cannot release the lock early because a timer fires. The busy policy and elapsed-time assertions inspect a real `openDatabase` failure. The instrumentation delegates the original SQL unchanged and reads the connection's busy timeout only after an execution error. [New test:12–27](https://github.com/sharbel0022/Mgeorge/blob/8c744db37816411d8ad8b70c5b94202c74c37e62/test/database-startup-contention.test.js#L12-L27), [39–50](https://github.com/sharbel0022/Mgeorge/blob/8c744db37816411d8ad8b70c5b94202c74c37e62/test/database-startup-contention.test.js#L39-L50)

3. **The existing concurrency and crash coverage is preserved.** I compared the complete immutable base and candidate files. Both the existing `childSource` string and the original test bodies are byte-for-byte equal as JavaScript strings. Their simultaneous `go` dispatch and business assertions are unchanged. The helper now drains bounded stderr and uses `close`, so its nonzero-exit diagnostics can include the complete captured stderr after the pipe closes. [Helper and concurrent start](https://github.com/sharbel0022/Mgeorge/blob/8c744db37816411d8ad8b70c5b94202c74c37e62/test/payment-concurrency.test.js#L30-L58)

4. **The early-rejection handling is sound.** `done.catch(()=>{})` observes a rejection while callers are still awaiting readiness. The helper still returns the original `done` promise, so later awaiting that promise continues to reject. This suppresses an unintended unhandled-rejection report without converting a failed import/startup into a successful result. [Helper:36–41](https://github.com/sharbel0022/Mgeorge/blob/8c744db37816411d8ad8b70c5b94202c74c37e62/test/payment-concurrency.test.js#L36-L41)

5. **The fixture checks useful invariants without manufacturing business evidence.** After rollback it checks database integrity, WAL and foreign-key configuration, the original synthetic invoice party, zero bank/allocation rows, unchanged import/audit counts, and exact original attachment bytes. The names and values are visibly synthetic. The checks support the stated test scenario; they are not evidence about live payments. [New test:34–38](https://github.com/sharbel0022/Mgeorge/blob/8c744db37816411d8ad8b70c5b94202c74c37e62/test/database-startup-contention.test.js#L34-L38), [51–68](https://github.com/sharbel0022/Mgeorge/blob/8c744db37816411d8ad8b70c5b94202c74c37e62/test/database-startup-contention.test.js#L51-L68)

6. **Scope and evidence claims remain restrained.** The base-to-head comparison contains the intended database-line edit, the helper change, the new test, and documentation. The Sites subtree remains `4feabc128c5f677103232d1cad1e4406083e8f19`; the inspected workflow, migration, script, public, bridge, and source subtrees are unchanged. The receipt and README explicitly disclose missing raw local logs and do not claim GREEN. [Immutable comparison](https://github.com/sharbel0022/Mgeorge/compare/237dd45e7e1b40513d2dd25ccff59bb08f023264...8c744db37816411d8ad8b70c5b94202c74c37e62), [Evidence README](https://github.com/sharbel0022/Mgeorge/blob/8c744db37816411d8ad8b70c5b94202c74c37e62/docs/quality8/payment-startup-remote/README.md), [RED receipt](https://github.com/sharbel0022/Mgeorge/blob/8c744db37816411d8ad8b70c5b94202c74c37e62/docs/quality8/payment-startup-remote/RED-RECEIPT.json)

## Critical issues

None found in the reviewed change.

## Important issues

### P2 — The new test's timeout does not reliably clean up a hung contender

**Location:** `test/database-startup-contention.test.js:30,48–49,69–73`.

The callback has no test context or timeout-triggered cleanup hook. It awaits `terminal`, whose normal settlement depends on the child closing. The only code that kills a running child is in the same callback's `finally` block, after that await.

A Node test timeout does not inject an exception into that suspended callback. The runner races the callback promise against its timeout, cancels the test when the timeout wins, and invokes registered teardown hooks. The still-pending callback does not thereby enter its own `finally`. This is visible in the Node 22 runner's `SafePromiseRace`, cancellation, and teardown-hook handling. I inspected the published v22.23.0 source for this reasoning, not an execution of the reported v22.23.4 runner. [Node 22 runner:1047–1089](https://github.com/nodejs/node/blob/v22.23.0/lib/internal/test_runner/test.js#L1047-L1089)

**Practical impact:** If the contender hangs instead of closing, the test can be marked timed out at 15 seconds while the child pipes keep its process alive and the holder retains the exclusive lock. The child kill, rollback, database close, and temporary-directory removal at lines 69–73 may never be reached. A regression in the very bounded-wait behavior this test is supposed to police could therefore hang the suite until a broader CI timeout. This is a concrete failure-path risk established by static control flow; I am not claiming that the current candidate actually hung.

**Minimal repair:** Accept the test context (`async t =>`) and register a teardown/cancellation hook before awaiting `terminal` that kills the live contender when the test is cancelled. Reuse or make the existing cleanup idempotent so the holder is rolled back/closed and the directory removed only after the child is closed. Keep the successful-path lock-release order and all existing assertions. Avoid continuing recovery assertions after cancellation. This needs no additional sleep, retry loop, timeout increase, or serialization.

[New test:30–49](https://github.com/sharbel0022/Mgeorge/blob/8c744db37816411d8ad8b70c5b94202c74c37e62/test/database-startup-contention.test.js#L30-L49), [69–73](https://github.com/sharbel0022/Mgeorge/blob/8c744db37816411d8ad8b70c5b94202c74c37e62/test/database-startup-contention.test.js#L69-L73)

## Minor issues

### P3 — Malformed child output hides the diagnostic information already collected

**Location:** `test/database-startup-contention.test.js:63–65`.

`JSON.parse(stdout)` runs before the diagnostic string is constructed and before exit code, signal, and truncation are asserted. A syntax/import/native failure that produces empty or non-JSON stdout therefore reports a JSON parse error instead of the captured child stderr and terminal status.

**Practical impact:** CI would still fail, but a failure outside the expected SQLite path would lose the precise diagnostic context this change is intended to preserve.

**Minimal repair:** Construct a bounded raw-output diagnostic first, then either check exit/truncation before parsing or catch the parse exception and report it together with exit code, signal, bounded stdout, and stderr. Retain the existing SQLite and elapsed-time assertions.

[New test:63–68](https://github.com/sharbel0022/Mgeorge/blob/8c744db37816411d8ad8b70c5b94202c74c37e62/test/database-startup-contention.test.js#L63-L68)

## Recommendations

- Repair P2 before merging. Address P3 in the same small test-only revision if practical, then freeze and identify the new full head for review and CI.
- Validate the repaired timeout path with a controlled contender that remains alive: the existing 15-second test timeout must terminate it and allow cleanup/process exit. This is a targeted check of the concrete risk, not a reason to add retry-until-green behavior to the committed test.
- Run the complete existing Node 22 PR checks and the required main checks. Keep all Sites, bridge, type, audit, and build gates honest. The PRAGMA change is statically compatible with the project's existing Node 22 SQLite usage, but only execution can establish the new test's timing and runtime behavior on the actual supported runner.
- Preserve the historical distinction: the supplied RED metadata supports the observed missing busy timeout in that local scenario. It does not establish the exact cause of the earlier generic CI startup failures whose stderr was not preserved.
- Do not promote a Site or report archive/deployment completion while the native archive/runtime gate remains blocked.

## Declined to judge

1. **Independent execution of candidate GREEN, timing across supported runtimes, and timeout cleanup.** Root reports successful Node 22.23.4 PR CI, including the new regression. I did not independently retrieve those logs or execute the candidate; no working execution environment was available to this reviewer.
2. **The precise cause of the earlier CI failures 2320/2321 and authenticity/completeness of unavailable raw local RED/probe logs.** I can assess the saved disclosure and source, not reconstruct missing output.
3. **General correctness of unchanged business, schema, authentication, reconciliation, and financial policies.** I checked change scope and preservation; this narrow review is not a new audit of the entire application.
4. **Pre-existing helper behavior for a clean exit without a readiness message or an exit after a `done` message, and pre-existing `openDatabase` error-path connection lifetime.** These were considered while reading control flow, but the candidate does not introduce them and this review does not expand the requested fix.
5. **Production Site 66 runtime health, native archive correctness, deployment success, and independent verification of PR/main gate results.** Root reports a successful PR run and a source-only saved version without a new deployment. The unchanged Sites tree and that saved version do not substitute for runtime and release checks.

## Merge verdict

**Not ready at `8c744db37816411d8ad8b70c5b94202c74c37e62` because P2 remains.** After the minimal timeout-cleanup repair is reviewed and the required full checks pass on the resulting immutable head, the narrowly scoped production PRAGMA ordering is suitable to merge. This review provides static findings only and supplies no independent execution approval.