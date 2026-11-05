# Integrated internal security acceptance — 2026-11-05

This addendum supersedes the producer PR's owner-only acceptance limitation. The security branch normally merges the authoritative company foundation, actual company-consent/Open Payments lifecycle and Bankgiro enrichment. Commercial and production acceptance remain separate and blocked without the required external evidence.

## Actual company boundaries exercised

`test/saas-company-acceptance.test.js` provisions three real Node companies through `createCompanyRuntime`, with distinct physical SQLite partitions. Each has the same invoice ID, invoice number0599, bank transaction ID and integration-job selector, plus different original bytes, encrypted-consent markers and service-cache values. A shared actor has admin, accountant and viewer roles across those companies. Reads verify the selected partition; captured statements fail after role downgrade and cross-company reuse; viewer writes fail; balances/consent revisions remain unchanged. Company-bound backups verify their own identity and reject either other company's identity.

`sites/tests/saas-company-acceptance.test.mjs` uses the real provisionCompany, membership, selection, scoped D1 database, server identity, file/state routes and company client. Only platform authentication and D1/R2 transports are synthetic. Three explicit company records adopt their respective preserved synthetic workspaces. A shared actor has three different roles. Tests cover:

- Positive access to only the selected company's invoice, bank transaction, consent, job and original; repeated business selectors do not widen SQL scope.
- Every foreign-company original selector denied before R2 read; encrypted consent payloads cannot be opened under another owner.
- Captured SQL and HTTP responses invalidated by a company switch or revoked membership during an await.
- Viewer upload denied without storing an R2 object; accountant integration management denied; forged company headers/query selectors rejected.
- The actual browser company client clears its private cache and refuses a delayed real-server response from the former company. A new client after the intended reload receives only the selected company's state.
- Revocation while an original is being read from R2 prevents response delivery while preserving the original.

These tests complement the existing foundation HTTP/SQL/worker, lifecycle, migration and backup suites. The earlier legacy-owner tests remain useful regression coverage and now execute with explicit real server identity and request boundaries. Their fixture imports and D1 batch result behavior were adapted to the integrated server; no authorization assertion was relaxed.

## Existing security changes retained

The8KiB preauthentication login limit,16MB streamed multipart cap, fixed bank transport-log event, synthetic-network guard and pinned GitHub Actions remain intact after integration. Focused tests still verify overflow rejection before persistence, allowed normal requests, no raw sensitive transport exception logging and accidental-egress denial.

The acceptance runner now includes actual company suites, foundation APIs and cache handling, consent callback checks, Open Payments provider/lifecycle and isolated company backup recovery. It records source SHA, dirty state, runtime version, exact counts and production acceptance as `NOT_VERIFIED`. Internal success is reported only when every selected case passes with no skips, cancellations or TODOs.

## Integration and external limits

The candidate now includes the real automatic-sync adapter, onboarding HTTP/UI contract and strictly scoped expired-consent revocation recovery. Final cumulative runs on the frozen combined tree are still required before main integration is called accepted. No real bank, BankID, Gmail, customer, production R2/D1 or financial write occurs in these tests. The SaaS provider feature remains server-disabled by default. Actual bank rights, corporate entitlement, verified transport, contract and commercial/legal approval remain external launch gates.

No score increase, production readiness statement, remote merge or Sites publication is authorized by this addendum. The integration owner records final cumulative CI and any publication separately.


## Final candidate coverage expansion — 2026-11-05

Normal local merge `e6be6a8` includes expired-consent recovery62c0944; normal merge10eb97b includes the real onboarding join8be9adf. The internal runtime projection retains both credential-generation fencing and sync-enabled capability verification. Cumulative producer evidence is preserved without increasing numerical scores.

The acceptance runner explicitly selects the actual Open Payments Node and Sites company sync adapters, original normalization, captured Bankgiro intake, persisted account authority, per-HTTP durable quota boundary, expired consent recovery and raw receipt suites. It also includes the onboarding contract/client/view/server/projection suites and the combined real-module onboarding snapshot test. The scale suite uses real tenant D1 storage and the durable runner at1,10 and100 synthetic companies; it measures local dispatch and persistence, not external provider throughput.

The three-company fixtures now explicitly assert a minimum of three actual company records, owner contexts and the shared actor's admin/accountant/viewer role matrix. Their targeted run passed8/8 with no skips. This proves the declared role fixture cannot silently shrink while leaving a passing acceptance label.

The runner keeps fail-closed completion requirements: every selected case must pass, with zero skips/cancellations/TODOs. Source commit, dirty working tree, runtime and the selected test paths remain recorded. The expanded acceptance and full suites are pending on the final42 checkpoint; no old count is reused as evidence for that combined tree.
