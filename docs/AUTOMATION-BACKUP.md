# Aktiverad automatik och verifierade säkerhetskopior

Den 28 oktober 2026 aktiverades de två befintliga molnschemana och ett nytt dagligt backupschema för MG Fakturakoll. Sites version 28 innehåller en beständig, återupptagbar backupmotor. Den ordinarie dagliga säkerhetskopieringen körs i molnet och kräver ingen påslagen dator.

| Arbete | Aktivt schema i Europe/Stockholm | Sparat jobb |
| --- | --- | --- |
| Bankhämtning | 03:06, 09:06, 15:06, 21:06 | Uppdatera Swedbank i MG Fakturakoll |
| Gmail och dokument | Varje hel timme | Hämta och tolka Gmail i MG Fakturakoll |
| Krypterad molnbackup | Dagligen 02:15 | Säkerhetskopiera MG Fakturakoll |

De befintliga bank- och Gmail-jobbens identiteter, länkar och tider behölls vid återaktiveringen. Backupjobbet är kopplat till samma Site. Inga kundutskick eller bankbetalningar ingår i dessa jobb. Bankens spärr mot för täta hämtningar respekteras även vid manuell provkörning.

## Molnbackupens innehåll och skydd

`sites/lib/backup-engine.ts` tar en konsistent D1-läsning av 20 beständiga, ägaravgränsade tabeller. Kopian innehåller arbetsyta, fakturor, bankposter, allokeringar, revisionslogg, dokumentregister, dokumenttolkningar, kopplingar och sparad integrationsdata. Därefter kopieras originalfilerna i R2 från exakt det dokumentregister som ingick i ögonblicksbilden.

Databassnapshot och varje original krypteras med AES-256-GCM och nyckelderivering via HKDF. Krypteringen binder kopian till ägare, backup-ID och objekt. Varje krypterat objekt läses tillbaka, dekrypteras och kontrolleras mot SHA-256 innan det räknas som klart. En kopia blir komplett först när samtliga original verifierats. Högst fem original behandlas per anrop; markör och lås gör att ett avbrott kan återupptas utan dubbla ekonomiska poster.

`BACKUP_ENABLED=true` och den separata hemligheten `BACKUP_ENCRYPTION_KEY` är konfigurerade i Sites runtime. `DOCUMENT_SCHEDULER_CONFIGURED=true` speglar den aktiverade dokumentkörningen. Befintliga bank-, Gmail- och krypteringshemligheter ändrades inte. En Windows-DPAPI-skyddad återställningskopia av den nya backupnyckeln finns på den konfigurerande datorn i `%LOCALAPPDATA%\MGFakturakoll\sites-backup-recovery.dpapi`; ingen klartextnyckel finns i Git eller rapporten.

Tillfälliga OAuth-flöden, aktiva lås och engångsgodkännanden för mejl återställs inte som giltiga behörigheter. Plattformens runtimehemligheter behöver bevaras separat. Kopiorna lagras under en separat privat backupprefix i samma R2-lagring; de skyddar mot registerändringar och förlust av enskilda original, men ersätter inte extern katastroflagring vid förlust av hela lagringsresursen. Ingen automatisk gallring har införts.

## Verifiering

Första riktiga molnkopian avslutades **2026-10-28 21:40 svensk tid** med status **complete**, **37 av 37 original** och **7 242 793 bytes** kontrollästa. Kopian är en ögonblicksbild från före den efterföljande Gmail-provimporten. Säkerhetskopieringen ändrade inga fakturor eller betalningssaldon.

Gmail-provimporten hämtade sju nya underlag med befintligt medgivande. Bankens automatiska anrop bekräftade att hämtningen ännu inte var förfallen och angav nästa tillåtna tid; ingen väntetid kringgicks. OCR-datorn var online vid kontrollen. Bilder och skannade PDF-filer kräver fortsatt att den datorn är tillgänglig; vanliga PDF-underlag och molnbackupen körs på servern.

**238 Node-tester och 283 Sites-tester** passerar. De sex nya backupintegrationstesterna täcker ägarisolering, fel nyckel, manipulerad krypterad data, saknade/ändrade original, begränsade återförsök, lås, dygnsgräns, återupptagning och återställning av hela den syntetiska databassnapshoten till en separat SQLite-databas. TypeScript och produktionsbygget passerar. Migration `0009_clumsy_rattler.sql` lägger endast till backupmetadata.

Sites-version **28**, källcommit `6fd93c709e480b5cd7b9c4e0669da24bcbf924bd`, deployment `appgdep_6ae25d2248dc8191b5cb43e394254dc0`, status **succeeded**, runtime-revision **8**.

## Status och återställning

De autentiserade verktygen `backup_status` och `backup_step` visar respektive driver kopian. `/api/backups` GET visar samma ägaravgränsade status. POST kräver samma origin och accepterar inga klientstyrda ägaruppgifter. Vid äldre pluginverktyg driver `process_invoice_documents` även ett begränsat backupsteg och returnerar status i fältet `backup`.

Tre misslyckade försök stoppar samma dags kopia med ett tydligt fel. Åtgärda det saknade underlaget eller lagringsfelet innan en kontrollerad ny kopia skapas; markera aldrig en ofullständig kopia som verifierad. Äldre kopior och bankoriginal raderas inte av körningen. En faktisk återställning till produktion är en separat administrativ åtgärd och körs inte av schemat.

## Lokal Node-installation

Den lokala `.env` har konfigurerats med separat `MG_BACKUP_KEY` och `MG_BACKUP_DIRECTORY`. En verklig krypterad snapshot med 24 tabeller skapades och återställningskontrollerades. Backuper och `backup-status.json` ligger i `%LOCALAPPDATA%\MGFakturakoll\backups`. `node --env-file=.env scripts/run-backup.mjs` verifierar eller skapar dagens kopia. `scripts/configure-backup.mjs` bevarar befintliga integrations- och backupnycklar vid omkörning.

Node-serverns befintliga dagliga backup körs när den servern är igång. Den separata dagliga driften för den publicerade appen sker genom molnschemat ovan, utan beroende av en lokal Windows-aktivitet. Det befintliga Windows-jobbet för lokal OCR behölls.
