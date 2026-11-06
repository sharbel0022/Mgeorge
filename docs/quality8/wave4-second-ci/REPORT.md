# PR 58: exakt CI för reparerat head 364232a

## Terminalt resultat: Payment control failure, SaaS success

**Kandidaten har inte godkänd CI.** Payment control `42153187290` avslutades med `failure` 2026-11-06 03:00:43 UTC. Sites teststeg hade 12 assertionsfel; produktionsbygget hoppades över. Node och bridge lyckades. SaaS security `42153187307` avslutades med `success`, uppdaterad 02:56:08 UTC.

- Branch: `feature/rating8-reviewed-geometry-retry-20261106`.
- PR-head: `364232a393fe96257a2579aac77dfb8dcfb87999`.
- Testprocessernas Node-version: `v22.23.4` i alla fyra jobb.
- Kandidatträd: `189bbc347ac5ac5f50729796f71b341c7a91c63a`.
- Alla fyra jobb checkade ut GitHubs PR-mergecommit `93ebe255217e064c007c379a24a028ffe5e4e098`.
- GitHubs commit-API bekräftar exakt samma träd för checkout och kandidat. Mergecommitens föräldrar är main `41aadcef5fc6f65cc73979997b195c7b4f12eec1` och kandidat-head ovan.
- Båda run-resurserna anger `event=pull_request`, head ovan och attempt 1. [Källbindning](source-verification.json).

## Exakta testantal

| Jobb/population | Tester | Pass | Fail | Cancel | Skip | TODO | Resultat |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Payment: Node | 2 321 | 2 321 | 0 | 0 | 0 | 0 | success |
| Payment: Sites | 4 981 | 4 969 | 12 | 0 | 0 | 0 | failure, exit 1 |
| Payment: bridge | 47 | 47 | 0 | 0 | 0 | 0 | success |
| Payment totalt | 7 349 | 7 337 | 12 | 0 | 0 | 0 | failure |
| SaaS: node-security | 325 | 325 | 0 | 0 | 0 | 0 | success |
| SaaS: sites-security | 893 | 893 | 0 | 0 | 0 | 0 | success |
| SaaS separat totalt | 1 218 | 1 218 | 0 | 0 | 0 | 0 | success |

SaaS-populationerna är separata acceptanskörningar och överlappar fullsviterna; de adderas inte till Payment-totalen. Testernas skip=0 innebär inte att alla workflowsteg kördes: Sites build är uttryckligen `skipped`.

## Konkreta fel

Samtliga 12 fel finns i `sites/tests/review-explicit-recipient-boundaries.test.mjs`, testdefinition på rad 25 och assertion på rad 27. Tre fall återkommer för **Node pdf, Node ocr, Sites pdf och Sites ocr**:

| Fall | Förväntat | Faktiskt |
| --- | --- | --- |
| colon recipient followed by bare supplier | `null` | `Syntetiska Mottagaren AB Leverantör Syntetiska Säljaren AB` |
| colon recipient followed by bare customer | `null` | `Syntetiska Mottagaren AB Kund Syntetiska Andra AB` |
| colon recipient followed by repeated bare recipient | `null` | `Syntetiska Mottagaren AB Faktureras till Syntetiska Andra AB` |

Feltypen är `ERR_ASSERTION` / `strictEqual`, med meddelandet `An unresolved role/field is not part of a recipient name`. [Samtliga 12 exakta felblock](sites-failure-blocks.json) har råa tidsstämplar och radpositioner i hela Sites-loggen. Inga testassertioner eller produktfiler ändrades under bevakningen.

Sites teststeg startade 02:54:57 UTC och slutade med failure 03:00:41 UTC. Loggen anger `Process completed with exit code 1`. Sites-jobbet avslutades 03:00:43 UTC. Buildsteget registrerades `skipped` 03:00:41 UTC.

## Check, audit och build

| Grind | Utfall |
| --- | --- |
| Node installation och `npm run check` | success |
| Node audit | success, 0 vulnerabilities |
| Sites verifierad installation och minimatchkontroll | success |
| Sites `npm run check` / TypeScript | success |
| Sites audit på high-nivå | success; rapporterade 8 moderate severity vulnerabilities |
| Sites tester | failure, 12 assertionsfel |
| Sites produktionsbygge | **skipped, ej kört** |
| Bridge installation och syntaxkontroll | success |
| Bridge audit med `--omit=dev` | success, 0 vulnerabilities |
| SaaS syntetisk säkerhetsacceptans och evidensuppladdning | success |

Fullständiga stegstatusar och exakta auditblock finns i [maskinläsbart kvitto](ci-receipt.json) och [terminalstatus](terminal-status.json). Ärvda Actions-varningar om att action-runtime Node 20 tvingas till Node 24 finns i råloggarna; de är inte testfel och blandas inte ihop med setup-node-versionen för testprocesserna.

## Råloggar och integritet

Fulla jobbloggar hämtades först sedan respektive jobb var terminalt. Connectorns fullständiga avkodade logginnehåll sparades oförändrat som UTF-8, inklusive BOM och radslut, i högst 24 000-teckens skrivblock. Varje block lästes tillbaka och kontrollerades. Samtliga fyra loggar innehåller avslutande jobbstädning och har SHA256-verifierats. [Loggkvitton](raw-log-receipts.json) och [SHA256SUMS](SHA256SUMS) anger storlek och full hash.

- [Node-rålogg](logs/test-127681065581.log)
- [Sites-rålogg](logs/sites-127681065709.log)
- [Bridge-rålogg](logs/bankgiro_bridge-127681065799.log)
- [SaaS-rålogg](logs/security_acceptance-127681065605.log)

[Statushistoriken](status-history.json) bevarar läsningarna. Root informerades direkt vid observerad terminal failure och fick konkreta felblock före slutrapporten. Ingen PR-, ref-, workflow- eller produktionsmutation har gjorts. Detta kvitto gäller PR-headet; någon main-CI eller merge ingår inte.

## GitHub-källor

- [Payment control 42153187290](https://github.com/sharbel0022/Mgeorge/actions/runs/42153187290)
- [Sites-jobb 127681065709](https://github.com/sharbel0022/Mgeorge/actions/runs/42153187290/job/127681065709)
- [SaaS security 42153187307](https://github.com/sharbel0022/Mgeorge/actions/runs/42153187307)
