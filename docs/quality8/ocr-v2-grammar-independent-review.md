# Independent review: explicit V2 grammar

## Decision

**NOT READY** on `abe5c1e099143ca59015562c5047b252ba9952bb`, compared with
`571073b8172ab53899a4ce3c2b717c7fe24daee2`.

The intended new standalone summary aliases and explicit colonless supplier
name work, and the delivered 56 tests pass independently. Further synthetic
counterexamples expose false green native-PDF results and a legitimate identity
regression. The author received the unchanged reproductions and paused the
subsequent layout work to address these findings.

This is a read-only production-code review. It introduces only independent
tests and evidence. There were no optical calls during this grammar review,
no live integration requests, no production writes and no changes to the first
V2 result, images or gold. The separate two-call optical diagnosis is preserved
in `e653a8d12fc276e2d6d0ecdbc1710101fd64b3d1` and is not an acceptance run.

## Important: the inline VAT boundary is broader than its census

In both `src/invoice-extraction.js` and `sites/lib/invoice-fields.js`, the new
`siblingLabel` accepts colonless `Summa moms` anywhere after another field.
The corresponding `vatLabel` accepts the colonless alias only at line start;
an inline occurrence requires a colon. Consequently the new sibling boundary
can discard an extra VAT observation without validating it.

Minimal modification of an otherwise complete synthetic invoice:

```text
Netto: 1496,00 SEK Summa moms oläsligt
Momsbelopp: 374,00 SEK
Att betala: 1870,00 SEK
```

On 571 the net value stays null and the document is yellow. On abe5 the result
is net 149600, VAT 37400, total 187000, **green**, `issues: []`. Replacing the
unreadable text with the contradictory `Summa moms 375,00 SEK` gives the same
false green result. Both actual parsers reproduce it. In OCR context the fixed
confidence ceiling still prevents green, but the extra amount is still missing
from the field evidence/census.

Required outcome: either retain the unsupported suffix and hold the containing
value, or account for the complete explicit sibling observation. A field
boundary must not silently erase a conflicting or unreadable observation.

## Important: the new name paths can admit non-name content

The new bare supplier event and expanded heading need the same full source
validation as the actual name consumer. Reproduced native-PDF changes are:

| Synthetic source | 571 | abe5 |
| --- | --- | --- |
| `Leverantör namn` followed by `Avtal: TEST-803` | party null, yellow | party `Avtal: TEST-803`, green |
| `Leverantör Syntetiska Granhed System AB Summa moms 374,00 SEK` | party null, yellow | the complete name plus VAT label/value becomes party, green |
| `Leverantör saknas` | party null, yellow | party `saknas`, green |
| `Leverantör ej angiven` | party null, yellow | party `ej angiven`, green |

The newly expanded heading event is not marked `bare`, so the unknown-colon
check applied to bare events does not guard its next-line borrowing. In the
inline-money case, the scalar boundary has the VAT alias limitation above and
the bare-event guard only excludes recognized competing roles or colon/pipe
characters. Explicit absence phrases pass the existing permissive `nameValue`
validator through the newly added path.

The same unexpected values occur in OCR context, although its unchanged review
ceiling prevents green. A name may safely remain null; a correctly separated
real name is also allowed by the independent test. The monetary label/value,
unknown explicit field and absence phrase must never become the company name.

One combined case, a bare supplier followed by contradictory inline VAT, also
demonstrates an older missing amount-census gap on 571: the old document was
still held because it lacked a party, while abe5 adds an incorrect party and
can make the document green. This is distinguished from the new after-net
boundary regression rather than presented as a wholly new older-field bug.

## Minor: an organization owner becomes an extra empty name

The existing supported owner labels `Supplier organization number:` and
`Seller org number:` overlap the new bare supplier prefix. The parser creates
both an organization event and a name event at index zero. The extra name has
an empty value, so a previously valid explicit supplier name is invalidated.

With the same complete invoice and valid organization value `556016-0680`,
571 preserves the real supplier name and is green. Abe5 returns party null and
yellow with an invalid-name issue. Both engines and both extraction contexts
show the unnecessary hold. The valid organization event must retain its role
without inventing a second name event. Invalid organization values must still
remain in the census.

## Focused verification

The review ran the exact source archive in
`/tmp/mgeorge-v2-grammar-review-fhluchnz`, with existing dependency symlinks and
direct Node `v24.22.1`. All test calls used
`NODE_ENV=test` and `scripts/saas-test-isolation.mjs`. No dependency installation
or mutation was required.

| Population | Pass | Fail | Skip | Duration |
| --- | ---: | ---: | ---: | ---: |
| Author's 56 cases, abe5, independent rerun | 56 | 0 | 0 | 759.484 ms |
| Independent 64 cases, old 571 | 52 | 12 | 0 | 657.187 ms |
| Same independent 64 cases, abe5 | 28 | 36 | 0 | 758.731 ms |

The independent population is **16 synthetic texts × 2 actual engines × 2
contexts (native PDF and OCR)**. The same file and assertions were used for
both versions. This deliberately adversarial review matrix is not a precision,
recall, coverage or production performance measurement. The old 12 failures
include intended new-feature positives and previously unsupported aliases;
the raw count must not be used as a general quality comparison.

The following meaningful controls remain green in the candidate matrix:

- an unchanged complete invoice;
- the intended explicit bare supplier plus both standalone new summaries;
- unresolved mixed supplier/recipient headings remain held;
- a damaged percentage after Summa moms remains null;
- an unreadable new total alias on another page remains in the full census;
- both summary-like article descriptions remain complete article rows and do
  not supply document totals.

The four production-file hashes and all individual test outcomes are retained
in `ocr-v2-grammar-independent-review.json`. The two detail modules are
byte-identical. The frozen independent test file is
`sites/tests/review-v2-explicit-grammar-independent.test.mjs`, SHA-256
`135175e9990f0bbe6661e56a0f29efd3f9e05d0ce2034c22ccc168fc3cfd3f8e`.

Run against the checkout containing the reviewed modules:

```sh
NODE_ENV=test /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --import ./scripts/saas-test-isolation.mjs --test \
  sites/tests/review-v2-explicit-grammar-independent.test.mjs
```

For a separate source archive, set `REVIEW_SOURCE_ROOT` to its absolute path;
the test then loads that archive's actual Node parser and Sites module loader.

## Handoff and limits

The fixed 64-case file was sent to the author before any response edit. Recovery
owns the production correction. It must pass unchanged on the next frozen SHA,
along with the meaningful existing positives; the source-bound layout changes
require a later separate review. This report does not claim the author's wider
290-test run as independently rerun, and it makes no quality-score or independent
holdout-success claim.
