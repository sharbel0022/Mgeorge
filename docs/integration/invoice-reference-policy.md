# InvoiceReferencePolicy v1 — Agent 1

## Delivery scope

Branch: `feature/mgeorge-invoice-reference-policy`.
Implementation started at `73662187cddf9a5c504dea9bd8a1288bd929bc51` and was
fast-forwarded through released contract main
`b65273500c214a4e16b880e3840dac90d8bd7401` to the latest coordinator checkpoint
`12c9868606a0a45b31b722ddee8f897541687e64` before publication. These add
integration documentation and a six-case synthetic 0599 acceptance test; runtime
code is unchanged from the starting base.
The integration lead owns merge and Sites deployment. This branch does neither.

The user-approved business rule is specific to **M.George Vitvaror AB's own
customer invoices**: invoice `0599` has intended payment reference `0599`, and
invoice `0001` has intended reference `0001`. Identifiers remain text. This does
not establish a bank OCR agreement, an actual reported OCR field, or a verified
payment. No real invoices, customer messages or bank payments are used as tests.

## C1 decisions proposed for integration review

This PR is the concrete C1 proposal requested by the shared
[`mgeorge-integration-v1` contract](README.md). Two choices need explicit approval
before dependent C4/C6 merges; they must not be inferred from the draft C1 prose:

1. **Default activation for the specifically authorized company.** Omitted
   policy configuration selects the built-in rule only for the complete
   configured name `M.George Vitvaror AB`. An explicit `[]` disables policies.
   Unconfigured other companies and supplier invoices retain their existing
   reference behavior. Thus legacy M.George workspaces get the requested business
   rule as a read-time projection, with no data migration; other legacy workspaces
   do not get a global invoice-number rule. This is an intentional refinement of
   C1's blanket legacy-default wording. Name comparison permits ordinary outer/
   repeated spaces and case only, never substring or punctuation heuristics.
2. **Conflicting declarations are retained separately from business intent.**
   Invoice `0599` with explicit reference `0600` projects intended reference
   `0599`, declared reference `0600`, and `BLOCKED`. Neither value is overwritten;
   no match is authorized. The intended field describes the company's rule, not
   an accepted replacement for the explicit declaration. This makes the user's
   rule and the contradictory evidence independently reviewable instead of
   presenting `0600` as the company's accepted intended reference.

Policy provenance is the user-approved company rule, identified by
`mgeorge-own-invoice-number-v1` and the contract version below. It is not a bank
statement. The configured company name is workspace business configuration;
historical invoices do not have immutable issuer IDs. Counterparty organization
numbers are never used as the issuing-company identity.

## Canonical module and public types

Canonical implementation: `sites/lib/invoice-reference-policy.js`.
Declarations: `sites/lib/invoice-reference-policy.d.ts`.
Node imports the same implementation through `src/invoice-reference-policy.js`.
The module is pure and performs no I/O or mutation.

```ts
type InvoiceReferencePolicy = {
  version: 'invoice-reference-policy-v1';
  id: string;
  companyName: string;
  direction: 'customer';
  referenceSource: 'invoice_number' | 'explicit_reference';
  matchMode: 'exact';
};
type InvoiceReferenceInput = {
  invoice_number: string;
  reference?: string | null;
  direction: string;
  original?: {
    invoice_number?: string | null;
    reference?: string | null;
    issuer_name?: string | null;
  } | null;
};
type InvoiceReferenceContext = {
  company?: { name: string; organizationNumber?: string };
  policies?: InvoiceReferencePolicy[];
};
type InvoiceReferenceDecision = {
  version: 'invoice-reference-policy-v1';
  policyId: string | null;
  applies: boolean;
  status: 'REVIEW' | 'BLOCKED';
  invoiceNumber: string | null;
  intendedPaymentReference: string | null;
  declaredPaymentReference: string | null;
  source: 'invoice_number_policy' | 'explicit_invoice_reference' | 'none';
  issues: string[];
  reason: string;
};
```

Exports:

- `resolveInvoiceReference(invoice, context)` validates unknown runtime inputs
  and returns the decision above.
- `strictInvoiceReferenceMatch(actual, expected)` compares complete bounded text
  identifiers. It never coerces numeric inputs or removes separators/zeroes.
- `matchesInvoiceReference(decision, actual)` requires an applicable, nonblocked
  decision and an exact intended-reference match.
- `validateInvoiceReferencePolicies(policies)` validates and copies the entire
  policy list; duplicate IDs/company scopes, sparse entries and invalid modes
  fail closed.
- `INVOICE_REFERENCE_POLICY_VERSION` and `MGEORGE_INVOICE_REFERENCE_POLICY`.

`REVIEW` means a usable intention requiring separate payment checks, not a
payment approval. `BLOCKED` means missing, invalid or contradictory input.
The resolver never returns `VERIFIED`. Bad outgoing-company configuration cannot
fall through to permissive legacy matching. Other valid company names, including
Node's existing accepted maximum of 240 characters, remain outside the built-in
scope. Invoice/reference identifiers are limited to 100 characters and retain
letters, digits, slash, underscore and hyphen exactly; only ordinary exterior
spaces are ignored for comparison. Raw observations are retained separately.

## Persistence, endpoints and compatibility

No new external API endpoint, dependency, database table or migration is added.
`State.schemaVersion` remains `1`. All storage additions are optional and
serialization/backup compatible.

| Meaning | Node | Sites |
| --- | --- | --- |
| Policy configuration | `app_settings.data.invoice_reference_policies` | `State.company.invoiceReferencePolicies` |
| Configuration write | Existing settings PATCH forwards `invoice_reference_policies`; `saveSettings()` validates before write | Existing `settings.save` command accepts `invoiceReferencePolicies`; normal settings edits preserve it |
| Read projection | `listInvoices()` and existing invoice/reconciliation API consumers receive `referencePolicy`, `intendedPaymentReference`, `referencePolicyIdentifiers` | `invoiceFacts()` exposes the same policy/intention plus `referencePolicyDirection` and ownership identifiers; payment verification and private MCP invoice projections carry policy/intention |
| Original reference observations | Read from every already-linked document's stored extraction; no backfill write | New `Invoice.referenceOriginal` stores interpreted invoice number/reference/issuer name; raw text values retained through subsequent edits |
| Retained payment observations | Current typed evidence and `raw_bank_data` are compared with the persisted extractor profile | `invoicePolicyPaymentReferences()` retains current, original and detail candidates despite manual corrections; internal engine inputs add `reference_policy_values` and `reference_policy_invalid` |
| Historical monetary fields | Stored invoices, `reference`, bank rows and allocations unchanged | `number`, legacy `ocr`, bank originals, allocations, credits and balances unchanged |

The legacy Sites property `ocr` is an invoice declaration, not proof that a bank
reported formal OCR. The intended reference is never copied into this field,
`bank_transactions.reference`, `Transaction.payerReference`, actual bank OCR or
provider payloads. Existing typed bank reference extraction, provenance and OCR
checksum checks remain authoritative. A real OCR candidate with an invalid
checksum stays blocked even if its digits match the intended invoice reference.

New manual file/text imports retain reference observations in their editable
form projection. A later field edit or pasted-text reinterpretation cannot erase
the first observation. A failed new file read clears stale unsaved observations
and the review checkbox. An existing policy-scoped invoice with a captured
snapshot cannot swap its document ID behind that snapshot. Sites Gmail
registration selects the current `document_jobs` extraction as a whole, or the
stored Gmail extraction when no current interpretation exists, independently of
editable submitted fields. The exact extraction and workspace revision are
rechecked at the registration write boundary. Automatic registration stops on a
blocked decision. Manual registration can retain the invoice for review, but
cannot authorize a subsequent unsafe allocation.

Browser/OCR snapshots are interpretation observations under the existing manual
review model. They are not independent proof of the invoice's business content.
Existing file ownership, original hash, account/consent and manual review guards
continue to apply. Historical Sites invoices without a captured snapshot are
not reparsed or silently backfilled by this change. Their preserved number and
explicit reference can still establish a conflict; absent original semantics
are not invented. A future controlled reinspection workflow remains separate.

## Matching and financial boundaries

The existing reconciliation and allocation engines consume the policy. There is
no second payment or reconciliation engine. Both runtime rule versions are
`invoice-reference-policy-2026-11-02.2`, reflecting changed reference authority
and automatic payment eligibility;
this version does not upgrade old bank evidence or claim byte-identical engines.

Every policy-scoped payment reference must match the complete intended string.
`599`, `00599`, `059`, `05990`, `05-99`, `0599/1`, combined numbers, unsupported
Unicode lookalikes and numeric inputs do not become `0599`. Existing source-aware
parsers may identify a labelled reference before this comparison; the policy
itself does not strip labels or repair source data.

The ownership census includes open, closed, unreviewed and conflicted customer
invoices. Their invoice numbers, declarations and preserved original identifiers
reserve ambiguity even when their policy is blocked, and also for configured
`explicit_reference` policies. These reservation identifiers never authorize a
match. Supplier invoice numbers occupy a different scope for an active customer
policy; generic issuers keep their existing census behavior.

A payer/amount similarity, a manual reference correction, or a previously green
interpretation cannot bypass a policy conflict. The existing account, consent,
original, payer, currency, direction, balance, duplicate and atomic write checks
still apply. No AIS/Bankgiro amounts are combined or recounted by this feature.
Historical allocations remain recorded, with blocked/reference-review evidence
shown separately. New allocations are blocked; historical money is not undone. Node withdraws the current verified/absence
projection on a blocked policy while preserving recorded paid/remaining amounts.

Customer-message preparation uses the intended reference and strict scoped
comparison. A blocked policy permits only a neutral confirmation draft; old
unsafe drafts become stale and cannot pass the existing approval boundary.
These changes do not send messages and do not add transport authorization.

Private MCP registered matches and bank query comparisons honor active policy
scope and expose policy/intended fields as read-only projections. Original-file
candidate discovery remains an explicitly unverified review proposal owned by
C4; this PR does not convert that search into invoice or bank proof. Agents 4/6
must consume `referencePolicy.status` and must not treat `REVIEW`, a candidate,
a recorded monetary status, or `matchesInvoiceReference()` alone as VERIFIED.

`BankAccountEvidence`, `BankTransaction`, `BankgiroReport`, `IndividualPayment`,
`PaymentReference`, `ReportDepositRelationship`, `ReconciliationDecision` and
`ImportJobStatus` retain their existing source semantics. Agent 1 adds the C1
projection and internal guards only; their owning agents control other contract
changes. Shared-file changes in this PR are explicit integration dependencies.

## Reusable synthetic regression coverage

`test/helpers/invoice-reference-policy-cases.mjs` registers the same behavioral
cases for Node and Sites. Agent 4 can import `registerInvoiceReferencePolicyTests`
and supply its test/assert functions plus the canonical exports. The fixture
contains no production customer, invoice registration or payment operation.

Additional runtime tests cover exact/wrong references, separate companies and
supplier scope, duplicate and closed owners, explicit-policy aliases, original
conflicts, stale interpretations, manual-correction bypasses, unchanged balances,
read-only API/MCP results, draft blocking and encrypted backup/restore round trips.
Node exercises real isolated SQLite and localhost HTTP boundaries. Sites tests
use isolated SQLite with the existing D1/R2 boundary fixtures and real domain
commands, parser and backup crypto.

Legacy regression fixtures that deliberately require separate invoice/OCR
identifiers now name a generic synthetic issuer. Existing assertions and bank
values are preserved. The default M.George policy is covered independently;
fixtures do not globally disable the feature to obtain green results.

## Verification receipt and continuation

Focused RED/GREEN evidence and independent review are complete for the core
policy, registration, manual correction, backup and display changes. Recorded
passing groups overlap and must not be added as unique tests:

- Shared Node policy: 49 cases; Sites policy: 48 cases.
- Sites policy/integration/manual-import combined group: 86/86.
- Sites original-registration/manual-import/backup group: 101/101.
- Sites payment verification/core integration/manual-import group: 109/109
  before the later retained-paste and minor compatibility tests.
- Sites customer-message suite: 54/54, including 11 new scoped regressions.
- Five legacy compatibility groups: 476 passing executions, with unchanged
  existing assertion bodies outside the explicitly added regression tests.
- Node scoped compatibility: 219/219 before later independent-review hardening;
  fresh post-review Node targeted group: 97/97 before the final backup/name test.

Final whole-suite/check/build/CI receipts are recorded in the delivery report and
PR. Root dependency audit passed with zero vulnerabilities. Sites' high-severity
audit gate passed; the existing 16 moderate lint-tool dependency findings remain,
with unchanged lockfiles and the repository's exact minimatch mitigation gate.
No dependency upgrade is included in this reference-policy PR.

- [x] Read current main and prior integration reports; isolated feature branch.
- [x] Pure policy, declared TypeScript contract and shared RED/GREEN cases.
- [x] Node/Sites integration, strict allocation guards and no-rewrite regressions.
- [x] Reproduce and fix independent review findings in original/reference paths.
- [ ] Final frozen-tree gates and PR publication receipt.

The first sandbox baseline run was stopped because local listeners were denied;
an early unrestricted baseline was also stopped while the shared host was
saturated. Neither aborted run is reported as a passing suite. Final functional
runs use permitted local execution; no production application, bank or mail
service is invoked. Git transport works in that execution mode, and the branch
is rebased only by a fast-forward to the documentation/test-only current main above.
