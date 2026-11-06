# Startup contention recovery checkpoint — 2026-11-06

## Status and scope

This is a documentation and patch-artifact checkpoint based on exactly `237dd45e7e1b40513d2dd25ccff59bb08f023264`. It does not apply either test patch or the proposed product change. No pull request, merge, deployment, or new test execution is part of this checkpoint.

The local execution environment became unavailable before a RED commit, product edit, or GREEN run could be completed. The session-memory checkpoint survived and supplies the exact strings in the three patch artifacts and the recorded result metadata. The remote checkpoint must not be described as a completed repair or independent approval.

## Restorable artifacts

- [payment-concurrency-worker-diagnostics.patch](payment-concurrency-worker-diagnostics.patch): complete patch for the original worker helper; captures bounded child stderr and exit/signal diagnostics. Original test bodies, assertions, child program and concurrent start barrier are unchanged by the patch.
- [database-startup-contention.patch](database-startup-contention.patch): complete Add File patch for the deterministic synthetic SQLite contention regression.
- [product-order.NOT_APPLIED.patch](product-order.NOT_APPLIED.patch): proposed one-line PRAGMA order change. **NOT APPLIED, NOT GREEN-TESTED.**
- [checkpoint.json](checkpoint.json): the complete surviving checkpoint object, including those patch strings, paths, limits, and recorded next steps.
- [results.json](results.json): recorded prior execution receipts. These are metadata, not full raw logs.
- [manifest.json](manifest.json): UTF-8 sizes and Git blob object IDs for the checkpoint files.

The patch strings are preserved verbatim in the original `apply_patch` format, including their original absolute worktree paths. When restoring to another checkout, adapt only the paths deliberately; retain patch bodies and escape sequences. These are not `git apply` unified-diff files. The new regression source is fully recoverable from its Add File patch.

The contents were recovered from session memory. A fresh comparison against inaccessible local files was not possible. Remote blob and branch verification is reported separately with the final receipt.

## Recorded evidence before the interruption

| Execution | Recorded result | Scope |
| --- | --- | --- |
| Main CI run 42164894222, Node job 127718950721 | 2320 passed, 1 failed; generic worker-before-ready error | Original child stderr and underlying cause were not captured |
| Two initial local attempts | Missing `xlsx`, then `@noble/hashes` | Environment failures before the test body; neither counts as a product RED |
| Existing two-process baseline | 2/2 passed, exit 0 | Local Node v24.22.1 |
| Explicitly held WAL lock probe | Child exit 1; ERR_SQLITE_ERROR, code 5; about 1.78 ms | Reproduces immediate database-is-locked during startup |
| New deterministic contention regression | 0/1 passed; assertion `0 !== 5000`; child about 1.16 ms | Existing startup connection had busy_timeout 0 when journal-mode setup failed |
| Proposed product repair and post-fix gates | **NOT RUN** | Environment stopped before application |

The original CI runtime was Node v22.23.4. The available local runtime was Node v24.22.1 with SQLite 3.53.4; no installed Node 22 runtime was found. This difference remains a verification limit.

The synthetic contention regression establishes a real early SQLITE_BUSY bug in the observed local runtime. It **does not establish that this was the original CI failure's cause**. Original CI reported only a generic worker error after about 124.72 ms.

## Proposed repair, still unapplied

At the base commit, `openDatabase` executes `foreign_keys=ON`, then `journal_mode=WAL`, then `busy_timeout=5000`. The proposed patch installs the same existing five-second busy policy before the journal-mode operation. It changes no timeout value, transaction boundary, retry policy, payment allocation, bank data, or durable receipt rule.

The new regression starts from a fully prepared synthetic WAL database, holds an exclusive lock before spawning the contender, retains it until the child closes, and then releases it by rollback plus close. The child-side observer reads the real connection's busy timeout only after a real SQLite failure; it does not rewrite SQL, add waits, release the holder, or retry. The regression also checks recovery, integrity, the preserved original import, original invoice data, and unchanged transaction/allocation/import/audit counts. It uses no sleeps, release timer, skip, or assertion relaxation.

The worker helper patch limits captured stderr to 8192 bytes, reports child exit and signal, and uses `close` so stderr is drained. Its observation of the early `done` rejection retains the original rejecting promise for the later await.

## Evidence limits and interruption

Full local raw logs, the standalone probe source, and any unconfirmed README/evidence copies are **not present in this recovered checkpoint**. SHA-256 values in results.json were recorded before the outage; the associated raw files have not been restored or reread by this checkpoint. The original CI raw log hash is retained as provenance, not as a claim that the log bytes were rescued here.

The last local cell, `g22:17`, attempted documentation/evidence work and was terminated after environment failure. Whether those local documentation writes completed is unknown. No product edit or commit was in that cell. There were zero newly frozen local commits at the checkpoint.

## Remaining work

A separate, explicitly authorized repair must restore the test patches on the exact intended base, preserve the RED evidence and original assertions, apply only the proposed order change if still justified, and run the unchanged contention regression plus existing two-process, crash/restart, idempotency, receipt and database gates. Node 22 verification and independent review remain required before any claim of readiness. This checkpoint performs none of those steps.
