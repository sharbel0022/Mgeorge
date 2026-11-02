# Seven-agent integration implementation plan

> **For agentic workers:** Use superpowers:executing-plans for the coordinator's
> serial work and independent read-only reviewers for architecture and PR review.

**Goal:** Publish reviewed shared contracts, integrate the six new workstreams
with cumulative financial-safety tests, and publish the matching existing Site
when implementation deliveries and all required gates are available.

**Architecture:** Extend the existing Node/SQLite and Sites/Workers/D1/R2
application. Retain original evidence, current account/consent checks and the
existing atomic allocation and job boundaries. No replacement domain engine.

**Tech stack:** Existing Node >=22.13, JavaScript/TypeScript, SQLite, React,
Vinext/Workers, D1/R2; existing lockfiles and GitHub Actions gates.

**Spec:** User's Agent 7 six-phase assignment and
`docs/integration/README.md` (concrete shared baseline).

## Global constraints

- Isolated coordinator branch from current origin/main; serial normal PR merges.
- No force-push, real-case 0599 writes, production financial tests or branch deletion.
- Production data/status inspected read-only; runtime secrets never exported.
- Other conversations communicate through their actual PRs and integration docs.
- User has explicitly authorized execution, integration and conditional publication;
  no additional design/merge/publish confirmation loop is needed.

## Review focus

Missing authorized Bankgiro source; lost reference zeroes and OCR mislabelling;
stale account/consent/job lease; duplicate report versus economic deposit;
changing PR/main heads during review. Each is a mandatory acceptance case in the
shared contract and must be exercised after its owning implementation arrives.

## Tasks

- [x] T1 Read current main, previous PRs/reports, current Site and live read-only status.
- [x] T2 Write exact existing field/API mappings and new capability contracts;
  independent architecture/document review; separate contract PR, CI, normal merge.
- [x] T3 Record the reviewed contract head/merge SHA and concrete six-agent inventory
  in `docs/SEVEN-AGENT-INTEGRATION-REPORT.md`; recheck branches/PRs while active.
- [ ] T4 For each delivered PR, freeze head/base/files/CI; review semantic dependencies
  and shared changes; reproduce/fix concrete defects with regression tests; test
  cumulative candidate, merge once, and require resulting main CI before next PR.
- [ ] T5 Exercise synthetic 0599 adapter-to-overview chain and negative/replay/
  concurrency/recovery matrix, with no duplicate economic effects. Preserve actual
  coverage gaps if a required implementation has not been delivered.
- [ ] T6 Run complete Node/Sites suites, syntax/TypeScript, security gates and
  production build for the final implementation; review independent results.
- [ ] T7 If relevant Sites code changed and gates pass, check current backup and
  retained rollback, preserve exact source/configuration, deploy existing project
  and verify version/tree plus read-only bank/Gmail/economic projections.
- [ ] T8 Final report: PR/SHA/branch inventory, merges/conflicts, exact tests, real
  external bank blocks, Site/main state and all 33 quality scores/deltas. Leave a
  precise continuation point, without claiming ongoing monitoring after this run.

## Evidence and rulings

Start: main `73662187cddf9a5c504dea9bd8a1288bd929bc51`, Sites tree
`45761f430862a3ecbf31bbba2c2c116db7b210a0`, current Site version 57.
Initial main Actions `41528175033` is green. Previous PR14–19 are already merged;
new-round PRs were absent at the initial inventory. Branch creation alone is not
new implementation delivery. Existing backup is a stored manifest pass, not a
fresh whole-system restore. Current score baseline is 255/330 = 7.73/10.

Ruling: Document exact existing interfaces and required semantics for unimplemented
additions; require concrete agent type/API proposals in their PRs instead of
inventing a second engine or declaring absent functions available.

Ruling: Use the already authorized normal merge/publication workflow after review
and CI. Do not request repeated permission for the steps the user assigned.

Contract receipt: PR22 head `75418773829e49e99bf7db64c34e8e0ba8577af2`,
tree `7a52d899f8fdbc5021a9368332936eab128f963a` matches the independent reviewer
copy. Two architecture wording findings corrected; final APPROVE. Exact PR CI
41531331428 both jobs success. Normal merge
`b65273500c214a4e16b880e3840dac90d8bd7401`; exact push CI41531868549 observed
complete/success: 1309 Node + 2331 Sites = 3640 pass, zero fail/skip/cancel/todo.
Six new implementation PRs absent at
21:48UTC. Report and coverage audit record this without claiming acceptance.

Ruling: Stop redundant unchanged local baseline suites after exact-head GitHub
CI passed, under shared-host load. Initial sandbox EPERM and stopped authorized
runs are not counted as passing local tests. Both local locked installs and
high-audit gates passed; Sites retains 16 moderate development findings.

PR23 initial head `6b54420c82e6e7aa6a00ad3949abe7af8b3ffa4c` passed full CI
41533411197: 1309 Node + 2337 Sites = 3646, including all six new named cases.
Independent reviewer approved the report/test, then the narrow guard follow-up.
Ruling: Address two minor findings because the claimed read-only and two-layout
coverage otherwise admitted concrete false positives. Fresh six-case pass and
four expected-failure mutation probes verify those guards; probes were removed.
The new frozen head still requires exact CI and resulting-main CI. New agent
implementation PRs remain absent in the 22:04UTC inventory.
