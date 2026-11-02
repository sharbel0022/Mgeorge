# Invoice reference policy implementation plan

> **For agentic workers:** Use the executing-plans workflow for the integration, with independent scoped workers for the pure policy and Node adapters. Follow RED/GREEN and do not merge or deploy.

**Goal:** Scope invoice-number payment references to M.George without changing
stored history or bank OCR evidence.

**Architecture:** One pure versioned JS policy implementation inside Sites, a Node
re-export, and explicit adapters for the existing invoice models. Reference
decisions are computed, never a database migration. Existing bank and financial
guards continue to determine whether an allocation is eligible.

**Tech Stack:** Node ESM/node:test, TypeScript, existing SQLite and Sites state.

**Spec:** `docs/integration/invoice-reference-policy.md` and the Agent 1 request.

## Global constraints

- Branch `feature/mgeorge-invoice-reference-policy`; PR to main; no merge.
- Preserve `0001`, `0599` and all original strings and economic history.
- Company-specific customer-invoice rule; no fabricated bank OCR or provider API.
- Synthetic tests only; no live registrations, allocations, email or payments.

## Review focus

- Lost zeros and punctuation must not create an exact match.
- Explicit original/registered reference conflicts must block policy matches.
- Other companies and supplier invoices retain their legitimate separate OCR.
- Duplicate open/closed invoice owners must prevent a unique allocation claim.
- Read-only projections/settings must not rewrite existing financial records.

### Task 1: Pure policy and reusable tests

Files: canonical `sites/lib/invoice-reference-policy.js`, its declarations,
`src/invoice-reference-policy.js`, mirrored test wrappers and the shared case file.

- [x] Write cases for literals `0001`, `0599`, `1`, `599`, `05-99`, competing
  company/supplier scope, invalid configuration and original contradictions.
- [x] Run wrappers and observe missing implementation failure.
- [x] Implement the documented exports without I/O or mutations.
- [x] Run both wrappers and confirm expected outcomes.

### Task 2: Runtime integration

Files: Node invoice/reconciliation adapters; Sites domain/reconciliation and
source-aware payment projections; focused runtime integration tests.

- [x] Write failing tests through existing read, matching and allocation paths.
- [x] Compute additive `referencePolicy` / `intendedPaymentReference` fields.
- [x] Use exact policy references, block conflicts and retain duplicate owners.
- [x] Preserve unscoped generic behavior; explicitly scope generic test fixtures.
- [x] Prove historical invoice/reference/balance/evidence bytes are unchanged.
- [x] Re-run focused reference/bank compatibility suites.

### Task 3: Review, full gates and PR

- [ ] Independently review complete diff for scope, provenance and financial safety.
- [ ] Run Node syntax/full tests, Sites types/full tests/build, and audit gates.
- [ ] Record any environmental or pre-existing failures explicitly.
- [ ] Check latest main and remote branch, commit/publish only feature branch.
- [ ] Open PR and record exact SHA, PR number, commands, results and limitations.
