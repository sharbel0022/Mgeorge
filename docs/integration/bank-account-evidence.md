# BankAccountEvidence v1 — Agent 2 integration contract

Status: additive contract proposal on `feature/mgeorge-swedbank-account-evidence`; merge and production migration belong to the integrator. Runtime baseline: `73662187cddf9a5c504dea9bd8a1288bd929bc51`. Updated integration base: `12c9868606a0a45b31b722ddee8f897541687e64` (PR #22 contracts and PR #23 documentation/synthetic tests; production code unchanged). This is the concrete C2 proposal under [mgeorge-integration-v1](README.md).

## Scope and ownership

Agent 2 owns Enable Banking/Swedbank access, booked AIS retrieval, current account identity and operational throttling. This change does not register invoices, create report/deposit relationships, allocate payments, send mail, initiate payments, renew live consent or publish Sites. All development verification uses synthetic bank responses and originals.

The authoritative exported type and projector are in `sites/lib/banking/account-evidence-contract.ts`:

```ts
type BankAccountEvidenceStatus = 'verified' | 'review' | 'blocked';
type BankAccountEvidence = {
  schemaVersion: '1.0.0';
  scope: 'recipient_account_identity';
  status: BankAccountEvidenceStatus;
  checkedAt: string | null;
  transactionId: string | null;
  documentId: string | null;
  workspaceRevision: number | null;
  reasonCode:
    | 'ACCOUNT_IDENTITY_VERIFIED'
    | 'ACCOUNT_ALIAS_MISSING'
    | 'EVIDENCE_STALE'
    | 'EVIDENCE_AMBIGUOUS'
    | 'EVIDENCE_INCOMPLETE'
    | 'PROVIDER_EVIDENCE_UNAVAILABLE'
    | 'INVALID_ACCOUNT_EVIDENCE';
  source: 'enable_banking';
  aliases: {
    reportRowIndex: number;
    scheme: 'IBAN' | 'BBAN' | 'CPAN';
    sourcePath: string;
    reportSourcePath: string;
  }[];
  bankgiroMapping: {
    status: 'blocked';
    reasonCode: 'PROVIDER_MAPPING_UNAVAILABLE';
  };
  paymentReconciliationAllowed: false;
};
```

Transport spelling is lowercase. It maps to the team's evidence levels `VERIFIED`, `REVIEW`, `BLOCKED`, with identical semantics. The current account reader emits only `verified` and `blocked`. `review` is reserved for a separately defined manual provenance contract; missing evidence is never automatically promoted to review or verified. A supplied `manualRelationship` property cannot upgrade an account.

### Existing endpoints and compatibility

`POST /api/bank/account-evidence` and MCP `bank_account_evidence` retain their input selectors and all legacy output fields/statuses. Successful reader envelopes now additionally contain `bankAccountEvidence`. Legacy `status:'matched'` is separate from `bankAccountEvidence.status:'verified'`.

The existing authorization rules remain: same-origin authenticated UI action, current owner/workspace revision/report selection, or a strictly bounded MCP request naming an owned transaction and exactly one owned document ID or SHA-256. Callers cannot choose the owner, account UID, provider endpoint, credential, request headers or force-refresh behavior.

`changed:false` continues to mean that financial state, account facts and originals are unchanged. A new `operationalStateChanged` flag reports retained operational changes, such as a cooldown or unresolved request marker; a normally completed request restores its temporary marker. The reader now acquires the existing owner bank lease, so its MCP annotation is explicitly `readOnlyHint:false`; its description explains the operational writes. Other read-only evidence tools are unchanged. A busy bank lease returns HTTP 409 with blocked evidence. Lease loss during a read also blocks evidence and preserves the actual provider-contact flag, including in the bounded error envelope.

This is an additive proposal for the integrator. No other agent's `InvoiceReferencePolicy`, `BankTransaction`, `BankgiroReport`, `IndividualPayment`, `PaymentReference`, `ReportDepositRelationship`, `ReconciliationDecision` or `ImportJobStatus` is redefined here.

## What a verified result proves

Every positive result requires all of the following:

1. An owned AIS transaction with an intact retained bank original and arrival checksum, plus an owned report with verified retained bytes.
2. A current production application/consent, matching owner, application generation, bank, country, business PSU and selected SEK account.
3. The exact saved/live consent account membership, including unselected accounts that could carry the same alias.
4. Current account-details resources for the complete census: at least one and at most five resources. More resources or more than 50 report rows make the result incomplete.
5. Exact primary identity continuity and currency, with an unchanged consent/workspace snapshot under the owner lease.
6. Exactly one matching resource for every report account. Only formatting whitespace/hyphens/case is normalized. Digits, clearing-number length and leading zeros remain significant.

Allowed alias paths are `account_id.iban`, `account_id.other.identification`, and `all_account_ids[0..49].identification`. A primary IBAN path must use scheme `IBAN`. Aliases carry source paths and report row indexes; no complete bank account numbers, provider UIDs, raw resources or credentials are exposed in the projection.

When the original account has no explicit number, the provider's exact singular `identification_hash` may bind a currently returned typed BBAN/CPAN/IBAN to that same account. Arbitrary overlap in plural `identification_hashes` is never used. A conflicting prior explicit identifier is not overridden by hash continuity. A missing identifier is never derived from an IBAN, UID, company name, invoice number or transaction text.

The result is a transient observation bound to the returned timestamp, transaction, document and workspace revision. It is not a reusable signature or a client authorization token. Consumers must trust the authenticated server response, retain its exact context and revalidate current server evidence before any later financial operation. This PR does not save aliases into the connection's account facts or change existing report-link/allocation authorization.

## Coordination with Agent 3: reports and recipient accounts

Use `aliases[].reportRowIndex` and `reportSourcePath` to associate the verified account identity with the exact retained report row. Keep the original report account string and its field provenance. Do not turn `BGNR` into `BBAN`, compare identifiers without their scheme, strip leading zeros, or calculate a domestic account from an IBAN.

`bankgiroMapping.status` remains `blocked`. The public provider schema can represent `BGNR`, but this branch has no observed bank-supplied mapping for the real account. This is deliberately separate from a verified match of the report's explicit recipient account.

Account identity does not prove that a report and AIS row are the same deposit. Agent 3 must retain its own original integrity, deposit identity, amount/currency/date/count and duplicate reservation checks. A manually supported report relation remains `REVIEW`; AIS and report observations must still count as one economic payment when properly related.

## Coordination with Agent 4: verification and reconciliation

Only `bankAccountEvidence.status === 'verified'` within its current authenticated context satisfies the account-identity step. All other results block that step. Never infer bank verification from HTTP 200, legacy `matched` alone, a stored old result, a user label, or a manual report relationship.

`paymentReconciliationAllowed` is always false: this result alone grants no financial permission. Bankgiro mapping, same-deposit evidence, actual payer, invoice/reference policy and allocation remain separately checked. M.George's expected invoice/payment reference equality does not populate a missing bank OCR field.

The existing UI continues to accept the legacy fields. Agent 4 may use the versioned reason codes and `retryAdvice` to explain blocking. For unknown/manual cooldowns, do not recommend automatic account-detail retry; the backend rejects it even if a generic transaction-sync fallback has elapsed.

## Durable account-read cooldowns

Migration `0016_agent2_account_read_guard.sql` adds one field to the existing `bank_connections` table:

```sql
account_evidence_retry TEXT NOT NULL DEFAULT ''
```

The Drizzle schema, journal and generated snapshot accompany it. No new table, package, account credential or environment variable is required. The integrator must apply/reconcile this migration before running the new code; a missing/unreadable guard fails closed for account reads. If another PR also allocates migration 0016, coordinate migration numbering/journal/snapshot before merging.

The field contains either an empty string (no recorded cooldown) or bounded JSON:

| Status | Fields | Account-details behavior |
| --- | --- | --- |
| `known` | `checkedAt`, `notBefore`, `provenance: retry_after_seconds` or `retry_after_http_date` | Block until the explicit deadline, also respecting the generic connection wait. |
| `unknown` | `checkedAt`, `provenance: retry_after_missing` or `retry_after_invalid` | Remain blocked; the six-hour background fallback is not evidence of a provider reset. |
| `manual_block` | `checkedAt`, `provenance: retry_after_exceeds_limit` | Remain blocked pending verified operational resolution. |
| `pending` | `checkedAt`, random `attemptId` | An outbound read has no durably completed result. Remain blocked; this is local uncertainty, not a provider diagnostic or reset estimate. |
| Missing/malformed state | No trusted diagnostic | Fail closed; do not probe the bank to discover whether the limit has ended. |

Only the provider adapter can originate trusted diagnostics, using private WeakMap metadata from actual HTTP responses. Getter properties, thrown private messages, forged error attributes and raw headers cannot become trusted deadlines. The existing `providerRetryDiagnostic` HTTP-429 display contract is preserved; the new `providerCooldownDiagnostic` also covers actual provider-coded throttling and HTTP 503 with Retry-After.

Account reads, transaction sync and transaction-detail reads record trusted cooldowns. Generic `retry_after` still enforces the existing background policy. Success of a transaction sync does not clear `account_evidence_retry`. Neither a shorter deadline nor an unrelated later known deadline erases an unresolved unknown/manual block. Repeated UI/MCP reads and syncs share `bank_locks`, including its expiry and atomic write fence.

`guardedBankRead(owner, connection, lease, read, onStateChange?)` in `account-read-guard.ts` arms a unique pending marker before each session/transaction/account-detail read in these paths. It compares owner, connection ID, application generation and encrypted session, then resolves only its own marker through a fenced compare-and-swap. A failed initial write prevents the request. A failed result write, lost lease or crashed invocation leaves pending; a completed non-throttle result restores the exact prior guard. A known prior deadline is protected by pending during any otherwise-authorized transaction read, so a new unsaved unknown throttle cannot be forgotten when that older deadline expires. An already unresolved unknown/manual/pending state is never replaced or cleared by transaction success. Ordinary caught transport errors with no observed provider throttle can complete the marker; an invocation whose result cannot be recorded remains blocked.

Unknown/manual/pending cooldowns have no automatic reset or force override in this PR. Provider confirmation or verified completion evidence, followed by a separately reviewed operational correction, is required. A blank field cannot reconstruct a historical response that older code never stored: the integrator must preserve any separately known unresolved legacy account-details cooldown and must not use rollout as permission for a new bank probe. No such production read or state correction occurred in this run.

Backup exports of the existing connection row retain the new field. A synthetic encrypted export and isolated SQLite restore preserve a nonempty unknown guard exactly; it remains blocking after 30 days. Old snapshots without it cannot establish that a previous unknown wait has ended. The additive column permits code rollback without dropping financial or operational history.

## Sync and original-preservation changes

Existing inclusive UTC windows, bounded interval narrowing, continuation handling, overlapping incremental retrieval and stable-entry deduplication remain. Application budgets remain Sites 25 requests/1,000 rows and Node 15 requests/5,000 rows; these are local execution limits, not bank promises. Empty pages with continuation keys do not complete history. An incomplete, invalid, interrupted or rejected fetch cannot advance coverage.

Node now validates the complete live bank/country/business/expiry scope, and carries the earliest stored/live consent deadline through each page, import and commit guard. Its imported rows/originals, encrypted coverage, successful sync audit and job success share one SQLite transaction. `storeTransactions` receives an optional synchronous final callback; all existing callers retain their previous interface behavior. Async completion callbacks are rejected before commit.

If independent postprocessing fails after commit, Node returns accurate import success with a bounded `warnings` array and persists a follow-up warning instead of reporting that the saved import failed. This warning is available in the API/status `last_error`; the existing Node UI only renders that field for error-status connections. Agent 4 can surface the warning while preserving successful sync status.

Raw transaction JSON, arrival SHA-256, original identities and duplicate/conflict evidence remain intact. Existing deduplication never substitutes the session UID or the transient `transaction_id` for stable `entry_reference`. No fabricated payer/OCR/account fields or production test records are introduced. Node's unused undocumented bare-account GET allowance is removed.

## Verified provider references and exact external gaps

Sources reviewed on 2026-11-02:

- [Enable Banking API reference](https://enablebanking.com/docs/api/reference/) and [official OpenAPI](https://enablebanking.com/docs/api/reference/enablebanking-api.yaml), OpenAPI 3.1.0, API version `1.0.0-967df6a1`: documented account-details and transaction endpoints; optional `account_id`/`all_account_ids`; typed schemes including `BGNR`.
- [Sweden integration specifics](https://enablebanking.com/docs/markets/se/): Swedbank holder names are available during session creation, older transactions may omit entry references, and historical preparation may require several minutes of continued pagination.
- [Provider FAQ](https://enablebanking.com/docs/faq/): singular stable account hash across sessions; continuation behavior, real foreground PSU headers and six-hour background rate-limit recommendation. The account-resource schema separately documents the plural identification hashes.
- [Bankgirot FAQ](https://www.bankgirot.se/en/Support/Frequently-asked-questions/): public Bankgiro search does not disclose the underlying bank/account mapping.

Still missing for the real account, and not manufactured by this implementation:

1. A current bank-supplied recipient-account alias that matches the retained report, if the provider does not return one in the authorized account resource.
2. A bank-supplied `BGNR` association or bank-issued account document explicitly proving the real Bankgiro-to-AIS-account relationship. Enum support alone proves neither availability nor this mapping.
3. A known reset/deadline or provider confirmation resolving any previously observed unknown account-details throttle. No live account-details call was made to test it.
4. Individual payer/reference data where Swedbank AIS exposes only an aggregate Bankgiro settlement; the company's permitted individual report channel/profile remains external.
5. Fresh authorized production evidence for this branch's behavior. Local tests and CI do not verify bank availability, actual provider fields, a renewed consent or a production schedule execution.

No production quality score is raised on the basis of these synthetic tests. Full delivery results and the exact commit/PR belong to the accompanying Agent 2 verification report.
