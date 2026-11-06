# PSM 6 på känd V2: sämre helhetsutfall

**Fast PSM 6 rekommenderas inte som generell ersättning på denna evidens.** Samma publicerade parserkod gav mandatory recall **63 → 52 procent**, medan kompletta normaldokument minskade från **1/10 till 0/10**. Tio normala och två stressbilder kördes exakt en gång vardera, utan körfel eller omtag. Båda parsrarna gav identiska fält och granskningsnivåer på samtliga tolv PSM 6-observationer.

Detta är förregistrerad utvecklingsdiagnostik på en känd korpus. Inga poäng ändras och V1/V2:s första underkända hållprov ersätts inte. Ingen produktkod ändrades och inget V3-material lästes.

## Bunden körning

| Del | Fryst eller observerat |
| --- | --- |
| Plancommit, före optik | `f0458cfa26dcfb7eebf7edbec0e33abd7de4f028` |
| Produktionskälla | `41aadcef5fc6f65cc73979997b195c7b4f12eec1` |
| V2-frysning | `9d9d0736d5f9f02e87ea055f328b9e44518badea` |
| Planfilens SHA256 | `64f56ec1b8e9b8441f370142e5733d10e9cc8b7b15d15e55d6b67931bf711ad6` |
| Slutresultatets SHA256 | `a8f4c44973ea42eedbac1878ef5c145fad8ae823227de6ceff6dd7364f9ab9ea` |
| Enda workerändring | `PSM.AUTO` → `PSM.SINGLE_BLOCK` |
| Optiska anrop | 12 startade, 12 färdiga, 0 omtag, 0 nya PSM 3-anrop |
| Livscykel | En bild per kall barnprocess, ny svensk Tesseract-instans, terminering efter bilden, högst en åt gången |
| Runtime | Node 24.22.1, samma svenska modell/OEM 1, oförändrade raster-/layoutparametrar |
| Faktiska raster | 12/12 stämde med förregistrerad SHA256 och storlek före `recognize` |
| Integritet efter körning | Fryst källkod, harness, runtime, korpus, facit och äldre resultat oförändrade |

Alla råsvar finns i `packet/cases/<id>/raw-response.v8` och `raw-response.json`. Dessa skrivs före layout och lämnas oförändrade. Varje fall har dessutom faktiskt `recognition-input.png`, parametrar/start-/slutkvitton, `worker-result.json`, `layout-replay.json` och filhashar. Råsvaren bevarar hela den struktur Tesseract returnerade, inklusive blocks, paragraphs, lines, words, bbox och confidence. Total optisk processtid inklusive kallstart och capture var 63,704 sekunder; detta enskilda värde är ingen produktionslatensjämförelse.

## Tre resultat får inte blandas ihop

| Observation | Parserkälla | All13 recall | Mandatory10 recall | Image9 recall |
| --- | --- | ---: | ---: | ---: |
| Ursprungligt oberoende V2-förstaprov, PSM 3 | `571073b` | 63,08 % | **60,00 %** | 55,56 % |
| Sparad PSM 3-text, känd omtolkning | Publicerad `41aadcef`; hashparitet med sparad `635ca5e`-omtolkning | 65,38 % | **63,00 %** | 58,89 % |
| Ny förregistrerad PSM 6-diagnos | Samma publicerade `41aadcef` | 48,46 % | **52,00 %** | 46,67 % |

Huvudjämförelsen är de två sista raderna. Den optiska kodgrafen är oförändrad jämfört med första PSM 3-observationen. Aktuella parsrar omtolkade den sparade PSM 3-texten och ordbevisen utan ny OCR; samtliga 24 parser-/dokumentutfall matchade det redan sparade omtolkningsresultatet fält för fält och i granskningsnivå. Den första radens äldre parserresultat bevaras separat.

## Primärmått, tio normala bilder

Resultaten nedan gäller **vardera** Node och Sites. Populationerna och nämnarna är oförändrade; riktning ingår i mandatory10 som tillförd metadata och är uttryckligen borttagen ur image9.

| Mått | PSM 3 med aktuell parser: TP / FP / FN | Precision / recall | PSM 6: TP / FP / FN | Precision / recall | Kompletta dokument, PSM 3 → 6 |
| --- | --- | --- | --- | --- | --- |
| All13, 130 fält | 85 / 0 / 45 | 100 % / 65,38 % | **63 / 1 / 67** | **98,44 % / 48,46 %** | 1/10 → 0/10 |
| Mandatory10, 100 fält | 63 / 0 / 37 | 100 % / 63,00 % | **52 / 0 / 48** | **100 % / 52,00 %** | 1/10 → 0/10 |
| Image9, 90 bildhärledda fält | 53 / 0 / 37 | 100 % / 58,89 % | **42 / 0 / 48** | **100 % / 46,67 %** | 1/10 → 0/10 |

Båda förregistrerade primärgränserna missas på recall: minst 85 procent krävs för all13 och mandatory10. Precision når minst 98 procent men väger inte upp de saknade fälten. Kritiska falskt gröna: **0**. Strikt falskt gröna enligt alla13: **0**. Antal gröna dokument: **0**. Det enda felaktiga returnerade normalvärdet var `kind=other` i normal-08, där facit är `invoice`; det var fortsatt rött. Inga felaktiga referens- eller beloppsvärden returnerades i normalpopulationen. Betalnings- och matchningsoperationer ingick inte i försöket.

## Hela normalmatrisen

Siffrorna visar antal korrekta fält, PSM 3 → PSM 6. Ingen förbättring väljs ut som ersättning för ett annat pass.

| V2-bild | All13 | Mandatory10 | Image9 | Förbättrade / försämrade fält | Granskningsnivå PSM 3 → 6 |
| --- | --- | --- | --- | --- | --- |
| normal-01 | 7 → 7 | 4 → 6 | 3 → 5 | 2 / 2 | röd → gul |
| normal-02 | 10 → 4 | 8 → 3 | 7 → 2 | 0 / 6 | gul → röd |
| normal-03 | 13 → 9 | 10 → 8 | 9 → 7 | 0 / 4 | gul → röd |
| normal-04 | 6 → 6 | 5 → 5 | 4 → 4 | 0 / 0 | gul → gul |
| normal-05 | 8 → 8 | 6 → 6 | 5 → 5 | 0 / 0 | gul → gul |
| normal-06 | 12 → 4 | 9 → 3 | 8 → 2 | 0 / 8 | gul → röd |
| normal-07 | 6 → 6 | 5 → 5 | 4 → 4 | 0 / 0 | röd → röd |
| normal-08 | 6 → 5 | 4 → 4 | 3 → 3 | 0 / 1 | röd → röd |
| normal-09 | 9 → 7 | 6 → 6 | 5 → 5 | 1 / 3 | röd → gul |
| normal-10 | 8 → 7 | 6 → 6 | 5 → 5 | 2 / 3 | röd → gul |

Över hela normalpopulationens 130 fält förbättrades **5**, försämrades **27** och var **98** oförändrade. För mandatory10 var motsvarande **5 förbättrade, 16 försämrade och 79 oförändrade**. Den fulla unionen med båda passens faktiska värden finns i `packet/result.json:fieldComparison`.

| Fält | Korrekta PSM 3 → 6, av 10 | PSM 6 FP / FN |
| --- | --- | --- |
| Fakturanummer | 9 → 8 | 0 / 2 |
| Motpart | 2 → 0 | 0 / 10 |
| Organisationsnummer | 6 → 2 | 0 / 8 |
| Fakturadatum | 9 → 7 | 0 / 3 |
| Förfallodatum | 8 → 6 | 0 / 4 |
| Totalbelopp | 6 → 6 | 0 / 4 |
| Nettobelopp | 5 → 6 | 0 / 4 |
| Momsbelopp | 2 → 1 | 0 / 9 |
| Referens | 6 → 2 | 0 / 8 |
| Bankgiro | 6 → 0 | 0 / 10 |
| Riktning, tillförd metadata | 10 → 10 | 0 / 0 |
| Dokumenttyp | 10 → 9 | 1 / 1 |
| Valuta | 6 → 6 | 0 / 4 |

## Procenttecken, rader och kolumner

Den frysta renderinventeringen innehåller **åtta procentmarkörer** i normalpopulationen. Sparad PSM 3-workertext innehåller **0** procenttecken. Både PSM 6-råtext och dess workertext innehåller också **0**. Hypotesen att detta fasta läge skulle återge procenttecknen bättre fick därmed inget stöd i detta försök. På normal-01 blev momstexten exempelvis `Moms 25 90`; andra observerade felläsningar kvarstår. Detta mått är en beskrivande teckenräkning, inte en full positions-/symbolprecision.

Det finns några återfunna belopp: normal-01 får netto och totalbelopp, normal-09 totalbelopp och normal-10 netto och totalbelopp. Samtidigt ökar sammanblandningen av kolumner. På normal-01 och normal-09 blir Bankgiro och OCR en gemensam rubrikrad följd av två värden; den oförändrade parsern avstår. Normal-02 lägger tre datum-/identitetsrubriker på en rad och deras värden på nästa och tappar sex tidigare korrekta fält. Normal-06 blandar betalningsdelen och summeringskolumnen i råtexten, med åtta förlorade fält. Normal-08 tappar den fristående fakturarubriken och klassificeras som `other`.

Dessa samband kommer från sparad text, faktiska PSM 6-koordinater och fältutfall. De är inte ett påstående om att OCR:n blivit generellt bättre eller sämre på alla möjliga dokument. Full gammal PSM 3-geometri saknas för tio fall; de två andra fallens bevarade PSM 3-geometri kommer från en separat tidigare diagnostik, inte från det oberoende förstaprovet. En komplett tvålägesjämförelse av bbox kan därför inte göras på hela korpusen. Råpaketet möjliggör fortsatt koddiagnos utan nya optiska anrop.

## Stress, separat från normalpopulationen

Båda stressfallen förblev **röda** i båda lägena och parsrarna. Inget stressfält ändrade värde mellan de två körningarna. Ingen grön dokumentstatus eller ekonomisk tillåtelse gavs.

| Stresspopulation, två bilder | TP / FP / FN, PSM 3 och PSM 6 | Precision / recall | Kompletta |
| --- | --- | --- | --- |
| All13 | 9 / 0 / 17 | 100 % / 34,62 % | 0/2 |
| Mandatory10 | 7 / 0 / 13 | 100 % / 35,00 % | 0/2 |
| Image9 | 5 / 0 / 13 | 100 % / 27,78 % | 0/2 |

Lost-bottom-fallet hade 6/13, 5/10 och 4/9 korrekta fält; defocused-photo hade 3/13, 2/10 och 1/9. Facitet behåller de okorrumperade källvärdena, så säkert avstående sänker stressrecall som avsett.

## Verifiering och beslut

Förkontrollen verifierade samma optiska kodgraf, samma publicerade parsergraf som den sparade omtolkningen, exakta tolv bild-/rasterhashar och 24 sparade parserutfall. Efter körning verifierades alla frysta käll-/runtime-/korpus-/harnesshashar igen. En separat beräkning från de lagrade fälten kontrollerade **24 kombinationer av läge, parser, population och fältomfattning** mot primärresultatet och verifierade Node/Sites-paritet på tolv fall; se `analysis.json`. Detta är aritmetikkontroller, inte nya optiska prov eller en full produktionssvit.

Behåll PSM 3 som generell inställning på detta underlag. De fem återfunna fälten är användbar utvecklingsevidens, men de 27 försämringarna och uteblivna procenttecknen ger inget stöd för att ersätta standardläget med fast PSM 6. Ett eventuellt senare beslut som använder flera sparade observationer behöver en uttrycklig konfliktsregel; detta experiment väljer inte högsta recall eller bästa fält per dokument. Ingen ny OCR-körning ingår i nästa analys av det sparade paketet.
