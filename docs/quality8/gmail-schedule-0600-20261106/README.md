# Gmail-schemat: observation av 06:00 UTC den 6 november 2026

**Den planerade körningen avslutades med `no_update`. Något nytt appanrop kunde inte verifieras.** Appens anrops-, hämtnings- och avslutstider samt dokumenträknare ligger kvar vid den tidigare uppgivna baslinjen.

## Faktisk schemakörning

| Fält | Observerat värde |
|---|---|
| Automation | `Automation_6efa3aafab4081918c48001acc562f96` |
| Run-ID | `179735cb-daf0-832f-8718-6af99d18895f` |
| Scheduled | `2026-11-06T06:00:00Z` |
| Started | `2026-11-06T06:01:01.755944Z` |
| Completed | `2026-11-06T06:01:02.300507Z` |
| Recorded status | `no_update` |
| Statusläsning | `2026-11-06 06:02:02 UTC` |

Schemat är fortfarande `is_enabled=true` och anges som hourly exact_schedule i Europe/Stockholm. `next_run_time` returnerades som null; det är inte belägg för att schemat är avstängt. `updated_at` returnerades som `2026-11-06T06:01:23.982590+00:00`; observationen fastställer inte vad som ändrade denna metadata.

## Appens observerade status

| Fält | Senaste rapporterade värde |
|---|---|
| last_invoked_at | `2026-11-06T04:05:48.841Z` |
| last_successful_fetch | `2026-11-06T04:06:01.714Z` |
| last_completed_at | `2026-11-06T04:06:04.143Z` |
| last_outcome | `completed` |
| needs_review / waiting_ocr / registered | **385 / 64 / 2** |
| cloud_worker_last_seen | `2026-11-06T03:55:08.200Z` |
| cloud_last_completed | `2026-11-06T03:55:13.630Z` |
| cloud_worker_recent | `false` |

Tiderna matchar den tidigare uppgivna baslinjen på sekundnivå och dokumenträknarna matchar exakt. Ingen separat föreobservation samlades in i denna kontroll; den första statusläsningen gjordes efter att 06:00-körningen avslutats.

Appen redovisar även `last_processed=2026-11-06T04:52:38.516Z`. Detta separata bearbetningsfält bevisar inte en ny Gmail-hämtning eller koppling till 06:00-körningen. Appens `processing.registered=5` är ett annat fält än `processing.counts.registered=2`; värdena blandas inte ihop.

## Bindning och begränsning

Det finns ett konkret terminalt run-ID för schemat. Appens sparade anropstider har inte avancerat. Därför är kopplingen mellan denna schemakörning och ett nytt appanrop **inte verifierad**. `no_update` räknas inte som anropsbevis. Ingen bakomliggande orsak fastställs.

`latest_result` avser fortfarande körningen planerad till 02:00 UTC och används inte som bevis för 06:00-körningens verktygsanrop. Inga chattreferenser, konversations-/tråd-ID:n, mejladresser, ägaridentiteter, promptar eller resultattexter sparas. Person- och chattfält redakterades rekursivt före urval.

## Omfattning och evidens

Kontrollen använde clock, ett automations.peek och ett skrivskyddat gmail_sync_status. Pollningen avslutades direkt när den terminala körningen var verifierad. Ingen update, run_now, ny automation, import, process, databasändring eller produktionsåtgärd utfördes. Ingen betygshöjning görs.

Uppgiven produktionskontext är Site 66, med Site 67 endast sparad som källa. Den kontexten lästes eller ändrades inte av denna kontroll.

Det fullständiga sanerade kvittot finns i [observation.json](observation.json). [file-manifest.json](file-manifest.json) och [SHA256SUMS](SHA256SUMS) binder de nya filernas innehåll. Checkpointen utgår från faktisk main `237dd45e7e1b40513d2dd25ccff59bb08f023264`, återläst 2026-11-06T06:03:28.818Z, och lägger endast till denna dokumentkatalog.
