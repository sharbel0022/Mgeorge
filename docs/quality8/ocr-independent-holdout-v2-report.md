# Oberoende OCR-hållprov V2 — första frysta mätningen

## Beslut

**UNDERKÄNT på exakt produktionscommit `571073b8172ab53899a4ce3c2b717c7fe24daee2`.** Både Node- och Sites-parsern klarar den förregistrerade precisionsgränsen i detta urval men missar recallkravet. Alla 13 fält ger **100 % precision och 63,08 % recall**; de 10 obligatoriska ger **100 % precision och 60 % recall**. Inget av de tio normaldokumenten är komplett i något av de tre redovisade fälturvalen.

Den enda första körningen slutfördes med **12 av 12 förutbestämda raster, 24 parserutvärderingar och noll bearbetningsfel**. Kritiska och strikt definierade falskt gröna utfall är båda **0** för vardera parsern. Båda stressbilderna ger rött granskningsläge. Detta bevarar säkerhetskravet men uppfyller inte kravet på användbar extraktionsgrad.

Ingen implementation, bild, facitpost, tröskel eller förregistrerad mätkod ändrades efter observationen. Ingen omkörning gjordes. V1:s tidigare underkända resultat ligger kvar som en separat mätning och ersätts inte av V2.

## Frysning, källbinding och faktisk ordning

| Artefakt eller steg | Exakt värde |
| --- | --- |
| Korpus, bokstavligt facit och harness frysta | `9d9d0736d5f9f02e87ea055f328b9e44518badea` |
| Levererad produktionscommit | `571073b8172ab53899a4ce3c2b717c7fe24daee2` |
| Produktionsträd | `d4e4c7f46d9139eca1284f8410d2dc36e669fd76` |
| Källbinding committad före OCR | `24401aa9f28f2417498023a51919a68be4e84927` |
| Bindingens committid, UTC | 2026-11-05 22:02:52 |
| Resultat startat, UTC | 2026-11-05T22:03:11.204Z |
| Första optiska anropet, UTC | 2026-11-05T22:03:11.363Z |
| Körning färdig, UTC | 2026-11-05T22:04:21.163Z |
| Full runtime-inventering | 188 filer: alla spårade `src/` och `sites/lib/`, plus båda projektens paket-/låsmanifest |
| Optisk importgraf | 28 lokala filer; exakta sökvägar och SHA-256 finns i binding och råresultat |
| Källinventeringens SHA-256 | `08407f895bca7925b5efae42f3d42907e6d09d6dffbc1a071e757440731a2ed4` |
| Korpusmanifestets SHA-256 | `b29aabbeaa210434ca69688294bc88d1b6136c83380cdeb70580ed824a08a08d` |
| Datasetets SHA-256 | `b7cbaf1d830c2010a530b91bd2c04d8769ea6202b5009ac2d56fbf9baeba3d7b` |
| Facitets SHA-256 | `943a3f9039726d50817de5ad5e913c85aa5210f52e70db487be18e4bb5840af0` |
| Förregistrerad harness SHA-256 | `d107b46a069ae3db83d5963037ac3f7f449084a29ebf78db8bc941c4335d9522` |
| Råresultatets SHA-256 | `13557c3012331fa0101fbe3e6fe498fd2fbf3346b8740cfe5fe4b83e8393b6e7` |

Produktionsträdet exporterades direkt med `git archive` till `/tmp/mgeorge-ocr-v2-571073b-9LJOQ4`. Alla inventerade bytes kontrollerades mot den angivna gitcommitten före binding. Arkivets endast tillagda runtime-länkar pekade på befintliga lokala beroenden; delade beroendekataloger ändrades inte. Mätaren krävde att den exakta bindingfilen fanns i aktuell harness-commit innan det första produktanropet fick ske.

Käll-, korpus- och runtimekontrollerna efter körningen är alla `true`. Fryscommitten innehåller det granskade bildmaterialet och separat bokstavligt facit. Ingen OCR, råtextextraktion eller applikationsparser kördes på dessa bilder före korpusfrysningen eller före den separata källbindingen. Detta var ett enda programanrop till mätaren och ett sekventiellt `runDocumentProcess`-anrop per bild, med högst en aktiv OCR-worker. Varje Tesseract-worker avslutades innan produktens child-process skickade sitt resultat och nästa bild påbörjades. Checkpoint sparades efter varje bild; körningen avbröts inte.

### Kommando som faktiskt kördes en gång

```sh
/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
  scripts/quality8/measure-ocr-holdout-v2.mjs \
  --source-root /tmp/mgeorge-ocr-v2-571073b-9LJOQ4 \
  --binding docs/quality8/ocr-independent-holdout-v2-source-binding.json \
  --output docs/quality8/ocr-independent-holdout-v2-result.json
```

Kommandot avslutades med exitkod 0 eftersom mätningen genomfördes korrekt. Det sakliga acceptansresultatet är uttryckligen `passed: false`; exitkoden betyder inte att kvalitetsgrinden är godkänd.

## Population och mått

De tio normalbilderna är nya, mänskligt läsbara svenska SEK-leverantörsfakturor med 25 % moms, fem vanliga typsnittsfamiljer och tio varierade arrangemang. De innehåller inlinefält, värden under etiketter, tvåkolumnsblock och naturliga rad-, moms- och betalningsavsnitt. Normal text är 28–36 px på 1600 × 2000 px. Samtliga tolv fullstora bilder och tre kontaktkartor granskades visuellt innan frysningen. Bild- och facitvärden skiljer sig från V1. Stressfallen är separat märkta: en ofullständig skanning och en lågupplöst, defokuserad, lätt roterad bild. Deras facit behåller de fullständiga ursprungsuppgifterna.

Precision är `TP/(TP+FP)` och recall är `TP/(TP+FN)`. Ett felaktigt returnerat värde räknas som både FP och FN. Saknat känt värde räknas som FN. Strängar och hela heltalsören jämförs exakt av den oförändrade metrikhjälparen. Alla normala facitfält är ifyllda; ingen tom facitpost förbättrar precisionen. För vardera parsern krävs minst 98 % precision och minst 85 % recall separat för alla 13 och de obligatoriska 10, noll bearbetningsfel, noll kritiskt falskt grönt samt att båda stressfallen avstår från grönt.

**Riktning (`supplier`, `direction_confident=true`) tillförs som kontext.** Den mäts därför också bort separat i bildurvalet med nio obligatoriska fält. Ingen slutsats om visuell riktningsigenkänning dras från de tio korrekta riktningsvärdena.

## Normalpopulation: frysta huvudmått

| Parser | Urval | TP | FP | FN | Precision | Recall | Exakta dokument |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Node | Alla 13 | 82 | 0 | 48 | 100,00 % | 63,08 % | 0/10 |
| Node | Obligatoriska 10 | 60 | 0 | 40 | 100,00 % | 60,00 % | 0/10 |
| Node | Bildhärledda 9 | 50 | 0 | 40 | 100,00 % | 55,56 % | 0/10 |
| Sites | Alla 13 | 82 | 0 | 48 | 100,00 % | 63,08 % | 0/10 |
| Sites | Obligatoriska 10 | 60 | 0 | 40 | 100,00 % | 60,00 % | 0/10 |
| Sites | Bildhärledda 9 | 50 | 0 | 40 | 100,00 % | 55,56 % | 0/10 |

Node och Sites ger identiska fältvärden, nivåer och issues för samtliga tolv bilder. De delar samma optiska text; det finns tio oberoende normalbilder, inte tjugo. Deras resultat har inte medelvärdesbildats. Båda motorernas separata acceptansobjekt är underkända på recall för både 13 och 10 fält.

Alla 48 fel i det fulla normalurvalet är uteblivna värden. **100 % precision avser de 82 returnerade värdena, inte fullständig avläsning av de 130 förväntade värdena.** För det obligatoriska bildurvalet saknas 40 av 90 värden.

### Fältnivå — samma för båda parsrarna

| Fält | Nyckel | Korrekt | Felaktigt returnerat | Saknat |
| --- | --- | ---: | ---: | ---: |
| Fakturanummer | `invoice_number` | 9/10 | 0 | 1 |
| Leverantör | `party` | 0/10 | 0 | 10 |
| Organisationsnummer | `organization_number` | 6/10 | 0 | 4 |
| Fakturadatum | `issued_at` | 9/10 | 0 | 1 |
| Förfallodatum | `due_at` | 8/10 | 0 | 2 |
| Totalbelopp | `total_cents` | 5/10 | 0 | 5 |
| Momsbelopp | `vat_cents` | 1/10 | 0 | 9 |
| Nettobelopp | `net_cents` | 5/10 | 0 | 5 |
| Betalningsreferens | `reference` | 6/10 | 0 | 4 |
| Bankgiro | `bankgiro` | 6/10 | 0 | 4 |
| Riktning (tillförd metadata) | `direction` | 10/10 | 0 | 0 |
| Dokumenttyp | `kind` | 10/10 | 0 | 0 |
| Valuta | `currency` | 7/10 | 0 | 3 |

Leverantör saknas i alla tio normalresultat. Momsbelopp saknas i nio, netto och totalbelopp i fem vardera. Dessa bortfall räcker för att underkänna grinden även utan något felaktigt returnerat värde.

### Dokumentnivå — samma för båda parsrarna

Tabellen räknar korrekta värden, inte gröna ekonomiska beslut. Alla normalfall har `requireReview: true` enligt den förregistrerade OCR-policyn.

| Fall | Layout | Alla 13 | Obligatoriska 10 | Bildhärledda 9 | Nivå | Saknade fält |
| --- | --- | ---: | ---: | ---: | --- | --- |
| normal-01 | split-header-totals-right | 7/13 | 4/10 | 3/9 | red | `currency`, `due_at`, `net_cents`, `party`, `total_cents`, `vat_cents` |
| normal-02 | formal-compact | 10/13 | 8/10 | 7/9 | yellow | `party`, `reference`, `vat_cents` |
| normal-03 | right-address | 11/13 | 8/10 | 7/9 | yellow | `party`, `vat_cents` |
| normal-04 | upper-payment-panel | 6/13 | 5/10 | 4/9 | red | `bankgiro`, `net_cents`, `organization_number`, `party`, `reference`, `total_cents`, `vat_cents` |
| normal-05 | ledger-form | 8/13 | 6/10 | 5/9 | yellow | `bankgiro`, `currency`, `organization_number`, `party`, `vat_cents` |
| normal-06 | stacked-summary | 12/13 | 9/10 | 8/9 | yellow | `party` |
| normal-07 | horizontal-summary | 6/13 | 5/10 | 4/9 | red | `bankgiro`, `net_cents`, `organization_number`, `party`, `reference`, `total_cents`, `vat_cents` |
| normal-08 | side-rail | 6/13 | 4/10 | 3/9 | red | `bankgiro`, `due_at`, `invoice_number`, `issued_at`, `organization_number`, `party`, `vat_cents` |
| normal-09 | classic-footer | 9/13 | 6/10 | 5/9 | red | `net_cents`, `party`, `total_cents`, `vat_cents` |
| normal-10 | paired-sections | 7/13 | 5/10 | 4/9 | red | `currency`, `net_cents`, `party`, `reference`, `total_cents`, `vat_cents` |

Normalfallen ger sex röda och fyra gula resultat per parser. Ingen av de tio fakturorna når fullständighet i 13-, 10- eller 9-fältsurvalet. Normal-06 ligger närmast med 12/13; det saknade leverantörsfältet kvarstår även där.

## Stress och falskt grönt

| Stressfall | TP av 13 | FP | FN | Nivå, båda parsrar | Faktisk OCR-konfidens |
| --- | ---: | ---: | ---: | --- | ---: |
| stress-lost-bottom | 6 | 0 | 7 | red | 93 |
| stress-defocused-photo | 3 | 0 | 10 | red | 34 |

Vardera parsern ger i den separata stresspopulationen TP 9, FP 0 och FN 17: precision 100 %, recall 34,62 %, 0/2 exakta dokument och 0/2 gröna. Ingen bearbetningskrasch inträffade. Ofullständig skanning behöll hög OCR-konfidens, men dokumentet fick ändå rött granskningsläge eftersom centrala fält saknades. Det illustrerar varför teckenkonfidens ensam inte räcker för fullständighet.

Strikt falskt grönt är **0/12** per parser och kritiskt falskt grönt är **0/12**. Samtliga 12 utvärderingar per parser kräver granskning; grönt är **0/12**. Stresskravet på 2/2 säkra avståenden är uppfyllt. Frånvaron av falskt grönt höjer inte den underkända extraktionsgraden och bevisar inte fungerande automatisk ekonomisk registrering.

## Observationer i bevarad råtext

Råresultatet behåller varje originalbilds hash, exakt observerad OCR-text, textens hash, verklig konfidens, hashbundet ordevidens, parserns fältevidens, issues och tider. Följande är observerade symptom, inte en separat kausal buggutredning eller ändrade testförutsättningar:

- Leverantörernas namn finns i den observerade texten för alla tio normalbilder, men ingen parser returnerar `party`. Exempelvis finns namnet i normal-06 samtidigt som de övriga tolv fälten är korrekta. Vissa andra namn står vid `Leverantör` utan kolon eller i rader som även innehåller mottagarkolumnen.
- I normal-01, normal-09 och normal-10 hamnar flera beloppsvärden i en senare textsektion, skilda från sina summeringsetiketter. Råtexten visar därmed en läsordnings-/associationsgräns även när själva siffrorna är synliga.
- Flera procenttecken blir teckenföljder som `25 90`, `25 960` eller `25 Yo`. Normal-03 innehåller däremot den läsbara raden `Summa moms 1 468,00` men returnerar ändå inget momsbelopp. Momsbortfallet kan därför inte förklaras som enbart samma optiska teckenfel i alla fall.
- Under-etikett-värden och närliggande kolumner syns sammanflätade i några råtexter. Säker avvisning sker, men den förregistrerade normalpopulationens täckningskrav uppnås inte.

Ingen sådan observation användes för att rensa OCR-text, korrigera facit, fylla i nullvärden, öka konfidens eller köra om ett fall. Denna V2 är nu observerad. Senare ändringar kan mätas som öppet namngivna regressioner på V2; de kan inte beskrivas som ett nytt första blint prov på samma korpus.

## Runtime och uppmätt tid

| Del | Värde |
| --- | --- |
| Node | `v24.22.1` |
| `tesseract.js` | `6.0.1` |
| `tesseract.js-core` | `6.1.2` |
| `@tesseract.js-data/swe` | `1.0.0` |
| `@napi-rs/canvas` | `0.1.80` |
| `pdfjs-dist` | `5.4.149` |
| Svensk träningsdata SHA-256 | `8432cbbf8c916ab80e21c00379591e696b7dfee5183242f8a137cad93ec4803b` |
| Total optisk behandling, 12 bilder | 69,34 s |
| Total optisk behandling, 10 normalbilder | 58,12 s |
| Median per bild, alla 12 | 5,69 s |
| Min–max per bild, alla 12 | 4,57–6,64 s |
| Hela mätningens väggtid | 69,96 s |
| Samlad Node-parserstid, 12 utvärderingar | 126,22 ms |
| Samlad Sites-parserstid, 12 utvärderingar | 35,56 ms |

Varje bild använde en ny kall child-worker och lokalt installerade svenska språkdata. Inga beroenden eller modeller laddades ned. Den optiska tiden delas av de två parserresultaten och får inte räknas två gånger som faktisk väggtid. Värdena kommer från en enstaka körning på en delad värd och ger ingen produktionslatensgaranti. Alla per-bildtider, CPU-/runtimeuppgifter och belastning före/efter finns i råresultatet.

## Verifiering och begränsningar

Efter körningen kontrollerades resultatet läsande: exakt 12 unika bild-ID:n, 24 parserrader, identiska fält/nivåer/issues mellan motorerna, korrekta TP/FP/FN-nämnare samt slutliga käll-, korpus- och runtimehashar. Den kontrollen läste endast sparad JSON och startade ingen OCR eller parser. Den sparade första resultatsfilen ändrades inte vid rapportskrivningen.

Detta är tio avsiktligt varierade syntetiska normalfakturor och två stressbilder, inte ett representativt kundurval. Mätningen bevisar inte 98 % populationsprecision med statistisk säkerhet. Den täcker enkelsidiga tryckta svenska leverantörsfakturor, SEK och 25 % moms; inte handskrift, godtyckliga flersidiga dokument, andra språk eller valutor. Rad-/detaljtabellerna finns i bilderna för naturlig layout men det frysta huvudfacit omfattar de 13 namngivna skalärfälten.

Sites-parsern läser samma faktiska Node-workers OCR-resultat som Node-parsern. Detta är inte ett självständigt prov av browser-Tesseract, molntransport, uppladdning, registrering eller betalningsgodkännande. De bredare domän-, presentations- och importhasharna dokumenterar källproveniens; de innebär inte att dessa tjänster funktionstestades av denna mätning. Ingen verklig bank, Gmail, kunddata, produktionsregistrering, ekonomisk fördelning eller betald OCR-tjänst användes.

Kvalitetsgrinden för OCR är fortsatt underkänd på denna leverans. V1 och V2 behålls som separata, negativa förstamätningar. Rapporten sätter ingen kvalitetsrating och gör inget påstående om bankbekräftad produktionsfunktion.

## Bevarade artefakter

- `docs/quality8/ocr-independent-holdout-v2-source-binding.json`: committad binding före första anropet, med hela källinventeringen och runtimehashar.
- `docs/quality8/ocr-independent-holdout-v2-result.json`: oförändrat första råresultat, alla observationer, fältvärden, fel, tider och separata motorgrindar.
- `test/fixtures/quality8/ocr-holdout-v2/manifest.json`: ursprunglig förregistrering, bildinventering, corpus-/facit-/harnesshashar och V1-proveniens.
- `test/fixtures/quality8/ocr-holdout-v2/gold.json`: separat bokstavligt facit, bevarat från korpusfrysningen.
- `test/fixtures/quality8/ocr-holdout-v2/visual-qa.json`: visuell kontroll före frysning och före optiska observationer.
