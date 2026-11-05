# Company bank sync and reconciliation design

## Authority and scope

This implements the user's Agent 5 brief on
`feature/saas-bank-sync-reconciliation`, from main `14a042a`. Delivery is a tested
branch and PR; merge, Sites publication, live bank calls, and production changes
are outside this task. Only synthetic data may enter tests or repository files.

The current Node ledger is a single-company SQLite database. Sites uses an
owner-keyed workspace, original store, and bank connection. Neither an owner nor
a caller-supplied company ID proves a legal-company data boundary. A company
job therefore needs a trusted, exclusive company-to-data-scope binding before
any provider call or write. Existing data remains; legacy scheduler paths remain
available for unbound scopes. A durable binding prevents legacy fallback,
including a job that was already awaiting a response when enrollment occurred.
Agent 1 owns membership and the eventual general company model;
Agents 2–4 own provider, consent, and Bankgiro normalization.

## Approach

Use shared additive coordination primitives and small runtime adapters. Keep
the existing financial import, original, reconciliation, and allocation engines
authoritative. The alternatives were modifying every financial table here
(duplicates Agent 1 and risks legacy migration) and merely adding a company ID
to jobs (does not isolate the ledger). Neither satisfies this task safely.

The existing Node timer and Sites authenticated bank automation dispatch company
work through trusted bindings. No second external scheduler or browser-provided
owner/URL/credential override is introduced. Missing binding, consent, quota,
account authorization, or integration capability blocks work with a safe code.

## Required invariants

- A stable company/account job identity survives consent renewal and restart.
  A persisted fence and finite lease prevent overlapping or late writers.
- Current company, connection, consent generation, permitted account, and expiry
  are checked before provider reads, after waits, and inside import commits.
- Quota reservations precede actual requests and survive failures and renewal.
  Provider 429 embargoes cannot be bypassed by manual execution or restart.
- Original transactions and import checkpoints commit together through existing
  idempotent sinks. An uncertain response never proves success or changes money.
- Job outcomes are `success`, `partial`, `blocked`, and `retry`; previous success
  and latest attempt are separate. Bankgiro coverage is a separate fact.
- Enrichment uses only an enabled, verified, company-bound source. Missing real
  coverage remains explicit. A report is not a second economic deposit.
- Every company's exact reference policy is explicit. No legacy M.George rule
  becomes another company's default. Payer, account, currency, available money,
  invoice balance, original integrity, audit, and allocation rules remain intact.
- Only a fully evidenced, current, uniquely identified payment may be allocated
  automatically. Review and ambiguous cases leave invoice balances unchanged.

## Verification

Run 100 synthetic companies, concurrent jobs and same-account contention,
provider throttling, consent renewal/revocation during waits, interrupted imports,
restart replay, wrong account/customer, identical references across companies,
partial/excess payments, aggregate Bankgiro deposits, duplicate reports, missing
coverage, and unchanged balances on uncertainty. Exercise actual SQLite/D1-shaped
atomic batches and the existing financial sinks; provider network calls are
synthetic. Run root and Sites full suites, syntax/types, audits, bridge regression,
and a separate Sites build. Record local versus remote CI separately.

## External evidence and integration limits

Provider policies are inputs, not invented defaults. Official Open Payments
consent documentation exposes `frequencyPerDay`, recurring access, and account
scope; its enum reference separates `bankgiroinformation` from AIS. Enable
Banking documents bank-dependent background limits. These do not establish a
particular customer's entitlement. Agent 2/3 must supply the verified policy
and current authorization in their adapter.

- https://docs.openpayments.io/api/consent-service
- https://docs.openpayments.io/api/account-information-service-ais
- https://docs.openpayments.io/docs/enums
- https://enablebanking.com/docs/api/reference
- https://enablebanking.com/knowledge-base

No real company/provider acceptance or production score increase follows from
the synthetic tests. Exact runtime adapter contracts and activation dependencies
are recorded in `docs/integration/saas/sync-reconciliation.md`.
