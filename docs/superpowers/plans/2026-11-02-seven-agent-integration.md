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
- [x] T6 Run complete Node/Sites suites, syntax/TypeScript, security gates and
  production build for the delivered contract/regression heads; independently
  verify all six named cases. Repeat these gates for future implementations.
- [x] T7 Evaluate the publication condition: only docs/tests changed; no runtime
  publication is due. Recheck existing Site 57, bank/Gmail, stored backup and
  read-only economic projections. A future runtime merge still requires fresh
  backup/rollback, exact source deployment and production verification.
- [x] T8 Final report: PR/SHA/branch inventory, merges/conflicts, exact tests, real
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
At that checkpoint, the new frozen head required exact CI and resulting-main CI. New agent
implementation PRs remain absent in the 22:04UTC inventory.

Final #23 review head `15f259d1ef46f28fbecf66d522ac70054cf2e6b4`, tree
`e4681c5028ba68a25e233516e873d3cc566fae67`, passed exact CI41534249801:
1309 Node + 2337 Sites = 3646, all six new names present and every job step
successful. Main/base was rechecked immediately before normal merge to
`12c9868606a0a45b31b722ddee8f897541687e64`; both expected merge parents and
tree were verified. Separate main CI41534722847 completed successfully at
22:11:13UTC; actual logs confirm 1309 Node + 2337 Sites = 3646 and all six new
cases, zero fail/skip/cancel/todo. The 22:11UTC inventory has no open PRs or
new implementation commits; the adapter branch remains at starting main.

T4/T5 remain open for the six undelivered workstreams and full C1/C3 source
chain. Delivered #22/#23 were reviewed and merged serially. The final report
states this scope explicitly; the complete product goal remains pending.
