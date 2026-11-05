# Kvalitet, CI och syntetisk prestanda

Detta är Agent 8:s reproducerbara kvalitetsflöde. Körningarna använder syntetiska data och sparar faktiska processresultat, testantal, coverage och källidentitet. Aktuella leveransresultat redovisas separat; den här instruktionen är inte ett testkvitto.

## Kör lokalt

Utgå från repositoryts rot. CI låser Node till `22.23.4` och `24.22.1`; Node 24.22.1 används för Sites, bryggan, browsern och prestandamätningen. Kör profilerna **sekventiellt i samma checkout**, eftersom flera profiler installerar samma beroenden. Varje GitHub-jobb har en separat checkout.

```bash
npm run quality:node -- .codex-work/quality/run-001/node
npm run quality:sites -- .codex-work/quality/run-001/sites
npm run quality:bridge -- .codex-work/quality/run-001/bridge
npm run quality:performance -- .codex-work/quality/run-001/performance
npm run quality:browser -- .codex-work/quality/run-001/browser
```

Använd en ny utdatakatalog per körning. Standardläget utför installation från lockfiler. `--skip-install` är ett uttryckligt felsökningsläge för redan installerade beroenden och ger `installExecuted: false` i kvittot. Browserprofilen installerar sitt separat låsta Playwright-paket och Chromium med systemberoenden. En miljö som blockerar webbläsarstart kan verifiera byggsteget men behöver en fungerande browsermiljö för acceptanstesterna.

Testprocesserna får en begränsad miljö med `NODE_ENV=test`, UTC och avstängd Cloudflare-telemetri. Befintlig nätverksvakt stoppar oavsiktlig extern `fetch`/TCP i de processer där den är laddad; den är ingen säkerhetssandbox för fientlig kod eller godtyckliga underprocesser. Browserharnessarna blockerar externa browserförfrågningar och ersätter API-svar med uttryckliga syntetiska fixturer.

## Inventering av baslinjen

Bas: `4ad205b84d1852ec7ed33cabd70fdadbe2f9d5c5`. Antalen i tabellen avser **testfiler**, före den här branchens tillägg.

| Yta | Befintlig körning | Omfattning och lucka |
| --- | --- | --- |
| Node, 102 filer | `npm run test:isolated` | Unit-, kontrakts-, SQLite-, HTTP/API-, återställnings-, original- och avstämningstester. |
| Sites, 156 filer | `npm --prefix sites run test:isolated` | Domänlogik, D1-adaptrar över SQLite, migrationer, R2-fixturer, providergränser och SaaS. Flera UI-tester läser källtext och ersätter inte browseracceptans. |
| Bankgirobrygga, 3 filer | `npm --prefix bridge/bankgiro run test:isolated` | Verkliga lokala SSH/SFTP/HTTP-komponenter med syntetiska original och återstartsscenarier. |
| Säkerhetsacceptans | `.github/workflows/saas-security-acceptance.yml` → `node scripts/run-saas-security-acceptance.mjs <utdata>` | Överlappande urval av 22 Node- och 37 Sites-filer. Ska inte adderas till fullsviternas testantal. |
| Onboarding-browser | `docs/integration/saas-onboarding-browser/` | Befintliga DOM-scenarier med syntetiskt API. Den tidigare normala harnessen saknade `CompanyWorkspace`. |
| Betalningsbrowser | `docs/integration/agent-6-browser/` | Separat historisk browserharness, tidigare utanför ordinarie CI. Denna leverans automatiserar onboarding och företagskontext; betalningsharnessens historiska resultat räknas inte som nya. |
| Schemalagd moln-OCR | `.github/workflows/sites-cloud-ocr.yml` | Operativ produktionskörning med egna credentials. Ingår inte i den syntetiska kvalitetssviten. |

Den [maskinläsbara inventeringen](test-inventory.json) listar varje testfil, nytillkomna filer och samtliga tre GitHub Actions-flöden.

Baslinjens huvud-CI saknade maskinläsbara kvitton, coverage och artefakter efter fel. Dess syntaxkontroll missade undermappar. Säkerhetsflödet sparade ett separat kvitto men gav inte ett samlat underlag för installation, build, audit och alla testsviter.

Efter normal integration av main `bf24a3c52ffc637d1e7bbc4d4f64a1732dcd9fee` innehåller branchen 112 Node-, 160 Sites- och 3 bridge-testfiler. Inventeringen skiljer Agent 8:s tillägg från filerna som tillkom i main genom PR #48.

## Nya beteenderegressioner

- `test/payment-concurrency.test.js`: verklig SQLite-låsning vid processstart, samtidiga importer och processavbrott. Ett upptäckt startup-race rättas genom att sätta befintlig `busy_timeout` före WAL; finansiella assertions behålls och barnprocesserna måste avslutas med kod 0.
- `test/quality-regressions-migration-replay.test.js`: historiskt SQLite-schema, upprepade migrationer/öppningar, finansiell identitet och originalhashar även efter korruption.
- `test/quality-regressions-recovery-api.test.js`: verklig lokal HTTP-server, faktura/PDF, CSV-preview/import, avstämning, processomstart, dubblettåterimport och avvisat korrupt original.
- `test/quality-regressions-contracts.test.js`: Bankgiro-rapportens externa ID är opakt och URL-kodas utan att ändra auktoriserad innehållsrutt; originalbytesen bevaras.
- `sites/tests/quality-regressions-ocr-recovery.test.mjs`: riktig worker och SQLite-kö efter förlorat svar på sparad OCR; ingen dubbel extraktion/historik eller automatisk fakturaregistrering. Extraktor och transport är explicita fixturer.
- `test/quality-benchmark.test.js`: den riktiga benchmark-CLI:n måste bevara företagsgränser, belopp, replay och konkurrerande leaser.
- `test/quality-runner.test.js` och `test/quality-syntax.test.js`: negativ kontroll av falska godkännanden, timeout, ändrade källor, auditfel, browserstartfel och trasig nästlad JavaScript.

## Nya CI-grindar

`payment-control-ci.yml` behåller installation, syntax/typer, dependency audit, fulla testsviter och produktionsbygge. Det kör dessutom två Node-versioner, en separat syntetisk prestandaprofil och Chromium-acceptans. Huvud- och säkerhetsjobben använder fast Ubuntu/Node-version, låsta npm-paket, SHA-pinnade GitHub Actions med Node 24-runtime (`checkout` 7.0.1, `setup-node` 7.1.0, `upload-artifact` 7.0.2), läsbehörighet och `if: always()` för evidensuppladdning.

Varje testprofil sparar TAP, JUnit och LCOV. Fulla och produktionsbegränsade audits sparas separat. High/critical-fynd gör grinden röd; moderate-fynd syns fortfarande i kvittot. Installation som misslyckas ger `NOT_RUN` för beroende kontroller. En annan kontrolls fel hindrar inte att oberoende kontroller lämnar användbar diagnostik.

Browserprofilen har två tydliga delar:

1. Befintlig onboarding-komponentacceptans med syntetiskt API och fem skärmbredder.
2. Ny integrerad `CompanyWorkspace` + `BankPage` med riktig browserkod: formulärbevarande vid kontextuppdatering på 320/390/1440 px, företagsbyte över sidomladdning och återkallat medlemskap som tömmer privat innehåll. Provider- och API-svaren är fortfarande syntetiska.

Browserstart, fel i källhashar och globala browserfel sparas som underkänd körning. Det strikta CI-flödet vidarebefordrar inget scenariofilter och kräver båda delarnas fullständiga resultat.

## Hur kvittot ska läsas

`receipt.json` är jobbkvitto; `tests/receipt.json` är kvitto för själva testprocessen. `source-manifest.json` innehåller SHA-256 för samtliga trackade och icke-ignorerade filer, även konfiguration, SQL, CSV/XML/PDF-fixturer och OCR-binärer. Skriv evidens utanför checkouten eller i `.codex-work/` så att körningen inte ändrar sina egna källindata.

| Fält | Betydelse |
| --- | --- |
| `source.commit` / `source.tree` | Faktiskt utcheckad Git-identitet. |
| `source.workingTreeDirty` | Om lokala ändringar fanns vid start. Ett sådant kvitto identifieras även med manifestets innehållshash. |
| `source.contentSha256` | Hash över filmanifestet med de faktiskt lästa källbytesen. |
| `sourceChangedDuringRun` | Ändrad commit eller ändrade indata under körningen gör resultatet underkänt. |
| `github.checkoutSha`, `pullRequestHeadSha`, `pullRequestBaseSha` | PR-körningar kan testa GitHubs merge-commit; den skiljs från branchens head och bas. |
| `exitCode`, `signal`, `errorCode` | Faktiskt subprocessutfall, inklusive avbrott och timeout. |
| `totals` | Faktiska tester/pass/fail/cancelled/skipped/TODO; saknade totalsiffror är inte noll. |
| `coverage` | Uppmätt LCOV, inklusive täljare/nämnare och laddade filers omfattning. |
| `artifacts[].sha256` | Integritetshash för logg/rapport som stöder resultatet. |
| `syntheticOnly` / `realBankVerification` | Syntetisk acceptans respektive `NOT_RUN` för verklig bankverifiering. |

För godkänt testkvitto krävs processframgång, kompletta totalsiffror, minst ett test, exakt lika många godkända som körda och noll fail/cancelled/skipped/TODO. Timeout/spawnfel underkänner även om en exitkod skulle vara noll. Den anropande npm-CLI:ns sökväg bevaras uttryckligen i den isolerade testmiljön; registry-/providercredentials vidarebefordras inte. En kraschad testfil får inte försvinna bakom de assertions som hann passera före kraschen.

### Coverage och prestandans gränser

Det befintliga testet för avsiktligt misslyckad minimatch-filskrivning sätter en 64 KiB OS-gräns. Endast dess felinjicerade barnprocess körs utan V8-instrumentering, så att den inte samtidigt förstör hela körningens coverage-JSON. Samtliga fel-/reparationsassertions och föräldraprocessens instrumentering behålls.

Node V8/LCOV mäter de produktionsfiler som laddades i den instrumenterade körningen. Oimporterade filer, källtextkontroller, vissa transformerade `data:`-moduler och browserkod ska inte räknas om till fullständig kodtäckning. Rapporten visar uttryckligen denna begränsning och exakta nämnare; den gör ingen uppskattning av okörd kod.

Belastningsprofilen använder 1, 10 och 100 syntetiska företag, tio transaktioner per företag, seed 95 och högst fyra parallella företagsjobb. Den kör verkliga SQLite-partitioner, banksynk och beständiga leaser med en injicerad syntetisk provider. Initial import följs av replay och två konkurrerande anrop per företag; en konkurrent ska vinna och den andra få `ACCOUNT_BUSY`. Korrekthetskontrollerna kräver exakt 1 110 importerade rader, 2 220 dubbletter och 111 förväntade upptaget-svar över de tre storlekarna. Samma externa ID:n återanvänds mellan företagen för att avslöja läckage. Den redovisar parametrar, samtidighet, resultatkontroller, latens och genomströmning. Gamla benchmarkfiler tas bort före start, och CI kräver processframgång samt ett fullständigt strukturerat kvitto för alla tre storlekar på rätt commit. Tider är informativa utan sköra tidsgränser; korrekthet och komplett mätning är grindar. Dessa mätningar är lokala syntetiska arbetslaster. Banklatens, produktions-D1/R2 och faktisk kommersiell kapacitet kräver separata mätningar.

## Underlag för implementationen

- [Node test runner: flera reporters och coverage](https://nodejs.org/download/release/latest-jod/docs/api/test.html)
- [GitHub Actions: jobbsammanfattningar](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#adding-a-job-summary)
- [GitHub Actions: artefakter](https://docs.github.com/en/actions/tutorials/store-and-share-data)
- [Playwright: CI-installation och rapportering](https://playwright.dev/docs/ci-intro)

Actions-versionernas officiella underlag: [checkout 7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1), [setup-node 7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0) och [upload-artifact 7.0.2](https://github.com/actions/upload-artifact/releases/tag/v7.0.2). Det separata credentialstyrda produktions-OCR-flödet behåller sin befintliga konfiguration.
