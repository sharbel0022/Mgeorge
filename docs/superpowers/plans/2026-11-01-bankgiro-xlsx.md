# Bankgiro XLSX implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development; the user explicitly authorized independent implementation, main push and publication.

**Goal:** Read Swedbank Excel originals directly, preserve bank payer/reference and all evidence, and reuse the existing safe import and reconciliation boundaries.

**Architecture:** A synchronous, bounded SheetJS parser returns the existing Bankgiro row contract. Preview has no writes; confirmation rereads the owned SHA-256 original. Existing review specifications remain outside economic totals until account and stable bank identifiers are verified.

**Tech Stack:** Node, TypeScript/React, Cloudflare D1/R2, SheetJS CE 0.20.3.

**Spec:** User's detailed XLSX request; private original is kept outside Git.

## Constraints and decisions

- Preserve Sites identity, bindings, authentication, secrets, schedules and economic history.
- Synthetic fixtures reproduce observed layout; never publish real bank values.
- A report sequence or Bankgiro number is not an AIS account or transaction identifier. Do not invent their mapping.
- General numeric reference cells without an explicit recoverable Excel format are rejected; never guess zeroes.
- Keep the existing checkout to coordinate with the nested Sites repository and preserve current work; no destructive checkout/reset.
- No customer messages or bank payments, no real import in production.

## Tasks

- [ ] Measure unchanged Node/Sites baseline and direct XLSX rejection.
- [ ] Inspect original privately; implement header-based bounded XLSX parser with integer cents, block validation, references and cell provenance; run red/green parser corpus.
- [ ] Wire Sites picker, preview, owned-original upload/reread, retained report evidence and visible general reference; test API write isolation, owner access, concurrency, duplicates and balances.
- [ ] Add safe Node adapter and private review-original retention using existing import jobs; test idempotence and no economic mutation.
- [ ] Run full Node/Sites checks, tests, audits, production build and desktop/mobile QA; independently review financial boundaries.
- [ ] Record identical-corpus before/after metrics, evidence and limitations; update scorecard and progress conservatively.
- [ ] Fetch latest main, integrate without overwrites, commit/push without force, verify exact Actions SHA; publish the same Sites project and verify version and read-only economic snapshot.

## Review focus

- Missing stable account/transaction IDs must keep Excel details in review.
- Two reports containing the same payment must never create additional money.
- Browser-supplied facts must be replaced by owned retained original bytes.
- Numeric formats, hidden/formula cells and ZIP expansion must not fabricate facts or exhaust the Worker.
- Upload cancellation and concurrent confirmations must leave finances unchanged or exactly one complete import.
