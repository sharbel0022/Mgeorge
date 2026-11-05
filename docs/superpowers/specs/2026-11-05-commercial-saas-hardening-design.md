# Commercial SaaS hardening — 2026-11-05

## Intent and constraints

Implement the authorised Agent 4 request on `feature/95-saas`, based on `origin/main` at `4ad205b`. Deliver a PR with meaningful regression tests, migration verification and commercial launch requirements. Preserve existing M.George data, originals, deployment identity, schedules and provider credentials. Do not deploy, migrate production, create real consents, invoke BankID or change financial records.

The existing product already has authoritative company membership, four roles, immutable storage boundaries, a shared Open Payments lifecycle and company-bound sync jobs. This iteration must verify those components together and repair concrete remaining gaps. Test transports and synthetic sign-in callbacks must always be identified as synthetic.

## Architecture decision

Keep the current partition model: a company catalog and isolated SQLite databases for Node; immutable company/storage-owner bindings, guarded D1 queries and owner-prefixed R2 originals for Sites. Add focused checks and lifecycle repairs in the existing paths. A replacement tenant schema or a new identity provider would require data movement and a different product scope without resolving the identified boundary risks more directly.

The logged-in actor, selected company, storage owner and bank PSU are distinct identities. Every API, callback and job must retain the authoritative versions relevant to its operation. An untrusted company name, organisation number, account identifier or browser header never establishes membership or bank authority.

## Required behaviour

- A user can create a separate empty company and select authorised companies; that action does not assert legal representation or transfer legacy data.
- Read/write/integration/member/restore permissions follow the existing role matrix. Stale, removed or suspended membership cannot be used across an asynchronous operation.
- Accounts, invoices, payments, originals and jobs remain within the authoritative company boundary. Two companies using the same bank do not share account selections, cursors, leases, deduplication or consent state.
- An aborted or failed bank authorisation must retain its known remote consent handle until confirmed revocation. A replacement attempt cannot silently discard it. Ambiguous cleanup must remain blocked and retryable.
- Expired redirect sessions and interrupted operations must have an honest recovery action; expiry never implies bank approval or confirmed remote revocation.
- Synced data is committed only with current membership/worker grant, consent, selected account and lease. Concurrent work for one account is fenced; independent company accounts can progress separately.
- Missing provider contracts, mTLS, corporate authority, Bankgiro entitlements or real acceptance evidence remain explicit launch blockers.

## Verification and delivery

Use synthetic users/companies/accounts and actual storage, routing and provider modules where possible. Mock only external bank transport. First reproduce every product defect with a failing behaviour test, then implement the smallest repair. Verify additive migrations on retained synthetic legacy data and check schema integrity, counts and original hashes. Run the repository's Node, Sites and bridge gates; distinguish environmental failures, local checks and PR CI.

Document the API boundaries reviewed, concrete fixes, test commands/results, migration implications, launch prerequisites and exact continuation point. Do not raise production-dependent scores to 9.5 based only on local tests. The deliverable is the branch and PR, not a claim of commercial approval.
