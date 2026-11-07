# Domäner och offentliga ingångar

Nya Node-anrop från applikationens samordningslager använder `packages/<domän>/index.js`. Dessa ingångar exporterar befintlig implementation; de kopierar inga regler eller data. Interna importer i äldre moduler fungerar fortsatt. Det gör migrationen stegvis och håller regressionstester och gamla script kompatibla.

| Domän | Ansvar | Intern implementation |
|---|---|---|
| `ai` | AI-konfiguration, Responses, schema, källbelägg, budget och granskning | `sites/lib/openai-invoices/` samt tunna Node/Workers-adaptrar |
| `bank` | Enable Banking/Open Payments, medgivanden, konton och hämtning | `src/bank*.js`, `src/company-bank-sync.js`, `src/banking/`, `sites/lib/banking/` |
| `bankgiro` | Rapportintag, original, källbehörighet och beviskopplingar | `src/bankgiro-*.js`, gemensamma `sites/lib/bankgiro-*.js` |
| `gmail` | OAuth och bounded dokumentintag | `src/gmail.js` |
| `ocr` | PDF-text och isolerade Tesseract-arbetare | `src/invoice-extraction.js`, `src/invoice-worker.js` |
| `invoices` | Fakturatolkning, originalkontroll och godkännande | `src/invoice-review.js`, `src/invoice-details.js` |
| `payments` | Översikt, referenser och samordnad betalningskontroll | `src/payment-*.js` |
| `reconciliation` | Förslag, ekonomiska kontroller och allokering | `src/reconciliation*.js`, `src/manual-multiple-allocation.js` |
| `auth` | Loginbegränsning och sessionsprimitiver | `src/login-rate-limit.js`, `src/security.js`; HTTP-grinden ligger i `src/server.js` |
| `companies` | Aktuell aktör, medlemskap och företagsgräns | `src/company-runtime.js`, `sites/lib/company-contract.js` |
| `database` | SQLite-schema, original, register, audit och transaktioner | `src/db.js` |
| `security` | Hashning, kryptering och skyddade nyckelfiler | `src/security.js`, `src/private-key-file.js` |
| `shared` | Rena företags- och referenskontrakt | Gemensam kod under `sites/lib/` |
| `backup` | Krypterad backup och isolerad verifierad återställning | `src/backup.js` |
| `jobs` | Jobblås, leases och beständig återhämtning | `src/integration-jobs.js` |
| `messages` | Granskade mejlförslag och uttryckligen godkänd sändning | `src/customer-messages.js` |

## Runtimegräns

`packages/` är serverkod för Node. Importera inte dess databas-, nyckel- eller filmoduler i webbläsaren eller Workers. Sites behåller sina offentliga serviceingångar i `sites/lib/` och sin `sites/`-rot som självständigt byggbar källkod. De faktiska ingångarna listas i [arkitekturen](../docs/architecture/ARCHITECTURE.md).

Gemensamma rena regler och AI-implementation ligger fysiskt under `sites/lib/`, eftersom en Sites-publicering bara innehåller `sites/`. Node återanvänder dem genom dessa exporter. Flytta dem inte utanför Sites-roten utan att samtidigt ändra och verifiera publiceringskontraktet.

Modulansvar betyder kodens ansvar, inte att en viss person eller agent exklusivt äger repositoryt. Ändringar av en gemensam regel behöver båda runtime-sviterna. HTTP-/SQL-/OAuth-/ekonomigränser ska förbli explicita; ett paketnamn ger ingen behörighet.
