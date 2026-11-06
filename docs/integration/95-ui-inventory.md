# Agent 6 — UI inventory, 2026-11-05

Baseline: `main` at `4ad205b84d1852ec7ed33cabd70fdadbe2f9d5c5`.
Delivery branch: `feature/95-ui`.

The inventory covers both frontends in this repository. This change improves
the Sites React workspace used by the current deployment. The self-hosted Node
frontend is recorded below and covered by the existing root regression suite;
its independent templates and styles are not redesigned by this change.

## Pages and workspace views

| Surface | Implementation | Review / change scope |
| --- | --- | --- |
| Overview | `/`, `sites/app/page.tsx`, `dashboard.tsx`, `economy-overview.tsx` | Four existing evidence-based totals, active company identity, recovery and disconnected-bank notice, responsive hierarchy |
| Customer invoices | `/?view=receivable`, `dashboard.tsx` | Search, status selector, four common filters, reset, result announcement, invoice/OCR readability |
| Supplier invoices | `/?view=payable`, `dashboard.tsx` | Same controls, preserving payable direction and existing amounts |
| Bank payments | `/?view=bank`, `bank-payments.tsx`, detail dialog in `dashboard.tsx` | Shared monochrome presentation; existing payer/reference/source decisions retained |
| Review | `/?view=review`, `payment-control.tsx`, embedded detail components | Readiness/error recovery, persistent keyboard region, mobile list/detail return, existing review decisions |
| Imports | `/?view=imports`, `dashboard.tsx` | Shared typography, targets and contextual page actions; existing import behavior |
| Contacts | `/?view=contacts`, `dashboard.tsx` | Shared controls and responsive invoice links |
| History | `/?view=history`, `dashboard.tsx` | Contextual actions and shared readable presentation |
| Settings | `/?view=settings`, `dashboard.tsx` | Contextual actions and shared form presentation |
| Connections | `/?view=connections`, `dashboard.tsx` | Contextual actions and access to existing connection workflows |
| Documents | `/?view=documents`, `gmail-workspace.tsx` | Shared shell; existing document/OCR workflows |
| Messages | `/?view=messages`, `customer-messages.tsx` | Shared shell; existing review/send separation |
| Bank connection | `/bank`, `sites/app/bank/page.tsx` | Existing company-aware onboarding and legacy connection components |
| Gmail | `/gmail`, `sites/app/gmail/page.tsx` | Existing standalone Gmail workspace inventoried |
| Customer messages | `/kundmeddelanden`, `sites/app/kundmeddelanden/page.tsx` | Existing standalone message workspace inventoried |
| Privacy / terms | `/integritetspolicy`, `/anvandarvillkor` | Existing legal route content inventoried; no legal-text edits |
| Application layout | `sites/app/layout.tsx` | Existing company boundary and stylesheet order; final workspace presentation layer |

API routes and the MCP route are request interfaces, not user-facing page
components. Their contracts, financial calculations and authorization behavior
remain unchanged.

## Functional component inventory

There are 20 top-level TSX components, 2 onboarding TSX components and 4
top-level TypeScript hooks/helpers under `sites/components`.

| Component or helper | Responsibility |
| --- | --- |
| `bank-connection.tsx` | Legacy bank connection, renewal, synchronization and accounts |
| `bank-payments.tsx` | Transaction list, summary and evidence-aware row presentation |
| `bankgiro-availability.tsx` | Missing or available Bankgiro specification explanation |
| `bankgiro-link-review.tsx` | Existing review for evidence-backed report links |
| `bankgiro-source-status.tsx` | Source availability and retrieval status |
| `company-workspace.tsx` | Active company, role, selection and isolated request boundary |
| `connector-error.tsx` | Connector failure presentation |
| `customer-messages.tsx` | Draft/message review and existing explicit actions |
| `document-ocr-status.tsx` | Document processing state |
| `economy-overview.tsx` | Dashboard totals, outstanding invoices, payments and review summary |
| `gmail-summary.tsx` | Connection summary |
| `gmail-workspace.tsx` | Documents, import status and document review |
| `invoice-evidence.tsx` | Invoice original and evidence status |
| `list-pagination.tsx` | Accessible list paging |
| `onboarding/bank-onboarding.tsx` | Company-aware bank journey and asynchronous state |
| `onboarding/bank-onboarding-views.tsx` | Company, bank, scope, account and connection views |
| `payment-control.tsx` | Control action, progress, connection overview and review queue |
| `payment-history.tsx` | Payment provenance and history |
| `payment-verification.tsx` | Evidence and verification details |
| `reconciliation-proposal.tsx` | Existing proposal review UI |
| `sync-recovery-notice.tsx` | Recovery explanation |
| `workspace-navigation.tsx` | Desktop/sidebar links and mobile modal navigation |
| `payment-bank-filter.ts` | Existing transaction grouping/filter helper |
| `use-bank-refresh.ts` | Bank refresh lifecycle |
| `use-payment-verification.ts` | Verification request lifecycle |
| `use-workspace-navigation.ts` | URL navigation, drafts and focus lifecycle |

The inline components in `dashboard.tsx` include global search, invoice table,
read-status/empty states, invoice/payment dialogs and forms, attachment/original
views, CSV/XML import, contacts, settings and shared fields/buttons. The branch
retains them rather than introducing a second evidence or financial model.

## UI primitives

The 61 existing files in `sites/components/ui` were inventoried as the reusable
primitive catalog. This branch adds no parallel component library and does not
claim a separate browser acceptance result for every unused primitive.

`accordion`, `alert-dialog`, `alert`, `aspect-ratio`, `attachment`, `avatar`,
`badge`, `breadcrumb`, `bubble`, `button-group`, `button`, `calendar`, `card`,
`carousel`, `chart`, `checkbox`, `collapsible`, `combobox`, `command`,
`context-menu`, `dialog`, `direction`, `drawer`, `dropdown-menu`, `empty`,
`field`, `form`, `hover-card`, `input-group`, `input-otp`, `input`, `item`,
`kbd`, `label`, `marker`, `menubar`, `message-scroller`, `message`,
`native-select`, `navigation-menu`, `pagination`, `popover`, `progress`,
`radio-group`, `resizable`, `scroll-area`, `select`, `separator`, `sheet`,
`sidebar`, `skeleton`, `slider`, `sonner`, `spinner`, `switch`, `table`, `tabs`,
`textarea`, `toggle-group`, `toggle`, `tooltip`.

## Self-hosted Node frontend

`public/index.html` and `public/app.js` provide the independent workspace.
`public/review.js`, `public/messages.js` and `public/payment-control.js` provide
its review, message and payment-control interfaces. Presentation lives in
`public/style.css` and `public/payment-control.css`. The two standalone legal
pages are `public/integritetspolicy.html` and `public/anvandarvillkor.html`.

Existing Node behavior is protected by the root syntax and synthetic test gates.
Sites browser screenshots must not be interpreted as new Node frontend,
production, physical-device or assistive-technology acceptance evidence.
