# OCR-schema — avgränsad läsdiagnos 2026-11-05

## Slutsats

**Inget konkret konfigurationsfel är påvisat. Orsaken till det saknade periodiska anropet är fortfarande okänd. Område 28 förblir under 8.**

Den sista avgränsade GitHub-läsningen avslutades **23:43:32 UTC**. En uttrycklig fråga efter `schedule`-körningar skapade efter PR 56:s main-merge **22:39:48 UTC** gav **0 träffar**. Senaste observerade periodiska körning är fortfarande [42083409804](https://github.com/sharbel0022/Mgeorge/actions/runs/42083409804), skapad 18:21:17 och avslutad 18:23:36 UTC. Det senare lyckade [42124413524](https://github.com/sharbel0022/Mgeorge/actions/runs/42124413524), 22:47–22:49, har uttryckligen event `workflow_run`.

[Maskinläsbart underlag](cloud-ocr-schedule-read-diagnosis.json) innehåller källor, exakta svarssammanfattningar, tider, aktörsuppgifter, kodhashar, begränsningar och separata slutsatsnivåer. Inga dispatchar, återkörningar, schemabyten, hemlighetsläsningar, bank-/Gmail-/OCR-anrop eller produktionsskrivningar ingår. V3 har inte öppnats eller körts för denna diagnos.

## Säkerställda fakta

| Kontroll | Utfall |
|---|---|
| Standardgren | GitHub anger `main`; repositoryt är publikt och inte arkiverat. |
| Workflowfil | Finns på både `819adee2f3848b474167eb6b15f82584caeb39af` och nya main `41aadcef5fc6f65cc73979997b195c7b4f12eec1`. Exakt samma Git-blob `7a4b3931d69c6250a3a091b52f5a12a211061578`. |
| Aktivt workflow | Roots bevarade offentliga GET-kvitto 23:41:18.822421 UTC anger workflow `399932780`, `state=active`. Denna reviewer har läst kvittot; det är inte ett eget nytt workflow-state-anrop. |
| Cron | `7/15 * * * *`, motsvarande minuterna 7, 22, 37 och 52 UTC. Det tidigare listuttrycket anger samma minuter. |
| Nominella tillfällen efter PR 56 | 22:52, 23:07, 23:22 och 23:37 före lässtoppet. Dessa är schemats tider, inte garanterade leveranstider. |
| Synliga aktiva OCR-körningar | Ingen OCR-rad returnerad för `queued`, `pending`, `waiting`, `requested` eller `in_progress`. Den sistnämnda frågan returnerade main-CI. |
| Aktör och cronändring | Senaste schemakörningens aktör och cronändringens GitHub-författare/committer är `sharbel0022`. Separat aktuell behörighetsläsning gav `admin`. |
| Historik före PR 56 | Schemakörningar 5 november 03:02, 10:45 och 18:21. Det glesa mönstret är alltså äldre än PR 56. |

GitHubs [dokumenterade stegsyntax och schemavillkor](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) stödjer cronläsningen, UTC och standardgrenen. Där beskrivs också risken för fördröjda eller tappade schematillfällen. Den aktuella filen har inget `schedule`-specifikt branch-/pathfilter.

## Vad koden och observationerna avgränsar

Jobbets `if` kräver main och den befintliga aktiveringsvariabeln. Kraven på ett lyckat, exakt main-CI-payload gäller bara event `workflow_run`. Den lästa main-förkontrollen accepterar schematriggern separat och kontrollerar aktuell main före användning av OCR-behörigheten.

Dessa kontroller körs efter att GitHub har skapat en workflow-körning. De kan förklara ett överhoppat eller misslyckat jobb, men **förklarar inte ensamma varför ingen schemakörning syns i API:t**. Det är en avgränsad slutsats om den observerade felgränsen, inte insyn i GitHubs interna köer. Inga av dessa säkerhetsgrindar bör lättas.

Den senaste OCR-körningen har avslutats, och statusfrågorna visar ingen synlig OCR-föregångare som håller concurrency-gruppen. Även detta är en observation, inte bevis mot ett osynligt internt köfel. `in_progress`-svaret angav `total_count=6` men returnerade en rad; båda uppgifterna bevaras utan påstående om en full intern köinventering.

## Möjliga orsaker — inte fastställda

GitHubs [felsökningsdokumentation](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows) beskriver att ett schema kan sluta fungera trots aktivt workflow och fungerande manuella körningar, bland annat om den interna schemaaktörens konto inte längre är aktivt. Aktuell repositorybehörighet och den senaste aktören ger här inget positivt stöd för en sådan brist; de verifierar samtidigt inte GitHubs interna aktörsregistrering eller kontolivscykel.

GitHub Status visade **Actions Operational**. Dagens [Actionsincident](https://www.githubstatus.com/incidents/t89g2q1800fr) var markerad löst 17:42 UTC, före den lyckade schemakörningen 18:21. Incidenten bevisar därför inte orsaken till det senare avbrottet. En repositoryspecifik fördröjning, tappad trigger eller registreringsfråga återstår som möjlig förklaring.

Inaktivitet i 60 dagar stämmer inte med aktivt workflow och dagens repositoryaktivitet. Ingen felaktig cron, saknad standardgrensfil, avaktivering eller ny PR 56-regression är visad.

## Minsta nästa sakliga steg

1. Gör en ny **avgränsad läsning** efter ett senare nominellt schematillfälle och en uttryckligen redovisad observationsmarginal. Registrera faktiskt event, workflow-ID, SHA, skapande/slutförande och verklig köprogress. Ett nytt `workflow_run` efter PR 57 hålls separat.
2. Om periodiska körningar fortsätter saknas kan ägaren läsa Actions-/kontonotiser för en eventuell aktörsrestriktion och använda detta underlag för GitHub Supports kontroll av schemaregistrering och dispatch. Inget supportärende eller meddelande har skickats här.
3. Behåll nuvarande säkerhetsgrindar och redovisa område 28 som otillräckligt styrkt. Den redan genomförda ekvivalenta cronändringen behöver följas av faktisk observation. En ny spekulativ cronändring, dispatch eller återkörning bevisar inte periodicitet.

Ingen maximal GitHub-fördröjning eller schema-SLA härleds ur dessa observationer. Rapporten gäller det angivna lässtoppet; senare observationer ska dateras separat.
