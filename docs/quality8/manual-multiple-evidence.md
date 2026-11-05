# Explicit manual multi-invoice allocation: implementation evidence

Date: 2026-11-05. Initial UI checkpoint: `98fb9a122ea5ccc2049321b22e41fe7ca6679587`;
the transport/lifecycle follow-up described below is required with that checkpoint.
Implementation and all measurements used synthetic local fixtures. **No customer
payments, bank calls, financial production writes or outbound messages were made.**
This document assigns no quality score and does not certify a real bank payer.

## Concrete gap and resulting behavior

The independent baseline review, committed as
`df315c0f4bc98f3bcf18f4ecb85169406cd266dc`, found that Node `/api/allocations` and
Sites `match.create` required every preserved bank reference to identify the one
selected invoice. A payment with two or three explicit references could not be
allocated by repeating that command. Node's UI nevertheless told the user to
repeat partial matching. Sites splitting followed by separate matches could
leave partially committed progress. The existing C4 proposal correctly remained
`REVIEW` and refused automatic execution.

The new operation reviews and approves the entire explicit manual vector. Its
entry is available in the existing bank transaction detail in both applications,
adjacent to the Sites C4 proposal. The incorrect repeat-one-invoice advice is
removed. Every exact reference and row amount is displayed, together with
original links, each invoice's remaining debt and the payment remainder. Editing
after review consumes that review; the user must request another server review.
Only the final separately checked approval can submit the financial operation.

Recorded outcomes are labelled **Manuellt registrerad fördelning**. Neither the
new command nor its receipt grants automatic `VERIFIED` history. Current balance
and bank evidence checks remain distinct from a historical manual receipt.

## Boundaries enforced by the server

- Two to twenty distinct receivable invoices, with exact ownership of every
  relevant preserved bank reference across the complete current-company invoice
  census, including closed and conflicting claims. Leading zeroes are preserved.
- The existing C4 source assessment is reused conservatively. Missing bank
  payer, unsupported payer/customer relationship, absent originals, unknown
  reference, bad OCR, competing owner/payment, reversal, non-economic report and
  account/current-consent problems remain closed. There is no `referenceCorrection`
  or general `REVIEW` override.
- Whole safe-integer minor units only, positive allocation on every referenced
  invoice, no extra/omitted row, no balance/debt overflow, and no existing
  invoice/payment pair. An arbitrary partial top-up is outside this operation.
- Underpayment consumes the whole available payment and shows invoice debt.
  Overpayment settles all referenced invoices and shows bank money remaining.
  Leaving both bank money and invoice debt in the same vector is rejected.
- Review binding includes owner/company/actor context, revision, whole exact
  vector and note, full original/source version evidence, bank transaction,
  current account/consent, invoice identity/reference/currency/direction/total/
  remaining debt and the full reference census. Type tags prevent canonical
  collisions between sentinels, scalar values, arrays and objects.
- Commit derives fresh evidence again. Node compares it under `BEGIN IMMEDIATE`
  without asynchronous gaps before commit. Sites uses one D1 batch/CAS and
  same-batch predicates for the exact workspace payload, original metadata,
  quoted consent and bank source snapshots.
- Allocations, invoice updates, one audit record and the durable idempotency
  receipt commit together. A second-row failure, audit failure, stale revision,
  changed original, revoked consent or competing request rolls back the vector.
- Owned historical receipts can be replayed after consent revocation. Reuse of
  the same request ID with a changed intent is rejected. Current user/company
  authorization is still required to read the receipt.

## Lost-response correction discovered by independent review

Recovery independently reproduced a genuine outcome-classification defect on
`8aa48fc`: a Sites batch committed, its response was lost, and an immediately
subsequent receipt read temporarily returned null. The route emitted an
unclassified HTTP 400; a following receipt read returned 404, although both
allocation rows existed. A later exact retry recovered the existing receipt.

Commit `798f8783aaee9155b1e65db73fc51f68119c6894` gives unclassified failures after
the batch call an explicit `503 MANUAL_OUTCOME_UNKNOWN` when the receipt cannot
yet establish the outcome. Known fence failures and current auth boundaries are
preserved. Two negative regressions first failed with actual HTTP 400, then
passed for both a real committed batch and a failure before commit.

The browser also tolerates earlier/unclassified HTTP 400, 500 or 503 responses.
It persists the exact intent and request ID before POST. A lost reply, invalid
success, unavailable receipt or subsequent receipt 404 retains that request;
retry sends the same body and ID. Only an initial, explicitly classified manual
rejection, with no preceding uncertain attempt and a separate owned receipt-404,
can clear the quote for a new review. Unknown outcomes never become a successful
or failed financial label merely because a response is missing.

## Focused verification

All runs used Node **v24.22.1** directly and existing isolated test dependencies.
The initial combined implementation suite on `98fb9a1` passed **156/156**, no skips,
in **15.81 seconds**. That suite exercised APIs and clients separately, and missed
the real Node revision representation at their boundary. It was insufficient to
claim that the complete Node UI flow worked. The follow-up connects actual
producer responses through the real clients and adds ownership/lifecycle cases.
The combined suite now passes **170/170**, no skips, in **17.68 seconds**:

| Boundary | Passing cases | What is exercised |
|---|---:|---|
| Shared pure policy, Node and Sites entrypoints | 68 | 2/3 exact vectors, under/overpayment, 27 negative policy cases per entrypoint, type-distinct binding |
| Actual Node HTTP/SQLite and Sites routes/D1-style atomic SQLite fixtures | 44 | Complete commit, rollback, original/consent/census changes, simultaneous same/different requests, historical replay, lost replies, actual producer-to-client flows |
| Shared browser controller, ESM and shipped classic adapter | 45 | No write on discovery/review, frozen vector, mandatory confirmation, strict real revision types, invalid transport, storage failure, stable request ID, recovery and ownership across old/new controllers |
| Actual Node dialog templates/events and Sites rendered view/events | 13 | Reachable entry, 2/3 rows, Swedish odd cents, original links, under/over remainders, explicit checkbox, edit/review transitions, manual history |

The pure policy cases use the same implementation through both entrypoints;
they are parity tests, not two independent bank confirmations. UI event fixtures
execute shipped code with synthetic DOM/transport boundaries; they are not a
claim of authenticated production-browser validation.

A separate pre-follow-up focused regression run passed **103/103** in **3.04
seconds**. It contains the original 46 client/UI cases plus 57 existing Node
bank/final-UI and Sites C4-proposal cases. These overlap with the combined suite;
do not add the counts.
TypeScript (`--noEmit --incremental false`), shipped JavaScript syntax checks
and `git diff --check` also passed.

The initial implementation RED runs were: 64 missing-policy failures, 15 missing
Node API cases, 16 missing Sites API cases, two missing browser-controller test
modules, the absent Sites UI test module and five failing actual Node UI cases.
Later targeted RED regressions caught canonical type collisions and the two
unclassified-outcome cases before their fixes.

### Independent UI findings and required follow-up

The independent UI reviewer found two Important integration/lifecycle defects on
the unpublished `98fb9a1` checkpoint:

1. Node's real API returns a 64-character lowercase SHA-256 snapshot revision;
   Sites returns a safe integer workspace revision. The original client accepted
   only an integer. It rejected genuine Node discovery/quote/receipt responses
   despite the separate HTTP and synthetic client suites passing. The transport
   now accepts only these two canonical forms, with strict type/value equality
   between discovery and quote. Invalid, coerced, uppercase, truncated, fractional
   and unsafe revisions remain rejected. No producer revision or API fixture was
   changed to fit the client.
2. An older controller could clear session storage before checking whether its
   response was still active. After its original receipt had been recovered and
   the operation normally undone, a new pending approval could occupy the same
   scope; the old late response then erased the newer recovery ID. Success now
   checks the controller token before cleanup, and cleanup removes storage only
   when its entire persisted pending record exactly matches the controller's
   owned record. Historical reads own no pending record and cannot remove one.

The revision regression run initially failed **3 of 8** cases, including a real
Node HTTP response through the shipped classic client. The lifecycle regressions
initially failed **6 of 6** across both client builds. After the narrow fix all
**14 new cases pass**. They include the actual Node discovery → review → explicit
confirmation → commit → receipt chain with an unchanged hash revision, the
actual Sites route chain with its integer revision, historical reads after
consent revocation, old disposed and still-active controllers, and a delayed
history read alongside a new uncertain approval.

These findings were caught before publication. They demonstrate why the earlier
separate fixture tests were not adequate proof of the complete UI integration.
The follow-up still requires independent review of its exact commit before
release; server financial/evidence gates were not relaxed.

### Reproduce the combined implementation suite

```sh
NODE_ENV=test /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --import ./scripts/saas-test-isolation.mjs --test --test-reporter=tap --test-concurrency=1 \
  test/manual-multiple-allocation.test.js sites/tests/manual-multiple-allocation.test.mjs \
  test/manual-multiple-allocation-api.test.js sites/tests/manual-multiple-allocation-api.test.mjs \
  test/manual-multiple-client.test.js sites/tests/manual-multiple-client.test.mjs \
  test/manual-multiple-ui.test.js sites/tests/manual-multiple-ui.test.mjs
```

## Local policy measurement

`scripts/measure-manual-multiple-policy.mjs` measures the unchanged C4 source
preview, new manual policy and full canonical binding on generated data. Each
size uses five warmups followed by twenty samples. Results from `98fb9a1` are in
`manual-multiple-measurement.json`.

| Explicit rows | Whole-company invoice census | Median | p95 |
|---:|---:|---:|---:|
| 2 | 2 | 0.84 ms | 1.12 ms |
| 3 | 1,000 | 31.29 ms | 34.21 ms |
| 20 | 1,000 | 36.42 ms | 38.14 ms |
| 20 | 5,000 | 174.51 ms | 205.85 ms |

All 100 measured/warmup positive vectors retained C4 `REVIEW`; none acquired an
automatic `VERIFIED` status. This is a local policy/binding measurement, **not**
bank latency, R2 performance, D1 service latency or production capacity proof.
The 20-row upper bound is exercised in this measurement; the API scenarios focus
on realistic two- and three-invoice payments plus negative transaction cases.

## Storage and external limitations

Original bytes are reread and hash-checked at review and commit. Sites captures
R2 object version/etag from that same verified byte read when available; replacing
an object version with unchanged bytes invalidates the earlier review. When the
storage API exposes neither, the bound value is null and the existing owned key,
byte length/hash and D1 original metadata remain required. No generic metadata
stub makes a previously invalid original valid.

D1 can atomically fence its own workspace, original metadata, consent and audit
rows. **It cannot promise a cross-store atomic fence against an out-of-band R2
byte overwrite after the final byte read.** Existing immutable-original storage
discipline is therefore a material boundary, not an inferred D1 guarantee.

The operation reuses supported source adapters. It does not create a new source
of bank payer identity, turn a manually typed payer into bank evidence, make an
unregistered invoice eligible, or add unsupported Sites customer-relationship
evidence. It does not settle the unresolved live `0599` evidence case. No real
account, consent, invoice or allocation was changed to make these tests pass.

Browser recovery uses session storage. If the browser cannot persist the pending
request, it blocks the economic POST and explains the recovery-storage problem.
Current company authorization protects the server receipt; a pending browser
record is never treated as permission to read another company's financial data.

Root owns final integrated test adapters, complete CI, authenticated browser QA
and release. Independent review is recorded separately; this implementation
report does not substitute its own test counts for that review or for real bank
evidence.

## Implementation commits

1. `0cf3695b44f51bcd9e0abb40b58765fdd10d5308` — explicit manual policy and design.
2. `4d71982b756e62ff29ed05dc97144bae013f0ae2` — atomic Node API and receipt.
3. `851d702c9ccf557eb3a3ffa8b550f8211c5d9e19` — type-distinct review binding.
4. `8aa48fc12df52e524f6a5fd3ab483b6c4d7707d2` — Sites source fences and receipt.
5. `798f8783aaee9155b1e65db73fc51f68119c6894` — explicit unknown batch outcomes.
6. `98fb9a122ea5ccc2049321b22e41fe7ca6679587` — actual Node/Sites approval UI.
