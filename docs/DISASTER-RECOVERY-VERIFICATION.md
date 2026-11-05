# Verifiering av backup och katastrofåterställning

**Kompletterande evidens 2026-11-05:** dagens driftsatta backup är färdigverifierad (362 original, 142 968 213 byte). En ny reproducerbar syntetisk övning mäter faktisk isolerad restore och oberoende integritetsacceptans för 27 tabeller vid samma filantal och bytevolym. Se [mätningar, avgränsningar och regressioner](quality8/recovery-evidence.md) samt [JSON-evidens](quality8/recovery-evidence.json). En verklig produktionsrestore är fortfarande inte genomförd. Den daterade rapporten nedan beskriver den tidigare leveransen.

Datum: **2026-11-02**, Europe/Stockholm. Bas: `a9f88ae1c0f697376b3ecd140e1e80a64405125a`.

Arbetsbranch: `codex/backup-security-stabilization-20261102`.

## Vad denna leverans bevisar

Leveransen stärker Node-backupens publicering och nyckelkonfiguration, tillför en körbar isolerad Sites-återställning och rättar ett bekräftat autentiseringsrelaterat lagringsproblem. Riktiga SQLite-databaser, kryptering, filsystem och lokala HTTP-anrop används i regressionerna. All testdata är syntetisk.

**En faktisk återställning av produktionsbackupen är fortfarande inte verifierad.** Den aktuella driftstatusen har lästs, men inga produktionsoriginal, dekrypteringsnycklar eller kompletta R2-arkiv har hämtats för detta prov. Koden har inte återställt någon produktionsdatabas, skickat kundmejl, genomfört betalningar eller ändrat scheman. Ingen Sites-publicering eller automatisk PR-merge ingår, enligt samordningen av sex parallella uppdrag.

Den nya Sites-databasen är uttryckligen **evidens för återställning**. Alla tabeller har prefixet `evidence_`; applikationen kan inte använda den som sitt vanliga register. Att aktivera en återställd tjänst är ett separat arbete med explicit hantering av gamla sessioner, behörigheter, integrationsnycklar och synkroniseringslägen.

Efter en felaktig synkronisering behöver operatören välja ett bevarat arkiv från rätt tidpunkt och jämföra det återställda tillståndet med händelsehistoriken. Ett kryptografiskt giltigt arkiv kan innehålla ett tidigare verksamhetsfel. Verktyget ändrar därför inga ekonomiska beslut, hittar inte på saknade original och aktiverar inte automatiskt en gammal synkronisering igen.

## 1. Inventering och bevarade kontrakt

| Del | Befintligt beteende | Förändring i denna branch |
| --- | --- | --- |
| Node, `src/backup.js` | SQLite `VACUUM INTO`, AES-256-GCM, `MGBAK001`, originalhashar och registerreferenser; separat restore med exklusivt nytt mål | Krypterad fil skrivs och flushas privat, återläses och verifieras före exklusiv publicering. Samtidiga dagliga körningar verifierar och bevarar vinnaren. |
| Node, `scripts/configure-backup.mjs` | Lokal `.env` och separat `MG_BACKUP_KEY` | Stoppar ny nyckel när arkiv redan finns. Atomisk, privat och verifierad konfigurationsskrivning; lås, dubblett- och symlänkskontroll. |
| Sites, `sites/lib/backup-engine.ts` | Ägaravgränsad D1-snapshot, 20 beständiga tabeller, krypterade R2-kopior, stegvis kopiering och manifestpass | Befintlig produktionsmotor och format behålls; omfattande regressionsprov körs. |
| Sites, ny `sites/scripts/lib/backup-recovery.mjs` | Ingen fristående export-/återställningsverifierare fanns i bascommitten | Läser och autentiserar komplett backup, skapar krypterad portabel export och verifierar exakt manifest-/objekt-/tabellförteckning. |
| Sites, ny `sites/scripts/restore-backup-isolated.mjs` | Tidigare tester infogade själva dekrypterade rader i SQLite | Körbar funktion och CLI som validerar före utskrift till disk och skapar en ny evidenskatalog med verklig SQLite och originalbytes. |
| Node-autentisering, `src/server.js` | HTTPS-anrop utan giltig cookie skapade persistenta anonyma sessioner även vid nekad åtkomst | Nekade läsningar och misslyckade/throttlade inloggningar skapar inga sessioner. Lyckad inloggning roterar token och städar utgångna sessioner. |

Inga paketversioner, låsfiler, migrationsfiler, produktionsrutter för Sites, bank-/Gmail-/OCR-regler, ekonomiska beslut eller användargränssnitt ändras av denna leverans.

### Sites-tabeller

Följande 20 beständiga tabeller ingår i den befintliga snapshoten och i det nya återställningsprovet:

`workspaces`, `audit_events`, `documents`, `bank_applications`, `bank_connections`, `bank_sync_runs`, `gmail_connections`, `customer_contacts`, `customer_messages`, `reconciliation_findings`, `customer_deliveries`, `gmail_sources`, `gmail_runs`, `document_automation`, `document_jobs`, `document_extractions`, `invoice_counterparties`, `document_registrations`, `payment_control_runs`, `payment_control_requests`.

Sex avsiktligt undantagna tabeller skapas tomma av betrodda migrationer i evidensdatabasen: `bank_auth_flows`, `bank_locks`, `gmail_flows`, `gmail_locks`, `customer_reviews`, `backup_runs`. Tillfälliga OAuth-flöden, lås, engångsgodkännanden och backupkoordinatorns egna körningar aktiveras alltså inte. Alla 26 tabeller döps sedan om till `evidence_*`. Exakta autentiserade rader i de 20 beständiga tabellerna behålls, även krypterade integrationsfält och schemakonfiguration; ingen tyst rensning av ekonomisk historik sker.

Den läsande D1-översikten i den aktuella driftmiljön visade samma 26 tabellnamn, utan trunkering. Detta kontrollerar tabellinventeringen, inte samtliga verkliga rad- eller originalreferenser.

## 2. Kryptering och nyckelhantering

| Användning | Nyckel/format | Vad som verifierats |
| --- | --- | --- |
| Node-arkiv | `MG_BACKUP_KEY`, 64 hextecken/32 bytes; AES-256-GCM, slumpad 12-byte IV, autentiserad formatheader | Rätt och fel nyckel, manipulerad/trunkerad fil, verklig dekryptering och SQLite-/originalkontroll. |
| Sites-arkiv | `BACKUP_ENCRYPTION_KEY`, 64 hextecken/32 bytes; HKDF-SHA-256 och AES-256-GCM, slumpat salt och IV | Ägare, backup-ID och objektnamn är bundna med AAD. Fel ägare/nyckel/backup, utbytta objekt och modifierad ciphertext avvisas. |
| Sites-exportmanifest | Samma arkivnyckel, eget AAD-objektnamn `recovery-manifest` | Manifestet autentiseras och jämförs med snapshoten och varje faktisk fil. Klartextmanifest får inte ersätta det. |
| Node-integrationer | Befintlig `BANK_DATA_KEY`/konsekvent `ENCRYPTION_KEY` | Separat från arkivnyckeln. Arkivdekryptering bevisar inte att bank/Gmail kan återanslutas. |
| Sites-integrationer | Befintlig `BANK_DATA_ENCRYPTION_KEY` | Separat runtimehemlighet; ägar-/ändamålsbunden kryptering täcks av säkerhetstesterna. |

Aktuell runtime-metadata visade revision **9** och att `BACKUP_ENCRYPTION_KEY` samt `BANK_DATA_ENCRYPTION_KEY` finns som hemligheter med maskerade värden. Inget värde hämtades i klartext eller användes för produktionsdekryptering. Att en hemlighet är konfigurerad bevisar inte att en oberoende återställningskopia finns eller är åtkomlig efter ett kontobortfall.

### Skydd för lokal konfiguration

Konfigurationsskriptet läser Node:s dotenv-format, bevarar befintliga nycklar och annan konfiguration och avvisar tvetydiga dubbla backupinställningar. Om `.mgbak`-arkiv redan finns och nyckeln saknas/är tom stoppar det före nyckelgenerering. Ett felaktigt befintligt nyckelformat repareras inte genom rotation.

Skrivning sker till en ny privat fil på samma filsystem, med flush och bytekontroll före atomisk ersättning av `.env`. Den tidigare filen och identiteten kontrolleras igen innan publicering. Exklusivt lås hindrar två konfigurationsskript från att generera konkurrerande nycklar. Låset och stagingkatalogen matchar repositoryts befintliga `.env.*`-ignore. Hemligheter skickas inte som kommandoradsargument eller till loggen.

Efter ett abrupt processavbrott kan ett lås eller en privat stagingkatalog finnas kvar. Kontrollera först att ingen konfigurationsprocess kör och bevara materialet innan manuell hantering. Skriptet tar inte automatiskt över ett övergivet lås. En befintlig felaktig backupfil skrivs heller inte över eller raderas för att få nästa kontroll att bli grön.

## 3. SQLite, WAL och sidfiler

Node skapar snapshoten genom SQLite, inte genom en rå kopia av en öppen huvudfil. `VACUUM INTO` bevarar det logiska committade innehållet och låter originaldatabasen vara kvar. Testet håller en riktig källa öppen i WAL-läge, lämnar committade data i WAL och öppnar en separat oavslutad skrivtransaktion. Återställningen innehåller de committade posterna men inte den oavslutade fakturan. Källans huvudfil och WAL jämförs byte för byte före och efter provet.

Det återställda Node-målet måste saknas. Befintligt mål, `-wal`, `-shm` eller `-journal` stoppar återställningen. SQLite öppnar inte målet under själva Node-publiceringen; den verifierade databasen öppnas privat först, sedan kontrolleras exakt de publicerade bytesen. Detta hindrar en gammal främmande WAL från att ändra det autentiserade ekonomiska innehållet. Befintliga tester täcker dessutom filbyten, symlänkar och att felstädning bevarar främmande ersättningar.

Sites-verktyget bygger först databasen i minnet med repositoryts betrodda migrationsfiler. SQL från arkivet körs aldrig. Tabellnamn och kolumner kontrolleras mot schemat; värden binds som parametrar och typer/primärnycklar kontrolleras. Exakta radmängder, `integrity_check` och `foreign_key_check` verifieras före skapande av utdatakatalog och efter faktisk SQLite-skrivning. Utdatakatalogen är alltid ny; ingen sökväg till en befintlig produktionsdatabas accepteras som restoremål.

En privat målkatalog räcker inte om en annan användare kan byta dess förälder. Verktyget kontrollerar därför även POSIX-föräldrarna, tillåter betrodd sticky-katalog som `/tmp` och kontrollerar katalogidentiteter runt skrivningarna och efter asynkrona originalläsningar. En reproducerad utbytesattack stoppas före lyckad återställning. Det förutsätter fortfarande att den anropande användaren och andra processer med samma användaridentitet är betrodda.

Windows kan rapportera olika `dev` från sökvägsstatistik och öppna filhandtag. Där jämförs två handtags volym-/inodeidentitet samtidigt som sökvägens filtyp/inode kontrolleras. Positiva och negativa metadatafall samt skrivbar filöppning för flush provas genom modellering på Linux. **Ingen ny native Windows-körning påstås; Windows-katalogernas ACL måste vara korrekt etablerade av operatören.**

Källor: [SQLite VACUUM INTO](https://sqlite.org/lang_vacuum.html#vacuum_with_an_into_clause), [SQLite WAL](https://sqlite.org/wal.html), [SQLite PRAGMA-kontroller](https://sqlite.org/pragma.html#pragma_foreign_key_check). Dokumentationen beskriver SQLite-kontraktet; de lokala regressionerna verifierar hur detta projekt använder det.

## 4. R2-original, manifest och historiska referenser

Den befintliga Sites-motorn tar de ägda tabellerna i en D1-batch och fryser dokumentregistret innan R2-original kopieras. Saknade/ändrade original, fel SHA-256, ogiltiga checkpoints, felaktigt API-kvitto och deklarerade originalreferenser stoppar kopian. Även äldre bilagor i kända revisionshändelser och återtagna Bankgiro-länkar måste kunna härledas till rätt original. Godtyckliga strängar i användar-/providerdata tolkas inte som dokumentreferenser.

Den nya fristående kontrollen kräver ett komplett, olåst körningskvitto med fullständigt manifestpass. Den kontrollerar själv snapshoten och **varje krypterat original på nytt**. Den gamla flaggan `complete` ensam räcker inte. Manifestet binder exakt objektnamn, källprefix, ägare, backup-ID, ciphertext-/klartextstorlek, SHA-256 samt radantal för varje beständig tabell.

Återställning avvisar saknade, extra, duplicerade, felordnade eller utbytta manifestobjekt, fel tabellförteckning/radantal, fel checksummor, främmande källprefix, sökvägstraversering, fel ägare/backup-ID/nyckel, aktiv lease, ofullständig verifiering samt ett manipulerat men korrekt omkrypterat manifest. Filkatalogens faktiska innehåll måste också stämma med manifestet. Varje original autentiseras på nytt när dess bytes verkligen skrivs till återställningskatalogen.

Nuvarande kapacitetsgränser bevaras: högst **5 000 rader per beständig tabell**, **12 000 000 bytes snapshot**, **15 000 000 bytes per original** och högst **4 000 000 bytes återställningsmanifest**. Överskridna gränser stoppar; ingen partiell export presenteras som fullständig. Kompatibilitet med ett okänt framtida databasschema gissas inte.

[Cloudflare D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) och [R2:s konsistensmodell](https://developers.cloudflare.com/r2/reference/consistency/) är separata lagringskontrakt. En D1-transaktion och ett R2-manifestpass utgör inte en gemensam atomisk transaktion eller garanti mot att filer försvinner senare. Den faktiska portabla exporten och dess återställning måste därför verifieras självständigt.

## 5. Avbrott och säker återupptagning

| Felprov | Förväntat och verifierat beteende |
| --- | --- |
| Delvis skriven Node-ciphertext, ENOSPC | Ingen slutlig daglig arkivfil publiceras; ny körning kan skapa en verifierad kopia. |
| Node-flush eller autentiserad återläsning misslyckas | Ingen lyckad backup eller blockerande halvfil vid slutnamnet. |
| Riktig process dödas under Node-skrivningen | Privat staging kan bli kvar, men samma dags omkörning lyckas utan att radera den eller källan. |
| Två Node-körningar publicerar samma dag | Exklusiv publicering; förloraren verifierar vinnaren och återger `created: false`. Ogiltig vinnare bevaras och avvisas. |
| Sites-originalläsning avbryts efter några kopior | Checkpoint behålls; en utgången lease kan återtas; samma frysta snapshot används och samtliga original verifieras. |
| Exporten avbryts | Ingen avslutande `bundle.json` skrivs; ofullständig katalog kan inte återställas som en komplett backup. Gör en ny export till en ny katalog. |
| Källa ändras mellan inspektion och export/restore | Faktiska bytes autentiseras igen och stoppas vid avvikelse. |
| Sites-kvittots skrivning/flush/återläsning avbryts | Ingen lyckad `receipt.json` publiceras. En privat ofullständig katalog kan finnas kvar; en ny omkörning använder en annan katalog. |
| Ett annat kvitto finns vid Sites-publiceringen | Exklusiv publicering stoppar och bevarar den främmande filen. Ingen automatisk radering av en ersatt stagingfil sker. |
| `.env`-skrivning blir kort eller flush misslyckas | Befintlig konfiguration, inklusive andra integrationsnycklar, är oförändrad. |

Node-arkivet och Sites-slutkvittot publiceras genom hårdlänk på samma filsystem. Filsystem som inte stöder den operationen avvisas utan osäker skrivfallback. Filflush och processavbrott är testade. Föräldrakatalogerna flushas inte; total hårdvaru-/strömförlust, beständighet hos katalogmetadata på alla filsystem och oberoende katastroflagring är inte bevisade. Node-arkivets och `.env`-filens föräldrar måste vara betrodda lokala kataloger.

## 6. Vad helhetsproven återställer

### Node

Det nya helhetsprovet använder hela applikationens riktiga schema. Alla schemadefinitioner, tabeller och rader jämförs mellan den committade källan och en separat återställd SQLite-databas. Det innehåller två fakturor, två bankposter, faktiska allokerings-/ångra-/omallokeringshändelser och **62 500 öre** i återställd allokering. Historiskt och aktuellt fakturaoriginal, avvisat konfliktoriginal och syntetisk XLSX bevaras exakt. En faktiskt bekräftad, återtagen och åter bekräftad rapportkoppling finns kvar med hela historiken.

En separat ocommittad faktura kommer inte med. Källans databas/WAL, arkivet och en redan återställd målfil bevaras vid avvisad upprepad restore. Dessa belopp och poster är testdata; de verifierar inte något verkligt kundärende.

### Sites

Provet fyller samtliga 20 beständiga tabeller: 19 tabeller med en rad och dokumentregistret med sju original, alltså **26 bevarade beständiga rader**. En annan syntetisk ägare och ett aktivt lås finns i källan men får inte bli den valda ägarens återställda register/aktivt lås. Ett avbrott och en utgången lease simuleras innan backupen slutförs. Den faktiska CLI:n återställer en ny filbaserad SQLite-databas och sju originalfiler.

Alla valda rader och originalbytes jämförs exakt. Arbetsytans allokering på **62 500 öre**, en historisk kredit på **500 öre**, historisk fakturabilaga och återtagen originalkoppling bevaras. Integritets-/FK-kontroller passerar; ordinarie `workspaces` finns inte i den nya evidensdatabasen. Ett redan befintligt syntetiskt produktionsnamn i utdatakatalogens förälder lämnas orört.

## 7. Säkerhetsgranskning

Det bekräftade Node-felet var persistenta sessionsskrivningar före HTTPS-autentisering. Tio anonyma/ogiltiga cookie-anrop skapade tio sessioner. Fem felaktiga lösenord och ett throttlat försök skapade sex. Rättningen gör dessa anrop statslösa medan en lyckad inloggning skapar en ny hashad session med säkra cookie-attribut. Detta är ett verifierat skydd mot den specifika lagringstillväxten; ingen allmän DoS-frihet eller faktisk produktionsöverbelastning påstås.

Den avgränsade granskningen och säkerhetsregressionerna täcker Sites ägarbundna SQL-/R2-läsningar, MCP:s identitets-/origin-/inputgränser, OAuth-replay och webbläsarbindning, förlorad session efter asynkront arbete samt krypteringens ägar-/ändamålsbindning. Inget ytterligare konkret ägar- eller hemlighetsläckage etablerades. Plattformens autentiserade identitetshuvuden är fortfarande en driftsmässig tillitsgräns. Node är avsiktligt ett gemensamt företagsregister för en administratör.

En begränsad filnamns-/mönstersökning av 588 spårade textfiler fann inga spårade verkliga `.env`-/databas-/privatnyckelfiler eller matchande GitHub/OpenAI/Google-tokenformer. Markörer för privatnycklar fanns i validator-/testkod. En separat kontroll av samtliga 13 ändrade/nya textfiler gav inga token- eller privatnyckelmatchningar. Sökningen är inte en full historik-/binär-/penetrationsgranskning. Nytillkomna fixturer använder uttryckligen syntetiska nycklar; inga produktionsnycklar eller kundoriginal ingår i ändringarna.

### Beroenden

Färsk audit gav **0 fynd i root**, **0 i Sites produktionsberoenden**, och **16 moderate, 0 high/critical i hela Sites-trädet**. De 16 posterna omfattar en minimatch-advisory och berörda utvecklingskedjor. Den befintliga exakta 10.2.5-backporten är verifierad med en målinstallation och noll ytterligare skrivningar; versionsbaserad audit fortsätter redovisa fynden.

Npm:s föreslagna semver-major-ändring till `eslint@4.0.0` tillämpades inte. [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), [uppströms rättning](https://github.com/isaacs/minimatch/commit/77a0f5c4b80bdc641c3c930a1d9edf5ad2db57f8) och [ESLints supportmatris](https://eslint.org/version-support/) kontrollerades. ESLint 9 är utan ordinarie underhåll sedan 2026-08-06. Både auditposterna och supportbristen kvarstår; kontrollernas gränser har inte sänkts.

## 8. Aktuell produktionsobservation och återstående behörigheter

Läsande `backup_status` visade:

| Fält | Observerat värde |
| --- | --- |
| Backup aktiverad | Ja |
| Backupdag | 2026-11-02 |
| Sparad status | `complete` |
| Kopierade/verifierade filer | 195 / 195 |
| Kopierade/verifierade bytes | 63 463 280 |
| Sparad färdigtid | 2026-11-02 02:29:26 CET |
| Verifieringsomfattning | `manifest_pass` |
| Bevarade API-kvitton kontrollerade | 11 |
| Äldre API-poster utan kvitto | 112 |
| Rapporterat fel/försök | Inget / 0 |

Detta är ett **sparat driftskvitto**, inte en ny fullständig filkontroll eller återställning utförd i denna branch. De 112 äldre posterna utan API-kvitto har inte fått påhittade original eller ny proveniens. Senast lästa befintliga Sites-projekt var version 56. Vi har varken ändrat det projektet, dess åtkomst, DB/R2, runtimehemligheter eller scheman, eller publicerat denna branch.

För en faktisk produktionsövning återstår:

1. En ägarauktoriserad, fullständig läsande export av rätt `backup_runs`-rad och dess krypterade R2-objekt via en betrodd källadapter. Statusverktyget ger inte själva objekten.
2. Den ursprungliga backupnyckeln tillgänglig via godkänd privat nyckelhantering. Metadata om en maskerad hemlighet räcker inte. Historiska DPAPI-anteckningar har inte återverifierats här.
3. En separat privat återställningsmiljö och en arkivkopia som går att nå oberoende av den primära R2-resursen/kontot. Samma R2-resurs är inte oberoende katastroflagring.
4. Faktisk export-/nyckel-/restorekontroll med komplett original-/ekonomisk jämförelse och mätt dataålder/tid. **Produktions-RPO och RTO är inte verifierade.** Lokala testsuiters tider är inga servicegarantier.
5. Om en återställd tjänst senare ska aktiveras: separat beslut, behörighets-/sessionsinvalidering, rätt integrationsnycklar och en kontrollerad plan för att undvika replay av synkronisering eller utskick. Evidensverktyget gör ingen sådan aktivering.

## 9. Körbar isolerad återställning

### Node-arkiv

Använd en privat lokal arbetskatalog, rätt ursprunglig `MG_BACKUP_KEY` via säker processmiljö eller en privat miljöfil utanför Git, och ett helt nytt mål. Exempel på kommandostruktur, med egna verifierade sökvägar:

```text
node --env-file=C:\MG-DR\secrets\node-recovery.env scripts/backup.mjs verify C:\MG-DR\archive.mgbak
node --env-file=C:\MG-DR\secrets\node-recovery.env scripts/backup.mjs restore C:\MG-DR\archive.mgbak C:\MG-DR\isolated\restored.sqlite
```

Originalarkivet och nyckeln får inte ersättas om verifieringen misslyckas. Starta inte den ordinarie servern mot evidenskopian. Node-återställningen är bytebevarande och innehåller även gamla sessions-/OAuth-rader.

### Sites-export och evidensprov

`exportBackupBundle(bucket, trustedRunRow, key, owner, write)` är en läsande exportfunktion för en betrodd adapter. Den anropar bara källans `get`, inte R2 `put/delete` eller D1-skrivningar. `trustedRunRow` måste komma från en aktuell ägaravgränsad metadatahämtning; `write` ska skriva till en ny privat exportkatalog. Ingen offentlig export-/restoreendpoint eller produktionsbehörighet har lagts till. Ett avbrutet exportförsök hålls ofullständigt och exporteras om till en ny katalog.

En komplett portabel katalog innehåller `bundle.json`, krypterad `manifest.bin`, `objects/snapshot.bin` och `objects/<dokument-UUID>.bin`. Ägare och backup-ID ska kontrolleras mot en betrodd källa separat från katalogens egna uppgifter.

Med rätt ursprunglig Sites-backupnyckel i processvariabeln `MG_SITES_RECOVERY_KEY`, eller i en privat miljöfil utanför Git:

```text
node --env-file=C:\MG-DR\secrets\sites-recovery.env --experimental-strip-types sites/scripts/restore-backup-isolated.mjs C:\MG-DR\encrypted-bundle C:\MG-DR\isolated VERIFIED_OWNER VERIFIED_BACKUP_UUID
```

Den andra katalogen ska redan finnas och vara privat. Verktyget skapar en ny slumpmässigt namngiven `mg-sites-evidence-*`-underkatalog; det accepterar ingen befintlig databas som mål. Använd privata Windows-ACL:er eller POSIX-behörigheter i den riktiga miljön. POSIX-modekontroller ersätter inte faktisk Windows-verifiering.

Resultatet innehåller:

- `evidence.sqlite`: verifierade rader under `evidence_*`-tabeller.
- `originals/<UUID>.bin`: exakta dekrypterade originalbytes.
- `source/bundle.json`, `source/manifest.bin`, `source/snapshot.bin`: källans metadata och autentiserade krypterade snapshot/manifest.
- `receipt.pending`: privat, flushad och bytekontrollerad stagingfil. Den kan finnas kvar även efter ett lyckat prov och är aldrig ett färdigkvitto.
- `receipt.json`: enda färdigmarkören; publiceras exklusivt sist efter godkända kontroller och stängd databas. Innehåller tabellantal, originalantal/bytes och checksummor, utan nyckel.

Behåll även hela krypterade exportkatalogen. Utdatan innehåller känsliga återställda uppgifter och ska inte läggas i Git. Vid skrivfel kan en ofullständig privat katalog finnas kvar; den ska inte accepteras utan ett giltigt slutfört prov. Ingen automatisk radering av tidigare material sker.

Bevara även verktygets och migrationernas källcommit med återställningsinstruktionen. Ett äldre arkiv med annan kolumnstruktur kräver en matchande, granskad återställningsversion; verktyget gissar inte bort, fyller inte på och konverterar inte okända fält för att få ett gammalt arkiv att passa.

## 10. Slutgrindar och leverans

Oberoende delgranskning och samlad kodgranskning är avslutade utan kvarstående konkreta blockerare. Tre reproducerade granskningsfynd rättades med regressioner: utbytbar utdatakatalog genom en skrivbar förälder, Windows-skillnaden mellan sökvägs- och handtagsmetadata samt ett misslyckat kvittoflush som lämnade en falsk färdigmarkör. Den samlade granskaren omprövade själv Windows-fallen, kvittofelet och återförsöket samt ett konkurrerande byte av `.env`. Granskningens godkännande gäller kodens redovisade omfattning och ersätter inte PR-granskning eller produktionsövningen.

Slutlig lokal verifiering på Linux, **Node 24.22.1 / npm 11.9.0**, med fryst programkod efter granskningsrättningarna:

| Kontroll | Resultat |
| --- | --- |
| Root `npm ci --ignore-scripts` | Godkänd ren installation. |
| Sites `npm run install:ci` | Godkänd ren installation med repositoryts befintliga minimatchbackport. |
| Root `npm run check` | 108 JavaScript-filer godkända. |
| Syntaxkontroll av tre nya Sites `.mjs`-filer | Godkänd. |
| Root `npm test` | **1 083/1 083**, 0 fel, 0 överhoppade; 407,550 sekunder. |
| Sites `npm run check` | TypeScript och befintlig beroendegrind godkända. |
| Sites `npm test` | **1 973/1 973**, 0 fel, 0 överhoppade; 188,368 sekunder. |
| Sites `npm run build`, separat omkörning | Godkänt lokalt produktionsbygge. Ingen publicering. |
| Root audit | 0 fynd. |
| Sites audit, endast produktionsberoenden | 0 fynd. |
| Sites full audit och `--audit-level=high` | 16 moderate, 0 high/critical; befintlig high-grind godkänd. |
| Exakt installerad minimatchkontroll | 1 mål verifierat, 0 ytterligare patchskrivningar. |
| Begränsad hemlighetssökning av ändringarna | 13 ändrade/nya textfiler, inga token-/privatnyckelmatchningar. |
| `git diff --check` | Godkänd. |

Helsviterna omfattar sammanlagt **3 056 passerade tester**. Riktade delmängder är Node backup **102/102**, konfiguration **10/10**, Node säkerhet **86/86**, Sites återställning/backup **318/318** och Sites säkerhet **122/122**. Den nya Sites-filen innehåller **61 återställningstester**. Dessa delmängder överlappar helsviterna och ska inte summeras som ytterligare unika tester. Testsviternas tider är mätningar av lokala regressioner, inte återställningstid för produktion.

`origin/main` hämtades på nytt efter den slutliga Sites-testkörningen och var fortfarande `a9f88ae1c0f697376b3ecd140e1e80a64405125a`; ingen samtidig main-ändring behövde integreras. Det verifierade trädet levereras endast på [den egna branchen](https://github.com/sharbel0022/Mgeorge/tree/codex/backup-security-stabilization-20261102). Slutligt commit-SHA, PR-länk och GitHub Actions på Node 22 hör till PR:ns leveranskvitto och kontrolleras separat från dessa lokala resultat. Målbranch är `main`, men ingen automatisk merge eller Sites-publicering utförs. Delade dokument får bara denna avgränsade komplettering; samordnad integration behöver bevara övriga uppdrags ändringar.

Den första rootkörningen startades innan Sites XLSX-beroende fanns färdigt och räknas inte som giltig baslinje. Ett installationsförsök förlorade executortransport och slutfördes därefter genom en ren omkörning av samma CI-installationsskript. Sandlådans subprocess-/loopbackfel och en mellanliggande ofullständig minimatch-installation redovisas som miljöfel; testerna ändrades inte för att kringgå dem. Godkända körningar använder oförändrade kommandon med fungerande lokala processbehörigheter.

Ett sista byggförsök samtidigt med de andra grindarna avslutades med `Killed`/exit 137. Miljön redovisade OOM-händelser, men någon separat PID-bunden orsaksanalys gjordes inte. Försöket räknas inte som godkänt. Samma oförändrade byggkommando kördes därefter separat och avslutades med `Build complete`/exit 0; det är omkörningen i tabellen ovan.

Poäng för säkerhetskopiering, säkerhet, katastrofåterställning och produktionsverifiering höjs inte på grund av syntetiska prov. Se den avgränsade uppdateringen i [QUALITY-SCORECARD.md](../QUALITY-SCORECARD.md). Övriga parallella uppdrags poäng och kod lämnas till respektive leverans.
