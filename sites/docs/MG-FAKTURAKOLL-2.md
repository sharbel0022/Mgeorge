# MG Fakturakoll 2.0

Den befintliga Siten är produktionssystemet. Den använder oförändrat projekt-ID, D1/R2-bindningar, ägaridentitet och integrationsnycklar. Node.js-versionen i GitHub har en separat databas. Ingen datamigrering mellan dessa register ingår.

## Arbetsflöde och gränser

Fem huvudområden samlar översikt, granskning, fakturor, bank och inställningar. Import, kontakter, historik, Gmail-dokument, bankanslutning och kundmeddelanden är fortsatt åtkomliga. Original, verifierade betalningar, avvikelseanalys och aktuella mejlutkast visas från fakturadetaljen.

`POST /api/payment-control/run` tar enbart `request_id`. D1-batchen skapar högst en aktiv körning per ägare och sparar beständiga idempotensalias, även för återanvända körningar. Ett nytt klick inom 60 sekunder återanvänder senaste körningen.

`POST /api/payment-control/advance` tar enbart körnings-ID och gör ett begränsat steg: Gmail, dokumenttolkning, bank, avstämning eller utkast. En atomisk lease skyddar varje steg. Resultatet får bara sparas av aktuell, giltig lease. Avbrutna anrop kan återtas efter tio minuter, högst tre försök. Externa adaptrar behåller sina egna lås, dubblettkontroller och kvitton. Feltexten innehåller aldrig råa leverantörssvar.

`GET /api/payment-control/overview` och `GET /api/payment-control/status?id=...` läser enbart den inloggade ägarens data. UI:t fortsätter en sparad körning när arbetsytan är öppen; vid stängd webbläsare finns jobbet kvar för återupptagning vid nästa besök. Detta skapar eller aktiverar inget molnschema och garanterar ingen framtida extern hämtning utan en tillgänglig körningsutlösare.

Gmail respekterar 15 minuters kylperiod och visar kvarvarande paginering. Dokumentsteget behandlar högst två molndokument; skannade dokument ligger kvar i den befintliga Windows-OCR-kön. Pausad dokumentautomatik bevaras. Bankkontrollen respekterar sex timmars anropsbegränsning. Sparat underlag och ofullständiga steg redovisas separat; ett avslutat jobb bevisar inte att alla fakturor är betalda.

## Verksamhetsregler

Översikten skiljer fakturerat, verifierat betalt, kvar att stämma av och verifierat utestående. Verifierat utestående kräver en separat kontroll med dokumenterad motivering; en delbetalning ensam räcker inte. Förfallodatum är en separat signal och ger ingen automatisk utsaga om utebliven betalning.

Granskningskön samlar dokument, identifieringsproblem, Bankgiro, ekonomiska avvikelser och mejlutkast. Oklar mejlleverans prioriteras. En bankhändelse ger en betalningspost även när flera fakturor kan passa. Fullständiga Bankgirospecifikationer ersätter sin samlingspost ekonomiskt; bankoriginalen finns kvar. Lön, kortköp och identifierade kortåterbetalningar visas separat.

Avstämningen återanvänder den befintliga konservativa motorn. Belopp ensamt är aldrig betalningsbevis. En möjlig momsdifferens kräver att netto, moms, total och verifierad betalning stämmer tillsammans och uttrycks som en fråga. Saknad/fel referens, privat betalare, flera fakturor, överbetalning och möjlig dubbelbetalning kräver granskning när underlaget inte är entydigt.

Kundmejl kräver fortsatt verifierad adress, aktuella faktauppgifter, aktuell granskad version och uttryckligt engångsgodkännande. Redigering kräver ny granskning. Ingen kontroll-, OCR- eller schemaväg skickar mejl. Osäker Gmail-leverans låses för manuell kontroll och skickas inte om automatiskt.

## Migration och verifiering

Migration `0007_material_the_spike.sql` lägger enbart till `payment_control_runs`, `payment_control_requests` och index. Migration `0008_minor_jazinda.sql` lägger till `bank_connections.control_last_attempt_at`, en separat reservationsstämpel för manuell huvudkontroll. Även misslyckade eller avbrutna försök respekterar sex timmar, utan att ändra automatikschema. Tidigare migrationsfiler och produktionsrader ändras inte. Runtime-hemligheter och schemainställningar ändras inte.

Testerna använder isolerad SQLite som D1-adapter samt Workerd för riktig PDF-tolkning. De provar SQL-reservationer, samtidighet, idempotens, återstart, utgången lease, ägarisolering, origin-kontroll, säkra fel, Gmail-/bankkylperioder, pausad dokumentkö, saldon, Bankgiro, mejlspärrar och klientens sena svar. En lokal Vite/Workers-förhandsvisning med separat D1/R2 används för UI-kontroll av hela flödet och mobil/laptop. Dessa tester ersätter inte efterföljande produktionsverifiering med verkliga anslutningar.
