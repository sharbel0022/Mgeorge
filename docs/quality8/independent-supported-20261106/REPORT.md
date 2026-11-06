# Independent supported-normal OCR first pass — 6 November 2026

**The 85% recall / 98% precision target was not met.** On 12 valid supported-normal synthetic invoices, both actual Node and Sites parsers achieved **57.41% mandatory image-field recall (62/108) and 100% observed precision (62/62)**. All 46 missed values were absent/null; none was an incorrect nonempty prediction. No normal invoice had all nine mandatory image fields correct. Every worker completed, so execution failures did not reduce this score.

This is a fresh independent experiment, not a replacement or rescore of another cohort. Its author did not read previous corpus data, predictions, results, or parser/worker implementation. Only invocation interfaces and field schema were read. The [preregistered protocol](protocol.md), [gold](gold.json), all images, generator, and runner were committed before the first call. No corpus change, OCR retry, parser retry, confidence override, text repair, or product change occurred.

## Main results

The two engines have identical fields, confidence, issues, and levels for all 14 observations; only extraction timestamps differ. Each row below applies separately to Node and Sites, not to pooled independent samples.

| Cohort | Documents | TP | FP | FN | Recall | Precision | All nine correct |
|---|---:|---:|---:|---:|---:|---:|---:|
| Normal primary | 12 | 62 | 0 | 46 | 57.41% | 100% | 0/12 |
| Normal Swedish | 6 | 34 | 0 | 20 | 62.96% | 100% | 0/6 |
| Normal English | 6 | 28 | 0 | 26 | 51.85% | 100% | 0/6 |
| Completed-only normal diagnostic | 12 | 62 | 0 | 46 | 57.41% | 100% | 0/12 |
| Stress, separate | 2 | 10 | 0 | 8 | 55.56% | 100% | 0/2 |

Precision describes the 62 returned mandatory values; it does not mean that 100% of expected fields were captured. The normal denominator remains 108 expected values. All 12 normal workers completed, so the completed-only diagnostic excludes zero documents and equals the primary result. The 2 stress documents have their own denominator of 18 and do not influence the primary target.

### Per-field normal results

These counts are identical for both engines. Each field has 12 expected values.

| Image field | TP | FP | FN | Recall |
|---|---:|---:|---:|---:|
| Invoice number | 4 | 0 | 8 | 33.33% |
| Supplier/party | 2 | 0 | 10 | 16.67% |
| Organization number | 8 | 0 | 4 | 66.67% |
| Issue date | 6 | 0 | 6 | 50.00% |
| Due date | 6 | 0 | 6 | 50.00% |
| Gross amount | 12 | 0 | 0 | 100% |
| Net amount | 12 | 0 | 0 | 100% |
| VAT amount | 0 | 0 | 12 | 0% |
| Currency | 12 | 0 | 0 | 100% |
| **Total** | **62** | **0** | **46** | **57.41%** |

Gross, net and currency were correct on every normal invoice. VAT was missing on all normal invoices; supplier names and invoice numbers also contributed substantial omissions. English issue dates were missing in all six English cases. The machine-readable [first results](first-results.json) include per-language and stress per-field counts and every expected/actual mismatch.

### Document status and false green

For each engine, normal status was **8 red, 4 yellow, 0 green**. Stress status was **2 red, 0 yellow, 0 green**. All-nine correctness was 0/12 normal and 0/2 stress. There were **0 false greens**, with **zero green documents emitted**; this provides no positive sample for estimating green-result correctness.

Incoming direction was passed as explicitly confident metadata (`supplier`). It was returned correctly for 12/12 normal and 2/2 stress cases. Direction is excluded from the nine image-field metrics and is not evidence of optical recognition.

## What ran and what is preserved

The test called the actual `runDocumentProcess` exactly **14 times**, sequentially. All 14 returned method `ocr`; there were **14 completed workers, 0 worker errors, 0 thrown worker errors**. The returned text and actual confidence/evidence were passed once to each actual `interpretInvoice`: **14 Node calls and 14 Sites calls, 0 parser exceptions**. No preflight was performed. All raw observations and complete parser outputs, including issues and evidence, are in [observations](observations/); the [call event log](call-events.jsonl), [stdout log](first-pass.log), and [verification record](verification.json) retain the execution accounting. Worker failures were preregistered to count as nine FN in the primary denominator; none occurred here.

The frozen images contain ordinary, readable invoices. Raw OCR reveals some failures before final extraction. For example, in [normal Swedish 02](observations/normal-sv-02.json), the printed `Moms 25%` appears in OCR text as `Moms 2590` while the amount `312,50` remains present; the returned VAT field is null. In [normal English 08](observations/normal-en-08.json), `VAT 25%` similarly becomes `VAT 2590`, and invoice/date headings are placed on one text line with their values on another. These are observations, not a complete attribution of each omission to OCR versus parsing. No parser implementation was inspected and no repair was attempted.

The original first results are preserved. Future use of these cases for debugging makes them development material; a corrected parser run on them would not be a new independent holdout.

## Freeze, product binding and reproducibility

- Approved product commit: `f5d178ea816d276457685fbc0421cf144f7cf655`.
- Preregistration commit / executed worktree HEAD: `cb83472359927adadf99cb50b54f9e9aeaded19a`, a docs-only descendant with byte-identical product code.
- Freeze UTC: **2026-11-06T15:43:21.883995+00:00**.
- Freeze SHA256: `0fd6c4de10ad0b4e8c883b727aa9c3a5a5a7a2a9d272957cee11469b9cb44758`.
- First-run claim UTC: **2026-11-06T15:43:30.523Z**, after freeze and preregistration commit.
- The 19 frozen inputs were rehashed after the run and remain unchanged. The [freeze manifest](freeze.json) binds every image, gold, protocol, generator, contact sheet, and runner.
- [Run provenance](run-claim.json) records source hashes, model/core hashes, actual runtime versions and lockfile SHA256. The dependency symlink reused the existing installation after verifying identical lockfiles: `cef4d785d401b705d27a408eb732f1552fa3836b48da4f25460ef121a19e7b8d`.

Runtime: Node 24.22.1; `@napi-rs/canvas` 0.1.80; `@tesseract.js-data/swe` 1.0.0; `tesseract.js` 6.0.1; `tesseract.js-core` 6.1.2; `pdfjs-dist` 5.4.149. The OCR model, language, mode, PSM, and dependencies were unchanged. No bank, network provider, or production calls occurred.

The corpus is portable: PNG images, JSON gold, a Python/Pillow generator, and a Node runner with only the documented Sites import adapter. Frozen PNGs are the authoritative inputs; regenerating an image under another font/Pillow version is not a byte-identical replay. The runner refuses to overwrite an existing `run-claim.json`, so the preserved first pass cannot accidentally be rerun in place. Recomputing summary arithmetic from saved observations requires no OCR/parser calls. `artifact-sha256.json` hashes the completed deliverable, including evidence and this report, separately from the preregistration freeze.

## Scope and limits

The normal cohort comprises six Swedish and six English invoices, all SEK and all with valid Swedish organization-number format/checksum, coherent dates and exact monetary arithmetic. The independent generator validation and later integrity check passed. Organization numbers are synthetic business identifiers validated for format/Luhn, not checked against a company registry. No personal identifiers were used. A visible TEST footer marks every image; no payments can be initiated from this evaluation.

Three layouts are balanced within each language. Two additional valid-content stress cases introduce mild skew/blur and reduced resolution/contrast. No unsupported-currency or intentionally invalid-content cases are included. The [contact sheet](contact-sheet.jpg) permits visual review; individual PNGs retain full resolution.

This small controlled synthetic cohort uses one recipient, one 25% VAT rate, typed text and a narrow layout family. It does not estimate production-wide quality or establish that true precision is at least 98%. Its defensible conclusion is narrower and concrete: on these frozen valid supported inputs, the unchanged product completed OCR reliably but omitted 46 of 108 required image values, and therefore failed the requested recall target.
