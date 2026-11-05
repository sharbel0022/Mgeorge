# Preregistered independent image-OCR holdout

This is a new, wholly synthetic holdout for the image-OCR criterion in `docs/quality8/PLAN.md`. The target runtime is exactly `6325f2d63565e2ab2bd9c02e5e6d3fc50cd04608`. The corpus, separate gold, generated PNG bytes, source inventory, measurement harness and thresholds are committed before the first OCR call. The result is saved afterward in a separate commit. No production source is changed.

## Population fixed before measurement

Eight readable, single-page Swedish supplier invoices cover different conventional layouts, serif/sans-serif type, four date notations, comma/point decimal notation, grouped/ungrouped amounts, three- and four-digit Bankgiro prefixes, payment details at the header/side/footer, and label/value fields on one or two lines. Body text is 29–36 pixels at 1600 × 2000 pixels. The invoices use explicit Swedish field labels, SEK and 25% VAT. They are an intentionally varied small sample, not a random sample of customer originals.

The two stress inputs are separate predetermined populations: a 36 × 45 pixel downsample enlarged to the original dimensions, and an otherwise readable invoice with opaque damage over payment instructions and the complete monetary summary. Their gold retains the facts of the uncorrupted source. They are never pooled into normal precision/recall and never replace a failed normal case.

All ten contact-sheet images were inspected before freezing; the two-column and stacked-field normal images were additionally inspected at full size. The normal cases have no intentional damage or overlapping text. Text bounds are recorded, and the generator refuses an overflowing line. No OCR or application field parser was invoked for this visual inspection. Before freezing, one generator-only change put PNG files in their reproducible `images/` directory; both renderings produced the same ten image hashes. No OCR-driven layout or answer correction occurred.

## Frozen answers and rules

`documents.json` describes the printed content and fixed layouts. `gold.json` separately records the manually specified canonical answers; it is not derived from OCR or application parser output. All thirteen scalar fields are annotated on every document. Ten mandatory fields are reported separately: invoice number, supplier, organization number, invoice date, due date, total, net, VAT, direction and currency.

Direction is supplied `supplier` metadata, matching the existing measurement chain. It is not recognized from pixels; a separate nine-field required-image breakdown excludes it. Invoice numbers, organization numbers, payment destinations and references are synthetic strings, not claims of real account ownership.

Each parser gets its own normal precision and recall gates: at least 98% precision and 85% recall, reported both for all thirteen and for the ten mandatory fields. This holdout's conservative overall decision requires both scopes on both parsers, zero false-green critical decisions and non-green results for both stress inputs. The full metric definitions, critical field list and exact hashes are in `manifest.json` and the committed runner. No threshold, source, gold or selected image changes after the first measurement; misses remain misses.

The actual Node document worker runs once per input. Its unedited text, actual confidence and hash-bound word evidence feed the real Node and Sites field parsers once each, using the repository's existing metric helper. Sites therefore shares the worker's OCR result: this is not independent browser/cloud OCR or a production upload/registration/payment journey. OCR's manual-review policy is retained, so absence of green decisions alone cannot prove useful field accuracy.

## Reproduction

Use the already installed dependencies and the direct Node 24 executable. The generator refuses to overwrite a prior directory:

```sh
/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
  scripts/quality8/generate-ocr-holdout.mjs --output /tmp/new-ocr-holdout-render
```

The eight normal and two stress PNG hashes should match this manifest when the recorded canvas version and font files are identical. Manifest creation time naturally differs; the frozen PNGs remain the authoritative measurement inputs. Do not replace them with platform-dependent rerendered bytes.

For measurement, make an isolated archive of the exact target's `src/`, `sites/lib/` and root/Sites dependency manifests, and link the existing installed `node_modules` read-only by convention. Pass that archive to the runner; it checks every frozen source hash, local trained-data/dependency hash, committed harness, gold and image hash before invoking OCR:

```sh
/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
  scripts/quality8/measure-ocr-holdout.mjs \
  --source-root /tmp/exact-6325-source \
  --output /tmp/new-ocr-holdout-result.json
```

The runner refuses to overwrite a previous measurement. It checkpoints all cases and writes an explicit `passed: false` for a valid below-threshold result. Reproduction after the initial held measurement is regression evidence, not a new independent holdout. The final report must keep that distinction.

## Source-change boundary

The manifest contains every tracked `src/` and `sites/lib/` file plus dependency manifests (187 files), the precise transitive optical/parser graph (27 files), and the contextual downstream import/domain/economy/presentation graph (51 files). These sets can overlap: Sites imports `parseMoney` from `domain.ts`. A later domain edit therefore changes an optical-graph file even if it only changes a separate presentation function. Such a change must be compared explicitly; hash identity of the worker/parser entry points alone is insufficient to claim an identical graph. Downstream code is hashed for traceability, not exercised by this field-accuracy test.
