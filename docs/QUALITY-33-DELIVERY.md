# MGEORGE QUALITY REPORT — 30 oktober 2026

## Leveransens omfattning

Denna körning genomför flera analys-, reproduktions-, rättnings- och granskningscykler mot användarens 33 kvalitetsområden. Ekonomisk korrekthet, bevarade original och ärlig driftstatus prioriteras. Slutliga publiceringsidentiteter och läsande efterkontroller kompletteras nedan efter faktisk publicering.

**Kodkontrollerna godkänner den här avgränsade leveransen. Hela målet om 9,5/10 i alla 33 områden är inte uppnått.** Den fullständiga bedömningen finns i [QUALITY-SCORECARD.md](../QUALITY-SCORECARD.md). Saknat bankoriginal, företagsavtal och faktisk driftverifiering ersätts inte med syntetiska tester.

Basen är `origin/main` **b5a25e72a5ac24e4f796d4d1c2c12fd157be554a**, kontrollerad igen före integration. Arbetsbranch: `codex/quality-33-20261030`. Befintlig Sites-källa öppnades med projektets ordinarie källflöde; samtliga 263 ursprungliga spårade filer överensstämde med basens `sites/`.

## Rättade ekonomiska fel

### Banktypen måste stödja fakturabetalning

En bankrörelse med plausibelt namn och OCR kunde tidigare automatmatchas trots en uttrycklig beskrivning som återbetalning, återföring, kortköp, kontantuttag, lön eller överföring mellan egna konton. Båda motorerna behåller nu sådana fall för granskning. Vanliga entydiga fakturabetalningar fungerar fortfarande. Klassificeringen använder även bevarad beskrivning, kompletterande banktext och relevanta råfält; en senare manuell anteckning får inte dölja ursprungstypen.

Evidens: `test/node-payments-quality-cycle.test.js`, `sites/tests/sites-payments-quality-cycle.test.mjs`. Beloppslikhet används inte som bevis för betalare eller OCR.

### Ett stabilt bank-ID gör inte nya motstridiga uppgifter ofarliga

Återimport med samma bank-ID men ändrat namn, referens, datum, belopp eller betalningsriktning kan inte längre lämna den första raden automatiskt betrodd. Konflikten sparas separat från originalfakta och tidigare betalningskopplingar. Den syns i granskningskö och status och spärrar nya kopplingar. Node känner även igen en försämring från vanlig referens till ogiltig OCR med oförändrat textvärde, eller nytillkommen ofullständig referensanalys.

Konflikter i en samlingspost gäller dess underlag och delbetalningar. I Node följs föräldrar även när de har undantagits därför att kompletta detaljer ersatt dem. En konflikt i en tidigare koppling får inte lära systemet en betalarrelation som används för att betala nästa faktura.

Den oberoende granskningen reproducerade att en tidigare konflikt försvann när en senare rad avbröt hela importen. Node bevarar nu alla redan observerade konflikter mot befintliga rader efter återställning av importtransaktionen. Även ett senare fel i specifikationens totalsumma täcks. Upprepade försök skapar inte dubbla konflikt- eller revisionsposter.

Evidens: 30 fokuserade Node-fall, inklusive sex nya fall som först misslyckades; Sites motsvarigheter; 19 Node-dialogtester som också verifierar att spärrade betalningar saknar godkännandeknapp. Befintliga kopplingar raderas eller räknas inte om av spärren.

### Samlingsbelopp får inte förbrukas igen

Node kontrollerar alla detaljbetalningar mot samlingspostens belopp, konto och valuta inom importtransaktionen, även när samlingsposten redan är undantagen och när underlagen kommer i olika ordning. Den motsvarande andra-rapport-attacken var redan blockerad i Sites; en ny regression låser detta beteende. Det felaktiga andra underlaget förblir granskningsbart i stället för att dubbla ekonomin.

### Originalet kontrolleras vid den faktiska Sites-kopplingen

En tidigare kodväg kunde göra en automatisk koppling utifrån sparad importmetadata utan att läsa det bevarade originalet. Ett negativt API-test visade HTTP 200, noll originalläsningar och ett fakturasaldo som felaktigt gick från 62 500 öre till noll när originalet saknades.

Den nya gränsen i `sites/lib/reconciliation-evidence.ts` kontrollerar dokumentets ägare, R2-objektets existens, deklarerad och faktisk storlek, SHA-256 och importens förväntade hash. Den omfattar automatisk avstämning, jämförelseförhandsvisning samt manuell verifiering, uppdelning och koppling. Även samlingspostens original och original som stöder en inlärd betalarrelation kontrolleras.

Kontrollen upprepar kandidatbedömningen när en spärr förändrar vilka betalningar som är entydiga. Därmed kan en nytillkommen kandidat inte kringgå kontrollen efter att en felaktig betalarrelation tagits bort. Hypotetiska kopplingar sparas inte. Varje transaktion granskas högst en gång per begäran, och läsningarna delar en cache med gräns på 32 original och 64 MB. Ett saknat eller skadat original ger en synlig, reviderbar tillgänglighetsspärr. Rätt återställt original kan häva just denna spärr och möjliggöra en enda koppling.

Evidens: `sites/tests/bank-original-quality-cycle.test.mjs`, verklig route mot isolerad databas/objektlagring, positiva och negativa fall, förhandsvisning utan skrivningar och regressionen `removing an unavailable payer link cannot release another unchecked original`. De två nya Sites-banksviterna innehåller tillsammans **21 godkända fall**.

### Översikten använder samma försiktighet som banklistan

Manuellt inmatade namn och referenser i äldre originalögonblicksbilder får inte visas som banklevererade uppgifter. Konfliktspärrade, originalspärrade eller otillräckligt verifierade filbetalningar räknas inte in i verifierade månadsinbetalningar eller listan över nyligen verifierade betalningar. Den befintliga betalningskopplingen och fakturans redovisade saldo bevaras; översikten räknar och visar att kopplingen behöver verifieras.

Evidens: `sites/tests/economy-quality-cycle.test.mjs`, **7/7**, sex av dem reproducerade tidigare fel; befintlig översikts- och UI-svit. Den positiva UI-fixturen anger nu uttryckligen bankkälla för sitt syntetiska banknamn.

## Fakturor, Gmail och dokument

- En giltig förekomst av datum, organisationsnummer, Bankgiro eller belopp får inte dölja en annan uttryckligt märkt ogiltig förekomst. Ogiltiga datum, kontrollsiffror, för långa tal och felaktiga beloppsformat kräver granskning.
- Svensk och engelsk fakturamärkning i filnamn och mejlrubrik tolkas konsekvent. `0594` förblir skilt från `594`; bokstäver och skiljetecken i `North-0594` bevaras. Filnamn och rubrik kan skapa en konflikt även när dokumenttextens nummer inte går att tolka.
- Osäkra underlag med fakturatecken behålls trots rubriker om påminnelse, kvitto, lön eller villkor. Gmail filtrerar tydligt identifierad inbäddad dekoration; ett oklart fristående `logo.png` kastas inte bort enbart på grund av namnet. Ett uttryckligt bilageattribut har företräde framför Content-ID.
- Node kräver tidigare uttrycklig mänsklig granskningshistorik, kompatibel motpart och Bankgiro samt tillgängliga moms-/nettobelopp för automatisk registrering. Enbart en äldre rad med samma leverantör räcker inte. Kraven kontrolleras igen inne i skrivtransaktionen.
- Originalets hash och storlek kontrolleras före betrodd tolkning/registrering. Sites server-PDF-väg kontrollerar nu R2-bytes före extraktion. Nya Node-tolkningar sparas även i revisionshistoriken, så tidigare tolkningar inte försvinner.

Evidens: `test/document-quality-cycle.test.js` **32 fall** och `sites/tests/document-quality-cycle.test.mjs` **31 fall**, plus befintliga Gmail-, extraktions-, PDF- och OCR-sviter. Dessa är syntetiska regressioner; precisionen för företagets verkliga layoutvariationer är fortfarande inte kvantifierad.

## Driftstatus och användarflöde

Gmails läsande MCP-status hämtar nu en begränsad sammanfattning utan dokumentkroppar eller hela arbetsytans fakturor. Ett statusanrop initierar inte dokumentautomatisering. Autentisering, frånvaro av tokens/dokumenttext och begränsad svarsstorlek testas.

Status skiljer frånkopplad, pausad, blockerad, väntande, saknad verifiering, gammal och nyligen lyckad hämtning. En framtida tidsstämpel godtas inte som framgång. För ett inställt intervall på 60 minuter betraktas en lyckad hämtning äldre än 120 minuter som gammal. `schedule_verified: false` är avsiktligt: programmets konfiguration bevisar inte att ett externt schema faktiskt är aktiverat. Ett beständigt `status='blocked'` visas som blockerat. UI visar också ett konkret fel när status inte kan hämtas.

Browserkontrollen använde den stödda lokala Sites-förhandsvisningen och en verklig Chromium-webbläsare med syntetiskt demoläge. CSS-vyer på **320, 390, 768, 1024 och 1440 px** kontrollerades i en lokal iframe. Översikten hade fyra sammanfattningskort och en huvudknapp vid varje bredd; varken översikt eller bankvy hade horisontell dokumentöverströmning. Sökning på faktura 1003 gav en bankrad; filtret för saknad specifikation gav samlingsposten. Mobilens native dialog var 370 px bred i 390 px vy utan inre horisontell överströmning.

Enter öppnade betalningsdialogen och Escape stängde den. Ett faktiskt fokusfel reproducerades även utanför iframen: stängning lämnade fokus på BODY. Rättningen återför fokus till den öppnande knappen. Efterkontrollen visade rätt knapp och en synlig solid fokusram på 3 px. Den lilla React-effekten granskades separat.

Bevis: [UI-mätningar](screenshots/quality-33/ui-verification.json), [översikt](screenshots/quality-33/overview-desktop.jpg), [mobil dialog](screenshots/quality-33/payment-detail-mobile.jpg) och [tangentbordsfokus](screenshots/quality-33/bank-keyboard-desktop.jpg). Skärmbilderna innehåller bara demodata. Den tillfälliga testinramningen ingår inte i leveransen.

Begränsningar: dessa är CSS-vyer i Chromium, inte fysiska enheter eller fullständig skärmläsar-/flerwebbläsarcertifiering. Mobilmenyns pekarsekvens blev inte slutligt verifierad. Shift+Tab kunde lämna testiframen; ett fullständigt fokusprov för alla dialogvarianter återstår. Dessa delar markeras inte som godkända enbart på grund av breddmätningen.

## Samlade kontroller

| Kontroll | Ren bas | Slutlig programkod |
|---|---:|---:|
| Root `npm test` | 312/312 | **377/377**, inga fel eller överhoppade |
| Sites `npm test` | 394/394 | **456/456**, inga fel eller överhoppade |
| Root `npm run check` | Godkänd bas | **63 JavaScript-filer godkända** |
| Sites `npm run check` | Godkänd bas | **Godkänd efter sista fokusändringen** |
| Root `npm audit --json` | 0 kända sårbarheter | **0 i samtliga allvarlighetsgrader**, även utvecklingsberoenden |
| Sites `npm audit --json` | 0 kända sårbarheter | **0 i samtliga allvarlighetsgrader**, även utvecklingsberoenden |
| `git diff --check` | Rent | Godkänt |
| Sites produktionsbygge | Befintligt bygge | **Godkänt, exit 0, Build complete** |

Totalt **833 godkända tester**, jämfört med 706 i den separat körda rena basen. Lokal Node-version: 24.22.1; GitHub Actions använder Node 22 och verifieras separat efter push. Installationerna `npm ci` och Sites `npm run install:ci` genomfördes. Inga paketversioner eller låsfiler ändrades.

Den hanterade miljön krävde tillåtelse för lokala testsockets och nätverk. De initialt nekade miljökörningarna räknas inte som godkända tester. I samma miljö reproducerades att två shellskript försökte exekvera varandra trots filmode 100644. De använder nu uttryckligen `bash`, och produktionsbygget körs med den stödda Sites-profilen.

De fullständiga sviterna omfattar API/autentisering, ägaravgränsning, CSRF, krypteringsintegritet, lås/revisioner, samtidiga processer, avbruten import och återförsök. `test/backup.test.js` återställer syntetisk SQLite med WAL-data till en separat databas och avvisar fel nyckel/skadad ciphertext. `sites/tests/backup.test.mjs` återställer syntetisk databas och original isolerat, avvisar fel ägare/nyckel/skadade eller saknade original och testar återupptagning/lease-fel. Ingen produktionsåterställning utfördes.

Oberoende granskning mot bascommitten godkände den avgränsade slutdiffen utan kvarstående Critical/Important-fynd. Granskaren reproducerade och följde rättningen av referenskvalitet, ärvda konflikter, rollback av konfliktbevis, översiktsproveniens, betalningstyper och den sista originalkontrollens kandidatslinga. Detta är kodgranskning, inte en fullständig säkerhetsrevision eller produktionscertifiering.

## Faktisk drift — läsande förkontroll

| Område | Observerad evidens 30 oktober | Vad det inte bevisar |
|---|---|---|
| Swedbank | Ansluten, automatisk hämtning aktiverad med sex timmars intervall, senast lyckad hämtning 14:09:57 UTC, inga rapporterade fel | Individuella Bankgirobetalare, företagets rapportprofil eller komplett fakturabetalningsidentifiering |
| Gmail | Ansluten; senast lyckad hämtning 29 oktober 15:00:48 UTC; det externa timschemat är **inaktiverat** | Att schemalagd Gmail-hämtning fungerar just nu |
| Moln-OCR | Konfigurerad; senast observerad worker 30 oktober 09:54:51 UTC; senaste lästa Actions-körning lyckades | Regelbunden körning var 15:e minut eller avslutad representativ OCR när användarens dator är avstängd |
| Backup | Dagens backup komplett, 191/191 original, 63 448 066 byte; verifierad 01:27:38 UTC | Oberoende återställning av dagens verkliga backup efter förlust av konto, hela lagringen eller krypteringsnyckeln |

Statusanrop och schemametadata är evidens från de anslutna tjänsterna. Inga kundoriginal eller tokenvärden har tagits in i repositoryt. Bank/Gmail/OCR/backup startades inte manuellt som publiceringstest; ingen verklig avstämning, kundsändning eller bankbetalning gjordes. Det observerade pausade Gmail-schemat behålls.

## Kvarstående arbete och exakt fortsättningspunkt

1. **P1, externt bankunderlag:** anskaffa ett behörigt individuellt Swedbankoriginal, företagets avtalade MIG/XSD/OCR-regel och leveranskanal. Följ `V4-SWEDBANK-CHANNELS.md`. Mappa rapportfält till nuvarande evidens, genomför en jämförelse utan saldoändring och granska facit. Gissa inte format eller avtal från XML-namespace.
2. **P1, originalkonflikter:** utveckla en uttrycklig, reviderbar lösningsprocess för motstridiga bankoriginal. Den nuvarande spärren är beständig; en fri anteckning får inte ta bort den. Processen måste bevara båda underlagen, verifiera konto/summa/referens och hålla tidigare kopplingar synliga.
3. **P2, Gmail och OCR:** klargör orsaken till det pausade externa schemat och återaktivera först med rätt instruktion. Verifiera tidsstämplar, checkpoints, felgränser och representativ moln-OCR över flera riktiga intervall. Automatregistrering måste fortsatt kräva dokumenterad motpartsgranskning.
4. **P2, autentiserad användning:** kontrollera de publicerade läsande vyerna och ett avgränsat godkänt flöde från underlag till granskning. Använd inte riktiga ekonomiska skrivningar för att göra en smoke-test grön. Kvantifiera OCR-fältprecision och undantagsandel på ett godkänt facitmaterial.
5. **P3, tillgänglighet:** slutför mobilmenyn, skärmläsare, fokusordning i alla dialoger och minst en andra webbläsare/fysisk mobil. Den verifierade fokusåterställningen behöver inte reproduceras som ny bug.
6. **P4, återställning:** genomför ett dokumenterat återställningsprov med godkänd säker åtkomst till en verklig backup i isolerad miljö och mät RPO/RTO. Behandla förlust av krypteringsnyckel eller backupkonto som misslyckad återställningsförutsättning. Utvärdera godkänd extern katastrofkopia utan ny betaltjänst eller nyckelrotation på eget initiativ.

Nästa körning läser `AGENTS.md`, `PROGRESS.md`, `QUALITY-SCORECARD.md` och denna rapport, hämtar aktuell main och kontrollerar dess faktiska publiceringsbevis. Den börjar med nästa olösta krav, inte med att upprepa redan avslutade reproduktioner. Ingen fortsatt bakgrundsutveckling har konfigurerats.

## Publicering och återgång

Föregående verifierade Sites-version **31** finns kvar som `appgprj_6adf2f7f7e848191b64192161886b528~appgver_b454b3b7ac20819192cc260b714f858b`, källcommit `de8f49f924b8afde4772cba814b300e4dc41399d`. Dess deploymentstatus kontrollerades som `succeeded` med runtime-revision **9** inför denna leverans.

Publicera i samma projekt `appgprj_6adf2f7f7e848191b64192161886b528` med befintliga D1-bindningen `DB`, R2-bindningen `BUCKET`, autentiseringsklient och domän. Sites-ändringen kräver ingen ny SQL-migration. Node använder en additiv konfliktkolumn. En eventuell kodrollback ska behålla data och nycklar; äldre kod saknar de nya spärrarna och bör därför bedömas innan återaktivering av automatiska flöden. Ingen destruktiv databasåterställning ingår i återgången.

Slutliga main-/Actions-/Sites-identiteter och efterkontroller läggs till här när de finns som faktiska resultat.
