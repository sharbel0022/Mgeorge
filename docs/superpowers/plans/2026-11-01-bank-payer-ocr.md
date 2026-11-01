# Bank payer and OCR implementation plan

**Goal:** Improve the existing bank chain with measured source-aware payer/reference extraction, regression evidence and safe delivery to main and the existing Site.

**Spec:** User's 2026-11-01 attached goal. It explicitly authorizes autonomous implementation, push and safe publication. Existing engines, original storage, bank consent and account checks are retained.

**Architecture:** Extend the shared pure parsing/evidence components, propagate separately typed bank facts, and retain existing atomic allocation engines. Never use invoice suggestions to identify bank payers. Unknown contract/profile remains an external blocker.

- [x] Freeze and run the same 25-original synthetic extraction corpus before production changes; run existing suites and record any baseline failures.
- [x] Reproduce payer ID/type, missing raw provenance, multi-column CSV and API reference-scheme gaps; implement shared evidence normalisation and negative tests.
- [x] Review existing allocation/original/concurrency boundaries; reproduce and fix concrete safety defects without a parallel payment engine.
- [x] Correct any misleading payer/OCR labels in payment and review surfaces, preserve mobile and technical details.
- [x] Rerun corpus and full Node/Sites/type/build/audit gates; independently review.
- [x] Document metrics, all 25 requested scenarios and honest scores; fetch/integrate latest main, push without force, verify exact-SHA Actions.
- [x] Publish same Sites project using matching source/archive; verify identity/resources/schedules and read-only financial snapshot, record version and limitations.

Review focus: party role/identifier scheme confusion; unknown bank profile/contract; competing invoice references; legacy receipt invalidation; partial/over/refund/concurrent/duplicate allocation; original raw bytes and migration compatibility.
