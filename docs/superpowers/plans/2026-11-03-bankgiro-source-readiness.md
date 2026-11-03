# Automatic Bankgiro Source Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete generic safe report delivery infrastructure so verified bank configuration and acceptance can activate it later.
**Architecture:** Existing source worker and financial sinks remain authoritative. A shared HTTPS adapter, isolated SFTP bridge and trusted registration bind into existing scheduled boundaries; telemetry and UI show actual receipts.
**Tech Stack:** Node >=22.13, JavaScript/TypeScript, SQLite/D1/R2, React, isolated SSH transport package.
**Spec:** docs/superpowers/specs/2026-11-03-bankgiro-source-readiness-design.md

## Global Constraints

- No invented bank hostname, endpoint, bank format fields, credentials or entitlement.
- Production remains unconfigured; synthetic sources cannot register as production.
- Browser input cannot choose URLs/configuration/owner/secrets. Read status never fetches, authorizes or writes.
- Existing parsers/ledgers/import/original and integer-ore/reference semantics remain;0599 is text and generic reference is not formal OCR.
- No real financial test writes, customer messages, bank payments, new schedules, destructive restore or force push.
- Normal isolated-branch PR merge/CI then existing Sites publication with auth/DB/R2/runtime/schedules preserved.

## Review Focus

- Redirects, untrusted download URLs and secret-bearing errors must not leak credentials or reach arbitrary hosts.
- SFTP symlink/path swaps, changing remote metadata, partial streams and restart must not publish an incomplete original.
- Replay/late delivery must not skip a journal page or create duplicate economic effects.
- Configuration rollback/revocation/expiry at commit must not revive authority or let a stale worker import.
- Unknown or failed telemetry must not display successful/connected/paid without its own receipt.

### Task 1: Shared HTTPS transport and trusted registry
**Files:** sites/lib/bankgiro-http-source.js, bankgiro-source-registry.js; focused tests.
**Interfaces:** Produces the exact factory/resolver and normalized protocol in the spec; consumes no financial APIs.
- [ ] Write failing tests for scoped authorized list/download, absent config, owner/company/Bankgiro/scope/generation/provenance/expiry/synthetic denial and transport limits/redirects/abort/429.
- [ ] Run tests and confirm behavioral RED, implement minimal factories and bounded transport, verify GREEN.
- [ ] Commit scoped files and record tests/security limits.

### Task 2: Isolated SFTP-to-HTTP bridge
**Files:** bridge/bankgiro/** (isolated package/lock/tests/entrypoint); no root/Sites dependency edits.
**Interfaces:** Serves the normalized v1 protocol from Task1; read-only SFTP upstream and private immutable journal/spool.
- [ ] Write failing actual transport/journal/server tests for pinned host identity, authentication, path/symlink bounds, stable metadata, interruption/restart, replay/late pages, hash conflicts and unauthorized HTTP.
- [ ] Implement using a supported pinned SSH library with primary-documentation verification and exact lock; test real in-process SSH/SFTP or equivalent protocol boundary.
- [ ] Verify focused tests, syntax and production audit; commit package and deploy/config documentation with no actual bank values.

### Task 3: Durable authority/telemetry and existing scheduler integration
**Files:** existing source/ingest/store/evidence/schedule/service modules, Node source/server/db, Sites orchestration/MCP/import-job overview, additive migration/schema/backup consumers, backend tests.
**Interfaces:** Consumes Task1 resolver with server BANKGIRO_SOURCE_CONFIG and binding-map secrets. Produces public authorization/status fields from spec and atomic registration lifecycle. May not change Task1 factories or bridge files without coordination.
- [ ] Write failing real-transaction tests for trusted registration/revocation/revision, stale config cannot revive, expiry and config change at commit, persisted success/failure history, configured interval/restart/provider embargo, scheduled dispatch and read-only status.
- [ ] Add the smallest additive schema/receipt changes, preserve historical backups, map actual source receipt into C5 readiness, wire existing Node/Sites bank boundary.
- [ ] Run focused backend/migration/backup/scheduler suites and commit; supply exact field semantics and lifecycle activation steps.

### Task 4: Compact operational UI and joined acceptance
**Files:** sites/components/bankgiro-source-status.tsx, its CSS/tests; root owns joined end-to-end tests and docs/CI integration.
**Interfaces:** Consumes additive public status; all new fields are optional for compatibility with legacy snapshots. Unknown must never imply connected or authorized.
- [ ] RED/GREEN runtime/SSR tests for connection/auth, last success/failure, next time, separate pending/import/review/error counts, explicit gaps, stale/error/demo and fallback.
- [ ] Join actual HTTPS adapter/worker/DB/sink/presentation with multipayer, missing payer, cross-report invoice, partial/excess, retry/restart and zero-allocation assertions; retain existing negatives.
- [ ] Add isolated bridge tests/audit to CI, run complete mandatory suites/types/syntax/audits/build; independent security/whole-branch review and fix meaningful findings with regression tests.
- [ ] Write docs/BANKGIRO-AUTOMATIC-SOURCE-READINESS.md, update current progress/scorecard without invented increases, publish normal PR/main/Sites with exact receipts and read-only production comparisons.

## Coordination

Tasks1/2/3/4 may develop in separate worktrees with disjoint ownership after interface freeze. Root integrates and owns joined tests/CI/report. This parallels independent deliverables without sharing mutable working files. No release until combined verification and review pass.
