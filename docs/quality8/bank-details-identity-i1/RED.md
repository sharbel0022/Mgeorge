# I1: frozen primary-identifier regressions

Baseline product commit: `638c77365dbf8f4c73db6b23816a37f577da5689`.
This test-only stage reproduces the independent Important finding before any product edit.

## Unchanged independent cases

The independent policy and adapter files have only their relative imports adjusted to the repository. Their cases, fixtures and assertions are unchanged. The seven reviewer service cases and their two assertion helpers are appended unchanged to `sites/tests/banking-security.test.mjs`; the two fixture blocks were already byte-identical, so no existing service suite or fixture is copied into another suite.

| Population | Tests | Pass | Fail | Exit |
| --- | ---: | ---: | ---: | ---: |
| Independent policy | 5 | 2 | 3 | 1 |
| Independent actual adapter | 2 | 1 | 1 | 1 |
| Independent ordinary service/audit | 7 | 6 | 1 | 1 |
| Independent total | 14 | 9 | 5 | — |
| Additional policy/service controls | 7 | 2 | 5 | 1 |

All failures are assertion failures: `observed` was returned where the frozen cases require `unavailable / DETAILS_ACCOUNT_CONFLICT`. There are no skips, cancellations or todo cases. The six independent service/audit controls remain green. These RED cases are not passing verification.

The additional cases exercise contradictory live IBAN fields with absent or noncomparable fresh identifiers, saved/live BBAN conflict with a noncomparable fresh IBAN, the two cached conflicts through the real provider adapter and ordinary service, identical IBAN duplicates within all three resources, and distinct noncomparable schemes across the resources. The latter two controls pass before the fix and must continue to pass.

## Preserved evidence

`source-preservation.json` records original source hashes, the exact import/append operations, and hashes of preserved review artifacts. `original/` contains byte-identical copies of the original independent RED logs, the six-case positive log, and review reports/evidence. The original review workspace is untouched.

`red-evidence.json` freezes the test and product hashes, exact commands, runtime and outcomes. Individual `red-*.json` files describe the corresponding raw `red-*.tap` logs. All runs use Node 24.22.1, `NODE_ENV=test`, the repository isolation preloader, type stripping and test concurrency 1. All bank HTTP responses are synthetic mocks; the ordinary adapter and service remain real.

No product code, consent decision, credential, connection state, production data or quality score is changed in this test commit. Root owns the independent re-review, integration and CI.

The all-file whitespace check reports reporter-generated trailing spaces in preserved raw RED logs. Those bytes are retained for hash integrity. The staged source, tests and authored Markdown/JSON pass `git diff --cached --check -- . ":(exclude)**/*.tap"`; raw TAP formatting is the only exclusion.
