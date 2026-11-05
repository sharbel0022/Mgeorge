# SaaS onboarding UI implementation plan

> Execution: implement in this branch, test with synthetic data, obtain independent review, push only `feature/saas-customer-onboarding-ui` and open a PR for integration.

**Goal:** A Swedish, monochrome, accessible company and bank onboarding journey, with truthful provider capabilities and payment evidence.

**Architecture:** An additive company-scoped frontend contract and client, small presentation components and a guarded controller. `/bank` discovers the SaaS directory; an explicit initial 404 retains the existing owner-scoped bank screen. All other errors fail closed. No database, provider, scheduler, financial-domain or production changes.

**Stack:** Existing React/TypeScript, native forms/dialog, existing CSS tokens, Node test runner and isolated Chromium acceptance harness.

**Spec:** User's Agent 6 brief; integration contract at `docs/integration/saas-customer-onboarding-ui.md`.

## Constraints and decisions

- Baseline `origin/main`: `14a042a`. No SaaS company/provider/consent contracts or branches were available at inspection. This branch proposes a versioned UI boundary; the corresponding endpoints require Agents 1/2/3/4/5 to implement or adapt them before activation.
- Continue the authorized implementation without an additional design approval round. Use the existing stack and preserve the legacy flow until the scoped backend is available.
- Never reinterpret legacy owner-scoped bank responses as company-scoped responses. Never send a company selector to an endpoint that ignores it.
- Authentication, membership, CSRF, idempotency, consent validation and provider redirects must be enforced by the backend. Frontend validation is additional defense, never authorization.
- New frontend follows only an exact same-origin authorization route minted by the server. The provider decides whether BankID is available. No fabricated providers, BankID buttons, financial references, verification or success.
- Isolated tests only; no real bank requests, customer messages, account changes or production writes. Existing numerical quality scores remain unchanged without production evidence.

## Review focus

1. Late A → B → A reads and mutations must not render/redirect across company or request generation.
2. A 401/403, malformed nested scope or lost membership must erase private UI and never trigger legacy fallback.
3. Expired/missing consent, incomplete Bankgiro coverage and a callback query must not become a successful connection or verified payment.
4. Unsupported scope/bank/redirect or decoupled expiry must block actions while offering only a supported alternative.
5. Small viewports, keyboard focus and error announcements must remain usable without relying on color.

## Task 1 — Versioned frontend boundary

Files: `sites/lib/onboarding/{contract,client,request-scope}.ts`; `sites/tests/saas-onboarding-contract.test.mjs`; synthetic fixtures; integration document.

- [x] Write failing behavioral tests for strict directory/snapshot/action validation, scope binding, consent freshness, observed references and redirects.
- [x] Implement bounded validators, safe localized error mapping, same-origin authenticated/no-store transport, idempotency and CSRF headers; request generation guards.
- [x] Verify the focused suite and document exact proposed wire endpoints and backend ownership.

## Task 2 — Accessible company and bank journey

Files: `sites/components/onboarding/*.tsx`; `sites/styles/saas-onboarding.css`; `/bank` route and stylesheet import.

- [x] Write failing static component tests for permissions, unavailable coverage, consent, independent sync status, payment references and accessible control names.
- [x] Implement directory login/loading/error/legacy states, company create/select, bank choice, read permissions, provider handoff, callback recovery, accounts, renewal/revocation and scoped payment overview.
- [x] Clear private state on switching/failure; prevent stale side effects, duplicate actions and optimistic success. Use server capability flags and fresh status after mutations.
- [x] Verify component tests and typecheck.

## Task 3 — Browser acceptance and delivery

Files: `docs/integration/saas-onboarding-browser/*`; integration receipt; `PROGRESS.md`; `QUALITY-SCORECARD.md`.

- [x] Exercise actual components/CSS at 320, 390, 768, 1024 and 1440 px, keyboard navigation, dialog Escape/focus and screen-reader semantics.
- [x] Exercise isolated provider redirect, cancellation, callback failure, missing consent, AIS without Bankgiro, company creation/switching, forbidden/malformed responses, late reads/mutations and duplicate clicks.
- [x] Run required Node/Sites check/test/audit/build gates and separate bridge dependencies needed by the existing suite; report environmental failures accurately.
- [x] Independent whole-change review; fix concrete findings and verify regressions.
- [x] Record exact local outcomes and activation limits.
- [x] Commit, publish the feature branch and create the integration PR; remote delivery is recorded separately from local acceptance.

## Execution record

- Initial audit: existing `/api/bank/*` is owner-scoped and Swedbank-only. Provider authentication and existing CSRF checks remain intact. No company-scoped API is available to reuse as-is.
- Final local gates: 1,565 Node + 3,166 Sites + 47 bridge = 4,778 pass; syntax, types, high-audits and production build pass. Sites retains eight moderate dependency findings.
- Browser acceptance: 41/41 pass, five actual viewport widths, 115 intercepted synthetic API requests, no JavaScript errors or external calls; source and served assets are hash-bound.
- Independent review findings were reproduced and fixed: slow-read polling starvation, stale decoupled authorization notices and enabled sync for an unsupported selected account.
- Final visual inspection of all six screenshots found no remaining overlap or clipping. Backend contracts remain a documented integration dependency; no live bank/BankID or production action was performed.
- Published implementation `765d9e165d5ba9a773c6eb0792954d1281f2639f`, tree `52f199d3ec1880f3dfb87256c4ff25b57e1b99ae`, matches the locally verified tree. Draft [PR #38](https://github.com/sharbel0022/Mgeorge/pull/38) targets main without merge or deployment.
- Final read-only comparison with newly available Agent 2 (`1a634c1`) and Agent 7 (`eed6879`) confirms no company/web authorization endpoints are yet supplied. Explicit SCA challenge, identity/scope, expiry and Bankgiro evidence mappings were added to the handoff document.
