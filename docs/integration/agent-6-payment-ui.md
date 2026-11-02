# Agent 6 — betalningsöversikt och frontendintegration

## Uppdrag och bas

Branch: `feature/mgeorge-payment-ui`. Startbas: `73662187cddf9a5c504dea9bd8a1288bd929bc51`. Det tidigare opushade arbetet återupptogs på den kontrollerade basen `a779b0dd8d184eaf6e6d6e636c555c967f15f3d5` från `origin/main` den 2 november 2026. Den omfattar det gemensamma kontraktet från PR #22 och integrationskvittona #23–24. En separat kopia bevarar originalarbetet. Befintlig Sites-frontend används; inga nya externa API-endpoints, ekonomimotorer, databasscheman eller produktionsskrivningar införs. Merge och publicering tillhör integrationsansvarig.

## Genomförandeplan

**Mål:** visa fakturanummer, avsedd referens, faktiskt bankrapporterad referens, betalare/källa och återstående kontroll utan att göra granskningsunderlag till nya pengar eller verifierad bankfakta.

**Arkitektur:** läsande projektion av befintliga `Invoice`, `Transaction`, `State`, `BankgiroLink` och `PaymentVerification`. Befintliga `bankPaymentFieldSources`, `bankPaymentInvoiceAssessment` och `economicTransactions` bestämmer källor, förslag och ekonomiskt medlemskap. Inga beslut skrivs av presentationskod.

**Teknik:** Sites React/TypeScript och befintliga node:test-/ReactSSR-fixturer. Faktisk lokal Chromium används med en byggd kopia av den riktiga Dashboard-komponenten och dess CSS; endast syntetiska API-svar och data.

1. [x] Regressioner först för avsedd referens `0599`, separat bankreferens/OCR, saknat konto, rapportobservationer och flera betalare. Implementera läsande presentationsfält i `sites/lib/payment-presentation.ts`.
2. [x] Uppdatera `sites/components/bank-payments.tsx`, begränsade delar av `sites/app/dashboard.tsx` och tillhörande CSS. Behåll 50 synliga rader per sida, svenska statusar, källor och huvudfunktionen **Kontrollera alla betalningar**.
3. [x] Visa sammanfattad verifieringsstatus och exakt återstående kontroll ovanför befintliga detaljsteg. Prova felaktiga/inaktuella svar, laddning och tomma tillstånd.
4. [x] Kör lokala obligatoriska kontroller, oberoende kodgranskning samt faktisk lokal mobil-/desktop-/tangentbordsacceptans. Dokumentera exakta resultat och begränsningar. Egen branch levereras genom PR mot `main`; dess Node 22-CI är separat mergegrind.

### Särskilda granskningsfall

- En manuellt styrkt underlagsrelation måste fortsatt vara REVIEW, även när original är intakta.
- AIS och rapport med samma datum/belopp får aldrig slås ihop utan befintlig uttrycklig relation.
- Ett giltigt OCR-liknande nummer utan typad originalkälla är en betalningsreferens.
- Flera individuella betalare måste behålla sina separata rader, referenser och källor.
- Ett sent eller felaktigt svar får inte lämna en tidigare verifierad markering för ett annat objekt eller en annan revision.

## Befintliga kontrakt som konsumeras

| Gemensamt begrepp | Befintlig källa | Frontendregel |
| --- | --- | --- |
| InvoiceReferencePolicy | `domain.ts: Invoice.direction/number/ocr` och användarens policy | Uttrycklig `Invoice.ocr` bevaras som avsedd referens. Saknad deklaration visas som saknad tills Agent 1:s granskade företagsprojektion är integrerad; frontend inför ingen egen global nummerpolicy. Avvikelse från bankens observerade referens kräver granskning. Ett separat fakturanummer är inte i sig en konflikt eller bank-OCR. |
| BankAccountEvidence | `account-evidence-presentation.ts`, `PaymentVerification.steps`, `Transaction.bankAccountIssue/bankgiroAccountIssue` | Saknad, tvetydig eller spärrad kontoevidens visas med kvarstående kontroll. |
| BankTransaction / IndividualPayment | `domain.ts: Transaction`, `economicTransactions` | Ekonomisk betalning skiljs från samlingspost och granskningsobservation. |
| BankgiroReport | `Transaction.specification`, `bankFileProof`, `reportEvidence`, `State.imports` | Bevarat/importerat underlag är inte bevis på automatisk rapporthämtning. |
| PaymentReference | `payment-presentation.ts: bankPaymentFieldSources`, typad `referenceEvidence/referenceParts` | Bankens visade värde och klassificering kommer från samma valda original. |
| ReportDepositRelationship | `domain.ts: BankgiroLink`, `activeBankgiroLink` | Endast uttrycklig aktuell relation sammanför källor. `method: manual_review` förblir manuell relation. |
| ReconciliationDecision | `PaymentVerification` och befintlig `bankPaymentView` | Presentationen förklarar befintligt underlag; den skapar inga allokeringar eller nya verifieringsbeslut. |
| ImportJobStatus | Befintlig bankanslutning visar AIS-tid; separat rapportkvitto saknas på basen | Automatisk Bankgirorapporthämtning, dess senaste lyckade körning och exakta bankbehörigheter visas som ej verifierade tills annat uppdrags dokumenterade kontrakt finns. AIS-tid får aldrig återanvändas som rapporttid. |

Det gemensamma semantiska kontraktet **`mgeorge-integration-v1`**, infört via PR #22, har lästs och konsumeras. Det introducerar inga färdiga nya runtimeexporter för C1/C3/C5. Denna PR dokumenterar befintliga Sites-typer och additiva presentationsfält; den skapar inte en konkurrerande frontend/backendmodell.

Vid återupptagningen togs den tidigare globala kundfakturafallbacken bort efter oberoende granskning: den saknade företagsscope och kunde konkurrera med C1. Samma skäl tar bort en automatisk konfliktetikett enbart för att fakturans deklarerade referens skiljer sig från fakturanumret. Faktisk konflikt mot bankreferensen bevaras. Agent 1 äger företagspolicyn och dess projektion. PR #27 föreslår andra aktiverings- och konfliktsemantiker som integrationsansvarig måste granska innan C6 kopplas till dem. Denna branch ändrar inga av dessa gemensamma kontrakt eller aktiveringsregler.

## Additiva frontendexporter och konsumenter

Ingen HTTP-endpoint, databastabell, migration, providerparameter eller versionsändring av `State.schemaVersion` införs. Inga beroenden eller låsfiler ändras. Node-ekonomimotorn och Sites skrivgränser är oförändrade.

| Plats / export | Tillagt kontrakt | Konsument |
| --- | --- | --- |
| `sites/lib/payment-presentation.ts: invoiceIntendedReference` | Läsande `Pick<Invoice, 'direction' \| 'number' \| 'ocr'> → string`; enbart befintlig uttrycklig referens tills C1 är integrerad. Inga nummer konverteras eller inledande nollor återskapas. | Bank-, fakturalista och fakturadetalj. |
| `bankPaymentView(...).intendedReferences` | `{number: string, value: string, proposal: boolean, source: string, conflict: boolean}[]`. Endast befintliga registrerade/allokerade fakturor kan leverera en avsedd referens; ett sökförslag är inte en registrerad faktura. | `BankPaymentReferences` och banksökning. |
| `bankPaymentView(...).decision` | Lokal läsande `{code: 'VERIFIED' \| 'REVIEW' \| 'BLOCKED', label: string, reason: string, next: string}`. Förklarar sparat underlag; är ingen ny behörighet att bokföra. | Banklista, filter, sammanställning, fakturalista och detaljer. |
| `bankPaymentCounts(...).observations` | Separat antal synliga icke-ekonomiska observationer. Ekonomiskt medlemskap följer befintlig `economicTransactions`. | Banköversikt. |
| `BankPaymentReferences` | `{view: ReturnType<typeof bankPaymentView>}`. Separat avsedd och bankrapporterad referens med respektive källa; OCR-etiketten följer just bankfältets original. | Banklista och betalningsdialog. |
| `BankReportAvailability` | `{state: State, demo?: boolean}`. Visar uttryckligen att automatisk rapportkälla, behörighet och hämtningskvitto inte är bekräftade i befintligt kontrakt. | Befintlig bankvy efter lyckad arbetsyteläsning. |
| Befintlig `PaymentVerificationPanel` | Sammanfattar befintliga elva steg före detaljerna. Alla obligatoriska steg, aktuell ekonomisk post och bokad allokering krävs för VERIFIED; manuell relation ger REVIEW, saknad/motsägande evidens BLOCKED. | Befintlig betalningsdialog. |

Legacyfälten `bankPaymentView.verified/status` lämnas kvar för befintliga konsumenter. Nya statusetiketter, räknare och filtret **Verifierade** använder `decision` för att undvika motsägande gamla etiketter. Bokade belopp och historiska allokeringar bevaras även när underlag behöver granskas.

`readableWorkspace` kontrollerar transportens läsbara form innan `/api/state`-svaret når React. Felaktiga listor, referenstyper (inklusive inbäddat original), datum och grundläggande belopp avvisas utan typkonvertering. Befintlig servervalidering och samtidighetskontroll är fortfarande skrivgränsen. Ett numeriskt `599` görs aldrig om till texten `0599`.

## Levererat beteende

- Svartvit banköversikt med stora fakturanummer, individuella betalare/källor, betalningsdatum och belopp. Avsedd referens, bankreferens och formell OCR hålls isär.
- Svenska statusar **Verifierad**, **Behöver granskas** och **Blockerad**, med konkret återstående kontroll på varje rad och ovanför verifieringsstegen.
- Manuella rapportrelationer och ogranskade/saknade fakturaoriginal kan inte ge ett verifierat betalningsmärke. Källorna för betalare, referens och faktura märks separat även när de kommer från olika original.
- Separat grupp **Underlag · räknas inte som pengar**, med **Underlagsbelopp** utan kreditliknande plusmarkering. Befintlig uttrycklig relation och `economicTransactions` styr urvalet; inget nytt datum-/beloppsbaserat dedupantagande införs.
- Befintliga 50 rader per sida, memorerad presentationsberäkning för synliga rader, mobilkort, synligt tangentbordsfokus och textbrytning i smal betalningsdialog. Ingen global cache av finansiell evidens.
- Huvudknappen **Kontrollera alla betalningar** använder samma befintliga kontrollflöde. Sidvisning initierar inte bankhämtning eller allokering.

## Beroenden och begränsningar

1. Automatisk Bankgirohämtning, dess senaste lyckade körning och exakta behörighetsfel kan inte bekräftas utan C3/C5:s verkliga serverprojektion. UI visar den luckan och nästa åtgärd. AIS-synktid, importerad fil och sparat rapportunderlag används aldrig som ersättande hämtningskvitto.
2. En faktiskt bankauktoriserad rapportkälla och erforderliga bankbehörigheter måste tillhandahållas av ansvarig integration. Ingen providerendpoint, åtkomst eller BankID-åtgärd hittas på.
3. Full C1-policyintegration och den nya sammanhängande C1→C5-kedjan beror på de andra implementationerna. Lokala typade syntetiska underlag verifierar befintliga frontendgränser, inte en ännu ej levererad produktionskedja.
4. Listans beslut beskriver det sparade underlaget. Den befintliga aktuella verifieringsendpointen granskar betalnings-/originalstatus när betalningen öppnas. UI skapar aldrig en ny allokering på grund av ett grönt märke.
5. Browseracceptans sker i lokal Chromium med syntetiska svar. Det är ingen inloggad produktionsresa, fysisk mobil eller verifiering av Swedbanks verkliga svar. Ingen Sites-publicering ingår.
6. Tidigare full lintskuld och 16 moderate utvecklingsberoendefynd ligger utanför denna frontendleverans; inga tester eller säkerhetsgrindar försvagas för att dölja dem.

## Återupptagning och beslut

- Beslut: återanvänd tidigare implementation och syntetisk browserharness i en separat checkout; kör färska slutgrindar på den faktiskt levererade koden. Äldre testkvitton används som historik, inte som bevis för nya ändringar.
- Beslut: använd konservativ uttrycklig referens på befintlig `main` tills C1-projektionen är granskad. Detta skjuter automatisk härledning för äldre fakturor utan deklaration till samordnad integration; det undviker konkurrerande företagspolicy.
- Beslut: saknade individuella bankuppgifter har BLOCKED-prioritet före en referens- eller underlagsrelation som behöver REVIEW. Fullständiga manuella underlagsrelationer förblir REVIEW. Ursprunglig chargeback-förklaring bevaras.
- Ogiltiga fakturaförslag avvisas vid läsgränsen. HTTP-/transportfel har egen tillgänglighetsstatus och GET-återförsök; lagrade bankfakta kan visas utan att uteblivna förslag framställs som ett lyckat tomt resultat. Revision, dokumentepok och återförsöksnummer avgränsar svaren.
- Varje misslyckat svar efter ett skickat sparanrop kan innebära att ändringen redan sparats. Befintlig backend kan exempelvis spara konfliktbevis och ny revision innan HTTP 400 returneras. UI kräver därför en lyckad ny GET-läsning före nästa skrivning, även för ett kvarhållet gammalt eventhandler. Inget automatiskt omskick görs. En redan öppen betalningsdetalj visar ett läsfel och återförsök i stället för tidigare bankfakta under denna osäkerhet; formulärtillståndet bevaras.
- Den läsbara arbetsyteformen kontrollerar också historikposter, frivilliga avstämningsnoteringar, nästlade referenskandidater/varningar/valt värde, betalare och rapportfält innan de når komponenter. Historikens JSON måste vara ett objekt och dess visade meddelande text.

### Oberoende granskning och rättade fynd

En första oberoende genomgång identifierade kandidatsvar, osäkra sparresultat, statusprioritet, ofullständig fältvalidering och en konkurrerande global fakturapolicy. Dessa rättades med RED→GREEN-regressioner. Slutgranskaren fann inga kritiska fynd, men två viktiga fel på det då granskade underlaget: även HTTP 400 kan följa en sparad ändring, och felaktiga nästlade referens-/rapportfält kunde krascha den riktiga detaljvyn. Båda är rättade med egna regressioner och ingår i fullsviten. Författaren kompletterade dessutom två tester för en redan öppen detalj efter ett osäkert sparresultat. Slutgranskarens tidigare utlåtande anges inte som en oberoende omgranskning av de efterföljande rättningarna.

### Samordning med nu levererade producent-PR:er

- C1: [PR #27](https://github.com/sharbel0022/Mgeorge/pull/27), läst huvud `5fada91427ee49d98897802eeb7a2aeede73fbf7`. Konsumera den godkända `referencePolicy`/`intendedPaymentReference`-projektionen vid integration; aktivera ingen andra policy i frontend. Företagsscope och motsägande deklarationer behöver samordnat godkännande. Testfixturer använder deklarerade textreferenser tills dess.
- C3: [PR #26](https://github.com/sharbel0022/Mgeorge/pull/26) innehåller `BankgiroSourceStatus` och `GET /api/bankgiro/source/status`. Samordna den med `BankReportAvailability` så att två motstridiga paneler inte visas. På denna bas saknas endpointen. Dess föreslagna offentliga svar saknar fortfarande separat kvitto för senaste lyckade rapporthämtning; `nextPollAt`, jobb och AIS-tid ersätter inte ett sådant kvitto.
- C2: [PR #25](https://github.com/sharbel0022/Mgeorge/pull/25). Befintliga kontoevidens-/felgränser konsumeras utan att hitta på nya bankfält. Integratören bevarar C2:s aktuella konto- och medgivandekontroller.
- C4: [PR #28](https://github.com/sharbel0022/Mgeorge/pull/28), läst huvud `9f8b6f17c791639bc65f2c4eb018f25eee75f09e`, föreslår `mgeorge-reconciliation-v1` och läsande `GET /api/reconciliation/preview`. Den projektionen gäller förslag, `writesAllowed:false` och separat godkännande. C6:s befintliga etikett för sparat underlag får inte användas som ersättning för dess beslut, snapshot eller godkännande. Båda flödena måste benämnas tydligt vid integration.
- C5: [PR #29](https://github.com/sharbel0022/Mgeorge/pull/29), läst huvud `b219d63a27c759019ccef937e0b557dfa3c03e7a`, föreslår `ImportJobStatus` version `1.0` och läsande `GET /api/import-jobs`. `observedAt` är lästid; bara ett `lastSuccessAt` för rätt jobb är ett lyckat körkvitto. `bank_sync` styrker inte Bankgirorapporthämtning. `bankgiroPreparation` är en förberedelse, inte ett utfört jobb. Koppla dessa fält först tillsammans med C3:s granskade käll-/jobbmappning.

Samtliga producent-PR:er ovan var öppna vid slutkontrollen; `origin/main` var fortfarande `a779b0d`. De är lästa integrationsberoenden, inte inmergade implementationer i denna branch. Denna PR inför inga anrop till deras ännu ej tillgängliga endpoints och genomför ingen merge/publicering.

## Verifieringskvitto

Lokala körningar använder Node **24.22.1** / npm **11.9.0**. Repositoryts obligatoriska PR-CI använder Node **22**. Exakt leverans-SHA, PR-nummer och CI-körning publiceras i PR:ns leveranskvitto. Ett dokument som ingår i samma commit kan inte ange sin egen ännu okända commit-SHA. Inga äldre PR-resultat används som bevis för denna kod.

| Kontroll | Observerat lokalt resultat |
| --- | --- |
| Låst rootinstallation `npm ci --ignore-scripts` | Godkänd. |
| Låst Sitesinstallation `npm run install:ci` | Godkänd; installerad minimatch-backport applicerad. |
| `node scripts/minimatch-backport.mjs --check --require-target` | Godkänd: 1 mål, 0 nya skrivningar, `verified`. |
| Root `npm run check` | Godkänd: 121 JavaScript-filer. |
| Root `npm test -- --test-concurrency=2` | **1309/1309**, 0 fail/skip/cancel/todo; 373450,834 ms. Rootkoden och dess tester är oförändrade mot `a779b0d`. |
| Sites `npm run check` | Godkänd på fryst slutlig källkod. |
| Sites `npm test -- --test-concurrency=2` | **2411/2411**, 0 fail/skip/cancel/todo; 139235,378 ms. |
| Sites `npm run build` | Godkänd på fryst kod: exit 0 och `Build complete.`; 25,732 s. |
| Root `npm audit --audit-level=high` | Godkänd: 0 sårbarheter. |
| Sites `npm audit --omit=dev --audit-level=high` | Godkänd: 0 produktionssårbarheter. |
| Full Sites `npm audit --audit-level=high` | Godkänd high-grind: 16 befintliga moderate utvecklingsfynd, 0 high/critical. |
| Faktisk Chromiumacceptans | **19/19** på slutlig kod, 0 JavaScriptfel, externa HTTP-anrop eller horisontella overflowfel. |

Totalt **3720 godkända Node-/Sites-testfall** och separat **19 godkända browserfall**. Riktade omkörningar räknas inte igen som unika tester. Inga tester, assertions, belastningar eller tidsgränser har tagits bort eller försvagats. CI kör repositoryts ordinarie `npm test` utan lokal begränsning av filparallellism.

### Nya regressioner

Sites-sviten har **74 fler körda fall** än den kontrollerade basens 2337. Nya sviter är `payment-overview-ui.test.mjs` och `payment-verification-summary.test.mjs`; befintliga dashboard-, betalningsdetalj- och fakturalistesviter kompletteras. Alla underlag är syntetiska. Täckningen omfattar:

- Avsedd textreferens, inledande nollor, `599` mot `0599`, deklarerad `0000599`, faktisk bankkonflikt och inget globalt företagspolicyantagande.
- Vald originalkälla för betalare/referens/OCR, flera individuella betalare, saknat konto eller fakturaoriginal, manuella relationer, oförändrade historiska belopp/allokeringar och bevarad chargebackförklaring.
- Separata rapportobservationer utan dubbla ekonomiska betalningsräknare eller kreditliknande plusmarkering; korrekt Verifierade-filter.
- Alla elva obligatoriska verifieringssteg, dubbletter/saknade steg, tillåtna `not_required`-fall, faktisk ekonomisk post och registrerad allokering före ett verifierat betalningsmärke.
- Felaktiga listor, historik, kandidater och nästlad bankevidens, numeriska referenser, misslyckad transport och eget GET-återförsök. Senare svar kan inte återuppliva gamla kandidater eller ett annat objekts verifieringsresultat.
- Osäkert sparresultat vid HTTP 400/500, transportfel, ogiltig JSON eller felaktigt lyckat svar. Nästa skrivning kräver färsk läsning även via ett gammalt eventhandler; öppen detalj visar inte äldre bankfakta under osäkerheten.

### Mobil, desktop och tangentbord

Se [reproducerbar browseracceptans](agent-6-browser/README.md), [alla 19 resultat](agent-6-browser/acceptance-results.json) och [käll-/byggmanifest](agent-6-browser/bundle-source-manifest.json). Slutkörningen avslutades **2026-11-02T22:40:45.426Z** i Chromium **141.0.7390.37**. Faktiska viewportbredder var **320, 390, 768, 1024 och 1440 px**. Testerna använder riktig DOM, native dialog, Tab, Enter, Space, Escape, fokusåtergång och synliga fokusindikatorer. Desktop-/mobilbilder samt den smala betalningsdialogen har också inspekterats visuellt.

Källinnehållet var oförändrat före/efter byggning och browserprov: **47 produktinputs, nio byggda resurser och fem resurser som faktiskt levererades till Chromium** hashkontrollerades. Kvittona omfattar 22 viewportbilder. Totalt 76 lokalt fångade API-anrop: 75 GET samt exakt en uttryckligen testad POST till befintliga `/api/payment-control/run`, helt besvarad i Playwright. Inget API-anrop levererades till en backend och inget automatiskt advance-anrop gjordes.

### Tidigare fel och deras upplösning

Det återfunna arbetet hade ännu inget färdigt, pushat leveranskvitto. Dess tidigare fullkörningar innehöll inaktuella mock-/etikettfel, en direkt Node-körning utan rätt npm-kontext och ett bygge som avslutades med exit 137 under samtidig last. De räknas inte som godkända resultat. Mockar och körmiljö rättades utan försvagade assertions; den färska fullsviten ovan passerar via repositoryts npm-ingång.

Återupptagningen reproducerade de konkreta kandidatsvars-, status-, sparresultats- och renderingsfelen före rättning. Varje sista regressionsgrupp visade RED före ändring och GREEN efter. Slutlig lokal typkontroll, fullsvit, separat godkänt produktionsbygge och Chromiumkörning avser samma frysta produktkod. De 383 Sites-källfilerna var oförändrade före/efter slutgrindarna (manifestets SHA-256: `af3e25e67efb4337101fb86ebd8efb7907787feaa627a3f824518dd770ddcdcd`). Bygget har befintliga icke-blockerande varningar för dynamiska importer, sourcemaps och plugintider; det avslutas normalt. Den obligatoriska Node 22-CI:n på den levererade PR:n är ytterligare mergegrind; den tidigare miljöavbrutna körningen ersätter aldrig ett aktuellt grönt kvitto.

## Fortsättningspunkt och integrationsöverlämning

Produktkoden är fryst på **`feature/mgeorge-payment-ui`**, bas **`a779b0dd8d184eaf6e6d6e636c555c967f15f3d5`**. Browsermanifestet binder kvittot till exakt källinnehåll. Branchens leveranscommit, PR och dess aktuella CI anges i PR-beskrivningen och slutrapporten till uppdragsgivaren; använd dessa vid fortsatt arbete.

Integrationsansvarig läser den då aktuella `origin/main`, granskar producent-PR:ernas versioner och kopplar C1/C3/C4/C5 enligt samordningen ovan. Sammanför C3:s statuspanel med C6:s rapporttillgänglighet, bind en verklig Bankgiroframgång till rätt jobbkvitto och behåll all osäkerhet när kvitto saknas. Kör de gemensamma regressions- och browserfallen på den resulterande integrationen innan merge/publicering. Ingen sådan sammanhängande produktionskedja påstås verifierad här.

Ingen produktionsskrivning, riktig fakturaregistrering/allokering, kundmejl, bankbetalning, BankID-åtgärd eller Sites-publicering har gjorts. Merge och publicering tillhör integrationsansvarig. **Kvalitetspoängen behålls på 255/330 = 7,73; inga produktionsbetyg höjs av syntetiska testbevis.**
