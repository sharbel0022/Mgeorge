# Automatic Bankgiro ingestion implementation plan

> Agent 3. Execute with Superpowers test-first development and an independent final review. The user's request authorizes implementation, the named branch and a PR; integration/merge/publication belong to Agent 7.

**Goal:** Automatically retain and import reports from an explicitly authorized report source, with durable retries and no duplicate economic effect.

**Architecture:** One shared JavaScript source/queue engine, an asynchronous SQLite/D1 store, and small adapters into the existing Node/Sites original/import models. Production source resolution returns no source until a real bank-approved adapter is configured and independently verified. Synthetic providers exist only in tests.

**Tech stack:** Existing Node 22+, SQLite, Sites TypeScript/D1/R2, existing XLSX/CSV/camt parser. No new package or provider endpoint.

**Spec:** User's Agent 3 request; the versioned interface in `bankgiro-source.md`.

## Constraints and decisions

- Runtime base: `73662187cddf9a5c504dea9bd8a1288bd929bc51`; feature subsequently fast-forwarded to reviewed contract main `b65273500c214a4e16b880e3840dac90d8bd7401`; branch `feature/mgeorge-bankgiro-auto-ingest`.
- Source retrieval is disabled without an owner-bound, current VERIFIED authorization. AIS connectivity alone does not satisfy this.
- Delivery authentication, report originality, bank account identity and reconciliation are separate evidence. No client-supplied flag upgrades any of them.
- Keep leading zeroes and all original reference evidence. Do not synthesize bank OCR, payer fields or account aliases.
- The worker imports through existing parsers/original storage. It never creates invoices, allocations, messages or payments.
- Durable delivery cursor is separate from report booking dates; old/late reports remain importable. Empty listings never prove that a payment is absent.
- Lease fencing, retries and exact-hash idempotency must survive a new process and a lost response after a committed import.
- A bank report identity with different bytes is quarantined, never economically imported twice. Original bytes and the conflicting receipt are retained.
- Existing manual upload remains the fallback. Existing proof/matching decisions remain the responsibility of the domain and Agents 2/4.
- No production data operations, bank fetch, deployment or main push in this branch.

## Review focus

1. Lost lease or changed authorization during a download must prevent a stale financial write.
2. A successful import followed by a lost response must be recovered without a second economic effect.
3. Cross-source, manual/automatic and new-filename duplicate originals must converge by owner/hash.
4. Status must distinguish missing/late reports and backoff from a successful complete bank-data fetch.
5. Adding queue persistence must not invalidate old backups or omit durable source receipts.

## Tasks

- [x] T1: Source contract + durable shared queue. Write and observe failing synthetic-provider tests, then implement discovery, byte verification, identity/hash deduplication, retry-after, bounded execution, owner lease and restart. Test all ten user scenarios, authorization revocation, lost lease, owner isolation and unknown commit outcome.
- [x] T2: Sites original/import adapter + authenticated status/run API. Reuse `readBankgiroOriginal`, `applyCommand`, original reads, consent fences and revision CAS. No reconciliation call. Add API and actual original/domain integration tests.
- [x] T3: Node adapter + status/run/scheduler hooks. Reuse existing parser/import/original model, owner binding and guarded SQLite transactions. Default source unavailable, no automatic real fetch. Add adapter/API tests.
- [x] T4: Status UI, backup/schema compatibility and integration documentation. Show unavailable source honestly, report queue state and next permitted retrieval, retain manual fallback. Document source research and coordination requirements for Agents 2/4/7.
- [x] T5: Focused regression suites, independent review and exact remote main recheck; prepare the feature branch and its delivery receipt. Mandatory full root/Sites gate, branch/PR head and publication state are recorded by the PR checks and final delivery response, with local environment limitations preserved in the report.

## Progress ledger

- Remote main SHA and tree verified through GitHub. A local seed supplied the exact Git objects because the executor proxy was unavailable; tree `2f598d52d068a6f7b1fd4bc94eb7ac6b90803d32` matches GitHub.
- Named branch created locally and on GitHub from that main. No open PRs were present at initial inspection.
- Existing dependencies copied into the isolated checkout without modifying lockfiles. Initial root baseline cannot open loopback listeners in the restricted sandbox (`EPERM`); retry with the supported approval path/CI is required, not a claimed code failure or pass.
- Research confirms Enable Banking AIS limitations and Swedbank contracted file delivery. No customer source/contract/transport verified.
- Reviewed contract PR #22 became main during implementation. Read it, fetched main through the approved network path and fast-forwarded this feature branch; preserved all upstream files. Added commit-time source-generation checks, a safe public status projection and delayed cursor acknowledgement to match it.
- Independent review reproduced and closed timeout write authority, stale embargo, premature cursor, Node backup pointer, renamed unknown-outcome replay, domain-invalid input and stale worker source-authority overwrite. UTC ISO status projections also match the reviewed contract. Final local feature run: 93 Sites cases; Node adapter/reference run 57; dashboard/navigation/status/MCP run 63 (overlapping subsets). Full CI is the mandatory final branch gate; initial local full-run failures/limitations remain explicit in the report.
