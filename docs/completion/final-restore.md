# Final merged-source encrypted restore and independent release opinion

Date: 2026-11-06. Reviewer: security/completion. **PASS for the full synthetic isolated restore on the exact merged source.** No new blocking finding was identified within this security/restore scope. Deployment remains the release owner's action, subject to the remaining main and hosted gates below.

## Exact source and command

| Binding | Value |
| --- | --- |
| Tested merge commit | `24390ef7e8cf6b2274c57804dc9c2d74d362ab12` |
| Tested whole Git tree | `ad40b5a5ae7710939801d73e5e16eb80f3186f48` |
| PR candidate with the same tree | `ebbea9c67f174a6879f1e638633cc53e728282e2` |
| PR CI checkout recorded in downloaded receipts, also the same tree | `4d19058628bf3ec2973be40a465c509eaf82408d` |
| Isolated branch | `work/security-final-restore` |
| Runtime | Node v24.22.1, Linux x64 |
| Drill interval (UTC) | 2026-11-06 14:53:29.082–14:53:46.033 |
| Process result | Exit 0; stderr empty |

The worktree was clean at the start and immediately after the drill. The commit and tree stayed unchanged. All 14 local restore/isolation modules, all 24 migration SQL files, the migration journal, both package manifests and lockfiles, and captured `@noble/hashes` module bytes matched their pre-run SHA-256 values. Documentation was added only after these checks. The report commit is separate from the tested product commit.

From the repository root, the existing command was:

```sh
NODE_ENV=test node --import ./scripts/saas-test-isolation.mjs \
  --experimental-strip-types sites/scripts/recovery-drill.mjs 430 185567855
```

The process received only `PATH`, `NODE_ENV=test`, `LANG=C.UTF-8` and `TZ=UTC`. It inherited no production credentials or `NODE_OPTIONS`. The existing network guard permits loopback only; the drill itself uses in-memory synthetic R2 objects, local SQLite and fresh private temporary directories. No provider call, production read/write, deployment, or live recovery-barrier operation was performed. Temporary fixture, bundle and restored data are removed by the harness after completion.

The Sites dependency directory reused an installed dependency tree whose Sites lockfile was verified byte-for-byte identical to the candidate. The imported external package is `@noble/hashes` 2.4.0; its package metadata and all top-level JavaScript files are hashed in the receipt. This was not a fresh local dependency installation; clean installs, complete suites and the production build are covered by the CI receipts below.

## Acceptance results

| Check | Result |
| --- | --- |
| Encrypted backup, interrupted copy and resume | PASS; interruption observed after 3 originals, original snapshot retained; 174 total steps |
| Original census and byte total | **430 originals; 185,567,855 bytes** |
| Original SHA-256 acceptance | **430/430 checked** against the independently frozen pre-backup census |
| Retained durable tables | **27/27**; exact rows and owner fields matched, with the deliberate worker-lease revocation transform |
| SQLite checks | `integrity_check=ok`; no foreign-key violations; exact evidence schema census |
| Financial evidence | 2 invoices totaling 75,000 öre; 2 transactions totaling 75,000 öre; 1 allocation of 62,500 öre; 1 revoked credit and 1 revoked Bankgiro link preserved |
| Snapshot cutoff | The independently added post-snapshot workspace write was excluded |
| Tenant isolation | Wrong owner/company rejected; other owner's fixture data excluded |
| Authorization and transient state | Authorization grants and transient rows absent; four seeded role labels confer no membership |
| Worker leases | Invalidated and fence version advanced in the restored evidence |
| Application tokens | No retained app tokens; fixed recovery barrier remains required |
| Synthetic source | Durable source-table rows, source-object hashes and object-write count unchanged during export/restore/acceptance |

The application-token control row was independently checked in full: `id=1`, `revision=2`, `recovery_required=1`, `restore_marker='isolated-evidence-restore'`, `recovery_evidence=''`. The destination uses `evidence_` table names and is explicitly not an activated application database.

All ten existing negative checks passed:

| Negative input | Required outcome observed |
| --- | --- |
| Wrong encryption key | Restore rejected; no output created |
| Wrong expected owner | Restore rejected; no output created |
| Wrong expected company | Restore rejected; no output created |
| Corrupted encrypted original | Restore rejected; no output created |
| Missing encrypted original | Restore rejected; no output created |
| Altered allocation/ledger | Independent acceptance rejected, even with a refreshed database-receipt hash |
| Altered restored plaintext original | Independent SHA-256 acceptance rejected |
| Foreign-owner restored row | Independent acceptance rejected, even with a refreshed receipt hash |
| Reactivated application issuer | Independent acceptance rejected, even with a refreshed receipt hash |
| Retained application token | Independent acceptance rejected, even with a refreshed receipt hash |

The harness restores the synthetic evidence after each negative mutation and performs acceptance again. This verifies the expected data against a census frozen before the backup, rather than treating a successful export or self-consistent receipt as sufficient.

## Timing, resource use and bounds

| Measurement | Observed |
| --- | --- |
| Backup and interrupted resume | 5,074.597 ms |
| Encrypted bundle export | 3,230.598 ms |
| Restore plus independent acceptance | **5,470.712 ms** |
| Whole drill | **16,951.556 ms** |
| Whole Node process, including startup | 17,182.743 ms |
| Node process peak RSS | 774,964 KiB, measured by POSIX `wait4` |
| Node CPU time | 14.043943 s user; 2.160386 s system |
| Existing isolated RTO objective | 60,000 ms, passed |
| Scenario's simulated RPO | 900,000 ms, within the 900,000 ms objective |

The OCR agent was notified before and after execution. The release owner instructed this run after observing no competing heavy build and the OCR agent's latest preparation-only heartbeat. There was no acknowledged exclusive OCR window and no global exclusive resource lock. Local elapsed times are therefore informational; no claim of resource exclusivity is made. No heap limit, timeout, assertion, input-size or test-budget override was used.

The retained limits are the existing ones: drill configuration accepts 4–4,000 originals, at most 512,000,000 total original bytes, and at most 15,000,000 bytes per original. Bundle validation caps plaintext snapshots at 12,000,000 bytes, plaintext documents at 15,000,000 bytes, manifests at 4,000,000 bytes and table rows/original census at 5,000; sealed-object framing adds 52 bytes. The independent restore path requires fresh private output and safe directory/file identities. This run exercises the stated 430-original size; it is not a new maximum-capacity or path-fuzzing test.

The RTO measurement starts when the encrypted bundle is already local. It includes authentication, new SQLite evidence creation, original write/readback and independent row/owner/ledger/hash acceptance. It excludes operator response, cloud download or regional failure, key custody/access recovery and production activation. The recovery-point/incident clock is synthetic. **`productionRestoreTested=false` remains explicit**: matching the previously observed production inventory's count and byte total does not download, restore or establish freshness of the production backup.

## CI and independent release opinion

A read-only GitHub query for the exact PR candidate independently returned both successful workflows. The reviewer also read every returned job/step status:

| CI gate on the candidate tree | Result |
| --- | --- |
| Node 22.23.4 | PASS; 2,898/2,898 tests in downloaded receipt |
| Node 24.22.1 | PASS; 2,898/2,898 tests |
| Sites types, complete tests and production build | PASS; 5,820/5,820 tests |
| Bankgiro synthetic SFTP integration | PASS; 47/47 tests |
| Chromium synthetic onboarding acceptance | PASS; 77/77 tests; zero recorded external requests or browser errors |
| Synthetic 1/10/100-company performance | PASS |
| Separate SaaS security acceptance | PASS |

The six quality-job receipts have zero failures, cancellations, skips and TODOs where test totals apply. All share whole tree `ad40b5a5ae7710939801d73e5e16eb80f3186f48` and report no source change during their run. The raw parent-downloaded summary was inspected and is retained here; it identifies CI's PR merge-test checkout `4d190586...`, not the candidate or final main commit. Source-tree equality is recorded explicitly. The dependency audit passes under the existing policy; the Sites all-dependency audit records **8 moderate findings**, with zero high/critical findings, while the production audit records zero. A passing gate is not a claim of zero findings across all development dependencies.

Workflow links: [candidate quality run](https://github.com/sharbel0022/Mgeorge/actions/runs/42235429917), [candidate security run](https://github.com/sharbel0022/Mgeorge/actions/runs/42235429991), [main quality run](https://github.com/sharbel0022/Mgeorge/actions/runs/42237265007). At this review's main-run observation, five jobs had succeeded and the Sites job was still running; no claim that main CI had completed is made in this receipt. The release owner owns its final outcome and deployment evidence.

**Independent opinion: the merged tree has passed the reviewed synthetic security and recovery gates, with no additional blocker found in this scope.** The final main workflow and hosted migration/upload/post-deployment gates still belong to the release owner. Earlier failed local full-security attempts and SIGKILL observations in [security.md](security.md) remain historical failures; the new successful remote CI and this exact-merge drill are separate evidence, not a relabeling of those attempts.

The missing-schema behavior and singleton initialization question described in [security.md](security.md) remain applicable. Request paths must not create or repair token tables. If hosted migration `0025`'s `INSERT OR IGNORE` control-row initialization is rejected by the schema-only migration validator, the release owner must resolve that packaging gate through a reviewed, authorized path. This reviewer has no new host-validator evidence. Missing tables/control row leave the configured provider unavailable; do not reset an existing recovery barrier or create tokens to obtain a green status. Actual schema state, recovery state, company authority, real mTLS/provider configuration and consent must be verified before future provider activation.

This opinion approves the bounded code/security/restore evidence for the release owner's decision. It does not certify production restoration, bank activation, commercial multi-company launch, all OCR generalization, or a 9.5 quality score. No score was changed, and this reviewer did not merge a PR, push or deploy.

## Separate bank-status review and retained artifacts

The prior independent bank-status review is a separate documentation commit: **`3eed0a2a28538bcae63602fb209ca055f9a66e6e`**. It reviewed product commit `d7ede6af7cdd6633442c773f98b880d90104ac25`, with the frozen independent probe changing from 6/22 pass before to 22/22 pass after. The final merged service/UI bytes match that review's stored hashes; the authored bank test file is unchanged as well. The checks enforced read-only SQLite, unchanged rows, zero provider dispatches and denied ordinary fetch. No bank test was rerun as part of this restore receipt. The release owner should integrate that review commit separately.

[Raw drill report](final-restore-24390ef/restore.json), [process/command/resource receipt](final-restore-24390ef/process-receipt.json), [source manifest](final-restore-24390ef/source-before.json), [post-run hash comparison](final-restore-24390ef/source-after.json), [candidate CI observation](final-restore-24390ef/candidate-ci-observation.json), [main CI observation](final-restore-24390ef/main-ci-observation.json), [downloaded PR quality summary](final-restore-24390ef/pr-quality-summary.json) and [artifact SHA-256 index](final-restore-24390ef/index.json) are retained next to this report. Stderr is an empty retained file. Full migration/dependency hashes are in the source manifest; local restore module hashes follow.

| Restore or isolation module | SHA-256 |
| --- | --- |
| `scripts/saas-test-isolation.mjs` | `9f40b9159a1ad9f4d21c7ecdc76db31fd55d6a0efe793f3f32e7548809affb80` |
| `sites/lib/backup-engine.ts` | `16c9c727c469d7083b917087eae852a07334888748e8d0041e404aca1296fd0c` |
| `sites/lib/bank-api-original.js` | `2868abc1423a942d6eed583cbc14a2ab7b68cba533f1320636d4d5692d993a27` |
| `sites/lib/banking/openpayments-normalization.js` | `13782ec9a42db954153b6bebaf35b8f795d62035d4d6259b0e8b21717ac5185b` |
| `sites/lib/company-contract.js` | `5da17708a61f842002c3d57650679d260bb5142821baf97700353bc467e14c8e` |
| `sites/lib/invoice-reference-policy.js` | `3e3edf1942ec61a518bcef6350a09f1a3a2fabfffb56f0f1c2af9463953d5a9e` |
| `sites/lib/payer-evidence.js` | `6f6e5ac7f331c5fe87d8ed555cb2d908b8d000b26335efba25b8c5200a168661` |
| `sites/lib/payment-references.js` | `0ff3654f93c69d81fdcf6cef5d515849c0f46d7ee0c7f338c90239409a22723c` |
| `sites/lib/reference-evidence-compat.js` | `1f01e0e6fbc32edf8449e5972634380a3138ad7fc3adaccf35600871eb961eba` |
| `sites/scripts/lib/backup-recovery.mjs` | `c971322d5d076726d018de1bda011855e0c01404cf17e8dda332d85601ca218d` |
| `sites/scripts/lib/recovery-acceptance.mjs` | `cfd917d15d6a21aed189d85b716b021618e7fb5e2c19eae7f33f29df1c3e708a` |
| `sites/scripts/lib/recovery-drill-fixture.mjs` | `ec7e9b7bef842abedafb601f5dd9ddcd5f42105d3056c02fc903426ad3752ede` |
| `sites/scripts/recovery-drill.mjs` | `dddedc152b49cb08a86906719377d9666ca5a1aacf0142f0b5fd5dcedc2c8f10` |
| `sites/scripts/restore-backup-isolated.mjs` | `fd8bbeaa54ac6a3d07081000e7ef8fd6b2d38bf1aee0f6af1a9c42a289e5e648` |
