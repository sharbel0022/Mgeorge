# OCR, native PDF and current payment evidence

Baseline: main `dfd852666cf3462588a82797717822347602e196`. This report contains synthetic measurements and sanitized findings only. Real bank/invoice originals, account identifiers, names, original digests and private evidence IDs are excluded.

## Corrected behavior

- Both reference engines retain complete malformed tokens. A valid numeric prefix cannot become a safe match; leading zeros and adjacent real labels survive.
- Both invoice parsers audit every labelled occurrence. Ambiguous numbers, unreadable duplicates, malformed currency/Bankgiro/organization values and adjacent monetary columns require review. Legitimate formatted identifiers and single-character digit spacing remain supported.
- A remote OCR worker cannot claim native-PDF trust. The server assigns OCR provenance to authenticated worker completions; original/lease/owner checks remain intact.
- Raster PDFs with long digital footers now reach optical recognition in both environments. Native PDFs with logos retain native extraction when their invoice text is usable.
- Both PDF boundaries reconstruct adjacent positioned fragments without manufacturing spaces inside numbers. Explicit space/EOL items, unknown geometry and clearly separated forward/reverse columns stay separate. Strict monetary parsing is unchanged.
- Optical rasters use high-quality 1.5x enlargement within a rounded 12-million-pixel per-canvas cap. Color/gray detail remains intact, original bytes are unchanged, and OCR confidence still requires review.
- New owner-only MCP readers expose bounded stored payment/register/source evidence and retained-report verification without fetches or writes. A separate current-account reader uses the existing AIS provider permission for bounded account-detail GETs. It requires exact live/stored consent membership, current owner/selected production account, valid original receipt, exact bank-provided aliases and snapshot rechecks. It never derives IBANs or writes storage/financial data.

## Measured before and after

These are deliberately narrow, reproducible acceptance measurements, not estimates for arbitrary documents.

| Same declared corpus | Before | After | Meaning |
| --- | --- | --- | --- |
| Exact invoice-field decisions, 50 cases through two engines | 42/100 correct; 48 invalid green | 100/100 correct; zero invalid green | Labelled text only; all 42 positive evaluations exact |
| Complete payment tokens, 20 cases through two reconciliation engines | 14/40 correct; 26 false safe | 40/40 correct; zero false safe | All 14 positive safe evaluations preserved |
| Seven readable synthetic native/optical documents, 11 text fields | 76/77 exact | 77/77 exact | One layout; native controls included |
| Actual optical subset, five documents | 54/55 exact fields | 55/55 exact fields | PNG/JPEG/WebP and two scanned-PDF routes; all remain review items |
| Blank and severely pixelated scans | Separate controls | 2/2 held; no invented fields | Not counted as readable successes |
| Light gray and blue ink | Separate controls | 22/22 exact fields | Both still require review |

Machine-readable [invoice measurements](measurements/exact-invoice-fields-after.json), [reference measurements](measurements/complete-payment-tokens-after.json) and [optical measurements](measurements/optical-normalization-after.json) include scope and corpus/source evidence. Before results are retained alongside them. Exact 100% on these declared corpora is not universal 100% OCR. Peak memory/concurrent OCR performance has not been measured; timing samples are observations, not an SLA.

## Real private evidence, read-only

- Supplied workbook reread directly: 12/12 checks passed, one detail agrees with summary, bytes unchanged. Its generic date remains a report date and operational SEK remains an assumption where the file omits a currency label.
- Original native invoice checked through the actual Node worker and Sites server extraction/parser: 9/9 numeric/date/currency fields exact in each engine, no parser issues, native PDF provenance. It remains yellow because currency wording has lower confidence. There is no explicit OCR-labelled reference; the invoice number is not promoted to formal OCR.
- A primary public Bankgiro register resolves the differing payer/customer names to the same legal organization. This resolves the name discrepancy only; it does not establish a report-to-AIS transaction identity or account alias.
- No real invoice registration, import, source relation, allocation, balance change, sync, email or payment was performed as a test. No production processing command was used as a diagnostic.

## Review and remaining evidence

Independent scoped reviews passed reference parsing, invoice labels, worker provenance, optical routing, stored readers, normalization and native PDF reconstruction. Integrated review findings about integer monetary columns, actual serialized source references and complete identifier suffixes were fixed with failing/passing regressions. Current-account review found an extra-live-account uniqueness gap; an exact membership guard and shared-alias regression resolved it before publication.

Final local gates passed: Node775/775, Sites1323/1323, zero failed/skipped; syntax97, TypeScript and production build passed. Exact main/CI/Sites provenance is recorded in the delivery receipt after publication. Existing dependency locks are unchanged. The full Sites development audit has 16 existing moderate findings; production-only audit has zero vulnerabilities and mandatory high/critical gates pass. A breaking tooling downgrade is not a valid way to claim zero defects.

The payment cannot be marked verified from amount/reference/date alone. Required external evidence is an explicit bank-supported recipient-account/AIS-account relation, a stable shared identity or independent bank-issued report/deposit relation, missing currency evidence, and a complete current register/source assessment. Fresh read-only tool results supersede historical register observations. No balance or paid-state decision is authorized by this software delivery.

## Verified delivery and exact continuation

Code `ee3d8aa3716fc818d7703335c5aabba2b32954d5` is on main. [Actions41362005970](https://github.com/sharbel0022/Mgeorge/actions/runs/41362005970) succeeded on that exact SHA: clean installs, Node775/775, Sites1323/1323, syntax97, TypeScript, audit gates and production build. Sites49 succeeded from source `0444e2e13efea60150fc3917ee6c533d0c461ce6`; its source tree exactly equals GitHub's Sites subtree. Runtime9, current audience, auth, DB/R2 declarations and schedules are preserved. [Machine-readable receipt](COMPLETE-OCR-EVIDENCE-DELIVERY.json).

Post-publication native reads show active production Swedbank, no sync error and unchanged workspace revision40/updated timestamp. The native workspace/encrypted account projection is still truncated. Complete registration-table rows do not contain the target, but that table is not the complete invoice ledger; no fresh absence claim follows.

The connected plugin remains callable through its eight previous tools. This chat does not expose `payment_evidence`, `retained_report_evidence` or `bank_account_evidence` after republication (`typeof` is undefined). A new chat may refresh the already connected plugin's registry, as the Sites integration guide describes. A direct unauthenticated metadata request returned HTTP403/1010 and provided no financial evidence; no identity headers, runtime secrets or bypass tokens were used to impersonate the owner.

Continuation: in a chat exposing the new read tools, use exact private payment reference/amount/report date to locate candidates with `payment_evidence`, page only with returned cursors, verify the unchanged supplied workbook by its private digest with `retained_report_evidence`, then use `bank_account_evidence` on the returned owned AIS candidate/report. Read results may establish an explicit alias or truthfully return incomplete. Neither amount/date nor a provider connection proves the report/deposit relation. The new tools never register invoices or allocate payments. Resolve external evidence and review the complete current register before any separate financial action. Existing no-balance-change instruction persists.
