# Bankgiro automatic source readiness — 2026-11-03

**Release receipt in progress.** Start main:`d91ec6c45acc07c15b82b815ffaa305d6d213656`; local code freeze:`87c6be03fa9c19d2e810db80f3f1e2af548589b6`. Exact integrated main/CI and new Sites deployment receipts are added after the normal PR gates. This completes generic internal development for the supported transports, not a claim of company-specific bank approval or a real bank download.

[Design](superpowers/specs/2026-11-03-bankgiro-source-readiness-design.md), [plan](superpowers/plans/2026-11-03-bankgiro-source-readiness.md), [execution ledger](integration/bankgiro-readiness-ledger.md). No endpoint, credential, bank profile or entitlement is invented.

## Delivered modules and boundaries

| Component | Implementation / behavior |
| --- | --- |
| Normalized HTTPS source | `sites/lib/bankgiro-http-source.js` and declarations implement the existing authorize/listReports/fetchReport contract. Fixed trusted HTTPS origin/path, no redirects or arbitrary download URL, bounded streaming JSON/originals, length/SHA/encoding checks, abort/deadline, safe401/403/429 and content409 identity-conflict handling. |
| Trusted registry | `bankgiro-source-registry.js` accepts server configuration and a server secret binding map only. Immutable owner/company/Bankgiro/source/scope/generation/profile/entitlement/transport binding; remote authorization must match exactly. Missing config stays null; malformed/disabled/synthetic authority fails closed. |
| Isolated SFTP bridge | `bridge/bankgiro/` is a separate Node>=22.13 POSIX package with pinned `ssh2@1.17.0`, exact lock, private configuration/credentials, explicit password or public-key authentication and verified SSH host fingerprint. No browser/Workers SFTP or root/Sites dependency addition. |
| Durable private spool | Read-only bounded SFTP scans, stable opaque identity and discovery sequence, immutable SHA-addressed originals and journal, atomic publication/readback/fsync and SQLite OS writer lock. Process death/restart, late files, unchanged/renamed originals, changed hashes, partial/disconnected streams and legal empty listings are tested. No upstream file deletion/move occurs. |
| Existing intake | Node/Sites `bankgiro-ingest`, store and sinks retain existing parsers, original retention and ledger boundaries. Fifteen-MB originals,50-report pages,10 jobs/run and45-second worker bound remain. Full accepted pages alone advance the cursor; pending work can resume without relisting before its configured interval. Provider429 embargo survives restart/config revision. |
| Authority lifecycle | Additive migration0018 stores receipt/history/revision/binding metadata on existing queue tables. Semantic authority binding is independent of operational interval/revision. Monotonic revision and exact owner-snapshot CAS fence activation/revocation; retired scope/generation pairs cannot return through a newer config. Capacity is bounded and admission reserves space for eventual revocation. |
| Current commit guards | Original metadata, queue identity/binding, source authority, live expiry and lease are fenced inside real Node SQLite / Sites D1 commits; existing AIS consent/account and workspace CAS guards remain. Intake does not create an invoice allocation. Retained originals and uncertain committed outcomes survive failures. |
| Existing orchestration | Node reuses its minute timer. Sites reuses bank automation and payment-control bank boundaries; C5 status reads stored receipts without authorizing/fetching/writing. No external schedule is created or changed. |
| Compact status UI | `bankgiro-source-status.tsx` shows registration/current authorization, success/failure history, next eligibility, separate pending/retry/import/review/blocked/duplicate counts, safe errors and explicit source-reported gaps. Unknown is not connected/authorized; imported is not paid. Manual Excel remains a fallback. |
| CI | Existing root and Sites jobs are preserved; an isolated Node22 bridge job adds locked install/syntax/audit/actual SSH tests. Sites installs bridge dependencies only to run the full synthetic chain. |

The bridge serves our application protocol:GET `/v1/authorization`, `/v1/reports?cursor&limit`, `/v1/reports/{opaque-id}/content`. GETs read retained state and never start an upstream scan. Its HTTP listener is loopback-only; an independently approved HTTPS proxy and private persistent POSIX filesystem are deployment requirements. The bridge package is delivered/tested, not deployed against a bank.

## Formats and preserved evidence

Existing parsers remain authoritative:CSV, XLSX, and generic ISO20022 camt.053/.054 namespaces `.001.02` and `.001.08` supported by `camt-xml.js`. This does not certify Swedbank's exact MIG/XSD/Envelope, required security wrapper or customer-specific detail coverage. Only an actually approved profile should be configured. The application adapter allowlist is `csv|xml|xlsx`; the bridge can retain other configured transport extensions but they are not thereby supported application formats.

Exact original bytes, SHA256, source/report identity, arrival/availability and import receipts survive retention and replay. A hash proves retained byte integrity, not bank origin. General bank references and individual bank-reported payer fields are not filled from an invoice. M.George invoice0599 retains intended reference0599 as text;599 stays distinct; generic reference never becomes formal bank OCR. Account/deposit/customer relations and allocation remain separate evidence/decision boundaries.

## Verification and resolved findings

Final local full verification: **1565 Node +3117 Sites +42 bridge =4724 passed;0failed,0skipped,0cancelled,0todo**. Root/Sites ran on Node24.22.1; the isolated bridge full suite also ran on the exact supported Node22.13.0 floor. Guarded TypeScript,136-file root syntax plus bridge syntax and production build pass. Root/Sites production/bridge audits are0; full Sites retains16 inherited moderate development findings,0high/critical. Dependency inputs are locked and unchanged in root/Sites. Exact PR/main CI and publication receipts remain pending below. Clean restored baseline was1563Node+2980Sites=4543,0fail/skip/cancel/todo. Final production-source code is independently reviewed at local freeze87c6be0 with no remaining Critical/Important blockers. Focused suites overlap the full suites and are not added to the final total.

Actual synthetic end-to-end tests join a local SSH/SFTP server, pinned/authenticated bridge, normalized HTTPS adapter, real SQLite-backed D1 queue, retained originals, real parser/domain sink, read-only C4 preview and payment/status rendering. The only network substitute in the full chain maps one exact fictional HTTPS origin to the real private loopback HTTP listener; it does not verify a deployed TLS proxy or bank server. The chain preserves original bytes and intended/observed0599, one economic deposit and zero allocations. A changed upstream original retains both bridge blobs, blocks the queue as IDENTITY_CONFLICT, leaves cursor and application originals/workspace/audit unchanged, and exposes review status rather than endless retry.

Meaningful RED/GREEN findings were retained:stale generation/revision drainage and cadence; blocked overview appearing successful; retired-generation resurrection; delayed revocation losing history; revocation capacity; string/number wire mismatch; synthetic authority markers; root HTTPS path joining; cancellation/deadline during durable publication; content409 classification; and ssh2-filtered empty/dot-only directory pages. No tests were deleted or weakened. POSIX-only bridge acceptance is explicitly unavailable on Windows; Linux CI has no platform skips.

| Requested scenarios | Existing/added actual-component evidence |
| --- | --- |
| Single payment; multiple payers; aggregate;0599 versus599 | `bankgiro-sftp-e2e`, `bankgiro-readiness-joined`, `seven-agent-0599-joined` |
| Different/missing account aliases or deposit relationship | Joined cases and `bank-account-evidence-contract` / real sink suites |
| Replay, rename, conflicting hash, delayed report | Worker/sink/joined cases and actual bridge sequence/immutable-blob tests |
| Interrupted/resumed transfer;429; lost auth; wrong host identity | HTTP stream/deadline tests, durable worker/restart, actual SSH auth/pin and process-death tests |
| Concurrent workers; expired lease; changed consent/config | SQL/D1 commit races, source authority lifecycle and current consent fences |
| No source; synthetic production denial; missing payer | Registry/service/entrypoint negatives and joined unknown-payer preservation |
| Same invoice across reports; partial/excess; import with zero allocation | Joined conservation/preview/UI cases and full SFTP chain |

## Server configuration and operating instructions

No source configuration or new secret binding is installed in production. Node and Sites explicitly read only server `BANKGIRO_SOURCE_CONFIG` and server secret bindings. Browser run endpoints still accept an empty object only; no URL, owner, source override, credential or force field is accepted.

Configuration v1 is `{version:1,revision,registrations:[...]}`. A source declares:

| Parameter | Must be supplied/verified |
| --- | --- |
| revision | Monotonic positive owner-wide config revision; never roll back. |
| id / owner / companyId / bankgiro | Stable nonsecret source ID, exact authenticated owner, internal legal-entity key and bank-confirmed canonical Bankgiro text. An internal key is not an invented organization number. |
| scopeId / generation | Exact report namespace and a fresh opaque string generation after authority replacement/revocation. Retired pairs cannot be reused; ordinary operational renewal preserves authority binding. |
| mode / enabled / transport | Production, deliberate activation and `https-v1`; no synthetic source. Installation alone enables nothing. |
| baseUrl / tokenSecret | Actual approved HTTPS origin/path and server-only credential-binding name. No URL credentials/query/fragment or browser URL. Secret value lives separately in approved server secret storage. |
| profileId / allowedFormats | Actual reviewed profile and existing parser formats, not assumed bank fields. |
| intervalMinutes |1–1440; earliest eligible discovery, not proof of external execution. |
| entitlement | Actual VERIFIED provider_authorization evidenceId, checkedAt/validUntil and bankgiro_reports:read. Remote fresh authorization must match exact scope/company/profile/generation; AIS or manual evidence does not substitute. |

For SFTP deployment, follow [the isolated bridge guide](../bridge/bankgiro/README.md):dedicated OS identity, private persistent filesystem/configuration/key paths, read-only bank user, independently verified host-key fingerprint, actual directory and bounded scan limits, HTTPS reverse proxy, high-entropy server credential and provider immutable publication rules. The bridge has its own internal bounded scan loop; it never writes application financial data or creates another bank/invoice automation.

Typical verification after configuring a supported channel:

1. Install locked root/Sites/bridge dependencies and pass their check/test/audit commands.
2. Independently verify contract/identity/profile/sample and secrets; keep disabled until these are established.
3. Start the isolated bridge/proxy if required; verify authenticated host-pinned scan and exact original bytes/size/hash. A listener or schedule receipt is not a bank-download receipt.
4. Apply the trusted registration through the canonical dispatcher. It atomically binds/replaces source authority before any job; every network wait and actual write rechecks authority/expiry. No separate browser enrollment API exists.
5. Revoke/remove with an explicit higher-revision disabled/removed registration and execute its trusted lifecycle before deleting configuration/credentials. Keep retirement history; do not erase it to reuse a generation.
6. Verify a real authorized list/download/original/import receipt and review status. Prove account/deposit/customer relations independently before any allocation. Preserve originals and failed/conflicting evidence.

The existing Sites bank task invokes at its six-hour cadence. A configured shorter interval does not create more frequent external invocation; manual authorized dispatch/payment-control can also invoke the same bounded stage. Node reuses its existing minute timer. No duplicate schedule is created.

## Production baseline and activation dependencies

Before this release:Sites59, runtime revision9/17 entries, same auth client/public shell/private owner economic routes, DB/R2 and the same three enabled bank/Gmail/backup schedules. `BANKGIRO_SOURCE_CONFIG` is absent. Selected0599 AIS/report observations at revision45 are complete/current, economic count1+0, zero allocations and automaticEligible=false; account/deposit/customer proof remains missing and invoice original is unregistered. No private customer names/accounts/original hashes are published here.

Existing backup:267/267 files verified,91664627bytes, manifest_pass2026-11-02T23:55:27.281Z, no error. Fixed snapshot scope does not include a claim about later arrivals or complete production disaster recovery. Bank AIS last observed success2026-11-03T08:06:13.584Z, connected six-hour cadence, no error; AIS success is not Bankgiro report access.

Swedbank must still provide actual company entitlement, legal entity/account/Bankgiro scope and account aliases, the chosen SFTP/approved-provider channel and authentication/security arrangement, authenticated server identity, exact profile/MIG/XSD/Envelope/security requirements and approved originals, stable report/payment/deposit identities, individual payer/reference coverage, replay/retention/late-delivery/rate-limit/gap rules and operating cadence. The supplied generic transports need deployment configuration and real acceptance for supported protocols; a bank-specific proprietary wrapper/authentication outside them requires a separately reviewed adapter after its specification is known. It is not fabricated in advance.

## Release distinctions

| Status | Current receipt |
| --- | --- |
| KOD KLAR |YES — reviewed generic code and all final local gates; exact PR/main CI receipt remains a separate release gate. |
| SYNTHETISK END-TO-END KLAR |YES — actual local SSH/SFTP through retained payment/status view; no bank/TLS-proxy certification. |
| SITES PUBLICERAD |Existing59; new reviewed code publication pending. |
| VERKLIG BANKKÄLLA ANSLUTEN |NO — actual channel/entitlement/profile/identity still external. |
| AUTOMATISK PRODUKTIONSHÄMTNING VERIFIERAD |NO — no authorized real original/download receipt. |

All33 formal scores remain255/330=7.73/10,0/33 at9.5. No actual report source is activated, no economic test mutation/customer message/payment/destructive restore/force-push is performed and no new external schedule is created.
