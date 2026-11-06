# PR47 — oberoende granskning av senare QA-delta

Datum: 2026-11-05. Endast läsning av Git-objekt och GitHub-status; inga källändringar, nya sviter, produktionsåtgärder eller pushar.

## Beslut

**GODKÄND: inga blockerande fynd i hela deltat.**

- Tidigare integrerad head: `8a083eb70babac68b08ab3eac50aaa5e225c5eb8`.
- Granskad aktuell head: `875876ae539f5ecba1fc39d4c213197806e245ce`.
- Aktuellt träd: `66cfc496db38237c4837437054cb64cce4a7ed12`.
- Senaste GitHub-metadata: samma head, base `bf24a3c52ffc637d1e7bbc4d4f64a1732dcd9fee`, öppen PR, `draft=false`, `mergeable=true`.

Deltat är **inte enbart dokumentation**: två QA-kod/testfiler och nio dokument/evidensfiler, totalt 4 497 tillagda och 13 borttagna rader. Ingen produktionsruntime, paket-/låsfil, SQL-migration eller workflow ändras i detta delta.

## Samtliga ändrade filer

| Fil | Bedömning |
| --- | --- |
| `scripts/quality/core.mjs` | LCOV-aggregation och Markdownrapportering korrigeras; befintliga test-/process-/källgrindar kvarstår. |
| `test/quality-runner.test.js` | Tre nya beteendefall samt stärkta befintliga assertions; inga borttagna eller försvagade assertions. |
| `PROGRESS.md` | Daterad mätbas och senare rapporteringsändring hålls isär. |
| `QUALITY-SCORECARD.md` | Numeriska poäng bevaras; ändrad coverage-nämnare framställs inte som nya tester eller produktionsacceptans. |
| `docs/quality/AGENT-8-REPORT.md` | Full leverans-, begränsnings- och evidensbeskrivning. Historiska fel bevaras och SQLite-fixens samband med det ursprungliga okända CI-felet överdrivs inte. |
| `docs/quality/README.md` | Förklarar `files`, `records`, `sourceLines`, råsummering och äldre kvittos betydelse. |
| `docs/quality/evidence/benchmark-8a083eb.json` | Tre syntetiska batcher, 1/10/100 företag. Aggregat och metodbegränsningar är konsistenta. |
| `docs/quality/evidence/ci-42083369457.json` | Ursprungliga profiler/kommandon/resultat, historisk röd körning, arkivreferenser och separat parserkorrigering bevaras. |
| `docs/quality/evidence/coverage-8a083eb.json` | Råposternas och unika radmåttens olika nämnare redovisas; transformerade koordinater och oimporterade källor är uttryckligen begränsningar. |
| `docs/quality/evidence/cpu-profile-b24ea08.json` | Separat äldre revision och en lokal profileringskörning; ingen uppmätt runtimeförbättring eller produktionskapacitet påstås. |
| `docs/superpowers/plans/2026-11-05-quality-ci-performance.md` | Avslutade steg kopplas till faktisk mätbas; den senare rättningen kräver egen CI. |

## Kod- och testbevis

`core.mjs:59–111` skiljer unika SF-sökvägar från LCOV-poster. Fullständiga poster och exakt en uppsättning säkra summeringsräknare krävs. Fristående summeringsräknare, även noll eller ogiltiga värden, ger `measured=false` och läggs inte till råsumman.

Varje posts DA-underlag måste ha giltiga, distinkta positiva radnummer och icke-negativa heltalsträffar samt stämma mot LF/LH innan unik radunion får rapporteras. En ogiltig senare post kan inte lämna en delvis godkänd union. Funktioner och grenar behåller råa postmått eftersom deras genererade identiteter inte säkert kan slås ihop.

`core.mjs:249–265` redovisar båda måtten och behandlar äldre kvitton utan `records` som äldre postantal. Ogiltigt DA-underlag ger uttryckligen `sourceLines: NOT_MEASURED`. Detta nya unika mått är informativt; befintlig råcoverage-grind, verklig exitstatus, fullständiga TAP-resultat och oförändrat källmanifest fortsätter styra testutfallet (`171–214`). Ingen grind sänks.

`quality-runner.test.js:57–122` kontrollerar dubblettposter med skilda träffrader, sex sorters ogiltiga/ofullständiga DA-underlag och sex orphan-counter-varianter. Förväntade numeriska täljare/nämnare och renderad omfattning kontrolleras. Det verkliga subprocess-/coverage-fixturefallet får ytterligare krav på uppmätt unik radcoverage (`160–164`). Producentens separata RED→GREEN-kvitto anger 18/18; detta har inte körts om av granskaren.

## Evidens och CI

Referenshasharna från CI-kvittot till coverage-, benchmark- och CPU-filerna matchar deras exakta committade bytes. Parserkorrigeringens två SHA-256-värden matchar också de aktuella QA-filerna. Benchmarkkällans SHA-256 matchar och batcherna summerar till 1 110 importer, 2 220 replaydubbletter, 111 förväntade upptaget-svar och noll oväntade fel. De sex historiska profilerna har samma före-/eftermanifest och uttrycklig ren mätbas.

Historiska 8a083eb-resultat tillskrivs inte den senare headen. Ny oberoende GitHub-läsning på **875876a** visar:

- **Payment control checks 42088065668: completed/success.** Samtliga sex jobb är individuellt lästa och godkända: Node 22.23.4, Node 24.22.1, Sites typer/test/build, Bankgirobrygga, Chromium och syntetisk performance.
- **SaaS security acceptance 42088065637: completed/success.**

Jag har inte återhämtat och omverifierat de sju historiska ZIP-arkiven eller deras 78 interna råfiler. Den kontrollen är producentens daterade kvitto; de committade referenshasharna, metadata och aktuella CI-statusarna är separat kontrollerade här. Inga äldre fullsviteantal presenteras som en ny körning på 875876a.

Godkännandet gäller detta PR47-delta. Rootens kombinerade kandidat och eventuell senare publicering behöver egna exakta käll- och grindkvitton.
