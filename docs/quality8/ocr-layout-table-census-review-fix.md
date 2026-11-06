# Follow-up: reuse the parser's table-header census

Independent review of the horizontal layout change found that its legacy table-heading vocabulary was narrower than the invoice parser's vocabulary. A recognized `Artikel / Antal / Netto`, `Item / Quantity / Netto` or `Beskrivning / Kvantitet / Netto` header could therefore fail to block an article named `Netto`. When quantity `1` and row amount `480,00` were emitted in a separate raw OCR row, layout could join them into a wrong document net amount `148000` öre. Both actual parsers reproduced the error. These examples remained non-green, but the incorrect field association is itself a release-blocking defect.

## Narrow correction

Both byte-identical detail modules expose a boolean wrapper around their **unchanged existing** table-header detector. Layout calls this shared detector on the original raw row text, preserving its spaces, tabs and pipe delimiters. It retains the earlier broader layout barrier as an additional blocking condition. This reuses the authoritative complete/incomplete header grammar, including description, quantity, unit-price and VAT-rate variants, rather than maintaining another incomplete alias list.

The same cached header result establishes the horizontal table boundary and the existing excluded-row state. No table ending is inferred, no distance is enlarged, no table value is calculated, and no field or word confidence is raised. The parser's own table algorithm is unchanged; the two detail-file edits only add the read-only export. Browser code receives the same pure JavaScript helper through the existing shared layout module.

## Reproductions and verification

The independent file `sites/tests/review-layout-table-census-independent.test.mjs` is byte-identical to the reviewer's frozen matrix, SHA-256 `332ec4b13aed08ac7ec46eb870b139d52aa17e8c7e4f47654232ac0c626cbe06`.

- Before: **6 passed, 6 failed**, no skips.
- After: **12 passed**, no input or assertion changes.
- Eight supplemental Node/Sites cases cover already-supported `Artikeltext/Kvantitet`, pipe-delimited unit-price columns, tab-delimited VAT-rate columns and incomplete headers without a description column.
- Full targeted text/word matrix, including the preceding identity fix: **732/732**, no skips, zero OCR calls.
- Sites TypeScript, detail byte parity and diff check passed.

The JSON receipt preserves the exact three synthetic sources and their word boxes. The actual before helper produces `Netto 1 480,00`; the actual after helper keeps the original source unchanged. Passing both outputs through the actual Node/Sites consumers changes the net amount from `148000` to null. Existing positive cases above later tables and the older vertical summary cases remain green.

The preceding colon-boundary correction is separately frozen in `27caeb3fdbe206937a1004a32d58845923c21c8e` and received the reviewer's scoped READY. This commit does not amend its original evidence or the earlier known-image replay. The latter still has SHA-256 `dd25d647b95e942ddf268d85322a14297acbeb5a4ee8a215dd3217118f178db0` and describes source `6d6968d`, not this follow-up. No new optical measurement, corpus edit or V3 access occurs here. Exact independent re-review of the table correction remains a release gate.

Run the focused reproductions without OCR:

```sh
NODE_ENV=test /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --import ./scripts/saas-test-isolation.mjs --test \
  sites/tests/review-layout-table-census-independent.test.mjs \
  sites/tests/ocr-layout-table-grammar-parity.test.mjs
```
