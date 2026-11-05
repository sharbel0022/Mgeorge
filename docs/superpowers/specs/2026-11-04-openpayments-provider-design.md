# Open Payments corporate provider design

## Intent and constraints

Implement Agent 2's read-only corporate integration on
`feature/saas-openpayments-provider`, based on main
`14a042abd37fa455d08da9dfcc096ef4f603b512`. Existing Enable Banking connections,
financial validation, originals, schedules and production data remain intact.
The supplied assignment authorizes implementation, tests, branch push and PR;
deployment and migration are outside this delivery.

## Approach

Use additive, framework-independent JavaScript modules under `sites/lib/banking/`
with TypeScript contracts, and a separate Node HTTPS mTLS transport. Node and
Workers can share the protocol adapter. Retrofitting Open Payments into the
Enable Banking wire model would mislabel original evidence; replacing today's
connection service would also collide with the company-foundation workstream.
The selected approach provides a usable server adapter without either change.

The public contract binds every resource to authenticated owner, company,
connection, provider, environment and configuration generation. A required server
authorization callback rechecks the binding before and after network work. An
injected codec reuses the current `encrypt/decrypt` storage boundary (AES-GCM
`seal/unseal`) for consent, account and redirect-flow handles. No new database,
bank ledger, payment engine or scheduler is introduced.

Token state belongs to a server application instance, not a browser or a company
response. The application token is shared only within its exact environment,
client and credential generation, as recommended by the provider. Company data,
consents and accounts are never cached together with that token. Refresh is
single-flight and bounded by actual expiry; 401 invalidates without replaying
consent creation. Redirect activation tokens are validated then discarded.

## Protocol and evidence

Only documented v1 ASPSP, consent and AIS routes are callable. Production scopes
are `aspspinformation accountinformation corporate` with optional
`bankgiroinformation`; sandbox ASPSP uses `accountinformation`. Reject private,
paymentinitiation, unknown scopes and unsupported API versions before network.
Consent `combinedServiceIndicator` is always false. ISO fallback and premium
lookup are not enabled by this adapter.

Production requires a validated client-certificate transport. The Node transport
checks certificate/key matching and validity, retains server TLS verification,
and sends credentials only to fixed provider hosts. Workers require a configured
mTLS binding; plain fetch is permitted only in sandbox.

Bank capabilities come from ASPSP list/details. Corporate context, application
scope, consent status, company entitlement and actual Bankgiro data are separate
facts. Unknown Bankgiro coverage stays unknown. Enrichment flags describe
observations, not report completeness or an independently proved deposit link.
The original provider JSON and a checksum travel with results; they are never
relabeled as Enable Banking originals or automatically imported into the ledger.

Redirect and decoupled authorization use the documented consent authorisations
routes. Redirect activation requires a bound, unexpired, single-use server flow
and exact allowlisted callback, state and read-only scope. A successful SCA
response alone cannot turn a partially authorised consent into a valid consent.

## Verification and external limits

Use synthetic fixtures for official wire shapes and real cryptography for
tenant/provider isolation and certificate validation. Exercise timeouts including
stalled bodies, scopes, malformed OAuth, 401/403/429/5xx, credential rotation,
expired certificate, consent revocation, wrong-company account handles and
unavailable enrichment. Run existing Node/Sites gates. No sandbox credentials,
bank entitlement or commercial SaaS agreement is assumed. Report fixture, live
sandbox and provider-contract evidence separately.
