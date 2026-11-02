# MG Fakturakoll — seven-agent final delivery

Status: code and local combined acceptance are complete. Exact GitHub/main CI and Sites publication receipts remain pending; those pending entries are not completion claims. Task started 2026-11-02; machine receipts below use UTC (Stockholm is UTC+1).

## Reviewed inputs

Initial main: `a779b0dd8d184eaf6e6d6e636c555c967f15f3d5`. C1 policy was normally merged through PR27 as `70c61267e049c29b6e2fb6a5a2bb658c3b029693`, exact main CI41541298113 success. Remaining producer commits are preserved as ancestors on the isolated integration branch; their mutually dependent changes will be delivered atomically through a normal integration PR, avoiding an intermediate main with the known terminal-lease conflict.

| Agent | Delivery | Frozen reviewed head | Producer CI |
| --- | --- | --- | --- |
| 1 Reference policy | PR27, merged |5fada91427ee49d98897802eeb7a2aeede73fbf7|41537452515 success|
| 2 Swedbank | PR25, staged |9dcf038567102514a14774b301cfa0078274b31b|41536738875 success|
| 3 Bankgiro | PR26, staged |5c9b51bc12c0c7b37df07b0c8061e9b6313189f6|41536018420 success|
| 4 Reconciliation | PR28, staged including C1 follow-up |58e40a21eb459e2191d7b19b458326459a09e5d6|41540703404 success|
| 5 Durable jobs | PR29, staged |b219d63a27c759019ccef937e0b557dfa3c03e7a|41538632699 success|
| 6 Payment UI | PR30, ready and staged |089ac0b8585d2a0c69c3537b510d3fec5291be50|41540194266 success|
| 7 Shared architecture/integration | PR22–24 already merged; combined acceptance here |released mgeorge-integration-v1|previous main41535692536 success|

## Integrated behavior and conflict resolutions

- M.George customer invoice numbers provide the intended payment reference as text, preserving0599/599/00599 distinctions and original observations. Supplier/other-company references retain their declared semantics. No intended reference becomes bank-certified formal OCR.
- New automatic report transport contract, authorized synthetic test source, durable owner/source/scope/generation queue, SHA-verified originals, delivery/hash idempotency, recovery, and read-only status use existing parser/ledger/retention boundaries. Manual CSV/XML/XLSX remains available. The production resolver returns null until a real company-authorized adapter is registered.
- C2 account/read safeguards and C5 completion receipts coexist. The lease owns the primary Node bank transaction; terminal success cannot be reused for writes. Afterchecks take an independent control claim; committed imports survive lost replies and cleanup failures. Failure audit does not erase provider cooldowns.
- Schema collision is resolved as0016 account guard followed by0017 Bankgiro queue, with chained complete snapshots and both Node/Sites consumers updated. Fresh upgrades preserve workspace payload and create no financial seed rows.
- C1/C4 share one trusted server-policy selector. Canonical bounded ownership aliases preserve raw originals while preventing whitespace from hiding a competing invoice. Customer/supplier obligations are scoped by cashflow direction.
- C1/C6 show intended reference, declared source/conflicts, actual bank reference, payer source, dates, money, original evidence and reasons. Bankgiro availability reads actual source status; there is one dashboard panel. Formal bank OCR requires complete consistent valid evidence; malformed bank-reported OCR stays diagnostic.
- C3 acknowledgements preserve source-wide429 embargo while committing accepted cursor progress. Explicit eight-day numeric and fourteen-day HTTP-date deadlines are preserved; overflow remains deferred to the maximum representable instant.
- Active Node/Sites automatic allocations now require an exact full remaining payment and a verified retained invoice original for scoped M.George customer invoices. Partial/excess and missing/tampered originals stay in review; explicit manual decisions and historical amounts remain. Current C3 authority/conflicting originals enter both active eligibility and C4 snapshots. Same-batch source revocation/hash append/status races roll back financial writes and audit; foreign-owner append is harmless. The separate C4 panel is read-only and always retains separate approval.
- GitHub review comments are reproduced and corrected: standalone Node CAMT payments no longer acquire an invented aggregate/report relation; the same effective invoice-review status now drives table, status filters, CSV, details and contacts.

Conflict matrix, implementation decisions and red/green history: [delivery ledger](integration/seven-agent-delivery-ledger.md). Detailed producer contracts remain under [docs/integration](integration/README.md).

## Verification

Fresh local verification: **1563 Node +2978 Sites =4541 passed;0failed,0skipped,0cancelled,0todo**. Node completed271921.6ms; Sites88557.0ms. Standard guarded TypeScript and exact minimatch verification pass. Production build completed successfully (exit0 / Build complete). Independent final review of runtime`7164a2c8be11c288e20994e5c966f7c51f147f6e` found no Critical/Important blockers; original source-conflict, partial/excess, missing-original and race reproductions were rerun. Its focused counts overlap these full suites and are not added.

The initial unchanged baseline passed1309 Node+2337 Sites, zero fail/skip/cancel/todo. Nine joined/migration cases now pass using the real new C1/C3/C4/C6 modules with isolated synthetic storage, including0599 versus599, missing source, missing alias/deposit relation, wrong/changed hash, replay, supplier collision and financial conservation. Producer suites and targeted integration runs overlap; they must not be summed as unique final coverage.

Early red runs are retained honestly:545 combined Node failures traced to a missed renamed migration consumer (fixed);43 UI-branch banking fixtures crossed Stockholm midnight while provider bounds use UTC (fixed by explicit UTC fixtures and a deterministic boundary regression). No tests were removed or weakened to obtain acceptance.

Audit baseline after locked installation:root0; Sites production0; full Sites16 inherited moderate development findings,0 high/critical. Exact minimatch backport target and TypeScript pass. Final unchanged-input build/audit receipts are added below after freeze.

A real local browser verified the new black/white bank view, unauthenticated unknown states, isolated demo, search, transaction details and Escape focus return. Fresh physical/mobile browser acceptance is not claimed. Producer C6 includes19 Chromium acceptance cases across320–1440px; new hooks/components have focused stale/error/SSR regressions.

## Production baseline and acceptance boundaries

Before deployment:existing Site57, source`12ece026c917a87c2b53f5feb02af488e35e40d1`, public audience with authenticated private economic routes; DB/R2 bindings retained; runtime revision9/17 entries and the same three bank/Gmail/backup schedules. Rollback target is saved Site57; no rollback or destructive restore is performed.

Selected0599 reads at workspace revision43 were complete/current:one economic AIS observation, a separate non-economic Bankgiro report, zero allocations, no exact registered invoice. Report/reference integrity is retained, but current provider reads of both approved account resources do not prove the report account alias. Report-to-AIS deposit identity and customer/invoice relation remain unproved. The report shows a general0599 reference; formal bank OCR is absent. No original, actual payer name or full account identifier is committed here.

Latest observed bank sync succeeded2026-11-02T20:07:20.589Z, connected, six-hour cadence, no reported error. This is AIS success, not automatic Bankgiro report authorization.

Gmail's existing hourly schedule has a real23:00UTC run completed23:06UTC; last successful fetch23:04:41.397UTC. It imported15 new originals and rejected32 duplicates. There are240 review documents and15 waiting OCR. Last observed cloud OCR completion18:48:28.449UTC matches successful GitHub workflow41503974414 (3processed/0failed); no newer start is returned. Existing cron is unchanged. Current cloud workflow enable flag/state cannot be read through the available connector, so unattended OCR freshness remains unverified; no job is dispatched as a financial acceptance test.

Backup:latest observed complete snapshot195/195 originals, verified manifest pass,63463280bytes. Retained API checksum scope covers11 records with112 historical records lacking receipts. Synthetic isolated recovery is tested; this is not a new complete production disaster-recovery/RPO/RTO exercise.

Post-deployment source/version/state comparison: PENDING.

## Automatic Bankgiro production activation

Internal adapters and synthetic tests do not establish company entitlement. Ask Swedbank to confirm Inbetalningar bankgiro with individual ISO reporting, exact company/Bankgiro/receiving-account scope and current account aliases, and a bank-proven report-to-booking identity. Obtain camt.054 Credit or an explicitly detailed extended camt.053, exact ISO/MIG/XSD/Envelope profile and an approved test original.

For automatic delivery, confirm Anslutning Företag via direct SFTP plus the required security solution, or a bank-integrated third party. Obtain actual endpoint/transport, credentials/server identity, report directories/scope, creation cadence, history/redelivery/acknowledgement and failure policy. Workers require an authorized HTTP integration/bridge for SFTP; no endpoint or bank permission is invented. Register the real server-owned adapter, bind trustworthy capability/provenance into orchestration, reuse one approved schedule and run isolated acceptance before enabling it. Existing AIS cannot substitute for these facts.

Primary sources checked2026-11-02:
- https://www.swedbank.se/foretag/betala-och-ta-betalt/ta-betalt/bankgiro-inbetalningar.html
- https://www.swedbank.se/foretag/betala-och-ta-betalt/ny-standard-for-betalningar-i-sverige/nya-tjanster-for-filbetalningar/anslutning-foretag.html
- https://www.swedbank.se/foretag/betala-och-ta-betalt/betala/fakturahantering/betala-via-fil/mig.html
- https://enablebanking.com/docs/faq/

## Quality and final status

All33 numeric scores remain255/330=7.73/10,0/33 at9.5. New synthetic proof does not supply real bank authorization, representative invoice/OCR acceptance, physical accessibility acceptance or a complete production restore exercise. Existing per-area scores and limits remain in [QUALITY-SCORECARD.md](../QUALITY-SCORECARD.md).

KOD KLAR: YES — frozen runtime, full local suites, guarded types/audits and independent review; exact-head/main CI and publication receipts remain separate.
INTEGRATION KLAR: PENDING normal integration PR/main CI.
PUBLICERING KLAR: PENDING exact-main source/version/deployment receipt.
VERKLIG BANKAUTOMATIK KLAR: NO — actual authorized company report channel/account/deposit proof absent.

Branch inventory/archive/restore assessment and final GitHub receipts: PENDING. No force-push, customer message, bank payment, test production invoice/allocation or destructive restore is authorized by this receipt.
