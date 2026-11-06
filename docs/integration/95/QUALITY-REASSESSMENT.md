# Agent 9 — ny bedömning av samtliga 33 kriterier

**Verifierad nivå: 250/330 = 7,58/10. Full CI och oberoende kod-/poänggranskning är godkända på den frysta kombinerade koden 0ce2604. Målet 9,5/10 är inte uppnått; kommersiell produktion är NOT APPROVED.**

Baslinjen 255/330 är den senast dokumenterade bedömningen i main vid start, inte ett nytt accepterat produktionsfacit. Samma femkomponentsmodell används: F funktion, S felhantering/säkerhet/integritet, K sammanhängande kedja, U användbarhet/driftbarhet och P aktuell produktion/leverans. Varje komponent är 0–2 i halva steg. Poängen är deras exakta summa. Utan nödvändig autentiserad produktionsacceptans är taket 8,5.

Den lägre nya totalen beror främst på att äldre produktionspoäng inte kan styrkas av dagens begränsade observationer. Det är inte ett påstående att rättningarna försämrar funktionerna. Faktisk aktuell Gmailhämtning, accepterade moln-OCR-resultat och exekverade kritiska återställningsfall motiverar uttryckliga höjningar.

| Nr | Kriterium | Tidigare | F | S | K | U | P | Nytt | Delta |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | Design och färger | 8 | 2 | 1,5 | 1,5 | 1,5 | 0,5 | 7 | -1 |
| 2 | Startsida | 8,5 | 2 | 2 | 1,5 | 1,5 | 0,5 | 7,5 | -1 |
| 3 | Navigering | 8,5 | 2 | 1,5 | 2 | 1,5 | 0,5 | 7,5 | -1 |
| 4 | Mobilanpassning | 8,5 | 2 | 2 | 1,5 | 1,5 | 0,5 | 7,5 | -1 |
| 5 | Sökning och filtrering | 7,5 | 2 | 1,5 | 2 | 1,5 | 0,5 | 7,5 | 0 |
| 6 | Minimal manuell hantering | 6,5 | 1,5 | 2 | 1,5 | 1 | 0 | 6 | -0,5 |
| 7 | Kundfakturor | 8 | 2 | 2 | 2 | 1,5 | 0,5 | 8 | 0 |
| 8 | Leverantörsfakturor | 8 | 2 | 2 | 2 | 1,5 | 0,5 | 8 | 0 |
| 9 | PDF-tolkning | 8 | 2 | 2 | 2 | 1,5 | 0,5 | 8 | 0 |
| 10 | Bild-OCR | 7 | 1,5 | 2 | 2 | 1 | 1 | 7,5 | +0,5 |
| 11 | Gmail-anslutning | 7,5 | 2 | 2 | 2 | 1,5 | 1 | 8,5 | +1 |
| 12 | Automatisk fakturaregistrering | 8 | 2 | 2 | 2 | 1,5 | 0,5 | 8 | 0 |
| 13 | Dubblettkontroll | 8 | 2 | 2 | 2 | 1,5 | 0,5 | 8 | 0 |
| 14 | Dokumentgranskning | 8 | 2 | 2 | 2 | 1,5 | 0,5 | 8 | 0 |
| 15 | Swedbank-anslutning | 8,5 | 2 | 2 | 2 | 1,5 | 0 | 7,5 | -1 |
| 16 | Automatisk bankhämtning | 8 | 2 | 2 | 2 | 1,5 | 0 | 7,5 | -0,5 |
| 17 | Bankgiroimport | 8,5 | 2 | 2 | 2 | 1,5 | 1 | 8,5 | 0 |
| 18 | Identifiera verklig betalare | 7 | 1,5 | 2 | 2 | 1,5 | 0 | 7 | 0 |
| 19 | Verklig OCR/fakturareferens | 7 | 1,5 | 2 | 2 | 1,5 | 0 | 7 | 0 |
| 20 | Automatisk betalningsmatchning | 7,5 | 2 | 2 | 2 | 1,5 | 0 | 7,5 | 0 |
| 21 | Delbetalningar | 8 | 2 | 2 | 2 | 1,5 | 0,5 | 8 | 0 |
| 22 | Överbetalningar | 8 | 2 | 2 | 2 | 1,5 | 0,5 | 8 | 0 |
| 23 | Flera fakturor i en betalning | 7,5 | 1,5 | 2 | 2 | 1,5 | 0,5 | 7,5 | 0 |
| 24 | Betalningshistorik | 8 | 2 | 2 | 2 | 1,5 | 0,5 | 8 | 0 |
| 25 | Betalningsstatus | 8 | 2 | 2 | 2 | 1,5 | 0,5 | 8 | 0 |
| 26 | Kontrollera alla betalningar | 8 | 2 | 2 | 2 | 1,5 | 0 | 7,5 | -0,5 |
| 27 | Automatiska mejlutkast | 8 | 2 | 2 | 2 | 1,5 | 0,5 | 8 | 0 |
| 28 | Schemalagd automatisering | 6,5 | 1,5 | 2 | 2 | 1 | 0 | 6,5 | 0 |
| 29 | Säkerhetskopiering | 7,5 | 2 | 2 | 2 | 1,5 | 1 | 8,5 | +1 |
| 30 | Säkerhet och åtkomstkontroll | 8,5 | 2 | 2 | 2 | 1,5 | 0,5 | 8 | -0,5 |
| 31 | Katastrofåterställning | 5,5 | 1,5 | 2 | 2 | 1 | 0 | 6,5 | +1 |
| 32 | Kodkvalitet och tester | 8,5 | 2 | 2 | 2 | 1,5 | 1 | 8,5 | 0 |
| 33 | Verifiering i verklig produktion | 6,5 | 1,5 | 1 | 1,5 | 1 | 0 | 5 | -1,5 |

**Aritmetik:** 255 → 250 av 330; netto −5. Medelbetyg 250 ÷ 33 = 7,57575…/10. Avstånd till 314 är 64 poäng. Inget av de 33 områdena har styrkt minst 9,5. 33 × 9,5 = 313,5; tröskeln 314 kräver ytterligare 0,5 utöver detta. Detta är ett gap, ingen utlovad poängbudget.

Alla 131 testfilshänvisningar nedan återfinns i de faktiska fullsviternas exekverade fillistor; se [kriteriebindningen](evidence/criterion-test-bindings.json). En filhänvisning är alltså inte bara en kontroll av att filen finns.

## Så ska bevisen läsas

Testfilerna nedan anger det konkreta beteendebeviset. Slutkörningens fullständiga kvitton, exakta head/tree och avgränsade granskningar ska läsas tillsammans med [slutrapporten](FINAL-REPORT.md), [releasegrindarna](RELEASE-GATES.md) och [testregistret](TEST-RESULTS.md). Fokuserade och säkerhetsrelaterade delsviter överlappar helsviterna och summeras inte en gång till. Syntetiska bank-/OCR-/företagsprov är inte verklig bankauktorisation eller driftskapacitet.

## 1. Design och färger — 8 → 7

**Bevis och delpoäng.** Layout, tydliga ekonomifält, fel-/inloggningstillstånd och kontrastregressioner; syntetisk Chromium visar realiserad rendering. F2 avser dessa lokala vyer, S1,5 flera UI-felklasser, K1,5 renderingsgränsen. U1,5 behåller kvarstående användaracceptans.

**Tester.** `test/payment-control-ui.test.js`, `test/ui-final-node.test.js`.

**Kvarstående brister / exakt acceptans som behövs.** Acceptera samtliga relevanta vyer med verklig text, kontrast, 200–400 % zoom och skärmläsare på publicerad revision.

**Motivering.** P sänks 1,5→0,5: ingen ny autentiserad visuell acceptans på aktuell publicerad revision. Gamla skärmbilder certifieras inte på nytt.

## 2. Startsida — 8,5 → 7,5

**Bevis och delpoäng.** Översiktskort, list-/periodprojektion, väntande laddning och nekad åtkomst är regressionskontrollerade. K1,5 avser renderad översikt, inte en ny komplett verklig faktura-/banksession. S2 stöds av negativa och positiva status-/åtkomstfall.

**Tester.** `test/ui-final-node.test.js`, `test/payment-control-ui.test.js`, `sites/tests/dashboard-loading-ui-q8.test.mjs`.

**Kvarstående brister / exakt acceptans som behövs.** Stäm av autentiserade startsidans kort, perioder och summor mot en godkänd uppsättning original och ekonomiska facit.

**Motivering.** P sänks 1,5→0,5. Publicerad grund finns; startsidans verkliga totalsummor har inte stämts av i en tillåten autentiserad slutresa.

## 3. Navigering — 8,5 → 7,5

**Bevis och delpoäng.** Verkliga komponent-/webbläsarflöden för vybyte, historik, fokus och företagsskifte; gamla svar får inte överta ny företagsvy. F2/K2 avser den lokala sammanhängande navigationskedjan. S1,5 och U1,5 lämnar full hjälpmedelsacceptans öppen.

**Tester.** `test/payment-control-ui.test.js`, `test/payment-evidence-ui.test.js`, `sites/tests/workspace-navigation-dashboard-q8.test.mjs`.

**Kvarstående brister / exakt acceptans som behövs.** Dokumentera Tab, Shift+Tab, Escape, framåt/bakåt samt fokusåtergång genom alla centrala autentiserade vyer och dialoger.

**Motivering.** P sänks 1,5→0,5. Den nya kombinationen har ingen verifierad autentiserad produktionsresa genom alla huvudvyer.

## 4. Mobilanpassning — 8,5 → 7,5

**Bevis och delpoäng.** Responsiva vyer, dialogbredd, långa uppgifter och fokusskydd testas i syntetisk Chromium. F2/S2 avser dokumenterade lokala positiva/negativa fall; K1,5 en verklig browsergräns. CSS-viewport är inte fysisk mobil.

**Tester.** `test/payment-control-ui.test.js`, `test/payment-evidence-ui.test.js`.

**Kvarstående brister / exakt acceptans som behövs.** Acceptera iOS/Android, rotation, tangentbord, långa referenser och originaldialoger på aktuell publicering; komplettera relevant hjälpmedelskontroll.

**Motivering.** P sänks 1,5→0,5. Ny aktuell iOS-/Androidacceptans och komplett hjälpmedelskontroll saknas.

## 5. Sökning och filtrering — 7,5 → 7,5

**Bevis och delpoäng.** Svensk normalisering, belopp, exakta referenser och kombinerade filter prövas i delad sökmotor, verkligt Sites-domänkommando och klassisk UI. PR53 bevarar exakt referens 2026.01 parallellt med möjlig beloppstolkning; uttrycklig valuta styr beloppssökning. S1,5: flera oberoende felklasser, ingen allomfattande sökcertifiering.

**Tester.** `test/ui-final-node.test.js`, `test/reconciliation-normalization-final.test.js`, `test/workspace-search-quality8.test.js`, `sites/tests/workspace-search-final.test.mjs`.

**Kvarstående brister / exakt acceptans som behövs.** Verifiera referensvarianter, kombinerade filter och komplett resultat mot facit på stor realistisk datamängd; mät hela data- och användarkedjan.

**Motivering.** Oförändrat 7,5. Reproducerad rättning och 47/47 berörda tester stärker befintlig klass utan att ersätta storskaligt användarfacit eller aktuell leveransacceptans.

## 6. Minimal manuell hantering — 6,5 → 6

**Bevis och delpoäng.** Lokal kontrollkedja, förslag och stopp vid ofullständigt underlag är verifierade. F1,5/K1,5: flera centrala delar, men inget godkänt representativt arbetsmått över hela verkliga processen. S2: falskt gröna ekonomiska beslut ska stoppas.

**Tester.** `test/payment-control.test.js`, `test/reconciliation-preview.test.js`.

**Kvarstående brister / exakt acceptans som behövs.** Mät en godkänd representativ arbetsperiod: korrekta avslutade ärenden, manuella beslut, tid och undantag; verifiera bank/Gmail-kedjorna.

**Motivering.** P sänks 0,5→0: den kompletta bank-, OCR- och registreringskedjan samt verifierad minskning av manuellt arbete saknar fortfarande tillräckligt underlag. De sex aktuella OCR-resultaten styrker inte hela denna kedja. U1 behålls eftersom verifierad minskning av handpåläggning och full driftkedja återstår.

## 7. Kundfakturor — 8 → 8

**Bevis och delpoäng.** Registrering och ändring av kundfakturor, belopp/referens, bevarade PDF-original och betalningskoppling prövas mot riktig lokal HTTP/SQLite samt Sites lagringsgräns. Negativa identitets-/beloppsfall och positiva kontrollfall stödjer F2/S2/K2.

**Tester.** `test/invoice-reference-integration.test.js`, `test/payment-control-api.test.js`, `test/quality-regressions-recovery-api.test.js`.

**Kvarstående brister / exakt acceptans som behövs.** Verifiera godkänt originalinventarium, registrering, belopp, referens, kundrelation och betalningshistorik i ett autentiserat flöde.

**Motivering.** Oförändrat 8. P0,5 avser publicerad grund; verkligt originalinventarium, kundrelation och ny autentiserad resa saknas.

## 8. Leverantörsfakturor — 8 → 8

**Bevis och delpoäng.** Leverantörsextraktion, mottagar-/utställarseparation, summaryfält, dokumentgranskning och originalintegritet prövas med syntetiska PDF-/textfall i båda motorerna. F2/S2/K2 gäller den angivna lokala funktionens centrala gränser.

**Tester.** `test/invoice-extraction.test.js`, `test/invoice-evidence-ocr.test.js`, `test/invoice-summary-labels.test.js`, `sites/tests/invoice-summary-labels.test.mjs`.

**Kvarstående brister / exakt acceptans som behövs.** Verifiera godkända leverantörslayouter, kredit/negativa belopp, mottagarrelation och originalbevarande mot ett märkt verkligt facit.

**Motivering.** Oförändrat 8. Nya parserfall ger inte automatiskt representativ produktionsprecision; godkända verkliga layouter och affärsregler återstår.

## 9. PDF-tolkning — 8 → 8

**Bevis och delpoäng.** Rekonstruerad PDF-text, fakturaidentitet, stycke-/sidgränser, svensk/engelsk beloppsgrammatik och osäkra tolkningar prövas. PDF-filer går genom faktisk extraktion; syntetiska textkorpusar redovisas separat. F2/S2/K2 avser lokal kedja och kritiska negativa klasser.

**Tester.** `test/invoice-parser-corpus-q8.test.js`, `test/pdf-text-reconstruction.test.js`, `test/invoice-summary-labels.test.js`, `sites/tests/invoice-summary-labels.test.mjs`.

**Kvarstående brister / exakt acceptans som behövs.** Utöka och frys godkänd representativ PDF-korpus med fältfacit; redovisa felaktiga gröna godkännanden, osäkerhet och fellägen.

**Motivering.** Oförändrat 8. En större syntetisk korpus och fler passerade tester är inte en mätning på ett representativt godkänt kundfacit.

## 10. Bild-OCR — 7 → 7,5

**Bevis och delpoäng.** OCR-kö, lease, bounded transport, persistens, omtag efter förlorat kvitto och granskningsstatus prövas. PR52:s cleanup får inte göra en annars begränsad begäran oändlig. F1,5/U1 avser användbar kedja med kvarvarande precision-/driftgap; S2/K2 avser testade felklasser och lokal lagring.

**Tester.** `test/pdf-layout-ocr.test.js`, `test/ocr-quality-metrics.test.js`, `test/sites-ocr-pull.test.js`, `sites/tests/document-queue-recovery.test.mjs`.

**Kvarstående brister / exakt acceptans som behövs.** Kör godkänd rasterkorpus och aktuell cloud-worker med verkligt underlag; mät fältkvalitet, osäkerhet, fel, total tid och spårbarhet.

**Motivering.** Höjning 7→7,5 genom P0,5→1: en extern schemakörning på mainbf24 (42083409804) har verifierad logg processed6/failed0 och tjänsten bekräftar sparade resultat18:23:31 medan lokal worker är offline. Detta ger ett daterat konkret driftutfall. Vid sista läsningen 19:14 var molnworkern åter utan färsk heartbeat; märkt fältfacit, uthållig kadens och den nya kandidatens leveransacceptans saknas.

## 11. Gmail-anslutning — 7,5 → 8,5

**Bevis och delpoäng.** OAuth-/token-/Gmailflöden, beständiga jobb, originalhantering, retry och felstatus testas. Läsande produktionsstatus visar en aktuell lyckad hämtning 2026-11-05T18:59:26.053Z. F2/S2/K2 gäller den lokala integrerade Gmailkedjan; U1,5 lämnar driftacceptans öppen.

**Tester.** `test/integration-job-api.test.js`, `test/integration-jobs-orchestration.test.js`, `sites/tests/gmail.test.mjs`.

**Kvarstående brister / exakt acceptans som behövs.** Verifiera aktuell levererad Gmailkedja med godkänt originalfacit och representativ autentiserad användaracceptans. Externt schema, OCR och registrering bedöms dessutom separat.

**Motivering.** Höjning 7,5→8,5 enbart genom P0→1: konkret aktuellt driftutfall för anslutning/hämtning. Detta bevisar inte timschema, full OCR eller alla fakturaregistreringar.

## 12. Automatisk fakturaregistrering — 8 → 8

**Bevis och delpoäng.** Automatisk registrering kräver fullständiga kritiska fält, original och företag; osäker extraktion går till granskning. Idempotens efter avbrott och lagrat resultat kontrolleras med positiva/negativa lagringsfall. F2/S2/K2 avser denna lokala kedja.

**Tester.** `test/invoice-evidence-ocr.test.js`, `test/integration-jobs.test.js`.

**Kvarstående brister / exakt acceptans som behövs.** Verifiera automatisk registrering av godkända original med samtliga kritiska fält, exakt-en-gång-beteende och oförändrade äldre poster.

**Motivering.** Oförändrat 8. P0,5 avser den publicerade funktionen; ingen komplett ny produktionsserie med godkända original och affärsfacit certifieras.

## 13. Dubblettkontroll — 8 → 8

**Bevis och delpoäng.** Samma original/transaktion över omstart, replay och samtidiga processer skapar inte dubbel ekonomi. Företag återanvänder identiska externa ID:n utan läckage. SQLite-journalgränsen repareras och krascher före commit ska rulla tillbaka. F2/S2/K2 har verkliga databasgränser.

**Tester.** `test/integration-jobs.test.js`, `test/company-reconciliation.test.js`, `sites/tests/company-bank-sync-backup.test.mjs`, `test/payment-concurrency.test.js`, `test/quality-regressions-migration-replay.test.js`.

**Kvarstående brister / exakt acceptans som behövs.** Verifiera ägarbundet originalinventarium, godkänd återhämtning, korrigering och historiska luckor; visa att dubbla/importerade original inte skapar dubbel ekonomi.

**Motivering.** Oförändrat 8. P0,5: befintlig publicerad grund; ett aktuellt ägarbundet produktionsinventarium och alla historiska luckor är inte verifierade.

## 14. Dokumentgranskning — 8 → 8

**Bevis och delpoäng.** Original, metadata, osäkra fält och fel/retry bevaras i granskningskedjan. Syntetiska parser-/UI-/lagringsfall stoppar tvetydiga eller saknade underlag och bevarar ekonomin. F2/S2/K2 avser dokumenterade centrala lokala flöden.

**Tester.** `test/invoice-evidence-ocr.test.js`, `test/payment-evidence-ui.test.js`.

**Kvarstående brister / exakt acceptans som behövs.** Acceptera prioriterade verkliga dokument med original, versionsbyte, fel/retry och korrekt synlig osäkerhet i aktuell autentiserad UI.

**Motivering.** Oförändrat 8. U1,5/P0,5: aktuell verksamhetsacceptans för prioriterade verkliga dokument och publicerad granskning återstår.

## 15. Swedbank-anslutning — 8,5 → 7,5

**Bevis och delpoäng.** Callback, providerregistrering, aktuellt medgivande, kontoval, företagsrätt och efter-await-/commitfences har positiva och negativa syntetiska tester. PR45 och49/50 bevarar kända handtag och osäkra skrivutfall. F2/S2/K2 gäller lokal bankadapterkedja; inga tester använder verklig bankauktorisation.

**Tester.** `test/openpayments-node-transport.test.js`, `test/openpayments-company-bank-sync.test.js`, `test/node-company-bank-sync.test.js`, `sites/tests/banking-security.test.mjs`, `sites/tests/openpayments-write-ambiguity.test.mjs`, `sites/tests/openpayments-lifecycle-recovery.test.mjs`.

**Kvarstående brister / exakt acceptans som behövs.** Verifiera att de granskade consent-/race-rättningarna finns i accepterad publicering. Styrk aktuell bankutfärdad kontorelation, behörighet, detaljer, förnyelse och tillåtna retry-fall med verkliga bankbevis.

**Motivering.** P sänks 1→0: aktuell produktion rapporterar connected=false. Senaste historiska lyckade hämtning och ett framtida giltighetsdatum styrker inte dagens kontobehörighet.

## 16. Automatisk bankhämtning — 8 → 7,5

**Bevis och delpoäng.** Pagination, råkvitto, beständig kvot, konto-/företagslease, checkpunkt, avbrott och dedup testas i lokala sammanhängande synkflöden. En aktuell återkallelse eller kontextändring stoppar läsning/commit. F2/S2/K2 avser dessa exekverade kedjor.

**Tester.** `test/openpayments-company-bank-sync.test.js`, `sites/tests/company-sync-boundary-integration.test.mjs`, `sites/tests/company-sync-scale.test.mjs`.

**Kvarstående brister / exakt acceptans som behövs.** Verifiera ett auktoriserat komplett aktuellt bankjobb inklusive sidindelning, leases, kvitton, dedup, avbrott/återupptagning och oförändrad ekonomi vid nekad åtkomst.

**Motivering.** P sänks 0,5→0: ansluten och fungerande aktuell produktionsbankhämtning saknas. Ett konfigurerat schema och gamla success-tider räcker inte.

## 17. Bankgiroimport — 8,5 → 8,5

**Bevis och delpoäng.** CAMT/XLSX/CSV/Open Payments/SFTP-kedjor, exakt bevarad referens, originalhash, ägarbunden rapporthistorik och ändringsdetektion testas. En befintlig ägd manuell rapport återlästes autentiserat 18:09:39Z: komplett, intakt och oförändrad. F2/S2/K2 avser importer/evidens, inte påstådd bankauktorisation.

**Tester.** `test/openpayments-bankgiro-ingest.test.js`, `test/payment-reference-sources.test.js`, `sites/tests/mcp-report-provenance.test.mjs`, `sites/tests/openpayments-document-numbers.test.mjs`, `sites/tests/payment-verification.test.mjs`.

**Kvarstående brister / exakt acceptans som behövs.** Konfigurera och godkänn faktisk bank-/företags-/kontobunden källa med profil och råkvitto; verifiera betalare, referens och samlingsinsättning före separat fakturarelation.

**Motivering.** Oförändrat 8,5, P1 stöds av aktuellt konkret manuellt rapportutfall. Automatisk källa är fortfarande SOURCE_NOT_CONFIGURED/UNKNOWN. Intakt import är inte styrkt aktuell bank-/kontorelation, formell OCR eller rätt faktura.

## 18. Identifiera verklig betalare — 7 → 7

**Bevis och delpoäng.** Bankpart, manuell attest, namn, organisationsidentitet och kundrelation hålls isär. Konflikter, fel original och återkallat underlag stoppas i verkliga lokala skriv-/lagringsgränser. F1,5 avser kvarvarande verklig identifieringsbredd; S2/K2 de negativa/positiva kedjorna.

**Tester.** `test/payer-evidence.test.js`, `test/payer-completion-conflict.test.js`, `test/payer-verification-atomic.test.js`, `sites/tests/reconciliation-manual-provenance.test.mjs`.

**Kvarstående brister / exakt acceptans som behövs.** Styrk verklig betalare från bankoriginal eller godkänd redovisningsrelation; verifiera attest, konflikt och återkallande utan att interna kunduppgifter blir bankfakta.

**Motivering.** Oförändrat 7. P0: privat rapportnamn är inte automatiskt juridisk betalare eller godkänd kundrelation; autentiskt verifierat helfacit saknas.

## 19. Verklig OCR/fakturareferens — 7 → 7

**Bevis och delpoäng.** Ledande nollor, generisk referens, dokumentnummer och formell OCR hålls åtskilda. Referens får inte passera med trasigt original; CSV får inte fabricera banktransaktions-ID. Negativa och positiva fall når import-/avstämningsgränsen. F1,5 avser kvarvarande verklig referens-/avtalsbredd.

**Tester.** `test/payment-reference-sources.test.js`, `test/invoice-reference-policy.test.js`, `test/reference-evidence-compat.test.js`, `sites/tests/reconciliation-csv-reference.test.mjs`, `sites/tests/openpayments-document-numbers.test.mjs`.

**Kvarstående brister / exakt acceptans som behövs.** Verifiera bankbunden verklig OCR/referens inklusive avtal/checksiffra där relevant, inledande nollor, frånvaro och konflikter mot ett märkt originalfacit.

**Motivering.** Oförändrat 7. P0: manuellt bevarad generisk referens bevisar inte formell OCR, bankens avtalade regel eller full fakturarelation.

## 20. Automatisk betalningsmatchning — 7,5 → 7,5

**Bevis och delpoäng.** PR51:s delade deterministiska slutbedömning tilldelar distinkta exakt styrkta referenser utan inbördes falsk spärr, samtidigt som svaga konkurrerande underlag kvarstår för granskning. Manuella ersättningsfält blir inte bankfakta. Verklig SQLite/D1-persistens kontrollerar saldo/audit/replay. F2/S2/K2 stöds lokalt.

**Tester.** `test/reconciliation-contract.test.js`, `test/reconciliation-contract-integrity.test.js`, `sites/tests/reconciliation-proposal.test.mjs`, `test/reconciliation-batch-integration.test.js`, `sites/tests/reconciliation-batch-integration.test.mjs`, `sites/tests/reconciliation-decisions.test.mjs`.

**Kvarstående brister / exakt acceptans som behövs.** Verifiera representativ betalningsvolym med korrekt bankpart, godkända fakturarelationer och exakt facit; mät falska positiva och bevara förslag/bokföring som separata steg.

**Motivering.** Oförändrat 7,5. P0: syntetiskt 8/8 mot facit och noll falska positiva i avgränsad korpus ersätter inte representativ bank-/kundacceptans.

## 21. Delbetalningar — 8 → 8

**Bevis och delpoäng.** Delbetalningar bevarar tidigare tilldelningar, exakt restbelopp och audit över omstart och återimport. Samtidiga processer får inte lägga till samma betalning två gånger. F2/S2/K2 avser riktiga lokala databastransaktioner med syntetiska belopp.

**Tester.** `test/reconciliation.test.js`, `test/payment-control-api.test.js`, `test/payment-concurrency.test.js`, `test/reconciliation-batch-integration.test.js`, `sites/tests/reconciliation-batch-integration.test.mjs`.

**Kvarstående brister / exakt acceptans som behövs.** Verifiera verkliga godkända delbetalningar med korrekt restbelopp, tidsordning, avstämning och obruten audit.

**Motivering.** Oförändrat 8. U1,5/P0,5: verksamhetens godkända verkliga delbetalningsresa på slutrevisionen återstår.

## 22. Överbetalningar — 8 → 8

**Bevis och delpoäng.** Överbetalning skiljer fakturans saldo från spårbart överskott, utan falsk automatisk fakturakoppling. Retry/replay och historik har negativa och positiva lokala transaktionsfall. F2/S2/K2 gäller dessa scenarier.

**Tester.** `test/reconciliation.test.js`, `test/payment-control-api.test.js`, `test/payment-concurrency.test.js`, `test/reconciliation-batch-integration.test.js`, `sites/tests/reconciliation-batch-integration.test.mjs`.

**Kvarstående brister / exakt acceptans som behövs.** Verifiera verklig överbetalning och godkänd affärshantering, saldo/status, beslut och audit utan automatisk felaktig fakturakoppling.

**Motivering.** Oförändrat 8. Godkänd verklig överskottshantering/återbetalningsprocess och ny driftacceptans saknas; P0,5 är publicerad grund.

## 23. Flera fakturor i en betalning — 7,5 → 7,5

**Bevis och delpoäng.** Befintliga grupp-/fördelningsregler och spärrar mot ofullständiga referenser har lokala integrationstester. F1,5 kvarstår: PR51:s konkurrensbedömning är inte en ny fullständig atomisk flerfakturafunktion. S2/K2 avser befintliga gränser, inte outförd produktbredd.

**Tester.** `test/reconciliation-contract.test.js`, `test/reconciliation.test.js`, `test/company-reconciliation-gate.test.js`.

**Kvarstående brister / exakt acceptans som behövs.** Verifiera kompletta original och godkända grupperingar med summerade belopp, referenser och dokumenterade beslut för flera fakturor per betalning.

**Motivering.** Oförändrat 7,5. Godkända kompletta grupperingar, summerade belopp, original och verksamhetsbeslut måste verifieras för full acceptans.

## 24. Betalningshistorik — 8 → 8

**Bevis och delpoäng.** Bevarade original, rapportproveniens, importhistorik, manuella beslut, allokeringar och audit går genom ägarbundna läsningar och backup/restore. PR46:s sena revisionskontroll märker snapshot som ändrad efter samtidiga uppdateringar. F2/S2/K2 stöds i lokal databas-/lagringskedja.

**Tester.** `test/payment-identity-evidence-final.test.js`, `test/integration-jobs-backup.test.js`, `sites/tests/company-backup.test.mjs`, `sites/tests/mcp-report-provenance.test.mjs`, `sites/tests/recovery-drill.test.mjs`.

**Kvarstående brister / exakt acceptans som behövs.** Verifiera autentiserad historik vid realistisk volym, pagination, tidsordning och audit genom migrering och återställning; eliminera relevanta obegränsade listgränser.

**Motivering.** Oförändrat 8. U1,5/P0,5: full autentiserad historik vid realistisk volym och eventuella listbegränsningar återstår.

## 25. Betalningsstatus — 8 → 8

**Bevis och delpoäng.** Betalt/restbelopp, förslag, granskningskrav och bankmedgivandets hälsa visas separat. Sparat kvitto får inte intyga aktuell anslutning efter app-/kontoändring. Positiva och negativa integrationsfall verifierar projektion utan att ändra ekonomin. F2/S2/K2 gäller lokal kedja.

**Tester.** `test/message-evidence-projection.test.js`, `test/payment-identity-evidence-final.test.js`, `test/node-payments-quality-cycle.test.js`, `sites/tests/payment-evidence-status-final.test.mjs`, `sites/tests/banking-security.test.mjs`.

**Kvarstående brister / exakt acceptans som behövs.** Verifiera aktuell betalningsstatus mot godkända original, kontorelation och aktuellt samtycke; acceptera även reauth/okänd/ofullständig status utan falsk grön signal.

**Motivering.** Oförändrat 8. Aktuell verklig betalningsstatus mot godkända original, kontorelation och användaracceptans saknas; P0,5 är publicerad grund.

## 26. Kontrollera alla betalningar — 8 → 7,5

**Bevis och delpoäng.** Kontrolljobb, progress, kvitton, förslag, avbrott och omtag körs med syntetiska data via riktig HTTP/lagring. Ingen ofullständig kedja får fabricera godkänd betalning. F2/S2/K2 avser lokal sammanhängande kontroll.

**Tester.** `test/payment-control-api.test.js`, `test/payment-control-receipts-q8.test.js`, `test/payment-control.test.js`.

**Kvarstående brister / exakt acceptans som behövs.** Genomför tillåtet komplett produktionsflöde mot avgränsat godkänt underlag med audit, korrekta undantag och dokumenterad tidsåtgång.

**Motivering.** P sänks 0,5→0: nödvändigt komplett aktuellt verkligt kontrollutfall saknas. Ingen produktionsknapp eller jobbstart används för att skaffa poäng.

## 27. Automatiska mejlutkast — 8 → 8

**Bevis och delpoäng.** Utkast visar rätt mottagare/underlagsstatus i testade projektioner, och osäkra bankfakta får inte förvandlas till säkra kundpåståenden. UI-/domänregressioner separerar förhandsvisning från sändning. F2/S2/K2 avser avgränsad lokal utkastkedja.

**Tester.** `test/message-evidence-projection.test.js`, `test/payment-evidence-ui.test.js`.

**Kvarstående brister / exakt acceptans som behövs.** Acceptera mottagare, innehåll, osäker evidens och fel-/retry-lägen i aktuellt flöde. Verifiera att förhandsvisning aldrig sänder och att sändning kräver tillåtet separat beslut.

**Motivering.** Oförändrat 8. U1,5/P0,5: godkänd aktuell mottagar-/textacceptans kvarstår. Ingen riktig kundsändning är utförd eller behövs för dessa syntetiska tester.

## 28. Schemalagd automatisering — 6,5 → 6,5

**Bevis och delpoäng.** Beständiga körningar, kvot, ägar-/företagslease, återupptagning och workflowvillkor testas. PR48:s OCR-trigger kräver lyckad aktuell main och två refkontroller; den startas inte av våra PR-körningar. F1,5/U1 avser kvarvarande verklig driftbredd.

**Tester.** `test/integration-jobs-orchestration.test.js`, `sites/tests/company-sync-scale.test.mjs`, `test/sites-ocr-pull.test.js`, `test/cloud-ocr-trigger.test.js`.

**Kvarstående brister / exakt acceptans som behövs.** Verifiera faktiska auktoriserade Gmail-, bank- och OCR-körningar med rätt identitet/kadens, 429/restart/leasehantering och bevarade original.

**Motivering.** Oförändrat 6,5. P0: konfigurerade scheman, en Gmailhämtning eller worker-kontakt bevisar inte alla nödvändiga bank-/Gmail-/OCR-körningar med rätt kadens.

## 29. Säkerhetskopiering — 7,5 → 8,5

**Bevis och delpoäng.** Aktuell backupstatus: 362/362 filer, manifest_pass. Syntetisk riktig krypterad backup/export/restore har alla27 ägarbundna backuptabeller, originalhashar och oberoende ekonomifacit. Fel nyckel/ägare/företag, korrupt/saknat original, ändrad huvudbok/plaintext och främmande ägarrad avvisas; positiva kontrollfall passerar.

**Tester.** `test/integration-jobs-backup.test.js`, `sites/tests/company-backup.test.mjs`, `sites/tests/company-bank-sync-backup.test.mjs`, `sites/tests/recovery-drill.test.mjs`, `test/security-login-rate-limit.test.js`.

**Kvarstående brister / exakt acceptans som behövs.** Verifiera aktuell komplett separat kopia av alla nödvändiga original, metadata och nycklar; kontrollera hash och genomför ägarisolerad restore utan gamla behörigheter/leaser.

**Motivering.** Höjning 7,5→8,5 genom S1→2 enligt oförändrad modell: åtta kritiska felklasser och positiv fullkedja är exekverade. P1 behålls för aktuell verifierad backup, inte för en oberoende katastrofåterställning.

## 30. Säkerhet och åtkomstkontroll — 8,5 → 8

**Bevis och delpoäng.** Företag/roller, session/CSRF/state, medlemskapsändringar, bankhandtag, exporter, original, worker och skrivgränser har positiva/negativa HTTP-/SQLite-/Sitesacceptansfall. Oberoende review kopplas till exakta kodversioner. F2/S2/K2 gäller exekverade lokala säkerhetsgränser, inte uttömmande penetrationstest.

**Tester.** `test/saas-company-acceptance.test.js`, `sites/tests/saas-company-acceptance.test.mjs`, `test/saas-login-boundary.test.js`, `test/session-mutation-fence.test.js`, `sites/tests/openpayments-write-ambiguity.test.mjs`, `sites/tests/openpayments-lifecycle-recovery.test.mjs`, `test/security-login-rate-limit.test.js`, `sites/tests/security-request-budget.test.mjs`, `sites/tests/company-request.test.mjs`, `sites/tests/bank-state-integrity-q8.test.mjs`.

**Kvarstående brister / exakt acceptans som behövs.** Verifiera de rättade consent- och racegränserna i accepterad driftkonfiguration. Bedöm oberoende den publicerade revisionens nycklar, sessioner, ägarbyte, callbacks, export/original och överlastskydd; stäng alla säkerhetskritiska fynd.

**Motivering.** P sänks 1→0,5: läsande driftstatus och publicerad grund har verifierats, men aktuell publicerad kandidat och full driftsäkerhetsacceptans har inte verifierats.

## 31. Katastrofåterställning — 5,5 → 6,5

**Bevis och delpoäng.** Den syntetiska katastrofövningen använder riktig backupmotor, portabel kryptering och isolerad återställning samt oberoende före-backupförväntningar. Alla27 ägarbundna backuptabeller/original/ekonomifacit kontrolleras; gamla behörigheter och leaser återaktiveras inte. Åtta kritiska felklasser avvisas. F1,5/U1 behåller verklig operativ lucka.

**Tester.** `sites/tests/company-backup.test.mjs`, `sites/tests/company-bank-sync-backup.test.mjs`, `test/integration-jobs-backup.test.js`, `sites/tests/recovery-drill.test.mjs`, `test/backup-disaster-recovery.test.js`.

**Kvarstående brister / exakt acceptans som behövs.** Återställ från en oberoende komplett backup i isolerad miljö med nycklar, original, ägare, behörigheter, historik och ekonomisk avstämning; mät RPO/RTO och dokumentera start/återgång.

**Motivering.** Höjning 5,5→6,5 genom S1→2. K2 stöds av realiserad lokal end-to-endåterställning. P0 kvarstår: ingen faktisk produktionsbackup har återställts och accepterats separat med verklig nyckeltillgång och RPO/RTO.

## 32. Kodkvalitet och tester — 8,5 → 8,5

**Bevis och delpoäng.** Låsta installationer, fulla sviter på angivna Nodeversioner, syntax/typer, audit, produktionsbygge, Chromium och SQLitebelastning får hash-/SHA-bundna kvitton. Trunkerad/tom/skip/TODO/kraschad eller ändrad källa underkänns. F2/S2/K2 kräver gröna slutgrindar på exakt kombination.

**Tester.** `test/saas-test-isolation.test.js`, `test/reconciliation-contract.test.js`, `sites/tests/company-sync-boundary-integration.test.mjs`, `test/quality-runner.test.js`, `test/payment-concurrency.test.js`.

**Kvarstående brister / exakt acceptans som behövs.** Bevara reproducerbara fulla grindar vid varje release. Slutför relevant instrumentation-/lint-/underhållsacceptans och knyt faktisk accepterad leverans till samma testade kod; den nu gröna syntetiska CI:n är redan styrkt.

**Motivering.** Oförändrat 8,5 är villkorat av faktisk slutlig CI, tills dess ingen slutcertifiering. U1,5: kvarvarande lint-/utvecklingsberoendeskuld och verkliga driftprov. P1 avser levererat grönt kodkvitto, inte kommersiell acceptans.

## 33. Verifiering i verklig produktion — 6,5 → 5

**Bevis och delpoäng.** Native versions-/deploymentstatus och läsande bank/Gmail/Bankgiro/backup samt ett befintligt rapportoriginal har observerats. Detta är begränsade konkreta driftkontroller: F1,5/S1/K1,5/U1. Inga nya betalningar, bankmedgivanden, OCR-jobb eller kundmeddelanden skapas.

**Tester.** `test/saas-company-acceptance.test.js`, `sites/tests/saas-company-acceptance.test.mjs`.

**Kvarstående brister / exakt acceptans som behövs.** Verifiera exakt levererad revision, representativa autentiserade kundflöden, faktisk bank/Gmail/OCR, original-/ekonomifacit och återställningsövning; stäng kommersiella go/no-go-grindar.

**Motivering.** P sänks 1,5→0: den nödvändiga autentiserade produktionskedjan på rätt slutrevision, verklig bank, full OCR och oberoende återställning saknas. En lyckad separat Sitespublicering ändrar inte detta.
