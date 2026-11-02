# C1/C4 reference policy integration

This focused integration applies to C1 PR #27 at
`5fada91427ee49d98897802eeb7a2aeede73fbf7` and C4 PR #28 at
`58e40a21eb459e2191d7b19b458326459a09e5d6`. It supersedes the original
C4 handoff's pending company-policy activation gate only. Bank-account and
report-queue producer gates remain independent.

The existing C1 configuration selector now has a pure public export,
`resolveInvoiceReferenceConfiguration`. Both C1 invoice decisions and the C4
mapper use that selector, including its validated company scope, built-in
M.George rule when configuration is omitted, and explicit `[]` disable switch.
There is no second stored policy or client policy parameter. Only a selected
customer `invoice_number` / `exact` policy maps to the C4 contract; unsupported,
invalid, absent and disabled configurations remain blocked.

Node resolves `invoiceReferenceContext(db)` inside the existing read savepoint.
Sites resolves the same configuration from the cloned owned workspace used by
its adapter. Both GET routes inherit this trusted mapping, retain their existing
authentication and staleness checks, and bind policy provenance and workspace
configuration into the snapshot. Explicit server `referencePolicy: null` still
holds a preview. C1 `REVIEW` remains invoice intent only; C1 `BLOCKED` remains a
hold. Neither policy status establishes bank facts.

Integration review reproduced a missed ownership conflict: invoice `00043`
retained an original number ` 00042 ` while another invoice owned `00042`.
C1's comparison recognized the conflict; C4's raw-string census previously
allowed a verified proposal against the second invoice. The bridge now retains
the raw claim and adds C1's bounded canonical comparison identity for ownership
reservation, including held invoices. It removes only ordinary exterior
spaces; it never repairs zeroes, separators, Unicode, controls or numeric
inputs. Invoice fields and bank observations are not rewritten.

The combined follow-up scopes ownership by cashflow direction, preserving
same-direction held/original conflicts while separating unrelated payable
claims. Padded current invoice numbers remain conservative review cases;
original fields are preserved. These cases do not authorize a financial write. Existing allocation history and balances stay
unchanged, and every preview retains `changed: false`, `writesAllowed: false`
and `approvalRequired: true`.

The added shared regressions run in both runtimes. They cover supported and
disabled company configuration, the reproduced original-ownership conflict,
and negative normalization cases. Node and Sites route tests use real isolated
storage, forbid provider calls and verify unchanged state. Focused verification
passed 172 Node cases and 148 Sites cases, with zero failures or skips. Node's
syntax check passed for 128 files. Sites' standard check cannot run against
the temporary dependency symlink because its existing minimatch guard rejects
symlinked dependency roots; the integrator must run that gate with real installed
directories. Any combined-suite receipt belongs to the integrating branch; no real
invoice, allocation, payment, message or production data is used here.
