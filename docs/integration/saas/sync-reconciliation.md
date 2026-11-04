# Company bank sync and reconciliation — Agent 5

Branch: `feature/saas-bank-sync-reconciliation`. Base: `14a042a` (`main`).
This is the implementation and cross-agent integration contract. Final full-suite
verification and delivery receipts are recorded at the end of this document.

## Scope and activation boundary

Company identity, authenticated actor, storage owner, bank connection, and bank
account are distinct. A job must receive an explicit trusted binding between
them. Node must use an exclusively company-bound financial database; Sites must
use an exclusively company-bound storage owner. No request may choose another
storage owner by submitting a company ID. Missing membership/scope/provider
integration blocks the company path. Existing single-company behavior remains
the legacy path until deliberately bound. A durable binding holds the legacy
automatic path even if the runtime registry has not been restored after restart.

Agent 1 supplies company membership and data-scope resolution. Agents 2/3 supply
current provider authorization and verified background-access policy. Agent 4
supplies the actual company-bound Bankgiro source and its coverage evidence.
Agent 5 coordinates those contracts and reuses the existing scheduler and
financial sinks. No new bank provider is claimed by this branch.

The existing Node financial schema has no company column on every financial
table. This implementation therefore requires one exclusive database per
company. Sites requires one exclusive workspace/storage owner per company.
The authenticated caller is not allowed to supply that storage owner. The
current Sites entrypoint binds its authenticated owner to one company; a future
actor with membership in several companies needs Agent 1's trusted mapping and
dispatcher integration. The shared coordinator already supports many company
scopes, and its tests exercise 100 separate synthetic companies.

No onboarding route, real company enrollment, bank authorization, external
schedule, deployment, or production data migration is performed by this PR.
The concrete runtime adapters support the existing Swedish business Enable
Banking/SEK flow. The provider-neutral coordinator and company policies do not
claim that another provider or report channel has been onboarded.

## Common contract (v1)

The trusted job context identifies `companyId`, `owner` (storage scope),
`connectionId`, `provider`, stable `accountKey`, provider `accountUid`,
`consentId`, `generation`, monotonic `revision`, and `validUntil`.
`accountKey` survives provider UID/consent renewal. Account permission, active
consent, and company ownership must be rechecked at network and write boundaries.

Both concrete bank adapters derive and verify an opaque `accountKey` from the
persisted account's stable identity and bank/country/provider namespace using
`companyBankAccountKey`. A provider session UID is never an account key. Node
exports `nodeCompanyBankAccountKey` for the trusted selector factory. Sites uses
its existing `stableAccountKey` and `canonicalBankAccount` before the common hash.
Changing only UID, consent or generation must not create another quota bucket.
A change of connection identity, bank namespace, or representation from primary
hash to account number requires an explicit reviewed migration; it is not an
automatic alias or permission grant.

Rate policy must have verified provenance and positive integer limits. A
persisted request reservation is consumed before the provider call. An attempt
still consumes its reservation if the response is lost. Renewal must not erase
request history or provider embargoes. No universally valid daily quota is
assumed. All pagination and consent requests are included in the provider
adapter's declared budget contract.

`ratePolicy` has the shape
`{verified: true, evidenceId, maxRequests, windowMs, scope}`; `scope` is
`account` or `connection` (default `account`). The connection scope includes all
selected accounts on that connection. Provider-wide application limits spanning
separate company databases require a verified shared provider limiter from the
provider adapter. Unsupported scope values are rejected. There is no universal
four-calls-per-day constant.

Runtime adapters must expose a fresh context reader and a current-context guard.
`authorizationStatus: 'VERIFIED'` means current permission to read transactions
on this exact company/account, not merely an authenticated actor or an active
provider application. The resolver is responsible for that permission evidence.
The shared coordinator supplies a finite account lease, bounded provider-call
wrapper, and fenced commit boundary. A sink's financial/original writes and its
durable import receipt belong to the same transaction. Provider payloads,
credentials, and bank account numbers are excluded from public job status.

The shared `store.status` method is internal: it includes the import checkpoint.
An eventual HTTP/status projection must select safe fields and must not expose a
provider cursor, raw payload, lease token, session, or credential. Only hashes of
consent/generation authority are kept in the new coordinator tables.

## Durable state and transaction boundaries

Migration `sites/drizzle/0023_saas_bank_sync.sql` is additive and matches the
Drizzle schema and journal. It adds four tables:

| Table | Purpose |
| --- | --- |
| `company_bank_sync_scopes` | Exclusive company-to-owner binding and explicitly versioned reference policy. |
| `company_bank_sync_jobs` | Per-company/account authority, lease fence, attempt history, embargo and successful checkpoint. |
| `company_bank_sync_requests` | Durable reservations for actual provider requests, including failed/lost requests. |
| `company_bank_sync_receipts` | Import identity, original hash and the exact committed result. |

The company/account primary key and conditional SQL claim admit one live writer.
Every financial write is fenced by that lease, its generation, current scope,
current consent and current policy. D1 checks the execution clock inside the
batch; an assertion made before an asynchronous wait cannot authorize a later
write. A terminal status closes the writer before a delayed response returns.

Node wraps the existing synchronous financial importer and its actual result in
one `BEGIN IMMEDIATE` transaction through `batchWork`. Sites places workspace
CAS, originals, audit, bank run, checkpoint and company receipt in one D1 batch.
A crash before commit leaves no accepted import; a lost response after commit
is resolved by reading the receipt. Same identity plus a different hash is a
conflict, never an overwrite. Rejected contradictory input retains the original
and conflict audit without advancing the successful checkpoint or changing the
accepted financial amount.

The runner bounds each provider request and the admitted run stages. Trusted
job discovery, initial context resolution, registration, claim and guard setup
precede that timer; they must use local state or their own bounded operations.
They must not perform unmetered provider calls. The runner passes an abort signal,
rechecks authority after both fulfilled and rejected network waits, and fences
late results even if a provider ignores cancellation. The existing Enable
Banking session is checked before and after pagination and again immediately
before automatic reconciliation, after any awaited enrichment. Account selection,
bank, country, business scope, access and expiry must remain valid. Each actual
session/page request consumes a reservation. A successful one-page Node job
therefore uses four requests: three session reads and one transaction page.
Additional pages and enrichment calls consume their actual reservations.

The provider's [Access schema and session response](https://enablebanking.com/docs/api/reference)
allow `access.transactions` to be omitted. Both company adapters accept this
documented shape only within an already verified transaction-read context; an
omitted field does not grant access. Any present value other than `true` blocks
the read. Mapped expired/revoked-session and denied-account errors remain blocked
even when the existing provider adapter exposes HTTP 400/409 rather than 401/403.
An interactive-user-context requirement blocks unattended access instead of
retrying it as a transient outage.

A known 429 or 503 `Retry-After` is preserved without truncating long waits.
Malformed or explicitly unknown provider waits block automatic retry. A denial
observed while consent is being revoked still records its restriction using the
already reserved request as evidence. New consent does not remove that embargo.
`retry_blocked=1` denotes a configuration block requiring a higher authority
revision; `retry_blocked=2` denotes an unresolved provider embargo that renewal
alone cannot clear. Historical success and accepted originals remain intact.

## Existing schedulers and trusted runtime registration

No new timer or external automation is introduced. Node's existing
`runScheduledSync` invokes `runScheduledCompanyBankSync`, with at most four
workers and 100 selected jobs per batch. Sites' existing `automaticSync` invokes
`dispatchCompanyAutomaticSync` for a bound owner and keeps its owner lock in
addition to the per-account lease. Account checkpoints, rather than a shared
connection timestamp, control Sites multi-account history coverage.

Node orders runnable work by the persisted last attempt, so accounts beyond the
first 100 progress on later ticks and after registration order changes. It
refreshes trusted authority before eligibility, excludes running/blocked/future
jobs, and isolates both company job-discovery failures and individual invalid
selectors. Those failures do not consume another company's runnable slot.

Node setup, from trusted server startup code:

```js
const runtime = await createNodeCompanyBankSyncRuntime({
  db, companyId, owner, evidenceId,
  existingDataCompanyId, // Explicit attestation for first binding of populated DB.
  resolveContext,       // Current membership, consent, account and verified quota.
  assertCurrent,        // Synchronous against this SQLite DB, including authority.
  listJobs,            // Trusted selectors; never arbitrary client authority JSON.
  providerRequest,     // Optional; defaults to the existing Enable Banking adapter.
  enrich,              // Optional, real company-bound Bankgiro integration.
});
await runtime.store.setReferencePolicy(explicitCompanyPolicy);
registerCompanyBankSyncRuntime(runtime);
```

Sites setup, from trusted server initialization:

```ts
registerCompanyBankSyncRuntime({
  jobsForOwner,    // null only for an unbound legacy owner; explicit company jobs otherwise.
  resolveContext,  // Derives current company/storage scope from authenticated owner.
  currentGuard,   // {assert, fence}; SQL fence must share the financial D1 batch.
  enrich,         // Optional real source adapter; absent coverage remains unavailable.
});
```

The trusted integration must create the exclusive scope and explicit reference
policy before scheduling. `resolveContext` and `currentGuard` must read current
server-controlled membership and authority; a boolean or JSON object submitted
by a caller is not such evidence. Runtime registration is process-local and must
be repeated at startup. All coordination, quotas, embargoes, receipts and policy
revisions are durable.

For a bound Sites owner, disconnect/reconnect to the same bank, country and
environment retains the local connection ID. New session and account payloads
are encrypted under that stable ID; account selection is reset and automation
remains off until explicitly re-enabled. Stored retry advice remains. A verified
new authority revision is still required; reconnect is not a quota reset.

Unbound legacy users retain their existing flows. Once bound, legacy automatic
banking and reconciliation cannot act as a fallback when company authorization
is missing. Company-specific controls must use the trusted company dispatcher.
Explicit manual financial decisions retain the existing original, consent,
source, balance and audit rules.
Apply the additive Sites migration before allowing company enrollment. Existing
legacy paths have commit-time unbound-owner fences once that table is present;
live migration concurrent with legacy work is not the activation procedure.

## Outcomes and coverage

| Outcome | Meaning |
| --- | --- |
| `success` | Requested authorized import stages completed and have durable receipts. |
| `partial` | An import committed but requested enrichment or a later stage did not complete. A retry deadline may still apply. |
| `blocked` | Ownership, account, consent, policy, or evidence needs intervention. |
| `retry` | A bounded transient attempt can resume after its persisted eligibility time. |

Previous success and the latest attempt remain separate. A complete AIS fetch
does not establish Bankgiro coverage, an individual payer, OCR, or a paid invoice.
Absent/unverified coverage is explicitly unknown or unavailable. Raw originals
and prior verified allocations are preserved even if later access is revoked.

`coverage` separates AIS coverage from Bankgiro evidence. Its
`paymentDataComplete` is always `false`: a successful job cannot certify that
every bank payment has complete details. If Bankgiro is enabled without an actual
source adapter or coverage, the accepted AIS import remains and the outcome is
`partial`. A trusted `enrich(stage)` adapter must use the same company authority,
wrap each provider request in `stage.request`, preserve source originals and
durable report identities, and return `verified` only for verified actual source
coverage. The existing unscoped Bankgiro path is not silently substituted.
The report adapter must also enforce any independent quota belonging to its own
report provider/channel; an AIS request allowance is not proof of that allowance.

## Reconciliation

Each company supplies an explicit reference policy. Company A may deliberately
use invoice numbers; company B may require a separate explicit OCR; company C
may use another bank/report channel. No M.George fallback policy is copied to a
new company. Exact identifiers retain leading zeroes.

Existing reconciliation and allocation engines remain authoritative for payer,
account, currency, amount, remaining invoice/transaction balances, source
integrity, revisions, and audit. A suggestion is not an allocation. Aggregated
Bankgiro deposits require actual per-payment evidence and a verified report to
deposit relation. Duplicate reports never create extra money. Uncertain matches
leave invoice balances unchanged.

Policy shape:

```js
{
  companyId, owner, revision, companyName,
  mode: 'invoice_number', // or 'ocr'
  evidenceId,
}
```

Policy revisions cannot move backward or change content at the same revision.
For `ocr`, an explicit numeric checksum-valid OCR must agree with preserved
invoice-original evidence; the invoice number is not a fallback. Company
wrappers apply the explicit policy only to customer invoices and the job's
selected account. Sites uses a temporary calculation context and restores the
workspace's stored company settings in its result. Node performs the analysis,
rechecks and allocations inside the existing financial transaction. An async
guard cannot protect a synchronous Node commit and is rejected.

An automatic result must verify original integrity, exact intended reference,
the actual payer/customer, recipient account, currency, payment amount and
remaining balances. Ambiguity, partial/excess amounts without an admissible exact
allocation, aggregate deposits without verified child reports, missing originals,
duplicate report uncertainty and stale policy all hold allocation. Existing
verified manual partial allocations can leave an exact remaining balance; the
remaining automatic payment still needs all ordinary evidence.

## Backup and isolated recovery

Sites snapshots now include 26 durable tables. Exact historical 20- and 22-table
archives remain accepted; they recover with empty company tables and therefore
do not enroll or activate company jobs. New archives validate owner/company
scope, policy identity, job/request/receipt relationships, hashes and checkpoint
receipt coverage before acceptance.

The existing isolated restore tool retains the authenticated source archive
unchanged and writes only `evidence_*` tables. Recovered jobs clear lease token,
expiry and deadline, increment the fence version, and record that transformation
in `receipt.json`. Consumed requests, policies, successful receipts/checkpoints
and provider embargoes survive. A captured pre-recovery lease cannot write;
receipt replay cannot repeat a financial effect. This is an isolated recovery
test, not activation of a live production database.

## Acceptance scenarios and evidence

All new test data, invoice originals, bank entries and provider responses are
synthetic. Tests use real SQLite transactions and D1-shaped batches; fixtures
reject live provider access.

| Requested scenario | Concrete test coverage |
| --- | --- |
| 100 companies, separate accounts and many simultaneous jobs | Shared store and bounded runner tests create 100 isolated scopes/receipts and assert overlapping work with a fixed concurrency ceiling. A real Node adapter test uses 101 separate company databases over five ticks, including restart in a different registration order, a failing 102nd discovery and an invalid selector. |
| Same-account overlap | Conditional claim races, stale lease fences and concrete runtime/legacy owner locks. |
| Provider429 and long waits | Durable known/unknown embargo, 503 two-day delay, restart and consent revision tests. |
| Renewed consent | New authority fences old work while request history, receipts and embargo remain. |
| Revocation during a call or enrichment | Both fulfilled and rejected provider waits recheck authority; no late financial write. A real Node allocation positive control reaches 12,500 cents, while the revoked case retains its exact post-AIS financial/evidence snapshot and allocates nothing. |
| Crash in import and duplicate after restart | Transaction failure injection, receipt failure, lost response recovery and exact replay tests. |
| Wrong account/customer/company and repeated references | Real Node/Sites company wrappers keep scopes and balances separate under explicit A/B/C policies. |
| Partial and excess payment | Held uncertain amounts and an exact remainder after an existing verified partial allocation. |
| Aggregate Bankgiro deposit and two reports | Existing economic-identity/source checks retain one deposit, reject unsupported promotion, and keep uncertain invoice balances unchanged. |
| No actual Bankgiro coverage | Enabled but absent adapter returns partial/unavailable; no complete-payment claim or fabricated per-payer data. |
| Recovery | New 26-table snapshots, historical formats, quota/embargo/receipt preservation and invalidated old lease. |

Primary new suites: `test/company-bank-sync*.test.js`,
`test/node-company-bank-sync.test.js`, `test/company-bank-account-key.test.js`,
`test/company-bankgiro-legacy-binding.test.js`,
`test/company-reconciliation*.test.js`,
`sites/tests/company-bank-sync*.test.mjs` and
`sites/tests/company-reconciliation.test.mjs`. Targeted counts overlap the full
suites and must not be added to them.

## Verified provider documentation

Reviewed for contract design on 2026-11-04:

- [Open Payments consent service](https://docs.openpayments.io/api/consent-service):
  account access, recurring access, validity, and `frequencyPerDay`.
- [Open Payments AIS](https://docs.openpayments.io/api/account-information-service-ais):
  returned accounts are limited by the granted consent.
- [Open Payments scopes](https://docs.openpayments.io/docs/enums):
  `bankgiroinformation` adds enrichment access alongside `accountinformation`.
- [Enable Banking reference](https://enablebanking.com/docs/api/reference) and
  [knowledge base](https://enablebanking.com/knowledge-base): current session and
  accessible accounts are separate from bank-dependent background limits.

These sources do not prove any customer's actual entitlement or complete report
coverage. Production acceptance requires the other agents' integrated contracts
and a separately authorized test against the real provider.

## Verification and delivery

Final local verification on 2026-11-04 used Linux, Node **24.22.1** and npm
**11.9.0**, with the coordinated production/test source frozen. The full suites
use the same file globs as repository CI; local concurrency is bounded to two.
There are **4,958 passing tests**, zero failures, skipped, cancelled or todo:
**1,704 Node + 3,207 Sites + 47 bridge**. This is 225 more cases than the recorded
main baseline of 4,733; targeted suites overlap these totals.

| Gate | Exact local command / result |
| --- | --- |
| Root syntax | `npm run check`: 149 JavaScript files pass. |
| Root tests | `npm exec --call 'node --test --test-concurrency=2 test/*.test.js'`: 1,704/1,704 pass. |
| Root audit | `npm audit --audit-level=high`: pass; zero findings. |
| Sites installed mitigation | `node scripts/minimatch-backport.mjs --check --require-target`: one target, zero writes, verified. |
| Sites types | `npm run check`: pass. |
| Sites tests | `npm exec --call 'node --experimental-strip-types --test --test-concurrency=2 tests/*.test.mjs'`: 3,207/3,207 pass. |
| Sites audit | `npm audit --audit-level=high`: pass; eight moderate development dependency findings, zero high/critical. No dependency or lockfile change in this PR. |
| Sites build | Separate `npm run build`: pass. This builds locally; it does not publish Sites. |
| Bridge syntax/tests/audit | From `bridge/bankgiro`, `npm run check`, `npm test` (47/47) and `npm audit --omit=dev --audit-level=high`: pass; zero audit findings. |
| Whitespace | `git diff --check`: pass. |

The repository's Node 22 PR workflow remains the remote delivery gate. The exact
branch commit and its workflow result are recorded on the PR against `main`;
local Node 24 results are not presented as Node 22 results.

### Review evidence and failed-attempt provenance

Independent review covered shared coordination, company policy, both adapters,
financial commit fences and representative tests. It reproduced a P1 where
remote consent could be revoked during Node enrichment before allocation. The
new pre-reconciliation session check closes that gap. Its independently rerun
regression includes a genuine 12,500-cent allocation control and a revoked case
whose entire post-AIS evidence/financial snapshot remains unchanged. Both cases
make four requests and four durable reservations.

A separate final comparison applied the journal migrations in isolated SQLite
and matched the four new tables, 43 columns, four primary keys and four named
indexes against the ORM and generated snapshot. The prior tables are unchanged;
the snapshot parent and journal indices/tags are consistent. There was no
remaining reproduced blocker in the reviewed scope. This is not exhaustive
production or penetration-test certification.

Earlier attempts are not counted as successful verification:

- The first concurrent Sites dependency install exited 137; the bounded retry
  completed. A root test attempt before shared Sites dependencies were installed
  could not load `xlsx`; the completed baseline then passed 1,565/1,565. An
  interrupted early Sites baseline is not claimed as a completed local baseline.
- A direct `node` invocation passed 3,202 of 3,203 Sites tests but lacked the npm
  execution context needed by the existing minimatch-entrypoint test. Its npm
  context recheck passed 12/12, then the full npm-context suite passed 3,203/3,203.
  Four later optional-access cases are included in the final 3,207/3,207 run.
- After the stable account-key namespace was hardened, three Node fixtures still
  constructed its old representation. That attempt passed 1,687 of 1,704, with
  17 failures. The fixtures now use the canonical adapter helper. Explicit
  denied/malformed-permission cases additionally assert one real session request,
  one durable reservation, no transaction fetch and the authorization error.
  The corrected focused run passed 32/32 and the final full run passed 1,704/1,704.

The independent review's original permission-case passes predated that fixture
correction and are not cited as proof that those cases reached the provider
permission check. The strengthened cases are covered by the final root run.

Remaining production prerequisites are explicit company enrollment/membership
integration, each bank's verified access/budget policy, the real company-bound
Bankgiro source when requested, and separately authorized production acceptance.
No quality score is raised based only on synthetic results. This branch is
delivered by PR against `main`; it is not merged and Sites is not published.
