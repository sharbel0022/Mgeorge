# Ordinarie moln-OCR: kapacitet och utebliven köprogress

**Sex begränsar arbetet per körning, men är inte en verifierad förklaring till stoppet efter 03:55. Ingen befintlig konfiguration stöder en större OCR-batch.** Analysen gäller exakt main `237dd45e7e1b40513d2dd25ccff59bb08f023264` och offentlig GitHub-CI. Inga produktionsanrop eller ändringar har gjorts.

## Vad faktiska körningar visar

| Trigger | Run / jobb | Resultat | OCR-stegets tid |
|---|---|---|---:|
| schedule | [42153093698 / 127680754710](https://github.com/sharbel0022/Mgeorge/actions/runs/42153093698/job/127680754710) | 02:52:50–02:54:40; complete, processed=6, failed=0 | 98 s |
| workflow_run | [42159152074 / 127700385608](https://github.com/sharbel0022/Mgeorge/actions/runs/42159152074/job/127700385608) | 03:52:42–03:55:18; complete, processed=6, failed=0 | 141 s |
| workflow_run på main237 | [42165382962](https://github.com/sharbel0022/Mgeorge/actions/runs/42165382962) | 04:55:58–04:55:59; skipped | inget OCR-arbete belagt |

Den färska API-läsningen 06:37:49 UTC visar fortfarande 02:52-körningen som senaste schedule-event. En completed workflow_run räknas inte som periodicitet. Main237:s misslyckade Payment-grind uppfyller inte det uttryckliga villkoret success + push + exakt aktuell main. Detta förklarar att den vägen inte återstartade OCR; orsaken till frånvaron av senare periodiska events är fortfarande okänd. [Workflow, rader 25–32](https://github.com/sharbel0022/Mgeorge/blob/237dd45e7e1b40513d2dd25ccff59bb08f023264/.github/workflows/sites-cloud-ocr.yml#L25-L32).

De två lyckade historiska körningarna hade god tidsmarginal. Men processed inkluderar upp till två accepterade server-PDF-resultat. Totalen sex bevisar därför inte att sex OCR-leaser förbrukades eller att capen slog i. [Pull, rader 38–52 och 67–77](https://github.com/sharbel0022/Mgeorge/blob/237dd45e7e1b40513d2dd25ccff59bb08f023264/src/sites-ocr-pull.js#L38-L77).

## Varför just sex och går det att konfigurera?

runSitesOcr har default maxJobs=6 och slingan använder Math.min(maxJobs,6). Regressionen skickar maxJobs=100 och kräver exakt sex extraktioner/completions. Cloud-CLI skickar bara origin, token och mode; workflowet exponerar ingen batchvariabel. Gränsen är därmed avsiktlig och testad, men de lästa kontrakten innehåller inget benchmarkunderlag som härleder just talet sex. [Pull:22–52](https://github.com/sharbel0022/Mgeorge/blob/237dd45e7e1b40513d2dd25ccff59bb08f023264/src/sites-ocr-pull.js#L22-L52), [test:117–119](https://github.com/sharbel0022/Mgeorge/blob/237dd45e7e1b40513d2dd25ccff59bb08f023264/test/sites-ocr-pull.test.js#L117-L119), [CLI:5–9](https://github.com/sharbel0022/Mgeorge/blob/237dd45e7e1b40513d2dd25ccff59bb08f023264/scripts/run-sites-cloud-ocr.mjs#L5-L9).

En större batch kräver en separat granskad kod-/konfigurationsförändring. Att anropa om eller forcera en särskild kandidat är inte en befintlig batchinställning.

## Faktiska resurs- och kögränser

| Område | Gräns och källa |
|---|---|
| Workflow | Cron minuter 7,22,37,52; 15 min timeout inklusive setup; samma concurrency-group och cancel-in-progress=false. [yml:3–34](https://github.com/sharbel0022/Mgeorge/blob/237dd45e7e1b40513d2dd25ccff59bb08f023264/.github/workflows/sites-cloud-ocr.yml#L3-L34) |
| Batch | Högst2 server-PDF-försök följt av högst6 sekventiella OCR-leaser. [server:237–249,295–304](https://github.com/sharbel0022/Mgeorge/blob/237dd45e7e1b40513d2dd25ccff59bb08f023264/sites/lib/document-processing.ts#L237-L304) |
| HTTP | /process 60 s; lease/download/complete 25 s per request. Full sexbatch ger högst19 klientrequests enligt slingan. [pull:26–67](https://github.com/sharbel0022/Mgeorge/blob/237dd45e7e1b40513d2dd25ccff59bb08f023264/src/sites-ocr-pull.js#L26-L67) |
| Extraktion | Separat child per dokument; 90 s timer och --max-old-space-size=256. Detta är V8 old-space, inte en total RSS-gräns. Lokal processfunktion tillåter högst2 samtidiga extraktioner, medan pull-loopen väntar på en i taget. [extraction:226–239](https://github.com/sharbel0022/Mgeorge/blob/237dd45e7e1b40513d2dd25ccff59bb08f023264/src/invoice-extraction.js#L226-L239) |
| Dokument | 15MB original, högst10 PDF-sidor, 150000 tecken, 12MP raster; bilddimension högst12000 per sida. OCR-språkdata kommer från lokalt paket. [worker:22–75](https://github.com/sharbel0022/Mgeorge/blob/237dd45e7e1b40513d2dd25ccff59bb08f023264/src/invoice-worker.js#L22-L75), [image:13](https://github.com/sharbel0022/Mgeorge/blob/237dd45e7e1b40513d2dd25ccff59bb08f023264/src/image-dimensions.js#L13) |
| Server-PDF | 5MB,10 sidor,150000 tecken,12MP maxImageSize,15 s parse-timer. Promise.race följs av await destroy, alltså ingen bevisad separat 15 s processkill. [server-pdf:3–23](https://github.com/sharbel0022/Mgeorge/blob/237dd45e7e1b40513d2dd25ccff59bb08f023264/sites/lib/server-pdf.ts#L3-L23) |
| Lease/samtidighet | Cloudrunner300 s; lokal/server180 s. En aktiv lease per ägare och engine. Lokal och cloud OCR delar engine=local. Ordning available_at,document_id. [claim:105–114](https://github.com/sharbel0022/Mgeorge/blob/237dd45e7e1b40513d2dd25ccff59bb08f023264/sites/lib/document-processing.ts#L105-L114) |
| Retry | Högst3 försök;60/120 s cooldown före nästa försök; tredje fel blir failed. [claim/fail:100–119](https://github.com/sharbel0022/Mgeorge/blob/237dd45e7e1b40513d2dd25ccff59bb08f023264/sites/lib/document-processing.ts#L100-L119) |
| Resultat | POST högst600000 bytes; completion JSON350000 tecken och text150000. [route:3–8](https://github.com/sharbel0022/Mgeorge/blob/237dd45e7e1b40513d2dd25ccff59bb08f023264/sites/app/api/ocr-worker/%5Baction%5D/route.ts#L3-L8), [complete:313–318](https://github.com/sharbel0022/Mgeorge/blob/237dd45e7e1b40513d2dd25ccff59bb08f023264/sites/lib/document-processing.ts#L313-L318) |

Ingen ytterligare requests-per-second/minute-limiter identifierades i den lästa OCR-applikationsvägen. Plattformens externa CPU-, RAM- eller requestkvoter är inte fastställda av denna analys.

Komponentbudgetarna summerar nominellt till 60 + 6×(25+25+90+25) = 1050 s före workflow-setup. Det är budgetaritmetik, inte uppmätt körtid eller en garanti om maximal väggtid. Att öka antalet utan en återstående tidsbudget är därför inte motiverat bara av de två snabba historiska körningarna.

## Är capen en verklig flaskhals?

Om fyra ordinarie körningar faktiskt utförs varje timme ger sexgränsen högst24 OCR-försök/timme från schemat. 64 omedelbart claimbara dokument som alla lyckas på första försöket behöver minst11 fulla körningar. Detta är en villkorad kapacitetsberäkning; den inkluderar inga nya ankomster eller extra workflow_run-körningar.

waiting_ocr räknas utan claim-eligibility. Claim kräver dessutom needs_review-källa, attempts<3, passerad available_at och ledig engine. De uppgivna nio nya importerna kan inte utan en färsk köobservation adderas som nio OCR-jobb. [Status/claim:89–114](https://github.com/sharbel0022/Mgeorge/blob/237dd45e7e1b40513d2dd25ccff59bb08f023264/sites/lib/document-processing.ts#L89-L114).

cloud_worker_seen skrivs vid varje godkänt worker-anrop även när inget jobb hittas. cloud_worker_completed uppdateras efter accepterad completion; recent-fönstret är45 minuter. En cap på sex kan därför inte ensam förklara att heartbeat inte flyttas. Körningslucka, transport-/authfel eller fel före heartbeatens skrivning är skilda möjligheter; denna diagnos fastställer ingen upstream schedulerorsak. [workerOwner:283–303](https://github.com/sharbel0022/Mgeorge/blob/237dd45e7e1b40513d2dd25ccff59bb08f023264/sites/lib/document-processing.ts#L283-L303), [completion:329–332](https://github.com/sharbel0022/Mgeorge/blob/237dd45e7e1b40513d2dd25ccff59bb08f023264/sites/lib/document-processing.ts#L329-L332).

## Testkontrakt och minsta nästa steg

Lästa regressionskontrakt täcker sexgränsen, en aktiv OCR-plats, claim-CAS, leaseutgång/stale completion, cooldown/tre försök samt verklig syntetisk scan genom pull till sparad OCR. Detta är funktionella kontrakt, inte ett uppmätt backlogbenchmark. [Queue tests:66–158](https://github.com/sharbel0022/Mgeorge/blob/237dd45e7e1b40513d2dd25ccff59bb08f023264/sites/tests/document-queue-recovery.test.mjs#L66-L158), [cloud test:334–359](https://github.com/sharbel0022/Mgeorge/blob/237dd45e7e1b40513d2dd25ccff59bb08f023264/sites/tests/cloud-ocr.test.mjs#L334-L359). Inga tester kördes under denna skrivfria diagnos.

**Nästa steg:** observera nästa ordinarie OCR-körning efter lyckad exakt-main Payment push-CI. Bind event/head och terminalt jobb till antal, tidsåtgång och efterföljande normal läsande heartbeat-/köobservation. Behåll ordinarie urval.

**Möjlig generell förbättring, inte genomförd:** om ordinarie körningar återkommande förbrukar sex OCR-leaser med kvarvarande eligible kö och tidsmarginal, inför senare en dokumenterad bounded batchparameter tillsammans med kontroll av återstående väggtid före nästa lease. Separata server/OCR-räknare och stopporsak (tom kö, antal eller tidsbudget) behövs för att mäta detta. Prioritet, auth, cadence och samtidighet ska bevaras.

Sanerade API- och loggobservationer finns i [OBSERVATIONS.json](OBSERVATIONS.json). Exakta källfilers SHA-256 finns i [SOURCE-REFERENCES.json](SOURCE-REFERENCES.json). Checkpointen tillför endast dokumentation.
