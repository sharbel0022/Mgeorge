# Company bank sync and reconciliation implementation plan

> **For agentic workers:** use the development and verification workflow;
> preserve explicit file ownership while parallelizing independent components.

**Goal:** Company-isolated durable bank jobs and evidence-safe reconciliation.

**Architecture:** Shared coordination with persistent account leases, request
budgets, and import receipts; adapters reuse the existing Node timer and Sites
bank automation. Existing financial engines remain the only allocation path.

**Tech Stack:** ESM JavaScript, TypeScript, Node SQLite, D1 atomic batches.

**Spec:** `docs/superpowers/specs/2026-11-04-saas-sync-reconciliation-design.md`.

## Global constraints

- Own branch only; PR to main; no merge or Sites publication.
- Preserve M.George data, Enable Banking, originals, audit, and allocations.
- Synthetic tests only; no credentials or customer data in git.
- Trusted exclusive company data scope; fail closed when dependencies are absent.
- No guessed provider fields, quotas, permissions, or Bankgiro coverage.

## Review focus

1. A renewed consent must not reset a request budget or import identity.
2. A late reply must not write after revocation, scope change, or lease expiry.
3. Same owner or reference in separate companies must never share policy/data.
4. A committed import with a lost response must not repeat a financial effect.
5. Partial evidence and duplicate reports must leave uncertain balances intact.

## Task 1: Durable shared company coordination

Files: shared company bank sync modules/declarations and additive job migration;
synthetic store/runner tests.

- [x] Define trusted scope, job, request-policy, outcome, and adapter contracts.
- [x] Write failing real-SQLite tests for isolation, claim races, quotas, renewal,
  stale fences, interruption and commit/replay behavior.
- [x] Implement the smallest persistent coordinator satisfying those cases.
- [x] Run the focused suite and review the atomicity/authority boundaries.

## Task 2: Runtime adapters and existing schedule integration

Files: Node company sync adapter and scheduler boundary; Sites company adapter
and bank-automation boundary; matching synthetic integration tests.

- [x] Add failing tests proving blocked unbound scopes and real scoped imports.
- [x] Reuse current consent, account, provider, original, and import functions.
- [x] Wire the existing scheduler to the bounded company dispatcher without
  creating new external schedules; preserve unbound legacy behavior and block
  legacy automatic paths once the database/workspace is company-bound.
- [x] Prove 100-company dispatch, same-account serialization, 429, renewal,
  revocation while awaiting a provider, and lost-result replay.

## Task 3: Explicit company reconciliation policy

Files: shared company reconciliation guard, Node/Sites wrappers and tests.

- [x] Add failing tests for A invoice-number, B explicit OCR, and C other bank;
  same reference in two companies; wrong account and wrong customer.
- [x] Require explicit company scope/policy and delegate to existing evidence
  and allocation logic, preserving integer balances and audit checks.
- [x] Exercise partial/excess payments, aggregate deposits, duplicate reports,
  missing real coverage, and unchanged balances on uncertain matching.

## Task 4: Integrated verification and delivery

- [x] Independently review coordination/financial boundaries and fix the reproduced
  remote-revocation finding. Broader review limits are documented in the delivery.
- [x] Run root/Sites/bridge suites, syntax/types, audits and Sites build.
- [x] Document the contract, activation prerequisites and exact test evidence in
  `docs/integration/saas/sync-reconciliation.md`; update progress and scorecard.
- Delivery receipt: the pushed commit, PR and exact remote Node 22 workflow
  result are recorded on the PR after branch delivery; no merge or publication.

## Additive recovery requirement completed

- [x] Include all four company coordination tables in the existing snapshot
  contract, preserving the exact historical 20/22-table formats.
- [x] Validate company/owner/job/receipt relationships and invalidate recovered
  worker leases without erasing quotas, embargoes, originals or receipts.

## Final review resolutions

Stable account keys are derived from persisted typed identities, including an
unambiguous local-account tuple. Actual consent renewal preserves quotas and
receipts; same-bank Sites reconnect retains its connection ID. Request denial
after timeout still records the provider embargo. Provider-specific permanent
access errors cannot become transient retries. An omitted transaction-access
field follows the documented optional session schema; a present denied or
malformed value blocks. Node rechecks the remote
session after enrichment before reconciliation. Legacy calls are fenced against
enrollment during an awaited request. Node discovery isolates failing companies
and fairly schedules beyond the first 100 jobs. Focused regressions cover these
boundaries; the independent review's remote-revocation finding was reproduced
before its fix. Frozen-source full local verification passed 1,704 Node, 3,207
Sites and 47 bridge tests with no failed, skipped, cancelled or todo cases.
Syntax, types, audit gates, exact mitigation and separate Sites build passed.
