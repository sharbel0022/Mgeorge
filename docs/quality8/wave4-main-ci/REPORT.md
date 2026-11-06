# Exakt main-CI efter PR 58

## Verifierat resultat

**Payment control checks är completed/success på exakt main-commit 0035ea89ef3cd60f0924f901503cad00d1ab1fca.** Alla tre fullständiga jobbloggar är sparade, bytekontrollerade och SHA-256-verifierade. De visar tillsammans **7 569 av 7 569 passerade testkörningar**, med **0 fail, 0 cancelled, 0 skipped och 0 TODO**. Samtliga **16** faktiska install-, check-, audit-, test- och buildgrindar passerade.

Sites build **kördes och passerade** mellan **2026-11-06 03:52:24 och 03:52:36 UTC**. Loggen innehåller både kommandot npm run build, flera slutförda Vite-byggen och slutraden Build complete. Build var inte skipped.

Detta är ett separat main-kvitto. PR-kvittot bevaras i [wave4-third-pr-ci-f488841](../wave4-third-pr-ci-f488841/REPORT.md). Tidigare misslyckade körningar har inte ändrats.

## Körning och källbindning

| Fält | Verifierat värde |
| --- | --- |
| Repository | sharbel0022/Mgeorge |
| Branch / event | main / push |
| Head och samtliga tre checkout-SHA | 0035ea89ef3cd60f0924f901503cad00d1ab1fca |
| Fullständigt gitträd | 2f22b5e154646507f78e9e44952513d7456905e4 |
| Sites-träd | 58c2cae56a5be177842c360ae46d5caed83fdd9b |
| Mergeföräldrar | 41aadcef5fc6f65cc73979997b195c7b4f12eec1; f488841afccdefba17a6b584320347581f60c3f4 |
| Workflow | .github/workflows/payment-control-ci.yml |
| Run | [42158636715](https://github.com/sharbel0022/Mgeorge/actions/runs/42158636715) |
| Run number / attempt | 265 / 1 |
| Workflow-ID | 398864112 |
| Start | 2026-11-06T03:47:22Z |
| Terminal uppdatering | 2026-11-06T03:52:39Z |
| Terminal run läst | 2026-11-06T03:54:07.582Z |
| Terminala jobb lästa | 2026-11-06T03:52:51.972Z |
| Runtime i alla tre jobb | Node v22.23.4 |

Checkout-SHA är läst ur varje fullständig jobblogg efter git log -1 --format. Main-commitens träd, föräldrar och Sites-träd är också verifierade genom pinnade GitHub Git API-läsningar. [source-verification.json](source-verification.json) bevarar dessa svar och bindningar. [terminal-status.json](terminal-status.json) bevarar körningen, jobb och samtliga steg med GitHubs faktiska tidsstämplar.

## Exakta testantal

| Jobb | Jobb-ID | Tests | Pass | Fail / cancelled / skipped / TODO | Jobb klart |
| --- | --- | ---: | ---: | --- | --- |
| Node | 127698704223 | 2321 | 2321 | 0 / 0 / 0 / 0 | 2026-11-06T03:51:04Z |
| Sites | 127698703819 | 5201 | 5201 | 0 / 0 / 0 / 0 | 2026-11-06T03:52:39Z |
| Bridge | 127698704025 | 47 | 47 | 0 / 0 / 0 / 0 | 2026-11-06T03:47:42Z |

Summan är 7 569 testkörningar i Payment-jobben. Varje logg har exakt en terminal TAP-sammanfattning. Inget not ok-testblock finns och avslutande runnerstädning finns i samtliga tre sparade loggar.

## Check, audit och build

Node och bridge rapporterar **found 0 vulnerabilities** vid sina separata auditgrindar. Sites audit kör npm audit --audit-level=high och passerar, men rapporterar **8 moderate severity vulnerabilities**. Sites har därför inte redovisats som ett nollfynd. Bridge använder dessutom --omit=dev. De exakta auditkommandona, loggraderna och GitHub-stegstatusarna finns i [ci-receipt.json](ci-receipt.json).

| Jobb | Faktisk grind | Resultat | Start UTC | Slut UTC |
| --- | --- | --- | --- | --- |
| test | Run npm ci --ignore-scripts | success | 2026-11-06T03:47:39Z | 2026-11-06T03:47:41Z |
| test | Run npm run check | success | 2026-11-06T03:47:41Z | 2026-11-06T03:47:46Z |
| test | Audit production dependencies | success | 2026-11-06T03:47:46Z | 2026-11-06T03:47:47Z |
| test | Run tests with synthetic data | success | 2026-11-06T03:47:47Z | 2026-11-06T03:51:00Z |
| sites | Run npm run install:ci | success | 2026-11-06T03:47:37Z | 2026-11-06T03:47:50Z |
| sites | Verify exact installed minimatch mitigation bytes | success | 2026-11-06T03:47:50Z | 2026-11-06T03:47:50Z |
| sites | Install shared OCR runtime for cloud integration test | success | 2026-11-06T03:47:50Z | 2026-11-06T03:47:51Z |
| sites | Run npm run check | success | 2026-11-06T03:47:51Z | 2026-11-06T03:48:00Z |
| sites | Audit Sites production dependencies | success | 2026-11-06T03:48:00Z | 2026-11-06T03:48:22Z |
| sites | Install isolated bridge for full synthetic SFTP chain | success | 2026-11-06T03:48:22Z | 2026-11-06T03:48:22Z |
| sites | Run Sites tests with synthetic data | success | 2026-11-06T03:48:22Z | 2026-11-06T03:52:24Z |
| sites | Run npm run build | success | 2026-11-06T03:52:24Z | 2026-11-06T03:52:36Z |
| bankgiro_bridge | Install isolated SFTP bridge | success | 2026-11-06T03:47:33Z | 2026-11-06T03:47:33Z |
| bankgiro_bridge | Check isolated bridge syntax | success | 2026-11-06T03:47:33Z | 2026-11-06T03:47:34Z |
| bankgiro_bridge | Audit isolated bridge production dependencies | success | 2026-11-06T03:47:34Z | 2026-11-06T03:47:34Z |
| bankgiro_bridge | Test synthetic SSH SFTP HTTP and durable recovery | success | 2026-11-06T03:47:34Z | 2026-11-06T03:47:40Z |

[sites-build-evidence.json](sites-build-evidence.json) bevarar API-steget och de tidsstämplade buildraderna. Alla fullständiga installations-, check-, audit-, test- och buildutdata finns i råloggarna nedan.

## SaaS på main

Det pinnade SaaS-workflowet har push-filter **feature/saas-***, pull_request-filter **main** och workflow_dispatch. Push till main matchar därför inte dess push-filter. Ingen separat SaaS-körning krävs av detta workflow för denna main-push, och inget SaaS-resultat på main påstås.

Den exakta head_sha + event=push-läsningen hittade Payment-körningen. PR:s separata SaaS-körning 42157715038 finns i det tidigare PR-kvittot; dess överlappande tester läggs inte till i main-totalen. Triggerbedömningen och råa pinnade workflowfiler finns i [workflow-applicability.json](workflow-applicability.json).

Båda sparade workflowfilerna har kontrollerats mot GitHubs git-blob-SHA med Git-formatet blob + längd + NUL + filbytes:

| Pinnad workflowfil | Verifierad git-blob-SHA |
| --- | --- |
| [payment-control-ci.yml](workflows/payment-control-ci.yml) | 093737d0fcc940b8876a179b0f5e4303dd30abc9 |
| [saas-security-acceptance.yml](workflows/saas-security-acceptance.yml) | 3c8fbd5aa04c982c7c05003515bb1ee865d0c646 |

## Fullständiga råloggar och hash

Loggarna är bevarade som UTF-8 från connectorns fullständiga loggsträngar. BOM, ANSI-sekvenser och radslut är kvar. Analysen använde separata normaliserade kopior i minnet. Varje begränsat skrivblock lästes tillbaka, varefter den färdiga filens byteantal och SHA-256 kontrollerades.

| Rålogg | Bytes | SHA-256 |
| --- | ---: | --- |
| [node-127698704223.log](logs/node-127698704223.log) | 989607 | e9f323a9917b0c9c59aa181f43a1ba5058781672a6634ea8ff34a88514c9d525 |
| [sites-127698703819.log](logs/sites-127698703819.log) | 2233824 | c75d97d4701ceb952cac34d461e73bcbebe340297027daf0905e4fd3ac0e361f |
| [bankgiro-bridge-127698704025.log](logs/bankgiro-bridge-127698704025.log) | 35875 | d8220970d547c401ee52b6514c187b358c103ab1536b1174387e67d623f3c25d |

[raw-log-receipts.json](raw-log-receipts.json) innehåller mottagningstider och filkvitton. [status-history.json](status-history.json) bevarar de faktiska observationerna. Den snabba verifierade terminalbekräftelsen ligger i [exact-green-confirmation.json](exact-green-confirmation.json); paketeringen fortsatte därefter utan fler statuspollningar.

## Artefakter och slutkontroll

Det maskinläsbara slutkvittot är [ci-receipt.json](ci-receipt.json), och de verifierade invarianten finns i [validation.json](validation.json). [checkpoint.json](checkpoint.json) markerar uppgiften som komplett. [SHA256SUMS](SHA256SUMS) omfattar samtliga filer i denna katalog utom manifestet självt och verifieras med sha256sum -c.

Endast läsande GitHub-anrop och skrivningar i denna separat angivna granskningskatalog utfördes. Ingen workflowdispatch, omkörning, produkt-, PR-, ref-, workflow- eller produktionsändring ingår i uppgiften. Kvittot beskriver CI; publiceringsutfall bedöms separat av root.

Verifieringen slutfördes 2026-11-06T04:01:44+00:00.
