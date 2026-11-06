# Oberoende slutgranskning av OCR-geometri och identitetsbindning

Datum: 2026-11-06.

## Beslut och exakt omfattning

**READY för den fullständiga granskade kedjan på `a19e0a8ce7a7ddedb85de1a8f9e21b617ba90b77`.** Inga konkreta Critical, Important eller Minor återstår i denna avgränsade granskning. Beslutet omfattar den nya horisontella OCR-associationen, `Faktureras till`-aliaset, gemensam tabellcensus samt de efterföljande namn- och organisationsnummergränserna.

Basen var `ae56dc9a9e3d76697e38a196692a337ae0900b0d`. Den ursprungliga geometrikandidaten var `6d6968dffa2eb68b8f2c217b598e3e7a9e86603f`. Mellanversionerna `06ba7f0` och `d3af785` var **inte godkända totalleveranser**, trots gröna tidigare delmatriser. Nya motprov visade ytterligare källbindningsfel, som behölls som blockerande tills slutversionen stängde dem.

Detta är en kod- och regressionsgranskning. Den är inte en ny optisk acceptansmätning och ger inget nytt betyg. V1/V2:s förstaprov ändrades inte. Granskaren läste inga V3-bilder, facit eller generatorer och gjorde inga OCR-, bank- eller produktionsanrop i denna granskning.

## Källbindning

Följande produktfiler ingår i den granskade slutkällan. De två detailparserna är byteidentiska.

| Fil | SHA-256 |
|---|---|
| `sites/lib/ocr-layout.js` | `b9c22df11bf317e7d0c3cb880f3c810c73b948fa6f694214c07ac80e1a066d76` |
| `src/invoice-details.js` och `sites/lib/invoice-details.js` | `8525da588b94ac7c7bc967b40b7051bea85c21ea881319dbe5d38ab9e2ca101d` |
| `src/invoice-extraction.js` | `7da29d442cbdbee18833fae0b93f276a5a3d4d12dc7dc3b774deb9ff1dfc029e` |
| `sites/lib/invoice-fields.js` | `e7f2ecd75e56cd82f1296234daf1bb11886f743a2ee84d233119f7588ba9b4e2` |

Slutgranskningen bygger på den fullständiga produktdiffen, exakta utdrag av scalarregistreringen och roots byteverifierade git-archive-snapshot av samma SHA. Ingen worker-, OCR-motor- eller konfidensregel ändrades av dessa följdfixar.

## Reproducerade fynd och stängning

### 1. Kolonetiketten kunde svälja en andra roll

`Faktureras till: Syntetiska Mottagaren AB Leverantör Syntetiska Säljaren AB` kunde i `6d6968d` bli ett sammanslaget mottagarnamn och en grön native PDF. Även en okänd kolonetikett eller en upprepad kolonlös mottagarroll kunde absorberas. Basen höll namnet okänt.

Orsaken var att konkurrerande roller och okända kolon bara kontrollerades när den första namnetiketten saknade kolon. `27caeb3` tog bort detta undantag och behöll varje ogiltig förekomst i samma census. Den oförändrade oberoende 40-matrisen gick från **24 pass / 16 fail** till **40/40**. Legitima enskilda mottagare och två fullständigt uttryckliga kolonroller bevarades.

### 2. Layouten saknade tabellrubriker som konsumenten redan kände

Layoutens egen rubrikgrammatik missade bland annat `Artikel/Antal`, `Item/Quantity` och `Beskrivning/Kvantitet`. En artikelbeskrivning `Netto`, antal `1` och radbelopp `480,00` kunde då ordnas till `Netto 1 480,00`. Med värderaden före beskrivningen i rå OCR-ordning ändrades dokumentets netto från okänt till felaktiga **148 000 öre**. Dokumentet var fortfarande spärrat av tabell-/beloppskontroller; detta var en ny felaktig fältassociation, inte ett falskt grönt dokument.

`06ba7f0` återanvänder fakturaparserns oförändrade `tableHeader` genom `isInvoiceTableHeader`, på rå radtext med separatorerna bevarade. Den äldre breda layoutspärren finns kvar. Den oförändrade oberoende 12-matrisen gick från **6 pass / 6 fail** till **12/12**. Ett korrekt horisontellt fält ovanför en senare tabell fungerar fortfarande.

### 3. Organisationsnummer kunde flyttas mellan källregioner

En tidigare eller senare avsändarregion, exempelvis `Avsändare:` eller `Utställd av:`, kunde donera sitt organisationsnummer till den uttryckliga mottagaren. Både den globala `unassigned`-adoptionen till en ensam namngiven roll och kvarhängande `section` bidrog.

Den felaktiga organisationsnummerfallbacken fanns redan i `ae56dc9`, men mottagarnamnet var då okänt och dokumentet hölls. Det nya mottagaraliaset gjorde kombinationen falskt grön. Denna skillnad mellan ett äldre latent fältfel och den nya grönklassningen bevaras i före-kvittot.

`d3af785` stängde fallen över separata rader och stycken. Granskarens oförändrade 40-matris gick från **8 pass / 32 fail** till **40/40**; recoverys separata 36-matris gick från **12 pass / 24 fail** till **36/36**. Ett ytterligare inline-fall kvarstod dock:

`Faktureras till: Syntetiska Mottagaren AB\nAvsändare: Syntetiska Utställaren AB Organisationsnummer: 556016-0680`

Här fanns redan en känd organisationsnummerhändelse på raden, så `!events.length`-gränsen kördes inte. Både granskaren och root reproducerade detta före följdfixen: Node och Sites gav grön PDF med mottagarens namn och utställarens organisationsnummer.

Den slutliga `a19e0a8` granskar hela prefixet före varje känd händelse samt okända suffix efter händelserna. En uttrycklig annan organisationsnummerägare bryter dessutom den äldre sektionen för efterföljande oägda värden. Avsändaretiketter upphöjs inte till nya juridiska parter. Mottagarnamnet bevaras, medan ett organisationsnummer utan rätt källa hålls okänt.

Granskarens sista oförändrade 16-matris hade **8 pass / 8 fail** på `d3af785`, körd av root. Samtliga åtta positiva kontroller passerade redan då. Samma fil ingår grön i slutkörningen.

## Scalargrammatik och ändrade testförväntningar

Slutfixen skiljer kända inline-skalärfält från okända fält med samma `scalarLabels` som de faktiska fältinsamlarna registrerar. Etiketternas regexer konsumerar inget inledande kolon. `match[0].indexOf(':')` pekar därför på den registrerade etikettens egen suffixseparator; okända kolon och kolumnseparatorer ligger kvar i gränscensus. Organisationsnummer hanteras separat som detail-händelser.

En känd inline-etikett som `Valuta: SEK` introducerar ingen ny part. Den följer samma regel som det äldre positiva fallet med inline `Summa moms`. En separat skalärrad, eller ett skalärfält först på en organisationsnummerrad, bryter däremot sektionen. Root godkände därför omklassningen av **en ny** scalar-suffixförväntning, motsvarande fyra engine/method-fall. Ursprungliga 24/28 och den äldre 848/852-grinden med fyra positiva fel bevarades först i `69b2dd0`. Inga äldre assertions eller oberoende frysta motprov ändrades.

Ett äldre korsaxelprov fick också tidigare, med uttryckligt rootgodkännande, skärpt förväntning till exakt råtext och avstående. Dess oförändrade input hade både horisontella och vertikala kandidater. Före-kvittot ligger i `docs/quality8/ocr-layout-cross-axis-review.json`. Ändringen var dokumenterad före slutgranskningen och användes inte för att ändra korpusfacit.

## Verifiering och tydlig attribution

Granskaren körde själv de ursprungliga syntetiska motproven och tidigare fokussviter, inklusive **195/195 på `06ba7f0`** och **271/271 på `d3af785`**. De gröna totalsiffrorna gav inte slutligt godkännande när senare negativa fall hittades. Därefter blev granskarens exekveringsmiljö otillgänglig. Slutgranskningen fortsatte som självständig textreview; root sparade och körde granskarens oförändrade sista matris.

**Den slutliga oberoende körningen utfördes av root:** exakt `a19e0a8`, **883/883 gröna**, noll fail/skip/cancel/todo, exit 0, **14 322.664496 ms**. Alla 25 manifesttester hashkontrollerades. Granskarens extra 15 geometritester kopierades byteidentiskt och ingår. `REVIEW_SOURCE_ROOT` band den externa 64-filen till samma snapshot. Ingen optisk producerfil ingick. Authors 868/868 är ett separat kvitto och ska inte tillskrivas granskaren eller räknas som ytterligare oberoende acceptansfall.

De extra geometriproven täcker bland annat konkurrerande horisontella och vertikala ägare, okända och lågkonfidenta etiketter, minsta glyphhöjd, breda/höga värderutor, ofullständiga tvåkolumnsrader och bevarad Bankgiro-konfidens 0/89/90. Originalorden, deras koordinater och konfidens behålls exakt en gång. Samma Bankgiro-ordspärr och OCR:s granskningsspärr kvarstår.

### Bevarade körkvitton

- Root-snapshot: `/tmp/rating8-root-a19-independent-nud694u0`.
- Slutmetadata: `/tmp/rating8-root-a19-independent.json`.
- Slutlogg: `/tmp/rating8-root-a19-independent.log`, SHA-256 `9a59cbcae8447af1873693301d847b929655ccd94f3264adb75c07a6a6b0e735`.
- Sista oberoende 16-matrisen: 2411 byte, SHA-256 `ad1434c22d55d954e350482a9fc56cd15b8ec3d29b680c4ca280c8f6b58126d3`.
- Roots förelogg för samma matris: `/tmp/rating8-root-independent-inline-before.log`, SHA-256 `d457267ee717a02f937f6de525e57809f7be9c7c63db786f28046cb0d9709fd0`; 8 pass/8 fail, 640.421589 ms.
- Tidigare fryst total-NOTREADY-kvitto: `/tmp/mgeorge-explicit-layout-independent-review-i0jji211/review-06ba7f0-not-ready.json`, SHA-256 `4638a92656987edc0ee29c3767dbd8f27017b732d53578385a4104cbbf9171f0`.

## Kvarstående avgränsningar

Den nya horisontella vägen används fortsatt inte i eller under en observerad tabell. Det kan lämna legitima senare totalsummor olösta. Inga oägda organisationsnummer flyttas längre globalt till en ensam namngiven part. Den äldre riktningsfallbacken när **ingen** roll alls är namngiven är oförändrad; den fyller inte ett partnamn och kan inte ensam göra dokumentet grönt.

READY avser denna versionsbundna programändring och de granskade källbindningsgränserna. Optisk recall, fältprecision på en ny population, dokumenttäckning, full release-CI och publicerad drift måste fortsatt redovisas med sina egna kvitton. Testantalet ersätter inte sådan evidens.
