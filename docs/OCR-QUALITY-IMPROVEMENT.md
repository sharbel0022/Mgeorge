# OCR, PDF and invoice understanding — quality improvement

## Delivery status

Implemented and verified on `codex/ocr-quality-20261102`. The baseline is `a9f88ae1c0f697376b3ecd140e1e80a64405125a` (source tree `7658b96077f81ad43847c168d640e9d4d275ffa1`). The measured implementation commit is [`4bf4912d870d9ee3518a266b720f5fb5664b1f0e`](https://github.com/sharbel0022/Mgeorge/commit/4bf4912d870d9ee3518a266b720f5fb5664b1f0e); the final evidence commit adds this report, the plan and the after-measurement without changing application code. No main push, merge, production data mutation or Sites publication was performed.

Delivery: [PR #19 against main](https://github.com/sharbel0022/Mgeorge/pull/19). Main was checked again immediately before PR creation and still pointed to the baseline. The PR is to be reviewed and integrated in the agreed order with the other workstreams; integration and publication are not part of this delivery.

The scope is invoice extraction, PDF/image interpretation, source evidence, mathematical checks and their tests. Bank synchronization, Gmail scheduling, backup, reconciliation and product UI belong to separate workstreams.

## Existing pipeline and confirmed baseline defects

Node runs bounded PDF.js/Tesseract processing in `src/invoice-worker.js`, then `interpretInvoice` in `src/invoice-extraction.js`, then review/registration in `src/invoice-review.js`. Sites uses `server-pdf.ts` and the mirrored `invoice-fields.js` through `document-processing.ts`. Browser uploads additionally have `local-ocr.ts` and `imports.ts`; the baseline manual parser was a separate permissive set of expressions.

Only synthetic originals were used to reproduce the following defects:

| Boundary | Confirmed baseline behavior | Consequence |
| --- | --- | --- |
| PDF drawing order | Visually identical, differently ordered objects could swap invoice number `0606` and OCR `000018`. The preview images were byte-identical. | Both parsers returned green; a real synthetic Sites processing test registered the wrong invoice number. |
| PDF text provenance | A scan with an invisible text layer containing a different invoice number was treated as trusted native PDF text. | Visually absent text could determine a green identity. |
| Manual suggestions | `0 6 0 6` became `0`; a missing invoice number could become the next `OCR` heading; a suffix could be truncated; two amount columns could be joined. | Incorrect values were prefilled for manual review. |
| Identity labels | An empty second party label was ignored, and a long name could be truncated to a valid prefix. | A single apparently valid name could conceal contradictory or unreadable source data. |
| Row arithmetic | The word “discount” or “rabatt” anywhere in the document disabled row checks. An explicit VAT percentage was captured but never validated. | Mathematically inconsistent synthetic invoices could be registered automatically. |
| Decimal quantities | A fractional quantity could be read from its final integer fragment. | Correct rows could be rejected while incorrect rows passed. |
| Metadata | Punctuation suffixes could be truncated; alphabetic IDs discarded; embedded labels/date-like filenames mistaken for invoice numbers. | Both missed conflicts and unnecessary review. |
| Browser PDF fallback | A long digital archive footer prevented OCR of a scanned invoice; fragmented glyphs gained arbitrary spaces. | Invoice fields were missed or leading zeroes lost. |

These are reproduced behavior claims, not estimates of their prevalence in customer documents. Original bytes were preserved throughout the synthetic tests.

## Source and reference rules

Only document evidence may supply invoice values. Filename, subject and message identifiers can raise conflicts but cannot fill missing invoice fields. A missing or contradictory value must remain absent. Page/line provenance is attached only when the input preserves page boundaries; it is not a claim that an OCR engine read the pixels correctly.

A value explicitly labelled OCR is distinguished from a generic payment reference. Bankgirot documents numeric OCR references of 2–25 digits with a modulus-10 check digit. Bank agreement settings determine soft/hard and length validation. Therefore checksum validity is separate from formal bank verification, and the parser does not manufacture `formal_verified=true`.

Primary references, checked 2026-11-02:

- [Bankgirot OCR reference control](https://www.bankgirot.se/tjanster/inbetalningar/bankgiro-inbetalningar/ocr-referenskontroll/).
- [Bankgiro Receivables user manual](https://www.bankgirot.se/globalassets/dokument/anvandarmanualer/bankgiroreceivables_bankgiroinbetalningar_usermanaual_en.pdf), sections 5.2.1–5.2.3, pages 20–22.

## Implementation and compatibility

### One interpretation contract in both runtimes

`src/invoice-extraction.js` and `sites/lib/invoice-fields.js` keep the existing thirteen scalar fields and add `details.version = 1`. The mirrored `invoice-details.js` helpers expose supplier and recipient separately, role-bound organization numbers, the reference type and checksum result, line items, printed VAT rates and table status. These details are retained by the existing extraction JSON persistence; no financial database schema migration or historical reclassification is performed.

Names and organization numbers use a census of labelled source occurrences. An empty, invalid or contradictory occurrence invalidates that field instead of letting the first readable occurrence win. A supplier's organization number is not borrowed from the recipient. Identifiers remain strings, including leading zeroes and their complete suffixes. A metadata disagreement can require review, but filenames, subjects and message IDs do not supply missing document fields.

The party parser reuses the scalar parser's actual accepted label grammar when bounding a name. Thus a missing supplier cannot borrow a following "Faktura nr", "Faktureringsdatum" or "Betalas senast" label as its name. Explicit net and VAT are required for automatic eligibility; zero VAT is valid source evidence, but an absent VAT amount is not silently interpreted as zero.

Manual Sites imports now adapt the same parser into the existing form shape. The form remains unreviewed, uncertain suggestions remain empty, and warnings include extraction issues. For an email with one PDF, only that attachment supplies invoice values; the envelope and subject remain context. Multiple PDFs require separate imports. A forwarder's display name/address is not fabricated into the invoice counterparty. Credits and receipts do not suggest a new positive invoice debt. CSV, CAMT, bank synchronization and Gmail scheduling implementation are unchanged.

### Tables and continued pages

The bounded table parser accepts explicit Swedish/English headings separated by pipes, tabs or at least two spaces. Description, quantity, unit price and net amount are the required column roles. Printed VAT percentage, VAT amount and gross amount are optional additional columns; an entirely absent column remains `null`, while a blank cell in a declared column makes the table incomplete. The parser does not fill an absent cell with a calculation.

Supported decimal quantities, mixed printed VAT rates, repeated headings and bounded description continuations retain source page/line evidence. Page boundaries are preserved with form-feed separators. A different invoice identity, incompatible repeated heading, incomplete row, unsupported column mapping or unverified continuation requires review. The maximum supported table is 500 rows within the application's existing document limits. Table descriptions are excluded from document-level field matching so an article named "invoice number …" cannot become a header value.

Arithmetic uses integer minor units for money and independently compares quantity × unit price, row net/VAT/gross relationships and table/document sums. A calculation is a consistency check, not source evidence for a missing value. The older explicitly labelled `quantity st / price kr / VAT % / VAT kr / gross` layout also validates the complete quantity token, including decimal fractions. Discount prose never disables the checks; unsupported discount calculations require review.

When a printed net and VAT percentage allow a consistency calculation but the row has no VAT/gross column, the checked sum is compared with the document's explicit VAT/gross. The omitted row cells remain `null`. Printed monetary-cell currency codes are compared with one another and with the document currency before row text is excluded from scalar matching. The supported headerless row family is also summed against the document totals, so internally consistent rows cannot hide a mismatching invoice summary.

### Native PDF versus optical evidence

All three PDF paths—Node worker, Sites server and browser—share the same mirrored reconstruction/routing rules. Horizontal non-overlapping geometry establishes reading order independently of PDF drawing order. Large visible gaps are retained as column separators instead of collapsing every column into ordinary prose. Missing, rotated, mirrored or overlapping geometry is insufficient to grant native-text trust.

Substantial raster content with a text layer, unknown optimized image groups/repetitions, invisible or unreliable text rendering, and scanned invoice content with a digital footer are sent through the optical path. Sites server returns its existing `local_ocr_required` signal when it cannot safely use native text. Original bytes and previews remain unchanged. OCR confidence and field validation still apply after routing; the existence of text or an invoice-looking label never establishes correctness by itself.

Existing resource limits remain in force: up to ten PDF pages, 150,000 interpreted characters and 12 million rendered pixels per page, with the existing worker/server bounds. This implementation does not claim a general proof that every possible PDF drawing operation is visible, or support arbitrary page/table layouts.

There is a deliberate review cost: clipping, uncertain colors/compositing and decorative shapes whose bounding boxes overlap text can route an otherwise legitimate native PDF to OCR. Font/Unicode mappings and the full PDF rendering language are not exhaustively verified. These limits must be measured on representative real documents before estimating production automation or manual-review volume. The browser regression adapter runs actual PDF.js, canvas and Tesseract in Node; it is not a Chrome session or a production deployment check.

### Test harness compatibility

Some existing Sites tests evaluate modules through data URLs. Adding the shared invoice-detail import requires those tests to resolve the real module's local dependencies through `sites/tests/helpers/invoice-module-loader.mjs`. Changes in tests named for bank or Gmail flows are limited to this loader compatibility; their product implementations and behavioral assertions are outside the OCR changes. Synthetic positive-flow fixtures with invalid OCR check digits are corrected explicitly, while dedicated invalid-OCR regressions retain their required review result.

The fixture corrections use valid `000018`/`0000596` OCR literals, retain the separate invoice IDs and amounts, and place the organization number in its explicitly intended supplier block. Expected optical values are updated to match those corrected synthetic originals. The frozen benchmark corpus is independent of these mutable legacy fixtures and is unchanged between measurements.

An independent whole-change review additionally reproduced six concrete issues: VAT-rate aggregation without a printed VAT column, hidden row currencies, visually absent native PDF text, a party borrowing a scalar label, missing net/VAT eligibility, and headerless row totals disagreeing with invoice totals. Fixes are verified with failing-then-passing regressions; the three legacy paths are labelled as existing weaknesses rather than newly introduced regressions.

## Measurement protocol

A fixed synthetic corpus and independent literal expected values are evaluated against the frozen baseline and candidate source. The runner records source, runner and corpus hashes. Deterministic text interpretation and real PDF/raster processing are reported separately. Correct absence is never counted as a true positive.

- Field precision = correct non-null values / all returned non-null values.
- Field recall = correct non-null values / all expected non-null values. A wrong value counts as both a false positive and a false negative.
- Exact document coverage = documents where all annotated fields are correct / all evaluated documents. This is distinct from green coverage.
- False green = green despite a required review or incorrect/incomplete annotated fields. Wrong values, incomplete fields and unsafe decisions are also separated, and established scalar fields are reported separately from newly exposed details.
- Manual review = non-green results. Unnecessary review is counted separately for otherwise exact eligible documents.
- Treatment time is measured within each engine and modality. This shared development machine does not establish a production latency guarantee.

"False green" measures the extraction decision, not a count of financial entries actually created. Automatic registration additionally depends on the existing verified-counterparty and integration controls. The benchmark itself does not register invoices; the separate synthetic `processDocuments` regression checks that the wrong PDF identity cannot reach registration.

No universal OCR accuracy claim follows from a finite, synthetic, deliberately challenging corpus. Real representative, consented documents and a measured production run remain necessary to estimate real-world rates.

### Reproduce the comparison

Run the same checked-in runner and corpus against both source checkouts. A separate baseline checkout avoids accidentally measuring current code twice:

```bash
git worktree add --detach ../mgeorge-ocr-baseline a9f88ae1c0f697376b3ecd140e1e80a64405125a
```

Install the root lockfile dependencies in each checkout with `npm ci --ignore-scripts`. The optical fixtures need the runtime's canvas/font support. Then run from the candidate checkout:

```bash
node --experimental-strip-types scripts/measure-ocr-quality.mjs \
  --source-root ../mgeorge-ocr-baseline \
  --text-repeats 5 \
  --output docs/measurements/ocr-quality-before.json

node --experimental-strip-types scripts/measure-ocr-quality.mjs \
  --source-root . \
  --text-repeats 5 \
  --output docs/measurements/ocr-quality-after.json

node --test test/ocr-quality-metrics.test.js
```

The complete corpus has 40 labelled text documents in 16 families and nine generated binary inputs: three native PDFs, four raster images and two scanned PDFs. It includes correct Swedish/English invoices, credit, leading zeroes, missing/conflicting fields, metadata traps, currencies, table/rate/page cases, blank images and a deliberately degraded image. Every document annotates the thirteen existing scalar fields; eleven text documents additionally annotate selected new details. The fixtures and expected values are synthetic and independent of the parser's returned values.

The thirteen-field contract includes supplied direction context and document kind as well as invoice facts. Direction and other metadata are controlled fixture inputs; this comparison does not measure mail-direction inference, counterparty trust establishment or integration authorization. New detail coverage also measures an expanded output contract, not solely optical recognition.

Both reports must have identical `corpusSha256`, `datasetSha256`, `runnerSha256` and every `inputManifest` hash. The runner records actual source hashes, dependency/runtime versions, font identity, processing errors and whether any loaded source changed during the measurement. A changed source or processing error returns a failing exit status. `--text-only` is useful for diagnostics but produces a different dataset hash and is not a replacement for the full comparison.

The checked-in reports use compact JSON records to keep the PR reviewable. Reformatting is verified to preserve the entire parsed report; no document, score, processing output or expected fact is omitted. The runner's default indented output contains the same data.

Binary Sites measurements use the Sites parser on text emitted by the selected checkout's Node worker. They do **not** measure the entire Sites server/browser/manual-upload chain; those paths have separate actual-PDF and browser-adapter regression tests. Text timing excludes setup and uses one warmup plus five passes. Binary timing includes a cold worker and PDF rendering/Tesseract where selected, once per input. Shared-host timing is descriptive and cannot establish a reliable speedup.

## Results on the frozen corpus

Both engines produced identical reviewed field values and decisions. All figures below are **per engine**, not independent duplicated observations. Both measurements have 98 evaluations (49 inputs × two parsers), stable and clean measured source, and zero processing/evaluation errors.

| Subset | TP / FP / FN before → after | Field precision before → after | Field recall before → after | Exact documents before → after |
| --- | --- | --- | --- | --- |
| Text, existing 13 scalars; 40 inputs | 499 / 1 / 3 → 502 / 0 / 0 | 99.80% → 100% | 99.40% → 100% | 36/40 → 40/40 |
| Text, newly exposed selected details; 11 inputs | 0 / 0 / 110 → 110 / 0 / 0 | Undefined → 100% | 0% → 100% | 0/11 → 11/11 |
| Text, entire annotated contract; 40 inputs | 499 / 1 / 113 → 612 / 0 / 0 | 99.80% → 100% | 81.54% → 100% | 27/40 → 40/40 |
| Native PDF; 3 inputs | 37 / 2 / 2 → 39 / 0 / 0 | 94.87% → 100% | 94.87% → 100% | 2/3 → 3/3 |
| Raster images; 4 inputs | 29 / 1 / 12 → 29 / 1 / 12 | 96.67% → 96.67% | 70.73% → 70.73% | 3/4 → 3/4 |
| Scanned PDF; 2 inputs | 26 / 0 / 0 → 26 / 0 / 0 | 100% → 100% | 100% → 100% | 2/2 → 2/2 |

The baseline had no structured detail API. Its 110 missing detail facts therefore count as false negatives for the expanded contract, not as incorrect returned legacy monetary values. The scalar-only row is the comparable existing field contract. Across all 49 inputs the expanded exact-document count is 34/49 → 48/49; scalar-only exact coverage is 43/49 → 48/49.

No optical recognition improvement is demonstrated by the raster subset. The deliberately pixelated invoice still has one FP and twelve FN: its known original type is `invoice`, but the unreadable output is classified as `other`; the missing original facts remain absent. It remains red. The difficult input is retained rather than removed or relabelled to inflate recall. The other perfect subset results describe only these small fixed synthetic cases and **are not a universal 100% OCR claim**.

### False green decisions and review demand

| Decision measure | Before | After |
| --- | --- | --- |
| False green text decisions, scalar-only scope | 7 | 0 |
| False green text decisions, expanded annotated scope | 14 | 0 |
| Expanded text: green with a wrong returned value | 1 | 0 |
| Expanded text: green with missing fields and no wrong returned value | 9 | 0 |
| Expanded text: green despite explicit required review | 7 | 0 |
| False green native PDF decisions | 1 | 0 |
| False green raster/scanned PDF decisions | 0 | 0 |
| False green across all 49 inputs, expanded scope | 15 | 0 |

The three expanded-text reason rows overlap and must not be added together. The 14 baseline expanded false-green cases also include the absent detail API; the separate 7 → 0 scalar result prevents that feature gap from being presented as fourteen incorrect legacy field interpretations. The native-PDF error is a real identity swap in a visually identical input: invoice `0606` and reference `000018` were reversed before the fix.

| Annotated text decision group | Before | After |
| --- | --- | --- |
| Eligible inputs with green signal | 10/12 | 12/12 |
| Eligible inputs held for review | 2/12 | 0/12 |
| Inputs requiring review, incorrectly green | 7/28 | 0/28 |
| Inputs requiring review, correctly held | 21/28 | 28/28 |
| All text inputs held for review | 23/40 (57.5%) | 28/40 (70.0%) |
| All 49 inputs held for review | 29/49 (59.18%) | 34/49 (69.39%) |

The two formerly held eligible inputs concern supplier/recipient organization roles. Both now become green, while seven unsafe green inputs are correctly held. Consequently total review grows by five documents in this deliberately challenging corpus. The evaluator's narrower `unnecessaryReviewCount` is 0 before and after because it counts only otherwise *exact* eligible documents; the two old eligible failures had missing fields. The explicit eligible cohort above reports the improvement without hiding that distinction.

### Observed average processing time

| Subset | Node before → after | Sites before → after |
| --- | --- | --- |
| Text interpretation | 0.949 → 0.572 ms | 0.681 → 0.614 ms |
| Native PDF | 4.790 → 0.842 s | 4.792 → 0.841 s |
| Raster images | 15.634 → 3.825 s | 15.629 → 3.825 s |
| Scanned PDF | 22.374 → 5.458 s | 22.370 → 5.457 s |

These are observations, not a demonstrated performance gain. On the same host with nine reported CPUs, one-minute load average was 19.83 → 23.99 during the baseline and 2.55 → 3.79 during the candidate run. The text medians increased from 0.341 to 0.462 ms for Node and 0.208 to 0.522 ms for Sites. CPU contention, warm caches, cold workers and the small number of optical samples prevent a reliable speed ratio or production latency guarantee. Binary Sites time shares the Node worker's extraction time as described above.

### Measurement provenance

The entire input manifest, corpus and harness hashes match. An independent read-only review also recomputed TP/FP/FN and document/decision totals directly from each recorded field and verified all loaded source hashes against the two checkouts.

| Evidence | SHA-256 |
| --- | --- |
| Corpus | `c1a28614d0812fa0687bbd2ce0ed00c800ce99d38297757077bd8d74a1a616f9` |
| Dataset including generated input bytes | `f54e3d3f0c5a7e1595a7caf3669773ab462282c36e6685a052b0c879a9e8eae0` |
| Runner and two measurement helpers | `81ec6ebb7aefd0e9c023d43a4e5d5290787932d81aaafea50196bea9fb0851be` |
| Baseline loaded source and lockfiles | `de0c24a0c2c231a25848d1e881befa996567d493d17f35da3e32560f2c0ddf40` |
| Candidate loaded source and lockfiles | `d72673fa6c3d543abd235e1b94146e72c5a2e20b891961aaea37b15f3372a760` |

The complete records are [before](measurements/ocr-quality-before.json), [after](measurements/ocr-quality-after.json), and the independent [pixel-identity receipt](measurements/ocr-quality-native-render.json). Runtime/dependency versions, font identity, exact input bytes' hashes, timing samples, field-level facts and retained synthetic OCR output are included.

## Verification

The final code was checked with clean installations from the unchanged root and Sites lockfiles. Those installations were placed in the candidate checkout for the full test/build gates. Local Node was v24.22.1; the GitHub workflow independently uses its configured Node 22 runtime. No production dependency, lockfile, financial schema or scheduling configuration changed.

| Gate | Final result |
| --- | --- |
| Root `npm ci --ignore-scripts` | Passed from the root lockfile |
| Sites `npm run install:ci` | Passed, including existing minimatch backport |
| `node sites/scripts/minimatch-backport.mjs --check --require-target` | Verified installed bytes; zero further writes |
| Root `npm run check` | 110 JavaScript files; exit 0 |
| Root `npm test` | **1,137 passed, 0 failed, 0 skipped, 0 cancelled** |
| Sites `npm run check` | Typecheck passed; exit 0 |
| Sites `npm test` | **1,996 passed, 0 failed, 0 skipped, 0 cancelled** |
| Sites `npm run build` | Production build passed; exit 0; no publication |
| Root `npm audit --audit-level=high` | Zero vulnerabilities; exit 0 |
| Sites `npm audit --audit-level=high` | 16 moderate development findings; no high/critical; exit 0 |
| Sites `npm audit --omit=dev --audit-level=high` | Zero production vulnerabilities; exit 0 |
| `git diff --check` and mirrored helper parity | Passed |
| Full before/after benchmark | 98 evaluations per run; stable sources; zero processing/evaluation errors |

The final full suites contain **3,133 passing tests** in total. The frozen baseline's separate full Node suite passed 1,062/1,062. The first candidate full run exposed one genuine compatibility regression in a bare `Mottagare` section followed by an explicit company-name label. It was fixed in both engines with RED→GREEN tests and independent review, while a truly empty colon-labelled name still requires review. The unchanged old Gmail assertion passes in the final full Sites run; no assertion was weakened to hide it.

Independent whole-change review closed all six concrete findings, then separately verified the section-heading correction. It repeated 52 parser assertions, five actual-PDF controls and 22 section-boundary assertions. These are additional review evidence, not numbers to add to the full-suite count. The full suites already include the new dedicated regression files.

The measured code commit passed both jobs and every configured step in [GitHub Actions run 41513072407](https://github.com/sharbel0022/Mgeorge/actions/runs/41513072407). The final report-only commit can be reviewed against the same implementation source hash; its exact head checks are visible on the PR. Build output includes framework dynamic-import/source-map warnings. The existing moderate development dependency findings remain recorded; the exact installed minimatch mitigation is verified, and no general absence of security issues is claimed.

## Integration constraints

The requested PR must be reviewed and integrated in coordination with the five other workstreams. This report contains this task's evidence; shared `PROGRESS.md` and `QUALITY-SCORECARD.md` are intentionally left to the integration owner to avoid simultaneous edits. Existing area scores are not raised solely because synthetic regressions pass. No historical production document or queued extraction is silently reclassified by this development task.

The affected existing scores remain unchanged: minimal manual handling 6.5; customer invoices 8; supplier invoices 8; PDF interpretation 8; image OCR 7; automatic invoice registration 8; formal OCR/invoice reference 7; code quality/tests 8.5. New synthetic regression and measurement evidence is recorded here for the later coordinated scorecard update. Representative production acceptance remains outstanding.

The existing Sites project and its data, secrets, schedules and access policy remain outside this task's mutations. The final coordinated integration should publish the combined verified source only once.

## Changed files

The task changes 49 files: twelve application modules, one measurement runner, 31 test/fixture/loader files and five report/measurement/plan files. No package or lockfile changes are included.

### Node implementation

- `src/document-triage.js`
- `src/invoice-details.js`
- `src/invoice-extraction.js`
- `src/invoice-worker.js`
- `src/pdf-text.js`

### Sites implementation

- `sites/lib/document-triage.js`
- `sites/lib/imports.ts`
- `sites/lib/invoice-details.js`
- `sites/lib/invoice-fields.js`
- `sites/lib/local-ocr.ts`
- `sites/lib/pdf-text.js`
- `sites/lib/server-pdf.ts`

### Node regressions and fixtures

- `test/document-quality-cycle.test.js`
- `test/fixtures.js`
- `test/helpers/fragmented-pdf.mjs`
- `test/helpers/invoice-evidence-cases.mjs`
- `test/helpers/ocr-quality-corpus.mjs`
- `test/helpers/ocr-quality-metrics.mjs`
- `test/helpers/optical-invoice-fixtures.mjs`
- `test/helpers/pdf-layout-ocr.mjs`
- `test/invoice-evidence-ocr.test.js`
- `test/ocr-quality-metrics.test.js`
- `test/pdf-layout-ocr.test.js`

### Sites regressions and test loaders

- `sites/tests/bank-api-original-q8.test.mjs`
- `sites/tests/bank-file-provenance.test.mjs`
- `sites/tests/bank-state-integrity-q8.test.mjs`
- `sites/tests/cloud-ocr.test.mjs`
- `sites/tests/document-quality-cycle.test.mjs`
- `sites/tests/domain.test.mjs`
- `sites/tests/economy.test.mjs`
- `sites/tests/gmail-preview-q8.test.mjs`
- `sites/tests/gmail.test.mjs`
- `sites/tests/helpers/browser-ocr-fixture.mjs`
- `sites/tests/helpers/document-ocr-fixture.mjs`
- `sites/tests/helpers/file-upload-concurrency-fixture.mjs`
- `sites/tests/helpers/invoice-module-loader.mjs`
- `sites/tests/invoice-evidence-ocr.test.mjs`
- `sites/tests/invoice-parser-corpus-q8.test.mjs`
- `sites/tests/manual-invoice-ocr.test.mjs`
- `sites/tests/mcp-evidence-read.test.mjs`
- `sites/tests/pdf-layout-ocr.test.mjs`
- `sites/tests/pdf-text-reconstruction.test.mjs`
- `sites/tests/server-pdf-optical-fallback.test.mjs`

### Measurement runner

- `scripts/measure-ocr-quality.mjs`

### Report, measurements and plan

- `docs/OCR-QUALITY-IMPROVEMENT.md`
- `docs/measurements/ocr-quality-after.json`
- `docs/measurements/ocr-quality-before.json`
- `docs/measurements/ocr-quality-native-render.json`
- `docs/superpowers/plans/2026-11-02-ocr-quality.md`
