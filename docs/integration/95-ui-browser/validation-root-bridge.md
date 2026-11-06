# UI 9.5 — root and bridge validation

**PASS: 1,997 root + 47 bridge = 2,044 passing tests.** Both suites report 0 failures, cancellations, skips and TODOs. All six commands exited 0. These are fresh runs on the integrated branch; the earlier 1,899-root-test result is not reused.

## Provenance and runtime

- Branch: `feature/95-ui`.
- Merged base (`origin/main`): `bf24a3c52ffc637d1e7bbc4d4f64a1732dcd9fee`.
- Tested head: `a50c57b802e9b2615fad064065bcb6d9d4726c89`; merge parents `da0559c` and `bf24a3c`.
- Committed tree at the tested head: `d3ab2f043e9b5d76be09e3868b1f0ad031aae31a`.
- UTC window: `2026-11-05T21:32:59.203776+00:00` through `2026-11-05T21:38:54.951175+00:00`; total wall time **355.747 seconds**. Independent gates ran concurrently.
- Environment: **Linux x86_64; Node v24.22.1; npm 11.9.0**. CI specifies Node 22; this report covers the stated local runtime.
- Working directory: `/workspace/scratch/a79875d7c884/Mgeorge`.
- Requirements read from `AGENTS.md`, `.github/workflows/payment-control-ci.yml`, root and bridge `package.json`, `scripts/check.mjs`, and `scripts/saas-test-isolation.mjs`.

## Commands and outcomes

| Gate | Exact command | Outcome | Elapsed seconds | Full log |
| --- | --- | --- | ---: | --- |
| Root syntax | `npm run check` | 180 JavaScript files | 18.779 | `root-check.log` |
| Root isolated tests | `NODE_ENV=test npm run test:isolated` | 1,997/1,997 passed | 355.446 | `root-tests.log` |
| Root audit | `npm audit --audit-level=high --json` | 0 vulnerabilities; high gate | 10.613 | `root-audit.log` |
| Bridge syntax | `npm --prefix bridge/bankgiro run check` | 6 JavaScript targets | 1.272 | `bridge-check.log` |
| Bridge isolated tests | `NODE_ENV=test npm --prefix bridge/bankgiro run test:isolated` | 47/47 passed | 8.060 | `bridge-tests.log` |
| Bridge audit | `npm --prefix bridge/bankgiro audit --omit=dev --audit-level=high --json` | 0 vulnerabilities; production dependencies; high gate | 10.502 | `bridge-audit.log` |

Both audits report **info 0, low 0, moderate 0, high 0, critical 0, total 0**. `--json` only selects the audit output format. Audit transport overrides were `npm_config_fetch_retries=0` and `npm_config_fetch_timeout=60000`; the required high-severity thresholds were unchanged. npm emitted its existing non-fatal `Unknown env config "http-proxy"` warning.

## Evidence and scope

Full stdout/stderr logs and execution metadata are under `/tmp/mgeorge-95-ui-root-bridge-mbensud0`. `result.json` records exact command arguments, environment overrides, timestamps, exit codes, per-log SHA-256 hashes, and before/after source hashes. Its SHA-256 is `6cf83c1d969c8fc84a37bfa444f27fe47a030cadcdd83b71098d4bc0591f1e01`. The root test runner reported `354676.368942` ms and the bridge runner `7349.479637` ms; the table includes npm/process overhead.

The head and base refs stayed unchanged during the run. SHA-256 checks matched before and after for all **216 scoped tracked files** under `src`, `public`, `scripts`, `test`, and `bridge/bankgiro`, plus root manifests and the CI workflow. A final `git diff --exit-code HEAD -- sites/lib sites/drizzle sites/tests/helpers sites/tests/company-client.test.mjs package.json package-lock.json bridge/bankgiro/package.json bridge/bankgiro/package-lock.json` also exited 0, covering shared Sites modules used by these suites.

Each full suite ran **once**. Existing dependencies were reused as instructed; no installation, dependency update, product edit, or harness-code edit was performed for this validation. The only repository output from this validation task is this report. Tests use synthetic data and the configured loopback isolation guard. Sites UI changes, Sites gates, browser acceptance, Node 22 CI and deployment are outside this report and are assessed separately.
