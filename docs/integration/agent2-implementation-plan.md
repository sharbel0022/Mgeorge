# Agent 2 — Swedbank and account evidence implementation plan

> Agentic execution: Superpowers systematic debugging, TDD, isolated branch and final independent review. The user requests implementation through a tested branch/PR in this run; no further design approval is required.

**Goal:** retain complete booked AIS history, respect provider access/cooldown boundaries and expose versioned account identity evidence without inferring a Bankgiro relationship.

**Baseline:** runtime `7366218`; refreshed through contract PR #22 (`b652735`) to `12c9868` on `origin/main` after documentation/synthetic-test PR #23. No intervening production code changed. Previous six-PR integration and Sites57 are historical evidence, not verification of this branch. Branch: `feature/mgeorge-swedbank-account-evidence`.

**Architecture:** extend the existing Enable Banking adapter and owner-scoped bank lease; preserve the existing transactional import/checkpoint and immutable originals. Add a bounded typed evidence projection alongside the legacy account reader response. Keep all financial reconciliation and report ingestion interfaces unchanged.

## Global constraints

- No real bank requests, customer originals, invoice creation/allocation, outgoing messages or payments in tests.
- No main push, merge or Sites publication. Only this branch and its integration PR.
- Preserve leading zeros and raw bank originals. No calculated account numbers, provider fields or endpoints.
- Account identity is separate from Bankgiro-to-account mapping, report/deposit relationship and payment reconciliation.
- Account detail reads must stop on active or unknown provider cooldowns; incomplete account census never proves uniqueness.
- Reuse current date-window, cursor, deduplication and transaction/checkpoint safeguards; only change demonstrated gaps.

## Tasks

### 1. Baseline and provider contract

- [x] Read AGENTS.md, progress, scorecard, current integration report and current provider code.
- [x] Run focused existing Node/Sites banking suites before edits; distinguish sandbox/HTTP-bind failures from behavioral test results.
- [x] Verify official Enable Banking Sweden/API documentation and document exact remaining data gaps.

### 2. Bound current account reads and publish typed evidence

Files: `sites/lib/banking/account-evidence.ts`, a new `account-evidence-contract.ts`, provider retry diagnostics where needed, existing bank store/lease helpers and focused tests.

- [x] Add RED regressions for repeated unknown/known cooldowns, concurrent account reads, interrupted reads and malformed cooldown state.
- [x] Serialize the account read with the existing owner bank lease; persist only operational cooldown metadata on provider throttling, preserving financial/original state.
- [x] Add the additive `bankAccountEvidence` v1 response, with `verified`, `review`, `blocked` status and explicitly separate absent Bankgiro mapping.
- [x] Verify aliases only from an exact bank-supplied IBAN/BBAN/CPAN field, complete consent census, current snapshot and original integrity; retain all existing legacy response fields.
- [ ] Run focused tests and commit the coherent deliverable.

### 3. Correct demonstrated sync identity/coverage gaps

Files: the existing Node `src/server.js` bank session validation and relevant tests; any further Sites/Node sync edits require a reproduced regression.

- [x] Add RED tests for live expired consent, changed bank/country/PSU and consent expiry during pagination.
- [x] Validate live consent scope and expiry before each outbound page and commit, without advancing history on failure.
- [x] Verify incremental overlap, interval narrowing, abort, concurrency, duplicate identity and raw/checksum preservation with existing plus new synthetic tests.

### 4. Integrator handoff and delivery

- [x] Document the final contract in `docs/integration/bank-account-evidence.md`; identify Agent 3 and Agent 4 consumption rules and any operational API changes explicitly.
- [ ] Record exact tests, dependency/build findings, remaining external data and continuation point; keep scorecard claims bounded.
- [ ] Run mandatory root/Sites syntax/types/tests/audits/build and a fresh independent branch review. Fix material findings with regression tests.
- [ ] Recheck current main and remote branch, push only the feature branch, open/update PR and verify its head/CI. Leave merge to the integrator.

## Review focus

1. A provider fallback timer must never become proof that an unknown account-details cooldown has expired.
2. Concurrent UI/MCP/sync callers must share the same owner lease and cannot overwrite a longer cooldown or a replacement consent.
3. A positive account alias result must not grant verified Bankgiro mapping or reconciliation authority.
4. Live consent expiry or identity mismatch halfway through pages must leave the original history checkpoint and balances unchanged.
5. Different bank IDs, missing entry IDs and changed originals must retain conservative duplicate/conflict behavior.

## Progress / decisions

- Existing bank originals/checksums and adaptive date windows already exist; preserve them and test integration rather than replacing working code.
- The common contract is an additive proposal in this PR. Other agents' reconciliation, report ingestion, UI and backup behavior stays under their ownership.
- Operational lease/cooldown writes are explicitly distinguished from financial or account-fact writes. Existing `changed:false` describes financial state; the new contract documentation must disclose the operational effect.
- Reproduced gap: generic sync retry timestamps cannot represent an unresolved account-read cooldown. The additive connection column and generated migration 0016 are necessary to retain that independent operational fact; no new engine/table is introduced.
- Independent review reproduced loss of a just-observed throttle when result persistence fails. A durable pre-request pending marker now protects session and data reads, and regression tests cover failed arming, failed result persistence and lease loss. This is a concrete requirement-driven extension of the original cooldown task.
- Reproduced Node gap: rows could commit before coverage/audit/job bookkeeping failed. The optional synchronous store callback makes these writes atomic; post-commit independent follow-up failure returns committed success with a bounded durable warning.
