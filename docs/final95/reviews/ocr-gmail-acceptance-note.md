# Slutlig acceptansnotering: OCR/Gmail

2026-11-06. Avgränsad read-only-kontroll mot produktkoden i `2982b6c51cf2891d97b816ea1ce6c82e5f4c71a1`. Produktdiffen mot denna commit var tom vid kontrollen. Inga repositoryfiler, produktionsdata, behörigheter eller schemainställningar har ändrats. Inga nya provideroperationer eller testkörningar utfördes i denna slutkontroll.

## Beslut

**Kodens köåterställning och extraktionsskydd är accepterade inom verifierat scope. Produktionsmässig Gmail-schematillförlitlighet och uthållig genomströmning är fortfarande obevisade.** Inga ytterligare konkreta, reproducerbara tekniska fel identifierades i den avgränsade kontrollen. Detta är inte ett påstående om fullständig felfrihet eller uppnått 9,5/10.

| Krav | Verifierad täckning och kvarvarande gräns |
| --- | --- |
| Lease löper ut och worker startar om | `document-queue-recovery` och `cloud-ocr` kontrollerar en vinnande lease, omtag efter expiry, fence vid skrivning, åtskilda ägare/motorer och avvisade gamla completion-svar. |
| Retry och sista försök | Beständig backoff, högst tre försök, återvinning av sista-försök-kvitto och avvisning av gammalt/saknat kvitto. Nya backlogtester visar att tredje okontrollerade kvittot bevaras till nästa begränsade pass, även om första kvittot är ogiltigt. |
| Originalintegritet | Ägare, storlek, SHA-256, faktiska originalbytes och kvitto kontrolleras. Testerna täcker ändrade bytes med samma storlek, ändrad storlek/hash/ägare och race efter kontroll. Återställningen ändrar inte originalen. |
| Svenska och engelska fakturor | Parallella Node-/Sites-fall täcker belopp, moms, datum, fakturanummer, part, nollutfylld referens, strikta tusentalsgrupper, tabeller och flersidiga identitetskonflikter. `Net 30`, saknade fält och motstridiga belopp blir inte säkra värden. |
| Osäkerhet och registrering | OCR förblir granskningspliktigt; högt nominellt OCR-confidence ger inte automatisk registrering. Bankgiro kräver original- och textbundet ordbevis. Overifierad motpart och saknad moms/netto stoppar automatisk registrering. |
| Transport | Endast ett begränsat omtag av läsande original-GET. Lease-/completion-POST upprepas inte vid okänt utfall. Endast accepterad delprogress räknas; okänt slutstatus förblir synligt. |
| Statusens sanningshalt | Gmail-hämtning, automatisk appinvokation, OCR-worker och registrering har separata bevis. Saknade mått blir inte nollor eller ett påhittat fungerande schema. |

**Befintliga slutkvitton:** Node-fokus 336/336, Sites-fokus 446/446, queue-recovery 38/38. Samtliga utan skip/cancel/todo. Tre verkliga lokala OCR-anrop använde redan etablerade syntetiska PNG-original; frysta ordobservationer är separata återspelningar. Ingen ny blind OCR-precision har mätts och V3 är orörd. Root har dessutom rapporterat full Node 2481 PASS och bridge 47 PASS; Sites fullsuite pågick vid denna notering. Root äger de exakta fullsuite-/CI-kvittona och den slutliga commitbindningen för draft-PR #61.

## Skilj de observerade driftskedena

- Moln-OCR 10:44 UTC med `processed=6`, `failed=0` visar ett verkligt accepterat bearbetningspass. OCR kan bearbeta redan sparade dokument utan en ny Gmail-hämtning.
- Gmail hade senaste lyckade apphämtning 04:06 UTC. Automationens 11:00 UTC-körning gav `no_update` efter cirka en sekund utan matchande nytt appkvitto. Den visar inte att Gmail hämtades.
- `397 needs_review` och `52 waiting_ocr` beskriver olika tillstånd. De 396 overifierade motparterna och 333 lågkonfidensfallen motiverar fortsatt granskning; orsaksräknarna kan överlappa.
- `external_schedule_verified=false` är korrekt i appens nuvarande bevismodell: en appinvokation ensam intygar inte vem som schemalade den. Ett verifierat externt körkvitto ska redovisas separat, inte ersättas av en kosmetiskt ändrad flagga.

## Exakta återstående åtgärder för schemabevis

1. **Kontrollera den befintliga automationens exekveringsspår.** Leta efter ett faktiskt MCP-verktygsanrop till `gmail_auto_sync`, dess externa execution-id/tid, rätt företagskontext och konkret svar eller fel. Entrypointen kräver `manage_integrations` och anropar `gmailSync(undefined, true)`. Saknas verktygsspannet ligger nästa rättning i runtime-dispatch eller tillgänglig verktygs-/autentiseringsbindning. Ett genererat `no_update`-svar är otillräckligt.
2. **Efter eventuell runtime-rättning, observera ett normalt auktoriserat schemapass.** Knyt det externa spåret till appens `gmail.automatic.invoked` och `gmail.automatic.result` med samma interna `run_id`, inom rätt företag. Kontrollera det faktiska utfallet: `not_due`, `paused`, `blocked` och `reconnect_required` är giltiga besked men inte en lyckad Gmail-hämtning. En hämtning kräver ett färskt `gmail_runs`-kvitto och `last_successful_fetch`; `completed_pending` visar att underlagen hämtats men efterkontrollen återstår.
3. **Verifiera återkomst utan manuell sync.** Använd bevarade körkvitton om de finns, annars observera minst två efterföljande förväntade schematillfällen. Dokumentera eventuella gap och providerfel. Respektera pausläge, befintligt medgivande, Retry-After och spärr efter tre misslyckade automatiska försök. Nytt medgivande genomförs endast av behörig användare om det faktiska felet kräver det.

## Exakta återstående åtgärder för uthållig genomströmning

1. Spara tidsstämplad startstatus per företag: `ready_pdf`, `ready_ocr`, `deferred`, `active`, `expired_leases`, `exhausted`, `failed`, `oldest_pending_at`, `next_retry_at` och mottagna nya dokument. Dessa aggregat räcker för driftanalys; kunders OCR-text och fakturavärden behöver inte kopieras till rapporten.
2. Samla befintliga, eller därefter normalt producerade, OCR-kvitton över ett helt dygn. Särskilj verkliga `schedule`-körningar från `workflow_run`/manuella körningar. Dokumentera start/slut, accepterat processed/failed och `status_unknown`, samt verifierad driftversion. Ett enskilt sexjobbspass är inte ett uthållighetsmått.
3. Läs det ägarspecifika 24-timmarsmåttet `throughput.completed_documents` tillsammans med dess `window_start`, `window_end` och basis `accepted_extractions_with_terminal_job`. Det räknar unika accepterade dokument i terminalt tillstånd. **Subtrahera inte två rullande 24-timmarsräknare och kalla differensen periodens nya genomströmning**: äldre händelser kan lämna fönstret och ett dokument kan återgå till granskning/bearbetning. En annan fast mätperiod kräver en auktoriserad aggregering av beständiga kvitton, med samma dedupliceringsregler.
4. Jämför avslutade unika dokument, inflöde och kvarvarande kö över samma mätperiod. Redovisa om kön minskar och hur åldern på äldsta körbara dokument ändras. Separera tekniska fel, externa schemagap och manuella granskningsorsaker; registrerade fakturor är ett eget mått.

Kodens tak är sex OCR-dokument per planerat kvartspass: nominellt högst 24 OCR-dokument/timme, plus högst åtta text-PDF:er. De 52 väntande OCR-dokumenten kräver minst nio lyckade pass under idealvillkor. Denna beräkning ska inte presenteras som uppnådd produktionstakt eller som ett löfte att alla 397 granskningsärenden löses automatiskt.

Detaljerad tidigare rapport och exakta testlogghashar: `ocr-recovery.md`, `ocr-final95-test-results.json`, `ocr-final95-source-manifest.json` och `ocr-final95-focused-evidence.tar.gz` i samma överlämning.
