# Quality evidence: sites

**FAILED** — commit `2982b6c51cf2891d97b816ea1ce6c82e5f4c71a1`; working tree dirty: false.

**Synthetic acceptance only. Real bank verification: NOT_RUN. Production performance: NOT_MEASURED.**

| Gate | Result | Tests / pass / fail / cancelled / skipped / TODO | Duration |
| --- | --- | --- | --- |
| minimatch-mitigation | PASS | — | 1.70 s |
| typecheck | PASS | — | 32.53 s |
| audit-production | PASS | — | 5.47 s |
| audit-all | PASS | — | 63.90 s |
| sites-tests | FAIL | 5569 / 5567 / 2 / 0 / 0 / 0 | 781.35 s |
| production-build | PASS | — | 18.01 s |

## Measurements

- audit-production vulnerabilities: info=0, low=0, moderate=0, high=0, critical=0, total=0.
- audit-all vulnerabilities: info=0, low=0, moderate=8, high=0, critical=0, total=8.
- sites-tests coverage: 92 unique loaded source paths / 92 LCOV records. Unique source-line coverage: **85.07%** (9918/11659). Record-weighted raw coverage: lines **85.07%**, branches **90.74%**, functions **91.19%**. Unimported files are not measured; transformed source mappings are not verified.

## Failures

- sites-tests: tests/bank-account-evidence.test.mjs
- sites-tests: tests/manual-multiple-allocation-api.test.mjs

Full commands, exit codes, timestamps, source manifest, log SHA-256 hashes and retained artifacts are in `receipt.json`.
