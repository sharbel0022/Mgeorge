# Known V2 replay after the a19 parser repair

Exact parser source: `63edd9fa97bc0475237133021313963e402efc76`.
This is a known development-data regression replay, not a fresh optical result, independent holdout, acceptance measurement or score change.

The unchanged baseline runner executed the same 52 Node/Sites parser calls on 26 variant/input cases drawn from the same 12 V2 images. Original bytes, text, raw-response/raster hashes, metadata and confidence were identical to the a19 baseline. The metric helper, gold, first-pass result and PSM6 result hashes matched exactly. Source graph bytes matched the exact product commit before parsing and remained unchanged afterward. No new optical calls were made; V3 was not read or run.

## Current results and retained history

The repaired source retains **57/100 mandatory10 fields** and **79/130 all13 fields** on the ten normal stored-PSM3 texts. The historical a19 artifact remains unchanged (SHA-256 `15e1c73339c6bcaf505d1dc89d24fb29685bd58de009a52e35831d8352a2f1a7`). These new current-source figures therefore equal the historical figures; they do not indicate a recognition improvement.

Node and Sites have identical outcomes. The table reports each parser separately through their common figures; it does not combine engines or overlapping variants into a larger sample.

| Saved input | Population (documents) | Fields | TP / FP / FN | Precision | Recall | Exact documents | Critical false greens |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Stored PSM3 text | normal-readable (10) | all13 | 79 / 0 / 51 | 100.00% | 60.77% | 0 | 0 |
| Stored PSM3 text | normal-readable (10) | mandatory10 | 57 / 0 / 43 | 100.00% | 57.00% | 0 | 0 |
| Stored PSM3 text | normal-readable (10) | image9 | 47 / 0 / 43 | 100.00% | 52.22% | 0 | 0 |
| Stored PSM3 text | stress (2) | all13 | 9 / 0 / 17 | 100.00% | 34.62% | 0 | 0 |
| Stored PSM3 text | stress (2) | mandatory10 | 7 / 0 / 13 | 100.00% | 35.00% | 0 | 0 |
| Stored PSM3 text | stress (2) | image9 | 5 / 0 / 13 | 100.00% | 27.78% | 0 | 0 |
| Known PSM6 raw | normal-readable (10) | all13 | 60 / 2 / 70 | 96.77% | 46.15% | 0 | 0 |
| Known PSM6 raw | normal-readable (10) | mandatory10 | 50 / 0 / 50 | 100.00% | 50.00% | 0 | 0 |
| Known PSM6 raw | normal-readable (10) | image9 | 40 / 0 / 50 | 100.00% | 44.44% | 0 | 0 |
| Known PSM6 raw | stress (2) | all13 | 9 / 0 / 17 | 100.00% | 34.62% | 0 | 0 |
| Known PSM6 raw | stress (2) | mandatory10 | 7 / 0 / 13 | 100.00% | 35.00% | 0 | 0 |
| Known PSM6 raw | stress (2) | image9 | 5 / 0 / 13 | 100.00% | 27.78% | 0 | 0 |
| Two preserved PSM3 raw pages | normal-readable (2) | all13 | 18 / 0 / 8 | 100.00% | 69.23% | 0 | 0 |
| Two preserved PSM3 raw pages | normal-readable (2) | mandatory10 | 13 / 0 / 7 | 100.00% | 65.00% | 0 | 0 |
| Two preserved PSM3 raw pages | normal-readable (2) | image9 | 11 / 0 / 7 | 100.00% | 61.11% | 0 | 0 |

All 52 field-value sets, field evidence, document levels and party results equal a19. 22 issue lists changed only in their organization warning: a corrupt/unreadable unowned occurrence now has the explicit invalid-organization warning instead of the generic unclear-role warning. The complete before/after issue arrays are retained in the comparison JSON. No field was gained or lost.

The normal PSM6 `kind=other` false positives in 08 and 10 remain present and red. All stress results remain red. There are no critical false greens in this replay, and there are no exact normal documents. The two separately preserved PSM3 raw pages are 05 and 09; no geometry is invented for the other ten stored PSM3 observations.

## Evidence and reproduction

- `known-ocr-replay-63edd9f.json`: all inputs, 52 outcomes, source graph/hashes and complete metrics.
- `known-ocr-replay-63edd9f-comparison.json`: exact baseline comparison, current precision/recall, all changed diagnostics and artifact hashes.
- `known-ocr-replay-runner-63edd9f.mjs.txt`: byte-identical baseline runner, SHA-256 `92dd331faa793273feab7638091eb5e668653710d8834d318d5771b356078542`.
- `known-ocr-replay-63edd9f.log`: unabridged successful process output.

The runner was copied temporarily to its original `scripts/quality8/replay-ocr-field-observations.mjs` location so its existing relative imports and source-root resolution stayed unchanged. It was removed after the run. To reproduce, restore those captured bytes to that path and use a new output filename; the runner refuses to overwrite an earlier result. The unchanged metric helper is SHA-256 `e799e8e7b759f1cc20aeae946d479b7bae4c730fef45fd015a5c809c42cc0ada` and the unchanged gold is SHA-256 `943a3f9039726d50817de5ad5e913c85aa5210f52e70db487be18e4bb5840af0`.

```sh
NODE_ENV=test /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --import ./scripts/saas-test-isolation.mjs scripts/quality8/replay-ocr-field-observations.mjs --source-commit 63edd9fa97bc0475237133021313963e402efc76 --output docs/quality8/a19-parser-regression/known-ocr-replay-63edd9f.json
```

Only new evidence files were committed for this task. Product, fixtures, metric helper and prior baseline were not changed. B remains paused pending independent review.
