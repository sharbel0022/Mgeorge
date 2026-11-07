### Spec Compliance

- ✅ **ADDRESSED:** the duplicate-charge finding is fixed for the reviewed, unreleased implementation. `sites/lib/openai-invoices/integration.js:173` derives the new durable key from exact model and original/company context; review date, approval reference, source, prices, limits and built-in/custom representation cannot change it.
- ✅ Historical built-in reservations and completed receipts remain protected: `sites/lib/openai-invoices/integration.js:176-179,189-196` reads the historical alias and passes it into reservation; `sites/lib/openai-invoices/audit-store.js:53-57,82-86` atomically checks both IDs alongside both budgets and preserves D1 owner filters.

### Strengths

- `test/openai-invoice-model-replay.test.js:19-28`: real SQLite and D1-query execution cover failed receipt persistence and completed receipt reuse across each metadata, price and limit change, including reopening the store.
- `test/openai-invoice-model-replay.test.js:29-42`: historical built-in receipt/reservation behavior and competing alias-aware reservations are covered.
- `test/openai-invoice-model-replay.test.js:44-48`: alternate-ID lookup retains D1 owner isolation.

### Issues and Precise Limits

- No remaining blocking finding in this fix diff.
- Deployment limitation: `sites/lib/openai-invoices/integration.js:176-178` can reconstruct only the historical profile alias represented by the available registry/current custom contract. It cannot discover an already-persisted pre-fix custom key after its original contract has been replaced. The reports explicitly identify the affected custom-contract implementation as local and unreleased; therefore this does not block the present correction. If that prerequisite changes, migrate or fence old custom reservations before activation.
- Mixed-version limitation: `sites/lib/openai-invoices/audit-store.js:53-54,82-83` protects callers using the new two-ID protocol. An old process that only knows the legacy ID can still insert that ID after a new process inserts the canonical ID. The new concurrency test correctly covers two alias-aware callers, not simultaneous old/new software. Production activation should exclude concurrent old AI consumers during this identity transition.

### Assessment

**Task quality:** Approved for the reviewed local implementation and controller integration; original finding **ADDRESSED**.

**Reasoning:** The fix directly removes mutable profile data from cost identity and preserves known legacy receipts/reservations without weakening atomic budgets or tenant scope. Reported focused validation is 94/94 Node/D1 and 28/28 Sites; no new concrete doubt requires another suite run.

### Checks

- Read `task-2-fix1-review.diff` once and the appended round-one implementation/test report. Reviewed only the original finding and new control-flow/SQL changes.
- No additional code reads, tests, builds, provider requests, implementation edits, git operations or agents.
