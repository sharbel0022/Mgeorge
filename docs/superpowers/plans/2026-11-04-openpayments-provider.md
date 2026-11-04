# Open Payments Corporate Provider Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for the shared adapter;
> isolate independent research, transport implementation and final review.

**Goal:** Deliver a tested read-only corporate provider adapter and honest coverage documentation.

**Architecture:** Add a provider-neutral boundary with scope-bound opaque resources.
Use a bounded HTTP/token client, a separate Node mTLS transport and the existing
encrypted storage/original intake boundaries. Keep Enable Banking as the current
runtime path until a separately reviewed company integration activates the adapter.

**Tech Stack:** ES modules, Web Crypto, WHATWG HTTP, Node HTTPS, node:test and TypeScript declarations.

**Spec:** `docs/superpowers/specs/2026-11-04-openpayments-provider-design.md`

## Global Constraints

- Own branch and PR only; no main push, production mutation or deployment.
- No credentials, real account data or customer originals in fixtures/logs.
- Deny paymentinitiation and any route outside ASPSP/consent/AIS allowlists.
- Preserve original evidence, identifiers as strings and current financial fences.
- Contract and provider coverage must cite official documentation checked 2026-11-04.
- Sandbox success may be claimed only after a real authorized sandbox test.

## Review Focus

- Tenant/connection/provider substitution while an HTTP request is awaiting its response.
- Token refresh/rotation races and accidentally reused redirect activation tokens.
- Slow/malformed error bodies erasing rate-limit or timeout classification.
- Pagination links changing origin, account or requested history interval.
- A documented Bankgiro field being mistaken for confirmed company entitlement.

### Task 1: Provider boundary and policy

**Files:** `sites/lib/banking/bank-data-provider.{js,d.ts}`,
`sites/lib/banking/openpayments/config.js`, `sites/tests/openpayments-policy.test.mjs`.

**Interfaces:** `BankDataProvider`, `BankProviderError`, immutable binding;
resource codec consumes existing owner/purpose `encrypt/decrypt`; provider selection
requires exact provider ID, with legacy rows defaulting only to Enable Banking.

- [ ] Write scope, provider selection and resource isolation tests; observe RED.
- [ ] Implement exact scope/feature/version allowlists and scoped codec; observe GREEN.
- [ ] Record policy decisions and commit.

### Task 2: HTTP, token and certificate boundary

**Files:** `sites/lib/banking/openpayments/{http,token}.js`,
`src/banking/openpayments-node-transport.js`,
`sites/tests/openpayments-http.test.mjs`, `test/openpayments-node-transport.test.js`.

**Interfaces:** Transport `{kind, validateCertificate, request(url, init)}` returns
Response; bounded HTTP returns `{data, headers}`; token client exposes only
server authorization and redirect activation methods.

- [ ] Test client-credentials form/scopes, refresh single flight, malformed token,
  invalid_client, 401/403/429/5xx, redirects, abort, slow body and certificate errors.
- [ ] Implement fixed hosts, byte/time limits, error classification and server cache.
- [ ] Verify RED/GREEN and exact native certificate/key behavior; commit.

### Task 3: Open Payments data adapter

**Files:** `sites/lib/banking/openpayments-provider.{js,d.ts}`,
`sites/tests/openpayments-provider.test.mjs`, shared synthetic test helper.

**Interfaces:** `OpenPaymentsProvider` implements bank discovery, capabilities,
consent create/status/delete, authorization create/start/status/redirect completion,
account list/details and bounded booked-transaction retrieval. All company data
operations consume immutable server context and opaque scoped handles.

- [ ] Write official-shape fixtures and tests before implementation.
- [ ] Implement methods with current binding checks before/after asynchronous work.
- [ ] Verify redirect state/scope/replay, partial consent, account ownership,
  pagination and Bankgiro unknown/unsupported results. No inferred OCR/payer fields.
- [ ] Verify original/checksum preservation and provider switch isolation; commit.

### Task 4: Delivery and independent review

**Files:** `docs/integration/saas/provider-capabilities.md`,
`docs/integration/saas/openpayments-adapter.md`, `PROGRESS.md`, `QUALITY-SCORECARD.md`.

- [ ] Record official sources, APIs, company integration boundary and live blockers.
- [ ] Run root/Sites locked installations, syntax/types, tests, audits and build.
- [ ] Obtain an independent branch review; reproduce and fix material findings.
- [ ] Update evidence without increasing production scores from fixtures.
- [ ] Commit, push the requested branch, open PR, verify remote head/PR and report.
