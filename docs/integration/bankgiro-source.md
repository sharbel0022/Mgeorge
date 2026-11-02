# BankgiroReportSource — proposed contract v1

**Owner:** Agent 3. **Contract:** `mgeorge-integration-v1` / additive `BankgiroReportSource v1` proposal. **Status:** implementation on `feature/mgeorge-bankgiro-auto-ingest`, subject to integration review; no existing shared interface is silently replaced.

This module transports and queues originals. It does not decide whether an invoice is paid. Source authorization is distinct from `BankAccountEvidence` (Agent 2) and `ReportDepositRelationship`/`ReconciliationDecision` (Agent 4).

## Internal source interface

These are application interfaces, not asserted fields of Swedbank or Enable Banking APIs.

```ts
interface BankgiroReportSource {
  id: string;
  mode: 'production' | 'synthetic';
  authorize(input: { owner: string; signal: AbortSignal }): Promise<ReportAuthorization>;
  listReports(input: { owner: string; authorization: ReportAuthorization;
    cursor: string | null; limit: number; signal: AbortSignal }): Promise<ReportPage>;
  fetchReport(input: { owner: string; authorization: ReportAuthorization;
    report: ReportDescriptor; signal: AbortSignal }): Promise<Uint8Array>;
}
interface ReportAuthorization {
  status: 'VERIFIED' | 'REVIEW' | 'BLOCKED';
  owner: string;
  sourceId: string;
  scopeId: string;        // stable bank/contract/account report namespace, never session UID
  generation: string;     // changes on authorization/configuration replacement
  validUntil: string;     // ISO instant
  evidenceId: string;     // retained authorization/transport verification reference
}
interface ReportDescriptor {
  reportId: string;       // immutable bank report/delivery identity inside scopeId
  filename: string;       // .xlsx, .csv or .xml
  sha256: string;         // digest of the exact original bytes; not proof of bank origin
  availableAt?: string;   // delivery time, never a booking-date watermark
}
interface ReportPage {
  reports: ReportDescriptor[];
  nextCursor: string | null;
  nextPollAt?: string;
  missingReportIds?: string[]; // only an explicit source-reported delivery gap
}
```

The adapter must establish report identity and hash from an authorized delivery, downloading internally if its transport does not provide a content digest. It must support replay-safe discovery, retain late deliveries, and reject incomplete/truncated responses. It may not invent a bank identity from filename or amount. No generic URL, SFTP hostname, secret, provider field or undocumented endpoint is accepted from a browser. `id` is a nonsecret application identifier; `scopeId` and pagination cursors are internal and are not exposed by the public status projection.

`createBankgiroIngest({source, store, sink, now?, allowSynthetic?})` exposes `run(owner)` and `status(owner)`. A null source returns an explicit disabled status without provider calls. `allowSynthetic` is false by default and is used only by isolated tests. The source is reauthorized after network waits, and a changed owner/scope/generation or expired authorization blocks import.

The sink contract is `retain({owner, report, bytes, sha256, lease}) -> {documentId}` and `importReport({owner, job, documentId, authorization, lease}) -> {status: 'IMPORTED'|'REVIEW'|'DUPLICATE', importId?: string, paymentCount: number}`. It must re-read retained original bytes, enforce owner/hash checks, and make a repeated import idempotent even after an unknown commit outcome. Lease exposes `assert()`, `fence()` and `write(statements)`; Node additionally has a synchronous commit-time guard. No sink creates an allocation or calls automatic reconciliation.

Both sinks bind the job and original to the current owner/source/scope/generation. Source authorization status and generation, original identity, lease and authorization expiry are checked at the actual database write boundary. A future source configuration/revocation operation **must atomically update the corresponding `bankgiro_ingest_sources` authorization record**; a disconnected credential must not leave a locally VERIFIED generation active. Worker discovery and retry metadata may not restore a blocked or replaced authorization from a cached result. Re-enabling a locally blocked/replaced generation requires an explicit trusted configuration/reauthorization update, with reviewed cursor/scope handling. This is an adapter integration obligation, not a claim that an external bank's revocation can be made atomic with a local database transaction. The existing current AIS account/consent fence independently remains mandatory when Sites promotes a report into an economic deposit relation.

The committed delivery cursor advances only when all reports on the discovered page have a retained original and an accepted import outcome (`IMPORTED`, `REVIEW`, `DUPLICATE`). Discovery receipts survive interruption while the committed cursor remains unchanged. The adapter must replay that page safely until completion. `BLOCKED` and `RETRY` reports prevent the checkpoint from passing them. An accepted `REVIEW` outcome means the original has entered the existing review workflow; it does not assert that a bank relationship is verified.

## Parser and original-model integration

| Format or boundary | Node | Sites |
| --- | --- | --- |
| CSV and camt XML | `parseBankFile` in `src/importers.js`, then existing `storeTransactions` and retained `import_jobs` bytes | `readBankgiroOriginal` → `parseSpecificationBytes` in `bankgiro-parser.js` → existing `specificationPreview` / `applyCommand` |
| XLSX | Existing workbook parser and review-only handling; no invented account, currency or deposit relationship | Existing `bankgiro-xlsx.js` reached through the same specification parser; current account aliases and complete-group checks remain in force |
| Original retention | Owner-tagged `documents` bytes plus existing import originals; `bank_report` document status keeps bank files out of invoice auto-processing | Owner-bound R2 original plus D1 `documents` metadata, exact SHA-256 and readback |
| Financial effect | Existing transaction import/dedup rules; aggregate entries remain aggregates and return a review outcome | Existing report observations and complete conserved parent/child relationships; no invoice reconciliation/search |
| Repeated import after lost response | Existing owned exact-hash import receipt is adopted without re-importing money | Existing `State.imports` receipt is recognized without another workspace mutation |

No existing CSV, XLSX, camt, reference, payer or reconciliation parser is changed by this feature. No format publication is treated as certification of a customer's exact bank profile.

## IndividualPayment v1 mapping

`IndividualPayment` is a projection of existing parser rows and existing transactions; no separate economic table is introduced. Amounts remain integer öre, currency comes from the original, reference values remain strings, and `referenceEvidence`/`referenceParts`, `payerEvidence`, `reportEvidence`, bank payment ID and deposit ID retain their actual source paths.

The exact v1 mapping is below. Optional facts remain absent when absent in the original. This is a documented projection, not a new persisted payment record or an additional financial amount.

| `IndividualPayment` fact | Existing Node field | Existing Sites field |
| --- | --- | --- |
| Booking date | `booked_at` | `date` |
| Amount in minor units | `amount_cents` | `amount` |
| Observed currency | `currency` with original currency evidence | `currency` with original currency evidence |
| Observed payer | `payer`, `payer_evidence` | `party`, `payerEvidence` |
| Observed payment reference | `reference`, `reference_evidence` | `payerReference`, `referenceEvidence` / `referenceParts` |
| Bank payment identity | `bank_reference` and retained bank fields | `bankReference` and retained bank fields |
| Aggregate/deposit relation | Existing aggregate/specification fields and link records | `parentBankReference`, existing `reportEvidence`, `parentId` only after domain proof |
| Original receipt | Retained `import_jobs` ID, `content_sha256`, document ID | `State.imports` ID, `documentId`, original hash |

Transport `reportId` is a report/delivery identity. It must never replace an individual bank payment identity or be used as a report-to-AIS deposit proof. `paymentCount` counts imported individual transaction observations; zero is valid for an aggregate-only or unpromoted Node review report. The two runtimes retain their existing review semantics rather than inventing artificial financial rows to make the counts equal.

- `paymentReference` is the observed `payerReference` and typed reference evidence. A general reference or invoice number does not become bank OCR.
- For M.George's own invoices, intended payment reference equals the invoice number, e.g. `0599`. This policy cannot fill an absent bank reference.
- `original` is identified by the retained document/import ID and SHA-256. A delivery receipt adds transport provenance without rewriting original facts.
- `VERIFIED` requires the relevant original source. Queue success alone is not verified payer, account, deposit relation or reconciliation.
- `REVIEW` includes unlinked report observations and manually reviewed relations. `BLOCKED` includes conflicting identities/hashes, malformed input and insufficient authorization.
- Individual report payments and AIS deposits pass through existing domain duplicate and relationship checks. Agent 4 owns relationship decisions and later evidence rechecks; a completed fetch is not a prohibition on a later domain recheck.

## Integration ownership

Agent 2: consume original account identifiers and authorize aliases only from bank evidence. A source's `scopeId` is a queue namespace, never an account alias or consent.

Agent 4: consume retained originals through the existing parser/domain; `parentBankReference`, actual references and report evidence are untouched. A queue receipt does not assert a verified AIS relationship. Recheck held observations when new bank evidence arrives without downloading the same report again.

Agent 7: review these additive interfaces and persistence changes, coordinate migration naming and backup compatibility, merge in the agreed order and deploy the existing Site only after final gates.

Agent 5: invoke `runBankgiroSource(owner)` in the existing authenticated payment-control/scheduling boundary after reviewing this contract. The new MCP entry point supports a bounded invocation; this branch does not configure a new production Sites schedule. Node adds a report step to its existing one-minute scheduler timer, which is inert when the resolver returns null. Neither a configured timer nor a synthetic run is proof of a real bank delivery.

## Exports, API and persistence

- Shared engine: `createBankgiroIngest` in `sites/lib/bankgiro-ingest.js` and `createBankgiroIngestStore` in `sites/lib/bankgiro-ingest-store.js`.
- Source validation and safe status projection: `sites/lib/bankgiro-source.js`. `resolveBankgiroSource(owner)` in `bankgiro-source-registry.js` currently returns **null for every owner**. No environment toggle or client flag enables the test provider.
- Sites integration: `createSitesBankgiroSink`, `bankgiroSourceStatus(owner)`, `runBankgiroSource(owner)` in `sites/lib/bankgiro-ingest-service.ts`.
- Node integration: `nodeIngestDatabase`, `createNodeBankgiroSink`, `createNodeBankgiroIngest` in `src/bankgiro-ingest.js`.
- Both applications expose authenticated `GET /api/bankgiro/source/status` and `POST /api/bankgiro/source/run`. Run accepts only an empty object; owner, source URL, credentials and force overrides are rejected.
- Private Sites MCP tools: `bankgiro_source_status` is read-only and never contacts the source. `bankgiro_auto_ingest` runs the bounded worker using only server-derived identity. Existing MCP origin, JSON/body-size and authentication rules apply.

Queue job statuses are `PENDING`, `RETRY`, `IMPORTED`, `REVIEW`, `DUPLICATE`, `BLOCKED`. Source-view states are `DISABLED`, `IDLE`, `RUNNING`, `BACKOFF`, `REVIEW`, `BLOCKED`. Public responses expose safe status/counts, next eligible attempt, explicit delivery gaps and bounded job summaries. Projected timestamps use UTC ISO strings; the database retains epoch milliseconds. Internal cursors, authorization generations, scope/account identifiers, original filenames/bytes and credentials are omitted. These enums describe transport/import processing, not `ReconciliationDecision`.

Migration `0017_bankgiro_auto_ingest.sql` and its Drizzle schema/snapshot add:

| Table | Durable fields and indexes | Legacy/default rule |
| --- | --- | --- |
| `bankgiro_ingest_sources` | Composite owner/source key; scope, authorization generation/status, committed cursor, explicit missing-report IDs, next poll, attempt count, sanitized error, update time | Empty table; authorization defaults to REVIEW; no configured source |
| `bankgiro_ingest_jobs` | ID, owner/source/scope/report ID, original SHA-256/filename, availability time, authorization generation, document/import references, state, attempt/retry fields, payment count, creation/update times; owner/report/hash unique index and due/hash/identity lookup indexes | No synthetic jobs are seeded; new jobs start PENDING |
| `bankgiro_ingest_leases` | Owner key, random token, expiry | Transient; never restore an active claim |

Node initializes the same queue DDL once inside its existing database setup and safely reopens an initialized database. Sites applies the generated migration through the usual deployment workflow. `State.schemaVersion` and existing bank/domain types remain unchanged. No package, lockfile, credential, binding or production schedule is changed.

Sites backups now preserve 22 durable tables and validate the queue's original references. Exact historical 20-table snapshots remain accepted without inventing jobs or a source. Isolated restore inventories the three new schema tables and leaves leases empty. Node backups preserve the actual SQLite tables and verify new queue references while accepting historical databases without these tables. Restoring credentials or a queue does not register or activate a production report adapter.

## Researched delivery options — checked 2026-11-02

Enable Banking is the existing AIS provider. Its [Sweden documentation](https://enablebanking.com/docs/markets/se/) explicitly describes limited individual payment details behind Bankgiro batch settlements. Its [API reference](https://enablebanking.com/docs/api/reference/) documents optional transaction details; this is not a verified Bankgiro-report feed. No actual customer-specific detail coverage is established.

Swedbank [Inbetalningar bankgiro](https://www.swedbank.se/foretag/betala-och-ta-betalt/ta-betalt/bankgiro-inbetalningar.html) offers electronic ISO 20022 XML reporting, including available payer details and possibly multiple OCR references per payment. It must be contracted.

[Anslutning Företag](https://www.swedbank.se/foretag/betala-och-ta-betalt/ny-standard-for-betalningar-i-sverige/nya-tjanster-for-filbetalningar/anslutning-foretag.html) documents direct SFTP integration or an already integrated third party for automated report delivery. Direct integration requires the bank's security arrangement. Internet-bank file administration is a separate manual channel.

The [Swedbank MIG index](https://www.swedbank.se/foretag/betala-och-ta-betalt/betala/fakturahantering/betala-via-fil/mig.html) lists camt.054.001.02 Credit and camt.053.001.02 guides. Format publication does not establish transport entitlement or customer-specific granularity. Linked detailed PDFs were not retrievable in this research; the current generic parser is not claimed to be certified against the bank's exact production profile.

Swedbank's [2026 migration notice](https://www.swedbank.se/foretag/betala-och-ta-betalt/ny-standard-for-betalningar-i-sverige.html) states Bankgiro-format support ended on 1 September and reporting moves through the bank in ISO 20022. Do not assume legacy BgMax is an available new automatic Swedbank delivery.

## Production activation dependencies

Real retrieval stays disabled. Missing evidence: the customer's incoming-report agreement, authorized legal entity/accounts/Bankgiro scope, exact report profile and completeness, actual contracted transport and authentication/host verification, replay/retention/rate-limit rules, and a verified end-to-end original receipt. No BankID login robot is implemented.

## Delivery evidence

Implementation paths, exact local test evidence, review findings and remaining gate/production limits are recorded in [Agent 3's delivery report](agent-3-bankgiro-auto-ingest.md). The PR metadata and its exact-head CI checks identify the delivered commit and full verification. Synthetic success does not certify a real bank connection or production scheduler.
