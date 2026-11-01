# Bankgiro/AIS original linking implementation plan

> **For agentic workers:** Use test-driven implementation with parallel ownership and an independent whole-change review. The user's detailed execution mandate supplies the specification and authorizes main push and existing Sites publication.

**Goal:** Associate retained Bankgiro reports with one existing AIS posting through an audited, reversible manual decision, preserving money and originals.

**Architecture:** Existing bank transactions remain the economic source. Existing import originals remain separate; an additive manual relation supplies presentation only. Stable bank identity and invoice allocation rules remain separate. Node uses an additive relation table; Sites uses its existing owner workspace JSON and CAS/audit transaction.

**Tech stack:** Existing Node/SQLite and Sites TypeScript/React/D1/R2. No new dependencies.

**Spec:** User's attached request, AGENTS.md and this document's constraints. Baseline main: `1b017c0a34821bdc04aa9ca3002765f78b2888b6` (code delivered as Sites39).

## Global constraints and model

- Bank posting: existing economic transaction; collection posting and verified individual automatic children retain current semantics.
- Individual report row and report group: existing parsed Bankgiro records, review-only until existing strict automatic evidence qualifies.
- XLSX/CSV/camt original: existing imports/document storage and hash; no original deletion or rewriting.
- Manual relation: explicit method, owner/principal, target and complete report-group identity, source hashes, financial snapshots, note, timestamps and revocation. It never supplies bank-verified identity.
- Invoice allocation: existing allocation model only; manual source relations must neither create nor revoke allocations, payer relations, invoices or drafts.
- Candidate: date/amount/currency may suggest a relation, but never confirm identity. Explicit recipient account mismatch blocks confirmation. Maximum three calendar days difference requires a separate recorded explanation.
- Confirmation checks current owner, active selected bank account/consent, intact retained AIS receipt and freshly reparsed report originals, complete count/total, amount/currency/account, and conflicting/reused relations. No fabricated receipt or stable ID.
- Multi-payer reports remain grouped under the existing deposit; their amounts are not new economic money. Single-payer display can reuse the report's payer/reference with explicit manual-source label; generic reference never becomes OCR.
- No production writes during verification, emails, bank payments, consent/secret/schedule changes, destructive migration or database restore.

## Review focus

1. Metadata commands accidentally invoke automatic reconciliation or message preparation.
2. Re-import changes original/group identity, or report/target mutation leaves a stale display relation.
3. Two identical date/amount deposits, split reports and incomplete groups incorrectly collapse.
4. Missing historical AIS receipt, wrong owner/account, expired consent or corrupted report bypass integrity controls.
5. Detail rendering performs a bank provider mutation or invoice controls consume display-only payer/reference.

## Tasks

- [x] Fetch origin/main, read progress/scorecard/latest delivery, read CI and scripts; baseline npm installations and 578 Node + 912 Sites tests pass.
- [x] Reproduce synthetic 625 kr: Sites two visible rows, one economic row, zero allocations; Node one economic row plus retained review original. No current economic double-count bug reproduced.
- [x] Node owner: write failing real SQLite/API regressions, implement additive relation persistence/candidates/confirmation/revoke and original/UI presentation. Preserve allocations and raw rows.
- [x] Sites core owner: failing domain and real D1/R2 API regressions; add relation model/service, owner/integrity checks, metadata-only CAS/audit path. Preserve strict stable automatic path.
- [x] Root UI: failing presentation/detail regressions; show one linked main row, separate originals, candidates, explicit confirmation/revoke and source labels. Replace implicit provider fetch on detail open with explicit action.
- [x] Measurement owner: run identical synthetic before/after corpus, counts and timings, map all 25 scenarios and honest limits in BANKGIRO-AIS-LINKING-IMPROVEMENT.md.
- [x] Independent review and correction of significant findings, full Node/Sites CI commands including audits and build, browser desktop/mobile verification.
- [x] Refresh origin/main and integrate without overwriting concurrent work; commit/push main without force; verify Actions exact SHA.
- [x] Check backup/rollback and original deployment/policy/DB/R2/schedules; publish exact Sites source in existing project; verify version/deployment and authenticated read-only UI.
- [x] Update progress/scorecard and delivery receipt with actual results and remaining authentic-bank-evidence blockers.

## Execution record

Baseline full test logs: host temporary directory `mgeorge-linking-node-before.log` and `mgeorge-linking-sites-before.log`; fresh installs succeeded. Source-helper first opening in GitHub sites/ correctly refused a nonempty unrelated checkout; existing dedicated Sites source checkout is used instead. No production mutation occurred.
