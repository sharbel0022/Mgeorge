# OCR worker exit/IPC diagnosis — bounded independent follow-up

2026-11-06. Source: `24390ef7e8cf6b2274c57804dc9c2d74d362ab12`, tree `ad40b5a5ae7710939801d73e5e16eb80f3186f48`. **The cause of the four first-pass worker exits is not established.** No new holdout corpus, gold, image, text, prediction or observation file was opened. No holdout case was repeated. Product code was unchanged.

## Verified findings

`src/invoice-worker.js` already uses `process.send(result, () => process.exit(0))`. There is no immediate unconditional exit following the send call. Four new transport probes, using small and 262,144-byte payloads with that same callback/exit pattern, delivered `message` before `disconnect`, `exit(0)` and `close(0)`. This finite probe did not reproduce a flush/exit race and cannot prove one impossible.

A freshly generated 640×240 synthetic image, unrelated to any evaluation document, passed through the actual unchanged worker. It returned OCR IPC and exited with code 0. Only sizes and event order were recorded, not field accuracy. This is a diagnostic execution, not an additional holdout result.

The parent wrapper's exit handler discards `(code, signal)` and throws `Error('worker')`. Child stdout/stderr are ignored. Independent controlled children confirmed that **exit 0 with no IPC, exit 7 and SIGTERM all become the same error with neither code nor signal**. The previous generic error therefore does not establish a successful child exit, an OOM event, a native failure, or a cleanup failure. The 90-second timer throws a separate `Error('timeout')`; an exit-handler stack alone does not identify why the process exited.

A concrete unsheltered control-flow path exists before IPC: the handler catches `run()` failures but performs `await ocr.terminate()` in `finally` before `process.send`. A cleanup exception prevents even `{error:true}` from being sent. A test-only Tesseract stub that returned a synthetic recognition result and rejected `terminate()` reproduced **exit 1 without IPC** through the actual unchanged worker file. That injected failure establishes the path, not the cause of any original case.

The parallel reviewer checked installed Tesseract.js 6.0.1 against the lockfiles: its `terminate()` wrapper invokes the Node adapter, clears its worker reference and resolves; the adapter does not await/return the underlying worker-thread termination promise. Consequently the application's `await` does not prove complete thread shutdown. No ordinary asynchronous cleanup rejection from that implementation was established. The IPC send callback also ignores its error argument and always chooses exit 0, so a failed send has no structured diagnostic.

## Safe follow-up recommendation

Root review should precede any product correction. A bounded observability change should preserve the existing user-safe failure and expose only structured internal metadata: fixed failure category, exit code, signal, elapsed time, timeout state, whether IPC was received, and process phase. Keep spawn/send/timeout/exit-without-result distinct. Do not log image bytes, OCR text, extracted fields, credentials or unfiltered child stderr in production.

Handle cleanup and send-callback errors explicitly so cleanup cannot silently skip the result/error protocol. Preserve the cleanup error as a separate failure, with a settled-once parent result and a bounded child-lifecycle policy. Any change to when the worker is considered finished should be tested against controlled message/exit ordering and termination failures. Do not change parser thresholds, retry the first-pass holdout, raise memory budgets, or call the four failures OOM on current evidence.

## Diagnostic receipt

The test-only harness temporarily instruments `node:child_process.fork` to retain stderr and process events. It uses the original parent wrapper and original 256 MiB V8 old-space flag. Controlled transport children and the explicit cleanup fault are marked separately from the final actual-worker run. One real optical call was made on the new synthetic image. No broad suite or build was run; all diagnostic processes ended.

[Probe source](ocr-worker-ipc/probe.mjs), [raw event receipt](ocr-worker-ipc/receipt.json), and [SHA-256 index](ocr-worker-ipc/index.json) retain the evidence. The probe contains the exact isolated paths used for this run and regenerates its simple synthetic input. Root/Sites dependencies were reused only after both lockfiles were compared byte-for-byte. Source hashes matched after execution; only this report and receipts are committed.

Command used from the exact-source worktree:

```sh
env -i PATH="$PATH" NODE_ENV=test LANG=C.UTF-8 \
  node --import ./scripts/saas-test-isolation.mjs \
  /workspace/scratch/aab0f7dc06f9/security-evidence/ipc-24390ef/probe.mjs
```
