## Slutförd leverans: Site 66 — 2026-11-06

Den tredje kandidaten fick grön full PR-CI, normal merge till main0035ea89 och separat grön main-CI 7569/7569. Samma Sites-träd publicerades 04:01:09 UTC. [Slutligt releasekvitto](release-wave4.md) och [verkliga efterkontroller](wave4-postpublication-observations.json) ersätter kandidatuppgifterna nedan som aktuellt läge. De tidigare underkända körningarna är bevarade. Målet är fortfarande 28/33 minst8; ingen total måluppfyllelse påstås.

## Historiska kandidatgrindar

## Aktuell tredje kandidat: oberoende granskad, full CI återstår — 2026-11-06

Den andra fulla PR-körningens tolv recipient-regressioner har reparerats. Den första smala reparationen fick i sin tur två oberoende fynd om parenteser och oägt organisationsnummer; båda är rättade i exakt produkt `96d1404`. [Ursprunglig NOTREADY och separat READY](party-boundary-independent/README.md) bevarar alla frysta prov och råloggar. Granskaren har själv kört **340/340**, medan [rootintegrationens avgränsade grind](party-boundary-integration/receipt.json) passerar **655/655**. Populationerna överlappar och summeras inte.

Den [kända OCR-replayen](party-boundary-repair/known-ocr-replay-comparison.json) gör 52 parseranrop och 0 nya optiska anrop. Samtliga fält, evidens, varningar, nivåer och parter är oförändrade mot 63edd9f; PSM3 står kvar på 57/100 mandatory och 79/130 All13, utan falska fältvärden. Detta är inte ett nytt hållprov eller ett högre OCR-betyg.

[Nytt native-paket](wave4-third-native-preparation.json) är byggt från Sites-träd `58c2cae56a5be177842c360ae46d5caed83fdd9b`, native source `0b119b8d472f70a1bfeac686c12889b618a32fb2`, arkiv-SHA256 `8cb1aace94955204027302b08acdbb9e308b57c40a1fc95f33ace1830b8fee2d`. Ingen version är sparad eller publicerad. Exakt kommande PR-CI, normal merge och separat exakt main-CI krävs först. Båda tidigare underkända paket är fortsatt uteslutna.

Bankdiagnos e66, normal MCP-återköning och banktestharnessens rättning är oförändrade mot föregående sammansatta kandidat. OCR A/B och förseglad V3 ingår inte. B:s separata negativa-censusfynd rättas och granskas i sin egen utvecklingslinje. Produktion är fortfarande Site 65 och **28/33 minst 8**. Periodisk OCR har nu faktiskt behandlat sex väntande dokument på levererad kod; område 28 väntar fortfarande på automatisk backupverifiering från ofärdig snapshot.

## Aktuellt: full CI underkänd, ingen publicering — 2026-11-06

Den andra fulla körningen på `364232a` underkänner tolv befintliga recipient-boundary-assertions. [Bevarat CI-kvitto och alla fel](wave4-second-ci/README.md): Node 2321/2321, Sites 4969/4981, bridge 47/47; Sites build skipped. Den tidigare smala parsergranskningen täckte inte dessa tolv fall och ger ingen integrerad publiceringsklarhet. En separat smal fix måste få oberoende granskning samt ny full PR- och main-CI.

Nativepaketet från `1fda827` / Sites-träd `7671a5b` tillhör denna underkända kandidat och får inte publiceras. Det tidigare paketet från den första underkända körningen är också uteslutet. Site 65 är fortfarande live, alla betyg oförändrade. De daterade READY-beskeden nedan gäller sina uttryckliga delomfattningar, inte den sammansatta kandidatens fulla grind.

## Slutlig kodgranskning efter harnessrättning — 2026-11-06

Alla ingående koddelar har nu separata oberoende READY-besked. Den utökade banktestfilen avbröts lokalt med SIGKILL efter drygt 3 GB RSS; den underkända körningen är bevarad. Den avgränsade testharnessrättningen 7a5a397 använder korta fil-URL:er i stället för rekursivt inbäddade data-URL:er. Produktkod, importmappningar, fixtures och samtliga assertions är oförändrade.

Producentens fulla banksvit passerar **273/273**, max-RSS 783 912 KiB. [Oberoende fullkörning](bank-harness-independent-review/REVIEW.md) passerar samma **273/273**, max-RSS 807 608 KiB, och fem separata riskprov för identitet, isolering och cleanup. Resultaten överlappar och summeras inte. Inga heapgränser, skip-markeringar eller testpopulationer ändrades.

Ett nytt native-paket är byggt från Sites-träd `7671a5b634127b42c0c101c0d99d071c1288ad08`, native source `1fda827650ff858e9c09a6a1795a6b15966004ac`. Ingen version har sparats eller publicerats från detta paket. Full obligatorisk CI på nästa exakta PR-huvud, normal merge och separat exakt main-CI återstår. Nuvarande produktion är Site 65, med oförändrat **28/33 minst 8**.

[Reparationernas originalhistorik](wave4-repair-source-history.json) bevarar bank e66, parser dd968c1/63edd9f och harness 7a5a397. [Sammanföringskvitto](wave4-review-assembly-audit.json) verifierar rena cherry-pick-diffar och de inlästa oberoende råartefakterna.

# Uppdaterad kandidat efter underkänd full CI — 2026-11-06

Den första fulla PR-körningen var underkänd med **9 Node- och 14 Sites-fel**. Det resultatet finns oförkortat och hashbundet i [initialt CI-kvitto](wave4-initial-ci/README.md). Inga testförväntningar har sänkts. Kandidaten nedan har nu kompletterats med två separat granskade rättningar; ny full CI på exakt PR-huvud och därefter exakt main återstår.

- Parserreparation `63edd9f` bevarar vanliga rollord inom explicit kolonmärkt företagsnamn och återställer negativt census för oägda organisationsförekomster. [Oberoende READY](parser-repair-independent-review/parser-review.md), 312 gränsfall, 71 Gmail-preview/MCP, 12 egna riskfall och 12 äldre tabellfall. Granskningen avgränsar ett redan befintligt fall med namnlös andra roll; dokumentet förblir gult och får ingen automatisk registrering. Fullständig universell census påstås inte.
- Bankens detaljdiagnos ingår nu, efter stängning av I1 i `e66cde6`. En normal, redan avvisad revalidering kan under strikt konto-/medgivandebindning läsa detaljer för högst fem redan valda konton. Den bevarar originalavvisningen och ändrar ingen anslutning, kontofakta eller ekonomi. Färska/sparade/aktuella primära identiteter som motsäger varandra stoppar hela diagnosen. [Oberoende omprövning](bank-details-independent-recheck/REVIEW.md), 22/22 inklusive konflikt på femte adaptersvaret. Den första underkända granskningen är bevarad i bank-details-identity-i1/original.
- De nya oberoende regressionerna är integrerade med bevarade assertions: en bankkontroll och tolv parserkontroller. Befintliga sviter har inte duplicerats.
- [Känd replay på exakt reparerad parser](a19-parser-regression/known-ocr-replay-63edd9f.md) ger samma fältvärden i 52/52 anrop: PSM3 mandatory **57/100**, All13 **79/130**, inga falska fältvärden. Varningslistorna blir mer precisa i 22 anrop. Det är noll nya optiska anrop och inget nytt hållprov. PSM6 behålls som negativ diagnos och införs inte.

Oberoende READY gäller angivna koddelar. Ingen OCR A/B-kod eller förseglad V3-data ingår. Det förra byggda native-arkivet hör till det underkända PR-huvudet och får inte publiceras; den rättade källan ska byggas och paketeras på nytt. Site 65 är fortfarande den publicerade versionen. Alla 33 poäng är oförändrade, **28/33 minst 8**.

## Historisk första kandidat före full CI

# Granskade fakturarättningar inför nästa publicering

## Omfattning

Denna integrationskandidat levererar de oberoende granskade roll-/tabellgränserna i fakturatolkningen och normal återköning via MCP. `retry_invoice_document` använder samma ägarbundna, atomiska återköning som UI:s Tolka igen. Verktyget startar ingen tolkning, registrering, betalning eller kundsändning; normal processor gör därefter sina ordinarie kontroller. Företagskontext och aktuell behörighet kontrolleras före skrivning. Redan registrerade, aktiva och främmande jobb förblir orörda.

Bankens nya detaljdiagnostik ingår ännu **inte** i produktfilerna i denna kandidat. Producenten `638c773` finns endast som bevarad ursprunglig källhistorik och inväntar separat oberoende granskning. Ingen pågående OCR A/B-implementation eller V3-data ingår.

## Verifiering före full PR-CI

- Geometri/rollgränser på exakt `a19e0a8`: oberoende granskningsfynd stängda, 883/883 verifierade med tydlig attribution. [Granskning](ocr-explicit-layout-independent-review.md), [exakt slutkvitto](ocr-explicit-layout-independent-final.json).
- MCP-återköning på exakt `52e68aa`: oberoende READY, 125 ursprungliga och fyra egna extra fall verifierade. [Granskningskvitto](document-retry-mcp-independent-review.json).
- Efter integration med geometri: **129/129** i verkliga Gmail-/företagsbehörighetssviter på `589f1f58062ef46b30f9bef2530e833c24642ed6`, 0 fel/skip/cancel/TODO, 23 939,759 ms. [Hela loggen och SHA](document-retry-wave4-integration.json).
- Känd a19-textreplay redovisar recallregressionen öppet: 57/100 mandatory och 79/130 alla fält, noll felaktiga värden. Den är ingen ny optisk mätning. [Avgränsning och rårapport](ocr-field-a19-baseline-note.md).

Full obligatorisk CI på den exakta GitHub-kandidaten återstår vid detta kvittos skapande. Publicering får beskrivas som klar först när exakt huvudgren passerat och samma Sites-träd blivit publicerat. Ursprungliga producent-SHA:er kan återskapas från [källhistorikens manifest](wave4-source-history.json), tillsammans med föregående wave3-bundle.

## Bedömning

Aktuell levererad version är fortfarande Site 65. Den kompletterade oberoende produktionsbedömningen är **28/33 minst 8**; 6, 10, 15, 16 och 28 återstår. Den här kandidaten höjer inte dessa betyg genom kodtester. Den avsedda nästa driftkontrollen är en normal återtolkning av ett befintligt ägt underlag genom de vanliga registreringsgrindarna. Bankdiagnosen och dess eventuella fortsatta åtgärd hålls till ett separat granskat steg.
