# Original Reference Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Track completed evidence below.

**Goal:** Stop upload-generated duplicate originals and false backup completeness when retained document references are missing.

**Architecture:** Keep the existing owner-scoped D1/R2 and SQLite engines. Serialize identical document insertion in the SQL statement and verify the resulting owned reference. Validate database and frozen snapshot references before certifying backup or restore.

**Tech Stack:** Node 22, SQLite, TypeScript, D1, R2, node:test.

**Spec:** `docs/superpowers/specs/2026-11-02-original-reference-integrity-design.md`.

## Global Constraints

- Synthetic data only; no production finance writes, live restore, bank retries, customer emails or schedule changes.
- Preserve uncertain originals, original bytes and existing special snapshot contracts; no production schema migration.
- Workers have exclusive file ownership, make no commits and do not revert others. Root owns integration, documentation, push and existing Sites publication.

## Review Focus

- Same-owner uploads that overlap Gmail and manual upload must converge on the same document; different owners remain isolated.
- Lost insert response or lost post-insert read must preserve referenced bytes and retry identity.
- Backup validation must reject missing metadata behind retained references and explicit conflicting hashes.
- Empty optional/explicitly rejected references and valid legacy snapshots must remain accepted.
- Invalid archives must not create a restore destination or damage an existing complete backup.

## Task 1: Atomic original deduplication

Files: `sites/app/api/files/route.ts`, `sites/lib/gmail-service.ts`, dedicated new tests `sites/tests/file-upload-concurrency-final.test.mjs` and Gmail race tests as needed. Any shared helper must be limited to document insertion/owned outcome handling.

- [x] Add synthetic overlapping same-owner uploads and mixed Gmail/upload tests; assert one persisted document, same returned ID, readable exact bytes and unambiguous owned hash selection. Run RED against baseline. Retain a distinct-owner positive case.
- [x] Use one atomic guarded D1 insertion, then resolve actual owner/hash identity under the existing Gmail lease where relevant. Cleanup only the newly uploaded unreferenced object after a conclusive owned outcome. Preserve unknown outcomes.
- [x] Add lost-response, read-failure and cleanup-failure race coverage; run existing original-upload/Gmail/Bankgiro regressions and TypeScript.
- [x] Independent scoped review; correct concrete findings and record exact tests.

## Task 2: Backup referential completeness

Files: `src/backup.js`, `sites/lib/backup-engine.ts`, dedicated new Node/Sites backup-reference tests. Do not change document APIs or schema.

- [x] Add actual SQLite FK-corrupt snapshot and encrypted archive tests for create/verify/restore. Confirm RED: baseline wrongly reports verified/restored. Assert no destination on rejection and preserve original/archive bytes.
- [x] Add Sites valid snapshot baseline then missing owned document metadata behind workspace and durable table references. Confirm RED: baseline wrongly completes 0/0. Include explicit proof hash conflicts, other-owner metadata and valid empty rejected Gmail source.
- [x] Reject SQLite foreign-key violations inside shared integrity validation and validate known typed/audit original references, including active/revoked link hashes. In `validateSnapshot`, index owned document metadata and check declared current/historical original references and generated specification decisions before copying or verifying the manifest. Match only producer-defined fields, with positive legacy controls.
- [x] Run all focused Node/Sites backup suites and TypeScript, then independent scoped review and fix concrete findings.

## Task 3: Reuse normalization within one analysis

Files: `src/reconciliation.js`, `sites/lib/reconciliation-engine.js`, dedicated Node/Sites name-normalization decision regressions and `scripts/measure-reconciliation-volume.mjs`. Root owns these files.

- [x] Reproduce the measured slow complete synthetic Sites run against baseline and record RED against the diagnostic 20-second local budget; profile the actual code. Keep timing out of mandatory CI assertions.
- [x] Add literal positive/negative identity, Unicode, learned-link/account and between-call mutation expectations for both actual analyzers. These protect behavior while the measured performance defect is reproduced separately.
- [x] Memoize name normalization by full string only inside each analysis, passing that normalizer to the existing payer predicate. Do not cache decisions across analyses or skip any existing financial checks.
- [x] Run the same versioned before/after volume runner, compare literal expected allocations/balances and exact normalized findings, then full neighboring reconciliation suites and independent review.

## Integration and delivery gates

- [x] Run root/Sites installs, current syntax/type checks, full tests, audits and Sites production build. Distinguish any environment skips and open development audit findings.
- [x] Independent whole-change review; verify current main and integrate without force-push.
- [x] Push and verify exact Actions; publish changed Sites source into the same existing project with rollback retained.
- [x] Read-only production aftercheck for compared economic fields, originals, auth/runtime/schedules and deployment provenance.
- [x] Update PROGRESS, all affected scorecard evidence and final report with exact continuation. No score inflation; full goal remains broader than this cycle.


Delivery receipt: verified maincc2be7b/Actions41491162166, Sites55/source7ede844/c8e911 tree, succeeded17:31:19Z, revision42→42 and selected finance/originals/configuration unchanged. Documentation-only final receipt follows; full goal remains active with bank/DR/acceptance/dependency limits.
