# Agent 4 — safe Bankgiro-to-invoice reconciliation

Branch: `feature/mgeorge-safe-auto-reconciliation`.

Pull request: [#28](https://github.com/sharbel0022/Mgeorge/pull/28). Initial published implementation: `9f8b6f17c791639bc65f2c4eb018f25eee75f09e`; the subsequent C1 ownership correction is delivered as a normal follow-up on the same branch. The PR's current head and exact-head CI receipt identify the final delivery.

Initial main: `73662187cddf9a5c504dea9bd8a1288bd929bc51`. The branch incorporated the released contract at `b65273500c214a4e16b880e3840dac90d8bd7401`, then fast-forwarded to final base **`a779b0dd8d184eaf6e6d6e636c555c967f15f3d5`** (PR24). Those main updates added documentation and six synthetic acceptance cases, with no runtime changes. The six added cases were executed separately after the fast-forward. The implementation proposal is `mgeorge-reconciliation-v1` under the released `mgeorge-integration-v1` edition. The PR is the review boundary; merge and publication belong to the integration lead.

## Outcome and integration dependencies

The new surface returns deterministic allocation proposals and explicit VERIFIED / REVIEW / BLOCKED decisions from trusted server evidence. It does not execute allocations. Existing ledgers, importers, matchers, schedules and atomic financial writers are unchanged.

**Agent 1 integration remains required.** Both adapters accept an explicit server-side `referencePolicy`; the GET routes deliberately supply no invented policy provider. Until the reviewed company-bound C1 projection is wired in, these routes return BLOCKED with `REFERENCE_POLICY_REQUIRED`. A configured company name is insufficient. Positive tests inject a synthetic server policy; they are not evidence that C1 has shipped.

The concrete C1/C2/C3 proposals were inspected at PR #27 `5fada91`, PR #25 `9dcf038` and PR #26 `5c9b51b`. Exact hashes, field mappings and activation gates are recorded in [reconciliation-contract.md](reconciliation-contract.md). The new C1 bridge consumes the producer's optional server invoice projection without silently merging its code. Current C2/C3 adapters use existing retained-source and consent services. C2's live account reader is not read-only; C3 delivery identity, imported row count and queue status cannot substitute for bank identity, original count or reconciliation evidence. C5/C6 can consume the preview after the integration lead approves the complete producer mapping. No cumulative merged-producer test is claimed.

## Exact exports and APIs

| Surface | Contract |
| --- | --- |
| `sites/lib/reconciliation-contract.js` | `RECONCILIATION_CONTRACT_VERSION`, `adaptInvoiceReferenceEvidence(facts)`, `buildReconciliationPreview(input)`, `validateReconciliationApproval(preview, approval, context)`; shared ES module with adjacent TypeScript declarations |
| `src/reconciliation-preview.js` | `readReconciliationPreview(db, {owner, transactionId?, referencePolicy?})` |
| Node `GET /api/reconciliation/preview` | Authenticated principal; optional single `transactionId`; rejects all other parameters; session rechecked after asynchronous hashing |
| `sites/lib/reconciliation-preview.ts` | `readReconciliationPreview(owner, state, revision, transactionId, options?)`; `options.referencePolicy` is a trusted server option |
| Sites `GET /api/reconciliation/preview?transactionId=…` | Exactly one valid owned transaction; rejects other/duplicate parameters; rechecks workspace revision and returns 409 if it changed |

Both APIs return `mode: 'preview'`, `changed: false`, `writesAllowed: false`, `approvalRequired: true`, a complete snapshot fingerprint and individual decisions. Node optionally adds `selectedTransactionId`; Sites adds `transactionId` and `selectedStatus`. A global BLOCKED result can include a VERIFIED selected decision if another observation has unresolved evidence. Callers must display the selected decision and its reasons, not infer status from an amount or invoice candidate.

No new persistence fields, tables, migrations, dependency packages, provider endpoints or write handlers are introduced. `State.schemaVersion`, reference parser versions and existing reconciliation rule versions remain unchanged. The only existing runtime file edited is the narrow import/GET branch in `src/server.js`; the other runtime code is in new modules/routes. That shared server change needs serial integration with other workstreams.

## Evidence and economic behavior

- References remain strings with their original value, kind and source. `0599` cannot match `599`. The policy cannot change a bank observation or create OCR evidence. A contradictory explicit invoice reference is preserved and held for REVIEW with no allocation proposal.
- Every current, declared and known original invoice reference reserves ownership, including closed, held, voided and fully credited records. `conflictingInvoiceIds` is separate from exact-number `candidateInvoiceIds`; ambiguous ownership blocks proposals. Invalid/incomplete C1 reservations block the complete snapshot, and supplied C1 BLOCKED decisions are preserved. C4's company-wide reservations are intentionally stricter than C1's proposed separate supplier scope pending the integration decision.
- Original bank payer evidence is kept separately from invoice customer data, manual report relations and optional bank-detail metadata. Conflicting organization identity blocks a proposal; a separately approved third-party relationship remains REVIEW.
- A complete report must conserve the deposit amount and match original count, account, currency, date and shared bank deposit identity. CAMT count/total come from retained XML declarations. Missing counts are never replaced with imported row counts.
- Every report member and every child naming its deposit participate in group completeness. Conflicts in a parent, sibling or historically allocated source propagate to the dependent proposal. Different original document IDs/hashes cannot be treated as one report.
- Only one economic representation is counted. A report can replace its aggregate only as a complete verified group; a manual report link cannot turn retained observations into additional money.
- Safe integer money, active allocations, credits, direction, currency and remaining balances are checked. Partial, excess and multi-invoice proposals remain REVIEW. Exhausted payments, reversals, undo holds and excluded observations remain visible.
- Standalone Node credits follow existing `paymentSign` cashflow and their own settlement history. They are not misrepresented as refunds against an unrelated invoice; new credit proposals remain held.
- The snapshot includes competing records, retained source facts, invoice originals, relationship state, policy and consent context. Revoked or changed evidence invalidates approval. `evidenceValidUntil` also rejects time-expired source evidence without requiring the snapshot hash to change.

## Approval and race boundaries

The pure approval validator checks owner, contract, full snapshot/revision, exact selected proposals, unexpired stored approval, the selected evidence deadlines and already-consumed request IDs. It still returns `writesAllowed: false`. It does not authenticate arbitrary browser JSON, persist approval or consume an idempotency key.

A later authorized consumer must rebuild under Node `BEGIN IMMEDIATE`, or use the existing Sites workspace CAS and current consent fence, then consume a durable unique request ID atomically with allocation and audit. This PR creates no financial writer and cannot race two new allocations. The existing actual persistence race/rollback/idempotency tests are part of the complete regression gates.

## Independent review and reproduced fixes

A fresh independent review found five P2 correctness issues on the intermediate candidate. Each was reproduced before the fix; all were assigned and corrected with regression tests:

| Finding | RED observation | Correction |
| --- | --- | --- |
| Duplicate bank identity did not propagate | Conflicting aggregate or historical payment still allowed a dependent VERIFIED proposal | Common source integrity is checked in reports, ancestors and allocated history |
| Report membership was not closed over parent links | Extra child with another/missing report ID left the declared child VERIFIED | All children of the linked deposit must belong to its declared complete group |
| Approval outlived account evidence | Approval at 12:05 remained valid after evidence expiry at 12:01 | Per-decision dependency expiry and time check |
| Sites original report count was inferred | Removing `Btch` or `NbOfTxs` still yielded VERIFIED | Explicit count/amount reread from retained XML |
| Standalone Node credit settlement corrupted balance interpretation | Valid settled customer/supplier credit blocked an unrelated payment | Existing cashflow direction and separate-obligation settlement normalization |

Additional observed regressions cover modified report payer/reference metadata behind an unchanged file hash, ambiguous/unreadable active account resources, omitted foreign-source allocations, logout during preview hashing, route parameter validation, and C1 policy/reference conflicts. The new source replay uses actual retained synthetic bytes and existing parsers; tests deny provider calls and persistent preview writes.

The later C1 comparison exposed a second invoice's declared/original reference not reserving ownership against an exact number candidate. Shared and real-adapter regression cases reproduced it and now block every affected proposal, including closed/held/credited competitors. A narrow follow-up review also reproduced an incomplete census hidden behind an early C1 BLOCKED/not-applicable/unsupported return. Validation now checks known current, decision and Sites original identifiers before those returns; missing membership sets `complete: false` and globally holds uniqueness. The review's supplier-scope observation is retained as an explicit conservative limitation, not represented as C1 semantic parity. An independent rereview ran the four original synthetic reproducers against the corrected code, confirmed BLOCKED/no proposals, and found no remaining blocker in that narrow follow-up. It did not test cumulative C1/C2/C3 integration. Earlier review findings refer to their intermediate snapshots; final regression receipts below cover the corrected code.

## Verification receipt

The initial implementation's complete local gates passed on Node **v22.23.4**, matching the CI major. The required gates are those in `.github/workflows/payment-control-ci.yml`. The managed local `--test` runner reported only passing file wrappers in some invocations; those wrappers are not counted as named-case evidence. Each complete test-file glob was therefore executed directly in isolated Node22 processes, with its named TAP cases and exit status recorded. The normal real npm executable context was supplied for the installation-entrypoint test. The current-main six-case addition was then executed separately; all previously tested runtime/test inputs were unchanged by that documentation/test-only fast-forward.

GitHub subsequently confirmed the complete initial implementation in [run 41537795349](https://github.com/sharbel0022/Mgeorge/actions/runs/41537795349), testing merge `bb07145a8775689dc8b6d372e258af5fe77b24b2` of head `9f8b6f17c791639bc65f2c4eb018f25eee75f09e` into base `a779b0dd8d184eaf6e6d6e636c555c967f15f3d5`: **1381 Node + 2399 Sites = 3780 passed**, zero failed/skipped/cancelled/todo. Both CI jobs and the Sites production build succeeded. This receipt precedes the C1 follow-up; the final exact-head run is recorded in the PR.

| Initial implementation complete gate | Result |
| --- | --- |
| Root locked install (`npm ci --ignore-scripts`) | Passed |
| Sites locked install (`npm run install:ci`) | Passed |
| Root syntax | 125 JavaScript files passed |
| Complete Node corpus, 70 files | **1381 passed; 0 failed/skipped/cancelled/todo** |
| Complete Sites corpus, 91 files | **2399 passed; 0 failed/skipped/cancelled/todo** (2393 plus the six new-main cases) |
| Combined named-case coverage | **3780 passed** |
| Sites TypeScript check | Passed |
| Exact installed minimatch mitigation | One target verified; zero writes |
| Sites production build | Passed; new `/api/reconciliation/preview` route included |
| Root audit | Zero findings |
| Sites production audit (`--omit=dev`) | Zero findings |
| Full Sites audit / high gate | 16 moderate development findings; 0 high/critical; gate passed |
| Staged whitespace/diff check | Passed |

The build emitted toolchain sourcemap/dynamic-import/timing warnings and completed successfully. No dependency, lockfile, migration or CI change was needed.

Focused evidence after the C1 ownership/census correction:

| Check | Result |
| --- | --- |
| Shared contract corpus | 47 cases in each runtime |
| Additional source/approval integrity cases | 9 cases |
| Combined shared run | 103 passed, 0 failed/skipped/cancelled |
| Node adapter and authenticated route | 24 passed, 0 failed/skipped |
| Sites adapter and authenticated route | 23 passed, 0 failed/skipped |
| New executed regressions across both runtimes | 150 passed |
| Sites typecheck after C1 adapter changes | Passed |

Two local runner interruptions are retained honestly: the existing Node PDF/OCR corpus reached a temporary 240-second harness limit after 198 passing cases, then completed unchanged with **284/284** passes in 334 seconds under a 600-second harness limit; the Sites npm-postinstall case initially failed because the direct-file runner lacked `npm_execpath`, then passed all **12/12** cases with the actual installed npm CLI context. No assertions or repository tests were weakened, and no failing/partial attempt contributes to the final totals. Earlier interrupted baseline runs and file-wrapper-only reports are likewise not counted as successful complete suites.

The follow-up Node HTTP fixture initially hit sandbox `listen EPERM` after 22 passing cases. The unchanged synthetic adapter/route suite was then rerun with localhost permission and passed **24/24** (including its nested route case). This was an environment restriction, not a relaxed assertion or changed financial path.

## Fresh read-only real-case receipt

At 2026-11-02 21:53 UTC, the existing production read-only evidence tools were used for reference `0599`, 625 SEK, date 2026-10-26. No bank-provider fetch, sync, invoice registration, allocation, customer message or payment was triggered.

| Observation | Fresh result |
| --- | --- |
| Exact selected payment-ID reads | Two complete/current reads, `changed: false`, workspace revision 43 |
| Retained report original | Integrity passed; complete/current read; `0599`, 62500 minor units and date 2026-10-26 retained |
| Receiving account proof | Not uniquely verified against current owner consent |
| Report-to-AIS relationship | `targetRelationProved: false` |
| Individual observations | AIS economic; separate report non-economic; individual payer available only in report, not proved to belong to this AIS deposit |
| Exact registered invoice | Complete registry search: zero matches |
| Allocations | Zero; both observations not automatically eligible |
| Broad reference search | Separately incomplete (`referenceSearchComplete: false`); no global completeness claim |

These are checks of the already deployed application, not acceptance of this branch in production. Private original payloads, payer names, account IDs and document hashes are not committed. No mutable fixture uses a real invoice.

## Remaining limits and required production evidence

1. Integrate Agent 1's reviewed company policy at the server adapter boundary, preserving explicit-reference conflicts and complete ownership. Resolve C1/C4 fallback, space, status and customer/supplier-scope differences; until then the GET routes remain blocked.
2. Obtain bank-origin proof connecting the report's receiving account to the selected current account and the report to the specific AIS deposit. Matching amount/date or a manual relation alone does not establish a VERIFIED bank identity.
3. Preserve an individual payment identity, actual payer, valid currency/booking-date facts and complete original report count/total. The real retained XLSX observation cannot be assigned a fabricated bank payment ID or booking date.
4. Register/review the intended invoice through the authorized business flow and establish customer/third-party evidence. No real registered `0599` invoice was found by the complete read.
5. Obtain separate business approval before any real allocation. Approval persistence/execution is outside this read-only PR.
6. Review the C2 retained-proof/freshness boundary and map C3 queue authorization, conflict and completeness into the canonical snapshot before activating those new producer paths. C2's live reader must stay out of the GET preview; C3's production resolver is disabled. The integrator owns the C2/C3 migration-0016 collision and cumulative merge tests.
7. V1 verifies SEK payments only. Sites validates a bounded selected lineage/report group. Unchecked historical sources can hold a balance-dependent proposal. Generic non-report `bank_file` sources remain blocked pending exact financial/payer replay. Node cannot assert environment/application-generation provenance absent from its existing consent schema.

Production-dependent quality scores remain unchanged. The existing complete scorecard is 255/330 (7.73/10), with no claim that this scoped synthetic verification makes all areas 9.5. This PR does not change Sites57, its identity, bindings, secrets or schedules. The integration lead owns cumulative merge tests and any later publication.

## Continuation point

Use the named feature branch and this report, verify its current head/PR checks against current main, then wire only reviewed C1/C2/C3 mappings. Preserve the tests and fail-closed defaults. Run the cumulative Node/Sites gates before serial merge. Do not treat an earlier branch test, this read-only real-case receipt or a manual report link as permission to register or allocate a real invoice.
