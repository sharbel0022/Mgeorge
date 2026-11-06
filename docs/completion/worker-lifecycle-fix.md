# Narrow OCR worker lifecycle correction

2026-11-06. Base `24390ef7e8cf6b2274c57804dc9c2d74d362ab12`. Fryst RED-testcommit: `6cba09889f4ecb7c5be3e3a14820fbecbe09f02c`. Produktfix: **`f5d178ea816d276457685fbc0421cf144f7cf655`**, whole tree `85b3e39bf97c93246beed073bb3790baf62d94cd`.

## Problem and corrected behavior

A completed OCR result or unreadable-result receipt could be discarded when the worker's cleanup failed before IPC. The worker now catches that cleanup failure separately, retains the entire existing receipt, and adds only `workerDiagnostics: {code: 'DOCUMENT_WORKER_CLEANUP_FAILED'}`. The private exception is not attached or printed. Text, confidence and all hash-bound OCR evidence remain identical to the successful-cleanup result.

The worker's IPC callback now exits unsuccessfully on a send error; a synchronous send exception also exits 1. A send failure cannot synthesize a successful OCR receipt.

The parent still exposes the existing `worker` and `timeout` messages and the existing 429 concurrency behavior. It attaches only fixed failure categories and process metadata: `code`, `exitCode`, `signal`, `elapsedMs`, `receivedMessage`, `timedOut`. Signal names are constrained to native OS signal constants. Spawn/send exceptions are replaced by the safe public error instead of retaining attacker-controlled exception messages, paths or payload. No raw child output, OCR text, original bytes, credentials or exception cause are added to diagnostics.

The 90-second timeout, 256 MiB V8 old-space cap, two-call admission limit, Swedish Tesseract model, PSM AUTO and all parser/financial rules remain unchanged. The correction does not add a cancellation API or a production test bypass. Cancellation coverage exercises termination of actual child processes and subsequent slot reuse. No retry policy was introduced.

Only `src/invoice-extraction.js` and `src/invoice-worker.js` changed in product code: 24 insertions and 8 deletions. The entire `sites/` subtree remains **`ff078901d22a76ce0d0eac775e405ca50d8bcc6e`**, identical to the base.

## Frozen regressions and focused integration

| Run | Result |
| --- | --- |
| Frozen 12-case boundary suite on original product | **0 pass / 12 fail**, 5,422.093 ms |
| Same unchanged suite after correction | **12/12 PASS**, 7,376.413 ms |
| Five-file focused integration on exact fix commit | **107/107 PASS**, 94,238.731 ms |

All runs report zero cancellation, skips and TODOs. The tests exercise actual forked child processes and the actual worker entrypoint. Fault doubles replace the Tesseract dependency or IPC transport at the boundary; no product source-string assertions are used. The controlled cases cover retained success/error receipts under cleanup failure; no-result exit 0, nonzero exit and signal; worker send callback/throw failures; parent spawn/send failures; private error text exclusion; the registered 90-second timeout; two active jobs, third-call 429 and slot reuse after termination. Normal OCR text, confidence and the complete evidence object are compared unchanged across a cleanup fault.

The timeout test captures and invokes the actual registered 90,000 ms callback from test code after an actual hanging child has spawned. It does not change production timing or introduce configuration flags. Existing raster/Bankgiro evidence, PDF layout, invoice extraction and Sites-OCR transport tests form the remaining focus. These are existing development fixtures; no blinded evaluation input or observation was read or rerun.

The source/tests were frozen for GREEN and focused acceptance. Root and Sites dependency lockfiles matched the reused installation byte-for-byte. The temporary root dependency symlink was removed after testing. No broad local suite/build was run; the release owner owns mandatory complete PR 62 CI and integration on its exact source. Independent review was requested from the bank completion reviewer on the frozen product hash.

## Evidence and limits

[Machine-readable receipt](worker-fix-evidence/receipt.json) binds commands, source hashes, totals and deterministic compressed log hashes. Raw logs are retained as [RED](worker-fix-evidence/red-frozen.tap.gz), [GREEN](worker-fix-evidence/green.tap.gz) and [focused](worker-fix-evidence/focused.tap.gz). All private-looking strings in those regression logs are intentionally synthetic test markers.

The separate [IPC diagnosis](ocr-worker-ipc-diagnosis.md) remains applicable: the cause of the four prior blinded-evaluation exits was not established. This correction fixes reproduced lifecycle/error-reporting defects; it does not prove those four exits are fixed, identify OOM, or improve parser accuracy. The new independently authored cohort must bind to the final reviewed source before its first optical call. No production call, provider call, holdout access, deployment or financial write was made in this work.
