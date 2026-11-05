# Read-only diagnosis of ACCOUNT_USAGE_INVALID on published Site 64

## Finding and evidence boundary

Source examined: **`819adee2f3848b474167eb6b15f82584caeb39af`**. Root reported
one ordinary revalidation after Site 64 publication returning
`BANK_ACCOUNT_SCOPE_INVALID`, HTTP 409, reason `ACCOUNT_USAGE_INVALID`.
That production observation is supplied by root; this diagnosis made no bank
request, credential read, production-data read or production write.

The code identifies a narrower cause than a generic reconnect failure, but
**does not yet distinguish private, explicit null, unknown string or wrong
datatype, nor whether the saved or current account observation caused it**.
An omitted usage field is already accepted. Therefore the available evidence
does not establish either an integration defect or a need for a new owner
consent. A repeated authorization could return the same rejected representation.

## Exact published predicate

`sites/lib/bank-consent-policy.js` checks both the saved account snapshot and
current `accounts_data` with:

```js
return accountData(values) &&
  values.every(account => account.usage === undefined || account.usage === 'ORGA');
```

`accountData` requires 1–100 non-array account objects. Separate earlier checks
give malformed inventories their own reasons. The resulting usage truth table
is exact, case-sensitive and does not trim or coerce values:

| Account property | Usage gate |
| --- | --- |
| Property omitted | Accepts this gate |
| Explicit JavaScript `undefined` | Accepts this gate; not a distinct JSON wire value |
| Exact string `ORGA` | Accepts this gate |
| Exact string `PRIV` | Rejects with ACCOUNT_USAGE_INVALID |
| Explicit JSON `null` | Rejects with ACCOUNT_USAGE_INVALID |
| Empty, lower-case, padded or any other string | Rejects with ACCOUNT_USAGE_INVALID |
| Boolean, number, array or object | Rejects with ACCOUNT_USAGE_INVALID |

Passing this gate is not proof of legal corporate ownership and does not bypass
the remaining identity, consent, authorization or account-scope checks.

## Which accounts and observations the reported action checks

`revalidateConsent` in `sites/lib/banking/service.ts` loads the authenticated
owner's retained connection, selected UIDs and saved account snapshot. Its
ordinary guarded provider operation is one `getSession`. It invokes
`validateLegacyEnableSelection`, not the new-consent full-account validator
directly.

The legacy adapter first validates bounded, unique UUID inventories in the
saved accounts, live UID list and live account data, requires the complete live
UID/data inventories to agree, and verifies that every persisted selected UID
exists in both snapshots. It then projects both snapshots to **only the already
selected UIDs** before invoking the unchanged strict consent validator.

Consequences for this particular failure:

- The selected-account inventory and preceding envelope/status/period checks
  had passed before this reason was produced. Later identity checks have not
  thereby been proved successful.
- At least one selected saved or selected live account had an explicit value
  other than the accepted `ORGA`/undefined pair.
- A private or null usage on an unselected legacy account cannot alone produce
  this usage failure. Its UID still participates in the preceding full census.
- The reason alone cannot identify the failing snapshot or value category.

Owner checks, company-adoption fences, application generation, period limits,
leases, cooldowns, CAS and success receipts are separate existing gates. This
diagnosis proposes no relaxation of them.

## Provider contract checked against primary documentation

The current [Enable Banking API reference](https://enablebanking.com/docs/api/reference/)
lists `AccountResource.usage` as optional, with `ORGA` for professional usage
and `PRIV` for private personal usage. `GetSessionResponse.accounts_data` uses
`SessionAccount`, whose documented fields are UID and identity hashes; its
published example omits usage. The reference does not document null, lower-case
or `business` as a Usage enum value.

The linked raw OpenAPI YAML could not be parsed by the browsing tool because
its content type is unsupported. This report relies on the rendered API
reference; it does not claim a separately verified nullable schema declaration.

The published adapter matches the documented field names. `createSession`
retains valid-UID account objects, `getSession` returns the validated response
without stripping extra fields, and `accounts(row)` returns the saved decrypted
JSON snapshot. No conversion from omitted usage to explicit null was found in
these paths. TypeScript's optional enum annotation is not runtime validation of
an external response. An extra live `usage` property, if supplied, is retained
and reaches the policy even though the SessionAccount type does not list it.

## Read-only evidence that can resolve the remaining uncertainty

| Available or proposed evidence | What it can establish | Limit |
| --- | --- | --- |
| Existing `bank_auto_sync_status` | Current connected/blocked state and ordinary operational timestamps | Contains no usage category |
| Existing bank status account projection | Selected flag, currency, masked label and importable flag | Does not expose usage; its `usage !== PRIV` display condition cannot distinguish null/unknown from ORGA |
| Existing failed-revalidation audit event | That an attempt failed with the canonical error code | Persists no snapshot/category or complete live response |
| Authenticated projection of saved selected usage categories | Whether a selected saved object contains omitted, ORGA, PRIV, null, other string or wrong type | Does not reconstruct the lost live response |
| Fixed diagnostic categories bound to the already generated failure | Which of the already selected saved/live observations caused this exact failure | Requires a later ordinary action; it must add no separate bank fetch |

Enable Banking's [Control Panel documentation](https://enablebanking.com/docs/api/control-panel/)
describes existing request logs and Data Insights. Logs provide request/session
metadata and related request details; the documentation does not guarantee a
complete response body. Insights provide field types, examples and population
frequency, not proof of this owner's specific response. Either may help explain
a representation, but only an actually retained matching observation can prove
the incident value. No control-panel access was performed here.

The safe diagnostic output is a bounded set of category counts, separately for
saved and live selected resources. It needs no account number, UID, identity
hash, party name, session identifier, bank credentials, unknown usage string or
hash of that string. Missing data must remain distinguishable from explicit
null and from an explicit private-account marker.

## Decision after obtaining that evidence

| Proven category/source | Appropriate next decision |
| --- | --- |
| Selected saved or live PRIV | Preserve the rejection. The owner/bank must establish the intended professional account and its authority; an owner-led correct business authorization may be needed. |
| Selected null, other string or wrong type | Preserve the rejection and establish the producer's documented meaning and the actual matching response before proposing any adapter change. |
| Saved invalid, live omitted | The saved invalid observation remains the blocker. A GET session that omits usage does not correct historical evidence. |
| Saved allowed, live invalid | The live response is the blocker; identify the actual provider representation without changing the saved account to make it pass. |
| Both selected snapshots entirely omitted/ORGA | This exact failure is inconsistent with those exact inputs. Investigate version, source/context identity and retained observation before another authorization attempt. |

An adapter normalization would widen the accepted input set if it turned
currently rejected null/unknown/private evidence into an accepted value. It is
not justified by the current observations, and is not part of the approved
diagnostic change. A new consent is appropriate when actual authorization or
account choice needs changing; this reason by itself does not establish that.

## Minimal follow-up implementation plan

Root subsequently authorized diagnostic implementation with unchanged policy.
The selected approach is the **existing error response**, privately bound to
the actual ACCOUNT_USAGE_INVALID exception after the legacy adapter has already
validated and narrowed the inventories. It avoids a new status endpoint and a
second account-selection implementation.

The intended change is limited to:

1. Fixed category counts for saved/live **selected** observations, created only
   for the existing genuine usage rejection; no input value is copied into the
   diagnostic.
2. Private provenance and a finite output shape, so forged public properties,
   getters, client arguments and unrelated errors cannot supply diagnostics.
3. Serialization through the existing bank failure/MCP response, preserving the
   same code, 409 status, acceptance predicate and ordinary request count.

Security/authorization/selection negatives must be RED before implementation,
then GREEN with meaningful positives, and the before/after acceptance results
must be identical. This report commit contains no implementation. Root handles
review, integration and any later ordinary published action.

## Pure synthetic verification

`scripts/quality8/diagnose-bank-account-usage.mjs` checks exact source hashes
before loading the published policy. It exercises 14 representations on the
saved and live sides through both strict and legacy validators (56 cases),
plus six legacy selected/unselected inventory boundaries. All 62 expected
outcomes passed: **15 accepted, 47 rejected**. Rejections retained the canonical
code and 409 status; inputs were deep-frozen and unchanged.

These are deterministic policy probes, not a count of bank accounts or live
successes. `bank-account-usage-diagnosis.json` retains the exact source/script
hashes and all synthetic outcomes. The run used direct Node 24.22.1 with the
existing test-network guard. No bank or production operation occurred.
