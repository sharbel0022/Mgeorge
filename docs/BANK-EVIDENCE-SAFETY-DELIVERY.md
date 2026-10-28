# Bankbevis, avstämning och återhämtning — granskningsleverans

28 oktober 2026. Bas: `origin/main` på `a024216`. Branch: `codex/bank-evidence-production-safety`. Detta är en lokal kodleverans för PR-granskning; den är inte publicerad och verifierar inte produktionens nya beteende.

[Granskningsutkast PR #12](https://github.com/sharbel0022/Mgeorge/pull/12). GitHub Actions bekräftade lyckade Node- och Sites-jobb för källrevision `f43e2bc` i både push- och PR-körningen; följande dokumentationsuppdatering ändrar ingen programkod.

## Vad som ändrats

Betalningsbeslut bygger på bankunderlag, kundrelation och exakt referens. Beloppslikhet eller fakturaförslag kan inte skapa en betalare eller bank-OCR. Hela bankfilen behålls; original, SHA-256, OCR/fakturareferenser, bankidentifierare och betalarnamn hålls separat.

Viktiga fel reproducerades med syntetiska data innan de rättades:

| Fel | Följd före ändring | Skydd efter ändring |
| --- | --- | --- |
| Node ignorerade filens konto | Fel IBAN kunde ges valt kontos etikett | Uttryckligt fel IBAN och blandade konton avvisas; kontoalias får inte automatiskt styrka samma konto |
| Godtyckligt kontoalias vid automatisk filmatchning | Ett okontrollerat konto kunde betraktas som företagets | Bevarat rapportkonto och återtolkade bankfakta måste motsvara ett aktivt, ägt och valt SEK-IBAN |
| Återföring och dubbla XML-fält | `RvslInd=1` eller första av flera bankfakta kunde godtas | Återföringar, ogiltiga flaggor och tvetydiga singletonfält avvisas |
| Felaktiga datum och CSV-citat/kolumner | Skadade uppgifter kunde normaliseras till giltiga | Hela datumet och CSV-strukturen kontrolleras |
| Negativ API-magnitud med inkommande riktning | Negativt underlag kunde bli positiv betalning | Magnitud och riktning valideras var för sig |
| Trunkerat långt banknamn | Ett annat kundnamn kunde skapas av prefixet | Ursprungligt namn bevaras i rådata; otillåten identitet förblir okänd |
| Node analyserade före skrivlåset | Nytt motstridigt bevis kunde komma före allokering | Analys, saldo, allokering, fynd och revision omfattas av samma transaktion |
| API-hash saknades | Rådata utan integritetsbevis kunde godtas | Retained original och dess hash måste finnas och återtolkade fakta måste stämma |
| Klientstyrd generisk Sites-import | Bifogad fil kunde ge påhittade rader bankproveniens | Servern verifierar ägt original/hash och härleder bankfakta ur filen |
| Processlokala Node-jobblås | Samtidig process/omstart kunde kringgå lås och väntetid | Beständig SQLite-lease, skydd under skrivtransaktion och sparad försökspolicy |
| Fördröjd Sites-backup | Komplett snapshot kunde skrivas över | Ny läsning under villkorat lås och separat snapshotväg per lease |

## Betalningsflöden som kan verifieras lokalt

- CSV och camt.053/.054 kan förhandsgranskas, originalbevaras och importeras. Fel valuta, återföring, felaktig struktur och oförenliga konton stoppas.
- Individuella specifikationer kopplas endast vid entydigt konto, datum, bankreferens, valuta och komplett totalsumma. Samlingspost och delbetalningar räknas ekonomiskt en gång.
- Exakt fakturareferens, kontrollerad kundrelation och tillgängligt saldo kan ge automatisk koppling. Saknad/fel OCR, flera möjliga fakturor, konkurrerande referenser, okänd/annan betalare och möjliga dubbletter kräver granskning.
- Delbetalning och överskott bevarar exakta heltalsören. Flera fakturor kan fördelas genom explicit granskning; ingen beloppskombination skapar automatisk betalningsidentitet.
- Dubblettimport, två processer, förlorad lease och omstart testas med separata syntetiska SQLite-anslutningar/processer.
- Gmail, PDF-text och moln-OCR använder befintliga köer/checkpoints. Skannad syntetisk faktura går genom verklig Tesseract i det befintliga integrationstestet. Automatik skickar inga kundmejl.
- AES-GCM-backup kan återläsas, hashkontrolleras och återställas i separat syntetisk databas, inklusive originalfiler. Fel nyckel/ägare, saknat original och avbrutet jobb ger inget falskt verifierat resultat.

Node automatisk **filavstämning** kräver fullständigt rapporterat konto som exakt motsvarar ett aktivt, ägt och valt SEK-IBAN i bankanslutningen. Saknat konto, alias, maskering, saknad godkänd koppling eller utgånget medgivande ger endast granskning. Befintliga kontoetiketter och ID:n skrivs inte om; rapportkontot sparas som separat proveniens. Historiska kontofakta fylls inte i genom gissning.

Sites generiska filimport kräver serverns versionsmärkta originalbevis och därefter färsk manuell kontroll av original/konto innan matchning. Äldre `bank_file`-rader visar okänd bankbetalare/OCR tills originalet lästs om. Återimport av samma dokument/hash reparerar endast exakt överensstämmande och entydiga rader; konflikter bevaras och stoppas utan extra disponibla pengar. Den särskilda Bankgiroimportens fullständiga gruppkontroll finns kvar.

## Jobb och återställning

Node `integration_jobs` lagrar endast koordination: namn, lease, utgångstid, försök, nästa tillåtna tid och säker feltext. Inga tokens eller bankpayloads skrivs där. Bankens och Gmails befintliga intervall och behörigheter behålls.

Schemalagda misslyckade eller avbrutna försök begränsas till tre. Väntetid och larm finns kvar efter omstart. Status exponeras i `/api/settings` och Gmail-status. Åtgärda anslutningen, vänta till leverantörens tillåtna tid och gör en lyckad manuell hämtning för att återställa spärren. Femminuterslåset stoppar sena svar; när låset löpt ut kan jobbet återupptas från beständig checkpoint. Ett gammalt svar får inte skriva efter att en annan körning tagit över.

Gmail `Retry-After` bevaras som sekunder eller HTTP-datum i båda implementationerna. Ingen automatisk eller manuell hämtning tillåts före leverantörens väntetid. Ogiltiga värden får säker reservväntetid; orimligt långa värden stoppar automatiken för manuell åtgärd. Sites-migration **0011_sturdy_zeigeist.sql** tillför enbart `gmail_connections.retry_after` och har inte tillämpats i produktion.

Sites Gmail ändrar token, status, checkpoint, dokumentregister och källor i atomiska D1-batcher med aktuell låstoken och databasens klocka. Fördröjd hämtning, OAuth-retur och frånkoppling kan inte skriva över en nyare anslutning. Om en D1-skrivning kan ha lyckats trots förlorat svar bevaras det eventuellt registrerade R2-originalet; nästa försök återupptar via hash.

Sites-backup behåller tidigare objektvägar och återupptar från den snapshotväg som sparats i `backup_runs.snapshot_key`. Nya snapshots får en separat leasekatalog. Dokumentkopior ligger bredvid den sparade snapshoten; härled katalogen från metadata, inte från antagandet att en viss generation alltid används. Avbrutna skapanden kan lämna oanvänd krypterad data; ingen gallring eller radering införs här.

Följ befintlig [backup- och återställningsguide](AUTOMATION-BACKUP.md). Bevara runtimehemligheter separat och använd en separat återställningsdatabas/resurs vid prov. Produktionsåterställning och extern katastroflagring behöver administrativt godkännande och är inte körda av denna leverans.

## UI och webbläsartest

Sex huvudfält: Betalare, Faktura, OCR, Belopp, Datum och Status. Saknad identitet visas som `Betalare okänd`; saknad OCR visas uttryckligen. Möjliga fakturor hålls åtskilda från bankfakta. Tekniska bankfält finns under `Varifrån kommer uppgifterna?`.

Node har samma sex huvudfält, neutrala färger och mobilkort. Fakturasaldo avgör status Delbetalning/Överbetalning, även när bankbeloppet är fullständigt fördelat. Manuellt angivet namn är separat från bankidentitet. Den lokala Node-förhandsvisningen kördes med uttryckligt syntetiskt testläge och en separat temporär databas, utan `.env` eller schemaläggning.

Den lokala Sites-vyn testas i minnesbaserat demoläge med `sites/tests/fixtures/synthetic-ui-camt054.xml`. Filens konto, datum, referens och totalsumma motsvarar en demosamlingspost. Efter import visas syntetiskt namn och OCR `000018`, medan faktura fortfarande saknas och status kräver granskning. Inga verkliga bank- eller fakturauppgifter används i bilderna.

[Desktop med import](screenshots/safety/bank-imported-desktop.jpg) · [Mobil med importerad specifikation](screenshots/safety/bank-mobile-after-import.jpg) · [Importerad betalningsdetalj](screenshots/safety/payment-imported-mobile.jpg) · [Utfällbar källspårning](screenshots/safety/payment-evidence-desktop.jpg) · [Node desktop](screenshots/safety/node-bank-desktop.jpg) · [Node mobil](screenshots/safety/node-bank-mobile.jpg).

Sites testades vid **320, 390, 768, 1024 och 1440 px**. Ingen horisontell dokumentoverflow observerades. Mobilens detaljdialog ryms utan intern horisontell scroll. Dubblettförhandsgranskning visar `Redan importerad` och håller bekräftelseknappen spärrad. [Mätresultat och syntetiskt scenario](screenshots/safety/ui-verification.json).

## Slutlig testkörning

| Kontroll | Resultat |
| --- | --- |
| Node testsvit | **291/291**, 0 fel, 0 hoppade över |
| Node syntax | **59 JavaScript-filer**, godkänd |
| Sites testsvit | **357/357**, 0 fel, 0 hoppade över |
| Sites TypeScript | `tsc --noEmit`, exit 0 |
| Beroendesäkerhet | Båda `npm audit`: **0 kända sårbarheter**, även utvecklingsberoenden |
| Oberoende kodgranskning | Import/proveniens, bankmagnitud/hash, transaktionsracer, fördröjda jobb och backup granskade; funna blockerande fel åtgärdade |
| Produktionsbygge | `npm run build`: **Build complete**, exit 0; färdigt Worker-bygge därefter provkört lokalt med D1/R2 i lokal miljö |
| Sista bilder | Desktop/mobil och syntetisk camt-import kontrollerade även i färdigt bygge; en CSS-klasskrock rättad och verifierad som transparent mobilkort med flexlayout |
| GitHub Actions | Både Node och Sites **success** på `f43e2bc`: [PR-körning 40779971685](https://github.com/sharbel0022/Mgeorge/actions/runs/40779971685), [push-körning 40779965287](https://github.com/sharbel0022/Mgeorge/actions/runs/40779965287) |

Alla automatiserade tester använder syntetiska/tillfälliga databaser och kontrollerade leverantörssvar. Det verkliga OCR-integrationstestet använder en syntetisk skannad bild. Testsiffrorna verifierar ingen verklig bankrapportkanal.

CI gav befintliga plattformsnotiser om actions som ursprungligen riktade sig mot Node 20 och om `ubuntu-latest`-övergången. Samtliga jobb lyckades; inga kod- eller testfel rapporterades. Workflow-versionerna ändras inte av denna leverans.

## PR #9 och #11

[#11](https://github.com/sharbel0022/Mgeorge/pull/11) är mergad och dess head `1def87e` är en förfader till aktuell main. Den befintliga moln-OCR-kön, referenskällorna och bankvyn har bevarats och förstärkts.

[#9](https://github.com/sharbel0022/Mgeorge/pull/9) är fortfarande öppet utkast. Dess head är inte mergad, men textavsikten tillgodoses redan av V3:s presentationsfunktioner: okänd betalare, separat fakturaförslag och saknad specifikation. PR:n har inte mergats, stängts eller ändrats.

## Exakt extern blockeringsrapport

Automatisk hämtning av individuella bankrapporter är **inte verifierad eller aktiverad**. Befintlig AIS-anslutning visar inte att företaget har avtalad åtkomst till dessa rapporter. Följande behövs innan den delen kan färdigverifieras:

1. Bekräftat företagsavtal för **Swedbank Inbetalningar bankgiro** för rätt Bankgiro och mottagarkonto, med individuell elektronisk redovisning. Tjänsten redovisar tillgängliga betalaruppgifter i ISO 20022/XML och visar individuella betalningar i internetbanken. [Swedbanks tjänstebeskrivning](https://www.swedbank.se/foretag/betala-och-ta-betalt/ta-betalt/bankgiro-inbetalningar.html).
2. Bankbekräftad rapportversion: **camt.054.001.02 Credit Notification** och vid kontoutdrag **camt.053.001.02**, rätt MIG-version samt eventuell Swedbank Envelope. Banken listar flera MIG-varianter; företagets faktiska variant måste fastställas. Parsern gör struktur- och verksamhetskontroller och är inte en fullständig XSD/MIG-validator. [Aktuellt MIG-/schemaindex](https://www.swedbank.se/foretag/betala-och-ta-betalt/betala/fakturahantering/betala-via-fil/mig.html).
3. Bekräftad automatisk, **läsande** leveranskanal med rätt till individuella rapporter: avtalad SFTP- eller bank/ERP-API-kanal, serveradress, kund-/avtalsidentitet, rapportbehörighet, godkända konto-/Bankgirokopplingar och nödvändiga certifikat/nycklar enligt bankens instruktion. Detta är inte samma behörighet som betalningsinitiering. [Bankens kanalbeskrivning](https://www.swedbank.se/foretag/betala-och-ta-betalt/bankintegration-med-affarssystem.html).
4. En uttryckligen godkänd anonymiserad originalfil från just den kanalen, och en känd samlingsinsättning för kontroll av referenser, datum, konton, totalsumma och individuella rader. Företagets avtalade OCR-kontrollnivå och längdregel måste också bekräftas. Inga regler gissas.
5. Om befintlig Enable Banking-kanal ska användas: faktisk kontroll att Swedbank levererar individuella detaljer för företagets konto. API:t dokumenterar ett detaljanrop, men dess schema lovar inte bankens täckning. Tillfälligt `transaction_id` får inte identifiera en ekonomisk post; stabil bankreferens per konto används för idempotens. [Enable Bankings primärdokumentation](https://enablebanking.com/docs/api/reference/).

Bankens åtkomstskydd kringgås inte. Fram till verifierad kanal är behörig export och säker filimport alternativet. Historiskt Bg Max är inte implementerat. Inga nya avtal tecknas, inga verkliga bankanrop för import görs och inga produktionsjobb ändras av PR:n.

## Produktionsgräns och bevarande

MG-pluginens rena statusanrop visade ansluten bank med oförändrat sex-timmarsintervall, komplett befintlig molnbackup och ansluten Gmail/konfigurerad moln-OCR. Statusen bekräftar befintlig drift, inte koden i denna branch. Inga företagsdokument eller personuppgifter kopieras till Git eller testfixtures.

En oavsiktlig kort lokal Node-start redovisas i [PROGRESS.md](../PROGRESS.md): databasen öppnades och additiva hashkolumner fanns efteråt. Senaste revisionshändelse och backupens ändringstid var före starten; processen stoppades före bank-/Gmail-intervallet. Produktions-Sites ändrades inte. Den lokala databasfilen påstås inte vara byteoförändrad.

## Acceptanskriterier

| Kriterium | Evidens/status |
| --- | --- |
| A/B | Lokala negativa tester för banknamn, klientproveniens, förslag, manuella uppgifter och OCR-källor |
| C | Individuell syntetisk fil → rätt samlingspost verifieras; verklig företagsfil/kanal är externt blockerad enligt ovan |
| D | Entydig referens, kundrelation, konto, valuta, datum, saldo och originalintegritet kontrolleras före automatmatchning |
| E | Två processer, dubblettimport, försenade svar, leasebyte och återstart testas |
| F | 291 Node + 357 Sites, syntax, TypeScript, produktionsbygge, bildkontroll och beroendesäkerhet godkända; inga kända blockerande regressioner i granskad lokal omfattning |
| G | Sex fält, mobilkort och utfällbar källspårning; lokala skärmbilder |
| H | Beständiga lås/försök/väntetider, synliga stoppfel och återupptagbara checkpoints |
| I | Additiva migreringar, bevarandetester och ingen produktionsskrivning; lokal startavvikelse dokumenterad |
| J | Denna rapport, PLAN.md och PROGRESS.md samt granskbar PR |
