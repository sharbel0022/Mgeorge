# Evidence-based payment reconciliation

Date: 2026-11-05. Branch: `feature/95-reconciliation`.
Baseline: `4ad205b84d1852ec7ed33cabd70fdadbe2f9d5c5`.

## Intent and authority

Implement the user's Agent 5 assignment in the existing Node and Sites applications,
then deliver a separate PR, synthetic test evidence and false-positive/false-negative
analysis. The user authorized implementation and the PR. Production financial data,
deployments, other agents' branches and `main` are outside this delivery's mutations.
No claimed bank proof may be inferred from an invoice or a test fixture.

## Existing design

`src/reconciliation.js` and `sites/lib/reconciliation-engine.js` produce live findings.
Their writers already verify originals and current account authority, use integer
minor units and protect writes with SQLite locking or D1 revision/evidence fences.
`sites/lib/reconciliation-contract.js` supplies a separate read-only canonical
preview with evidence status, source lineage, balance proposals and approval binding.
Manual allocation supports partial payments, several payments and excess; refunds
and aggregate report replacements have separate financial rules.

The reproduced defect is in the live findings' final competition pass: every other
candidate, including an explicitly mismatching reference for the same payer, vetoes
an otherwise unique exact full match. Two payments to different invoices therefore
block each other. Output ties also inherit input order. These are separate from real
competing payments that must remain reviewable.

## Approaches and implementation decisions

1. Replacing the existing live writers with the canonical preview would require new
   activation/approval and financial compatibility work. It is unnecessary for this
   defect and risks disturbing established review rules.
2. Independently patching both engines would keep their competition rules duplicated.
3. Use a small shared pure finalization policy after each existing evidence analysis.
   This is the selected implementation decision: preserve existing proof guards and
   make competition and output order consistent across runtimes.

A transaction may be excluded as a weak competitor for another invoice only when
the pre-finalization evidence yields exactly one safe positive allocation for its
own invoice. A held, partial, excess, missing-reference or conflicting payment never
gets this exemption. Genuine multiple payments to the same invoice remain manual.
Safe findings rank before unsafe findings; stable IDs break ties. Preserve the
original reasons for unsafe findings instead of disguising conflicts as duplicates.

Review the persistence and canonical-preview boundaries independently and reproduce
any additional concrete flaw before changing its implementation. Each accepted
correction must be recorded in the plan and covered by an observable regression.

## Financial and evidence invariants

- `0597`, `0577`, `0599` and `599` are distinct strings under the configured policy.
- The bank's original reference and payer are retained separately from manual facts.
- An exact 625 SEK payment for invoice 0599 can settle only with the existing complete
  bank, account, invoice, payer and reference evidence.
- 2,500 SEK against 3,125 SEK is a reviewable partial payment with a 625 SEK remainder.
- Partial/excess/split/refund decisions are not automatically promoted to verified.
- Missing/mutated originals, expired consent, source holds and ambiguous identities
  prevent automatic writes; historical financial entries are preserved.
- Aggregate and child observations represent one economic deposit, with complete
  bank-backed linkage required by the existing rules.
- Repeat sync/reconciliation cannot consume a payment twice or duplicate its audit.

## Acceptance

Synthetic tests exercise both pure engines and actual allocation paths. Cover same
payer/different invoices, distinct payers/equal amounts, wrong/missing/conflicting
references, duplicate payments, exact remaining balances, partial/excess payments,
refunds, retained original failure, consent races and batch conservation. Preserve
and rerun the existing full Node, Sites and bridge gates, syntax/types, audit and
Sites production build. Report failures and environment limitations honestly.

The 9.5/10 goal is an acceptance target, not permission to invent live results.
Production bank/report coverage and a real original-backed reconciliation remain
separate acceptance gates; only measured code results are credited by this PR.
