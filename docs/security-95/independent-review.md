# Independent security review — 2026-11-05

**Verdict: READY with limits.** The independent code reviewer reported no
confirmed Critical, High or Medium finding in the requested implementation
diff against `4ad205b84d1852ec7ed33cabd70fdadbe2f9d5c5`. The reviewer did not
edit files. This verdict is separate from production acceptance and from the
coordinator's complete test gates.

## Reviewed changes

- SQLite reservation and expiry behavior for the single administrator account,
  restart/shared-instance behavior, Retry-After, successful-login reset and
  preservation of session creation. No address or secret is stored by the new
  limiter.
- Sites stream budgeting before authorization clones, actual bytes versus
  declared length, lazy reads, deadlines, cancellation, reader/timer cleanup and
  standard Request metadata. No confirmed size bypass or new tenant bypass was
  identified in the changed boundary.
- Audit projection from accepted domain records. The final Bankgiro-link form
  retains link ID, transaction/specification references, notes and time. Its
  original evidence stays in the durable link record. Rejected bank-import
  `retained_conflicts` and revision/CAS conditions are unchanged in the diff.
- Producer/recovery agreement on UUID-shaped document IDs, and rejection
  before writing a snapshot while preserving the source originals.
- Security-runner child environment without inherited `NODE_OPTIONS` or
  operator credentials. The regression probe exercises real Node child
  processes without recursively running the full acceptance suite.

## Reviewer's own executions

Node version: **24.22.1**. All tests used synthetic, isolated data.

| Working directory | Command | Result |
| --- | --- | --- |
| Repository root | `NODE_ENV=test node --import ./scripts/saas-test-isolation.mjs --test --test-concurrency=1 test/security-login-rate-limit.test.js` | Exit 0, 5/5 pass, no failures/skips |
| `sites` | `NODE_ENV=test node --import ../scripts/saas-test-isolation.mjs --experimental-strip-types --test --test-concurrency=1 tests/security-request-budget.test.mjs tests/company-request.test.mjs tests/bank-state-integrity-q8.test.mjs tests/backup-integrity-q8.test.mjs` | Exit 0, 75/75 pass, no failures/skips |
| Repository root | `NODE_ENV=test node --import ./scripts/saas-test-isolation.mjs --test --test-concurrency=1 test/saas-security-runner.test.js` | Exit 0, 1/1 pass, no failures/cancellations/skips/TODO |

Total: **81 passing reviewer tests**. These overlap the coordinator's full
test suites and are not added to the release total.

## Timing and limits

The 75-test execution preceded removal of duplicate `documentId`/`sha256`
fields from the new `bankgiro.link` audit projection. The reviewer reread the
final code after that correction. The coordinator separately executed 57/57
Bankgiro-link/bank-state tests after the correction and restarted the full
Sites gate; those 57 tests are not part of the reviewer's 81.

The full Node gate's application, test and shared-library inputs did not change
during this Sites-route-only correction. The before/after source manifests
differ only at `sites/app/api/state/route.ts`. The focused acceptance runner
subsequently ran on the final source manifest. Exact command receipts and
source fingerprints are retained in
[first-candidate-gates.json](first-candidate-gates.json).

Real Next/Cloudflare transport, provider-specific Request properties,
production identities and bank/provider calls were not exercised by this
review. The network guard protects trusted tests against accidental egress;
it is not a sandbox for hostile JavaScript. Operational risks in
[the security report](../SECURITY-95-REVIEW.md) remain open.

## Separate access review

A second read-only access review inspected Sites membership/role/version
fences, owner-filtered SQL, Node company-database boundaries, actor/session/
company-pinned OAuth and the fixed-origin Open Payments transport. It found
no additional confirmed Critical/High defect and made no edits. It read the
existing company-API/session tests but did **not** run its own tests; no new
test count is attributed to that review.

The review noted Node's compatibility support for an implicit active company
when API selectors are omitted. No unauthorized cross-company access or
actual browser mutation was reproduced. The coordinator checked that the
shipped UI installs `createCompanyClient`/`installCompanyClientSurface`, whose
fetch boundary adds the selected company and context-version headers. This
observation is not promoted to a confirmed vulnerability or release blocker.

## Separate risk and report review

A third read-only reviewer inspected selected Node rendering paths, Sites
React rendering and the unused chart CSS sink, the internal owner-scoped SQL
adapter, static legal-document parity, and the report's cryptography and GDPR
claims. No additional evidence-backed Critical/High/Medium was found. No tests
were executed in this pass, and it adds no test count.

The report incorporates the requested qualifications: selected rendering paths
are not an exhaustive browser penetration test; the internal SQL adapter is not
a general SQL sandbox; the privacy policy is a draft in inspected source rather
than a newly verified live publication; and H1–H3 are operational evidence gaps,
not demonstrated exploitable High vulnerabilities. The older Node token helper's
lack of AAD is scoped separately from context-bound backup/provider formats.

## Integration review after main PR #48

The coordinator integrated `bf24a3c52ffc637d1e7bbc4d4f64a1732dcd9fee`.
The locally reviewed merge `5f2e5878f81e9e9c6010c487084d1c7ffc7720b0`
and initially published commit `cc50423315ba506f4e9f2cd8e5c5ef089dbe6269`
have the same Git tree, `cc066d47bcbe12b8cc30b737e399fa781f27d903`.
Publication through the repository connector changed commit metadata, not
file contents. The pre-integration review above retains its original scope.

The integration reviewer found no new confirmed Critical, High or Medium
defect. Request-budget failures still propagate before effects, while the new
`/api/bank/revalidate` route and `bank_revalidate_consent` MCP tool require
`manage_integrations`. The coordinator extended the existing accountant-denial
regression and ran the combined budget/company-request selection: 32/32 pass.

The reviewer separately inspected the integrated revalidation service,
account-read guard and runtime configuration. Revalidation preserves legacy
owner scope, rejects company/adoption misuse, checks authority before provider
work and commit, and cannot expand authorized accounts or create financial
records. Concurrent cooldowns and durable consent receipts remain fenced.
A lost commit reply is checked against the durable owner-bound receipt; an
unreadable result remains unknown. Canonical callback configuration requires
the expected HTTPS origin/path and provider registration. These observations
are code-review results, not live provider or deployment tests.

The reviewer's first combined run of budget/company/banking tests ended with
164 passing cases and a generic banking-security file-process failure; it is
not counted as a passing run. A separate TAP run of all 168 banking-security
cases then passed with zero fail/skip/cancel/TODO. The coordinator's full
Sites run reproduced a generic file failure, so a separate instrumentation
pass was requested instead of treating the isolated success as a full gate.
The final report records that investigation and the eventual source-specific
full-suite results.

### Production OCR trigger inherited from main

The supply-chain reviewer inspected the exact main versions of
`.github/workflows/sites-cloud-ocr.yml`,
`scripts/verify-cloud-ocr-trigger.mjs` and `test/cloud-ocr-trigger.test.js`.
Its own syntax check and **43/43 synthetic trigger cases** passed.

The new `workflow_run` path requires successful CI for a same-repository
`push` to `main`, matching the checked SHA, with two fresh main-ref preflights.
Checkout is SHA-pinned and no PR/fork artifact is consumed. OCR credentials
appear only in the execution step; preflight uses a read-only GitHub token.
Schedule/manual paths retain main/flag/fresh-ref requirements but do not
require a preceding successful CI run. Preflight does not lock the branch
through later execution. No live workflow was dispatched by this review.
Repository policy enforcement remains unverified independently of workflow
source review.

### Search and recovery changes inherited from main

The risk/report reviewer examined the new workspace search and recovery drill
without editing files or running additional tests. Search uses bounded text
processing with fixed regular expressions, 512-character/32-term query limits,
escaped Node text and React text rendering. The inspected paths do not build
SQL, dynamic regular expressions, HTML or network destinations from the query.
The Sites workspace boundary invalidates old company state and cached search
results on company transitions; this static review is not exhaustive browser
testing.

The new recovery drill uses temporary synthetic keys and data, checks original
hashes and relational/authority invariants, and explicitly reports
`productionRestoreTested: false`. Its measured recovery interval begins after
the package is local; it does not measure independent key retrieval, backup
download or real service activation. The evidence in
[`docs/quality8/recovery-evidence.md`](../quality8/recovery-evidence.md)
therefore does not close H1, even where synthetic row or byte counts match a
historical production observation. No new production data was read here.

## Final fixture-representation review

The independent reviewer read the complete proposed change to
`sites/tests/banking-security.test.mjs` and its static/dynamic import mappings.
Verdict: **READY with limits**, no confirmed Critical/High/Medium finding.
`git apply --check` passed. This review did not modify files or execute tests.

SHA-256 content identity preserves the existing reuse of identical modules,
while the fixture-specific global keys continue to distinguish Cloudflare,
identity, provider, server, store, service and MCP instances. Absolute import
mappings remain intact. `.mjs` and `pathToFileURL()` avoid dependence on the
temporary directory's package type or platform path syntax.

The unique temporary directory and exclusive mode-0600 writes prevent
accidental overwrite. Suite teardown runs after test completion; existing
per-test global-state/SQLite cleanup and network replacement are unchanged.
The generated modules reference fixture objects by their global identifiers;
runtime keys, database contents and provider results are not serialized into
those files. File/import/cleanup failures remain visible test failures.

The diagnostic worker then ran all 168 original banking tests, with zero
fail/cancel/skip/TODO, verified byte-identical test bodies/assertions, measured
lower RSS and observed directory/file permissions and cleanup on Linux.
This is separate execution evidence from the static reviewer. Windows and
abrupt-kill cleanup were not exercised. The exact cause/signal of the original
generic file-process failures remains unverified.

## Added isolated control-database recovery coverage

The recovery worker added one integrated case to
`test/security-login-rate-limit.test.js`, using real production backup,
authenticated-encryption, verification and restore functions with synthetic
data and a new temporary destination. It verifies the exact retained login
window, rejection one second before expiry, admission at expiry, rejection of
a wrong key/modified ciphertext before destination creation, and unchanged
source/valid archive bytes. The complete login file passed 6/6 under the
sanitized environment and network guard; no original assertions or production
files changed. [The execution receipt](control-recovery.json) records times,
command, source hashes and the log digest. This additional coverage passed on
its first run and is not described as a newly reproduced production bug.

The coordinator reread the diff and verified its scope. The test explicitly
backs up the control database. Scheduled company backups select the company
database path, so this test does not prove that operational backups include
both company partitions and the separate control database. H1 includes that
inventory and real independent recovery requirement.
