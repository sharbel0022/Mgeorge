# Evidence-based reconciliation implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` for the implementation
> and focused parallel audits. Track observable RED/GREEN outcomes and final review.

**Goal:** Correct live payment competition without weakening bank evidence, then
deliver a reviewable PR with financial regression and false-positive/negative results.

**Architecture:** A shared pure finalizer consumes existing guarded live findings;
the existing persistence and canonical preview remain authoritative at their boundaries.

**Tech Stack:** JavaScript/TypeScript, Node test runner, SQLite, Sites/D1 fixtures.

**Spec:** `docs/superpowers/specs/2026-11-05-reconciliation-95-design.md`.

## Global constraints

- Work only on `feature/95-reconciliation`, from baseline `4ad205b`.
- Synthetic tests only; no production financial changes, merge or deployment.
- No dependency, provider or schema changes unless a reproduced defect requires one.
- Keep partial/excess/refund and genuinely competing payments in explicit review.
- Preserve raw originals, leading zeroes, current authority and atomic audit.

## Review focus

1. A safe distinct-reference match must not conceal an unresolved duplicate payment.
2. An unsafe alternative (including partial/excess) must not gain the safe exemption.
3. Reordered input must produce identical ordered findings and economic decisions.
4. Manual corrections must not replace bank original reference or payer evidence.
5. Replay, cancellation and refund operations must preserve financial conservation.

## Task 1: Deterministic live competition

**Files:** create `sites/lib/reconciliation-decisions.js`; modify
`src/reconciliation.js`, `sites/lib/reconciliation-engine.js`; create shared
`test/helpers/reconciliation-decisions.mjs`, `test/reconciliation-decisions.test.js`
and `sites/tests/reconciliation-decisions.test.mjs`.

**Interfaces:** `finalizeReconciliationFindings(findings, ruleVersion)` returns new
ordered findings, preserving existing public fields and adding explicit decision
status/reason codes only when their meaning is fully represented by existing facts.
Both engines call it after all existing source/invoice/account checks.

- [x] Write regressions: two verified 62500 payments for 0597/0577 resolve to their
  respective invoices; reversing invoice and transaction arrays leaves exact output.
- [x] Run both wrappers and observe the current duplicate veto/order failures.
- [x] Implement the shared finalizer and bump the shared live rule version.
- [x] Prove same-invoice duplicates, unknown/wrong references, source/financial holds,
  partial/excess amounts and incomplete groups remain unsafe.
- [x] Run the existing live reconciliation/reference/normalization tests and commit.

Task 1 evidence: 11 failing regression cases before the correction (47/58 pass),
then 124/124 combined focused cases and 103/103 Sites integration/reference cases.
The sets overlap and are not added as unique coverage. TypeScript passes. The 26-case
pure corpus changes from 2 to 8 of 8 expected allocations per engine, with zero false
positives across 21 negative scenarios. Existing isolated financial baseline: 66/66.
Initial whole-suite attempts were stopped (130) before implementation: the Node run
had overlapped Sites installation and observed transient missing `xlsx`; the Sites
run was incomplete. Neither is claimed as a successful baseline or final full gate.

## Task 2: Persistence and evidence review

**Files:** `src/db.js`, `sites/lib/domain.ts`, `sites/lib/reconciliation-evidence.ts`,
`sites/lib/reconciliation-contract.js` and their existing test boundaries (read first).

**Interfaces:** retain existing allocation/undo/refund and preview interfaces.

- [x] Finish the independent allocation and canonical-preview audits.
- [x] For each reproducible relevant bug, append the exact test/fix scope here before
  implementation; otherwise document the verified existing behavior.
- [x] Exercise actual Node and Sites reconciliation with multiple distinct invoices,
  reruns, audit/original invariance, reviewed partials and exact remaining balances.
- [x] Commit only reviewed corrections and their regression tests.

### Task 2A: Sites manual facts cannot become automatic bank proof

Reproduced on the live adapter: a generic company invoice 0599 for 62500 and an
intact bank-original payment with reference 0577 become an automatic 62500 allocation
after `transaction.verify` changes only the displayed reference to 0599. The adapter
discards typed reference evidence whenever a manual verification exists; the raw
reference census is otherwise enforced only for policy-scoped invoices.

**Files:** modify `sites/lib/reconciliation.ts`; create
`sites/tests/reconciliation-manual-provenance.test.mjs`.

- [x] Reproduce wrong→correct manual reference, manual payer substitution, unsupported
  manual source and manual aggregate split becoming automatic candidates.
- [x] Require a bank-backed individual source for new automatic eligibility; retain
  typed reference evidence and hold manually substituted payer/reference values.
- [x] Keep unchanged verification of intact bank facts and explicit reviewed manual
  allocation usable. Do not change historical allocations or raw originals.
- [x] Prevent manually substituted historical payer values from teaching new automatic
  relationships; run existing invoice-reference, undo, refund and original suites.

Follow-up from the unchanged-assertion suite: CSV `Referens` is explicitly mapped to
the bank transaction reference, but the generic extractor also treats that column as
an invoice reference. Retaining typed evidence correctly exposes this pre-existing
misclassification. In `sites/lib/imports.ts`, exclude columns with recognized bank-ID
headers from invoice/OCR extraction while retaining their raw source bytes, indices
and dedicated bank-ID fields. Add `reconciliation-csv-reference.test.mjs` first.
The manual split regression's former automatic success conflicts with the user's
bank-proof rule; change its fixture flow to an explicit `match.create` after review
and keep its original conservation, undo, active-allocation and replay assertions.
The bank-file provenance test's former OCR-conflict expectation used that same bank
ID misclassification. It now expects the intact valid OCR to be displayed, while
retaining every original-file reparse, forged-browser-field, amount, bank-ID, hash,
unverified-status and audit assertion. No bank verification is granted by this fix.

### Task 2B: Preserve duplicate warnings and manual bank-lineage diagnostics

The first full-suite pass exposed two integration regressions, reproduced in
isolated existing tests: Node's cautious duplicate draft disappears for two exact
but unverified observations; Sites no longer refreshes a manual split's ancestor
account issue because the new source guard correctly removes its automatic
eligibility. Both full runs were stopped (130); neither is a completed final gate.

**Files:** shared finalizer and decision contracts; Sites original-aware evidence
adapter and bank-account-consent tests. Do not change the existing failing assertions.

- Keep `possible_duplicate` classification for competing otherwise-correct
  observations, including unverified ones, while retaining their original evidence
  reason and `safe:false`. Never overwrite a reference/source/financial classification.
- Include manually reviewed bank-backed lineages in the bounded original/account
  refresh even when they cannot allocate automatically. Standalone manual cash
  must not invent a bank account prerequisite.
- Add regressions for duplicate classification and manually substituted payer/
  reference with disconnected and restored consent. Re-run both reproductions,
  then the full gates on the corrected frozen tree.

## Task 3: Acceptance, review and delivery

**Files:** new `docs/integration/reconciliation-95.md`, synthetic measurement evidence;
update `PROGRESS.md` and `QUALITY-SCORECARD.md` with the bounded results.

- [x] Run the named synthetic positive/negative corpus through both runtimes and
  report exact true/false positive/negative counts with the fixture denominator.
- [x] Run Node/Sites full isolated suites, bridge suite, syntax, types, high-audit,
  exact minimatch mitigation and Sites production build per CI workflow.
- [x] Obtain an independent whole-change review; reproduce and fix material findings.
- [x] Document commands, counts, baseline, accepted changes and production limitations.
- [x] Push only `feature/95-reconciliation`, create a PR against `main`, inspect its
  resulting head/check status and report the concrete link and remaining acceptance.

Local receipt: 1937/1937 Node and 47/47 bridge; Sites full attempt had 3751
passes and one file-level failure after 70 passing banking-security cases. The
unchanged standalone file passes 130/130; deduplicated local Sites coverage is
3811, not a claimed successful single full run. Separate Node 22.13.0 compatibility:
38 Node +206 Sites pass. Syntax, types, exact mitigation, audits and sequential
build pass. A concurrent build ended137. The exact process-failure cause was not
established. Full remote Node22 checks on the PR remain the readiness gate.

Delivery receipt: [PR51](https://github.com/sharbel0022/Mgeorge/pull/51) is open
against main. Git CLI push had no configured credentials; the connected GitHub
integration published the exact verified local tree
`13558cd3486966cb89b40a289e632661df56f2cd` as commit `2e4296b`. The commit
identity differs from local `a47f206`; the complete file tree is identical.
GitHub reports the PR mergeable against updated main `bf24a3c`. Full payment
control and SaaS security workflows run on the PR. Read their actual status in
the PR checks; draft readiness is withheld until these checks finish successfully.
This final delivery-note update changes documentation only.
