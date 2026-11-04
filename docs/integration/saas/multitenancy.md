# Mgeorge multi-company foundation

This branch proposes an additive SaaS foundation for the existing Node and Sites applications. It preserves the current financial engines and storage identities. It does not deploy a new Site, migrate production data, activate customer bank connections, send messages, or merge itself.

See [versioned contracts](contracts.md), [implementation plan](implementation-plan.md) and [Agent 8 handoff](agent-8-handoff.md).

## Existing owner and workspace inventory

| Area | Node before this change | Sites before this change |
| --- | --- | --- |
| Identity | Single `administrator` or `local-admin` principal in `sessions` | Authenticated ChatGPT `userId` |
| Financial storage | One global SQLite handle; invoices, bank transactions and allocations have no tenant predicate | `workspaces(owner, revision, payload, updated_at)` with JSON financial records |
| Bank state | Some owner columns, but invoices and most related data are global within the database | Owner-scoped connection/application, flow, lock and sync tables |
| Originals | Bytes, hashes and references in the same SQLite database | D1 `documents.owner`, R2 `${owner}/${documentId}` and owner-bound encrypted data |
| Jobs | Global service instances, leases, retry state and timer | Existing owner-scoped import/document/Gmail/payment-control/bank jobs |
| Reference policy | `app_settings.data.invoice_reference_policies` | `workspace.payload.company.invoiceReferencePolicies` |

A principal, workspace, legal company and bank-authorized account are separate identities. Existing owner strings are valuable evidence of the storage boundary; they are not safely replaceable with a guessed company name or a client `companyId`.

## Model and isolation strategy

Node adds an explicit catalogue and physically separate business databases per company. Sites keeps its existing owner partitions and binds a company to an immutable storage owner. Neither runtime creates a second invoice, bank or matching engine. Current financial invariants remain in the existing transaction/revision/consent/lease code.

| Requested concept | Concrete representation |
| --- | --- |
| Companies | Explicit company catalogue with immutable storage binding, status/version and verification record |
| CompanyMemberships | Unique company/actor relation, role, active/revoked state and monotonic version |
| CompanyRoles | Fixed owner/admin/accountant/viewer catalogue and shared action allowlist |
| CompanyBankConnections | Existing bank connections inside the company DB or verified owner namespace; existing encrypted consent and account evidence retained |
| CompanyBankAccounts | Existing connection account records/selected accounts inside that same boundary; provider proof remains separate |
| CompanyBankgiroSources | Existing owner-bound source configuration, authority history, receipts and ingest tables |
| CompanyInvoices | Existing `invoices` in the selected SQLite partition; Sites `workspace.invoices` under the verified owner |
| CompanyPayments | Existing bank transactions, allocations, credits and evidence under the same partition/owner |
| CompanyOriginals | Existing documents/import originals and checksums; immutable company/namespace manifest in new bound backups |
| CompanyImportJobs | Existing job/lease/checkpoint stores executed under a captured company scope |
| CompanyReferencePolicies | Existing company-local configuration plus the versioned CompanyReferencePolicy adapter |

These are adapted domain concepts, not duplicate copies of every financial table. In Node the physical partition supplies the company key for all rows. In Sites the unique verified owner-to-company binding supplies it for every owner row and its nested workspace records. An unbound legacy workspace remains explicitly legacy; it is never advertised as a verified new customer.

## Authorization and active company

The authenticated actor remains separate from `storageOwner`. Every selected company must have a current active membership. Permission is evaluated by the shared matrix in [CompanyAuthorization](contracts.md#companyauthorization). Client roles and company IDs are not trusted.

Selection carries a version so that switching in one browser tab cannot make another tab's invoice or import target a different company. Current membership/role and company status are checked again at database boundaries. Removing or downgrading a membership invalidates previously captured authority. A company switch does not rewrite the owner of an existing connection, document or queued job.

Background work retains a fixed company identity. It does not resolve the actor's current UI company when a timer or late callback executes. Current consent, account, source authorization, membership/worker grant, lease generation and financial revision remain independent conditions at commit.

### Runtime enforcement

**Node:** `src/company-runtime.js` owns the catalogue and opens server-generated SQLite partitions. `AsyncLocalStorage` binds each request or scheduled continuation to a fixed company. Prepared statements, iterators, transactions and service instances retain that boundary. A statement created for A cannot execute as B; a statement prepared during service initialization must still acquire the current same-company authority at execution. Company writes hold the catalogue lock until the financial transaction commits. An `await` across an open synchronous SQLite transaction triggers rollback, preventing another request from entering an uncommitted connection. Existing session/logout fences remain independent checks. A revoked task may release only its already-captured exact lease/token/generation; it cannot write business data or success state through that cleanup capability.

**Sites:** `withCompanyRequest()` wraps the worker's application dispatch before route execution. Identity resolution happens inside the framework's authenticated-header context. The D1 adapter scopes reads with owner-filtered CTEs and preserves explicitly requested `rowid`. A mutation executes an authorization fence, the existing business statements, and fence cleanup in one atomic `D1.batch`. Triggers on all **29** owner tables reject an operation touching a different namespace, including an omitted owner predicate. The adapter denies raw catalogue access, schema-qualified escapes, unsafe SQL and implicit `REPLACE` deletion. The trigger/table manifest is checked against the actual migrated schema. Old financial revision/lease/original checks remain inside the same guarded batch.

Every request response is checked again before publication. For example, an original read started for A is suppressed if membership is revoked or the selected context changes during its awaited R2 read. OAuth state rows retain the initiating company, actor and context/membership versions; another member of the same company cannot consume the flow, and role change or revoke/reactivate cannot revive it. Worker grants pin company, originating member/version, company version, runner, credential hash and grant version. UI selection is excluded from worker authority.

## Concrete migrations and operator configuration

`migrations/node/0001_company_catalog.sql` is applied transactionally by the Node runtime. It adds only catalogue/role/membership/selection/migration tables to the existing database. An explicitly bound business database additionally receives `company_database_boundary` and immutable-boundary triggers. Existing financial rows have no new mutable tenant column. `MG_COMPANY_DIRECTORY` defaults to `companies/` beside `DB_PATH`; new database filenames are server-generated UUIDs and cannot come from HTTP input. The catalogue's `database_key='legacy'` keeps the original database in place.

Node's trusted APIs are `bindLegacyCompany`, `provisionCompany` and `setMembership`. Binding requires `storageOwner` and `actorId` to equal the configured original principal (`administrator` in secured deployments, `local-admin` in local mode), and rejects conflicting retained bank/import/source owners. A legacy principal with existing unbound financial/original/integration records must verify and bind that storage before provisioning another company; creating an empty company cannot hide the real existing workspace. Both binding and provisioning require `verification:{status:'verified',evidenceId,verifiedBy}`. These helpers consume evidence established by a trusted operator; they do not implement BankID, company-registry or other external identity verification. There is no HTTP endpoint for claiming an existing Node database.

Sites adds `sites/drizzle/0019_company_boundaries.sql`, its schema snapshot and journal entry. It adds six catalogue/fence/worker tables, ownership/membership/context triggers, owner-table write triggers and eight nullable OAuth fields. It performs no financial backfill and creates no company automatically. Apply it using the existing reviewed D1 migration workflow before this runtime is activated. Agent 8 must reconcile the migration number if another branch also introduces `0019`.

Sites' trusted `provisionCompany()` accepts an existing `legacyOwner` only with an exact `verifiedLegacyOwner`, that same authenticated original actor, a pre-existing workspace, and recorded `verifiedBy`/`verificationEvidence`. Fresh provisioning creates an empty random namespace within the same transaction as its catalogue entry; it never copies legacy JSON. The public empty-company endpoint cannot supply these adoption fields. Memberships and worker grants are managed through current scoped authority; a real worker credential must be registered before a bound company can use it.

### Mailboxes and worker integration

New companies must not inherit the global M.George Gmail account. Node uses an operator-supplied `MG_COMPANY_GMAIL_ACCOUNTS` JSON map from company ID to independently approved mailbox. Sites uses `COMPANY_GMAIL_ACCOUNTS` with `{version:1,accounts:[{companyId,storageOwner,email,verifiedBy,evidence}]}` and checks the immutable namespace as well as the company. The corresponding APIs report an unconfigured/empty mailbox and block provider work when the trusted registration is absent. OAuth profile validation, source IDs and outgoing sender preparation use that exact account. A verified legacy binding retains its previous account; its tokens and originals are not rewritten.

Existing identity providers, external schedules and legacy worker secrets are retained. Sites additionally supports distinct private worker credentials: a globally unique SHA-256 resolves exactly one company/runner grant. Rotation leaves the previous binding as a revoked tombstone, so the old key cannot later become another company's key. Each operation rechecks the originating membership, company/grant versions and enabled automation. Fresh company automation is disabled. Node schedules iterate isolated company contexts and prefer an active owner for maintenance that also includes owner-only backups; they never change an admin's role to obtain that permission.

This foundation does not enroll real companies, issue identities, register a real Bankgiro product or alter existing external schedules. Integrating onboarding and worker dispatch must establish each company's real relationship, consent and credential-bound grant explicitly. No task payload or request `companyId` may redirect the privileged worker. For a bound company, a Bankgiro source registration must name both the exact storage owner and the same company ID before new provider intake is allowed.

## Migration and preservation

The migration is additive. It does not backfill a guessed company ID onto old invoices or rewrite a financial payload. Existing R2 object keys, document hashes, encrypted consent, register entries and allocations remain unchanged.

Binding legacy storage is an explicit trusted administrative operation that records a verified owner relationship. Matching the business name or organisation number, possessing an arbitrary invoice, or claiming a company ID in an API request is insufficient. The legacy database/workspace can be bound once; reassignment to another company is prohibited. A fresh company receives a fresh namespace/partition and neutral profile/reference settings.

### Rollout order

1. Integrate and review the proposed shared contract edition and exact migration number with Agent 8.
2. Test migration and backup recovery against isolated copies with the final merged code. Preserve the previous application build and independently verified backups.
3. Apply additive schemas before enabling company selection. Retain legacy behavior until explicit verified adoption/provisioning.
4. Provision a synthetic staging company and prove A/B isolation, roles, revocation, jobs, downloads and cache switching in the real deployment environment.
5. Adopt an existing real workspace only with separately recorded verification of its existing owner's relationship. No data copying or account reassignment is part of adoption.
6. Enable additional real customers only after their own identity, memberships, consent, bank account and source authorization are established by the responsible onboarding/integration workstream.

### Rollback plan

Before any company is bound, the prior application build can continue using untouched legacy business storage while the new additive tables remain. Do not drop catalogue metadata as an automatic down migration.

After binding or provisioning, do **not** serve multiple companies through a pre-SaaS build. Disable admission, retain the current authorization boundary, and roll forward with a fix or isolate each company at the deployment boundary. Restoring an older application must never re-enable implicit legacy-owner access to a company whose member was revoked. Never undo adoption by changing a storage namespace or relabelling old data.

Node company databases and the control catalogue must be retained together. Sites D1 and R2 evidence retain their existing owner identifiers. Offline recovery writes a new evidence-only directory; it neither restores live permissions nor activates integrations. Restoring a company's financial evidence never grants a new operator access to it.

## Original and backup integrity

New company-bound Sites snapshots contain an authenticated `companyBoundary` in their encrypted snapshot. Verification and isolated restore accept an expected CompanyDataBoundary and reject a different company/namespace before producing output. The restore receipt retains the original boundary. Existing owner-bound archives remain readable as legacy evidence; they cannot be silently promoted to a new company.

Node backups verify the immutable database identity when an expected company is supplied. Each company's scheduled backup uses a separate directory. Existing original-byte, SHA-256, foreign-key, ledger and encrypted-archive checks remain in effect.

The Node legacy/control database also contains the company catalogue and membership metadata. Its full database backup is an **operator control-plane backup**, not a company-facing export. No user download endpoint exposes it. A restored bound company database cannot be reopened as an unbound legacy installation. Sites isolated recovery creates empty `evidence_` catalogue/permission/worker tables; it never restores active access or integration grants from financial evidence.

The Sites offline CLI accepts an optional expected company ID after the existing bundle/output/owner/backup arguments. For company-bound recovery, supply it explicitly. The expected storage owner remains the separately supplied existing owner; neither value is taken from an untrusted directory name.

## Reference policies and financial evidence

A company administrator can configure intended invoice references within its own verified storage boundary. Fresh companies retain explicit-only behavior. Existing M.George policy settings remain untouched. Full string identifiers and leading zeroes are preserved, conflicting explicit references stay blocked, and no policy modifies what the bank actually reported.

Policy, source provenance and payer/account/deposit evidence remain separate. Successful company isolation says nothing about whether a bank offers a particular Bankgiro report product or whether an individual payment is matched. Existing financial approval and evidence rules continue to decide those outcomes.

## Validation and delivery receipt

Final local verification, 2026-11-04, on `feature/saas-multitenant-foundation` based on `14a042abd37fa455d08da9dfcc096ef4f603b512`:

| Gate | Result |
| --- | --- |
| Exact-main baseline | 1,565 Node + 3,121 Sites tests passed |
| Final full Node suite | **1,633/1,633 passed** |
| Final full Sites suite | **3,190/3,190 passed** |
| Isolated Bankgiro bridge suite | **47/47 passed** |
| Combined final suites | **4,870 passed; zero failures, skips, cancellations or TODOs** |
| Node syntax / Sites TypeScript / bridge syntax | Passed; Node checked 142 JavaScript files |
| Locked dependency installation | Passed for Node, Sites and bridge |
| Exact installed minimatch mitigation | Passed; one target verified, zero writes |
| Root / Sites production / bridge production audit | Zero reported vulnerabilities |
| Full Sites audit | Eight moderate development-dependency findings; zero high/critical; required high-severity gate passed |
| Sites production build | Passed |
| Independent security review | One reproduced Important worker-credential fallback defect fixed and independently reverified; no remaining reproduced Critical/Important findings in the reviewed boundaries |

The final full suites ran with `--test-concurrency=2` on local Node 24.22.1. The repository's unchanged PR workflow separately runs its default test concurrency and all three jobs on Node 22 (minimum supported 22.13). The PR's exact-head checks are the authoritative CI receipt; the local counts above are not a claim about a CI run that has not yet finished. No dependency or lockfile changes are included.

### Requested isolation acceptance

All cases use temporary or in-memory synthetic SQLite/D1 databases, synthetic companies and original bytes. No production database, account or provider is used.

| Requested case | Concrete regression evidence |
| --- | --- |
| A cannot read B bank transactions | `test/company-api.test.js`, `test/company-boundary.test.js`, `sites/tests/company-storage.test.mjs`, `sites/tests/company-request.test.mjs`: actual HTTP/state reads and database queries, including an omitted owner predicate and colliding record IDs |
| A cannot read B invoices | The same API/database suites validate separately seeded invoice/workspace records and originals |
| A forged company ID grants no access | Actual request tests reject forged, missing, duplicate and conflicting selectors; a company payload cannot retarget an authenticated operation |
| A removed user loses access | Live membership checks reject captured statements, delayed writes and original responses; revoke/reactivate cannot revive an OAuth flow or worker grant |
| Switching company does not leak cached data | Shared client tests plus both actual UI integrations reject delayed responses and delayed body consumption, unmount/blank private state, and handle focus/bfcache and remaining-membership selection |
| A background job cannot switch tenant | Node scheduler/payment-control tests and Sites private worker tests pin company/actor/grant; a UI switch never retargets work and revocation prevents further business writes |
| Restore does not confuse company originals | `test/company-boundary.test.js` and `sites/tests/company-backup.test.mjs` use encrypted archives and actual isolated restore; mismatched company/owner is rejected before output and original SHA-256 remains exact |
| Old M.George data remains unchanged | Node legacy snapshot comparison and Sites additive-migration tests compare all pre-existing columns in all 29 owner tables, including document hashes, consent, source/registry rows and workspace allocations |

The shared contracts and backup additions have explicit failing-then-passing regression cycles. Existing integration fixtures now apply the required additive schema and understand the generated owner CTEs. Fault-injection hooks still target the same business operation; a dedicated helper test rejects write-bearing CTEs and verifies that only the exact generated prefix is stripped. These fixture changes do not relax production authorization, original verification or financial invariants.

The independent reviewer reproduced a revoked company worker credential falling back to another unbound legacy owner when it also matched an old global secret. The fix checks all historical credential bindings, regardless of runner/status, and retains an atomic database fence for an already-running legacy worker. The same external reproduction now returns `403 COMPANY_WORKER_FORBIDDEN` after revocation and with the wrong runner. Credential ownership remains permanently bound to its original company. The reviewer performed read-only source analysis and this independent synthetic reproduction; root ran the full integrated gates above.

### Delivery and activation limits

Delivery is a feature-branch push and PR against `main`; merge and deployment remain outside this task. The [Agent 8 handoff](agent-8-handoff.md) publishes the proposed contract edition, exact new fields, migration-number coordination and integration requirements. Existing quality scores remain **255/330 = 7.73/10; 0/33 at least 9.5**.

Production data has not been accessed or changed by this work. Preservation claims are based on isolated synthetic migration snapshots and unchanged storage formats; they do not claim that a production migration or production restore has been run. Live identity/ownership verification, real bank consent, provider behavior, authenticated deployment/browser acceptance and actual worker dispatch still require the rollout evidence described above. An operator-provided verification record is not itself an external identity-verification service.
