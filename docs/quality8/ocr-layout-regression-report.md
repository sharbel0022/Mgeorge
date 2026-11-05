# OCR AUTO och försiktig layout — utvecklingsregression

## Resultat och kvarstående fel

På exakt kodcommit **`68e3cb752d05f825e36f88eab58f925cb056e3e8`** passerar den nya körningen de numeriska 98/85-gränserna på de åtta tidigare kända normalbilderna. Både Node och Sites ger **98,68 % precision och 93,75 % recall för de tio obligatoriska fälten**, med 5/8 helt korrekta dokument. Alla tretton fält ger 98,95 % precision, 90,38 % recall och 3/8 helt korrekta dokument. Inga falskt gröna kritiska beslut observeras; båda separata stressfall kräver granskning.

**Detta är regression efter diagnos, inte ett nytt oberoende hållprov.** Bilderna och deras första missar var kända när rättningen gjordes. Det första underkända hållresultatet, dess facit, manifest, bilder och mätkod är byteidentiska och kvarstår som första resultat. Den här rapporten tilldelar inget betyg och ersätter inte en oberoende slutacceptans.

**Ett konkret felvärde återstår:** normal-07 är rött men tolkar fortfarande råtexten `Att betala 0074108077` till **7 410 807 700 öre**, mot facits **540 150 öre**. Layouten återställer avsiktligt den berörda kedjan av rader eftersom summans råa rad även har en okänd oparad instruktion. Den får inte dölja denna text för att återvinna summan. Felet har lämnats till parserägaren; det är inte ett korrekt återvunnet belopp eller ett grönt ekonomiskt beslut.

## Kod och säkerhetsregel

Koden bygger på rootcommit `f601ef762a91b598f6df5d87ab318895bb76a240`, inklusive tidigare parser-/typ- och Bankgiroförbättringar. Den här ändringen omfattar den gemensamma `sites/lib/ocr-layout.js`, `src/invoice-worker.js`, `sites/lib/local-ocr.ts`, browser-testladdaren och egna geometri-/integrationstester. Inga parserfiler ändras i committen.

Node-worker och browseradapter väljer uttryckligen **PSM.AUTO** i den redan installerade Tesseract-versionen. Det är en vald parameter efter grundorsaksdiagnos, inte en parametergrid. Samma gemensamma layoutfunktion används efter OCR och före konstruktionen av Bankgirots ordbevis.

Layoutfunktionen arbetar enbart med OCR-motorns befintliga ord, deras bounding boxes och deras oförändrade konfidens:

1. Källtext, rader och samtliga ord måste stämma överens i exakta tecken, bortsett från blanksteg. Ogiltig geometri, överlapp, saknade ord eller enbart Unicode-normaliserad likhet ger oförändrat original.
2. Ett x-gap större än tre medianordhöjder delar en rad i kandidater. Två redan kompletta märkta fält kan skiljas åt. Ett stort gap ensamt ger ingen rätt att utelämna text eller tilldela ett värde.
3. En fristående känd fältetikett får kopplas till en unik närliggande, vänsterjusterad kandidat under den. Vertikalt avstånd är högst två segmenthöjder; annat innehåll i korridoren blockerar. Algoritmen väljer inte det närmaste eller första värdet bland flera möjliga. Ett värdesegment får högst en etikett.
4. Identifierade beskrivnings-/antalrubriker och efterföljande artikelrader löses inte geometriskt. En tydlig efterföljande sammanfattningsetikett kan avsluta tabellområdet.
5. Om en delad rå rad har ett okänt oparat segment återställs **hela raden**. Alla par som använder den raden tas bort. Detta upprepas tills inga beroenden återstår; en delvis lyckad kedja får inte gömma suffix eller konflikter.
6. Varje ursprungsord måste finnas exakt en gång i resultatet, med exakt text, bbox och konfidens. Endast blanksteg och geometriskt styrkt ordordning får ändras. Oparade råa rader behåller sina starka styckegap.

Bankgirobeviset binds därefter till samma originalbytes och den faktiskt levererade OCR-texten. Minst 90 i ordkonfidens och inventeringen av samtliga märkta Bankgiroförekomster gäller fortsatt. En korrekt gissning, Luhn-korrigering, ändrad siffra eller höjd konfidens ingår inte. Sidans faktiska konfidens skickas vidare oförändrad.

## RED → GREEN och integration

Nio positiva geometrifall var röda mot den ursprungliga identitetsfunktionen. Browserintegrationen hade tre röda fall före AUTO-/layoutkopplingen. En separat negativ regression visade dessutom att Unicode-normalisering kunde dölja ett faktiskt tokenbyte; exakt teckenbindning infördes och det fallet blev grönt.

| Slutkontroll | Resultat |
| --- | ---: |
| Egna geometri-/ordbevarandetester | 27/27 |
| Egna browseradaptertester, inklusive stängning vid fel | 4/4 |
| Befintliga Node-/Sites-ordbevis och syskonetikettsfall | 104/104 |
| Befintliga producent-/PDF-/browserfall | 38/38 |
| **Totalt fokuserat** | **173/173** |
| Sites TypeScript-kontroll | Godkänd |
| Diff-/syntaxkontroll | Godkänd |

De 38 sista fallen innehåller verklig lokal raster-OCR, verklig browseralgoritm med PDF.js/canvas/Tesseract och lokala språkdata, samt befintliga frysta ordobservationer. Inga befintliga assertions sänktes. Testladdaren fick endast importkoppling för den verkliga nya layoutmodulen och exponering av Tesseracts verkliga PSM-konstant.

Rootdiagnostikens sparade AUTO-block lästes även utan ny OCR för att kontrollera ordbevarande. Alla ursprungsord behölls exakt en gång med sina befintliga konfidensvärden. Sju normalobservationer rekonstruerades; normal-02 och de båda stressobservationerna behöll rå ordning. Detta var kontraktsdiagnos, inte ett separat blindprov eller ytterligare parameterförsök.

Fokuserade kommandon från repositoryroten:

```sh
/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --test \
  test/ocr-layout.test.js sites/tests/ocr-layout-integration.test.mjs \
  test/ocr-bankgiro-evidence.test.js test/ocr-bankgiro-sibling-evidence.test.js \
  sites/tests/ocr-bankgiro-evidence.test.mjs

/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --test \
  test/ocr-bankgiro-producer.test.js sites/tests/pdf-layout-ocr.test.mjs

/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
  sites/node_modules/typescript/bin/tsc --noEmit -p sites/tsconfig.json
```

## Regression på oförändrade V1-bilder

Körningen startade **2026-11-05 19:57:33.181 UTC** och avslutades **19:58:20.449 UTC**. De tio fasta bildfilerna lästes en gång vardera av den verkliga Node-workern. Varje resultat tolkades en gång av den riktiga Node-parsern och en gång av den riktiga Sites-parsern. Ingen bild valdes bort; inga värden i facit ändrades.

Tabellen gäller vardera tolken, utan att fördubbla antalet oberoende bilder:

| Mått på normalbilderna | Första hållprov, 6325f2d | Denna regression, 68e3cb7 |
| --- | ---: | ---: |
| Precision, alla 13 | 85,14 % | **98,95 %** — 94 TP / 1 FP |
| Recall, alla 13 | 60,58 % | **90,38 %** — 94 TP / 10 FN |
| Dokumentexakthet, alla 13 | 0/8 | **3/8** |
| Precision, obligatoriska 10 | 96,67 % | **98,68 %** — 75 TP / 1 FP |
| Recall, obligatoriska 10 | 72,50 % | **93,75 %** — 75 TP / 5 FN |
| Dokumentexakthet, obligatoriska 10 | 0/8 | **5/8** |
| Falskt gröna kritiska beslut, normal + stress | 0/10 | **0/10** |

Riktning är uttryckligen tillförd metadata, inte bildigenkänning. Utan riktning ger de nio obligatoriska bildfälten **98,53 % precision och 93,06 % recall**, 67 TP / 1 FP / 5 FN. Samma oförändrade måtthjälpare räknar felaktiga ifyllda värden som både FP och FN, och null för ett känt värde som FN.

### Alla tretton fält, per tolk

| Fält | Rätt / 8 | Felvärde | Saknat |
| --- | ---: | ---: | ---: |
| Fakturanummer | 8 | 0 | 0 |
| Leverantör | 6 | 0 | 2 |
| Organisationsnummer | 6 | 0 | 2 |
| Fakturadatum | 8 | 0 | 0 |
| Förfallodatum | 8 | 0 | 0 |
| Totalbelopp | 7 | 1 | 0 |
| Momsbelopp | 8 | 0 | 0 |
| Nettobelopp | 8 | 0 | 0 |
| Betalningsreferens | 6 | 0 | 2 |
| Bankgiro | 5 | 0 | 3 |
| Riktning, metadata | 8 | 0 | 0 |
| Dokumenttyp | 8 | 0 | 0 |
| Valuta | 8 | 0 | 0 |

Normal-01, normal-04 och normal-08 är helt korrekta över tretton fält. Normal-02 saknar Bankgiro; normal-03 saknar leverantör, organisationsnummer och Bankgiro; normal-05 saknar referens och Bankgiro; normal-06 saknar leverantör och organisationsnummer. Normal-07 har det redovisade felaktiga totalbeloppet och saknar referens.

Sju normalfall är gula och normal-07 är rött. Båda stressfallen är röda och avstår från total, referens och Bankgiro. Det finns inga process- eller parserfel. Säker abstention för låg ordkonfidens har inte omdefinierats till ett korrekt återvunnet värde.

## Källor och oförändrat första underlag

[Fullständigt regressionsresultat](ocr-layout-regression-result.json) sparar samtliga förväntade/returnerade fält, faktisk bearbetad text, ordbevis, konfidens, varningar, tider och källinventering. SHA-256: **`c992ad8445979a72dac0b01ea3ba486c0c184d3a6f9bc3fd77391f9cc8cd9e41`**.

Kodträdet är `3830a43dcbed0bfefde6620b8f1b1101f316b49d`; källinventeringen omfattar 188 filer och dess SHA-256 är `8fb83d643ead624848d4634856831ffdc81b25cc191793f32aa408aade66b679`. Den faktiska OCR-/tolkgrafen omfattar nu 28 filer. Rapportens `changedSourceFilesFromFirst` redovisar alla skillnader från första hållkodens inventering, även tidigare rootägda parser-/domänändringar. Förbättringen i tabellen mäter hela denna kodstack; den är inte en isolerad kausal uppskattning av enbart layoutfunktionens bidrag.

Den nya [regressionsköraren](../../scripts/quality8/measure-ocr-layout-regression.mjs) lämnar den gamla hållköraren orörd. Den verifierar 18 skyddade filhashar före/efter, däribland första resultatet, manifestet, facit, de tio bilderna och den ursprungliga mätkoden. Den vägrar skriva över en tidigare resultatfil och kräver ren committad produktionskälla.

```sh
/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node \
  scripts/quality8/measure-ocr-layout-regression.mjs \
  --source-root /workspace/scratch/4d79ab4bea8e/security \
  --output docs/quality8/ocr-layout-regression-result.json
```

Första resultatfilens SHA-256 är fortfarande `91e1bfd75277c0175a4145739e70759fa9f65b900a75d94dcf94e131b5e59c46`; datasetets SHA-256 är fortfarande `ec7eec5c26b988d3587d4045b4eef2d96be5373ed3751a967d4976aeccf4cc2e`. Ingen av dessa filer ersattes av regressionen.

## Begränsningar

Detta är små, nu utvecklingskända syntetiska svenska ensidesfakturor. Resultatet visar förbättrad regression på dessa bilder, inte generell produktionsprecision eller ett nytt oberoende urval. Sites-mätningen använder Node-workers optiska resultat med sin egen riktiga parser; browserintegration är separat verifierad i testerna. Produktens OCR-resultat kräver fortfarande granskning.

Inga kundoriginal, bank-/Gmailanrop, produktionsskrivningar eller nya beroenden ingår. Originalbytes, faktiska ord och konfidens behålls. Oberoende kodgranskning, rootens fulla integration och eventuell ny oberoende acceptans är separata steg. Det återstående röda beloppsfelet står kvar även om de numeriska regressionsmålen passerar.
