# SaaS onboarding browser acceptance

This harness bundles the actual `sites/app/bank/page.tsx`, onboarding components, contract/client and existing legacy components with the application's CSS. It uses synthetic companies, accounts and payment evidence. All `/api/*` responses are intercepted; every external request is blocked and causes acceptance to fail. No provider or production service is contacted.

## Recorded result

The final run passed **41/41 scenarios**, with **115 intercepted API requests**, **zero JavaScript errors** and **zero external requests**. See [acceptance-results.json](acceptance-results.json) for each scenario, browser version, source SHA-256 manifest, generated asset hashes and checks of the bytes actually served to the browser. These hashes are checked before and after the run; editing product sources during a run invalidates its result.

Chromium headless shell **141.0.7390.37** was driven using Playwright **1.62.1** in the local Linux environment. This is isolated frontend acceptance, not a live provider/callback, physical-device, Safari/Firefox or real assistive-technology certification. The production build is checked separately in the [delivery report](../saas-customer-onboarding-verification.md).

## Reproduce

Use the repository's supported Node version, install `sites/` dependencies with `npm run install:ci`, and provide Playwright and its Chromium executable outside the application dependency tree. No package manifest or lockfile is changed by this harness.

From the repository root:

```bash
node docs/integration/saas-onboarding-browser/build-harness.mjs
PLAYWRIGHT_MODULE_PATH=/absolute/path/to/playwright \
MGEORGE_QA_CHROMIUM=/absolute/path/to/chromium-headless-shell \
node docs/integration/saas-onboarding-browser/browser-suite.mjs
```

When available, `CODEX_PRIMARY_RUNTIME_NODE_MODULES` supplies Playwright instead of `PLAYWRIGHT_MODULE_PATH`. `MGEORGE_QA_CHROMIUM` is optional if the matching Playwright browser is already installed. `MGEORGE_ONBOARDING_QA` can set an alternate scratch output directory; the default is the operating system's temporary directory plus `mgeorge-saas-onboarding-qa`.

The runner starts its own loopback server at port 5178 in the same process tree as the browser. The server rejects API calls and writes if interception is accidentally removed. Do not point this runner at a live application. `MGEORGE_QA_FILTER` can select a case while developing a fix; the recorded final receipt comes from an unfiltered run.

## Coverage

| Area | Checks |
| --- | --- |
| Responsive layout | Actual viewport widths 320, 390, 768, 1024 and 1440; no horizontal page/dialog overflow. |
| Keyboard and semantics | Named native form controls, skip-link target, visible focus, modal initial focus, Tab containment, Escape and opener focus restoration. The skip link returns outside the viewport when focus leaves it. |
| Provider handoff | Required read scopes, company-scoped POST with CSRF/idempotency headers, exact server-minted redirect path, rejected external redirects, delayed navigation kept locked. |
| Authorization | Callback cancellation/failure/expiry, forged success query, decoupled pending/completed/cancelled/failed states, renewal, missing/expired consent and no fake BankID action for unsupported banks. |
| Company isolation | Creation followed by membership reload, switching companies, A → B → A late reads, late mutation redirects, invalid nested company IDs, unauthorized company query and 401/403 clearing. |
| Stale/uncertain state | Old snapshots, revision regression, slower status reads, bounded client deadline, uncertain creation, accepted account selection absent from the fresh response, duplicate clicks and company-specific fallback refusal. |
| Truthful bank/payment facts | AIS without Bankgiro, missing payer/reference, preserved leading zeroes, account selection and the first completed sync revealing the overview automatically. |
| Action eligibility | Viewer restrictions, consent/revocation checks, confirmation before disconnect and disabled sync for selected accounts that cannot be imported. |

The request deadline/cancellation assertions and further timestamp, currency, scope and evidence invariants live in the ordinary Node-run Sites test suite. They supplement the browser scenarios; they are not counted again in the browser total.

## Screenshots

Each image is captured after the keyboard checks, from scroll position zero without hiding any product element. All company, provider and payment details are synthetic.

- [320 px](screenshots/onboarding-320.png)
- [390 px](screenshots/onboarding-390.png)
- [768 px](screenshots/onboarding-768.png)
- [1024 px](screenshots/onboarding-1024.png)
- [1440 px](screenshots/onboarding-1440.png)
- [Account connected, Bankgiro/reference missing](screenshots/missing-bankgiro-reference.png)

The final visual review checked all five widths, monochrome hierarchy, account labels, reference `0000599`, review status and honest missing-data labels. Earlier full-page captures taken after keyboard scrolling placed the offscreen fixed skip link inside the image; viewport geometry and corrected captures confirm this was a screenshot-origin artifact. The final images do not contain that overlap.
