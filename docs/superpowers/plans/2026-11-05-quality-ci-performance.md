# Quality, CI and performance implementation plan

> **For agentic workers:** Use the execution and verification skills; keep separate file ownership for independent QA work. Steps below track this branch's authorized work.

**Goal:** Reproducible, honest test and performance evidence for Agent 8 on `feature/95-quality`, delivered as a PR to `main`.

**Architecture:** Retain the existing Node test runner, SQLite/D1 test adapters and product browser harnesses. Add a dependency-free quality runner that captures real process outcomes, TAP/JUnit/coverage, source identity and failure evidence. Run independent regression and synthetic scale work in parallel, then verify the joined branch.

**Tech stack:** Node >=22.13, built-in `node:test` and SQLite, existing TypeScript stripping, locked npm installs, GitHub Actions, existing Chromium/Playwright harness.

**Spec:** User's Agent 8 assignment (all twelve requirements), repository `AGENTS.md`, and current `.github/workflows/payment-control-ci.yml`. Baseline is `4ad205b84d1852ec7ed33cabd70fdadbe2f9d5c5`.

## Global constraints

- Work on `feature/95-quality`; PR against `main`; no merge or production deployment.
- Use synthetic data only. Never label fixture provider responses as real bank verification.
- Do not weaken tests, suppress failures, or report a pass without executing it.
- Preserve production/customer data and existing integration settings.
- Prefer test, benchmark, documentation and CI changes; report product defects with reproducers.
- Evidence must record exact source commit and whether source changed or was dirty.
- Historical results remain historical. All new counts and timings come from this run.

## Review focus

- Empty/truncated test output, skipped/cancelled/TODO tests and child process failure must not become green receipts.
- A changed working tree must not be attributed to an unmodified commit.
- Parallel or replayed jobs must not duplicate financial data or cross company boundaries.
- Browser fixtures must stay loopback-only and must not be presented as backend/provider end-to-end verification.
- Missing audit/coverage/build evidence must stay explicit, including tool/environment failures.

## Task 1: Inventory and baseline

- [x] Read repository instructions, progress, scorecard, latest report and workflow definitions.
- [x] Create an isolated checkout and the requested branch from current main.
- [x] Install all three packages from lockfiles using existing supported installers.
- [x] Execute current Node, Sites and bridge suites; preserve complete logs and exact counts.
- [x] Inventory unit, API integration, contracts, SQL migrations, browser acceptance and live-service gaps.

## Task 2: Reproducible quality runner and CI

Files: new `scripts/quality/*.mjs`, `test/quality-runner.test.js`; root/Sites/bridge scripts; `.github/workflows/payment-control-ci.yml`.

- [x] Write failing runner tests for subprocess failures, skipped/empty/truncated results, provenance and summary parsing.
- [x] Add strict suite discovery and environment isolation, TAP/JUnit/LCOV plus source/lockfile/log hashes and process timing.
- [x] Produce machine-readable per-job receipts and readable GitHub summaries without external publishing permissions.
- [x] Preserve artifact upload after failures; maintain mandatory checks, audit and build gates.
- [x] Run targeted runner tests before integrating and executing full suites.

## Task 3: Behavior regressions

Files: new `test/quality-regressions*.test.js`, `sites/tests/quality-regressions*.test.mjs`, scoped helpers.

- [x] Identify actual gaps across invoice/OCR, bank/Bankgiro contracts, migrations and SaaS isolation.
- [x] Add real-code, synthetic-data regressions with literal expected outcomes.
- [x] Execute regressions; preserve and report product defects instead of weakening assertions.

## Task 4: Synthetic company performance

Files: new `scripts/quality/benchmark*.mjs`, `test/quality-benchmark*.test.js`, scoped helpers.

- [x] Exercise actual company SQLite isolation and durable work with reproducible fixtures for 1/10/100 companies.
- [x] Record operations, concurrency, throughput, p50/p95, errors, memory and correctness checks.
- [x] Separate measured local workload from real bank latency and deployed SaaS capacity.
- [x] Execute and save parameterized benchmark evidence; avoid brittle microsecond pass thresholds.

## Task 5: Browser, final validation and delivery

- [x] Automate existing synthetic browser acceptance using pinned test tooling; report fixture scope explicitly.
- [x] Run complete tests, syntax/type checks, production build and full/production dependency audits.
- [x] Run independent whole-branch review and fix concrete high-priority findings with reproductions.
- [x] Commit code; run final evidence against the immutable commit; keep report commit separate where needed.
- [x] Update `PROGRESS.md`, `QUALITY-SCORECARD.md`, quality report and JSON receipts with limitations.
- [x] Push only this branch, open PR against main, inspect exact-head GitHub checks and report their actual state.

## Execution choices

The assignment and standing autonomous-work instruction already authorize implementation, branch push and PR. Routine framework choices use existing project tools. No extra approval pause is needed. QA results do not upgrade live bank, commercial-readiness or production-performance scores.

## Pre-CI evidence

The baseline was actually executed: Node 1899/1899, bridge 47/47, Sites 3752 passed with one file-level failure (3753 total). The isolated failing Sites file then passed 34/34; this does not convert the failed full run to success. New runner/syntax tests pass 16/16, final root regressions 5/5, Sites OCR regression 1/1 and benchmark tests 3/3. The 1/10/100-company benchmark completed all correctness checks with 1110 imported transactions, 2220 replay duplicates and 111 expected busy claims. Those local runs include a dirty source snapshot; final immutable CI evidence remains required. Local production build/typecheck passed; production audits are zero and full Sites audit retains eight moderate development findings. Actual local Chromium launch was blocked by the environment; browser acceptance is pending CI.

## First immutable CI and corrective verification

Published code b24ea089a062e122ce240ec66ba01180efe533c9 was tested through PR merge checkout f347c2257b167c706861bc2f6d9a29db4553d4cf, tree362e10cb322ca269fd73f2d8f3f60fa879d9d2ab, in run42079194353. Node22 passed1923/1923; Node24 had1922pass/1startup failure. Sites had3756pass/1npm-lifecycle failure and a truncated coverage file. Bridge47/47, Chromium46/46, benchmark1/10/100 and the separate overlapping security subset325+750 passed. Build/types/production audits passed; Sites full audit retained8moderate findings.

A separate diagnosed startup failure reproduced as SQLite BUSY_RECOVERY before ready: the timeout was installed after the WAL pragma. The original CI child's exception had not been retained, so exact identity with that earlier failure cannot be established. A minimal production order correction retained the simultaneous financial assertions; controlled-lock RED/GREEN evidence and100/100 candidate startup attempts were observed. The final targeted startup/migration/HTTP set passed7/7. The quality runner now preserves the actual npm CLI path, and the deliberately file-limited minimatch fault child stops corrupting the parent V8 report. All40 related existing Sites tests passed together with valid script LCOV; no tests were skipped or weakened.

Official SHA-pinned Node24-runtime Actions replace the deprecated Actions runtime in the two test workflows. The operational OCR workflow remains outside Agent8 modifications. Current main advanced through PR48 and was merged normally at bf24a3c52ffc637d1e7bbc4d4f64a1732dcd9fee; the intersecting eight root regressions and one Sites OCR regression passed on the merged code. A new full CI run must verify this combined revision.

## Verified integrated measurement baseline

PR47 head8a083eb70babac68b08ab3eac50aaa5e225c5eb8 was tested through checkout1880ac268eeb7de752bec2ca9567bf35ffdfdec8 with identical treeed59308d7e41be58b49e0bb66a77b707e08fde86. Runs42083369457 and42083372075 completed successfully: Node22/24 each2023/2023, Sites3851/3851, bridge47/47, Chromium41+5=46/46, overlapping security325+788. All had zero fail/cancel/skip/TODO. Types/build/syntax passed; production audits zero, full Sites8moderate. All1/10/100 benchmark correctness checks passed. Seven ZIP digests/sizes and78 internal artifact hashes/sizes were verified.

Final independent coverage review found19 LCOV records for src/server.js. The reporting correction keeps record-weighted totals, counts unique SF paths separately and validates a DA-based source-line union. An independently reproduced orphan-counter defect also received RED/GREEN coverage; all18 runner tests passed after the final correction. This correction and the report are a separate follow-up revision; its own CI status belongs in the PR and does not rewrite the measured baseline. See docs/quality/AGENT-8-REPORT.md and evidence/ci-42083369457.json. Numeric score remains8.5; no live-bank, production capacity, deployment or9.5 certification is claimed.
