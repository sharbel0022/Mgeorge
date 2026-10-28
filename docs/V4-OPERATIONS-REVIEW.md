# V4 – drift, samtidighet och återställning

Granskad 28 oktober och kompletterad 29 oktober 2026 från `main`/Sites 30 (`f549293`). Detta dokument beskriver lokal kod och syntetisk verifiering. Ingen bankhämtning, produktionsmigration, publicering, Gmail-synkronisering eller ändring av befintliga scheman har körts av denna granskning.

## Teknisk inventering

| Del | Exakt kodreferens | Implementerat och verifieringsgräns |
| --- | --- | --- |
| Node-jobb | `src/integration-jobs.js:5` | Beständig SQLite-lease, skrivtransaktion, tre automatiska försök, väntetid, tokenkontroll och larm. Oberoende anslutningar, riktig andra process, omstart och sena svar testas i `test/integration-jobs.test.js:11` och `test/integration-job-api.test.js:24`. |
| Node-bank | `src/bank.js:86`, `src/server.js:244` | Begränsade AIS-anrop, verifierad session och valt konto, leverantörsväntetid, transaktionssäker lagring och befintligt jobb. Alla HTTP-svar i testerna är styrda. |
| Node-avstämning | `src/reconciliation.js:106`, `src/db.js:287` | Befintlig motor läser bevis och allokerar under `BEGIN IMMEDIATE`. `test/payment-concurrency.test.js:38` kör två verkliga processer och kontrollerar en betalning/allokering/revisionshändelse efter omkörning. |
| Sites-bank | `sites/lib/banking/store.ts:73`, `sites/lib/banking/service.ts:356` | D1-lease per ägare, atomiska skrivningar, optimistisk arbetsyterevision, beständiga försök och befintliga fasta Stockholmsintervall. Lokal SQLite emulerar D1:s transaktioner; verklig D1-drift är inte verifierad av dessa tester. |
| Individuell API-detalj | `sites/lib/banking/details-service.ts:9` | Kontrollerar aktuell bankpost, session, valt konto och originalfält; lagrar JSON-original/hash. Ändrar inte samlingsbelopp eller skapar allokeringar. Ett dokumenterat detaljanrop garanterar inte att Swedbank levererar individuell OCR. |
| Sites-Gmail | `sites/lib/gmail-service.ts:13`, `sites/lib/gmail-service.ts:89` | Befintlig checkpoint, original/hash, OAuth/tokenkryptering, D1-fencing, 15-minutersgräns och tre beständiga automatiska försök. Mockad Google-gräns; ingen verklig förnyelse av medgivande har körts. |
| Dokument/OCR | `sites/lib/document-processing.ts:34`, `sites/lib/document-processing.ts:51`, `sites/lib/document-processing.ts:170` | Beständig kö med högst tre försök, villkorad claim, leasemarkör, återtag av avbrutna jobb, ägaravgränsning och kontrollerad automatregistrering. Befintlig moln-/lokal OCR återanvänds. |
| Moln-OCR-schema | `.github/workflows/sites-cloud-ocr.yml:1` | Ett befintligt schema, separat OCR-token, endast godkänd `main`, begränsad körning och samtidighet. Har inte aktiverats eller ändrats här. Schemalagd drift med företagets token måste kontrolleras i driftmiljön. |
| Sites-avstämning/utkast | `sites/lib/customer-messages.ts:25` | Befintlig avstämning återanvänds. Förbereder utkast; faktisk sändning ligger i separat uttryckligt kommando på `sites/lib/customer-messages.ts:146`. |
| Node-backup | `src/backup.js:13`, `src/backup.js:22` | Konsistent SQLite/WAL-snapshot med databaslagrade original, AES-256-GCM och exklusiv återställning till ny målfil. Faktisk kryptering och isolerad SQLite-återställning testas i `test/backup.test.js:5`. |
| Sites-backup | `sites/lib/backup-engine.ts:5`, `sites/lib/backup-engine.ts:27` | Sammanhängande snapshot av ägartabeller, högst fem original per steg, autentiserad kryptering och hashkontroll. Original kopieras från beständig snapshot, med token och checkpoint. |
| Schema | `sites/db/schema.ts:21`, `sites/db/schema.ts:49` | Additiva fält i `0012_minor_naoko.sql` och `0013_real_mindworm.sql`; ingen tabell eller data tas bort. Migreringarna är genererade med Drizzle, men inte tillämpade i produktion. |

## Konkreta fel som åtgärdats

1. **Utgången Sites-banklease kunde fortfarande skriva.** Det tidigare låset skyddade enbart förvärv och borttagning. Ett sent svar kunde importera efter att en annan körning tagit över. `BankLease.write/run` kontrollerar nu token och databasens klocka inne i samma atomiska D1-batch som mutationerna. Samma skydd omfattar bankhämtning, kontoval, OAuth, frånkoppling och detaljregistrering. Regressioner: `sites/tests/banking-security.test.mjs:593`, `:600`, `:607`, `:616`.

2. **Bankens Retry-After tappades eller kortades.** Sites kastade bort HTTP-fältet, och Node kortade flera dagars väntetid till 24 timmar. Sekunder och HTTP-datum behålls nu. För `ASPSP_RATE_LIMIT_EXCEEDED` utan giltig Retry-After använder Node sex timmars reservväntetid enligt bankkanalens dokumenterade återförsökspolicy; ett giltigt längre värde kortas inte. `test/bank-api.test.js:182` kör verklig schemaläggningskod, kontrollerar beständig sex-timmarsspärr och återöppnar servermodulen utan ett nytt bankanrop. Sites sparar `retry_after` och stoppar manuell, automatisk och huvudkontroll före tillåten tid. Detaljhämtning delar samma spärr. Orimligt stora värden stoppar automatiken och kräver bank-/administratörskontroll; de ersätts inte med ett tidigt försök. Regressioner: `sites/tests/banking-provider.test.mjs:388`, `sites/tests/banking-security.test.mjs:623`, `sites/tests/bank-details.test.mjs:44` och `test/bank.test.js`.

3. **Sites-bank/Gmail kunde fortsätta automatiskt efter obegränsat antal fel eller processavbrott.** Ett försök reserveras nu före externa anrop och lagras i anslutningens `sync_failures`. Tre försök stoppar fortsatt schemalagd hämtning och ger läsbar blockeringsstatus. En lyckad manuell hämtning efter anslutningskontroll återställer räknaren. Befintliga intervall och jobb behålls. Regressioner: `sites/tests/banking-security.test.mjs:634`, `sites/tests/gmail.test.mjs:224` och `:237`.

4. **Avbrutna backupjobb räknades inte som fel.** Övertagande av en utgången backuplease räknas nu, och tre avbrutna försök ger `backup_interrupted` före mer objektåtkomst. Leaseförnyelse kontrollerar D1:s klocka efter väntan på databaslås. Regressioner: `sites/tests/backup.test.mjs:79` och `:87`.

5. **Detaljhämtning kontrollerade inte live-sessionens giltighetstid.** Ett `AUTHORIZED`-liknande svar med förgången `access.valid_until` avvisas nu före transaktionsanrop. Regression: `sites/tests/bank-details.test.mjs:51`.

6. **En efterkontroll kunde felmärka en redan sparad bank-/Gmail-hämtning.** Efter lyckad commit rapporteras nu den sparade hämtningen som lyckad även om avstämning/dokumentbearbetning behöver upprepas. En väntande efterkontroll sparas atomiskt tillsammans med hämtningen innan efterkontrollen startar: bankens lyckade körning behåller en varning i `bank_sync_runs.warnings`, och Gmail använder `gmail_runs.status=completed_pending`. Status-GET visar fortsatt lyckad hämtning, nollställd felräknare och en separat `postprocessWarning`/`postprocess_warning`. Markören tas bort först efter lyckad efterkontroll; nästa lyckade hämtning återhämtar även denna del. Inga original eller lyckade checkpoints återtas. Regressioner: `sites/tests/banking-security.test.mjs:644` och `sites/tests/gmail.test.mjs:250`.

## Verifiering utförd i denna granskning

| Körning | Resultat |
| --- | --- |
| Node: bankadapter/API, backup, beständiga jobb, integrationers återstart, betalningssamtidighet och verkligt processavbrott | **50/50**, inga fel eller överhoppade tester |
| Sites: bankadapter, banktjänster, detaljer, Gmail och backup | **127/127**, inga fel eller överhoppade tester |
| Node syntaxkontroll | **59 filer**, godkänd |
| Sites TypeScript | `npm run check`, godkänd |

Hela projektets slutliga testantal, produktionsbygge, säkerhetsgranskning och UI-bilder redovisas av huvudleveransen. Ovanstående antal gäller en avgränsad delmängd och får inte summeras som ytterligare unika tester utöver den fullständiga sviten.

Ett verkligt abrupt processavbrott testas i `test/payment-concurrency.test.js:61`: en separat Node-process avslutas omedelbart efter att SQLite accepterat den första bankraden inne i en öppen importtransaktion. Ingen stängning, rollback eller produktionshook används. Efter processens avslut öppnas databasen på nytt: ingen delrad, allokering, importrapport eller revisionspost från den avbrutna importen finns, tidigare original är bevarat och saldo är oförändrat. Normal återimport och replay ger exakt en betalning, allokering och automatisk revisionshändelse.

Sites-återställningstestet på `sites/tests/backup.test.mjs:13` skapar sju syntetiska original, kör två begränsade backupsteg, dekrypterar snapshoten och återför dess tabellrader till en separat ny SQLite-databas med aktuell migrationskedja. Det jämför arbetsytans payload, dokumentantal och `PRAGMA integrity_check`, och dekrypterar/jämför samtliga sju original. Fel ägare, nyckel, ändrat original, saknat original, avbrott och sena workers testas separat. Ingen produktionsbackup har återställts och testet bevisar inte att en verklig produktionsnyckel är tillgänglig.

## Säkerhet, återhämtning och rollback

- De nya fälten lagrar enbart väntetid/försöksantal. Inga credentials, kontonummer eller bankpayloads flyttas till koordinationstabeller.
- Bankadaptrarna behåller sina fasta AIS-endpoints och initierar inga betalningar. Gmail-/bankhämtning och efterkontroll skickar inga kundmejl.
- Bank-/Gmail-anslutningens status visar senaste lyckade hämtning och blockering. Administratören ska kontrollera medgivande/leverantör och därefter göra en lyckad manuell hämtning. Vid orimlig Retry-After krävs först bekräftelse från leverantören och behörig konfigurationsåtgärd/ny anslutning; väntetiden återställs inte automatiskt.
- Bank/Gmail fortsätter med sina befintliga tidsintervall. Det skapas inga nya parallella scheman eller betalningsmotorer. Dokument-/backupköerna återanvänder sina checkpoints.
- Originalobjekt vars D1-svar förlorats kan lämnas kvar som oanvänd skyddad data. Att bevara ett eventuellt registrerat original prioriteras framför automatisk radering. Ingen ny gallring införs.
- Kodrollback ska återgå till tidigare testad version i samma Site och med samma D1/R2-bindningar och nycklar. De nya additiva kolumnerna lämnas kvar; den äldre koden kan ignorera dem. Ingen automatisk tabellradering eller databasåterställning används som rollback.
- Före godkänd publicering: verifiera komplett krypterad backup och tillgängliga nycklar, tillämpa additiva migreringar en gång, kontrollera befintliga scheman, och kör en behörig isolerad kontroll innan nya verkliga allokeringar tillåts. En återställning görs först till separat mål och jämförs före varje särskilt beslutad produktionsåtgärd.

## Extern gräns

Verkliga Swedbankrapporter, företagets avtalade kanal/MIG och individuella rapportbehörighet saknas i testunderlaget. Ny kod har inte publicerats eller körts med produktionsmedgivanden. Syntetiska HTTP-svar och en lokal D1-emulering kan verifiera säkerhetsregler och återhämtning, men kan inte styrka verklig betalaridentitet, bankens leveransgaranti, larmleverans eller företagets fulla produktionsflöde.

**EXTERN BLOCKERING – INTE FULLSTÄNDIGT PRODUKTIONSVERIFIERAT.**
