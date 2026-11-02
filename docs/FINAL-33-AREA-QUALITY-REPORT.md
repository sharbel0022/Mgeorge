# Slutlig UI-, prestanda- och kvalitetsrapport — samtliga 33 områden

Datum: 2026-11-02. Repository: `sharbel0022/Mgeorge`.

**Leveransstatus: egen UI-branch för granskning. Det samlade målet 9,5/10 är inte uppnått.** Samtliga 33 områden har granskats. Den dokumenterade områdesbedömningen ligger kvar på **255/330 = 7,73/10; 0/33 områden når 9,5**. Lokala förbättringar och nya regressionstester stärker avgränsade delar. Återstående krav på verkliga underlag, drift, fysisk mobil, användaracceptans och katastrofåterställning kvarstår.

- Branch: `codex/final-ui-quality-2026-11-02`.
- Bas: senaste hämtade `origin/main` vid start, `a9f88ae1c0f697376b3ecd140e1e80a64405125a`.
- Main omkontrollerades under arbetet och låg fortfarande på samma commit. Slutlig fjärrkontroll redovisas i leveransavsnittet.
- Användarens senare samordningsregler gäller: endast egen branch och PR, ingen main-push, force-push, automatisk merge eller parallell Sites-publicering.
- Produktionsobservationer nedan gäller den redan publicerade tjänsten. Den här branchens nya kod har inte publicerats.
- Endast syntetiska testdata och mätningar ingår i repositoryt. Inga kundoriginal, konton, mottagare, privata skärmbilder eller åtkomstuppgifter har lagts till.

## 1. Genomförda förbättringar

| Kodnyckel | Konkret fel eller kostnad | Rättning och avsedd effekt |
| --- | --- | --- |
| C1: översikt och lästillstånd | Node-startsidan saknade den efterfrågade tydliga grupperingen. Sites kunde visa inloggningsuppmaning innan autentisering hade avgjorts. Sekundära listor kunde visa tomma eller gamla data under en misslyckad hämtning. | Fyra primära Node-kort använder befintliga belopp: Inbetalt, Kvar att få, Att betala, Behöver granskas. Omfattningen framgår. Huvudknappen behålls. Sites prioriterar väntande/fel framför bekräftat utloggat tillstånd. Import, kontakter, historik och sökning följer listans faktiska lässtatus. |
| C2: fakturalista och evidens | Sites renderade varje faktura samtidigt. Referens, källa och granskning var svåra att överblicka. Betalaridentitet behövde kunna visas utan att kundnamn eller förslag uppgraderades till bankbevis. | Högst 50 fakturor per sida; alla träffar är nåbara och totalsumma/export avser hela resultatet. Listan visar kund/leverantör, nummer, uttrycklig referens, belopp, saldo, status, källa och granskning. Verifierad betalare/mottagare kräver aktuell godkänd betalningsevidens och en positiv aktiv koppling. Utgående betalning kallar motparten mottagare. |
| C3: banklistans renderingsarbete | Sites beräknade betalningspresentation och HTML för samtliga poster i både desktop- och mobillayout. | Sidan avgränsas till 50 poster före den dyra presentationsfunktionen. Oförändrade indata återanvänder resultaten. Sammanfattningarna räknas fortfarande över hela underlaget. Nytt filtrerat resultat eller nya transaktioner återställer till sida 1. |
| C4: sökning, datum och fokus | Oanvänd matchningsanalys kördes vid Dashboard-renderingar. Klistrade blanksteg gav onödiga missar. Node skapade tusentals datumformaterare. Fokus kunde försvinna när en öppningsknapp doldes eller byttes ut. | Oanvänd analys tas bort; filtrerade listor memoiseras med aktuella indata. Unicode/blanksteg normaliseras. Fakturasökning omfattar explicit referens, källa, belopp och evidensstödd motpart. Node återanvänder formaterare och hanterar saknat förfallodatum. Sökresultat har piltangenter/Home/End/Escape. Sidnavigering behåller fokus och dialogstängning har synlig reservpunkt. |
| C5: fakturaunderlag och meddelanden | Gamla original eller utkast kunde synas vid byte av faktura. Väntande/felaktiga läsningar kunde presenteras som tom kö eller saknat Gmail-medgivande. Originalvisning körde även dold avstämningsanalys. | Synliga resultat binds till aktuell faktura, dokument, läge, försök och besöksepok; återgång A→B→A kan därför inte återvisa ett gammalt svar. Gamla svar ignoreras och gamla blob-URL:er frigörs. Original och meddelanden har separata lästillstånd och skrivfri återhämtning. Ren originalvisning kör ingen analys. Utskick kräver fortfarande uttryckligen läst `send_enabled === true` och ordinarie granskningsflöde. |
| C6: responsiv och tillgänglig presentation | Breda fakturarader blev svåra att läsa på mindre skärmar. Försvinnande sidknappar och otydliga radåtgärder gjorde tangentbordsbruk svårare. | Svartvit palett bevaras. Fakturor blir märkta kort vid högst 1 100 px. Långa referenser/källor kan brytas. Sidknappar har minst 44 px höjd, synligt fokus och korrekt spärrbeteende. Explicit radknapp öppnar exakt en faktura. Kontaktsökning skiljer inga träffar från första användning. |

### Ekonomimotorn och bankens verkliga uppgifter

Inga ändringar görs i `src/`-motorerna, Sites domän-/avstämnings-/ekonomifunktioner, bankleverantörer, OCR, API-rutter, databasscheman, säkerhetskopiering eller återställning. Node-korten använder befintliga `verified_paid_cents`, `remaining_cents`, `supplier_open_cents` och granskningsantal. Sites använder samma saldo-, status- och betalningspresentationsfunktioner som före ändringen.

En kundidentitet, ett matchningsförslag, en manuellt kompletterad identitet och bankens ursprungliga motpart har olika evidensvärde. Nya listfält går genom befintliga kontroller och döljer verifieringspåståendet när underlaget spärras eller saknas. En aktiv koppling med nollbelopp ger inte en verifierad betalare. OCR eller betalningsreferens återges enligt sitt befintliga fält; ett allmänt referensnummer omklassificeras inte till bank-OCR. Varken paginering, sökning eller prestandamätning skapar allokeringar eller utför ekonomiska kommandon.

## 2. Inventering av befintligt UI

Den [fullständiga fil- och symbolinventeringen](UI-COMPONENT-INVENTORY.md) omfattar 109 befintliga UI-filer, inklusive 32 namngivna Dashboard-funktioner och 127 namngivna public-funktioner. Den omfattar båda apparna, de tolv Dashboard-vyerna och separata sidor. Det finns dessutom 61 återanvändbara primitives i `sites/components/ui/`. De är huvudsakligen scaffold; deras existens räknas inte som verifierade produktflöden.

| Ansvar | Sites | Node/public |
| --- | --- | --- |
| Skal och sidor | `app/layout.tsx`, `app/page.tsx`, Dashboard; separata bank-, Gmail- och kundmeddelandesidor | `index.html`, `app.js`: boot, login, render, navigation |
| Tolv huvudvyer | overview, receivable, payable, bank, imports, contacts, history, settings, review, messages, documents, connections | Översikt, fakturor, bank, import, anslutningar, meddelanden, historik, inställningar och hjälp |
| Navigation och gemensamma ytor | WorkspaceNavigation, WorkspaceLink, MobileNavigation, MobileMenuButton, useWorkspaceNavigation, WorkspaceSearch, Dialog, Empty, Field, Pill, WorkspaceListStatus, FormError, DetailSurface; ny ListPagination | modal/closeModal, filter/pagination/rerenderResults, toast/error, badge, hero, empty, stat, panel |
| Startsida och kontroll | EconomyOverview, ControlButton, ControlProgress, ControlConnections, ControlQueue, usePaymentControl | paymentControlOverview, controlButton, controlProgress, controlConnections, controlQueue; invoiceSummary/recentInvoices/upcomingRows |
| Granskningsyta | ControlReview och inline-faktura/betalning/Gmail/meddelande | paymentControlReview, reviewDocument, extractionSummary |
| Fakturor och kontakter | InvoiceTable, Contacts, InvoiceEditor, InvoiceDetail, InvoiceEvidence, MissingInvoice, CreditDialog, ConfirmDialog | invoicePage/filteredInvoices/invoiceResults, invoiceDialog/invoiceDetail, reconcileDialog, reminderDialog, undoDialog |
| Bank och bevis | BankPayments, BankReference, BankPaymentSummary, TransactionDetail, NewTransaction, MatchDialog, SplitTransaction, PaymentHistory, PaymentVerificationPanel/Report, BankgiroLinkReview | paymentBankPage/Results, bankPayerUI, bankOCRUI, bankEvidenceUI, bankFileOriginalUI, status/evidence helpers; bankTable/Results, transaktions-/specifikations-/återtagningsdialoger |
| Bankanslutning | BankConnection, SyncRecoveryNotice, useBankRefresh | connectionPage/Card, bankActivationDetail, activationDialog, konto-/synk-/frånkopplingsflöden |
| Import och original | BankImport, GenericBankImport, InvoiceEditor, underlagslista, importhjälp | importPage, documentsTable, importTable, bankgiroReviewTable, previewPanel, filväljare, upload/preview/commit, reviewDocument |
| Gmail | GmailWorkspace, GmailSummary, DocumentOcrStatus, SyncRecoveryNotice | gmailAction, gmailSettings, Gmail-panel och dokumentgranskning |
| Kundmeddelanden | CustomerMessages: kö, underlag, utkast, separat godkännande/utskick, kontakt-/frånvaroverifiering | messagesPage, messageEvidence, openMessage och separata granska/redigera/avvisa/skicka-åtgärder |
| Historik, inställningar och hjälp | SettingsView, audithistorik, export, privacy/terms-rutter, ConnectorError | settingsPage, helpPage, historyPage, export; privacy/terms-HTML |

Primitivfamiljerna omfattar navigation/menyer, formulär/fält, dialog/drawer/sheet, kort/tabeller, pagination/tabs, status/laddning, diagram och meddelanden. Aktiva produktkomponenter använder främst semantisk HTML och produkt-CSS; inga globala primitives har bytts ut i detta uppdrag.

**Kvarvarande omfattning:** kontakter, importhistorik, audithistorik samt Gmail-/gransknings-/meddelandeköer är inte generellt serverpaginerade. Kontaktvyn gör fortfarande upprepade sökningar per kontakt. De två prioriterade faktura- och banklistorna är begränsade i renderingen; hela arbetsytan hämtas fortfarande enligt befintligt API. Detta är en uttrycklig begränsning för stora kompletta register.

## 3. Test- och verifieringsbevis

Alla nya reproducerade fel fick riktade regressioner. Testdata är syntetiska. Fulla sviter körs på Linux med Node `24.22.1`; repositoryts Actions använder Node 22. Lägre lokal testkonkurrens begränsar belastningen från samtidiga uppdrag och ändrar inga testassertioner.

| Nyckel | Omfattning | Resultat |
| --- | --- | --- |
| T1 | Node/public: fokus, sökning, tomma datum/belopp, evidens, fyra kort; kompatibilitet med bank- och betalnings-UI | 16 nya fall; riktad samling 74/74 passerar. |
| T2 | Sites-banklista: 50-radersgräns, alla 123 poster nåbara, ny sidindata, uppdaterade kandidater/evidens, hel sammanfattning, oförändrade finansiella indata | 5 nya fall passerar; baslinjefelen reproducerade. |
| T3 | Sites-fakturalista: sidor, explicit radöppning, källa/referens/granskning, positiv verklig motpart som skiljer sig från kunden, spärrad evidens, utgående mottagare och nollkoppling | 7/7 passerar. Fyra ursprungliga listfel samt mottagar-/nollbeloppsfallen gav RED före respektive rättning. |
| T4 | Dashboard läslivscykel och arbetsyta | 41/41 passerar: bland annat inga oanvända suggestions-anrop vid skrivning, inga falskt tomma sekundära listor, stängd sökning vid väntande/felaktig läsning, normaliserad käll-/beloppssökning. |
| T5 | Original-/meddelandelivscykel och översiktens inläsning | 17/17 nya evidensfall samt 4/4 översiktsfall passerar. Ursprungligen 11 RED, därefter ett nytt malformed-draft-RED och tre revisit-RED (A→B→A, demoåtergång, original-only-återgång); tre översiktsfall gav RED. Separat kompatibilitet med befintlig evidence/control/navigation/Gmail-UI passerar. |
| T6 | Hela Node/Sites, syntax, TypeScript, audits, minimatchkontroll och bygge | Node 1 078/1 078 och Sites 1 961/1 961 passerar, 0 fel/skip. Syntax 107 filer, TypeScript och slutligt produktionsbygge passerar. Exakta grindar nedan; extra lint är underkänd. |
| T7 | Faktisk lokal webbläsare: responsiva bredder, tangentbord, dialoger, sidbyten | Blockerat för ny kod: den separata molnwebbläsaren kunde inte ansluta till den lokala syntetiska förhandsgranskningen (ERR_CONNECTION_REFUSED). Läsning av dess efterföljande felsida nekades av webbläsarens URL-policy. Ingen alternativ åtkomstväg eller policyomväg användes. Därför saknas färskt browserbevis på 320/390/768/1024/1440 px för denna branch. |
| T8 | Ny sökresultatstyrning: ArrowUp/Down, Home/End, Escape, vald träff och begränsat resultat | 10/10 passerar; faktisk funktionskod med små fokusfixturer, inklusive native Enter/Space/Tab utan egen aktivering. Karakterisering av redan infört beteende; inget RED påstås för dessa tio fall. |
| R1 | Oberoende skrivfri granskning mot `a9f88ae`, inklusive all produktkod, tester och mätunderlag | Första helgranskningen hade inga Critical/Important-fynd. Senare lintrefaktorering gav ett konkret Important-fynd: återbesök till A kunde återvisa gammalt utkast/frigjord URL. Tre nya regressioner reproducerade felet; per-besöksepok rättar det. Slutlig omgranskning stängde fyndet: inga Critical/Important-fynd kvar. Ingen merge-/driftcertifiering. |

Den första avslutade Sites-helsviten gav 1 955/1 956 pass: ett befintligt installationsprov saknade `npm_execpath` när Node kördes direkt och sökte då npm i fel runtime-katalog. Samma 12 entrypointprov passerade med den verkliga installerade npm-klienten angiven; inga testkrav eller installerade paket ändrades för detta. En senare körning avbröts uttryckligen för att rätta granskningsfyndet A→B→A innan kodfrysning.

Tidiga fullförsök i den begränsade miljön avbröts eller gav lokala socket-/processfel (`EPERM`) och förlorade körningssessioner under samtidig belastning. Dessa räknas inte som godkända fullkörningar. Endast avslutade färska körningar i T6 används som slutbevis. Inga tester, krav eller säkerhetsgrindar har sänkts för att få grönt resultat.

### Avslutade obligatoriska lokala kontroller

| Kontroll | Faktiskt resultat |
| --- | --- |
| Ren Node-installation: `npm ci --ignore-scripts` | Passerad; inga paket- eller lockfiländringar. |
| Ren Sites-installation: `npm run install:ci` | Passerad; exakt befintlig minimatchbackport installerad. |
| Node syntax: `npm run check` | 107 JavaScript-filer passerar. |
| Node helsvit: `node --test --test-concurrency=2 test/*.test.js` | **1 078/1 078 pass**, 0 fel/skip; 484,49 sekunder lokalt. |
| Sites TypeScript: `npm run check` | Passerad på slutlig produktkod. |
| Sites helsvit: `node --experimental-strip-types --test --test-concurrency=2 tests/*.test.mjs` med korrekt `npm_execpath` | **1 961/1 961 pass**, 0 fel/skip; 136,05 sekunder lokalt. |
| Root `npm audit --audit-level=high` | Passerad; 0 fynd. |
| Sites `npm audit --audit-level=high` | Passerad high-grind; 16 moderate, 0 high/critical. Dessa moderata utvecklingsfynd kvarstår. |
| Sites `npm audit --omit=dev --audit-level=high` | Passerad; 0 produktionsfynd. |
| `node scripts/minimatch-backport.mjs --check --require-target` | Passerad; targets 1, writes 0, verified. |
| Sites `npm run build` efter sista kodrättningen | Passerad; produktionens klient/server/API-rutter byggda. Ingen publicering utförd. |
| `git diff --check` | Passerad. |

Sammanlagt **3 039 passerade tester**. Sites-körningen använde miljöns faktiskt installerade npm-cli via `npm_execpath`; det är samma miljöfakta som normalt tillhandahålls av `npm test`, inte en ändrad assertion eller en testsimulering. GitHub Actions kör projektets ordinarie `npm test` på Node 22. Exakt fjärrresultat verifieras först efter branchpublicering och redovisas tillsammans med PR:n.

### Extra lintkontroll och oberoende granskning

`npm run lint -- --format json` kördes i sin helhet och avslutades med exit 1: **212 fel, 2 527 varningar i 294 filer**. Det är en kvarstående teknisk skuld och en underkänd kontroll. Workflowens obligatoriska grindar omfattar inte lint, så ett grönt Actions-resultat skulle inte ändra detta.

De nio ändrade befintliga Sites-filerna jämfördes med `a9f88ae` med samma installerade beroenden, ESLint-konfiguration och kända app-routes: **52 → 47 fel, 31 → 26 varningar**. Nya Sites-komponenter, tester och mätfiler har noll lintfel/varningar. InvoiceEvidence kontrollerades dessutom med samma ESLint-instans och exakt samma filväg: **5 → 0 fel**, med en kvarstående befintlig bildvarning. Inga regler stängdes av. De återstående felen i befintliga filer gäller bland annat `any`, äldre effektmönster och Next-specifika regler; bred sanering ligger utanför denna UI-branchs avgränsade ändringar.

Den sista oberoende granskningen stängde A→B→A-fyndet efter att besöksepoken och regressionsfallen hade granskats. **Inga Critical/Important-fynd återstår i den granskade ändringen.** Det är kodgranskningsbevis; browser-/produktions-/DRacceptans och den fulla lintskulden hålls öppna.

## 4. Uppmätt prestanda och dess gränser

### Node, 5 001 syntetiska fakturor

Se [råmätning och hashvärden](measurements/final-ui-node.json) och [runner](../scripts/measure-ui-node.mjs). Samma frysta datum, indata och baslinje `a9f88ae`; en uppvärmning och sju alternerande mätpar. Medianer:

| Operation | Före, ms | Efter, ms | Omfattning |
| --- | ---: | ---: | --- |
| Fakturasida och sammanfattning | 3 533,370 | 38,411 | Samma 5 001 fakturor och belopp; formatteringskostnaden minskar. |
| Första fakturaresultat | 79,017 | 41,916 | 50 renderade rader. |
| Referenssökning | 47,682 | 24,205 | 1 000 matchande fakturor. |
| Månadsfilter | 909,810 | 10,928 | 2 500 matchande fakturor. |

Fixturen har **noll transaktioner, allokeringar och dokument**. Datumsammanfattningen skapade tidigare 10 002 DateTimeFormat-objekt och skapar nu ett. Mätningen täcker lokal presentationslogik, inte nätverk, DOM-layout, verkliga bankoriginal eller ett stort allokerat register. Delad värd ger märkbar varians; råproverna finns kvar. Ingen produktions-SLA härleds från dessa tider.

### Sites, riktig React-SSR av banklistan

Se [råmätning och hashvärden](measurements/final-ui-lists.json) och [runner](../sites/scripts/measure-ui-lists.mjs). Baslinje och ny lista använder samma faktiska domän-/betalningspresentation, en uppvärmning och tre alternerande mätpar.

| Dataset | Före, ms | Efter, ms | HTML före → efter | Renderade rader per layout |
| --- | ---: | ---: | ---: | --- |
| 100 bankposter | 607,52 | 196,62 | 114 015 → 57 608 byte | 100 → 50 |
| 1 000 bankposter | 2 192,75 | 119,32 | 1 138 490 → 57 610 byte | 1 000 → 50 |
| 5 000 bankposter | Ej körd | Ej körd | Ej mätt | Avstod enligt uttrycklig 180-sekundersbudget; inget påhittat resultat. |

För 1 000 poster blev den uppmätta komponentrenderingen cirka 18,38 gånger snabbare och HTML cirka 94,94 % mindre. **Förälderns filtrering, helsammanfattning, datahämtning, hydrering och webbläsarlayout ingår inte.** Ingen ändring av ekonomisk beräkning, automatisk matchning eller bokföringsbeslut ingår. Att sidan visar 50 rader innebär inte att API:t hämtar endast 50 poster.

## 5. Aktuell och historisk produktionsevidens

**P1 — aktuell autentiserad läsning, 2026-11-02:** den befintliga Chrome-fliken för den befintliga Sites-tjänsten kunde läsas med DOM och skärmbild efter två tidigare navigeringstimeouter. Startsidan visade alla fyra ekonomiska sammanfattningarna, tydlig huvudåtgärd, preliminärhetsnotis och granskningsbehov för saknade eller motstridiga bankoriginal. En redan pågående kontroll observerades först som pågående och senare som delvis klar med återstående underlag. Den startades inte av detta uppdrag. Kunduppgifter, privata belopp och skärmbilden har inte kopierats till repositoryt.

P1 styrker inloggad läsbarhet och den publicerade startsidans statuspresentation. Det styrker inte branchens nya lista, full dataintegritet, providerutfall, genomförd matchning, lyckat automatiseringsschema eller färdig användaracceptans. Ingen ekonomisk åtgärd, bankretry, uppladdning, kundkommunikation, schemaändring eller produktionsskrivning gjordes.

**P0 — historik:** [MAINTAINED-RUNTIME-DELIVERY-REPORT](MAINTAINED-RUNTIME-DELIVERY-REPORT.md) dokumenterar tidigare Sites55, avgränsad autentiserad faktura-/bankläsning, sökning och dialogbredder. [ORIGINAL-REFERENCE-INTEGRITY-REPORT](ORIGINAL-REFERENCE-INTEGRITY-REPORT.md) dokumenterar tidigare käll-/integritetskontroller. De är historiska bevis med sina egna commit-/data-/tidsgränser. Äldre påståenden om pausad Gmailhämtning, senaste banktid, registerrevision eller backupstatus presenteras inte som aktuellt verifierade av denna UI-cykel.

**P2 — denna branch:** ingen Sites-publicering har gjorts, i enlighet med samordningsinstruktionen. Nytt produktionsbevis måste tas efter granskning, ordnad integration och en samordnad publicering i samma befintliga projekt.

## 6. Samtliga 33 områden: före, aktuellt och exakta återstående krav

Poängen är samma konservativa områdesbedömning som i baslinjens kompletta scorecard. De är inte statistiskt uppmätta decimaler. Varje rad anger vad denna UI-cykel faktiskt har ändrat eller lämnat oförändrat, relevant testbevis och vad som konkret behöver verifieras för en ny bedömning på minst 9,5.

| Nr / område | Tidigare | Aktuellt | Kodrättning i denna cykel | Testresultat | Produktionsbevis | Kvarstående risk och verifierbar åtgärd före 9,5 |
| --- | ---: | ---: | --- | --- | --- | --- |
| 1. Design och färger | 8 | 8 | C1/C6: svartvit presentation, tydliga kort, radetiketter och brytbara källor. | T1/T3/T7; befintliga kontrastregressioner ingår i T6. | P1 visar publicerad svartvit startsida; P2 saknas. | Hela verkliga textmängden, zoom och hjälpmedel är inte accepterade. Kör alla 12 vyer med långa godkända texter, 200–400 % zoom, kontrast och skärmläsare efter integration. |
| 2. Startsida | 8,5 | 8,5 | C1: fyra Node-kort från befintliga totalsummor; ärlig väntan/fel i Sites. | T1/T5 och ekonomiregressioner i T6. | P1: fyra kort, preliminärhetsnotis och delvis klar kontroll. | Kortens faktiska totalsummor är inte omräknade mot hela aktuella originalregistret här. Stäm av en godkänd komplett produktionssnapshot mot bevarade original och redovisad period. |
| 3. Navigering | 8,5 | 8,5 | C4/C6: fokus efter listbyte/dialog, explicit radknapp, tangentbordsstyrda sökresultat. | T1/T3/T8 och befintlig navigation i T6. | P0 begränsad tidigare navigationsacceptans; P1 endast startsida. | Komplett ny inloggad tangentbordsresa saknas. Testa Tab/Shift+Tab/Escape/Back/Forward genom alla vyer och dialogbyten efter publicering. |
| 4. Mobilanpassning | 8,5 | 8,5 | C6: fakturakort och sidnavigering på små bredder; Node-datumfilter synliga. | T7 samt fokus/layoutfall i T1/T3. | P0 tidigare viewportkontroller; inget nytt fysiskt enhetsprov. | Viewport är inte fysisk telefon/surfplatta. Verifiera iOS/Android, rotation, virtuellt tangentbord och öppna dialoger med långa underlag. |
| 5. Sökning och filtrering | 7,5 | 7,5 | C4: normaliserad text, källa/belopp/evidensstödd motpart, stabila sidbyten, ärliga inga-träffar. | T1/T4/T8 samt uppmätta lokala sökfall. | P0 tidigare referenssökning; branchsökningen är opublicerad. | Global sökning omfattar inte all dokumenttext och alla registerfält; API:t hämtar hela state. Acceptera en facitlista med verkliga tillåtna referenser, format, filter och stora register. |
| 6. Minimal manuell hantering | 6,5 | 6,5 | C1/C4/C5: huvudåtgärd, mindre dold analys och tydligare nästa steg/återhämtning. | T4 visar noll oanvända matchningsanrop; T5; lokala mätningar. | P1 visar kvarstående underlag och delvis klar kontroll. | Mindre renderingskostnad bevisar inte mindre verkligt granskningsarbete. Mät tid, antal beslut och korrekt avslutade ärenden på en godkänd representativ arbetsvecka. |
| 7. Kundfakturor | 8 | 8 | C2/C5: komplett listinformation, säker verklig betalare och fakturabundet original. | T3 positiv kund≠betalare, spärr och immutable state; T5/T6. | P0 historisk originalgranskning; ingen ny registrering/allokering. | Historiskt saknade original repareras inte av UI. Inventera ägarbundna original och genomför separat godkänd registrerings-/betalningsacceptans med full audit. |
| 8. Leverantörsfakturor | 8 | 8 | C2: samma listfakta, korrekt verifierad mottagare för utgående betalning. | T3 mottagarfall och befintliga leverantörsregressioner i T6. | Ingen ny verklig leverantörsacceptans. | Leverantörslayouter, negativa/krediterade fall och äldre original behöver verksamhetsfacit. Testa representativa godkända original och mottagarrelationer utan testbetalning. |
| 9. PDF-tolkning | 8 | 8 | Parsern oförändrad; C5 hindrar fel tidigare original i visningen. | T5 och fulla befintliga PDF-/registreringsfall i T6. | P0 tidigare avgränsad originalintegritet. | Syntetiskt PDF-facit är ingen generell korrekthetsgaranti. Utvärdera en versionsbunden, godkänd verklig layoutkorpus med fältfacit och falskt-gröna mått. |
| 10. Bild-OCR | 7 | 7 | OCR-motorn oförändrad; väntan/fel ska visas som sådana. | Befintliga OCR-/fältgränsfall i T6. | P1 visar återstående bearbetning, ingen färdig moln-OCRkedja. | Precision/volym/drift är inte styrkt över representativa rasterbilder. Mät godkänd bildkorpus, osäkerhetsgrind, faktisk lyckad OCRkedja och svarstider. |
| 11. Gmail-anslutning | 7,5 | 7,5 | C5: okänd behörighet under väntan/fel visas inte som bekräftat saknad. | T5; befintliga Gmail-/retry-/sessionfall i T6. | P1 begränsad kontrollstatus; P0 tidigare integrationshistorik. | Inloggad UI visar inte att ett aktuellt schema fungerar. Verifiera aktuell konfiguration och ett tillåtet lyckat schemalagt jobb med bevarad dokumentproveniens. |
| 12. Automatisk fakturaregistrering | 8 | 8 | Registreringslogik oförändrad; C5 visar rätt aktuellt original och status. | T5 och befintliga autogransknings-/race-/PDF-fall i T6. | Ingen ny riktig automatisk registrering utförd. | Produktionsprecision och äldre poster återstår. Genomför separat godkänt fall med bevarat original, full fältkontroll och bevis på exakt en registrering. |
| 13. Dubblettkontroll | 8 | 8 | Deduplicering oförändrad; paginering förändrar inte register eller import. | Befintliga ägar/hash/race/dubblettfall i T6; immutable listtester T2/T3. | P0 tidigare källintegritetsbevis, ingen ny originalinventering. | Historiska dubbletter eller saknade original repareras inte. Kör ägarbunden inventering och spårbart beslutad återanskaffning/rättning vid konstaterad brist. |
| 14. Dokumentgranskning | 8 | 8 | C5: gamla original/utkast döljs direkt, abort/revoke och separat återförsök. | T5: 17/17 nya fall och kompatibilitet; T6. | Inga nya verkliga granskningsbeslut utförda. | Verkliga layoutfel, historiska format och användarbeslut återstår. Acceptera prioriterade original i ny UI med versionsbyte, fel/retry och dokumenterad granskning. |
| 15. Swedbank-anslutning | 8,5 | 8,5 | Provider/konto-/consentkontroller oförändrade; C2/C3 bevarar spärrad presentation. | Konto-/original-/retry-/consentfall i T6. | P1 visar källproblem och återstående kontroll; ingen ny kontoattest. | Bankutfärdad kontorelation och aktuell detaljevidens saknas i uppdragets bevis. Inhämta erforderligt original och följ leverantörens tillåtna retrytid; ingen gissning. |
| 16. Automatisk bankhämtning | 8 | 8 | Synk/scheman oförändrade; C3 optimerar endast läst lista. | Befintliga provider-/session-/retryfall i T6. | P1 visar att kontroll inte bevisar lyckad full bankhämtning. | Aktuell komplett automatisk hämtning har inte accepterats här. Observera ett tillåtet lyckat jobb med tidsfönster, sidfullständighet och dubblettkontroll. |
| 17. Bankgiroimport | 8,5 | 8,5 | C3: lista med begränsat antal synliga rader med samma käll-/referensgrindar; ingen importmotorändring. | T2 och befintliga XLSX/specifikations-/relationsfall i T6. | P0 tidigare rapportintegritet; P1 kvarstående specifikationsbehov. | Importerad rapport bevisar inte rätt bankinsättning. Anskaffa uttryckligt kontoalias och gemensam insättningsidentitet före separat relationsbeslut. |
| 18. Identifiera verklig betalare | 7 | 7 | C2: befintliga verifieringsgrindar, positiv koppling, inga kund-/förslagsnamn som bankbevis. | T1/T3 positiva och negativa fall; bankevidensregressioner i T6. | P1 behåller okänd motpart/granskning vid bristande original. | Den saknade rapport-/AIS-relationen kan inte skapas med UI. Styrk bankoriginal, rapportrelation och separat kundattest; kontrollera återtag/invalidering. |
| 19. Verklig OCR/fakturareferens | 7 | 7 | C2/C4: uttryckligt fält, ledande nollor och sökning; inget generiskt nummer blir bank-OCR. | T1/T3, befintliga OCR/reference/proveniensfall i T6. | P0 historiskt typ-/originalbevis, ingen ny komplett insättningsrelation. | OCR-avtal/checksumma och källrelation måste styrkas för de verkliga fallen. Acceptera explicit typade originalreferenser inklusive saknade/motstridiga värden. |
| 20. Automatisk betalningsmatchning | 7,5 | 7,5 | C4 tar bort oanvänd UI-analys; ekonomimotorns beslut oförändrade. | T4 noll oanvänd analys; full matchnings-/allokeringsregression T6. | Ingen ny verklig automatisk allokering utförd. | UI-timing är ingen matchnings-SLA eller affärsacceptans. Kör godkänd representativ volym med bank-/motpartsbevis och verifierat identiskt finansiellt facit. |
| 21. Delbetalningar | 8 | 8 | Saldo/logik oförändrade; C2/C3 visar samma delbetalningsstatus. | Befintliga delbetalnings-/statusfall i T6; T2/T3 bevarar state. | Ingen ny riktig delbetalningsacceptans. | Ett aktuellt konto-/originalbundet delbetalningsfall behöver verksamhetsgodkännas med restsaldo och audit. |
| 22. Överbetalningar | 8 | 8 | Saldo/logik oförändrade; verifierad motpart skiljs från kund. | Befintliga överbetalnings-/refundfall i T6. | Ingen återbetalning gjord eller testad i produktion. | Överbetalning och återbetalningsbeslut kräver separat original- och verksamhetsgranskning. Acceptera status/audit utan att genomföra en testbetalning. |
| 23. Flera fakturor i en betalning | 7,5 | 7,5 | C2 behåller existerande referens-/allokeringsgrindar och unika motparter. | Befintliga flerfaktura-/konflikt-/ordningsfall i T6. | Ingen ny verklig gruppallokering utförd. | Blandade historiska typer kräver kompletta original. Verifiera godkända grupper, fördelade belopp, referenser och separat allokeringsbeslut. |
| 24. Betalningshistorik | 8 | 8 | C1: väntande/fel/utloggat historikläge visar inte gammal eller falskt tom historik. | T4 och befintliga audit-/återtagningsfall i T6. | Ingen full ny produktionsaudithistorik exporterad eller omverifierad. | Historiken är fortfarande obunden i renderingen. Acceptera ägarinloggad historik/återtag och mät stort verkligt tillåtet historikunderlag; lägg vid behov till paginering. |
| 25. Betalningsstatus | 8 | 8 | C2/C3: samma ekonomiska status; verifieringspåstående försvinner vid känd evidensspärr. | T1/T2/T3, befintliga status/original/holdfall i T6. | P1 visar preliminär och delvis klar status. | En projektion upptäcker inte okända brister i gamla original. Verifiera aktuell original-/consent-/kontoevidens inför verkliga beslut. |
| 26. Kontrollera alla betalningar | 8 | 8 | C1: tydlig primäråtgärd; ingen ny knappväg som kringgår kontrollflödet. | T1/T5 och kontroll-/jobbregressioner i T6. | P1 observerad pågående→delvis klar kontroll startad utanför detta uppdrag. | Ett observerat partialjobb är ingen komplett acceptans. Kör separat samordnat godkänt produktionsprov med aktuella bankbevis, alla steg, audit och mätt varaktighet. |
| 27. Automatiska mejlutkast | 8 | 8 | C5: aktuell fakturas utkast, ärlig kö-/behörighetsstatus och GET-retry. | T5 och befintliga version/granska/skicka-fall i T6. | Inget kundmejl skickat, inget verkligt utkast godkänt här. | Verklig mottagare, innehåll och osäker leverans kräver separat acceptans. Granska varje mejl i ordinarie flöde; verifiera version/avvisa/återläsning utan obehörigt utskick. |
| 28. Schemalagd automatisering | 6,5 | 6,5 | Inga scheman eller bakgrundsjobb ändrade. | Befintliga scheduler/lease/retry/sessionfall i T6. | P1 pågående/partial UI; inget nytt lyckat schema bevisat. | Anslutning eller heartbeat räcker inte. Dokumentera aktuell tillåten konfiguration och observera ett faktiskt komplett lyckat schemalagt Gmail-/bank-/OCRjobb. |
| 29. Säkerhetskopiering | 7,5 | 7,5 | Backupimplementation oförändrad. | Befintliga original/hash/snapshot-/arkivfall i T6. | P0 gammal backupstatus, ingen färsk komplett certifiering. | Ett historiskt manifest ger ingen atomisk DR-garanti. Skapa separat godkänd oberoende kopia, verifiera samtliga ägda original/nycklar och använd den i isolerad restore. |
| 30. Säkerhet och åtkomstkontroll | 8,5 | 8,5 | C1/C5: stale search/original döljs vid läsfel; utskick kräver explicit läst behörighet. | T4/T5/T6; aktuella audits nedan. | P1 inloggad läsning, ingen aktuell revoke-/cross-owneracceptans. | Node är ett gemensamt adminregister och hela hotbilden är inte certifierad. Kör riktad ägar-/sessionsrevokerings-/raceacceptans och hantera kvarstående utvecklingsberoenden. |
| 31. Katastrofåterställning | 5,5 | 5,5 | Ingen restoreändring i UI-uppdraget. | Befintliga plattforms-/fil-/kryptotester i T6; historiska OS-begränsningar gäller sin miljö. | Inget faktiskt nytt komplett katastrofprov. | Betrodda nycklar, kopia, föräldrakatalog och återställningsmiljö krävs. Genomför isolerad återstart från oberoende backup, kontrollera alla original/ägare/saldon och mät RPO/RTO. |
| 32. Kodkvalitet och tester | 8,5 | 8,5 | C1–C6, inga nya produktionsberoenden, fokuserade regressioner och hashbundna mätningar. | T1–T8/R1; fullresultat och exakt Actions redovisas separat. | Ny branch opublicerad; P2 kvarstår. | 16 moderata utvecklingsfynd, full lint med 212 fel/2 527 varningar och lintkedjans underhållsbegränsning kvarstår. Ordna granskad kompatibel beroendefix, representativ browser-/volymacceptans och exakt CI. |
| 33. Verifiering i verklig produktion | 6,5 | 6,5 | Enbart lokal UI-kod; ingen produktionsändring eller ny publicering. | Lokal verifiering och PR-CI kan bedöma branchens kod; inte driftparitet. | P1 färsk begränsad autentiserad läsning, P0 historik, P2 ingen branchdeploy. | Hela ändringen måste först granskas/integreras. Publicera sedan samordnat samma Sites, verifiera exakt källträd, inloggad användarresa, bank-/verksamhetsbevis och separat DR. |

## 7. Leverans, integration och fortsättningspunkt

Leveransen publiceras endast på `codex/final-ui-quality-2026-11-02` med PR mot `main`. Slutrapporten ingår i det testade filträdet före fjärrpubliceringen. Exakt fjärr-SHA, PR-länk och efterföljande Actions-resultat redovisas i PR:ns metadata och uppdragets slutmeddelande; den här commitbundna rapporten gör inget förhandsantagande om CI-resultatet. Ingen merge eller publicering av Sites ingår i branchleveransen.

Lokal Git saknade HTTPS-autentisering vid en skrivfri pushkontroll. Den befintliga behöriga GitHub-anslutningen kan användas för att publicera exakt samma Git-träd på den egna branchen. Trädhash och fjärrhuvud ska då jämföras med det lokalt testade innehållet före PR-leverans.

Integrationsordning: granska UI-PR:n tillsammans med andra uppdrags eventuella överlapp i Dashboard/public UI och dokumentens topprader; hämta aktuell main igen; lös verkliga konflikter med båda ändringarnas avsikt bevarad; kör berörda regressioner och obligatoriska grindar på den integrerade committen. Merge utförs av den samordnade granskningen. En enda ansvarig publicerar därefter det befintliga Sites-projektet och verifierar källträd och inloggad drift.

Fortsätt med de verifierbara åtgärderna i varje rad ovan. Det finns inget stöd för att kalla samtliga 33 områden fullt godkända enbart på grund av gröna tester.
