# Whole-branch finding scoped rereview — round 1

Reviewed fix `2a506575901637dc83a087c91920e3a1f86c5bd1` on `9fc922739cb3522d34a3b9e854bc98262b6f32ba`, integrated by the coordinator as `c8e6c16`. Read `final-fix1-review.diff` and `admin-fix-report.md`. This rereview addresses the single important finding from `final-review.md` and new breakage in its fix.

**Spec-compliance verdict: PASS for the reviewed integrated implementation.**

**Code-quality verdict: PASS. No remaining review blocker found.**

## Original finding — ADDRESSED

`src/server.js:697` now evaluates AI policy using `req.companyContext?.storageOwner || 'node:legacy'`. This matches the existing processing owner selection in `src/openai-invoice-integration.js:6`. Legacy login principals no longer substitute for the AI storage owner, while company-scoped diagnostics retain their exact current storage owner.

The single production-line change leaves session, actor, current company resolution, `manage_integrations`, origin and response secrecy checks intact. It does not enable processing or make a provider request.

`test/admin-ai-status.test.js:52` adds actual authenticated HTTP coverage for an approved `node:legacy` consumer. The following cases reject actor-only legacy approval and verify company approval against the exact storage owner, including rejection of the login actor and another company's owner. These tests directly cover both the original false negative and the converse false positive, as well as company behavior.

The implementation report records a meaningful RED result of 6 passing / 2 failing tests before the production fix, followed by 8/8 passing after it; the existing authorization and secrecy cases remain in that focused suite. These results are implementer evidence, not an independent rerun. No further concrete doubt required a new test run.

## Scope and remaining acceptance

No additional correctness regression was found in the fix diff. The preceding whole-branch review otherwise remains applicable. Final exact-source mandatory CI, integrated build and later release-cleanup helper review are separate coordinator gates; these source-review verdicts do not assert that those gates or production publication have completed.

No tests, builds, provider requests, implementation edits, git operations or subagents were run in this rereview. This report was the only file written.
