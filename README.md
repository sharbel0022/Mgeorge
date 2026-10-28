# MG Fakturakoll – M.George Vitvaror AB

Ett svenskt, självhostat system för kundfakturor, leverantörsfakturor, originalunderlag och bankavstämning. Gränssnittet följer de ljusa, blå designreferenserna och använder samma navigation på dator och mobil. Alla sammanställningar beräknas från den lokala databasen; en ny installation innehåller inga exempeltransaktioner.

Det här är den fristående källkodsversionen i detta repository. Den tidigare publicerade [ChatGPT Sites-webbplatsen](https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site/) har separat kod och databas. Dessa ändringar publiceras inte automatiskt där och flyttar inga företagsuppgifter mellan systemen.

## Ny arbetsyta: en betalningskontroll

Översiktens **Kontrollera alla betalningar** samordnar Gmail, bankhämtning, dokumenttolkning, avstämning och mejlutkast. Sparad stegstatus visar även ofullständiga körningar. **Att granska** samlar beslut, och fakturadetaljen visar original, betalningar och mejl tillsammans. Kortköp och lön ligger separat från kundinbetalningar. Inga mejl skickas av huvudknappen.

Funktionen gäller Node-versionen i detta repository, **inte en automatisk uppdatering av ChatGPT Sites**. Läs [genomförande, säkerhet och Sites-avgränsning](docs/ONE-CLICK-PAYMENT-CONTROL.md). Befintliga anslutningar, automatiseringsval och manuellt godkännande av kundmejl bevaras.

## Kom igång lokalt

Kräver **Node.js 22.13 eller senare**, med inbyggda `node:sqlite`. Installera låsta beroenden med `npm ci`. Node-gränssnittet kräver inget byggsteg. PDF.js, Canvas och Tesseract används för lokal dokumenttolkning.

```bash
git clone https://github.com/sharbel0022/Mgeorge.git
cd Mgeorge
npm ci
npm run setup
npm start
```

Öppna `http://localhost:3000`. Appen öppnas direkt utan lösenord eller inloggningssida. Kommandot skapar en Git-ignorerad `.env` med krypteringsnycklar för anslutningarna. En befintlig `.env` behålls. Om en databas finns men konfigurationen saknas avbryts skapandet för att skydda installationens ursprungliga krypteringsnyckel.

`npm start` läser `.env` och kör `src/server.js`. `npm run dev` använder samma konfiguration och startar om servern vid kodändringar. Du kan också skapa `.env` manuellt från `.env.example` och starta med `node --env-file=.env src/server.js`.

Servern lyssnar endast på `127.0.0.1`. Lokalt används den utan appinloggning. En webbläsarsession skyddar returflöden från Google och banken. För HTTPS-drift bakom en betrodd reverse proxy krävs `MG_ADMIN_PASSWORD` med minst 16 tecken; alla företags-API:er kräver då administratörsinloggning. Proxy ska bevara den konfigurerade domänens Host, terminera HTTPS och skydda den lokala anslutningen. Befintliga fakturor och underlag behålls. Bevara `BANK_DATA_KEY`: utan den kan befintliga bank- och Gmail-anslutningar inte dekrypteras.

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
- Valbar återkommande hämtning var 15, 30 eller 60 minut, var fjärde timme eller dagligen. Bankhämtning är manuell från början. Gmail har separat intervall på 15 minuter efter anslutning, vilket kan ändras eller stängas av i Inställningar.

## Anslut bank och Gmail

**Swedbank:** En tidigare delad PEM betraktas som komprometterad och får inte användas. Återkalla den hos Enable Banking och registrera ett nytt certifikat först. Ange `ENABLE_BANKING_APPLICATION_ID`, `ENABLE_BANKING_ENVIRONMENT=SANDBOX` eller `PRODUCTION` och exakt en serverkälla för nyckeln: `ENABLE_BANKING_PRIVATE_KEY_FILE` utanför repositoryt eller `ENABLE_BANKING_PRIVATE_KEY` i skyddad miljö. Produktion kräver dessutom HTTPS och `ENABLE_BANKING_KEY_ROTATED=true`, vilket administratören endast får sätta efter genomförd rotation. Flaggan ersätter inte återkallningen hos leverantören.

Registrera exakt `APP_ORIGIN` följt av `/api/bank/callback`. Backend kontrollerar den verkliga applikationens miljö, aktivering, AIS, Sverige och returadress innan bankflödet startas. Öppna **Bank → Koppla banken**, godkänn hos Swedbank och välj företagets SEK-konto. Medgivandet lagras krypterat; kontovalet startar hämtning av de senaste 30 kalenderdagarna. Hämtningen kan misslyckas separat utan att en lyckad import påstås. Du kan förnya, uppdatera och koppla från banken i samma vy. Riktiga konton kräver godkänd produktionsåtkomst, avtal och verkligt bankmedgivande. Se [bankguiden](docs/SWEDBANK.md) och [jämförelsen med Sites](docs/SWEDBANK-SITES-COMPARISON.md).

**Gmail:** Aktivera Gmail API i företagets Google Cloud-projekt, skapa en OAuth-webbklient och registrera `APP_ORIGIN` följt av `/api/gmail/callback`. Ange `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` och `GMAIL_ACCOUNT=mg.vitvaror@gmail.com`. Starta om servern och välj **Import → Koppla Gmail**. Se [Gmail-guiden](docs/GMAIL.md) för hela flödet.

Gmail hämtar PDF- och bildbilagor från mottagna, arkiverade och skickade mejl. Dokumenten tolkas med PDF.js och lokal svensk OCR vid behov. Original, fältvärden, källbelägg och säkerhetsnivå bevaras. Granska originalet bredvid uppgifterna och godkänn eller avvisa. Okända motparter och OCR-resultat kräver granskning. Valbar automatisk registrering gäller endast gröna textfakturor från redan kända motparter; säkra betalningar kan därefter matchas automatiskt enligt den konservativa avvikelsemotorn. Se [tolkning och granskning](docs/INVOICE-EXTRACTION.md).

Schemalagd hämtning kräver att **Node-servern är igång**, att integrationerna är konfigurerade och att medgivandena gäller. Jobb körs på servern utan att webbläsaren behöver vara öppen. Endast entydiga betalningar med verifierat bankunderlag, kundidentitet och exakt referens avstäms automatiskt. Kundmejl kräver alltid uttryckligt administratörsgodkännande. Riktiga Google- och bankflöden behöver verifieras med företagets behöriga konton; automatiska tester använder kontrollerade API-svar.

## Bankfiler och Bankgiro

Bankimporten stöder SEK och högst 1 000 bokförda händelser per fil. Andra valutor stoppas så att belopp aldrig felaktigt etiketteras som kronor. CSV-format varierar mellan banker; kontrollera alltid förhandsgranskningen och verifiera ett verkligt, anonymiserat kontoutdrag före drift.

En samlad Bankgiroinsättning utan fullständig betalningsspecifikation behålls **en gång** och kan inte matchas som om den gällde en enda faktura. Status är **Betalardetaljer saknas – importera betalningsspecifikation.** Importera en camt.054-specifikation med betalarnas belopp och referenser och välj det sparade maskerade bankkontot i importen. Om en komplett specifikation kan identifieras som samma samlingspost ersätts eller kompletteras den i avstämningen med revisionshistorik. Olika kontoalias eller saknade bankreferenser kräver manuell kontroll. Beloppslikhet ensam är inte betalningsbevis.

## Tester

```bash
npm run check
npm test
```

Syntaxkontrollen omfattar server, integrationer, gränssnitt, startskript och tester. Testerna skapar tillfälliga databaser och använder inte företagets `.env` eller riktiga externa konton. De verifierar bland annat direkt lokal åtkomst/origin-skydd, fakturastatus, riktning, delbetalningar, dubbletter, samlade Bankgiroposter, import, originalunderlag och Gmail-adaptern.

## Data och drift

Installationen är en **arbetsyta för ett företag och en administratör**. Lokal åtkomst bygger på operativsystemets behörighet; HTTPS-drift kräver administratörslösenord och säkra sessionscookies. Separata användarkonton, roller och flera företag ingår inte. Använd inte en gemensam databas för flera verksamheter. Bankanslutningar har explicit ägare; oinloggade sessioner och andra huvudmän nekas företagsdata.

OAuth-token och bankens anslutningsuppgifter krypteras med AES-256-GCM på servern. Fakturor, bankfiler och registerdata ligger i en privat SQLite-databas och är inte separat krypterade på disk av applikationen. Skydda lagringsplatsen och ordna driftövervakning, HTTPS och backup före publik drift. `.env`, privata nycklar, SQLite-filer, originalfakturor, kundregister och bankutdrag får aldrig läggas i det offentliga repositoryt.

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

## Offentliga informationssidor

[Integritetspolicy](https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site/integritetspolicy) och [användarvillkor](https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site/anvandarvillkor) är publicerade som läsbara utkast på den befintliga Siten. Dokumenten behöver fortfarande granskas och kompletteras för företagets verkliga drift. Se [publicerings- och synkroniseringsguiden](docs/SITES-LEGAL.md).

## Betalningsavstämning och kundmeddelanden

Sites har nu en beständig dokumentkö för PDF-text och lokal Windows-OCR. Se [driftguiden för automatisk dokumenthantering](docs/SITES-DOCUMENT-AUTOMATION.md). OCR-datorn behöver vara på, vaken och inloggad; kundmejl kräver fortfarande ditt godkännande.

Fliken **Kundmeddelanden** visar verifierade betalningar, kvarstående saldo, avvikelse, originalfaktura och ett redigerbart svenskt mejlutkast. Verifiera kundadressen mot ett faktiskt underlag. Öppna och läs varje aktuell mejlversion; efter redigering måste den nya versionen granskas. **Avvisa** stoppar utkastet; **Godkänn och skicka** kräver ett uttryckligt godkännande och separat Gmail-medgivande för utskick.

Saknad/fel OCR, annan betalare, möjliga dubletter och fördelning på flera fakturor kräver granskning. En ny betalning stoppar äldre utkast. Vid Gmail-timeout låses utskicket som oklart och skickas aldrig om automatiskt. Schemaläggaren hämtar, avstämmer och förbereder utkast men kan inte skicka mejl.

Se [leveransrapport och exakt fillista](docs/RECONCILIATION-CUSTOMER-MESSAGES.md) för funktioner, testresultat, API, Google-/bankaktivering och separat arbete för ChatGPT Sites.

Samma avstämnings- och granskningsflöde är separat publicerat i **Sites version 16**, med verifierad Gmail-anslutning och utskicksbehörighet. Se [Sites-rapporten](docs/SITES-CUSTOMER-MESSAGES.md) för patch, testresultat, Google-aktivering och skillnaden i OCR-körning.
