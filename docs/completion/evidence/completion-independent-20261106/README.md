# Preserved independent OCR experiment

Evaluation: `completion-independent-20261106`. Newly authored synthetic material, not the unavailable historical V3 corpus. The first pass is completed and must not be overwritten or relabeled as a fresh blind test.

## Evidence map

| File | Meaning |
| --- | --- |
| `predeclared-plan.md`, `run-plan.json` | Original preregistration and fixed case order |
| `corpus.json`, `build_corpus.py` | Original synthetic source facts, gold and exact raster generator |
| `freeze-manifest.json`, `freeze-receipt.json` | Original SHA256 freeze of 23 files, before any OCR/parser call |
| `frozen-images.tar.gz` | All 19 original PNG byte streams, with simple `<case-id>.png` archive names |
| `runtime-audit.md` | Pre-optical enum translation, execution contract and setup notes |
| `runtime-binding.json` | Pre-optical runner/scorer/source/dependency hash binding |
| `run-first-pass.mjs`, `score-first-pass.mjs` | Executed first-pass runner and unchanged preregistered scorer |
| `attempts.jsonl`, `run-receipt.json` | Original append-only attempt ledger and completed run receipt |
| `raw-first-pass.tar.gz` | Unchanged individual optical observations and both parser outputs; 59 files under `first-pass/` |
| `optical-observations.json` | Compact derived view of actual OCR text, confidence and errors; full raw evidence remains in the archive |
| `scores.json` | Original score output including every field comparison and both populations |
| `run-console.log`, `process-resources.json` | Original process output, exit code and resource measurements |
| `infrastructure-diagnostics.json`, `post-run-setup-diagnostics.json` | Read-only diagnostics after the first pass, without input image/OCR/parser calls |
| `verify-evidence.py`, `verification-receipt.json` | Separate post-run mechanical verification of schema, fixed denominators, hashes, exactly-once ledger, error propagation and independent recount |
| `source-comparison.json` | Source identity comparison with the published merge candidate |
| `delivery-manifest.json` | Hashes of the delivered evidence and report; supplements rather than replaces the original freeze |

The original freeze manifest and receipts retain absolute paths to preserve their original bytes. The portable archives use relative names. `verify-evidence.py` maps the original paths to these archive names and verifies the actual bytes without extracting them, installing dependencies, loading a parser, or running OCR:

```sh
python3 docs/completion/evidence/completion-independent-20261106/verify-evidence.py --check-only
```

The images archive is about 2.38 MB; all original raw worker/parser records compress to about 23 KB. No large OCR models or dependency trees are committed.

Original scratch locator: `/workspace/scratch/aab0f7dc06f9/independent-ocr-raw/completion-independent-20261106`. The worktree used was `/workspace/scratch/aab0f7dc06f9/Mgeorge-independent-eval`. The portable archives retain all frozen rasters and per-attempt observations if scratch is later unavailable.

The source baseline was `6b1d0c71214395d2d8294b5823bc015b97e51909`; the published merge comparison is `24390ef7e8cf6b2274c57804dc9c2d74d362ab12`. The original runner intentionally refuses an existing runtime binding or ledger. The original scorer refuses to overwrite `scores.json`. Future infrastructure diagnostics or a new experiment require separate output and honest labeling; this first pass stays unchanged.
