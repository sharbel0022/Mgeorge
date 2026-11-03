# Automatic Bankgiro source readiness

User authority: uploaded implementation mandate Inklistrad text(20261103-090416).txt, 2026-11-03. Implement and deliver without waiting for Swedbank; real production remains disabled until customer authorization and actual channel/profile are verified. Start main d91ec6c45acc07c15b82b815ffaa305d6d213656, no open PRs.

## Design and alternatives

Keep the current BankgiroReportSource/queue/original/parser/financial sink. Add a runtime-neutral HTTPS v1 adapter, trusted server registration and an isolated Node SFTP bridge. Reusing only manual XLSX does not satisfy automation; embedding SFTP in browser/Workers violates the requested boundary. A generic normalized HTTPS protocol also supports an approved provider without claiming a bank-specific endpoint or field mapping. This is the implementation choice, not an assertion that Swedbank has approved it.

## Binding interfaces

`BankgiroReportSource` retains id, mode, authorize({owner,signal}), listReports({owner,authorization,cursor,limit,signal}), fetchReport({owner,authorization,report,signal}). A resolved production source additionally exposes an immutable registration and intervalMinutes. Existing synthetic sources stay test-injected and can never be registered in production.

New shared files: bankgiro-http-source.js and bankgiro-source-registry.js. Exports: createHttpsBankgiroSource({registration,token,fetchImpl?,now?}); createBankgiroSourceRegistry({configuration,secrets,fetchImpl?,now?,runtime?}) returning {resolve(owner)}; resolveBankgiroSource(owner,options={}) remains async and defaults to null with absent configuration. Configuration is trusted server state, never request JSON. Secrets is a server-owned binding map. Invalid configured source fails closed with a safe authorization/configuration code.

Configuration v1: {version:1,revision:positive safe integer,registrations:[registration]}. Each registration declares id, owner, companyId, bankgiro, scopeId, generation, mode:'production', enabled, transport:'https-v1', baseUrl, tokenSecret, profileId, allowedFormats, intervalMinutes and entitlement. Bankgiro is explicit canonical digits; companyId is an internal legal-entity key, not an invented organization number. entitlement requires VERIFIED/provider_authorization, evidenceId, checkedAt, validUntil and bankgiro_reports:read. Fresh remote authorization must additionally match exact owner/source/company/Bankgiro/scope/generation and the declared profile; no AIS/manual evidence substitutes for it. Configuration revision must not roll back/revive an older locally revoked generation. A trusted registration/revoke lifecycle atomically changes source authority; discovery/errors cannot promote replaced/blocked state.

The normalized bridge protocol is our application contract, not a bank API: GET /v1/authorization, GET /v1/reports?cursor=...&limit=..., GET /v1/reports/{opaque-report-id}/content. All requests authenticate with a server Bearer credential. Authorization returns the canonical receipt plus companyId, bankgiro, profileId, checkedAt, origin and capabilities. Lists return existing ReportPage/ReportDescriptor, optionally declared byte length. No arbitrary per-report download URLs. Report identity is opaque and stable within scope; a changed original under one identity must surface as a conflict.

HTTPS requires valid TLS, pinned configured origin/path, no redirects, no URL credentials/fragment, bounded JSON/binary streaming, cancellation, length/hash verification and safe allowlisted errors. Restrict unsafe hostnames/addresses in server configuration. The bridge uses pinned SSH host keys, read-only SFTP, bounded enumeration/download, private durable journal and immutable SHA-addressed bytes, stable discovery-sequence cursors, atomic publish, replay/resume and no remote deletion. Its dependency/package/deployment remains isolated from Sites.

## Orchestration and observability

Reuse the existing Node minute timer and existing Sites bank automation/payment-control boundary, adding a canonical report stage. The worker's durable lease enforces per-source idle polling interval and provider embargo; pending queued work can resume without relisting prematurely. No new external schedule/timer.

Persist authorization verified/expiry timestamps, last acknowledged-success time, last failure time/code and registration revision/binding if needed. Unknown remains unknown. Read endpoints do not authorize/fetch/write. Public status adds authorization:{status,verifiedAt,validUntil}, lastSuccessAt,lastFailureAt,lastFailureCode and allowlisted job errors. Source evidence checks current expiry without requiring a provider call. UI keeps a compact monochrome panel, explicit gaps only, manual Excel fallback and separate transport/import versus verified payment semantics.

## Safety and acceptance

All write tests use isolated synthetic data and real SQLite/D1-adapter transactions and retained byte storage. No production source configuration, actual report import, invoice/allocation test write, customer message, payment or new schedule. Actual Bankgiro remains externally blocked. Preserve current auth, DB/R2 and runtime secrets. Verify selected economic projections before/after Sites publication.

Tests must cover 0599 versus599, multiple payers/aggregate, missing payer/account/deposit, replays/renames/hash conflict, delayed reports, disconnect/resume,429 and auth/server identity failures, owner/generation/expiry/lease races, partial/excess and original import with zero allocations. Full root/Sites/bridge tests, syntax/types/audits/build and independent review gate normal PR merge, main CI and existing Sites publication. Final report separates CODE, SYNTHETIC E2E, SITE, REAL SOURCE and REAL PRODUCTION FETCH.
