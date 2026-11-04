# SaaS integration matrix — 2026-11-04

Start main: `14a042abd37fa455d08da9dfcc096ef4f603b512`. Current Site: version60, existing project `appgprj_6adf2f7f7e848191b64192161886b528`. All seven PRs open at inventory; #38 Draft. No producer is treated as integrated on the basis of its standalone tests.

| PR / responsibility | Frozen branch / SHA | Changed files | Contracts / schema / dependencies | Exact-head CI | Integration status |
| --- | --- | ---: | --- | --- | --- |
| #40 multi-company foundation | feature/saas-multitenant-foundation / c096d77c6ad388bd6d5811816823c880db0f1899 | 102 | CompanyContext, Membership, ReferencePolicy, BankConnection, worker grants; Node catalogue0001, D1 company boundaries0019 and OAuth fields; no package change | 41906748002 success | Review in progress; first integration |
| #36 Open Payments | feature/saas-openpayments-provider / 1a634c1e845d8a739a1df1e0978ca0aa3534779c | 21 | BankDataProvider, encrypted provider context, read-only OAuth/mTLS; no migration/package change | 41903902071 success | Requires trusted company/current connection and callback/token integration |
| #39 company consent | feature/saas-bank-consent / 32be7f5802d49ecfe444a4bd0d2cf9bf95272dff | 34 | State/session/company/actor-bound consent policy; D1 bank_consent_context0019, Node additive fields | 41906678816 success | Migration collides with foundation; company/provider mapping required |
| #41 Bankgiro enrichment | feature/saas-bankgiro-enrichment / 0ee8bfdde55b610ec55028f685310140ebdd7c4d | 31 | Native .opbg.json capture, exact raw HTTP receipt and normalized evidence; existing intake; root package/lock changed, inspect exact diff | 41907284690 success | Requires current company.id, company registry and raw provider transport receipt |
| #42 bank sync/reconciliation | feature/saas-bank-sync-reconciliation / 70c2538728722e5675cc3d36de1718dbd66d0cf3 | 52 | SaaS company/account leases, quotas, checkpoints, receipts; 4 tables migration0023, conflicting journal/snapshot0019; no new package | 41910261629 success | Requires trusted company adapter/reference policy and Open Payments adapter |
| #38 onboarding UI | feature/saas-customer-onboarding-ui / 8f8962e0ea2c0a138888121c5aa72f9cfb58a1da | 29 | Validated UI-specific company/membership/bank/SCA/consent/account/sync endpoints; no migration/package | 41905521119 success | Draft; backend contract adapter absent in producer baseline |
| #37 security/acceptance | feature/saas-security-acceptance / eed68796179565e0fa76b8e201b23449b2a9c754 | 23 | Bounded bodies, safe logs, isolated tests, pinned Actions; package scripts only, no new dependency | 41904365439 +41904365899 success | Review after all functional interfaces integrated |

Full changed filenames and frozen producer metadata are retained in `producer-inventory.json`.

## Dependency and risk register

1. Preserve the existing Enable Banking owner workspace. Company binding is an explicit trusted operation; empty-company creation must never hide existing originals or bank data.
2. #40 supplies membership, roles and immutable storage owner. Request-supplied IDs are selectors only; Node company database and Sites owner namespace must be derived from verified membership. Workers, backups, cache and OAuth must keep that context through awaits/revocation.
3. #36 supplies a provider library, not activated bank routes. #39 currently integrates the existing Enable Banking flow. Their contracts require a trusted adapter; green separate CI does not prove Open Payments onboarding.
4. Foundation `CompanyReferencePolicy` and sync `referencePolicy` have different representations. A version-fenced explicit adapter is needed. Never coerce invoice reference0599 into599 or infer a customer relation.
5. #41 requires exact raw HTTP bytes and request path; parsed provider JSON is insufficient. Source authority, account identity, reported Bankgiro facts and stable deposit relation remain distinct evidence.
6. D1 migration numbering/journal/snapshots conflict. Merge cumulatively; test clean install and legacy upgrade with synthetic original bytes and unchanged ledger state. Do not restore tenant-unaware code after company binding.
7. #38's separate UI contract must map to real server operations, with idempotency, role checks, CSRF/state/replay protection, stale-response rejection and truthful capability/availability. Commercial feature flag remains disabled without external acceptance.
8. #42's current concrete adapters require Enable Banking. Provider-independent dispatch must explicitly adapt Open Payments, preserving original provenance, expiry, quotas and banking scopes.
9. #37 baseline acceptance is owner isolation, not complete joined company-role acceptance. Rebind the final acceptance to the integrated code and all new owner tables/migrations.
10. Latest cloud OCR run41877909285 failed. Gmail schedule exists but is disabled. Diagnose separately; no duplicate schedule or successful runtime claim from a worker heartbeat.

## Merge gates and sequence

Provisional order: #40 → #36 → #39 → #41 → #42 → #38 → #37. Current head is re-read and frozen before every merge. Review all diff, reproduce concrete findings, apply minimal regression-backed repairs, run full cumulative workflow gates, then merge with expected head and verify exact new main CI. Conflicting or incomplete PRs remain blocked until repaired.

No merge or production deployment has occurred in this integration at the time of this inventory. Sandbox access, real bank/company entitlement, Bankgiro coverage and commercial/legal approval are independent external gates.
