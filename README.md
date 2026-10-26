# MG Fakturakoll – M.George Vitvaror AB

Ett svenskt, självhostat system för kundfakturor, leverantörsfakturor, originalunderlag och bankavstämning. Gränssnittet följer de ljusa, blå designreferenserna och använder samma navigation på dator och mobil. Alla sammanställningar beräknas från den lokala databasen; en ny installation innehåller inga exempeltransaktioner.

Det här är den fristående källkodsversionen i detta repository. Den tidigare publicerade [ChatGPT Sites-webbplatsen](https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site/) har separat kod och databas. Dessa ändringar publiceras inte automatiskt där och flyttar inga företagsuppgifter mellan systemen.

## Kom igång lokalt

Kräver **Node.js 22.13 eller senare**, med inbyggda `node:sqlite`. Inga externa npm-paket eller byggsteg behövs.

```bash
git clone https://github.com/sharbel0022/Mgeorge.git
cd Mgeorge
npm run setup
npm start
```

Öppna `http://localhost:3000`. Appen öppnas direkt utan lösenord eller inloggningssida. Kommandot skapar en Git-ignorerad `.env` med krypteringsnycklar för anslutningarna. En befintlig `.env` behålls. Om en databas finns men konfigurationen saknas avbryts skapandet för att skydda installationens ursprungliga krypteringsnyckel.

`npm start` läser `.env` och kör `src/server.js`. `npm run dev` använder samma konfiguration och startar om servern vid kodändringar. Du kan också skapa `.env` manuellt från `.env.example` och starta med `node --env-file=.env src/server.js`.

Servern lyssnar endast på `127.0.0.1` och används lokalt utan appinloggning. En webbläsarsession skapas automatiskt för att skydda returflöden från Google och banken. Befintliga fakturor och underlag behålls. Bevara `BANK_DATA_KEY`: utan den kan befintliga bank- och Gmail-anslutningar inte dekrypteras.

## Funktioner i denna version

- Översikt med verkliga saldon, anslutningsstatus, bankhändelser och granskningsbehov.
- Kund- och leverantörsfakturor med sökning, filter, förfallodatum, OCR/referens, moms, Bankgiro, originalunderlag och betalningshistorik.
- Tydlig skillnad mellan **Ej avstämd**, verifierat **Obetald**, **Delvis betald**, **Betald** och **Förfallen**. Förfallodatumet kontrolleras också separat för fakturor som ännu inte är avstämda.
- CSV-, camt.053- och camt.054-import med förhandsgranskning, bekräftelse, originalfil, dubblettkontroll och importhistorik.
- Matchningsförslag utifrån riktning, OCR/fakturareferens, belopp och betalare. Användaren granskar och godkänner; ett förslag registrerar aldrig en betalning automatiskt.
- Delbetalningar, fördelning av en bankhändelse på flera fakturor, undantag med motivering och spårbart återtagande av matchningar.
- Kreditfakturor med omvänd förväntad betalningsriktning och avdrag i sammanställningar. Återbetalningar kan matchas; automatisk kvittning mellan kredit- och debetfakturor ingår inte.
- Uppladdning och bevarande av PDF, PNG, JPEG och WebP, högst 15 MB per fil. Original hämtas direkt från den lokala arbetsytan.
- Läsanslutning till Swedbank via Enable Banking och Gmail via Google OAuth, efter extern aktivering och godkända medgivanden.
- Företagsinställningar, anslutningshantering, granskningshistorik och JSON-export av registerdata.
- Valbar återkommande hämtning var 15, 30 eller 60 minut, var fjärde timme eller dagligen. Standard är manuell hämtning.

## Anslut bank och Gmail

**Swedbank:** Ange `ENABLEBANKING_APP_ID` och `ENABLEBANKING_PRIVATE_KEY_FILE` i serverns miljö. PEM-nyckeln ska ligga utanför Git-katalogen. Registrera exakt `APP_ORIGIN` följt av `/api/bank/callback` hos Enable Banking. Öppna **Bank → Koppla banken**, godkänn läsning hos banken och välj konto. Riktiga företagskonton kräver leverantörens produktionsåtkomst, tillämpliga avtal och ett verkligt bankmedgivande. BankID ersätter inte denna tekniska aktivering. Anslutningen utför inga betalningar.

**Gmail:** Aktivera Gmail API i företagets Google Cloud-projekt, skapa en OAuth-webbklient och registrera `APP_ORIGIN` följt av `/api/gmail/callback`. Ange `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` och `GMAIL_ACCOUNT=mg.vitvaror@gmail.com`. Starta om servern och välj **Import → Koppla Gmail**. Se [Gmail-guiden](docs/GMAIL.md) för hela flödet.

Gmail-hämtningen bevarar möjliga fakturabilagor från inkorgen och skickade mejl som underlag för granskning. Den skapar inte en verifierad skuld utifrån ett mejls ämnesrad. Kontrollera originalet och registrera fakturauppgifterna. **Automatisk OCR och fullständig PDF-fälttolkning ingår ännu inte.**

Schemalagd hämtning kräver att **Node-servern är igång**, att integrationerna är konfigurerade och att medgivandena gäller. Jobb körs på servern utan att webbläsaren behöver vara öppen. Avstämningar och utskick av betalningspåminnelser godkänns inte automatiskt. Riktiga Google- och bankflöden behöver verifieras med företagets behöriga konton; automatiska tester använder kontrollerade API-svar.

## Bankfiler och Bankgiro

Bankimporten stöder SEK och högst 1 000 bokförda händelser per fil. Andra valutor stoppas så att belopp aldrig felaktigt etiketteras som kronor. CSV-format varierar mellan banker; kontrollera alltid förhandsgranskningen och verifiera ett verkligt, anonymiserat kontoutdrag före drift.

En samlad Bankgiroinsättning utan fullständig betalningsspecifikation behålls **en gång** och kan inte matchas som om den gällde en enda faktura. Importera en camt.054-specifikation med betalarnas belopp och referenser. Om en komplett specifikation kan identifieras som samma samlingspost ersätts samlingsposten i avstämningen. Olika kontoalias eller saknade bankreferenser kan behöva manuell kontroll. Beloppslikhet ensam är inte betalningsbevis.

## Tester

```bash
npm run check
npm test
```

Syntaxkontrollen omfattar server, integrationer, gränssnitt, startskript och tester. Testerna skapar tillfälliga databaser och använder inte företagets `.env` eller riktiga externa konton. De verifierar bland annat direkt lokal åtkomst/origin-skydd, fakturastatus, riktning, delbetalningar, dubbletter, samlade Bankgiroposter, import, originalunderlag och Gmail-adaptern.

## Data och drift

Installationen är en **lokal arbetsyta för ett företag utan lösenordsinloggning**. Separata användarkonton, roller och isolering mellan flera företag ingår inte. Använd inte en gemensam databas för flera verksamheter.

OAuth-token och bankens anslutningsuppgifter krypteras med AES-256-GCM på servern. Fakturor, bankfiler och registerdata ligger i en privat SQLite-databas och är inte separat krypterade på disk av applikationen. Skydda lagringsplatsen. Denna version är avsedd för lokal åtkomst och ska inte exponeras via publik proxy utan separat åtkomstskydd. `.env`, privata nycklar, SQLite-filer, originalfakturor, kundregister och bankutdrag får aldrig läggas i det offentliga repositoryt.

JSON-exporten innehåller registerdata och dokumentmetadata; den är **inte en fullständig säkerhetskopia** av originalfiler eller anslutningshemligheter. För en enkel konsekvent backup: stoppa servern och säkerhetskopiera databasen samt `.env` och privata integrationsnycklar till en skyddad plats. Återställ och kontrollera kopian innan du förlitar dig på rutinen. Automatisk backup, retention och återställning måste ordnas i driftmiljön.

## Projektstruktur

```text
public/               Svenskt webbgränssnitt
src/server.js         HTTP API, sessioner, dokument, anslutningar och bakgrundshämtning
src/db.js             SQLite, migreringar, status, matchningsförslag och historik
src/importers.js      CSV och ISO 20022 camt.053/.054
src/bank.js           Enable Banking AIS-adapter
src/gmail.js          Google OAuth och Gmail-hämtning
src/security.js       Lösenord, sessionscookies och kryptering
scripts/setup.mjs     Lokal engångskonfiguration utan att skriva över befintliga filer
test/                 Kontrollerade enhets- och API-tester
docs/                 Arkitektur och integrationsguide
```

Se [arkitekturen](docs/ARCHITECTURE.md) för datamodell, API och tekniska avgränsningar.
