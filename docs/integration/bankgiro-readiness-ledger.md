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
- [x] Final combined1565Node+3117Sites+42bridge=4724pass,0fail/skip/cancel/todo; types/syntax/build pass; audits0root/prod/bridge,16inheritedmoderatedev; independent reviews clean.
- [ ] Normal PR/main CI, same Sites project publication and scoped read-only comparisons.
- [ ] Final exact receipt and external activation parameters.

Root joined extension:17/17 actual fixture cases pass (six new multipayer/missing-payer/partial/excess/cross-report/429-restart cases plus eleven prior). Initial extra-test assertion used a nonexistent presentation field; corrected to existing fieldSources.payer.value and explicit unknown label, without any product change. Source protocol E2E still pending Task1/3 integration.

Code freeze:87c6be03fa9c19d2e810db80f3f1e2af548589b6. Final independent whole-branch review has no Critical/Important blockers; final scoped9/9 cases pass. Full final runner receipts pending below. Prior full1565Node+3113Sites and38bridge were green before two final whole-review fixes; do not use that earlier count as the final acceptance.

Final local runner logs:bank-ready-final-node.log1565/1565;bank-ready-final-sites.log3117/3117;bank-ready-final-bridge-node22.log42/42 exactNode22.13.0; all0fail/skip/cancel/todo. Finaltypes,136-file syntax,bridgecheck,Build complete. No source/dependency changes after code freeze87c6be0; only root documentation follows.

Post-freeze contract adjudication: full spool identity incorrectly changed delivery IDs across authorization generations. Real two-spool RED reproduced; strict full spool binding retained while separate versioned canonical delivery namespace now preserves same-scope delivery ID. Root actualfullchain g2 changedSHA remainsBLOCKED/IDENTITY_CONFLICT withold/new originals and financial state preserved. Independent scoped6/6 pass, all3whole-branch findings closed. Current codefreeze2de17e5; refreshed fullSites3117/3117,bridge47/47 exactNode22.13,types/build pass. Node1565/1565 priorfull remains applicable: no Node production/dependency changes in this bridge/test-only follow-up. Finalunique total4729,0fail/skip/cancel/todo. Earlier4724 receipt superseded. PR34 originalhead72b79a6 CIall3jobs passed; fast-forward updatedhead and fresh exactCI required beforemerge.
