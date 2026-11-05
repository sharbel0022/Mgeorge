# Oberoende fryst OCR-hållprov — underkänt

## Beslut

**Den första hållmätningen missar acceptansgränsen för område 10.** På exakt `6325f2d63565e2ab2bd9c02e5e6d3fc50cd04608` gav både Node- och Sites-tolken **96,67 % precision och 72,50 % recall för de tio obligatoriska fälten**, mot kraven minst 98 % respektive 85 %. Samtliga tretton fält gav 85,14 % precision och 60,58 % recall. Inget av de åtta läsbara normaldokumenten var helt korrekt, vare sig över tio eller tretton fält.

**Säkerhetsdelen klarades:** inga falskt gröna kritiska beslut; samtliga åtta normalfall och båda stressfall var röda. Det visar att dessa fel krävde granskning, men kompenserar inte för den otillräckliga fältprecisionen och återvinningen. Ingen poäng höjs i detta kvitto.

Det underkända resultatet är oförändrat. Inga bilder valdes bort eller ersattes. Inget facit, tröskelvärde, bildmaterial, mätprogram eller produktionskod ändrades efter den första OCR-körningen. Ingen ny OCR- eller tolkarkörning gjordes för denna rapport. Fortsatt diagnos och eventuella rättningar måste redovisas separat; en framtida mätning på dessa nu kända bilder är regression, inte ett nytt blint hållprov.

## Fryst material och tidsordning

| Händelse | Exakt underlag |
| --- | --- |
| Produktkod | Commit `6325f2d63565e2ab2bd9c02e5e6d3fc50cd04608`, träd `e8f5e87d949b349e11bd12a0b4a89e720ec74419` |
| Manifest skapat | 2026-11-05 19:19:47.497 UTC |
| Fryscommit före OCR | `82f4a0a07d2f27115e78816b5b7ae8520ad93926`, 2026-11-05 19:21:35 UTC |
| Första OCR-anrop | 2026-11-05 19:21:50.177 UTC |
| Mätning slutförd | 2026-11-05 19:22:37.733 UTC |
| Omfattning | 10 fasta rasterbilder, 10 verkliga OCR-workeranrop, 20 tolkningar: en per bild och parser |
| Stabilitet | Samtliga frysta käll-, bild-, facit- och mätkodshashar identiska före/efter; 0 process- eller parserfel |

Det nya syntetiska materialet skapades fristående från dokumentförfattarens tidigare diagnoskorpus. Åtta läsbara svenska leverantörsfakturor har olika realistiska uppställningar, serif-/sans-seriftypografi, datum med bindestreck/punkt/snedstreck, komma/punkt som decimaltecken, grupperade/ogrupperade belopp samt Bankgiro i sidhuvud, sidoblock eller fot. En- och tvåradiga fält ingår. Normalbilderna är 1600 × 2000 pixlar med läsbar brödtext på 29–36 pixlar. Två separata stressfall är kraftig pixelering respektive täckta betalningsuppgifter och beloppssammanfattning.

Separat [facit](../../test/fixtures/quality8/ocr-holdout-v1/gold.json), [tryckta uppgifter](../../test/fixtures/quality8/ocr-holdout-v1/documents.json), [manifest](../../test/fixtures/quality8/ocr-holdout-v1/manifest.json), generator, bilder, mätkod och krav frystes före första OCR. Bildöversikterna granskades visuellt före frysningen; två normalfall granskades även i full storlek. En ändring före frysningen flyttade enbart generatorns PNG-utmatning till rätt katalogstruktur; båda renderingarna gav identiska bildhashar. Ingen OCR användes vid denna förberedelse.

## Mätkedja och mått

Den oförändrade `runDocumentProcess(bytes, 'image/png')` kördes en gång per bild från ett isolerat arkiv av exakt produktcommit. Den verkliga OCR-texten, den faktiska konfidensen och det hashbundna ordbeviset skickades till både Node- och Sites-tolken. Det finns ingen konfidensöverskrivning, textkorrigering eller facitstyrd bildbehandling. Samma befintliga `projectReviewedFields`, `evaluateDocument` och `summarizeDocuments` som i repositoryts övriga OCR-mätning används.

Precision är TP/(TP+FP); recall är TP/(TP+FN). Ett felaktigt ifyllt värde räknas både som FP och FN. Ett saknat korrekt källvärde räknas som FN. Dokumentexakthet kräver samtliga värden rätt inom respektive fältmängd. Alla normal- och stressfall behålls i sina fördefinierade populationer.

De tio obligatoriska fälten är fakturanummer, leverantör, organisationsnummer, fakturadatum, förfallodatum, total, netto, moms, riktning och valuta. Riktningen `supplier` är uttryckligt tillförd metadata, såsom i den befintliga mätkedjan; den är inte bildigenkänning. Därför redovisas också de nio obligatoriska bildfälten utan riktning. Samtliga tretton omfattar dessutom referens, Bankgiro och dokumenttyp.

Sites använder sin riktiga fälttolk på samma Node-workers OCR-resultat. Det är således två tolkar men åtta oberoende normalbilder, inte sexton oberoende bilder eller ett fullständigt browser-/moln-/uppladdningsprov. Mätningen exekverar inte ekonomiskt godkännande eller registrering i en produktionsdatabas.

## Normalresultat

Node och Sites gav samma utfall. Tabellen gäller **vardera tolken**, utan att slå ihop deras nämnare.

| Fältmängd | TP | FP | FN | Precision | Recall | Helt korrekta dokument |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Alla 13 fält | 63 | 11 | 41 | 85,14 % | 60,58 % | 0/8 |
| Obligatoriska 10 | 58 | 2 | 22 | 96,67 % | 72,50 % | 0/8 |
| Obligatoriska 9 utan metadata-riktning | 50 | 2 | 22 | 96,15 % | 69,44 % | 0/8 |

Den förregistrerade rapporten prövar samma 98/85-gränser för både tio och tretton fält. Båda omfattningarna missar båda gränserna på båda tolkarna. Detta utfall är därför oberoende av vilken av dessa två omfattningar som används för att läsa PLAN:s precisionskrav.

### Samtliga tretton fält, per tolk

| Fält | Rätt / 8 | Felaktigt ifyllt | Saknat | Precision | Recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| Fakturanummer | 7 | 0 | 1 | 100 % | 87,50 % |
| Leverantör | 6 | 1 | 1 | 85,71 % | 75 % |
| Organisationsnummer | 7 | 0 | 1 | 100 % | 87,50 % |
| Fakturadatum | 1 | 0 | 7 | 100 % | 12,50 % |
| Förfallodatum | 6 | 0 | 2 | 100 % | 75 % |
| Totalbelopp | 7 | 1 | 0 | 87,50 % | 87,50 % |
| Momsbelopp | 8 | 0 | 0 | 100 % | 100 % |
| Nettobelopp | 0 | 0 | 8 | —, inget returnerat värde | 0 % |
| Betalningsreferens | 4 | 1 | 3 | 80 % | 50 % |
| Bankgiro | 1 | 0 | 7 | 100 % | 12,50 % |
| Riktning, tillförd metadata | 8 | 0 | 0 | 100 % | 100 % |
| Dokumenttyp | 0 | 8 | 0 | 0 % | 0 % |
| Valuta | 8 | 0 | 0 | 100 % | 100 % |

Kolumnen ”saknat” omfattar endast nullvärden. FN i föregående tabell omfattar både saknade och felaktigt ifyllda värden; därför är FN större än antalet nullvärden.

### Oförändrade normalfall

| Bild | Layout | TP / FP / FN, 13 fält | Status |
| --- | --- | ---: | --- |
| normal-01 | Modern servicefaktura | 9 / 1 / 4 | Röd |
| normal-02 | Klassisk verkstadsfaktura | 8 / 3 / 5 | Röd |
| normal-03 | Konsultfaktura med två kolumner | 4 / 1 / 9 | Röd |
| normal-04 | Inramad materialfaktura | 10 / 1 / 3 | Röd |
| normal-05 | Fraktfaktura med färgband | 8 / 1 / 5 | Röd |
| normal-06 | Luftig formgivningsfaktura | 8 / 1 / 5 | Röd |
| normal-07 | Serviceblankett med staplade fält | 7 / 2 / 6 | Röd |
| normal-08 | Kontorsfaktura med betalningsblock | 9 / 1 / 4 | Röd |

## Konkreta observationer för fortsatt diagnos

Dessa observationer kommer enbart från det sparade första utfallet. Ingen ny tolkarkörning eller ändrad bild användes för att pröva en förklaring.

- **normal-01:** OCR-texten innehåller `Fakturadatum: 2026-09-18 Förfallodatum: 2026-10-18` på samma rad samt ett korrekt läst nettobelopp. Tolken lämnar både fakturadatum och netto tomma och markerar märkta värden som ogiltiga.
- **normal-02:** det felslästa Bankgironumret hamnar på leverantörsraden. Leverantörsvärdet får därför en extra sifferdel. Referensen `0074108028` returneras som `00741080238`. Båda felvärdena finns kvar i resultatet som fel, utan rättat facit.
- **normal-07:** två visuella kolumner ger OCR-raden `Att betala 0074108077`. Tolken returnerar **7 410 807 700 öre** som total i stället för det synliga facitvärdet **540 150 öre**. Dokumentet är rött, dess fältevidens varnar och inget grönt ekonomiskt beslut sker.
- **Dokumenttyp:** samtliga åtta normalfall får `other` trots att varje bild är märkt FAKTURA. I de närmare lästa råtexterna från normal-01, normal-02 och normal-07 saknas rubriken. Hela originaltexten för samtliga tio bilder är sparad så fortsatt diagnos kan skilja optiskt bortfall från fälttolkning.

Normala OCR-konfidensvärden var 90–93. Dessa dokumentnivåvärden är varken faktakontroll eller bevis på korrekt koppling mellan fältetikett och siffra. Resultatet gör ingen starkare orsaksdiagnos än vad det sparade underlaget visar.

## Stress och falskt gröna beslut

| Stressbild | Faktisk konfidens | TP / FP / FN, alla 13 | Status | Kritiska betalningsvärden |
| --- | ---: | ---: | --- | --- |
| Kraftigt pixelerad | 36 | 1 / 1 / 12 | Röd | Total, referens och Bankgiro saknas |
| Täckta betalningsuppgifter och beloppssammanfattning | 91 | 5 / 1 / 8 | Röd | Total, referens och Bankgiro saknas |

Båda stressfallen avstod från grönt och från de här kritiska betalningsvärdena. Deras ursprungliga källfacit ligger kvar, så bortfallet syns som FN. Stress summeras separat och används inte för normalgränserna. Även den skadade bilden med hög konfidens kräver granskning.

Per tolk finns **0 falskt gröna kritiska beslut av 10 dokument**, 0 gröna normalfall och 0 gröna stressfall. Samma gäller den bredare befintliga falskt-grönt-definitionen över samtliga tretton fält. Den aktuella OCR-policyn kräver manuell granskning även när enskilda fält är rätt; säkerhetsutfallet ska läsas tillsammans med de underkända fältmåtten.

## Källgraf, runtime och återanvändning

Manifestet innehåller 187 käll-/beroendefiler: alla spårade filer i `src/` och `sites/lib/` samt båda dependency-manifesten och låsfilerna. Den faktiskt importerade OCR-/tolkgrafen har 27 filer. Den separat redovisade kontextuella grafen för import, domän, ekonomi och betalningspresentation har 51 filer. Dessa mängder överlappar.

**`sites/lib/domain.ts` ingår i den faktiska tolkgrafen**, eftersom Sites hämtar `parseMoney` därifrån. En senare ändring i domänen kan därför inte beskrivas som en byteidentisk OCR-graf, även om ändringen rör en annan funktion. Återanvändning mot en kommande leverans måste visa vilka grafhashar som ändrats och bedöma den faktiska skillnaden. Testet bevisar inget funktionellt om de ekonomiska nedströmsmodulerna bara för att deras hash finns med.

Runtime var Node `v24.22.1`, canvas `0.1.80`, Tesseract.js `6.0.1`, Tesseract core `6.1.2`, lokala svenska språkdata `1.0.0` och PDF.js `5.4.149`. Fontfiler, språkdata och lokala WASM-filer är hashade. Inga nya beroenden installerades. Normalbildernas workeranrop tog i genomsnitt cirka 5,00 sekunder; samtliga tio anrop summerade till 47,41 sekunder på denna delade värd. Det är ingen produktionsgaranti för svarstid.

## Filer, kommandon och beständighet

[Fullständigt oförändrat resultat](ocr-independent-holdout-result.json) innehåller alla 13 förväntade/returnerade värden, rå OCR-text, konfidens, ordbevis, fältevidens, varningar, tider, källhashar och separata summeringar. Resultatfilens SHA-256 är `91e1bfd75277c0175a4145739e70759fa9f65b900a75d94dcf94e131b5e59c46`.

| Underlag | SHA-256 |
| --- | --- |
| Dataset, tio fasta PNG-bilder | `ec7eec5c26b988d3587d4045b4eef2d96be5373ed3751a967d4976aeccf4cc2e` |
| Separat facit | `56e4b03f2b90f0d9cb2143376041d2751429d683397459df46a2a1e48d8141d3` |
| Manifest | `6d9bb30d672b23096e469a38d8eabf88ce2582501d3fc2a82b83a96f82f9311b` |
| Hela frysta källinventeringen | `72bd6e378608c0c6370096d287539be330f10dacc03321e6ed00387dec8acd80` |
| Mätkod inklusive befintlig måtthjälpare | `cbec6812f35a87257fadb8f6bfece6464124ae8c48a6c20daf9592881a6d5ff5` |

Det exakta första mätkommandot, från repositoryroten, var:

```sh
/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
  scripts/quality8/measure-ocr-holdout.mjs \
  --source-root /tmp/mgeorge-ocr-exact-6325-z4dnfa3a \
  --output docs/quality8/ocr-independent-holdout-result.json
```

Källarkivet skapades med `git archive` från den exakta målcommitten och befintliga installerade beroenden länkades in. Mätprogrammet verifierar alla hashvärden före OCR och vägrar skriva över en tidigare resultatfil. Ett avslutat, giltigt underkänt prov har `status: completed` och `passed: false`; processens lyckade avslut innebär inte att acceptansgränsen klarats.

[Korpusens README](../../test/fixtures/quality8/ocr-holdout-v1/README.md) beskriver reproducerbar bildgenerering, avgränsning och frysta krav. [Bildöversikt 1](../../test/fixtures/quality8/ocr-holdout-v1/contact-1.png), [bildöversikt 2](../../test/fixtures/quality8/ocr-holdout-v1/contact-2.png) och [separata stressbilder](../../test/fixtures/quality8/ocr-holdout-v1/contact-3.png) hör till samma frysta material.

## Begränsningar

Detta är ett litet avsiktligt varierat syntetiskt hållprov, utan kundoriginal. Åtta layouter kan inte fastställa en generell populationsprecision på 98 % eller ett verkligt manuellt granskningsbehov. Svenska maskinskrivna ensidesfakturor, SEK, explicit märkta fält och 25 % moms avgränsar populationen; handskrift, andra språk/valutor, godtyckliga flersidiga dokument och fullständig artikelradsexakthet ingår inte.

Inga bank-/Gmailanrop, externa OCR-tjänster, produktionsdokument eller ekonomiska skrivningar användes. Den legitima fortsättningen är att diagnostisera de bevarade missarna och därefter separat verifiera eventuella ändringar. Detta kvitto är det oförändrade första hållresultatet och ska finnas kvar även efter framtida förbättringar.
