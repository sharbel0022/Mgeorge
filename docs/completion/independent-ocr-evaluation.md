# Oberoende syntetisk OCR-mätning — 6 november 2026

**Målet är inte uppnått.** Det förregistrerade första provet gav **37,50 % recall** och **100 % precision på faktiskt lämnade bildfält** för både Node- och Sites-tolkaren. Målet var minst 85 % recall och 98 % precision. Fyra av sexton normala dokument fick ett tekniskt workerfel. Inget dokument blev grönt och inget blev fullständigt korrekt i alla obligatoriska fält. Noll falskgröna är därför inte ett belägg för användbar eller säker automatregistrering.

Detta är en ny, oberoende författad **syntetisk** korpus, `completion-independent-20261106`. Den ersätter inte saknad historisk V3-evidens och används inte som ett återfunnet gammalt prov. Produktkod, parserregler, modeller, bilder och facit ändrades inte efter utfallet. Ingen automatisk registrering eller extern OCR-tjänst användes.

## Primärt resultat

Normalgruppen innehåller 16 dokument och nio obligatoriska bildfält per dokument: fakturanummer, motpart, organisationsnummer, fakturadatum, förfallodatum, totalbelopp, nettobelopp, moms och valuta. Riktning är separat betrodd metadata och räknas inte som optiskt igenkänd information.

| Population och mått | Node | Sites |
| --- | ---: | ---: |
| Normala dokument | 16 | 16 |
| Förväntade bildfält | 144 | 144 |
| Korrekt lämnade värden, TP | 54 | 54 |
| Felaktigt lämnade värden, FP | 0 | 0 |
| Saknade eller felaktiga förväntade värden, FN | 90 | 90 |
| Precision, TP / (TP + FP) | 100,00 % | 100,00 % |
| Recall, TP / (TP + FN) | **37,50 %** | **37,50 %** |
| Abstentioner bland förväntade bildfält | 90 | 90 |
| Helt korrekta dokument, nio bildfält | 0 / 16 | 0 / 16 |
| Dokumentstatus, röd / gul / grön | 14 / 2 / 0 | 14 / 2 / 0 |
| Normala dokument med workerfel | 4 | 4 |
| Falskgröna, normal + stress | 0 / 19 | 0 / 19 |
| Förregistrerat recallmål 85 % | Ej uppnått | Ej uppnått |

Precisionen gäller 54 lämnade bildvärden och ska läsas tillsammans med de 90 abstentionerna. Den visar inte att 100 % av dokumenten är korrekta. Precision bland gröna dokument går inte att uppskatta här, eftersom det inte finns några gröna dokument.

Med den betrodda metadatariktningen inkluderad blir det 70 TP, 0 FP och 90 FN av 160 förväntade fält: **43,75 % recall** och 100 % precision. Skillnaden är exakt de sexton tillförda riktningarna; den är ingen optisk förbättring. Fullständig dokumentträff är fortfarande 0/16.

Node och Sites fick samma observation för varje dokument. Deras fullständiga fältobjekt och effektiva status var identiska i samtliga 19 par. De 38 parseranropen är därför inte 38 oberoende optiska prov. Resultaten och de enskilda jämförelserna finns i [scores.json](evidence/completion-independent-20261106/scores.json).

### Vilka fält saknades?

Följande resultat är identiska för båda tolkarna. Varje bildfält har sexton förväntade värden. Samtliga FN i tabellen var abstentioner; inget felaktigt icke-tomt värde lämnades i dessa fält.

| Bildfält | TP | FP | FN | Recall |
| --- | ---: | ---: | ---: | ---: |
| Fakturanummer | 7 | 0 | 9 | 43,75 % |
| Motpart | 0 | 0 | 16 | 0 % |
| Organisationsnummer | 0 | 0 | 16 | 0 % |
| Fakturadatum | 9 | 0 | 7 | 56,25 % |
| Förfallodatum | 7 | 0 | 9 | 43,75 % |
| Totalbelopp | 7 | 0 | 9 | 43,75 % |
| Nettobelopp | 12 | 0 | 4 | 75,00 % |
| Moms | 0 | 0 | 16 | 0 % |
| Valuta | 12 | 0 | 4 | 75,00 % |

När ett fält aldrig lämnades, såsom motpart, är dess egen precision odefinierad, inte 100 %. De fullständiga fältmåtten bevarar detta som `null`.

De fyra workerfelen bidrar med 36 av de 90 saknade bildvärdena. De övriga 54 saknas trots att en optisk observation returnerades. Som **separat efterhandsdiagnostik**, villkorad på slutförd OCR, får de tolv återstående normala dokumenten 54 TP, 0 FP och 54 FN av 108 bildfält: **50,00 % recall**. Den siffran ersätter inte det förregistrerade utfallet på alla sexton dokument och uppfyller inte heller recallmålet. [Den oberoende omräkningen](evidence/completion-independent-20261106/verification-receipt.json) styrker båda nämnarna.

### Stressfallen hålls separat

Stressgruppen består av tre bilder: mycket låg kontrast, beskuren dokumenttopp och motstridiga totalsummor. Alla var förregistrerade som granskningskrävande. De gav 8 TP, 0 FP och 19 FN av 27 bildfält: **29,63 % recall**, 100 % precision på de åtta lämnade värdena och 0/3 fullständigt korrekta dokument. Alla tre blev röda och inget blev falskgrönt. Med riktning inkluderad är recall 11/30, eller 36,67 %.

Stressresultaten ingår inte i normalgruppens 37,50 %. Bankgiro och betalningsreferens saknades avsiktligt i hela korpusen; inget sådant värde uppfanns. Det provar frånvaro och avhållsamhet, inte igenkänning av giltiga betalningsuppgifter.

## Faktiska anrop och tekniska fel

Det första optiska försöket började **15:09:11.631 UTC**. Körningen avslutades **15:10:48.569 UTC**. Den gjorde exakt **19 anrop till den befintliga `runDocumentProcess`**, ett per fryst bild, och exakt **38 parseranrop**, ett per tolkare och observation. Femton workeranrop gav färdiga optiska observationer; fyra avslutades innan något IPC-resultat kom. De fyra felen återkördes inte. Inga parserundantag inträffade.

| Fall | Population | Försök | Tid | Observerat tekniskt fel |
| --- | --- | ---: | ---: | --- |
| N01 | Normal | 1 | 6 843 ms | Worker avslutades före IPC-resultat |
| N02 | Normal | 1 | 2 888 ms | Worker avslutades före IPC-resultat |
| N06 | Normal | 1 | 3 458 ms | Worker avslutades före IPC-resultat |
| N10 | Normal | 1 | 3 876 ms | Worker avslutades före IPC-resultat |

Det bevarade undantaget är `Error: worker`. Stacken pekar på `ChildProcess.<anonymous>` i `src/invoice-extraction.js:305:58`, följt av engångslyssnaren, `ChildProcess.emit` och `_handle.onexit`. Den oförändrade produktwrappern använder `stdio: ignore` och ersätter barnprocessens exit med det generiska undantaget. Förstapasset har därför **ingen fångad exitkod, signal eller worker-stderr** för dessa fyra fall. En mer specifik rotorsak kan inte utläsas ärligt ur den bevarade observationen. De 19 anropen ska inte beskrivas som 19 verifierat slutförda Tesseract-igenkänningar.

Efter förstapasset utfördes ett separat modulladdningstest av `src/invoice-worker.js` utan IPC-meddelande eller bild. Det avslutades med kod 0 och tom stderr. Båda installerade svenska språkfilerna klarade gzip-CRC. Dessa kontroller gjorde inga OCR- eller parseranrop och utesluter inte fel under själva igenkänningen. Efterhandsläsning av cgroup- och memory-pressurefiler misslyckades eftersom filerna inte är tillgängliga i miljön; inga minnesfel eller signaler tillskrivs körningen utan belägg. [Diagnostiken](evidence/completion-independent-20261106/post-run-setup-diagnostics.json) och [de misslyckade systemavläsningarna](evidence/completion-independent-20261106/infrastructure-diagnostics.json) är bevarade.

Körprocessens exitkod var 0, vilket betyder att experimentet slutfördes och sparade även de negativa resultaten. Det betyder inte godkänd OCR-kvalitet. Processen tog 98,85 sekunder inklusive uppstart; `RUSAGE_CHILDREN` rapporterade högsta RSS 394 368 KiB. Medianen för ett workerförsök var 5 017 ms, med intervallet 2 888–8 494 ms. Körningen var sekventiell och saknade konkurrerande tunga jobb från det samordnade agentarbetet. Värdena beskriver denna delade körmiljö och är ingen produktionsgaranti. [Resurskvittot](evidence/completion-independent-20261106/process-resources.json) innehåller de exakta observationerna.

## Fryst metod och oberoende

Utvärderaren skrev inte parsern. Innan korpusen frystes lästes endast de namngivna körharnessernas I/O-kontrakt, paketmetadata, workerfilnamn samt de obligatoriska/kritiska fältkonstanterna. Tidigare OCR-fixturer, facit, utvecklingsresultat och parserimplementation användes inte för att författa korpusen. Källgränssnittet kontrollerades efter frysningen för exekvering, utan ändring av produktkoden eller anpassning till resultat.

Protokollet deklarerades **14:38:36.588 UTC**. Bilder, facit, renderingskod och körplan frystes **15:02:48.030 UTC**, före alla optiska och parseranrop. Det ursprungliga manifestets SHA256 är:

```text
246ea4ac2f60d7567fddd2ee57cd7c48bc3f23a4a2b902a1f3fab30ece12781c
```

Frysningen omfattar 23 filer: 19 rasterbilder och fyra protokoll-/korpus-/generatorfiler. Körkod, jämförelsekod, källor och installerade beroenden fick en ytterligare bindning **15:09:10.114 UTC**, före första optiska anropet. De ursprungliga frysfilerna skrevs inte om. Tiderna kommer från lokala kvitton och körledger; den samlade evidenscommiten skapas efter experimentet och ska inte beskrivas som en tidigare extern tidsattestering. Se [ursprungsmanifestet](evidence/completion-independent-20261106/freeze-manifest.json), [protokollet](evidence/completion-independent-20261106/predeclared-plan.md) och [runtime-bindningen](evidence/completion-independent-20261106/runtime-binding.json).

Körningen använde funktionsbaslinjen `6b1d0c71214395d2d8294b5823bc015b97e51909`. Jämförelse med den mergade kandidaten `24390ef7e8cf6b2274c57804dc9c2d74d362ab12` visar oförändrade exekverade worker-/parserkällor. Den enda ändrade filen inom de 201 registrerade `src/`- och `sites/lib/`-filerna är separat banktjänstkod, `sites/lib/banking/service.ts`. Inga produktkodändringar ingår i denna utvärderingsleverans.

Runtime var Node 24.22.1, Tesseract.js 6.0.1, Tesseract.js-core 6.1.2 och det lokala paketet `@tesseract.js-data/swe` 1.0.0. Exakta paket-, native- och modellfiler är hashade i runtime-bindningen. Den oförändrade workern använder svensk modell även för de engelska fallen. Den kördes med lokala beroenden i en isolerad worktree och en tömd miljö med endast PATH, TEMP och LANG. Ingen uppvärmningsbild, produktionsdata, liveleverantör eller registreringsåtgärd ingick.

Varje optisk observation skickades oförändrad till båda tolkarna med sitt verkliga OCR-säkerhetsvärde och hashbundna positionsbevis. Goldriktningen `incoming` mappades före första anropet till produktens `supplier` med `direction_confident: true`; jämförelsen mappar tillbaka denna enum. Bildfältens säkerhetsvärden ändrades inte. Den befintliga workergränsen på 90 sekunder behölls, inom körplanens maximala 120 sekunder. [Runtime-noteringen](evidence/completion-independent-20261106/runtime-audit.md) dokumenterar dessa val före utfallet.

Jämförelsen använder de förregistrerade exakta kanoniseringarna, heltalsbelopp i minsta valutaenhet och abstention vid null, saknat eller tomt svar. Ett felaktigt icke-tomt svar skulle ge både FP och FN. Falskgrönt innebär produktens faktiska gröna status tillsammans med processfel, granskningskrav, fel/saknat kritiskt värde eller påhittad frånvarande betalningsuppgift. Effektiv status blir röd vid processfel, medan den ursprungliga parserstatusen bevaras.

En annan agent granskade efteråt enbart protokoll, runtime-notering och scorer, utan korpus eller observationer. Granskningen identifierade indataantaganden att kontrollera: fullständigt facitschema, unika fall och fasta populationsnämnare samt felpropagering. En separat mekanisk verifiering styrkte alla dessa, exakt ett optiskt försök och två parseranrop per fall, oförändrade arkivbytes och en oberoende omräkning av TP/FP/FN. Scorern och dess ursprungliga resultat ändrades inte. [Verifieringskvittot](evidence/completion-independent-20261106/verification-receipt.json) redovisar kontrollen.

## Vad resultatet kan och inte kan visa

Materialet består av åtta svenska och åtta engelska normalfall, fyra layouter samt ren utskrift, gråskala, lätt rotation och skanningsliknande brus. Alla uppgifter är författade testuppgifter. Varje faktura har en rad och 25 % moms. Underlaget är litet och avsiktligt konstruerat; det är inte ett slumpmässigt urval av kundernas fakturor.

De syntetiska organisationsnumren använder avsiktligt en ogiltig `000000-…`-form för att undvika verkliga identiteter. Normala engelska dokument använder EUR, medan parserns observerade validering anger att registret endast stöder SEK. Dessa val minskar representativiteten för giltiga svenska registreringsunderlag och påverkar avhållsamhet och dokumentstatus. De behålls i den ursprungliga nämnaren. Provet kan därför inte beskrivas som ett representativt acceptanstest på fullt giltiga produktionsfakturor. Det skiljer inte heller helt optiska teckenfel från regler som avsiktligt avstår från att lämna ett annars synligt värde.

Språk, valuta och layout är delvis sammanbundna i konstruktionen: svenska använder layout 0/2 och engelska layout 1/3. Svenska normalfall fick 29/72 bildfält och engelska 25/72, men skillnaden är inte ett isolerat språktest. Bilder och facit kommer från samma författade källfakta; det finns ingen separat mänsklig dubbeltranskription av alla bilder. Två bildexempel granskades visuellt efter det färdiga provet, utan ändringar.

De nominella 95-procentiga Wilson-intervallen för normalgruppens bildfält är **93,36–100 % precision** och **30,01–45,64 % recall**. De är beskrivande fältintervall; fält på samma faktura och återanvända layoutfamiljer är korrelerade. De ska inte användas som ett statistiskt bevis för minst 98 % precision i verklig drift. Inte ens det förenklade precisionsintervallets nedre gräns når 98 %.

Sites-resultatet avser dess fälttolkare efter samma lokala Node-worker. Browserns egen optik, molntransport, uppladdning och registreringsflöde prövades inte här. Noll falskgröna tillsammans med noll gröna dokument visar endast att inget osäkert dokument godkändes i detta prov; användbar automatisk registrering är fortfarande obevisad.

Den första körningen är nu bevarad som ett negativt kvalitetsresultat med fyra tekniska fel. Nästa arbete behöver särskilja workerdiagnostik från återstående fältavhållsamhet och använda en ny förregistrerad, oberoende korpus med relevanta giltiga syntetiska fakturor för en framtida acceptansbedömning. Ett eventuellt separat infrastrukturexperiment på dessa bilder måste märkas som en senare körning och får inte ersätta detta första prov.

## Levererad evidens

Alla frysta bilder finns portabelt i [frozen-images.tar.gz](evidence/completion-independent-20261106/frozen-images.tar.gz), cirka 2,38 MB. Samtliga ursprungliga optiska observationer, båda parserresultaten, ledger och körkvitto finns i [raw-first-pass.tar.gz](evidence/completion-independent-20261106/raw-first-pass.tar.gz), cirka 23 KB. En lättläst vy av den faktiska OCR-texten finns i [optical-observations.json](evidence/completion-independent-20261106/optical-observations.json). Arkiven innehåller de ursprungliga bytesen, inte förbättrade eller omgenererade observationer.

Den ursprungliga råkatalogen är `/workspace/scratch/aab0f7dc06f9/independent-ocr-raw/completion-independent-20261106`. De portabla arkiven bevarar bilder och observationer även om den katalogen senare försvinner. [Evidensöversikten](evidence/completion-independent-20261106/README.md) beskriver varje fil och hur hela underlaget kan verifieras utan nya OCR- eller parseranrop.
