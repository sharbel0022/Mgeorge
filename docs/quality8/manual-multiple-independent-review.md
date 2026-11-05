# Independent review: explicit manual multiple-invoice allocation

## Decision and exact source

**Approved within the reviewed local scope.** No remaining Critical, Important or Minor finding was identified in the final review of `4503944e4ecb9d34f467cbac27830dc529a15312`. Root integrated that client fix as `6325f2d63565e2ab2bd9c02e5e6d3fc50cd04608`. This report is evidence for that review; it assigns no quality score and does not approve an unreviewed future tree.

The adapter review started at `8aa48fc12df52e524f6a5fd3ab483b6c4d7707d2`, including the pure policy, Node adapter and typed canonicalizer from `0cf3695b44f51bcd9e0abb40b58765fdd10d5308`, `4d71982b756e62ff29ed05dc97144bae013f0ae2` and `851d702c9ccf557eb3a3ffa8b550f8211c5d9e19`. The outcome fix is `798f8783aaee9155b1e65db73fc51f68119c6894`; the initial UI is `98fb9a122ea5ccc2049321b22e41fe7ca6679587`.

## Three Important findings, independently closed

| Finding | Reproduction and impact | Closing change and verification |
| --- | --- | --- |
| R1: ambiguous Sites commit outcome | A real local SQL batch commits two allocation rows, then its response is lost. A temporarily absent receipt produced a generic error and a following 404 despite the committed rows. These responses cannot prove that the write failed. | `798f878` maps an unclassified failure after entering the write path, with no readable receipt yet, to `503 MANUAL_OUTCOME_UNKNOWN`. The client keeps the exact request ID and body across errors, 404, remount and retry. Independent before/after-commit injections recover exactly one audit receipt and two rows. |
| UI1: real Node revision rejected by client | The actual Node discovery response uses a lowercase 64-character SHA-256 revision. The initial client accepted only an integer, so its real discovery response never reached editing. Integer-only mock fixtures missed this. | `4503944` accepts only a safe nonnegative integer or canonical lowercase SHA-256 string, preserving strict quote/discovery type and value equality. Actual Node HTTP responses are consumed by the shipped classic client; Sites integer revisions are exercised through the real service and client. |
| UI2: stale controller deletes newer recovery record | An old disposed controller receives success after a new controller has persisted another unknown request. Its cleanup removed the newer session-storage record. No double allocation was demonstrated; durable recovery intent was lost. | `4503944` checks controller activity before success mutation and removes storage only when the complete stored record equals its own pending record. The independent delayed-success case preserves the newer request and restores it on the next mount. Producer regressions also cover an older still-active controller and delayed historical lookup. |

## Strengths verified

The manual operation requires the complete two-to-twenty-invoice reference census, positive safe integer minor units, an explicit reviewed vector and confirmation. It rejects an existing invoice/payment pair and a vector leaving both a payment remainder and unpaid referenced invoices. The automatic C4 policy is unchanged.

Node rereads and validates inside `BEGIN IMMEDIATE`, then writes allocations and the audit receipt in the same transaction without an intervening asynchronous wait. Sites protects its single state-write batch with exact workspace state, quoted consent, document metadata, C3 snapshot and current company authorization fences. Independent cases reject an expired consent, deselected account, changed original owner, revoked or downgraded membership, changed active company context and legacy adoption after review. Historical receipts require current company authorization while remaining readable after the bank connection is revoked.

The client requires the complete immutable quote and an explicit checkbox; inability to persist recovery intent prevents the commit request. Historical receipt recovery precedes new bank-consent discovery. The receipt records manual approval; it does not upgrade automatic source evidence to verified.

## Reproducible evidence

All inputs are synthetic. The final independent run used Node `v24.22.1` against a frozen archive of `4503944`, with 82/82 passing cases:

| Suite | Passed | Duration |
| --- | ---: | ---: |
| Own adversarial adapter, real API/client and lifecycle cases | 22/22 | 6.452 s |
| Existing Node/Sites shared-client and UI regressions | 58/58 | 0.786 s |
| Producer regressions connecting actual API responses to the shipped client | 2/2 | 1.122 s |

The 22 independent cases are now saved in four files. Ten test authorization and final-write fences; six exercise Sites company requests with the real client; five exercise real Node HTTP with the shared ESM client; one reproduces late cleanup of newer pending intent. The separate producer integration exercises the shipped classic Node browser adapter and its JSON transport. Originally the independent cases ran in `/tmp/mgeorge-manual-final-review-bgl1zylv`. Saving changes only relative import URLs in the three relocated files; assertions and scenario logic are unchanged. Syntax was checked after relocation. There was no additional suite run solely to write this report. The accompanying JSON records source and saved file hashes.

To rerun the saved independent cases from the repository root:

```sh
/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --test \
  test/manual-allocation-independent-node.test.js \
  test/quality8/manual-allocation-authorization.test.mjs \
  test/quality8/manual-allocation-sites-client.test.mjs \
  test/quality8/manual-allocation-lifecycle.test.mjs
```

The two existing-suite commands used in the final review were:

```sh
/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --test \
  test/manual-multiple-client.test.js test/manual-multiple-ui.test.js \
  sites/tests/manual-multiple-client.test.mjs sites/tests/manual-multiple-ui.test.mjs

/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --test \
  --test-name-pattern='actual (Node API|Sites route) responses' \
  test/manual-multiple-allocation-api.test.js \
  sites/tests/manual-multiple-allocation-api.test.mjs
```

Earlier adapter and pure-policy runs overlap these cases and are not added to the 82 total. Nine relevant source files were compared with the frozen review commit after testing; the tests had not modified them.

## Declined to judge and remaining limits

This review does not establish an authenticated production-browser journey or pixel-level quality. UI evidence uses the actual templates and client state machines with synthetic DOM/React rendering, plus real local API responses. The tests use a local SQLite-backed D1 facade and injected failures; they do not exercise production D1/R2. In particular, there is no cross-store atomicity guarantee against an out-of-band R2 overwrite after its read.

No customer originals, live bank service, real financial write or production action was used. Root owns the full integration suites, release decision, deployed observation and quality scoring. No remaining code finding is being withheld in these limitations.
