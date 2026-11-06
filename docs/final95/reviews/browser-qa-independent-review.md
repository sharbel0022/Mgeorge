# Oberoende granskning av browser-QA

2026-11-06. Granskad källa: `70534d737bfe79ccb180e5dae96b3781048a493a`, med samma dashboard-runner som lokala `a49eeb2`. Runnerns SHA-256 är `83132eeea3cedf0bd3eaa58f05c7a62fcd5552f41a6079a5d7c0a0b92c97bbff`.

Scope: `scripts/quality/dashboard-browser.mjs` och ändringarna i `browser.mjs`, `run.mjs`, `workspace-browser.mjs`; tillhörande bundle-/HTTP-fixturekod lästes för att bedöma bevis och nätverksgränser. Inga repositoryfiler ändrades och ingen riktig browser/server startades av granskaren. Root rapporterade lokal socket-EPERM och pågående CI; detta ersätts inte av ett påhittat lokalt browserresultat.

## Fynd som bör rättas

### P2: Cleanupfel kan avbryta serverstädning och körkvitto

I dashboard-runnerns yttre `finally` ligger `await browser.close()` före serverns SIGTERM och före `writeJson`. Om browserstängningen kastar körs inget av de senare stegen. Serverns exitväntan är dessutom obegränsad efter SIGTERM.

Det första felet reproducerades genom att exekvera **exakt den lästa finally-kroppen** med syntetiska browser-/serverstubs. När `browser.close` avvisades blev serverkill-anrop **0** och skrivna receipts **0**. Detta är en kontrollflödeskontroll, inte Chromium-acceptans. Utfallet finns i `browser-qa-review-probes.json`.

Rätta med oberoende cleanupsteg: fånga stängningsfel i `runnerErrors`, säkerställ att servern fortfarande avslutas, begränsa väntan med TERM följt av KILL vid behov och skriv slutkvittot även om cleanup misslyckas. Ett cleanupfel ska ge ett rött kvitto och får inte försvinna bakom lyckade scenarier. Överväg samma robusthet i workspace-runnerns liknande avslutning.

### P2: Kvittot kräver en godkänd asset, men inte faktiskt laddad CSS/JS

Nuvarande slutvillkor är `assetChecks.length > 0` och att befintliga poster matchar. Enbart en godkänd `index.html`-post kan därför uppfylla assetvillkoret trots att inget receipt visar `app.css` eller `app.js`.

En syntetisk kontroll av exakt samma slutvillkor, med 31 godkända scenarier och endast HTML-asseten, gav `passed=true`. Det visar en lucka i bevisvillkoret; det är inte ett påstående att alla verkliga UI-scenarier skulle passera utan CSS.

Kräv uttryckligen observerade hashmatchningar för **`index.html`, `app.js` och `app.css`**, helst per scenario. Behåll kontroll av alla övriga observerade manifestassets. Då styrker kvittot det uttalade påståendet om faktiskt laddad produktions-CSS, utöver bundlefilernas hashbindning på disk.

## Kontroller som håller

- **Inga assertions försvagades.** Företagsbytesfallet använder nu den faktiska `Aktivt företag`-kontrollen och kräver exakt en sådan samt noll äldre `Välj företag`-kontroller. Kontrollerna av tidigare företagskontext, payload, en mutation och frånvaro av det gamla företagets referens kvarstår.
- **Nya scenarier är substantiella.** De 31 dashboardfallen täcker fem viewportbredder, fyra huvudsidor, native tangentbord/fokus, touchmeny, referenssökning med inledande nollor, osäkert betalningsbevis, laddning/fel/tomlista och explicit retry. Ofullständigt medgivande får inte visas som aktivt.
- **Samlad grind kan inte bli grön om en del misslyckas.** `browser.mjs` behåller onboarding-/workspacekraven och kräver sex godkända bygg-/browsersteg samt godkänt dashboardkvitto. Saknat dashboardresultat är fail. `run.mjs` för vidare dashboardfel och runnerfel.
- **Källbindningen är verklig.** Bundleharnessen kompilerar de riktiga Dashboard-, BankPage- och CompanyWorkspace-modulerna. Dess sex CSS-källor motsvarar samtliga CSS-importer i verkliga `sites/app/layout.tsx`. Produkt-/harnessinputs och bundlebytes hashkontrolleras före/efter. Den yttre grinden fångar också ändrad commit eller innehållshash över alla spårade och icke ignorerade filer.
- **Ingen verklig provideråtkomst ingår.** Runnerns HTTP(S)-route tillåter endast den egna loopbackoriginen; service workers blockeras. Andra API-mutationer än den uttryckliga syntetiska auto-sync-noop:en avbryts och gör körningen röd. Servern har ingen upstreamproxy, binder 127.0.0.1, kontrollerar Host/Origin, blockerar utgående HTTP/TLS/fetch och returnerar en restriktiv CSP. Auto-sync-fixturen ändrar inga ekonomiska data.
- **Hemligheter är avskilda.** Barnservern får den begränsade testmiljön. Begärandeloggen utelämnar query, cookies, request body och godtyckliga headers. Browserkontexten skapas separat för varje scenario.

## Slutsats

UI-testernas assertions och huvudsakliga säkerhets-/källbindning är goda. Åtgärda de två avgränsade kvitto-/cleanupfynden och låt den exakta slutkällan passera CI-browsergrinden. Granskningen verifierar kodkontraktet; först ett faktiskt grönt Chromium-kvitto visar att alla 77 planerade scenarier har körts. Backendautentisering, riktiga företag, provideranslutningar och produktion täcks fortsatt inte av denna syntetiska browserharness.
