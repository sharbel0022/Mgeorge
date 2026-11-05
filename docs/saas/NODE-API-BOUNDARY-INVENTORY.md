# Node HTTP API boundary inventory

Date: 2026-11-05. Scope: the actual HTTP dispatcher in [`src/server.js`](../../src/server.js), on `feature/95-saas` based on `4ad205b`. This complements the [Sites inventory](API-BOUNDARY-INVENTORY.md). It is a source census with test pointers, not an exhaustive endpoint penetration test or production acceptance.

The dispatcher contains six API paths before company dispatch, 34 literal company business paths, nine other object/action patterns, and one SaaS bank dispatcher with eight supported subpaths. The tables account for all of them. No business route outside the installed company boundary was identified. Two existing viewer-read failures and an incorrect lost-session projection were reproduced and repaired during this census; see the regression record below.

## Installed boundary and identity limitation

The listener is loopback-only. `route` validates the host, checks browser origin/fetch metadata, establishes the authenticated actor, and handles the narrow exceptions below. Every remaining API request passes through `companySelector`, `companyRuntime.resolve`, `callbackCompanyContext`, and `companyRuntime.run` before `companyRoute` can access business data.

The company selector accepts an ID/context version in headers or query parameters; conflicting or duplicate selectors are rejected. A selector is never membership evidence. Resolution checks the active company, active membership and role, and current company/member/context versions. An authorized member of a second company still needs an explicit active-company switch. `req.actorId` remains the authenticated person; `req.principal` becomes the resolved company's storage owner.

[`src/company-runtime.js`](../../src/company-runtime.js) selects a physically separate SQLite partition whose immutable boundary must match that context. The database proxy captures the scope and rechecks membership, session and permissions around operations. Synchronous write transactions serialize against the control catalog; transactions cannot survive an asynchronous yield. Captured statements cannot be reused in another scope. Per-company service bundles isolate caches, integration leases and payment-control state. Original-file routes read from the selected partition and emit company response headers; an object ID alone cannot select a database.

`readBody` rechecks session and company permission after reading streamed input and rejects business-payload tenant/owner overrides. JSON, redirect and original-file response paths call `companyHeaders`, which rechecks the company scope before writing response headers. Provider/document-processing paths also supply live authorization callbacks. These checks do not make remote providers, database commits and bytes already delivered one atomic transaction.

Export uses a narrow `recordDataExport` runtime operation to retain its audit event for all read roles. It accepts no SQL, event name, details or tenant selector. It checks the current read/session/company scope under catalog and partition write locks and appends only `data_exported` with server-derived company/actor metadata. Ordinary database writes remain unavailable to viewers.

**Node is not a public multi-user registration service.** HTTPS password login creates the single principal `administrator`; local OS access uses `local-admin`. Settings expose `user_mode: 'single_administrator'`. Distinct actors in company HTTP tests are provisioned through trusted fixture/operator setup. `provisionCompany`, `bindLegacyCompany` and `setMembership` are trusted runtime APIs with no HTTP route. They must not be confused with public signup, invitation acceptance or proof of a legal representative. A separate reviewed identity/onboarding adapter is necessary before offering this Node entry point to independent customers.

## Permission legend

The central dispatch function is `companyAction` in `server.js`; grants are defined in [`company-contract.js`](../../sites/lib/company-contract.js).

| Code | Company permission |
| --- | --- |
| R | `read`: owner, admin, accountant, viewer. |
| W | `write`: owner, admin, accountant. |
| I | `manage_integrations`: owner, admin. |
| S | `manage_company`: owner, admin. |
| C | Authenticated actor/catalog operation before a selected company is required. |

These are required dispatch permissions, with any stronger service check noted. They are not a guarantee that every business condition permits a successful response. The unbound legacy workspace is an explicit exception for its configured legacy principal; after binding, it cannot be used as a fallback around company authorization. No membership-management, company-provisioning, backup-restore or OCR-worker HTTP route exists in this Node dispatcher.

## Paths before company dispatch

| Path | Method | Boundary / behavior | Test pointer |
| --- | --- | --- | --- |
| `/api/health` | GET | Public fixed application/liveness response after host validation; no company data. | API |
| `/api/me` | GET | Anonymous response contains no company data; authenticated company details use resolved scope and session checks. | API, AUTH, BND |
| `/api/login` | POST | HTTPS administrator login only; exact origin, JSON, 8 KiB input budget, password/rate checks, rotated secure session. | AUTH |
| `/api/logout` | POST | Authenticated browser session; exact origin; invalidates that session and pending control-database OAuth rows. Later company callbacks also check the live session. | AUTH, BANK |
| `/api/companies` | GET | C: current actor's active memberships and selected context; no provisioning handler. | BND |
| `/api/companies/active` | POST | C: exact origin, post-body session check, current target membership and context-version compare-and-swap. Only company ID/version accepted. | BND |

Non-API paths serve a fixed allowlist of application assets, shared browser modules and legal-information pages. They contain no private business records. An unsupported path/method does not introduce another data handler.

## Company business paths

Every row below runs inside the resolved company scope. Braces describe the actual dynamic route patterns rather than additional literal paths.

### Literal paths (34)

| Path | Methods / required permission | Additional boundary / test pointer |
| --- | --- | --- |
| `/api/bankgiro/source/status` | GET R | Storage owner and registered company/source match; BND, BGI. |
| `/api/bankgiro/source/run` | POST I | Empty payload; verified source, durable lease and legacy/SaaS binding guard; BND, BGI. |
| `/api/reconciliation/preview` | GET R | Owned transaction selector; after-await authorization; BND, EVIDENCE. |
| `/api/payment-control/overview` | GET R | Company service bundle and owner-specific run history; CONTROL. |
| `/api/payment-control/run` | POST I | Request ID only; worker retains initiating authorization; CONTROL, BND. |
| `/api/dashboard` | GET R | Scoped invoice/payment summary; API, BND. |
| `/api/settings` | GET R; PATCH S | Per-company settings/services; unsupported automatic mail remains rejected; API, BND. |
| `/api/invoices` | GET R; POST/PATCH W | Scoped invoice/original lookup; business payload cannot switch tenant; API, BND. |
| `/api/bank-transactions` | GET R; POST/PATCH W | Scoped original/reference rules and financial rows; API, BND, EVIDENCE. |
| `/api/bank-specifications` | GET R | Owned transaction and retained specification candidates; BGI. |
| `/api/bank-specification-links` | POST W | Owned evidence and live authorization callback; BGI. |
| `/api/suggestions` | GET R | Scoped conservative matching; API, EVIDENCE. |
| `/api/reconciliation` | POST W | Company partition; legacy reconciliation blocked after SaaS bank binding; EVIDENCE, SYNC. |
| `/api/customer-messages` | GET R | Drafts and delivery records from selected partition; MESSAGES. |
| `/api/customer-contacts` | POST W | Verified contact action records the actor and rechecks authority; MESSAGES. |
| `/api/payer-links` | POST W | Verified payer action records actor; no free tenant override; MESSAGES. |
| `/api/imports` | GET R | Company import-job overview excludes original bytes; API. |
| `/api/import/preview` | POST W | Bounded original parsing with company/owner authority; API, BGI. |
| `/api/import/commit` | POST W | Explicit confirmation; original retention/deduplication and scoped commit; API, BGI. |
| `/api/documents` | GET R; POST/PATCH W | Owned invoice relation; file signature/size; post-OCR session checks; API, BND. |
| `/api/allocations` | GET R; POST/DELETE W | Owned invoice/payment, confirmed original evidence and transaction guard; EVIDENCE. |
| `/api/audit` | GET R | Latest selected-partition audit events; API, BND. |
| `/api/export` | GET R | Company records and fixed-purpose export audit operation; READ, API. |
| `/api/bank/status` | GET R | Owned connections and pure local consent-flow projection; authoritative control-database sessions; READ, BANK. |
| `/api/bank/connect` | POST I | Configured provider, bank/company authority, retained browser/session/state pin; BANK, BND. |
| `/api/bank/callback` | GET I | One-use flow, initiating browser, actor/company/version pin and provider verification; BANK, BND. |
| `/api/bank/accounts` | POST I | Owned connection, corporate account scope, current consent and lease; BANK. |
| `/api/bank/sync` | POST I | Owned connection/account, current consent and session, company-binding guard; BANK, SYNC. |
| `/api/bank/connections` | DELETE I | Owned connection, fenced revocation and explicit provider/bank revocation distinction; BANK. |
| `/api/gmail/status` | GET R | Company mailbox configuration and local connection status; GMAIL, BND. |
| `/api/gmail/connect` | POST I | Company mailbox, browser-bound state and requested scope; GMAIL, BND. |
| `/api/gmail/callback` | GET I | One-use state, context/session pin, correct mailbox and post-await authority; GMAIL, BND. |
| `/api/gmail/sync` | POST I | Company mailbox and import lease; live authorization throughout; GMAIL, SYNC. |
| `/api/gmail/connection` | DELETE I | Owned connection, confirmed token revocation and fenced removal; GMAIL. |

### Object/action patterns (nine)

| Pattern | Methods / required permission | Additional boundary / test pointer |
| --- | --- | --- |
| `/api/payment-control/runs/{id}` | GET R | Run lookup requires current storage owner; CONTROL. |
| `/api/invoices/{id}` | GET R | Invoice, allocations and documents are all loaded inside selected partition; API, BND. |
| `/api/bank-specification-links/{id}/revoke` | POST W | Current owner/evidence/version and authorization callback; BGI. |
| `/api/bank-transactions/{id}/original` | GET R | Owned retained original and company headers; BGI, EVIDENCE. |
| `/api/customer-messages/{id}/{edit, reject, review, send}` | POST W | Owned message/version; send additionally requires explicit reviewed approval, evidence and live authority through delivery preparation; MESSAGES. |
| `/api/imports/{id}/original` | GET R | Selected partition, eligible owner, retained bytes and SHA-256 check; API, BGI. |
| `/api/documents/{id}/{analyze, approve}` | POST W | Owned document and current session; analysis rechecks after asynchronous processing; API. |
| `/api/documents/{id}/preview` | GET R | Owned original, sandboxed response and authorization after PDF processing; API, GMAIL, BND. |
| `/api/documents/{id}` | GET R | Owned original download, company headers and restrictive response policy; API, BND. |

### SaaS bank subpaths (eight)

All use `/api/companies/{companyId}/bank` as prefix. The route ID must equal the already authorized selected company. [`src/saas-bank-runtime.js`](../../src/saas-bank-runtime.js) binds encrypted state to that company's storage owner, pins relevant configuration and passes live session/company checks to the shared runtime. Client IDs, idempotency keys and revisions do not grant authorization.

| Subpath | Methods / effective permission | Additional checks / test pointer |
| --- | --- | --- |
| Empty suffix | GET R | Snapshot does not grant integration management; SaaS flag/config/registration determine available actions; BND, ONBOARD. |
| `/sync` | GET R; POST I | Exact account selector; manual operation requires current connection/revision and owned durable sync runtime; ONBOARD, SYNC. |
| `/callback` | GET I | Strict callback envelope, retained state/session/company/actor pin and provider-confirmed consent; ONBOARD. |
| `/authorizations/{authorizationId}/redirect` | GET I in service | Generic dispatch is R; shared runtime `service` additionally requires owner/admin and valid initiating session/flow. Redirect ID alone grants no access; ONBOARD. |
| `/connect` | POST I | Current provider registration, read scopes, request key and revision; ONBOARD. |
| `/renew` | POST I | Same boundary plus retained-consent cleanup/replacement; ONBOARD. |
| `/accounts` | POST I | Provider-confirmed owned account set; initial sync uses the same company runtime; ONBOARD, SYNC. |
| `/disconnect` | POST I | Known owned consent and confirmed remote cleanup; ONBOARD. |

## Session, callback and background exceptions

All non-GET API operations require the exact configured `Origin` and JSON content type. Normal API reads reject a foreign supplied origin or cross-site fetch metadata. GET provider callbacks intentionally permit provider navigation, but still require the initiating authenticated browser and company authorization. Legacy bank/Gmail state is read through the current partition, then its retained actor, storage owner, company/member/context versions and session hash must match. Moving away and back, revoking/regranting membership, or adopting a legacy database cannot revive an old flow.

Schedulers do not use browser-provided tenant selectors. `scheduledContexts` chooses an active owner/admin for each active company; `runJob` pins the company independently of later browser selection and keeps membership/version checks. Service bundles, account leases, Bankgiro registrations and mailbox mappings stay company-bound. Legacy scheduling runs only where its unbound workspace remains eligible. Backup is a trusted scheduler/maintenance operation, not a restore HTTP endpoint.

## Coverage map and precise limits

The following map distinguishes existing tests from the new READ regressions. Current complete-suite counts and source identity belong in the [delivery report](95-SAAS-DELIVERY.md) and its verification receipt. A shared-storage test is not automatically an HTTP test of every listed route/action/role.

| Key | Tests | What is actually exercised |
| --- | --- | --- |
| AUTH | [`security-session-allocation.test.js`](../../test/security-session-allocation.test.js), [`saas-login-boundary.test.js`](../../test/saas-login-boundary.test.js), [`bank-api.test.js`](../../test/bank-api.test.js) | Actual HTTP anonymous/expired login behavior, session rotation, origin, bounded login and OAuth session rules. No public multi-user signup proof. |
| READ | [`company-read-api.test.js`](../../test/company-read-api.test.js), strengthened API/BANK cases | Six new actual HTTP regressions: viewer status/export, immutable flow evidence, live/lost/expired session projection, fixed audit metadata, denied ordinary writes and foreign/stale selectors, and membership/session revocation immediately before export audit. Local legacy audit/projection and expired callback behavior are also retained in the adjacent tests. |
| BND | [`company-api.test.js`](../../test/company-api.test.js), [`company-boundary.test.js`](../../test/company-boundary.test.js), [`saas-company-acceptance.test.js`](../../test/saas-company-acceptance.test.js) | Actual HTTP partitions, original denial, forged selectors, selected viewer operations, explicit switching and bank/Gmail callback invalidation; runtime SQL/RBAC, three-company colliding IDs, captured statements, cache/jobs and backups. Not every HTTP permutation. |
| API | [`api.test.js`](../../test/api.test.js) | Actual local-mode business HTTP paths, file originals, input and economic invariants. Mostly legacy administrator fixtures, not a full company/role matrix. |
| BANK | [`bank-api.test.js`](../../test/bank-api.test.js), [`bank-consent-api.test.js`](../../test/bank-consent-api.test.js), [`api-account-consent.test.js`](../../test/api-account-consent.test.js) | Actual bank HTTP paths with synthetic provider responses: scope, browser/state/replay, ownership, concurrent actions, expiry/revocation and consent fencing. No live bank/SCA acceptance. |
| ONBOARD | [`company-api.test.js`](../../test/company-api.test.js), [`openpayments-lifecycle-recovery.test.mjs`](../../sites/tests/openpayments-lifecycle-recovery.test.mjs), [`saas-bank-runtime.test.mjs`](../../sites/tests/saas-bank-runtime.test.mjs) | Actual Node disabled/foreign-company HTTP entry plus the shared lifecycle/runtime recovery and browser contracts. Shared-runtime tests do not establish a Node HTTP round trip for every subpath. |
| SYNC | [`company-bank-sync-store.test.js`](../../test/company-bank-sync-store.test.js), [`openpayments-company-bank-sync.test.js`](../../test/openpayments-company-bank-sync.test.js), [`company-bank-sync-scheduler.test.js`](../../test/company-bank-sync-scheduler.test.js), [`company-bank-sync-legacy-binding.test.js`](../../test/company-bank-sync-legacy-binding.test.js), [`company-gmail-scheduler-integration.test.js`](../../test/company-gmail-scheduler-integration.test.js) | Durable SQLite leases/jobs, owner/account binding, provider/consent fences, scheduler isolation and legacy-path blocking. Providers and deployment scheduling remain synthetic. |
| BGI | [`bankgiro-links-api.test.js`](../../test/bankgiro-links-api.test.js), [`bank-import-api-q8.test.js`](../../test/bank-import-api-q8.test.js), [`company-bankgiro-legacy-binding.test.js`](../../test/company-bankgiro-legacy-binding.test.js), plus BND | Actual import/link/original/revoke HTTP and company source authority/legacy binding. No customer Bankgiro product entitlement proof. |
| CONTROL | [`payment-control-api.test.js`](../../test/payment-control-api.test.js), [`payment-control.test.js`](../../test/payment-control.test.js), plus BND | HTTP pipeline activation, origin/approval rejection, durable run lifecycle and removed-member worker fencing. |
| EVIDENCE | [`manual-allocation-evidence-api.test.js`](../../test/manual-allocation-evidence-api.test.js), [`reconciliation-preview.test.js`](../../test/reconciliation-preview.test.js), [`company-reconciliation.test.js`](../../test/company-reconciliation.test.js), plus API/BGI | Original-backed allocation, conservative preview and company reconciliation behavior. Not an exhaustive HTTP tenant matrix for every financial read. |
| GMAIL | [`gmail-api.test.js`](../../test/gmail-api.test.js), plus API/BND/SYNC | HTTP anonymity, callback/session replay, mailbox checks and synthetic import/original handling. No actual Gmail authorization or delivery performed. |
| MESSAGES | [`customer-messages-api.test.js`](../../test/customer-messages-api.test.js), [`customer-messages.test.js`](../../test/customer-messages.test.js) | HTTP/service reviewed-message and evidence constraints with synthetic delivery. The company partition remains the shared boundary; no full four-role HTTP matrix is claimed. |

### Census finding and repair

An isolated synthetic HTTP reproduction against the initial worktree returned 200 for a viewer's `/api/invoices`, but 403 `company_permission_denied` for both `/api/bank/status` and `/api/export`. The status handler attempted unconditional `bank_states` updates; export attempted the audit insert through the generic write guard. An owner's status read also incorrectly classified a live control-database session as lost because it queried the company's separate `sessions` table. These were read-role/status defects, not a demonstrated tenant isolation bypass.

The repair makes bank status a pure projection and uses the authoritative control database for session existence. Expiry remains higher priority than session loss, and existing terminal outcomes remain intact. Export retains its fixed audit event through the narrowly scoped runtime operation described above. The six new actual HTTP cases passed after failing against the original behavior; generic viewer database mutations and foreign/stale-company reads remain denied. Status GET does not consume expired attempts; the existing expired callback guard still rejects them before any provider exchange. Full and adjacent execution evidence is recorded separately in the delivery report.

The census does not verify public reverse-proxy configuration, production sessions, real provider permissions/redirects, an operator's legal-entity checks, production migrations or actual scheduled runs. No production connection, message, customer-data operation or BankID action was performed.
