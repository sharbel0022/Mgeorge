# Agent 1 → Agent 8: multi-company contract proposal

Branch: `feature/saas-multitenant-foundation`. Target: `main` via PR, no self-merge. Baseline: `14a042abd37fa455d08da9dfcc096ef4f603b512`.

## Proposed version decision

Review **`mgeorge-saas-v1`** and proposed parent edition **`mgeorge-integration-v2`** before consumers adopt the new authorization semantics. The existing `mgeorge-integration-v1` remains the released baseline until integration. Individual bank/reference/reconciliation contracts keep their versions; company identity is an additional authorization boundary and does not change their financial meaning.

Read [contracts](contracts.md) for CompanyContext, CompanyMembership, CompanyAuthorization, CompanyDataBoundary and CompanyReferencePolicy; read [multitenancy](multitenancy.md) for migration, preservation and rollout requirements.

## Fields and consumers requiring coordination

| Surface | New or affected fields | Consumer requirement |
| --- | --- | --- |
| Company catalogue | Company ID, immutable storage owner/key, verified relationship, company version/status | Never map by name, invoice or client owner. Do not change existing R2/AAD keys. |
| Memberships | Company/actor key, role, status, membership version | Resolve authenticated actor separately from namespace; recheck after awaited work and at commit. |
| Active selection | Actor, company ID, context version | UI and API pin company/version; stale selection returns a distinct context conflict. |
| All business data | Existing partition/owner binding | Preserve original financial fields, IDs, checksums, account evidence, consent and allocations. |
| Worker jobs | Fixed company/storage owner plus live membership or worker grant | Do not use UI selection or an arbitrary payload owner to choose a tenant. |
| Original recovery | `companyBoundary` / immutable Node database boundary | Expected-company verification before output; legacy archives remain legacy evidence. |
| Reference policy | Company-local existing policy arrays; typed company policy envelope for new consumers | Explicit reference conflicts and observed bank references retain current semantics. |
| API | Companies directory/switch, company headers and original query selectors | No role/tenant privilege from client input; reject conflicting/forged selectors. |
| Frontend | Company/actor/role/version cache identity | Clear workspace and reload on selection; discard old response bodies and forms. |

Agent 8 must reconcile migration numbering with other parallel branches instead of renaming existing deployed migration files.

## Exact schema proposal

Node migration: `migrations/node/0001_company_catalog.sql`. Its catalogue stays in the original `DB_PATH`; each fresh company has a server-generated separate SQLite file.

| Node table | Fields |
| --- | --- |
| `companies` | `company_id`, `name`, `storage_owner` UNIQUE, `database_key` UNIQUE, `company_version`, `status`, `verification_ref`, `verified_by`, `created_at` |
| `company_roles` | `role` |
| `company_memberships` | `(company_id,actor_id)` primary key, `role`, `membership_version`, `status`, `updated_at` |
| `company_active_contexts` | `actor_id` primary key, `company_id`, `context_version` |
| `company_schema_migrations` | `version` primary key, `applied_at` |
| `company_database_boundary` | Partition-local singleton `id=1`, `company_id`, `storage_owner`, `boundary_version=1`, `verification_ref`, `verified_by`; created during explicit binding/provisioning, immutable thereafter |

Node existing invoice, bank, original, job and allocation columns remain unchanged. New audit events add `companyId`, `actorId` and `membershipVersion` within existing `audit_events.details` JSON. Earlier audit JSON is retained verbatim. `database_key='legacy'` points at the existing database and is never a client-supplied path.

Sites migration: **`sites/drizzle/0019_company_boundaries.sql`**, accompanied by `sites/db/schema.ts`, `sites/drizzle/meta/0019_snapshot.json` and `_journal.json`.

| Sites table | Fields |
| --- | --- |
| `companies` | `id`, `name`, `storage_owner` UNIQUE, `status`, `company_version`, `boundary_version`, `legacy_owner` UNIQUE nullable, `ownership_verified_by`, `ownership_evidence`, `ownership_verified_at`, `created_at`, `updated_at` |
| `company_memberships` | `(company_id,actor_id)` primary key, `role`, `status`, `membership_version`, `created_at`, `updated_at` |
| `company_roles` | `role` restricted to owner/admin/accountant/viewer |
| `company_user_contexts` | `actor_id` primary key, nullable `active_company_id`, `context_version`, `updated_at` |
| `company_worker_grants` | `id`, `company_id`, `actor_id`, `membership_version`, `company_version`, `runner`, `credential_sha256`, `status`, `grant_version`, `created_at`, `updated_at`; unique active `(company_id,runner)` and globally unique `credential_sha256`, including revoked history |
| `company_operation_guard` | Transient singleton `slot=1`, `storage_owner`, nullable `company_id`, `actor_id`, nullable `context_version`/`membership_version`, `action`, `authorized=1`; inserted and removed in the same atomic business batch |
| `bank_auth_flows` and `gmail_flows` | Each gains nullable `company_id`, `company_actor_id`, `company_context_version`, `company_membership_version`; retained OAuth flows are pinned, never used as company adoption evidence |

The migration adds insert/update/delete ownership fences to every table in `sites/lib/company-owner-tables.json` (29 current owner tables), plus immutable binding, membership/version, last-owner, worker-credential retention and OAuth pinning triggers. No old `owner`, R2 key, consent ciphertext, original hash, financial JSON or allocation is rewritten. Future owner tables must join the manifest and receive the same triggers; the schema census regression rejects omissions.

The encrypted Sites snapshot and isolated restore receipt gain an optional authenticated `companyBoundary`. Old archive formats stay readable but are rejected if supplied as a company-bound restore. No active catalogue, membership or worker grant is restored from those evidence bundles.

## Integration-specific requirements

The current Node authentication remains local administrator/session based. The trusted provisioning APIs consume independently verified operator evidence; this PR does not invent a new legal-identity provider. Sites empty-company creation is authenticated and creates no imported real business data. Existing owner adoption remains a separate trusted operation. Onboarding must supply real actor/owner verification before binding M.George or any other existing company.

Directory consumers must implement the `selectionRequired:true` state as well as selected and explicit legacy states. An actor whose current membership is removed may still select another permitted company, but cannot render a financial workspace until that choice is confirmed. A zero-membership actor is denied and must never fall back to legacy.

New Node mailboxes require `MG_COMPANY_GMAIL_ACCOUNTS`; Sites mailboxes require the verified `COMPANY_GMAIL_ACCOUNTS` registry described in `multitenancy.md`. New tenants without a trusted mailbox mapping stay disabled. Global runtime provider credentials are not evidence that a particular tenant owns a mailbox, account or Bankgiro source.

For a bound company, each `BANKGIRO_SOURCE_CONFIG.registrations[]` used for intake must have `owner === CompanyContext.storageOwner` and `companyId === CompanyContext.companyId`. Both HTTP and scheduled intake return `BLOCKED` with `COMPANY_BOUNDARY_MISMATCH` when this binding does not match, before provider calls, lease acquisition or financial/source/job mutations. An explicit disabled registration must also match that company before it can revoke the retained source. Removing a registration entirely can only revoke the currently captured immutable owner; it cannot authorize new intake.

Sites workers resolve the exact company from a private credential's SHA-256 and runner. They never accept a target company from request JSON, headers or query. Grant rotation revokes and retains the previous row; a used credential cannot be transferred to another company or runner. Live member/company versions, grant status/version and enabled automation are checked at database boundaries. Provisioning creates a disabled automation row; activation requires separately authorized setup. Legacy global-worker credentials retain their old explicitly unbound path and do not become a universal tenant credential.

## Integration gates

- Preserve the existing Site identity, DB/R2 bindings, secrets, schedules and authorization configuration.
- Apply additive migrations before any new company context is enabled.
- Authenticate membership management/provisioning through the responsible onboarding workstream; trusted helper functions are not public claim-company endpoints.
- Validate owner, actor, role, revocation and job authority across the complete joined bank/Gmail/Bankgiro pipeline. A connected bank does not establish Bankgiro entitlement.
- Verify deployed request context/async storage behavior with synthetic companies before adopting real storage.
- Keep this PR unmerged until independent review and the integration gates pass. No Sites publication is performed by Agent 1.
