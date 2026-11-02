# Agent 6: local payment UI browser acceptance

This harness exercises the actual Sites Dashboard and product components in
headless Chromium. It uses real React, the actual global CSS compiled through
the installed Tailwind/PostCSS pipeline, and the actual bank connection
stylesheet. The boot HTML and API responses are synthetic.

The host binds only to 127.0.0.1:5173. It rejects every API request itself.
The browser context intercepts API requests and blocks external HTTP requests.
The runner rejects a non-loopback origin and disables service workers.
Navigation, evidence disclosure, filters, and retry cases allow only GET.
One separate keyboard-activation case permits exactly one POST to the existing
/api/payment-control/run path, fulfills it entirely inside Playwright with a
synthetic finished job, and rejects additional mutations. No API request is
delivered to a production or local application backend.

No credentials, customer originals, real bank records, actual payments,
registrations, mail, aliases, schedules, or Sites publication are involved.
All fixture parties, references, identifiers, and financial records are
synthetic. Fixture allocations are historical in-memory test objects.

## Final observed acceptance

The frozen run completed at 2026-11-02T22:40:45.426Z with **19 passed, 0 failed**.
Actual browser widths were **320, 390, 768, 1024, and 1440 pixels**; each passed page/dialog overflow and native keyboard/focus checks.

76 local API requests were intercepted: 75 GET requests and exactly one explicitly permitted synthetic control POST. There were **0 external HTTP requests, 0 browser JavaScript errors, and 0 asset-hash errors**.

The receipt attests 47 product input hashes and 9 emitted asset hashes before and after testing, plus the actual bytes of 5 static assets received by Chromium. It includes 22 viewport screenshots.

The auxiliary viewport field named mobileCards records the explicit max-width:760px media query used by the harness; it is not a classification of the component layout. The screenshots and element visibility checks reflect the component stylesheet’s actual responsive breakpoints.

## Coverage

The 19 behavioral cases cover:

- Actual window.innerWidth values of 320, 390, 768, 1024, and 1440 pixels,
  with page and dialog overflow measurements.
- A specific economic row's exact bank reference 0599 and an explicitly
  present missing-bank-OCR note.
- Intended invoice reference versus bank-reported reference, including
  explicit stored 0000599 versus bank-reported 0599 and a REVIEW conflict.
- Separate non-economic report observations, multiple report payers,
  missing recipient account, and missing Bankgiro details.
- Initial loading, loaded empty state, failed reads, and explicit retry.
- Malformed report/workspace data, numeric top-level reference rejection,
  and numeric nested-original reference rejection.
- A late prior-payment response after changing selection. The synthetic
  transport deliberately ignores abort for that request, waits for its
  response body to finish, then checks the current UI after two animation frames.
- Native skip-link navigation, disclosure Enter/Space, visible focus
  indication, dialog Tab confinement, Escape return focus, resize fallback,
  and mobile review-list return focus.
- Exclusion of a manually linked REVIEW payment from Verifierade despite
  a retained historical allocation.
- One intercepted primary-control dispatch with disabled/busy semantics
  during its response and no automatic advance request.

## Evidence files

The acceptance JSON contains outcomes, viewport measurements, intercepted
request methods, browser errors, screenshots, and hashes of the QA scripts.
The adjacent source manifest identifies the exact product inputs and emitted
HTML/JavaScript/CSS assets.

The builder compares source hashes before and after bundling. The runner
checks source and emitted asset hashes before and after testing, and also
hashes the actual successful static-response bytes received by Chromium.
All of these checks must pass for the final receipt to be accepted.

Viewport screenshots are intentionally bounded to the browser viewport.
They are synthetic local UI evidence, not production or physical-device
screenshots.

## Reproduce

Use the repository's installed Sites dependencies and an externally installed
Playwright package plus Chromium executable. No Playwright dependency or
browser binary is added to the repository.

If Playwright is not resolvable normally, set PLAYWRIGHT_MODULE_PATH to the
external package directory. Set MGEORGE_QA_CHROMIUM to a Chromium executable,
or let Playwright use PLAYWRIGHT_BROWSERS_PATH and its normal installed browser.
The runner can also discover an existing Chromium executable beneath the
dedicated QA scratch browser directory.

From the repository root:

    node docs/integration/agent-6-browser/build-harness.mjs

In a separate process:

    node docs/integration/agent-6-browser/serve-harness.mjs

Then:

    node --experimental-strip-types docs/integration/agent-6-browser/browser-acceptance.mjs all

Generated web assets and results default to the operating system temporary
directory under mgeorge-payment-ui-qa. Override MGEORGE_QA_SCRATCH or
MGEORGE_QA_OUTPUT when necessary. MGEORGE_QA_REPO is optional; by default
the repository root is inferred from these scripts' location.
MGEORGE_QA_BASE must remain a loopback HTTP origin.

Useful scopes:

    MGEORGE_QA_WIDTHS=320,768 node --experimental-strip-types docs/integration/agent-6-browser/browser-acceptance.mjs viewports
    node --experimental-strip-types docs/integration/agent-6-browser/browser-acceptance.mjs states

The managed environment required ordinary execution escalation for browser
child processes and loopback listening. Proxy and certificate settings were
preserved. The full Sites Vite dev startup exited 137 during RSC/SSR dependency
optimization under concurrent test load; this standalone host avoids worker
startup while exercising actual frontend code and stylesheet bytes.

## Runtime and limits

The observed runtime uses Node 24.22.1, npm 11.9.0, global Playwright 1.62.1,
and Chromium Headless Shell 141.0.7390.37. The runtime's Chrome 151 archive
endpoint returned an unavailable HTML page. The official Playwright 1.56.1
installer obtained Chromium 141 through its supported Microsoft mirror using
the inherited proxy. Browser binaries and installation caches are external
to this repository.

These tests do not certify production authentication, live backend contracts,
bank relationships, external scheduling, physical mobile devices, screen
readers, other browser engines, or actual financial correctness. The project
CI's Node 22 gates remain separate from this Node 24 browser harness.
