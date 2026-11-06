# Bankgiro evidence and payment reconciliation plan

> For agentic workers: use the established systematic debugging and verification workflows. The user explicitly authorized implementation and a PR; work continues within that scope.

**Goal:** Bind interpreted payment facts and reusable import receipts to their actual source authority, retaining exact originals and requiring a complete evidence chain before invoice verification.

**Architecture:** Keep the existing Node and Sites import, original storage, queue, reconciliation, and SFTP bridge. Make narrow repairs only after a regression demonstrates a defect. Source authorization, original integrity, bank-reported fields, report-to-AIS identity, invoice identity, and financial allocation remain separate checks.

**Tech stack:** Node 22/24, JavaScript/TypeScript, SQLite/D1, R2, existing ssh2 SFTP bridge.

**Spec:** User's Agent 4 Bankgiro Evidence & Payment Reconciliation request, 2026-11-06.

## Constraints

- Base: main `f3c80629d4856c2f8ecbb1ed81be391a13ac6be8`, tree `c1912a91e44ecaca7095dcaca1201c3904df87d7`.
- Work branch: `feature/95-bankgiro-reconciliation`; deliver a PR to main.
- All executable test inputs are synthetic and isolated. No production allocations, destructive original/invoice changes, bank activation, or deployment.
- Preserve original bytes, SHA-256, leading zeros, ownership, current consent, and audit history.
- AI suggestions and matching amounts/dates are not bank evidence.
- Synthetic success cannot certify an active provider source.

## Review focus

1. An account identifier whose scheme merely contains “BANKGIRO” must not become a verified Bankgiro number.
2. An explicit recipient in an original must not contradict the source's authorized Bankgiro.
3. An identical file hash under another source/scope/generation/registration must pass the current sink's checks.
4. Replay cannot add money, allocations, or silently rewrite original facts.
5. The visible reference 0599 and amount 625.00 SEK must remain unverified when any required original/source/account/deposit/invoice evidence is absent.

## Tasks

- [x] Read current main, project instructions, relevant delivery reports, source adapters, original retention and existing verification paths.
- [x] Check fresh read-only source status and the selected retained original; retain only a redacted receipt in public documentation.
- [ ] Add frozen failing regressions for explicit source-recipient conflict, cross-authority hash replay, and typed CAMT Bankgiro extraction.
- [ ] Repair exact scheme handling and preserve explicit Node CAMT fields.
- [ ] Validate reported recipient before first import and duplicate adoption in both sinks; constrain queue receipt reuse to the same authority.
- [ ] Run focused and full mandatory CI with unchanged existing assertions; preserve failed/interrupted outcomes.
- [ ] Add explicit evidence-chain acceptance for 0599 and review the complete diff independently.
- [ ] Document supported formats, exact source provenance, provider dependencies, test commands/results and unchanged production limitations; create/update PR.

## Execution environment limit

The root dependency install completed. Four existing Node Bankgiro test files completed with 95 passed, zero failures/skips/cancellations. The clean Sites installer exited 137. Existing same-lock dependencies were used for provisional tests; the integrity guard rejected that linked layout, so no clean Sites-install/type/build pass is claimed. The managed shell then became unavailable during Sites and SFTP tests; those runs have no verified final result. GitHub's normal PR CI is the independent clean-install validation path.
