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
