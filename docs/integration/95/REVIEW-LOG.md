# Oberoende granskning och integrationsrättningar

Bedömningen gäller de frysta SHA som anges i [integrationsmatrisen](INTEGRATION-MATRIX.md). Producentens egen beskrivning eller gröna äldre CI har inte ensam räckt. Runtime, testassertions, behörighetsgräns, felutfall, schema och proveniens har lästs separat. Två granskare användes för känsliga bank-/säkerhetsöverlapp. Tekniska granskningsrapporter och PR-kommentarer är **inte** formella GitHub `APPROVED`-reviewhändelser; vanlig maintainergranskning och merge återstår.

## Fynd som krävde ändring

| Fynd | Rättning och konkret bevis | Leverans |
| --- | --- | --- |
| Lyckad Open Payments-skrivning kan förlora osäkerhetsflaggan vid trasig kropp/JSON, semantisk validering eller lokal försegling | 21 ursprungliga RED-fall plus positiva kontrollfall; 28 slutliga regressioner. Transport, provider och beständig lifecycle behåller `mayHaveSucceeded`, känt handtag och spärr mot ny skapning. DELETE behandlas som en ändring. | PR 49, förenad med PR 45/50 |
| Ett känt medgivande kan tappas vid första lagringsfel; definitiv HTTP400 spärras felaktigt som okänt resultat | Känd resurs behålls i guardad fallback; explicit renewal/disconnect kräver verifierad cleanup. Definitivt utebliven skapning tillåter säkert återförsök utan att historiken skrivs om. Ingen reset av osäkert fjärrutfall. | Korrigering på Agent 4:s PR 50 |
| Bankgiroproveniens kunde förändras mellan async läsning och slutligt svar | Revision/innehåll valideras även efter sista proveniensläsningen. RED 8/9, därefter 119/119 berörda tester; 138/138 efter main-syntes. Formell OCR kan inte bevisas med bara dokumentnummer eller generisk text. | Korrigering på Agent 2:s PR 46 |
| Decimalformad exakt referens försvann vid beloppssökning | Exakt `2026.01` bevaras parallellt med möjlig beloppstolkning; uttrycklig valuta avgränsar belopp. Tre sökmotorer och tre testfiler. RED 43/47 → GREEN 47/47. | PR 53 ovanpå extern main48 |
| SQLite-start kunde misslyckas före aktivering av befintlig busy-timeout | Samma 5 000 ms väntetid ställs in före WAL. Verklig tillfällig SQLite-låsning samt barnprocessernas ready/done/exit kontrolleras utan försvagade finansiella assertions. | Korrigering på Agent 8:s PR 47 |
| Isolerad QA saknade exakt npm-identitet; felinjicerad64 KiB barnprocess skadade V8-kvittot | Endast verifierad npm-sökväg tillåts. Felinjicerad barnprocess kör utan V8-coverage, med alla fel-/reparationsassertions kvar och instrumenterad förälder. Inga providercredentials ärvs. | PR 47 |
| Rekursiva data-URL-fixturer gav orimlig minnesanvändning | Innehållsadresserade temporära modulfiler ersätter inbäddade rekursiva URL:er. Befintliga testkroppar/assertions jämfördes och bevarades. Processkrasch räknades som fel, aldrig som pass. | PR 45 och separat producerkomplettering PR 54 |
| Bounded OCR-transport kunde vänta obegränsat på `reader.cancel()` | Cleanup görs utan blockerande await; underliggande privat body-/timeoutfel och förbud mot automatisk POST-omförsändning bevaras. RED63/65 → GREEN65/65; slutlig producerkedja165/165. | Korrigering på Agent 3:s PR 52 |
| Ny säkerhetsingress avvisade giltig OCR med flerbytestecken | Verklig PR 52worker→route→wrapper→SQLite/original visade200 före PR 54,413 på gammal PR 54 och200 efter rättning. Ingressen följer befintlig 600 000-byte route; gränserna 350 000 JSON-tecken och 150 000 OCR-tecken kvarstår.60/60 relevanta filer och2/2 originalprobe. | Korrigering på Agent 7:s PR 54 |

## Leveranser utan ytterligare blockerande fynd

PR 45:s aktuella bankläsningar och legacyåtervalidering kontrolleras precis före dispatch respektive atomisk commit. Samma valda metadata, medgivande, session, roll och apprevision krävs; replay projicerar aktuell hälsa. Statusläsning är skrivfri och råa bankfel hålls privata. Två MiB-bunden Enable-transport stoppar överstora eller oändliga svar.

PR 51:s deterministiska matchningsbeslut bevarar svaga konkurrerande underlag för granskning medan distinkta fullständigt styrkta referenser kan behandlas korrekt. CSV och manuella fält får inte fabricera bankidentitet. Ändringen ger inget automatiskt nytt bevis för flera fakturor i samma betalning.

PR 54 tillför beständig kontogemensam loginbudget, begränsade requestströmmar, auditminimering, strikt backupidentitet och credentialfri testrunner. Äldre/blandade runtimes och restore av äldre snapshot kan minska loginbudgetens skydd; den begränsningen står uttryckligen i releasegrindarna. Ingen extern drift-/nyckelacceptans härleds från lokal kod.

## Konflikter och pågående begränsningar

`PROGRESS.md` och `QUALITY-SCORECARD.md` har additiva daterade producentsektioner; historiken har bevarats. Överlappande runtimefiler och semantiska gränser har granskats utöver Git:s konfliktmarkeringar. OCR-felet52×54 låg i olika filer och hade därför inte upptäckts av enbart textmerge.

Den [oberoende slutgranskningen av den frysta koden](reviews/CODE-REVIEW-1918.md) bekräftar alla åtta producentheads som ancestors, bevarade bank-/OCR-assertions och runtimeöverlappar. Den [sena QA-granskningen](reviews/QA-UPDATE-REVIEW.md) bekräftar att LCOV-radunionen inte försvagar test-/auditgrindarna.

Full slut-CI är nu bunden till den publicerade samlade kandidaten 0ce2604, dess exakta tree och rena källmanifest; se [kodkvittot](evidence/ci-code-0ce2604.json). Alla tidigare och fokuserade resultat i detta dokument är avgränsade bevis, inte en sådan slutgrind. Produktionsbank, faktisk Bankgirokälla, oberoende operativ restore, regulatoriska/avtalsmässiga behörigheter och rätt deploymentproveniens förblir externa blockerare.

## Minimering av produktionsuppgifter i dokument

Slutredaktionen fann att Agent2:s nya producentprosa återgav konto-/belopps-/datumuppgifter från ett verkligt rapportoriginal. Repositoryts instruktion att inte publicera kontouppgifter kräver maskering. Den aktuella dokumentversionen återger därför bara nödvändig bevisstatus, antal och referensegenskaper. Producentens två dokument och progress är korrigerade i PR46-head7d3bcb5, som ingår i rapportkandidaten; ingen testfixture, originalfil eller finansiell data ändras. Historiska poäng och testkvitton bevaras.

Tidigare Git-versioner har inte skrivits om och kan fortfarande innehålla den äldre texten. Detta redigeringssteg ska inte beskrivas som historikrensning. Dokumentgranskningen hör till leveranshygien och ger ingen ny kvalitetspoäng eller produktionssäkerhetsattest.
