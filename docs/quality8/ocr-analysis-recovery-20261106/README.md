# OCR analysis recovery checkpoint — 2026-11-06

This documentation-only checkpoint preserves the existing analysis text and structured session data during an unavailable execution environment.

## Source distinction

**The analysis source is the locally frozen product commit c5cdd0fe57d300ba40f6572cbbe39c7fce9397e7 and the already completed optical result with SHA-256 8957731b7f0f1ed9fed6bb53683b65cf352138e4b1f3f7fa0ee8f5980dfa2756.**

The GitHub checkpoint is based on actual main commit 237dd45e7e1b40513d2dd25ccff59bb08f023264, tree 2fcd7736a029663e7519d31ed91be1e2db24cf17. Both the main ref and commit/tree were read back through the connected GitHub service before writing.

**The product code inherited from that GitHub base is not the source measured by the c5 optical run.** This checkpoint does not claim c5 exists in the branch's product tree, does not apply OCR changes to main, and does not retroactively bind any result to main237.

## Exactly what was preserved

- [analysis-report.original.sv.md](analysis-report.original.sv.md): exact surviving functions.store string, including its original uncertainty and interruption status. It was not reconstructed or edited for this checkpoint.
- [evidence-checkpoint.original.json](evidence-checkpoint.original.json): the surviving structured checkpoint, serialized as indented JSON without changing its values.
- [analysis-metadata.original.json](analysis-metadata.original.json): the original historical metadata, likewise preserved. Statements such as "functions.store only" describe the earlier interruption checkpoint; they are intentionally unchanged.
- [synthetic-plan-ids.original.json](synthetic-plan-ids.original.json): independently constructed synthetic fixture literals. They are not verified company/account facts, not corpus aliases, and were not submitted to the parser or any optical worker.
- [recovery-provenance.json](recovery-provenance.json): new provenance for this GitHub recovery, hash bindings, explicit limits and the inventory of unavailable local material.
- [SHA256SUMS](SHA256SUMS): UTF-8 SHA-256 digests for the six other files. As usual, this manifest does not hash itself.

All four original session keys were present when checked after followup. The Markdown is byte-for-byte the UTF-8 encoding of the original stored string. For JSON, data identity is asserted after lossless serialization; no nonexistent prior filesystem byte representation is claimed.

## This is not a full restoration

The complete 3.4 MB optical result and producer observations, the independently locked optical archive, its 38 journal snapshots and exclusive claim, the original live journal, source images/gold, the full geometry script and any last diagnostic outputs have **not** been recovered into this directory.

Their last known local locations and known hashes are listed in recovery-provenance.json. The local optical archive was reported locked at 2ca47860bd1dc587e0fec0a3dfbcedac8477a6fb; its main receipt SHA-256 was fe9b332ba9de45e77a74eefaabba20087fbff556ac326d8fa52d68b9fbd32bb1. These are recorded prior provenance, not newly fetched original bytes. This task has not established another remote backup of those artifacts.

Exact name-word boxes and complete region boundaries for the six missing party fields, the last diagnostic command's completion, and a complete 39-field causal matrix remain unverified. No word ID, geometric boundary, source file, journal member or test result was invented to fill a gap.

## Scope and authorization

Root explicitly authorized a separate checkpoint branch and writes only under docs/quality8/ocr-analysis-recovery-20261106. The intended branch is checkpoint/ocr-analysis-recovery-20261106-0532.

No product or old evidence file is changed. This operation opens no PR, merges nothing, deploys nothing, runs no optical worker or parser, and accesses no V3 material. The readable plan is approved only for further investigation after the environment returns; no product changes are authorized by this checkpoint.

The known run remains below its recall requirement: Node=Sites, normal all13 91/130, mandatory69/100, image9 59/90, all FP0, all10 review; both stress cases non-green. These are recorded outcomes of the exact c5 run, not new measurements or blind acceptance.

## Verification

File hashes are computed over exact UTF-8 content. The in-memory SHA-256 implementation was checked with three standard known-answer vectors and an explicit Swedish/Unicode UTF-8 byte vector. After the commit is created, each file must be fetched through its full immutable commit URL, compared to the prepared string and rehashed. Git tree/compare checks must show only additions in this directory and an unchanged base product tree.

When a shell becomes available, the manifest can also be verified with sha256sum -c SHA256SUMS from this directory. Such a shell check has not been claimed during the outage.
