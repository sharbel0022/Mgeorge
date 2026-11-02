# New producer-chain synthetic acceptance

`sites/tests/seven-agent-0599-joined.test.mjs` adds seven representative cases on
the staged six-producer integration. These are separate from the older runtime
baseline test. The new fixture reuses the actual C3 transport worker, durable
SQL store and original-retention/import sink. Its C4 preview and C6 payment view
read the same SQLite workspace and retained bytes. Actual C1
`resolveInvoiceReference` / `invoiceFacts` supply the invoice reference.

The source is explicitly synthetic and test-opted-in. Worker bindings,
authentication and account-resource decoding use the established synthetic
fixture. Provider network calls throw. Every invoice/report byte is synthetic.
No remote operation, production data mutation or source registration is involved.

Coverage: exact `0599` plus independent `599`; source absence; absent current
bank-reported alias; absent shared deposit ID; wrong advertised SHA before
retention; changed retained bytes before preview; source replay and renamed
delivery; same-number supplier scope. Intake and reads preserve zero committed
allocations, unchanged invoice balances and exactly 62500 economic öre. The
read-only checks reject attempted SQL writes, write batches, R2 writes/deletes
and network calls. Both desktop and mobile SSR sections must display the bank
reference without formal OCR or a paid/verified class. SSR is not browser QA.

Command, from `sites/`:

```sh
node --experimental-strip-types --test tests/seven-agent-0599-joined.test.mjs
```

RED evidence on staged `5e6507d`: 7 cases, 4 pass / 3 fail. Exact `0599` and
`599` fail with `REFERENCE_POLICY_REQUIRED`; same-number supplier also reports
ambiguous reference/direction issues. After the C1/C4 mapper fix `7553782`
(local equivalent `0374b67`), exact cases produce `VERIFIED` C4 proposals and
fail at C6's empty intended-reference values. Supplier scope still reports
`AMBIGUOUS_INVOICE_REFERENCE`, `INVOICE_REFERENCE_POLICY_CONFLICT` and
`INVOICE_REVIEW_OR_DIRECTION_REQUIRED`. Assertions remain strict while the
coordinator integrates those fixes. These are test findings, not completion or
green-suite claims. The coordinator must rerun this file and the full required
gates on the final combined head; the test-only branch does not claim them.
