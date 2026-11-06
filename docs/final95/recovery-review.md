# Independent integration review — SaaS, security, QA and UI

Reviewed 2026-11-06 against frozen main `cde9178c0f8e8e386329ed8feaa4201e87b5a78f`, PR49 `03f84afd61bb1020e73c17c3cde332a1b07f55a0` and PR55 `d6646dd0971650878738f81215d0cfc5c04a1da3`. This is a static review and fresh readback of earlier exact-source CI, not a test of the new combined candidate. Bank/provider and OCR/parser review are delegated separately by the parent.

## Result

No new concrete blocking defect found in the reviewed SaaS/security/QA/UI changes. Proceed with reviewed integration and new dynamic gates. This does not approve commercial release or recertify production quality.

## Checked changes

- `src/login-rate-limit.js`, `src/server.js`: fixed administrator budget persists across restart and independent SQLite connections; reservation is one conditional SQL statement; timeout remains bounded; no forwarded-address trust or credential retention. Login rotates the existing session. Existing tests exercise competing listeners, fixed-window expiration, successful reset and encrypted control-database restore.
- `src/company-runtime.js`: read-authorized export audit is a fixed append-only capability with scope checks and catalog/data locks. It accepts no caller SQL, event label or tenant selector. Viewer access does not gain the general write capability.
- `sites/lib/server.ts`: streamed UTF-8 byte admission occurs before authorization cloning, deadlines cancel stalled reads, malformed lengths are rejected, and unauthorized uploads are not eagerly consumed. MCP gets its explicit clone and both unread branches are released. Current scope is revalidated before the response. Existing request-budget tests cover dishonest content length, clones, exact limits, multibyte bodies, timeout, abort and private upstream error text.
- `sites/app/api/state/route.ts`: audit projects accepted business state instead of saving arbitrary client envelopes. Request IDs are already bounded and validated. Original ownership, revision/idempotency and payment commit fences remain in place.
- `sites/lib/backup-engine.ts`: restoration validates UUID structure more strictly; no financial or D1 migration is introduced by this delta.
- `sites/lib/evidence-read.ts`, `sites/lib/payment-verification.ts`, `sites/lib/reconciliation*.{js,ts}`, `src/reconciliation.js`, `sites/lib/imports.ts`: retained-report history is bounded and owner-scoped, rechecked after asynchronous provenance reads, and labelled as retained history rather than bank authenticity. Missing original integrity prevents a passed reference status. Manual payer/reference substitution cannot authorize automatic allocation. Bank transaction IDs are excluded from invoice-reference extraction. Competing-payment postprocessing preserves source/financial failure reasons.
- `.github/workflows/payment-control-ci.yml`, `.github/workflows/saas-security-acceptance.yml`, `scripts/quality/*`, `scripts/check.mjs`, `scripts/run-saas-security-acceptance.mjs`: full suites remain mandatory; TAP fail/cancel/skip/TODO fails the runner; tested input manifest is captured before and after; production and full audits are distinct; fixture children receive a stripped environment and network guard. Coverage explicitly covers loaded sources, not every repo file. Browser and performance receipts preserve synthetic scope. All three new Actions pins were fetched from the official `actions/*` repositories and resolve to verified commits matching the declared releases.
- PR55: `dashboard.tsx`, economy overview, payment review, bank connection, company picker/onboarding, navigation, layout and both CSS layers. The new review retention keeps its prior renderer mounted only while hidden and inert; sign-out clears it and the company boundary unmounts the whole subtree during switch. Explicit loading/failure states do not turn missing bank data into zero or verified values. Bank interval text uses the actual returned interval. Company selection uses the existing active-workspace surface. Changes contain no new provider mutation or financial API contract.

## Exact CI/source evidence freshly read

| Candidate | Checkout | Result |
|---|---|---|
| main `cde9178c` | Same commit in all three job logs | 2323 Node + 5237 Sites + 47 bridge = **7607/7607**; fail/cancel/skip/TODO all zero; build success |
| PR49 `03f84afd` | `7c13b47789d3a02c26adafbc7909ee30e25b7a5c`, tree `7f1809e37e3feedb8cc728d2208caf016eebcda3`, equals head tree; parents old main `bf24a3c` and PR head | 2152 Node on both Node22/24 + 4128 Sites + 47 bridge = **6327 unique suite cases**; overlapping security 332+843; browser/performance runner success |
| PR55 `d6646dd0` | `7f593c00c22b41f8ed67d08af561306d0f93f770`, tree `f1d506d6184483e9d1ec6e3e76265497d4d9f112`, equals head tree; parents old main `bf24a3c` and PR head | 1997 Node + 3888 Sites + 47 bridge = **5932/5932**; all fail/cancel/skip/TODO zero; build success |

Sources: exact GitHub jobs/log excerpts in `recovery-ci.json`; API commit objects and official Actions pins in `recovery-review-metadata.json`. PR49/55 formal GitHub review lists are empty. Previous independent technical reports are not formal `APPROVED` events.

## Integration conditions

1. Preserve all current-main bank diagnostics, invoice field/party ownership, financial source policy and PR60 startup cancellation cleanup. PR49 conflicts with these later fixes in 14 files. No whole-file “ours/theirs” replacement is justified by old green CI.
2. Merge PR49 once (all #45–47 and #50–54 heads are verified ancestors), then PR55. PR55’s only product conflict against current main is `sites/app/dashboard.tsx`; documentation conflicts must preserve dated history and keep the newest scorecard at the top.
3. Re-run the full exact combined tree. Retain all old assertions; if module loader cache changes, keep every bank/OCR regression. Run actual browser desktop/mobile/focus/error/draft/company-switch cases after CSS integration.
4. Treat persistent `login_rate_limits` as schema behavior: an older application can open the DB but does not preserve the new limiter semantics. Company-only snapshots do not automatically back up the central login catalog.
5. Do not merge or publish merely because tests pass: main success can trigger existing production OCR. Preserve source-bound deployment and external bank/consent/customer acceptance gates.

## Remaining evidence limits

This review did not execute new suites or browse production; it read actual existing logs and exact source commits. Full browser accessibility, physical mobile, real user/provider/BankID journeys, current Gmail cadence, independent offsite restore, original-corpus OCR performance and current production deployment are separate gates. Current main’s documented score is **257.5/330 = 7.803/10**, newer than PR49’s 250/330. No score is increased by this review.
