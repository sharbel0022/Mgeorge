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
