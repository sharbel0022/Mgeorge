# Six PR integration report — MG Fakturakoll

## Scope and authority

Requested integration of PR14–19 into `main`, full cumulative gates, one publication to the existing Site, and read-only production acceptance. This report is being completed during the serial integration. **Pending fields below are not success claims.** The final receipt distinguishes the implementation SHA, documentation SHA and Sites source SHA.

Start main: `a9f88ae1c0f697376b3ecd140e1e80a64405125a`. Existing Site: `appgprj_6adf2f7f7e848191b64192161886b528`; rollback version **56**, saved source `4483058138ed4f04b93bdee775c79718c074dd80`.

No force push, branch deletion, production invoice registration/allocation, outgoing mail, bank payment, consent renewal or manual bank/Gmail sync is part of this integration. Existing external automations can run independently; their observations must not be attributed to this work.

## Frozen deliveries and readiness

| PR | Workstream | Original frozen head | Initial exact-head PR CI | Review disposition |
| --- | --- | --- | --- | --- |
| 15 | Backup/security | `bb4d40333e252ebd7067515cf2c9ba8e72419f7e` | 41507434246 success | Ready within documented offline-recovery scope |
| 16 | Swedbank/periods | `869a0543eee81a42b55fbb0f0f9d9fbac3846661` | 41512208727 success | Blocker reproduced and corrected before merge |
| 19 | OCR/invoice interpretation | `920dd5153231c99226157fe11863bb2e4c6da857` | 41514268924 success | Ready; inherited textual-month gap remains a safe review hold |
| 18 | Gmail/document automation | `8d4e71bc96ad61366651f0f2ed8531ca0e27d319` | 41512746245 success | Combined test-loader blocker corrected before merge |
| 14 | Bankgiro/0599 safeguards | `18fd3c5e78aa16d697a651fa3a739d720797f2a7` | 41506000881 success | Duplicate-reservation blocker reproduced and corrected before merge |
| 17 | UI/performance | `a67e2405406c94c3b0cab32d5630ef5dab7f0b0b` | 41512245036 success | Ready for ordered integration after conflict resolution and browser acceptance |

All six were open and non-draft. Their heads were observed repeatedly before changes. No unresolved inline review threads were returned. No development-conversation liveness API is available; stability is demonstrated by repeated head observations, completed CI and delivery descriptions, not by an invented claim that another conversation has stopped. Every branch update uses a normal descendant commit and expected-head lease; every merge uses GitHub's expected-head check.

Initial remote branches: `main` plus exactly the six workstream branches listed by the user. They are preserved. Main reports `protected=false` and no rulesets. The separate protection endpoint returned 403 due connector administration scope; this is a disclosure of inspection limits, not permission to bypass protection. Ordinary GitHub merge enforcement remains in use.

## Conflict matrix

| Intersection | Classification | Resolution / mandatory behavioral check |
| --- | --- | --- |
| 15/16/18 `src/server.js` | Shared file; semantic auth, lease, sync/registration boundaries | Distinct hunks merge automatically; preserve session allocation/rotation, invalid-date handling, bank coverage and post-COMMIT Gmail semantics. Full auth/session/bank/Gmail regressions remain mandatory. |
| 15/17 `PROGRESS.md`, `QUALITY-SCORECARD.md` | Text conflict | Retain both workstreams' sections and their historical limits; prepend the current integrated receipt rather than treating old production observations as current. |
| 16/17 `public/app.js` | Text and semantic date/UI conflict | Preserve separate UTC `bankIso` for provider dates and UI's `dayOffset(n, from=iso())` optimization. Run bank-ui and final-node UI tests together. |
| 19/18 `sites/tests/gmail.test.mjs` | Shared harness and stricter-parser semantic dependency | Preserve PR19 parser module loader and PR18 queue/automation assertions. No assertions removed. |
| 19 parser → 18 new queue fixture | Semantic integration failure despite clean Git merge | Explicitly resolve invoice-details import in data-URL harness; all queue tests must execute. |
| 16 normalization → incremental checkpoint | Data conflict | Invalid BOOK rows must stop success/import/checkpoint before advancing coverage. Pending/non-SEK skip policy retained. |
| 14 report variants → reservation key | Data conflict | Same numeric recipient BG with zero padding reserves one BG/year/sequence identity. Raw report evidence stays exact. |
| 19 extraction → 18 autoregistration → 17 evidence UI | Semantic/data | Unknown or conflicting counterparties remain in review; leading-zero reference preserved; suggestions do not create debt or prove payment. New combined synthetic PDF flow covers backend boundary. |
| 15 snapshot/restore → financial/original changes | Data/deployment | Exact financial rows and original references preserved; offline evidence database only, no production activation. |
| Dependency manifests, CI workflows, schema migrations, hosting manifest, schedules | Deployment | None changed by the six workstreams. Existing D1 `DB`, R2 `BUCKET`, auth, runtime values and schedules must remain unchanged. |

A successful Git merge is not used as evidence of behavioral correctness.

## Integration corrections

1. **Historical bank coverage loss.** PR16 Sites treated malformed/out-of-period booked rows as skipped while writing a successful checkpoint. The next ordinary incremental request started three days back and could permanently miss the older row. Local source correction `02653401dbc18e812ebce1c323d6e39c56c0fa6f`: reject `normalized.skipped.invalid` as `BANK_INCOMPLETE_RESPONSE` before successful import/run/checkpoint persistence. Four regressions failed before the guard; five passed after it, including preserved pending/foreign-currency behavior. Focused banking coverage **144/144**; no migration.
2. **Gmail/OCR fixture import.** PR18's new queue test used a data URL but did not resolve PR19's new invoice-details dependency. Local correction `afb497a26d830e3e1f7840ff7bd12a555a38eb29` changes one harness line. Standalone PR18 **7/7**; combined before correction **0/7** with the expected import failure; combined after **7/7**; restored standalone **7/7**. No product behavior weakened.
3. **Bankgiro recipient padding.** PR14's internal reservation key distinguished the same numeric recipient BG written as seven versus eight digits with leading zero padding. Local correction `527d6c67e0bbe89d6f7ddb7be15d2719ba579159` canonicalizes only the key to ten numeric digits. Four mirrored cases failed before and passed after; **51 Node + 124 Sites** compatibility tests passed. Raw reports, snapshots and fingerprints remain unmodified. This makes reservations conservative; it does not prove a bank account/deposit relationship or authorize allocation. Primary reference: [Bankgirot technical manual, tables 1/3](https://www.bankgirot.se/globalassets/dokument/tekniska-manualer/bankgiroinbetalningar_tekniskmanual_sv.pdf), numeric recipient BG right aligned and zero filled to width ten.

Independent read-only domain reviews covered all six initial diffs. Scoped independent reviews accepted the corrections. Final independent cumulative review of exact e42ac0e15e627bd5c33f079e62101ab71bedd44c and both planned tests-only commits returned READY, with no Critical/Important blockers; conditioned on exact-tree CI. It did not claim deployment, live provider or production restore verification.

## Full validation policy and local observations

Mandatory commands remain unchanged in `.github/workflows/payment-control-ci.yml`: root `npm ci --ignore-scripts`, `npm run check`, `npm audit --audit-level=high`, `npm test`; Sites `npm run install:ci`, exact installed minimatch check, shared root OCR installation, `npm run check`, `npm audit --audit-level=high`, `npm test`, `npm run build`.

Full exact-tree **Node 22 GitHub Actions** is the per-integration full-suite/type/build/audit gate. Each PR branch is updated to verified current main, tested as a cumulative tree, merged normally, and followed by verified main CI before the next merge. Local Node is **24.22.1 / npm11.9.0**; targeted tests and final full suites supplement this authoritative CI, and do not pretend to reproduce its environment.

Root/Sites clean installations completed. An independent final worktree at tree22af91fac5cef09e17d416edea4954f0659249f3 contains exactly the six-PR candidate plus the two tests-only commits; unchanged installed dependencies were copied, not symlinked. Its full Sites suite passed2331/2331,0fail/skip/cancel; minimatch exact1target/0writes,TypeScript and both audit gates passed. The same independent final worktree then passed **1309/1309 Node**,0fail/skip/cancel, so full local suites total **3640/3640**,0fail/skip/cancel/todo, with no reruns. Root elapsed296.67s and Sites103.08s; portable build receipt follows below. A missing optional /usr/bin/time launcher was detected before a test executed and replaced with Python timing; it is not counted as a test failure or skip. Dependencies/lockfiles and test limits were not altered. Initial local baseline was invalidated by starting the local PR15 merge before that baseline's test process ended, so its eventual green result is **not** reused as frozen-tree proof. The subsequent frozen PR15 local Node run passed **1083/1083**, zero fail/skip. Its Sites run gave **1972 pass / 1 fail / 0 skip**: existing minimatch default-100k CJS workload timed out under concurrent shared-host load. Unchanged isolated file then passed **28/28**. Exact PR15 main CI independently passed **1083 Node +1973 Sites**, zero fail/skip, including the same minimatch assertions and production build. No timeout was raised and no test was removed.

Known dependency finding: full Sites audit has **16 moderate development findings**, zero high/critical; production-only audit has zero findings. Root audit has zero findings. Existing ESLint support/compatibility debt remains; PR17 reported full lint212errors/2527warnings. Fresh final integrated lint completed **211errors /2527warnings**,311files,0fatal/0suppressed, exit1. This remains nonblocking existing debt, separate from required checks; integration does not claim lint clean. The two new flow tests add no listed lint issue; the reused banking fixture retains its old no-this-alias finding.

## Cross-flow coverage and failure matrix

| Flow | Executed behavioral path / evidence | Scope limits |
| --- | --- | --- |
| A Gmail → invoice proposal | New `sites/tests/gmail-pdf-cross-flow.test.mjs` (`24c71a2`): actual Gmail adapter and owner token crypto, real synthetic permuted PDF bytes, real retained-file route, both manual/Gmail race winners, SHA/bytes, PR19 server-PDF/parser, durable queue lease, exact held proposal, repeat import/fresh worker without duplicate original/extraction/debt. Focused combined group **16/16**. Existing actual PDF registration and known-counterparty suites remain in full CI. | Provider network and owner-bound local storage/auth harness stand in for live infrastructure; actual extraction/reconciliation code runs. Fresh worker shares SQLite, not a process crash. No live Gmail import or real invoice registration. |
| B Swedbank → payment view | Actual provider/date-window, receipt/normalization/checkpoint and bank UI regression suites; invalid-row correction; full combined CI. New `banking-security` cross-flow case (`3667cce`): actual RSA-signed provider adapter with substituted HTTP, rejected broad range/narrow exact windows/continuation, real receipt/normalization/SQLite, repeated history, real PR17 ReactSSR payment list and general-reference label. Scoped62/62; intentional OCR mislabel control fails then restored case passes. | No live provider mutation or consent renewal during integration. |
| C Bankgiro → preview | Real XLSX parser/integrity/import APIs, alias checks, multi-payer reports, stable reservations and financial domains; new zero-padding regression; complete full CI. | Real account/deposit relation remains externally unproven; no production links/allocation. Browser read-only navigation separately recorded. |
| D Backup → isolated restore | PR15 real SQLite/WAL, snapshot/encryption/original inventory/manifest, actual CLI isolated evidence restore, exact financial/original integrity, process interruption and safe retry. | No production archive decrypted/exported/restored; original private key and independent archive availability are not established. No production RPO/RTO claim. |
| E UI → list/detail/original/back | PR17 pagination/evidence/visit identity, stale A→B→A, navigation/filter/focus and contrast regressions; actual local Chromium candidate check: demo overview→invoice list→partial invoice detail→missing-original state, Escape focus returns to the opening invoice; bank list→aggregate needing specification→blocked detail→Escape returns to same row. Monochrome desktop dialog screenshot inspected. Production responsive/original receipt recorded separately below. | Physical mobile, screen reader and native OS matrix remain beyond these checks. |

| Requested failure | Test evidence retained in cumulative full suites |
| --- | --- |
| Concurrent same Gmail attachment | `gmail-upload-concurrency-final`, `document-queue-recovery`, new `gmail-pdf-cross-flow`, `integration-job-api` |
| Duplicate bank transaction | `db`, `bank-reference-storage`, Sites `banking-security` atomic import/audit/stable ID |
| Duplicate Bankgiro report / several payers | Node/Sites `bankgiro-links`; Sites `bankgiro-xlsx-integration` and new padding reservation cases |
| Several invoices / partial / overpayment | Node `reconciliation`, Sites `bankgiro` and `customer-messages`; proposals preserve exact öre and do not silently consume extra money |
| Wrong OCR / dropped leading zero | Mirrored `payment-references`; `invoice-candidates`, `invoice-evidence-ocr`, actual PDF registration/cross-flow |
| Similar customer names | Shared `reconciliation-normalization` identity/organization and competing-payment cases; no live near-name decision |
| Missing alias | `bank-account-evidence`, `payment-verification`, commit-time `bank-account-commit` |
| Rejected bank period / bank429 | `bank-date-recovery`, `bank-sync-date-api`, Sites `bank-sync-periods`, `banking-security` |
| Gmail429 / OAuth failure | Mirrored `gmail-adapter-reliability`, `gmail-retry-automation`, Sites `gmail` durable cooldown/blocked status |
| Session expiry during API | `session-mutation-fence`, bank consent-between-pages and lease/fence tests |
| Missing original / conflicting hashes | `bank-file-provenance`, `payment-verification`, `backup-reference-integrity-final`, `backup-recovery` |
| Interrupted restore | Actual process-kill/receipt staging and fresh retry in `backup-recovery`; cleanup in Node `backup` |
| Stale UI API answer | `evidence-loading-final`, `dashboard-loading-ui-q8`, `workspace-location-q8`, A→B→A visit cases |

These are synthetic writes in isolated stores. None deliberately corrupts production data.

## Read-only production baseline

Existing public shell with owner-bound private data, auth client, D1 `DB` (26 listed tables), R2 `BUCKET`, runtime revision9 and three enabled bank/Gmail/backup schedules recorded. Runtime secrets are masked by the service; values were neither printed nor changed. The API's masked entries allow preservation checks by key/type/revision, not secret-value verification.

Gmail: connected, recent successful fetch and durable queue observed. Existing automation ran independently; its predeployment success is not evidence for newly deployed code. At first integration status, 216 review items, no pending-job count shown, five registered outcomes, and stale cloud-worker heartbeat were reported. Later fresh status is the authoritative postdeployment receipt. GitHub scheduled-run history last reports cloud OCR run41503974414 at18:48:04Z on the old a9f88ae head; this does not certify the new code. No cloud run was manually dispatched.

Bank: active connected configuration; saved period error observed. No bank fetch/account-details call was initiated by this integration. Existing scheduled attempts may update status independently.

Backup: today's stored complete manifest, **195/195 originals**, **63,463,280 bytes**, saved manifest-pass verification. API original census reports 11 retained receipt records and112 older records without receipts. This status is not a fresh full cryptographic production restore.

0599: owner-bound exact-reference and ID reads at workspace revision42 show **one economic bank observation**, a separate **non-economic report observation**, zero allocations and a complete invoice-registry query with zero matches. Both selected original-integrity checks passed. Account/deposit identity remains insufficient and automatic reconciliation false. No payer identity, alias, invoice, allocation or paid status is fabricated. Exact bank/customer data and raw original bytes are deliberately omitted from this public report.

Production-wide preservation limitation: native D1 row inspection truncates the workspace payload (`truncated_values=1`), so it cannot establish a full ledger byte comparison. The selected payment projection/originals and visible overview totals can be compared read-only; do not expand that result into a full ledger census. Synthetic full-state conservation and restore tests supply broader code evidence.

## Serial delivery receipt

| Step | Updated reviewed PR head | Integrated main SHA | Full main Actions | Node / Sites | Result |
| --- | --- | --- | --- | --- | --- |
| 15 | bb4d40333e252ebd7067515cf2c9ba8e72419f7e | def0349e965a697831cfe3f1c75c946e404f6a1e | 41517221453 | 1083 /1973 | success,0fail/skip |
| 16 | b5c923c6612020044063da2b07c2f0dcdcb8f482 | c84467967fe34bafb12206fab096cc7e443d0e25 | 41518621990 | 1126 /2023 | success,0fail/skip |
| 19 | 8b87098ebd899cc6f118fcb43a5aca4dcb12db42 | 8c612353b665d89e2d45a264eacf2c533ade4bef | 41519668295 | 1201 /2107 | success,0fail/skip |
| 18 | d3566fdc90857517330127eef7f9d7911849e06a | 2bfe4e55059390deacde6b0107d6640245ff60f1 | 41520665359 | 1271 /2215 | success,0fail/skip |
| 14 | 493365c7e20cd86639ecae32ca8acfddd7aec363 | 723b143515bac1a59ee290f6ea3881c096caf5ab | 41521668283 | 1293 /2279 | success,0fail/skip |
| 17 | 72ce0daa891fccffc1d9112c3c8c45fa6901c672 | 79e7aa2acf78925c23d106fa826d92c25c642579 | 41523255146 | 1309 /2328 | success,0fail/skip |

All six original PRs merged successfully in the stated order. Every resulting main tree exactly matches its reviewed/tested candidate. Main79e7aa2acf78925c23d106fa826d92c25c642579 is green. A final acceptance PR adds the two tests-only flows and this report/scorecard; its exact main/Sites/publication receipt is recorded below after completion. All six workstream branches remain; no active work was deleted. Sites56 is still the rollback/current publication until the final native deployment succeeds.

## Quality assessment

Latest complete 33-area baseline is **255/330=7.73/10**, **0/33 at9.5**. All 33 retain their scores until full acceptance has objective evidence. New code/test evidence strengthens scoped controls; it cannot establish missing bank facts, representative OCR accuracy, a production DR exercise or physical accessibility acceptance. The integrated table in `QUALITY-SCORECARD.md` records before/after, contributing PR, tests, production evidence and remaining risk per area.

PR19's frozen synthetic corpus improves text scalar exact documents36/40→40/40 and false green7→0; native PDF2/3→3/3, false green1→0. Raster remains3/4 exact, precision96.67%, recall70.73%. Text green/review metrics do not imply universal100% OCR. Swedish textual month names still produce a safe review hold and remain a documented nonblocking inherited gap.

## Remaining acceptance and next steps

1. Establish explicit bank account/deposit evidence and separate business authorization before any real blocked-case registration/allocation.
2. Observe a new external Gmail schedule run and cloud OCR completion on the final deployed code; heartbeat/configuration alone is insufficient.
3. Perform full owner-authorized production export/independent-key isolated restore, integrity and measured RPO/RTO exercise; new offline tools do not create missing private keys.
4. Complete representative anonymized OCR/business corpus, textual-month parsing and genuine mobile/assistive-technology acceptance.
5. Resolve compatible development dependency/lint maintenance debt without weakening security gates.
