# Oberoende granskning av dokumentarbetarens IPC-gräns

Datum: 2026-11-06. Bedömare: bankspåret, som inte författade workerfixen eller dess ursprungliga tester.

**Bedömning: inga blockerande fynd identifierade i den avgränsade produktdiffen `f5d178ea816d276457685fbc0421cf144f7cf655`.** Granskningen godkänner denna fel-/transportändring inom sitt scope; den är inget nytt OCR-kvalitetsprov, produktionskvitto eller tillstånd att kringgå ordinarie releasegrindar.

## Fryst källa och metod

Basen är exakt merge `24390ef7e8cf6b2274c57804dc9c2d74d362ab12`. Producentens frysta testcommit är `6cba09889f4ecb7c5be3e3a14820fbecbe09f02c`; produktfixen är `f5d178ea816d276457685fbc0421cf144f7cf655`. Senare dokumentationscommit i producentens arbetskopia ändrar inte de granskade produktfilerna.

Granskaren läste hela produktdiffen i `src/invoice-extraction.js` och `src/invoice-worker.js`, producentens frysta test och dess child-helper. Därutöver skrevs tolv egna små transportprober, frysta före körning. Samma probe-bytes kördes mot basens riktiga `runDocumentProcess` och den rättade funktionen. Forkgränsen ersattes av en test-only EventEmitter; inget barn, OCR-anrop eller nätanrop görs av dessa egna prober. Basens modulkopia har oförändrade produktbytes och använder oförändrade beroenden från kandidaten.

Producentens tolv testfall kördes därefter om separat. Dessa startar faktiska barnprocesser och använder den riktiga worker-entrypointen med uttryckligt mockad Tesseract. Den syntetiska bildfixturen används endast för arbetarkontraktet; ingen verklig optisk OCR körs. Nätisolering var aktiverad. Inga nya holdoutbilder, texter, facit, prediktioner eller korpusresultat öppnades. Inga produktfiler ändrades av granskaren.

## Resultat

| Kontrollerad körning | Resultat | Tid |
| --- | --- | --- |
| Egna oförändrade prober på bas `24390ef7` | 2 pass / 10 fail, exit 1 | 294,852 ms |
| Samma egna prober på fix `f5d178ea` | 12/12 pass, exit 0 | 330,255 ms |
| Omkörning av producentens faktiska child-/mockdependency-svit | 12/12 pass, exit 0 | 7 503,038 ms |

Samtliga körningar har noll skip/cancel/TODO. Egna baselinefel gäller den tidigare saknade klassningen eller osäkra send-throw-vägen; positiva kontroller för bevarat framgångskvitto och backpressure passerar även före fixen. De två testmängderna är olika kontrollfall, inte 24 oberoende OCR-observationer.

Egna prober prövar `send()` som returnerar false utan fel, ett fullständigt kvitto följt av ett senare processfel, sendfel följt av ett sent påstått kvitto, synkront kast, felobjekt med privata texter och kastande getters, exit 0/7, SIGTERM, okända exit-/signalfält utan typkonvertering, den befintliga 90-sekundersbudgeten samt två samtidiga jobb/429 och återanvända platser. För varje fork kontrolleras även 256 MB-argumentet, advanced IPC-serialisering, privat stdio och oförändrad begränsad miljö.

## Granskade egenskaper

- Ett fullbordat workerresultats text, confidence, method och källbevis bevaras exakt vid cleanupfel. Endast den fasta diagnostikkoden `DOCUMENT_WORKER_CLEANUP_FAILED` tillkommer.
- Ett redan misslyckat tolkningsresultat behåller `error: true` även om cleanup också misslyckas. Inget tomt eller fabricerat framgångskvitto skapas.
- Barnets send-callback väljer exit 1 vid fel; synkront send-kast ger också exit 1. Förälderns start-, process-, send-, timeout- och exitfel avvisar utan att kopiera exceptiontext, stderr, dokumenttext, sökväg eller credentials.
- Exitkod begränsas till ett heltal och signal till operativsystemets fasta signalkatalog. Främmande typer konverteras inte till text. Det första avgörande utfallet bestämmer Promise-resultatet; ett sent påstått kvitto räddar inte ett redan avvisat sendförsök.
- `send()` som returnerar false behandlas korrekt som möjlig backpressure. Det är callback-/processutfallet som avgör, inte returvärdet ensamt.
- Timeout 90 sekunder, 256 MB V8-argument, maximal samtidighet två och 429 är oförändrade och prövade. PSM, språk, raster-/sid-/storleksgränser, parser och confidence-regler är byteoförändrade i den granskade diffen.

## Kvarvarande avgränsningar

Det tidigare konstaterade problemet var en cleanup-exception som kunde förhindra ett redan färdigt IPC-resultat. Detta innebär inte att de fyra av 19 tidigare blinda försöken hade den orsaken. Deras första utfall ska bevaras; inget avbrott omklassificeras som lyckad OCR av denna granskning. Ingen OOM-, signalfels- eller transport-raceorsak påstås utan särskild evidens.

Tesseract.js 6.0.1:s wrapper väntar inte på den underliggande Worker.terminate-promise:n. Fixen ändrar inte biblioteket eller inför en ny garanti om trådens fulla terminering. Förälderns timeout använder fortfarande vanlig kill utan ny eskalering eller väntan på faktisk exit. Start/import-/nativefel och verkliga resursfel kan fortfarande ske; den fasta diagnostiken förbättrar deras avgränsning. Dessa befintliga begränsningar är inte belägg för ett nytt fel i den granskade diffen.

## Kvitton och reproduktion

Produkt- och probe-SHA-256 kontrollerades oförändrade efter körning. [Fryst manifest](frozen-probes.json) binder källor och prober; [resultatmanifest](result.json) binder råloggar. Egna prober finns i [independent-parent-probes.mjs](independent-parent-probes.mjs). Råloggarna är [baseline](parent-red.tap), [fix](parent-green.tap) och [child-omprov](child-recheck.tap).

Egna prober kan köras mot en checkout med matchande låsta beroenden:

```sh
WORKER_REVIEW_TARGET_ROOT=/absolute/path/to/checkout NODE_ENV=test \
  node --import ./scripts/saas-test-isolation.mjs --test --test-concurrency=1 \
  --test-reporter=tap docs/completion/worker-review/independent-parent-probes.mjs
```

Child-omprovet kördes från producentens checkout:

```sh
NODE_ENV=test node --import ./scripts/saas-test-isolation.mjs --test \
  --test-concurrency=1 --test-reporter=tap test/document-worker-boundary.test.js
```

Den tillfälliga beroendelänken i producentens checkout togs bort efter körning; arbetskopian var ren. Granskaren har inte gjort någon ny bred svit-, build- eller produktionskörning. Dessa slutgrindar ägs av integrationsansvarig.
