# Commercial SaaS launch gates

Reviewed2026-11-04. **Decision: BLOCKED.** This is an evidence checklist, not regulatory approval. A green test, authenticated individual, existing provider connection or generic bank API capability cannot replace the evidence below. No customer credentials, bank originals or legal documents containing personal data belong in this repository.

The technical implementation must keep new SaaS onboarding disabled server-side until an authorized business/security decision records every required gate. A local synthetic configuration can exercise the code, but cannot authorize a production flag.

| Gate | Required reviewable evidence / acceptance | Current status | Responsible function |
| --- | --- | --- | --- |
| L01 AIS operating model | Written classification of Mgeorge's exact service and responsibilities, including whether registration/permission or an approved provider/agent arrangement is required. Identify the actual legal entity providing AIS; independent legal review and FI clarification where needed. | NOT VERIFIED | Business/legal |
| L02 supplier authority | Executed provider agreement, documented environment/product entitlement, permitted SaaS use, bank/company coverage and responsibility allocation. Inspect actual provider registration independently. | NOT VERIFIED | Business/legal/provider |
| L03 company representative | Verified company identity and separate proof that the consenting person may grant access to the selected corporate accounts. Individual SCA/BankID success alone is insufficient for this product gate. | NOT VERIFIED | Business/provider/bank |
| L04 permitted read scope | Actual accounts/transactions/corporate and optional bankgiroinformation entitlement, requested/granted scopes and expiry. No payment-initiation permission. | NOT VERIFIED | Provider/security |
| L05 Bankgiro coverage | Bank/company/account-specific source authorization, profile, exact raw response receipt, individual payer/reference coverage and stable deposit identity. Missing facts remain unknown. | SOURCE_NOT_CONFIGURED | Provider/bank/integration |
| L06 privacy roles and instructions | Record controller/processor roles by processing purpose; signed DPA where required, documented customer instructions, information duties and processing register. | NOT VERIFIED | Privacy/legal |
| L07 subprocessors | Actual provider/hosting/storage/OCR chain, processing locations, security commitments, approved subprocessor arrangements and change notification. | NOT VERIFIED | Privacy/procurement |
| L08 international transfers | Actual data-flow/location inventory and reviewed transfer mechanism/safeguards wherever required; do not assume that an integration's connection status establishes this. | NOT VERIFIED | Privacy/legal |
| L09 retention and deletion | Authorized retention schedule covering financial originals, provider receipts, audit, backups and expired/revoked secrets. Test tenant-specific export/deletion while respecting required original retention. | NOT VERIFIED | Business/privacy/security |
| L10 incident response | Named duty coverage, detection/escalation, processor-to-controller notice, assessment and applicable regulatory reporting procedure. Test a synthetic incident exercise and record response responsibilities. | NOT VERIFIED | Security/privacy |
| L11 production recovery | Current verified encrypted snapshot and originals, trusted recovery key, independently retained copy, tenant-bound restore, measured RPO/RTO and rollback procedure. | PARTIAL: fixed Nov4 snapshot362/362 complete/manifest_pass;112 historical API records lack receipts, full DR/RPO/RTO not verified | Operations/security |
| T01 provider acceptance | Real sandbox corporate SCA and callback/account/scope/expiry/revocation receipts, production mTLS/credential acceptance and bank-specific entitlement. Mock contracts alone do not pass. | NOT VERIFIED | Integration/provider |
| T02 joined tenant isolation | Reviewed exact integrated SHA, actual current-membership A/B/C and role tests, callback/worker/cache/export/original/restore boundaries, migration upgrade tests and green Linux main CI. | IN PROGRESS | Engineering/security |
| T03 operations | Existing schedule identities/cadences retained; real run receipts distinguish configuration, invocation and successful completion. Safe 429/restart/lease/original retention acceptance. | PARTIAL: Gmail disabled; fresh OCR receipt pending | Operations |
| T04 activation decision | Signed release evidence identifies exact main/Sites source, feature flag, approved customer scope, rollback and all above gate outcomes. Runtime flag absent/false is disabled. | BLOCKED | Business/security/release |

## Current primary references

FI describes permission requirements for payment services and an application route for providers supplying only account-information services. Applying this to Mgeorge's particular operating model requires the L01 review; use of another provider does not itself establish our legal status. [Finansinspektionen: Betaltjänster](https://www.fi.se/sv/betalningar/sok-tillstand/betaltjanster/?navigation=open).

IMY explains when processor agreements are needed, documented instructions and arrangements with subprocessors. L06–L08 must follow the actual parties and processing performed. [IMY: Personuppgiftsbiträdesavtal](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/personuppgiftsansvariga-och-personuppgiftsbitraden/personuppgiftsbitradesavtal/).

Incident duties depend on the controller/processor role and circumstances. L10 must document prompt processor escalation and the controller's assessment/reporting process, rather than treating a single time limit as a universal rule. [IMY: Att tänka på som personuppgiftsbiträde](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/personuppgiftsansvariga-och-personuppgiftsbitraden/att-tanka-pa-som-personuppgiftsbitrade/), [IMY: Personuppgiftsincidenter](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/personuppgiftsincidenter/).

Provider API contracts and documented production access are technical inputs, not company-specific commercial approval. [Open Payments: API environments](https://docs.openpayments.io/docs/api), [production access](https://docs.openpayments.io/docs/getstarted), [tokens](https://docs.openpayments.io/docs/get_access_token), [authorisations](https://docs.openpayments.io/docs/authorisations).

## Evidence record format

Each approval must record gate ID, reviewer function, decision date, evidence reference in approved private storage, applicable company/provider/environment, expiry/review date and exact technical release where relevant. Do not paste sensitive agreement, person or bank data into a GitHub issue. An unknown, expired or partial result remains blocked.
