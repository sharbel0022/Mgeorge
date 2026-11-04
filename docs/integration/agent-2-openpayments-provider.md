# Agent 2 handoff: Open Payments corporate provider

Baseline: `14a042abd37fa455d08da9dfcc096ef4f603b512`.
Branch: `feature/saas-openpayments-provider`; additive contract
`bank-data-provider-v1`, provider ID `open_payments`.

The exact exports, persistence/integration requirements, allowed operations,
verification and limits are in
[the adapter report](saas/openpayments-adapter.md).
[Provider capabilities](saas/provider-capabilities.md) records official sources
and the commercial/bank/company questions that public API documentation cannot
settle.

No existing routes, tables, schema versions, bindings, originals, financial
allocations, connection records, schedulers or Enable Banking provider functions
are changed. New server code is isolated under `sites/lib/banking/` and the native
Node transport under `src/banking/`. Root/Sites tests cover the new boundary and
retain both existing runtime regression suites.

Consumers: company/connection foundation, onboarding/authorization integration,
source acquisition orchestration and future reviewed original intake. Each must
use authenticated server company context and preserve the existing write fence.
The adapter returns acquisition evidence and cannot authorize reconciliation.

Integrators must not treat `State.company` as a tenant identity, overload the
legacy owner-only `bank_connections` row, or relabel Open Payments JSON as Enable
Banking original evidence. No production migration/publication is part of this PR.
