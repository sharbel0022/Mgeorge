# Bankgiro enrichment for SaaS

Branch: `feature/saas-bankgiro-enrichment`. Baseline: `14a042abd37fa455d08da9dfcc096ef4f603b512`.
Documentation checked: 2026-11-04. This work owns report normalization and evidence intake; the company model, provider OAuth/mTLS client and consent UI belong to the other SaaS workstreams.

## Design and boundaries

Use the documented Open Payments AIS `transactions.bankgiro` records as supplementary report observations. Retain every original JSON response and its byte hash in an explicitly application-owned capture container. Feed that container through the existing original/queue/report boundary. Do not manufacture CAMT from JSON or describe an internal transport protocol as an Open Payments endpoint.

The existing CAMT/XML/XLSX paths remain available. The Node standalone register retains API reports for review without making financial rows. Sites can retain individual report observations in its existing specification model; those observations require company identity, current account evidence and a common bank entry identifier before they can represent an existing deposit. Import never allocates invoices.

Alternatives considered: replacing the file intake would discard its existing authority/lease/original guarantees; converting API data to CSV/CAMT would obscure the actual source. A native JSON capture and small extensions to the existing intake preserve those guarantees and the actual bank fields.

The current baseline has an owner workspace, not a complete multi-company authorization model. A new API report must have an explicitly bound `companyId`; no company may be inferred from a name, invoice, owner or bank amount. Integration with the foundation/provider branches must supply the selected company and trusted provider authorization. Nothing in this branch configures a production source, obtains credentials or grants a bank entitlement.

## Verified provider schema

Official sources:

- [Access tokens and scopes](https://docs.openpayments.io/docs/get_access_token)
- [AIS endpoints](https://docs.openpayments.io/api/account-information-service-ais)
- [Account report and transaction schemas](https://docs.openpayments.io/api/~schemas)

The read endpoint is `GET /psd2/accountinformation/v1/accounts/{account-id}/transactions`. Corporate use requires the corporate context and account consent. `bankgiroinformation` accompanies `accountinformation` for ISO enrichment; merely having PSD2 AIS access does not establish that the company receives Bankgiro details.

The schema has `transactions.booked`, `transactions.pending`, and `transactions.bankgiro`. Child fields include `transactionId`, `entryReference`, `transactionAmount`, `bookingDate`, `valueDate`, `debtorName`, `debtorOrganisationId`, account/remittance information, `aggregateTransactionId`, `aggregateTransactionListId`, `aggregateId`, `aggregateAmount`, `isAliasPayin`, `isAliasPayout` and `isEnriched`.

`aggregateTransactionId` refers to the aggregate transaction. `transactionListId` is generated from transaction details and can collide; neither it nor its aggregate counterpart is sufficient as an identity. `aggregateId` is a deposit serial, not a globally unique report or payer identity. A structured numeric reference is not automatically formal OCR. The publicly rendered nested `creditorReferenceInformation.reference` schema is an object; unsupported shapes must be preserved and held for review, never guessed.

## Implementation and acceptance plan

1. Implement and test a bounded pure normalizer against those actual fields. Cover exact decimal amounts, complete groups across pages, missing details, duplicate/conflicting child IDs, strict account identity, raw fields and reference semantics.
2. Add a byte-preserving internal capture format and explicit authority/company checks. Integrate it with the existing durable report worker and both original sinks. Add review reasons to the existing status projection.
3. Prove conservation, scope isolation, receipt integrity and replay through actual synthetic SQLite/D1-backed intake and domain components. Preserve the independent invoice reference policy and allocations.
4. Run required root/Sites/bridge gates, obtain independent review, document coverage and activation limits, push only this branch and open a PR against `main`.

Review focus: identity collisions across company/account/source; changed originals under an existing report identity; a partial response looking complete; expiry or revocation during intake; an untyped provider ID being mistaken for a bank-issued deposit identifier.

## Existing source and parser review

`BankgiroReportSource` already separates authorization, paginated report discovery and exact-byte retrieval. Its durable queue binds owner/source/scope/report/hash, retains originals before interpretation, fences writes with a lease and current registration, and keeps uncertain outcomes available for recovery. The new format uses that boundary; it adds no parallel scheduler.

The shared `bankgiro-parser.js` reads booked CAMT.053/CAMT.054 entries and individual `TxDtls`, validates currency/direction/reversals and exact entry totals, and preserves namespace-aware payer/reference evidence. `bankgiro-xlsx.js` validates ZIP structure, CRC and expansion bounds before parsing the existing Swedbank report profile. XLSX report serials and recipient Bankgiro remain typed report identities; they are not treated as an AIS bank entry reference. CSV has separate generic reference and OCR columns. These existing profiles and their trust rules are unchanged.

The general bank-file import path can create account transactions and therefore does not accept the API capture format. Only the company-bound report intake can admit `.opbg.json`. Retained previews remain read-only; any later report link is reconstituted from the retained original rather than browser-supplied normalized fields.

## Delivery evidence

The delivered adapter is `sites/lib/bankgiro-openpayments.js`, with a typed public contract and an independent byte-preserving capture module. The existing report worker, HTTPS registration, retained-original service, Sites domain and standalone Node sink admit the new profile without replacing the file parsers. The status projection exposes unavailable, partial and review outcomes.

Limits are explicit: at most 50 capture pages, 1,000 individual observations, 10,000 booked observations, 8 MiB per normalized page and 15 MB across originals/capture. Scoped SHA-256 identities avoid truncation in the existing transaction model. Stable provider IDs and missing-ID observation keys use separate namespaces. The existing 1.8 MB Sites workspace projection limit also remains; a retained capture is not a promise that every possible normalization fits in the workspace. A rejected projection does not post money or discard its retained original.

## Provider and bank availability: verified documentation versus customer evidence

The following is a documentation inventory as of 2026-11-04. **No customer entitlement, live bank response, production completeness or historical backfill has been verified in this task.** A bank's presence in an AIS list, ISO enrollment instructions or outgoing payment support is insufficient proof of incoming `bankgiroinformation` for that customer's account.

| Provider / bank | What the official material establishes | Incoming individual Bankgiro details in this delivery |
| --- | --- | --- |
| Open Payments / Swedbank | A documented ISO enrollment route through the customer's bank contact and a signed agreement. Swedbank's ERP table marks several integrations via Open Payments for camt.053E, pain.001 and PSD2. | The shared API has Bankgiro detail fields. Availability and completeness for a particular account remain unverified. Do not equate this route with the separate CAMT054C/SFTP agreement. |
| Open Payments / SEB | ISO enrollment through SEB, requiring authority to sign the agreement; onboarding may ask about the company's invoice references. | Incoming field coverage and the customer's activated product must be confirmed. The adapter never changes the company's reference policy to satisfy an assumed bank requirement. |
| Open Payments / Handelsbanken | Account selection, acceptance of terms and signature are documented for ISO enrollment. | Customer-specific incoming Bankgiro enrichment remains unverified. |
| Open Payments / Nordea | ISO enrollment uses Corporate Access Lite according to the provider's bank guide. | Customer-specific incoming Bankgiro enrichment remains unverified. |
| Open Payments / Danske Bank | The bank guide requires an agreement with Open Payments as a service bureau. | Customer-specific incoming Bankgiro enrichment remains unverified. |
| Open Payments / DNB | ISO enrollment is initiated through a link supplied by the business system. | The guide does not prove incoming Swedish Bankgiro detail coverage for a specific account. |
| Enable Banking / Swedish banks | Official Swedish-market documentation explicitly describes limited individual detail in Bankgiro batches exposed through PSD2 AIS. The existing adapter preserves what the bank returns. | No separately verified incoming Bankgiro enrichment product is introduced here. Missing payer details stay missing; use an authorized report source. |
| Direct Swedbank CAMT054C/SFTP | Swedbank publishes CAMT054 Credit implementation guides and examples, and the repository already has a pinned SFTP/report pipeline. | Available only for a customer with an independently verified applicable agreement, account/profile and transport configuration. Manual original-file import remains available. |

Sources for these distinctions:

- [Open Payments ISO and PSD2 overview](https://www.openpayments.io/integrera)
- [Swedbank ISO enrollment](https://www.openpayments.io/integrera/swedbank-iso), [Swedbank's own integration table](https://www.swedbank.se/foretag/betala-och-ta-betalt/bankintegration-med-affarssystem.html)
- [SEB ISO enrollment](https://www.openpayments.io/integrera/seb-iso), [Handelsbanken ISO enrollment](https://www.openpayments.io/integrera/handelsbanken-iso), [Nordea ISO enrollment](https://www.openpayments.io/integrera/nordea-iso)
- [Danske Bank ISO enrollment](https://www.openpayments.io/integrera/danske-bank-iso), [DNB ISO enrollment](https://www.openpayments.io/integrera/dnb-iso)
- [Enable Banking Swedish-market limits](https://enablebanking.com/docs/markets/se/), [batched-transaction explanation](https://enablebanking.com/docs/faq/)
- [Swedbank MIG index, including the 2026-08-07 CAMT054C update](https://www.swedbank.se/foretag/betala-och-ta-betalt/betala/fakturahantering/betala-via-fil/mig.html)

There is no verified bank-specific unsupported list for this feature. `unavailable` means the retained response supplies no individual detail; it does not mean the bank is permanently unsupported or that no customer payment exists. `partial` means the observed data is incomplete or unsuitable for automatic decomposition. `available` is limited to the complete observed groups; it is not a full-history or bank-wide completeness certificate.

Open Payments' `lastTransactionEnrichmentDateTime[Utc]` fields indicate freshness, not complete coverage. `X-ISO-Fallback-Enabled` applies to accounts already ISO onboarded and included during consent creation; it does not enroll an account or grant new authority. See the [AIS documentation](https://docs.openpayments.io/api/account-information-service-ais). This branch deliberately requires current authority and does not infer continuing ISO permission from an expired AIS receipt.

## Field and identity mapping

| Provider field / source | Existing model / preserved evidence | Rule |
| --- | --- | --- |
| `transactions.bankgiro[]` | Individual `specification` observations | Never create a new standalone deposit from a report. |
| `transactionAmount.amount`, `.currency` | Integer öre and currency | Parse decimal strings exactly; unsupported or malformed monetary data cannot become SEK by assumption. |
| `bookingDate`, `valueDate` | Booking date and preserved settlement date | A date is a consistency check, never a deposit identity. |
| `debtorName` | `party`, typed payer evidence | Use the bank's individual debtor; no invoice-derived payer. Missing debtor information remains a review hold. |
| `debtorOrganisationId`, `debtorAddress`, `debtorAccount` | Payer evidence and raw bank JSON | Preserve source values and paths, including data not promoted into matching. |
| `remittanceInformationStructured` | Generic structured `payerReference` / reference evidence | String values such as `0599` and `599` remain distinct. Structured does not mean formal OCR. |
| Unstructured remittance and arrays | Reference evidence, message and raw JSON | Preserve alternatives and conflicts. Do not silently choose an invoice's preferred value. |
| Nested structured reference shapes | Raw JSON and review issue when unsupported | The public schema's ambiguous object shape is not guessed into a scalar OCR. |
| Child `transactionId` | Provider/company/account/source-scoped external identity | Deduplicate a stable child identity, not a payer/amount/date fingerprint. Separate genuine IDs preserve otherwise identical payments. |
| Child `entryReference` | Child `bankReference` | Never substitute an internal API transaction or list ID. |
| `aggregateTransactionId` | Typed parent API identity and grouping | Resolve it against a unique `transactions.booked[].transactionId` in the captured pages. |
| Resolved parent's `entryReference` | `parentBankReference` | This actual bank identifier, verified account, currency, dates and exact child total must agree with the existing AIS aggregate. |
| `transactionListId`, `aggregateTransactionListId` | Typed raw identities | Collision-prone generated IDs do not establish uniqueness or cross-provider equivalence. |
| `aggregateId`, `aggregateAmount` | Serial / expected aggregate total evidence | A serial is not globally unique. It cannot replace a common bank entry identity. |
| `isAliasPayin`, `isAliasPayout`, `isEnriched` | Classification / raw evidence | Enrichment flags alone neither prove account ownership nor complete Bankgiro information. |
| Response `account.iban` | Reported recipient account | Must agree with the trusted provider-account binding; Sites separately resolves it against the current selected bank account. No guessed BBAN-to-IBAN conversion. |

The adapter preserves unknown provider fields in the retained response and `rawBankData`. `enrichmentEvidence` keeps the new provider identity separate from the existing Enable Banking `bankData`/receipt format. Neither `paymentId` nor a numeric remittance is promoted into a generic bank payment identity.

## Native capture and source integration contract

`sites/lib/bankgiro-openpayments-capture.js` exports `createOpenPaymentsBankgiroCapture`, `readOpenPaymentsBankgiroCapture` and `assertOpenPaymentsBankgiroAuthority`. The first accepts:

```js
{
  context: { owner, companyId, sourceId, scopeId, accountId, iban, bankgiro },
  captureId, // durable acquisition ID, reused only for the same immutable acquisition
  pages: [{ body, requestPath, requestId, receivedAt }]
}
```

`body` is the exact UTF-8 response text or bytes supplied by the trusted provider transport. The helper retains that text, checks each response hash and emits `{ bytes, sha256, filename, reportId, normalization }`. The filename ends in `.opbg.json`; the media type is `application/vnd.mgeorge.openpayments-bankgiro+json`. This is **Mgeorge's internal capture container**, not a claimed Open Payments response format. Do not serialize an already parsed provider object and describe it as the original HTTP body. A provider client that only exposes parsed JSON must add a raw-response receipt at its transport boundary before using this format.

The captured request path is the documented account transaction route, with `bookingStatus=booked` and bounded permitted query fields. Every subsequent page must correspond to the preceding response's next link for the same provider account. Duplicate JSON object keys, ambiguous request scopes, changed byte hashes, repeated pages and malformed containers are rejected. Raw page hashes verify integrity; they do not authenticate the bank.

The trusted source supplies current authority separately. It must bind the exact owner, selected company, source, scope, provider account ID, IBAN and applicable Bankgiro, with current `checkedAt`, `validUntil`, evidence ID, generation, `origin=provider_authorization`, and all of:

```text
bankgiro_reports:read
accountinformation
bankgiroinformation
corporate
```

`bankgiro_reports:read` is Mgeorge's existing internal source capability. The other three are documented Open Payments scopes. A checksum, captured context, bank name or normalizer output grants none of them. Production access also needs the provider's approved application and organization-specific client certificate; see [Open Payments onboarding](https://docs.openpayments.io/docs/getstarted).

The pure construction/normalization helpers can represent an unknown expected Bankgiro. Authenticated intake cannot: it requires the capture context to repeat the registered Bankgiro exactly. This prevents omission from bypassing the source's Bankgiro binding. A missing number in the actual bank response is still left missing in normalized bank fields.

The existing `BankgiroReportSource` queue accepts the capture descriptor and exact bytes. Its `https-v1` transport remains Mgeorge's internal source protocol (`/v1/authorization`, `/v1/reports`, `/v1/reports/{id}/content`), **not an Open Payments API**. A registration may allow `json` only with the exclusive `openpayments-bankgiro-v1` profile and the concrete account binding. Existing XML/CSV/XLSX profiles remain separate. The provider integration must durably store the immutable capture before exposing its descriptor; retries reuse that capture rather than changing content behind an existing report ID.

The worker retains original bytes before interpretation, checks descriptor/report identity and hashes, and preserves current authorization/lease/configuration fences. Both sinks check the capture's internal report ID against the job. Sites stores an additional import/audit receipt with authority provenance and expiry. Node records the whitelisted current receipt in document metadata and appends an audit entry for a new import or a changed receipt, preserving earlier authority evidence without growing history on an unchanged replay. A normal file upload cannot enter this authenticated capture path. Read-only retained previews still verify owner and selected company.

The current owner-based registry permits one active registration per owner. This branch does not register a second company or silently retire an existing customer's source. The foundation integration must provide a trusted company binding (`State.company.id` in Sites, explicit `company_id` for the standalone Node review sink) and a company-aware registry before multiple concurrent company sources are enabled. Names, invoice references and owner IDs cannot fill that binding.

## Conservation, conflicts and fallback

Sites links complete individual observations only to a proved existing aggregate. `economicTransactions` excludes unlinked review observations and counts the aggregate or its complete children once. The intake checks that invoice allocations have not changed. Node retains the capture as `needs_review` and exposes its normalized observations through the capture reader; it creates no financial transaction rows. Neither sink performs invoice reconciliation as part of report intake.

Replay of the same capture produces no new import effect. A fresh capture of the same scoped payment preserves its new original receipt without duplicating the same complete observation. Identical financial details with different genuine child IDs remain separate payments. Changed raw data under an existing child identity creates conflict evidence. Changed bytes under an existing report identity are blocked. Incomplete earlier captures remain review observations when a later complete capture supplies enough bank evidence; incomplete data is not silently rewritten into a complete original.

The fallback order is:

1. Use actually returned, authorized individual API information when its group and account evidence pass.
2. If information is absent or partial, retain and display that fact. Use the customer's existing CAMT054C/SFTP source only when its own current company-specific agreement and configuration are verified.
3. Keep manual CAMT/XML/XLSX/CSV import as the final reserve. Missing bank fields remain missing through every route.

The fallback selector is a pure policy helper. It does not fetch a report, grant consent, activate SFTP or replace the current owner-wide source registration. The UI states the applicable path and the durable queue retains `BANKGIRO_INFORMATION_UNAVAILABLE`, `BANKGIRO_INFORMATION_PARTIAL` or `BANKGIRO_ENRICHMENT_REVIEW` as appropriate.

## Historical 0599 case

The acceptance fixtures use synthetic bank accounts, source identities and payers, including a `625.00` SEK payment and the separate reference strings `0599` and `599`. The application's M.George company reference policy is preserved. No actual customer original was opened, downloaded, copied into tests or modified in this task. No inference that the historical invoice was paid is made. Its economic allocation still requires the necessary bank evidence and an authorized financial decision.

## Verification and handoff

### Acceptance coverage

| Requested case | Principal regression coverage | Expected financial effect |
| --- | --- | --- |
| One payer and multiple payers in one deposit | `openpayments-bankgiro.test.mjs`, `openpayments-ingest.test.mjs` | Preserve each individual amount, payer, source ID and reference; represent an already proved aggregate once. |
| Same bank entry again, reimport and new acquisition receipt | `openpayments-domain.test.mjs`, `openpayments-ingest.test.mjs`, `openpayments-bankgiro-ingest.test.js` | No duplicate economic deposit; keep new original receipts. Distinct genuine child IDs remain distinct even with identical financial facts. |
| Different companies with similar references | Capture, domain and both sink suites | Company binding is mandatory; no name/reference-based tenant selection or cross-owner adoption. |
| `0599`, `599` and 625 SEK | Normalizer and Sites intake suites | Preserve the exact bank strings and configured company policy; no invoice allocation. |
| Missing Bankgiro information or missing individual payer | Normalizer, intake, queue/status and fallback suites | Explicit unavailable/partial/review status; missing information is not filled from invoices. |
| Wrong provider account, IBAN or report identity | Capture, transport and both sink suites | Reject before a financial commit; retain acquired originals through the queue's original boundary. |
| Conflicting original hash or changed facts under an existing bank ID | Capture, queue, domain and intake suites | Block or retain conflict evidence for review; do not overwrite the accepted bank observation. |
| Partial bank coverage and later complete capture | Normalizer and domain suites | Earlier incomplete observations stay held; a later independently complete original can support the proved deposit without double counting. |
| Authorization expiry, changed company, stale job or source | Existing queue/lease regressions plus capture and intake suites | Recheck authority and immutable identity at commit; no stale write. |
| Existing XML/XLSX/CSV and SFTP fallback | Existing parser/service/API suites and the bridge suite | Preserve the existing customer agreement and file import paths. |

### Frozen local verification

Environment: Linux, Node `24.22.1`. The reviewed code passed:

| Gate | Result |
| --- | --- |
| Root `npm run check` | 137 JavaScript files passed syntax checks. |
| Root `npm test` | 1,580 passed; 0 failed, cancelled, skipped or todo. |
| Sites `npm run check` | TypeScript check passed, including the new public declarations. |
| Sites `npm test` | 3,219 passed; 0 failed, cancelled, skipped or todo. |
| Sites `node scripts/minimatch-backport.mjs --check --require-target` | One installed target verified, zero writes. |
| Sites `npm run build` | Production build completed. |
| Bridge `npm run check` and `npm test` | Syntax passed; 47 tests passed, with no failures, cancellations, skips or todo. |
| `git diff --check` | Passed. |

Total: **4,846 passing tests**, including **113 new cases** relative to the verified baseline. Focused runs are subsets of these totals. Existing CAMT/XML/XLSX/API/retained-preview and the pinned synthetic SFTP chain are included.

Local verification used the existing installed dependencies. The root now explicitly declares the same pinned `@noble/hashes@2.4.0` dependency already used by Sites, so the shared capture works in a root-only installation. A local offline package-install attempt could not resolve the uncached registry metadata. Clean installation, dependency audits and Node 22 verification belong to the required [Payment control checks workflow](../../../.github/workflows/payment-control-ci.yml); the PR's commit-specific checks are the authoritative remote receipt. No new clean-install or audit success is inferred from the local reused dependencies.

### Independent review and fixes

Independent reviews covered the real provider field mapping, parent/account identity, authorization admission, both original sinks and the financial domain. Reproduced findings were fixed with negative-to-positive regressions:

- A malformed or unsafe aggregate serial cannot become a normalized report sequence; a null serial stays missing.
- A genuine provider ID cannot collide with a missing-ID observation key.
- Parent creditor account and returned Bankgiro are checked, and placeholder bank references cannot support linkage.
- Distinct provider payments under separate proved deposits remain separate even when payer, date, amount and generic reference agree. Equal bank payment references and cross-source ambiguity still hold for review.
- Reusing a bank reference on a later date for a distinct provider parent does not poison an earlier original. Changed facts under the same scoped parent still conflict.
- An omitted capture Bankgiro cannot bypass the registered source binding. Company/authority changes inside Node's transaction roll back the review import and its audit together.

The final narrow independent checks passed for the resolved normalizer/capture and domain findings. No established monetary-duplication or authority-bypass blocker remained in those reviews. These are scoped engineering reviews and synthetic tests, not a live bank acceptance certificate.

### Integration handoff

Before activation, the foundation and provider workstreams must supply the trusted selected company, a company-aware source registry, raw HTTP response receipts from the authorized provider transport, and verified customer/bank entitlement and account binding. Preserve the existing provider credentials and consent lifecycle; this branch supplies no replacement OAuth or mTLS implementation. Confirm actual individual field coverage and the common bank entry reference using authorized customer evidence.

Delivery is through `feature/saas-bankgiro-enrichment` and a PR against `main`. The PR records its exact GitHub commit and CI results. No source registration, customer allocation, production data mutation, merge or deployment is performed by this branch delivery. All 33 quality scores remain unchanged at **255/330 = 7.73/10**, with **0/33 at or above 9.5**.
