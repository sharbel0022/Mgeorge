# Agent 3 — AI/OCR, Gmail och tillförlitlig fakturatolkning

Branch: `feature/95-ocr`. [PR #52 mot main](https://github.com/sharbel0022/Mgeorge/pull/52). Ursprunglig bas: `4ad205b84d1852ec7ed33cabd70fdadbe2f9d5c5`. Integrerad main: `bf24a3c52ffc637d1e7bbc4d4f64a1732dcd9fee`.

## Omfattning och evidensgräns

Leveransen förbättrar befintlig fakturatolkning, OCR-arbetarens återhämtning och dokumentkön. Ändringarna ska granskas i en PR mot `main`. Produktionskontrollerna är läsande. Inga kundoriginal, fakturabelopp, registreringar, bankdata, hemligheter, scheman eller Sites-versioner ändras av uppdraget.

Syntetiska text-/bild-/PDF-prov och faktiska produktionsobservationer redovisas separat. En lyckad testsamling är inte ett mått på precisionen i kundens observerade dokument. Något manuellt märkt produktionsfacit har inte skapats och någon generell 9,5/10-bedömning utfärdas inte.

## Verifierat produktionsläge

Se det maskerade [observationskvittot](../measurements/95-ocr-production-observations.json).

| Observation | Vid uppdragets start | Läsning 2026-11-05 18:24 UTC |
| --- | ---: | ---: |
| Behöver granskning | 350 | 362 |
| Väntar på OCR | 15 | 11 |
| Väntar på serverns texttolkning | 0 | 0 |
| Jobb i tillståndet registrerad | 2 | 2 |

Gmail hade vid den senare läsningen en lyckad hämtning 18:05:02 UTC. En mellanliggande läsning 18:03 visade 350 för granskning, 17 OCR-väntande och 3 textjobb. Inflöde och behandling på main pågick samtidigt som arbetet. Skillnaderna i kön är inte ett resultat av denna ännu odriftsatta branch.

Vid start och läsningen 18:03 var molnarbetarens senaste kontakt 10:45:29 UTC och senaste sparade OCR-resultat 03:02:55 UTC. Den då senaste returnerade schemakörningen [42013301104](https://github.com/sharbel0022/Mgeorge/actions/runs/42013301104) hade `processed:0, failed:0`. Det förklarade varför historisk grön driftstatus inte räckte som belägg för aktuell genomströmning.

Vid kontrollen 18:24 fanns en ny faktisk schemakörning: [42083409804](https://github.com/sharbel0022/Mgeorge/actions/runs/42083409804), skapad 18:21:17 på main `bf24a3c`, avslutad med `processed:6, failed:0` enligt den hämtade jobbloggen. Tjänsten bekräftade molnkontakt 18:23:26, sparat resultat 18:23:31 och `cloud_worker_recent:true`. Den lokala arbetaren var fortfarande inte nyligen aktiv. Den externa körningen utlöstes inte av denna uppgift och körde inte PR-grenen. Den bevisar en aktuell behandling av sex dokument, inte återkommande tillgänglighet, korrektheten i deras fakturafält eller en kapacitet per timme.

Workflowmetadata-endpointen avvisades tidigare, så enable/disable-inställningen lästes inte. Den senare faktiska körningens event var `schedule`. Gmails separata externa schemaverifiering var fortfarande falsk, och status rapporterade två väntande meddelanden samt `postprocessing_pending`; därför påstås inte att hela bakgrundskedjan är färdig.

Alla sidor i `document_jobs` lästes före den senare schemakörningen, men Gmail ändrade tabellen under sidindelningen. Den läsningen är därför ingen atomisk inventering och dess sidtotaler används inte som köantal. De väntande jobb som då lästes hade noll försök, tom felkod och ködatum efter den då senaste molnkontakten. Ingen förbrukad återförsöksbudget är belagd som orsak till den inspekterade produktionskön.

Granskningsorsakerna vid den sista läsningen är överlappande observationer av sparad tolkning: 361 saknade verifierad motpart, 300 hade osäkra fält, 256 saknade organisationsnummer, 197 datum, 151 motpart, 153 moms/netto, 134 giltigt totalbelopp och 112 fakturanummer. Alla 362 granskningsposter ingick i orsaksräkningen. Vid start var motsvarande antal för verifierad motpart och osäkra fält 349 respektive 288. En OCR-körning kan inte i sig skapa den uttryckliga motpartsverifiering som saknas.

## Fakturaextraktion: samma syntetiska facit före och efter

Node och Sites har samma avgränsade rättningar:

- Engelska `Net`, `Total`, `VAT amount` och `Total VAT` identifieras som dokumentfält med bibehållen kontroll av hela värdet. Ett nytt, motstridigt `Total` kan därmed inte ignoreras medan en svensk summa lämnas grön.
- Engelska grupperade belopp såsom `3,750.00` accepteras bara med fullständiga tresiffriga grupper och uttrycklig decimalpunkt. Felaktiga grupper och tvetydiga värden lämnas för granskning. Originaltexten bevaras som belägg.
- `VAT rate: 25 %` är en procentsats och får inte ersätta eller ogiltigförklara ett separat angivet momsbelopp.
- Betalningsvillkor som `Net 30`, `Net: 60` och ett radbrutet `Net`/`90` får inte bli nettobelopp, även om övriga belopp råkar passa matematiskt. Ett ensamt engelskt `Net` med heltal kräver mer belägg; uttryckligt `Net amount`, decimaler eller valuta stöds fortsatt.
- Summeringsrader utan kolon avslutar artikeltabellen bara när de innehåller ett fullständigt belopp. Artikelbeskrivningar och leverantörsnamn som börjar med `Net` eller `Total` får inte försvinna. Fortsatta sidor och motstridiga fakturaidentiteter provas separat.

Befintliga regler för netto + moms = total, radberäkningar och momssats, organisationsnummer, bokstavliga faktura-/OCR-referenser, dubbletter och motpartsverifiering behålls. Värden härleds inte för att fylla saknade nettobelopp eller moms. Den optiska confidence-gränsen behålls: hög OCR-confidence innebär fortfarande manuell granskning och blir inte automatiskt verifierad finansiell evidens.

Mätningen omfattar **15 deklarerade syntetiska textfall ×13 fält**, körda i båda motorerna. Båda ger följande identiska resultat. De 13 fälten är fakturanummer, motpart, organisationsnummer, fakturadatum, förfallodatum, total, moms, netto, betalningsreferens, Bankgiro, riktning, dokumenttyp och valuta. Tabellstatus, antal rader och granskningsbeslut bedöms dessutom per fall; de ingår inte i fältprecisionens nämnare.

Riktningen är given i den syntetiska mejlmetadatan. Fältmåttet gäller alltså de deklarerade utdata med den kontexten, inte en separat mätning av hur väl riktningen kan härledas. Artikelvärden, fullständig mottagaridentitet och andra betalningsformat får inget 100-procentigt precisionspåstående från denna 13-fältstabell.

| Mått, per motor | Ursprunglig bas `4ad205b` | Ny main `bf24a3c` | Sammanfogad branch |
| --- | ---: | ---: | ---: |
| Exakta fält, inklusive nödvändiga tomma värden | 178/195 =91,28 % | 178/195 =91,28 % | 195/195 =100 % |
| Precision bland returnerade, icke-tomma fält | 172/173 =99,42 % | 172/173 =99,42 % | 188/188 =100 % |
| Återfunna korrekta värden bland förväntade, icke-tomma fält | 172/188 =91,49 % | 172/188 =91,49 % | 188/188 =100 % |
| Helt korrekta fall, inklusive granskningsbeslut | 8/15 | 8/15 | 15/15 |
| Korrekt hanterade positiva fall | 2/7 | 2/7 | 7/7 |
| Felaktigt gröna resultat bland uttryckligen osäkra fall | 1/8 | 1/8 | 0/8 |

Precision är TP/(TP+FP) och recall är TP/(TP+FN). Ett felaktigt icke-tomt värde räknas som FP och även FN när ett annat icke-tomt värde förväntas. Korrekt avstående räknas separat: före TP172/FP1/FN16/korrekt tomt6, efter TP188/FP0/FN0/korrekt tomt7. Det finns **15 unika fall**, inte 30 oberoende dokument; motorerna delar samma facit.

[Ursprunglig baslinje](../measurements/95-ocr-extraction-before.json), [ny main-baslinje](../measurements/95-ocr-extraction-main-before.json) och [sammanfogat resultat](../measurements/95-ocr-extraction-after.json) innehåller samma korpus-hash, källfilshashar, definitioner och fel per fall. Korpus-hash: `40e6dac4e240e0f23a2e2c414a3897cde4cef7f0d9508bb7ff572c86e02f9137`. Båda baslinjerna kördes mot separata git-arkiv med samma mätare och facit. Ny main har samma utfall på just dessa 15 fall; dess förbättrade svenska summeringar och identitetsgränser har egna regressioner och tillskrivs inte denna PR. Aktuell mätning kan upprepas med `node --experimental-strip-types scripts/measure-invoice-reliability.mjs --output /tmp/95-ocr-extraction.json`; `--source-root` väljer ett annat källträd.

**Detta är riktad textregression, inte ett representativt optiskt riktmärke eller produktionsprecision.** Tolv ytterligare gränsfall per motor ingår i regressionstesterna men inte i tabellens fasta 15-fallsmätning. Den oberoende granskningen hittade betalningsvillkoret `Net 30` utanför den fasta korpusen; den nya tolkningen kunde först felaktigt bli grön. Fem varianter per motor observerades röda före korrigeringen, och den slutliga oberoende gruppen passerade 54/54. Befintliga tester med faktiska syntetiska PDF-/bildbytes och Tesseract körs också i fullsviterna. Inga nya kundoriginal eller påhittade OCR-resultat används.

### Separat prov med verklig OCR av syntetiska bytes

Ett rent engelskt prov med grupperade decimalbelopp renderades med repositoryts befintliga PDF-/bildhjälpare och kördes genom den verkliga barnprocessen, PDF-läsaren och Tesseract. [Det separata kvittot](../measurements/95-ocr-english-smoke.json) innehåller fält, confidence, metod och oförändrade originalhashar.

| Egenskap | En PNG | En text-PDF |
| --- | ---: | ---: |
| Exakta fält, samma 13-fältsschema | 13/13 | 13/13 |
| Metod | `ocr` | `pdf` |
| Arbetarens confidence | 93 | 100 |
| Extraktionsnivå | Gul, granskning krävs | Grön extraktion |
| Fältconfidence, utom metadata-riktning | 0,85 | 0,96 |
| Observerad körtid, en körning | 5 347 ms | 2 291 ms |
| Originalets SHA-256 före/efter | Oförändrad | Oförändrad |

Riktningen tillfördes som kontrollerad syntetisk metadata; övriga tolv värden tolkades från dokumenttext. Grön PDF-extraktion betyder inte registrerad eller verifierad motpart. Ingen registrering gjordes. Detta separata prov genomfördes före integrationen av ny main; dess exakta källsnapshot och körningstidpunkt registrerades inte, så kvittot används inte som verifiering av slutligt PR-huvud. De sammanfogade fullsviterna provar också verkliga syntetiska PDF-/bildbytes. Dessa två rena underlag är ett begränsat funktionellt prov, ingen skattning av optisk produktionsprecision eller kapacitet.

## Köhantering och avbrutna jobb

### Nedladdning och kvittering i OCR-arbetaren

Nedladdningen låg tidigare i samma felhanterare som OCR. Ett avbrutet nätverkssvar kunde därför skickas tillbaka som misslyckad tolkning, trots att OCR aldrig hade körts. Nu avslutas överföringen separat. Vid ett tillfälligt nätverks-, ström- eller serverfel tillåts ett enda nytt GET-anrop med samma jobblås, från byte noll; originalets exakta storlek och SHA-256 kontrolleras före OCR.

Autentiseringsfel, omdirigeringar, 429, för stor fil och svar med `Retry-After` får inget omedelbart nytt försök. Ett kvarstående överföringsfel lämnar jobbet åt den beständiga köåterhämtningen. Lease-/process-/completion-POST upprepas inte när svarets utfall är osäkert. Befintliga storleks-, sid-, tids- och samtidighetsgränser bevaras.

Arbetarens räknare behåller nu både accepterade resultat och uttryckligen kvitterade OCR-fel när ett senare anrop avbryts. Ett lokalt fel vars kvittering tappas eller avvisas räknas inte som ett accepterat fel. Det rättar två reproducerade brister i delvis genomförda körningar. Kända utfall redovisas med `status_unknown` för den osäkra fortsättningen; det skapas inga påhittade resultat.

### Sparad tolkning på sista försöket

Ett syntetiskt SQL-/R2-prov reproducerade ett konkret fel: tredje försöket sparade ett unikt tolkningskvitto, men fortsättningen avbröts innan slutstatus skrevs. När jobblåset löpte ut markerade den gamla koden jobbet som misslyckat och förbrukat, trots att dess tolkning fanns kvar.

Återhämtningen kontrollerar nu samma ägare, dokument, aktuella jobblås, dess hashade kör-id, exakt beständigt tolkningskvitto och originalets SHA-256/storlek. En villkorad skrivning kontrollerar återigen källa, dokumentmetadata och att ingen registrering redan finns. Högst två sådana återhämtningar görs per köanrop. Resultatet blir `needs_review` med `processing_interrupted_after_extraction`; det sker ingen ny OCR-körning eller automatisk registrering. Tidigare tolkning, historik och original bevaras.

Motprov för ett äldre jobblås, saknad historik, ändrat original och avvisning under originalläsningen stannar utan återställning till granskning. Befintlig hantering av första/andra försök och sena dubbla svar bevaras.

### Läsande driftstatus

`processingStatus` tillför `queue_health` och `throughput` utan nya tabeller eller migrationer:

- Köarbete som är redo för texttolkning respektive OCR, uppskjutna försök, aktiva jobblås, utgångna återtagbara lås och förbrukade försök.
- Äldsta väntande original och tid för nästa uppskjutna försök.
- En uttrycklig signal när OCR-jobb är redo men ingen lokal eller konfigurerad molnarbetare nyligen har hörts av.
- Antal unika dokument med ett accepterat tolkningskvitto och aktuell slutstatus under ett uttryckligt 24-timmarsfönster. Historiska omtolkningar räknas inte flera gånger och avbrutna fortsättningar räknas inte som avslutade.

Sammanställningen är ägaravgränsad och använder `EXISTS`/unika dokument så att flera Gmail-källor inte multiplicerar ett jobb. Den läser inga original eller dokumentvärden till svaret. Saknade/ogiltiga värden i vyn visas som okända. Dygnet avser observationstidpunkten; det är inget kapacitetslöfte.

Granskningsorsakerna skiljer dessutom belopps-/momskonflikter, oklara/motstridiga identiteter, ofullständiga artikeltabeller och sparade tolkningar efter avbrott. Ursprungliga orsaker och gränsen på 500 analyserade granskningsposter bevaras.

### Äldre dokument kan öppnas från granskningskön

Den oberoende genomgången reproducerade ytterligare ett köhinder: översikten skapade en granskningsuppgift för ett gammalt underlag, men Gmail-status begränsade de senaste källposterna till 200 innan klienten tog bort dubbletter. Underlaget saknades då i listan som den fokuserade granskningsvyn kunde öppna. Redan två dokument kunde framkalla problemet om det ena hade 200 senare Gmail-källor.

Status väljer nu en deterministisk senaste källa per ägt dokument före gränsen på 200 dokument. Ett uttryckligen valt dokument prioriteras inom samma gräns. Främmande ägare och avvisade dokument tas inte med; ett äldre källobjekt kan inte återinföra ett senare avvisat dokument. Både route, statusanrop och sidans dokumentnyckel följer det valda id:t. Den sammanfattande statusvägen är oförändrad och läser inga original.

Regressionen använder 350 påhittade dokument och 210 upprepade källor: resultatet är 200 unika dokument och det äldsta valda underlaget kan öppnas. Statusläsningen gör inga originalanrop eller SQL-skrivningar. Fyra navigationsfall misslyckades före rättningen; den fokuserade Gmail-/preview-/driftgruppen passerade 140/140. Ett separat rött sidnyckelfall rättades och hela previewgruppen passerade 33/33. Översiktens länkar ger åtkomst till äldre poster; den vanliga Gmail-listan är fortsatt begränsad, utan ny obegränsad hämtning.

## Verifieringsjournal

- Befintlig fokuserad baslinje: 97/97 kö-, moln-OCR- och statusprov passerade.
- Tre nya köobservationsprov misslyckades mot gammal kod och passerade efter rättning.
- Sista-försöket-provets faktiska utfall ändrades från `failed` till `needs_review`; fyra negativa skyddsprov passerar.
- Två nya komponentprov för driftstatus misslyckades före ändringen och passerade efteråt.
- Separat test för de fyra nya granskningsorsakerna misslyckades före ändringen och passerade efteråt.
- Fokuserad Gmail-/kö-/komponentverifiering: 137/137, utan fail/skip/cancel/TODO.
- Arbetarens första transportregressioner: 10 misslyckade och 1 passerat före rättning. En oberoende granskning av räknarna följdes av 7 misslyckade testfall före rättningen. Slutlig fokuserad transport-/pull-verifiering: 58/58, inklusive 17 nya fall.
- Slutlig parserkorpus och extra gränsfall: 54/54 i de två motorerna, inklusive den oberoende `Net 30`-regressionen.

### Integration av parallella main-ändringar

Efter att PR #52 skapades hade main avancerat till `bf24a3c` genom PR #48. Fyra parserfiler hade överlappande ändringar. Konflikterna löstes i `feature/95-ocr`; inga ändringar slogs in i main av denna leverans. Main-versionens svenska momskvalificerade summeringsrubriker, begränsade återhämtning över styckesluckor, skydd för radbrutna fakturaidentiteter och sidgränser bevaras tillsammans med denna PR:s rättningar.

Den fokuserade sammanfogade parser-/evidensgruppen passerade **204/204**. En oberoende granskare passerade dessutom **94/94** sammanfattnings-/reliabilitetsprov och kontrollerade kombinationer av svenska rubriker med engelska grupperade belopp, flersidiga tabeller, `Net` följt av en tom rad och `30`, samt separata leverantörs-/mottagaridentiteter. Dessa överlappande grupper adderas inte till fullsviternas antal. Gmail-integrationen granskades separat mot båda föräldrarna; main-versionens försiktiga driftstatus och denna PR:s fokuserade dokumentval bevaras. Det inkommande OCR-workflowet och dess verifieringsskript är oförändrade från main.

### Fulla slutgrindar

Det tidigare [verifieringskvittot före integration](../measurements/95-ocr-pre-integration-verification.json) bevarar **1 945 Node +3 801 Sites +47 brygga =5 793** godkända tester och tillhörande kontroller för den dåvarande koden. Det återanvänds inte som bevis för den nya runtime-kombinationen.

Alla fullsviter och källberoende kontroller kördes om på den sammanfogade koden, fryst 18:18:14 UTC. Det maskinläsbara [slutkvittot](../measurements/95-ocr-verification.json) innehåller kommandon, antal, körtider, logghashar och hash för varje ändrad käll-/testfil relativt ny main. Samtliga 742 frysta käll-/konfigurationsfiler hade oförändrade hashvärden efter körningarna. Lokal miljö: Linux, Node 24.22.1, npm 11.9.0. GitHub-flödets separata Node 22-resultat redovisas på PR-huvudets kontroller och härleds inte ur den lokala körningen.

| Grind | Resultat |
| --- | --- |
| Node `NODE_ENV=test npm run test:isolated` | **2 043/2 043** |
| Sites isolerade helsvit, externa Cloudflare-anrop avstängda | **3 895/3 895** |
| Bryggans isolerade helsvit | **47/47** |
| Summa fullsviter | **5 985 passerade; 0 fail/skip/cancel/TODO** |
| Rotens syntaxkontroll | 183 JavaScript-filer, exit 0 |
| Sites TypeScript-kontroll | Exit 0 |
| Sites produktionsbygge | Exit 0 |
| Bryggans syntaxkontroll | Exit 0 |
| Exakt installerad minimatch-rättning | Verifierad, 1 mål, 0 ändringar vid slutkontrollen |
| Auditgrindar | Root/brygga: 0 fynd. Sites: 8 befintliga moderate, 0 high/critical. Tidigare samma-session-audit återanvänds efter identiska manifest-/låshashar; ny CI gör egna auditkontroller. |

Riktade grupper överlappar helsviterna och ska inte adderas som extra täckning. Separat agentgranskning omfattade kö/status, arbetare, navigering, parser och den sista testanpassningen; inga kvarstående Critical/Important-fynd fanns efter rättning. Framgång på syntetiska prover innebär inte att kunddokument eller motparter är verifierade.

## Miljöobservationer före integrationen av ny main

Standardinstallationen för Sites avbröts två gånger med exit 137. Samma låsfil installerades sedan med begränsad Node-heap, en nedladdningsanslutning och avstängda installationsskript: 719 paket, följt av den obligatoriska, byteverifierade minimatch-rättningen. Manifest/låsfiler ändrades inte. En första teststart saknade obligatoriskt `NODE_ENV=test` och avvisades av isoleringsgrinden; den räknas inte som ett produktfel eller godkänt testresultat.

En tidig Sites-byggning avbröts med exit 137 under klientfasen. Det godkända bygget före integrationen använde 384 MiB Node-heap och en Rayon-tråd och avslutades med exit 0. En typkontroll med samma lilla heap avbröts med verifierad heap-OOM/exit 134; efterföljande typkontroll med 1 024 MiB passerade. Två heltester stoppades avsiktligt med exit 130 när den oberoende granskningen hittade `Net 30`, så att grinden kunde köras på den färdiga koden. Avbrutna försök räknas inte som godkända. Rotens och bryggans audit hade inga fynd; full Sites-audit hade åtta befintliga moderate och inga high/critical. De nya integrationsgrindarnas utfall redovisas separat ovan.

Heltesterna före integrationen identifierade även en föråldrad förväntan i de två befintliga dokumentkvalitetstesterna: ett giltigt engelskt `1,250.00 SEK` klassades som felaktigt format. Exakt två sådana fel reproducerades separat. Provet använder nu felaktiga `1,25.00`, medan nya positiva och negativa fall kontrollerar samma respektive motstridigt engelskt totalbelopp i båda ordningsföljderna. Alla 69 riktade prov passerade och teständringen granskades oberoende. Produktionskoden ändrades inte. Node-helkörningen startades om; Sites hade ännu inte laddat den berörda testfilen och dess godkända förintegrationskörning innehåller båda nya fallen. En överflödig, ännu pågående delkörning stoppades och räknas inte som godkänd verifiering.

## Kontroller inför produktionsacceptans

Efter normal granskning/integrering krävs ett separat kontrollerat driftsprov: verifiera schemakörning på den integrerade leveranscommitten och rätt origin över flera körningar, välj ett fåtal ägda original med facit, håll osäkra resultat för granskning, jämför fält/identiteter/belopp mot original och mät köförändringen utan massregistrering. Kontrollera återstart, provider-/nätverksfel och att dubbla körningar inte skapar dubbla skulder.

Inga numeriska produktionspoäng höjs innan dessa drift- och precisionsbevis finns. Aktuell verklig extraktionsprecision är okänd; behovet av granskning är fortsatt verifierat.
