# Mgeorge Codex safety and engineering rules

- This repository holds TWO distinct implementations: local Node.js (`src/`, `public/`, `test/`) and Sites (`sites/`). They have separate databases. Git changes do not deploy Sites.
- For automated work, use only a fresh disposable clone with synthetic fixtures. Never access real bank accounts, Bankgirot, Gmail, Sites, production D1/R2, local SQLite files, credentials, personal data, or network connectors.
- Never send customer emails, authorize transfers, mark real invoices as paid, run backup/restore in production, change schedulers, modify secret material, publish a Site, or deploy.
- Never run `git commit`, `git push`, `git merge`, `git reset --hard`, `git clean`, or modify `.git` during the unattended loop. The human owns version control and release.
- Do not weaken/skip/delete tests, static checks, security checks, CI, or the local Codex runner. Add regression tests for every meaningful fix. Preserve baseline test counts.
- Financial evidence is strict: distinguish bank-supplied OCR, invoice-number proposal, customer identity, actual payer identity and bank transaction ID. Never convert an amount match, generic bankgiro number, or Gmail invoice into verified payer/OCR proof. Unknown data must remain visibly unknown and require human review.
- Preserve original source documents, bank payloads, provenance, idempotency, duplicate prevention, audit trails, backups and customer-authorized actions. Never fabricate data or claim real payment verification from mocks.
- Prioritize changes with measurable impact. Run `npm run check && npm test` at repo root and, separately, `npm run check && npm test && npm run build` within `sites/` when feasible. The orchestrator independently runs the full gates.
- User-facing UI should be simple, responsive, accessible, black and white, with minimal actions and clear explanations of payer and reference confidence. Do not hide uncertainty or safety warnings to make UI look cleaner.
- Codex must output valid JSON matching `docs/codex-autopilot/result.schema.json`. `done=true` is only a technical suggestion and never asserts production-level perfection.
