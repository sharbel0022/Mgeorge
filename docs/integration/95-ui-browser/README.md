# Isolated UI browser acceptance

This harness mounts the actual `sites/app/dashboard.tsx`, `sites/app/bank/page.tsx`, and `sites/components/company-workspace.tsx` with production React. Esbuild bundles their real imports. Tailwind/PostCSS compiles `sites/app/globals.css`; the real bank connection, Bankgiro source, SaaS onboarding, company workspace, and workspace design stylesheets follow it in product order. The harness does not reproduce product screens or override product styles.

Only the HTML entry, network guard, and local API fixtures are test infrastructure. All companies, invoices, account identifiers, and bank originals are synthetic. No production credentials, customer originals, backend, bank provider, or mail provider are used.

## Build and serve

From the repository root, with the existing `sites/node_modules` already installed:

```sh
node --experimental-strip-types docs/integration/95-ui-browser/build-harness.mjs
node --experimental-strip-types docs/integration/95-ui-browser/serve-harness.mjs
```

Open <http://127.0.0.1:5195/?scenario=standard>. The bank onboarding page is <http://127.0.0.1:5195/bank?scenario=onboarding>. Existing product URLs such as `/?view=receivable`, `/?view=review`, and `/?view=bank` work with the same scenario cookie.

The server binds **127.0.0.1 only**. `MGEORGE_95_UI_PORT` changes the default 5195 port. `MGEORGE_95_UI_QA` changes the default `/tmp/mgeorge-95-ui-qa` output directory. Serve and build must use the same output directory. The server reads built assets on each request, so rebuilding updates them without restarting; fixture or server source changes require a server restart.

Some managed execution environments give each shell invocation its own network namespace. In that environment, start this command through the same native terminal/runtime that the connected browser can reach. A server started in another namespace is not reachable merely because it printed a loopback URL. `server.test.mjs` starts its server as a child of the test process so that both share the same namespace. This harness does not bypass environment networking controls.

## Scenarios

An explicit `scenario` query on `/` or `/bank` starts a new synthetic session and resets its read counters. Navigation and company switching without that query retain the cookie. Use one scenario at a time per browser profile; another tab that starts a scenario replaces that origin's cookie.

| Scenario | Workspace behavior | Bank onboarding behavior |
| --- | --- | --- |
| `standard` | Seven invoices (five receivable, two payable), eight bank/evidence rows, three review tasks, two selectable companies. | Existing synthetic connection and selected account; bank-account reference `0000599` remains an unverified payment. |
| `loading` | Company access resolves; `/api/state` remains pending until navigation or request cancellation. | Fresh synthetic snapshot if opened directly. |
| `error` | `/api/state` consistently returns a synthetic 503. | Fresh synthetic snapshot if opened directly. |
| `empty` | Successful empty invoices, transactions, imports, and review queue. | Fresh synthetic snapshot; this scenario targets workspace empty states. |
| `missing-bank` | Invoices remain, bank transactions and imported reports are absent. | No connection, accounts, or payments. |
| `onboarding` | Standard synthetic workspace. | Disconnected bank chooser, read permissions, and synthetic company selection. |
| `error-after-first-read` | First state read 200; second 503; third and later 200. Use the actual **Uppdatera** and retry buttons to test failure and focus restoration. | Fresh synthetic snapshot if opened directly. |
| `legacy-connected` | Standard synthetic data with the legacy company boundary. | The actual `BankConnection` component, confirmed consent valid for another day, and one selected account. |
| `legacy-unknown-expiry` | Standard synthetic data with the legacy company boundary. | `BankConnection` receives an empty consent expiry. It must not claim confirmed active consent. |
| `legacy-expired` | Standard synthetic data with the legacy company boundary. | `BankConnection` receives an expiry one minute before response time and must require renewal. |
| `legacy-disconnected` | Standard synthetic data with the legacy company boundary. | `BankConnection` receives no connection and exposes its bank chooser. |

Dates and money are fixed fixture values. The onboarding snapshot `checkedAt`, authorization expiry, and consent times are relative to response time because the production contract intentionally rejects stale snapshots. No browser clock is modified.

The overview response uses the actual read-only `economySummary` projection with an explicit summary date of **2026-11-05**. Standard values are **0 kr received**, **6 245 kr remaining receivables**, **875 kr payable through 2026-11-12**, and **3 review tasks**. The zero received amount is intentional: the fixture includes bank originals but no booked invoice allocations. The latest confirmed payments section must therefore explain that no verified payment links are available, without implying that no money reached the bank.

For legacy surface checks, navigate directly to `/bank?scenario=legacy-connected` (or another `legacy-` scenario) without a `company` query. Those scenarios provide the actual legacy company-directory response and a deliberate onboarding-directory 404, which activates BankPage's existing `BankConnection` fallback. This expected 404 is not missing fixture coverage. Other scenarios retain SaaS onboarding. Synthetic auto-sync is a documented no-op; it performs no provider request or financial change.

## Evidence cases

The fixture reuses `agent-6-browser/fixtures.mjs` and the production test helpers `bank-api-fixture.mjs` and `saas-onboarding-fixture.mjs`.

- Invoice **0000599** and the corresponding synthetic bank payment preserve all leading zeroes. The bank's value is a **payment reference**, with no bank-reported OCR. A matching invoice number does not invent OCR evidence.
- `qa-verified-bank-payer` has an individual payer taken from a SHA256-bound synthetic bank API original. The product presentation exposes **Syntetisk Norrvik Studio AB** as that bank payer. It has no allocation and does not claim that the invoice has been paid or reconciled.
- `qa-missing-bankgiro` lacks individual Bankgiro details and verified payer identity. The product must display the unknown identity and missing evidence rather than promote a suggested invoice customer into a bank payer.
- `qa-missing-account` has a synthetic report without its recipient account.
- `qa-multiple-payers` has two report observations with separate payers. The observations are not separate counted cash deposits and do not prove a single payer for the collective deposit.
- The three review tasks point to actual fixture transactions. Verification responses explicitly have `changed: false`, `automaticEligible: false`, and no booked allocation.
- `/api/files` returns a deliberate 404. No synthetic proof placeholder is passed off as an accessible customer original.

Company switches use the actual CompanyWorkspace client and synthetic versioned company context. Only company/account selection, automatic-read preference, synthetic disconnect/handoff preparation, and no-op sync have fixture handlers. Financial writes, mail sending, unlisted actions, and all upstream routes are rejected. A synthetic authorization response contains a local handoff path, but the harness does **not** implement real authentication or provider redirect completion. The legacy connect action returns an explicit synthetic 503 rather than opening a bank provider.

## Isolation and logs

The server has no proxy or upstream configuration. It rejects non-loopback Host headers, foreign Origin headers, stale company selectors, unsupported resources, and unknown APIs. Mutations require the exact local Origin and JSON content. Only listed synthetic state transitions run. The process disables common HTTP, HTTPS, TCP, TLS, and fetch outbound entry points. Browser CSP restricts resources and connections to the local origin; the entry additionally rejects external fetch/navigation. These are test guards, not substitutes for production authorization.

`/tmp/mgeorge-95-ui-qa/requests.jsonl` records timestamp, method, path, synthetic scenario/company, and response status. It omits query values, cookies, arbitrary headers, and request bodies. Unknown API requests remain visible as failures so missing fixture coverage cannot silently use production.

## Focused automated verification

```sh
node --experimental-strip-types --test docs/integration/95-ui-browser/fixtures.test.mjs
node --experimental-strip-types --test docs/integration/95-ui-browser/server.test.mjs
```

The first file checks fixture integrity using the actual payment presentation, company client, and onboarding parsers. The second starts a child HTTP server, reads the actual built JS, and verifies local origin rejection, company selection, unknown/economic route rejection, and the 200 → 503 → 200 retry sequence. Build before the server test. These tests neither launch nor drive a browser and do not prove visual acceptance.

## Browser acceptance and source hashes

Use [browser-acceptance.md](browser-acceptance.md) to record actual viewport sizes, actions, screenshots, and observed results. Do not mark a browser assertion passed from the fixture or HTTP tests alone. Browser actions are intentionally performed by the connected browser tool or a human; no Playwright launch is part of this harness.

The build writes `bundle-source-manifest.json` under the output directory. It records SHA256 hashes for every bundled product source, all six stylesheets, harness and fixture source files, and each generated asset, plus toolchain versions. A build fails if a product input or harness source changes during compilation. Rebuild after the final product edits, then retain the exact manifest for the browser run:

```sh
cp /tmp/mgeorge-95-ui-qa/bundle-source-manifest.json docs/integration/95-ui-browser/bundle-source-manifest.json
```

Do not reuse screenshots or source manifests from an earlier bundle after changing product code. Production access, delivery, bank authorization, live schedules, and actual external integrations remain outside this isolated acceptance scope.

## Exact viewport frame

Open `http://127.0.0.1:5195/qa-frame?width=320&height=900&scenario=standard&view=overview` to test the actual app in the named iframe `qa-app`. Its content viewport uses the requested CSS width and height with no scaling. Native selectors offer widths 320, 390, 768, 1024 and 1440, all synthetic scenarios, and workspace views. Choose `bank-page` for the dedicated `/bank` page; `bank` is the dashboard bank view. Press **Visa** to apply the selectors. Wide frames require horizontal scrolling when the outer browser is narrower.

The app document permits embedding only by the same local origin; the frame wrapper itself cannot be embedded. Each frame load resets its scenario session through the actual app URL. Use one scenario per browser profile at a time, as described above.
