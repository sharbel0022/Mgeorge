# Final PR60 CI archive — head520, 2026-11-06

## Result and scope

The actual new PR60 runs for head `520e22716c6298e4d24ccf3989e87cfe563d8d14` passed on attempt 1:

- [Payment control checks 42176691810](https://github.com/sharbel0022/Mgeorge/actions/runs/42176691810): **7607/7607 tests** — Node 2323, Sites 5237, bridge 47.
- [SaaS security acceptance 42176691849](https://github.com/sharbel0022/Mgeorge/actions/runs/42176691849): **325/325 Node + 929/929 Sites = 1254 overlapping checks**, recorded separately.

Every outer test summary reports **0 fail, 0 cancelled, 0 skipped and 0 todo**. The cancellation fixture intentionally aborts its inner synthetic test; the outer regression passed all cleanup assertions.

These are fresh results for head520. Nothing is inferred from the earlier head8c/7606 run. This archive contains no main CI proof, no RED-run archive, and no deployment evidence.

## Actual checkout

All four complete job logs show `git log -1 --format=%H` returning:

`c7a22cbc13c9b1dbed1d825278c91ea369c2c447`

The GitHub commit record verifies ordered parents `237dd45e7e1b40513d2dd25ccff59bb08f023264` and `520e22716c6298e4d24ccf3989e87cfe563d8d14`. Its tree `4df922a5284fd1ee040e246a8cb88ae4dfae9175` exactly equals the final PR head tree. Run and job records bind all results to PR60, event `pull_request`, and attempt 1.

## Terminal jobs

| Job | Job ID | Result | Started UTC | Completed UTC |
| --- | --- | --- | --- | --- |
| bankgiro_bridge | 127756674626 | success | 06:47:41 | 06:47:57 |
| sites | 127756675056 | success | 06:47:41 | 06:53:53 |
| test | 127756675126 | success | 06:47:41 | 06:51:35 |
| security_acceptance | 127756675302 | success | 06:47:40 | 06:50:31 |

## All 16 mandatory Payment command gates

Each row is matched to the workflow at the frozen head, a successfully completed job step, and the exact command in that job's original raw log. Complete step timestamps and line evidence are in [command-gates.json](command-gates.json).

| Gate | Job | Command | Result | UTC interval |
| --- | --- | --- | --- | --- |
| 1 | test | `npm ci --ignore-scripts` | success | 06:47:51–06:47:53 |
| 2 | test | `npm run check` | success | 06:47:53–06:47:58 |
| 3 | test | `npm audit --audit-level=high` | success | 06:47:58–06:47:58 |
| 4 | test | `npm run test:isolated` | success | 06:47:58–06:51:31 |
| 5 | sites | `npm run install:ci` | success | 06:47:51–06:48:06 |
| 6 | sites | `node scripts/minimatch-backport.mjs --check --require-target` | success | 06:48:06–06:48:06 |
| 7 | sites | `npm ci --ignore-scripts` | success | 06:48:06–06:48:07 |
| 8 | sites | `npm run check` | success | 06:48:07–06:48:19 |
| 9 | sites | `npm audit --audit-level=high` | success | 06:48:19–06:48:46 |
| 10 | sites | `npm --prefix ../bridge/bankgiro ci --ignore-scripts` | success | 06:48:46–06:48:47 |
| 11 | sites | `npm run test:isolated` | success | 06:48:47–06:53:37 |
| 12 | sites | `npm run build` | success | 06:53:37–06:53:50 |
| 13 | bankgiro_bridge | `npm --prefix bridge/bankgiro ci --ignore-scripts` | success | 06:47:48–06:47:49 |
| 14 | bankgiro_bridge | `npm --prefix bridge/bankgiro run check` | success | 06:47:49–06:47:49 |
| 15 | bankgiro_bridge | `npm --prefix bridge/bankgiro audit --omit=dev --audit-level=high` | success | 06:47:49–06:47:50 |
| 16 | bankgiro_bridge | `npm --prefix bridge/bankgiro run test:isolated` | success | 06:47:50–06:47:55 |

The Sites check launcher confirms `tsc --noEmit` behind the existing dependency-byte guard. All dependency audit gates passed. **Sites still reported eight moderate findings** under the configured high-severity threshold; Node and bridge reported zero vulnerabilities.

The actual Sites build completed from **06:53:37 to 06:53:50 UTC**, including the bundle outputs and `Build complete.`.

## Focused outcomes from the full Node log

| Test | Result | Duration ms |
| --- | --- | --- |
| two real processes import and reconcile one bank payment once, then replay safely after restart | PASS | 417.138003 |
| abrupt process exit during bank insertion rolls back the entire import and retries once | PASS | 315.228064 |
| startup resources close a hanging contender and release its SQLite holder on real test cancellation | PASS | 80.056787 |
| opening a prepared WAL database uses its bounded busy wait before contention failure and recovers after release | PASS | 5134.96192 |

The exact original concurrency file and repaired contention/helper/cancellation sources are retained under `source/test/`. Their Git blob IDs match the frozen reviewed sources; the cancellation regression remains the same immutable fixture used for the RED candidate.

## Observed versions

All four setup logs report Node **v22.23.4**, npm **10.9.9**, and Yarn **1.22.22**. The runner reports **2.338.2** and Git **2.56.0**. Sites bundle logs report Vite **8.3.5**. SQLite's numeric library version was not printed by these jobs and is not invented here.

## Complete evidence and verification

- `logs/` contains **four full original job logs**, totaling **3299234 UTF-8 bytes**. BOM, timestamps, line endings and GitHub's existing masked placeholders are retained unchanged.
- `github/` contains original run/job/head/merge/artifact response bodies and a minimal point-in-time PR projection.
- `source/` contains the two exact workflows, four relevant test/helper sources and the Sites typecheck launcher from head520.
- [ci-receipt.json](ci-receipt.json), [command-gates.json](command-gates.json), and [focused-results.json](focused-results.json) preserve the derived findings with source bindings.
- [readbacks.json](readbacks.json) records exact immutable-blob readback checks. [manifest.json](manifest.json) records byte lengths, SHA-256 and Git blob SHA-1 identities. The manifest excludes only itself.

Only original log content is stored; connector/transport headers, redirect credentials and private chat references are not appended.

The SaaS job uploaded artifact **13483314471**, **52711 bytes**, digest `sha256:881e5e88e3e6b16365e252151fafef7e1c4fb3b522246837acf4fbd30409078d`. Its metadata and full job stdout are preserved. The ZIP and its internal per-suite log files were not downloaded by this UTF-8-only archival workflow.

The PR snapshot was read before subsequent changes and records its own timestamp. It is historical source context, not a claim about the current PR or main state. This separate evidence branch is based on head520 and changes no product, test, workflow, PR ref/body, main ref or deployment.
