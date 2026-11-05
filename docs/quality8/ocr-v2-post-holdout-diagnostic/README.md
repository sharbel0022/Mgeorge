# V2: two post-holdout optical diagnoses, not a new acceptance run

## Status and scope

Exactly two additional optical calls were authorized and performed, one each in
the declared order **normal-09, then normal-05**. Both used the unchanged source
at `571073b8172ab53899a4ce3c2b717c7fe24daee2`. This packet is openly
**post-holdout diagnostic evidence**. The first V2 run at
`45fd0e9d5f13071129da983996c4a6c33804f62d` remains **FAILED**. Its input images,
gold, manifest, first observations and first result were not changed.

The first V2 result SHA-256 remains
`13557c3012331fa0101fbe3e6fe498fd2fbf3346b8740cfe5fe4b83e8393b6e7`.
The source inventory SHA-256 remains
`08407f895bca7925b5efae42f3d42907e6d09d6dffbc1a071e757440731a2ed4`.
The source tree is `d4e4c7f46d9139eca1284f8410d2dc36e669fd76`.

The first run did not retain all optical blocks and coordinates. The coordinates
below belong only to these newly authorized observations. The final extracted
texts happen to match the first V2 observation hashes byte for byte; that does
not establish that the first run had identical unrecorded coordinates.

No production modules, extraction rules, score numbers, gold labels or original
V2 measurements are modified in this commit. All images and company names in
this packet are synthetic.

## Questions fixed before recognition

1. **normal-09:** Why does the visually explicit right-hand summary, with Netto,
   Summa moms and Att betala and a value on each physical row, not form a proven
   field column on unchanged 571? Is the association absent from the actual
   words/boxes, or is it stopped by an existing layout condition?
2. **normal-05:** Do the actual words/boxes support an unambiguous split of
   Leverantör and Faktureras till into exactly one company-name candidate per
   explicitly labelled role column?

The machine-readable questions and one-call-per-image restriction were saved in
`packet/plan.json` before recognition. No further optical call was made.

## Reproducible capture and integrity

The actual archived `src/invoice-worker.js` ran unchanged. An observational ESM
import hook wrapped only that worker's `tesseract.js` import, forwarded every
argument and parameter, copied the actual input PNG and complete recognition
response, and returned the original response object unchanged. PSM was the
source's existing `3` (AUTO), Swedish language, OEM 1. There was no second pass,
new segmentation setting, confidence override or text normalization.

The same source provenance functions used by V2 checked all source files against
the target commit. Source, protected corpus/harness/result files and dependency
artifacts were checked before and after. The inventory includes runtime versions,
Swedish traineddata and all Tesseract WASM artifact hashes. A later, explicitly
labelled runtime-executable supplement records the Node binary hash; it is not
represented as a pre-run capture.

Each case retains:

- `raw-response.json` and `raw-response.v8`: the complete response, including
  original blocks, paragraphs, lines, words, boxes and confidence values;
- `recognition-input.png`: the exact 2400×3000 raster sent to recognition;
- `recognition-start.json` and `recognition-finished.json`: actual arguments,
  parameters, times, input and response hashes;
- `worker-result.json`, `worker-stderr.txt` and the case `receipt.json`;
- `layout-replay.json`: a non-optical replay of the unchanged layout helper;
- `layout-trace.json`: an observational copy of that pure helper recording its
  segments, proposals, ownership claims and disabled rows. Its output was checked
  by deep equality against the unchanged helper on the exact saved response.

The capture and tracing scripts are retained under `harness/`. Their original
absolute paths are historical execution details, not instructions to rerun OCR.
`packet/receipt.json` records exactly two recognition calls, stable source,
stable protected files and stable runtime dependencies. `manifest.json` hashes
the complete retained packet and harness, including the later trace artifacts.

| New diagnostic observation | normal-09 | normal-05 |
| --- | ---: | ---: |
| Recognition calls | 1 | 1 |
| Blocks / lines / words | 17 / 26 / 85 | 8 / 20 / 92 |
| Global OCR confidence | 93 | 90 |
| Worker runtime including capture | 4,970.729 ms | 5,142.418 ms |
| Layout reconstructed at least something | true | true |
| Final worker text equals first V2 text hash | true | true |
| Worker processing error | none | none |

These timings measure this diagnostic capture, not a performance benchmark.

## Findings: normal-09

The numerical words exist and have a clear same-height relationship to their
labels, despite being emitted in later raw text blocks. Coordinates are in the
actual 2400×3000 recognition raster.

| Segment | x0–x1 | y0–y1 | Exact current condition |
| --- | --- | --- | --- |
| Netto | 1231–1329 | 1834–1865 | Known label, but its entire raw row is still table-excluded |
| 15 324,00 | 2062–2248 | 1830–1869 | To the right, overlapping the label's vertical band |
| Summa moms | 1233–1488 | 1948–1979 | Not a layout label on 571; still table-excluded |
| 3 831,00 | 2084–2248 | 1944–1983 | To the right, overlapping the label's vertical band |
| Att betala | 1230–1420 | 2062–2094 | Known label, outside the table exclusion |
| 19 155,00 SEK | 1917–2250 | 2058–2101 | To the right, overlapping the label's vertical band |

The existing candidate condition accepts only a different raw row **below** a
label, with nonnegative vertical gap and almost equal left x coordinates. It has
no same-physical-row association to the right. Thus even Att betala creates no
proposal for the printed total: its value starts above the label bottom and is
far to the right.

There is also a distinct table-boundary limitation. The raw row containing
Netto begins `Moms 25 246 beräknas på nettobeloppet.`. The complete raw row is
neither a standalone recognized label nor a colon-delimited complete field, so
the current table state stays active. Summa moms also does not end it because
that full alias is absent from this layout lexicon. The later Att betala row
does end it. The diagnostic does **not** justify ignoring the table exclusion,
discarding the prose, or interpreting the damaged percentage `25 246` as 25%.

The helper still correctly reconstructs unrelated explicit bankgiro/reference
pairs and splits the complete invoice-number/date fields. A global
`reconstructed: true` therefore does not mean these summary cells were recovered.

## Findings: normal-05

The header role and name rows split into two distinct segments each:

| Segment | x0–x1 | y0–y1 | Current classification |
| --- | --- | --- | --- |
| Leverantör | 153–386 | 630–662 | Known label |
| Faktureras till | 1278–1576 | 630–662 | Unrecognized phrase, without a colon |
| Exempel Pump & Värme AB | 152–936 | 696–747 | One left-column value segment |
| Testmottagaren Handel AB | 1275–1933 | 696–743 | One right-column value segment |

The unchanged helper proposes Leverantör → the left company name, with exactly
one ownership claim. The right role phrase does not create a matching pair.
The indivisible-row condition then correctly cancels the incomplete split of
both raw rows. It does not concatenate the two companies or promote the left
name merely because it is first. The dates above these rows are reconstructed
successfully by the same existing below-label logic.

This identifies an explicit-role vocabulary gap suitable for a narrow general
extension. It does not supply evidence for the six unlabelled sender names in
the wider first V2 population. A footer organization number or bankgiro alone
does not establish which of two unlabelled companies is the issuer.

## At most two proposed general experiments

These are proposals for separately tested changes, not changes made here.

1. **Explicit label and unique right-hand value on the same physical row.** Use
   actual word geometry and a complete ownership census across labels, unknown
   explicit headings and values. Preserve table exclusions and all original
   words/confidences. Unknown prose or a competing column must not be silently
   deleted to manufacture a complete field. Synthetic negatives should include
   two plausible values, two competing labels, an unknown heading owning the
   same area, nonoverlapping y bands, words crossing the corridor, a summary-like
   article description, a second page, and partial or corrupted percentage text.
   A candidate relationship is not permission to infer or repair a number.
2. **Consistent explicit `Faktureras till` role alias.** Recognize it consistently
   as the recipient role and in complete-row ownership, retaining the existing
   one-to-one, all-segments-resolved rule. Synthetic negatives should include a
   single mixed text row with no geometry, two names under one role, duplicate
   role headings, swapped columns, intervening unknown headings, malformed or
   overlapping boxes, and a missing name in either column. Both names and their
   original roles must be retained; no first-row or AB-suffix inference.

No unlabelled-name heuristic is proposed. Investigating one would require new,
separately authorized optical observations of both a local issuer-name/org
region and a footer-only org case, plus adversarial recipient-first, factoring,
self-billing and competing-identity examples. These two already consumed
diagnostic calls do not answer that question. Stronger evidence or trusted,
previously verified identity data would still be needed before assigning a role.

## Limits

The packet exposes causes in two already-seen synthetic images. It cannot raise
the first independent V2 recall, turn that failed run into a pass, establish
production coverage, or justify a quality score. Later changes may use it only
as a known regression set. A fresh independent acceptance population remains a
separate requirement after any development changes.
