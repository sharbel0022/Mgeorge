# Förregistrerad V2-diagnos: fast PSM 6

Detta är ett enda utvecklingsexperiment på den redan kända V2-korpusen. Det är **inte ett nytt oberoende hållprov**, en produktionsändring eller skäl att höja någon poäng. V1/V2:s första underkända mätningar ligger kvar. Inget V3-material används.

## Hypotes och fasta villkor

Tesseracts `PSM.SINGLE_BLOCK` (6) kan återge procenttecken och vissa rader bättre än `PSM.AUTO` (3), men kan också blanda kolumner. Vi mäter hela den oförändrade populationen, utan att välja bästa fält från olika pass.

- Produktionsbas: `41aadcef5fc6f65cc73979997b195c7b4f12eec1`.
- Korpus/facit: oförändrad V2-frysning `9d9d0736d5f9f02e87ea055f328b9e44518badea`, tio normala bilder och två separata stressbilder, i manifestets ordning.
- Enda ändringen i den isolerade worker-kopian: `PSM.AUTO` byts till `PSM.SINGLE_BLOCK`. Parserfiler, layoutkod, svenska modellen, OEM 1, rasterstorlek, skalning, bildbehandling, OCR-outputval och övriga parametrar är oförändrade.
- Exakt ett optiskt anrop per bild, högst tolv totalt. Ingen ny PSM 3-körning, crop, omtag, alternativ skala, parameteranpassning eller fältkombination.
- Produktionslivscykeln bevaras: ett underlag per barnprocess, en ny Tesseract-instans, terminering efter underlaget. Barnprocesserna kör sekventiellt med samma Node 24.22.1; högst en OCR-worker åt gången.
- Fullt råsvar fångas före layout utan att det returnerade objektet ändras. Både oförändrad V8-serialisering och JSON sparas med blocks, paragraphs, lines, words, bbox och confidence såsom Tesseract returnerar dem. Det faktiska OCR-rastret, dess SHA256, parametrar och slutliga workerresultat sparas också.
- Förberedelsen får rasterisera och räkna hash utan OCR. Den förberäknade rasterhashen måste stämma före varje faktiskt recognize-anrop. Ingen ny modell eller dependency hämtas.

## Jämförelse och mått

Huvudjämförelsen använder samma publicerade Node- och Sites-parsers på två observationer: den sparade PSM 3-texten/evidensen från första V2 och de nya PSM 6-resultaten. PSM 3-texten omtolkas lokalt utan optik och jämförs fält för fält med det redan sparade resultatet `ocr-v2-stored-text-reparse-result.json` från `635ca5e3bcf3c1c8ecff16b192a44cde35175d69`. Parsergrafens hashparitet kontrolleras före körning. Den historiska första mätningens 60 procent mandatory recall redovisas separat från den kända omtolkningens 63 procent.

Oförändrad metrikhjälpare och V2-facit används. För vardera parser redovisas:

1. Normalpopulationens all13 (130 fält), mandatory10 (100 fält), image9 utan riktning (90 fält), TP/FP/FN, precision, recall, fältmatris och fullständiga dokument.
2. De frysta diagnostiska gränserna minst 98 procent precision och minst 85 procent recall för all13 och mandatory10; inga kritiska falskt gröna och separat avstående på båda stressfallen. Utfallet är diagnostik, inte nytt hållprovs- eller produktionsgodkännande.
3. Stressfallen separat, inklusive alla fält, fel och granskningsnivå. Inga stressfall tas bort eller blandas in i normalpopulationen.
4. Hela unionen av avvikande PSM 3/6-fält: förbättring, försämring, olika felvärden eller oförändrat utfall. Ingen kombinerad faktura byggs av två pass.
5. Sekundärt: antal procenttecken i sparad PSM 3-workertext samt PSM 6-råtext och workertext, jämfört med frysta rendertexters åtta synliga procentmarkörer i normalpopulationen. Detta är en beskrivande glyphobservation, inte ett positionsstyrkt precisionsmått. Rad-/kolumnskillnader bedöms från fältutfall och de bevarade råa text-/geometriobservationerna; inget nytt optiskt anrop tillåts för en förklaring.

Riktning är tillförd metadata och får inte redovisas som bildigenkänning. Båda parsrarna delar samma optiska resultat per bild och är inte två oberoende OCR-prov. För tio av första V2-observationerna saknas full gammal bbox; en komplett geometrisk PSM 3/6-jämförelse kan därför inte hävdas där. Källgrafens optiska delar, svenska träningsdata och runtime jämförs även mot det gamla provets inventering, men faktiskt gammalt OCR-raster finns endast för de två tidigare separata diagnostikfallen.

## Frysning och felhantering

`packet/plan.json` binder källinventering, runtime, indata, skyddade äldre resultat och all ny mätkod. Denna plan och koden ska vara committade **innan** `measure.mjs --run` får utföras. `--check` verifierar bindning och sparad parserbas utan OCR. `packet/first-attempt.json` skapas exklusivt före första anropet; befintlig markör spärrar omkörning. Varje bild har en separat exklusiv startmarkör i capture-koden.

Om ett anrop misslyckas bevaras dess observation och det görs aldrig om. Ett avbrott i harness lämnar delresultat med ärlig status och får inte döljas genom en ny helkörning. Råsvar och slutligt resultat skrivs som nya filer; inga tidigare V2-facit, bilder, mätkoder eller resultat skrivs om. Ingen bank-, Gmail-, backup-, produktions- eller återställningsåtgärd ingår.

## Körning efter plancommit

```text
/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node docs/quality8/ocr-v2-psm6-diagnostic/harness/measure.mjs --check
/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node docs/quality8/ocr-v2-psm6-diagnostic/harness/measure.mjs --run
```

Resultat och råpaket tillkommer i en separat commit efter experimentet. Ingen lyckad optisk körning eller något mätutfall påstås vid planfrysningen.

Förkontrollen före frysning hittade att en först vald lokal dependencylänk saknade `@noble/hashes`. Ingen OCR hann starta. Den isolerade arbetsytan använder därför samma befintliga dependencykatalog som V2:s första mätning; inget installerat beroende ändrades. Den slutliga runtimeinventeringen omfattar samtliga rotberoenden och deras tillgängliga transitiva paketinnehåll, inte enbart modell-/WASM-filer.
