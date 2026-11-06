# Isolated backup recovery and application-token quarantine

This change protects the **Open Payments application-token control plane** in Node's physical SQLite backups. It does not claim that an actual customer archive has been restored, that every legacy provider credential is removed, or that production bank access has been activated.

## Behavior and preservation

`createBackup()` first makes a private `VACUUM INTO` snapshot, including committed WAL data. It verifies the financial registers, original hashes, logical original references and company boundary. Only that private snapshot is changed: the global application-token table is removed, a monotonic recovery revision and random restore marker are written, and the database is repacked with secure deletion before authenticated encryption. Source database, committed WAL, originals and financial rows remain unchanged.

An archive containing an application-token table is rejected even if the table is empty. Case aliases cannot bypass the check, because SQLite identifier resolution and sqlite_master string equality have different case behavior. Foreign triggers/views or foreign-key references involving the reserved control tables are rejected before sanitization. Archives with a malformed control row, active authority (`recovery_required=0`), missing marker or retained operator evidence also fail closed.

New archives already contain the recovery barrier and restore their exact authenticated bytes. A valid pre-coordinator archive is first transformed in a private directory to add the barrier, then independently checked before publication to a fresh destination. Existing restore protections remain: no overwrite, no opening the final destination with SQLite, exclusive file creation, sidecar rejection, file identity and authenticated-byte checks. The whole original financial schema and every original row must still match exactly; the sole additional control table is explicitly verified in the recovery assertions.

The actual common coordinator migration uses `INSERT OR IGNORE` and cannot remove the restored barrier. Readiness, first-family registration and token access all reject it. Release requires an exact trusted operator CAS over the expected revision and restore marker, plus an evidence identifier. The synthetic archive-to-migration-to-coordinator test performs no token issuance or decryption before or after that decision.

## Root verification

| Evidence | Observed result |
| --- | --- |
| Initial new backup behavior tests | 0/9 before implementation; 9/9 after |
| Independent case-alias reproduction | 9/11 before case fix; both formerly failing cases pass after |
| First broad run | Two old full-schema census assertions failed because the new recovery-control table was added; no financial preservation failure was hidden |
| Broad after explicit control-table assertions | 117/117 |
| Archive → actual migration → coordinator gate, plus full backup focus | **118/118**, zero failures |
| Shared coordinator root focus, including distinct OS processes | **108/108**, zero failures |

Raw logs are retained under `../evidence/focused/`. Source commits: backup behavior `785ce3c1084c8cef10e86ce816586ef40f1cebda`; archive/coordinator integration `82c9437` (local candidate history). Local/remote commit mapping is recorded separately when the identical Git trees are published.

## Operator boundary

Do not turn a restored file into an active bank issuer merely because local token rows are absent. Before an explicit release, stop or revoke all prior issuers using the same provider app across every database/deployment plane, or document that the full maximum uncertainty window has elapsed. The implemented pre-send window is one hour plus 50 seconds. Verify the intended credentials, certificate, provider app and authoritative database, keep provider egress disabled during isolated restore, and record the decision under the exact restore marker. No browser or HTTP route for releasing this barrier is supplied.

Node processes coordinate only when they use the same central local SQLite database. Sites Workers coordinate through one D1 database. A Node installation and a Sites installation with separate databases must not independently issue tokens for the same provider application. A designated issuer or separate provider applications are required; this change does not create a cross-platform token broker.

The production backup's 430/430 manifest result is separate evidence. The production encrypted archive and its recovery key were not available for a real isolated restore in this session. Synthetic restore, financial preservation and source-invariance results must not be described as a production recovery certificate.
