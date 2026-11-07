### Spec Compliance

- ❌ Issues found: the shared configuration, optional activation, durable monthly budget and restricted status endpoint are implemented, but custom-model configuration changes can reopen an uncertain previously billed original (`sites/lib/openai-invoices/integration.js:174-175`). This violates the required no-double-charge/replay boundary.
- ⚠️ Cannot independently verify from this diff: unchanged financial/source validators and complete production recovery/lease wiring. Their existing implementation remains in place; the controller's integrated verification remains the appropriate gate. This task review did not repeat full suites or builds.

### Strengths

- `packages/ai/index.js:2`, `sites/lib/openai-invoices/index.js:2-12`: one shared provider implementation with runtime adapters and a platform-neutral public entry.
- `sites/lib/openai-invoices/configuration.js:3-5,19-43`: explicit enable/model precedence, bounded tokens/timeouts, decimal-to-integer budget parsing within safe caps, secret-free status and unconditional `liveVerified:false`.
- `sites/lib/openai-invoices/audit-store.js:21-27,52-53,81-82`: daily and monthly checks share each atomic reservation INSERT, UTC boundaries are explicit, legacy rows contribute to sums, and both D1 sums retain owner predicates.
- `sites/lib/openai-invoices/integration.js:160-166,200-204`: fallback requires a definitive unavailable-model receipt without cost uncertainty, independently reserves its budget, and only starts after successful durable receipt recording.
- `sites/app/api/admin/ai-status/route.ts:8-13`, `sites/lib/server.ts:150-153,175`: diagnostic authorization uses current company storage owner and `manage_integrations`; the shared response applies private/no-store. The changed route test covers owner/admin, forbidden roles, wrong company and anonymous requests.
- `test/openai-invoice-integration.test.js:216-224`: built-in legacy receipts and uncertain reservations retain their original identity when runtime token/budget settings change.

### Issues

#### Critical (Must Fix)

- None found.

#### Important (Should Fix)

- `sites/lib/openai-invoices/integration.js:174-175`, `sites/lib/openai-invoices/configuration.js:15`: custom profiles include review date, approval/version, source, prices and limits, and the entire profile is hashed into the durable reservation key. Updating only `reviewedOn` therefore makes the same owner/original/model eligible for another charge after the previous response or receipt was lost. The built-in legacy compatibility test does not cover this path. Make uncertain-reservation protection stable across custom review/configuration changes (and across later built-in/custom representation of the same exact model); use explicit governed migration for any intentional reprocessing rather than allowing attestation metadata to implicitly authorize it.
- Focused in-memory reproduction: use real `createNodeAuditStore`, a valid synthetic custom contract, fixed owner/document/hash/model, an adapter returning `{status:'fallback',issues:['api_network_error'],costUnknown:true}`, and simulate failed receipt persistence with `record:async()=>false`. First request returns `AI_RECEIPT_NOT_SAVED`; identical retry returns `AI_REQUEST_ALREADY_RESERVED`. Change only contract `reviewedOn` from `2026-11-07` to `2026-11-08`; another adapter call occurs. Observed output: `{"first":"AI_RECEIPT_NOT_SAVED","replay":"AI_REQUEST_ALREADY_RESERVED","changed":"AI_RECEIPT_NOT_SAVED","calls":2,"reservations":2}`. Add this regression and equivalent successful-receipt reuse coverage for metadata-only changes.

#### Minor (Nice to Have)

- None recorded.

### Assessment

**Task quality:** Needs fixes.

**Reasoning:** The shared policy/configuration and atomic budget implementation are sound within the reviewed scope. The custom profile identity regression is a concrete duplicate-charge path and must be resolved before accepting the no-replay guarantee.

### Checks

- Read the supplied diff once; recovered the initially truncated middle portion from the diff. Read only the complete cut-off `enrichInvoiceForReview`, audit reservation functions/sum helper and adapter execution function to assess their surrounding control flow.
- Named risk: legacy identity and exact pricing. Checked unchanged `profiles.js`; existing policy version matches the legacy integration version and cost calculation uses integer BigInt arithmetic.
- Named risk: admin actor-versus-owner isolation. Checked the specific `identity`, `withCompanyOwner` and `response` definitions in `server.ts`; identity resolves the company storage owner before policy evaluation.
- Named risk: concurrent/uncertain budget behavior. Inspected existing `openai-invoice-audit-store.test.js` coverage for durable duplicate reservations, conservative failures and D1 owner separation; did not rerun those tests.
- Ran only the isolated custom-contract identity reproduction above; no provider requests, full suites, builds, git changes or implementation edits.
