# Known V2 response replay after explicit-layout changes

**This is a re-interpretation of two saved, already known OCR observations: zero new OCR calls in this replay, not a holdout or an acceptance measurement.** Both documents still require review. The original failed V2 result and gold remain byte-identical. The earlier three unintended recognition calls on old synthetic Bankgiro fixtures are a separate, explicitly recorded deviation; this report does not erase them.

## Exact inputs and source

| Item | Binding |
|---|---|
| Before source | `ae56dc9a9e3d76697e38a196692a337ae0900b0d` |
| Frozen after source | `6d6968dffa2eb68b8f2c217b598e3e7a9e86603f` |
| Full diagnostic packet commit | `e653a8d12fc276e2d6d0ecdbc1710101fd64b3d1` |
| Packet manifest SHA-256 | `df914f43de498b6f01efc961735113a6f6bbd576c84b688dd510b502c5ae5ed2` |
| Original V2 result SHA-256 | `13557c3012331fa0101fbe3e6fe498fd2fbf3346b8740cfe5fe4b83e8393b6e7` |
| Unchanged V2 gold SHA-256 | `943a3f9039726d50817de5ad5e913c85aa5210f52e70db487be18e4bb5840af0` |
| New result file | `docs/quality8/ocr-explicit-layout-known-regression.json` |
| New result SHA-256 | `dd25d647b95e942ddf268d85322a14297acbeb5a4ee8a215dd3217118f178db0` |
| New result bytes | 227057 |
| 28-file source inventory SHA-256 | `a4b4cda2785eaef8b99c6cf3395f59a56c48e1807215c768a546bc2fe5d79746` |

The inventory hash is SHA-256 of `JSON.stringify(result.sourceHashes)` in its recorded order. The runner checks the existing local optical dependency graph against the exact Git commit before loading the parsers, then verifies it is unchanged afterward. Exactly three product files differ from the before source: the shared layout helper and both party-detail modules. This graph is a source binding, not a claim that every module in it executed. No worker or recognizer is called by the runner.

All 37 diagnostic packet files passed byte-length and SHA-256 verification before and after replay. The known normal 09 observation retains all **85** original word objects and confidence values; normal 05 retains all **92**. Their original overall OCR confidences remain **93** and **90**. Every word appears exactly once, and the sorted text tokens are unchanged. The actual stored original-input hash, reconstructed text and retained words are used by the unchanged Bankgiro evidence collector/binder/assessor.

The runner performs eight actual parser calls: two documents × before/after × Node/Sites. Before-layout text matches each sealed diagnostic worker text byte for byte. The original diagnostic texts were previously verified against the first V2 text; this does not establish the equality of bounding boxes that were not captured during that first V2 run.

## Observed metrics

Node and Sites produce identical field values and classifications. Counts below are **per engine**, over only these two known normal documents. Do not add the two engines together as if they were four independent documents.

| Field scope | Before TP / FP / FN | After TP / FP / FN | Precision before → after | Recall before → after |
|---|---:|---:|---:|---:|
| All 13 fields | 17 / 0 / 9 | 18 / 0 / 8 | 100% → 100% | 65.38% → 69.23% |
| Mandatory 10 | 12 / 0 / 8 | 13 / 0 / 7 | 100% → 100% | 60.00% → 65.00% |
| Image 9, excluding metadata direction | 10 / 0 / 8 | 11 / 0 / 7 | 100% → 100% | 55.56% → 61.11% |

Exact documents remain **0/2**. Both documents remain held for review; there are **0 false-green critical decisions**. Normal 09 remains red and normal 05 remains yellow. No stress observation was included in this two-image replay, so it provides no new stress result. No threshold or field-scoring rule was changed. Durations in the JSON measure only synchronous parsing, not recognition or end-to-end processing.

### All 13 field outcomes

Amounts in this table are integer öre. “Unchanged” means the before and after actual values are identical; it does not mean the field is correct if it remains null.

| Field | Normal 09 before → after | Normal 05 before → after |
|---|---|---|
| Invoice number | `284-6119`, unchanged | `701682`, unchanged |
| Supplier party | null → `Exempel Styrsystem AB` | null → `Exempel Pump & Värme AB` |
| Organization number | `5597623197` → null | null, unchanged |
| Invoice date | `2026-08-04`, unchanged | `2026-07-02`, unchanged |
| Due date | `2026-09-03`, unchanged | `2026-07-22`, unchanged |
| Total | null, unchanged | `1210900`, unchanged |
| VAT | null, unchanged | null, unchanged |
| Net | null, unchanged | `968720`, unchanged |
| OCR/payment reference | `00863025193`, unchanged | `00863025151`, unchanged |
| Bankgiro | `827-3641`, unchanged | null, unchanged |
| Direction | `supplier`, unchanged | `supplier`, unchanged |
| Kind | `invoice`, unchanged | `invoice`, unchanged |
| Currency | `SEK`, unchanged | null, unchanged |

The supplier names are now established by their explicit role headings and uniquely aligned name segments. Both recipient names are also retained correctly as `Testmottagaren Handel AB` in detail evidence, although the 13-field metric scores only the selected supplier party. The same indivisible-row census requires both role columns to be resolved; it does not accept only the convenient half of a merged source row.

Recognizing both roles exposes the ownership uncertainty of normal 09's unqualified footer organization number. The old result assigned that number while only one named role existed. The new result leaves it null, with an explicit ambiguous-role issue, rather than transferring the last emitted role or assuming all footer identities belong to the supplier. This is one lost correct field under the gold rubric, and is included in the reported FN count. Two recovered supplier names minus this held organization number explain the net improvement of one field.

## Precisely what remains unresolved

No new horizontal monetary pair is recovered in these two diagnostic images. Their useful change is the explicit role columns. The horizontal feature has synthetic positive coverage but this small known-image subset does not demonstrate a monetary recall gain.

For normal 09, actual minimum glyph heights, not union heights or the larger value font, determine reach:

| Label → printed value | Right gap | Minimum label glyph height | Maximum gap, 16 × glyph height | Outcome |
|---|---:|---:|---:|---|
| `Netto` → `15 324,00` | 733 px | 31 px | 496 px | Outside reach; raw row also has unresolved damaged-rate prose |
| `Summa moms` → `3 831,00` | 596 px | 22 px | 352 px | Outside reach |
| `Att betala` → `19 155,00 SEK` | 497 px | 30 px | 480 px | Outside reach |

All three also occur below an identified table, where the new horizontal path remains prohibited without a proven table ending. Reach was not increased. The damaged `25 246` prose remains uncorrected and present in full.

Normal 05 retains the raw `Bankgiro Summa exkl. moms …` row and the damaged `Moms (25 90) …` value. Bankgiro, VAT and currency remain invalid according to the unchanged scalar/evidence checks; the unqualified organization number remains unowned between the two roles. Existing valid net and total values remain exactly as before. This replay does not claim to repair punctuation, percentages, table endings or unlabelled ownership.

## Reproduction

Use the frozen product commit and the full `docs/quality8/ocr-v2-post-holdout-diagnostic/` directory from diagnostic commit `e653a8d…` as `PACKET_ROOT`. The checked-in runner rejects changed packet bytes, changed product bytes and an existing output filename. This command does not call OCR:

```sh
NODE_ENV=test /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --import ./scripts/saas-test-isolation.mjs \
  scripts/quality8/replay-explicit-layout-diagnostic.mjs \
  --packet-root "$PACKET_ROOT" \
  --source-commit 6d6968dffa2eb68b8f2c217b598e3e7a9e86603f \
  --output /tmp/ocr-explicit-layout-new-replay.json
```

The preceding product verification is recorded separately: **656/656** text/word cases, TypeScript, byte parity and diff check. The source-bound JSON retains all actual before/after text, word indices, evidence, field values and per-engine metrics. Independent code review and a new genuinely blind measurement remain separate release/acceptance gates. V3 was not accessed by this work.
