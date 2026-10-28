# MG Fakturakoll 2.0 – leverans och verifiering

Verifierat 2026-10-28. Produktion: https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site/.

## Leveransstatus

| Område | Faktiskt resultat |
| --- | --- |
| Implementerat i kod | Fem huvudområden, huvudkontroll, beständiga deljobb, samlad kö, bankfilter, fakturadetalj, avvikelseanalys och säkra mejlutkast i Node och Sites. |
| Testat med syntetiska uppgifter | Node: 207/207 tester, 42 JavaScript-filer syntaxkontrollerade. Sites: 177/177 tester, TypeScript och produktionsbygge godkända. Isolerad lokal Workers/D1/R2-miljö för UI och API. |
| Publicerat på Sites | Version **21**, befintligt projekt `appgprj_6adf2f7f7e848191b64192161886b528`. Deployment `appgdep_6ae1cfd97ce88191ae117c04e0202f4a` har status `succeeded`. |
| Verifierat med riktiga externa integrationer | Verklig Gmail-hämtning via huvudknappen: 17 nya underlag. Två molndokument behandlades, OCR-datorn var ansluten och nio dokument väntade på lokal OCR vid kontrollens avslut. Banken använde redan hämtat produktionsunderlag inom sin väntetid; ingen ny bankhämtning tvingades fram. |

Sites-källcommit: `6adb8e58b111887074426b3c8d84d5610885a342`. Utgångspunkt var version 20, commit `0287a087ee419f49dd655fe61c12be2c683b850c`. Node-förbättringarna och rättningen av PR #5:s granskningsfynd finns i commit `ed02876b1067595b62d4d9242b9820812c348eb9`. Denna rapport och den verifierade Sites-patchen ingår i efterföljande GitHub-commit i samma PR.

## Vad som fungerar

- Översikt med fakturerat, verifierat betalt, kvar att stämma av, verifierat utestående, förfallodatum, granskningsbehov och integrationsstatus.
- En huvudknapp: Gmail → dokument → bank → avstämning → mejlutkast. Beständigt request-ID, en aktiv körning per ägare, atomisk reservation och säkert återtagande efter utgången lease.
- En kö för dokument, osäker betalare/referens, Bankgiro, ekonomiska avvikelser och kundmeddelanden. En bankhändelse ger högst en betalningsuppgift även vid flera fakturaförslag. Oklar leverans prioriteras.
- Sju bankfilter. Lön, kortköp och identifierade kortåterbetalningar visas under Övriga transaktioner med bankens ursprungliga beskrivningar.
- Fakturadetalj med originalets första sida, extraherade ekonomiska fält, verifierade betalningar, förslag, avvikelseanalys och aktuella svenska mejlutkast.
- Verifierat utestående kräver separat dokumenterat kontrollunderlag. En vanlig delbetalningsallokering räcker inte. Möjlig momsavvikelse kräver konsistenta netto-, moms-, total- och betalningsbelopp.
- Befintlig godkännandeväg för kundmejl återanvänds: adressverifiering, aktuell version, engångsgranskning, uttryckligt godkännande och beständig leveransspärr. Ny betalning omprövar gamla utkast. Ingen kontroll eller schemaväg kan skicka mejl.
- PR #5:s bankproblem rättat: högst tre redo Node-anslutningar väljs efter äldsta försök. Kylperioder och återkommande fel kan inte permanent svälta övriga konton.

## API och migreringar

Sites nya API:

| Metod och väg | Funktion |
| --- | --- |
| `GET /api/payment-control/overview` | Ägarbunden ekonomisk modell, kö, integrationsstatus och senaste körning. |
| `POST /api/payment-control/run` | Starta eller återanvänd med enbart `request_id`. |
| `POST /api/payment-control/advance` | Kör ett begränsat sparat steg med enbart körnings-ID. |
| `GET /api/payment-control/status?id=...` | Läs sparad ägarbunden stegstatus. |

Sites migration `0007_material_the_spike.sql` skapar `payment_control_runs`, `payment_control_requests` och index, inklusive unik aktiv körning per ägare. `0008_minor_jazinda.sql` lägger till den nullable kolumnen `bank_connections.control_last_attempt_at`. Den reserverar sex timmars huvudkontroll före provideranrop även vid fel eller avbrott, utan att aktivera eller ändra schemat. Båda migreringarna har applicerats i produktion genom Sites-deployment. Tidigare migreringar ändrades inte.

Node behåller sina befintliga kontrollendpoints. Fakturadetaljens GET får `analysis` och översikten kompletteras med nyckeltal och `last_successful_control`. Additiv SQLite-migration lägger till `bank_connections.control_attempt_at`; befintliga körnings- och affärstabeller bevaras.

## Faktisk produktionsverifiering

1. Ny navigation och huvudknapp öppnades i den befintliga autentiserade Chrome-arbetsytan.
2. Omedelbart efter deployment var arbetsyterevisionen fortfarande 13. Gmail-token, bankanslutningens identitet/krypterade session, kontoval och automatikflagga var bevarade. Samtliga 19 befintliga originaldokument hade samma ID och SHA-256 som före deployment.
3. Ett verkligt knapptryck startade D1-körning `a32a27cf-c759-4fd7-aab7-23d3c21a8481`. Alla fem steg sparades och status uppdaterades i gränssnittet.
4. Gmail importerade 17 nya original. Totalt fanns därefter 36 dokument, med samtliga ursprungliga 19 ID/hash bevarade. Två molndokument behandlades; återstående paginering/OCR markerades som väntande. En senare återläsning visade uppdaterad Windows-arbetarsignal och inga kvarvarande `waiting_ocr`-poster; molnkön hade fortfarande fyra väntande PDF-jobb. Detta bekräftar att den befintliga lokala OCR-kedjan fortsatte bearbeta underlagen utan att något molnschema återaktiverades.
5. Banken rapporterade **Sparat underlag** och nästa tillåtna försök. Ny extern bankhämtning gjordes inte eftersom väntetiden gällde. Bankhistoriken finns kvar; bankvyn visade totalt 111 bevarade transaktioner, varav 71 i Övriga transaktioner och 40 samlingsposter som behöver specifikation. Före publiceringen visade den gamla menyn 71 som sin statusindikator, inte ett verifierat totalantal.
6. Fyra befintliga fakturor och totalt 13 125 kr registrerat kundfakturabelopp fanns kvar. Faktura 0604 öppnades med korrekt belopp, moms/netto och faktisk renderad originalbild. Ingen betalning hittades som kunde avstämmas automatiskt i denna körning.
7. Slutstatus blev **Delvis klart**, eftersom Gmail-paginering och dokumentkö återstod. Ingen falsk uppgift om full betalning visades.
8. Den verkliga granskningskön och ett kundutkast öppnades. Utskicksbehörighet fanns, men kundadressen saknade verifiering och godkännandekryssrutan var tom. **Godkänn och skicka** var spärrad. `customer_deliveries` innehöll fortfarande noll rader efter testet.
9. De båda molnschemana var fortfarande pausade efter publicering och verklig kontroll. Inga runtime-hemligheter, OAuth-scopes eller åtkomstpolicyer ändrades.
10. Windows/Chrome desktop, laptopbredd 1280, surfplatta 768, smalt fönster 600 och mobil 390 kontrollerades. Ingen yttre horisontell overflow på översikten vid de testade smala bredderna. Syntetiskt verifierades också delbetalningen 2 500/3 125 kr, kvar 625 kr, originalvisning, granskning, bankfilter och mejlspärr.

## Begränsningar som återstår i drift

- Bankgiro-samlingsposter behöver verkliga individuella betalningsspecifikationer innan betalare och fakturor kan verifieras. Beloppslikhet ensam räcker inte. Inga specifikationer har fabricerats.
- Gmail-historik och OCR bearbetas i begränsade omgångar. Knappen lovar inte att hela historiken töms i en enda körning. OCR-datorn måste vara på, vaken och inloggad; dokumenten väntar annars säkert.
- Sites-körningen lagras beständigt men drivs stegvis av den öppna arbetsytan. Vid stängd flik finns jobbet kvar och kan återupptas nästa besök; en avbruten deloperation kan behöva vänta tills dess lease löpt ut. Detta installerar ingen ny obemannad körning och återaktiverar inga pausade molnscheman.
- Nytt liveanrop till Swedbank och faktiska kundutskick testades inte i denna leverans. Providertransport, bankreservationer och utskickskonkurrens testades syntetiskt; verkliga utskick kräver fortsatt användarens eget godkännande.
- Testsiffrorna bevisar de testade fallen, inte att varje möjlig produktionspost kan registreras eller matchas utan granskning. Det finns fortsatt dokument med osäkra uppgifter som kräver beslut.

## Exakt ändrade filer

Node/GitHub: `README.md`, `docs/ONE-CLICK-PAYMENT-CONTROL.md`, `src/customer-messages.js`, `src/db.js`, `src/payment-control.js`, `src/payment-overview.js`, `src/server.js`, `public/app.js`, `public/messages.js`, `public/payment-control.js`, `test/customer-messages.test.js`, `test/payment-control-api.test.js`, `test/payment-control-ui.test.js`, `test/payment-control.test.js`. Tillkommer denna rapport och `docs/sites/payment-control-v2.patch`.

Sites: `app/api/payment-control/[action]/route.ts`, `app/dashboard.tsx`, `app/globals.css`, `components/customer-messages.tsx`, `components/gmail-workspace.tsx`, `components/invoice-evidence.tsx`, `components/payment-bank-filter.ts`, `components/payment-control.tsx`, `db/schema.ts`, `docs/MG-FAKTURAKOLL-2.md`, `drizzle/0007_material_the_spike.sql`, `drizzle/0008_minor_jazinda.sql`, `drizzle/meta/0007_snapshot.json`, `drizzle/meta/0008_snapshot.json`, `drizzle/meta/_journal.json`, `lib/banking/service.ts`, `lib/banking/store.ts`, `lib/customer-message-text.js`, `lib/customer-messages.ts`, `lib/payment-control.ts`, `lib/payment-overview.ts`, `tests/banking-security.test.mjs`, `tests/customer-messages.test.mjs`, `tests/gmail.test.mjs`, `tests/payment-control-ui.test.mjs`, `tests/payment-control.test.mjs`.

Den kompletta Sites-diffen från version 20 till 21 är versionshanterad i `docs/sites/payment-control-v2.patch`. Den kontrollerades med `git apply --reverse --check` mot den exakta slutkällan. Den ska appliceras på Sites-källan, inte på Node-servern. Produktionens register, dokument eller hemligheter ingår inte i patchen.
