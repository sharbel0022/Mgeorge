# GitHub and bank final verification plan

> **For agentic workers:** Use superpowers:subagent-driven-development; user authorizes continuous safe implementation and delivery, but remote deletion awaits specific approval.

**Goal:** Preserve all work, finish possible cleanup steps, expose trustworthy account retry advice and deliver an honest bank-verification receipt.

**Architecture:** Existing read-only owner-scoped bank reader and provider diagnostics; additive safe retry metadata and existing UI. No financial engine, alias store, quota database or automatic bank retry.

**Tech Stack:** Existing Node/Sites TypeScript/React, synthetic provider tests, GitHub/Sites tools.

**Spec:** ../specs/2026-11-02-github-bank-final-design.md

## Global constraints

- No real bank account/provider calls while supplier deadline is unknown; no rate-limit bypass or unapproved financial mutations.
- No raw response/header, account/UID/original hash or credential in public diagnostics/Git.
- Do not represent60second fallback or sync nextAttemptAt as account-details supplier permission.
- Read-only API remains no-write; existing sync fallback/cooldown semantics stay compatible.
- Remote deletion requires concrete action approval; no replay or indirect execution of the rejected mutation.

## Review focus

- Explicit duration/date vs absent, invalid, past or oversized Retry-After.
- Forged ProviderError metadata/getters and arbitrary remote header text cannot confer trusted advice or leak data.
- Unknown/blocked/stale errors remain non-verifying; no timers trigger provider requests.
- UI displays deadline provenance without promoting bank account identity.
- Existing branch SHA/protection/PR/activity and archive restore proof rechecked before any approved deletion.

## Tasks

1. Recheck currentmain/CI/branches/PRs/archive and stored bank/original/status evidence. No provider retry.
2. RED safe explicit/no-header/invalid/oversized retry advice through real provider and owner reader; GREEN WeakMap diagnostics in sites/lib/banking/enable-banking.ts and account-evidence.ts, truthful presentation in existing account-evidence-presentation/UI if needed; focused tests and TS. Independent review.
3. Full Node/Sites/syntax/TS/production audits/clean build; exact main push and CI; publish same Sites if changed; read-only aftercheck excluding bank account/provider calls.
4. Inspect available genuine approval mechanism without triggering the rejected deletion; await explicit confirmation. Do not close PRs or delete refs before assessed/approved cleanup. Record limitation if no dialog capability exists.
5. Write the two requested sanitized reports, update current progress/quality/plan and delivery provenance. Verify finaldocs CI and actual remaining refs. No false universal OCR,9.5,completedpayment or background retry claim.
