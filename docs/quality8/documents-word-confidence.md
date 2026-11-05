# OCR bankgiro: ordbevis, avståenden och uppmätt täckning

2026-11-05. Fortsättning efter dokumentfixen `303285ab1fec047ec0923614d994860c7d7ce6a5` och identitetsgranskningens fix `9c3dcee2bfffacc1f82fef49c1b23950bee616bb` (lokalt cherry-pick `8b523d1a9ba32a682fe1b478ab3449e13f68ff0a`). Alla original, ordobservationer och metadata i dessa prov är syntetiska. Rapporten sätter inget kvalitetsbetyg och innehåller inga produktionsresultat.

## Resultat

Den nya spärren håller inne fyra felaktiga bankgiroförslag på den frysta variantkorpusen. Den håller också inne ett korrekt bankgiro vars ordkonfidens är 89. **Det är en precisionsförbättring genom avstående, inte bättre återläsning av pixlar eller ökad automatisk registrering.**

Alla tio rasterbilder i variantkorpusen går från **101 TP / 5 FP / 16 FN** till **100 TP / 1 FP / 17 FN**: precision **95,28 → 99,01 %**, recall **86,32 → 85,47 %**, helt exakta dokument **5/10 → 4/10**. Det återstående felaktiga fältet är dokumenttypen på det avsiktligt förstörda stressprovet.

Hela det gamla rasterunderlaget är fortsatt **29 TP / 1 FP / 12 FN**, precision **96,67 %**, recall **70,73 %**, exakta dokument **3/4**. Dessa äldre tal ersätts inte av den bättre variantpopulationen. Samtliga OCR-dokument kräver fortfarande kontroll; falskt gröna dokument är **0 före och efter** i båda korpusarna.

## Konkret diagnos och fryst förundersökning

Fyra läsbara bilder har det tryckta värdet `123-4567`, men den befintliga OCR-körningen gav `1223-4567`. Den totala dokumentkonfidensen låg omkring 91 medan själva sifferordets konfidens var **0**. Etikettordet var tydligt. Dokumentets medelkonfidens var därför otillräcklig som bevis för bankgirot.

Förundersökningen frystes 2026-11-05 17:20:56 UTC, före ändringen av produktionskoden. Den omfattar **15 bilder**: gamla korpusens 4 raster, variantkorpusens 10 raster och en separat bild där det faktiskt står `1223-4567`. Alla källfacit och bytehashar behölls. Utfallet för de **11 läsbara** bilderna var:

| Förfarande i avgränsat experiment | Rätt bankgiro | Fel bankgiro | Avståenden |
|---|---:|---:|---:|
| Befintlig helbild, befintlig uppskalning | 7 | 4 | 0 |
| Ursprungliga pixlar, rad hittad via OCR-etikettens geometri | 9 | 2 | 0 |
| Ursprungliga pixlar, helbild | 9 | 2 | 0 |
| Befintlig körning med krav på ordkonfidens minst 90 | 6 | 0 | 5 |

De fyra stressbilderna är två blanka och två avsiktligt förstörda bilder. Ingen tydlig bankgirorad hittades i dessa. De två förstörda bildernas bankgiron förblir FN mot deras kända källfacit; korrekta null-värden på blanka bilder räknas inte som återfunna bankgiron.

Radförsöket rättade vissa fel men skapade också två nya `123 → 1223`-fel på tidigare korrekta bilder. Därför införs **ingen ny uppskalning, inget extra OCR-pass, ingen siffernormalisering och inget facitstyrt byte**. Den verkligt tryckta fyrsiffriga kontrollen har sifferordskonfidens 95 och behålls oförändrad. Samtliga tre försöksvägars råtext, koordinater, tider, ordkonfidens och originalhashar finns kvar i `ocr-bankgiro-frozen-probe.json`.

## Implementerad regel och transport

`sites/lib/ocr-bankgiro-evidence.js` används av båda parsermotorerna och producerar eller kontrollerar ett litet bevispaket. Paketet innehåller SHA-256 för de ursprungliga filbyten, hela OCR-texten och varje textsida. Varje bankgirorad måste ha rätt sidnummer, radindex, exakt normaliserad radtext, samma redan avlästa värde och kompletta ord med ändliga konfidensvärden mellan 0 och 100.

Ett OCR-föreslaget bankgiro behålls endast när varje uttryckligt märkt förekomst är entydig och både etikettens och sifferordens lägsta konfidens är minst **90**. Saknad metadata, fel original, fel text, fel sida, tvetydig rad, dubbletter utan eget fullständigt stöd eller lägre konfidens ger **null plus en konkret kontrollorsak**. Medelkonfidens 99 får inte ersätta ordbevis. Metadatan får inte skapa eller korrigera någon sifferföljd.

Paketet begränsas till 10 sidor, 32 radposter totalt, 16 ord per rad, 500 tecken per rad och 60 tecken per ord. OCR-textens befintliga gräns är 150 000 tecken. Okända properties tas bort innan en worker skickar beviset vidare. En duplicerad OCR-rad kan inte låna en enda lämplig högkonfidensobservation.

Konsumenterna jämför mot en självständigt känd originalhash: Node-utvinningen hashar aktuella bytes, filimporten hashar den valda filen eller den enda PDF-bilagan, och molnslutförandet använder det integritetskontrollerade jobbets hash. En decoder kan inte välja sin egen förväntade originalidentitet. PDF-hashen tas innan PDF.js kan överföra och koppla loss ArrayBuffer-minnet.

Beviset följer samma OCR-resultat genom Node-worker, lokal pull-worker, Sites molnslutförande, webbläsarens PDF-/bildtolkning och manuell fil-/EML-import. Gmail-förhandsvisningen skickar nu även bevis och oberoende originalhash när den tolkar texten med Gmail-riktning och metadata. Den behåller tidigare sparad tolkning enligt samma regler som förut.

OCR-råtexten ändras inte, och det ursprungliga avlästa bankgirot finns kvar i fältets evidens även när förslaget blir null. Den befintliga textutdragsgränsen och historiklagringen är oförändrade; detta är inget nytt löfte om obegränsad lagring av hela dokumenttexten. Konfidensspärren **0,85** och spärren för automatisk OCR-registrering är oförändrade. Native-PDF-tolkning kräver inte OCR-ordbevis.

## Oförändrade populationer och facit

| Population | Antal | Precision före → efter | Recall före → efter | Helt exakta dokument före → efter |
|---|---:|---:|---:|---:|
| Gamla alla raster, inklusive stress | 4 | 96,67 → 96,67 % | 70,73 → 70,73 % | 3 → 3 |
| Gamla läsbara raster | 2 | 100 → 100 % | 100 → 100 % | 2 → 2 |
| Gamla stressraster | 2 | 75 → 75 % | 20 → 20 % | 1 → 1 |
| Variantkorpusens alla raster | 10 | 95,28 → 99,01 % | 86,32 → 85,47 % | 5 → 4 |
| Variantkorpusens läsbara normalraster | 6 | 97,44 → 100 % | 97,44 → 96,15 % | 4 → 3 |
| Variantkorpusens läsbara säkerhetsraster | 2 | 91,67 → 100 % | 91,67 → 91,67 % | 0 → 0 |
| Variantkorpusens stressraster | 2 | 75 → 75 % | 20 → 20 % | 1 → 1 |

Samtliga 40 gamla textfall, 3 gamla native-PDF:er och 2 gamla scanned-PDF:er är fortsatt exakta. Variantkorpusens 14 textfall, 2 native-PDF:er och 2 scanned-PDF:er är också fortsatt exakta. Tabellen gäller båda parsermotorerna: de ger samma fältvärden och granskningsbeslut. Precision och recall avser samtliga 13 scalarfält i rasterfallen, inte bara bankgiro.

Parserns **tio obligatoriska registreringsfält** påverkas inte av denna bankgirospärr. Gamla raster har 22 TP / 0 FP / 9 FN: 100 % precision och 70,97 % recall. Variantkorpusens raster har 80 TP / 0 FP / 9 FN: 100 % precision och 89,89 % recall. De läsbara normalfallen har 100 % precision och recall för dessa tio fält i båda populationerna. Bankgiro, betalningsreferens och dokumenttyp ingår inte i det kompletterande tiomåttet.

De förstörda bilderna behåller hela sitt kända källfacit. Gamla bilden reducerades till 25 × 25 pixlar, den nya till 24 × 24. Inga ekonomiska värden kan återläsas. Att gissa den tidigare texten vore fel. Deras kvarvarande FP är dokumenttypen `other` i stället för `invoice`; de korrekta stressfälten kommer från riktningens metadata och den blanka bildens dokumenttyp.

## Verifiering

- De frysta ordbevisfallen gav **12/62 passerade och 50/62 fel** före parserändringen; efter ändringen **62/62**. De täcker global konfidens 99, gränsen 90, 89/0/saknad ordkonfidens, riktig fyrsiffrig sifferföljd, fel byte-/text-/sidbindning, motstridiga ord och värden samt dubbla förekomster och sidor.
- Parser-, producent- och faktiska PNG-workerprov: **82/82**, 35,67 s. De inkluderar 15 frysta primära OCR-observationer och två bytefrysta PNG-original. Källfacit och regelns förväntade avstående har separata fält i fixturefilen.
- Pull-, moln-, lokal-, manuell fil-/EML- och faktisk PDF.js/Tesseract-gränsverifiering: **147/147**, 35,37 s. Båda runnerlägena sparar samma råa digits/evidens och kräver kontroll även med konfidens 99. Fel original eller fel OCR-text ger inget förslag.
- Gmail-förhandsvisningens nya regression gick **3/4 → 4/4** när vidarebefordran lades till. Det positiva fallet visade att korrekt ordbevis annars försvann vid den andra parsningen.
- Den bredare fokuskörningen täckte 340 prov och gav först **338/340**. Två äldre rena parserprov skickade `method:'ocr'` utan ordbevis. De fick ett oberoende handbyggt bevispaket för samma syntetiska text; samtliga fältförväntningar behölls. Alla 40 prov i de två berörda Node-/Sites-filerna kördes om och passerade **40/40**, 2,20 s. Den verkliga bildens korrekt lästa ord med konfidens 89 behålls som avstående och FN i bildmätningen.
- De fem befintliga testladdarnas nya importmappningar pekar på den riktiga gemensamma bevismodulen. Assertions och ekonomiska förväntningar försvagades inte.
- Sites `tsc --noEmit --incremental false` passerade med stabil Node 24. Root ansvarar för full integrerad CI och produktionsgrindar.

## Tider och spårbarhet

| Node-medeltid per dokument | Före | Efter |
|---|---:|---:|
| Gamla native-PDF:er | 793 ms | 835 ms |
| Gamla raster | 2 746 ms | 2 816 ms |
| Gamla scanned-PDF:er | 3 422 ms | 3 978 ms |
| Variantkorpusens native-PDF:er | 1 797 ms | 742 ms |
| Variantkorpusens raster | 9 091 ms | 3 296 ms |
| Variantkorpusens scanned-PDF:er | 11 759 ms | 3 658 ms |

Gamla förevärden är den bevarade mätningen efter etikettfixen. Variantkorpusens förevärden mättes på `8b523d1` omedelbart före ordbevisimplementationen. Värdena är enskilda körningar på en delad maskin; variantkorpusens förekörning hade tydligt högre belastning. Tabellen bevisar **ingen generell förbättring av prestanda**. Full miljö, belastning, råa tider och båda motorerna finns i JSON-filen.

Båda efterkörningarna har `sourceStable:true` och samma källhash **`2175c4fcdac95813d225bd7a45c9a50eceb2aca4b1a3bac1155325833b15490d`**. Variantkorpusens före-källhash är `c50770cca2a32988f45f29cf4a6a8d2be1f7eb251f225c42aa70d4d133ef772f`. Korpus- och bytehashar matchar respektive tidigare körning exakt. Graderingskoden och facit är oförändrade; mätaren vidarebefordrar nu ordmetadata och beräknar förväntad originalhash från de verkliga provbyten.

- `documents-word-confidence-measurements.json`: före/efter, samtliga dokumentutfall, alla rasterfält, kvarstående fel, obligatoriska fält separat, rå OCR-text, ordbevis, källhashar, byte-manifest och miljö.
- `ocr-bankgiro-frozen-probe.json`: alla resultat från förundersökningens tre vägar, inklusive deras försämringar.
- `documents-evidence.md` och `documents-measurements.json`: den tidigare rapporten med hela ursprungliga 96,67/70,73-resultatet och före/efter för etikettfixen; de äldre observationerna är inte ersatta.

Upprepa med kommandona för `measure-ocr-quality.mjs` i den tidigare rapporten. Använd `--label-corpus` för variantpopulationen. Ingen ändring av beroenden, produktionsdata eller original behövs.

## Oberoende granskning och lång text

Den oberoende läsande granskningen av `8b523d1 → 9fd47ea` fann ingen blockerande säkerhetsregression. Den hittade ett P3-fall: `readInvoiceFile` returnerade högst 50 000 tecken för visning, men ordbeviset gällde hela OCR-texten. Gmails kontextuella omparsning av det korta utdraget höll därför även ett korrekt styrkt bankgiro i ett långt dokument.

Fyra nya regressioner reproducerade beteendet (**0/4 passerade**) före följdfixen. Importen behåller nu en separat `interpretationText` på högst 150 000 tecken, och Gmail använder den med samma originalhash, ordbevis och Gmail-kontext. **Visningstexten är fortfarande begränsad till 50 000 tecken.** Bevisets texthash räknas inte om för att godkänna ett avkortat prefix. Ett motstridigt bankgiro efter tecken 50 000 upptäcks i den fullständiga parsertexten; ett OCR-resultat över 150 000 tecken hålls fortfarande när dess fulla bevis inte kan styrkas inom gränsen.

De två berörda konsumentfilerna passerade tillsammans **66/66 tester**, 0 hoppade, på **8,92 s**, och Sites TypeScript-kontroll passerade. Följdfixen ändrar endast filimportens returvärde och Gmails textval samt dessa regressioner. Den mätta Node-workern, båda parsermotorerna, ordbevismodulen, korpusarna och graderingen är byteoförändrade. Eftermätningarnas källhash `2175c4fc…490d` och samtliga redovisade mätvärden gäller därför fortsatt samma mätta kod; ingen ny optisk prestandamätning påstås för denna UI-fix. Ursprungliga produktkällhashar ligger kvar i mätfilen, och följdfixens två nya filhashar redovisas separat i `documents-word-confidence-followup.json`.

Den oberoende läsande följdgranskningen bedömde därefter P3-fyndet som åtgärdat och fann inga nya blockerande fynd. Den granskaren körde inga tester; ovanstående test- och typkontrollresultat kommer från implementationens fokuskörning.

## Kvarstående gränser

Konfidens 90 är en konservativ utvecklingsregel, inte en kalibrerad sannolikhet eller garanti för rätt bankgiro. Ett högkonfident OCR-fel kan fortfarande förekomma på andra original. Bevispaketet kopplar en betrodd OCR-producent till dess källa; det är ingen fristående äkthetskontroll av ett bankkonto.

Bevisinsamlingen stöder en uttrycklig fristående etikett och sifferföljd på samma rad. Inlinefält med andra uppgifter, svår radbrytning och ofullständiga ord hålls. En blandad native-/OCR-PDF kan få ett korrekt bankgiro på en native-sida hållet eftersom dokumentet totalt har OCR-proveniens men den sidan saknar OCR-ord. Dessa avståenden ska mätas på fler format före utvidgat stöd.

Detta är ett litet, observerat utvecklingsunderlag. Den separata variantkorpusen var fryst före de första parserändringarna men har därefter använts för diagnos; den är inte längre ett statistiskt orört blindtest. En bredare bedömning kräver nya oberoende, dubbelt annoterade original med fler avsändarlayouter, typsnitt, komprimering, fotograferingsförhållanden, flera sidor och svåra betalningsidentiteter. Eventuella verkliga original måste hanteras separat med godkänd åtkomst; de ska inte läggas i git. Ingen av denna rapports mätningar demonstrerar minskad faktisk manuell granskningsvolym i produktion.
