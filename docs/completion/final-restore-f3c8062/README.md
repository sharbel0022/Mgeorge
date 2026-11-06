# Final main: isolated synthetic encrypted restore

**Accepted on exact main `f3c80629d4856c2f8ecbb1ed81be391a13ac6be8`, whole tree `c1912a91e44ecaca7095dcaca1201c3904df87d7`.** One existing synthetic drill was executed, with no rerun or expanded test suite. This is the same complete tree tested for PR62; the receipt binds the actual final merge commit separately.

| Verified item | Result |
|---|---:|
| Synthetic originals | 430 |
| Original bytes | 185,567,855 |
| Original SHA-256 checks | 430 / 430 |
| Restored backup table groups | 27 |
| Rows compared across those groups | 456 |
| Required negative cases rejected | 10 / 10 |
| Exit / signal | 0 / null |
| stderr bytes | 0 |

Ledger acceptance retained two invoices and two transactions, each totaling 75,000 cents, one allocation of 62,500 cents, one revoked credit and one revoked Bankgiro link. All independent expected rows, owner identities and original hashes matched. A write after the frozen snapshot was excluded. The deliberately interrupted backup resumed without replacing its snapshot; its internal backup loop completed in 174 steps.

## Negative and isolation checks

Before any restore output was created, wrong key, wrong owner, wrong company, corrupted encrypted original and missing original were rejected. After restoration, acceptance rejected a modified ledger even with a refreshed database receipt hash, a modified plaintext original, a foreign-owner row, a reactivated application issuer and a retained application token. The valid synthetic restored evidence was accepted again after undoing those deliberate local corruptions.

The source database/object fingerprints and object-write count remained unchanged by export/restore/acceptance. Other-owner data was excluded, authorization/transient rows were absent, former worker leases were invalidated, and application-token recovery remained blocked. These are the existing harness's explicit assertions, not a claim of a production recovery operation.

## Measured timing and resources

| Measurement | Value |
|---|---:|
| Backup plus interruption/resume | 3,132.692 ms |
| Encrypted bundle export | 3,186.402 ms |
| Restore plus independent acceptance | **3,625.739 ms** |
| Entire drill inside Node | 12,473.298 ms |
| Entire Node process | 12,682.838 ms |
| Peak process RSS | 776,352 KiB |
| User CPU / system CPU | 12.312083 s / 1.805143 s |

The isolated restore objective was 60,000 ms. Its measured interval includes authenticated bundle validation, fresh SQLite creation, original write/readback and independent row/owner/ledger/SHA-256 acceptance. It excludes operator response, cloud download/outages, key custody/access recovery and production application activation. The 900,000 ms recovery-point interval is a **fixed synthetic scenario**, not measured production RPO. There is no global exclusive-resource lock; local timing is informational.

## Source and process binding

Runtime was Node `v24.22.1`, Linux x64. Only `PATH`, `LANG=C.UTF-8`, `TZ=UTC` and `NODE_ENV=test` were passed to the Node process. No other operator environment, credentials or `NODE_OPTIONS` were inherited. The existing network-isolation guard was loaded. Exact executable, command, timestamps, exit state and `wait4` resource measurements are in `process-receipt.json`.

```sh
env -i PATH="$PATH" LANG=C.UTF-8 TZ=UTC NODE_ENV=test   node --import ./scripts/saas-test-isolation.mjs --experimental-strip-types   sites/scripts/recovery-drill.mjs 430 185567855
```

The command ran in a clean, separate worktree at `/workspace/scratch/aab0f7dc06f9/security-final-restore-f3c8062`. Both source manifests bind the exact commit/tree, 14 restore-related modules, 24 migration SQL files, metadata/lockfiles and the reused `@noble/hashes` JavaScript/package bytes. Those source and dependency hashes match before/after; tracked bytes also match the committed Git objects. Manifest timestamps naturally differ. The Sites lockfile was byte-identical to the existing installation before the temporary dependency link was used; that link was removed after the single run. No package install, source modification or test-budget change occurred.

Raw JSON and stderr are preserved byte-for-byte. `index.json` contains their sizes/hashes and the assertion verification; `source-before.json` and `source-after.json` retain module-by-module hashes. Temporary synthetic restore evidence and its generated encryption key were disposed by the unchanged harness. The earlier historical `docs/completion/final-restore.md` was not edited, and the separate security-CI receipt commit `adea4797d3598365657a1607fedd2abf98f3c4c0` remains on its existing branch.

**`productionRestoreTested: false`.** All 430 originals, rows, identities and encryption material were generated synthetically. Equal counts/bytes do not imply use or restoration of production data. This run supplies the requested final-commit synthetic recovery evidence; root owns the separate main CI gate, merge/release decisions and any future production recovery verification.
