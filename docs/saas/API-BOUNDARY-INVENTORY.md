# Sites API boundary inventory

Date: 2026-11-05. Scope: every `route.ts` under `sites/app/api`, plus `sites/app/mcp/route.ts`, on the `feature/95-saas` worktree based on `4ad205b`. This is a source census and a map to existing executed-test evidence. It does not claim a new exhaustive endpoint penetration test or production verification.

The census contains **41 API route files and one MCP route file**. Dynamic action files represent multiple actions; their dispatch and permission exceptions are described below. No sensitive route that bypasses the configured global request wrapper was identified in this census. No production calls or application changes were made for this inventory.

## Global installation and guarantees

The configured chain is:

1. `sites/vite.config.ts` sets the Cloudflare worker `main` to `./worker/index.ts` and installs the Cloudflare plugin for the Vinext RSC/SSR environments.
2. `sites/worker/index.ts` exports the worker whose `fetch` method wraps **the entire** `vinext/server/fetch-handler` dispatch in `withCompanyRequest`, outside `runWithConnectorBinding`. Route files do not need to repeat this wrapper individually.
3. `sites/lib/server.ts:withCompanyRequest` creates an `AsyncLocalStorage` holder for the request. `/mcp` gets a cloned request so action classification can still inspect the JSON body after the route consumes it.
4. `identity`, `db`, `companyBoundaryForOwner`, or the worker resolver activates `requestScope`. Browser identity comes from `sites/app/chatgpt-auth.ts:getChatGPTUser`, which reads the platform's authenticated-user headers. This assumes trusted Sites ingress; it is not a separate application implementation of JWT or session validation.
5. `resolveCompanyScope` requires active, verified company ownership metadata, active membership, a permitted role, the selected company, and matching context version. Client selectors identify a requested context; they do not grant access. Bound storage and actors with company history cannot fall back to the legacy owner path.
6. `createCompanyDatabase` pins the scope, restricts owner tables, checks reads before and after awaiting SQL, and places authorization guards in the transaction with mutations. Company/member/context versions invalidate captured permissions.
7. Before returning a handler response whose scope was activated, the wrapper calls `assertScopeCurrent` again and adds company/context headers. Thus a selection change or membership revocation observed after an awaited handler prevents delivery of that response.

**The wrapper installs context; it does not eagerly require authentication for every request.** If no scope is resolved, its final scope check does not run. The census below traces each business route to its identity or specialized authorization entry point. Catalogue endpoints intentionally use actor-based authorization before a company is selected. MCP protocol metadata intentionally does not resolve a tenant.

These guarantees apply to the configured worker dispatch. Importing a route module directly outside that dispatch does not automatically recreate the wrapper. The company request and acceptance fixtures explicitly wrap imported handlers. The final response check is also not an atomic transaction across SQL, R2, remote providers, and streaming bytes after a response has been returned.

## Permission and boundary legend

The role contract is `sites/lib/company-contract.js`; path/tool dispatch is `sites/lib/server.ts:actionFor`.

| Code | Meaning |
| --- | --- |
| R | `read`: owner, admin, accountant, viewer. |
| W | `write`: owner, admin, accountant. |
| I | `manage_integrations`: owner, admin. |
| S | `manage_company` or `manage_reference_policy`: owner, admin. |
| M | `manage_members`: owner only. |
| C | Authenticated actor and catalogue/provisioning rules; an already selected company is not required. This is not anonymous access. |
| K | Private worker credential bound to its company and current granting membership; no browser role or client tenant selector can substitute for the grant. |
| G | Global worker wrapper plus `identity`/scoped database activation, directly or through the named service. |
| O | Global wrapper plus `onboardingBankRoute`, which also installs a local wrapper and requires route company to equal authenticated selected company. |

The role columns describe company mode. A retained, unbound legacy workspace follows the explicit legacy branch rather than pretending to have a company role. Provisioning an empty workspace establishes application ownership only; it does not verify legal-entity or bank authority. `restore` is owner-only in the role contract, but there is no restore HTTP route in this census.

## Complete route census

For each entry, the source file is exactly `sites/app` plus the listed file path; bracketed segments are literal directory names. Coverage keys refer to the evidence map below, not to a claim that every method/action was separately exercised with every role.

| Route file path under `sites/app` | Exported methods | Boundary activation / service | Company role | Coverage |
| --- | --- | --- | --- | --- |
| `/api/backups/route.ts` | GET, POST | G: `backupRpc` / direct `identity`; backup engine pins owner/boundary | GET R; POST W | BND, BACKUP |
| `/api/bank/account-evidence/route.ts` | POST | G: direct `identity`; owned transaction/document/revision before `readBankAccountEvidence` | I | BANK, EVIDENCE |
| `/api/bank/accounts/route.ts` | POST | G: `selectAccounts` | I | BANK |
| `/api/bank/auto-sync/route.ts` | POST | G: `automaticSync` | I | BANK, SYNC |
| `/api/bank/automatic/route.ts` | POST | G: `setAutomaticSync` | I | BANK |
| `/api/bank/banks/route.ts` | GET | G: `banks` calls `identity` before bank lookup | R | BANK |
| `/api/bank/callback/route.ts` | GET | G: `callback`; retained OAuth flow supplies initiating context | I | BND, BANK |
| `/api/bank/config/route.ts` | POST, DELETE | G: `saveConfig` / `removeConfig` | I | BANK |
| `/api/bank/connect/route.ts` | POST | G: `connect` | I | BND, BANK |
| `/api/bank/details/route.ts` | POST | G: `fetchBankDetails` | I | BANK, EVIDENCE |
| `/api/bank/disconnect/route.ts` | POST | G: `disconnect` | I | BANK |
| `/api/bank/history/route.ts` | GET | G: direct `identity`, workspace and scoped event query | R | BND; shared SQL boundary, no dedicated route tenant matrix asserted |
| `/api/bank/invoice-candidates/route.ts` | GET | G: direct `identity`, workspace and scoped Gmail/job query | R | BND; shared SQL boundary, no dedicated route tenant matrix asserted |
| `/api/bank/status/route.ts` | GET | G: `status` | R | BANK |
| `/api/bank/sync/route.ts` | POST | G: `sync` | I | BANK, SYNC |
| `/api/bank/verification/route.ts` | GET | G: direct `identity`; transaction must exist in owned workspace | R | BND, EVIDENCE |
| `/api/bankgiro/invoice-search/route.ts` | POST | G: direct `identity`, `searchBankgiroInvoice` | I | BANKGIRO |
| `/api/bankgiro/preview/route.ts` | GET, POST | G: direct `identity`, retained/upload preview | GET R; POST W | BANKGIRO |
| `/api/bankgiro/source/run/route.ts` | POST | G: direct `identity`, empty payload, `runBankgiroSource` | I | BND, BANKGIRO |
| `/api/bankgiro/source/status/route.ts` | GET | G: direct `identity`, `bankgiroSourceStatus` | R | BANKGIRO |
| `/api/companies/[companyId]/bank/accounts/route.ts` | POST | O: `onboardingBankRoute('accounts')` | I | ONBOARD, SYNC |
| `/api/companies/[companyId]/bank/authorizations/[authorizationId]/redirect/route.ts` | GET | O: authenticated directory selection, then `saasBankRedirect` | I | ONBOARD |
| `/api/companies/[companyId]/bank/callback/route.ts` | GET | O: authenticated directory selection, then `saasBankCallback` | I | ONBOARD |
| `/api/companies/[companyId]/bank/connect/route.ts` | POST | O: `onboardingBankRoute('connect')` | I | ONBOARD |
| `/api/companies/[companyId]/bank/disconnect/route.ts` | POST | O: `onboardingBankRoute('disconnect')` | I | ONBOARD |
| `/api/companies/[companyId]/bank/renew/route.ts` | POST | O: `onboardingBankRoute('renew')` | I | ONBOARD |
| `/api/companies/[companyId]/bank/sync/route.ts` | POST | O: `onboardingBankRoute('sync')`, `runOnboardingBankSync` | I | ONBOARD, SYNC |
| `/api/companies/[companyId]/bank-onboarding/route.ts` | GET | O: `onboardingBankRoute('snapshot')` | R | ONBOARD, SYNC |
| `/api/companies/active/route.ts` | POST | `companyCatalogueAction('active')`; authenticated actor, live target membership, context CAS | C: any active target membership | BND |
| `/api/companies/memberships/route.ts` | POST | `companyCatalogueAction('membership')`; selected scope plus `changeCompanyMembership` | M | BND |
| `/api/companies/route.ts` | GET, POST | `companyCatalogueAction('list'/'create')`; directory / empty-company provisioning | C | BND |
| `/api/customer-messages/[action]/route.ts` | GET, POST | G: `messagesAction` starts with `identity(req)` | GET R; POST W; send additionally requires explicit approval and current evidence | MESSAGES |
| `/api/export/route.ts` | GET | G: direct `identity`; workspace, audit, documents, messages, deliveries, contacts, findings use scoped DB | R | BND; shared SQL boundary, no dedicated route tenant matrix asserted |
| `/api/files/route.ts` | GET, POST | G: direct `identity`; owned metadata and owner-prefixed R2 keys | GET R; POST W | BND, ORIGINAL |
| `/api/gmail/[action]/route.ts` | GET, POST | G: `gmailStatus/Connect/Callback/Sync/Disconnect/Review` or `processingAction` | GET status R; callback I; POST connect/sync/disconnect/automation/trust I; process/retry/review W | BND, GMAIL |
| `/api/import-jobs/route.ts` | GET | G: direct `identity`; `readImportJobStatuses(db(), user.userId)` | R | JOBS |
| `/api/ocr-worker/[action]/route.ts` | GET, POST | `workerAction` → `workerOwner` → `companyWorkerIdentity`; request's bearer grant pins company | K | BND, OCR |
| `/api/onboarding/companies/route.ts` | GET, POST | `onboardingCompanies`: platform actor, actor directory, CSRF/idempotent empty provisioning | C | ONBOARD |
| `/api/payment-control/[action]/route.ts` | GET, POST | G: `paymentControlAction` starts with `identity(req)` | GET R; supported POST run/advance I | CONTROL |
| `/api/reconciliation/preview/route.ts` | GET | G: direct `identity`; owned transaction, original-aware preview and revision recheck | R | EVIDENCE |
| `/api/state/route.ts` | GET, POST | G: direct `identity`; scoped workspace, original checks and revisioned mutations | GET R; ordinary POST W; settings/reference-policy S | BND, ORIGINAL, EVIDENCE |
| `/mcp/route.ts` | POST | Public metadata or authenticated tool service; global wrapper classifies tool from cloned JSON | Metadata: public; tools R/W/I below | BND, MCP |

## Intentional exceptions and action details

### Catalogue and onboarding registration

`/api/companies` and `/api/onboarding/companies` authenticate the actor without requiring an existing selected company. The first supports directory reads and explicit empty-company creation; the second adds actor/cookie-bound CSRF and idempotent creation. Neither accepts a client-selected storage owner or legacy adoption evidence. The onboarding UI's `canCreate` projection is not the authorization implementation: the server's provisioning rules determine whether an empty company may be created. The response keeps legal identity/organization number unknown.

`/api/companies/active` validates target membership and performs a context-version compare-and-swap. Membership changes resolve the selected scope and additionally require `manage_members`; the database enforces last-owner safety inside the transaction. These endpoints are actor-authorized catalogue exceptions, not public endpoints.

### Browser mutations and callbacks

Ordinary browser mutation services call `identity(req)`, which requires an exact same-origin `Origin` for non-GET/non-HEAD requests. Catalogue mutations apply the same origin rule. Onboarding mutations additionally require the `__Host-mg-onboarding` cookie, an actor-bound `X-CSRF-Token`, JSON content type, and an idempotency key (`sites/lib/onboarding/directory-adapter.ts`).

GET callbacks are intentional provider navigation endpoints. They do not require mutation `Origin`, but they still require the authenticated actor and authorized company context:

- `/api/bank/callback` and `/api/gmail/callback` recover company, initiating actor, context version and membership version from the retained flow keyed by the hash of `state`; current selection and membership must still match. Flow validation/consumption belongs to the bank/Gmail service. A callback failure may return a safe redirect without exposing company data.
- The company-specific Open Payments callback and authorization redirect first read the authenticated directory and require its selected company to equal the route company. They construct trusted boundary headers from that selection, then run the locally wrapped handler and the consent runtime. The URL's company/authorization IDs alone grant no access.
- Non-snapshot company bank actions explicitly require `manage_integrations`, independently of the generic method-to-role rule. The runtime supplies the additional consent, authorization, revision and session/state checks.

### OCR worker

`/api/ocr-worker/[action]` uses bearer credentials rather than browser identity or browser CSRF. In the installed request context, `resolveRequestScope` resolves the credential grant before business access. Company headers/query selectors are rejected. A grant is bound to the company, runner, granting actor and membership/company/grant versions; worker authorization is independent of a later browser company switch. Revoked/known company credentials cannot fall through to an unrelated legacy owner. The legacy configured-token branch remains only for its eligible unbound owner.

The actions include POST cloud `process`, POST `lease`, GET `document`, and POST `complete`. Document access also requires the owned live lease, runner, state and active source. The route bounds streamed POST input before dispatch; oversize or malformed/unknown requests may be rejected without resolving a company. That exposes no company payload.

### MCP

`sites/lib/banking/mcp.ts` intentionally serves `server/discover`, `initialize`, `notifications/initialized`, and `tools/list` without identity. These return protocol/server/tool metadata, not private tenant data. Unknown methods/tools and invalid argument shapes may likewise fail before identity resolution.

Every implemented `tools/call` dispatch reaches an identity-checking service. No owner override is accepted. The central permission mapping is:

| Role requirement | Tools |
| --- | --- |
| R | `payment_evidence`, `retained_report_evidence`, `backup_status`, `bankgiro_source_status`, `gmail_sync_status`, `bank_auto_sync_status` |
| W | `backup_step`, `process_invoice_documents`, `reconcile_customer_payments` |
| I | `bank_account_evidence`, `bankgiro_auto_ingest`, `gmail_auto_sync`, `bank_auto_sync` |

The transport rejects a foreign browser `Origin`, requires JSON, and caps the body at 16,384 bytes. Server/OAuth callers may omit `Origin`; tool identity is still resolved through the trusted ingress context. Discovery is public even though the transport comment also describes authenticated tool calls.

### Other public surfaces outside the census

The existing `sites/app/integritetspolicy/route.ts` and `sites/app/anvandarvillkor/route.ts` are public legal-information pages outside `/api` and `/mcp`. Platform sign-in/sign-out/callback paths are referenced by `chatgpt-auth.ts`; they are not tenant business route files in this tree. Example code under `sites/examples/d1/app/api` is not part of the active `sites/app` route census.

## Existing executed-test evidence and limits

Execution receipts are distinct from this source inventory:

- [`evidence/2026-11-05/security-acceptance.json`](evidence/2026-11-05/security-acceptance.json) names the executed Sites security files and records **739/739** passing, no failures/cancellations/skips/TODO, on clean source `95d9a4184275dcbec830ab9558973beba35c8c06`.
- [`evidence/2026-11-05/bank-compat-gates.json`](evidence/2026-11-05/bank-compat-gates.json) records the subsequent complete Sites suite: **3,756/3,756**, no failures/cancellations/skips/TODO, Node `v24.22.1`, source tree `ed92aa3c5ad5e8c50281aedf9670f68b9739ddd1`. It explicitly describes a frozen staged tree and `sourceDirty: true`; this must not be restated as a clean-head run.
- [`../integration/saas/security-integrated-acceptance.md`](../integration/saas/security-integrated-acceptance.md) describes the three-company acceptance scenarios and which infrastructure boundaries are synthetic. These receipts predate the current worktree's recovery changes. New current-head gate results belong in that cycle's separate evidence; this document does not invent them.

All test filenames in the following map are under `sites/tests/`. “Security receipt” means the named file is explicitly listed in the first receipt; “full suite” means a test in the complete-suite set. A module/service test is not automatically an HTTP route test or a test of the deployed ingress.

| Key | Existing coverage pointers | What the pointer supports / important limit |
| --- | --- | --- |
| BND | `saas-company-acceptance.test.mjs`, `company-storage.test.mjs` (security receipt); `company-request.test.mjs` (full suite) | Real scoped storage/request code, colliding IDs across three companies, role denial, SQL/HTTP invalidation after await, foreign original denial before R2, revocation during original read, catalogue selection, callback actor/context/version, workers and legacy fallback. The request fixture wraps handlers explicitly; it is not deployed worker-dispatch coverage. |
| BANK | `banking-security.test.mjs`, `bank-state-integrity-q8.test.mjs`, `bank-account-consent.test.mjs`, `bank-account-commit.test.mjs` (security receipt); `bank-company-authority.test.mjs`, `bank-sync-integrity-q8.test.mjs` (full suite) | Bank route services, synthetic provider/identity, selected-account/consent and persistence checks. Not real bank acceptance. |
| ONBOARD | `saas-onboarding-server.test.mjs`, `saas-onboarding-contract.test.mjs`, `saas-onboarding-client.test.mjs`, `saas-onboarding-projection.test.mjs`, `saas-bank-runtime.test.mjs`, `openpayments-lifecycle.test.mjs`, `openpayments-expired-revocation.test.mjs` (security receipt) | Catalogue, idempotent registration, CSRF, role projection, runtime and consent transitions. Does not establish an exhaustive HTTP permutation for all eight company bank route files or a real SCA redirect round trip. |
| SYNC | `openpayments-company-sync.test.mjs`, `company-bank-sync.test.mjs`, `company-sync-boundary-integration.test.mjs`, `company-sync-scale.test.mjs` (security receipt) | Real D1/company dispatch with synthetic transport, membership/consent fences, durable receipts, partitioned company work, 1/10/100-company scale fixtures. Not deployed scheduling/provider load evidence. |
| ORIGINAL | `saas-upload-boundary.test.mjs` (security receipt); `file-upload-integrity-final.test.mjs`, `file-upload-concurrency-final.test.mjs`, `bank-api-original-q8.test.mjs`, plus BND (full suite) | Bounded upload, retained originals, deduplication races, checksum/provenance and protected downloads. Does not claim that bytes already streamed can be recalled after revocation. |
| EVIDENCE | `bank-account-evidence-contract.test.mjs`, `bank-account-evidence.test.mjs`, `bank-account-evidence-provider.test.mjs`, `bank-details.test.mjs`, `reconciliation-preview.test.mjs`, `company-reconciliation.test.mjs`, `mcp-evidence-read.test.mjs` (full suite) | Owned evidence selection, original-aware previews, account authority and conservative matching behavior. Not an independent per-endpoint tenant matrix for every read route. |
| BANKGIRO | `bankgiro-authority.test.mjs` (security receipt); `company-bankgiro.test.mjs`, `bankgiro-api.test.mjs`, `bankgiro-retained-preview.test.mjs`, `bankgiro-ingest-service.test.mjs`, `bankgiro-source-status.test.mjs`, `bankgiro-ingest-mcp.test.mjs` (full suite) | Company/registry authority, retained/upload evidence, source jobs and MCP intake; synthetic sources only. |
| BACKUP | `company-backup.test.mjs`, `company-bank-sync-backup.test.mjs`, `backup-recovery.test.mjs` (security receipt); `backup-integrity-q8.test.mjs` (full suite) | Company/storage boundary retained in encrypted backups, cross-company restore rejection, original integrity/recovery. HTTP POST backup is W; isolated restore checks are a separate operation. |
| CONTROL | `payment-control.test.mjs` (full suite), plus BND/SYNC | Auth/origin/input rejection, owned durable jobs, leases/concurrency, conservative evidence progression. Shared action classification additionally restricts run/advance to I. |
| MESSAGES | `customer-messages.test.mjs` (full suite), plus BND | Message/evidence/approval behavior and shared scoped storage. Does not by itself prove every dynamic action with every company role. No actual messages were sent for this census. |
| GMAIL | `gmail.test.mjs`, `gmail-adapter-reliability.test.mjs`, `gmail-upload-concurrency-final.test.mjs` and BND's company/Gmail cases (full suite) | Gmail flow/import behavior, verified tenant mailbox selection, neutral unconfigured status, provider blocked without configuration, original/deduplication behavior. No real Gmail authorization or send validation claimed. |
| JOBS | `import-job-route.test.mjs`, `import-job-overview.test.mjs`, `import-job-status.test.mjs` (full suite) | Unauthenticated overview performs no DB access; route derives owner from identity and has no activation/write handler. |
| OCR | `cloud-ocr.test.mjs` and BND's credential/lease cases (full suite) | Company-bound worker credentials, runner/lease checks, private originals and revoked-grant behavior. No live OCR worker execution claimed. |
| MCP | `mcp-security-q8.test.mjs` (security receipt); `mcp-evidence-read.test.mjs`, `bankgiro-ingest-mcp.test.mjs`, BND's consumed-body/role test (full suite) | Foreign-origin rejection, authenticated originless calls, missing identity/owner override rejection, bounded JSON, read/write/integration classification. Public protocol metadata remains intentional. |

## Census result and remaining verification boundary

All 42 route files are accounted for. Each data-bearing path reaches the installed request scope or a documented actor/worker authorization path. No concrete unwrapped sensitive handler was found. This is narrower than proving every route secure against every concurrent interleaving: some route families are covered by shared tenant/storage tests and service tests rather than their own complete HTTP role matrix.

The current census does not verify production ingress header stripping, a deployment's actual worker entrypoint, real provider callback/session behavior, provider permissions, production R2/SQL atomicity, or background scheduling. These cannot be inferred from the static worker wiring or synthetic tests. Future route additions must both remain under the installed worker and activate an appropriate authorization path before accessing data or effects; the lazy wrapper alone is insufficient.
