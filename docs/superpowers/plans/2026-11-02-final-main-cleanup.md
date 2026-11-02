# Final main cleanup implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development. User explicitly authorizes continuous execution and delivery within the stated safeguards.

**Goal:** Fix reproduced internal defects, deliver verified main/Sites, and remove only recoverable assessed development branches.

**Architecture:** Preserve existing Node and Sites engines. Fence asynchronous authorization, isolate restore validation, and scope UI proposals to current workspace state. Archive Git work privately before cleanup.

**Tech Stack:** Node.js SQLite, React/TypeScript Sites, existing test loaders, GitHub/Sites connectors and Git.

**Spec:** ../specs/2026-11-02-final-main-cleanup-design.md

## Global constraints

- No real allocations, registration, paid-status changes, emails, payments or production restore.
- Synthetic tests only; private originals and branch archives outside public Git.
- Never force-push main; preserve Sites project, D1/R2, secrets, identity and schedules.
- Tests must fail for the reproduced cause before implementation; no weakened assertions.
- Independent review per code task and one final integrated review.

## Review focus

- Orphan SQLite WAL/SHM/journal and symlink paths must not import unrelated state or remove foreign files.
- Logout/expiry while bodies/providers are pending must block protected writes; login remains usable.
- Revision changes and late failed responses cannot revive old proposals.
- Gmail success updates actual workspace state; failure must not fabricate success or mutate funds.
- Branch heads may advance between inventory and cleanup; preserve exact new work or leave branch intact.

## Tasks

1. **Restore correctness** — src/backup.js, test/backup.test.js. RED foreign-WAL restore and sidecar/symlink cases; GREEN isolated validation/exclusive publication/byte verification; focused restore tests, independent review.
2. **Node session revocation** — src/server.js and focused synthetic HTTP tests. Also reproduce concurrent streamed login bodies bypassing the rate limit; read/check/update attempts atomically after parsing, preserving serial controls. RED streamed-body logout for invoice/bank/document/allocation routes, GREEN current-session fence at shared body/provider boundaries; positive login/local mode and existing bank/message integration tests; independent review.
3. **Sites stale document/proposal state** — sites/components/dashboard.tsx, gmail-workspace.tsx and focused dashboard/Gmail synthetic tests plus sites/lib/banking/invoice-candidates.ts. Candidate discovery must use the same actual report/detail/AIS reference source as bankPaymentView, including active manually-linked report0599 vs competing detail reference; no source promotion. RED missing document refresh and stale candidates after revision/error; GREEN scoped refresh and late-response guard; TS/integration tests, independent review.
4. **Integrated quality** — inspect dependency findings, safe synthetic backup/restore and concurrency suites; full Node/Sites/syntax/TS/audits/clean build; 33-area evidence and score decisions. Fix further important reproducible findings within scope.
5. **Delivery** — latest-main lease, exact tree push, exact CI, fresh Sites source/build parity and existing-project publication if Sites changed; read-only target/payment/backup/environment checks.
6. **Branch cleanup** — complete protection/PR/workflow inventory; private Git bundle and isolated restore verification for all heads; review unique work/close only assessed superseded drafts where safe; delete only authorized inactive/unprotected/recoverable branches via available authorized tooling; verify remaining refs and main/CI.
7. **Report** — docs/FINAL-MAIN-CLEANUP-REPORT.md, PLAN.md, PROGRESS.md and QUALITY-SCORECARD.md. Record exact refs, archive identity, deleted/preserved branches, tests, production and unresolved constraints. Final docs-only CI and clean state.

## Execution evidence

Start evidence: exact main a4f09b8 CI success775Node/1381Sites from the preceding same-session delivery, unchanged dependencies/environment. Three independent inventory audits confirmed concrete new defects; all remote branches report protected=false and recent100 Actions runs contain no active run. Git write dry-run fails missing password; branch deletion capability must be resolved without credential extraction or bypass.

## Utfört och kvarvarande

Tasks1–5 passerar: rättningar/granskning,847Node/1426Sites/syntax99/TS/bygge, main8516e11 med exakt CI41456514768 success, Sites52 succeeded med identiskt källträd/runtime9 och läsande efterkontroll. Task6: lokala utvecklingsbrancher rensade; privat Git-arkiv med11 återställda refs bevarat. Automatisk godkännandekontroll avvisade konkret fjärrradering och kräver åtgärdsspecifik bekräftelse; fem fjärrbrancher ochPR9/10 lämnades orörda. Task7: [slutrapport](../../FINAL-MAIN-CLEANUP-REPORT.md) och [kvitto](../../FINAL-MAIN-CLEANUP-DELIVERY.json). Ny bankkonto-GET stoppad avBANK_RATE_LIMIT; ingen retry/kringväg eller riktig ekonomisk mutation.
