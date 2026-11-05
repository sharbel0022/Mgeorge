# Invoice candidate CI fixture repair

2026-11-05. Base: `9ce08a5b830e3acbfc3f6131053298072c971ac4`. Isolated branch: `fix/invoice-candidates-source-fixtures-20261105`.

## Finding and scope

The unchanged `sites/tests/invoice-candidates.test.mjs` reproduced the five reported PR 56 failures: **15/20 pass, 5 fail**. Each failing case supplied only `bankDetails: { payerReference }`. That shape has neither saved detail status/original identity nor AIS provenance. The current source policy correctly withholds that reference and returns amount-only review suggestions. Restoring trust in that incomplete shape would weaken the production rule.

Only this test file and this report change. No production code, shared fixture helper, dependency, scorecard, original document, balance or allocation changes. Root owns the separate UI failures and full integration checks.

The positive cases now use the existing `paymentFieldSourceFixture` with an unlinked report and the scenario's detail reference. Its AIS row is constructed from a new synthetic provider JSON response, imported through the trusted synthetic import path and checked by `bankApiOriginalIssue`. Its separate detail metadata includes the retained original ID, response status and parsed reference evidence. The helper is reused unchanged; a damaged original is never rehashed or repaired to make a test pass.

This is a read-only projection test. Saved detail provenance does **not** stand in for a fresh owned R2 document/byte check, current bank permission, customer identity or permission to allocate. Those services retain their existing checks. No real bank or customer data is used.

## Preserved assertions

All original expected values remain. In particular:

| Bank reference | Candidate identifier | Expected exact candidate |
| --- | --- | --- |
| `AB12` | `AB-12` | No |
| `AB-12` | `AB12` | No |
| `Faktura 0599` | `0599` | Yes |
| `0599` | `599` | No |
| `0599` | `0599` | Yes |

These assertions still run for registered invoices and unregistered extracted documents. The separate document reference `000018` and legacy OCR `000026` remain conflicting review evidence; shortened `18`, `26` and `606` still do not match. Structured detail `0599` still takes precedence over equal-amount `0600`. None of these proposals authorizes a payment.

## Added negative controls

Eleven additional tests make the source distinction explicit:

- The old bare `bankDetails` shape exposes no bank reference and retains both equal-amount review suggestions.
- Removing or blanking the detail original ID, removing the status, setting an unsupported status, or removing AIS provenance does not create an exact source selection.
- Mutating the received JSON, its receipt hash or the retained original reference produces the actual original-integrity issue and a `BLOCKED` decision. These tests do not erase useful review candidates or reseal altered evidence.
- A valid separate manual overlay remains separate from the bank reference, both with and without backed detail metadata. Setting `verified: true` cannot turn that overlay into a bank reference or a verified invoice link.

Each new case preserves its state, transaction and document inputs and retains zero allocations. The positive exact-reference case also checks that its selected source is the detail original and its inputs remain unchanged.

## Verification

Direct runtime: **Node v24.22.1**. No installation or shared dependency modification. Commands run from `sites/` with the repository's test isolation preload and one test process at a time:

```sh
NODE_ENV=test /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --import ../scripts/saas-test-isolation.mjs \
  --experimental-strip-types --test --test-concurrency=1 \
  tests/invoice-candidates.test.mjs
```

| Check | Result |
| --- | --- |
| Unchanged base file | 20 tests: 15 pass, 5 fail; 885.347 ms |
| Final candidate file | 31 pass, 0 fail/skip/cancel/TODO; 757.909 ms |
| Final focused group below | 119 pass, 0 fail/skip/cancel/TODO; 3,337.078 ms |
| `git diff --check` | Pass |

The final focused command replaces the single test argument above with:

```text
tests/invoice-candidates.test.mjs
tests/payment-reference-sources.test.mjs
tests/bank-api-original-q8.test.mjs
tests/bankgiro-link-presentation.test.mjs
tests/invoice-reference-integration.test.mjs
```

The 31 tests are included in the 119, not added to them. An intermediate expansion passed 30/31: the new old-shape test attempted full presentation with a minimal fixture lacking required string fields. Empty ordinary transaction strings were supplied to that negative fixture; its unbacked `bankDetails` shape and all assertions were retained. This intermediate fixture error is not counted as a passing run or a product defect.

Temporary local logs: `/tmp/invoice-candidates-ci-red-9ce08a5.tap`, `/tmp/invoice-candidates-ci-green-final.tap`, `/tmp/invoice-candidates-ci-focus-final.tap`. This repair does not claim a green full Sites suite, successful remote CI, deployment or production bank evidence. Independent review and root's exact integrated CI remain required.
