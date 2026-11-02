# Backup and security stabilization implementation plan

> **For agentic workers:** Use the Superpowers debugging, TDD and verification workflows. The user authorized independent implementation, branch-only publication and a PR; no merge or Sites publication.

**Goal:** Preserve and actually recover every retained original and financial record in an isolated environment, and fail closed on incomplete or inconsistent backups.

**Architecture:** Keep the existing Node SQLite snapshot and Sites owner-scoped encrypted snapshot formats. Strengthen publication and configuration writes, and add a read-only Sites encrypted export plus a standalone evidence restore tool. Production authentication and original storage remain unchanged except for a demonstrated Node anonymous-session allocation defect.

**Tech stack:** Node >=22.13, node:sqlite, AES-256-GCM, HKDF for Sites, SQLite/D1 and R2 interfaces.

**Spec:** The user's 15-point backup/security request and subsequent six-conversation coordination instructions; existing contracts in `docs/AUTOMATION-BACKUP.md` and `AGENTS.md`.

## Global constraints

- Start from `a9f88ae1c0f697376b3ecd140e1e80a64405125a`, the observed `origin/main`.
- Work on `codex/backup-security-stabilization-20261102`; no force-push, main push, merge, other branch deletion or Sites publication.
- Never restore over production or delete customer originals. Synthetic test data only in Git.
- Do not read, print or commit production keys; runtime/integration keys remain separate recovery prerequisites.
- Preserve economic logic, bank/Gmail/OCR/UI changes owned by other conversations.
- Distinguish exact evidence recovery from activation of a live service and local tests from production proof.

## Review focus

- Crash or disk failure before final archive/configuration publication must preserve earlier valid state.
- A concurrent publisher, foreign path or stale SQLite sidecar must never be overwritten or trusted.
- Missing, duplicate, added, reordered, cross-owner or corrupted bundle content must fail before recovery output is accepted.
- WAL commits, in-flight transactions, financial undo/history and revoked document links must retain the correct snapshot semantics.
- Restored credentials/leases must not turn an evidence drill into a running production service.

## Task 1: Node archive publication and exact recovery

**Files:** `src/backup.js`, `test/backup-disaster-recovery.test.js`.

**Interfaces:** Existing `createBackup`, `dailyBackup`, `verifyBackup`, `restoreBackup` signatures remain compatible.

- [x] Investigate existing integrity, reference and sidecar tests.
- [x] Reproduce partial-write, fsync/readback, process-interruption and concurrent-publication defects with real filesystem/SQLite tests.
- [x] Stage and authenticate an archive before exclusive final publication; preserve a concurrent winner.
- [x] Verify full application schema/rows/originals and financial history with committed WAL and an uncommitted transaction.

## Task 2: Sites encrypted export and isolated evidence restore

**Files:** new `sites/scripts/lib/backup-recovery.mjs`, `sites/scripts/restore-backup-isolated.mjs`, `sites/tests/backup-recovery.test.mjs`; backup engine changes only if a reproduced defect requires them.

**Interfaces:** `inspectBackup(bucket, run, key, owner)`, `exportBackupBundle(..., write)`, `verifyRecoveryBundle(source, key, expectedOwner, expectedBackupId)`. The final report documents exact CLI arguments.

- [x] Establish that no executable offline restore exists on the base commit.
- [x] Authenticate owner/run, complete counters, exact file/table census and every object; create an encrypted manifest and write completion last.
- [x] Restore only into a fresh private child directory using trusted migrations and `evidence_` tables that the live application cannot use.
- [x] Exercise malformed manifests, tampering, missing/extra objects, interrupted export/resume, symlinks and real SQLite restoration of all durable tables.

## Task 3: Key configuration and API security

**Files:** `scripts/configure-backup.mjs`, `test/backup-configuration.test.js`; auth-only `src/server.js`, `test/security-session-allocation.test.js`.

- [x] Reproduce missing-key-with-existing-archives, interrupted configuration writes and unsafe config links/values.
- [x] Preserve existing secrets, refuse silent key replacement, and atomically replace only verified configuration.
- [x] Reproduce anonymous denied/failed-login requests allocating persistent session rows.
- [x] Keep secure anonymous requests stateless; preserve successful login, session rotation, OAuth binding and revocation fences.
- [x] Audit current locked dependencies, existing owner isolation and secret exposure without speculative broad changes.

## Task 4: Integration, evidence and branch delivery

**Files:** `docs/DISASTER-RECOVERY-VERIFICATION.md`, `PROGRESS.md`, relevant entries of `QUALITY-SCORECARD.md`.

- [x] Run the complete root and Sites CI commands, inspect every failure and preserve known environment limits.
- [x] Obtain independent code review and address important findings with regressions.
- [x] Record synthetic drill timing/counts and actual read-only production status separately; document unavailable production export/keys/offsite recovery.
- [x] Recheck latest `origin/main` and prepare the reviewed, tested tree for branch-only publication and an unmerged PR. Record the actual commit SHA, PR and remote CI result in the PR delivery receipt and final handoff; no main push or automatic integration.

## Execution decisions

- Existing historical/reference validation is reused and regression-tested; no reconstruction of missing originals by guessing.
- Sites recovery preserves exact source rows in evidence tables instead of activating integrations or silently deleting authority records.
- Node raw recovery remains byte-faithful. Any future activation must separately invalidate transient sessions and re-establish trusted credentials.
- No numeric quality increase is justified by synthetic restoration alone; production DR requires independently accessible archive/key and a measured actual drill.
- Final local evidence: 1083/1083 root and 1973/1973 Sites tests, no failures/skips; root syntax108, three new Sites syntax checks, TypeScript, audits at the existing threshold and a separate production build pass. A concurrent build was killed; its unchanged separate rerun passed. Scoped backup318 and new recovery61 are included in the Sites total, not added to it.
- Independent final review closed the output-ancestry, Windows metadata and receipt-publication findings. The receipt is staged/verified privately and published exclusively last; `receipt.pending` is retained and is not completion evidence.
