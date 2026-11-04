# Joined SaaS contract resolution

This records integration decisions, not provider/customer approval. The original producer contracts and financial evidence versions remain retained. Commercial onboarding remains a separately gated operation.

## Authority and consent

The foundation's `CompanyContext` is canonical: authenticated `actorId`, immutable `storageOwner`/`companyId`, owner/admin/accountant/viewer role, and positive integer membership/company/selection versions. A shape is not authority: resolve live membership, retain the context through awaits and recheck it in each protected write. Request company IDs only select an already authorized context.

The legacy unbound workspace keeps its existing authenticated owner and connections. New company flows must never fall back to a fabricated `workspace:<owner>` identity. Node exposes its current runtime context through a scoped server-side accessor; Sites uses `currentCompanyContext()`. Accountants and viewers can read bank status; only owner/admin can manage integrations. Read-only status must not execute maintenance UPDATEs.

Consent provenance retains its initiating actor and versions. Other currently authorized company readers are not required to impersonate that actor. Persistent account/company/provider/generation bindings and bank-evidenced corporate scope remain mandatory. Pending callbacks retain the complete initiating context and browser/session binding; selection changes, revocation/reactivation, replay and preupgrade contextless flows require restart.

Provider IDs at new boundaries are `enable_banking` and `open_payments`. Translate only known retained legacy spellings at trusted adapters. Unknown providers remain rejected. Existing Enable Banking encrypted session/account columns retain their meaning; Open Payments handles must not be stored in those fields.

## Additive provider persistence

Retain and extend the existing bank authorization flow tables rather than creating a parallel callback authority model. A provider discriminator defaults to `enable_banking`; new encrypted provider payload, provider connection ID, public flow ID and request-key hash fields distinguish additional-provider flows. Existing company pin columns and triggers remain mandatory. Callback dispatch selects the provider from the retained server row, never from a callback-supplied provider parameter.

Add `bank_provider_connections` as an owner-scoped business table in both applications. It supports multiple additional-provider connections without overwriting the existing owner-unique legacy bank row. Columns:

`id`, `owner`, `company_id`, `provider_kind`, `environment`, `app_generation`, `bank_id`, `bank_name`, `status`, `encrypted_state`, `selected_accounts`, `valid_until`, `revision`, `last_synced_at`, `last_error`, `request_key_hash`, `created_at`, `updated_at`, `grant_fingerprint`.

`bank_provider_grant_claims` retains the hash-only provider/environment/actual-consent identity and its original owner/company/connection. Claims are immutable and retained after renewal/revocation. The atomic repository write inserts the new connection before its first claim, or claims before an existing connection CAS; a failed CAS rolls back the whole batch. Node checks all validated retained partitions under the existing catalogue writer lock; Sites uses its global D1 claim key. Neither an absence read nor a failed new callback authorizes remote DELETE of an unowned grant.

Connection and account secrets are encrypted with the existing owner/purpose-bound codec. Public account selectors are opaque IDs mapped to retained encrypted handles. Every read/write checks company/owner/provider/generation; CAS revision and existing bank locks fence concurrent consent changes. Callback state consumption is durable and single-use before authorization activation. Uncertain external writes remain pending/review/revocation-pending rather than falsely active or safely revoked.

The shared additional-provider manager exposes bank discovery, consent start/status/callback/account selection/revocation and read-only transaction acquisition. Repositories implement owner/company-scoped read/insert/CAS and existing-flow read/create/consume operations. Node and Sites adapters reuse their existing database authorization and bank locks. The manager must not allocate invoices or introduce a financial engine. Production construction requires a trusted corporate/PSU registration and actual supported transport; absent credentials or production mTLS keeps that provider unavailable.

## Migrations and recovery

Keep foundation D1 migration0019. Generate cumulative consent0020, provider-persistence0021 and retained grant/session ownership0022 from the merged ORM schema and foundation snapshot/journal. Later sync metadata must be regenerated cumulatively rather than choosing either producer's conflicting snapshot0019. New owner tables enter the shared census, row ownership triggers, backup formats and isolated restore tests. Old snapshots remain readable without fabricating company bindings. Tenant-unaware rollback is forbidden after company adoption.

Current Sites census is37 user tables:31 owner business tables and6 internal company-control tables. New encrypted snapshots include24 evidence tables; exact historical20/22-table formats remain readable. Isolated Sites evidence restore keeps all company-control and volatile OAuth/lease tables empty, temporarily removes only the two named live provider-insert admission triggers in a new in-memory database, and restores/checks all original trigger definitions before and after publishing the new isolated evidence artifact. It never creates live memberships or provider authority. Node retains its whole-database format with namespace/claim-join integrity checks. Neither synthetic restore is a production recovery receipt.

## Exact originals and financial rules

The provider transport must retain exact bounded UTF-8 HTTP entity bodies and request paths for Bankgiro capture; parsed/re-serialized JSON is a different representation and must not be called exact original evidence. Preserve existing parsed-original versions and add an explicit raw-response receipt. Decryption/raw originals remain server-side.

Foundation reference policy is canonical. `invoice_number` uses the exact invoice text; `explicit_only` accepts only the existing explicit-reference rules and is not formal OCR. The sync policy adapter must retain the actual policy version and evidence. `0599`, `599`, `00599` and explicit non-OCR strings remain distinct. Other companies do not inherit M.George's policy.

An authenticated later report may add a genuinely missing payer field without changing already supplied bank facts. Only explicitly permitted missing-to-present payer-field additions qualify; changed amount/date/currency/reference/recipient/account/identity or arbitrary raw fields remain conflict evidence. Earlier originals stay immutable and earlier incomplete rows stay reviewable. An AIS deposit and related report still count economically once; no date/amount-only relation and no allocation without full current evidence.

## UI and activation

Use the actual foundation directory/legacy/selection states and canonical roles. Organization identity is optional evidence-backed information, not invented from a name or user namespace. Company creation creates an explicitly empty workspace; it does not certify legal identity. Company switching uses the foundation's versioned active-company operation and invalidates all stale requests.

Expose scoped onboarding and lifecycle routes using actual server services. Redirect navigation resolves a retained flow because browser navigation does not add company headers. Use the existing same-origin/CSRF protection and durable idempotency/revision checks. A UI action being available requires live membership and actual server/provider capability; provider fixtures never become a successful BankID connection.

`MG_SAAS_ONBOARDING_ENABLED` must be exactly `true` to create new SaaS workspaces or start new company/provider onboarding in production. Absent/false is disabled. Existing authenticated legacy banking and retained data remain available. This technical switch does not replace the separately recorded commercial launch decision.

The live switch is rechecked across awaits for new grant/activation operations. Disabling it must preserve an authorized company's ability to inspect and revoke an existing owned grant. Valid current membership, exact credential generation, verified company registration and actual supported transport remain required. Stored connection DTOs distinguish `onboardingAvailable` from availability of an existing connected lifecycle. Terminal status refresh must account for retained older grants; closure of only a renewed grant cannot report complete revocation while an older grant may remain active.

## Joined low-level provider HTTP contract

Both adapters expose the actual foundation-authorized company under `/api/companies/:companyId/bank`. GET `providers`, `provider-connections` and `provider-connections/:id` return stored, private no-store state; GET `open-payments/banks` performs explicit management-authorized provider discovery. All JSON includes the resolved `companyId`. Account selectors and method selectors are opaque public identifiers; registration evidence, handles, tokens, raw originals and provider authorization URLs never enter JSON.

Management POSTs have bounded strict JSON schemas: `provider-connections` takes `{bankId,validUntil,requestKey}`; `provider-connections/:id/renew` takes those plus `revision`; `:id/method` takes `{methodId,revision}`; `:id/accounts` takes `{accountIds,revision}`; `:id/revoke` takes `{revision}`. Explicit `:id/refresh` takes exactly `{}` and uses the manager's fresh owned row/lease/CAS rather than asserting a caller revision. Ordinary GET status does no provider refresh or maintenance write. No financial acquisition/import endpoint is added in this lifecycle integration.

The browser navigates only the server's nested `/api/companies/:companyId/bank/authorizations/:flowId/redirect`. It resolves the retained full company/actor/version pins before identity-scoped storage is used; the URL alone grants no access. `/api/bank/callback` dispatches from the retained provider discriminator before that provider's strict query parser. Open Payments hex and existing Enable Banking base64url state digests are distinct known representations, never fallback authority. Concurrent flows have separate random Secure/HttpOnly/SameSite=Lax cookies. Node additionally pins the actual authenticated application session hash; Sites pins ChatGPT's authenticated actor/full company context and browser nonce because that identity integration supplies no independently observable application-session identifier.

Sites uses the existing project's verified canonical callback `https://mg-fakturakoll-sharbel.sharbelrasho.chatgpt.site/api/bank/callback`. This does not update a provider's registered redirect URI; any actual registration mismatch must fail closed. The obsolete pasted hostname gave404 and is not a working callback target. Node derives its callback from trusted server configuration.
