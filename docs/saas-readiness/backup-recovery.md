# Backup and recovery: Agent 5 evidence

The isolated synthetic restore and the separate file-format fidelity test passed on the source below. The full restore verified **430 originals, 185,567,855 bytes, 27 populated durable tables and 22 negative controls**, with **3,080.262 ms** for restore plus independent acceptance. The format test also restored real synthetic PDF, PNG, CSV, XML and XLSX bytes and passed the relevant parsers before and after recovery.

This is a frozen observed recovery receipt. It is not a production restore or approval of the whole release. The final PR checks must identify their own exact source; documentation changes do not inherit a new verification claim. Earlier intentionally RED candidates are recorded below.

## Frozen execution identity

[Recovery run 42309880196, job 128208396548](https://github.com/sharbel0022/Mgeorge/actions/runs/42309880196/job/128208396548) logged the parsed report at 2026-11-06T23:09:45.9429720Z. The exact [wrapper receipt](evidence/recovery-d2cad86-receipt.json), [drill result](evidence/recovery-d2cad86-result.json) and [format-fidelity diagnostic](evidence/recovery-format-fidelity.json) are retained separately.

| Field | Observed value |
| --- | --- |
| PR head | `d2cad86a65237ae7a7bbaf2e1d8bc72de847d111` |
| Actually tested PR merge checkout | `bad0a67b1e61c562c420f4e53f391c136c07e662` |
| Source tree | `235fb2d55ffeabeb735882fa59db40e0aab157f5` |
| Base main | `f3c80629d4856c2f8ecbb1ed81be391a13ac6be8` |
| Runtime | Node v24.22.1, Linux x64 |
| Drill started / completed | 2026-11-06T23:09:34.161Z / 2026-11-06T23:09:45.692Z |
| Source status | Clean before execution; unchanged during execution |
| Backup / resume | 5,032.653 ms; 174 bounded steps; one injected interruption |
| Authenticated export | 1,434.150 ms |
| Restore plus independent acceptance | 3,080.262 ms, within the isolated 60,000 ms objective |
| Whole drill | 11,531.001 ms |
| Simulated RPO | 900,000 ms; fixed scenario cutoff, not observed production cadence |
| Artifact | [13548361593](https://github.com/sharbel0022/Mgeorge/actions/runs/42309880196/artifacts/13548361593), aggregate results, format TAP and logs; no originals or keys |

The CI command was:
```sh
node scripts/run-saas-recovery-acceptance.mjs "$RUNNER_TEMP/saas-recovery-acceptance"
node scripts/verify-saas-release-evidence.mjs recovery "$RUNNER_TEMP/saas-recovery-acceptance" "$GITHUB_SHA"
```

The wrapper uses an environment allowlist, excludes operator credentials and NODE_OPTIONS, and sets NODE_ENV=test. The actual child command from the receipt is:
```sh
NODE_ENV=test node --import ./scripts/saas-test-isolation.mjs \
  --experimental-strip-types sites/scripts/recovery-drill.mjs 430 185567855
```

The guard blocks accidental non-loopback network calls by trusted test code. It is not a malicious-code sandbox. The drill accepts only bounded synthetic counts, byte totals and scenario time; it accepts no customer source, production destination or key.

## What was compared independently

The drill freezes source rows and original SHA-256 values before backup. It then interrupts copying, resumes the same authenticated snapshot, and excludes a later source write. The exported backup identity, company binding, snapshot checksum and three retained source-file hashes are captured before restore. None of these expectations comes from the restored receipt.

Acceptance reads the new evidence-only SQLite database and every recovered original. It compares all retained rows, owner identity, file census and hashes. Worker leases are invalidated explicitly; the application-token issuer remains recovery-blocked; memberships, grants and transient rows are absent. Source financial rows and source objects remain unchanged by export and restore.

The frozen ledger has two invoices totaling 75,000 öre, two transactions totaling 75,000 öre, one allocation of 62,500 öre, one revoked credit and one revoked Bankgiro link. Negative controls change allocation and revoked-link references while retaining totals and refreshing the database receipt checksum. Complete-row comparison rejects both mutations.

The first five negative controls reject wrong key, owner, company, corrupted ciphertext and a missing original before creating output. The other seventeen reject changed ledger/plaintext, foreign owner, reactivated issuer, retained application token, five altered receipt fields, three altered retained source files, missing/extra source files and the two reference mutations. The JSON preserves the exact case list and stages.

| SHA-256 binding | Frozen value |
| --- | --- |
| Original recovery-drill.json bytes | `5e3751aa82ebf551087e82d45f852dffba1dc32aede929c12c633db63591d087` |
| Uploaded artifact archive | `2a752aeb26b3184be7a45f16301d72db321889263d0f5a820c9553047b5a9fe1` |
| Pre-backup table census | `331b086bdf05bb0491aea56fcc9a046f02f5f742fa4f070e36b93936c879f429` |
| Pre-backup original census | `add50d91f475ee79ffec6c4e146f60f15177eacd06752dfe7ca748a54042d3be` |
| Authenticated plaintext snapshot | `abf04fc5f299113767bb009eb13f453511c5f412b6bb7090a4ff01b1520f4b26` |
| Retained manifest.bin | `6ce76ed11cd607fa8284eb7a3f5e93d01e522d9ad273d58a862bae74f2cdfc13` |

The JSON also records the encrypted snapshot and bundle-header hashes. Encryption uses a fresh ephemeral key; no key is printed, retained in these reports or uploaded.

## Reproduced acceptance defects and correction

The earlier [acceptance oracle](../../sites/scripts/lib/recovery-acceptance.mjs) checked recovered financial rows and original bytes but did not bind five receipt fields or retained source files to independent provenance. The new regression first ran against unchanged acceptance code: [run 42308462021, job 128203695537](https://github.com/sharbel0022/Mgeorge/actions/runs/42308462021/job/128203695537), PR head 7ae959fb, tested merge 6cfb5cd7. **14 recovery tests: 3 passed, 11 failed with missing expected exceptions.** The authentic baseline and both financial-reference mutation controls already passed.

After the narrow oracle correction, [run 42308964853, job 128205377402](https://github.com/sharbel0022/Mgeorge/actions/runs/42308964853/job/128205377402), head 4f703b3f / merge 383a25e8, passed **14/14 recovery regressions**; its combined targeted job passed 104/104 with zero failures, cancellations, skips or TODOs. No production encryption or backup-engine implementation was changed for this finding.

Independent review then found the release verifier accepted renamed table entries, some changed ledger totals/counts, a wrong negative-control stage and a malformed backup identity. [The eight regression failures](https://github.com/sharbel0022/Mgeorge/actions/runs/42309256114/job/128206341547) are retained: 112 total, 104 passed, eight failed. That earlier ee1e714 candidate was overall RED despite its separate 3,025.370 ms restore success. The follow-up pins the independent 27 table names, all eight ledger fields, a canonical backup UUID and every negative-control stage. The stricter release gate accepted the new full recovery on d2cad86a / bad0a67b recorded above.

## Format fidelity, separate from volume

The 430-object fixture matches an inventory's count and byte volume using generated placeholder bytes. It does not represent a collection of valid PDFs, images and bank files.

The new [recovery-format-originals.test.mjs](../../sites/tests/recovery-format-originals.test.mjs) uses five genuine synthetic formats: PDF 1.4 and a 1400×1400 PNG generated by the existing invoice fixture; the explicitly synthetic CSV and camt.054 XML fixtures; and XLSX produced by the existing SheetJS fixture writer. It validates PDF text, decoded image dimensions and the CSV/XML/XLSX payment/reference fields before and after the real encrypted export and isolated restore. It compares exact bytes, hashes, retained rows and source preservation. Parser results never post financial changes.

**Observed execution: 1/1 passed, zero failures, cancellations, skips or TODOs**, in the dedicated format step at 2026-11-06T23:09:33Z on the same checkout as the full restore. All five parsers accepted the bytes before and after recovery; source data and financial references were preserved.

| Format | Bytes | SHA-256 of original and restored file |
| --- | ---: | --- |
| PDF | 947 | `abc37b2d3380763487bb93b669d0c0ac84191573e4cae77104fd6d3b262c38db` |
| PNG | 101,995 | `b689ad57e3ed02dc127c76b976e795b54c2a61a8b3a7a3255527752e12dea2df` |
| CSV | 218 | `b9454d21d15792d7d8de2d9fe523181193ceef8b72737348aa9bed2c853b3683` |
| XML | 776 | `2ea4d8982036567e340cb120b74db2616e345807477a585a6d523ace497b332f` |
| XLSX | 9,891 | `af0fbc7d422f146ed179603bd6fd3f71ba5bcfafb28af4dff3f56d5134866705` |

This complementary test does not measure OCR accuracy, validate a bank's full XML schema/profile, establish customer entitlement or certify a real customer corpus.

## Remaining risk register

| ID | Limit / status | Required operational evidence |
| --- | --- | --- |
| BR-01 | Production restoration and key recovery: NOT VERIFIED. | Authorized operator, independently retained encrypted copy, actual key access and tenant-bound isolated restore under reviewed private handling. |
| BR-02 | RTO covers local bundle verification, SQLite creation, original writes/readback and acceptance only. | Measure operator response, cloud transfer, regional failure, key custody recovery and application activation separately. |
| BR-03 | Fifteen-minute RPO is a fixed scenario. The [backup implementation](../../sites/lib/backup-engine.ts) makes one snapshot per Stockholm date. | Observe real successful cadence and retained recovery points; agree a production RPO supported by that schedule. |
| BR-04 | Volume fixture and format fixture exercise different dimensions; 26 durable tables have one row each. | Approved production-scale distribution, larger ledger histories and supported size-limit tests; current [Sites bounds](../../sites/lib/backup-engine.ts) include 5,000 rows/table, 12 MB snapshot and 15 MB/original. |
| BR-05 | Evidence output is deliberately incompatible with live table names. | Reviewed activation/rollback procedure, current membership reconstruction and explicit worker/application-token authority recovery; never treat a successful evidence restore as activation. |
| BR-06 | Encrypted bank/Gmail state is retained as evidence; not every provider consent is removed. | Revalidate live provider consent, credentials and schedule authority before any separately authorized production use. |
| BR-07 | Offsite retention, regional durability and tenant-specific retention/deletion are unverified. | Operations/security retention and independent-copy receipts under the commercial launch gates. |

No customer originals, real bank calls, production database writes or production recovery occurred in this work. The [commercial launch gates](../saas/COMMERCIAL-LAUNCH-GATES.md) remain separate, including L11 production recovery.
