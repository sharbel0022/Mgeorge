# Independent P2/P3 follow-up review — PR #60

**Reviewed code:** `82cda2ec692e1b3a976d3ee1711cd0ab2072ad01`, tree `0e279a2c63971f11cce269c0e93bc884f57b8189`.

**RED baseline:** `f0e845bb87ee08d15fa96cb75879849493aeb1fd`. **Original reviewed candidate:** `8c744db37816411d8ad8b70c5b94202c74c37e62`.

**Static verdict:** P2 and P3 are addressed in the reviewed code. No new Critical, Important, or Minor issue was found in this narrow follow-up. Execution approval remains pending: this reviewer has not executed either revision or inspected RED/GREEN workflow logs for this repair. This is conditional code acceptance, not an assertion that CI passed or that merging is currently authorized.

The [original NOT READY review](https://github.com/sharbel0022/Mgeorge/blob/819bc206f7c21c0f6f8ce0a490c36fbfb4047579/docs/quality8/startup-independent-review-20261106/REVIEW.md) remains unchanged and remains the assessment of its original candidate.

## Final candidate and later execution report

I independently read the [immutable comparison](https://github.com/sharbel0022/Mgeorge/compare/82cda2ec692e1b3a976d3ee1711cd0ab2072ad01...520e22716c6298e4d24ccf3989e87cfe563d8d14) and commit metadata for final candidate `520e22716c6298e4d24ccf3989e87cfe563d8d14`, tree `4df922a5284fd1ee040e246a8cb88ae4dfae9175`. Its delta from the reviewed code commit consists of exactly eight documentation files. This static P2/P3 acceptance therefore also applies to that candidate's unchanged code. This is sufficient to proceed to the planned normal PR update and full CI; it is not permission to bypass those checks.

Root subsequently reported reading the actual RED job log: run 42176156539, attempt 1, job 127754977736, baseline `f0e845bb87ee08d15fa96cb75879849493aeb1fd`. The reported result is 2323 tests, 2322 pass, one failure, and zero cancelled/skipped/todo. The sole failure is the intended cancellation watchdog after 10010.454839 ms, with ready-barrier evidence and the inner test's intentional cancellation. This is **root's execution verification**, not an execution or log inspection by this reviewer. Final-candidate GREEN remains pending.

## Scope and identity checks

I read all three complete test files at the reviewed commit, the RED resource helper, the original contention test, and immutable commit/comparison metadata. The fix commit changes only the contention test and its helper (+12/-3); the cumulative change from the original candidate adds the cancellation regression, the helper, and evidence documentation. There is no further production, existing payment-concurrency test, Sites, schema, authentication, or business-policy change in that comparison.

- All 18 original contention assertions are exactly preserved.
- The real contender source is exactly preserved.
- The original 15000 ms test timeout, 5000 ms busy policy assertion, and 4500 ms lower-bound assertion are preserved.
- The cancellation regression is exactly equal between RED and fix and to Git blob `0d337415be3689f71f217f1d5ea88cf3d688a595`.

## P2 — addressed by the actual cancellation path

The [helper](https://github.com/sharbel0022/Mgeorge/blob/82cda2ec692e1b3a976d3ee1711cd0ab2072ad01/test/helpers/startup-test-resources.js#L4-L26) installs `t.after(cleanup)` and an abort listener before returning to the caller. Its single memoized cleanup promise kills a live child with SIGKILL, waits for the separate `close` promise, then rolls back/closes the SQLite holder and removes the owned directory. A child error still rejects the caller's terminal promise; cleanup separately waits for final close. The abort listener observes rejection, while the caller and after hook await the same promise, so the listener's catch does not turn a cleanup failure into a successful cleanup.

The [contention callback](https://github.com/sharbel0022/Mgeorge/blob/82cda2ec692e1b3a976d3ee1711cd0ab2072ad01/test/database-startup-contention.test.js#L31-L53) creates the resource owner before starting its work and checks `t.signal.aborted` immediately after the awaited child terminal event. An aborted callback returns through shared cleanup without executing the recovery/openDatabase assertions. Its [finally](https://github.com/sharbel0022/Mgeorge/blob/82cda2ec692e1b3a976d3ee1711cd0ab2072ad01/test/database-startup-contention.test.js#L75-L76) uses the same idempotent cleanup. On the ordinary path, the holder remains locked until child close, then the existing recovery and business assertions execute.

This directly addresses the original defect: cleanup no longer depends solely on reaching a finally block behind a hung child's terminal promise.

## P3 — addressed by bounded raw diagnostics

The [contention test](https://github.com/sharbel0022/Mgeorge/blob/82cda2ec692e1b3a976d3ee1711cd0ab2072ad01/test/database-startup-contention.test.js#L66-L74) builds raw diagnostics from the already bounded stdout/stderr buffers and terminal status before JSON parsing. Its parse-error catch includes that diagnostic and the original cause. The existing truncation, exit/signal, SQLite error, busy-timeout, and elapsed-time assertions are unchanged.

## The new regression does not credit outer rescue as success

The [fixture](https://github.com/sharbel0022/Mgeorge/blob/82cda2ec692e1b3a976d3ee1711cd0ab2072ad01/test/database-startup-cancellation.test.js#L8-L46) owns a real SQLite exclusive holder and a live IPC child. Cancellation is sent only after the child's ready message. It waits for both the Node test and the callback's finally to finish, then probes the preserved database with a new zero-busy-timeout exclusive transaction and reads the rolled-back original value.

The [outer test](https://github.com/sharbel0022/Mgeorge/blob/82cda2ec692e1b3a976d3ee1711cd0ab2072ad01/test/database-startup-cancellation.test.js#L73-L101) requires both the completion report and host close before its assertions. Success requires that the watchdog did not fire and outer cleanup did not start. It additionally requires callback completion, no recovery open after cancellation, child close by SIGKILL, ESRCH for the child's PID, removal of the managed folder, and a successful SQLite recovery probe with the original value. The intentional cancelled inner test is expected to exit 1; that exit is explicitly checked.

The 10000 ms watchdog rejects its deadline promise before starting independent rescue cleanup. Watchdog use therefore fails the outer test; rescue cannot supply its success evidence. The regression exercises real Node-test cancellation through options.signal. It does not separately measure the firing time of the unchanged 15000 ms timer.

## New findings and recommendations

**Critical:** none found. **Important:** none found. **Minor:** none found.

Preserve the frozen regression and root-reported meaningful RED evidence on the baseline, and obtain the complete ordinary Node 22 PR gates on the final candidate containing this exact reviewed code. Retain the required Sites, bridge, type, audit, and build checks and the required main/release gates before production. No additional code repair is requested by this static follow-up.

## Declined to judge

- Independent RED/GREEN execution, exact Node runtime behavior and timing, and workflow success: root supplied a RED log-verification report, but this reviewer has not executed the repair or independently inspected its workflow logs.
- Whether the original historical CI failure had the same cause: its missing stderr remains missing.
- A new audit of unchanged product, financial, schema, authentication, Sites, and deployment behavior: this review verifies the narrow test repair and its scope.
- Native archive correctness, current production health, and permission to publish: none is established by this test review.

## Merge condition

There is no remaining static blocker from P2/P3 at `82cda2ec692e1b3a976d3ee1711cd0ab2072ad01`. Merge remains conditional on honest RED evidence and full passing PR checks on the final immutable candidate. This follow-up supplies no independent execution approval; main/release gates remain necessary before production.
