# Integrationsgranskning, andra kvalitetsleveransen

2026-11-05. Fortsättning från publicerade Sites 63 och main `bf24a3c52ffc637d1e7bbc4d4f64a1732dcd9fee`. Denna arbetsrapport skiljer lokala kandidater från kommande exakt CI och publicering. Den sätter inga slutbetyg.

## Leveranskandidat efter slutgranskning, 2026-11-05 22:15 UTC

Produktionskoden är fryst vid lokal commit `571073b8172ab53899a4ce3c2b717c7fe24daee2`. Efterföljande commits till och med `37c88fe0b418b1c9927764ef3c64faa9b50de65c` tillför mätkvitton, granskningar, tester och en separat lokal webbläsarharness. Kandidaten är ännu inte publicerad när detta avsnitt skrivs. Exakt PR-/main-CI och Sites-publicering är återstående leveransgrindar. De 5 894 gröna testerna för main `bf24a3c` gäller den äldre Site 63 och får inte tillskrivas detta slutträd.

### Granskade ändringar och avgränsad verifiering

- **Översiktens ekonomiska uppgifter:** gemensam evidenspolicy för verklig bankkälla, konto, betalningsreferens och fullständiga referensägare. Historiska kopplingar räcker inte som verifierad betalning. Fem oberoende Important-fynd är stängda; slutgranskningen omfattar 150 överlappande prov, däribland 19 egna negativa fall. Indexeringen behåller alla referensägare och minskar den uppmätta bearbetningen av 1 000 fakturor från cirka 1 871 ms till 110–117 ms. Se [granskning och mätgräns](overview-evidence-independent-review.md).
- **Manuell flerfakturafördelning:** den oberoende granskningen nedan gäller den integrerade slutversionen. Säkra offertunderlag, exakta öresbelopp, aktuellt samtycke/konto, atomiska tillståndskontroller och idempotenta kvitton är provade lokalt. Inga riktiga kundallokeringar har utförts som test.
- **OCR:s kodgränser:** belopp, dokumenttyp, full etiketträkning, ordkonfidens och geometrisk entydighet har förstärkts. Slutlig oberoende kodgranskning ger 101/101 överlappande prov, inklusive 44 egna parserfall och tio oförändrade geometriska motexempel; inga kvarvarande fynd i granskat scope. [Kodgranskningen](ocr-independent-code-review.md) är skild från bildmätningens kvalitet nedan.
- **Bankdiagnostik:** samma 409-spärr och samma acceptansbeslut bevaras. Endast elva slutna felorsaker får passera från den privata policyn till service och MCP; godtycklig feltext eller konto-/personuppgifter får inte följa med. Oberoende kontroll: 67 policyprov, 14 service-/MCP-prov samt 54 differentialfall med noll beslutsavvikelser. Sex av serviceproven går genom den riktiga MCP-routen med lokal SQLite och förbjuden nätverksfetch. Se [bankgranskningen](bank-scope-diagnostic-review.md). Diagnostiken återansluter inte banken i sig.
- **Faktisk lokal webbläsare:** fem vyer vid 320, 390, 768, 1 024 och 1 440 px ger 25/25 uppmätta geometrier utan oavsiktligt horisontellt sid-/dialogöverflöde efter två CSS-rättningar. Tre separata observationer gäller sammansatt sökning och återgångsfokus, formulärstängning samt korrekt banketikett. `Registrerade kopplingar` ersätter den missvisande historiketiketten i båda klienterna. Se [skärmbilder, före-fel och mätkvitto](browser-wave2/README.md). Detta är lokala syntetiska data, inte autentiserad produktionskontroll, fysisk mobil eller skärmläsarcertifiering. Två rendererkrascher och ett avbrutet extra tangentbordsprov redovisas och räknas inte som godkända prov.

Root körde dessutom en tidigare integrerad fokusgrupp med 120/120 prov (manuell fördelning, översikt, indexering, geometri, browser-fixtures och bankgirobevis), syntaxkontroll av 195 filer samt 43 schema-/behörighetsvakter. Den senare typkontrollen efter CSS-/etikettändringarna slutade med exit 0; bankändringarna har separat typkontroll hos författaren. Dessa delmängder och versioner ersätter inte slutträdets obligatoriska CI.

Två lokala fullsviter som startades 21:37 lämnade ofullständiga loggar och ingen verifierbar avslutning. Den observerade orsaken är okänd. De räknas varken som passerade helsviter eller som ett fastställt minnes-/kodfel. Testantal mellan författare, granskare och integration överlappar och summeras inte.

### OCR:s verkliga kvalitetsgrind är fortfarande underkänd

Första oberoende V1-provet bevaras oförändrat. Senare återkörningar och omparsning av dessa redan kända observationer är öppet utvecklingsregressioner, inte nya oberoende förstaprov.

En ny V2-korpus frystes i `9d9d0736d5f9f02e87ea055f328b9e44518badea`; separat källbindning gjordes till `571073b` före första OCR-körningen. Tolv bilder bearbetades en gång vardera och gav 24 parseranrop utan behandlingsfel. Bland de tio normala fakturorna blev obligatoriska fält för **varje parser 60 rätt, 0 felaktiga värden och 40 saknade: precision 100 %, recall 60 %, exakt kompletta fakturor 0/10**. Alla 13 mätta fält ger recall 63,08 %; enbart bildhärledda obligatoriska fält ger 55,56 %. Ingen normal- eller stressbild blev falskt grön, men detta uppfyller inte PLAN:s återkallningsmål på 85 %. OCR får därför inte 8.

Det oförändrade [V2-resultatet](ocr-independent-holdout-v2-result.json) har SHA-256 `13557c3012331fa0101fbe3e6fe498fd2fbf3346b8740cfe5fe4b83e8393b6e7`; [rapporten](ocr-independent-holdout-v2-report.md) redovisar nämnare, fältutfall och begränsningar. Fullständiga OCR-block/bbox sparades inte i detta kvitto. Senare diagnos får inte påstå sig ha sådana koordinater från förstaprovet.

### Kvarstående driftfrågor före publicering

- Site 63:s faktiska omverifiering av bankens samtycke 21:29 avvisades med `BANK_ACCOUNT_SCOPE_INVALID`; banken är fortfarande frånkopplad. Den sparade kontoselektionen innehåller ett strängvärde, men den nu publicerade versionen identifierar inte vilken senare scope-kontroll som avvisar. Inga kontovärden har publicerats. Ny sluten diagnostik ska verifieras efter leveransen.
- Gmail-plattformens 21:00-körning slutfördes 21:03:56 och hämtade sju nya objekt. OCR-kön ökade från 34 till 41 och arbetaren var fortfarande inaktuell. En lyckad Gmail-körning är därför inte bevis för komplett bakgrundsgenomströmning.
- GitHub har bara observerats köra OCR automatiskt 18:13 och 18:23 under denna senare del av sessionen, sex objekt vardera. Cron-uttrycket skrivs om till det ekvivalenta `7/15 * * * *`; detta är ett försök att återregistrera schemat, inte en bevisad schemareparation. Ny faktisk periodisk körning måste observeras separat från en körning som utlöses av main-CI.
- Den verifierade dagsbackupen omfattar 362 original och 142 968 213 byte. Senare importer ingår inte automatiskt i den redan färdiga snapshoten. Den isolerade återställningsmätningen nedan är fortfarande en lokal övning, inte produktionens RTO/RPO eller ett fullständigt externt nyckelprov.

Ingen av dessa återstående frågor döljs genom höjda betyg. Alla 33 områden ska bedömas med skilda kolumner för faktiskt publicerad version och ännu villkorad leveranskandidat.

## Första fulla PR-CI och rättning av kvarvarande integration, 22:23 UTC

[PR 56](https://github.com/sharbel0022/Mgeorge/pull/56), huvud `c17365187c5e97f164199e7ab070e6dacca6abec`, har exakt samma träd `6f493bf8da0df1578e4e93899635a8500a13a362` som lokala `9ce08a5`. Full CI `42120342085` gav **Node 2 277/2 277**, **bridge 47/47** och **Sites 4 169/4 177: åtta fel**. Inga prov var överhoppade, avbrutna eller TODO. Sites typkontroll, installation och audit passerade; produktionsbygget kördes inte efter testfelet. Separat säkerhetskörning `42120342083` passerade 325 Node- och 800 Sites-prov, vilka överlappar fullsviten. Den första kandidaten blev inte mergad eller publicerad.

Fem fel gäller gamla positiva kandidat-fixtures som skickade `bankDetails.payerReference` utan verifierbar AIS-källa eller bevarat detaljoriginal. Den nya källregeln avvisar korrekt sådan metadata som bankfakta. De positiva underlagen kompletteras syntetiskt med riktiga käll-/originalkontrakt; exakta referensförväntningar, inklusive skillnaden mellan `0599`/`599` och `AB12`/`AB-12`, behålls. Negativa käll- och mutationsfall tillkommer. Ingen produktionsfix behövs för dessa fem testunderlag.

Tre UI-fel reproducerades lokalt som 52/55. En positiv ekonomifixture saknade fakturaoriginal trots att den förväntade sig verifierad historik; den får nu ett syntetiskt dokument-ID, med oförändrade tidigare assertions och ett separat negativt prov för saknat original. Två verkliga presentationsfel rättas: samlingsinsättningens saknade detaljer ska ha sitt konkreta skäl, och en ren återföringsinstruktion ska behålla domänens REVIEW. Den första lokala rättningen `d59ead9` gav 62/62, men oberoende review hittade ytterligare tre kombinationer där en återföringsorsak kunde dölja ett hårt referens- eller riktningsfel. `22dc749` utvärderar därför samtliga befintliga oberoende käll-/konto-/referens-/riktningskontroller före betalningstypens granskningsskäl. Den ändrar inga ekonomiska skrivningar. Root har åter 62/62 och typkontroll; oberoende omgranskning och ny exakt full CI krävs innan leverans.

Slutlig [oberoende omgranskning av `22dc749`](payment-presentation-review-22dc.md) är **READY**: 124/124 överlappande prov, inklusive de tre oförändrade negativa scenarierna som nu ger rätt hårda spärr. Rent återföringsskäl förblir REVIEW. Root har även läst [kandidat-fixture-diffen](invoice-candidates-ci-fixture-review.md), bekräftat att de gamla referensförväntningarna är oförändrade och integrerat elva nya negativa käll-/mutationsprov. Efter integration körde root alla fyra berörda testfiler: **108/108**, 3 980,762 ms, noll fel/skip/cancel/TODO, under repositoryts nätverksisolering. Slutlig typkontroll har exit 0. Detta ersätter inte den nya fulla PR-/main-CI som nu krävs på det korrigerade trädet.

[Färska läskvitton före publicering](wave2-prepublication-observations.json) skiljer dessutom två verkliga observationer på revision 52: en ekonomisk AIS-post utan individuell betalare/referens och en icke-ekonomisk rapportpost med båda uppgifterna. Båda avgränsade ID-läsningarna är fullständiga, har noll fakturakopplingar och inga allokeringskonflikter. Rapportoriginalets integritetskontroll passerar och dess strukturerade referens återges som generell referens, inte formell OCR. Mottagarkontot är fortfarande blockerat och `targetRelationProved` är falskt. Detta ger färsk evidens för korrekt separat presentation, inte en ny bankrelation eller betalning.

## Integrerade prov före de sista granskningsrättningarna

På lokala kandidaten `ec200fa` kördes tio berörda testfiler med Node 24.22.1: de fyra befintliga Dashboard-/detaljfixtures som laddar den nya underkomponenten samt Node-/Sites-API, klient och UI för manuell flerfakturafördelning. Resultat: **192/192**, noll fel, överhoppningar, avbrutna eller TODO; 27,768 s. Logg: `/tmp/rating8-wave2-integrated-manual-focus.log` (tillfällig lokal logg).

De fyra äldre renderfixtures fick enbart motsvarande importstub för `ManualMultipleAllocation` som de redan använder för andra orelaterade barnkomponenter. Inga förväntningar ändrades. Dessa fyra fixtures verifierar sina befintliga vyer; de påstås inte verifiera den nya manuella komponentens beteende. Den komponenten har separata riktiga render-/interaktionsprov.

Denna gröna körning fångade inte två senare oberoende klientfynd: verkliga Node-svar har hashrevision där klienten först krävde heltal, och ett sent svar kunde radera en nyare oavgjord begärans sessionpost. De fynden kräver egna reproduktioner, rättningar och omgranskning före leverans. Ett tidigare Sites-fynd om förlorat batchsvar har en särskild rättning i `b956007`; även den återkontrolleras oberoende. Testantalet ovan är därför inte ett godkännande av den dåvarande kandidaten.

## Övriga integrerade kontroller

- OCR-ordbevis och hantering av lång text: root körde **250/250** relevanta tester, 17,577 s, utan fel eller överhoppningar. Den frysta optiska korpusens utfall och begränsningar finns i [ordbevisrapporten](documents-word-confidence.md).
- Sökträffens fokus: korrekt före-rättning gav 0/2; efter rättning passerade hela filens **16/16**. Se [separat fokusrapport](search-focus-review.md). Faktisk kontroll av den ännu opublicerade rättningen återstår.
- Återställningsövning med den integrerade återställningskoden: 362 original, 142 968 213 byte, 27 tabeller och åtta negativa scenarier. Återställning plus verifiering tog **3 416,863 ms**; hela övningen **11 605,651 ms**. Samtliga tio berörda källfiler var byteidentiska med föregående verifierade övning. Se [mätkvitto](recovery-integration-rerun.json); detta är en isolerad syntetisk övning, inte en återställning över produktion.

Testgrupperna överlappar de kommande helsviterna och summeras inte som ytterligare unika prov. Slutlig källversion, obligatorisk CI, publicering och efterkontroller fylls med faktiska resultat när dessa finns.

## Oberoende slutgranskning av den manuella fördelningen

Den frysta författarcommitten `4503944e4ecb9d34f467cbac27830dc529a15312`, integrerad som `6325f2d`, återgranskades oberoende. Sites-fyndet om okänt batchutfall samt klientfynden om verklig Node-revision och sen radering av en nyare begäran är stängda. **Inga Critical-, Important- eller Minor-fynd återstår inom detta avgränsade kodscope.** [Granskningsrapporten](manual-multiple-independent-review.md) redovisar 82 överlappande körningar, faktisk lokal API-till-klient-kedja samt vad som inte bedömdes.

De 22 egna granskningsfallen sparades därefter i Git. Root körde dem från deras slutliga relativa importsökvägar efter integration `bc15d2b`: **22/22**, 14,359 s, utan fel, överhoppningar, avbrutna eller TODO. Det verifierar att flytten från den isolerade granskningskopian inte bröt reproducerbarheten. Node HTTP-gruppen använder den delade ESM-klienten; den separata producentregressionen kör den klassiska webbläsaradaptern och dess riktiga JSON-transport. Detta är fortfarande syntetiska lokala prover, inte en riktig kundallokering eller autentiserad produktionswebbläsare.
