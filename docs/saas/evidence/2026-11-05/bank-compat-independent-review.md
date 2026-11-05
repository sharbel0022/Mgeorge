# Oberoende granskning av legacybankkompatibilitet — 2026-11-05

**Bedömning: inga kvarvarande Critical/Important-fynd i den granskade sjufilsdiffen.** Kandidaten är klar för integrationsansvarigs fulla grindar. Detta är en kod- och syntetisk regressionsbedömning; den etablerar varken orsaken till det okända liveprovidersvaret eller återställd produktionsanslutning.

## Exakt omfattning

Bas: `672c152242add9427c8526af8dd92431c526c8c2`. Granskat fryst repositoryträd: **`ed92aa3c5ad5e8c50281aedf9670f68b9739ddd1`**. Efter de oberoende testerna jämfördes arbetsytan direkt mot trädet utan skillnad. Alla sju ändrade filer har granskats; filhashar finns i `bank-compat-independent-review.json`.

- `sites/lib/bank-consent-policy.js` och `.d.ts`: ny separat legacyadapter; den befintliga strikta policyn är oförändrad.
- `sites/lib/banking/service.ts`: legacyvalidering i kontoval och synk, samt kanoniska samtyckesdiagnoser.
- `sites/lib/banking/details-service.ts`: samma legacyvalidering för detaljhämtning, med hela det sparade kontovalet.
- `sites/tests/bank-consent-policy.test.mjs`, `banking-security.test.mjs` och `bank-details.test.mjs`: tillagda regressioner. Befintliga assertions är bevarade. Detaljfixturens tidigare godtyckliga konto-ID ersätts konsekvent med giltig UUID; metadatafixturen kan nu återge legacy/company eller ett parserfel.

## Verifierade säkerhets- och kompatibilitetsgränser

Legacyadaptern kontrollerar hela cache- och GET-inventeringen före projektion: begränsade, unika giltiga UUID:er, samma fullständiga konto-/kontodata-UID-set i GET, samt ett icke-tomt unikt kontoval som finns i båda källorna. Ett UID-löst GET-objekt, en dubblett eller en saknad vald post avvisas även när en annan vald post är giltig. Inga konto-ID:n härleds från hash eller andra fält.

Endast de valda kontona går därefter igenom den oförändrade strikta policyn. Vald business-usage, singular identitetshash, bank/land/PSU, transaktionsbehörighet, providerstatus och samtliga utgångsgränser behålls. Ovalt återkallat eller privat konto ger ingen ny åtkomst och blockerar inte ett i övrigt giltigt legacyval. Detta korrigerar den reproducerbara skillnaden mot Site60:s valda-konton-semantik; det är inte en diagnos av dagens bankfel.

Anropsplatserna väljer legacygrenen från framgångsrikt läst serverlagrad metadata, aldrig från requestdata eller ett fångat parserfel. Kontoval, synk och detaljhämtning är täckta. Detaljhämtningen kontrollerar **alla sparade valda UID:er**, inte enbart transaktionens konto. Fallet sparat val `[A,B]`, mål `A`, men endast `A` levande avvisas innan transaktionslista, detaljer, R2-original eller ekonomisk persistens.

Nya callbacks och company-mode behåller strikt fullständig kontomängd. Node-konsumenterna av den befintliga strikta policyn är oförändrade; Node legacy hade redan separat kontroll av valt konto. Befintliga kontroller av medlemskap, applikationsgeneration, anslutningsidentitet, lease, aktuellt medgivande, read guards, cooldown och commitgränser ändras inte.

Felrapportering godtar en fast kodlista och konstruerar meddelandet från den interna tabellen. Inkommande custom message, okänd kod och duck-typed fel används inte. Kodvärdet fångas en gång inuti try/catch, vilket stänger det under granskningen reproducerade fallet där en getter först gav en tillåten kod och sedan hemlig text. Diagnosen ändrar ingen behörighet eller cooldown. Testerna visar att avvisad anslutning förblir `reauth_required`, historisk `last_synced_at` består och ett nytt synkförsök inte gör fler provideranrop.

## Oberoende körningar

Direkt Node24.22.1 med befintlig `scripts/saas-test-isolation.mjs`, utan verklig bank, e-post eller credentials. Resultaten nedan överlappar integrationsansvarigs fulla sviter och ska inte adderas till dessa som nya unika acceptansfall.

| Körning | Godkända | Tid | Lokal logg |
| --- | ---: | ---: | --- |
| Hela policyn | 54/54 | 263.435003 ms | `bank-compat-independent-policy.txt` |
| Riktat serviceurval: diagnostics, selected scope, callback, company | 36/36 | 11861.299437 ms | `bank-compat-independent-service.txt` |
| Hela detaljtestfilen, inklusive ursprunglig finansiell integritet och nya kontogränser | 90/90 | 6686.964732 ms | `bank-compat-independent-details.tap` |

**Summa 180 riktade pass; fail, skipped, cancelled och TODO är 0.** Ingen hel repositorysvit eller tung build kördes av granskaren. De två första körningarna gällde de fem ursprungliga filerna i trädet `b3733e92b1fa9dc74bea2afdd451869dffaa874c`; dessa var byte-identiska i slutträdet ovan när detaljextensionen granskades och kördes.

## Kvarstående produktionsgräns

Den historiska cutoverjämförelsen kl.13:13 och det senare verkliga `BANK_ACCOUNT_SCOPE_INVALID`-felet hålls åtskilda. Det faktiska misslyckade providersvaret är inte tillgängligt, så ingen specifik kontomängd, usage, identitetskonflikt eller providerorsak kan fastställas. Den bevisade legacyregressionen och förbättrad diagnostik är separata, verifierade kodrättningar.

Ett framtida `valid_until` eller tom äldre consentmetadata räcker inte för att lokalt återställa `connected`. Ingen reauthstatus, historik, misslyckanderäknare eller bankdata återställs av patchen eller denna granskning. Granskaren gjorde inga provideranrop eller produktionsskrivningar. Integrationsansvarigs senare läsning av cachelagrad redirectmetadata är en separat kontrollpunkt inför eventuell förnyelse; den är inte färsk verifiering av providerregistreringen.
