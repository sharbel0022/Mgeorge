# Six PR integration implementation plan

> For agentic workers: execute inline with independent read-only domain reviews. This is the integration work explicitly requested by the user; no additional plan approval gate.

**Goal:** Integrate PR14–19 one at a time, verify each cumulative tree and main CI, publish one combined version to the existing Site, preserve financial evidence.

**Architecture:** Frozen PR heads from common main a9f88ae1c0f697376b3ecd140e1e80a64405125a. Root owns mutations; three independent reviewers inspect backup/bank, OCR/Gmail, Bankgiro/UI. Local integration branch previews each merge before GitHub normal merge with expected-head lease.

**Tech stack:** Node 22 CI (local Node 24.22.1), SQLite, TypeScript/React, Sites Worker/D1/R2.

**Spec:** User goal in current conversation; complete scope in docs/SIX-PR-INTEGRATION-REPORT.md.

## Global constraints

- No force push, active branch deletion, real invoice registration/allocation, payment or customer mail.
- Preserve original data, runtime secrets, Site identity/audience, DB/R2 and schedules.
- Run root check/test/audit plus Sites check/test/audit/minimatch/build after each cumulative integration. Await exact main CI before next merge.
- Production acceptance reads only. Synthetic isolated fixtures for all writes. No private source data in GitHub report.
- Freeze and recheck head/main before any merge. Changed heads invalidate previous tests.

## Review focus

1. Date recovery must not mark incomplete bank coverage successful.
2. OCR/Gmail must retain strict identity and source evidence after combined changes.
3. Aliases/deposit reservations must not duplicate money or misattribute a customer.
4. Backup restore must fail closed on contradictory hashes/missing originals/interruption.
5. UI must reject stale responses and label payer/reference truthfully.

## Tasks

- [x] T1 Inventory all heads/CI/reviews/rules/current Site, baseline suites, map overlapping paths and semantic dependencies.
- [x] T2 Integrate PR15 backup after review/full cumulative gates; normal GitHub merge; verify main tree/CI.
- [x] T3 Integrate PR16 bank after review and any RED/GREEN correction/full gates; main CI.
- [x] T4 Integrate PR19 OCR after review/full gates; main CI.
- [x] T5 Integrate PR18 Gmail preserving parser test changes/full gates; main CI.
- [x] T6 Integrate PR14 Bankgiro/full gates; main CI.
- [x] T7 Integrate PR17 UI preserving prior reports/bank UI/full gates; main CI.
- [ ] T8 Exercise cumulative synthetic flows A–E and failure matrix; correct concrete integration regressions with RED/GREEN.
- [ ] T9 Update 33-area scorecard and integration report; merge verified report/fixes through PR; main CI.
- [x] T10 Package exact main Site subtree, preserve configuration, deploy existing Site once, verify provenance/status/read-only economic projection and document final evidence.

## Evidence ledger

Initial PR heads: 15 bb4d40333e252ebd7067515cf2c9ba8e72419f7e; 16 869a0543eee81a42b55fbb0f0f9d9fbac3846661; 19 920dd5153231c99226157fe11863bb2e4c6da857; 18 8d4e71bc96ad61366651f0f2ed8531ca0e27d319; 14 18fd3c5e78aa16d697a651fa3a739d720797f2a7; 17 a67e2405406c94c3b0cab32d5630ef5dab7f0b0b. All exact-head PR workflows initially success. main branch reports protected=false, rulesets empty; direct protection endpoint unavailable (403).

Shared paths: PR15/16/18 src/server.js; PR15/17 PROGRESS.md and QUALITY-SCORECARD.md; PR16/17 public/app.js; PR19/18 sites/tests/gmail.test.mjs. No dependency/lockfile, hosting manifest or schema changes in six PRs.

PR15: normal merge def0349e965a697831cfe3f1c75c946e404f6a1e; exact main Actions41517221453 success,1083Node/1973Sites,0fail/skip, installation/check/audit/build passed. Local Node1083pass. Local Sites1972pass/1minimatch timeout/0skip; unchanged isolated minimatch28pass. Initial local baseline was invalidated by starting the PR15 merge before its end, so it is not reused as frozen-tree evidence. Main CI supplies exact stable Node22 evidence.

PR16: independent review reproduced skipped-invalid BOOK checkpoint loss. Fix02653401 RED4/GREEN5, focused144pass. Updated branch b5c923c6612020044063da2b07c2f0dcdcb8f482 (tree68567936aceee8fa46ab996477cfcf2a1b5d47da) includes exactmain15 and fix; PR Actions41518250475success. Normal merge c84467967fe34bafb12206fab096cc7e443d0e25; awaiting exact mainCI41518621990.

Ruling: Use full exact-tree Node22 GitHub Actions as the per-integration full-suite/build/audit gate, alongside local targeted reproductions and final local full suites. The shared local host has demonstrable timeout contention; no thresholds/assertions/test selection or mandatory CI commands are weakened. Wait for each mainCI before next merge.

Review corrections prepared locally: PR18 loader afb497a (RED0/7->GREEN7/7 combined,standalone7/7); PR14 zero-padding reservation527d6c6 (RED4->GREEN4,compat175pass). Cross-flow tests24c71a2 focused16pass, no product bug claim.

Preview: managed profile was initially unset in clean clone. Applied supported configure-execution-profile helper, then moved only generated stale .vinext/dev/lock.json after stopped status; local preview now serves and anonymous views correctly hold private values. No tracked product configuration changed. Connected browser local-preview attempt timed out; cloud browser reaches managed URL.

PR19 normal merge8c612353b665d89e2d45a264eacf2c533ade4bef; mainCI41519668295success1201Node/2107Sites,0fail/skip. Local focusedOCR60pass,syntax116,TypeScript/audit/buildpass. Root/prod0;16moderate dev preserved.
PR18 updatedheadd3566fdc90857517330127eef7f9d7911849e06a tree9ab895344b229ff0b1fe2304f445a8da04cf4581 includes main19 + fixturecompat; exactPRCI41520201235success1271Node/2215Sites0fail/skip. Normalmerge2bfe4e55059390deacde6b0107d6640245ff60f1; awaitingmain41520665359. LocalfocusedSites71/Node66pass.
CrossflowBtests3667cce ready for afterPR17: actualprovider/periods/receipt/SQLite dedup->ReactSSR; scoped62pass and wrongOCRlabelnegativecontrol failed thenrestoredpass.

PR18mainCI41520665359success1271Node/2215Sites0fail/skip. PR14prepared493365c7e20cd86639ecae32ca8acfddd7aec363 tree0f86432a9115586f888f82367c20603bfeae39c0 includes main18 + paddingfix; awaitingfullCI.

PR14 mainCI41521668283success1293Node/2279Sites0fail/skip. All5 merged server trees verified exact equality to their tested candidate trees via Git data API. PR17 local e42ac0e tree5bf6fb8b3664923e2b975ac07b36852efae1b950 resolves3textconflicts preservingbothdocs+UTCbankIso+UIfrom-datehelper. Focused55Node/29Sitespass; syntax121/type/audit/buildpass. Published normal descendant72ce0daa891fccffc1d9112c3c8c45fa6901c672 for fullCI; no force.
Final independent cumulative review READY; no Critical/Important codeblockers. Declined-to-judge rulings: realbank0599 facts/businesspermission remain external (cost if guessed: wrong allocation); fullprodDR/key/offsite/RPO-RTO remains unverified (cost: recovery not certified); scheduler/cloud completion needs actualrun (cost: config/heartbeat not execution); physicalmobile/assistiveacceptance remains unverified (cost: missed device access defects); universalOCRaccuracy not asserted (cost: sample extrapolation); deployment/postconservation remains pending until native/runtime evidence (cost: false delivered claim). Preserve these in finalreport; no permission or safety gate is bypassed.
Fresh localChromium e42 demoactualoverview/list/partialdetail/missingoriginal/Escfocus/invoice; bankaggregateblocked/Escsame row; desktopdialog screenshotinspected. No real writes.

PR17exactCI41522610556success1309Node/2328Sites0fail/skip. Normalmerge79e7aa2acf78925c23d106fa826d92c25c642579; mainCI41523255146successsamecounts. All6maintreesexactcandidateparityverified. Finalverifierworktree22af91 fullSites2331pass; rootrunpending; lint211errors2527warnings/0fatal baseline debt; TypeScript/minimatch/audits pass.
