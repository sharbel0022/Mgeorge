# Kodguide: så fungerar MG Fakturakoll

> **Lärandeguide för utvecklare.** Kommentarerna i koden och denna guide beskriver ansvarsgränser utan att ändra programmets funktioner. GitHub-installationen (Node.js/SQLite) är separat från den publicerade ChatGPT Sites-versionen (Cloudflare/D1). Undvik riktiga banknycklar och personuppgifter vid kodstudier.

## 1. Följ ett klick genom hela systemet

```text
Webbläsaren visar public/index.html
        |
public/app.js  -- fetch('/api/...') -->
        |
src/server.js  -- HTTP-route, sessions- och åtkomstkontroll -->
        |                                 |
        |--> src/gmail.js --> Google API  |
        |--> src/bank.js  --> Enable Banking / Swedbank
        |--> src/importers.js --> uppladdad CSV / camt-fil
        |
src/db.js  <--> SQLite
        |
JSON-svar tillbaka till public/app.js
```

**Viktigt:** En knapp i frontend bekräftar inte bankanslutning. Backend måste få ett giltigt medgivande från leverantören och kontrollera bankens sessionsstatus.

## 2. Mapp för mapp

| Plats | Ansvar | Läs först |
| --- | --- | --- |
| `public/index.html` | Grundläggande HTML | Navigering och appens rot |
| `public/style.css` | Färger, layout och responsivitet | Sida, formulär, tabeller |
| `public/app.js` | UI-tillstånd, formulär, API-anrop, renderad data | Nätverksanrop och bankvy |
| `src/server.js` | Node.js HTTP-server, rutter, behörighet, sync | `route`, `syncBank`, `syncGmail` |
| `src/db.js` | SQLite och betalningsregler | `openDatabase`, `allocate`, `invoiceStatus` |
| `src/bank.js` | Läsintegration Enable Banking | `jwt`, `findSwedbank`, `fetchBookedTransactions` |
| `src/gmail.js` | Google OAuth och Gmail-bilagor | `gmailAuthorizationUrl`, `fetchGmailInvoiceDocuments` |
| `src/importers.js` | Normaliserar CSV och camt.053/.054 | `parseBankFile` |
| `src/security.js` | Sessionscookie, hashing, AES-GCM | `sessionCookie`, `encryptObject` |
| `scripts/setup.mjs` | Förbereder lokal .env | Nycklar och datamapp |
| `test/` | Regressioner och kontrollerade integrationstester | `api.test.js`, `bank.test.js`, `gmail.test.js` |

## 3. Exempel: hämta bankhändelser

1. Klick i bankvyn hanteras av `public/app.js`.
2. UI skickar en begäran till en `/api/bank/...`-route i `src/server.js`.
3. Servern kontrollerar session, kontoval, medgivande och aktuell giltighet.
4. `src/bank.js` signerar anropet till Enable Banking med en RSA-nyckel som bara får finnas på servern.
5. Leverantören returnerar bokförda bankhändelser (ibland på flera sidor).
6. `src/importers.js` eller normaliseringslogik omvandlar rådata till gemensamma fält.
7. `src/db.js` sparar unika bankhändelser. Samlad Bankgiroinsättning får inte behandlas som en identifierad enskild fakturabetalning utan detaljer.
8. Servern returnerar status och antal importerade. UI uppdaterar tabellen.

### Koncept att förstå

**JWT och RS256:** Servern skapar och signerar ett intyg för att prata med bankintegratörens API. Det är inte ett BankID-lösenord och används inte av webbläsaren direkt.

**OAuth/medgivande:** Användaren godkänner dataåtkomst hos bank/Google; callback tillåts bara när engångsstate och session kontrollerats.

**Paginering:** API:t kan returnera fortsättningsnyckel, därför måste flera sidor hämtas utan att fastna.

**Idempotens:** Samma bankhändelse ska inte dubbleras när synkroniseringen körs om.

## 4. Exempel: hämta en Gmail-faktura

1. Användaren begär Gmail-anslutning.
2. `gmailAuthorizationUrl()` skapar en Google-länk med `gmail.readonly` och state.
3. Google returnerar en tillfällig kod via `/api/gmail/callback`; servern verifierar medgivandet och byter kod mot token.
4. `gmailProfile()` kontrollerar att det är företagets konfigurerade Gmail.
5. `fetchGmailInvoiceDocuments()` hittar möjliga fakturamejl och bilagor.
6. `src/db.js` lagrar original som granskningsunderlag.

**Nuvarande begränsning:** Denna Gmail-adapter utför inte komplett OCR eller automatisk registrering av alla fakturafält. Det är ett separat utvecklingssteg.

## 5. Exempel: matcha en betalning mot faktura

En faktura och en bankhändelse lagras separat. Tabellen `allocations` knyter ihop dem.

- `matchingSuggestions()`: **föreslår** möjliga kopplingar enligt belopp, riktning, referens och betalare.
- `allocate()`: **bekräftar** en vald koppling med saldokontroller.
- `invoiceStatus()`: **beräknar** betalt/delbetalt/ej avstämt från registrerade kopplingar.
- `deleteAllocation()`: ångrar en matchning med spårbar historik.

**Exempel:** Faktura 3 750 kr, två inbetalningar 2 000 kr + 1 750 kr. Två allocations summerar till 3 750 kr; fakturans saldo blir 0 efter godkännande. Samma belopp utan identitetsbevis är bara ett osäkert förslag.

## 6. Databas och säkerhet

SQLite används via inbyggt `node:sqlite`. Känsliga anslutningstoken krypteras med AES-256-GCM. Det betyder **inte** att alla fakturor och dokument är krypterade som separata objekt. Serverns åtkomstskydd och säker lagring är fortfarande nödvändiga.

Publicera aldrig `.env`, PEM/RSA-nycklar, SQLite-databaser, verkliga CSV-filer eller fakturaunderlag i det offentliga GitHub-repositoryt.

Lokal server kör normalt på `127.0.0.1`. För HTTPS-drift krävs separat administratörsinloggning och säker driftkonfiguration; se `README.md`.

## 7. Läs- och testordning

1. Börja med `public/app.js`: välj en knapp och hitta vilket API-anrop den gör.
2. Hitta samma `/api/...` i `src/server.js`: följ kontrollkedjan.
3. Öppna anropad modul (`src/bank.js`, `src/gmail.js` eller `src/importers.js`).
4. Se hur objektet skrivs i `src/db.js`.
5. Läs testet för samma flöde i `test/`. Experimentera med syntetiska indata, aldrig riktiga företagsuppgifter.

Kör kontroller:

```bash
npm run setup
npm run check
npm test
npm start
```

Tester med mockade banksvar och Gmail-svar är inte bevis för fungerande produktionsmedgivande. Läs `docs/SWEDBANK-PRODUCTION-STATUS.md` för separat verifierad driftstatus på Sites.
