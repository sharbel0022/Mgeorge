# MG Fakturakoll — shared integration contract

Contract edition: **`mgeorge-integration-v1`**. Runtime architecture baseline:
**`73662187cddf9a5c504dea9bd8a1288bd929bc51`** (PR #21).
This document is introduced through a separate contract PR. Its reviewed head and
merge commit are recorded in `../SEVEN-AGENT-INTEGRATION-REPORT.md` after merge;
an unmerged proposal is not a released implementation.

## Scope and source of truth

The six new workstreams extend the existing application. PR #14–19 and the
acceptance/deployment receipts #20–21 belong to the previous delivered round;
their presence does not demonstrate delivery of the new six assignments.

The authoritative implementation is the code at the baseline above. The useful
system models are [payment verification](../PAYMENT-VERIFICATION-ARCHITECTURE.md),
[architecture](../ARCHITECTURE.md), and [the previous integration report](../SIX-PR-INTEGRATION-REPORT.md).
Older prose is historical where it conflicts with current code: durable job
coordination, for example, already exists in `src/integration-jobs.js`.

There are two existing runtimes, with separate data stores:

| Boundary | Node installation | Existing Sites installation |
| --- | --- | --- |
| API and identity | `src/server.js`, authenticated administrator/principal | `sites/app/api/**`, server-derived ChatGPT owner |
| Ledger and persistence | `src/db.js`, SQLite transactions | `sites/lib/domain.ts`, `sites/lib/server.ts`, owner-bound D1 workspace revision/CAS |
| Originals | Retained document/import bytes and hashes in SQLite | Owner-bound R2 objects, D1 metadata and arrival receipts |
| Bank provider | `src/bank.js`, `src/bank-sync-state.js` | `sites/lib/banking/{service,transactions,store,sync-periods}.ts` |
| Reconciliation | `src/reconciliation.js`, existing allocation boundary | `sites/lib/reconciliation.ts`, `reconciliation-engine.js`, `domain.ts` |
| Bankgiro report parsing | Existing importers and shared parser helpers | `sites/lib/{bankgiro-parser,bankgiro-xlsx,bankgiro-deposit-identity}.js` |
| Jobs | `integration_jobs`, `createIntegrationJobs` | Existing bank/Gmail locks and run receipts, `document_jobs`, payment-control receipts |

Do not create a second bank, invoice, reconciliation or scheduler engine. Node
also imports helpers under `sites/lib/`; a `sites/`-only diff can change Node.
Keep the existing Site identity, `DB`, `BUCKET`, authentication, runtime secrets
and configured schedules. A GitHub merge is not a Sites deployment.

## Existing data fields and their meaning

Field names are wire/storage names, not interchangeable synonyms. This table
does not rename existing fields or declare new migrations.

| Meaning | Node | Sites | Required interpretation |
| --- | --- | --- | --- |
| Invoice identity | `invoice_number` | `Invoice.number` | String; `0599` stays `0599` |
| Intended invoice payment reference | `invoices.reference` | Legacy `Invoice.ocr` | Legacy storage does not prove formal OCR classification; new policy metadata must preserve explicit values |
| Observed payer reference | `bank_transactions.reference` | `Transaction.payerReference` | Source-bound bank value; never fill it from an invoice or policy |
| Stable bank record reference | `bank_reference` | `bankReference` | Bank identity, not the invoice's payer reference |
| Provider detail lookup ID | `provider_transaction_id` | Retained `bankData.transaction_id` | May change across fetches; not a substitute for stable deduplication identity |
| Derived stable transaction identity | Existing fingerprint/stable bank identity | `externalId` derived from stable account and original entry reference | Distinct from the provider's temporary lookup ID |
| Invoice direction | `customer` / `supplier` | `receivable` / `payable` | Preserve explicit runtime mapping; never infer direction from names |
| Account | `account`, `reported_account`, selected connection account | `account`, `recipientAccount`, selected owner account resources | Reported text and authoritative current account aliases are separate evidence |
| Amount | `*_cents` | `total`, `amount`, allocation amounts | Safe integer minor units (öre); SEK, direction and sign rules preserved |
| Dates | `issued_at`, `due_at`, `booked_at` | `issued`, `due`, `date` | Valid calendar `YYYY-MM-DD`; new projected instants use UTC ISO strings. Preserve and explicitly convert existing SQLite timestamps and epoch milliseconds. |
| Invoice status | Derived from allocations and checks | `invoiceStatus`, `paid`, `balance` | Candidate/reference similarity cannot mark an invoice paid |
| Reference evidence | `reference_evidence`, retained reconciliation data | `referenceEvidence`, `referenceParts`, retained original | Raw value, kind, path and conflicts retained |
| Payer evidence | Shared typed payer extraction | `payerEvidence`, bank original/details | Actual bank statement, verified relationship and suggestion remain distinguishable |
| Original integrity | `content_sha256`, `raw_bank_data_sha256` and versions | Document hash, `bankDataSha256`, `bankDataVersion`, `bankFileProof` | Hash proves integrity of retained representation, not independent bank authorization |
| Report review/link | `bank_specification_links`, manual verification | `bankgiroLinks`, `method: 'manual_review'` | Metadata relation; no additional money and no automatic promotion to bank identity |
| Financial allocation | `allocations` | Active `Allocation` records | Existing atomic currency/direction/balance/consent checks remain mandatory |

`extractPaymentReferences(raw, {sourcePrefix, profile})` currently produces
candidates with `value`, `rawValue`, `source`, `kind`, `priority`, `validity` and
optional `schema`. Existing kinds are `ocr`, `invoice`, `structured`, `message`.
An invoice-number payment reference can be valid business intent without being
formal OCR. `validateOcrAgreement` checks supplied rules; it does not establish
that a bank agreement exists.

### Non-negotiable financial and evidence rules

1. Keep identifiers as strings. No `Number`, `parseInt`, zero padding, checksum
   repair, truncation or lossy normalization may turn `599` into `0599` or make
   the two equal. Preserve raw source text alongside permitted normalization.
2. An explicit invoice reference takes precedence over policy derivation. A
   contradictory explicit reference is a review condition, not a value to erase.
3. Company intent may derive an intended invoice reference; it may not rewrite
   any bank observation or convert a generic reference into bank-declared OCR.
4. Candidate search and manual original links change no financial balances.
   A name or amount match alone is not payer/account/deposit evidence.
5. Count one economic deposit once. Review-only reports and linked originals
   are not additional money. Promotion/splitting requires complete conserved
   amounts, current account proof and common explicit bank entry/deposit
   identifiers, with the existing date/currency/count/sum checks. The
   `bankgiroDepositIdentity` reservation key or `report_key` prevents reuse;
   neither proves a report-to-AIS relationship or a payer's identity.
6. Recheck owner, consent, selected account and workspace revision at the actual
   write boundary. A stale lease or response cannot commit after revocation.
7. Replay by report identity, original content hash and stable bank identity must
   be idempotent. Conflicting repeated identities must stop for review.
8. Retain existing allocations and originals when evidence becomes unavailable;
   disclose the evidence issue and prevent new unsafe actions.
9. Jobs may retry safe steps, but must not repeat a committed financial effect
   after an ambiguous response. Keep durable receipts, fences and bounded retry.
10. Every write test uses isolated synthetic data. Real case `0599` is read-only
    in this integration; invoice registration/allocation needs separate approval.

## Existing API contract

These are the existing consumers to preserve. New fields must be additive and
old callers must continue to receive the meanings above.

| API/service | Existing contract and owner |
| --- | --- |
| Sites `GET /api/state` | Owner-bound workspace state, revision and audit. Do not supply another owner from the client. |
| Sites `POST /api/state` | Existing command/revision boundary; verifies original/consent/CAS and writes audit atomically. `bankgiro.link` and `bankgiro.unlink` are metadata-only. |
| Sites `GET /api/bank/status` | Existing connection/sync status; connection, last successful run and schedule execution are different facts. |
| Sites `GET /api/bank/verification?transactionId=…` | Existing read-only payment-verification projection with workspace revision. Opening details does not initiate sync/reconciliation. |
| Sites `GET /api/bank/invoice-candidates` | `{candidates: Record<transactionId, BankInvoiceCandidate[]>}`; proposals only. |
| Sites `/api/bankgiro/preview` | POST previews a file; GET previews a retained original. Preserve existing review, original and owner checks. |
| Sites `POST /api/bankgiro/invoice-search` | Existing search can fetch additional Gmail data. It is not a read-only candidate endpoint and must not be called during read-only production acceptance. |
| Sites `/api/payment-control/[action]` | Existing run/status/step coordination; extend its steps without a second orchestration loop. |
| Node existing bank/import/overview routes | Keep existing response/storage conventions; use existing import, `createIntegrationJobs`, reconciliation and allocation functions. Document exact new routes in the owning PR. |
| Private MCP `payment_evidence`, `retained_report_evidence` | Read-only stored evidence; no bank fetch or mutation. |
| Private MCP bank/Gmail/processing/reconciliation tools | Existing authenticated mutation boundaries. A new status reader must not call a write tool. |

`BankInvoiceCandidate` currently carries `documentId`, `invoiceId`, `number`,
`party`, `amount`, `issued`, `needsReview`, `source`, `reason`, optional
`identifiers`, `matchedFields`, `extractionSource`, `referenceConflict`.
`document_jobs` extraction is authoritative as a whole over older Gmail
metadata. Do not merge missing current fields with stale extracted values.

## New integration contracts: required semantics, implementation proposals

The following are new additions or extensions of existing capabilities. The
persisted company policy (C1) and authorized automatic report source (C3) do
**not** exist in the baseline; AIS, candidates, jobs and the overview already do.
These workstream contracts do not claim their new changes have shipped. The
owner must document its exact
type names, fields, paths, endpoints and migration in a PR under this directory.
The integration lead approves that concrete mapping before downstream merge;
consumers must not guess an unreviewed export or silently change its meaning.

### C1 — company payment-reference policy (agent 1)

The policy is scoped to the authenticated company/workspace. It must declare a
version, its mode (explicit-only or invoice-number-derived intended reference),
and the rule's provenance. Policy derivation applies to an invoice only when an
explicit contradictory reference is absent. Project the intended reference as
a string with its source (explicit or policy), classification and policy version.
Preserve existing invoice fields and raw originals. Legacy workspaces without a
policy retain conservative existing behavior. Formal OCR classification needs
separate explicit agreement/rule evidence. No global company-name heuristic.

Agent 1 owns the exact additive storage/type proposal; agents 4 and 6 consume
its reviewed projection. It must cover `0599`, `599`, a conflicting explicit
reference and a numeric input that has already lost source zeroes. Carry the
metadata through extraction, review, registration, export and restore; inspect
`src/invoice-review.js` and `sites/lib/document-processing.ts` as consumers.

### C2 — AIS source adapter (agent 2)

Reuse the current Enable Banking connection, selected account, original receipt,
normalizer and deduplication. Preserve bank source fields and paginated period
checkpoints. A checkpoint advances only after all required pages and durable
imports succeed. Retry-After, expired consent, malformed booked rows and stale
workers must retain their existing fail-closed behavior. AIS availability does
not establish access to a Bankgiro report product.

### C3 — `BankgiroReportSource` (agent 3)

Provide an adapter into the existing report parser/original/import workflow.
The exact method signatures belong in agent 3's reviewed contract PR. Every
source result must supply or allow the importer to derive the following facts:

| Fact | Contract |
| --- | --- |
| Source authorization | Server-bound owner, configured source identity and account scope; never an arbitrary client URL/account |
| Availability | Distinguish not configured, authorized/ready, transient failure and permission/consent block; missing source is not successful empty ingestion |
| Report identity | Stable source/report identity, distinct from an AIS deposit ID; same identity with changed bytes is a conflict |
| Original | Bounded bytes, filename/media type and receipt time; retain bytes and calculate/check SHA-256 before financial interpretation |
| Pagination/checkpoint | Bounded batches and durable cursor; advance only after original retention and idempotent import commit |
| Account/deposit facts | Preserve explicit identifiers and source paths; require current-account proof plus common bank entry/deposit identifiers and complete date/currency/count/sum validation. Report hashes, `report_key` and `bankgiroDepositIdentity` are dedup/reservation keys, not report-to-AIS proof. Never infer aliases. |
| Result | Imported/duplicate/review/blocked counts, safe reason and retry timing without exposing tokens, bank accounts or original payloads in status |

No browser download bot, credentials collected by the UI, guessed bank endpoint,
or invented production authorization. A synthetic adapter verifies the internal
boundary. Real fetching remains blocked until a bank-authorized source is
provided. Exporting a report manually remains compatible with the same parser.

### C4 — safe candidates and matching (agent 4)

Use C1 for intended invoice reference and existing typed bank evidence for the
observed reference. Return exact candidates with reasons/conflicts. Preserve
candidate versus allocation semantics. Actual allocation continues through the
existing current-original/account/consent/identity/balance boundary. Missing
bank proof, conflicting references, multiple payers, ambiguous invoices or
revoked evidence must not become a green automatic decision.

### C5 — durable jobs and orchestration (agent 5)

Compose C2/C3/C4 through the existing job/run/lock systems. Job identity includes
the applicable owner/source scope. Define durable deduplication, claim, lease,
fencing, completed-step receipts, retry/backoff/Retry-After and restart behavior
in the PR. Reuse existing schedules; a configured scheduler is not a completed
run. No real financial reconciliation is triggered as a deployment test.

### C6 — payment overview (agent 6)

Consume the reviewed projections above in the existing black/white interface.
Preserve the four overview totals and primary action **Kontrollera alla
betalningar**. Show invoice number, intended reference, observed bank reference,
verified payer when available, source/review status and actionable source/job
blocks. `0599` is not labelled valid formal OCR merely because company policy
uses the invoice number. Do not duplicate matching or allocation rules in UI.

## File ownership and shared-change review

| Workstream | Primary responsibility | Shared dependencies requiring integration review |
| --- | --- | --- |
| 1 | Company reference policy, reference projection and mirrored regression tests | Invoice models, `payment-references.js`, extraction, settings and UI types |
| 2 | AIS acquisition, period recovery, bank status and source receipts | Bank normalizer, connection store, import boundary and jobs |
| 3 | Authorized Bankgiro source adapter, retention, ingestion and cursor | Existing report parsers, original store, bank account proof and C5 |
| 4 | Exact candidate search, matching and evidence explanation | C1/C2/C3, reconciliation engine and allocation boundary |
| 5 | Durable job claims, retries, concurrency, recovery and control step wiring | Existing Node jobs, Sites bank/Gmail/document/payment-control services |
| 6 | Black/white overview, fields, source/job state and accessibility | C1/C4/C5 projections and existing components/API responses |
| 7 | Contracts, PR review, conflict resolution, cumulative tests and publication | No independent replacement domain engine |

High-collision files: `src/server.js`, `src/db.js`, `src/reconciliation.js`,
`public/app.js`, `sites/lib/domain.ts`, `sites/lib/server.ts`,
`sites/app/api/state/route.ts`, `sites/lib/reconciliation.ts`,
`sites/lib/payment-control.ts`, shared parser/reference/payer helpers and the
overview components. Treat `domain.ts` as both types and the financial engine.
Use separate small modules where appropriate; do not weaken the write boundary
to avoid a merge conflict. The integrator sequences shared-file changes.

Each delivery adds `docs/integration/agent-N-<topic>.md` with baseline SHA, exact
exports/endpoints, persistence fields, default/migration rules, consumers,
modified shared files, synthetic tests, limitations and dependencies. PR comments
and these files are the inter-conversation communication channel. Branch names
and an agent's prose are not a delivery: a reviewed commit and tests are needed.

### Version and merge rules

- Existing `State.schemaVersion` stays `1` unless a reviewed migration changes it.
  Additive optional fields need explicit safe legacy defaults and round-trip tests.
- Reference extractor version is currently `payment-references-2026-11-01.1`;
  `payment-references-ais-null-schema-v1` is a separate opt-in compatibility profile.
  Node and Sites reconciliation rule versions currently differ; do not claim
  byte-identical implementations or change versions just to manufacture trust.
- Contract semantics/enum/required-field changes require a PR before dependent
  merges, with both-runtime tests and consumer migration. Bump the contract major
  for incompatible meaning; document additive changes as a new edition/minor.
- A newer integrity/parser version never upgrades old evidence automatically.
- Freeze head SHA, base SHA, file list, CI and reviewer result for every PR.
  Re-read them immediately before merge; changed heads invalidate approval.
- Merge normally, one PR at a time; never force-push. Verify the exact resulting
  main CI before the next merge. If main moved, rebuild the integration candidate
  and rerun affected checks. Preserve both sides' tests and evidence.
- Suggested dependency order: contracts → C1 → C2 → C3 → C4 → C5 → C6, adjusted
  only for actual reviewed dependencies. Independent changes may be prepared in
  parallel, but main merges and Sites publication are serialized.
- Required gates are `.github/workflows/payment-control-ci.yml`: locked installs,
  root syntax/tests/audit, Sites exact mitigation/typecheck/tests/audit/build.
  Report extra lint debt and moderate dev findings separately from passed gates.
- Publish the exact integrated `sites/` tree to the same existing Site only when
  required gates pass and relevant code changed. Record backup/rollback, source
  commit/tree, saved version, deployment, bindings and read-only acceptance.

## Integrated acceptance contract

Use isolated synthetic invoice `0599` and typed intended reference `0599` → AIS
observation → authorized synthetic `BankgiroReportSource` → retained original →
individual payment → current account/stable deposit proof → exact reference →
safe invoice candidate → existing payment overview. Exercise a valid complete
case and all blocked cases below, including state conservation assertions.

| Scenario | Required outcome |
| --- | --- |
| No authorized report source | Explicit blocked/not-configured status; no fabricated report or success |
| Wrong/missing account alias or changed consent | No promotion/allocation; raw identifiers retained |
| Multiple payers or incomplete group | Correct individual evidence only when the full group conserves the deposit; otherwise review |
| Lost leading zeroes (`599` versus `0599`) | No exact match or reconstructed bank reference |
| Invoice reference falsely labelled OCR | Classification remains source/rule-based; no checksum bypass |
| Same report twice or same bank transaction twice | One financial effect; durable duplicate receipt |
| Same identity with conflicting original | Explicit conflict/review; no replacement of accepted financial facts |
| Concurrent scheduler/manual workers | One claim/commit; stale worker cannot overwrite winner |
| Failure before/after commit and restart | Safe resume; completed effects not repeated; cursor not advanced past failure |
| Candidate/UI read | No allocations, no balance changes and no provider fetch |

Tests of the new adapter chain cannot be claimed until its implementation is
delivered. Existing component tests and previous cross-flow tests remain useful
baseline evidence but do not substitute for that complete new chain.
