# Preregistered independent supported-normal OCR cohort

Authored 2026-11-06 by a new evaluator. This cohort is separate from all previous experiments and does not replace, repair, or rescore them. No prior images, gold, OCR outputs, metrics, parser/worker implementation, or sibling evaluation logs were read. Only the existing harness invocation interface and field schema were consulted. All data is synthetic, visibly marked TEST, and never sent to production or a financial provider.

## Locked source and scope

Product source: `f5d178ea816d276457685fbc0421cf144f7cf655`, the parent-approved worker-receipt/error-classification fix. No parser logic, model, language, PSM, or runtime mode is changed by this evaluation. Product code is not edited. The installed dependencies are reused only after verifying the lockfile is identical. Runtime/source/model hashes are recorded by the runner. The source import necessary for execution is not implementation review.

12 supported-normal invoices: 6 Swedish and 6 English, all denominated in SEK. Three ordinary layouts are balanced within each language. Nine mandatory image values are present: invoice number, supplier/party, organization number, issue date, due date, gross, net, VAT, currency. Supplier business names and billing recipient are synthetic. Organization numbers have Swedish 6-4 format, third digit at least 2, and an independently implemented Luhn validator (generation and validation use different traversals). Dates are ISO, due 30 days after issue. Net plus 25% VAT exactly equals gross; line items sum exactly to net. Every normal label and value is readable at native resolution; contact sheet visually reviewed before freeze. This validates syntax and checksums, not real-world registry assignment of invented identifiers.

Two separately scored valid-content stress images: slight skew/blur (Swedish) and reduced resolution/contrast (English). Neither is an unsupported currency nor intentionally invalid content. Stress does not enter the normal primary denominator. No unsupported/invalid cohort is included.

## Freeze and call budget

`freeze.json` records UTC time and SHA256 of every image, gold, protocol, generator, review sheet, and runner before any worker or parser call on this cohort. The freeze is also committed before running. No preflight was used. Exactly one `runDocumentProcess` invocation per image, in gold order, sequential workers. Save its complete returned object or thrown error, then call each actual Node and Sites `interpretInvoice` exactly once on that same observation. The runner passes original text, method, confidence, OCR evidence, and actual input SHA; there are no text repairs, confidence overrides, inferred substitutes, or selected retries. Error observations still receive both parser calls on the returned text (or empty text after a thrown worker error), but their values cannot rescue the primary score.

The fixed source is loaded with the existing harness's relative-import adapter for the Sites parser. The adapter contains no fixtures or predictions. No execution on these images is permitted before freeze. A claim file prevents accidental second execution. Any unexpected harness problem is disclosed; no image OCR may be repeated. Raw observations, parser outputs/errors, call events, and first results are retained. No result-driven amendments to corpus, gold, or scoring are allowed.

## Scoring fixed before results

Primary fields are exactly the nine image fields above, 108 expected values per parser on 12 normal invoices. Incoming direction is supplied separately as metadata `{direction:'supplier',direction_confident:true}` and reported independently; it is not claimed as recognized from the image.

For a completed worker and parser: exact correct value = one TP; wrong nonempty value = one FP and one FN; missing/empty value = one FN. Money is compared as integer cents, dates as ISO strings, currency case-insensitively, organization numbers as digits only, party after Unicode NFC/whitespace/case normalization, invoice number after outer whitespace trimming. No fuzzy matches, alternative labels, or OCR repairs are permitted. Extra nonmandatory fields are retained but do not affect this mandatory-field precision.

A failed worker, including a returned `error`, counts as nine FN in the primary denominator even if partial diagnostics exist. A parser exception similarly supplies no credited values. Report TP/FP/FN per field, micro recall TP/(TP+FN), micro precision TP/(TP+FP), and language breakdown. Undefined precision is reported null, never 100%. The target is recall >=85% and precision >=98%, required jointly. Completed-only normal metrics are diagnostic, with the count and excluded failures explicit; parser failures remain within the completed-worker denominator.

Document success requires all nine image fields correct and successful worker/parser. Separately report parser level counts and false green: a green result that has any wrong/missing mandatory image field or worker/parser failure. Direction metadata correctness is a separate counter, excluded from optical totals. Stress uses the same rules but its own denominator of 18. Worker attempted/completed/failed and per-parser calls are explicit.

## Interpretation limits

This is a small controlled synthetic cohort using three clean layouts, one recipient and 25% VAT, not a random or representative production-quality estimate. Swedish OCR runtime is exercised on both languages without changing the model. Passing the targets here cannot establish population-wide precision/recall. Failing here identifies a reproducible problem on valid supported inputs. No tuning, code changes, production actions, or reruns follow from this test inside this evaluation.
