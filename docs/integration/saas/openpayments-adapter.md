# Open Payments corporate adapter — Agent 2

Date: **2026-11-04**. Branch: `feature/saas-openpayments-provider`.
Baseline: `14a042abd37fa455d08da9dfcc096ef4f603b512`.
Contract: **`bank-data-provider-v1`**; provider ID **`open_payments`**.

## Delivery boundary

This is an additive server acquisition adapter for the documented Open Payments
v1 corporate AIS and consent APIs. It is not activated by an API route, UI,
scheduler or database migration. Today's Enable Banking routes and saved
connections continue to use their existing code. No production credentials,
customer records, live bank operations or Sites deployment were used.

The new provider can be called by a server integration after that integration
supplies authenticated company context, a current-connection authorization guard,
the existing encrypted storage codec, and an atomic redirect-flow consumer.
Those are explicit dependencies, not optional authorization bypasses. Agent 1's
company registry and the integration workstream own their persistent mapping.

See [provider capabilities](provider-capabilities.md) for documentary evidence
and the distinction between API contracts, customer agreements and live coverage.

## Exact implementation

| File | Responsibility |
| --- | --- |
| `sites/lib/banking/bank-data-provider.js` and `.d.ts` | Provider-neutral contract, safe errors, immutable bindings, scoped encrypted handles, explicit provider selection |
| `sites/lib/banking/openpayments-provider.js` and `.d.ts` | Company-bound ASPSP discovery, consent/SCA lifecycle, accounts and paginated transactions |
| `sites/lib/banking/openpayments/config.js` | Fixed environment hosts, v1, feature/scope/callback allowlists |
| `sites/lib/banking/openpayments/http.js` | HTTP method/path/header allowlists, 20-second deadline, 2 MiB body limit, safe classifications |
| `sites/lib/banking/openpayments/token.js` | Server application-token cache, single-flight refresh, expiry/invalidation, separate redirect activation |
| `sites/lib/banking/openpayments/authorization.js` | SCA/status validation and strict redirect-template substitution |
| `src/banking/openpayments-node-transport.js` | Native Node HTTPS client-certificate transport |

### Public API

`new OpenPaymentsProvider(config, options)` creates one application instance.
`provider.forCompany(context, dependencies)` creates a connection adapter with
the methods below. It does not create a company, change a default provider or
persist any bank record.

| Method | Result and constraints |
| --- | --- |
| `listBanks(countries = ['SE'])` | Actual ASPSP list response projection; no hardcoded commercial bank list |
| `discoverCapabilities()` | ASPSP metadata for the bound BIC, known authorization methods and documented history limits; company entitlement remains unknown |
| `createConsent({validUntil, frequencyPerDay?, redirectPreferred?})` | Opaque consent handle, actual consent status and original; read access, recurring consent, frequency 1–4 and `combinedServiceIndicator: false` |
| `getConsentStatus(handle)` | Provider status; `partiallyAuthorised` is not treated as valid |
| `revokeConsent(handle)` | Documented consent DELETE only |
| `createAuthorisation(consentHandle)` | Opaque authorization handle and methods actually advertised in the response |
| `startAuthorisation(handle, {authenticationMethodId, redirectUri?})` | Decoupled challenge or a validated provider redirect and opaque flow handle |
| `getAuthorisationStatus(handle)` | One status read; caller controls bounded, sequential polling |
| `completeRedirect(flowHandle, {code, scope, state})` | Single-use activation followed by a separate consent-status read |
| `listAccounts(consentHandle)` | Account handles and explicit returned identifiers within a currently valid corporate consent |
| `getAccount(accountHandle)` | Account details checked against the handle's known account identity |
| `getTransactions(accountHandle, {dateFrom, dateTo, requireBankgiro?})` | Separate booked rows and Bankgiro observations plus one preserved response per page |

Both runtimes can use the shared JavaScript adapter, subject to installation of
its existing Sites dependencies. The Node transport is separate so Node HTTPS
and certificate handling do not enter the Workers/browser bundle.

### Configuration and allowlists

The constructor accepts `environment` (`SANDBOX` or `PRODUCTION`), `clientId`,
`clientSecret`, `credentialGeneration`, optional `credentialsValidUntil`,
`apiVersion: 'v1'`, `features`, `scopes` and exact HTTPS `redirectUris`.
Unknown configuration keys and alternate API hosts are rejected.

Default features are `bank_discovery`, `consents`, `accounts`, `transactions`.
`bankgiro_enrichment` is opt-in and requires `transactions`. Explicit scopes must
match the configured read features exactly. Defaults are:

| Environment / feature | Requested OAuth scopes |
| --- | --- |
| Sandbox default | `accountinformation corporate` |
| Production default | `aspspinformation accountinformation corporate` |
| Bankgiro enrichment | Add `bankgiroinformation` to the relevant environment's scopes |

`paymentinitiation`, `private`, Bankgiro Lookup, PIS, payouts, ISO payment routes
and ISO fallback are excluded. Returned bank payment capabilities do not enable
them. HTTP permissions are enforced independently of scopes. Only documented
ASPSP, consent and account-information v1 paths are allowed; mutations are
restricted to consent/authorization management and OAuth exchanges.

Official contracts: [tokens](https://docs.openpayments.io/docs/get_access_token),
[environment hosts](https://docs.openpayments.io/docs/api),
[sandbox scope exception](https://docs.openpayments.io/docs/sandbox).

## Identity, consent and existing storage

Every context supplies immutable:

```text
owner / companyId / connectionId / provider / environment / generation
corporateId / psuId / bicFi
optional corporateIdType / affiliatedAspspId / interactive PSU IP and user agent
```

`owner` and `companyId` must come from authenticated server membership, not from
request JSON alone. The adapter's generation is the current configured
credential generation. `assertCurrent(binding)` must recheck current membership,
connection/provider selection, application generation and local revocation.
Checks run before/after external requests and before results leave the adapter.
Operation inputs are snapshotted before asynchronous work, preventing caller
mutation of dates, Bankgiro requirements, callback or authorization inputs.

The `codec` dependency has `seal(owner, purpose, value)` and
`unseal(owner, purpose, ciphertext)` methods. Use the existing
`sites/lib/banking/store.ts` `encrypt/decrypt` functions or its
`security.ts` `seal/unseal` primitives with the existing server key. The purpose
includes a JSON tuple of company, connection, provider, environment and generation,
plus resource type. An account handle cannot become a consent handle, and handles
cannot move across companies, providers or credential generations.

Bank consent ID, account resource ID and authorization ID are inside those
handles. The data adapter checks corporate/PSU/BIC bindings again after opening
them. AIS reads re-read consent state and apply the earlier of local and bank
expiry. Explicit private accounts, contradictory account identifiers, revoked,
expired and partially authorized consents are blocked. A returned Bankgiro number
is preserved as an observation, with `bankgiroMappingVerified: false`.

The existing `BankConnectionRow` and `BankFlowRow` remain unchanged and are still
owned by Enable Banking. Do not write Open Payments handles into those rows in
the current production schema. The company foundation/integrator must define the
reviewed additive provider discriminator and persistent company mapping first.

Official identity/consent contracts:
[consent service](https://docs.openpayments.io/api/consent-service),
[consent guide](https://docs.openpayments.io/docs/create_consent),
[AIS](https://docs.openpayments.io/api/account-information-service-ais).

## OAuth and authorization lifecycle

The application cache contains only an opaque application token, effective expiry
and refresh generation. Its fields and client secret are not enumerable. Tokens
are acquired with form-encoded `client_credentials` on `/connect/token`; no custom
JWT signing or token-claim interpretation is used. Returned type, lifetime and
exact scopes are validated. Missing/extra/wrong scopes and malformed results fail
closed. 401 clears the cached token; the failed operation is not replayed.

Concurrent callers share one refresh in one application instance. Invalidation
during a refresh prevents that in-flight token from reentering the cache. Recreate
the application instance on credential rotation; existing resource handles are
generation-bound. Multiple companies may share application authentication, while
their contexts, consents, headers, accounts and original envelopes stay separate.

For a multi-isolate deployment, the integrator must coordinate the application
instance/token lifecycle in a server actor or equivalent shared service. This
in-process cache does **not** claim a distributed once-per-hour token guarantee.
Do not persist plaintext tokens in workspace state, job payloads or browser data.

For redirect authorization, the supplied `scaOAuth` template must name the fixed
environment auth host, `/connect/authorize`, this consent/authorization/BIC,
read-only corporate scope and the expected placeholders. Exact configured callback,
cryptographic random state and client ID are inserted; arbitrary auth URLs are
rejected. The flow expires after at most ten minutes.

`consumeRedirectState({binding, state, flowId})` is mandatory for redirect. It must
atomically verify the saved owner/company/connection, authenticated browser cookie,
state, expiry and pending status, then consume the flow exactly once. Existing
owner-bound flow/cookie patterns are the model; a caller returning `true` without
those checks is not a production implementation. The test implementation uses an
isolated synthetic store. Consume occurs before exchanging the code, so ambiguous
activation failure requires a new flow instead of replay.

Activation uses `authorization_code` with `X-consentId` and
`X-ConsentAuthorisationId`. Its returned token is validated and discarded, as
documented; subsequent AIS continues to use the application token. Decoupled
authorization exposes only the response challenge and current SCA state. This
adapter does not implement a BankID UI or an unattended polling loop. A final SCA
status does not bypass the separate valid-consent check.

Source: [authorizations](https://docs.openpayments.io/docs/authorisations).

## HTTP, certificates and errors

Production requires a transport with `kind: 'mtls'` and a certificate-validation
function; ordinary fetch is rejected before authentication. The concrete Node
factory `createOpenPaymentsNodeTransport({certificatePem, privateKeyPem, now?})`
uses native HTTPS, verifies X.509 validity/key matching at construction and before
requests, retains TLS server verification, and restricts destinations/routes.
The key and certificate remain in a private closure. Sandbox supports injected
fetch-compatible transport without a production certificate.

Sites/Workers needs an actual deployment mTLS fetch binding wrapped in the
documented transport interface and a current certificate-validation policy. No
such binding or certificate has been provisioned by this PR. Local certificate
tests prove parsing, validity checks and key matching; they do not prove that Open
Payments has issued or accepted a production certificate.

Request handling bounds headers and streaming bodies, refuses redirects and does
not expose raw provider errors, tokens or account data in errors. 401, 403, 429 and
5xx retain safe distinct classifications. `Retry-After` is retained even when an
error body is oversized or unreadable. Excessive retry intervals produce an
explicit retry block. Timeouts bound both network and body reads, including an
injected transport that ignores abort. Ambiguous POST/PUT failure is flagged
`mayHaveSucceeded` and is never automatically retried.

Source: [production access and certificate](https://docs.openpayments.io/docs/getstarted).

## Transactions and original provenance

The adapter requests `bookingStatus=booked`, explicit dates, and follows the
documented `transactions._links.next`/`continuationKey`. Every next page must retain
the same provider origin and account and remain inside the original date range.
Unknown query keys, repeat cursors, more than 20 pages, more than 5,000 combined
rows, malformed booked records and a failed page reject the whole batch. No
checkpoint, ledger mutation or financial success is produced from partial data.

`booked` and `bankgiro` are distinct arrays. They are never concatenated into an
economic ledger. Raw identifiers/references remain strings; there is no OCR
reconstruction, invoice lookup, guessed payer or transformation of `599` to `0599`.
`requireBankgiro: true` fails if its read scope is disabled or a response lacks the
documented Bankgiro collection. A returned collection means that data was observed
in that response, not that every report/payment is complete.

Each acquisition envelope contains `provider`, the full `binding`, `operation`,
request ID, receipt time, `bankData`, `bankDataSha256` and
`bankDataVersion: 'openpayments-response-v1'`. The existing `bankApiDataHash()` is
reused. It hashes the retained JSON representation, **not original HTTP wire bytes**.
Unknown source fields are preserved in that representation.

**Do not import these envelopes as legacy `bank-api-original-v1` transactions.**
The existing original validator and `enable-banking:` dedup identities are provider
specific. This PR neither impersonates that format nor weakens the validator.
A future reviewed intake must preserve the Open Payments envelope through the
existing owner-bound original store and add the appropriate provider-specific
normalizer/validator before financial import. Account identity, Bankgiro report
coverage, original integrity and permission to reconcile are separate evidence.
The result always reports `paymentReconciliationAllowed: false`.

Sources: [AIS](https://docs.openpayments.io/api/account-information-service-ais),
[schemas](https://docs.openpayments.io/api/~schemas).

## Enable Banking compatibility and provider switches

`providerForConnection(connection, registry)` defaults **only an absent legacy
provider discriminator** to `enable_banking`. An explicit unknown, unavailable or
mismatched provider fails; it never falls back using another provider's secrets.
The existing Enable Banking API/normalizers/store are unchanged. This is a
selection boundary for future integration, not a replacement Enable Banking
implementation. A switch must create/review new provider-specific consent and
account bindings; it must preserve historical originals and allocations.

## Verification receipt

All new bank/API responses used in tests are synthetic fixtures modeled on the
official schema. No real Open Payments sandbox request has been made.

| Boundary | Evidence in this PR | Live status |
| --- | --- | --- |
| Scope, configuration, provider switch, resources | Synthetic unit tests plus existing real AES-GCM codec | Not live tested |
| OAuth/token, statuses, timeout, body limits | Injected HTTP fixtures | Not live tested |
| Native client certificate | Generated temporary X.509 certs/private keys and mocked HTTPS request mechanics | No real provider mTLS handshake |
| Two companies and their accounts | Simultaneous distinct synthetic company/PSU/consent/account contexts | No live customer company |
| Redirect and decoupled consent | Official-shape fixtures; synthetic single-use flow store | No real BankID flow |
| Discovery and Bankgiro enrichment | Returned fixtures; absent support stays blocked/unknown | No verified bank/company coverage |
| Existing Enable Banking | Existing Node/Sites regression suites | Existing production untouched |

### Final local command receipt

Implementation commit: `79f27f0b20a51b759592f2910903a002f5adc4f0`.
The subsequent delivery commit updates documentation only. Local runtime:
Node **24.22.1**, npm **11.9.0**. The repository's GitHub Actions workflow uses
Node 22; its remote result is reported separately in the PR.

| Gate | Observed result |
| --- | --- |
| Root `npm ci --ignore-scripts` | Pass; lockfile unchanged |
| Sites `npm run install:ci` | Pass; exact installed minimatch mitigation verified |
| Bridge `npm ci --ignore-scripts` | Pass; lockfile unchanged |
| Root `npm run check` | Pass; 137 JavaScript files |
| Explicit syntax check of six shared new JS modules and native transport | Pass; includes the new nested source directory beyond the root scanner |
| Sites `npm run check` | Pass |
| Root `npm test` | **1,585 passed**; zero failed/skipped/cancelled/todo |
| Sites `npm test` | **3,191 passed**; zero failed/skipped/cancelled/todo |
| Bridge `npm run check` and `npm test` | Pass; **47 passed**; zero failed/skipped/cancelled/todo |
| Root `npm audit --audit-level=high` | Pass; zero vulnerabilities reported |
| Sites `npm audit --audit-level=high` | Pass at the required threshold; **8 moderate** development dependency findings remain |
| Bridge `npm audit --omit=dev --audit-level=high` | Pass; zero vulnerabilities reported |
| Sites `npm run build` | Pass |
| `git diff --check` | Pass |

Full suites total **4,823 passing tests**, including **90 new Open Payments
tests** (70 shared/Sites and 20 native transport). Focused reruns overlap these
totals and are not counted again. No dependency manifest or lockfile changed.
An additional Sites production-only audit attempt returned registry HTTP 403;
it is not claimed as a successful zero-finding audit. The required full Sites
high-threshold audit above completed successfully.

Independent review found two Important issues and no Critical issue. Both were
reproduced before correction: caller mutation could change transaction/date or
authorization inputs during awaits, and an oversized native transport error
could erase 401/429 classification and Retry-After. Snapshotting operation inputs
and preserving status/headers while discarding unsafe error bodies corrected
them. The reviewer independently reran the three input regressions and two
transport regressions, including the native/shared-HTTP combination, and confirmed
that both original findings are resolved and this additive adapter PR can proceed.
That verdict does not establish live provider compatibility or production readiness.

### External tests and activation prerequisites

1. Supply a sandbox application client ID/secret with the relevant read products
   and whitelisted callback; run real positive/negative sandbox scenarios.
2. Confirm the SaaS/customer-company commercial model, permissions and any
   Bankgiro/ISO onboarding with Open Payments. A successful OAuth scope is not a
   substitute for those confirmations.
3. Obtain production approval and the organization's real client certificate;
   test certificate deployment, rotation and provider acceptance.
4. Verify each targeted bank/company/account's AIS, authorization method,
   Bankgiro coverage, payer/reference fields, history, delays and completeness.
5. Integrate reviewed company persistence, durable redirect consumption, runtime
   token coordination, existing original retention and provider-specific intake.
   Then perform sandbox end-to-end acceptance before any production enablement.

No customer-specific contract, all-bank coverage, single-signature onboarding or
production readiness is inferred from fixture success.
