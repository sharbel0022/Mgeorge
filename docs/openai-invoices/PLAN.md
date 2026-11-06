# OpenAI invoice intelligence — implementation and acceptance plan

Base: `f3c80629d4856c2f8ecbb1ed81be391a13ac6be8`. Branch: `feature/95-openai-invoices`.  
PR: https://github.com/sharbel0022/Mgeorge/pull/64

## Design and delivered implementation

Retain deterministic PDF/Tesseract extraction as the first stage. The shared server adapter calls OpenAI Responses with strict structured output and produces untrusted invoice suggestions with page/quote provenance. Node and Sites validate financial values and keep every AI-assisted result in human review. Original bytes and independently sourced bank evidence remain intact.

- [x] Shared bounded adapter, explicit versioned profiles, strict schema and independent output validation.
- [x] Atomic durable audit reservations and receipt reuse, document/day budgets, no automatic replay of uncertain requests.
- [x] Node/Sites hooks behind server-only approvals and owner allowlists, with original, lease and registration guards.
- [x] Four-arm benchmark tooling with frozen provenance, a separate persistent live-budget journal, unavailable-arm statuses, and development/independent eligibility.
- [x] Read-only project model/cost inventory with explicit unknown credit and provider-budget statuses.
- [x] Independent safety review; cache-write pricing, ambiguous retries, mid-request authorization and oversized-response cleanup corrected.
- [x] Further independent P2 review; nested party/line contradictions reproduced, corrected and checked on fresh/cached results.
- [x] Real full CI recorded for source `76f4c182`; real optical development measurement and its source artifacts preserved.
- [ ] Real model comparison and independent optical acceptance — blocked by missing project credentials and a qualified independent corpus.

## Verification gate

[VERIFICATION.md](VERIFICATION.md) records exact source commits, test counts, CI URLs, focused RED/GREEN evidence and the measured development baseline. The full checks on the **current PR head** are the gate for every later code change. A previous passing commit never substitutes for those checks. Final current-head results are reported on the PR itself, avoiding a self-referential documentation commit.

The initial local installation failed when the original executor became unavailable; it was not a passing test. A restored runtime later executed targeted tests. GitHub CI executes the complete locked Node/Sites suites and the actual optical development benchmark.

## Acceptance limits

No project API key, admin billing key or project ID exists in the checked execution environment; the inspected Site environment revision 10 also had no OpenAI key. See [the actual access report](project-access-report.json). Model listing, billed costs, credits and provider budget remain NOT_VERIFIED.

The executed baseline has four synthetic optical documents, 46/52 correct expected scalar fields, no incorrect returned scalar fields, one complete-correct document and four documents requiring review. AI arms are unmeasured. The thirteen-field legacy rubric does not establish complete recipient or line-item accuracy. Development replay cannot prove the independent 85% recall / 98% precision goal, and this PR makes no measured-improvement claim.

Real customer processing remains disabled. No live model call, merge or production deployment occurred. Live data scope, privacy, security and spending controls remain those described in [OPERATIONS.md](OPERATIONS.md).
