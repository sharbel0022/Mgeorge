# Agent 8 — kvalitet, CI och prestanda

**Leverans:** [PR #47](https://github.com/sharbel0022/Mgeorge/pull/47), `feature/95-quality` mot `main`. Den verifierade mätbasen klarar samtliga sex huvudjobb och det separata säkerhetsjobbet. Test-, benchmark- och CI-arbetet har reproducerbara kvitton med källidentitet, faktiska processutfall och artefakthashar. **9,5/10 certifieras inte:** återstående mätluckor och driftberoenden redovisas nedan.

## Verifierad källidentitet

| Fält | Värde |
| --- | --- |
| Uppmätt branch-head | `8a083eb70babac68b08ab3eac50aaa5e225c5eb8` |
| Integrerad main-bas | `bf24a3c52ffc637d1e7bbc4d4f64a1732dcd9fee` |
| Faktiskt testad PR-merge-checkout | `1880ac268eeb7de752bec2ca9567bf35ffdfdec8` |
| Exakt gemensamt Git-träd | `ed59308d7e41be58b49e0bb66a77b707e08fde86` |
| Källmanifestets SHA-256 | `e1102d48e0fd80047d5c1a0f29f0c71a4fdfa4b862a8427a49bd70c8880b0a91` |
| Huvud-CI | [42083369457 — success](https://github.com/sharbel0022/Mgeorge/actions/runs/42083369457) |
| Säkerhets-CI | [42083372075 — success](https://github.com/sharbel0022/Mgeorge/actions/runs/42083372075) |

GitHubs merge-checkout och branchens head har identiskt källträd. Samtliga sex kvalitetsprofiler började och slutade med samma rena manifest, 1 192 filer och `sourceChangedDuringRun: false`. Det äldre separata säkerhetskvittot innehåller start-SHA och ren arbetsyta, men saknar kvalitetsprofilernas jämförda slutmanifest.

Denna rapport bevarar ovanstående mätbas även när rapporten och den avslutande LCOV-rapporteringsrättningen tillkommer i en senare commit. Senare commits får egna CI-körningar; deras status redovisas i PR:n. Resultaten nedan flyttas inte till en annan SHA.

## Faktiskt exekverade resultat

Alla testresultat nedan har **0 fail, cancelled, skipped och TODO**. Tiden avser respektive test-/acceptansprocess, inte hela jobbets installation och audit.

| Körning | Godkända / körda | Tid | Miljö |
| --- | ---: | ---: | --- |
| Node, full svit | 2 023 / 2 023 | 218,014 s | Node 22.23.4 |
| Node, full svit | 2 023 / 2 023 | 192,699 s | Node 24.22.1 |
| Sites, full svit | 3 851 / 3 851 | 523,510 s | Node 24.22.1 |
| Bankgirobrygga | 47 / 47 | 5,112 s | Node 24.22.1 |
| Chromium, onboarding + företagskontext | 46 / 46 | 15,725 s | Playwright 1.62.1; Chromium 151.0.7922.34 |
| Separat säkerhetsurval | 325 Node + 788 Sites | 139,572 s totalt | Node 22.23.4 |

Backend-sviterna omfattar **5 921 fall** enligt testköraren: 2 023 + 3 851 + 47. Node-matrisen kör samma svit två gånger. Säkerhetsurvalets 1 113 fall överlappar fullsviterna och ska inte adderas som nya fall. Browserns 46 är **41 befintliga onboardingfall plus fem nya workspacefall**.

Dessutom passerade 209 JavaScript-filer syntaxkontrollen, Sites typkontroll, verifiering av den installerade minimatch-mitigeringen och Sites produktionsbygge. Typkontrollen tog 10,795 s och bygget 14,623 s. Browsern registrerade noll externa förfrågningar och noll browserfel. Produktionsbygget är ett byggresultat; ingen deployment utfördes i detta uppdrag.

## Coverage med rätt nämnare

Slutgranskningen upptäckte att Node lämnar flera LCOV-poster för samma källfil vid separata modulinstanser. `src/server.js` förekommer **19 gånger**, med 1 141 rader per post. Därför är de ursprungliga Node-kvittonas `files: 97` ett postantal. Det finns **79 unika SF-sökvägar**.

Varje LCOV-post har validerats mot sina `DA`, `LF` och `LH`. Därefter har täckta rader förenats per exakt källsökväg och radnummer. Detta ger följande coverage för **unika rader i laddade produktionskällor**:

| Körning | Unika källor / LCOV-poster | Täckta / uppmätta rader | Andel |
| --- | ---: | ---: | ---: |
| Node 22 | 79 / 97 | 10 927 / 11 726 | 93,19 % |
| Node 24 | 79 / 97 | 10 930 / 11 726 | 93,21 % |
| Sites | 87 / 87 | 8 227 / 10 339 | 79,57 % |
| Bankgirobrygga | 2 / 2 | 412 / 421 | 97,86 % |

Radföreningen verifierar LCOV:s rapporterade koordinater. Mappningen mellan transformerad kod och ursprungskällan är inte generellt verifierad.

De ursprungliga summorna bevaras för reproducerbarhet. Dessa räknar **per LCOV-post**, inklusive upprepade källor:

| Körning | Rader | Funktioner | Grenar |
| --- | ---: | ---: | ---: |
| Node 22 | 15 484 / 32 264 — 47,99 % | 2 456 / 4 269 — 57,53 % | 9 316 / 13 045 — 71,41 % |
| Node 24 | 15 487 / 32 264 — 48,00 % | 2 456 / 4 270 — 57,52 % | 9 316 / 13 060 — 71,33 % |
| Sites | 8 227 / 10 339 — 79,57 % | 1 670 / 1 872 — 89,21 % | 8 459 / 9 340 — 90,57 % |
| Bankgirobrygga | 412 / 421 — 97,86 % | 69 / 76 — 90,79 % | 268 / 289 — 92,73 % |

Normaliseringens 93,21 % och råposternas 48,00 % beskriver **samma Node 24-körning med olika nämnare**. Omräkningen tillför inga testfall. Genererade funktions- och gren-ID:n varierar mellan modulinstanserna, så ingen osäker sammanslagning av dessa identiteter görs. Kvalitetsrapportören särredovisar nu `files`, `records`, råposternas aggregation och validerad `sourceLines`.

Detta är fortfarande inte heltäckande repositorycoverage. Oimporterade filer saknas i nämnaren. Vissa kompilerade `data:`-moduler och källtextkontroller ger ingen användbar källfilstäckning; exempelvis saknas Sites `document-processing.ts`, `server.ts` och `bankgiro-ingest-service.ts` som egna SF-poster. Browserkod ingår inte i LCOV. Avsaknad av en sådan post betyder inte automatiskt att funktionen saknar tester.

[Normaliserat underlag och största återstående radluckor](evidence/coverage-8a083eb.json) innehåller algoritm, ursprungliga LCOV-hashar och exakta nämnare. Sviterna ska bedömas tillsammans: en Node-fil med låg täckning i Sites körning kan vara väl täckt av Node-sviten.

Efter förening av Node 24-, Sites- och bridge-körningarnas rapporterade radträffar är de största synliga luckorna:

| Källa | Rapporterade otäckta rader | Prioriterad uppföljning |
| --- | ---: | --- |
| `sites/lib/account-evidence-presentation.ts` | 49 / 60 | Korrekt källmappning av befintliga transpilerade tester; konto-/bevispresentation och retryråd. |
| `src/server.js` | 46 / 1 141 | Schemaläggning, vissa kontrolladaptrar, dokumentpreview och startupbeteende som testläget avsiktligt stänger av. |
| `sites/lib/local-ocr.ts` | 28 / 33 | Källmappning samt faktisk browserworker, canvas/PDF-fallback, resursgränser och städning. |
| `src/banking/openpayments-node-transport.js` | 17 / 255 | Kvarstående signal-, status-, query- och konstruktionsfel i syntetisk transport. |
| `src/company-runtime.js` | 13 / 356 | Återöppning, felaktig partitionsväg och skyddad iteration vid kontextbyte. |

De transformerade modulernas siffror är delvis mätluckor. Även genererade funktions-/grenkoordinater med `undefined` förekommer i två Sites-UI-modulers LCOV; råsummorna ger därför ingen garanti om korrekt mappad originalkälla.

## Inventering och förbättringar

Den [fullständiga filinventeringen](test-inventory.json) skiljer den ursprungliga basen `4ad205b` från main-integrationen `bf24a3c` och denna branch. Aktuell kod har **112 Node-testfiler, 160 Sites-testfiler och tre bridge-testfiler**. Huvudflödet, säkerhetsflödet och det operativa OCR-flödet är inventerade. OCR-flödet följer main och har inte manuellt körts eller ändrats av Agent 8.

| Uppdrag | Levererat underlag |
| --- | --- |
| Inventera sviter och Actions | Alla testfiler, tre workflows, befintliga browserharnessar och luckor i `test-inventory.json` och `README.md`. |
| Identifiera svaga områden | Saknade kvitton/coverage, nästlad syntax, browser-CI, belastningsmätning, startupdiagnostik samt kvarstående instrumentation och driftluckor. |
| Unit-, integration-, kontrakts- och end-to-end-tester | Negativa runnerprov, riktig HTTP-/SQLite-kedja, providerkontrakt och faktisk Chromium-UI med syntetiska API-svar. En sammanhängande browser–backend–bank-kedja är inte verifierad. |
| Bank, OCR, Bankgiro, fakturor och SaaS | Nya regressioner och fulla befintliga sviter enligt tabellen nedan. |
| Reproducerbara körningar | Låsta installationer, Node-matris, isolerad testmiljö, seedade fixtures, exakta kommandon, käll- och logghashar. |
| Databas och migrationer | Historiskt SQLite-schema, upprepad migrering/reopen, originalkorruption och bevarad ekonomi; befintliga D1-migrationstester körda i Sites. |
| Idempotens och samtidighet | Replay efter omstart, verkliga konkurrerande processer, kontrollerat startlås, avbrott/rollback och beständiga synkleaser. |
| 1, 10 och 100 företag | Riktiga separata SQLite-databaser med kolliderande externa fixture-ID:n, verifierad isolering och exakta radantal. |
| Belastning och prestanda | Parameteriserad benchmark, percentiler, genomströmning, minnessampling och separat CPU-profil. |
| CI-felrapportering | TAP, JUnit, LCOV, sammanfattningar, verkliga exitkoder, stderrdiagnostik och artefakter även efter fel. |
| Produktionsbygge och audit | Faktiskt utförda typer/build samt fulla och produktionsbegränsade audits. |
| Maskinläsbara kvalitetskvitton | SHA-bundna jobbresultat, ursprungliga fel, benchmark, normaliserad coverage och integritetskontroller i `evidence/`. |

### Viktiga nya regressioner

| Område | Vad testet faktiskt bevisar |
| --- | --- |
| Fakturor och bankimport | Verklig lokal HTTP-server skapar och läser syntetisk faktura/PDF, förhandsvisar/importerar CSV, stämmer av, startas om och spelar upp samma import utan dubbla ekonomiska poster. |
| Original och migration | Historiskt SQLite-schema uppgraderas och öppnas igen med bevarade identiteter, belopp, allokeringar och audit. Ett manipulerat original får inte bli godkänt genom ny hash vid reopen. |
| Korrupt bankoriginal | Efter omstart avvisas hämtningen med 409 och avstämningen skapar inga allokeringar. |
| Bankgirokontrakt | Ett opakt rapport-ID URL-kodas korrekt; auktoriserad rutt, auth, manuell redirectpolicy, cursor och originalbytes bevaras. Transporten är en fixture. |
| OCR-återhämtning | Riktig worker sparar resultat i SQLite, medan syntetisk transport tappar kvittot. Ny klient dubbelextraherar inte; gammalt slutförande får 409, en historikrad behålls och ingen faktura registreras automatiskt. Optisk träffsäkerhet mäts inte av detta fall. |
| Samtidighet | Två verkliga processer kan importera samma betalning en gång; avbrott återställer transaktionen. Två separata startupregressioner täcker tillfälliga SQLite-lås. |
| Företagskontext i browser | Formulär överlever kontextuppdatering vid 320/390/1440 px. Företagsbyte bevaras över omladdning; återkallat medlemskap tömmer privat innehåll och spärrar mutationer. |

## Fel som upptäcktes och rättades

Den första fulla CI-körningen [42079194353](https://github.com/sharbel0022/Mgeorge/actions/runs/42079194353) är fortsatt registrerad som **underkänd**: Node 24 hade 1 922/1 923 och Sites 3 756/3 757. Node 22, bridge, browser och benchmark passerade. Sites coverage var då omätt, eftersom V8-underlaget hade trunkerats. Det är inte 0 % kodtäckning.

1. **SQLite-start under låsning.** Diagnostik reproducerade ett verkligt `SQLITE_BUSY_RECOVERY`-fel när WAL förhandlades före installation av timeout. Den enda produktionsändringen jämfört med integrerad main sätter samma `busy_timeout=5000` före WAL. Kontrollerade regressioner gick från rött till grönt, och en kandidatserie klarade 100/100 starter. Det ursprungliga CI-barnets undantag hade inte sparats, så exakt orsakssamband med just det första CI-felet är inte fastställt. Barnprocessernas stderr sparas nu begränsat och de måste avslutas naturligt med kod 0.
2. **Förlorad npm-identitet.** Den isolerade testmiljön tappade anropande `npm_execpath`; ett befintligt lifecycle-test gissade då fel installation. Den faktiska CLI-sökvägen bevaras nu. Providercredentials och preloadkod förs inte vidare.
3. **Coverage vid avsiktligt filskrivningsfel.** Ett befintligt test begränsar barnet till 64 KiB och kunde därmed också förstöra V8:s coveragefil. Endast detta felinjicerade barn körs utan V8-instrumentering. Förälderns instrumentation och samtliga fel-/reparationsassertions behålls. De två berörda Sites-filerna kördes tillsammans: 40/40 och giltig LCOV; därefter passerade hela Sites-sviten.
4. **LCOV-poster med samma källa.** Den avslutande rapporteringsrättningen behåller rådata och räknar unika källrader separat. Dubblettposter och ofullständiga radunderlag får egna regressionsprov. Granskningen reproducerade även att fristående räknare efter `end_of_record` kunde blåsa upp råvärden; ett nytt rött test demonstrerade felet innan rättningen. Parsern avvisar nu sådana räknare och summerar endast parsade poster. Hela runnerfilen passerade därefter **18/18**, utan fail/cancel/skip/TODO. Oberoende granskning godkände den korrigerade tolkningen mot samtliga fyra verkliga LCOV-filer. Ingen täckning tillskrivs okända funktioner, grenar eller oimporterade filer.

Det första lokala Sites-baslinjeförsöket hade också ett filfel: 3 752 pass av 3 753. Den filens senare 34/34 används inte för att godkänna den misslyckade fullkörningen. Den slutliga mätbasens kompletta körning är ett nytt, separat bevis.

## Syntetisk belastning: 1, 10 och 100 företag

Miljön var Node 24.22.1, SQLite 3.53.4, Linux x64, AMD EPYC 9V74 och fyra logiska CPU:er på GitHub-hostad Ubuntu. Varje företag fick tio syntetiska banktransaktioner; seed 95, högst fyra parallella företagsjobb och en replayomgång. Två samtidiga anspråk per företag provar därefter att exakt en vinner leasen.

Latens och genomströmning nedan gäller **initial importfas**. Totaltiden omfattar även setup, replay, konkurrerande anspråk, verifiering och städning.

| Företag | Totaltid | Initial p50 | Initial p95 | Importerade transaktioner/s | Samplad högsta RSS |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 0,454 s | 130,90 ms | 130,90 ms | 76,23 | 101,40 MiB |
| 10 | 3,482 s | 409,61 ms | 422,76 ms | 88,85 | 156,59 MiB |
| 100 | 33,801 s | 408,75 ms | 458,33 ms | 98,09 | 521,35 MiB |

Alla tre storlekar klarade korrekthetskontrollerna: **1 110 importerade och beständigt sparade rader, 2 220 igenkända replaydubbletter, 111 förväntade `ACCOUNT_BUSY` och noll oväntade synkfel**. Externa providerförfrågningar var noll. Hela benchmarken tog 37,758 s.

Mätningen använder en Node-process och verkliga lokala SQLite-partitioner med injicerad provider. RSS är sampling av processen och inkluderar tidigare batcher; den är inte ett exakt OS-toppvärde. Ett företag ger bara ett initialt latensprov. Ingen uppvärmning, upprepad statistisk serie, långvarig belastning, distribuerade workers eller verklig bank-/D1-/R2-latens ingår. Korrekthet och komplett mätning är CI-grindar; tidsvärdena har inga godtyckliga passgränser.

### Separat CPU-profil

En lokal 10-företagsprofil gjordes på den tidigare rena revisionen `b24ea089a062e122ce240ec66ba01180efe533c9`. Den innehöll 5 807 sampel över 12,267 s inklusive startup och setup. Exklusiv tidsviktning gav 57,06 % i företagsruntime, 16,06 % garbage collection och 9,41 % databas-/schemahjälpare. Upprepade medlemskaps- och databasgränskontroller var den tydliga observerade belastningen.

Detta motiverar framtida undersökning av återanvända förberedda SQL-satser och färre redundanta läsningar med bevarad återkallelse- och företagsisolering. Profilen skiljer inte SQL-förberedelse från exekvering/låsning och identifierar inte GC:s allokeringsorsak. Profileringens overhead är inte uppskattad. Ingen prestandaoptimering eller uppmätt förbättring påstås här. [Profileringskvitto](evidence/cpu-profile-b24ea08.json).

## CI, byggresultat och beroenden

De två testflödena använder Ubuntu 24.04, exakta Node-versioner, låsta npm-installationer, `contents: read`, avstängd credentialpersistens och SHA-pinnade officiella Actions med Node 24-runtime: checkout 7.0.1, setup-node 7.1.0 och upload-artifact 7.0.2. Artefakter sparas med `if: always()` i 14 dagar. Tomma/trunkerade resultat, skip/cancel/TODO, timeout, spawnfel och förändrade källindata underkänner körningen. En underkänd oberoende kontroll hindrar inte användbar diagnostik från övriga kontroller.

| Audit | Produktion | Alla beroenden |
| --- | --- | --- |
| Node | 0 fynd | 0 fynd |
| Sites | 0 fynd | 8 moderate, 0 high/critical |
| Bankgirobrygga | 0 fynd | 0 fynd |
| Separat browserverktyg | Inte ett produktionspaket | 0 fynd |

Sites-fynden ligger i utvecklingskedjan `eslint-config-next` → `typescript-eslint` → `minimatch`. Auditens föreslagna lösning anger en versionsändring som den markerar som major. Den befintliga lokala mitigeringen kontrolleras separat och raderar inte auditfynden. Ingen blind dependencyuppgradering har gjorts i denna QA-leverans.

## Kvarstående arbete för målet 9,5/10

1. **Serverkrävda CI-grindar:** vid läsningen angav GitHub `main.protected=false`, statuskontroller med `enforcement_level=off` och inga rulesets. Workflowresultaten finns, men repositoryt tvingar inte igenom dem vid merge. Den anslutna GitHub-appen saknar administrationsåtkomst; detta måste konfigureras med sådan åtkomst.
2. **Mätbar full källkodstäckning:** förbättra source maps/instrumentering för transformerad Sites-kod och inventera oimporterade produktionsfiler. Sätt motiverade regressionsgränser först när nämnaren är stabil. Ingen generell lintgrind har införts.
3. **Utvecklingsberoenden:** avveckla de åtta moderate-fynden genom en separat kompatibilitetsverifierad verktygsuppgradering.
4. **Sammanhängande produktionslik end-to-end-acceptans:** riktig browser, autentiserad backend, databas och behörig testprovider i samma kontrollerade miljö. Utöka även browser-/hjälpmedelsmatrisen och representativ optisk OCR-korpus.
5. **Kapacitet och drift:** upprepade belastningsserier, långvarig körning, distribuerad konkurrens, produktionslik D1/R2 och beslutade latens-/minnesbudgetar. Verklig bankåtkomst och produktionsåterställning kräver egna bevis.

Område 32 behåller därför **8,5 → 8,5** i repositoryts befintliga scorecard; övriga numeriska poäng ändras inte. Detta uppdrag höjer mängden verifierbar evidens och rättar konkreta fel, utan att ge syntetiska resultat en driftstatus de inte bevisar.

## Reproduktion och beständiga kvitton

Kör från en ren checkout med angiven Node-version. Profilerna installerar låsta beroenden; kör dem sekventiellt i samma checkout och använd en ny utdatakatalog.

```bash
npm run quality:node -- .codex-work/quality/reproduction/node
npm run quality:sites -- .codex-work/quality/reproduction/sites
npm run quality:bridge -- .codex-work/quality/reproduction/bridge
npm run quality:performance -- .codex-work/quality/reproduction/performance
npm run quality:browser -- .codex-work/quality/reproduction/browser
node scripts/run-saas-security-acceptance.mjs .codex-work/quality/reproduction/security
```

Kör Node-profilen på både 22.23.4 och 24.22.1 med skilda utdatakataloger. Fulla instruktioner och miljögränser finns i [README.md](README.md).

- [Samlat maskinläsbart CI-kvitto](evidence/ci-42083369457.json): källidentitet, verkliga kommandon, resultat, tider, coverage, audits, säkerhetsurval och historiska fel.
- [Oförändrat benchmarkkvitto](evidence/benchmark-8a083eb.json): alla faser, mått, fixturehashar, parametrar och begränsningar.
- [Validerad normalisering av källrader](evidence/coverage-8a083eb.json): källa, LCOV-hashar, algoritm och nämnare.
- [Separat CPU-profilanalys](evidence/cpu-profile-b24ea08.json): exakt äldre källa, profilhashar och avgränsad slutsats.

Alla sju nedladdade CI-arkiv matchade GitHubs SHA-256 och storlek. Ytterligare 78 refererade interna logg-/TAP-/JUnit-/LCOV-/manifestfiler kontrollerades mot kvittonas hash och byteantal. Råartefakterna i Actions har 14 dagars retention; ovanstående kompakta resultat och integritetshashar är incheckade med rapporten.
