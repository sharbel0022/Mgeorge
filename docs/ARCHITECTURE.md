# Arkitektur och överlämning

## Moduler

- `public`: responsivt gränssnitt, DOM-escaping av användardata, inga tredjeparts-cdn:er.
- `src/server.js`: REST-liknande API med session, origin-kontroll och felhantering.
- `src/db.js`: en lokal SQLite-databas i WAL-läge för fakturor, betalningar, matchningar, historik och bankmedgivande.
- `src/importers.js`: CSV och ISO 20022 camt.053/.054, importer med begränsad filstorlek och dublettskydd.
- `src/bank.js`: signerad Enable Banking API-autentisering via RS256 och enbart Account Information Service (AIS).

## Datamodell

`invoices` och `bank_transactions` kopplas genom `allocations`. Allokerade belopp får inte överstiga fakturans utestående saldo eller transaktionens återstående saldo. Inbetalningar får bara matchas mot kundfakturor och utbetalningar bara mot leverantörsfakturor. Varje bekräftelse skrivs i `audit_events`.

En bankhändelse importeras med en hashfingeravtryck som inkluderar konto, datum, tecken, belopp, referenser och beskrivning. Detta hindrar dubletter från samma export men kan inte garantera unikhet om banken presenterar identiska händelser utan transaktions-ID. Sådana fall behöver manuell kontroll.

## Begränsningar

CSV-format varierar mellan banker, och enskilda ISO 20022-rapporter kan innehålla avancerad struktur eller bankvariationer. Parsern hanterar vanliga kontoutdrag och betalningsspecifikationer och måste verifieras mot en anonymiserad **verklig** export innan drift. XML-parsern är en avgränsad strängextraktion, inte en fullständig XSD-validering. Komplettera med standardkompatibel XML-parser och XSD-testsvit för produktionskrav.

En Open Banking-sessions data kan sakna betalare för en samlad Bankgiroinsättning. Markera inte automatiskt betald faktura om det inte finns tillräckligt underlag.

## Driftchecklista

1. Välj privat datalagring och säkerhetskopior; verifiera återläsning.
2. Sätt långa unika `MG_ADMIN_PASSWORD`, `SESSION_SECRET`, `BANK_DATA_KEY`.
3. Använd HTTPS, en reverse proxy, skyddad runtime och åtkomstkontroll.
4. Konfigurera Enable Banking i sandbox, kör BankID/redirect-test, sedan produktionsavtal.
5. Verifiera kontobehörighet, bokföringsdatum, valutafält, OCR och Bankgirobetalningsspecifikationer.
6. Gör penetrationstest, säkerhets- och dataskyddsgranskning innan riktiga kunduppgifter används.
7. Säkerställ att genererade och lokalt insamlade data aldrig pushas till offentligt GitHub.

## API-endpoints (urval)

- `GET /api/health`, `GET /api/me`, `POST /api/login`, `POST /api/logout`
- `GET|POST /api/invoices`, `PATCH /api/invoices`
- `GET|POST /api/bank-transactions`
- `POST /api/import/preview`, `POST /api/import/commit`
- `GET|POST|DELETE /api/allocations`
- `GET /api/dashboard`, `GET /api/audit`
- `GET /api/bank/status`, `POST /api/bank/connect`, `GET /api/bank/callback`, `POST /api/bank/sync`
