# Backup och återställning: kontrollerad evidens 2026-11-05

Bas: `4ad205b84d1852ec7ed33cabd70fdadbe2f9d5c5`. Arbete på `feature/rating8-recovery-20261105`.

**Dagens driftsatta krypterade backup är färdigverifierad. En separat syntetisk återställningsövning har också passerat med samma antal original och total bytevolym. En faktisk återställning av produktionsbackupen är fortfarande inte genomförd.**

Fullständig maskinläsbar evidens, mätgränser, tabellförteckning och källkodshashar finns i [recovery-evidence.json](recovery-evidence.json). Rapporten innehåller inga kunduppgifter, produktionsoriginal, ägaridentiteter, backupnycklar eller produktionskörnings-ID:n.

## 1. Verklig drift: komplett verifieringspass

Den redan existerande backupen för **2026-11-05** återupptogs genom det befintliga `mg_fakturakoll_backup_step`. Ingen ny schemaläggare skapades. Utgångsläget var 362 kopierade och 35 verifierade original; senast fullständigt verifierade backup var då från 2026-11-04.

Efter **66 sekventiella steg**, under gränsen 80, rapporterade körningen `complete`. Ett efterföljande fristående `mg_fakturakoll_backup_status` bekräftade att både `latest` och `last_verified` avsåg dagens slutförda backup. Inga ytterligare steg kördes efter detta.

| Fält | Observerat resultat |
| --- | --- |
| Kopierade original | 362 / 362 |
| Verifierade original | 362 / 362 |
| Kopierade och verifierade byte | 142 968 213 / 142 968 213 |
| Backupens skapandetid enligt status, UTC | 2026-11-05 01:17:18.090 |
| Slutförd verifiering, UTC | 2026-11-05 16:55:10.290 |
| Verifieringsomfattning | `manifest_pass` |
| Fel / försök | `error=null`, `attempts=0` |
| Bevarade API-kvitton | 16 poster med kontrollerade JSON-kontrollsummor |
| Historiska API-poster utan kvitto | 112; denna begränsning kvarstår |

Detta styrker den driftsatta motorns slutförda autentisering och kontrolläsning av den frysta backupens original. Det bevisar inte att samtliga historiska bankuppgifter har originalkvitton, att en extern reservkopia finns eller att hela produktionen går att aktivera efter en katastrof. Inga fakturor eller betalningar ändrades av backupstegen.

**Sluttiden är verifieringens tid, inte datans återställningspunkt.** `created_at` ovan kommer från driftstatusen. Den krypterade produktionssnapshotens egna `createdAt` har inte lästs ut eller oberoende verifierats. Senare importer omfattas inte av en redan fryst snapshot. Varken en färdig verifiering 16:55 eller dagens datum är därför ett belägg för att alla senare dokument ingår, och dessa tider används inte för att påstå ett uppmätt produktions-RPO.

## 2. Reproducerbar isolerad övning med faktisk återställningskod

Ny körbar övning: `sites/scripts/recovery-drill.mjs`. Den skapar endast syntetiska SQLite-rader och originalbytes, genererar en tillfällig slumpnyckel och använder lokala minnes-/filsystemadaptrar. Den tar inte emot källsystem, produktionskataloger, molnbindningar eller nycklar som argument och läser inga miljönycklar. Alla temporära data tas bort efter körningen.

Övningen använder de befintliga modulerna:

1. `sites/lib/backup-engine.ts`: riktig kryptering, snapshot, ägar-/bolagskontroll, kopiering och separat manifestverifiering.
2. `sites/scripts/lib/backup-recovery.mjs`: autentiserad export av den färdiga backupen och verifiering av det krypterade portabla paketet.
3. `sites/scripts/restore-backup-isolated.mjs`: riktig återställning till ny privat katalog med SQLite, original och slutkvitto.
4. Ny `sites/scripts/lib/recovery-acceptance.mjs`: en oberoende kontroll av återställda rader och SHA-256 mot en förteckning som fångats **före backupen**.

Syntetiska data omfattar två ägare, samtliga **27** beständiga backuptabeller med minst en rad per tabell, fakturor, betalningar, matchning, historiskt återkallad kredit och Bankgiro-koppling, bank-/Gmail-konfiguration som syntetiska strängar samt bolagssynkens kontrollpunkter och kvitton. Den andra ägarens rader och original ingår inte i återställningen. Övningen gör inga externa bank- eller Gmail-anrop.

En läsning av ett syntetiskt original avbryts avsiktligt under kopieringen. Återupptagandet behåller samma frysta snapshot och slutför båda passen. De **147 lokala steg** som behövs för den stora syntetiska körningen är separata från de **66 produktionsstegen** ovan.

## 3. Uppmätta gränser och resultat

Slutlig stor körning: **2026-11-05 17:01:41.959–17:01:52.000 UTC**, Node **24.22.1**, Linux x64. Originalantalet och bytevolymen matchar dagens statusräknare; innehåll, filstorleksfördelning och databasrader är syntetiska.

| Mätning | Resultat | Vad den omfattar |
| --- | --- | --- |
| Original | 362, totalt 142 968 213 byte | Samtliga återställda original kontrollräknas och SHA-256-kontrolleras |
| Backup och återupptagande | 3 016,032 ms | Syntetisk snapshot, avbrott, återupptagen kopiering och verifiering |
| Krypterad export | 1 930,317 ms | Lokal export via den verkliga exportmodulen |
| Återställning och acceptans | **2 886,456 ms** | Autentisering av paket, ny SQLite-databas, originalskrivning/återläsning och oberoende integritetsacceptans |
| Hela övningen | 10 040,824 ms | Fixtur, backup, export, återställning och negativa kontroller |
| Simulerad RPO | **900 000 ms = 15 minuter** | Incident 12:15 minus verifierad snapshot-tid 12:00 |

Den lokala acceptansgränsen är högst **60 sekunder** för återställning inklusive acceptans och högst **15 minuter** i det syntetiska RPO-scenariot. Dessa är övningsgränser, inte fastställda produktions-SLA:er.

RTO-klockan startar när det krypterade paketet redan finns lokalt. Den omfattar inte operatörens inställelse, molnnedladdning, regionalt avbrott, åtkomst till reservnyckel eller aktivering av applikationen. RPO beräknas från den autentiserade snapshotens syntetiska tidsstämpel till en uttryckligt simulerad incident. En faktura som tillkommer 12:05 efter snapshoten finns kvar i källan men saknas avsiktligt i återställningen. Detta visar den faktiska återställningsgränsen i scenariot; det är inte ett uppmätt produktions-RPO.

### Godkänd integritet

Alla återställda rader jämförs med den oberoende förteckningen, SQLite `integrity_check` och `foreign_key_check` passerar, och hela förteckningen över originalfiler och deras SHA-256 stämmer. Källans beständiga tabeller för **båda** ägarna och alla lagringsobjekt förblir oförändrade av export/återställning.

Ledgerkontrollen ger två fakturor på sammanlagt **75 000 öre**, två transaktioner på **75 000 öre**, en matchning på **62 500 öre**, en återkallad kredit och en återkallad Bankgiro-koppling. Ändringar i dessa historiska rader upptäcks även om återställningskvittots databaschecksumma räknas om.

Alla tabeller i resultatet har prefixet `evidence_`. Användarmedlemskap, arbetarbehörigheter, aktiva företag, autentiseringsflöden och tillfälliga lås återaktiveras inte. Migrationsschemats fyra statiska rollnamn bevaras; de tilldelar ingen behörighet. Gamla bolagsworkerleases nollställs, stängselversionen höjs och beständiga kontrollpunkter, kvitton och begränsningar behålls.

### Åtta negativa kontroller

| Fel | Observerad gräns |
| --- | --- |
| Fel krypteringsnyckel | Återställning nekas före skapad output |
| Fel ägare | Återställning nekas före skapad output |
| Fel bolagsgräns | Återställning nekas före skapad output |
| Bitfel i krypterat original | Återställning nekas före skapad output |
| Saknat original | Återställning nekas före skapad output |
| Ändrad matchning och omräknad databaschecksumma | Oberoende acceptans nekar |
| Bitfel i återställt original | Oberoende acceptans nekar |
| Annan ägare införd i återställd rad | Oberoende acceptans nekar |

## 4. Reproduktion och regressioner

Kör från repositoryroten med Node 24. Ingen installation eller ändring av beroenden behövs:

```sh
node --experimental-strip-types sites/scripts/recovery-drill.mjs
node --experimental-strip-types sites/scripts/recovery-drill.mjs 362 142968213
node --experimental-strip-types --test sites/tests/recovery-drill.test.mjs
```

Standardkörningen använder sju original och 28 672 byte. Kommandot skriver en sanerad JSON-rapport till standard output och misslyckas om någon kontroll eller tidsgräns inte uppfylls. Inga temporära återställningskataloger publiceras som en driftsklar applikation.

Verifiering i arbetsmiljön använde den direkta Node 24-binären `/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node`:

- **348 / 348** fokuserade Sites-tester passerade, inklusive två nya drilltester, befintlig isolerad restore, bolagsgränser, originalreferenser, API-original och bolagssynkens återställning.
- **116 / 116** fokuserade Node-tester passerade, inklusive full återställning av WAL, original, finansiell historik, nyckelkonfiguration, publiceringsfel, avbrott och schemalagda jobb.
- Red/green: de två nya testerna misslyckades först eftersom drillmodulen saknades och passerade efter implementationen. Den stora separata körningen passerade därefter med ovanstående mätvärden.

Ingen produktionskod, migrationsfil, paketversion, låsfil, delad scorecard eller PROGRESS-fil ändras av denna leverans. Befintliga backup-/restoremoduler används direkt; tillägget är en körbar och mätbar acceptansövning.

## 5. Kvarvarande externa begränsningar

Det finns fortfarande ingen evidens här för återställning av ett **verkligt driftsatt krypterat paket** med en separat återställningsnyckel i en fristående miljö. Oberoende extern kopia, reservnyckelns åtkomst vid förlust av primärmiljön, tjänstens aktivering samt produktions-RTO/RPO behöver verifieras i en sådan övning.

De 112 historiska API-posterna utan kvitto blir inte fullständiga bankoriginal genom denna backup eller genom det syntetiska provet. Återställning bevarar historiken men kan inte återskapa saknat källbevis eller avgöra att varje gammalt ekonomiskt beslut var rätt.

Denna leverans motiverar förbättrad bedömning av kodens verifierade återställningsförmåga och dagens backupstatus. Den motiverar inte ett påstående att full katastrofåterställning av den driftsatta tjänsten är bevisad eller att samtliga operativa kriterier automatiskt nått 8/10.

## 6. Ny integrerad lokal körning

Root upprepade den stora syntetiska övningen **18:37:44.007–18:37:55.613 UTC** efter integrationen av dokument- och flerfakturaadaptrarna. Samtliga tio tidigare listade återställningskällors SHA-256 är oförändrade. [Det nya körkvittot](recovery-integration-rerun.json) innehåller dessa hashvärden, integrationshuvudet och hela utdata.

Även denna körning accepterade **362 original, 142 968 213 byte, alla 27 tabeller och samtliga åtta negativa kontroller**. Återställning inklusive oberoende acceptans tog **3 416,863 ms**; hela övningen **11 605,651 ms**. Den syntetiska återställningspunkten och incidenten ger fortfarande **15 minuters simulerad RPO**. Den tidigare mätningen ersätts inte, och skillnaden mellan lokala tider är ingen produktionsprestandamätning. Alla ovan angivna begränsningar kring produktion, extern kopia, nyckelåtkomst och aktivering består.
