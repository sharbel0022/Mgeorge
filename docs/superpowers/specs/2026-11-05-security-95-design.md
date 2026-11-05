# Security and reliability review — Agent 7

## Goal and authority

Implement the user's security/dataprotection assignment on `feature/95-security`
from `4ad205b` and deliver a reviewable PR against `main`. The 9.5/10 target is
an acceptance goal, not an assumed result. Production-dependent controls require
production evidence; synthetic tests alone cannot establish that score.

The user authorized code changes and a PR. All runtime tests use synthetic,
isolated data. No production restore/deletion, bank/provider penetration test,
real credentials in artifacts, deployment, merge, or customer communication.

## Approach

Preserve the existing Node/SQLite and Sites/D1/R2 architecture. Reproduce concrete
gaps, implement narrow fixes, and run the existing full gates plus focused
regressions. Replacing authentication or rebuilding tenant storage would expand
the trust boundary and overlap the other assigned agents; those are not needed
to fix ingress controls or recovery defects. This is the implementer's choice
within the requested security scope.

Parallel review covers access/OAuth/tenant isolation, backup/recovery, and
dependencies/CI. The coordinating engineer owns Node login throttling, Sites
request budgets, audit/privacy review, integration, and the risk register.

## Initial findings and intended behavior

1. Sites has JSON/text size checks after full buffering, including a cloned body
   used for authorization. Enforce actual byte budgets before parsing, including
   absent/false Content-Length, without reading unauthenticated uploads eagerly.
   Preserve the original request identity, authorization checks, and upload path.
2. Node login throttling is process-local. Keep the existing five attempts per
   15-minute policy but store its reservation in the control database. Survive
   restarts and multiple processes. Bind admission to the application's single
   administrator account, not an untrusted forwarding header or changing peer
   address. Retain only that constant account label, a count and a deadline;
   no IP address, password or keyed personal identifier. Include Retry-After.
3. Backup and concurrency fixes follow demonstrated faults, with corruption,
   cross-company, lost-response and restart tests. Never restore into an existing
   production target or activate external integration credentials during a drill.
4. CI executes untrusted branch code without production secrets and provides
   meaningful test isolation. Dependency findings are reported by deployment
   relevance; changing audit thresholds is not a fix.

## Acceptance and evidence

Run the root syntax/tests/audit, Sites locked install/type/tests/audit/build,
bridge syntax/tests/audit, and focused security runner required by AGENTS.md.
Record exact counts and limitations. Fresh independent review covers the final
diff. Update PROGRESS.md and QUALITY-SCORECARD.md with a dated, bounded assessment;
report unresolved Critical, High, and Medium risks and their release effect.
