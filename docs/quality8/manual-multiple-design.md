# Manual multiple-invoice allocation design

Approved implementation scope, 2026-11-05. Independent design review: recovery
agent; implementation: payments agent. No production financial execution.

## Intended result and approaches

A user reviews every invoice and minor-unit amount, then explicitly approves a
single immutable vector. The existing single-invoice write and C4 automatic
approval rules remain unchanged. A new manual receipt is not an automatic
`VERIFIED` decision or a new statement about the bank payer.

Repeated single matches reject complete multi-reference originals. The existing
Sites split-and-match sequence commits partial progress and cannot atomically
approve the whole vector. Neither is the chosen implementation. A separate
manual review and commit boundary reuses trusted source adapters and existing
SQLite/D1 transaction machinery without inventing bank child observations.

## Scope and evidence

- Two to twenty distinct invoices belonging to the current owner/company.
- All relevant preserved bank references must have exactly one invoice owner in
  the complete company census, including closed/held claims. Every referenced
  invoice must receive a positive row. No extra, omitted or fuzzy reference.
- Bank original, individual bank payer, account/current consent, source version,
  each invoice original, direction/currency/total/remaining balance and complete
  ownership/competition set are checked on the server at review and commit.
- C4 remains read-only. Its conservative source checks may inform the separate
  manual policy, but no generic REVIEW override or `referenceCorrection` is
  introduced. Only exact multiple-reference diagnostics, explicit amount
  discrepancy and a previously approved customer relation can be eligible.
- Missing/changed originals, incomplete source references, bad OCR, conflicting
  payer/customer, ambiguous ownership and competing payments stop the operation.
- Every amount is a positive safe integer number of minor units. Each row is at
  most the invoice debt; their safe-integer sum is at most payment availability.
- Either all available money is consumed (underpayment may leave invoice debt),
  or every referenced invoice is fully settled (overpayment may leave bank
  money). Leaving both kinds of remainder is rejected. Existing allocated pairs
  are rejected; this operation does not implement top-ups or adjustments.

## Approval, commit and replay

A read-only discovery returns eligible invoices and balances. Editing amounts
and a review note leads to a server-generated canonical quote. The final explicit
confirmation sends exactly that vector and quote hash with a random request ID.
The hash binds current owner/company, transaction, account/consent, source/original
versions and hashes, invoice identity/reference/currency/direction/amount/balance,
complete reference census, workspace revision, vector and note. It is not itself
bank evidence: all trusted sources are reread and validated before new writes.

Node performs final snapshot comparison and all ledger rows plus one audit/
idempotency receipt inside `BEGIN IMMEDIATE`, with no awaited work inside the
write transaction. Sites commits one cloned state plus audit/receipt under a
single D1 batch/CAS, the existing commit-time consent/source fence and additional
document metadata predicates. Any failed row, audit insert or fence rolls back
the complete result. Both retain explicit manual provenance.

The durable audit receipt is keyed by current owner/company and request ID. An
identical retry returns the stored actual outcome without revalidating historical
consent or writing money again. Changed intent under the same key is rejected.
Current user/company authorization still applies. An unreadable receipt after a
lost response leaves outcome unknown, with no invented failure audit.

Original bytes are read and hashed again on commit. D1 fences bind original
metadata and workspace bank payload, while immutable object keys/hash checks
retain their existing storage contract. D1 metadata predicates do not promise
cross-store atomic immutability against an out-of-band R2 overwrite; that limit
must remain explicit in the final evidence.

## UI and verification

The entry sits next to the existing bank review/proposal. The edit screen lists
every invoice/reference, its remaining debt and amount. The final review shows
each resulting invoice remainder, payment remainder and manual provenance;
changing a row invalidates the quote. Only the final confirmed action writes.

Focused tests cover two/three odd-cent vectors, under/overpayment, both-rest
rejection, exact/omitted/conflicting references, all evidence boundaries, stale
quotes, same/different concurrent requests, payload collisions, half-write and
audit failure rollback, replay after revocation and lost-response recovery.
Node/Sites policy and UI behavior must agree. Independent attack review follows
the first complete implementation. No score is assigned by this work.
