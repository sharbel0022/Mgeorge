# Independent standard-alias safety review

**Decision: no blocking finding in the exact final product diff `100f9c3015da34f772ea0cba53d9871e978ebeab`.** Its whole tree is `e00e40a059109ad0a3b3a35edf4bb8f8df10b536`. The independently prepared, explicitly corrected 106 checks plus 14 separately frozen checks pass **120/120**, exit 0, with no failures, cancellations, skips or TODOs. The unchanged corrected suite gives 78/120 on the baseline product. Final integration CI and release remain the parent's responsibility.

This is a bounded review of standard label recognition and census consistency. It establishes behavior for the supplied synthetic observations. It supplies no optical benchmark, general accuracy percentage, 85% target claim, production restore claim, or release/deployment proof.

## Transparent result sequence

| Stage | Exact source | Passed / total | Failed | Exit | Duration |
|---|---|---:|---:|---:|---:|
| Original pre-diff frozen suite | `f5d178ea816d276457685fbc0421cf144f7cf655` | 70 / 106 | 36 | 1 | 455.118 ms |
| Same original suite, first reviewed candidate | `4c8a2e3f69c6b88b4b8d0bae299c6d30fc7d82ee` | 94 / 106 | 12 | 1 | 397.686 ms |
| Separately frozen supplementary probes, baseline | `f5d178ea816d276457685fbc0421cf144f7cf655` | 6 / 14 | 8 | 1 | 314.967 ms |
| Corrected 106 plus unchanged supplementary 14, baseline | `f5d178ea816d276457685fbc0421cf144f7cf655` | 78 / 120 | 42 | 1 | 801.257 ms |
| Same corrected 106 plus supplementary 14, final | `100f9c3015da34f772ea0cba53d9871e978ebeab` | **120 / 120** | **0** | **0** | **729.359 ms** |

Every row has a preserved raw log in this directory. The first logs use Node's spec reporter despite their original temporary `.tap` names; the saved names identify that format accurately. The final two logs are genuine TAP. Durations are Node test-runner measurements, informational on a shared machine without an exclusive resource lock.

### Oracle correction, not hidden test weakening

The first suite was frozen in `799e909` before the reviewer read the implementation diff or executed either parser. Its 40 text observations and 13 manually authored word-box observations each run through both public parsers. The full original fixture is retained in `cases-original.json.gz` and its original hash/freeze manifest remain available.

Eight of the 12 failures on `4c8a2e3` came from four mistaken positive organization expectations, each exercised in two runtimes. The fixtures placed an unqualified organization number after intervening scalar sections, so the existing ownership policy correctly returned `null` instead of carrying forward an earlier supplier. The correction changes only those four expected organization values to `null`; every input, other expected field, layout assertion, runner, and original negative assertion remains unchanged. This was separately authorized and committed in `76bc962`; see `oracle-correction.md` and its machine-readable record. The British-spelling control already exposed the same mistaken expectation on the baseline. Source ownership rules did not change.

Four other failures were real conservative support gaps: `Amount due: 1000.00 SEK Bill to: Syntetisk Sydhandel AB` and the corresponding `Fakturamottagare:` form returned no total in both runtimes. They were reported to the parent and implementer immediately. Parent authorized the implementer to add the two already-supported explicit recipient labels to the scalar sibling census, requiring the printed colon. Those original positive expectations were **not** changed. The final `100f9c3` passes them.

The 14 supplementary checks were frozen separately in `1008c2f`, after diff review but before their execution. They supply unambiguous immediate local ownership, both organization spellings, a foreign recipient organization, printed recipient colons, and existing colonless next-line recipient inputs. These additional checks retain positive functionality evidence and do not erase the original red results.

## What was independently checked

The final diff touches five product files: the Node/Sites scalar parsers, their matching party-detail modules, and the shared OCR layout label census. It adds the `Issue date` label with guarded token boundaries; harmonizes the existing `organi[sz]ation number` collector spelling with sibling/layout recognition; and recognizes existing explicit `Bill to:` / `Fakturamottagare:` labels in the relevant census. Geometry algorithms, financial arithmetic, model/language/PSM settings, party-role inference rules, worker lifecycle and bank evidence remain unchanged in this diff.

The synthetic checks confirm:

- Exact/case-varied/tab-separated `Issue date`, the supported adjacent-line value, inline sibling values, and equal duplicate aliases are retained.
- Late contradictory, unreadable, missing and impossible dates remain in the complete census, including a contradiction beyond 20,000 characters. Competing dates produce no chosen date.
- `Reissue date`, prefixed/slash/dash/underscore forms, `IssueDateSetting`, plural or suffixed labels, unknown value tails and two bare dates do not produce an invoice date. Paragraph/page gaps do not authorize value borrowing.
- Organization-label suffixes/prefixes remain residual text; they cannot silently trim a malformed scalar. Explicit recipient boundaries are recognized while longer unsupported recipient tokens remain invalid residuals.
- A recipient's organization does not become the supplier's; mixed owner rows stay unowned; an unknown company label does not create a party role. Local owned supplier and recipient organization positives are also checked.
- Word-box reconstruction preserves every original word object once, its text, confidence and bounding box, without mutating input. Unknown labels, multiple plausible owners or values, excessive distance and unrepresented source text retain the raw layout.
- Printed recipient colons allow existing explicit recipient parsing, while the original colonless heading-plus-name input remains byte-for-byte unchanged and keeps the same parser fields/details.

OCR-layout inputs are handwritten word boxes, not observations from an optical worker. The existing OCR confidence cap means a yellow result alone is not evidence against false greens; the assertions inspect exact fields, ownership, residuals, and complete source preservation.

## Reproduction and provenance

`receipt.json` records exact commands and working directories, Node version, all result counts, source commits/trees, hashes of the relevant source modules, both lockfiles, unchanged test loader/network guard, and frozen probe artifacts. A representative final command is:

```sh
NODE_ENV=test \
ALIAS_REVIEW_ROOT=/workspace/scratch/aab0f7dc06f9/security-alias-candidate \
node --import /workspace/scratch/aab0f7dc06f9/security-alias-candidate/scripts/saas-test-isolation.mjs \
  --experimental-strip-types --test --test-reporter=tap --test-concurrency=1 \
  /workspace/scratch/aab0f7dc06f9/security-alias-review/docs/completion/alias-review/probes.test.mjs \
  /workspace/scratch/aab0f7dc06f9/security-alias-review/docs/completion/alias-review/supplemental.test.mjs
```

Run against the exact final source worktree. `ALIAS_REVIEW_ROOT` belongs only to this docs-only harness and introduces no production test bypass. Both source worktrees used an existing dependency installation only after byte-identical root/Sites lockfiles were verified. Relevant source bytes were compared with their committed Git objects after execution, and temporary dependency links were removed; the source worktrees are clean.

No blind corpus, individual gold fields, optical observations or predictions were opened. No OCR calls, holdout replays, provider calls, production operations, source edits, builds, full suite runs, pushes, merges or deployments were performed by this reviewer for this task.
