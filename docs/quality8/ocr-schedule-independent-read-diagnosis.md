# Oberoende läsdiagnos: utebliven periodisk OCR

## Slutsats

Inget konkret konfigurations-, branch- eller concurrencyfel har påvisats. Ny offentlig GitHub-läsning 2026-11-06 01:16:35–01:16:42 UTC bekräftar fortsatt frånvaro av schemakörning efter Site 65. Orsaken är fortfarande okänd. Inget kodändringsförslag lämnas; ingen mutation eller dispatch har gjorts. Kriterierna för område 28 ändras inte.

## Nya observationer

- Publikt repository sharbel0022/Mgeorge: default_branch=main, archived=false, disabled=false, pushed_at=2026-11-05T23:39:57Z.
- Standardgrenens aktuella commit: 41aadcef5fc6f65cc73979997b195c7b4f12eec1.
- Workflow 399932780: state=active, path=.github/workflows/sites-cloud-ocr.yml.
- Workflow hämtat via Contents API på main: blob 7a4b3931d69c6250a3a091b52f5a12a211061578, samma fil som tidigare diagnos.
- Explicit event=schedule och created>2026-11-05T23:48:25Z: total_count=0, returned=0, observerat 01:16:41.625177 UTC.
- Senaste schedule: 42083409804, bf24a3c52ffc637d1e7bbc4d4f64a1732dcd9fee, skapad 2026-11-05 18:21:17, avslutad/success 18:23:36.
- Senaste körning över alla event: workflow_run 42132076896, 41aadcef, skapad 23:47:38 och avslutad/success 23:50:50. Den är inte periodisk.
- Senaste tio schemarader av totalt 33 och senaste 20 alla-event-rader av totalt 38 hämtades. Samtliga dessa 20 hade status completed. Ingen full historikinventering påstås.
- Separata workflowfrågor för queued, pending och waiting returnerade vardera total_count=0 och noll rader.
- requested och in_progress kunde inte läsas: proxy returnerade HTTP 403 Forbidden. Ingen fullständig aktivköinventering påstås och inga försök att kringgå detta gjordes. Insamlingens process skrev färdig rårapport, men efterföljande PTY-poll rapporterade nätgodkännande avbrutet. Bedömningen bygger enbart på de faktiskt sparade framgångsrika svaren och de uttryckliga felen.

## Kodgranskning och slutsatsnivå

Cron 7/15 * * * * betyder minuterna 7,22,37,52 enligt GitHubs dokumenterade stegsyntax. Nominella tillfällen efter publiceringen är 23:52,00:07,00:22,00:37,00:52,01:07; senaste hade cirka nio minuters observationsmarginal. Dessa tider är inte garanterade leveranstider eller en påstådd SLA.

Filen finns på den verkliga standardgrenen och har varken schedule-specifikt branchfilter eller pathfilter. Jobbets if tillåter schedule på main med befintlig aktiveringsvariabel; de strängare CI-payloadvillkoren tillämpas endast på workflow_run. verify-cloud-ocr-trigger.mjs på exakt 41aad accepterar schedule separat och kontrollerar därefter aktuell main. Dessa senare grindar kan ge skipped/failed när en körning har skapats, men är inte någon påvisad förklaring till frånvaron av synliga schemakörningar. Inga behörighetsgrindar bör lättas.

Concurrency använder den fasta gruppen sites-cloud-ocr med cancel-in-progress=false. Sökning i de lokala workflowfilerna fann ingen annan användning av samma grupp. Senaste synliga OCR-körningen är avslutad, de läsbara väntestatusfrågorna är tomma och senaste 20 rader är completed. Inget observerat stöd finns för att en långlivad synlig föregångare blockerar. API-begränsningen och frånvaron av insyn i GitHubs interna köer innebär att ett internt fel inte är uteslutet.

Aktivt workflow och aktuell repositoryaktivitet talar emot 60-dagarsinaktivering. Senaste schemakörningens aktör är sharbel0022. Detta bevisar inte att GitHubs interna schemaaktörsregistrering eller kontolivscykel är korrekt just nu; inga tokens, secrets eller privata kontoinställningar lästes.

## Officiella källor och vad de stödjer

- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule — scheman körs från standardgrenen, kan fördröjas eller tappas vid belastning och publika repositories kan inaktiveras efter 60 dagars inaktivitet. Det dokumenterar möjliga mekanismer, inte orsaken i detta repository.
- https://docs.github.com/en/enterprise-cloud%40latest/actions/reference/workflows-and-actions/workflow-syntax#onschedule — stegsyntax, inklusive exemplet 20/15; stöd för läsningen av 7/15.
- https://docs.github.com/en/actions/how-tos/troubleshoot-workflows — aktivt workflow kan sakna schemakörningar vid problem med associerad aktör. Det är en möjlig felsökningsgren, inte ett konstaterat kontofel här.
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency — en running och som standard en pending körning per grupp; senare pending kan ersätta tidigare pending. Dokumentationen bevisar inte faktisk contention här.

## Minsta nästa sakliga steg

Bevara detta nya läskvitto och fortsatt skillnad mellan schedule och workflow_run. Om frånvaron fortsätter är kontroll av ägarens Actions-/kontonotiser eller GitHub Supports interna schemaregistrering/dispatch mer riktat än ännu en spekulativ cronändring. Inga meddelanden har skickats och ingen ändring föreslås i denna granskning. Ett manuellt dispatchresultat skulle inte fylla luckan i periodicitet.

Råa publika GET-svar, exakta URL:er och individuella tidsstämplar finns i ocr-schedule-independent-public-api.json. Lokala utgångskällor var cloud-ocr-schedule-read-diagnosis.md och schedule-runtime-observations-20261106.json; deras tidigare uppgifter har inte ersatts med nya påståenden om live-applikationen. Inga bank-, Gmail-, OCR-processor- eller produktionsskrivningsanrop gjordes. V3 lästes inte.
