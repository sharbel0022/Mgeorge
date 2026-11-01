# Direkt Bankgiro-XLSX-import — 1 november 2026

Direkt Excelimport är implementerad i befintliga Sites- och Node-applikationerna. Användaren behöver inte konvertera XLSX till CSV. **En läsbar rapport är inte ett bevis för bankautenticitet eller rätt kontorelation.** Rapporten sparas för granskning när bankens stabila insättningsidentifierare saknas; inga pengar eller fakturabetalningar skapas genom en gissning.

## Levererad kedja

`XLSX → begränsad ZIP-kontroll → rubrikstyrd parser → bankfakta → skrivfri förhandsgranskning → bevarat original/SHA-256 → omparsning → befintlig import/avstämning`.

SheetJS CE 0.20.3 från den officiella distributionen används synkront i browser, Node och Worker. fflate 0.8.3 kontrollerar faktisk uppackad storlek och CRC32 före arbetsboksläsningen. Båda beroendena är låsta i båda paketen, så en ren Node-installation fungerar utan installerade Sites-beroenden.

Parsern hittar datum/konto/Bankgiro, antal/belopp/betalningstyp/löpnummer, TOTALT samt avsändare/referens/Bankgiro-avinummer/belopp genom rubriker. Den stöder flera betalningar, dagar, block och arbetsblad med stödd struktur; svenska tal och Excel-/textdatum; rapportens sammanslagna och tomma celler samt exportens implicita celladresser och MIME-konvention. Samtliga summor jämförs i heltalsören.

Textreferenser behåller inledande nollor. Numeriska referenser accepteras endast med ett uttryckligt heltalsnollformat som bevarats i cellen. General-/exponentformat avvisas; inga förlorade nollor gissas. Exportens allmänna betalningsreferens får typen `structured`, aldrig formell OCR. Bankbetalare, avsändar-Bankgiro, betalningsreferens, faktura och manuellt verifierad relation förblir separata.

Ogiltig struktur, saknade fält, motstridiga metadata, fel antal/summa, negativa/ogiltiga belopp, dubbla rapporter/rader, formler, länkar, dolda fält och tvetydiga sammanslagningar stoppas. Gränser: 15 MB uppladdning, 8 MB per uppackad ZIP-post, 24 MB sammanlagt, 200 ZIP-poster, 20 arbetsblad, 1 000 betalningar samt särskilda gränser för celler och sammanslagningar. ZIP64, makron, externa datakällor, storleks-/CRC-fel och överlapp avvisas.

## Original och ekonomisk säkerhet

Det tillhandahållna originalet hittades lokalt och lästes privat. **13/13 privata facitkontroller passerade** efter sista parserändringen, inklusive avsändare, exakt textreferens, belopp/datum, mottagar- och avsändaruppgifter, rapportantal/-summa, löpnummer, explicit bankkontotext och cellbevis. Original, kontonummer, verkliga cellvärden och dess hash publiceras inte. Syntetiska fixtures återger den observerade strukturen.

Originalet innehåller bankkontotext men ingen stabil insättnings-/individidentifierare som säkert kan likställas med AIS. Löpnummer och Bankgiro används därför aldrig som påhittat AIS-id. Explicit kontotext kan prövas mot befintliga valda bankkonton; utan entydig kontokoppling och stabil bankidentifierare förblir rapporten spärrad. Ingen företags-Bankgirokonfiguration eller bankavtalsregel har hittats på.

Sites återanvänder `bankgiro.import`, R2-dokument, dokumentägarfilter, SHA-256-omläsning och D1 revisions-CAS med atomisk audit. Webbläsarens rader/hash ersätts med ny parsning av ägt original. Celladress, arbetsblad, celltyp, råvärde och talformat sparas i `reportEvidence.sourceCells` och visas utfällbart. Review-specifikationer undantas från `economicTransactions` och avstämning. Endast redan befintliga, strikta bankkopplingsregler kan ersätta en samlingspost med dess individrader.

Node återanvänder parsern och befintliga `import_jobs`: originalbytes/hash sparas atomiskt som `needs_review` med `BEGIN IMMEDIATE`, utan `bank_transactions` eller allokeringar. En separat lagringsspärr hindrar att `review_only` av misstag skickas till ordinarie transaktionslagring. Faktauppgifter visas i förhandsgranskningen; det sparade originalet hämtas från importhistoriken. Node har inte fått en parallell betalningsdatabas.

Samma originalhash skapar ingen extra import. Olika mottagar- eller avsändar-Bankgiron kollapsar inte längre till samma reviewrad. Överlappande rapporter tillför inga ekonomiska pengar. Kontrollerade AIS-/CSV-/XML-flöden och befintliga motparts-, referens-, belopps-, valuta- och saldoregler behålls.

## Före → efter

Baslinje: `a8ec37a19d93ef453bf8e3a5db617121d7837576`. Före första produktionsändringen kördes Node/Sites fulla baslinjesviter och direkt XLSX-avvisning reproducerades. Den jämförbara parsermätningen kör därefter samma runner och samma byteidentiska syntetiska korpus mot baslinjens parser respektive kandidatkoden. JSON anger att mätningen skedde i en ändrad arbetskopia; `candidateCommit` är då basens HEAD, inte ett påstående om färdig kodcommit.

Korpus: 22 XLSX-indata, 9 giltiga filer med 11 betalningsrader och 13 ogiltiga filer. Korpus-SHA-256: `65bb2b87b6e070160d43f93dd5322b6c56cae45a3f04ae55acfd982ceda2b5db`. Se `measurements/bankgiro-xlsx-before.json`, `measurements/bankgiro-xlsx-after.json` och `scripts/measure-bankgiro-xlsx.mjs`.

| Mått | Före | Efter | Förändring | Testbevis | Kvarstående begränsning |
| --- | ---: | ---: | --- | --- | --- |
| Korrekt identifierad avsändare | 0/11 | 11/11 | +100 procentenheter | Identisk parserkorpus | Begränsat syntetiskt urval; privat original separat |
| Exakt bevarad betalningsreferens | 0/11 | 11/11 | +100 procentenheter | Samma korpus, numeriska/textceller | Nollor som saknar cellbevis kan inte återskapas |
| Korrekt normaliserad betalningsrad | 0/11 | 11/11 | +11 | Samma korpus | Parserrader är inte bokförda bankposter |
| Accepterade giltiga XLSX-filer | 0/9 | 9/9 | +9 | Samma korpus | Andra banklayouter avvisas |
| Felaktigt accepterade filer | 0/13 | 0/13 | Oförändrat | Samma negativa korpus | Ingen universell säkerhetsgaranti |
| Parsningstid, hela korpusen | 2,198 ms | 157,641 ms | +155,443 ms | Engångsmätning | Före avvisade direkt; ingen prestandaförbättring påstås |
| Ekonomiska XLSX-poster | Ej stödda | 0 i osäkra fall | Säker review-import tillagd | 18 Sites + 8 Node integration/UI | Verifierat stabilt bank-id krävs för avstämning |
| Felaktiga automatchningar | Inte mätt i parserkorpusen | 0 i nya negativa API-fall | Ingen jämförbar produktionskvot | Oförändrade saldon/allokeringar testas | Verklig matchningsprecision inte mätt |
| Ekonomiska dubbletter | Inte mätt i parserkorpusen | 0 i återimport/överlapp/samtidighet | API-spärr verifierad | Originalhash, omdöpning, två samtidiga bekräftelser | Ingen stabil individidentitet gissas |
| Manuella granskningsfall | XLSX avvisades | Rapport utan stabil bankkoppling hålls | Bankfakta blir synliga | API + lokalt browserprov | Kräver ytterligare verifierat bankunderlag |
| Lyckade fullsvitstester | 570 + 858 | 578 + 912 | +62 | Node + Sites, inga misslyckanden | Syntetisk testbevisning |

## Testbevis och gränssnitt

- Parser: **35/35**. API/original/ekonomisk isolering: **18/18** nya Sites-tester. Node XLSX/API/UI: **8/8**. Generell betalningsreferens visas separat från OCR i desktop och mobil.
- Fulla Node **578/578**, Sites **912/912**, syntax **84 filer**, TypeScript och produktionsbygge godkända. Ingen databas/schemaändring behövs.
- Root audit: **0** sårbarheter. Sites produktionsaudit: **0**. Full Sites-audit: oförändrat **16 moderate** i utvecklingsverktyg/minimatch, **0 high/critical**; obligatorisk high-grind godkänd. Ingen brytande tvångsnedgradering av ESLint genomförd.
- Verkliga röda tester föregick parser/adapter/UI. Oberoende granskning ledde till rättningar av ZIP-expansion/CRC/ZIP64, merge-arbete, dolda fält, samma-SHA-importhistorik och förlorade mottagar-/avsändar-Bankgirouppgifter. Gamla CAMT-metadata fick behålla exakt kontrakt efter upptäckt regression.
- Lokalt produktionsbygge testades via riktig filväljare: syntetisk XLSX → preview → uttrycklig bekräftelse endast i isolerad demo → betalare/referens och reviewstatus i banklistan. Desktop **1280×900**, mobil **390×844**; dokumentbredd lika med viewport, tabellen rullar inom sin behållare. Bilder finns i `screenshots/bankgiro-xlsx/`.
- De 30 begärda områdena täcks av nya parser-/API-/UI-fall och befintliga `bankgiro`, `bank-api-original`, `bank-file-provenance`, reconciliation-/payer-/reference-sviter: även AIS-överlapp, samma belopp/flera fakturor, annan betalare, delbetalning och återbetalning. Negativa XLSX-belopp avvisas för separat granskning.

## Ändrade filer

Gemensam parser: `sites/lib/bankgiro-xlsx.js`; koppling: `sites/lib/bankgiro-parser.js`. Sites original/API/domän/UI: `sites/lib/server.ts`, `sites/app/api/files/route.ts`, `sites/lib/domain.ts`, `sites/app/dashboard.tsx`, `sites/components/bank-payments.tsx`, avgränsad referensregel i `sites/app/globals.css`. Node: `src/importers.js`, `src/server.js`, `src/db.js`, `public/app.js`. Båda package-/lockfilerna, nya syntetiska tester/fixture, mätprogram/-JSON, bilder, plan, scorecard och progress kompletteras.

## Publicering och kvarstående begränsningar

Implementation `359055c` och sista presentationsjustering `417fd4c35a9c585c78b22e5f7dc95ceb9fcf54f8` finns på main. [Actions 41313420001](https://github.com/sharbel0022/Mgeorge/actions/runs/41313420001) godkände båda jobben på exakt sista kod-SHA, inklusive rena installationer, tester, audits och Sites-bygge. **Senaste Sites-version39 är publicerad: succeeded.** Sites-källa `d3b5dc35eaa8757d00064ab8dbd2df91f9034ea3` har exakt samma träd som GitHub-commitens `sites/`. Version38s tidigare kvitto bevaras också i slutkvittot. Fullt kvitto: `BANKGIRO-XLSX-PUBLICATION.json`.

Nya importknappen, Exceltexten och `.xlsx`-filtret verifierades i publicerad browser. Därefter verifierades syntetisk XLSX via riktig filväljare och bekräftelse i sajtens isolerade demoläge; allt stannade i webbläsarens minne, inget bankoriginal laddades upp till servern. Referensvärdet visas framträdande med separat typetikett i sexkolumnsvyn och mobilkort. Samtliga912 Sites-tester, TS och produktionsbygge kördes på nytt efter presentationsjusteringen. Arbetsyterevision31→31 och ändringstid oförändrade; D1-tabellista, policy, scheman och runtime-revision9 oförändrade. D1-läsaren trunkerade payload; fullständiga produktionssaldon har därför inte oberoende återberäknats. Kontrollerna visar ingen ny arbetsyteskrivning. Inga schema-/auth-/hostingändringar ingår och inget riktigt bankoriginal importerades i produktion.

Kvar: bank-/avtalsverifierad stabil koppling mellan denna rapport och AIS-insättningen, formell OCR-regel när sådan faktiskt gäller, samt autentiserat verkligt import-/avstämningsutfall. Systemet får därför visa bankens avsändare och betalningsreferens utan att automatiskt betala en faktura. Kvalitetsbetyg och produktionskontroll redovisas separat och konservativt.
