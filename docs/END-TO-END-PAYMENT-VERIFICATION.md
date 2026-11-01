# MGEORGE – HELA BETALNINGSKEDJAN

Datum: 2026-11-01. Startrevision: `fa524c2b3d06530d1b75b48df45ae14b28ab1182`. Föregående verifierad kod: `dba8f426bfe96076c269c88c096f5f4cee665484`; skillnaden fram till startrevisionen är endast framsteg/poäng/leveransdokumentation. [Arkitektur, beslutsträd, datamodell och UI](PAYMENT-VERIFICATION-ARCHITECTURE.md).

**Slutmålet är inte produktionsgodkänt.** Interna kontroller och mätningar kan levereras medan den autentiska konto-/rapportrelationen fortfarande är blockerad. Ingen verklig fakturaregistrering, fakturaallokering, bankbetalning eller kundmejl ingår i provningen.

## Vad kartläggningen visade

De befintliga motorerna hanterar AIS, CSV/camt/XLSX, bevarade original, typade betalare/referenser, atomiska allokeringar, del-/överbetalning, återimport, separata manuella originalrelationer och återtag. Uppdraget motiverar ingen ny ekonomimotor eller databas.

Tre reproducerade interna luckor prioriterades:

1. Intakt AIS-original kunde automatiskt allokeras utan aktuellt mottagarkonto/medgivande i både Node och Sites. Fil- och rapportkontroller hade redan delar av detta krav.
2. Node tillät ny uttrycklig manuell HTTP-allokering utan verifierbart original/aktuellt ägt konto och kunde visa `paid` samtidigt som betalningsevidensen inte kunde verifieras.
3. Sites saknade en sammanhållen, läsande elvastegskontroll som skilde aktuella originalkontroller, kontoalias, bankidentitet, manuella beslut, fakturaförslag och verkligt bokat saldo.

Oberoende granskning reproducerade dessutom en samtidighetslucka: Sites ursprungliga kontoavläsning kunde bli inaktuell före workspace-sparningen vid samtidig frånkoppling/kontoborttagning. Den är rättad med en exakt medgivandesnapshot och SQL-giltighetskontroll i samma atomiska skrivbatch som nya pengar. 24 nya commit-integrationstester samt granskarens 18 extra racefall passerade. Enbart en extra läsning eller grön preview hade inte räckt.

## Implementationen

- Node skiljer `original_verified` från `account_consent_issue` och den samlade användbarheten. Aktuellt ägt, valt, entydigt SEK-konto och giltig anslutning krävs även för AIS. Ursprungskedjor och tidigare betalningar som lär kundrelationer omfattas. Bokade belopp och original bevaras när evidens brister.
- Node kontrollerar original, aktuell administratör och kontomedgivande under samma `BEGIN IMMEDIATE` som den manuella HTTP-allokeringen. Ett `confirm:true` ersätter inte underlaget. Den befintliga interna `allocate`-primitiven behålls för motor/återställning och isolerade tester.
- Sites använder befintlig ägar-/production-/applikationsgenerations-/giltighets-/kontoresurskontroll vid nya allokeringsförslag, föräldrar och lärda kundrelationer. `bankAccountIssue` är separat från originalintegritet. Request-cache återanvänds inte mellan kontroller.
- Sites `writePaymentState` skyddar både HTTP-kommandon och bakgrundsavstämning med samma atomiska medgivandefence. Samtidig ändring av ägare, anslutning, session, bank/land, generation, kontoval, kontoresurs eller giltighet lämnar varken partiella allokeringar eller audit. Ingen schemaändring eller nästlad banklease behövs.
- Den nya `GET /api/bank/verification` är ägarautentiserad och skriver inget. Den läser bevarade original, aktuella konto-/rapportförhandskontroller och befintlig matchningspreview. Fakturaoriginal kontrolleras med ägare, storlek och SHA-256. Ett registerfynd eller tolkat dokumentförslag får inte ensamt bli ett verifierat original.
- Den svartvita betalningsdetaljen visar elva utfällbara kontrollsteg med använda uppgifter, källa, kontrolltid, regel, förklaring och nästa åtgärd. Ingen körande Gmail-/bank-/allokeringsfunktion startas av panelen.
- Om betalare eller referens hämtas från separata bankdetaljer kontrolleras det ägda JSON-originalets MIME, storlek, hash och konto-/bank-ID-kuvert; den befintliga detaljtolkningen återspelas och jämförs med de visade fälten. Trimmade namn och felaktiga JSON-typer får inte kringgå källvalet. Kontrollen ändrar inga ursprungsfält.

Manuell originalrelation förblir metadata. Den varken blir bankverifierad identitet, byter bankens betalare eller auktoriserar fakturaallokering. Formell OCR, generell referens, fakturanummer och manuella kompletteringar förblir åtskilda.

## Före och efter på samma syntetiska korpus

Nya `scripts/measure-payment-consent.mjs` kör identiska elva fall per applikation från fryst startkod respektive kandidat: giltigt konto; saknat, utgånget, frånkopplat, felstatus, ägarlöst, avvalt, fel konto, fel valuta, tvetydig resurs samt saknat kvitto. Node använder verklig temporär SQLite. Sites använder befintliga original-, konto- och avstämningsfunktioner med syntetisk minneslagring för provider-resurser och verklig `stableAccountKey`. Ingen nätverkskontakt, produktionsdata eller autentiserad HTTP-gräns ingår i just den mätaren.

| Mått | Före | Efter |
| --- | ---: | ---: |
| Korrekt beslut, Node | 2/11 | 11/11 |
| Korrekt beslut, Sites | 2/11 | 11/11 |
| Felaktigt tillåtna nya allokeringar, Node | 9 | 0 |
| Felaktigt tillåtna nya allokeringar, Sites | 9 | 0 |
| Säkert positivfall, per applikation | 1/1 | 1/1 |
| Blockerade negativa fall med oförändrat saldo, per applikation | 1/10 | 10/10 |
| Ändrade bankoriginal eller indata | 0 | 0 |

Detta är avsiktligt en korpus som riktar in sig på det reproducerade felet. Andelarna är inga uppskattningar av verklig produktionsprecision. Atomisk kontomedgivandekontroll vid HTTP-/bakgrundssparning verifieras i separata integrationstester.

Två befintliga mätare körs också med samma facit och runner före/efter:

| Mått och omfattning | Före | Efter |
| --- | ---: | ---: |
| Node verklig import/original/avstämning, korrekta fall | 23/23 | 23/23 |
| Säkra automatchningar i Node-korpusen | 5/5, falska 0 | 5/5, falska 0 |
| Falsk acceptans vid osäker betalare / OCR | 0/6 / 0/3 | 0/6 / 0/3 |
| Sites-domän: korrekta manuella originalrelationer | 10/10 | 10/10 |
| Sites-domän: felaktiga relationer / allokeringar / ekonomiska dubblettfall | 0 / 0 / 0 | 0 / 0 / 0 |
| Sites-domän: oförändrade saldon/allokeringar | 15/15 | 15/15 |
| Manuella granskningsbeslut i Sites-korpusen | 10 | 10 |

Hashbundna före-/efterartefakter: [kontomedgivande före](measurements/payment-chain-consent-before.json) / [efter](measurements/payment-chain-consent-after.json), [Node-matchning före](measurements/payment-chain-matching-before.json) / [efter](measurements/payment-chain-matching-after.json), [Sites-originalrelation före](measurements/payment-chain-linking-before.json) / [efter](measurements/payment-chain-linking-after.json). Eftermätningarna anger arbetskopian före commit och dess exakta källhashar; HEAD-fältet ensamt är inte kandidatens versionsidentitet. Leveranskvittot binder dessa till faktisk kodleverans.

Node-import/original/avstämning: 3,5778 → 3,7228 ms per bankradsförsök, 27 försök/22 behandlingsfall. Sites-domän: 13,2740 → 9,0367 ms per filförsök, 16 försök. Den nya kontokorpusen tog totalt Node 31,1130 → 33,2955 ms och Sites 40,7537 → 61,9116 ms för elva fall vardera. Tiderna är engångsobservationer för syntetisk lokal bearbetning, exklusive nätverk och fixtures; de är ingen produktions-SLA eller statistiskt belagd hastighetsförbättring.

Samma relationskorpus behåller 8/8 visade individuella namn och 8/8 exakta referenser; bankidentifierad produktionsprecision är **inte uppmätt** genom manuella metadatarelationer. Befintliga stabil-ID-regler täcks av separata parser-/Bankgiroregressioner. Inga nya förbättringar av betalar-/referensprecision eller automatisk bankidentitetskoppling påstås från kontogränsändringen. Tre tidigare saknade allokeringskontroller har införts: aktuell automatisk AIS-kontogräns i två applikationer och Node manuell HTTP-original-/kontogräns. De elva panelstegen är en ny sammanhållen redovisning av dessa och redan befintliga kontroller, inte elva nya ekonomiska regler.

## Täckning av hela regressionskedjan

| Efterfrågat scenario | Befintlig eller ny relevant testgräns |
| --- | --- |
| Komplett säker betalning | Node `reconciliation.test.js`; Sites `bankgiro.test.mjs`, aktuella kontopositivfall |
| Saknat bankkvitto | Node `bank-reference-storage.test.js`, ny kontokorpus; Sites `bank-api-original-q8.test.mjs` |
| Fel mottagarkonto | Nya Node/Sites kontotester, `bankgiro-links` och XLSX-integration |
| Saknat kontoalias | Sites `bankgiro-retained-preview.test.mjs`, betalningspanelens rapportkontroll; Node kräver exakt IBAN |
| Saknad stabil bankidentitet | XLSX-integration och `bankgiro-links`: förslag/manuell metadata, inga pengar |
| Två insättningar med samma belopp | `bankgiro-links` i båda apparna, Node matchningskorpus |
| Samlingsbetalning med flera betalare | `bankgiro.test.mjs`, Node reconciliation, oförändrad komplett barnsumma |
| Fel OCR | Node/Sites referens-/Bankgirotester, panelens negativa OCR-status |
| Generell referens utan OCR-klassificering | Parser-/referensevidenstester och XLSX; ledande nollor bevaras |
| Faktura saknas i register | Sites Bankgiro/panel: originalförslag skapar inte faktura eller allokering |
| Annan fakturakund än betalare | Reconciliation-/Bankgirotester och separata verifierade kundrelationer |
| Delbetalning | Node/Sites reconciliation/domain, exakt öresaldo |
| Överbetalning | Samma motorer; allokera högst saldo och behåll överskott |
| Återbetalning | `node-payments-quality-cycle`, Sites `manual-return-allocation` |
| Redan betald faktura | Reconciliation/domain; ingen extra allokering mot nollsaldo |
| Återimport av samma rapport | XLSX/API/Bankgirotester och mätare; ett ekonomiskt belopp |
| Parallella kontroller | Node `payment-concurrency`; Sites CAS/control/link-tester och nya samtyckesfence-tester |
| Avbrott mitt i import | Verkligt Node-processavbrott/SQLite rollback; Sites avvisad batch/CAS/XLSX |
| Återtag av fel originalrelation | `bankgiro-links` i båda apparna; bokningar bevaras |
| Rätt saldo efter isolerad allokering | Positiv-/del-/överbetalningsfall och nya kontopositivfall |
| Oförändrat saldo när kontroll blockerar | Nya kontotester/korpus, originalintegritet och atomicitetsintegration |

Detta är en spårbar matris över verkliga olika gränser, inte ett påstående att alla fall körs i en enda webbläsarresa. Slutlig lokal verifiering: **625/625 Node och 1111/1111 Sites, totalt 1736**, inga fel eller överhoppningar. Startsviterna var 606+1022: **108 nya fullsvitstester**. Syntaxkontroll av 92 filer, TypeScript och produktionsbygge passerade. Rena installationer kördes med oförändrade package-/lockfiler; rotens audit och Sites produktionsaudit har 0 fynd. Full Sites-audit har 16 moderate utvecklingsfynd, 0 high/critical; obligatorisk high-grind passerar.

Oberoende kodgranskningar avslutades utan kvarstående Critical/Important-fynd eller konkreta P2-panelfynd efter rättningarna. Granskningsupptäckta fel gav röda/gröna regressioner; 24 commit-, 20 kontomedgivande- och 45 panel/UI-fall ingår i fullsviten. [Desktopbild](screenshots/payment-verification/desktop.png), [mobilbild](screenshots/payment-verification/mobile.png) och [browserprotokoll](screenshots/payment-verification/verification.json) gäller faktisk komponent och CSS med syntetiskt tillstånd, inte en verklig produktionsallokering. Tillfällig previewroute är borttagen och previewprocessen stoppad.

Läsande kontroll efter den första publiceringen, Sites 45, upptäckte ett visningsfel för äldre AIS-poster med giltigt kvitto men saknad äldre presentationsetikett. Originalintegritet blev felaktigt blockerad trots godkänt kvitto. Den befintliga `hasBankApiOrigin` används nu även vid panelens källklassificering. Sex nya syntetiska regressioner täcker giltigt, saknat, feltypat och felaktigt kvitto, okänd profil och ändrad originalprojektion. Säkerhetsgrindarna är kvar och inga historiska poster uppgraderas eller skrivs om. Sites 45 är därför en mellanleverans; slutlig versionsidentitet och läsande efterkontroll redovisas i leveranskvittot.

## Autentiskt 625-kronorsfall, endast läsning

Läst arbetsyterevision **40**, fem registerfakturor och **noll allokeringar**. Exakt aktuell AIS-JSON hämtades från den autentiserade sparade arbetsytan. Kvittots SHA-256 och versionsstyrda originalomtolkning passerade lokalt. Strängrepresentationen bevarades före JSON-transport; en omserialiserad granskningskopia får inte ersätta det exakta kvittounderlaget.

Det lokala XLSX-originalets hash är samma som det ägda sparade originalets hash i färsk skrivfri förhandsgranskning. Rapporten innehåller **en betalning, 62500 öre totalt**, och den beräknade radsumman stämmer. Exakt referens är `0599`, typen är generell strukturerad betalningsreferens. Bankens rapporterade avsändare finns i originalet; AIS lämnar ingen individuell betalare. De fälten ersätts inte med fakturakundens namn.

Den aktiva Swedbankanslutningen är production/connected med giltigt medgivande och ett valt importbart SEK-konto. Rapportens kontoformat finns fortfarande inte som ett entydigt styrkt alias i den aktiva kontoresursen. Rapport-/löpnummer finns, men är **inte samma stabila identifierare som AIS-insättningens externa bank-ID**. Datum och belopp räcker inte för koppling.

Originalfaktura `0599` har återöppnats och dess hela första sida visuellt granskats privat: nummer, datum, kund, organisationsidentifierare och 625-kronorsbelopp finns. Äldre dokumenttolkning gör den till ett förslag; registret innehåller fortfarande ingen sådan faktura. Maskinell textutvinning återger inte alla fält pålitligt i denna PDF och används inte som ersättning för visuell granskning eller ordinarie registreringskontroll. Separat dokumenterad kund-/tredjepartsrelation och administratörsbeslut återstår.

| Kontroll | Verifierat utfall före ny leverans |
| --- | --- |
| Bokförd AIS-post och ankomstkvitto | Finns; exakt hash och originalomtolkning passerar |
| Ägt Bankgirooriginal och integritet | Finns; lokal/sparad hash överensstämmer |
| Rapportantal och totalsumma | 1 betalning, 62500 öre; radsumma stämmer |
| Aktuellt AIS-konto/medgivande | Anslutet valt SEK-konto; rapportalias fortfarande blockerat |
| Samma insättning från två källor | Inte styrkt; separat manuell originalrelation inte bekräftad |
| Individuell betalare och referens | Finns i separat rapport, inte i AIS; `0599` är inte verifierad formell OCR |
| Fakturaoriginal | Hittat och visuellt omgranskat privat |
| Fakturaregistrering | Saknas |
| Kund-/tredjepartsrelation | Inte färdigattesterad i registerflödet |
| Föreslaget avstämningsresultat | Granskning/blockerat; noll ekonomiska skrivningar |

Inga verkliga original, kontouppgifter, personuppgifter eller originalkontrollsummor ingår i repositoryt. Exakta läsbevis finns privat utanför Git. Bank-/Gmail-/backupstatus lästes via [MG Fakturakoll-pluginen](https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site/); inga körande synk-/avstämningsverktyg anropades.

## Säkerhet, drift och återgång

Backupstatus gav komplett **manifestpass 191/191 original**. Det finns fortfarande 113 äldre API-poster utan kvitto i backupens redovisade kontrollomfattning; detta är ingen full katastrofåterställningsövning. Kodborttagning av nya kontroller eller påhittade kvitton är ingen tillåten återgång för felaktig verksamhetskoppling; använd befintligt separat återtag.

Gmail är anslutet men senaste lyckade hämtning är gammal och det bifogade timschemat är pausat. Ansluten integration redovisas därför inte som verifierad aktiv automatisk hämtning. Bankens sex-timmarsschema och backupschemat finns aktiva. Inga scheman ändras i uppdraget.

Exakt GitHub-kod, båda Actions-jobben, Sites-källträd/version/deployment, audit, bygg-/browserbevis, oförändrad policy/DB/R2/runtime/scheman och läsande efterkontroll ska redovisas i `docs/END-TO-END-PAYMENT-PUBLICATION.json`. Tills ett sådant faktiskt kvitto finns är ny push/publicering inte verifierad.

## Kvalitet och exakt fortsättningspunkt

Berörda poäng för bankhämtning, Bankgiroimport, betalare/referens, matchning, saldon/historik, säkerhet, användbarhet, tester och produktionsverifiering redovisas i `QUALITY-SCORECARD.md`. Syntetiska förbättringar ger inte 9,5 i produktionsberoende områden.

Innan faktura `0599` får markeras betald krävs: bankstyrkt mottagarkontoalias/Bankgirorelation; bankens uttryckliga samband mellan rapport och AIS-insättning eller tillräckligt styrkt separat originalgranskning; ordinarie registrering av det intakta fakturaoriginalet efter dubblett- och motpartskontroll; verifierad kund-/tredjepartsrelation; nytt skrivfritt avstämningsförslag och ett separat administratörsgodkännande av faktisk allokering. Beloppet får inte bokas som prov.
