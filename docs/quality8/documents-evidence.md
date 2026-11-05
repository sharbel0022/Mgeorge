# Dokumenttolkning: verifierad förbättring och kvarstående gap

2026-11-05. Bas: `4ad205b84d1852ec7ed33cabd70fdadbe2f9d5c5`. Denna leverans tilldelar inget nytt kvalitetsbetyg. Alla underlag är syntetiska.

## Ändringen

Den tidigare parsern tappade uttryckliga belopp märkta exempelvis **Summa inklusive moms**, **Summa exklusive moms**, **Summa inkl. moms** och **Totalt exklusive moms**. En giltig, tidigare känd etikett kunde dessutom dölja en motsägande eller oläslig summa med en sådan etikett. Fyra textfall blev felaktigt gröna före ändringen.

Node och Sites använder nu samma snäva grammatik för `summa`, `totalt` och `belopp` som uttryckligen kvalificeras med `inklusive/inkl./inkl` eller `exklusive/exkl./exkl` moms. Samma etiketter avgränsar intilliggande fält och avslutar artikelrader. Belopp måste fortfarande finnas tryckta, vara fullständigt giltiga och stämma med övriga belopp. En allmän `Summa` eller `Delsumma` räcker inte som totalbelopp.

Den faktiska OCR-körningen på det nya underlaget visade också tomma styckerader mellan etikett och belopp. Parsern kan nu passera sådana tomrader. Sidgränser behålls i scalartexten, så ett saknat värde inte hämtas från nästa sida. Råtext och evidens behålls. OCR:s konfidensspärr och kraven för automatisk registrering är oförändrade.

Ändrade produktionsfiler: `src/invoice-extraction.js`, `src/invoice-details.js`, `sites/lib/invoice-fields.js` och `sites/lib/invoice-details.js`. Ingen ändring gjordes i OCR-modell, rasterförbehandling, Gmail, bank, betalningar eller beroenden.

## Population och mätning

Det gamla underlaget är helt oförändrat: 40 textfall, 3 native-PDF:er, 2 läsbara rasterbilder, 1 blank rasterbild, 1 avsiktligt förstörd rasterbild samt 2 scanned-PDF:er.

Det separata nya underlaget frystes före produktionsändringarna: **14 textfall och 14 optiska dokument**. De optiska fallen består av 6 läsbara normalraster med andra fakturanummer och belopp än utvecklingsexemplen, 2 native-PDF:er, 2 scanned-PDF:er, 2 läsbara säkerhetsraster och 2 oläsbara stressfall. Det varierar svenska etiketter, beloppsformat, radbrytning, typsnitt och PNG/JPEG/PDF.

Det nya underlaget skapades efter den första textdiagnosen. Resultatet från dess frysta optiska fall användes för att hitta tomradsfelet. Det är därför ett separat och reproducerbart valideringsunderlag för utveckling, **inte ett statistiskt orört blindtest eller ett representativt stickprov av produktion**. Facit, bildbyte och population ändrades inte mellan före- och eftermätningarna.

Precision är `TP / (TP + FP)` och recall är `TP / (TP + FN)`. Ett felaktigt returnerat värde räknas både som FP och FN; ett korrekt avstående från ett annoterat null-värde höjer inte precision/recall. Dokumentet är exakt endast om samtliga granskade fält är rätt, inklusive avståenden. Ett grönt resultat är falskt grönt om något granskat fält är fel, något saknas, facit kräver granskning eller bearbetning misslyckades.

Samtliga 13 scalarfält granskas. Det gamla textunderlaget behåller även sina tidigare annoterade detaljfält. Tabellerna gäller båda parsermotorerna, som gav samma fält och beslut. Sites kör sin riktiga parser på Node-arbetarens faktiska OCR/PDF-text; detta är **inte** en end-to-end-mätning av Sites webbläsare eller moln-OCR.

## Gammalt fryst underlag: före och efter

| Population | Antal | Precision före → efter | Recall före → efter | Exakta dokument före → efter | Falskt gröna efter |
|---|---:|---:|---:|---:|---:|
| Text, inklusive tidigare granskade detaljfält | 40 | 100 → 100 % | 100 → 100 % | 40 → 40 | 0 |
| Native PDF | 3 | 100 → 100 % | 100 → 100 % | 3 → 3 | 0 |
| **Alla raster, inklusive stressfallen** | **4** | **96,67 → 96,67 %** | **70,73 → 70,73 %** | **3 → 3** | **0** |
| Läsbara raster | 2 | 100 → 100 % | 100 → 100 % | 2 → 2 | 0 |
| Oläsbara raster: blank + förstörd | 2 | 75 → 75 % | 20 → 20 % | 1 → 1 | 0 |
| Scanned PDF | 2 | 100 → 100 % | 100 → 100 % | 2 → 2 | 0 |

Hela gamla rasterpopulationen ger fortsatt **TP 29, FP 1, FN 12**. Samtliga missar ligger i bilden som först reducerats till 25 × 25 pixlar. Dess OCR gav fem tecken. Den behåller hela sitt kända källfacit och ligger kvar i totalen. Detta är en avståendekontroll: att gissa de ursprungliga beloppen eller identiteterna skulle vara fel. FP avser dokumenttypen `other` i stället för `invoice`. Inga ekonomiska värden återfanns i den förstörda bilden; de korrekta stressfält som räknas kommer från riktningens metadata och den blanka bildens dokumenttyp.

## Nytt fryst variantunderlag: före och efter

| Population | Antal | Precision före → efter | Recall före → efter | Exakta dokument före → efter | Falskt gröna före → efter |
|---|---:|---:|---:|---:|---:|
| Text, normal- och säkerhetsfall | 14 | 97,65 → 100 % | 94,86 → 100 % | 4 → 14 | **4 → 0** |
| Native PDF | 2 | 100 → 100 % | 84,62 → 100 % | 0 → 2 | 0 → 0 |
| **Alla raster, inklusive säkerhet och stress** | **10** | **93,07 → 95,28 %** | **80,34 → 86,32 %** | **1 → 5** | **0 → 0** |
| Läsbara normalraster | 6 | 97,18 → 97,44 % | 88,46 → 97,44 % | 0 → 4 | 0 → 0 |
| Läsbara säkerhetsraster | 2 | 84,62 → 91,67 % | 91,67 → 91,67 % | 0 → 0 | 0 → 0 |
| Oläsbara raster: blank + förstörd | 2 | 75 → 75 % | 20 → 20 % | 1 → 1 | 0 → 0 |
| Scanned PDF | 2 | 100 → 100 % | 88,46 → 100 % | 0 → 2 | 0 → 0 |

Nya raster totalt förbättras från **TP 94 / FP 7 / FN 23** till **TP 101 / FP 5 / FN 16**. De två native-PDF:erna går från manuell kontroll till korrekta gröna parserresultat. De sju normala textfallen blir korrekta gröna resultat; samtliga sju säkerhetsfall hålls. **Alla OCR-resultat kräver fortsatt manuell kontroll.** Det har alltså inte demonstrerats någon ökad automatisk registrering av OCR-underlag.

För parserns tio obligatoriska registreringsfält förbättras nya raster från 97,33 % precision / 82,02 % recall till **100 % / 89,89 %** (TP 80, FP 0, FN 9). Dessa fält är fakturanummer, motpart, organisationsnummer, fakturadatum, förfallodatum, total, netto, moms, riktning och valuta. Detta kompletterande mått utesluter bankgiro, betalningsreferens och dokumenttyp och ersätter därför inte måttet över samtliga fält.

## Kvarstående gap

**98 % fältprecision för raster är inte uppnått.** I fyra läsbara raster läser OCR `Bankgiro: 123-4567` som `Bankgiro: 1223-4567`. Två är normalfall och två är säkerhetsfall. Råtexten och det felaktiga förslaget med kontrollvarning bevaras; värdet korrigeras inte utifrån facit och inget av dokumenten blir grönt. Ett representativt original i denna grupp har även inspekterats visuellt för att bekräfta att trycket faktiskt säger `123-4567`.

Det nya förstörda 24 × 24-pixelprovet ger ytterligare 1 FP (dokumenttyp) och 12 FN med oförändrat facit. Normalraster når 97,44 % fältprecision, alla raster 95,28 %. Båda ligger under 98 %. Underlaget är för litet och för fokuserat på denna etikettfamilj för ett generellt OCR-löfte. Nästa belägg behöver omfatta fler oberoende originalformat och säkrare osäkerhetshantering för felavlästa betalningsidentiteter, samt verklig Sites/moln-OCR-verifiering. Denna leverans är inte ensam tillräcklig för ett högre generellt OCR-betyg.

## Regressioner och tidsmätning

- Etikettfallen kördes röda före fix: **6/26 passerade, 20/26 föll** för Node/Sites. Efter första fixen passerade 26/26.
- Tomradsregressionen föll i båda motorerna. Ett separat sidgränstest fångade sedan att scalartexten hade tappat form feed; det rättades innan slutmätning.
- Slutliga nya regressioner: **32/32 passerade**. De verifierar fullständiga fält, konflikter, otillåtna generella summor, ej härledda belopp, OCR-spärr, tomrader, sidgränser och artikelrader. Node- och Sites-testfilerna delar samma fall och Node-testet kräver inte Sites TypeScript-laddare.
- Riktade befintliga och nya regressioner: **827/827 passerade**, 0 hoppade, på **239,96 s**. Efter uppdelning av de nya testfilerna kördes dessa 32 fall igen: **32/32**, 1,34 s. Root ansvarar för de fulla integrerade CI-grindarna.

| Node-medeltid per dokument | Före | Efter |
|---|---:|---:|
| Gammal text, fem upprepningar efter uppvärmning | 0,424 ms | 0,553 ms |
| Gammal native PDF | 661 ms | 793 ms |
| Gammal raster | 2 328 ms | 2 746 ms |
| Gammal scanned PDF | 3 219 ms | 3 422 ms |
| Ny text, fem upprepningar efter uppvärmning | 0,431 ms | 0,479 ms |
| Ny native PDF | 691 ms | 663 ms |
| Ny raster | 3 220 ms | 3 395 ms |
| Ny scanned PDF | 3 417 ms | 3 276 ms |

Optiska tider omfattar en ny Node-arbetare per dokument, PDF-rendering/lokal Tesseract och parsning. Inga OCR-arbetarändringar gjordes. Tiderna är enstaka körningar på en delad maskin och varierar med belastning; tabellen visar observationerna och bevisar ingen generell prestandaförbättring eller garanti. Båda motorernas exakta tider, körmiljö och fel finns i `documents-measurements.json`.

## Spårbarhet och upprepning

Alla fyra mätningar har `sourceStable: true`. Korpus- och bytehashar är lika före/efter. Den ursprungliga mätarens gradering är oförändrad; ett explicit `--label-corpus` väljer den nya populationen. Den nya populationens före/efter använder dessutom identisk runner-hash.

- Före: source SHA-256 `69f4c6c0f65e79014d2801ff45bb94879069f94ce6ee8ab16dfcfa5d506bc88f`.
- Efter: source SHA-256 `10edeb7b4f0db528c6c03945cf7254b2ebd5afa9df8488115f82ed66f7c66dd8`.
- Gammalt korpus: `c1a28614d0812fa0687bbd2ce0ed00c800ce99d38297757077bd8d74a1a616f9`.
- Nytt korpus: `f8e895f7057ca4d6a6a1a70299c711785858f8fefebf4e3ebb32e89681c598f6`.

`documents-measurements.json` innehåller populationernas exakta counts, båda motorerna, obligatoriska fält separat, alla kvarstående fältfel, källfilshashar, byte-manifest och körmiljö. De mätta efterkällorna var ännu inte committade under körningen; källfilshasharna identifierar den kod som därefter committas med denna rapport.

Kör från vald checkout med den angivna stabila Node 24-binären:

```bash
NODE_ENV=test /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --import ./scripts/saas-test-isolation.mjs scripts/measure-ocr-quality.mjs --source-root . --output /tmp/documents-frozen.json --text-repeats 5
NODE_ENV=test /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --import ./scripts/saas-test-isolation.mjs scripts/measure-ocr-quality.mjs --source-root . --label-corpus --output /tmp/documents-labels.json --text-repeats 5
NODE_ENV=test /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --import ./scripts/saas-test-isolation.mjs --test test/invoice-summary-labels.test.js sites/tests/invoice-summary-labels.test.mjs
```

För en förejämförelse används den nya mätaren och dess frysta korpus men `--source-root` pekar på en checkout av basen ovan med samma installerade beroenden. Fullt fokuserat regressionsurval:

```bash
NODE_ENV=test /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --import ./scripts/saas-test-isolation.mjs --test-concurrency=1 --test test/invoice-summary-labels.test.js test/invoice-evidence-ocr.test.js test/invoice-reference-policy.test.js test/invoice-parser-corpus-q8.test.js test/invoice-extraction.test.js test/ocr-quality-metrics.test.js sites/tests/invoice-summary-labels.test.mjs sites/tests/invoice-evidence-ocr.test.mjs sites/tests/invoice-reference-policy.test.mjs sites/tests/invoice-parser-corpus-q8.test.mjs
```
