# QUALITY-SCORECARD — MG Fakturakoll, 33 kvalitetsområden

**Bedömningsdatum: 2026-10-30. Status: MÅLET ÄR INTE UPPNÅTT.**

Detta är den första samlade, dokumenterade bedömningen mot användarens 33 områden. Det är **inte** en uppfunnen historisk baslinje och visar ingen påstådd poängförbättring jämfört med tidigare körningar. Befintlig grund är `origin/main` på `b5a25e7`; denna körnings kodändringar, tester och begränsade observationer bedöms separat från äldre leveranser. Ingen poäng på 9,5 eller högre delas ut i denna version.

Bedömningen är konservativ och avser **verifierad kvalitet inom den redovisade omfattningen**, inte en statistiskt uppmätt felfrihetsgrad. En godkänd kodleverans är inte bevis för bankens rapporttäckning, avslutad moln-OCR eller fullständig företagsavstämning. Alla lokala testdata är syntetiska. Inga autentiserade produktionsflöden i webbläsaren har verifierats i denna bedömning.

## Reproducerbar bedömningsmodell

Varje område får fem delpoäng om 0–2, i steg om 0,5. Områdespoängen är exakt **F + S + K + U + P**. Översiktstabellen redovisar varje delpoäng; motiveringen och granskningsbara källorna står under respektive område. En annan granskare kan sänka en delpoäng om angivet bevis inte stödjer den.

| Del | Vad bedöms? | Förankrade nivåer |
| --- | --- | --- |
| F | Funktion mot angivna acceptanskriterier | 0: inget körbart bevis. 0,5: endast implementation identifierad. 1: ett begränsat lyckat fall. 1,5: flera centrala flöden verifierade men betydande omfattning återstår. 2: områdets centrala lokala funktioner verifierade i angiven omfattning. |
| S | Felhantering, säkerhet och dataintegritet | 0: inget bevis. 0,5: endast kodskydd identifierat. 1: konkret negativt fall. 1,5: flera oberoende felklasser. 2: dokumenterade kritiska felklasser och positiva kontrollfall täcks av exekverade regressioner. |
| K | Sammanhängande kedja | 0: ingen körning. 0,5: rena hjälpfunktioner. 1: flera samverkande delar i isolering. 1,5: verklig renderings-/HTTP-/lagringsgräns kontrollerad i en del av kedjan. 2: relevant sammanhängande lokal kedja med faktisk databas/lagring eller motsvarande realiserad integrationsgräns. |
| U | Användbarhet och driftbarhet | 0: inget bevis. 0,5: begränsad status/åtgärd. 1: användbar grund men tydliga gränssnitts-/driftluckor. 1,5: tydliga statusar, spårbarhet och betydande verifiering; minst en relevant användar-/driftkontroll återstår. 2: samtliga relevanta användar-/driftkontroller, inklusive tillgänglighet där tillämpligt, är dokumenterat accepterade. |
| P | Aktuell produktions- och leveransevidens | 0: nödvändigt verkligt utfall saknas eller krävd automatik är pausad. 0,5: befintlig publicerad grund eller begränsad läsande produktionsstatus. 1: aktuellt konkret driftutfall för området, utan full verifiering av ny kod och användarkedja. 1,5: aktuell leverans och representativt autentiserat flöde verifierade. 2: alla kritiska produktionskrav verifierade med rätt autentiska underlag och driftbevis. |

**Obligatoriska spärrar:**

- Utan erforderligt autentiserat produktionsbevis är områdets slutpoäng högst **8,5**, oavsett delsumma.
- **9,5 kräver** uppfyllda kritiska acceptanskriterier, inga kända blockerande/allvarliga fel, relevant produktionsbevis, dokumenterade gröna slutgrindar och korrekt publicerad revision när publicering ingår. En hög lokal testtäckning får inte ersätta detta.
- Saknat bevis räknas som saknat. Ett anslutet konto, konfigurerat schema, worker-kontakt eller deploymentstatus bevisar inte respektive genomfört verksamhetsflöde.
- Samtliga 33 områden väger lika i det aritmetiska totalbetyget. Kritiska blockerare redovisas separat och får inte döljas av medelvärdet.
- Halva poäng är evidensklasser, inte påstådd mätprecision. Ingen automatisk poänghöjning sker när en ny testsiffra eller SHA fylls i.

## Evidensregister och slutgrindar

### E-N — Node

Slutlig full Node-körning: **377/377 tester passerade**, inga fel eller överhoppade, exit 0. `npm run check` passerade för **63 JavaScript-filer** efter sista Node-rättningen. Dokumentcykelns tidigare 368/368 avser ett tidigare källtillstånd. Revisions- och publiceringsbevis kopplas separat till leveransen.

Reproducerbara kommandon från repositoryroten:

```bash
npm ci
npm run check
npm test
npm audit
```

### E-S / G-S — Sites

**G-S: GODKÄND.** Full Sites-svit efter den sista fokusåterställningen: **456/456**, 0 fel, 0 överhoppade, exit 0. TypeScript passerade efter samma ändring. Därefter slutfördes produktionsbygget med exit 0 och `Build complete`. Den tillfälliga QA-sidan togs bort före bygget.

`sites/tests/bank-original-quality-cycle.test.mjs` täcker bland annat att borttagning av ett otillgängligt motpartsbevis inte får släppa fram ett annat okontrollerat original. Denna rättelse och den slutliga fokusåterställningen granskades oberoende. Dokumentcykelns 438/438 är historisk evidens.

```bash
cd sites
npm run install:ci
npm run check
npm test
npm run build
npm audit
```

`node --test` behöver tillåten lokal process-/socketmiljö för integrationstesterna. En sandboxspärr eller en misslyckad testkörning är inte ett godkänt resultat. Riktade red/green-körningar och fulla sviter har hållits åtskilda.

### E-UI — aktuell Chromium-kontroll

Samordnaren har använt riktig Chromium-rendering i förhandsvisning med syntetiska data och CSS-viewport i iframe vid **320, 390, 768, 1024 och 1440 px**. Varje bredd visar **fyra kort och en huvudknapp**; översikt och bankvy hade inget horisontellt överflöde. Sökning `1003` gav en träff och specifikationsfiltret en rad. Vid 390 px är den öppna native-dialogen 370 px bred utan internt överflöde. Enter öppnar och Escape stänger. Ett verkligt fokusfel reproducerades på toppnivå: Escape lämnade fokus på BODY. Efter rättelsen återställs fokus till öppningsknappen med synlig solid 3 px-kontur.

Maskinläsbar aktuell evidens: [ui-verification.json](docs/screenshots/quality-33/ui-verification.json). Syntetiska bilder: [översikt](docs/screenshots/quality-33/overview-desktop.jpg), [mobil betalningsdialog](docs/screenshots/quality-33/payment-detail-mobile.jpg), [tangentbord/fokus](docs/screenshots/quality-33/bank-keyboard-desktop.jpg).

**Avgränsning:** CSS-viewport är inte fysisk enhet eller certifiering över flera webbläsare. Mobilmenyns peksekvens är inte entydigt verifierad. Shift+Tab kunde lämna test-iframe; någon full fokusfällescertifiering påstås inte. Toppnivåns Enter/Escape/fokusretur är separat verifierad. Detta är lokal UI-evidens, **inte** ett inloggat produktionsflöde. Äldre V4-bilder är endast historiska kompletteringar.

### E-PROD — läsande observationer den 30 oktober 2026

Följande statusvärden har rapporterats från samordnarens aktuella läsande produktionskontroller. Ingen kundtext, kontouppgift, token eller originalfil återges här. Tiderna är UTC och beskriver det observerade tillståndet; de är inte löften om fortsatt drift.

| Område | Faktiskt observerat | Vad observationen inte bevisar |
| --- | --- | --- |
| Backup | 2026-10-30: komplett, **191/191 filer**, **63 448 066 byte**, verifieringstid **2026-10-30T01:27:38Z** | Inte ett utfört isolerat återställningsprov av just denna produktionsbackup eller bevis för oberoende katastrofkopia. |
| Bank | Aktiv/ansluten, befintligt **sex-timmarsintervall**, senaste synk **2026-10-30T14:09:57Z**, inga rapporterade fel | Inte individuell Swedbankrapport, samtliga rapportfält eller korrekt matchning av verkliga fakturor i den nya revisionen. |
| Gmail | Externt timschema **DISABLED**; senaste observerade hämtning **2026-10-29T15:00:48Z** | Inte fungerande aktuell timvis automatik. Ingen aktivering utförd eller antagen. |
| Moln-OCR | Senaste observerade worker-kontakt **2026-10-30T09:54:51Z** | Inte ett slutfört aktuellt OCR-jobb eller verifierad körning med användarens dator avstängd. |

Äldre rapporter kan beskriva andra antal original eller aktiva scheman. Dessa historiska värden ersätter inte observationerna ovan.

### G-D / G-P — leveransgrindar att uppdatera

- **G-D:** Båda projektens senaste `npm audit` rapporterar **0 sårbarheter i samtliga allvarlighetsklasser**, enligt samordnarens slutkontroll. **G-D är godkänd lokalt:** Node 377/377, Sites 456/456, syntax 63 filer, TypeScript, produktionsbygge och oberoende slutreview passerade. Exakta kommandon och omfattning finns i `docs/QUALITY-33-DELIVERY.md`. GitHub Actions för publicerad SHA verifieras i G-P.
- **G-P:** Samordnaren fyller i slutlig `main`-SHA, verifierat GitHub Actions-resultat, Sites-källrevision, version/deployment-ID, publiceringsutfall och läsande efterkontroll. Dessa fält är **inte verifierade av denna scorecardversion**.
- Historiskt bevis: `docs/V4-PUBLICATION.md` dokumenterar Sites **version 31** och tidigare publicering. Detta verifierar inte denna körnings ändringar.
- Produktionsdatabas, dokumentlagring, projekt/domän, användaridentitet, runtimehemligheter och anslutningar ska bevaras. Ingen destruktiv återställning, automatisk bankbetalning eller riktig kundsändning ingår i verifieringen.

## Externa blockerare

| ID | Saknat bevis eller förutsättning | Vad krävs för att stänga blockeraren? |
| --- | --- | --- |
| B1 | Autentisk individuell Swedbankrapport, rätt avtalad MIG/XSD, OCR-regel och behörig rapportkanal saknas. | Bank-/avtalsbekräftad profil och läsande kanal samt uttryckligen tillåtet anonymiserat original med kända konto-, datum-, belopps- och individuppgifter. Se `docs/V4-SWEDBANK-CHANNELS.md`. BankID och bankens skydd får inte kringgås. |
| B2 | Aktuellt autentiserat produktionsflöde för den nya leveransen är inte verifierat. | Verifiera rätt publicerad revision i befintligt projekt och tillåtna inloggade användarflöden; håll produktionsdata privata. |
| B3 | Befintligt externt Gmail-timschema är avstängt. | Fastställ om pausen är avsiktlig, hantera befintlig schemastyrning inom mandatet och verifiera verkliga efterföljande körningar/checkpoints. Ett runtimefält räcker inte. |
| B4 | Moln-OCR med avstängd användardator och aktuell lyckad slutföring är inte bevisad. | Kör godkänt syntetiskt original genom befintlig molnkanal när lokal OCR är stoppad; dokumentera originalhash, lease, sparat resultat och tider. |
| B5 | Representativ godkänd fakturakorpus och verksamhetens fullständiga acceptanspolicy saknas. | Tillåtna anonymiserade PDF-/bildoriginal med facit och dokumenterade regler för motparter, kontoändringar, krediter och undantag. |
| B6 | Produktionsbackupens isolerade katastrofprov, oberoende kopia/nyckeltillgång samt RPO/RTO saknar aktuellt bevis. | Separat tillåten återställningsmiljö, godkänd kopia och nyckelhantering; mät fullständighet och tid utan destruktiv produktionsåterställning. |

G-S, G-D och G-P är **interna leveransgrindar**, inte externa blockerare. Bristande tangentbords-, kontrast- eller navigationskontroll är också internt kvarstående arbete.

## Poängöversikt

| Nr | Område | F | S | K | U | P | Poäng / 10 | Prioritet |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | Design och färger | 2 | 1 | 1,5 | 1,5 | 0,5 | **6,5** | P3 |
| 2 | Startsida | 2 | 2 | 1,5 | 1,5 | 0,5 | **7,5** | P3 |
| 3 | Navigering | 1,5 | 1 | 1 | 1 | 0,5 | **5** | P3 |
| 4 | Mobilanpassning | 2 | 1,5 | 1,5 | 1,5 | 0,5 | **7** | P3 |
| 5 | Sökning och filtrering | 2 | 1,5 | 1,5 | 1,5 | 0,5 | **7** | P3 |
| 6 | Minimal manuell hantering | 1,5 | 2 | 1,5 | 1 | 0,5 | **6,5** | P2 |
| 7 | Kundfakturor | 2 | 2 | 2 | 1,5 | 0,5 | **8** | P0 |
| 8 | Leverantörsfakturor | 2 | 2 | 2 | 1,5 | 0,5 | **8** | P0 |
| 9 | PDF-tolkning | 2 | 2 | 2 | 1,5 | 0,5 | **8** | P0 |
| 10 | Bild-OCR | 1,5 | 2 | 2 | 1 | 0,5 | **7** | P2 |
| 11 | Gmail-anslutning | 2 | 2 | 2 | 1 | 0 | **7** | P2 |
| 12 | Automatisk fakturaregistrering | 2 | 2 | 2 | 1 | 0,5 | **7,5** | P2 |
| 13 | Dubblettkontroll | 2 | 2 | 2 | 1,5 | 0,5 | **8** | P0 |
| 14 | Dokumentgranskning | 2 | 2 | 2 | 1 | 0,5 | **7,5** | P2 |
| 15 | Swedbank-anslutning | 2 | 2 | 2 | 1,5 | 1 | **8,5** | P1 |
| 16 | Automatisk bankhämtning | 2 | 2 | 2 | 1,5 | 0,5 | **8** | P1 |
| 17 | Bankgiroimport | 2 | 2 | 2 | 1,5 | 0,5 | **8** | P1 |
| 18 | Identifiera verklig betalare | 1,5 | 2 | 1,5 | 1,5 | 0 | **6,5** | P1 |
| 19 | Verklig OCR/fakturareferens | 1,5 | 2 | 1,5 | 1,5 | 0 | **6,5** | P1 |
| 20 | Automatisk betalningsmatchning | 2 | 2 | 2 | 1,5 | 0 | **7,5** | P0 |
| 21 | Delbetalningar | 2 | 2 | 2 | 1,5 | 0,5 | **8** | P0 |
| 22 | Överbetalningar | 2 | 2 | 2 | 1,5 | 0,5 | **8** | P0 |
| 23 | Flera fakturor i en betalning | 1,5 | 2 | 2 | 1,5 | 0,5 | **7,5** | P0 |
| 24 | Betalningshistorik | 2 | 2 | 2 | 1,5 | 0,5 | **8** | P0 |
| 25 | Betalningsstatus | 2 | 2 | 2 | 1,5 | 0,5 | **8** | P0 |
| 26 | Kontrollera alla betalningar | 2 | 2 | 2 | 1,5 | 0,5 | **8** | P2 |
| 27 | Automatiska mejlutkast | 2 | 2 | 2 | 1,5 | 0,5 | **8** | P2 |
| 28 | Schemalagd automatisering | 1,5 | 2 | 2 | 1 | 0 | **6,5** | P2 |
| 29 | Säkerhetskopiering | 2 | 2 | 2 | 1,5 | 1 | **8,5** | P0 |
| 30 | Säkerhet och åtkomstkontroll | 2 | 2 | 2 | 1,5 | 0,5 | **8** | P0 |
| 31 | Katastrofåterställning | 1,5 | 2 | 2 | 1 | 0 | **6,5** | P0 |
| 32 | Kodkvalitet och tester | 2 | 2 | 1,5 | 1,5 | 0,5 | **7,5** | P4 |
| 33 | Verifiering i verklig produktion | 1,5 | 1 | 1,5 | 1 | 0,5 | **5,5** | P4 |

**Aritmetisk summa:** 243,5 av 330. **Likaviktat medelbetyg:** 7,38/10 (243,5 ÷ 33). **Områden på minst 9,5:** 0 av 33. Lägsta områdespoäng: 5; högsta: 8,5. Medelvärdet är inte ett godkännande av betalningsidentifiering, automatisering eller produktion.

## Bedömning område för område

### 1. Design och färger — 6,5/10

- **Acceptanskriterier:** Svartvit sammanhängande design; tydliga tillstånd och kontraster; viktiga ekonomifakta ska kunna läsas utan tekniska detaljer.
- **Verifierat:** Neutrala översikts- och bankvyer, fyra kort och separerade bankfakta. Chromium-kontrollen E-UI visar inga horisontella överflöden i de två granskade vyerna.
- **Exakta tester och resultat:** `test/bank-ui.test.js`, `test/payment-control-ui.test.js` och `sites/tests/bank-payment-ui.test.mjs`: sex huvudfält, okänd betalare/OCR, separerad fakturareferens och escaperad text. Node ingår i E-N; Sites i E-S.
- **Kod-, API- eller UI-evidens:** `sites/components/economy-overview.tsx`, `sites/components/bank-payments.tsx`, `sites/lib/payment-presentation.ts`; E-UI samt historisk designgranskning i `docs/SITES-MONOCHROME-REVIEW.md`.
- **Återstående problem:** Bankdialogens fokusretur och synliga fokusmarkering är nu kontrollerade. Fullständig kontrastmätning, fokusordning och samtliga övriga formulär/dialoger är inte aktuellt granskade.
- **Prioritet och nästa åtgärd:** P3. Kontrollera kontrast, fokus och fel-/tomlägen på alla huvudvyer; dokumentera den publicerade versionens design.
- **Produktionsverifiering / extern blockerare:** Ja, publicerade huvudvyer. B2; tillgänglighetsgranskningen är dessutom ett internt kvarstående arbete.

### 2. Startsida — 7,5/10

- **Acceptanskriterier:** Fyra ekonomisammanfattningar; en huvudknapp Kontrollera alla betalningar; okända eller ofullständiga värden får inte visas som verifierade nollor.
- **Verifierat:** Fyra kort och huvudåtgärd finns. Laddning/fel ger okända värden. Konflikter och saknade original räknas inte som verifierade månadsinbetalningar.
- **Exakta tester och resultat:** `sites/tests/payment-control-ui.test.mjs`: fyra okända kort innan laddning och dolda gamla belopp vid fel. `sites/tests/economy-quality-cycle.test.mjs`: manuella original, konflikter, saknade original och ofullständigt referensbevis ger inte verifierade intäkter. `test/payment-control-ui.test.js`: huvudåtgärd och åtskilda kontrollerade/obekräftade totalsummor. E-N/E-S; nya sena Sites-fall omfattas av G-S.
- **Kod-, API- eller UI-evidens:** `sites/lib/economy-summary.js`, `sites/lib/payment-overview.ts`, `src/payment-overview.js`, `sites/components/economy-overview.tsx`; E-UI.
- **Återstående problem:** De faktiska företagsbeloppen har inte jämförts med ett komplett autentiskt bankunderlag i inloggad produktion.
- **Prioritet och nästa åtgärd:** P3. Verifiera kortens belopp och klickvägar mot behörigt företagsunderlag efter slutlig publicering.
- **Produktionsverifiering / extern blockerare:** Ja. B1 och B2 för ekonomisk fullständighet.

### 3. Navigering — 5/10

- **Acceptanskriterier:** Fakturor, bank, dokument, meddelanden och inställningar ska nås begripligt; återgång, markerad aktiv vy och tangentbordsvägar ska fungera.
- **Verifierat:** Översikt, banklista och granskningsåtgärder finns; renderade navigationsvägar och historiklänkar täcks av tester. Bankdialogens Enter/Escape och återgång till öppningsknappen är aktuellt verifierade i Chromium.
- **Exakta tester och resultat:** `test/payment-control-ui.test.js`: fem menyområden och bevarad navigering till import/meddelandehistorik. `sites/tests/payment-control-ui.test.mjs`: vald evidens bredvid granskningslistan och en åtgärd per uppgift. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `sites/components/payment-control.tsx`, `sites/components/bank-payments.tsx`, `sites/components/payment-history.tsx`; tidigare flöden beskrivs i `docs/ONE-CLICK-PAYMENT-CONTROL.md`.
- **Återstående problem:** Ingen komplett aktuell genomgång av alla menylänkar, bakåt/framåt och tangentbordsflöden har avslutats. Mobilmenyns peksekvens är uttryckligen inte verifierad; dialogtestet bevisar inte en fullständig fokusfälla.
- **Prioritet och nästa åtgärd:** P3. Genomför en dokumenterad navigationsmatris med tangentbord och webbläsarhistorik på samtliga huvudvyer.
- **Produktionsverifiering / extern blockerare:** Ja. B2; den saknade navigationsmatrisen är ett internt arbete.

### 4. Mobilanpassning — 7/10

- **Acceptanskriterier:** 320, 390, 768, 1024 och 1440 px ska fungera utan dokumentöverflöde; kontroller, tabeller, dialoger och fokus ska vara användbara.
- **Verifierat:** Riktig Chromium-rendering vid alla fem bredder visar fyra översiktskort och bankvy utan horisontellt överflöde. Mobilvyn behåller bankfakta och saknad OCR.
- **Exakta tester och resultat:** `sites/tests/bank-payment-ui.test.mjs`: sex fakta på desktop och explicit saknad OCR på mobil. `sites/tests/payment-control-ui.test.mjs` och `test/payment-control-ui.test.js`: åtgärds- och laddningstillstånd. E-UI är aktuell visuell evidens; historiska V4-dialogtester är endast kompletterande.
- **Kod-, API- eller UI-evidens:** `sites/components/bank-payments.tsx`, `sites/components/economy-overview.tsx`; aktuell `docs/screenshots/quality-33/ui-verification.json`. V4:s motsvarande fil är enbart historisk evidens.
- **Återstående problem:** Bankens native-dialog är nu kontrollerad vid 390 px: 370 px bred utan överflöde, Enter/Escape och återställt fokus på toppnivå. Övriga formulär/dialoger, skärmtangentbord, hjälpmedel, fysisk enhet och mobilmenyns peksekvens återstår.
- **Prioritet och nästa åtgärd:** P3. Utöka samma fem bredder till dokumentgranskning, fakturadetalj, inloggning och öppna dialoger.
- **Produktionsverifiering / extern blockerare:** Ja. B2; resterande responsivitet kan först verifieras lokalt.

### 5. Sökning och filtrering — 7/10

- **Acceptanskriterier:** Sökning efter fakturanummer inklusive nollor, kund och referens; förutsägbara filter; inga tysta bortfall eller förslag som blir bankfakta.
- **Verifierat:** I aktuell Chromium-demo gav sökning 1003 en träff och specifikationsfiltret en rad. Referenser hålls åtskilda från bankens faktiska OCR.
- **Exakta tester och resultat:** `test/payment-control-ui.test.js`: köfilter och exkludering av samlingsposter/återbetalningar från identifiering. `sites/tests/invoice-candidates.test.mjs`, `sites/tests/bank-payment-ui.test.mjs`: fakturakandidater och bevisseparation. E-N/E-S; faktisk sökning/filter i E-UI.
- **Kod-, API- eller UI-evidens:** `sites/components/payment-bank-filter.ts`, `sites/lib/bankgiro-invoice-search.ts`, `sites/lib/banking/invoice-candidates.ts`.
- **Återstående problem:** Stora företagsdatamängder, kombinerade filter, tomresultat, återställning och full tangentbordsanvändning är inte slutverifierade.
- **Prioritet och nästa åtgärd:** P3. Testa filterkombinationer och nollprefix på representativ större syntetisk datamängd och därefter i behörig produktionsvy.
- **Produktionsverifiering / extern blockerare:** Ja. B2; volym- och tangentbordsfallen är interna nästa steg.

### 6. Minimal manuell hantering — 6,5/10

- **Acceptanskriterier:** Säkra fall ska hanteras automatiskt; osäkra fall ska samlas en gång med tydlig nästa åtgärd; ingen minskning av beviskraven.
- **Verifierat:** Samordnad kontroll, beständiga jobb, dokumentkö och säkra automatiska matchningar finns. Osäkra bilagor bevaras nu och felaktigt gröna dokument stoppas.
- **Exakta tester och resultat:** `test/payment-control.test.js`, `sites/tests/payment-control.test.mjs`: idempotent kontroll, begränsade försök, en uppgift per betalning. Båda `document-quality-cycle`-filerna: ofullständiga fält och motstridig metadata kräver granskning. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `src/payment-control.js`, `sites/lib/payment-control.ts`, `src/invoice-review.js`, `sites/lib/document-processing.ts`.
- **Återstående problem:** Ingen mätning av faktisk manuell tid eller andel säkra automatfall. Gmail-schemat är pausat; verkliga bankdetaljer saknas.
- **Prioritet och nästa åtgärd:** P2. Mät genomströmning, automationsgrad och kvarvarande undantag över en kontrollerad driftperiod utan att lätta på säkerhetsregler.
- **Produktionsverifiering / extern blockerare:** Ja. B1, B3, B4 och B5.

### 7. Kundfakturor — 8/10

- **Acceptanskriterier:** Exakt fakturanummer/kund/valuta/belopp; korrekt saldo och kredit-/återbetalningshantering; verifierade kopplingar och bevarade original.
- **Verifierat:** Fakturaregister, heltalsören, uttrycklig granskning, saldo och originalkoppling är testade. Förslag ändrar inte saldo; återbetalningar kan inte automatiskt reglera vanliga kundfakturor.
- **Exakta tester och resultat:** `test/invoice-extraction.test.js`, `test/db.test.js`, `test/node-payments-quality-cycle.test.js`: fält, registrering, saldo och kredit/återbetalningsgränser. `sites/tests/domain.test.mjs`, `sites/tests/customer-messages.test.mjs`, `sites/tests/sites-payments-quality-cycle.test.mjs`: motsvarande ekonomiska regler. E-N/E-S och G-S för sena originalfall.
- **Kod-, API- eller UI-evidens:** `src/db.js`, `src/invoice-review.js`, `sites/lib/domain.ts`, `sites/components/invoice-evidence.tsx`.
- **Återstående problem:** Fullständigt autentiskt kundfakturaflöde till bankavstämning och aktuell inloggad UI-granskning saknas.
- **Prioritet och nästa åtgärd:** P0. Kontrollera kundfaktura, eventuell kredit och betalningssaldo mot tillåtet original i den publicerade versionen.
- **Produktionsverifiering / extern blockerare:** Ja. B1, B2 och B5.

### 8. Leverantörsfakturor — 8/10

- **Acceptanskriterier:** Rätt leverantör, organisationsnummer, förfallodag, moms, netto och betalningskonto; inga dubbla skulder eller automatiskt accepterade kontoändringar.
- **Verifierat:** Leverantörsriktning och utgående betalningar testas. Node återanvänder endast mänskligt granskad identitet/konto med intakt original; ändrat Bankgiro eller saknad moms/netto stoppar automatik.
- **Exakta tester och resultat:** `test/document-quality-cycle.test.js`: ändrat Bankgiro, saknad moms/netto och ogranskad identitet skapade tidigare extra faktura och stoppas nu. `sites/tests/gmail.test.mjs`: verifierad motpart, kontoavvikelse, ändrat belopp och dubbletter. `sites/tests/bank-payment-ui.test.mjs` och matchningstesterna täcker riktning. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `src/invoice-review.js`, `sites/lib/document-processing.ts`, `sites/lib/reconciliation-engine.js`.
- **Återstående problem:** Företagets kompletta motpartspolicy och representativa verkliga leverantörslayouter är inte accepterade i produktion.
- **Prioritet och nästa åtgärd:** P0. Verifiera policy för kontoändring, krediter och nya leverantörer med anonymiserade godkända original; kontrollera granskningsflödet.
- **Produktionsverifiering / extern blockerare:** Ja. B2 och B5; policybeslut krävs där regler saknas.

### 9. PDF-tolkning — 8/10

- **Acceptanskriterier:** Text-PDF ska läsas inom gränserna; skannade PDF ska gå vidare till OCR; ogiltiga fält, motstridiga källor och ändrade original får inte bli verifierade.
- **Verifierat:** Fältextraktion bevarar nollor och källtext. Ogiltiga extra värden kan inte längre döljas av ett giltigt värde. Sites kontrollerar PDF-originalets hash och storlek före tolkning.
- **Exakta tester och resultat:** `test/invoice-extraction.test.js`: riktig syntetisk text-PDF, skannad PDF och ogiltig PDF. Båda `document-quality-cycle`-filerna: felaktiga totalsummor/datum/orgnr, metadata och bevarade källor. `sites/tests/server-pdf.test.mjs`: parsergränser. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `src/invoice-extraction.js`, `src/invoice-worker.js`, `sites/lib/invoice-fields.js`, `sites/lib/server-pdf.ts`, `sites/lib/document-processing.ts`.
- **Återstående problem:** Verklig layoutvariation och feldetekteringsgrad har inte mätts mot en representativ märkt fakturakorpus.
- **Prioritet och nästa åtgärd:** P0. Bygg godkänd anonymiserad facitkorpus och mät fältexakthet samt falskt gröna resultat per layout.
- **Produktionsverifiering / extern blockerare:** Ja för precision i företagets underlag. B5; originalkorpusen saknas.

### 10. Bild-OCR — 7/10

- **Acceptanskriterier:** PNG/JPEG/WebP och skannade PDF ska behandlas säkert; osäkra OCR-fält ska granskas; molnbehandling ska bevisas med datorn avstängd.
- **Verifierat:** Svensk Tesseract körs faktiskt i syntetiska integrationstester. OCR-resultat har begränsad säkerhetsgrad, leasing och bevarade original. Senaste observerade molnkontakt är 09:54:51Z den 30 oktober.
- **Exakta tester och resultat:** `test/invoice-extraction.test.js`: PNG/JPEG/WebP och skannad PDF. `sites/tests/cloud-ocr.test.mjs`: faktisk pull-klient till Sites-jobb, privat lagringsfixture, Tesseract och sparad tolkning. `test/sites-ocr-pull.test.js`: hash, gränser och fel. E-N/E-S; kontaktstatus E-PROD är inte ett färdigt jobb.
- **Kod-, API- eller UI-evidens:** `src/invoice-worker.js`, `src/sites-ocr-pull.js`, `sites/lib/document-processing.ts`, `.github/workflows/sites-cloud-ocr.yml`; `docs/V3-CLOUD-OCR-RUNNER.md`.
- **Återstående problem:** Ingen aktuell produktionstest med avstängd användardator och verifierat slutfört molnjobb. Inga representativa precisionstal.
- **Prioritet och nästa åtgärd:** P2. Kör ett godkänt syntetiskt original genom befintlig molnkörning när lokal OCR är stoppad; jämför resultat/hash och dokumentera jobbtider.
- **Produktionsverifiering / extern blockerare:** Ja. B4 och B5.

### 11. Gmail-anslutning — 7/10

- **Acceptanskriterier:** Rätt konto, läsbehörighet, säkra tokens, beständiga checkpoints och faktiskt återkommande hämtning; ansluten får inte förväxlas med lyckad körning.
- **Verifierat:** OAuth, kontoägare, Retry-After, förlorade svar och leasebyte testas. Statusanrop är nu begränsade och läsande. Osäkra original sparas i stället för att kastas på grund av rubrik/filnamn.
- **Exakta tester och resultat:** `test/gmail.test.js`, `test/gmail-api.test.js`, `sites/tests/gmail.test.mjs`: konto, scopes, idempotens, sena svar och status utan dokumenttext/sidoeffekter. Båda dokumentkvalitetssviterna: fem osäkra bilagor behålls, inline-logo filtreras. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `src/gmail.js`, `sites/lib/gmail-adapter.js`, `sites/lib/gmail-service.ts`, `sites/lib/banking/mcp.ts`, `sites/components/gmail-summary.tsx`; E-PROD.
- **Återstående problem:** Det externa timschemat är DISABLED. Senaste observerade hämtning är 2026-10-29T15:00:48Z; aktuell automatisk leverans är alltså inte verifierad.
- **Prioritet och nästa åtgärd:** P2. Fastställ varför befintligt schema är pausat, hantera pausen i dess rätta styrning och verifiera nya faktiska körningar/checkpoints.
- **Produktionsverifiering / extern blockerare:** Ja. B3 och B2. Ingen aktivering påstås vara utförd.

### 12. Automatisk fakturaregistrering — 7,5/10

- **Acceptanskriterier:** Endast fullständiga, konfliktfria, entydiga och företagsverifierade underlag får registreras automatiskt; korrekta original och motpart måste finnas vid beslutet.
- **Verifierat:** Grön extraktion, verifierad motpart, konto/valuta, moms/netto, dubblettkontroll och atomiskt registreringsbeslut finns. Förlorad lease, kontoavvikelse och osäker OCR förhindrar registrering.
- **Exakta tester och resultat:** `test/invoice-extraction.test.js`: opt-in och kända identiteter. `test/document-quality-cycle.test.js`: mänskligt granskningsbevis och originalintegritet. `sites/tests/gmail.test.mjs`: registrering en gång, kontoavvikelse och manuell registrering under lease. `sites/tests/document-quality-cycle.test.mjs`: originalhash/storlek före PDF. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `src/invoice-review.js`, `sites/lib/document-processing.ts`; historisk policy i `docs/SITES-DOCUMENT-AUTOMATION.md`.
- **Återstående problem:** Företagets kompletta acceptanspolicy och verklig automatisk genomströmning är inte verifierade; pausad Gmail-hämtning begränsar kedjan.
- **Prioritet och nästa åtgärd:** P2. Godkänn explicita motparts-/kontoregler och följ säkra samt osäkra provfall genom publicerad registrering med full revisionskedja.
- **Produktionsverifiering / extern blockerare:** Ja. B2, B3 och B5.

### 13. Dubblettkontroll — 8/10

- **Acceptanskriterier:** Samma original, faktura eller ekonomiska betalning får inte räknas två gånger; kopior, återförsök, omstart och konkurrens ska bevara historiken.
- **Verifierat:** Originalhash/source-id och semantisk fakturaidentitet kontrolleras. Kopior och olika belopp på samma faktura stoppas. Betalningsdubbletter och samlingsposter testas separat.
- **Exakta tester och resultat:** `test/invoice-extraction.test.js`: samma bytes i två mejl, alternativ PDF-kopia, explicit koppling till befintlig faktura. `sites/tests/gmail.test.mjs`: kopia och ändrat belopp skapar inte ny skuld. `test/payment-concurrency.test.js`, `sites/tests/sites-payments-quality-cycle.test.mjs`: parallell import och samlingspost en gång. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `src/db.js`, `src/invoice-review.js`, `sites/lib/document-processing.ts`, `sites/lib/domain.ts`; revisions- och registreringstabeller.
- **Återstående problem:** Historiska namn-/organisationsändringar och företagets fakturanummerserier har inte genomgått full produktionsinventering. Tester bevisar inte frånvaro av alla historiska dubbletter.
- **Prioritet och nästa åtgärd:** P0. Gör läsande dubblettanalys av tillåten historik och kontrollera nya varianter med syntetiska reproduktioner före eventuell rättning.
- **Produktionsverifiering / extern blockerare:** Ja. B2 och B5; inga riktiga poster har ändrats för test.

### 14. Dokumentgranskning — 7,5/10

- **Acceptanskriterier:** Osäkra dokument ska finnas kvar med original, fältekälla, konflikter, korrigering och tolkningshistorik; en granskning ska inte döljas som noll eller klar.
- **Verifierat:** Missvisande filnamn/rubriker och ogiltiga extrafält kräver granskning. Node bevarar varje tolkning i audit. Sites har separat tolkningshistorik; avvisning raderar inte original.
- **Exakta tester och resultat:** Båda `document-quality-cycle`-filerna: källkonflikt, terms-rubrik med fakturabevis och oläslig logo. `sites/tests/gmail.test.mjs`: avvisning avbryter lease utan originalförlust. `sites/tests/payment-control-ui.test.mjs`: läsbar evidens bredvid vald granskning och laddning skild från tom kö. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `src/invoice-review.js`, `sites/lib/document-processing.ts`, `sites/components/invoice-evidence.tsx`, `sites/components/gmail-workspace.tsx`.
- **Återstående problem:** Aktuell fullständig användargranskning med tangentbord, dokumentförhandsvisning och rättad faktura har inte körts i inloggad produktion.
- **Prioritet och nästa åtgärd:** P2. Verifiera från kö till original, fältkorrigering, historik och slutligt beslut på desktop och mobil.
- **Produktionsverifiering / extern blockerare:** Ja. B2 och B5.

### 15. Swedbank-anslutning — 8,5/10

- **Acceptanskriterier:** Aktiv ägd anslutning, uttryckligt kontoval, korrekt medgivande/utgång och säkra fel; förnyelse får inte duplicera ekonomiska poster.
- **Verifierat:** Bankstatus visar aktiv anslutning, sex timmars automatik och inga rapporterade fel. Kontoägare, konto-UID-förnyelse, callback, behörighet och cooldown testas isolerat.
- **Exakta tester och resultat:** `test/bank-api.test.js`: inloggning, kontoval, fel ägare, återkallat medgivande och förnyad kontoidentitet. `sites/tests/banking-security.test.mjs`, `sites/tests/banking-provider.test.mjs`: samma ägar-/token-/kontoegenskaper. E-N/E-S; aktuell status i E-PROD.
- **Kod-, API- eller UI-evidens:** `src/bank.js`, `sites/lib/banking/service.ts`, `sites/lib/banking/store.ts`, `sites/components/bank-connection.tsx`.
- **Återstående problem:** Anslutningsstatus verifierar inte tillgång till individuella Bankgirobetalare eller det nya kodpaketets samtliga produktionsflöden.
- **Prioritet och nästa åtgärd:** P1. Efter publicering kontrollera samma anslutning, kontoägarskap och rapporterade körtider; håll individuell rapportåtkomst separat.
- **Produktionsverifiering / extern blockerare:** Ja. B2; B1 gäller individuell rapportering, inte att AIS-anslutningen existerar.

### 16. Automatisk bankhämtning — 8/10

- **Acceptanskriterier:** Endast valda konton, leverantörens intervall och beständiga lås; återförsök får inte duplicera belopp eller fabricera klientkontext.
- **Verifierat:** Sex-timmarsautomatik och senaste lyckade bankhämtning 2026-10-30T14:09:57Z observerades. Lås, försök, stabila tidsfönster och omstartsfencing testas.
- **Exakta tester och resultat:** `test/integration-jobs.test.js`, `test/integration-job-api.test.js`, `test/bank-api.test.js`: beständig lease/cooldown. `sites/tests/banking-security.test.mjs`: inga fabricerade PSU-fält, stabila Stockholmstider, återhämtning och sex-timmarsgräns. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `src/integration-jobs.js`, `sites/lib/banking/service.ts`; E-PROD och historiska `docs/SWEDBANK-AUTOMATIC.md`.
- **Återstående problem:** En observerad senaste körning är inte en verifierad serie av schemakörningar över driftstörning och återstart för den nya revisionen.
- **Prioritet och nästa åtgärd:** P1. Följ flera planerade körningar och verifiera tidsgränser, antal importer och idempotens med läsande efterkontroll.
- **Produktionsverifiering / extern blockerare:** Ja. B2; B1 blockerar separat automatisk individuell rapporthämtning.

### 17. Bankgiroimport — 8/10

- **Acceptanskriterier:** CSV/camt ska validera konto, riktning, datum, valuta, referenser, antal och totalsumma; original ska finnas; förälder och detaljer räknas en gång.
- **Verifierat:** Syntetiska camt/CSV-grupper, originalhash, fel struktur och flera detaljer är testade. En andra specifikation kan inte förbruka en redan ersatt samlingsinsättning.
- **Exakta tester och resultat:** `test/importers.test.js`, `test/camt-integrity.test.js`, `test/file-account-evidence.test.js`, `test/node-payments-quality-cycle.test.js`; `sites/tests/bankgiro.test.mjs`, `sites/tests/bankgiro-api.test.mjs`, `sites/tests/camt-integrity.test.mjs`, `sites/tests/sites-payments-quality-cycle.test.mjs`. E-N/E-S. Sena kontroller av kvarvarande original: `sites/tests/bank-original-quality-cycle.test.mjs`, G-S.
- **Kod-, API- eller UI-evidens:** `src/importers.js`, `src/db.js`, `sites/lib/camt-xml.js`, `sites/lib/bankgiro-parser.js`, `sites/lib/bankgiro-service.ts`.
- **Återstående problem:** Ingen autentisk individuell företagsrapport med rätt avtalad MIG/XSD har verifierats. Generell XML-validering är inte full bankprofilcertifiering; Bg Max är inte verifierat stöd.
- **Prioritet och nästa åtgärd:** P1. Validera en godkänd anonymiserad originalrapport mot företagets exakta profil och kända samlingspost.
- **Produktionsverifiering / extern blockerare:** Ja. B1 är uttrycklig extern blockerare.

### 18. Identifiera verklig betalare — 6,5/10

- **Acceptanskriterier:** Bankens betalare ska vara spårbar till autentiskt underlag och skiljas från fakturakund, manuell relation och förslag; saknad identitet ska sägas uttryckligen.
- **Verifierat:** Kod och syntetiska tester separerar bankidentitet, kund och manuell komplettering. Motstridig bankidentitet spärras och bevaras; beloppslikhet ger ingen betalare.
- **Exakta tester och resultat:** `test/bank-ui.test.js`, `test/payment-control-ui.test.js`, `test/node-payments-quality-cycle.test.js`; `sites/tests/bank-payment-ui.test.mjs`, `sites/tests/bank-details.test.mjs`, `sites/tests/economy-quality-cycle.test.mjs`. E-N/E-S; ingen testfixture är ett autentiskt Swedbankbevis.
- **Kod-, API- eller UI-evidens:** `src/bank-evidence.js`, `src/reconciliation.js`, `sites/lib/payment-presentation.ts`, `sites/lib/banking/detail-evidence.ts`; `docs/V4-SWEDBANK-CHANNELS.md`.
- **Återstående problem:** Företagets autentiska individuella rapport och avtalade leveranskanal saknas. Verklig betalaridentifiering är därför inte produktionsverifierad.
- **Prioritet och nästa åtgärd:** P1. Hämta behörigt original med känd betalare via avtalad läsande kanal och spåra varje visat fält till källan.
- **Produktionsverifiering / extern blockerare:** Ja, obligatoriskt autentiskt bevis. B1 och B2.

### 19. Verklig OCR/fakturareferens — 6,5/10

- **Acceptanskriterier:** Endast uttryckliga betalningsreferenser med källa; nollor och skiljetecken bevaras; eget Bankgiro, intern bankreferens eller förslag får inte bli OCR.
- **Verifierat:** Referensextraktion och presentationsregler separerar fakturanummer, OCR och intern bankreferens. Motstridiga kandidater och felaktiga uttryckliga OCR-värden kräver granskning.
- **Exakta tester och resultat:** `test/payment-references.test.js`, `test/bank-reference-storage.test.js`, `test/node-payments-quality-cycle.test.js`; `sites/tests/payment-references.test.mjs`, `sites/tests/bank-payment-ui.test.mjs`: nollor, källvägar, falsk OCR och konflikter. E-N/E-S; sena kontrollsifferfall omfattas av senaste E-N.
- **Kod-, API- eller UI-evidens:** `src/payment-references.js`, `sites/lib/payment-references.js`, `sites/lib/payment-presentation.ts`, `sites/lib/camt-xml.js`.
- **Återstående problem:** Faktisk Swedbankfältprofil, företagets OCR-längd-/kontrollavtal och autentiskt individuellt original saknas. Giltig kontrollsiffra ersätter inte dessa bevis.
- **Prioritet och nästa åtgärd:** P1. Bekräfta profil och OCR-avtal och jämför bevarade fält med ett autentiskt individuellt bankunderlag.
- **Produktionsverifiering / extern blockerare:** Ja. B1 och B2; detta område får inte godkännas genom enbart syntetiska tester.

### 20. Automatisk betalningsmatchning — 7,5/10

- **Acceptanskriterier:** Bokförd betalning, rätt riktning/valuta/konto, entydig referens och faktura, verifierad motpart, tillgängligt original och korrekt återstående saldo krävs.
- **Verifierat:** Återbetalningar, egna överföringar, löner och kortuttag kan inte reglera vanliga fakturor automatiskt. Stabilt bank-ID med motstridiga fakta spärras, gamla original och allokeringar bevaras för granskning.
- **Exakta tester och resultat:** `test/reconciliation.test.js`, `test/node-payments-quality-cycle.test.js`, `test/payment-concurrency.test.js`; `sites/tests/sites-payments-quality-cycle.test.mjs`, `sites/tests/customer-messages.test.mjs`. E-N/E-S. `sites/tests/bank-original-quality-cycle.test.mjs` prövar saknat original, föräldraoriginal och borttagna motpartsbevis; fasta-punkt-fallet ingår i det godkända 456-resultatet. G-S avser återkörning efter sista fokusfixen.
- **Kod-, API- eller UI-evidens:** `src/reconciliation.js`, `src/db.js`, `sites/lib/reconciliation.ts`, `sites/lib/reconciliation-engine.js`, `sites/lib/reconciliation-evidence.ts`.
- **Återstående problem:** Ingen fullständig jämförelse mot autentiska individuella företagsbetalningar. Originalvalideringen är grön och oberoende granskad; slutlig G-S efter fokusfix och publiceringsgrindarna återstår.
- **Prioritet och nästa åtgärd:** P0. Slutför G-S, därefter läsande jämförelsekörning mot godkända autentiska data; verifiera att inga förslag ändrar saldo.
- **Produktionsverifiering / extern blockerare:** Ja. B1 och B2; G-S är intern leveransgrind, inte extern blockerare.

### 21. Delbetalningar — 8/10

- **Acceptanskriterier:** Exakta ören och återstående saldo, flera verifierade betalningar över tid samt återtagning utan dubbel allokering.
- **Verifierat:** Verifierade delbetalningar reducerar saldo; förslag gör det inte. Aktiva allokeringar, otillräckligt belopp och återtagning är testade.
- **Exakta tester och resultat:** `test/db.test.js`, `test/reconciliation.test.js`, `test/customer-messages.test.js`; `sites/tests/domain.test.mjs`, `sites/tests/customer-messages.test.mjs`: delbetalning lämnar exakt 625 SEK i det syntetiska fallet. `sites/tests/bank-payment-ui.test.mjs`: delbetalningsstatus även när bankraden är fullt allokerad. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `src/db.js`, `sites/lib/domain.ts`, `sites/lib/payment-presentation.ts`.
- **Återstående problem:** Verkliga delbetalningsserier och eventuella bankavgifter är inte avstämda i aktuell produktion.
- **Prioritet och nästa åtgärd:** P0. Kontrollera en känd delbetalningsserie och visa fakturasaldo samt varje bankkoppling med oförändrade original.
- **Produktionsverifiering / extern blockerare:** Ja. B1, B2 och behörigt jämförelseunderlag.

### 22. Överbetalningar — 8/10

- **Acceptanskriterier:** Överskott ska vara synligt och behållas i exakta ören; ingen automatisk utbetalning eller ogrundad omfördelning.
- **Verifierat:** Fakturasaldo, allokerat belopp och disponibelt överskott skiljs åt. Utkast kan beskriva verifierat överskott men skickas inte automatiskt.
- **Exakta tester och resultat:** `test/customer-messages.test.js`: verkligt bankbelopp och ej allokerat överskott behålls. `sites/tests/domain.test.mjs`, `sites/tests/customer-messages.test.mjs`: exakt betalning/överskott/flera betalningar. UI-sviterna visar överskott skilt från bankradens allokering. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `src/db.js`, `src/customer-messages.js`, `sites/lib/domain.ts`, `sites/lib/customer-messages.ts`.
- **Återstående problem:** Inget autentiskt produktionsfall med överskott och administrativ åtgärd har slutverifierats.
- **Prioritet och nästa åtgärd:** P0. Verifiera ett godkänt överbetalningsfall inklusive ofördelat belopp och eventuellt granskat utkast; genomför ingen bankbetalning.
- **Produktionsverifiering / extern blockerare:** Ja. B1 och B2.

### 23. Flera fakturor i en betalning — 7,5/10

- **Acceptanskriterier:** En bankbetalning ska kunna fördelas kontrollerat mellan flera fakturor utan att totalen överskrids; beloppskombinationer får inte uppfinna referenser.
- **Verifierat:** Explicit manuell fördelning och överallokeringsspärrar finns. Flera referenskandidater behandlas konservativt och skapar inte en automatisk beloppskombination.
- **Exakta tester och resultat:** `test/db.test.js`, `test/reconciliation.test.js`, `test/payment-references.test.js`; `sites/tests/domain.test.mjs`, `sites/tests/economy.test.mjs`: två referenser förblir fördelningsförslag och saldon bevaras. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `src/db.js`, `src/reconciliation.js`, `sites/lib/domain.ts`, `sites/lib/reconciliation-engine.js`.
- **Återstående problem:** Företagets fullständiga flerfaktura-/kreditpolicy och aktuellt inloggat fördelningsflöde saknar produktionsacceptans. Säker automatik för alla sådana fall påstås inte finnas.
- **Prioritet och nästa åtgärd:** P0. Definiera tillåtna fördelningsbeslut och verifiera ett autentiskt flerfakturafall med total, återtagning och revisionshistorik.
- **Produktionsverifiering / extern blockerare:** Ja. B1 och B2 samt tydlig verksamhetspolicy.

### 24. Betalningshistorik — 8/10

- **Acceptanskriterier:** Ursprungliga fakta, verifieringar, korrigeringar och återtagningar ska kunna följas; historiken ska vara ägarisolerad och inte kapas av en global senaste-lista.
- **Verifierat:** Äldre verifieringar, paginering, återtagna kopplingar och förälder/detaljhistorik är testade. Konflikter skriver inte över ursprungliga bankfakta.
- **Exakta tester och resultat:** `sites/tests/payment-history.test.mjs`: poster äldre än senaste 100, stabil paginering, fel ägare/cursor, defekta äldre auditpayloads och parent/child. `test/node-payments-quality-cycle.test.js`: ursprungsfakta och befintliga allokeringar bevaras vid konflikt. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `sites/lib/payment-history.ts`, `sites/components/payment-history.tsx`, `src/db.js`; revisionsfält i båda databaserna.
- **Återstående problem:** Företagets större historik, åtkomst och användbarhet i aktuell publicerad vy är inte fullständigt granskade.
- **Prioritet och nästa åtgärd:** P0. Kontrollera en äldre verklig betalningskedja läsande, inklusive rättelse och original, utan att ändra historiken.
- **Produktionsverifiering / extern blockerare:** Ja. B2 och behörigt historiskt underlag.

### 25. Betalningsstatus — 8/10

- **Acceptanskriterier:** Betald, delbetald, överbetald, ej avstämd och behöver granskning ska bero på verifierade kopplingar/saldo; saknat original eller konflikt får inte beskrivas som verifierat.
- **Verifierat:** Status bygger på saldo och bevis. En allokering i sig kan inte lära ut ny motpartsidentitet när underlaget är i konflikt; osäkra mottagna belopp visas inte som verifierad månadsintäkt.
- **Exakta tester och resultat:** `test/payment-control-ui.test.js`, `test/payment-control-api.test.js`, `test/node-payments-quality-cycle.test.js`; `sites/tests/bank-payment-ui.test.mjs`, `sites/tests/economy-quality-cycle.test.mjs`: ofullständig referens, konflikt, originalbrist och obekräftade nollor. E-N/E-S och G-S för sena originalfall.
- **Kod-, API- eller UI-evidens:** `src/payment-overview.js`, `sites/lib/payment-presentation.ts`, `sites/lib/economy-summary.js`, `sites/lib/payment-overview.ts`.
- **Återstående problem:** Ingen aktuell produktionsjämförelse av samtliga statusklasser mot bankoriginal och fakturasaldo.
- **Prioritet och nästa åtgärd:** P0. Verifiera en tabell av faktiska godkända statusfall och tillhörande beviskedjor efter publicering.
- **Produktionsverifiering / extern blockerare:** Ja. B1 och B2.

### 26. Kontrollera alla betalningar — 8/10

- **Acceptanskriterier:** En tydlig huvudåtgärd ska samordna befintlig hämtning, tolkning, kontroll och kö; vara återupptagbar/idempotent och aldrig skicka mejl eller genomföra betalning.
- **Verifierat:** Beständiga körningar, ägarbundna anrop, idempotensnyckel, samtidighet och väntetider finns. Förlorat svar återanvänder samma begäran. Delvis resultat visas som delvis.
- **Exakta tester och resultat:** `test/payment-control.test.js`, `test/payment-control-api.test.js`, `test/payment-control-ui.test.js`; `sites/tests/payment-control.test.mjs`, `sites/tests/payment-control-ui.test.mjs`: en autentiserad kontroll, CSRF, återförsök, stale cache och inga kundutskick. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `src/payment-control.js`, `sites/lib/payment-control.ts`, `sites/components/payment-control.tsx`; E-UI visar huvudknappen, inte en körning mot företagsdata.
- **Återstående problem:** Hela knappen har inte körts och jämförts mot verkliga företagsdata i den nya publicerade versionen. Gmail-paus och saknade rapporter begränsar fullständigheten.
- **Prioritet och nästa åtgärd:** P2. Efter grön leverans kontrollera behörigt end-to-end-flöde med tydliga förväntade delresultat och bevarade scheman.
- **Produktionsverifiering / extern blockerare:** Ja. B1, B2, B3 och B4.

### 27. Automatiska mejlutkast — 8/10

- **Acceptanskriterier:** Sakliga utkast från verifierade belopp; ingen ogrundad betalningsanklagelse; exakt aktuell version och mottagare måste godkännas innan sändning.
- **Verifierat:** Systemet förbereder utkast. Betalning eller redigering ogiltigförklarar gammalt granskningsbevis. Dubbelklick ger en sändningsreservation; okänd leverans får inte automatiskt skickas igen.
- **Exakta tester och resultat:** `test/customer-messages.test.js`, `test/customer-messages-api.test.js`, `test/gmail-send.test.js`; `sites/tests/customer-messages.test.mjs`: mottagarverifiering, ofullständigt momsunderlag, stale version, fel webbläsare, timeout och inga schedulerutskick. E-N/E-S.
- **Kod-, API- eller UI-evidens:** `src/customer-messages.js`, `sites/lib/customer-messages.ts`, `sites/components/customer-messages.tsx`; syntetiska provideradaptrar används i tester.
- **Återstående problem:** Aktuell administratörsgranskning av utkast/mottagare i produktion har inte kontrollerats. Inga riktiga kundmejl har skickats i denna körning.
- **Prioritet och nästa åtgärd:** P2. Verifiera läsande ett kontrollerat utkast och dess källor; faktisk sändning kräver uttryckligt godkännande av den aktuella versionen.
- **Produktionsverifiering / extern blockerare:** Ja för produktionsflödet. B2; testgrönt sändningsflöde är inte sändningsgodkännande.

### 28. Schemalagd automatisering — 6,5/10

- **Acceptanskriterier:** Bank, Gmail, OCR och backup ska köras inom godkända intervall; faktisk körning, paus, väntetid, fel och senaste lyckade utfall ska skiljas åt.
- **Verifierat:** Beständiga lås/backoff, tre-försöksgränser, leasebyte och begränsade statusanrop är testade. Bank och backup har aktuella drifttecken, men Gmail-timschemat är avstängt.
- **Exakta tester och resultat:** `test/integration-jobs.test.js`, `test/integration-job-api.test.js`, `sites/tests/banking-security.test.mjs`, `sites/tests/gmail.test.mjs`, `sites/tests/cloud-ocr.test.mjs`, båda backupsviterna: omstart, sena svar, cooldown och kontakt skild från slutfört jobb. E-N/E-S; E-PROD.
- **Kod-, API- eller UI-evidens:** `src/integration-jobs.js`, `sites/lib/banking/service.ts`, `sites/lib/gmail-service.ts`, `.github/workflows/sites-cloud-ocr.yml`, `sites/lib/backup-engine.ts`.
- **Återstående problem:** Det avstängda Gmail-schemat och avsaknad av bevis för aktuell avslutad moln-OCR gör att obemannad helhet inte är verifierad.
- **Prioritet och nästa åtgärd:** P2. Fastställ avsikten med pausen och följ befintliga scheman under en driftperiod, inklusive ett kontrollerat avbrott och återhämtning.
- **Produktionsverifiering / extern blockerare:** Ja. B3 och B4; ingen ny betaltjänst eller ändrat bankmedgivande behövs för kodtesterna.

### 29. Säkerhetskopiering — 8,5/10

- **Acceptanskriterier:** Krypterad komplett snapshot och alla original; integritetsbevis, ägarbindning, beständig återupptagning och ingen falsk framgång vid saknat original/nyckel.
- **Verifierat:** Aktuell läsande produktionsstatus anger komplett backup 191/191 filer, 63 448 066 byte, verifierad 2026-10-30T01:27:38Z. Isolerade återläsningar, manipulering och låskonkurrens är testade.
- **Exakta tester och resultat:** `test/backup.test.js`: SQLite-snapshot, kryptering, separat återställning, fel nyckel och Stockholm-dygn. `sites/tests/backup.test.mjs`: alla original, fel ägare/objekt/nyckel/hash, saknat original, avbrott och sena leaseägare. E-N/E-S; E-PROD.
- **Kod-, API- eller UI-evidens:** `src/backup.js`, `sites/lib/backup-engine.ts`, `sites/lib/backups.ts`; `docs/AUTOMATION-BACKUP.md`.
- **Återstående problem:** Den rapporterade produktionsbackupens status är inte ett utfört återställningsprov av just den backupen. Oberoende extern katastrofkopia och nyckeltillgång är inte verifierade.
- **Prioritet och nästa åtgärd:** P0. Verifiera samma backup i isolerad miljö, jämför databas/original/hash och dokumentera separat återställningsnyckel samt extern kopia.
- **Produktionsverifiering / extern blockerare:** Ja. B6. Ingen destruktiv produktionsåterställning är genomförd eller godkänd här.

### 30. Säkerhet och åtkomstkontroll — 8/10

- **Acceptanskriterier:** Ägarisolering, autentisering, CSRF, säkra sessioner, tokenkryptering, begränsade jobb och inga hemligheter eller dokumentkroppar i onödiga statussvar.
- **Verifierat:** HTTP-/D1-gränser, OAuth-replay, fel ägare, kontoval, nyckelbindning och originalintegritet testas. Gmail MCP-status läser inte dokument/workspace och muterar inte automationsinställningar.
- **Exakta tester och resultat:** `test/api.test.js`, `test/bank-api.test.js`, `test/gmail-api.test.js`, `test/customer-messages-api.test.js`; `sites/tests/banking-security.test.mjs`, `sites/tests/gmail.test.mjs`, `sites/tests/customer-messages.test.mjs`. E-N/E-S. Beroendegranskning av slutlig revision registreras separat i G-D.
- **Kod-, API- eller UI-evidens:** `src/security.js`, `src/server.js`, `sites/lib/banking/security.ts`, `sites/lib/server.ts`, `sites/lib/banking/mcp.ts`.
- **Återstående problem:** Ingen full aktuell säkerhetsgranskning av autentiserad produktionsruntime, alla åtkomstroller och slutlig deployment. Hash bevisar integritet, inte bankens avsändarautenticitet.
- **Prioritet och nästa åtgärd:** P0. Slutför båda audits och CI på leveransrevisionen; kontrollera publicerad åtkomstisolering och känsliga statusytor utan att exportera företagsdata.
- **Produktionsverifiering / extern blockerare:** Ja. B2; G-D är intern leveransgrind.

### 31. Katastrofåterställning — 6,5/10

- **Acceptanskriterier:** Återställ databas och samtliga original i separat miljö med rätt nyckel; saknade delar ska ge fel; återställningstid, dataförlustfönster och extern kopia ska vara fastställda.
- **Verifierat:** Isolerade syntetiska återställningar för Node och Sites samt fel nyckel/ägare/original är testade. Avbrott och konkurrerande backupägare kan inte skapa falskt komplett resultat.
- **Exakta tester och resultat:** `test/backup.test.js` och `sites/tests/backup.test.mjs`: återställning till separat databas, byte-/innehållskontroll, manipulerad ciphertext, saknade original och leasebyte. E-N/E-S. Ingen destruktiv produktionsrestore ingår.
- **Kod-, API- eller UI-evidens:** `src/backup.js`, `sites/lib/backup-engine.ts`, `docs/AUTOMATION-BACKUP.md`; E-PROD visar backupstatus men inget katastrofprov.
- **Återstående problem:** Förlust av hela produktionsmiljön inklusive nyckel, oberoende extern kopia samt uppmätta RPO/RTO har inte verifierats.
- **Prioritet och nästa åtgärd:** P0. Planera och genomför isolerat katastrofprov från en godkänd kopia med separata resurser; mät tid, fullständighet och nyckeltillgänglighet.
- **Produktionsverifiering / extern blockerare:** Ja. B6 och överenskomna RPO/RTO; destruktiv produktionsåterställning kräver separat godkännande.

### 32. Kodkvalitet och tester — 7,5/10

- **Acceptanskriterier:** Reproducerade fel ska ha regressioner; båda implementationer ska följa samma beviskrav; fulla tester, syntax/typer, audit, build och CI ska vara gröna för samma revision.
- **Verifierat:** Flera konkreta fel har reproducerats före fix. Senaste rapporterade fulla Node-svit är 377/377 och Sites 456/456. Oberoende review har identifierat och fått original-/konfliktfall rättade. Båda slutliga audits har 0 sårbarheter; den sista fokusfixen ingår i den slutliga godkända Sites-sviten och bygget.
- **Exakta tester och resultat:** `test/node-payments-quality-cycle.test.js`, båda `document-quality-cycle`-filerna, `sites/tests/sites-payments-quality-cycle.test.mjs`, `sites/tests/economy-quality-cycle.test.mjs`, `sites/tests/bank-original-quality-cycle.test.mjs`. Exakta slutkommandon och grindstatus finns i evidensregistret.
- **Kod-, API- eller UI-evidens:** Befintlig Node/SQLite- och Sites/Workers/D1/R2-struktur samt `.github/workflows/payment-control-ci.yml` bevaras; arbetsplan `docs/QUALITY-33-PLAN.md`.
- **Återstående problem:** Lokala slutgrindar och bygge är godkända. CI för leverans-SHA ska ännu registreras. Audits är gröna; detta ersätter inte exakt revisionskoppling.
- **Prioritet och nästa åtgärd:** P4. Kör alla grindar på exakt leveransrevision, verifiera Actions och uppdatera resultat/SHA här och i PROGRESS.md; ändra inte poäng utan ny evidens.
- **Produktionsverifiering / extern blockerare:** Produktionsverifiering krävs för systembeteende; kodgrindarna kan avslutas utan företagsdata. G-S/G-D/G-P är interna kvarstående grindar.

### 33. Verifiering i verklig produktion — 5,5/10

- **Acceptanskriterier:** Rätt main-SHA och Sites-version ska vara publicerade i samma projekt; bevarade resurser/identitet; inloggade flöden och autentiskt bank-/dokumentunderlag ska verifiera målet.
- **Verifierat:** Tidigare publicering av version 31 finns dokumenterad. Aktuella läsande statusvärden finns för bank, Gmail, OCR och backup. Chromium-demo har kontrollerats med syntetiska data.
- **Exakta tester och resultat:** E-N/E-S är lokala tester; E-UI är lokal/hanterad förhandsvisning. E-PROD är läsande status. Ingen av dessa ersätter ett aktuellt inloggat produktionsflöde. `docs/V4-PUBLICATION.md` är historiskt versionsbevis.
- **Kod-, API- eller UI-evidens:** `docs/V4-PUBLICATION.md`, `docs/V4-SWEDBANK-CHANNELS.md`, E-PROD och kommande G-P. Befintligt projekt och domän ska behållas.
- **Återstående problem:** Ny leverans-SHA/deployment och slutlig efterkontroll saknas i denna bedömning. Autentisk individuell bankrapport, full dokumentkedja, avstängd dator och produktionsåterställningsprov saknas.
- **Prioritet och nästa åtgärd:** P4. Avsluta kod-/publiceringsgrindarna och verifiera tillåtna aktuella flöden. Fortsätt dokumentera externa blockerare; rapportera inte 9,5 i alla områden.
- **Produktionsverifiering / extern blockerare:** Ja, detta är själva områdets kärna. B1–B6 samt interna G-S/G-D/G-P.

## Fortsättning och ändringsregel

1. G-S och G-D är avslutade för den lokala slutkoden. G-P avslutas först med verifierad GitHub-/Sites-publicering. Rätta nya konkreta integritetsfel med en reproduktion.
2. Bevara separata bevis för GitHub och Sites. Fyll i slutliga counts/SHA/deployment-resultat utan att omtolka gamla körningar som nya.
3. Bankdialogens Enter/Escape/fokusretur är avslutad. Utöka tangentbords-, fokus- och navigationsmatrisen till återstående vyer och mobilmeny; behandla iframe-begränsningen uttryckligen.
4. Hantera Gmail-pausen och verifiera faktiskt moln-OCR-utfall. Respektera befintliga scheman och behörigheter.
5. Ta emot det autentiska bankunderlag som B1 kräver. Kör först läsande jämförelse mot förväntade betalare, exakta referenser och saldon.
6. Genomför representativ fakturavalidering och isolerat återställningsprov. Dokumentera felkvoter, undantag, RPO/RTO och konkret operatörsåtgärd.
7. Uppdatera en områdespoäng endast när en viss delpoäng kan kopplas till ett nytt godkänt bevis. Spara tidigare bedömning i versionshistoriken och ange vilken acceptanslucka som stängts. Avsaknad av nya fel är inte i sig skäl att höja betyget.

**Slutvillkoret kvarstår:** formuleringen `KLART – 9,5/10 I ALLA 33 OMRÅDEN` får inte användas utifrån denna scorecard. Ingen aktuell extern blockerare, ofärdig leveransgrind eller ej verifierad kritisk produktionsfunktion får döljas av godkända enhetstester.
