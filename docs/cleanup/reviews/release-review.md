# Independent release cleanup safety review

**Reviewed:** base `b154ac8e`, head `091e5ceaab3c5c636c6a0ba1c029dffafdb26885`; supplied four-file diff and exact implementation in `/workspace/scratch/2236a42849dc/worktrees/release-tools`.

**Spec verdict: PASS. Code-quality verdict: PASS. No actionable blocking findings found.**

This is a source and focused-test-design review, not an execution authorization or a claim that remote cleanup has happened. Review performed no remote mutations, source edits, broad suites or builds. The coordinator reports the final focused suite as **27/27**; those tests were inspected but not independently rerun. The English operations guide is being translated separately; this verdict covers the reviewed semantics.

## Safety evidence

- **Execution and permissions:** `.github/workflows/branch-cleanup.yml:3–22` limits the trigger/job to the exact repository and `release/cleanup-approved-20261107`, with serialized runs and no PR trigger. `scripts/release/branch-cleanup.mjs:136–146,190` additionally requires both the execute flag and manifest `execute: true`, plus the expected Actions repository/ref/event. Missing manifests and false execution flags cannot delete refs. Credentials stay in normal Actions checkout/API use; there is no credential export or alternate credential acquisition.
- **Literal names and SHA binding:** `scripts/release/branch-cleanup.mjs:23–39` restricts candidate/active branch names, rejects option/refspec/path-like invalid names through both a narrow allowlist and Git's ref validation, requires full lowercase SHAs and rejects duplicate candidates. Git uses argument arrays rather than shell interpolation. Archive names use a validated SHA and a digest of the branch name, avoiding branch-derived filesystem paths.
- **Repository and history checks:** `scripts/release/branch-cleanup.mjs:148–149,161–182` requires the configured expected origin, complete history, exact API response identity/SHA, exact fetched SHA, graph ancestry into the approved main, and fresh remote reads. Unknown/rejected API states or failed Git checks block the operation.
- **Active and protected branches:** `scripts/release/branch-cleanup.mjs:151–170` independently blocks main, feature/95-saas, the execution branch, the current attached checkout branch, and all declared active branches. Deletion requires explicit `protected: false`. Open PR checks cover both head and base; matching a fork branch name conservatively retains the candidate as well.
- **Complete PR enumeration:** `scripts/release/branch-cleanup.mjs:53–65` traverses 100-row pages until a short page, rejects duplicate/ambiguous row identities, and fails closed if its 100-page limit is reached. State/branch-field validation occurs before use. This avoids treating only the first page as the complete open-PR inventory.
- **Archive before delete:** `scripts/release/branch-cleanup.mjs:84–124,186–193` preflights every candidate before archive writes, pushes archive tags without force, verifies the remote peeled head, then verifies a full recovery bundle via an independent bare clone, exact candidate/main recovery and strict fsck. All of this precedes the first branch deletion. A crash before artifact upload still leaves the verified remote archive tags.
- **Race handling and leases:** `scripts/release/branch-cleanup.mjs:194–198` repeats inspection before each deletion and uses an explicit `--force-with-lease=refs/heads/BRANCH:EXACT_SHA` with an empty source. It does not overwrite main or force an archive tag. A changed candidate head is retained by Git even after the final read; the focused tests include a real Git race induced after that read. The post-deletion read detects a recreated branch and does not issue a repeated deletion.
- **Evidence and partial outcomes:** `scripts/release/branch-cleanup.mjs:197–215` records progress and final remaining refs, distinguishes partial completion, and stops on errors. `.github/workflows/branch-cleanup.yml:41–51` preserves receipts, bundle and test evidence even after a failed processing step. No credential configuration or restored repository is uploaded.

## Limits relevant to the actual run

The manifest still needs a fresh human-reviewed inactivity inventory: absence of an open PR cannot establish that a collaborator has stopped using a branch. The guide states this clearly, and the hard-coded known active branch remains protected independently of the manifest. This review does not approve any particular deletion manifest.

PR creation and main movement cannot be made atomic with this Git branch deletion. The implementation makes fresh checks and uses a candidate-head lease; the guide accurately discloses the remaining PR/main race. Archive and verified recovery are complete before that window. Server-side protection remains authoritative; there is no bypass path.

No additional implementation changes are requested from this review. Required integration checks and review of the exact execution manifest remain with the coordinator before any live run.
