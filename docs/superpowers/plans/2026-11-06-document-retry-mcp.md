# Document Retry MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing owner-scoped document retry available through MCP without approving or processing an invoice.

**Architecture:** Extract the existing guarded UPDATE into one shared helper. The authenticated UI and MCP dispatch call that helper; ordinary processing remains a separate operation with all current evidence and registration checks.

**Tech Stack:** TypeScript, Sites OAuth/company-scoped D1, Node 24 test runner, existing SQLite-backed Gmail fixture.

**Spec:** `docs/superpowers/specs/2026-11-06-document-retry-mcp-design.md`

## Global Constraints

- Exactly one `documentId` argument matching `^[a-zA-Z0-9_-]{1,100}$`; no client owner, context, force, or extracted values.
- Only the existing `failed`, `needs_review`, `duplicate` states with an active source are eligible.
- Same existing engine routing, attempt reset, and lease reset; no registration, provider call, original read, or trust mutation.
- Existing company write authorization and browser origin checks remain in force.
- No new dependencies or schema changes.

## Review Focus

- A foreign ID and an absent ID must both be a harmless `requeued=false`.
- A job being processed or already registered must retain its lease and receipt.
- A rejected source must not be returned to the queue.
- An unauthenticated or stale company request must not reach a queue write.
- Repeating the call before processing must return false without altering persisted interpretation or financial state.

---

### Task 1: Shared retry and authenticated MCP dispatch

**Files:**

- Modify: `sites/lib/document-processing.ts`
- Modify: `sites/lib/banking/mcp.ts`
- Test: `sites/tests/gmail.test.mjs`
- Document: `sites/docs/DOCUMENT-AUTOMATION.md`

**Interfaces:**

- Produces: `retryInvoiceDocument(owner:string, documentId:unknown):Promise<{ok:true,requeued:boolean}>` in `document-processing.ts`.
- Consumes: `identity()`, `processingSettings(user)`, the existing scoped `db()` and `activeSource` condition.
- MCP tool: `retry_invoice_document({documentId:string})`; UI `processingAction(...,'retry')` passes its already authenticated owner and `body.document_id`.

- [x] Write tests using the existing real processing module/SQLite fixture. For each eligible state and engine assert the expected queue state, attempt/lease reset, `requeued=true`, and unchanged extraction/history/trust/invoices. Replay must return false. Add refused-state, absent/foreign ID, rejected-source, authentication, and malformed-argument tests. Assert no bucket/provider/backup/processing calls.
- [x] Run the new tests against the unchanged product source; preserve the RED result and test hash before implementation.
- [x] Extract the exact guarded retry UPDATE and return whether one row changed. Validate the ID in the helper. Add explicit argument validation and authenticated dispatch to MCP; preserve the existing UI authentication path.
- [x] Run the entire Gmail test file, the relevant company-boundary tests, and the existing TypeScript check. Freeze the source and evidence for independent review.
- [ ] Commit the reviewed change, integrate it through normal full CI/publication, then perform at most the justified ordinary retry on the verified existing candidate. Report its actual state, without treating a queued response as registration success.
