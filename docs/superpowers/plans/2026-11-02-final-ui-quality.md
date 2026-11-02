# Final UI quality implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Independent UI surfaces are assigned to separate workers; the whole branch receives an independent review.

**Goal:** Make the existing black-and-white MG Fakturakoll UI clearer, accessible and responsive on long lists without changing financial decisions.

**Architecture:** Keep current data contracts, economic functions and evidence classifications. Bound displayed rows, cache only calculations whose inputs have not changed, and make unavailable data visibly unavailable. Root owns Sites dashboard/CSS and final evidence; independent workers own Node public UI and the Sites bank list.

**Tech Stack:** Existing Node JavaScript, React/TypeScript, Sites/Vinext and Node test runners. No new production dependencies.

**Spec:** User's 2026-11-02 final UI task and its later parallel-development restrictions; repository AGENTS.md. Baseline `a9f88ae`.

## Global constraints

- Use only branch `codex/final-ui-quality-2026-11-02`; do not push main, force-push, merge or publish Sites during parallel work.
- Do not modify financial engines, provider synchronisation, OCR or backup implementations owned by other assignments.
- Keep verified bank identity, manually supplied identity and suggestions distinct.
- All persisted test fixtures and measurement artifacts are synthetic.
- Four overview concepts: Inbetalt, Kvar att få, Att betala, Behöver granskas. Primary action: Kontrollera alla betalningar.
- Review all 33 areas; production-dependent scores require production evidence. An unmerged branch is not a production delivery.

## Review focus

1. Search/filter or refreshed data must not leave a paginated view on a nonexistent page.
2. Unknown/failed/auth-lost reads must not display zeros, stale search results or empty-state claims.
3. Payer and reference fields must come from existing evidence gates; a matching customer name cannot become bank proof.
4. Keyboard activation must open the intended row once, and focus must survive dialog closing and pagination boundaries.
5. Rendering/searching must not run unused reconciliation, change input state, trigger a financial command or truncate exports/totals.

## Tasks and progress

- [x] Sites dashboard: reproduce unnecessary suggestion calls; remove unused derived work, memoize stable filtered lists, gate all loaded-data views and search. Add regression tests for failed/pending reads and unchanged financial state.
- [x] Sites invoice list: bound rows to 50, retain total/export scope, expose explicit reference/source/review and verified payer safely, provide responsive layout and keyboard-accessible row actions. Test pagination and evidence boundaries.
- [x] Sites bank list: bound presentation work to 50 rows, share accessible pagination, keep full summary counts. Test page reset, selection, escaping and unchanged evidence.
- [x] Node public UI: fix confirmed search/focus/layout gaps, align home presentation using existing economic summary, preserve all economic logic. Test with synthetic data.
- [ ] Verify: full Node/Sites suites, syntax, TypeScript, security audits, production build, synthetic browser viewports/keyboard, bounded-list and large-dataset timings. Review branch independently.
- [ ] Deliver: fresh origin/main comparison, own-branch commits/push, PR to main, Actions status and `docs/FINAL-33-AREA-QUALITY-REPORT.md`. Leave merge/publication for ordered integration.

## Execution ledger

- 2026-11-02: fresh isolated clone; baseline `a9f88ae`. GitHub repository write permission verified. Local sandbox proxy/listen restrictions require managed escalation for network installs and server-based tests; no application permissions changed.
- Ruling: implement the supplied detailed brief autonomously, as requested. No additional design-approval round; existing stack and black-and-white design remain the basis.
- Baseline review: current scorecard totals 255/330 (7.73/10), zero areas at 9.5. Latest maintained report's partial authenticated Sites55 reading is later than the older complete table and must be labelled historical evidence.

- Final local gates: Node 1,078/1,078 and Sites 1,961/1,961, zero failures/skips. Syntax107, TypeScript, high audits, exact minimatch check and production build pass. Sites production audit0; full audit16 moderate development findings.
- Extra full lint remains failed:212errors/2527warnings. The9 changed existing Sites files improve52→47errors and31→26warnings;7 new Sites code/test/measurement files have0findings. No rules disabled.
- Final independent review closed an A→B→A evidence revisit regression after3 RED cases and a visit-epoch fix. The17-case evidence suite passes; no Critical/Important findings remain in reviewed changes.
- Actual authenticated current production overview was read without mutations. Local new-code browser attempt failed to connect; error-tab observation was policy-denied. No new responsive/browser acceptance is claimed; historical Sites55 evidence remains separately scoped.
- All33areas documented with before/current score, fix, tests, production scope and exact remaining action. Scores255/330and0/33at9.5 remain unchanged. Exhaustive UI inventory covers109files.
- Delivery remains own branch+PR only; no main push, merge or Sites publication. HTTPS git push dry-run lacked credentials; authorized GitHub connector will publish the exact staged tree and local/remote hashes must agree.
