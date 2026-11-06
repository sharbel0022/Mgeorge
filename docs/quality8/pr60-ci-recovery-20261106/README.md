# PR60 CI recovery archive — 2026-11-06

## Verified result and source boundary

PR [#60](https://github.com/sharbel0022/Mgeorge/pull/60), frozen head `8c744db37816411d8ad8b70c5b94202c74c37e62`, passed both observed pull-request workflows on their first attempt. This archive covers only those PR executions. It makes no claim about subsequent main-branch CI, publication, a provider account, or independent product review.

The Payment workflow ran **7,606/7,606 tests** with zero failures, cancellations, skips, or TODOs. SaaS security acceptance separately reported **325/325 Node + 929/929 Sites = 1,254 overlapping checks**, also with zero failures, cancellations, skips, or TODOs. The overlap is not added to the Payment total.

| Workflow/job | Run / job ID | Tests passed | Terminal UTC |
| --- | --- | --- | --- |
| Payment / Node | 42169919988 / 127735079993 | 2322/2322 | 05:45:25 |
| Payment / Sites | 42169919988 / 127735079843 | 5237/5237 | 05:48:51 |
| Payment / bridge | 42169919988 / 127735079604 | 47/47 | 05:42:01 |
| SaaS / security_acceptance | 42169920060 / 127735081102 | 325 + 929 overlapping | 05:44:39 |

All reported job steps completed successfully. The installed test runtime was **Node v22.23.4**.

## Actual checkout, rather than only a reported workflow head

All four original job logs show `git log -1 --format=%H` returning:

`3c2ffa129d7cc7c50eef06e16e405908f0c6a287`

GitHub's commit record proves that this synthetic PR merge has ordered parents:

1. `237dd45e7e1b40513d2dd25ccff59bb08f023264` — the PR base.
2. `8c744db37816411d8ad8b70c5b94202c74c37e62` — the frozen PR head.

Its tree is `9eeed8e9a840352c48987a66314a6a22e082a60e`, exactly equal to the verified frozen head tree. Both workflow records identify event `pull_request`, PR60, the expected head/base, and attempt 1.

## Relevant gates and observations

- The new deterministic WAL-startup regression passed in **5158.643886 ms** on Node 22.
- The existing real two-process import/reconcile/restart test passed in **243.47559 ms**.
- Node syntax checks, bridge syntax checks, and Sites `tsc --noEmit` passed. The guarded Sites check launcher at the frozen head is retained under `source/`.
- All three dependency audit gates passed. Node and bridge reported zero vulnerabilities. **Sites still reported eight moderate-severity findings**, which do not fail its configured `--audit-level=high` gate. Audit success is not presented as a zero-vulnerability result.
- The exact installed minimatch mitigation byte check passed.
- The actual Sites `npm run build` step passed from **05:48:32 to 05:48:48 UTC**. The full log contains the bundle build outputs and `Build complete.`; the terminal job-step record agrees.

These results verify the repaired startup path under the actual CI runtime. They do not retroactively establish the unknown cause of main237's earlier generic worker-before-ready failure.

## Archived evidence

- `logs/`: the four complete original workflow job logs returned by GitHub's decoded-log endpoint. The returned strings are preserved without normalization, truncation, line filtering, or added headers. Their UTF-8 BOM, timestamps, line endings, and GitHub's already-masked credential placeholders remain intact.
- `github/`: original run/job/commit/artifact JSON response bodies, plus a deliberately small PR-status projection. The job bodies include every reported step and terminal timestamp.
- `source/`: the exact two workflow definitions and Sites typecheck launcher fetched from the frozen PR head.
- [ci-receipt.json](ci-receipt.json): source bindings, test summaries, checkout evidence, gates, observed timings, and limitations.
- [readbacks.json](readbacks.json): direct Git blob readback checks for the data files, with content equality and object-ID verification.
- [manifest.json](manifest.json): SHA-256, Git blob SHA-1, UTF-8 byte length, and source provenance for the archived files. It excludes only itself; its own identity is recorded in the handoff receipt.

No connector response wrappers, transport headers, redirect credentials, or private chat references are included. Standard GitHub job output containing masked `***` placeholders is retained as original log data.

The SaaS workflow also uploaded artifact **13480428541**, 52,675 bytes, digest `sha256:7d9595c5b71782fc124acae1055fc4ada223ec8a50e0c7f8cd13c547f7258ebe`. Its metadata and complete job stdout are retained. The artifact ZIP and the per-suite log files inside that ZIP were not downloaded or copied into this archive.

## PR status and operational limits

The captured post-CI PR read was open, not merged, not draft, with unchanged head/base/merge SHA and `mergeable=true`, `mergeable_state=clean`. The exact read timestamp is retained in `github/pr-status.json`; this is a point-in-time observation.

All work used connected GitHub tools while the local execution environment was unavailable. No shell, CI rerun, product change, test change, merge, deployment, bank read, document retry, or scoring change was performed. The separate archive branch is based on the frozen PR head and adds only this evidence directory.
