# Maintained Runtime and Recovery Implementation Plan

Delivery cutoff: user requested finish/push within five minutes. Ship reviewed Tasks1/2 only. Tasks3A/3B implementation interrupted and seven new files hash-preserved privately outside the repository; all unchecked recovery acceptance remains pending. Design below is future work, not a shipped export/restore feature.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Root owns integration, docs and publication.

**Goal:** Mitigate the exact known minimatch preprocessing defect, reduce repeated payer-link scans without decision changes, and obtain honest isolated recovery evidence.

**Architecture:** Keep installed package identities and existing payment engines. Apply a pinned, fully checked backport through supported tooling entrypoints. Build only per-analysis payer-link buckets. Keep real historical recovery data private and distinct from live Sites recovery.

**Tech Stack:** Node22, TypeScript5.9.3, npm, portable/managed Sites scripts, SQLite/D1/R2.

**Spec:** `docs/superpowers/specs/2026-11-02-maintained-runtime-and-recovery-design.md`.

## Global Constraints

- Synthetic CI fixtures; no real finance writes, customer mail, bank retries, scheduler changes, production restore or exposed secrets/originals.
- No rule removal, fake version/advisory closure, global11 override, global identity cache or skipped financial rechecks.
- Worker ownership is disjoint; no commits/push/deploy by workers and no reverting others. No global install while another worker depends on current node_modules without coordination.

## Review Focus

- A later unknown package/file must stop before any earlier target is patched; interrupted known states must fail check and repair safely.
- Lifecycle suppression, cached installs and managed install receipts must not imply mitigation without current byte proof.
- Filesystem traversal, symlinks/junctions, duplicate physical copies and unexpected versions must not write outside the selected project.
- Payer-link indexing must preserve org precedence/raw truthiness and strict account semantics, including NaN and duplicate invoice IDs.
- Recovery claims must distinguish an empty historical Node archive from actual Sites customer-data recovery and hidden runtime secrets.

## Task 1: Exact owned minimatch backport

Owned files: new `sites/scripts/minimatch-backport.mjs`, patch data/license under `sites/scripts/patches/`, focused new `sites/tests/minimatch-backport-final.test.mjs` and helpers as needed; `sites/scripts/install-ci.mjs`, `sites/scripts/install-ci.sh`, `sites/scripts/run-framework.mjs`, `sites/package.json`, minimal root lockmetadata if necessary, `.github/workflows/payment-control-ci.yml`, optional small verified-tool wrapper for check/lint. No payment/backup modules.

Interfaces: export a root-injectable guard for synthetic tests; normal CLI derives project root from import.meta.url. CLI apply default, read-only `--check`, strict `--require-target`. Report actual targets/writes; no stale receipt as authority.

- [ ] Create permanent synthetic discovery/state/path-boundary/installer/entrypoint tests and exact CJS/ESM upstream regressions. Run RED on missing guard and unbounded original10 behavior.
- [ ] Implement pinned builtins-only transformations matching offline compiler-proven runtime/source/map output; retain declarations/version/license. Preflight all targets/outputs, then atomic per-file replace and final rehash. Known before/after mixtures repairable; unknown state rejected.
- [ ] Wire postinstall plus explicit portable/managed post-install guard before managed install receipt; check reused build/check/lint bytes. Preserve actual CLI arguments and all prior checks.
- [ ] Run targeted lifecycle-suppressed, no-dev, multiple-copy/late-drift/interruption tests; real package exports/parser/glob regressions on Windows and Linux. Keep audit findings honest. Independent scoped review and fix concrete findings.

## Task 2: Index learned payer links per analysis

Owned files: `src/reconciliation.js`, `sites/lib/reconciliation-engine.js`, dedicated Node/Sites tests and shared synthetic test helper; `scripts/measure-reconciliation-volume.mjs`, new cycle3 measurement JSON. Small index may remain inline to avoid unrelated transpilation-harness changes.

Interfaces: pure analyzer public signatures/outputs unchanged; internal buckets keyed by raw account and normalized link payer; original predicate retains strict account comparison. Reuse Set by actual invoice objects only within one analysis.

- [ ] Port the21 independent literal scenarios per engine and freshness sequence from the private diagnosis; add duplicate-object-ID and integration/allocation cases. Run baseline. Record slow200-pair performance before code using the same versioned runner; timing stays outside CI assertions.
- [ ] Build buckets once and reuse already evaluated invoice-object identity predicates, preserving every existing decision/check and output order. No new reference policy.
- [ ] Run identical seeded differential and literal cases against baseline/candidate, inspect exact finding/allocation hashes and input/original immutability. Run200-pair after measurement and all neighboring reconciliation regressions.
- [ ] Independent scoped review; correct concrete findings.

## Task 3: Honest recovery evidence / Sites export feasibility

Root ownership: private operational artifacts and eventual sanitized report only until an export implementation amendment is written.

- [x] Verify project-named archive/key availability without exposing values.
- [x] Create ACL-restricted private directory and private TEMP/TMP; verify/restore historical Node candidate through current CLI without starting app. Record integrity/FK/counts and source-archive immutability:24tables,0invoices/originals, no live Sites claim.
- [x] Complete read-only design for owner-authenticated encrypted Sites export plus offline verification; concrete API, bounds and acceptance matrix amended in spec before implementation. No bearer bypass or manifest195 restore claim.

### Task 3A: Read-only encrypted Sites export

Ownership: new `sites/lib/backup-export.ts`, `sites/app/api/backups/export/route.ts`, `sites/tests/backup-export-final.test.mjs`, `sites/tests/backup-export-route-final.test.mjs`, narrowly scoped helper if required. No backup-engine/server/auth/financial/package/schema changes. Exporter interface accepts injected read-only DB/bucket, authenticated owner, runId/mode, signal/clock and returns stream plus headers. Online wire contract is fixed by the spec; root/offline worker can implement against it independently.

- [ ] Permanent RED owner/path/method/query/history/forensic/stream/cap tests before implementation.
- [ ] Exact owned inventory admission and conditional stored-ZIP streaming with consumer backpressure, cancellation,900operation budget, row/inventory terminal comparison and honest transport-only receipt.
- [ ] Independent review plus scoped tests; no live export until reviewed/published. No new tokens, schedules, writes, runtime changes or extra identity privilege.

### Task 3B: Offline verify and inert isolated restore

Ownership: new `sites/scripts/backup-recovery.mjs`, `sites/scripts/lib/backup-recovery.mjs`, `sites/scripts/assert-recovery-private.ps1`, `sites/tests/backup-recovery-final.test.mjs` and narrowly scoped synthetic helpers. No existing backup-engine/Node-restorer/schema/payment/package edits. Reuse existing pure backup crypto/validator; offline Node builtins/fflate already installed. Coordinate exact transport JSON shape with3A.

- [ ] Permanent RED valid encrypted20table fixture and hostileZIP/crypto/manifest/context/cap tests; source read-only identity/hash pin and strict generated ZIP32 parser with actual CRC.
- [ ] Explicit verify CLI, trusted expected owner/run and key env only; redacted bounded errors/counts, no network/app/provider paths. Current semantic/reference checks and older unknown receipt distinctions remain.
- [ ] Permanent RED then implementation for new private destination, pinned migrations/26table schema,20archived table projection, six excluded tables empty, actual SQLite integrity/FK and original reread. Windows DACL and Unix permission controls are actual OS checks, no fake mode-only claim. Never activate retained jobs/credentials.
- [ ] Independent scoped review and fixes. Root alone handles real private DPAPI-memory authentication/isolated restore after delivery; preserve original source and exact acceptance gaps.

## Integration and delivery

- [ ] Fresh current root/Sites installs/checks/full tests/audits/build, with explicit mitigation byte verification and Windows/Linux scope.
- [ ] Independent whole review, fresh origin/main comparison, normal main push and exact CI.
- [ ] Build/package exact Sites source in existing project, retain rollback and verify deployment/runtime.
- [ ] Read-only bounded production before/after comparison; no financial or schedule changes.
- [ ] Update latest report, PROGRESS and all affected33 score evidence with exact continuation and open bank/UI/DR/audit limits. Goal remains broad and incomplete unless every acceptance criterion is actually proved.
