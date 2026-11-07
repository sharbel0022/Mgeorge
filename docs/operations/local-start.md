# Starta lokalt

Kör från repots rot:

```sh
npm start
```

Node.js 22.13 eller senare och npm 10 eller senare krävs. Projektets CI verifierar Node 22.23.4 och 24.22.1. Använd gärna en av dessa LTS-versioner. Docker och globalt installerade ramverk behövs inte för den lokala Node-appen.

Startkommandot kontrollerar versioner, låser denna checkout mot samtidig start och kontrollerar konfigurationen. Om de lokala Node-beroendena saknas kör det `npm ci --ignore-scripts --no-audit --no-fund` med projektets låsfil. Inga globala paket installeras. Nätverksåtkomst till paketkällorna krävs vid första installationen. Ett avbrutet beroendesteg kan köras om med samma kommando.

För en ny installation skapas `.env` med slumpmässiga sessions- och krypteringsnycklar och filrättighet 0600 på POSIX. Nycklar som redan angetts i processmiljön bevaras även i den nya filen. En befintlig `.env` skrivs aldrig över. Om en databas, dess WAL-filer eller företagsdatabaser redan finns utan `.env` avbryts starten. Återställ då ursprunglig `.env` och `BANK_DATA_KEY` från din privata säkerhetskopia. Att skapa en annan krypteringsnyckel kan göra sparade bank- och Gmail-token oläsbara. `ENCRYPTION_KEY` är ett kompatibilitetsalias; båda nycklarna måste vara identiska om båda anges.

Därefter kontrolleras appens loopbackport och `apps/api/index.js` startar den befintliga servern i `src/server.js`. Servern öppnar SQLite och kör sina befintliga additiva migrations- och företagsgränskontroller; launchern kör inga destruktiva migreringar. Samma process serverar frontendfilerna i `public/`, API och schemalagda integrationsjobb. Dokumenttolkning startar begränsade arbetarsubprocesser vid behov. Sites/Vinext är en separat körmiljö och behöver ingen extra utvecklingsserver för detta flöde.

Standardadressen är **http://localhost:3000**. Meddelandet `Redo:` visas först efter ett lyckat HTTP-anrop till `/api/health` där den startade processen har autentiserat en slumpmässig launcherutmaning. Proben har en tidsgräns på 20 sekunder och begränsad svarsstorlek. En process som bara råkar använda samma port räknas aldrig som redo. Readiness betyder att appen svarar; det intygar inte att externa bank-, Gmail- eller AI-konton är anslutna.

Spara en privat säkerhetskopia av `.env`. Lägg aldrig filen, databasfiler eller privata nycklar i Git.

## De vanliga kommandona

| Kommando | Användning |
| --- | --- |
| `npm start` | Förbered och starta hela den lokala Node-appen. |
| `npm run dev` | Samma start med bevakning av backend och delade moduler; en ändring stoppar föregående server innan omstart. |
| `npm run setup` | Förbered säker konfiguration och installera saknade låsta Node-beroenden, utan att starta appen. |
| `npm run doctor` | Läs konfiguration, beroendestatus, databasplats, port och valfria integrationsinställningar. Skriver inga filer och öppnar inte databasen. Saknad obligatorisk konfiguration eller beroenden ger felstatus. |
| `npm run stop` | Be denna checkouts autentiserade launcher att avsluta, och vänta på bekräftelse. |
| `npm test` | Kör Node-testsviten; övriga befintliga kvalitets-/CI-kommandon finns kvar. |
| `npm run build` | Bygg Sites med dess riktiga byggverktyg. Om Sites-verktygen saknas används Sites egna låsta `install:ci`; kommandot skapar ingen appkonfiguration och startar ingen app. |

`node scripts/setup.mjs` finns kvar som kompatibilitetsingång. Direkt körning av `src/server.js` fungerar fortfarande med uttryckligen laddad miljö, men normal lokal drift använder rootkommandona ovan.

## Konfiguration och valfria anslutningar

`.env.example` beskriver inställningarna. Verkliga processmiljövariabler har företräde framför `.env`. Databasen väljs med `DB_PATH`, som annars är `./data/mgeorge.sqlite`. Företagsdatabaser ligger normalt i en `companies/`-katalog bredvid databasen; `MG_COMPANY_DIRECTORY` kan ange annan plats.

OpenAI, Gmail, bank och Bankgiro behöver inga riktiga nycklar för säker lokal start. Start och doctor visar konfigurationsstatus utan att kontakta leverantörerna eller skriva ut hemligheter. AI:s status `configured` betyder lokal konfiguration, inte ett verifierat leverantörsanrop eller godkännande att skicka kundoriginal. Saknad AI-nyckel, inaktiverad AI och en ogiltig modell hindrar inte själva appstarten; befintliga AI-grindar avgör att OCR används när AI inte är tillgänglig. Anslutningar och eventuellt nya medgivanden hanteras i appen med befintliga behörighetskontroller.

För annan lokal appport, sätt **båda** värdena i `.env`:

```dotenv
PORT=3100
APP_ORIGIN=http://localhost:3100
```

Vid upptagen port avbryter starten med komponent och åtgärdsförslag. Ingen portägare dödas. Stoppa en tidigare projektstart med `npm run stop`, välj annan port eller hantera den andra tjänsten själv.

## Avslutning och fel

Ctrl+C och `npm run stop` stänger schemalagda timer, server och dess dokumentarbetare. En arbetare som inte avslutas får en begränsad respittid. Föräldralös server och arbetare upptäcker förlorad IPC-anslutning och avslutar sig. Utvecklingslägets watcher ägs av samma launcher och stängs samtidigt.

Launchern använder en separat loopbackport, deterministiskt vald från checkoutens verkliga sökväg i intervallet 40000–59999, och en slumpmässig 256-bitars kontrolltoken i den privata katalogen `.runtime/`. Portbindningen förhindrar samtidiga launcherinstanser. Kontrollinformationen skrivs atomiskt och tas bort vid normal avslutning. Stopkommandot autentiserar kontrollkanalen för just denna checkout; det skickar aldrig signaler till ett PID läst från en fil. En gammal kontrollfil efter hård processavslutning kan inte användas för att döda en senare process. En kontrollportkollision ger ett tydligt fel och lämnar den andra processen i fred.

Kör `npm run doctor` när starten misslyckas. Vid saknade krypteringsnycklar ska ursprunglig konfiguration återställas. Vid beroendefel ska npm-/nätverksfelet åtgärdas före ett nytt försök. Fel efter att SQLite öppnats hanteras av de befintliga databas- och migrationsskydden; ta inte bort databasen för att kringgå dem.

Linuxflödet är verifierat med verklig ren installation, HTTP och frontend, Ctrl+C, stopp, omstart, utvecklingsbevakning och portkonflikt. Launchern innehåller portabel Windows-hantering för npm, men Windows har inte körts i denna verifiering.
