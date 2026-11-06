# I1: reject contradictory primary identifiers in usage details

The independent I1 finding is corrected locally and awaits independent re-review. Baseline: `638c77365dbf8f4c73db6b23816a37f577da5689`. The RED tests and preserved original evidence were committed first in `30aa6612a0d43006b9797dc5d0721fb1accd98e7`.

## Product change

`observeAccountUsageDetails` collects every primary identifier from the fresh details, saved account and current session account. It then permits only one exact value per scheme. Different values for the same scheme return `{status: 'unavailable', reason: 'DETAILS_ACCOUNT_CONFLICT'}` before a usage category can be emitted. This detects duplicate fields within one resource and saved/live disagreements when fresh `account_id` is absent or has a different scheme.

Legitimately absent identifiers remain absent. Repeated identical values are accepted; BBAN, IBAN and other distinct schemes are not compared as though they were the same identifier. No normalization, alias matching or account-number repair is introduced.

The product diff is **8 added / 1 removed lines in one function**. The rest of `bank-consent-policy.js`, including `primaryIdentifiers`, `validateEnableConsent`, `validateLegacyEnableSelection` and read-plan/hash binding, is byte-identical to baseline. The entire service, adapter, type declaration, account-evidence reader and read guard are also byte-identical. [Source verification](source-verification.json) and [the product diff](product.diff) record these boundaries.

## Frozen RED to GREEN

| Population | RED pass/fail | GREEN pass/fail |
| --- | ---: | ---: |
| Independent policy: 5 cases | 2 / 3 | 5 / 0 |
| Independent actual adapter: 2 cases | 1 / 1 | 2 / 0 |
| Independent ordinary service/audit: 7 cases | 6 / 1 | 7 / 0 |
| Additional policy/service controls: 7 cases | 2 / 5 | 7 / 0 |
| Total focused cases | 11 / 10 | 21 / 0 |

The independent 14 cases reproduce the review's exact **9 pass / 5 fail** before the fix. Their assertions and test data are unchanged; only relative imports were adjusted. The service cases reuse the existing fixture. No existing 120-test suite was copied into a second suite. All four test files remain byte-identical to the separate RED commit, with exact hashes in [RED evidence](red-evidence.json).

The frozen cases cover contradictory fresh IBAN fields through policy, actual adapter and ordinary service; saved/live BBAN conflict with no fresh `account_id`; internal saved IBAN conflict with no fresh `account_id`; internal live conflict with absent or noncomparable fresh identifiers; and saved/live conflict with a noncomparable fresh IBAN. All ordinary service conflict cases retain the original 409 / `ACCOUNT_USAGE_INVALID`, the exact retained connection row, no workspace or financial sync, and no usage counts in the unavailable details diagnostic. Positive controls preserve absent identifiers, identical duplicates, distinct schemes and the six independent batch/audit boundaries.

## Affected regression and typecheck

| Check | Result |
| --- | --- |
| Policy, Node/Sites consent adapters, provider/account-evidence and cooldown | 298 / 298 pass |
| Revalidation, auth/scope/MCP, usage diagnostics and independent service cases | 129 / 129 pass |
| Distinct regression total | 427 / 427 pass, zero fail/skip/cancel/TODO |
| Sites guarded `tsc --noEmit` from `sites` | Exit 0 |

The 21 focused cases are a verified subset of the 427 and are not added again. Exact commands, runtimes, log hashes and counts are in [machine-readable evidence](evidence.json) and the individual `green-*.json` files. Test runs use Node 24.22.1, `NODE_ENV=test`, `scripts/saas-test-isolation.mjs`, type stripping and concurrency 1. Typecheck uses the same Node and the repository's guarded `scripts/run-verified-tool.mjs check` from `sites`; its successful raw log is empty. All provider HTTP is synthetically mocked.

## Evidence and handoff

[The original RED record](RED.md), original independent failing logs and hashes remain intact under `original/`. All 24 files recorded by the independent review still match their original hashes in the untouched review workspace. Reporter-generated whitespace in raw RED logs is preserved deliberately.

This is an implementation and local verification receipt, not an independent READY decision. Root owns re-review, integrated CI, PR and any production action. Full CI was not run locally for this one-function fix. No real bank request, credential inspection, account cache repair, connection activation, production change or quality-score change was made.
