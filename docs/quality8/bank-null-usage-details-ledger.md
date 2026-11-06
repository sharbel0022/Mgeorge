# Usage-details diagnostic execution ledger

Approved design: `23b4d71ae21d745471ac60c82e8b081f25731cb9`. Baseline is published `41aadcef5fc6f65cc73979997b195c7b4f12eec1`. Root authorized autonomous local implementation and owns independent review, integrated CI and any real follow-up. No external bank calls are performed here.

## Frozen before implementation

- Pure policy: 59 tests, 12 pass / 47 fail; all missing behavior failures. Duration 277.744 ms.
- Service / HTTP MCP: initial 50 tests, 17 pass / 33 fail. Added actual-provider positive, in-flight expiry, five pre-read context changes and foreign-error provenance before freezing. Final population: 58 tests, 23 pass / 35 fail; duration 18,414.732 ms.
- Existing account-evidence active gate: 1 / 1 pass; `reauth_required` makes zero reads even when the hypothetical response is ORGA. Duration 824.456 ms.
- All populations use synthetic accounts and a mocked HTTP boundary. Exact source/test/log hashes and counts are preserved in `bank-null-usage-details-red.json`.
- No product source was changed before these results. No existing assertions were removed. The only existing fixture mapping change exposes the real imported `getAccountDetails` boundary to the synthetic service harness.

## Execution choice

The existing isolated worktree is retained. Implementation proceeds inline in the approved plan, with focused gates rather than duplicate full CI. Root will independently review the frozen implementation. The pure read plan and service consumer are sequential dependencies; they are not implemented in parallel.

## Completed implementation gates

- [x] Input-bound pure plan / observation helper, retaining strict validator and business predicate bytes.
- [x] Owner-, context-, deadline- and lease-fenced service consumer; original 409 remains authoritative.
- [x] Focused regression, provider / MCP transport and typecheck evidence.
- [x] Frozen code SHA for root review; no production call or publication.

Final focused regression: 454 / 454 (120 service, 286 policy/adapters/provider, 48 existing sync import consumers); typecheck and diff check exit 0. Strict validator, business predicate and account-evidence source remain byte-identical. The two root-approved service-fixture corrections, additive response expectation and import-only mock exports are recorded explicitly in the final evidence report. Original RED is unchanged. Root review and integration remain external to this implementation.
