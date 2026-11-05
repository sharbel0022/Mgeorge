# Independent optical holdout v2 — preregistration

This is a new, separate, synthetic holdout. It does not replace, relabel or pool with `ocr-holdout-v1`, its eight normal/two stress images, or its recorded failing results.

## Frozen before any OCR

The corpus contains **10 readable Swedish supplier invoices and 2 separate stress images**, each a 1600 × 2000 PNG. Ten new layout arrangements use five ordinary sans/serif font families. Normal field/body text is 28–36 pixels; the invoice title is larger and the non-field synthetic footer smaller. Inline fields, values below labels, two-column addresses, item tables, and varied natural payment/VAT sections are represented. All amounts are SEK, with 25% VAT. This is a purposive printed single-page sample, not a random production sample.

`documents.json` specifies the rendered pages. `gold.json` contains separate literal canonical answers for every one of the 13 scalar fields, including all original facts for the two damaged images. The generator reads the specification, not the gold. The gold is never created from OCR, extracted text or application-parser output.

All twelve full-size images and three contact sheets were viewed before freezing. `visual-qa.json` records that check. Contact sheets, planned text coordinates and document specifications are **not OCR inputs**. The actual input is each exact PNG byte sequence listed in `manifest.json`.

The implementation's delivery SHA was not known when the corpus and measurement contract were frozen. Accordingly, the manifest explicitly leaves source binding pending. After root sends that frozen SHA, a separate committed binding records the exact source tree, hashes of every tracked `src/` and `sites/lib/` file, dependency manifests, local optical/downstream import graphs and installed OCR/model artifacts. No parser/OCR execution is permitted before that binding is committed.

## Predetermined acceptance

Each parser is evaluated separately on the normal population, using the same optical output from the unchanged selected Node worker:

- **All 13 scalar fields:** precision ≥ 98% and recall ≥ 85%.
- **The same mandatory 10 fields as v1:** precision ≥ 98% and recall ≥ 85%.
- **Critical false-green count:** zero.
- **Both stress images:** non-green/safe abstention; retained original gold is not rewritten to null.
- **Image-derived mandatory 9:** reported separately after removing supplied direction metadata. No image-recognition claim is made for direction.

The unchanged `test/helpers/ocr-quality-metrics.mjs` defines exact field comparison, TP/FP/FN, document exactness and the strict false-green metric. A wrong non-null value counts as both FP and FN. Missing known data counts as FN. No failure, error, abstention or inconvenient field may be removed from its preregistered population. No averaging across parsers or normal/stress populations can turn a failure into a pass.

Direction and direction confidence are supplied context; they are not recovered from pixels. OCR source policy requires manual review even when all fields are correct. Zero false-green results alone does not establish automatic financial approval. The twenty normal parser evaluations correspond to ten shared optical images, not twenty independent images.

The first complete measurement of a delivered candidate is retained regardless of outcome. Corpus, gold, thresholds, harness and runtime artifacts must not be tuned using those outputs. An infrastructure interruption must be recorded and any repeat identified explicitly. V1 evidence remains visible and independent.

## Binding and later measurement

Do not run these commands until root supplies the frozen implementation SHA. The scripts refuse an uncommitted or mismatched corpus/harness/binding and never overwrite an earlier binding or result.

```sh
node scripts/quality8/bind-ocr-holdout-v2.mjs \
  --source-root /path/to/exact-delivered-source \
  --target-sha EXACT_DELIVERED_40_HEX_SHA \
  --freeze-commit EXACT_CORPUS_FREEZE_40_HEX_SHA \
  --repository /path/to/source-git-repository \
  --output docs/quality8/ocr-independent-holdout-v2-source-binding.json
```

Commit the produced binding before the first OCR invocation, then:

```sh
node scripts/quality8/measure-ocr-holdout-v2.mjs \
  --source-root /path/to/exact-delivered-source \
  --binding docs/quality8/ocr-independent-holdout-v2-source-binding.json \
  --output docs/quality8/ocr-independent-holdout-v2-result.json
```

Use the session's direct Node 24 runtime. No model download, new dependency, cloud OCR service, live customer data or production financial operation is authorized by this measurement. A full source/runtime/corpus integrity check runs before and after measurement.

## Reproduction without OCR

`scripts/quality8/generate-ocr-holdout-v2.py --output FRESH_DIRECTORY` renders a fresh copy using the recorded local fonts and Pillow version. It refuses to overwrite a directory and does not import a product module. The committed PNGs remain the authoritative frozen inputs; regeneration never silently replaces them.
