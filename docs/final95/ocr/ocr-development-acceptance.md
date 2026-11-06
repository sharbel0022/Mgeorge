# OCR: aktuell utvecklingsmätning och säker parserrättning

2026-11-06. Bas: `2982b6c51cf2891d97b816ea1ce6c82e5f4c71a1`. Alla produktändringar och mätfiler i detta delarbete skapades i en separat scratchkopia medan releasekällan var fryst. Ingen produktion, provideråtkomst eller V3-data användes.

## Leverans

Två verkliga parserfel är rättade i både Node och Sites:

1. Ett komplett explicit ISO-valutavärde med en enda avslutande meningspunkt, exempelvis `Valuta: SEK.`, accepteras. Prefix följt av okänd text, extra punkt, annat nummer, ogiltigt värde eller konfliktande valuta hålls fortsatt.
2. En sluten betalningsinstruktion som `Ange OCR vid betalning.` skiljs från en värdebärande OCR-etikett. Instruktionen får varken ogiltigförklara en separat korrekt referens eller själv skapa ett referensvärde. Ofullständiga instruktioner, kolon/värden i instruktionen samt verkliga skadade eller konfliktande OCR-fält finns kvar i hela censusen. Fältparsern och referensens källevidens delar samma regel. Spannskanningen är linjär.

Originaltexten bevaras. Inga belopp eller referenser räknas fram. OCR:s manuella granskningstak, partsägarskap och Bankgiroordens konfidenströskel är oförändrade.

Patchen är `final95-ocr-census.patch`, SHA-256 `1c322036458a18e6664516816a11b979c0dbdca78a86f5b8fb83b1c5d9bb85cc`. Den ändrar `src/invoice-extraction.js`, `src/invoice-details.js`, `sites/lib/invoice-fields.js`, `sites/lib/invoice-details.js` och lägger till `test/final95-parser-census.test.js`. Exakta filhashar finns i `final95-ocr-census-files.json`. Testfilen kör båda parsermotorerna med PDF- och OCR-kontext.

## Faktisk mätning

Varje rad nedan avser tio normala, redan kända V2-dokument och gäller vardera Node respektive Sites. Motorerna är överens. De får inte räknas som tjugo oberoende bilder.

| Datakälla | Parser | Mandatory10 TP / FP / FN | All13 TP / FP / FN | Kritiska falskt gröna |
| --- | --- | ---: | ---: | ---: |
| Oförändrad äldre PSM3-text, ingen ny OCR | 2982 | 57 / 0 / 43 | 79 / 0 / 51 | 0 |
| Samma äldre PSM3-text | Kandidat | **59 / 0 / 41** | **82 / 0 / 48** | 0 |
| Ny verklig OCR på samma kända V2-raster | 2982 | 59 / 0 / 41 | 81 / 0 / 49 | 0 |
| Exakt samma nya optiska observationer | Kandidat | **61 / 0 / 39** | **84 / 0 / 46** | 0 |

Kandidaten återfår två korrekta valutafält och en korrekt OCR-referens, utan tappade fält eller nya felvärden. På den nya optiska normalmängden är uppmätt fältprecision 100 %, mandatory recall 61 % och all13 recall 64,62 %. Detta är ett litet känt utvecklingsprov; det bevisar inte 98 % populationsprecision eller oberoende acceptans. Ingen normalfaktura blev grön. Båda stressbilderna förblev icke-gröna; deras oförändrade kandidatresultat var mandatory 8/20 och all13 10/26 med FP0. Stress och normalpopulation hålls separata.

Äldre PSM6-rådata spelades också upp separat: kandidat mandatory 52/100 och all13 63/130. Två redan befintliga felvärden av typen `kind=other` kvarstår på röda dokument. PSM6 infördes inte som produktionsläge och dessa utfall blandas inte med PSM3-resultatet.

### Den nya optiska körningens kontrakt

`optical-v2-known-01/plan.json` skrevs och hashbands före körning: SHA-256 `6cb8f1654625a983b9157da1c5c6a0c8edcb85cbee590a7982d2e1d8d0e7e691`. Den binder produktfiler, kandidatkällor, mätkod, lokala Tesseract-/svenskmodellartefakter, oförändrat facit och alla tolv exakta raster. En exklusiv claim skapades före första workeranropet.

Körningen gjorde **12 workeranrop och 48 parseranrop**, inga omtag och inga körfel. Den oförändrade 2982-workern kördes en gång per bild med samma lokala språkmodell och parametrar. En observerande importhook sparade faktiskt recognition-raster, parametrar, raw JSON/V8 med ord/bbox/konfidens, start-/slutkvitton och workerresultat; den ändrade inte parametrar eller returvärden. Layoutåterspelningen stämde med workertexten. Samma originalbundna text, ordbevis och faktiska konfidens skickades till bas- och kandidatparsern. Samtliga käll-/runtime-/indatahashar var oförändrade efteråt.

Resultat: `optical-v2-known-01/result.json`, SHA-256 `d6db21532448fb8f8bb4a103c35f1b61cc44132392ca7ba12a0ed4a98c58c1dc`. Detta är en ny öppet redovisad **utvecklingskörning**, inte en ometikettering av V2:s första oberoende underkända prov. V3 varken lästes eller kördes.

## Regressioner och redovisade fel

- Ny syntetisk kontraktsmatris före rättning: **84 tester, 56 pass och 28 fail**. Felen gäller de två avsedda positiva kontrakten och deras bevisprojektion.
- Samma nya matris efter rättning: **84/84 pass**.
- Bred Node-fokus inklusive befintlig layout-, ekonomisk OCR-evidens- och tillförlitlighetsgranskning: **254/254 pass**, 1,796 sekunder.
- Bred Sites-fokus inklusive befintliga oberoende parti-/organisations-/grammatik-/geometrigränser: **480/480 pass**, 7,335 sekunder.
- Första breda scratchkörningen hade 221/222 respektive 447/448: en kopierad testhjälpare saknade den oförändrade syntetiska `test/fixtures.js`. Filen kopierades från den frysta källan och hela båda fokuskörningarna kördes om. Inga produktassertions ändrades eller togs bort.

Alla avslutade testkörningar har noll skip/cancel/todo. Dessa fokusresultat ersätter inte fulla releasegrindar efter integration. Den frysta optiska källbindningen omfattar den slutliga linjära spannskanningen. Den första `census-candidate-replay.json` togs före den mekaniskt likvärdiga byteoptimeringen; den nya optiska körningen och de sista 254/480-testkvittona gäller de slutliga patchbytesen.

## c5 ingår inte i main eller integrationen

Det historiska dokumentationscheckpointhuvudet `d5e9451ceff439ff7ae60799de58e8ff00971eb8` säger uttryckligen att den separata källan `c5cdd0fe57d300ba40f6572cbbe39c7fce9397e7` och dess fullständiga optiska arkiv inte återställdes i checkpointens produktträd. Endast analysen och begränsad metadata räddades. De historiskt redovisade 69/100 mandatory och 91/130 all13 är därför inte mätning av aktuell main.

Både c5 och arkivet `2ca47860bd1dc587e0fec0a3dfbcedac8477a6fb` saknades som lokala gitobjekt. GitHubs read-only GET `/repos/sharbel0022/Mgeorge/commits/c5cdd0f` och motsvarande `/2ca4786` gav **422, No commit found for SHA**. Den äldre lokala scratchplatsen fanns inte heller. Det är en exakt kvarvarande artefaktlucka; källan eller observationerna har inte återskapats ur analysprosa. Förbättringen ovan gjordes självständigt på den nu tillgängliga koden och den oförändrade kända korpusen.

## Kvarfelsmatris och faktiskt tekniskt kvararbete

Den fullständiga fältmatrisen finns i `remaining-fields.json`, med alla förväntade syntetiska värden, faktiska nullvärden, issues och begränsad markering om en sträng bokstavligen förekommer någonstans i råtexten. En sådan strängträff är inte bevis på fältroll eller partsägarskap.

| Saknat fält | Antal normaldokument | Nästa tekniska fråga |
| --- | ---: | --- |
| Organisationsnummer | 10 | Bind uttrycklig partsroll, namn och org inom en sluten källregion; behåll gränser vid mottagare, ombud, sidfot och okända etiketter. |
| Part | 6 | Oetiketterade namn får inte automatiskt bli verifierad leverantör. Eventuella förslag behöver separat, tydligt osäker produktsemantik. |
| Momsbelopp | 8 | Skilj en faktiskt tryckt beloppscell från skadad procentsats och löptext; behåll full negativ förekomstkontroll. Beräkna inte saknad moms. |
| Netto | 5 | Bevisa kolumn-/cellgränser i sammanställningar utan att behandla artikelkolumner som totalsummor. |
| Total | 4 | Samma strukturbindning, inklusive utskriven valuta vid etiketten och separat beloppscell. |
| Bankgiro | 4 | Kräver korrekt egen betalningscell och originalbundna ord med bibehållen faktisk confidence, inte bara hittade siffror. |
| OCR/referens | 3 | Skilj värdebärande uppmaningscell från löptext och okända/skadade rubriker; gissa inte OCR-glypher. |
| Valuta | 2 | Blandad kolumn eller valutavärde följt av annan mening behöver bevisad källgräns; acceptera inte en valfri känd prefixkod. |
| Förfallodatum | 2 | Avskild etikett/värde-geometri över blandade läsrader. |
| Fakturanummer | 1 | Samma geometri med bevarad faktura-/OCR-åtskillnad. |
| Fakturadatum | 1 | Samma geometri och oförändrad datumvalidering. |

För 85 % krävs ytterligare **24 korrekta mandatoryfält** och **27 korrekta all13-fält** på denna population, samtidigt som precision och samtliga negativa säkerhetsgränser håller. De 16 saknade part-/orgfälten innebär att alla andra mandatoryfält ensamma skulle räcka till högst 84/100. Det är därför inte möjligt att ärligt hävda att enbart betalnings-/summaformat löser recallkravet; partsägarskap måste få ett bättre verifierat kontrakt.

Den nya råcapture gör fortsatt källbunden geometridiagnos möjlig utan fler optiska anrop. Konkreta nästa utvecklingssteg är självständiga syntetiska positiva och negativa prov för slutna uttryckliga partsblock över adressrader, typade monetära celler och full negativ förekomstcensus. De är **tekniskt kvararbete**, inte bankavtal eller providerblockering. Det finns inte verifierad evidens för att alla saknade fält kan återvinnas säkert med nuvarande råobservationer.

V3-förseglingen är en regel för oberoende utvärdering och förregistrerad testdisciplin, inte ett generellt förbud mot fortsatt utveckling på känd data. Ett framtida, fryst kandidatprov måste följa det protokollet. Den nuvarande förbättringen berättigar inte till att kriterium 10 höjs till målnivån eller att 9,5/10 deklareras.
