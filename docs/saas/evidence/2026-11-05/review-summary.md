# Local release evidence and scoped review summary

All test cases summarized here used synthetic data. These receipts establish local integration behavior, not live provider acceptance, production financial correctness, commercial approval or a deployed schedule. Remote CI and sanitized deployment receipts are recorded separately by the release coordinator.

## Exact source provenance

- Final local gates tested commit `95d9a4184275dcbec830ab9558973beba35c8c06`, root tree `41b5cda03ae26c619e69eeb3feb65959acc5d281`.
- Published PR37 commit: `3215d40b559b5cb60daf068fd197054e809e5f83`.
- Runtime release/main commit: `672c152242add9427c8526af8dd92431c526c8c2`.
- Published and main root trees are identical: `03e5f4dafd6b272463338adda52a109ed91ceae9`.
- **The Sites subtree is identical at all three commits:** `fead95370aead0d422f3b7da766ad7eb9c33d0bc`.

The complete difference from tested `95d9a418` to published `3215d40`/main `672c152` is three documentation/browser-harness files: `docs/integration/saas-onboarding-browser/README.md`, `browser-suite.mjs`, and `integrated2026-11-05.md`. These correct the creation request assertion and distinguish historical browser acceptance from the root agent's integrated CUA receipt. Application runtime, ordinary test suites, dependency manifests and build inputs are unchanged. This is runtime/input parity, not a claim that the tested and published complete root trees are identical.

## Final local gates

[local-gates.json](local-gates.json) is a byte-for-byte copy of the frozen final receipt. Node v24.22.1 passed **1,899 Node + 3,704 Sites + 47 bridge = 5,650 full-suite tests**, with no failures, skips, cancellations or TODOs. Root syntax (170 files), bridge syntax, installed minimatch-byte verification, Sites typecheck and production build passed. Audits reported zero root/bridge findings and eight moderate Sites findings, with zero high/critical findings.

[security-acceptance.json](security-acceptance.json) is a byte-for-byte copy of the expanded acceptance receipt: **325 Node + 739 Sites = 1,064 overlapping checks**. These are not added to the unique full-suite total. Coverage includes actual three-company SQLite/D1/R2 authority, owner/admin/accountant/viewer roles, stale selection and cache fences, consent expiry recovery, original retention, durable sync, backup recovery and synthetic 1/10/100-company runner scale. External provider performance was not measured. The receipt explicitly leaves production acceptance unverified and commercial launch unapproved.

## Scoped independent review outcomes

| Scope | Findings, repairs and evidence |
| --- | --- |
| Consent expiry repair | The late Important finding was expired consent revocation becoming stuck. Repair `62c0944` limits expiry relaxation to authenticated consent-only DELETE cleanup, retaining company/owner/connection/generation and current-authority checks; ordinary reads remain expiry-checked. Independent re-review found no remaining Critical/Important issue in that repair and passed **111/111** focused tests. |
| Bankgiro enrichment | Bounded independent review found no new blocker in raw receipt capture, authority, normalization, original retention and duplicate/conflict handling. Its report explicitly required the later provider-aware account/sync joins before end-to-end readiness; those joins are included in the final cumulative gates. |
| Company sync | Bounded review found Important stale Node coverage after consent/configuration changes. Six regression cases failed before the current-authority projection repair. Focused checks passed **32/32**, with another **18/18** integration/boundary checks. The reviewer authored the assigned repair and did not claim independent approval of their own patch; cumulative release review/gates remain separate. |
| Onboarding | An Important defect projected separately corrected manual payer/reference values as bank facts. Repair `ad7aa57` uses the existing original-aware field selector; parent independently accepted it. The subsequent cumulative independent review found no remaining Critical/Important production-code issue in its exact scope and passed **78/78** focused checks. The obsolete browser-creation assertion was corrected separately. |
| Original PR37 hardening | Independent bounded review found no Critical/Important issue in login size limits, multipart stream limits, bounded provider diagnostics, test isolation and workflow controls. Initial focused checks passed **8/8** tenant-role cases and **19/19** hardening cases. Final diff/receipt review accepted the frozen cumulative gates; it explicitly did not claim independence for the reviewer's own later acceptance expansion. |

Focused counts overlap the full gates and must not be summed as unique tests. The historical **41-case** browser receipt is not a fresh integrated rerun. The separately attributed root CUA receipt covers integrated responsive/focus/role/state observations and is not provider or full automated-browser acceptance.

## Evidence retention

[local-log-hashes.json](local-log-hashes.json) identifies the retained final gate logs, onboarding receipts and scoped review reports by SHA-256 and byte length. Large logs are not copied here. The two receipts above remain faithful to their original provenance, including the exclusion of invalid Node27alpha attempts. No production payload, real customer original or secret was copied into this evidence directory.
