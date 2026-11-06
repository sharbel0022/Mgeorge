# Tenant and session boundary verification

Date: 2026-11-06. Review baseline: `f3c80629d4856c2f8ecbb1ed81be391a13ac6be8`.

This work changes two request admission checks in `src/server.js`. The regression fixtures use synthetic identities, two separate temporary company databases and real loopback HTTP. They never call a provider. The local executor was unavailable; the observed execution evidence below comes from GitHub Actions.

## Reproduced faults and resulting behavior

| Boundary | Reproduced behavior before the fix | Result after the fix |
| --- | --- | --- |
| Browser session selection | The cookie parser kept the last `mg_session`. With two valid principals, cookie order selected which company's data was returned; logout also acted on the selected session. Seven new cases failed. | A header must contain exactly one `mg_session` occurrence to reuse a session. Duplicate occurrences remain ambiguous even when their decoded values match. Protected reads and logout return 401; `/api/me` reports unauthenticated. No existing session is deleted and no anonymous HTTPS session is allocated. |
| Active company selection | Omitting `contextVersion` bypassed the expected-version comparison and changed the active company with HTTP 200. Other invalid version types returned 409 rather than a request-validation error. Seven new cases failed. | `POST /api/companies/active` requires a positive safe integer `contextVersion`. Missing, null, string, zero, negative, fractional and unsafe integer values return 400 before changing the selection. A valid but stale version still returns 409 with `COMPANY_CONTEXT_STALE`. |

These findings concern ambiguous credentials and an omitted concurrency precondition. They do not demonstrate the ability to invent a valid session or gain membership in an arbitrary company.

### API compatibility

The shipped company client already sends the numeric version from `GET /api/companies`:

```json
{"companyId":"company-b","contextVersion":1}
```

External callers that omitted the version must now read the directory and submit its current version. Trusted internal provisioning and selection APIs are unchanged.

A single session cookie, including its existing percent-decoding behavior, is unchanged. The local desktop trust model is also unchanged: `ensureBrowserSession` can mint a local session, sets `req.browserSession`, and `sessionHash` gives that value precedence over the incoming cookie header. This preserves expired-cookie replacement even though the internal header can temporarily contain both old and new values.

## Observed red/green evidence

| Stage | Branch head | CI checkout | Scoped result | Evidence |
| --- | --- | --- | --- | --- |
| Cookie test-only RED | `7ae959fb1760fa1fa0e639c08dc2ac1a19a1ad7d` | `6cfb5cd7312cedc0ec9a9cda1a7aca8579ad087d` | Cookie tests: 4 pass, 7 fail | [Job 128203695537](https://github.com/sharbel0022/Mgeorge/actions/runs/42308462021/job/128203695537) |
| Selection test-only RED | `34466a0e91bec3f2cc9224431311236a4f00e6fc` | `2513031677027c6a6472064126e1262176e7d3b5` | Selection tests: 2 pass, 7 fail; missing version returned 200 | [Job 128204157754](https://github.com/sharbel0022/Mgeorge/actions/runs/42308595454/job/128204157754) |
| Product GREEN | `4f703b3fb2304936a2deb9deef6fadefc272f99f` | `383a25e8f7883a4c121a188d597691f61fcb778c` | New cookie 11/11; new selection 9/9; existing session-allocation 4/4 | [Job 128205377402](https://github.com/sharbel0022/Mgeorge/actions/runs/42308964853/job/128205377402) |

The GREEN job used Node 24.22.1 and finished with **104 passed, 0 failed, 0 skipped and 0 cancelled**, including separate recovery, release-evidence, migration and scale tests. The two earlier mixed jobs had totals of 25 tests / 7 passed / 18 failed and 34 tests / 9 passed / 25 failed; their additional failures belonged to recovery provenance. The checkout IDs above are GitHub's PR merge commits, not the branch-head IDs.

The tested `src/server.js` blob is `4e123fee40c8dc3a5fda872745283819281e4471`. Before the two edits, its blob `b77cf8446577bb00abc05a6badcbf9a77a0e4500` matched both the baseline and `integration/mgeorge-final-95`.

Rerun the session/selection subset from the repository root:

```sh
NODE_ENV=test node --import ./scripts/saas-test-isolation.mjs --test --test-concurrency=1 test/security-session-ambiguity.test.js test/security-session-allocation.test.js test/company-selection-version.test.js
```

The new tests also verify simultaneous reads of separate companies, successful single-cookie logout, rejection of a logged-out token, one successful concurrent selection for an expected version, and rejection of requests from the stale tab.

## Existing boundaries reviewed

The entries below describe source-reviewed controls and their existing regression locations. They are not additional execution claims beyond the CI evidence above.

| Boundary | Existing enforcement | Existing regression location |
| --- | --- | --- |
| Node actor, role and physical partition | `company-runtime.js` validates membership/status/versions, immutable database identity, role and live session before/after guarded data operations. | `test/company-boundary.test.js`, `test/company-api.test.js` |
| Sites actor and storage owner | `resolveCompanyScope`, `authorizedBatch` and SQL guards bind operations to current membership, selection and owner. Request context rejects an A database handle invoked in B. | `sites/tests/company-storage.test.mjs`, `sites/tests/company-request.test.mjs` |
| Revocation across asynchronous work | Node rechecks the initiating session after reading a streamed body. Sites rechecks scope before returning a response, including original bytes fetched from storage. | `test/session-mutation-fence.test.js`, `sites/tests/company-request.test.mjs` |
| Last active owner | Node performs owner changes in a synchronous control transaction. Sites' `company_last_owner` SQL trigger protects the invariant inside the transaction. The suspected owner-loss race was not a defect. | `sites/tests/company-storage.test.mjs`: “last-owner safety is enforced inside the transaction after a concurrent revoke” |
| Explicit request selectors and origin | Conflicting/duplicate selectors are rejected; mutation routes enforce the configured origin. | `test/company-api.test.js`, `sites/tests/company-request.test.mjs` |

Full Node release checks retain these local-session controls in `test/api.test.js`: “local app and business APIs open directly without a password”, “password-free local use preserves origin and OAuth browser-session protection”, and “legacy local browser sessions acquire the administrator principal without losing their binding”. Their execution belongs to the full-suite result for the release revision.

## Deployment evidence outside this change

Loopback HTTP does not verify a deployed TLS/reverse proxy or the platform's stripping and injection of `oai-authenticated-*` identity headers. The Sites identity module relies on that trusted ingress.

Node's existing body limits remain 8,192 bytes for login and 22,000,000 bytes for protected JSON; `readBody` has no custom application-level streamed-body deadline. Sites' existing bounded reader uses route-specific limits of 16,000,000 / 1,500,000 / 600,000 / 65,536 bytes and 120-second or 30-second read deadlines. Effective deployment timeouts, admission limits and high-load behavior require their own evidence. These focused tests do not establish whole-system SaaS readiness.
