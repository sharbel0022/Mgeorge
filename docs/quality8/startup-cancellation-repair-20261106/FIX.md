# Startup cancellation repair candidate

## Exact source and current status

- Original PR60 head: `8c744db37816411d8ad8b70c5b94202c74c37e62`.
- Frozen RED candidate: `f0e845bb87ee08d15fa96cb75879849493aeb1fd`.
- Repair code commit: `82cda2ec692e1b3a976d3ee1711cd0ab2072ad01`.
- Repair code tree: `0e279a2c63971f11cce269c0e93bc884f57b8189`.

**Execution and independent recheck are pending at this freeze.** The local execution environment remains unavailable. No Node test execution is claimed by the producer. The separate RED branch contains the complete helper and regression, and ordinary GitHub CI must establish the intended RED rather than an import/setup failure. The same regression must then pass unchanged on this repair.

The earlier normal-path GREEN archive `93b39c641a542cf8add015b63b253de2926059e5` and independent NOTREADY review `819bc206f7c21c0f6f8ce0a490c36fbfb4047579` are preserved unchanged.

## What changed

The server-generated [fix.diff](fix.diff) contains **12 added and 3 removed lines** in two test files relative to the frozen RED candidate:

- The test-only resource helper registers a context after hook and an AbortSignal listener before the caller's first await. Both paths use the same idempotent cleanup promise. A live child is killed with SIGKILL, its close event is awaited, then the SQLite holder is rolled back/closed and the owned directory removed. The event listener starts cleanup immediately; the caller and after hook await the same promise so cleanup errors remain observable. An already-aborted context stops setup immediately.
- The original contention callback checks its signal after awaiting the contender and returns before reopening on cancellation. Its runner records that cancellation; the return is not an approval of an aborted test.
- Bounded stdout/stderr, terminal status and truncation state are captured before JSON.parse. Invalid JSON now throws an error containing that raw diagnostic and the original cause.

There is no production-code change in this candidate. The previously reviewed PRAGMA order in `src/db.js` is untouched.

## Frozen regression and fallback boundary

`test/database-startup-cancellation.test.js` is byte-identical between RED and repair, Git blob `0d337415be3689f71f217f1d5ea88cf3d688a595`.

It uses a separate real Node-test host, a real held synthetic SQLite WAL transaction, and a real hanging child. Only IPC-ready permits the cancellation request. GREEN requires the inner callback's cleanup to complete, child close and PID disappearance, removal of the managed directory, and a fresh SQLite exclusive transaction showing the original value. The post-cancellation reopen path must not run.

The outer owner has independent cleanup, including SIGKILL and host-close waiting. Its 10-second watchdog is a failure budget, not a sleep or passing condition. If it runs, or outer cleanup begins before the inner evidence is checked, the regression fails. This prevents fallback cleanup from hiding the original defect.

The regression exercises actual context cancellation after a readiness barrier. It does not claim a separately executed timer firing at exactly 15 seconds. Both tests retain their 15-second test timeout. Only the inherited internal Node test-reporter marker is cleared for the separate fixture host; no product or provider flag is introduced.

## Byte preservation

The original 18 assertion calls, original contention child program, complete financial recovery block, and 15,000/5,000/4,500 ms limits are unchanged. The entire existing `test/payment-concurrency.test.js`, including both test bodies and its child program, is unchanged.

Product identities from the original frozen head:

- `src/db.js` blob: `e6808bb65b6c0c159f360db211f755a23b7c74b4`.
- Entire `src/` tree: `e4b8955617924e0d22c4123d0a6dc5b27097b2e6`.
- Entire `sites/` tree: `4feabc128c5f677103232d1cad1e4406083e8f19`.
- Existing concurrency test blob: `5f27bd1ce8dbd88f8bce2d5b1ff05c55ff6e1e23`.

All initial readbacks and original-byte hashes are retained in [fix-evidence.json](fix-evidence.json), [fix-readbacks.json](fix-readbacks.json), and [fix-manifest.json](fix-manifest.json). The RED evidence files remain historical records of their exact RED commit, rather than hashes of the repaired helper.

## Remaining gate

The full regression must produce the intended RED and then GREEN under the actual Node CI runtime, followed by the independent static recheck and the normal full CI on the final PR head. No merge, PR60 ref update, production mutation, workflow change, or deployment was performed by this task.
