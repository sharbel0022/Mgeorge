# OCR-schema: läsande uppföljning efter Site 65

## Resultat

**Ingen ny periodisk OCR-körning har observerats efter Site 65.** Den avslutande publika API-frågan med `event=schedule` och skapandetid efter publiceringen gav **HTTP 200, total_count=0 och 0 rader** den **2026-11-06 02:27:50.022510 UTC**. Den tidigare frånvaron kvarstår; orsaken är fortfarande okänd. Ingen konfigurationsändring föreslås av denna uppföljning.

Site 65 publicerades enligt det bevarade leveranskvittot **2026-11-05 23:48:25.739259 UTC**. API-filtrets gräns är `>2026-11-05T23:48:25Z`, alltså strax före den exakta publiceringstidpunkten. Ett tomt resultat omfattar därför hela perioden efter publiceringen.

## Färska publika observationer

Alla åtta anrop var vanliga oautentiserade HTTPS GET till GitHubs publika API, utan Authorization-header. Samtliga svarade HTTP 200. Insamlingen observerades **02:24:57.487553–02:27:50.022510 UTC**; svarens egna Date-header och request-ID finns i kvittot.

| Kontroll | Verifierat värde |
| --- | --- |
| Repository | `sharbel0022/Mgeorge`, publikt, archived=false, disabled=false |
| Verklig standardbranch | `main` |
| Standardbranchens commit | `41aadcef5fc6f65cc73979997b195c7b4f12eec1` |
| Workflow | `399932780`, `Sites cloud OCR`, state=`active` |
| Workflowfil | `.github/workflows/sites-cloud-ocr.yml` |
| Fil hämtad från exakt standardbranch-head | Git-blob `7a4b3931d69c6250a3a091b52f5a12a211061578`, 2 184 byte |
| Filens SHA256 | `bce2b361de0bec0053a0defa460216b5db1e57f6cb639e592b6ccd549c39cfa8` |
| Cron i den hämtade filen | `7/15 * * * *` |
| Schedule sedan Site 65 | 0, bekräftat 02:24:57.487553 och 02:27:50.022510 UTC |

Workflowfilens Git-blob-SHA har räknats om från de hämtade bytesen och stämmer. Main-head, workflowblob, senaste schemakörning och antalet schemakörningar är oförändrade jämfört med den föregående oberoende diagnosen 01:16 UTC. Repositoryts nya `pushed_at` är 01:44:13 UTC; det ändrar inte den separat verifierade standardbranchens head.

## Faktiska körningar och event

| Egenskap | Senaste `schedule` | Senaste över alla event |
| --- | --- | --- |
| Run-ID | [42083409804](https://github.com/sharbel0022/Mgeorge/actions/runs/42083409804) | [42132076896](https://github.com/sharbel0022/Mgeorge/actions/runs/42132076896) |
| Event | `schedule` | `workflow_run` |
| Status/conclusion | `completed` / `success` | `completed` / `success` |
| Skapad | 2026-11-05 18:21:17 UTC | 2026-11-05 23:47:38 UTC |
| Run started | 2026-11-05 18:21:17 UTC | 2026-11-05 23:47:38 UTC |
| Senast uppdaterad | 2026-11-05 18:23:36 UTC | 2026-11-05 23:50:50 UTC |
| Branch | `main` | `main` |
| Head | `bf24a3c52ffc637d1e7bbc4d4f64a1732dcd9fee` | `41aadcef5fc6f65cc73979997b195c7b4f12eec1` |

`updated_at` redovisas som uppdateringstid, inte som en ny avläst jobbloggs sluttid. Den lyckade `workflow_run`-körningen är **inte periodisk** och räknas inte som schemabevis. Den skapades före Site 65 och dess senare uppdatering ändrar inte eventtypen.

Schedule-listan innehöll de senaste 10 raderna av totalt 33. Alla-event-listan innehöll de senaste 20 av totalt 38. Den separata frågan efter Site 65 är tom utan statusfilter. Någon full historik- eller aktivköinventering görs inte anspråk på.

## Jobb och loggar

Ingen ny schemakörning fanns att följa till jobb eller jobblogg. Det villkorade steget att verifiera en ny körnings faktiska OCR-jobb behövde därför inte utföras. Inga jobbloggar har hämtats i denna uppföljning, och inget antal behandlade dokument eller lyckad periodisk OCR-processning påstås.

## Kvitto, sanering och avgränsning

[Det sanerade API-kvittot](public-api-receipt.json) innehåller exakta URL:er, GET-metod, individuella observationstider, HTTP-status, utvalda publika svarsfält, svarshashar och föregående källors hashvärden. De enskilda GET-kvittona är också bevarade. Fullständiga råa API-svar, användarprofiler och commitförfattares personfält har inte sparats. Workflowtexten är publik och innehåller endast variabel-/secretreferenser, inga credentialvärden. [SHA256SUMS](SHA256SUMS) förseglar artefakterna.

Skrivningar gjordes endast i denna reviewkatalog. Inga dispatches, schemaändringar, nya credentials, produktionsanrop, privata dokumentläsningar eller skrivningar i `release-docs` gjordes. Underlagen från den förra diagnosen matchar fortfarande sina ingående hashvärden. Läsningen ger inget nytt stöd för att periodicitet har återupptagits.

### Direkta publika källor

- [Repository](https://api.github.com/repos/sharbel0022/Mgeorge)
- [Standardbranch](https://api.github.com/repos/sharbel0022/Mgeorge/branches/main)
- [Workflowmetadata](https://api.github.com/repos/sharbel0022/Mgeorge/actions/workflows/399932780)
- [Workflowfil på exakt head](https://api.github.com/repos/sharbel0022/Mgeorge/contents/.github/workflows/sites-cloud-ocr.yml?ref=41aadcef5fc6f65cc73979997b195c7b4f12eec1)
- [Schemakörningar efter Site 65](https://api.github.com/repos/sharbel0022/Mgeorge/actions/workflows/399932780/runs?event=schedule&created=%3E2026-11-05T23%3A48%3A25Z&per_page=100)
- [Senaste schemakörningar](https://api.github.com/repos/sharbel0022/Mgeorge/actions/workflows/399932780/runs?event=schedule&per_page=10)
- [Senaste körningar över alla event](https://api.github.com/repos/sharbel0022/Mgeorge/actions/workflows/399932780/runs?per_page=20)
