# Search and proposal review follow-up — 2026-11-05

## Review scope and reproduced defects

This follows the independent read-only review of payment/search commit
`7d58953bccdd16e531db2465bd3e9f69e9458bed`. It changes search interpretation and
the proposal transport guard. No financial write or bank-evidence policy changes.

1. With synthetic invoice `123` for 456.00 SEK and another invoice for
   123,456.00 SEK, `123 456,00` returned only the large invoice. Reversing the
   query terms returned invoice `123`. The parser had consumed the reference as
   a thousands group.
2. The proposal guard accepted `VERIFIED`, available/allocated 62,500 minor units
   even when `reportedAmountMinor` was 0, 1 or -1. This guard gap predated the
   search/payment commit. A negative reported amount with the same absolute
   value could also retain an invalid verified status.

Five added regression groups failed against the preceding implementation
(35 passed, 5 failed), including activation of the actual Sites search component.

## Corrections and conservative boundaries

Search keeps the complete Swedish thousands amount and alternative splits at
its group boundaries. An extracted prefix must match an **exact saved
reference**. It cannot become a fuzzy text term. Results from the valid readings
are combined, deduplicated by the existing single pass over index entries and
ranked with exact references first. Thus both relevant invoices remain visible,
with their own invoice numbers and amounts. The search opens no record until
the user activates a result.

Every other query term and amount group must still match that same record.
Alternatives are evaluated independently per amount group rather than forming
an exponential combination. The existing 512-character and 32-term bounds remain;
numeric group tokens now count toward the term bound. Node and Sites use identical
source, with the same tested classic-script adapter for the Node browser UI.
Ordinary explicitly entered text terms retain their existing substring search;
the new recovered numeric prefixes require exact references.

The proposal guard now requires `availableMinor <= abs(reportedAmountMinor)`.
Nonpositive reported amounts and `REVERSAL_OR_OUTGOING_PAYMENT` decisions must
be `BLOCKED`, which already forbids allocations. Legitimate blocked negative
payments retain their absolute availability for display. A positive bank amount
larger than the remaining available balance is allowed, preserving the case of
previous allocations. Malformed transport data cannot display invoice proposals.

## Verification and measurement

- RED: 5 new failing groups among 40 tests.
- GREEN: 40/40 in those same search and proposal tests.
- Expanded focused verification: **207/207**, no skips. Includes both C4 contract
  suites, both synthetic payment acceptance suites, the actual Node list filter,
  Sites search activation, proposal rendering and source/adapter parity.
- `tsc --noEmit --incremental false` and `git diff --check`: passed.
- No production requests, external messages, financial writes or customer data.

The separate reproducible measurement is
`scripts/measure-search-review-followup.mjs`; results are in
`docs/quality8/search-review-followup-measurement.json`. It compares the frozen
reviewed search module to the follow-up module on the same 10,000 synthetic rows,
12 fixed scenarios, three warmups and twenty samples per scenario.

| Metric | Reviewed commit | Follow-up |
|---|---:|---:|
| Correct scenarios | 7/12 | 12/12 |
| Slowest scenario p95 | 25.60 ms | 15.45 ms |
| Input mutations | 0 | 0 |

The follow-up index took 265.68 ms to build. This is a small local CPU comparison
on a shared development host, not a browser measurement or production latency
guarantee. It contains exact-reference, multiple-boundary, date, ordinary
thousands, negative, leading-zero, maximum-term, empty and unmatched cases.
Both source hashes are recorded. The earlier search measurement is retained as
historical evidence for its original source hash; it does not measure this fix.

This follow-up does not claim new operational bank payer/reference evidence or
an approved multi-invoice write flow. The C4 multi-invoice proposal remains
read-only and `REVIEW`. No rating changes are inferred from these synthetic tests.
