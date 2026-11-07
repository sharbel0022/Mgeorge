# Whole-branch integration review — 2026-11-07

Reviewed base `4c7b210a0553314c2d9ce95804b892b891f4fe36` through candidate `9fc9227`, using the supplied whole-branch diff, design and implementation plan. Generated/static omissions were accepted as described in the review brief. The later release-cleanup helper is outside this review.

**Spec-compliance verdict: NEEDS FIX.** The administrative status does not consistently describe the actual Node processing policy for the supported legacy installation.

**Code-quality verdict: NEEDS FIX.** One important integration defect remains. No critical finding or other important regression was found in the reviewed changes.

## Important finding

**P2 — Use the actual AI storage owner for legacy Node diagnostics.** `src/server.js:697` calls `invoiceAiPolicy(process.env, req.principal)`. In a legacy Node installation this principal is `local-admin` (HTTP) or `administrator` (authenticated HTTPS), while document processing consistently uses `node:legacy` when there is no company context (`src/openai-invoice-integration.js:6`). Consequently, valid approval for the actual AI consumer is reported as `OWNER_NOT_APPROVED`. The new settings UI then explicitly says the company policy blocks AI and existing OCR is used, although the processing policy permits AI. Conversely, approval of only the login principal can make diagnostics claim permission that document processing does not have.

The policy owner for this route should match processing: current company storage owner when present, otherwise `node:legacy`. Retain the existing actor/session and `manage_integrations` authorization checks. Add real HTTP coverage for an enabled legacy installation and an enabled company installation, with policy binding to the exact storage owner and rejection of approval belonging only to the actor or another company.

**Independent reproduction:** Started the actual HTTP server with a temporary synthetic SQLite database, `NODE_ENV=test`, valid synthetic configuration, all three approvals, and only `node:legacy` approved. No provider or customer-data request was issued. `GET /api/admin/ai-status` returned HTTP 200, `status:"configured"`, `policyStatus:"blocked"`, `policyCode:"OWNER_NOT_APPROVED"`; `invoiceAiPolicy(process.env, 'node:legacy').status` returned `"enabled"`. The temporary database and server were closed and removed afterward.

## Reviewed integration and strengths

- Root domain facades export the existing implementations and route the real Node orchestration imports through those entries; no replacement financial algorithms were introduced. The AI facade keeps the shared core under the standalone Sites source root and lazily imports the Worker adapter.
- Node routes classify the new diagnostic as `manage_integrations` before dispatch and bind real company requests to current storage owner. Sites uses `identity` and `withCompanyOwner` with that same permission. The diagnostic bodies contain explicit configuration/policy separation and `liveVerified:false`, with no keys returned.
- Both UIs gate diagnostics by current workspace role. Node also rejects a late response after workspace/refresh changes; Sites unmounts private children during company switching and aborts diagnostic fetching on cleanup.
- Launcher lifecycle and AI reservation fixes are consistent with the supplied independent rereviews. This review found no additional blocker in their integrated wiring. Prior custom-key/mixed-version deployment limits are documented rather than presented as solved migration support.
- Updated documentation accurately distinguishes local Node and Sites databases/runtime, optional AI configuration from provider access, synthetic checks from live acceptance, and historical/full-task results from pending final-source CI. Windows process acceptance and external bank/Bankgiro/Gmail/OCR limitations remain explicit. Release and branch cleanup are not falsely presented as completed.

## Verification scope and limits

Read the supplied diff in bounded sections, recovering portions truncated by tool output. Focused surrounding-code reads checked the Node principal/company dispatch, Node processing owner, Sites identity/permission enforcement, and both UI role/lifecycle checks. Ran only the single synthetic HTTP reproduction above. No implementation or git mutation, broad tests, builds, provider calls, production requests or subagents were performed. This report is the only review artifact written.

Reported prior focused/full-task test results remain coordinator/implementer evidence, not independent reruns. Mandatory exact remote-head CI and the integrated build are pending acceptance gates, separate from these source-review verdicts.
