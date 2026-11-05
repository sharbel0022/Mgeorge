# SaaS contracts — proposal for Agent 8

Status: **proposed on `feature/saas-multitenant-foundation`**, not a released or deployed contract. Proposed shared edition: **`mgeorge-saas-v1`**; proposed parent integration edition: **`mgeorge-integration-v2`**. Existing bank, invoice-reference, import-job and reconciliation contracts keep their versions and financial meanings. Agent 8 must review and integrate this proposal before downstream release.

The executable shared shapes and permission matrix are in `sites/lib/company-contract.js` and `company-contract.d.ts`. A correctly shaped object is not authentication. Only a live server-side lookup of company binding, actor membership, role and versions can authorize an operation.

## CompanyContext

```ts
interface CompanyContext {
  version: 'company-context-v1';
  companyId: string;
  storageOwner: string;
  actorId: string;
  role: 'owner' | 'admin' | 'accountant' | 'viewer';
  membershipVersion: number;
  companyVersion: number;
  contextVersion: number;
}
```

| Field | Authority and meaning |
| --- | --- |
| `companyId` | Explicit company catalogue identity, selected only from current memberships. Never obtained by matching company names, bank text or invoices. |
| `storageOwner` | Immutable server-selected storage namespace. Existing Sites owner/R2/AAD and Node legacy bank owner are retained exactly. It is not the current operator. |
| `actorId` | Current authenticated person/principal. Retained separately from the company's namespace. |
| `role` | Current catalogue membership role, never supplied by the browser. |
| `membershipVersion` | Positive safe integer. Increment on role/status changes; stale work must fail. |
| `companyVersion` | Positive safe integer identifying the current enabled company configuration. |
| `contextVersion` | Positive safe integer for the actor's active company selection. Old tabs cannot silently follow a changed selection. |

The context is an immutable snapshot. Database operations recheck live authority. Explicit job contexts keep their original company independently of later UI selection, while revocation and company suspension still invalidate their authority.

`companyCacheKey(context)` encodes **all** these identity/version fields as an ordered tuple. An invoice ID, transaction ID, revision, company name or storage owner alone is not a cache key.

## CompanyMembership

```ts
interface CompanyMembership {
  companyId: string;
  actorId: string;
  role: 'owner' | 'admin' | 'accountant' | 'viewer';
  status: 'active' | 'revoked';
  membershipVersion: number;
}
```

The `(companyId, actorId)` pair is unique. Removal means revocation; the row is retained as a tombstone and its version advances. A previously issued context does not survive revocation, reactivation or role changes. Existing data remains under the company's original storage boundary when an operator is removed. The last active owner cannot be removed. Adoption of existing data requires a trusted administrative operation with a recorded verified relationship. The Sites creation endpoint can create a separate empty company for its authenticated creator; it accepts no old owner, database, bank account or document to adopt.

## CompanyAuthorization

```ts
interface CompanyAuthorization {
  context: CompanyContext;
  action: CompanyAction;
  assertCurrent: () => void | Promise<void>;
}
```

| Action | Owner | Admin | Accountant | Viewer |
| --- | --- | --- | --- | --- |
| `read` | Yes | Yes | Yes | Yes |
| `write` (invoices/import/reconciliation) | Yes | Yes | Yes | No |
| `manage_integrations` | Yes | Yes | No | No |
| `manage_company` | Yes | Yes | No | No |
| `manage_reference_policy` | Yes | Yes | No | No |
| `manage_members` | Yes | No | No | No |
| `restore` | Yes | No | No | No |

Unrecognized roles and actions deny access. No implied superuser role exists in company-facing API requests. Role permission never overrides current consent, original integrity, bank evidence, balance, currency, revision or job-lease requirements.

`assertCurrent` is an integration requirement implemented by the runtime's database-backed fence, not a client callback. A preflight check alone is insufficient after an awaited upload/provider call. A write checks authority in the same protected transaction as its effect. Ordinary reads are scoped to the selected company and rechecked before a response is published.

## CompanyDataBoundary

```ts
interface CompanyDataBoundary {
  version: 'company-data-boundary-v1';
  companyId: string;
  storageOwner: string;
  boundaryVersion: 1;
}
```

This stable binding accompanies retained/backup evidence. Record IDs and SHA-256 values can legitimately repeat across different companies, so neither may replace this boundary. Restoring a snapshot for A while expecting B fails, including when the expected namespace or hash appears similar. Namespace/company reassignment is prohibited.

Older snapshots without a company boundary remain verifiable as owner-bound historical evidence. They cannot be relabelled as a company-bound snapshot merely by supplying a new expected company. Adoption does not modify their encrypted bytes or authenticated metadata.

Background job envelopes additionally pin `actorId`, role, membership/company versions and a job ID. UI `contextVersion` is deliberately excluded from the job's stable authorization identity: switching the screen must not redirect an already queued job. A new actor, role, membership generation or company binding requires new authorization.

## CompanyReferencePolicy

```ts
interface CompanyReferencePolicy {
  version: 'company-reference-policy-v1';
  companyId: string;
  policyVersion: number;
  mode: 'explicit_only' | 'invoice_number';
  updatedBy: string;
  provenance: string;
}
```

The explicit company ID is the scope. The existing runtime configurations (`app_settings.invoice_reference_policies` in Node and `workspace.company.invoiceReferencePolicies` in Sites) remain the compatible storage representation within each verified company boundary. `resolveCompanyReference()` provides a typed adapter for new consumers; a policy for another company is rejected before derivation.

Fresh companies have no implicit M.George policy. Explicit-only behavior is the default. Invoice-number derivation preserves the entire string (`0599` remains distinct from `599`) and is blocked by contradictory explicit invoice/original evidence. A policy never rewrites observed bank references, fabricates OCR agreement or bank origin, or authorizes an allocation. Formal OCR remains subject to the existing independent bank-agreement rules.

## HTTP selection and client isolation

```ts
GET /api/companies
// {
//   version: 'company-context-v1',
//   companies: [{id, name, role, membershipVersion}],
//   activeCompanyId, contextVersion, context
// }

POST /api/companies/active
// Request: {companyId, contextVersion}
// Response: {context: CompanyContext}
```

Unbound legacy mode returns `{version:'company-context-v1', companies:[], activeCompanyId:null, contextVersion:1, legacy:true}`. This is an explicit compatibility state, not a fallback for a failed membership check. A bound actor with no remaining access is denied.

If the selected membership is revoked while another membership remains, the directory returns `selectionRequired:true`, the authenticated `actorId`, permitted companies, the current `contextVersion`, and `activeCompanyId:null`. It returns no `context` or financial workspace. The client displays only the company selector. Its selection POST sends the target ID and expected version without old-company headers; the server independently verifies the target membership. Successful selection returns the new context and triggers a full page reload. This avoids both reopening legacy data and trapping a valid administrator in a revoked company.

Company requests pin `X-Company-Id` and `X-Company-Context-Version`. Original links use `companyId` and `companyContextVersion` query selectors because normal downloads do not attach custom headers. Duplicated, conflicting, malformed or unauthorized selectors fail closed. Payload values never establish company identity.

Sites responses retain `Cache-Control: private, no-store`; Node responses retain `Cache-Control: no-store`. Both prohibit response storage. Company context conflicts are distinguishable from normal workspace revision conflicts by `code: 'COMPANY_CONTEXT_STALE'` and/or `X-Company-Context-Stale: 1`.

The client loads the directory before rendering the financial workspace, binds every same-origin API request to a fixed context, and rejects delayed response/body consumption after invalidation. Switching blanks the workspace and reloads the document, discarding forms, details, demo snapshots, queued fetches and component caches. Focus/visibility and back-forward-cache return require revalidation. Browser behavior complements server enforcement; it does not grant access.

Node exposes directory and active selection only; its existing local/administrator authentication remains in place. Sites additionally exposes `POST /api/companies` (`{name,confirmEmptyCompany:true}`) and `POST /api/companies/memberships` (`{actorId,role,status}`) to its authenticated company owner. Creation does not claim legal ownership of an existing business. Membership mutation is not available to admin/accountant/viewer. Existing unbound Sites workspaces must be explicitly verified and bound before their owner creates another company, so creation cannot hide their legacy data. Node applies the same prerequisite to its legacy administrator when the unbound database contains business records, originals, consent or import history; trusted provisioning fails with `company_legacy_binding_required` and status 409 until the verified binding exists.
