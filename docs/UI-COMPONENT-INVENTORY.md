# Fullständig inventering av UI-filer och komponenter

Datum: 2026-11-02. Källa: arbetskopian på `codex/final-ui-quality-2026-11-02`, efter UI-ändringarna. Inventeringen kompletterar [slutrapporten för samtliga 33 områden](FINAL-33-AREA-QUALITY-REPORT.md); den är en spårbar fil-/symbolförteckning och tillför inga kvalitetspoäng eller produktionsbevis.

**Räkneregler:** 100 primära fysiska filer = 6 app-TSX + 2 publika HTML-routes + 16 feature-TSX + 4 komponentstöd/hook-TS + 61 UI-primitiver + 2 Sites-CSS + 9 Node/public-filer. Därutöver listas 9 kompletterande UI-hjälpare, innehålls- och resursfiler: **109 unika befintliga filer totalt**. En fil kan innehålla flera komponenter; filantalet är därför inte ett skärm- eller komponentbetyg. Av de 16 feature-TSX-filerna har ConnectorError ingen aktuell appanropare.

API-/MCP-routes, serverautentisering, ekonomimotorer, parser/OCR-motorer, lagring, backup, byggkonfiguration och tester är inte UI-komponenter och ingår inte i filantalet. Anonyma JSX-/DOM-händelsehanterare hör till sin omgivande komponent. De två publika juridiska HTML-routeserna ingår eftersom de faktiskt är läsbara sidor.

## 1. Sidor, ingångar och aktiv produktstil — 19 filer

| Fysisk fil | Ansvar |
| --- | --- |
| [sites/app/layout.tsx](../sites/app/layout.tsx) | RootLayout; gemensam HTML-ram, språk och sidmetadata. |
| [sites/app/page.tsx](../sites/app/page.tsx) | Home; läser tillåten arbetsyteadress och öppnar Dashboard. |
| [sites/app/dashboard.tsx](../sites/app/dashboard.tsx) | Dashboard; de tolv arbetsytevyerna och de lokala komponenterna nedan. |
| [sites/app/bank/page.tsx](../sites/app/bank/page.tsx) | BankPage; separat sida för BankConnection. |
| [sites/app/gmail/page.tsx](../sites/app/gmail/page.tsx) | GmailPage; separat autentiserad GmailWorkspace. |
| [sites/app/kundmeddelanden/page.tsx](../sites/app/kundmeddelanden/page.tsx) | CustomerMessagesPage; separat autentiserad meddelandegranskning. |
| [sites/app/anvandarvillkor/route.ts](../sites/app/anvandarvillkor/route.ts) | Publik HTML-sida för användarvillkor; GET är en sidroute, inte ett data-API. |
| [sites/app/integritetspolicy/route.ts](../sites/app/integritetspolicy/route.ts) | Publik HTML-sida för integritetspolicy; GET är en sidroute, inte ett data-API. |
| [sites/app/globals.css](../sites/app/globals.css) | Aktiv Sites-stil för arbetsyta, listor, formulär, dialoger och responsivitet. |
| [sites/styles/bank-connection.css](../sites/styles/bank-connection.css) | Aktiv stil för den separata bankanslutningen; importeras av layout. |
| [public/index.html](../public/index.html) | Node-appens HTML-start och inläsning av de fyra UI-skripten. |
| [public/app.js](../public/app.js) | Node-appens skal, vyer, listor, dialoger och UI-händelser; namninventering nedan. |
| [public/payment-control.js](../public/payment-control.js) | Node-betalningsöversikt, granskningskö, bankpresentation och styrning. |
| [public/messages.js](../public/messages.js) | Node-kundmeddelanden och meddelandegranskning. |
| [public/review.js](../public/review.js) | Node-dokumenttolkningens sammanfattning och granskningsformulär. |
| [public/style.css](../public/style.css) | Node-appens generella layout, komponenter och responsiva regler. |
| [public/payment-control.css](../public/payment-control.css) | Node-kontrollöversiktens och betalningsvyerna specialstil. |
| [public/anvandarvillkor.html](../public/anvandarvillkor.html) | Publikt statiskt villkorsdokument. |
| [public/integritetspolicy.html](../public/integritetspolicy.html) | Publikt statiskt integritetsdokument. |

Dashboard innehåller tolv adresserbara vyer: `overview`, `receivable`, `payable`, `bank`, `imports`, `contacts`, `history`, `settings`, `review`, `messages`, `documents` och `connections`. Fristående bank-, Gmail- och meddelandesidor återanvänder feature-komponenterna; de är inte separata kopior av deras logik.

## 2. Feature-komponentfiler — samtliga 16

| Fysisk fil | Namngivna renderade komponenter | Ansvar/status |
| --- | --- | --- |
| [sites/components/bank-connection.tsx](../sites/components/bank-connection.tsx) | `BankConnection` | Bankmedgivande, kontoval, status och uttryckliga anslutningsåtgärder. |
| [sites/components/bank-payments.tsx](../sites/components/bank-payments.tsx) | `BankPayments`, `BankPaymentSummary`, `BankReference` | Banklista för desktop/mobil, sammanfattning och källmärkt referens. |
| [sites/components/bankgiro-link-review.tsx](../sites/components/bankgiro-link-review.tsx) | `BankgiroLinkReview`, `Originals` | Originalvisning och separat manuell underlagskoppling/återtagning. |
| [sites/components/connector-error.tsx](../sites/components/connector-error.tsx) | `ConnectorError` | Scaffold för återanslutningsfel; ingen aktuell app-/feature-anropare hittad. |
| [sites/components/customer-messages.tsx](../sites/components/customer-messages.tsx) | `CustomerMessages` | Kö, betalningsunderlag, utkast, mottagar-/frånvarokontroll och uttryckligt utskicksbeslut. |
| [sites/components/document-ocr-status.tsx](../sites/components/document-ocr-status.tsx) | `DocumentOcrStatus` | Läsande OCR-, schema-, kö- och efterkontrollstatus. |
| [sites/components/economy-overview.tsx](../sites/components/economy-overview.tsx) | `EconomyOverview` | Fyra ekonomiska översiktskort, nästa åtgärd och ärliga lästillstånd. |
| [sites/components/gmail-summary.tsx](../sites/components/gmail-summary.tsx) | `GmailSummary` | Kort Gmail-/OCR-/utkastsstatus i inställningarna. |
| [sites/components/gmail-workspace.tsx](../sites/components/gmail-workspace.tsx) | `GmailWorkspace` | Anslutning, dokumentkö, original och granskningsformulär. |
| [sites/components/invoice-evidence.tsx](../sites/components/invoice-evidence.tsx) | `InvoiceEvidence` | Original, avvikelseförslag och fakturans aktuella mejlutkast. |
| [sites/components/list-pagination.tsx](../sites/components/list-pagination.tsx) | `ListPagination` | Ny aktiv sidnavigering för faktura- och banklistor; inte scaffold-filen ui/pagination.tsx. |
| [sites/components/payment-control.tsx](../sites/components/payment-control.tsx) | `ControlButton`, `ControlProgress`, `ControlConnections`, `ControlQueue`, `ControlReview` | Renderade kontroll-/kökomponenter; samma fil innehåller hooken usePaymentControl och läshjälpare. |
| [sites/components/payment-history.tsx](../sites/components/payment-history.tsx) | `PaymentHistory` | Utfällbar, sidindelad verifieringshistorik per bankhändelse. |
| [sites/components/payment-verification.tsx](../sites/components/payment-verification.tsx) | `PaymentVerificationPanel`, `PaymentVerificationReport`, `AccountEvidenceResult` | Läsande verifieringssteg och separat kontoevidensresultat. |
| [sites/components/sync-recovery-notice.tsx](../sites/components/sync-recovery-notice.tsx) | `SyncRecoveryNotice` | Meddelande om stoppad bank-/Gmail-automatik. |
| [sites/components/workspace-navigation.tsx](../sites/components/workspace-navigation.tsx) | `WorkspaceNavigation`, `NavigationContents`, `WorkspaceLink`, `MobileNavigation`, `MobileMenuButton` | Desktop-/mobilmeny och länkar; fokus-/tangentbordshjälpare i samma fil. |

## 3. Hooks, presentationsstöd, innehåll och resurser — 4 primära + 9 kompletterande filer

| Fysisk fil | Typ | Ansvar |
| --- | --- | --- |
| [sites/components/payment-bank-filter.ts](../sites/components/payment-bank-filter.ts) | Komponentstöd | needsPaymentIdentification; listfilter, ingen renderad komponent. |
| [sites/components/use-bank-refresh.ts](../sites/components/use-bank-refresh.ts) | Hook | useBankRefresh; befintlig ansluten bankvys uppdateringslivscykel. |
| [sites/components/use-payment-verification.ts](../sites/components/use-payment-verification.ts) | Hook | usePaymentVerification; aktuella läsresultat och avbrutna/inaktuella svar. |
| [sites/components/use-workspace-navigation.ts](../sites/components/use-workspace-navigation.ts) | Hook | useWorkspaceNavigation; navigation, lokala filter och osparade formulär. |
| [sites/lib/workspace-location.ts](../sites/lib/workspace-location.ts) | Kompletterande UI-stöd | Tillåtna adresser och webbläsarens framåt-/bakåtnavigation. |
| [sites/lib/workspace-drafts.ts](../sites/lib/workspace-drafts.ts) | Kompletterande UI-stöd | Skydd för osparad formulärtext och inskickad formulärversion. |
| [sites/lib/payment-presentation.ts](../sites/lib/payment-presentation.ts) | Kompletterande presentationsstöd | Läsande urval/etiketter för betalare, faktura och originalreferens; ingen renderad komponent. |
| [sites/lib/account-evidence-presentation.ts](../sites/lib/account-evidence-presentation.ts) | Kompletterande presentationsstöd | Validering och visningsmodell för läst kontoevidens; ingen renderad komponent. |
| [sites/lib/legal-documents.json](../sites/lib/legal-documents.json) | Kompletterande sidinnehåll | De två publika Sites-routesernas HTML-innehåll. |
| [sites/public/favicon.svg](../sites/public/favicon.svg) | Kompletterande bildresurs | Appikon som refereras av RootLayout. |
| [sites/hooks/use-mobile.ts](../sites/hooks/use-mobile.ts) | Scaffold-hook | Mobilbrytpunkt för återanvändbara scaffold-komponenter. |
| [sites/lib/utils.ts](../sites/lib/utils.ts) | Scaffold-stöd | Klassnamnshjälpare för UI-primitiverna. |
| [sites/vendor/shadcn-tailwind-4.13.0.css](../sites/vendor/shadcn-tailwind-4.13.0.css) | Scaffold-stil | Befintlig levererad CSS-resurs; ingen aktuell appimport hittad. |

## 4. Återanvändbara scaffold-primitiver — samtliga 61

Dessa filer finns i repositoryt men är inte 61 aktiva produktskärmar. Den enda direkta importen från en feature-fil till `components/ui/` är ConnectorErrors `button`-import; ConnectorError saknar i sin tur aktuell appanropare. Primitivernas egna inbördes importer ändrar inte detta. Aktiva vyer använder huvudsakligen semantisk HTML och produktens CSS. `sites/components/list-pagination.tsx` ovan är den aktiva nya listnavigeringen; `ui/pagination.tsx` nedan är separat scaffold.

Alla filnamn i följande tabell ligger under `sites/components/ui/`; varje länk pekar på den exakta befintliga filen.

| Familj | Fullständig fysisk fillista |
| --- | --- |
| Layout och struktur | [accordion.tsx](../sites/components/ui/accordion.tsx), [aspect-ratio.tsx](../sites/components/ui/aspect-ratio.tsx), [card.tsx](../sites/components/ui/card.tsx), [collapsible.tsx](../sites/components/ui/collapsible.tsx), [item.tsx](../sites/components/ui/item.tsx), [resizable.tsx](../sites/components/ui/resizable.tsx), [scroll-area.tsx](../sites/components/ui/scroll-area.tsx), [separator.tsx](../sites/components/ui/separator.tsx) |
| Navigation | [breadcrumb.tsx](../sites/components/ui/breadcrumb.tsx), [menubar.tsx](../sites/components/ui/menubar.tsx), [navigation-menu.tsx](../sites/components/ui/navigation-menu.tsx), [pagination.tsx](../sites/components/ui/pagination.tsx), [sidebar.tsx](../sites/components/ui/sidebar.tsx), [tabs.tsx](../sites/components/ui/tabs.tsx) |
| Knappar | [button.tsx](../sites/components/ui/button.tsx), [button-group.tsx](../sites/components/ui/button-group.tsx), [toggle.tsx](../sites/components/ui/toggle.tsx), [toggle-group.tsx](../sites/components/ui/toggle-group.tsx) |
| Formulär och textfält | [field.tsx](../sites/components/ui/field.tsx), [form.tsx](../sites/components/ui/form.tsx), [input.tsx](../sites/components/ui/input.tsx), [input-group.tsx](../sites/components/ui/input-group.tsx), [input-otp.tsx](../sites/components/ui/input-otp.tsx), [label.tsx](../sites/components/ui/label.tsx), [textarea.tsx](../sites/components/ui/textarea.tsx) |
| Val och reglage | [checkbox.tsx](../sites/components/ui/checkbox.tsx), [combobox.tsx](../sites/components/ui/combobox.tsx), [native-select.tsx](../sites/components/ui/native-select.tsx), [radio-group.tsx](../sites/components/ui/radio-group.tsx), [select.tsx](../sites/components/ui/select.tsx), [slider.tsx](../sites/components/ui/slider.tsx), [switch.tsx](../sites/components/ui/switch.tsx) |
| Dialoger och överlägg | [alert-dialog.tsx](../sites/components/ui/alert-dialog.tsx), [context-menu.tsx](../sites/components/ui/context-menu.tsx), [dialog.tsx](../sites/components/ui/dialog.tsx), [drawer.tsx](../sites/components/ui/drawer.tsx), [dropdown-menu.tsx](../sites/components/ui/dropdown-menu.tsx), [hover-card.tsx](../sites/components/ui/hover-card.tsx), [popover.tsx](../sites/components/ui/popover.tsx), [sheet.tsx](../sites/components/ui/sheet.tsx), [tooltip.tsx](../sites/components/ui/tooltip.tsx) |
| Status och återkoppling | [alert.tsx](../sites/components/ui/alert.tsx), [badge.tsx](../sites/components/ui/badge.tsx), [empty.tsx](../sites/components/ui/empty.tsx), [progress.tsx](../sites/components/ui/progress.tsx), [skeleton.tsx](../sites/components/ui/skeleton.tsx), [sonner.tsx](../sites/components/ui/sonner.tsx), [spinner.tsx](../sites/components/ui/spinner.tsx) |
| Data och media | [avatar.tsx](../sites/components/ui/avatar.tsx), [calendar.tsx](../sites/components/ui/calendar.tsx), [carousel.tsx](../sites/components/ui/carousel.tsx), [chart.tsx](../sites/components/ui/chart.tsx), [table.tsx](../sites/components/ui/table.tsx) |
| Meddelanden | [attachment.tsx](../sites/components/ui/attachment.tsx), [bubble.tsx](../sites/components/ui/bubble.tsx), [message.tsx](../sites/components/ui/message.tsx), [message-scroller.tsx](../sites/components/ui/message-scroller.tsx) |
| Övriga primitiver | [command.tsx](../sites/components/ui/command.tsx), [direction.tsx](../sites/components/ui/direction.tsx), [kbd.tsx](../sites/components/ui/kbd.tsx), [marker.tsx](../sites/components/ui/marker.tsx) |

## 5. Namngivna komponenter och funktioner i de stora UI-filerna

Följande listor utgår från faktisk källkod. Dashboard har **32 namngivna funktioner på toppnivå**; public/app.js har **99** inklusive 17 pilfunktioner; payment-control.js har **23**, messages.js **3** och review.js **2**. Alla är inte renderade komponenter: formatterare, läshjälpare och åtgärdshanterare är särskilt grupperade. Konstanter och anonyma callbacks räknas inte som egna funktioner här.

| Fil / grupp | Fullständig namngiven lista inom gruppen |
| --- | --- |
| Dashboard: skal och allmänna komponenter | `Dashboard`, `Pill`, `Empty`, `Field`, `Dialog`, `ActionFooter`, `WorkspaceListStatus`, `FormError`, `DetailSurface` |
| Dashboard: sökning och listor | `WorkspaceSearch`, `InvoiceTable`, `Contacts`, `invoiceListEvidence` |
| Dashboard: faktura och kundunderlag | `InvoiceEditor`, `InvoiceDetail`, `MissingInvoice`, `CreditDialog` |
| Dashboard: bank och import | `BankImport`, `GenericBankImport`, `TransactionDetail`, `NewTransaction`, `MatchDialog`, `SplitTransaction` |
| Dashboard: inställningar och bekräftelse | `SettingsView`, `ConfirmDialog` |
| Dashboard: presentationshjälpare | `normalizeSearch`, `shortDate`, `inputMoney`, `messageOf`, `init`, `bankPresentationGroup` |
| Dashboard: äldre kvarvarande komponent | `Stat` finns definierad men används inte av aktuell Dashboard-JSX. |
| Dashboard: namngivna inre arbetsytehanterare, utanför toppnivåantalet | `refreshWorkspace`, `openTask`, `openMessage`, `navigate`, `toggleDemo`, `exportData`, `exportInvoices`, `save` |
| Dashboard: namngivna inre komponenthanterare, utanför toppnivåantalet | InvoiceEditor: `readFile`, `submit`; WorkspaceSearch: `dismiss`; BankImport och GenericBankImport: `choose`, `submit`; TransactionDetail: `fetchBankDetails`, `verify`; NewTransaction, MatchDialog, SplitTransaction och CreditDialog: `submit`. |
| public/app.js: skal, navigering och återkoppling | `brand`, `render`, `showLogin`, `toggleMenu`, `navigate`, `hero`, `empty`, `stat`, `panel`, `badge`, `invoiceBadge`, `toast`, `handleError`, `notificationItems`, `notifications`, `connectionStrips`, `tabContent` |
| public/app.js: fakturor och listor | `recentInvoices`, `invoiceSummary`, `invoiceListContext`, `invoicePayers`, `invoiceSource`, `filteredInvoices`, `filters`, `invoicePage`, `invoiceResults`, `pagination`, `upcomingRows`, `invoiceDetail`, `rerenderResults`, `exportInvoices` |
| public/app.js: bankpresentation | `bankActivationDetail`, `bankEnrichmentSummary`, `displayedBankSuggestionsUI`, `linkedReferenceConflictUI`, `bankTable`, `bankResults`, `connectionPage`, `connectionCard`, `bankSpecificationLinkedPanel` |
| public/app.js: dialoger | `closeModal`, `modal`, `bankSpecificationDialog`, `revokeBankSpecificationDialog`, `invoiceDialog`, `reconcileDialog`, `reminderDialog`, `bankDialog`, `transactionDialog`, `excludeDialog`, `undoDialog`, `activationDialog`, `disconnectDialog` |
| public/app.js: import- och dokumentgranskning | `importPage`, `documentsTable`, `importTable`, `bankgiroReviewTable`, `previewPanel`, `filePicker`, `base64`, `uploadInvoices`, `uploadInvoice`, `bankFilePicker`, `previewFile`, `commitImport`, `dismissDocument`, `dismissedDocuments`, `importDetail` |
| public/app.js: inställningar, hjälp och historik | `features`, `settingsPage`, `helpPage`, `historyPage`, `gmailSettings` |
| public/app.js: läsning, anslutning och exporthanterare | `api`, `clearWorkspace`, `refresh`, `connectBank`, `selectBankAccount`, `gmailAction`, `syncBank`, `download`, `exportAll` |
| public/app.js: formatterare och små visningshjälpare | `icon`, `gmailIcon`, `esc`, `money`, `iso`, `dayOffset`, `date`, `datetime`, `company`, `sum`, `bankConnected`, `gmailConnected`, `pendingDocs`, `byDirection`, `invoiceSearchText`, `displayReferenceUI`, `sourceLabel` |
| public/payment-control.js: renderad kontroll-UI | `controlButton`, `controlProgress`, `controlConnections`, `paymentControlOverview`, `controlQueue`, `paymentControlReview` |
| public/payment-control.js: bank-/fakturapresentation | `paymentGroupUI`, `bankFileOriginalUI`, `bankEvidenceUI`, `bankPayerUI`, `bankOCRUI`, `paymentEvidenceUI`, `bankStatusLabelUI`, `paymentTitleUI`, `bankTechnicalEvidenceUI`, `paymentBankPage`, `paymentBankResults`, `paymentInvoiceDetail` |
| public/payment-control.js: tillstånd och åtgärdshanterare | `resetPaymentControl`, `controlData`, `controlBusy`, `startPaymentControl`, `resumePaymentControl` |
| public/messages.js | `messagesPage`, `messageEvidence`, `openMessage` |
| public/review.js | `extractionSummary`, `reviewDocument` |

## 6. Spårbarhet och gräns

Inventeringen togs fram med `rg --files`, källkodsläsning och AST-avläsning av namngivna toppnivåfunktioner. Samtliga 109 länkade filer kontrollerades som befintliga; listorna för feature-TSX och de 61 primitiverna jämfördes med katalogernas faktiska innehåll. Detta dokument ändrar inga produktfiler och kör inga produkt-/integrationstester. Testutfall, verklig browseracceptans, kvarstående begränsningar och alla 33 områdespoäng hör till [slutrapporten](FINAL-33-AREA-QUALITY-REPORT.md).
