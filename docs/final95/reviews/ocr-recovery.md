# Final 9.5 recovery: Gmail, OCR och dokumentköer

Datum: 2026-11-06. Delrapport för `feature/final-95-recovery`.

## Resultat och verifieringsgräns

De tidigare separata OCR-förbättringarna från PR #52/#49 har integrerats med de senare skydden i main. Ett ytterligare reproducerbart återställningsfel har rättats: en kö med fler än två avbrutna sista försök kunde förlora lease-bindningen för ett ännu inte kontrollerat, giltigt extraktionskvitto. Återställningen behandlar nu högst två kandidater per anrop och lämnar övriga kvitton intakta till nästa pass. Giltiga, originalbundna resultat går till mänsklig granskning.

Slutlig riktad verifiering: **Node 336/336 och Sites 446/446**, utan fel, överhoppade eller avbrutna tester. De centrala 14 käll- och testfilerna i hashmanifestet matchar commit **`2982b6c51cf2891d97b816ea1ce6c82e5f4c71a1`**. Detta är riktad verifiering; integrationsansvarig dokumenterar de separata fullständiga releasegrindarna på den frysta committen.

Ingen produktionskö har återställts eller omregistrerats. Inga verkliga Gmail- eller bankprovideroperationer har utförts inom detta delarbete. Inga osäkra fakturor har registrerats. Den förseglade OCR-hållmängden V3 har inte öppnats eller körts. Verklig lokal OCR har körts på tre redan etablerade, syntetiska rasterfall; detta är inte en ny blind noggrannhetsmätning eller verifiering av kunddokument.

## 1. Inventering före ändring

Utgångspunkt var main `cde9178c0f8e8e386329ed8feaa4201e87b5a78f`. Öppna PR kontrollerades via GitHubs pull request-API före produktändringar.

| Källa | Faktiskt läge vid inventering | Konsekvens |
| --- | --- | --- |
| PR #52, OCR, `eb4242f783172ac441f9092f921b04b06dc11771` | Öppen; senaste head skiljer sig från den äldre SHA som nämns i delar av beskrivningen | Återanvänd och granska implementationen; behandla inte äldre CI som verifiering av slutlig integration |
| PR #49, `03f84afd61bb1020e73c17c3cde332a1b07f55a0` | Öppen; innehåller #52 och producentgrenarna #45/#46/#47/#50/#51/#53/#54 | Integrera med senare main först, undvik dubblering |
| PR #47, QA, `875876ae539f5ecba1fc39d4c213197806e245ce` | Öppen och inkluderad i #49 | Behåll testkraven; kör dem på den samlade koden |
| Senare main #56–#60 | Redan i main vid inventeringen | Bevara parsergränser, partroller och den senare policyn för optiskt Bankgirobevis |
| PR #55 | Separat UI-gren, inte i #49 | Hanteras av integrationsansvarig; slutlig fokuskörning sammanfaller med integrationscommitten ovan |

Main innehöll redan en senare dokumenterad bedömning än integrationsrapportens 250/330: **257,5/330 = 7,80/10** i scorecarden. Denna delrapport tilldelar inga nya kvalitetspoäng enbart på grund av fler kodändringar eller syntetiska tester.

Redan levererat i #52/#49 och därför granskat, inte återuppfunnet:

- Ett avbrutet original-GET kan startas om en gång med samma lease. Lease- och completion-POST upprepas inte vid okänt utfall.
- Överföringsfel skiljs från OCR-tolkningsfel. Bekräftad delprogress behålls när ett senare steg misslyckas.
- Slutkvittot binds till ägare, dokument, originalhash och unik lease. Efter avbruten fortsättning kan det återvinnas till granskning.
- Köstatus skiljer redo, uppskjutna, aktiva, utgångna och uttömda jobb. Genomströmning räknar unika dokument med accepterad extraktion och terminalt jobbtillstånd.
- Gmail-listningen deduplicerar före 200-gränsen och kan fokusera ett äldre dokument med korrekt ägarskap.
- Engelska Net/Total/VAT-belopp, strikt tusentalsgruppering och flersidiga tabeller stöds samtidigt som `Net 30` inte blir ett belopp.
- Begränsade svarskroppar, icke blockerande avbrott av svarsläsning och UTF-8-budget för completion bevaras.

## 2. Integrationskonflikter och korrigerade regressionsrisker

| Filer | Beslut och verifierad effekt |
| --- | --- |
| `src/invoice-details.js`, `sites/lib/invoice-details.js` | Sammanför engelska beloppsetiketter med mains `Fakturabelopp` och `Summa moms`. Behåller avvisning av okända/oläsliga partsnamn och senare block-, tabell- och etikettgränser. |
| `src/invoice-extraction.js`, `sites/lib/invoice-fields.js` | Behåller mains gemensamma etiketträkning och skydd mot att nollutfyllda referenser blir belopp. Behåller strikt engelskt decimalformat och `Net 30`-skydd. Företagsnamn som `Total Consulting AB` är inte totalsummeetiketter. |
| Samma parserfiler | Bankgiro från OCR kräver fortfarande ordbevis som matchar originalhash och exakt text. Saknat eller felbundet bevis ger inget bankgirovärde. Hög OCR-konfidens upphäver inte granskning eller konfidensbegränsningen. |
| `sites/tests/gmail-preview-q8.test.mjs` | Både äldre dokumentfokus och senare originalbundna OCR-/långa texttester finns kvar. Befintliga assertions har inte försvagats. |
| `src/sites-ocr-pull.js` | Endast det kontrollerade OCR-bevispaketet får följa completion. Ett OCR-fel räknas som misslyckat först efter accepterad serverbekräftelse. |
| `test/helpers/load-invoice-parsers.mjs` | Sites testladdare kan lösa den senare importen av `ocr-bankgiro-evidence.js` även när parsern laddas via data-URL. |
| `test/helpers/invoice-reliability-cases.mjs` | Det positiva syntetiska OCR-fallet får ett giltigt, originalbundet ordbevis. Dess ursprungliga positiva assertion består. Tre nya gränsfall per parser kontrollerar matchande, saknat och felbundet bevis tillsammans med engelska beloppsetiketter. |

Den äldre positiva testfixturen hade saknat underlag för sitt förväntade bankgirovärde efter mains skärpta bevispolicy. Lösningen var att förse det syntetiska positiva fallet med det nödvändiga beviset och lägga till negativa kontroller. Parserns ekonomiska säkerhetskrav sänktes inte. Därför ska äldre mätfiler som använde fixturen utan detta bevis inte beskrivas som direkt jämförbara med den uppdaterade integrerade fixturen.

## 3. Nytt reproducerat fel: återställd kö med fler än två slutkvitton

### Felorsak

`recoverInterruptedExtractions` kontrollerade högst två avbrutna jobb med `attempts >= 3`. Därefter gjorde `enqueueDocuments` en obegränsad uppdatering som markerade alla kvarvarande utgångna sista försök som misslyckade och raderade deras lease. I en äldre eller återställd kö med tre giltiga kvitton blev det tredje jobbet aldrig originalkontrollerat. Den raderade leasen förstörde bindningen som den ordinarie återvinningskontrollen behöver, även om extraktionshistoriken fanns kvar.

Två syntetiska regressioner reproducerade felet före rättningen: tre giltiga kvitton respektive ett ogiltigt första kvitto följt av två giltiga. **Båda misslyckades före rättningen, 0/2 gröna.**

### Rättning

I `sites/lib/document-processing.ts` behandlas nu både återvinning och eventuell markering som misslyckat per vald kandidat, högst två per anrop. En fallback får bara ändra det valda jobbets oförändrade ägare, dokument, försökstal, lease, extraktion och utgångstid. En samtidigt registrerad faktura får inte skrivas över. Den obegränsade efterföljande uppdateringen har tagits bort. Även övergivna eller föräldralösa jobb kan avslutas inom samma begränsade pass.

Ett giltigt resultat kräver fortfarande det ursprungliga lease-bundna run-ID:t, rätt SHA-256, ett identiskt sparat extraktionskvitto, tillgängliga originalbytes och korrekt aktiv källa. Resultatet blir `needs_review` med `processing_interrupted_after_extraction`. Ingen automatisk registrering tillkommer.

### Verifiering

Efter ett första pass ska det tredje jobbets lease och extraktion vara exakt oförändrade. Efter ett nytt processpass ska dess giltiga resultat gå till granskning utan nytt OCR-försök. Testerna kontrollerar oförändrade originalbytes och historik, bibehållet försökstal tre och avsaknad av nya registreringar/workspaces. Samma förlopp fungerar även när det första kvittot är ogiltigt.

Hela `sites/tests/document-queue-recovery.test.mjs`: **38/38 gröna** efter rättningen. Senare samlad Sites-fokuskörning inkluderar samma tester.

## 4. Köer, genomströmning och kvarvarande driftorsaker

Produktionsobservationerna nedan kommer från integrationsansvarigs read-only-kontroll den 6 november. De är inte ändrade av detta delarbete.

| Observation | Vad den visar | Vad den inte visar |
| --- | --- | --- |
| 397 dokument behöver granskning | Stor kvarvarande manuell granskningsmängd | Att 397 dokument är fastnade OCR-jobb |
| 52 väntar på OCR | En separat väntande bearbetningsmängd | Att alla är omedelbart körbara eller klarar OCR |
| 396 overifierade motparter, 333 låg konfidens | Säkerhets- och osäkerhetsgränser stoppar automatisk registrering | Att mer aggressiv automatisk registrering skulle vara korrekt |
| Saknar fakturanummer 134, part 184, datum 231, organisationsnummer 292, belopp 147, moms 189 | Konkreta granskningsorsaker att sortera på | Antal separata dokument; orsakerna kan överlappa |
| Moln-OCR 10:44 UTC: `processed=6`, `failed=0`; färsk worker | Ett verkligt accepterat molnpass har körts | En uthållig timtakt, feelfria kundoriginal eller löpande Gmail-hämtning |
| Gmail senast lyckat 04:06 UTC; konfigurerat 60 minuter; stale; extern schemaverifiering saknas | Appen har inte ett färskt lyckat hämtningskvitto | Att en anslutning eller konfigurationsflagga bevisar fungerande schemakörning |
| Automationruntime 11:00 UTC: `no_update`, cirka 1 sekund, utan matchande nytt appkvitto | Den externa körningen behöver undersökas vidare | Att Gmail faktiskt hämtades; detta är inget skäl att ändra pausläge eller behörighet |

### Kapacitetsbedömning

Workflow `sites-cloud-ocr.yml` planerar fyra pass per timme, vid minuterna 7, 22, 37 och 52. Ett pass försöker högst sex OCR-dokument och först högst två text-PDF:er på servern. Den nominella gränsen blir därför **högst 24 OCR-dokument per timme**, plus högst åtta serverbehandlade text-PDF:er. Det är en kod- och schemagräns, inte en uppmätt uthållig produktionstakt.

För 52 OCR-dokument krävs minst nio framgångsrika sexjobbspass. Om samtliga jobb är körbara, inga nya dokument tillkommer, inga försök misslyckas och schemat verkligen kör varje kvart, ligger första till nionde passets start två timmar isär. Till detta kommer väntan till första passet och sista passets körtid. Det ger ett idealiserat intervall omkring två till två och en kvarts timme plus bearbetningstid. Nya dokument, lås, uppskjutna försök eller externa schemagap kan förlänga tiden. Ingen sådan tömning har utförts eller påståtts här.

Den nya statusmätningen använder 24 timmars accepterade, unika dokument med terminalt jobbtillstånd. Flera extraktionshistorikrader, dubbla Gmail-källor och ett sparat kvitto utan avslutat jobb får inte räknas som extra genomströmning. För faktisk produktionstakt krävs minst två tidsstämplade statusobservationer och körkvitton efter kontrollerad release. De gamla 397 granskningsärendena försvinner inte genom att OCR-kön körs klart.

### Retry och schemagränser

Gmail har ett ägarspecifikt femminuterslås med SQL-fence på skrivningar. Tillfälliga providerfel respekterar `Retry-After` och successivt längre väntetid; tre avbrutna/misslyckade automatiska försök stoppar fler schemalagda hämtningar. Permanenta token-, scope- eller kontoidentitetsfel kräver korrekt återanslutning. Dessa gränser ska inte kringgås för att visa en mindre kö.

OCR-jobb har avgränsade leases och högst tre försök. Endast det läsande original-GET:et får en begränsad överföringsretry; ett oklart completion-svar får inte leda till en upprepad mutation. Den nya rättningen förbättrar återvinning av ett redan sparat resultat, inte försökstaket.

`external_schedule_verified=false` ska kvarstå tills den externa schemaplattformen kan visa ett anrop som matchar appens autentiserade `gmail.automatic.invoked` och tillhörande resultathändelse. En manuell hämtning, en OCR-heartbeat eller ett lyckat kodtest räcker inte. Det exakta nästa driftsteget är att granska den redan konfigurerade automationens runtime-/verktygskvitto, fastställa varför 11:00-körningen inte nådde appentrypointen och därefter observera ett normalt auktoriserat schemapass. Detta arbete kräver åtkomst till det externa runtimeförloppet; ingen provideroperation eller inställningsändring ska simuleras.

## 5. Testprotokoll och misslyckanden

Alla tester använder isolerade ägare, databaser och syntetiska original. Fullständiga TAP-loggar, SHA-256 och exakta räknare finns i `ocr-final95-test-results.json`; källfilhashar finns i `ocr-final95-source-manifest.json`.

| Körning | Resultat | Tolkning |
| --- | --- | --- |
| Första Node/Sites-försöket utan `NODE_ENV=test` | Testharnessen avvisade start med `SAAS_TEST_ONLY`; inga tester kördes | Kommandofel öppet redovisat, inte ett produktfel eller en grön körning |
| Första faktiska Node-fokus efter konfliktlösning | 273/274; ett fel; 22,096 s | Positiv äldre OCR-fixtur saknade det nu nödvändiga originalbundna ordbeviset |
| Första faktiska Sites-fokus efter konfliktlösning | 293/294; ett fel; 35,250 s | Data-URL-testladdaren kunde inte lösa det senare OCR-bevisimportet |
| Node fixtur-/paritetsomkörning | 33/33; 0,973 s | Korrigerad syntetisk positiv fixtur och nya negativa beviskontroller |
| Sites fixtur-/paritetsomkörning | 33/33; 1,056 s | Samma kontroller i Sites |
| Ny köregression före produktfix | 0/2; två fel; 0,805 s | Båda backlogvarianterna reproducerar leaseförlusten |
| Hela queue-recovery efter produktfix | 38/38; 4,577 s | Båda nya fallen och befintliga återställningsgränser passerar |
| Slutlig Node-fokus | **336/336; 31,418 s** | Inkluderar verklig lokal OCR på etablerade syntetiska rasteroriginal |
| Slutlig Sites-fokus | **446/446; 67,034 s** | Inkluderar köåterställning, Gmail, server-/moln-OCR och operativ status |

Samtliga avslutade körningar ovan har noll cancelled/skipped/todo. Historiska omkörningar ska inte summeras till ett unikt testantal. De slutliga två fokuskörningarna är självständiga körkvitton och ersätter inte huvudrapportens fulla releasegrindar.

### Reproducerbara slutkommandon

Från repositoryroten:

```sh
NODE_ENV=test node --import ./scripts/saas-test-isolation.mjs --test --test-concurrency=1 --test-reporter=tap test/invoice-reliability.test.js test/ocr-layout*.test.js test/review-ocr-layout-boundaries.test.js test/ocr-bankgiro*.test.js test/sites-ocr-pull.test.js test/sites-ocr-transport-recovery.test.js test/cloud-ocr-trigger.test.js test/gmail.test.js
```

Från `sites/`:

```sh
NODE_ENV=test node --import ../scripts/saas-test-isolation.mjs --experimental-strip-types --test --test-concurrency=1 --test-reporter=tap tests/invoice-reliability.test.mjs tests/ocr-layout*.test.mjs tests/ocr-explicit-role-boundary-positive.test.mjs tests/ocr-parser-independent-review.test.mjs tests/ocr-bankgiro-evidence.test.mjs tests/gmail-preview-q8.test.mjs tests/document-queue-recovery.test.mjs tests/gmail.test.mjs tests/quality-regressions-ocr-recovery.test.mjs tests/cloud-ocr.test.mjs tests/gmail-operational-status-ui.test.mjs
```

De verkliga rasterkörningarna finns i `test/ocr-bankgiro-producer.test.js`: två `runDocumentProcess`-fall och ett `extractInvoice`-fall över de befintliga syntetiska PNG-fixturerna. Frysta ordobservationer i samma fil är separata återspelningar och räknas inte som nya optiska körningar. Originalens integritet, lägsta beviskrav och fortsatt mänsklig granskning kontrolleras.

## 6. Återstående krav och poängmässiga begränsningar

1. **Verklig Gmail-schemakörning:** koppla det externa runtimekvitto som saknas till en riktig, auktoriserad appinvokation och färskt resultat. Ändra inte pauser eller behörigheter för att dölja gapet.
2. **Kunddokumentens kvalitet:** granska faktiska osäkra fält och motparter genom ordinarie dokumentgranskning. De syntetiska svenska/engelska regressionerna motiverar inte automatisk registrering av de 397 gamla granskningsärendena.
3. **Optisk OCR-kvalitet:** ingen ny blind precision har mätts. Senare main har en separat dokumenterad optisk nivå under målet; den förseglade V3-mängden ska hanteras enligt projektets gällande protokoll. Tre syntetiska rasterfall ändrar inte det resultatet.
4. **Produktionsgenomströmning efter release:** ta tidsstämplad status, observera vanliga schemapass, jämför accepterade unika dokument och kvarvarande orsaker. Behåll skillnaden mellan nya OCR-resultat och säkert registrerade fakturor.
5. **Slutlig releaseverifiering:** huvudrapporten ska ange exakta fullsuite-, TypeScript-, bygg-, audit- och CI-resultat på slutlig commit samt faktisk publiceringsversion. Denna delrapport hävdar varken publicering eller fullständigt uppnått 9,5/10.

Berörda kvalitetsområden har nu starkare kod- och regressionsevidens för köåterställning, parserparitet och sanningsenlig status. Kriterierna för minskat manuellt arbete, optisk OCR och verifierat externt schema har fortfarande verkliga kvarvarande beviskrav.
