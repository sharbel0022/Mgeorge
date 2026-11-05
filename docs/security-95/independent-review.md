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
source fingerprints are recorded in [gates.json](gates.json).

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
