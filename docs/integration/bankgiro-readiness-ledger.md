# Bankgiro readiness execution ledger — 2026-11-03

Spec: docs/superpowers/specs/2026-11-03-bankgiro-source-readiness-design.md
Plan: docs/superpowers/plans/2026-11-03-bankgiro-source-readiness.md
Start main: d91ec6c45acc07c15b82b815ffaa305d6d213656. Branch: codex/bankgiro-source-readiness-20261103.

User explicitly supplied the implementation/merge/publication mandate; proceed autonomously. No extra approval is inferred from workflow defaults. Significant design choices are stated in the spec and user progress updates.

Preflight: T1->T2 fixed normalized HTTPS protocol; T1->T3 exact resolver/factory, immutable registration and interval; T3->T4 optional additive authorization/history fields. Root resolves interfaces before integrating. Separate worktrees isolate writes; all financial writes remain synthetic.

- [x] Baseline local Node1563 +Sites2980 =4543 pass,0fail/skip/cancel/todo, Node24.22.1; locked installs actual dependencies.
- [x] Task1 transport/registry; RED/GREEN and independent transport/whole-branch review fixes, including content409 integrity hold.
- [x] Task2 isolated SFTP bridge; actual protocol/auth/host/journal/restart/abort/empty-directory tests; exact Node22.13 floor verified.
- [x] Task3 authority/telemetry/scheduler; all six backend review findings fixed with exact snapshot CAS and reserved revocation capacity; independent14 targeted cases pass.
- [x] Task4 UI and joined acceptance; actual SFTP->HTTP->queue->original->parser->preview->UI, immutable conflict preservation and zero allocations.
- [x] Historical pre-renewal combined1565Node+3117Sites+42bridge=4724pass,0fail/skip/cancel/todo; types/syntax/build pass; audits0root/prod/bridge,16inheritedmoderatedev; independent reviews clean.
- [x] Normal PR34/main CI, same Sites project publication and scoped read-only comparisons; final receipts below.
- [x] Final exact receipt and external activation parameters recorded in readiness report/JSON.

Root joined extension:17/17 actual fixture cases pass (six new multipayer/missing-payer/partial/excess/cross-report/429-restart cases plus eleven prior). Initial extra-test assertion used a nonexistent presentation field; corrected to existing fieldSources.payer.value and explicit unknown label, without any product change. This was an early partial receipt; the completed actual protocol chain is documented below and in the final report.

Historical code freeze:87c6be03fa9c19d2e810db80f3f1e2af548589b6. Final independent whole-branch review has no Critical/Important blockers; final scoped9/9 cases pass. Full final runner receipts pending below. Prior full1565Node+3113Sites and38bridge were green before two final whole-review fixes; do not use that earlier count as the final acceptance.

Historical pre-renewal runner receipt:bank-ready-final-node.log1565/1565;bank-ready-final-sites.log3117/3117;bank-ready-final-bridge-node22.log42/42 exactNode22.13.0; all0fail/skip/cancel/todo. Finaltypes,136-file syntax,bridgecheck,Build complete. No source/dependency changes after code freeze87c6be0; only root documentation follows.

Post-freeze contract adjudication: full spool identity incorrectly changed delivery IDs across authorization generations. Real two-spool RED reproduced; strict full spool binding retained while separate versioned canonical delivery namespace now preserves same-scope delivery ID. Root actualfullchain g2 changedSHA remainsBLOCKED/IDENTITY_CONFLICT withold/new originals and financial state preserved. Independent scoped6/6 pass, all3whole-branch findings closed. Current codefreeze2de17e5; refreshed fullSites3117/3117,bridge47/47 exactNode22.13,types/build pass. Node1565/1565 priorfull remains applicable: no Node production/dependency changes in this bridge/test-only follow-up. Finalunique total4729,0fail/skip/cancel/todo. Earlier4724 receipt superseded. PR34 originalhead72b79a6 CIall3jobs passed; fast-forward updatedhead and fresh exactCI required beforemerge.

PR34P2 independently reproduced: ownerrevoke+renamedsource could reuse retired(scope,generation) because only newIDhistorywaschecked. cadcdc3/current63554ac now uses sameowner snapshot for historicalandprospective retirements, without providercalls/statuswrites ondenial. NewrealSQLite cases prove owner/targeted revocation alias denial, activealias denial, validnewgeneration andotherownerisolation. Independent10/10 scopedcases pass. RefreshedfullNode1565+Sites3121+bridge47=4733passed,0fail/skip/cancel/todo;types/syntax/buildgreen. Prior4724/4729 receipts are historical; that checkpoint awaited final fast-forward-head CI, now completed in the release receipt below.

Final runtime release: PR34 head944fe16f, normal merge c367fcd94594db8aa892bc900a813177ec498d04; PR CI41621290758/push41621284729/main41621802705 all3jobs success. Main logs1565Node+3121Sites+47bridge=4733pass,0fail/skip/cancel/todo. Source0b0aa755444cd0782bcd24d8f81bfb837d4f6ca5 exact Sites tree145fe442d133e1afb2e2d347a343fcc7b71be599,450sourcefiles checked; Sites60 deploymentappgdep_6ae9bc63a0e88191a2ad484ec41a1abb succeeded10:50:39UTC. No additional runtime changes in documentation receipt follow-up.

Postchecks delayed until18:57UTC after execution interruption: env9/17/authrevision2/29tables retained;0018columns present,source/jobs0; SOURCE_NOT_CONFIGURED/UNKNOWN. Selected0599 evidence currentcomplete changed=false, workspace45→46, same62500öre/economic1+0/zeroallocation/automaticEligiblefalse. Bank AIS successful14:10UTC. Gmail fetch18:38UTC recent but local/cloudworkerfreshnessfalse; original Gmail schedule nowdisabled versus enabledpreflight. No schedule write invoked; cause/time unknown,currentstateleftuntouched. Bank/backup original schedules remainenabled. Backup267/267 fixedsnapshot verified, noDRclaim. Detailed exact receipts and limits are in final report/JSON.
