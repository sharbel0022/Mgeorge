# Automation Orchestration Implementation Plan

> **For agentic workers:** Execute the scoped tasks with Superpowers test-driven development and a fresh whole-branch review. User authorization is to finish implementation, tests, branch push and PR in this run; no merge or deployment.

**Goal:** Make existing import jobs observable and recoverable without duplicate imports or stale writes.

**Architecture:** Keep each existing SQLite/D1 queue and ownership fence. Add a shared versioned status projection, strengthen reproduced race/error paths and expose a read-only status endpoint. Prepare a disabled Bankgiro schedule behind server-adapter authorization checks.

**Tech Stack:** Existing JavaScript/TypeScript, Node SQLite, Cloudflare D1/R2, node:test; no new dependencies.

**Spec:** `docs/integration/import-job-status.md` and the current Agent 5 user request.

## Global Constraints

- Own branch `feature/mgeorge-automation-orchestration`, based on verified latest `origin/main`.
- No direct push/merge to main, deployment or existing external automation changes.
- No real financial records used as tests; no outgoing customer email or payments.
- Preserve leading-zero references and all existing financial evidence rules.
- Unknown source capability and unknown execution evidence remain blocked/unknown.

## Review Focus

- Expired worker error callbacks must not rewrite a winner's current result.
- Provider retry deadlines survive restart and manual retries.
- Job success must never be inferred from a heartbeat, invocation or OAuth action.
- Duplicate OCR completion must not create a second accepted extraction.
- Bankgiro authorization must be owner/source bound and fresh at activation; an adapter-shaped client payload is insufficient.

## Tasks

1. **Shared status and Bankgiro preparation (root).** Create `sites/lib/import-job-status.js`, `sites/lib/bankgiro-import-schedule.js`, tests and an owner-authenticated `GET /api/import-jobs`. Tests cover all states, invalid/future timestamps, payload redaction, stale leases, unknown authorization, wrong owner/source and missing adapter. Run tests red, implement, run green. No new database tables or provider calls.
2. **Node durable jobs (node_jobs).** Extend `src/integration-jobs.js` additively, preserving legacy summary/callers. Store separate attempts/success/fence generation, sanitized error state, bounded renewal and durable retry barriers. Scope `src/server.js` changes to existing orchestration. Test concurrent workers, restart, old callbacks,429, long/timeout calls, idempotent completion and legacy migration.
3. **Sites document/Gmail queue (sites_queue_review).** Reproduce exact remaining lease/duplicate completion gaps and fix existing statements. Preserve financial registration receipts and canonical source/hash deduplication. Run existing and new queue/Gmail regressions.
4. **Sites bank/backup jobs (sites_bank_review).** Preserve the existing owner fence and provider adapter. Add privacy-safe attempt evidence where missing; reproduce/fix backup error/expiry races. No new consent or acquisition behavior. Run bank/backup regressions.
5. **Integration and delivery (root).** Read every scoped result, run full Node/Sites suites, syntax/typecheck/build and dependency gates. Review the whole diff with a fresh reviewer. Fix important findings with regression tests. Update this contract/report and progress without inflating production scores. Recheck main, push only the requested branch, open a PR and leave merge to the integrator.

## Progress

- [x] Verified GitHub main, latest integration report and current scheduler inventory.
- [x] Isolated checkout and branch; initial copied dependencies replaced by successful canonical locked installs. Refreshed through reviewed integration receipt `a779b0dd8d184eaf6e6d6e636c555c967f15f3d5` (coordinator documentation and six synthetic Sites acceptance cases only).
- [x] Shared contract/read endpoint and disabled source-gated schedule.
- [x] Node durable coordination.
- [x] Sites queue and bank/backup regressions.
- [x] Full validation and independent review: 1,324 Node + 2,399 Sites, zero failures/skips/cancellations; locked installs, syntax/typecheck, audits, mitigation and final build passed.
- [ ] Post-commit delivery receipt: push only the requested branch and open its PR. The owning PR metadata/final delivery comment records completion, immutable head and exact-head CI; merge/deployment remains with the integrator.

**Decision:** Continue the already authorized implementation without additional approval prompts. No external scheduler mutation or production write is necessary. Existing workflow and financial engines remain the source of truth.
