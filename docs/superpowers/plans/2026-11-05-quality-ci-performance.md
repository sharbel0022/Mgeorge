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
- [ ] Run complete tests, syntax/type checks, production build and full/production dependency audits.
- [x] Run independent whole-branch review and fix concrete high-priority findings with reproductions.
- [ ] Commit code; run final evidence against the immutable commit; keep report commit separate where needed.
- [ ] Update `PROGRESS.md`, `QUALITY-SCORECARD.md`, quality report and JSON receipts with limitations.
- [ ] Push only this branch, open PR against main, inspect exact-head GitHub checks and report their actual state.

## Execution choices

The assignment and standing autonomous-work instruction already authorize implementation, branch push and PR. Routine framework choices use existing project tools. No extra approval pause is needed. QA results do not upgrade live bank, commercial-readiness or production-performance scores.

## Pre-CI evidence

The baseline was actually executed: Node 1899/1899, bridge 47/47, Sites 3752 passed with one file-level failure (3753 total). The isolated failing Sites file then passed 34/34; this does not convert the failed full run to success. New runner/syntax tests pass 16/16, final root regressions 5/5, Sites OCR regression 1/1 and benchmark tests 3/3. The 1/10/100-company benchmark completed all correctness checks with 1110 imported transactions, 2220 replay duplicates and 111 expected busy claims. Those local runs include a dirty source snapshot; final immutable CI evidence remains required. Local production build/typecheck passed; production audits are zero and full Sites audit retains eight moderate development findings. Actual local Chromium launch was blocked by the environment; browser acceptance is pending CI.
