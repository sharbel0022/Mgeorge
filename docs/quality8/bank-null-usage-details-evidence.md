# Selected null-usage details: implementation evidence

Date: 2026-11-06 UTC. Published baseline: `41aadcef5fc6f65cc73979997b195c7b4f12eec1`. Approved design: `23b4d71ae21d745471ac60c82e8b081f25731cb9`. Tests and initial RED were frozen separately in `d874f68`; exact hashes and counts remain in [the original RED record](bank-null-usage-details-red.json). This report covers local synthetic execution only. Root owns independent review, integrated CI, publication and any real follow-up.

## Result and authority boundary

An ordinary, authenticated legacy consent revalidation can now diagnose current usage for **at most five already selected accounts whose saved usage is explicitly null**. The response remains `BANK_ACCOUNT_SCOPE_INVALID`, HTTP 409, reason `ACCOUNT_USAGE_INVALID`, even if every fresh detail says ORGA. The original account cache, selection, status, consent expiry, invoices and bank transactions are unchanged.

This narrow read is authorized by the existing bank grant: a fresh AUTHORIZED session for the same owner, application, bank, country and selected UIDs, with valid deadlines and scopes. Every selected resource must have a present, valid and byte-identical primary identification hash in the saved account and current session before the first detail GET. The separate local business-usage denial remains authoritative. This is neither account enrollment nor proof of legal company ownership.

The only product changes are shared `bank-consent-policy.js`, its declarations, and `banking/service.ts`. No endpoint, client account selector or force flag was added. `validateEnableConsent`, `businessAccountData`, and the **entire** `banking/account-evidence.ts` remain byte-identical to the published baseline. Its `active()` gate still prevents a reauth-required connection from using the ordinary account-evidence reader.

## How the read is constrained

The private original error is bound to the exact validation input and a bounded, immutable data snapshot. Accessors, executable values, changed inputs, cloned/foreign errors and unsupported snapshots cannot authorize a read. The same unchanged snapshot is rechecked by the existing legacy validator. No null is deleted and no usage is replaced with ORGA.

All full-inventory and selected-hash checks precede reads. Unselected accounts and already permitted selected accounts are never refreshed. More than five null targets causes zero reads; the first five are not silently substituted for the whole set. Requested Bankgiro scope and explicit invalid saved/live usage also stop before details.

Each sequential read uses the existing strict persistent cooldown guard. The diagnostic lease checks current owner/adoption, application ID/generation/active AIS metadata, runtime configuration, every retained connection field except the guard's own transient marker, and the earliest consent deadline before and after calls. Atomic SQL fences repeat context/deadline checks at writes, including the final failed audit. Completed observations additionally require the read marker to be restored. An explicit UID, primary-hash, same-scheme primary identifier or currency conflict makes the response unusable.

Only a complete set of identity-bound responses can emit aggregate usage categories. A provider failure or partial batch emits no partial usage totals. A context, expiry, lease or failed-audit problem suppresses the new diagnostic. Unknown/known provider rate limits remain persistent, and a lost marker-resolution write remains blocked. Nothing converts a fresh ORGA observation into a connection update.

The new `usageDetailsDiagnostic` is privately bound in the service and contains only a fixed version, status, whitelisted reason and counts. It never contains usage strings, UIDs, account numbers, hashes, names, provider text or exception properties. Existing HTTP MCP error transport preserves the additive object and remains `isError: true` with private/no-store caching.

## RED/GREEN and regression

| Population | Before | After | Scope |
| --- | ---: | ---: | --- |
| Pure plan/observation | 12 pass / 47 fail | 59 / 59 | Identical frozen 59-test file; input provenance, scope, full selected identity, five-target bound, literal usage, response conflicts. |
| Initial frozen service/MCP | 23 pass / 35 fail | See correction below | 58 tests frozen before any product edit. |
| Corrected service/MCP population | 23 pass / 35 fail | 58 / 58 | Same 58 cases; two test-assumption corrections explicitly documented below. Baseline rerun used archived exact 41 source. |
| Additional metadata/timeout probes | 4 pass / 2 fail | 6 / 6 | String-valued services/countries were incorrectly accepted by `includes`; both now require arrays. Other active/app/AIS and timeout controls remain green. |
| Existing account-evidence negative | 1 / 1 | 1 / 1 | No account read from reauth-required status, even with a hypothetical ORGA detail. |
| Final service regression | — | **120 / 120** | 64 new diagnostic cases plus 56 existing revalidation, consent, scope and MCP cases. 40,356.066 ms. |
| Final policy/adapters/provider regression | — | **286 / 286** | Shared policy, Node and Sites adapters, account evidence/provider and cooldown. Includes the 59 pure cases and the active-gate negative. 26,770.829 ms. |
| Existing sync import consumers | 3 pass / 45 fail | **48 / 48** | Two older provider mocks lacked the new static export. Explicit throwing test exports restore imports; all old assertions remain. 15,021.133 ms. |

The three final regression populations contain **454 distinct tests**, zero failures, skips, cancellations or todo. Earlier focused successes are subsets and are not added again. Sites typecheck and `git diff --check` exited 0. All tests used Node 24 with the existing isolation preloader; HTTP fetch was replaced by synthetic fixtures, including real provider-adapter JSON and MCP route execution.

The preserved policy parity scripts gave 54/54 and 62/62 identical baseline/current decisions, with no input mutation. The earlier independent reviewer's 256 usage combinations were rerun by the implementer: 4 allowed / 252 denied, unchanged, plus three unusual-value and reflection controls. This is reused regression evidence, **not a new independent review**.

## Transparent test corrections

The initial 58-case implementation run was 56 pass / 2 fail. Root approved these two corrections; the original test commit, source hashes and failed logs remain intact.

1. **Runtime generation:** the initial mutation appended a newline to the synthetic PEM. Existing `runtime-config.ts:11` trims configuration strings; line 33 obtains PEM through that helper. Therefore that mutation did not change generation. The corrected fixture replaces synthetic Base64 `VEVTVC1PTkxZLU5PVC1SRUFM` with `U1lOVEhFVElDLVJFUExBQ0VNRU5U`, preserving the envelope but changing normalized key material. The assertion still requires only the session GET and no diagnostic/detail read.
2. **Owner change:** the initial case required the original ConsentError/409 even after identity changed. Existing `store.ts:153–154` performs owner-scoped lock cleanup in `finally`, which throws `COMPANY_BOUNDARY_VIOLATION` under the changed actor. The corrected test requires that exact stronger failure and its existing generic 500 response, no old or new usage diagnostic, exactly the single detail GET that triggered the change, zero successful-consent audit entries, zero sync runs, and no workspace. The service/lock implementation was not weakened to satisfy the test.

Both corrected cases were rerun in the full 58-case population against archived baseline 41: 23 pass / 35 fail, 17,617.083 ms. The corresponding implementation population passed 58/58, 22,128.491 ms. These timings describe test runs, not live bank latency.

One older exact-response assertion also required an **additive** update: saved-null/no-primary-hash still returns the same error, reason and original usage counts, and now explicitly reports `not_read / PRIMARY_IDENTITY_MISSING` with zero attempts/observations. The unmodified old assertion first failed solely on that added field. Every previous field, denial, no-mutation, no-extra-GET, no-financial-effect and audit assertion remains present.

## Reproduction and remaining uncertainty

[Machine-readable evidence](bank-null-usage-details-evidence.json) records exact product/test hashes, commands, original and corrected logs, runtimes and byte invariants. The original design and [execution ledger](bank-null-usage-details-ledger.md) retain the approved limits and chronology.

No real bank request, customer-data access, credential inspection, cache repair, connection activation or production write occurred during this implementation. The actual selected account's primary-hash continuity and fresh detail usage remain unobserved. A later successful ORGA diagnostic can support a separately reviewed, history-preserving cache correction; that correction is intentionally absent here. Missing/changed identity, an expired or revoked grant, invalid usage, cooldown, or owner/adoption changes remain blocking. No score or restored-bank claim follows from these synthetic results.
