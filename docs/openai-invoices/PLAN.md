# OpenAI invoice intelligence — implementation and acceptance plan

Base: `f3c80629d4856c2f8ecbb1ed81be391a13ac6be8`. Branch: `feature/95-openai-invoices`.

## Design

Retain deterministic PDF/Tesseract extraction as the first stage. A shared server adapter calls OpenAI Responses with strict structured output and produces untrusted invoice suggestions with page/quote provenance. Both Node and Sites enforce local schema/financial validation and keep all AI-assisted results in human review. Original files and bank evidence remain unchanged.

The alternative of replacing OCR would remove a working local fallback and expose every document to an external service. The alternative of client-side calls would expose API credentials. The chosen server-side hybrid limits external processing and preserves existing data boundaries.

## Implementation

- [ ] Shared bounded adapter, explicit versioned profiles, strict schema and independent output validation.
- [ ] Atomic durable audit reservations and receipt reuse, per-document and per-owner daily caps, no automatic replay of an uncertain request.
- [ ] Node/Sites hooks behind server-only flags and owner allowlist, preserving original and registration checks.
- [ ] Four-arm benchmark tooling with frozen corpus provenance, independent acceptance separated from development material, actual cost/latency/coverage and unavailable-arm statuses.
- [ ] Full affected CI, independent code review, safety regressions and PR delivery.

## Review focus

Cross-owner cache/budget reuse; revocation while awaiting the API; API failure after billing but before a receipt; incomplete PDF or table output; conflicts with existing original-derived values; nullable/zero metric denominators; test fixtures accidentally counted as independent acceptance.

## Acceptance limits observed before implementation

No OpenAI API key or admin billing key exists in the execution environment. The linked Site environment revision 10 has no OpenAI key. Account model inventory, credit balance and live model benchmark are therefore NOT_VERIFIED. The local execution environment became unavailable during dependency installation; interrupted commands are not test passes. Existing main CI is a baseline, not evidence for this branch. GitHub CI will provide actual final execution evidence if available.

Real customer processing stays disabled. No claim of 85% recall / 98% precision or reduced review workload is permitted without a fresh independent optical test.
