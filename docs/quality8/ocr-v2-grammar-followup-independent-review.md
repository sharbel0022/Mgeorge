# Independent follow-up review of the V2 grammar correction

## Decision and exact scope

**READY** for `ae56dc9a9e3d76697e38a196692a337ae0900b0d`, whose parent is
`abe5c1e099143ca59015562c5047b252ba9952bb`.

The Important and Minor findings recorded in
`ocr-v2-grammar-independent-review.md` are closed on this exact version. No new
concrete blocking finding remains in this scoped review. The earlier report
and its NOT READY decision for abe5 are preserved as historical evidence.

This decision covers only the four parser/detail production files changed by
ae56. It does not approve subsequent geometry work, establish a new holdout
result, or replace root's integration gates. No optical calls, production
requests, V3 images, V3 answers or V3 generator reads were part of the review.

## What was checked

The correction was read and executed from a fresh exact Git archive at
`/tmp/mgeorge-v2-grammar-rereview-_4o74v7a`, independently of the author's
worktree. The original 64-case file was loaded byte-identically from the earlier
review snapshot, with `REVIEW_SOURCE_ROOT` selecting the new archive.

The shared money-label definitions now supply both their own value census and
the sibling boundaries. The complete explicit compound Summa moms is collected
inline. Unsupported generic inline VAT/net suffixes stay attached to the source
value and cannot disappear through a broader boundary. The same collector
patterns also bound a company name. Therefore the original contradictory and
unreadable VAT cases are held, while a correct complete inline amount can be
separated from the exact company name.

The expanded name heading no longer borrows an unknown colon-labelled next
line. Explicit absence phrases are rejected as whole values, while company
names that merely contain an absence word remain legitimate positives. The
recognized organization-owner event prevents creation of an additional empty
bare-name event; its own validity and duplicate-value census still run.

No amount calculation, OCR spelling repair, threshold change, registration
change or layout change is present. The two detail modules are byte-identical,
and both actual scalar consumers pass the same independent cases.

## Independent verification

| Population on exact ae56 | Pass | Fail | Skip | Duration |
| --- | ---: | ---: | ---: | ---: |
| Original 64 + delivered 56 + new boundary 80 | 200 | 0 | 0 | 798.956 ms |
| Additional independent source-census probes | 32 | 0 | 0 | 640.658 ms |

The original 64-case file remains SHA-256
`135175e9990f0bbe6661e56a0f29efd3f9e05d0ce2034c22ccc168fc3cfd3f8e`.
Its previous 28 pass / 36 fail result on abe5 is not overwritten.

The additional population is **8 synthetic cases × Node/Sites × PDF/OCR**:

- unreadable owner-qualified organization beside valid evidence;
- missing owner-qualified organization before another invoice label;
- conflicting valid organization numbers;
- identical owner-qualified organization evidence as a legitimate positive;
- three complete inline monetary aliases retaining exact separate values;
- an unsupported generic VAT suffix after a total;
- a competing explicit VAT amount after a currency field;
- an explicit absent supplier that a second complete supplier cannot erase.

All original text was retained in these probes, and OCR never became green.
The new test is `sites/tests/review-v2-grammar-followup-independent.test.mjs`,
SHA-256 `aca97a0026c912420f614123a4d4b30ccf88f1a539f7153884b22aed45f107e6`.
The companion JSON records production-file hashes and all individual outcomes.

Commands used direct Node 24.22.1 and the existing test network guard:

```sh
NODE_ENV=test REVIEW_SOURCE_ROOT=/tmp/mgeorge-v2-grammar-rereview-_4o74v7a \
  /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --import ./scripts/saas-test-isolation.mjs --test \
  /tmp/mgeorge-v2-grammar-review-fhluchnz/sites/tests/review-v2-explicit-grammar-independent.test.mjs \
  sites/tests/invoice-v2-explicit-grammar.test.mjs \
  sites/tests/invoice-grammar-boundaries.test.mjs

NODE_ENV=test \
  /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --import ./scripts/saas-test-isolation.mjs --test \
  sites/tests/review-v2-grammar-followup-independent.test.mjs
```

## Limits and handoff

These 232 focused executions are a code-regression check, not a precision,
recall, coverage or production-timing measure. The author's wider 434-case run
and typecheck are separate evidence and are not represented as independently
repeated here. The first V2 acceptance remains FAILED; the two later optical
observations remain openly post-holdout diagnoses.

Root and the author received READY on the exact source SHA. The proposed
geometry changes may proceed separately and require their own frozen review.
No scorecard or rating is changed by this test/document commit.
