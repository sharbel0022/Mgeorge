# Aktuell browseracceptans — integrerad recoverykod

Datum: 2026-11-06. GitHub-head `cc926f25568eaca0c740377fa8cf7f7d11dfb734`; faktisk Actions-checkout `18c7e3d8e090b132013b56fbbdd3833674303187`; identiskt Git-träd `9763b8ecb80cc2cfb7eebda27c31b3c1f44071f6`.

[Payment CI 42218258243](https://github.com/sharbel0022/Mgeorge/actions/runs/42218258243), browserjobb `127893582050`, artefakt `13502526660`. ZIP SHA-256 `f97efacb3dc715b044f38f3e2789431a362bd0a13bcb5bdf7833215772be3383`, 5 295 115 byte. Arkivets digest jämfördes före lokal uppackning.

## Faktiskt resultat

Chromium `151.0.7922.34`: **77/77 PASS**, inga fail, cancel, skip eller TODO. Fördelning: 41 onboardingfall, 5 företags-/workspacefall, 31 dashboardfall. Browserns produktionskomponenter och CSS byggdes från den exakta källan ovan. Hela körningen rapporterar 0 externa requests, 0 browserfel och oförändrad källmanifest. Manifestet omfattar 2 190 filer, SHA-256 `0aa902d5c873cb218f094d95da611450f48d130a2817c012be986bae7ccdf6b0`.

Dashboardens 31 fall har var för sig `assetsVerified=true`: rätt index.html, app.js och app.css hämtades med förväntade SHA-256. Det räcker alltså inte att någon annan testsida laddade en enda korrekt asset. `runnerErrors=[]`; browser- och serveravslut ingår i den begränsade, granskade cleanupvägen.

20 geometrifall täcker översikt, kundfakturor, inbetalningar och granskning vid 320, 390, 768, 1024 och 1440 px. Ytterligare 11 resor täcker referenssökning med nollor, Enter/Escape och fokusretur, fakturafilter/reset/leverantörsvy, betalare och referens utan falsk betalstatus, granskning/back på mobil, loading/error/empty, 503 med uttryckligt återförsök, touchmeny samt okänd och utgången consent-giltighet.

## Manuell visuell läsning av sparade skärmbilder

Huvudagenten öppnade bilder direkt ur den verifierade artefakten:

- `dashboard-24-320.png`: granskningslistan efter Back på 320 px. Etiketter, belopp, filter och tre granskningsärenden är läsbara; saknat underlag är tydligt och ingen horisontell klippning observerades.
- `dashboard-23-1440.png`: inbetalningsdialog på 1440 px. Betalare okänd, fakturanummer som möjligt förslag och saknad bank-OCR visas separat. Den blockerade relationen och nästa granskningssteg är tydliga. Beloppet på den ekonomiska bankposten blir inte i sig verifierat fakturabetalningsbevis.
- `dashboard-30-390.png`: bankanslutning på 390 px. Okänd giltighet visas som inte bekräftad, status kräver förnyelse och återanslutningen är en uttrycklig användaråtgärd. Den syntetiska legacy-installationens begränsning för ny företagsregistrering visas öppet.

Svartvit presentation, kontrastmarkeringar, fokus och hierarki är bevarade. De automatiska geometrimåtten och de manuellt lästa bilderna stödjer den här avgränsade acceptansen; de är inte en formell WCAG-/skärmläsarcertifiering eller fysisk telefongranskning.

## Verifieringens gräns

Detta är en riktig Chromium-browser med syntetiska, isolerade HTTP-fixtures. Riktiga Dashboard- och CompanyWorkspace-komponenter används. Begäran och svar kontrolleras, ekonomiska mutationer blockeras och automatisk synk har en uttrycklig fixture-noop. Testerna är inte en ny autentiserad backend-/BankIDresa eller en verklig betalning. Exempelbanken, företag, referenser och belopp i bilderna är testdata och har inte lagts in i produktion.

Separat försök i den tillgängliga produktionsbrowsern nådde den offentliga inloggningssidan men kunde inte fullfölja autentiserad navigering på grund av verktygets DOM-timeouter. Lokalt Chromium-startförsök stoppades av processmiljöns socketbehörighet före några assertions. Båda begränsningarna är dokumenterade; de räknas inte som godkända produktionsresor. Ingen åtkomstkontroll kringgicks.

Det första CI-försökets 45/46 med gammal företagsväljare behålls som misslyckat. Fixen använder den enda faktiska globala väljaren och behåller samtliga kontroller av tidigare/nästa företagskontext, request och rensning av gamla data. Följande 77/77 på `70534d7` och detta 77/77 efter cleanup-/asset-härdningen är separata fullkörningar, inte 154 unika produktfall.
