# Company bank consent

This document describes the company consent work on `feature/saas-bank-consent`, based on `14a042a`. It covers the existing Node and Sites bank integrations, their shared authorization policy, and the remaining dependencies before production acceptance. The implementation uses Enable Banking and the existing routes, stores, encryption and import controls. It does not introduce a second bank integration or a separate BankID service.

## Security boundary and current company model

Four decisions must remain separate:

1. **Application identity:** the authenticated person may use this application session.
2. **Application company access:** the server permits that actor to manage the selected workspace company's bank connection.
3. **Bank consent:** the bank/provider authorizes the requested read access to the specific accounts for a bounded period.
4. **Corporate account authority:** trusted bank/provider evidence ties those accounts to the intended company and the authorized access context.

BankID identifies a person. A successful BankID step, a business login, `psu_type: business`, an account's `ORGA` usage, a person identification hash, or a company name typed into the application does not independently prove corporate representation or account ownership. An application owner role is not proof of legal signing authority.

The baseline application has an owner workspace with one company. It does **not** have a released multi-company membership registry. The current server resolver returns `companyId = workspace:<authenticated actor>`, `storageOwnerId = <authenticated actor>`, `role = owner`, and `membershipVersion = legacy-owner-v1`. An explicitly supplied company ID must equal that server-resolved ID. Omitting `companyId` resolves the same company; it cannot select a weaker authorization mode.

The replacement seam for Agent 1 is `bankCompanyContext` in [Sites store](../../../sites/lib/banking/store.ts) and the [Node adapter](../../../src/bank-consent.js), together with the shared `CompanyBankContext` contract. A future membership adapter must resolve the active actor/company relationship from authoritative server data, supply the correct storage owner and membership version, and enforce management versus read access on every relevant operation. The policy understands owner/admin/member/viewer roles, but this change does not create or claim an underlying role database. Storage ownership, existing connection lookups and commit predicates must be integrated before enabling multiple companies.

**Every newly started authorization is company mode**, including requests that omit `companyId`. Existing persisted connections with no consent metadata retain the explicitly unverified legacy compatibility path. This exception does not cover new connections or unfinished pre-migration redirects: a callback without bound company context is rejected before code exchange and must be restarted. Sites reports `CONSENT_RESTART_REQUIRED` for that case. A client cannot request `mode: legacy` or submit its own owner or corporate authorization object.

## Contracts and persistence

The source of truth for the shared types is [bank-consent-policy.d.ts](../../../sites/lib/bank-consent-policy.d.ts); validation is in [bank-consent-policy.js](../../../sites/lib/bank-consent-policy.js).

| Model | Meaning and important fields |
| --- | --- |
| `BankConsent` | Versioned company/actor/membership binding, bank and country, requested/granted read scopes, account UIDs, effective expiration, lifecycle state and corporate authorization. The legacy mode exists for classification of already persisted connections. |
| `ConsentState` | Domain states: `pending_authorization`, `pending_account`, `corporate_authorization_required`, `connected`, `cancelled`, `denied`, `failed`, `expired`, `revoked`. Runtime flow and connection tables retain their existing additional operational statuses. |
| `CorporateAuthorization` | Either unverified with a safe reason, or verified evidence with origin `bank`/`provider`, an evidence ID, exact company/actor/bank/country/account bindings, checking time and bounded validity. It is not a browser declaration. |
| `ConnectedAccount` | Account UID, optional stable account key, company and consent references, explicit selection and corporate authorization. A session UID is not itself account ownership evidence. |
| `CompanyBankContext` | Server-resolved actor, company, storage owner, membership version, role and active membership. It establishes application access, not bank authority. |

These are shared domain contracts, not four new independent database tables. Sites persists flow context/result/connection linkage in `bank_auth_flows` and consent metadata alongside `bank_connections`; encrypted session/account payloads remain in the existing store. Node extends `bank_states` and `bank_connections`, adding `context_json`, `flow_id` and `consent_json` alongside durable `status`, `terminal_reason` and `connection_id` fields. See [Sites schema](../../../sites/db/schema.ts), [Sites store](../../../sites/lib/banking/store.ts) and [Node schema setup](../../../src/db.js).

The additive Sites migration is [0019_bank_consent_context.sql](../../../sites/drizzle/0019_bank_consent_context.sql): it adds `context_json`, `result_code` and `connection_id` to bank flows and `consent_metadata` to connections. Empty metadata identifies existing rows; it is not an authorization option for new writes. Existing imported transactions and financial evidence are preserved.

Provider session credentials and account payloads stay encrypted on the server. Sites uses `BANK_DATA_ENCRYPTION_KEY` with owner/purpose binding; Node retains the encryption layer in [security.js](../../../src/security.js) and its existing `ENCRYPTION_KEY`/`BANK_DATA_KEY` configuration. Provider application keys are server configuration. The UI does not accept provider private keys or expose session credentials. State tokens are stored as hashes, with a separate authenticated browser/session binding.

## Trusted company/account evidence

[bank-company-authority.js](../../../sites/lib/bank-company-authority.js) resolves the server-only `BANK_COMPANY_AUTHORIZATIONS` configuration. It deliberately fails closed when the configuration is missing, malformed, ambiguous, expired or does not match the requested company/bank/account context. A completed bank identification can therefore produce `corporate_authorization_required` without allowing confirmation or import.

The configuration is serialized JSON with `version: 1` and a bounded `bindings` array. Each applicable binding has the following contract:

| Field | Requirement |
| --- | --- |
| `companyId`, `storageOwnerId` | Exact server-resolved company and storage owner. |
| `provider` | Exactly `enablebanking` for this adapter. |
| `bankName`, `country` | Exact selected bank name and country; no prefix or wildcard matching. |
| `status` | `active`. |
| `origin` | `bank` or `provider`, reflecting the actual source of the evidence. |
| `evidenceId` | A safe, nonempty identifier for the independently verified source evidence. |
| `accountKeys` | Nonempty, unique stable account keys from the same key contract as the adapters. No wildcard keys and no substitution of transient session UIDs. |
| `checkedAt`, `validUntil` | Valid canonical UTC timestamps; checking time cannot be in the future and evidence must still be current. |

Exactly one binding may match the company, storage owner, provider, bank and country. The resolver intersects its stable keys with currently authorized provider accounts, excludes private accounts, and returns only the covered account UIDs. Evidence validity is capped by provider consent validity. The current actor is taken from the authenticated server context, not a submitted evidence object. Duplicate keys/UIDs, malformed dates and unsupported origins fail closed.

This map is an adapter for **prevalidated bank/provider attestations**. The resolver validates structure, exact bindings and freshness; it cannot establish the authenticity of evidence that an operator invents. Filling it from a user's self-attestation, copying an arbitrary company name, or entering synthetic proof in production would defeat the security boundary. Production needs a documented trusted acquisition and verification process for account/company evidence, including how its origin, completeness, revocation and renewal are established. Synthetic fixture entries are only test data.

Authorization is resolved again before and after provider reads and at relevant write boundaries. Removing or expiring evidence blocks subsequent company imports even if an earlier callback succeeded. Account evidence requests also require authority for the requested UID; if alias uniqueness requires a full account census that includes unattested accounts, that read is refused. A previously successful lookup cannot be reused as a permanent authorization cache. See [account-read-guard.ts](../../../sites/lib/banking/account-read-guard.ts), [account-evidence.ts](../../../sites/lib/banking/account-evidence.ts), [details-service.ts](../../../sites/lib/banking/details-service.ts) and [Node adapter](../../../src/bank-consent.js).

## Existing routes and user flow

The UI shows the current company and supported bank, starts the provider redirect, and then requires explicit account confirmation. Company selection is currently restricted to the single server-resolved workspace company. Sites lists supported Swedish business banks; the Node adapter retains its Swedbank selection constraint. Neither runtime interprets an arbitrary company/bank label as authority.

| Operation | Sites | Node |
| --- | --- | --- |
| Status | `GET /api/bank/status`, optional `companyId` | `GET /api/bank/status`, server-resolved company and connection list |
| Start consent | `POST /api/bank/connect` | `POST /api/bank/connect` |
| Renew | Same connect route with `renewConnectionId` | Same connect route with `renew_connection_id` |
| Provider callback | `GET /api/bank/callback` | `GET /api/bank/callback` |
| Confirm account selection | `POST /api/bank/accounts` with `connectionId`, `accountUids`, optional `dateFrom` | `POST /api/bank/accounts` with `connection_id`, `account_uid` |
| Disconnect | `POST /api/bank/disconnect`, optional exact `connectionId` | `DELETE /api/bank/connections` with `id` |

Start accepts the supported company/bank/country and `requiredScopes` inputs; Sites also accepts the existing `dateFrom`. Unknown authority, owner or mode fields are rejected. Default scopes are `accounts:read` and `transactions:read`, both required for this integration. The API does not grant payment initiation or write access. Requesting `bankgiro:read` through this adapter returns `BANKGIRO_SCOPE_UNAVAILABLE` before starting authorization.

The returned start result includes the provider URL, resolved company, flow ID, scopes, `authorization: provider_redirect` and `pkce: not_exposed_by_adapter`. The browser follows that URL. An approved callback saves a company connection in `pending_account` or the runtime's equivalent pending confirmation state when trusted corporate evidence is current; otherwise it records `corporate_authorization_required`. It does not silently select an account or begin importing. Account confirmation revalidates the live provider grant, current company evidence and exact connection before marking it connected. Sites requires supported SEK business accounts with stable identity; Node retains its explicit single-account confirmation flow. The existing Node confirmation route also starts the initial synchronization after validating the selected account. The Sites UI explicitly calls synchronization after confirmation; neither callback imports transactions by itself.

Status uses stored flow outcomes to report cancellation, denial, expiration and interrupted exchange without replaying a code or polling the bank to manufacture success. Query parameters such as a forged `connected` result do not establish connection success. The UI must use current server status and the current consent evidence.

Implementation entry points are [Sites banking service](../../../sites/lib/banking/service.ts), [Sites bank UI](../../../sites/components/bank-connection.tsx), [Node routes](../../../src/server.js) and [Node UI](../../../public/app.js).

## Provider redirect, BankID and PKCE

The supported provider contract is the official [Enable Banking API reference](https://enablebanking.com/docs/api/reference/), specifically `POST /auth`, `POST /sessions`, `GET /sessions/{session_id}` and `DELETE /sessions/{session_id}`. The application's `POST /auth` request starts a provider/bank redirect with business PSU context, the registered callback, state, requested transaction access and an expiration. The bank/provider handles SCA, including BankID where the bank uses it. The application does not build its own BankID or decoupled identification protocol.

The reviewed client-facing `/auth` and `/sessions` contract does not expose PKCE `code_challenge`/`code_verifier` parameters for this integration. Accordingly, the adapter reports `not_exposed_by_adapter`; it does not invent verifier fields or claim PKCE protection implemented by this application. This says nothing about whether the provider uses PKCE internally. A future provider adapter must explicitly declare its capabilities and implement documented PKCE when available or required, together with the same actor/company/browser/state and callback checks.

After code exchange, the server checks the current provider session. It requires the requested bank/country and business context, authorized status, acceptable transaction scope and exact agreement of the account UID sets. Singular account identification hashes cannot conflict. The official session read response can contain minimal `SessionAccount` records; the Node adapter retains the full account details from the exchange and validates fresh identity fields when present instead of inventing account details from the minimal response. Requested, exchanged and checked expirations are all validated; the earliest valid expiration wins, further capped by corporate evidence.

## Lifecycle, concurrency and failure handling

Each new flow binds the authenticated actor, resolved company, membership version, provider application generation, selected bank, requested read purpose/scopes, browser/session, expiration and renewal target. Flows expire after 15 minutes. Sites uses a separate secure, HttpOnly, SameSite=Lax callback cookie per state so independent attempts do not overwrite each other's browser proof. Node binds the state to its authenticated session. State is single-use and the exchange is claimed atomically.

Callbacks accept one well-formed state and exactly one code or provider error. Duplicate/unknown parameters, code-plus-error ambiguity, malformed values, wrong actor/browser, changed application generation and expired context are rejected before code use. Provider errors become safe local outcomes; raw messages and secrets are not reflected to the browser.

| Condition | Required behavior |
| --- | --- |
| User cancels identification | Store `cancelled`; a renewal cancellation does not replace the existing consent. |
| Bank denies access | Store `denied`, distinct from cancellation; do not activate or select accounts. |
| Unsupported business bank | Fail before creating the provider redirect/flow. |
| Missing corporate evidence | Report `corporate_authorization_required`; prevent confirmation and import. New evidence may enable a later explicit confirmation, but never auto-activate the connection. |
| Callback never arrives | Report expiration from stored state. Sites uses `CALLBACK_NOT_RECEIVED` for an expired pending flow. |
| Exchange was claimed but outcome is unknown | Do not replay the code. Sites reports `AUTHORIZATION_OUTCOME_UNKNOWN` after expiration; start a fresh flow. |
| Callback replay or simultaneous delivery | At most one exchange/activation. A duplicate cannot replace the committed result or revoke its session. |
| Multiple pending starts | Preserve independently bound attempts; commits still enforce current connection and flow ownership. |
| Membership, application, company evidence or connection changes during an await | Recheck after the response and before persistence; do not write under stale authority. |
| Consent expires or live scope is revoked | Block subsequent reads/imports and require renewal. Financial writes also check database expiry and the current session identity. |
| Disconnect races with renewal | Serialize/fence operations so a late callback cannot resurrect the removed connection. |

Sites uses owner leases plus SQL commit guards; Node uses its existing connection lease and atomic state/connection checks. The guards cover more than a successful check before an asynchronous bank request. Lost leases cannot write, release a replacement worker's lease, or clean up a provider session now owned by another worker. Callback cleanup also avoids deleting a session already committed locally, and Node rejects a new connection that aliases another persisted provider session.

Renewal uses the existing connect route and an explicit existing connection ID. It binds the previous encrypted session fingerprint and verifies the new provider grant and corporate proof before attempting to replace the old consent. Cancellation, denial or an unverified replacement leaves the old consent unchanged. **Immediately before remote deletion of the old provider session**, the existing row is marked as requiring reauthorization; Sites also disables automatic sync. If that deletion is ambiguous or a later swap fails, the application does not continue to present the old consent as usable. A successful replacement clears previous account selection and requires explicit confirmation again.

Disconnect stops future use, invalidates relevant outstanding authorization state and preserves already imported financial history. If provider deletion fails, the connection remains visibly `revocation_pending` and imports are blocked; retained encrypted credentials permit a retry. When the provider session is successfully closed, the response distinguishes `providerSessionRevoked: true` from `bankRevocationConfirmed: false`. Enable Banking's `DELETE /sessions` closes its session and can revoke the bank grant only where supported. It does **not** establish universal revocation at every bank. In Sites, a legacy connection whose trusted application key is unavailable is disconnected locally with an explicit manual bank/provider revocation requirement.

## Bankgiro is a separate capability

Account/transaction consent does not establish access to Bankgiro remittance files, account-to-Bankgiro links or underlying invoice references. This Enable Banking adapter declares Bankgiro unavailable for its consent flow and rejects an explicit Bankgiro scope. The existing Bankgiro evidence/source integration remains separate; this change must not relabel ordinary AIS access as verified Bankgiro access. A future provider must prove the capability and its source contract before that scope can be granted. See the existing [bank account evidence contract](../bank-account-evidence.md).

## Migration and rollback

Migration 0019 and the Node additive schema updates preserve existing rows and encrypted payloads. They have been exercised only against isolated synthetic databases in this delivery. Unfinished old redirects require a fresh start because they lack a bound company context.

An older binary ignores the new corporate-authorization metadata, so simply deploying it over active company-mode connections is not a safe rollback. Keep the additive columns and financial history. An authorized rollback must first stop company-mode bank reads and resolve or disconnect those connections through the current guarded lifecycle, then verify the target binary's access behavior. Prefer a compatible forward fix when preserving current grants is required. This document authorizes no production migration, downgrade or consent revocation.

## Validation map

The following are actual repository tests, not a claim about production bank behavior or a test-run receipt. The final implementation receipt records the executed commands and results separately; no test counts are inferred here.

| Area | Test file and representative exact test names |
| --- | --- |
| Server company and role boundary | `sites/tests/bank-consent-policy.test.mjs`: `legacy owner context cannot accept another company or a client object`; `server context binds active membership, actor, company and manage role`. |
| Callback and scope parsing | Same file: `ambiguous, duplicate, malformed and unbounded callbacks fail before code use`; `requested scopes must include the account and transaction access the adapters request`; `Enable Banking does not manufacture a Bankgiro read grant`. |
| Provider/account validation | Same file: `account approvals must be bounded, unique and agree across provider responses`; `matching UIDs cannot hide conflicting singular account hashes or be repaired by plural aliases`; `business account usage and a person hash alone never prove company authorization`. |
| Trusted evidence source | `sites/tests/bank-company-authority.test.mjs`: `missing, malformed and wrong-version server configuration fails closed`; `forged caller evidence and corporate labels cannot replace the trusted registry`; `removing or revoking a once-valid registry cannot reuse an earlier successful result`. |
| Company consent and explicit confirmation | `sites/tests/banking-security.test.mjs`: `approved company consent requires separate bank company/account proof and explicit confirmation`; `BankID business login without a company/account attestation remains unverified and cannot import`; `omitting companyId cannot opt a new authorization into legacy authority bypass`. |
| Denial, cancellation and lost redirect | Same file: `denied and cancelled identification have distinct safe durable outcomes`; `lost callback is reported expired from stored flow state without a bank request or replay`; `an interrupted code exchange expires as unknown outcome without replay or provider polling`. |
| Replay and commit races | Same file: `simultaneous delivery of one callback exchanges its authorization code at most once`; `a flow revoked at the actual callback write boundary cannot activate a connection`; `a callback that loses its lease cannot revoke a provider session owned by a newer worker`. |
| Lost successful commit reply | Same file: `a lost callback commit reply preserves the saved provider session with replacement lease false`; `a lost callback commit reply preserves the saved provider session with replacement lease true`. |
| Renewal and migration boundary | Same file: `renewal cancellation preserves the existing connection and accepted renewal replaces it once`; `uncertain old-session revocation during renewal never leaves an apparently usable connection`; `pre-migration redirects cannot create a new legacy connection without company verification`. |
| Authority and scope changes during use | Same file: `a newly revoked transaction scope blocks every subsequent transaction fetch`; `revoking company authority during a provider response prevents financial persistence`. |
| Node HTTP security and parity | `test/bank-consent-api.test.js`, suite `company consent HTTP security and lifecycle`: `company, CSRF, unsupported bank and Bankgiro scope fail before provider calls`; `sibling attempts survive and omitted company cannot bypass corporate proof`; `callback envelope and same-principal other browser cannot consume the state`. |
| Node renewal, session ownership and disconnect | Same suite: `unverified renewal preserves the previous consent and reused remote ids are never deleted`; `a fresh connection cannot alias or clean up another persisted provider session`; `simultaneous fresh callbacks cannot commit or revoke a shared provider session`; `failed disconnect stays visibly pending and prevents any subsequent import`. |
| Node compatibility and stale authority | Same suite: `pre-migration contextless redirects require restart and cannot create legacy rows`; `authority revoked during a provider read prevents checkpoint and financial writes`; `existing metadata-free connections remain usable and explicitly unverified`. |

Existing provider, account consent, account evidence, details, state integrity and financial import regression suites remain relevant. The implementation must pass the repository's Node and Sites gates, including Sites type checking and production build, without changing synthetic fixtures into supposed production evidence.

## Delivery boundary and production acceptance

This change is a code/migration/configuration contract delivered through the feature branch and PR. It does not apply migration 0019 to a live database, install production corporate evidence, call a live bank, publish Sites or merge the branch. A green local suite verifies synthetic fixtures and simulated failure/race boundaries; it does not verify an actual corporate bank mandate, a real BankID round trip, live provider revocation, Bankgiro capability or an active automation schedule.

Production acceptance still depends on:

1. Integrating Agent 1's authoritative company/membership adapter before offering multiple companies, including storage ownership and access revocation behavior.
2. Establishing a bank/provider-backed source for corporate account attestations and a supported operational process for their verification, expiry and revocation. Missing proof must continue to block company imports.
3. Applying the additive schema changes through the authorized release process, preserving existing encrypted connections and financial evidence, and requiring unfinished old redirects to restart.
4. Configuring the correct registered provider application, callback and encryption settings, then validating a controlled real business-bank authorization with an appropriately authorized company representative.
5. Checking explicit account selection, renewal, denial/cancellation, expiration, disconnect and the bank's own grant-revocation behavior in that authorized environment. Provider session closure alone is insufficient evidence of bank grant revocation.
6. Verifying any future Bankgiro provider/source separately and maintaining the distinction between account transactions, recipient/account evidence, Bankgiro links and payment allocation.

The planning record is [2026-11-04-bank-consent.md](../../superpowers/plans/2026-11-04-bank-consent.md). Execution evidence and any production acceptance results belong in the final delivery receipt and project progress records, with local verification and live acceptance clearly identified.

## Local verification receipt — 2026-11-04

Verification uses Node 24.22.1 and isolated synthetic SQLite/D1/provider fixtures. GitHub PR CI uses the repository's configured Node 22 job and is a separate receipt. Dependency manifests, lockfiles and CI definitions are unchanged.

| Gate | Observed result |
| --- | --- |
| Root syntax check, `npm run check` | 138 JavaScript files checked; passed. |
| Sites type check, `npm run check` | Passed. |
| Root full suite after the final concurrency fix | 1,587 passed; zero failures, skips, cancellations or TODOs. |
| Sites full suite | 3,227 passed; zero failures, skips, cancellations or TODOs. |
| Isolated Bankgiro bridge suite | 47 passed; zero failures, skips, cancellations or TODOs. |
| Bridge syntax check | Passed. |
| Root and bridge high-severity audits | Zero vulnerabilities reported. |
| Sites `npm audit --audit-level=high` | Passed the high/critical gate; eight moderate findings remain in the existing ESLint/typescript-eslint/minimatch development chain. |
| Exact installed minimatch mitigation | One target verified, zero writes needed. |
| Sites production build | Passed with the existing bundler sourcemap warnings. |
| Independent security review | Concrete scope, commit-expiry, migration and remote-session-alias findings were reproduced and corrected with regression tests; no unresolved finding was left in the reviewed paths. |

Full suites are run with concurrency bounded to two workers. The direct Node test launch supplies the existing `npm_execpath` so the repository's postinstall integration test uses the installed npm CLI, matching npm lifecycle execution:

```sh
# From repository root; npm_execpath points to the installed npm CLI.
node --test --test-concurrency=2 test/*.test.js

# From sites/ with the same npm lifecycle environment.
node --experimental-strip-types --test --test-concurrency=2 tests/*.test.mjs

# Production build, without publication.
NODE_OPTIONS=--max-old-space-size=1536 npm run build
```

The initial Sites install was killed with exit 137 during memory pressure; the bounded reinstall completed without dependency changes. An initial root baseline overlapped an incomplete dependency installation and was discarded; the subsequent stable baseline passed 1,565/1,565. An early direct Sites full run had one launch-environment failure because `npm_execpath` was absent; the corrected full run above passes. The final feature receipt, rather than these invalid preliminary environments, is the test evidence.

The focused final Node bank/API/UI/session-mutation regression additionally passed 95/95 after the transactional remote-session-alias fix. The subsequent full Node run on the final implementation passed 1,587/1,587. The three complete suites total **4,861 passing tests** (1,587 Node + 3,227 Sites + 47 bridge). No test was skipped to reach the passing result.
