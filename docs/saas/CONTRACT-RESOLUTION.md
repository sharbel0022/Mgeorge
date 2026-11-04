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

`id`, `owner`, `company_id`, `provider_kind`, `environment`, `app_generation`, `bank_id`, `bank_name`, `status`, `encrypted_state`, `selected_accounts`, `valid_until`, `revision`, `last_synced_at`, `last_error`, `request_key_hash`, `created_at`, `updated_at`.

Connection and account secrets are encrypted with the existing owner/purpose-bound codec. Public account selectors are opaque IDs mapped to retained encrypted handles. Every read/write checks company/owner/provider/generation; CAS revision and existing bank locks fence concurrent consent changes. Callback state consumption is durable and single-use before authorization activation. Uncertain external writes remain pending/review/revocation-pending rather than falsely active or safely revoked.

The shared additional-provider manager exposes bank discovery, consent start/status/callback/account selection/revocation and read-only transaction acquisition. Repositories implement owner/company-scoped read/insert/CAS and existing-flow read/create/consume operations. Node and Sites adapters reuse their existing database authorization and bank locks. The manager must not allocate invoices or introduce a financial engine. Production construction requires a trusted corporate/PSU registration and actual supported transport; absent credentials or production mTLS keeps that provider unavailable.

## Migrations and recovery

Keep foundation D1 migration0019. Generate cumulative consent0020 and provider-persistence0021 from the merged ORM schema and foundation snapshot/journal. Later sync metadata must be regenerated cumulatively rather than choosing either producer's conflicting snapshot0019. New owner tables enter the shared census, row ownership triggers, backup formats and isolated restore tests. Old snapshots remain readable without fabricating company bindings. Tenant-unaware rollback is forbidden after company adoption.

## Exact originals and financial rules

The provider transport must retain exact bounded UTF-8 HTTP entity bodies and request paths for Bankgiro capture; parsed/re-serialized JSON is a different representation and must not be called exact original evidence. Preserve existing parsed-original versions and add an explicit raw-response receipt. Decryption/raw originals remain server-side.

Foundation reference policy is canonical. `invoice_number` uses the exact invoice text; `explicit_only` accepts only the existing explicit-reference rules and is not formal OCR. The sync policy adapter must retain the actual policy version and evidence. `0599`, `599`, `00599` and explicit non-OCR strings remain distinct. Other companies do not inherit M.George's policy.

An authenticated later report may add a genuinely missing payer field without changing already supplied bank facts. Only explicitly permitted missing-to-present payer-field additions qualify; changed amount/date/currency/reference/recipient/account/identity or arbitrary raw fields remain conflict evidence. Earlier originals stay immutable and earlier incomplete rows stay reviewable. An AIS deposit and related report still count economically once; no date/amount-only relation and no allocation without full current evidence.

## UI and activation

Use the actual foundation directory/legacy/selection states and canonical roles. Organization identity is optional evidence-backed information, not invented from a name or user namespace. Company creation creates an explicitly empty workspace; it does not certify legal identity. Company switching uses the foundation's versioned active-company operation and invalidates all stale requests.

Expose scoped onboarding and lifecycle routes using actual server services. Redirect navigation resolves a retained flow because browser navigation does not add company headers. Use the existing same-origin/CSRF protection and durable idempotency/revision checks. A UI action being available requires live membership and actual server/provider capability; provider fixtures never become a successful BankID connection.

`MG_SAAS_ONBOARDING_ENABLED` must be exactly `true` to create new SaaS workspaces or start new company/provider onboarding in production. Absent/false is disabled. Existing authenticated legacy banking and retained data remain available. This technical switch does not replace the separately recorded commercial launch decision.
