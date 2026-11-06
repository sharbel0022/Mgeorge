# Startup cancellation regression — frozen RED candidate

Base: `8c744db37816411d8ad8b70c5b94202c74c37e62`. The independent P2/P3 review is preserved at `819bc206f7c21c0f6f8ce0a490c36fbfb4047579`; the earlier normal-path PR60 CI archive remains `93b39c641a542cf8add015b63b253de2926059e5`.

## Execution status

**NOT YET EXECUTED.** This commit freezes the regression and pre-fix helper for ordinary GitHub CI. No local execution environment is available. A pure JavaScript parse preflight was performed without running Node, importing modules, starting processes, or executing assertions. That is not a Node test pass.

A real RED requires the intended cancellation/cleanup failure after the fixture's IPC-ready barrier. Import errors, setup errors, or an unstarted contender do not count as that evidence.

## Three test files only

1. The existing contention test delegates ownership of its child, terminal close event and SQLite holder to `test/helpers/startup-test-resources.js`. The RED helper deliberately has no test-context cancellation or after hook; cleanup is still reached only by the caller's finally.
2. The helper is present in this RED tree, avoiding a missing-module substitute for the lifecycle defect.
3. `test/database-startup-cancellation.test.js` launches a separate real `node:test` host. That host holds a synthetic WAL database exclusively and starts a real child that remains alive and ignores SIGTERM. Only after the child sends IPC-ready does the outer test request cancellation through the host's AbortController and the test's `signal` option.

## What the unchanged regression will require for GREEN

The inner test must finish its callback cleanup, close the real contender, remove its managed directory, and permit a new SQLite connection to acquire an exclusive transaction and recover the original value. The post-cancellation reopen path must remain unexecuted. The outer process additionally checks that the contender PID is gone and that the host exited with the expected cancelled-test status.

The report must arrive and the host must close **before outer cleanup has started**. The outer 10-second watchdog is only a failure/cleanup budget. Its use rejects the test with `SYNTHETIC_STARTUP_CANCELLATION_WATCHDOG`; it cannot turn a failing cleanup into a pass. The outer owner has its own cancellation/after cleanup, sends SIGKILL to remaining synthetic processes, waits for host close, and removes its temporary parent directory. No sleep or retry loop decides correctness.

The cancellation case exercises a real test-context abort after a proven readiness barrier. It does not claim to have separately measured timer delivery at exactly 15 seconds. Both tests retain a 15-second runner timeout.

The fixture clears only the inherited internal `NODE_TEST_CONTEXT` reporter marker for its separate Node-test host. It adds no product feature flag, provider hook, production endpoint, or workflow change.

## Preserved source and assertions

- All 18 original assertion calls on 14 source lines are byte-identical.
- The original contention child program and complete financial recovery assertion block are byte-identical.
- The original 15,000 ms timeout, 5,000 ms busy policy expectation, 4,500 ms minimum, and lock-before-spawn barrier are retained.
- `test/payment-concurrency.test.js` is not edited; both existing test bodies and its child program remain byte-identical.
- `src/db.js`, all of `src/`, all of `sites/`, and the workflow tree remain unchanged from the base.

Exact hashes and original-byte checks are in [red-evidence.json](red-evidence.json), the three test-blob readbacks in [red-readbacks.json](red-readbacks.json), and all frozen file identities in [red-manifest.json](red-manifest.json).

## Pending repair and review

The intended repair will register context cancellation and after cleanup before the first await, use one idempotent cleanup promise, kill a live test child and await close before rollback/close/removal, and prevent reopening after cancellation. P3's bounded raw diagnostic must be constructed before JSON.parse. Neither repair is included in this RED helper, and no GREEN claim is made here.

Primary API references: [Node 22 context.signal](https://nodejs.org/download/release/v22.23.0/docs/api/test.html#contextsignal) and [context.after](https://nodejs.org/download/release/v22.23.0/docs/api/test.html#contextafterfn-options). These support the lifecycle design, not an execution claim.
