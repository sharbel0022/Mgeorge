# Task 3 independent-review fixes

All three reported P2 defects were verified with focused behavioral reproductions, then fixed one at a time on `work/cleanup-startup` based on `0bdc2fc`. No edits were made to the coordinator worktree's implementation. No full suites/builds, remote push, production change, real provider call, customer-data operation or subagent was used in this follow-up.

Apply these three commits in order:

1. `bf56289` — fix: await owned installer cancellation before releasing launcher.
2. `83aa473` — fix: enforce absolute HTTP readiness and control deadlines.
3. `be943c3abcc8ac5221a82e1204b4fb4860fbf4ae` — fix: serialize first-run database paths with verified dotenv quoting.

The task worktree is clean after all commits. These are follow-ups to the previously cherry-picked original lifecycle commit.

## Finding 1: authenticated stop while npm installation is in progress

**Verified defect.** Root shutdown only awaited the backend child. During first installation there is no backend child yet, so shutdown released the control port/state while its awaited `install()` and owned npm continued. Signal listeners in `npm()` did not help because authenticated HTTP stop did not send an OS signal.

**RED reproduction:** A fixture uses a real owned Node installer process through `npm_execpath`, writes a started receipt, and waits. On SIGTERM it writes a terminating receipt, waits700ms and writes a stopped receipt. Authenticated `stop` initially never reached the terminating state; the test failed after4s. This was an observable missing cancellation, rather than a source assertion.

**Fix:** Launcher owns an installation AbortController and its installation promise. Shutdown aborts the controller, then waits for the owned npm child's close before releasing ownership. `npm()` sends SIGTERM only to its retained child handle, has a1500ms SIGKILL fallback for that same child, clears the fallback/listeners, waits close/error settlement, and rejects cancelled work. `install()` accepts the signal. The setup command also connects authenticated stop and signals to this cancellation path; its existing sequential finally releases ownership only after installation settles. Normal build callers retain the optional-signal default.

**GREEN regression:** Installer receives cancellation; launcher state remains through the grace interval; a competing start is refused; installer and launcher exit before stop confirmation; control state is removed; an unrelated live process survives. This verifies real child behavior and checkout ownership without PID-file signaling.

## Finding 2: HTTP inactivity timer did not bound total readiness/control time

**Verified defect.** `http.request({timeout:800})` resets with socket activity, so a peer could drip partial bytes indefinitely. The old helper did not settle on an aborted response/premature close, and it measured decoded string length rather than response bytes.

**RED reproductions:** Three direct real-HTTP tests failed: continuous60ms whitespace drip remained pending after1800ms; a content-length100 response destroyed after a short prefix remained pending; an encoded multibyte JSON body exceeding8192 bytes was accepted. Complete valid JSON continued to work.

**Fix:** `request()` has an absolute wall-clock timer, default800ms, independent of traffic. It counts received Buffer bytes and rejects above8192; handles request errors and response aborted/error/premature-close/end; settles once; clears the deadline and destroys failed request/response resources. Launcher probes pass the remaining startup budget capped at800ms, and inter-probe waits respect the remaining budget. Both readiness and authenticated control use this helper.

**GREEN regressions:** All four HTTP cases pass. Two command-level cases also pass: a real launcher with a continuously dripping fake health route exits with readiness failure under its500ms health budget (including actual isolated npm fixture installation and teardown, around0.9s total); `stop` against a continuously dripping unrelated loopback listener rejects in around0.87s, and the unrelated listener remains running. Thus the fix is exercised through actual readiness and control consumers as well as the helper.

## Finding 3: JSON escaping corrupted dotenv DB_PATH persistence

**Verified defect.** JSON double-quote/backslash escaping is a different grammar from Node's dotenv parser. A literal Windows `C:\new\data.sqlite` path parsed into different characters after setup. Embedded quote cases can truncate. String replacement also treats `$&` specially unless given a function replacement.

**RED reproductions:** First setup with backslash path succeeded but `parseEnv(savedEnv).DB_PATH` differed from the original. A CR-containing path was persisted rather than rejected before writes. Both assertions visibly failed before the fix.

**Fix:** A dedicated dotenv serializer tries supported quote delimiters (single, backtick, double, unquoted), skips embedded delimiters and accepts a candidate only when Node's actual `util.parseEnv` returns exactly one intended key with the exact original value. Values with no exact representation throw a Swedish actionable error before `.env` or dependencies are written. The template replacement uses a callback so `$&` remains literal. This preserves all supported path characters without pretending JSON is dotenv.

**GREEN regressions:** Exact parser roundtrip for Windows backslashes, embedded double quotes, embedded single quotes, spaces and literal `$&`; unsupported CR representation fails with no .env and no dependency directory. These tests pass on both supported Node versions' actual dotenv parsers.

## Final verification

Final exact committed source: `be943c3abcc8ac5221a82e1204b4fb4860fbf4ae`.

Commands ran sequentially:

```sh
node --test test/local-lifecycle.test.js test/local-server-lifecycle.test.js test/local-http-request.test.js
/workspace/scratch/2236a42849dc/node22/node_modules/.bin/node --test test/local-lifecycle.test.js test/local-server-lifecycle.test.js test/local-http-request.test.js
git diff --check
git status --short
```

- Node24.22.1: **26/26 passed**, zero failures/skips/cancellations; duration11401.481ms.
- Node22.23.4: **26/26 passed**, zero failures/skips/cancellations; duration11088.483ms.
- Diff check passed; worktree clean. Read-only dependency symlink used for real-server regression prerequisites was removed afterward.
- Logs: `task-3-evidence/review-focused-node24.log` and `review-focused-node22.log` beside this report.
- No broad suite or build was rerun, per coordinator request. Final integrated CI and domain-facade wiring remain coordinator verification.

The follow-up used three item-by-item RED/GREEN rounds and resolved all three findings; no unresolved review defect remains from this list. Linux was exercised; Windows path serialization is validated as string/parser behavior on Node22/24, while native Windows process behavior remains untested.
