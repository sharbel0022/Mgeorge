# Agent 4: safe reconciliation contract

Status: additive Agent 4 proposal, `mgeorge-reconciliation-v1`, under the released `mgeorge-integration-v1` edition in [README.md](README.md). Initial runtime base: `73662187cddf9a5c504dea9bd8a1288bd929bc51`; final branch base: `a779b0dd8d184eaf6e6d6e636c555c967f15f3d5` after incorporating PR22–24's documentation and six synthetic acceptance cases, with no upstream runtime changes. No integration contracts existed at the initial base. Agents 1–3 own company policy, bank/account evidence and report import respectively. These adapters consume their current equivalents and explicit trusted injection points without guessing provider fields, endpoints or unreviewed Agent 1 exports. Unknown contract versions fail closed. The complete gate receipt is in [agent-4-safe-auto-reconciliation.md](agent-4-safe-auto-reconciliation.md).

## Scope and design

Provide one deterministic, read-only decision projection shared by Node and Sites, with trusted server adapters. Existing ledgers, matchers, importers, schedulers and allocation boundaries remain authoritative. A dedicated GET preview never calls the allocation, import, mail or orchestration entry points. It inventories all bank observations, including pending reports, exhausted payments and observations without invoice candidates. Evidence status, allocation proposal and business approval remain separate.

Alternatives considered: changing both existing matchers would alter unrelated workflows and duplicate new rules; projecting only their `safe` findings would omit blocked observations and hide some manually replaced original references. The chosen additive canonical engine preserves the existing public matchers and their rule versions.

`VERIFIED` means this contract's complete evidence checks support the proposed allocation; it is not a financial write or an approval. `REVIEW` means a business interpretation remains (including a manual report/customer relationship, partial/excess payment or explicit multi-invoice split). `BLOCKED` means required bank evidence, completeness or economic invariants failed. Every response has `mode: 'preview'`, `changed: false`, `writesAllowed: false`, and `approvalRequired: true`.

## Versioned interfaces

All monetary values are integer minor units (öre for SEK). This v1 projection verifies SEK payments only; other currencies remain BLOCKED. Reference values and bank identifiers are strings. The top-level `ReconciliationInput.contractVersion` and each supplied `InvoiceReferencePolicy.version` must equal `mgeorge-reconciliation-v1`. This is an internal application contract, not a bank API schema. Source paths are retained from the existing parsers only.

`buildReconciliationPreview(input): Promise<ReconciliationPreview>` in `sites/lib/reconciliation-contract.js` is the shared entry point. Its input is a complete owner/company-scoped snapshot:

```ts
type Status = 'VERIFIED' | 'REVIEW' | 'BLOCKED';
type OriginalEvidence = {status: Status; source: 'bank_api'|'bank_file'|'bankgiro_file'|'unknown'; id: string; sha256: string; reason?: string};
type InvoiceReferencePolicy = {version: string; companyId: string; invoiceNumberIsPaymentReference: true; preserveLeadingZeros: true; comparison: 'exact'; source: string};
type BankAccountEvidence = {status: Status; ownerId: string; accountId: string; currency: string; source: 'bank_account_resource'|'missing'; proofId: string; validUntil?: string; reason?: string};
type PaymentReference = {value: string; rawValue: string; source: string; kind: string; validity?: string; schema?: string};
type BankTransaction = {
  id: string; bankId: string; accountId: string; amountMinor: number; currency: string; bookedDate: string;
  kind: 'payment'|'aggregate'; economic: boolean; ignored: boolean; duplicateOf: string;
  original: OriginalEvidence; accountEvidence: BankAccountEvidence;
  payerEvidence: object|null; references: PaymentReference[]; referenceIncomplete: boolean;
  parentId: string; reportId: string; reversal: boolean; holdReason: string; conflict: boolean;
};
type IndividualPayment = BankTransaction & {kind: 'payment'};
type BankgiroReport = {id: string; bankDepositId: string; accountId: string; currency: string; bookedDate: string; totalMinor: number; paymentCount: number; paymentIds: string[]; original: OriginalEvidence};
type ReportDepositRelationship = {id: string; reportId: string; transactionId: string; method: 'bank_identity'|'manual_review'; status: Status; active: boolean};
type ReconciliationInvoice = {id: string; companyId: string; number: string; explicitReference: string; customerName: string; customerOrganizationNumber: string; direction: 'receivable'|'payable'; currency: string; totalMinor: number; creditMinor: number; reviewed: boolean; voided: boolean; issuedDate: string; evidenceIssue: string};
type ReconciliationAllocation = {id: string; invoiceId: string; transactionId: string; amountMinor: number; active: boolean; effect: 'payment'|'refund'};
type CustomerRelationship = {id: string; invoiceId: string; accountId: string; payerName: string; payerOrganizationNumber: string; approved: boolean; active: boolean; evidence: string};
type ImportJobStatus = {id: string; status: 'complete'|'pending'|'blocked'; complete: boolean};
type ReconciliationInput = {
  contractVersion: string; ownerId: string; companyId: string; revision: number|string; checkedAt: string;
  complete: boolean; referencePolicy: InvoiceReferencePolicy|null;
  transactions: BankTransaction[]; invoices: ReconciliationInvoice[]; allocations: ReconciliationAllocation[];
  reports: BankgiroReport[]; relationships: ReportDepositRelationship[]; customerRelationships: CustomerRelationship[];
  importJobs: ImportJobStatus[]; evidenceContext?: unknown;
};
```

The existing `payerEvidence` schema is preserved: `origin: 'bank_original'`, `scope: 'individual'`, `name: {value, rawValue, source}`, typed identifiers, organization number and conflict flag. Missing payer facts are never filled from an invoice or manual observation. Reference candidate `value` is compared as an exact string to `invoice.number`; raw values, kind and source remain visible. `0599` differs from `599`. `explicitReference` preserves Node `invoices.reference` / Sites `Invoice.ocr` without normalization. A nonempty value that differs from the invoice number prevents a proposal and adds `INVOICE_REFERENCE_POLICY_CONFLICT` with REVIEW. Numeric references are invalid, not repaired. No candidate becomes formal OCR through company policy.

The server adapter must validate the original and current owner-bound account evidence. A hash or `status: VERIFIED` supplied by a browser is not proof; these functions are not a client-payload ingestion endpoint. `evidenceContext` carries additional authoritative evidence and consent state solely to bind freshness.

## ReconciliationDecision and financial invariants

Each decision exposes `transactionId`, `status`, stable `reasonCodes`, preserved payer/references, `candidateInvoiceIds`, `allocations`, `availableMinor`, `unallocatedMinor`, `bankEvidenceStatus`, and `evidenceValidUntil: string|null`. The last field is the earliest known account-evidence expiry among the selected source, its ancestors/report members, and historical payment sources supporting the candidate balances. Unrelated account expiries do not invalidate an independent decision. Each allocation proposal names invoice, currency, amount, invoice balance before/after and settlement (`full`, `partial`, `excess`, `multiple`). Full matching can be VERIFIED. Partial/excess and multiple-invoice proposals deliberately remain REVIEW in v1 even when their bank evidence is verified.

Balances are derived from all active allocations and credits. Reject malformed/overflowing amounts, duplicate record IDs, conflicting stable bank identities, duplicate active pairs, missing/cyclic ancestors and incomplete reports. Source conflicts propagate through ancestors, complete report groups and previously allocated sources. A report group must match both the original count and total, including every row naming the report or its deposit as a parent. Both adapters reread explicit CAMT `NbOfTxs` and entry amount from retained XML; imported row counts are not original evidence. A VERIFIED bank relationship additionally requires the same stable bank deposit ID, account, date and currency in both original sources. Equal date/amount alone never proves the relationship. An aggregate contributes once; its individually linked children may replace its economic representation only as a complete validated group. The preview never changes that representation. Manual report relations remain REVIEW and cannot promote their rows into economic payments; independent missing evidence can raise the result to BLOCKED.

Canonical invoice direction describes the obligation's cashflow. Node standalone customer/supplier credits invert direction through the existing `paymentSign` rule, and their allocations settle their separate obligation (`effect: 'payment'`). A canonical `refund` instead reverses a payment against the same ordinary invoice. New credit proposals remain held for review; valid separate credit history must not invalidate unrelated invoice balances.

Unmatched, blocked, reversed, ignored and already allocated observations remain explicit. A prior allocation is not bank proof. Undo holds prevent immediate automatic rematching. Multiple payments competing for an invoice are reviewed together, not independently consumed.

## Approval, staleness and concurrency

The output includes `snapshot: {revision, sha256}` calculated from the complete canonical input, including raw evidence, all competing records, policy, customer/report relationships and consent context. Only `checkedAt` is omitted from the hash; validity/expiry is checked against that time. The snapshot is deterministic; arrays retain authoritative input order (a changed order conservatively invalidates old approval).

`validateReconciliationApproval(preview, approval, context)` is a pure admissibility validator. It requires a trusted stored business-approval record with matching contract version, owner, revision, snapshot hash, exact selected transaction/invoice/amount/currency proposals, request ID and unexpired validity. It rejects already-consumed request IDs, a check time before the preview, and a selected decision whose `evidenceValidUntil` has passed even when the revision/hash and approval expiry are unchanged. Its result still has `writesAllowed: false`: it is not an execution API, signature or proof that a browser's claimed approval is authentic.

No new production allocation endpoint is introduced. A future authorized writer must re-read and rebuild the preview under Node `BEGIN IMMEDIATE`, or use the Sites workspace revision CAS plus existing `writePaymentState` consent fence, and consume a durable unique request ID in the same transaction as allocation and audit. A pure hash validator cannot provide locking or one-use persistence. Existing lock, atomic rollback, idempotency and consent-race suites remain required integration gates.

## Adapter and API ownership

- Node: `src/reconciliation-preview.js` exports `readReconciliationPreview(db, {owner, transactionId?, referencePolicy?})`; route `GET /api/reconciliation/preview` is authenticated and read-only.
- Sites: `sites/lib/reconciliation-preview.ts` exports `readReconciliationPreview(owner, state, revision, transactionId, options?)`; route `GET /api/reconciliation/preview?transactionId=...` uses the existing owned stored-original checks. It makes no bank/provider call.
- Both accept an explicit trusted server `referencePolicy` option. There is no company-name fallback, client policy parameter, new policy storage or guessed Agent 1 export. Missing policy yields `REFERENCE_POLICY_REQUIRED` / BLOCKED. The new GET routes therefore remain held until the integrator wires Agent 1's reviewed company-bound projection. Positive synthetic adapter tests pass an explicit server fixture policy.
- Agents 2/3 should map their versioned bank/account/report results to the interfaces above. A missing original count, alias, report/deposit ID or complete snapshot remains blocked. No provider endpoint or account alias is invented.

Sites validates a bounded selected lineage/report group, replays each covered report as an exact multiset from owned retained bytes and verifies workspace revision after the read. Its global status may be BLOCKED while `selectedStatus` is VERIFIED under an injected policy. Unrelated sources remain unverified; an unresolved historical allocation source can consequently hold a balance-dependent proposal. Generic non-report `bank_file` sources remain blocked until a complete payer/financial replay adapter exists. Node reads its available sources under one SQLite read savepoint and rechecks session authorization after asynchronous hashing. Node's persisted consent schema lacks environment/application-generation fields; the adapter does not invent that stronger provenance.

No tables, migrations, dependencies, provider APIs, existing reconciliation rule versions or `State.schemaVersion` change. Proposed consumers are C5 orchestration and C6 overview; neither is silently rewired by this PR.

## Real 0599 acceptance boundary

The task specifies reference `0599`, 625 SEK, date 2026-10-26. Fresh read-only production evidence was obtained on 2026-11-02 at 21:53 UTC from the existing private `payment_evidence` and `retained_report_evidence` readers. Both selected payment-ID reads were complete, current and unchanged at workspace revision 43. Retained-report integrity passed, the report row preserved `0599` and 62500 minor units with date 2026-10-26, but the target deposit relationship was not proved and the receiving account was not uniquely verified against current owner consent. The AIS observation had no individual payer/reference; the separate report observation was non-economic. The complete invoice registry search found zero exact registered matches and there were zero allocations. The broader reference search separately reported `referenceSearchComplete: false`; this is not represented as a globally complete search.

These are observations of the already deployed application, not a production deployment/test of this branch. Original names, bank account identifiers, hashes and payloads are not committed. Synthetic write fixtures are artificial and isolated. No real invoice was registered, allocated, sent or used as a mutable fixture.

Production still requires original bank evidence connecting the report's receiving account to the selected AIS account, stable shared deposit identity (or a clearly separate manual review), individual payer/customer evidence, a registered and business-reviewed invoice, and separate authorized allocation approval. Publication and merge are owned by the integration agent.
