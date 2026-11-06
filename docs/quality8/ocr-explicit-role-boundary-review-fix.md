# Follow-up: uniform explicit party boundaries

Independent review of `6d6968dffa2eb68b8f2c217b598e3e7a9e86603f` found that the new `Faktureras till:` form could accept a composite recipient name when a bare competing role or unknown colon field followed it. A complete native-PDF fixture became green with that composite identity. The colonless form already held the same ambiguity.

## Narrow correction

The same existing competing-role and unknown-colon/column checks now apply to every name occurrence, whether or not the first role label has a colon. The invalid occurrence remains in the full census; another valid occurrence cannot hide it. Two separately explicit colon-labelled roles remain separate supported events. No layout rule, scalar grammar, OCR parameter, field confidence, original observation or gold file changes in this follow-up.

Only the two byte-identical `invoice-details.js` product modules change, with one logical condition and its explanation changed in each.

## Unchanged reproductions and positives

The reviewer's 40-case Node/Sites × PDF/OCR matrix is copied byte-identically into `sites/tests/review-explicit-recipient-boundaries.test.mjs`, SHA-256 `36ba2a360e5b47a7d242819f90f95b4641464f32400c2caf87a5981ad88d5545`.

- Before: **24 passed, 16 failed**, no skips.
- After: **40 passed**, no skips or input/assertion changes.
- Sixteen additional positive controls passed both before and after, including colon/bare recipient forms, legitimate `Kundservice` inside a company name, diacritics/ampersand, and two separately explicit colon roles.
- Combined targeted text/word regression: **712/712**, no skips, zero recognition calls.
- Sites TypeScript, detail byte parity and diff check passed.

The accompanying JSON records all four original failing source forms for both engines and both methods, their exact input hashes and actual before/after fields. For native PDF each was green before; afterward the recipient and selected party are null and the document requires review. Existing OCR confidence limits remain in effect.

The previously frozen `ocr-explicit-layout-known-regression.json` is unchanged, SHA-256 `dd25d647b95e942ddf268d85322a14297acbeb5a4ee8a215dd3217118f178db0`; it still binds the earlier geometry source, not this follow-up. No holdout has been rerun and V3 has not been read.

## Separate review boundary

The reviewer subsequently reported a different geometric table-heading issue involving parser-supported `Artikel`/`Item`. It is **not fixed or judged closed by this role-only commit**. The overall geometry change remains blocked pending that separate correction and independent review. This report claims only the reproduced party-boundary fix and its local verification, not overall READY or an acceptance score.

Reproduce this regression without OCR:

```sh
NODE_ENV=test /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --import ./scripts/saas-test-isolation.mjs --test \
  sites/tests/review-explicit-recipient-boundaries.test.mjs \
  sites/tests/ocr-explicit-role-boundary-positive.test.mjs
```
