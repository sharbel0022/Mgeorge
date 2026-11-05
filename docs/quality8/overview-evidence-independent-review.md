# Independent review of overview payment evidence

## Decision and exact scope

**READY for integration of `da12b51507d3a8fcc9a123dd9e752ee2f4479d2f`.** No Critical, Important or Minor finding remains in the bounded independent review described here. This is a code-review decision, not a quality rating or a statement about live bank evidence. Root retains the integrated CI and release gates.

Reviewed sequence:

- Original base: `69ec844e5f3d7d7104da75a264aeaf4144804bdb`.
- Initial overview change: `407f5f9c3cbe04af49a3c4a7fea92ad80597696e`.
- Shared source checks, intermediate: `ae3b6433471c181dbc0da00236a6d6406149d7d2`.
- Owner index and retained-reference fix, final candidate: `da12b51507d3a8fcc9a123dd9e752ee2f4479d2f`.

The final candidate was inspected and tested from a separate `git archive`, not the author's moving worktree. Production changes in this sequence are limited to `sites/lib/domain.ts`, `sites/lib/economy-summary.js` and `sites/lib/payment-presentation.ts`. This review commit contains only independent tests, the measurement helper and this evidence. It changes no production code, ledger, originals, customer data, package or rating file.

## Strengths

The overview and payment presentation now share a source assessment that distinguishes retained bank facts from manual overlays and unsupported detail metadata. A historical allocation still determines paid/remaining balances; an incomplete source no longer earns verified overview attribution merely because that allocation exists.

The independent positive controls retain complete AIS originals, saved full and partial bank detail responses, explicit sourced refunds, and manual completion that preserves the actual bank payer. Updated older fixtures establish the source/document associations required by the behavior under test. They do not replace missing evidence with a new assertion or weaken the financial-balance expectations. Synthetic document IDs are associations in these pure projections, not evidence that a physical object was checked.

The new owner lookup indexes once inside each synchronous projection. It keeps paid, unreviewed and conflict-bearing invoices in the owner census and excludes only the same voided invoices as the existing rule. Strict identifiers use the existing canonical reference function. Generic keys select possible candidates; the existing authoritative matcher still decides ownership, including case, labels, separators and leading zeros. The normal write-side reference guard retains its full-census behavior while sharing the same resolved policy predicate with the projection.

No global cache is introduced. Independent tests alternate company policies over the same invoice objects, change a company's policy between reads, and add/remove a held owner with a conflicting original. Each new projection observes the current state. The separate index parity tests cover scoped/generic policy, receivable/payable direction, labels, Unicode normalization, punctuation, leading zeros and held original identifiers.

## Findings closed after reproduction

The original fourteen independent cases and the later five boundary cases are preserved byte-for-byte in this review commit. They were not edited to fit the final candidate.

| Finding | Earlier behavior and classification | Final independent result |
| --- | --- | --- |
| Unsupported `bankDetails` supplied a missing original payer/reference, including manual-only historical rows and refunds. | Three original repro cases; older gaps present before the initial overview change. | Held in overview; detail does not claim VERIFIED. |
| A receiving-account hold blocked detail but not overview attribution. | Original Important, older gap. | Held, including an ancestor account hold. |
| Allocation to invoice `00599` with bank reference `00600` remained verified in overview. | Original Important, older gap. | Held without changing the booked balance. |
| Retained AIS reference `00600` could be hidden by saved detail reference `00599` for invoice `00599`. | Additional Important; already false green in the `407f5f9` summary. | Both preserved references participate in the active company policy; overview holds the allocation. |
| An incomplete saved detail response with empty selected reference disappeared behind a complete AIS reference. | **Regression in `ae3b643`**: the `407f5f9` summary correctly held it, whereas the intermediate version reported 10,000 verified öre. | The invalid/incomplete union is checked; zero verified öre and one hold, with booked balance preserved. |
| Full reference-owner scan repeated for every allocation. | **Performance regression in `ae3b643`**, independently measured below. | One local owner index replaces the repeated census; policy and ownership parity remain green. |

The two later reference cases are produced through the real `transactionDetailEvidence` function. The incomplete response has 101 synthetic remittance observations, which the bounded extractor marks incomplete. No retained receipt is resealed to make a negative case pass.

## Verification

Runtime: Node **v24.22.1**, using `/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node` directly. All test cases are local and synthetic. No provider call or production financial action was used.

- **19/19 independent cases pass**, unchanged from their earlier red reproductions: fourteen original cases and five state/source boundary cases.
- **150/150 targeted tests pass**, no failures, skips or cancellations. This total includes the 19 independent cases, the author's relevant source/account/presentation tests and six index parity tests. Some cases deliberately overlap; 150 is a runner total, not 150 independent failure scenarios.
- The frozen archive's source files match the candidate git object. The independent test hashes are recorded in `overview-projection-independent-performance.json`.
- The benchmark was repeated once to verify the persisted portable measurement entry point. Both final runs, including the noisier first run, are retained in the JSON evidence.

The targeted files were:

```text
sites/tests/review-economy-evidence-independent.test.mjs
sites/tests/review-economy-projection-boundaries.test.mjs
sites/tests/economy-payment-evidence-independent.test.mjs
sites/tests/economy-payment-evidence.test.mjs
sites/tests/economy-quality-cycle.test.mjs
sites/tests/economy.test.mjs
sites/tests/bank-account-consent.test.mjs
sites/tests/payment-evidence-status-final.test.mjs
sites/tests/bank-payment-ui.test.mjs
sites/tests/payment-reference-owner-index.test.mjs
```

Use `NODE_ENV=test`, `--import ./scripts/saas-test-isolation.mjs` and `--test` with those files from a checkout/archive containing the final candidate plus these independent review files. The evidence-only review branch itself need not contain the author's production commits; the reported results are explicitly from the frozen candidate archive.

## Projection performance

Identical fixture population and evaluation order: the old `407f5f9` summary first, then the candidate summary, for 100, 500 and 1,000 invoice/payment/allocation triples. Both summaries in each run use the same domain module from the selected candidate. All values are synthetic and every summary reports exactly `count * 10,000` received öre, zero held allocations.

| Rows of each kind | Before / after on intermediate `ae3b643` | Before / after on final `da12b515`, first run | Before / after on final `da12b515`, persisted-script check |
| ---: | ---: | ---: | ---: |
| 100 | 42.12 / 32.12 ms | 72.72 / 75.68 ms | 42.62 / 22.91 ms |
| 500 | 37.37 / 507.59 ms | 141.83 / 135.46 ms | 46.42 / 45.96 ms |
| 1,000 | 58.37 / 1,871.00 ms | 76.77 / 117.23 ms | 73.12 / 109.86 ms |

The 1,000-row final projection takes approximately **110–117 ms** in these two runs, versus **1,871 ms** in the intermediate version. The final version still performs stricter source/policy work than the old summary; the last paired 1,000-row result is about 1.5 times the old summary's time. The earlier roughly quadratic owner-census cost is removed by the inspected index design.

These are single-process, cold-order measurements with visible host/JIT/GC variation, not percentiles or a production service-level claim. The source loop and the before/after evidence support removing the repeated census; the small samples do not establish browser responsiveness, capacity or a general latency guarantee.

The read-only helper is `scripts/review-overview-projection-performance.mjs`. Arguments are the candidate checkout/archive root, comma-separated counts, and optionally a repository containing the old commit object. For example, from the candidate archive:

```sh
NODE_ENV=test /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --import ./scripts/saas-test-isolation.mjs \
  /path/to/review-repository/scripts/review-overview-projection-performance.mjs \
  /path/to/frozen-candidate 100,500,1000 /path/to/repository
```

## Critical / Important / Minor

None remains in this bounded review of the final candidate. Every earlier blocker above is closed only after its preserved negative case and relevant positive cases were rerun successfully.

## Declined to judge and external boundaries

This review does not establish actual production payer identity, current consent/account access, physical R2 object availability, fresh original-byte integrity, bank confirmation, browser layout or deployment behavior. Saved detail metadata needs the retained document association and AIS provenance for presentation; authoritative fresh byte checks remain a separate service boundary. No synthetic result increases a production evidence grade or proves a quality score. Root owns the full integrated test run and publication decision.
