# Acceptance coverage — static baseline audit

Audited implementation: **`73662187cddf9a5c504dea9bd8a1288bd929bc51`** (PR #21).
Contract reference: [shared integration contract](README.md), edition
`mgeorge-integration-v1`.

This is a read-only analysis of existing synthetic test files, not a test-run
receipt. The coordinator runs and records full baseline tests separately. Test
names below describe their assertions; they do not claim a new execution or
delivery of the six new workstreams. No private production observations are
included.

## Existing coverage along the requested chain

| Boundary | Representative existing tests | Scope |
| --- | --- | --- |
| Reference meaning and exact text | [Node reference sources](../../test/payment-reference-sources.test.js) and [Sites mirror](../../sites/tests/payment-reference-sources.test.mjs): `bank SEBG type detects invalid OCR that otherwise exactly matches an invoice number`; `unknown API scheme and generic SCOR retain structured identity without claiming OCR`. | Preserves `0599` and source classification. Explicit invalid OCR blocks matching; a generic structured reference does not become formal OCR. This is not persisted company policy C1. |
| AIS observation and retained receipt | [Sites provider](../../sites/tests/banking-provider.test.mjs): `trusted normalization preserves raw bank fields, candidate paths and immutable source on duplicate import`; `client imports cannot claim to hold authenticated raw bank data`. [Node storage](../../test/bank-reference-storage.test.js): `bank original and all reference candidates survive SQLite, duplicate sync and changed response`. | Authenticated source boundary, exact original, stable identity and replay. |
| Retained report and original bytes | [Sites XLSX integration](../../sites/tests/bankgiro-xlsx-integration.test.mjs): `XLSX original is retained and downloaded byte-for-byte with SHA-256 and correct MIME`; `XLSX confirmation reparses original, preserves cell provenance and never trusts client financial fields`. [Node XLSX](../../test/bank-xlsx.test.js): `confirmed XLSX retains exact private bytes and SHA once, without financial mutations even with concurrent retries`. | Real synthetic file/API flow. Starts with uploaded or retained bytes, not authorized automatic retrieval through C3. |
| Report to individual and deposit | [Sites Bankgiro](../../sites/tests/bankgiro.test.mjs): `Bankgiro XML preserves Café, 0599, sender BG, settlement date and individual ID`; `exact invoice, verified payer and linked original can reconcile automatically`; `two individual payments replace collective economically once and API refresh is idempotent`. | Individual reference, parent/child identity, complete group, positive matching and conservation. AIS and report inputs are synthetic fixtures. |
| Current account proof and commit fence | [Sites account evidence](../../sites/tests/bank-account-evidence.test.mjs): `current bank-supplied BBAN proves only the selected account alias without any writes`. [Node account evidence](../../test/file-account-evidence.test.js): `exact file account and bank facts with an active owned selected account support automation`. [Sites account commit](../../sites/tests/bank-account-commit.test.mjs): `alias removal inside the commit window rolls back promotion, allocation and audit atomically`. | Explicit owner-bound current account evidence and commit-time revalidation. An alias match alone is not deposit proof. |
| Exact invoice candidate | [Sites candidates](../../sites/tests/invoice-candidates.test.mjs): `real field wrappers expose 0599 as a suggestion without inventing bank OCR or changing state`; `an active linked report selects its matching unregistered original over a conflicting detail reference`; `linked report matching preserves leading zeros and does not promote a near identifier`. | Source precedence, exact `0599` versus `599`, and proposals without registration or financial writes. |
| Payment explanation and view | [Sites verification](../../sites/tests/payment-verification.test.mjs): `a complete bank-identified report shows common identity and declared counts separately from a manual relation`; `the existing engine may propose a safe match but the detail still performs no allocation`. [Sites payment UI](../../sites/tests/bank-payment-ui.test.mjs): `625 SEK collection never presents invoice customer, bank description or proposed 0599 as payer or OCR`; `a displayed report reference selects its invoice rather than the different detail-reference invoice`. | Keeps bank facts, manual relations, candidates, allocations and displayed source evidence distinct. |

## Strongest existing joined flow

[sites/tests/banking-security.test.mjs](../../sites/tests/banking-security.test.mjs)
contains `recovered bank history retains one financial receipt and truthful
evidence in the paginated payment view`. It uses the actual provider adapter with
substituted HTTP and a generated RSA key, period recovery, continuation handling,
durable import, original SHA verification, a replay through account selection,
and actual React server rendering of the payment list.

Its assertions retain one economic payment and the exact original, leave
allocations empty, and show the actual payer, leading-zero reference and missing
formal OCR in both rendered layouts. **The reference is `000427`, and the flow
does not retrieve or import a Bankgiro report.** It is AIS-to-view coverage, not
the complete new C1–C6 chain or browser/device acceptance.

## Negative, replay and recovery coverage

| Case | Existing representative assertions |
| --- | --- |
| Missing authorized report source | **Gap for C3.** [Node control](../../test/payment-control.test.js), `missing connections and provider rate limits produce partial not false success`, and [Sites control](../../sites/tests/payment-control.test.mjs), `missing Gmail and bank remain partial while saved-data steps continue`, cover existing adapters only. They do not test a missing report source or its availability contract. |
| Missing or ambiguous account alias | [Account evidence](../../sites/tests/bank-account-evidence.test.mjs): `missing bank-provided alias remains missing and is never calculated from IBAN`; `an alias shared by an unselected account remains ambiguous`; `stale consent or workspace after a provider read cannot produce a positive result`. |
| Multiple payers and incomplete groups | [Node report links](../../test/bankgiro-links.test.js): `complete multi-payer report links only to its total and preserves every individual reference`. [Sites report links](../../sites/tests/bankgiro-links.test.mjs): `manual relation covers the entire complete multi-payer report group`; `wrong report sum and incomplete individual rows cannot attach`. |
| Lost zeroes and false OCR | [XLSX parser](../../sites/tests/bankgiro-xlsx.test.mjs): `XLSX numeric reference uses explicit zero format without guessing`; `XLSX numeric general reference fails closed because leading zeros are unknown`. [Payment UI](../../sites/tests/bank-payment-ui.test.mjs): `numeric invoice reference is never labelled OCR without OCR evidence`; `unused detail reference metadata cannot classify the AIS reference as OCR`. |
| Replayed reports and transactions | [XLSX integration](../../sites/tests/bankgiro-xlsx-integration.test.mjs): `XLSX repeated confirmation and overlapping report never create additional economic money`; `XLSX identical request receipt prevents a second import despite stale revision`. [Sites report links](../../sites/tests/bankgiro-links.test.mjs): `the same semantic report in different XLSX originals cannot be claimed by two distinct AIS deposits`. Node/Sites also test stale second reservations after recipient Bankgiro padding changes. |
| Concurrent work and restart | [Node payment concurrency](../../test/payment-concurrency.test.js): `two real processes import and reconcile one bank payment once, then replay safely after restart`; `abrupt process exit during bank insertion rolls back the entire import and retries once`. [Node jobs](../../test/integration-jobs.test.js): `leases span independent database connections and stale owners cannot write or release replacements`. [Sites control](../../sites/tests/payment-control.test.mjs): `each advance executes one persisted step and resumes without in-memory state`; `a live lease prevents overlapping advances; expired lease is reclaimed safely`. |
| Economic conservation | [Node reconciliation](../../test/reconciliation.test.js): `bank collective deposit and complete Bankgiro specification are counted once`. [Sites report links](../../sites/tests/bankgiro-links.test.mjs): `manual link retains both originals and every financial field without counting report money`. [Sites verification](../../sites/tests/payment-verification.test.mjs): `economic membership explains an AIS observation and separate review report without adding money`. |

## Missing acceptance evidence for the new contracts

1. **C1 is absent from the audited baseline.** Existing typed-reference tests do
   not establish a persisted, company-scoped reference policy. New coverage must
   exercise policy version/provenance, explicit-reference precedence and
   conflict, conservative legacy defaults, `0599` versus `599`, already-lossy
   numeric input, and metadata preservation through extraction, review,
   registration, export and restore in both runtimes.
2. **C3 is absent from the audited baseline.** No `BankgiroReportSource`
   implementation or automated source acceptance test was found. Test the
   authorized synthetic adapter, owner/account scope, explicit missing-source
   status, bounded original bytes and hashes, report identity conflicts,
   pagination and durable checkpoints. Uploaded originals do not prove source
   authorization or automatic retrieval.
3. **The complete new chain is missing.** No existing test connects C1 intended
   `0599` reference → AIS → authorized C3 → retained original → individual
   payment → current account and common deposit proof → exact candidate →
   existing payment overview in one execution. The separately seeded fixtures
   above are regression evidence, not proof that the new contracts fit together.
4. **C3/C5 recovery is unproved.** Existing Sites control tests assert the five
   current steps via `gmail`, `documents`, `bank`, `reconcile`, `reconcile` calls
   with substituted external adapters. They do not cover report-source cursors,
   two source pollers, delivery-ID/content-hash replay, conflicting report bytes,
   or interruption between retrieval, retention and import. New tests must
   preserve completed effects, fence stale workers and stop checkpoints before
   uncommitted work.

Retain the existing suites as regression gates. Add the complete synthetic chain
and the contract's blocked/replay/recovery cases when the new implementations
arrive. Record actual results against their exact reviewed heads separately;
baseline tests cannot certify work that has not been delivered.

## Coordinator regression added after the static audit

The new [seven-agent 0599 baseline test](../../sites/tests/seven-agent-0599-baseline.test.mjs)
joins the real AIS normalizer, retained CAMT file upload/download and parser,
encrypted current account store, existing financial commit fence, exact
candidate GET endpoint and React payment-list rendering. Six cases exercise
normal report/AIS replay, a lost leading zero, missing current account alias,
missing common bank deposit identity, revoked consent at commit and changed
retained bytes. The positive flow has one economic payment, unchanged invoice
balances and zero allocations; candidate selection does not assert payer proof.

This closes a gap between existing components but deliberately starts with
synthetic AIS/report inputs. It does not provide C1 company-policy or C3
authorized report retrieval, new source-job recovery, real provider or browser
acceptance. The integration report records actual run/CI evidence separately.
