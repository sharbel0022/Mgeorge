# Browser QA hardening

Base: `4a18de185a23a507e3bc69760d41496c14e3d54b`. Own branch: `work/final95-browser-qa`.

Both independently reported P2 defects were reproduced against the unchanged runner. `browser-qa-contract-red.tap`: **0/2 passing, 2 failing**, 112.267176 ms. The actual finalizer was executed with controlled process/browser boundaries: rejected browser close skipped server termination and receipt writing; HTML alone produced a green receipt.

The runner now records bounded browser cleanup errors, proceeds to server cleanup, waits a bounded time for SIGTERM, escalates to SIGKILL with a separate bound, and writes the failed receipt. Deadline or signal errors remain failures even if later cleanup succeeds. Listener/timer cleanup is tested.

Each scenario requires hash-matching `index.html`, `app.js` and `app.css` before its success result. Each response check records its scenario. A previous complete scenario cannot cover a later missing asset. The final receipt also requires verified assets on every scenario. Existing 31 dashboard journeys and all their assertions are retained. No onboarding/workspace assertions, source binding, allowed network operations, fixtures or product behavior changed.

Verification: `node --test --test-reporter=tap test/browser-quality-lifecycle.test.js test/quality-runner.test.js test/quality-syntax.test.js /workspace/scratch/0005a76ddf57/browser-review-contract-probes.mjs` produced **30/30 passing**, 0 failed/cancelled/skipped/todo, 928.969134 ms. This includes eight committed lifecycle/resource tests, the two original regression probes, and an additional two-scenario probe proving that complete assets from one scenario cannot mask missing script/CSS in another. `node --check scripts/quality/dashboard-browser.mjs` and `git diff --check` passed.

These focused tests use controlled boundaries and execute the real runner finalizer/scenario logic; they are not a Chromium run. Parent owns the full source-bound Node/Sites/bridge/browser CI gates after integration. Local socket EPERM has not been bypassed. No production or provider access occurred.

Files: `scripts/quality/dashboard-browser.mjs`, new `scripts/quality/browser-lifecycle.mjs`, new `test/browser-quality-lifecycle.test.js`. External raw evidence: `browser-review-contract-probes.mjs`, `browser-qa-contract-red.tap`, `browser-qa-contract-green.tap`, `browser-qa-contract-green-final.tap`.
