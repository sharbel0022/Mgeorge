# PR62 independent security-CI verification

**No blocker identified in security run [42251628601](https://github.com/sharbel0022/Mgeorge/actions/runs/42251628601).** The run and its only job completed successfully; all 10 reported job steps succeeded. The reviewer checked the job log, artifact metadata, archive SHA256, `report.json`, both raw TAP logs and the Git source identity. No run restart or product change was made.

| Synthetic suite | Passed / total | Failed | Cancelled | Skipped | TODO | Exit / signal |
|---|---:|---:|---:|---:|---:|---|
| Node security | 377 / 377 | 0 | 0 | 0 | 0 | 0 / null |
| Sites security | 1,225 / 1,225 | 0 | 0 | 0 | 0 | 0 / null |
| **Total** | **1,602 / 1,602** | **0** | **0** | **0** | **0** | — |

The raw TAP totals match the report; no failed assertion, skip or TODO directive was found. The acceptance runner used Node **v22.23.4**, from `2026-11-06T16:22:05.423Z` to `2026-11-06T16:24:12.452Z` (127.029 seconds). CI recorded `workingTreeDirty: false` when it initialized the report.

## Exact source binding

GitHub's normal PR checkout tested merge commit **`795decf5b1601de2d1738e0a311dbc53e0840c72`**, not the literal PR-head commit. Its parents are main `24390ef7e8cf6b2274c57804dc9c2d74d362ab12` and PR head **`70dd9c5dca6981e440bec0486e43788d2ef3f6a1`**.

The reviewer fetched that immutable Git object read-only and verified:

- Both head and tested checkout have whole tree **`c1912a91e44ecaca7095dcaca1201c3904df87d7`**.
- Both have Sites tree **`c2feb372a4c0ef121ffe594784684957c14ddac1`**.
- `git diff --name-only` between head and checkout is empty.

Thus this CI result binds to the exact complete tree supplied for PR62. `source-manifest.json` is a reviewer-generated source-binding receipt with whole-tree identities and hashes for the workflow, runner, isolation guard, dependency locks and installation verification scripts. It is identified separately from the original CI-produced `report.json`.

## Artifact integrity and retained evidence

Artifact **13520996883**, `saas-security-795decf5b1601de2d1738e0a311dbc53e0840c72`, is **65,462 bytes**, SHA256 **`1689a1f3b9225028424562a822febe4240682b42d5fe5a954c02484437a1658f`**. The downloaded archive matched both the API digest and the job's upload digest. It contained exactly `report.json`, `node-security.tap` and `sites-security.tap`; the report and lossless compressed TAP copies are retained here.

The original verified ZIP and extracted evidence are available for the parent to preserve without downloading again:

- `/workspace/scratch/aab0f7dc06f9/security-evidence/pr62-security-42251628601.zip`
- `/workspace/scratch/aab0f7dc06f9/security-evidence/pr62-security-42251628601/report.json`
- `/workspace/scratch/aab0f7dc06f9/security-evidence/pr62-security-42251628601/source-manifest.json`
- `/workspace/scratch/aab0f7dc06f9/security-evidence/pr62-security-42251628601/review-receipt.json`

## Scope limits

This run establishes the tested synthetic authorization, company isolation, role, session, banking boundary and recovery assertions. Its own report retains `multiCompanyAcceptance: INTERNAL_BOUNDARIES_PASSED`, **`productionAcceptance: NOT_VERIFIED`** and **`commercialLaunch: NOT_APPROVED`**. It does not establish production restore, live provider behavior, external provider performance or commercial launch acceptance.

The separate quality workflow `42251628527`, artifact integration, merge and deployment belong to the parent. This receipt does not infer their result from the green security job. The reviewer performed only read-only CI/log/artifact/source verification and documentation writes in an isolated docs branch.
