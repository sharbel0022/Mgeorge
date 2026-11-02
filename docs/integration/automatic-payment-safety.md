# Active automatic payment eligibility

The existing Node and Sites reconciliation engines now require an exact full
remaining invoice payment before creating an automatic allocation. Partial and
excess amounts stay in review. Explicit manual allocation remains available and
existing allocations and balances are preserved.

M.George policy-scoped customer invoices additionally require an intact retained
invoice original. Node shares the registered-document relation and SHA-256
predicate with its read-only preview, checked inside `BEGIN IMMEDIATE`. Sites
checks owned original bytes during each production preflight and passes verified
invoice IDs only in request-local evidence. Stored positive proof flags cannot
authorize a new automatic allocation. Generic reviewed manual invoices retain
their existing document semantics.

Imported C3 reports also consume the shared read-only source evidence mapper.
Revoked or replaced source authorization, missing reports, unfinished jobs and
conflicting retained report identities hold new automatic allocations even when
the original imported financial row has not changed. Owner-scoped source holds
also prevent learned payer reuse. Unlinked manual or legacy originals acquire no
new C3 requirement. Sites binds the exact owned source/job rows and the complete
linked report identity census in the same D1 batch as its workspace CAS and
financial audit, so source changes after preflight roll back the entire write.
An explicit manual allocation may review a known source issue; the route derives
its allocation IDs from the applied command and still binds that source snapshot.
No new financial engine or schema migration is introduced.

Runtime regressions call the active allocators and production preflight, covering
missing, altered and empty originals, partial/excess money, exact full and
remaining payments, retained C3 conflicts and owner isolation. Existing tests
about consent, duplicate bank originals and learned payer identity now retain
explicit synthetic invoice originals. Tests about already confirmed partial or
excess message balances use explicit manual allocations; they no longer depend
on automatic settlement of an amount that requires review.
