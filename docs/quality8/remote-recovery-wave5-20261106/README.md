# Återhämtning av PR59 och main237 CI

**PR59 är grön. Den ursprungliga main237-körningen är underkänd.** Detta arkiv bevarar de sju ursprungliga jobbloggarna och det fullständiga felblocket efter att den lokala exekveringsmiljön blev otillgänglig.

## Verifierat återställt innehåll

De sju råloggarna omfattar **6 573 715 bytes**. Varje logg matchar tidigare bevarat byteantal och SHA-256. Felblocket är **1 055 bytes**, med SHA-256 `41e3e819aab3a361966786b391b51e59e991eb49eef92b9c0703ed4e059cfde5`. Innehållet har återlästs fullständigt från GitHub och jämförts byte för byte efter uppladdning. UTF-8-BOM, tidsstämplar, ANSI-sekvenser och radbrytningar i råloggarna är bevarade.

## Resultat

| Omfattning | Körning, försök 1 | Node | Sites | Bridge | Payment totalt | Utfall |
|---|---:|---:|---:|---:|---:|---|
| PR59 | 42163947263 | 2321/2321 | 5237/5237 | 47/47 | 7605/7605 | success |
| main237 push | 42164894222 | 2320/2321 | 5237/5237 | 47/47 | 7604/7605 | failure |

SaaS-körning **42163947178** för PR59 passerade: Node security **325/325**, Sites security **929/929**. Urvalen överlappar Payment och adderas inte till dess total. Samtliga TAP-sammanfattningar har 0 cancelled, 0 skipped och 0 TODO. Main har ett separat överhoppat GitHub-städsteg efter det misslyckade Node-jobbet; det är inte ett överhoppat test.

PR59:s 20 obligatoriska kommandosteg passerade. För main237 passerade 15 av 16; Node-teststeget misslyckades. Båda Sites-byggena kördes: PR **04:48:24–04:48:41 UTC**, main **04:55:40–04:55:52 UTC**. Båda loggarna innehåller `Build complete.`. Node och bridge rapporterar noll produktionsberoendesårbarheter. Sites rapporterar **8 moderate** och passerar den befintliga auditgränsen `high`; detta beskrivs inte som noll sårbarheter.

## Oförkortat fel

Main-jobb **127718950721**, test **1864**, misslyckades:

> two real processes import and reconcile one bank payment once, then replay safely after restart

Felet är `Synthetic concurrency worker failed before ready`, `ERR_TEST_FAILURE`, vid `test/payment-concurrency.test.js:38:1`. Hela tidsstämplade blocket finns i [main237/failure-blocks.log](main237/failure-blocks.log), och hela jobbloggen i [main237/logs/node-127718950721.log](main237/logs/node-127718950721.log). Återhämtningen fastställer inte arbetarprocessens bakomliggande avslutsorsak.

## Exakt källbindning

- PR59 head: `501de72c079a6b41593356f027990bc24b0aac8c`.
- PR-jobbens faktiska checkout: `643c1bedf37bc05e50e98999f4131f993bb71cd2`, med föräldrar `0035ea89ef3cd60f0924f901503cad00d1ab1fca` och PR-head ovan.
- Main-head och alla tre main-checkouts: `237dd45e7e1b40513d2dd25ccff59bb08f023264`.
- Samma rotträd: `2fcd7736a029663e7519d31ed91be1e2db24cf17`.
- Samma Sites-träd: `4feabc128c5f677103232d1cad1e4406083e8f19`.

De tre commitobjekten har återlästs separat från GitHub. Samtliga sju checkout-rader har kontrollerats mot fulla loggar. De fixerade workflow-filerna finns under `pinned-source/`. SaaS-workflowens main-push gäller inte enligt dess faktiska triggers.

## Äldre kvitton som saknas

De ursprungliga JSON-kvittona, deras fullständiga manifest, den gamla failure-analysis-filen och de ursprungliga gzip-arkivens komprimerade bytes kunde inte återställas. Bevarade hashankare redovisas i [original-reference-hashes.json](original-reference-hashes.json). De okomprimerade jobbloggarna och felblocket är däremot exakt verifierade originalbytes.

Det lokala, ej pushade docs-committet `a01767a` uppgavs innehålla 52 filer. Dess exakta träd och fullständiga filförteckning är otillgängliga. Denna checkpoint gör **inget anspråk på byteidentitet med a01767a** eller på att återställa dess övriga dokument.

## Nya återläsningar och manifest

Filerna under `readback/` är **senare sanerade API-återläsningar**, med egna hämtningstider. De ersätter inte äldre JSON byteidentiskt. Endast det ursprungliga försöket, `attempts/1`, används för körningsstatus. Ingen omkörning utfördes. Den tidigare PR-mergebarhetens fulla JSON är otillgänglig och ersätts inte med dagens redan mergade PR-status.

[ci-summary.json](ci-summary.json) innehåller exakta testblock, jobbstatusar, steg, audit- och byggresultat. [recovery-inventory.json](recovery-inventory.json) skiljer återställda original från nya metadata och förlorade artefakter. [hash-verification.json](hash-verification.json) beskriver hashkontroller och full återläsning. [file-manifest.json](file-manifest.json) listar filernas byteantal, SHA-256 och Git-blob-SHA. [SHA256SUMS](SHA256SUMS) kan kontrolleras från denna katalog med `sha256sum -c SHA256SUMS`.

## Checkpointens omfattning

Checkpointen utgår från main237 och lägger bara till denna katalog under `docs/quality8/remote-recovery-wave5-20261106`. Inga produktfiler, workflows, befintliga evidensfiler eller huvudgrenar ändras. Ingen PR, merge, workflow-dispatch, rerun eller publicering ingår. Produktionsstatus har inte lästs eller ändrats under återhämtningen.

Genererad återhämtningssammanställning: 2026-11-06T05:47:41.891Z.
