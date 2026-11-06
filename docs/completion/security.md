# Completion: security, SaaS boundaries and recovery

Date: 2026-11-06. Scope: independent inspection and synthetic acceptance of the Node/SQLite and Sites/D1/R2 boundaries. All originals and credentials used by this reviewer were synthetic. No production data was written, no real provider was contacted, and no live recovery barrier or bank service was activated.

## Source and decision

The reviewed starting point is PR #61, `30dfaa97bb7ce2118b4756205347d4a96e8be6ab`. The final source for the focused boundary acceptance and full-size restore is **`c22bd94a68144a41b3b40664225509ef89f40722`**. The earlier complete security attempt is separately bound to `ee8d52186e970a6c3cde7fc116cd33f3f3e10485` and remains failed.

| Commit | Change |
| --- | --- |
| `dc2e6dd8c1c3fb13ae67d4de1bfb82ce7836b6e4` | Freeze 27 independently specified SQL boundary regressions before changing product code. |
| `081b04acbca171720ca0f30043993a2d044166f0` | Scan SQL quotes before comments; include the frozen regression in the security runner. |
| `ee8d52186e970a6c3cde7fc116cd33f3f3e10485` | Eight missing-migration/legacy compatibility cases in the actual Workers runtime test; no migration or provider product change. |
| `774b511b76882239b0633535f3cae774382ab643` | Freeze 36 further quoted-identifier adjacency regressions from independent review. |
| `a4aec82543c9c45147fe5a574448b6d976ed2d27` | Preserve token boundaries around quoted identifiers in the inspection shape. |
| `bc8ee145bfa3356280786282abc7cb43095daeb8` | Freeze three recursive quoted-CTE compatibility regressions. |
| `c22bd94a68144a41b3b40664225509ef89f40722` | Prefix owner CTEs at `WITH`/`RECURSIVE` keyword boundaries without requiring following whitespace. |

**Release assessment: conditional code release with Open Payments remaining blocked, subject to integrated final gates and hosted migration validation.** This assessment does not authorize production bank activation or approve a commercial multi-company launch. Missing token schema or a missing control row fails closed, preserves existing business data, and does not trigger request-path schema repair. A fully configured production mTLS integration will have an unavailable bank onboarding panel until the operator has verified the actual migration and initial control state. Ordinary company and legacy workspace reads remain available in the tested configurations.

The first parent review did not find another blocker. A subsequent independent reviewer did find the quoted-identifier bypass described below; the first review was not treated as final acceptance. That reviewer then checked the final token-separator/CTE diff and ran an independently frozen suite: **1/28 before, 28/28 after**, with no additional blocker in that bounded change. The integrated candidate still requires the parent's final gates; results from this isolated branch do not certify later changes.

## Reproduced and corrected tenant SQL defect

The old `sites/lib/company-storage.js` removed comments with a regular expression before recognizing string literals. These valid internal queries could therefore hide a table from the tenant adapter's inspection:

```sql
SELECT '--' AS marker, owner FROM workspaces
SELECT '/*' AS marker, owner FROM workspaces WHERE '*/'='*/'
SELECT '--' AS marker, recovery_required
FROM company_application_token_control
```

With independently seeded synthetic companies, the first two returned foreign-company rows; the third bypassed the control-table denial. This is a real broken invariant in the tenant adapter. No HTTP endpoint accepting arbitrary SQL, currently affected hardcoded business query, or production disclosure was established by this audit.

The correction scans left to right, recognizes complete quoted values and identifiers before comments, and derives both the executable statement and inspection shape from that scan. Real comments become whitespace; comment-like text inside strings remains data. Single-quoted table spellings, control-plane tables, schema escapes, unsupported statements and noncanonical SQL remain denied. The existing owner CTE and transactional membership fences remain in force. This follows SQLite's documented [comment syntax](https://sqlite.org/lang_comment.html) and [token rules](https://sqlite.org/draft/tokenreq.html).

The frozen regression covers line/block markers, escaped quotes, CTEs, multiline literals, genuine comments adjacent to literals, double-quoted/backtick/bracket aliases, control tables, bound values, viewer writes and the existing fixed JSON transaction fence. The original product produced **7 pass / 20 fail**; the same 27 assertions pass after the fix. A broader nine-file boundary/backup/onboarding/request-budget run passed **113/113**, with no failures, cancellations, skips or TODOs.

### Independent review correction: adjacent quoted identifiers

The independent reviewer reproduced `SELECT owner FROM"workspaces"` and its bracket/backtick equivalents returning both synthetic owners, plus access to `FROM"company_application_token_control"`. SQLite accepts these adjacent tokens. Removing the quote delimiters without preserving their boundaries produced `FROMworkspaces`, which the inspection expressions did not recognize. This was a second concrete adapter defect, and release signoff was stopped while it was corrected.

The inspection shape now surrounds quoted identifiers with spaces; the quoted text in the executed SQL is preserved. Another three failures exposed the existing CTE prefix's unnecessary whitespace requirement after `WITH`; the prefix now recognizes the keyword boundary, including `WITH RECURSIVE`, before adding the owner projection.

The expanded frozen tests first produced **27 pass / 36 fail** across 63 cases. Token separators alone produced **60/63**, with the three adjacent CTE cases still failing. Adding three independently specified recursive cases froze **60 pass / 6 fail** before the CTE correction. The final set contains **66 SQL regressions**, all passing within the final **183/183** focused acceptance run. New adjacency/CTE read cases are first executed as raw SQLite against the independent two-company fixture, so an invalid-query error cannot masquerade as a successful boundary test. Coverage includes `FROM`, `SELECT`, `AS`, `WHERE`, `JOIN`, `UNION`, `WITH`, recursive CTEs, all four control tables and legitimate owner-bound updates.

## Upgrade from a database without token coordinator tables

The parent reports a read-only production schema inspection with no `company_application_token_*` tables, `companies=0`, `saas_bank_state=0`, and one existing blocked legacy bank connection. These are the parent's production observations, not facts inferred from synthetic tests. This reviewer did not inspect or change production credentials.

`sites/db/schema.ts` declares both coordinator tables. Journal migration `0025_application_tokens` and `sites/lib/banking/openpayments/token-coordinator.schema.sql` include their constraints and the initial `INSERT OR IGNORE INTO company_application_token_control(id) VALUES(1)`. The request paths do not run this DDL or create the control row.

Eight new tests use the actual compiled Workers runtime and real scoped SQLite-backed D1 facade. They remove tables or the control row independently of the coordinator implementation and retain stored encrypted consent and workspace records:

| Configuration / missing state | Observed result |
| --- | --- |
| No Open Payments configuration, both tables absent | Snapshot and configuration reads succeed with blocked bank actions and `configuration_required`; discovery is denied. |
| `SAAS_BANK_ENABLED=false`, both tables absent | Same disabled behavior; valid-looking mTLS metadata does not activate the provider. |
| Production configuration without mTLS metadata, both tables absent | Same disabled behavior; no fallback transport is used. |
| Active production mTLS; both tables absent | Snapshot, configuration, discovery and sync status reject with internal `APPLICATION_TOKEN_STORAGE_UNAVAILABLE`, status 503. |
| Active production mTLS; control table, token table, or control row individually absent | Same rejection before token/provider dispatch. Stored account authority also rejects with `BANK_CONSENT_CHANGED`, status 409. |
| Legacy actor without company membership, token tables absent, active mTLS environment | Actual legacy identity/workspace reads succeed; the retained bank row remains `reauth_required`. |

All eight cases verify unchanged schema, unchanged `schema_version`, unchanged business rows, no request DDL, zero provider fixture calls and zero ordinary fetch calls. The full Workers runtime file passes **31/31**. Tests inspect internal error codes because its generic request harness maps provider errors differently; the production onboarding route uses `onboardingFailure`, which maps the storage failure to HTTP 503 with `ONBOARDING_UNAVAILABLE`.

### Exact operator gate

The hosted deployment workflow is reported by the parent to apply schema migrations before Worker upload and to constrain migrations to schema changes. The initial singleton insert is therefore a concrete packaging question: the host validator must accept it as initialization metadata, or a reviewed schema-only migration plus separate authorized operator initialization will be required. **No validator result is available in this review, so neither the migration nor its initialization was changed speculatively.** A schema-only table creation with no singleton row keeps Open Payments safely blocked; it does not complete bank onboarding.

Before activation, verify the actual applied `0025` state, the singleton's provenance and its recovery status. Do not manufacture or reset a missing recovery barrier or application token state to obtain a green status. An existing `recovery_required=1` barrier must survive migration; the common migration's `INSERT OR IGNORE` preserves it. Recovery release requires the separate trusted operator decision with the exact expected revision, restore marker and evidence identifier. Provider agreement, real mTLS binding/certificate, company registration and consent remain separate production gates.

## Acceptance and restore evidence

| Run | Source | Actual result |
| --- | --- | --- |
| Final SQL/company/role/request/backup/token-fence/migration/Workers focus, ten files | Final `c22bd94` source content | **183/183 PASS**, 0 fail/cancel/skip/TODO; 13.65 s. Includes all 66 SQL regressions and 31 actual Workers runtime cases. |
| Full Node security suite | `ee8d521` | **377/377 PASS**, 0 fail/cancel/skip/TODO. |
| Full Sites security attempt | `ee8d521` | **1082 pass / 2 fail**, 1084 reported tests, 0 cancel/skip/TODO; two test processes received SIGKILL, so not all cases completed. **Gate remains failed.** |
| Isolated replay of both killed files, with RSS/heap observation only | `ee8d521` | **360/360 PASS**, 0 fail/cancel/skip/TODO; 72.13 s. Does not replace the failed full gate. |
| Earlier isolated actual D1 coordination/transaction suite | `081b04a` | **5/5 PASS**, 0 fail/cancel/skip/TODO; 5.75 s. |
| Final full-size encrypted recovery drill | `c22bd94` | **PASS**, 430 originals / 185,567,855 bytes, all 430 hashes checked, 27 retained tables, ten negative rejections. |

Receipts: [failed full security report](security/acceptance-ee8d521.json), [final restore report](security/restore-c22bd94.json), and [source/command/log-hash index](security/evidence-index.json). Raw synthetic logs remain in `/workspace/scratch/aab0f7dc06f9/security-evidence/`; their hashes and exact source bindings are indexed. The parent owns the clean, complete integrated CI run. This report makes no claim that the failed local gate is green.

The security suite exercises three actual company boundaries with owner/admin/accountant/viewer roles; session and OAuth fencing; application token coordination and recovery; D1 transactional fences; 1/10/100-company isolation; bank originals; and isolated backup recovery. It uses synthetic credentials and the repository's network isolation guard.

The final restore ran from **14:24:28.252Z to 14:24:36.197Z** on 2026-11-06. It uses **430 synthetic originals totaling 185,567,855 bytes**, matching the parent's observed production inventory size only. It restores an authenticated encrypted bundle into a fresh evidence database, independently verifies every original hash, retained rows, company ownership and financial totals, and rejects altered or foreign evidence. It is not a download or restoration of the production backup. `productionRestoreTested` remains `false`.

Restoration plus independent acceptance took **2,412.098 ms**; the entire backup/interruption/resume/export/restore drill took **7,944.952 ms**. The local RTO budget was 60 seconds and the scenario's simulated RPO was 15 minutes. All 27 durable table sets matched. The oracle retained two invoices and two transactions totaling 75,000 öre each, one allocation of 62,500 öre, one revoked credit and one revoked Bankgiro link. Wrong key/owner/company, corrupt/missing originals, changed ledger/plaintext originals, a foreign-owner row, a reactivated issuer and a retained app token were rejected. The source was unchanged; authorization/transient rows were absent, worker leases invalidated and application-token recovery blocked.

The Node backup review confirms that app-token state is removed only from the private snapshot, discarded pages are removed, and a persistent recovery barrier is authenticated in the archive. An older raw archive containing even an empty application-token table is rejected; a pre-coordinator legacy archive receives a barrier in the private restored copy. The actual migration is tested against the restored barrier, and source financial rows and originals remain unchanged. This is specifically application-token quarantine; it does not claim that all retained provider consent data is removed.

SQLite startup was inspected: the merged `busy_timeout=5000` placement precedes journal/WAL initialization, and existing independent tests hold actual cross-process locks, check cancellation cleanup and replay historical migrations while preserving financial identity and originals. Those dedicated startup files were not separately rerun after the parent limited further local work following the SIGKILLs. They remain part of the parent's complete quality/CI gate.

### Earlier observations retained

The initial full security attempt passed Node **377/377** but Sites reported **1139/1140**: the `openpayments-token-d1.test.mjs` process was killed by SIGKILL after four real D1 cases. No assertion failure explained that signal. That run also overlapped local scanner work and is diagnostic evidence only. The later frozen full attempt killed `banking-security.test.mjs` after 57.36 seconds and `seven-agent-0599-joined.test.mjs` after 11.10 seconds. Their subsequent isolated replay passed all 360 tests. Observed process peak RSS was approximately 908 MB and 634 MB respectively. This shows significant memory use, but does not establish that OOM caused the kills: cgroup evidence was unavailable and no cause was manufactured.

One full-size restore attempt on `ee8d521` also received SIGKILL (exit 137) before producing its result. A sequential unchanged-code replay passed, followed by the final `c22bd94` restore above. The final restore's observed process maximum RSS was 769,616 KiB. No heap limit, test budget, assertions, fixture data size or product behavior was changed to obtain these results.

The initial restore command omitted `NODE_ENV=test` and was rejected by the isolation guard before running. Early migration-test iterations corrected harness-level HTTP expectations and a synthetic fixture's required timestamp before the test commit was frozen. These setup failures are retained with the raw logs and are not product defects or successful acceptance runs.

## Commands and scope limits

```sh
node scripts/run-saas-security-acceptance.mjs <private-evidence-directory>

NODE_ENV=test node --import ./scripts/saas-test-isolation.mjs \
  --experimental-strip-types sites/scripts/recovery-drill.mjs 430 185567855
```

The final restore and isolated two-file diagnostic additionally preloaded a private observer that records only `process.memoryUsage()` / resource counters and timestamps. It performs no application mutation and changes no timeout or memory budget. The final focused command and diagnostic command are recorded in the evidence index.

No score was increased. Production restore, operator access/key recovery, real-provider operation, provider activation and commercial acceptance remain unverified. Local recovery timings exclude cloud download, regional failure, operator response, key custody and production application activation. The test environment uses Node v24.22.1 and preinstalled dependencies whose lockfiles matched the isolated branch; the parent owns clean final CI/build verification. The full security runner's dirty-tree flag reflects an untracked local `node_modules` symlink; tracked product/test files were frozen during that run. The final focused tests and restore were bound to the corrected source separately.
