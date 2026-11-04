# Agent 6 — SaaS customer onboarding and bank UI

Branch: `feature/saas-customer-onboarding-ui`. Inspected integration base: `14a042a` (2026-11-04).

## Activation boundary

This branch implements the frontend. The inspected `main` has **no company-scoped SaaS endpoints**. Its `/api/bank/*` endpoints use the authenticated owner and support Swedbank via Enable Banking. Passing `companyId` to those existing endpoints would not create tenant isolation.

The new `/bank` entry therefore discovers `GET /api/companies`. An explicit initial HTTP 404 retains the existing bank screen with a clear single-workspace notice, only when no company query is present. A 401 offers sign-in. A 403, network failure, non-JSON response, invalid contract, or missing company hides private data and shows recovery. Once a SaaS directory has been accepted, a subsequent 404 cannot fall back to the owner workspace. A company-specific URL never falls back to the owner workspace.

The following is a **proposed version 1 frontend boundary**, not a claim that Agents 1–5 have implemented or accepted it. The integrator must map their actual APIs at this boundary or implement these endpoints before enabling SaaS mode. No fake endpoint, local company store, demo bank catalogue or fictional payment is used by product code.

## Ownership and requirements

| Producer | Required handoff |
| --- | --- |
| Agent 1 | Authenticated directory, company creation, roles/memberships, company-scoped state and data queries. Keep original M.George owner data intact. |
| Agent 2 | Actual provider-supported bank catalogue and read permissions; bank-specific coverage and maximum consent duration. Never claim Open Payments or BankID availability from installation alone. |
| Agent 3 | Persistent company/session-bound authorization, CSRF/state/replay protection, applicable PKCE, provider handoff, callback, renewal and remote revocation state. |
| Agent 4 | Separately verified Bankgiro entitlement/coverage, real payer/reference evidence and applicable consent/sync timestamps. A separate UI status does not assume a separate provider consent resource. |
| Agent 5 | Durable account-scoped synchronization with concurrency, rate limit, consent and idempotency checks; first-sync scheduling after account selection; verified result timestamps. |
| Agent 6 | Bounded response validation, scope/generation checks, accessible presentation, safe request client, user actions and isolated browser evidence. Frontend checks are not server authorization. |

## Read endpoints

All responses are authenticated JSON with `Cache-Control: private, no-store`. GET routes read stored state only; UI refreshes must **not** initiate provider calls. Return 401 for missing authentication, 403/404 for inaccessible companies, and 409 for a stale revision. Do not serialize raw provider errors or credentials.

### `GET /api/companies`

```ts
{
  version: 1,
  csrfToken: string, // 16–512 printable ASCII bytes, bound to this session
  canCreate: boolean,
  companies: Array<{
    id: string, name: string, organizationNumber: string,
    role: 'owner' | 'admin' | 'viewer'
  }>
}
```

Company IDs are opaque identifiers, not organization numbers. Return only current memberships. UI selection is retained in the page URL, never in localStorage; data, accounts and CSRF tokens are not persisted by this frontend. A query parameter never grants membership.

### `GET /api/companies/:companyId/bank-onboarding`

Return one consistently scoped projection, with the concrete types in `sites/lib/onboarding/contract.ts`:

```ts
{
  version: 1, companyId: string, revision: number,
  checkedAt: string, environment: 'production' | 'sandbox',
  actions: { connect: boolean, renew: boolean, disconnect: boolean,
    selectAccounts: boolean, sync: boolean },
  banks: Bank[], connection: Connection | null, accounts: Account[],
  sync: SyncStatus, bankgiro: BankgiroStatus,
  authorization: Authorization | null,
  payments: Payment[], paymentsHasMore: boolean,
  manualImportPath: string | null
}
```

`checkedAt` is the time the authenticated server checked current membership and assembled the projection, **not** the last successful bank fetch. The UI rejects snapshots older than five minutes or over 30 seconds into the future, and revision regression within a company view. Real successful-fetch timestamps remain separately displayed.

Bank fields: `id`, `name`, `country`, `providerLabel`, `available`, `authorization` (`redirect`, `decoupled`, `separate`, `unavailable`), `supportedPermissions`, `requiredPermissions`, `maximumConsentSeconds`, `bankgiro` (`included`, `separate`, `unsupported`, `unknown`) and `unavailableReason`. Permissions are provider-neutral purposes: `accounts:read`, `transactions:read`, `bankgiro:read`; Agent 2 maps these to actual documented provider scopes. Mandatory permissions must be supported. The frontend never requests payment initiation.

Connection fields: `id`, `companyId`, `bankId`, `bankName`, `status` (`active`, `pending`, `expired`, `revoked`, `error`), `validUntil`, `permissions` and optional `revocationStatus` (`confirmed`, `pending`, `unknown`). `active` with a missing/expired date is not current consent. Revoked local access must not be described as confirmed remote revocation without that separate receipt.

Accounts: `id`, `companyId`, `name`, `maskedNumber`, `currency`, `selected`, `importable`. Return masked identifiers only. The backend verifies every selected account against this company's current consent and supported account set; the browser is not the authority.

Sync: `state` (`never`, `queued`, `running`, `succeeded`, `failed`, `blocked`), `automaticEnabled`, `lastSuccessAt`, `nextAllowedAt`, `errorCode`. Next eligibility is not a promise that a scheduler will run at that time. Do not expose successful sync until bank data and the durable receipt have committed.

Bankgiro: `state` (`available`, `pending`, `separate_agreement`, `unsupported`, `unknown`, `expired`), `validUntil`, `lastSuccessAt`, `nextAllowedAt`. AIS success never implies Bankgiro detail coverage. Use `available` only with a currently verified report entitlement; a successful report fetch does not verify every individual payment.

Payments contain only authorized company-scoped projections: `id`, `companyId`, `date`, integer `amountMinor`, `currency`, nullable `payerName`, nullable observed `reference: {value, kind, source}`, and `verification: {status, evidenceId, reason}`. `amountMinor` uses the currency's standard minor unit: SEK has two decimal places, JPY none and KWD three. Booking dates are calendar dates, without an invented time. `kind` is `ocr`, `payment` or `invoice`; source is `bank_account` or `bankgiro_report`. Preserve strings such as `0000599` exactly. Never substitute the intended invoice number, invoice customer or a manual alias for actual bank facts. `verified` requires the backend's accepted evidence receipt; review/unverified rows are labelled explicitly. These rows never mutate allocations or balances.

If a permitted company-specific import page exists, `manualImportPath` may be exactly `/companies/:companyId/imports`. Otherwise return null; the frontend never routes a SaaS company's records into the legacy owner import screen.

## Mutations

All POST requests send `Content-Type: application/json`, session credentials, `X-CSRF-Token` and a fresh `Idempotency-Key`. The backend must enforce Origin/CSRF, authenticated current company membership, role, current consent/capabilities, revision and durable idempotency. A button being disabled does not enforce any of these requirements.

| Endpoint | JSON body |
| --- | --- |
| `POST /api/companies` | `{name, organizationNumber, country: 'SE'}`; canonical company response `{version:1, company}`. Verify legal-entity data/authority server-side; browser formatting is not identity proof. |
| `POST /api/companies/:id/bank/connect` | `{bankId, permissions, expectedRevision}` |
| `POST /api/companies/:id/bank/renew` | `{connectionId, expectedRevision}`; renew through the current provider's documented process, preserving correct company/account history. |
| `POST /api/companies/:id/bank/disconnect` | `{connectionId, expectedRevision}`; stop further reads and report local/remote revocation independently. |
| `POST /api/companies/:id/bank/accounts` | `{connectionId, accountIds, expectedRevision}`; validate all accounts and schedule the first authorized sync using Agent 5's existing scheduler, subject to provider budget. |
| `POST /api/companies/:id/bank/sync` | `{connectionId, expectedRevision}`; enqueue or reuse the durable company/account job. |

Connect and renew return the authorization envelope below. Other bank mutations acknowledge only acceptance: `{version:1, companyId, accepted:true}`. The UI performs a fresh scoped GET before showing any new result. On a network/ambiguous mutation failure it hides the old projection and requires re-reading status before another action; it does not blindly retry financial/provider effects.

```ts
{
  version: 1, companyId: string,
  authorization: {
    id: string, companyId: string, mode: 'redirect' | 'decoupled',
    state: 'pending', expiresAt: string,
    redirectPath: string | null
  }
}
```

`mode` describes the UI handoff, not an unmodified provider SCA enum. For redirect mode, `redirectPath` must be **exactly** `/api/companies/:companyId/bank/authorizations/:authorizationId/redirect`, without query, fragment, credentials or another origin. Agent 3 implements this authenticated server route and validates the actual provider destination there. It may present the provider's actual method selection and challenge flow before external navigation. This prevents future provider domains from being guessed or trusted by a browser allowlist. The UI never constructs a BankID URL.

Decoupled mode is a waiting state only: return it with a null path **only after** the provider integration has initiated a process that the user can complete without an additional method-selection, QR or autostart step in this UI. Persist status so GET can observe completion/cancellation/expiry; do not make every status read perform provider SCA or bank reads. Where a provider requires challenge presentation, Agent 3 must implement the authenticated SCA page reached through the exact server handoff route, or a separately reviewed contract extension. Until that flow exists and is tested, catalogue availability must remain false with `configuration_required`; a generic waiting message is not a working BankID integration. Five-second projection refresh is not a QR/challenge polling implementation.

The provider callback may return the user to `/bank?company=:id&result=connected|cancelled|failed|expired|wrong_user|signin_required`. These query parameters are navigation hints only. A success notice additionally requires fresh active consent and this company's server-recorded completed authorization. Never send codes, tokens or raw error descriptions in the UI query. Callback state, CSRF/replay/PKCE and current membership checks remain server requirements.

## Privacy, races and accessibility

- Changing company unmounts the previous view and invalidates all reads/mutations. Every response and redirect is gated by a request generation, even if a transport ignores abort. A → B → A is a new view, never reuse of A's earlier response.
- A lost membership, sign-in failure, malformed nested company ID, invalid reference type or failed status read clears private UI. It does not re-display the last successful company's data.
- Duplicate submit is blocked synchronously. Idempotency still requires backend enforcement across tabs, restarts and network retries.
- Status refreshes share one in-flight read. Pending bank authorization is checked every five seconds; ordinary stored status every 30 seconds and on focus/visibility return. Reads never restart a slower in-flight read. Every request has a 20-second deadline, including JSON decoding, and cancellation settles even if the transport ignores abort. Company changes and mutations still invalidate earlier reads.
- A pending authorization notice derives from current status and is replaced when the bank reports completion, cancellation or failure. Expired authorizations leave the fast refresh cycle. Account selection is acknowledged only after the fresh projection contains the requested account IDs; an accepted job is not displayed as a successful sync.
- An uncertain company-creation response requires a directory reload before another submission. The UI does not assume an interrupted response means the company was not created.
- Native labelled select/radio/checkbox controls, fieldsets/legends, live status/error regions, heading hierarchy, skip link and modal focus are used. Availability is expressed in text, not color alone.
- The new layout remains monochrome and is tested at 320, 390, 768, 1024 and 1440 px. Browser tests use synthetic companies and intercept all API traffic. They are not physical-device, real screen-reader or live BankID acceptance.

## Delivery evidence

See [verification and delivery report](saas-customer-onboarding-verification.md) and the [browser reproduction instructions and receipt](saas-onboarding-browser/README.md). SaaS production activation remains dependent on the server handoffs above; this branch does not migrate existing data, change provider configuration, add schedules, merge to main or publish Sites.

## Producer handoffs available at final review

Two branches appeared after the initial inventory and were inspected without merging their changes:

- Agent 2: [`1a634c1e845d8a739a1df1e0978ca0aa3534779c`](https://github.com/sharbel0022/Mgeorge/tree/1a634c1e845d8a739a1df1e0978ca0aa3534779c), `feature/saas-openpayments-provider`; [adapter contract](https://github.com/sharbel0022/Mgeorge/blob/1a634c1e845d8a739a1df1e0978ca0aa3534779c/docs/integration/saas/openpayments-adapter.md) and [capabilities](https://github.com/sharbel0022/Mgeorge/blob/1a634c1e845d8a739a1df1e0978ca0aa3534779c/docs/integration/saas/provider-capabilities.md).
- Agent 7: [`eed68796179565e0fa76b8e201b23449b2a9c754`](https://github.com/sharbel0022/Mgeorge/tree/eed68796179565e0fa76b8e201b23449b2a9c754), `feature/saas-security-acceptance`; [security acceptance](https://github.com/sharbel0022/Mgeorge/blob/eed68796179565e0fa76b8e201b23449b2a9c754/docs/integration/saas/security-acceptance.md).

Neither implements the company directory, membership model, onboarding projection, web mutations or SCA handoff route above. No direct API substitution is therefore available. Agent 8 should integrate the following explicit mappings with Agents 1/3/4/5:

| Provider/server boundary | Required mapping to this UI |
| --- | --- |
| `forCompany()` context and PSU/company identity | Derive owner, company/connection, corporate ID, PSU identity, BIC and trusted interactive request metadata on the server. Browser IDs/permissions are not an identity or membership source. |
| App scopes and user read purposes | Open Payments app scopes are not the UI's purpose strings. Enforce the actual granted data purposes per company and subsequent query/job; do not imply unsupported granular provider consent. |
| `createAuthorisation()` / `startAuthorisation()` | Use a returned authentication method ID. Own method selection, actual challenge/QR/autostart and timely polling in the reviewed SCA integration. Raw challenge data cannot be silently replaced by this UI's waiting state. |
| Opaque handles, status and expiry | Persist server-only handle mappings; expose public resource IDs. Convert provider dates/statuses conservatively to the UTC projection. Unknown expiry stays null. `partiallyAuthorised` is not active; final SCA still requires a valid consent check. |
| Validated external `redirectUrl` | Store and validate it in the company/session-bound server handoff. Return only the exact internal path to this UI; never put opaque handles or OAuth data into the company URL. |
| Bankgiro enrichment | The inspected adapter uses the AIS transaction resource and the same `Consent-ID`; no separate BGI consent resource is established. Verify the company's product/coverage separately. Keep entitlement, validity, next eligibility and completeness unknown/null unless evidenced; a bank catalogue entry or Bankgiro number is insufficient. |
| Booked rows and Bankgiro observations | Agent 4/5 must preserve originals and actual reference/payer source, deduplicate economic effects and provide the authoritative reconciliation receipt. The adapter's `paymentReconciliationAllowed: false` cannot become a `verified` payment by projection alone. |

Agent 7's company/role/provider acceptance and final integration gates remain open for the missing server work. The frontend's synthetic A/B/race coverage is additional evidence, not a substitute for those server tests or a commercial release decision.
