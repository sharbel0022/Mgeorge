# Mgeorge V2 leverans och verifiering

Kontrollerat den 28 oktober 2026. Leveransen utvecklar den befintliga ekonomiarbetsytan och publiceras i samma Sites-projekt. Bankreferenser bevaras med ursprung, osäkra betalningar kräver granskning och ekonomiska belopp ändras bara genom befintliga transaktionssäkra kommandon.

## Utgångspunkt och omfattning

Arbetet utgår från GitHub `main` på `3a37c3b` och publicerad Sites-version 26. Senaste `main` hämtades före ändringarna. Befintliga förbättringar av ekonomiöversikt, dokumentklassificering, Gmail och avstämning ingår därmed även i Sites-leveransen. De två påbörjade lokala ändringarna för dold Windows-OCR-start har bevarats och ingår.

Genomgången omfattar affärslogiken i `src/`, `sites/lib/`, API-rutter, datamodeller, bakgrundsjobb, gränssnitt, migreringar, integrationer och CI. Befintliga dokument beskriver även historiska leveranser; de är inte aktuella testresultat. Genererade komponentbibliotek granskas genom typkontroll, bygg och beroendegranskning.

## Verifierade fel och åtgärder

| Plats | Verifierat problem och användarpåverkan | Genomförd lösning | Verifiering |
| --- | --- | --- | --- |
| `src/importers.js`, `sites/lib/banking/transactions.ts` | Ett utvalt referensfält gjorde att andra uttryckliga OCR- och fakturanummer föll bort. | Gemensam, begränsad extraktor med kandidater, prioritet, fältsökväg, kontrollsiffra och ofullständighetsmarkering. | Referenstester för bankfält, nästlade objekt, arrayer, meddelanden, saknade värden och konflikter. |
| `src/db.js`, `sites/lib/domain.ts` | Ursprungliga API-fält sparades inte i sin fullständiga struktur. Det försvårade kontroll i efterhand. | Oförändrad kopia av transaktionsobjektet och extraktionsresultatet sparas med posten. Tidigare poster kan kompletteras med första tillgängliga original utan ändrade belopp, referensfält eller ID:n. | Databastester, domäntester och dubblettimport med förändrat providersvar. |
| `src/importers.js` | CSV behöll ett referensfält; camt valde en strukturerad referens framför andra underlag. | Samtliga stödda referenskolumner, upprepade kolumner, `CdtrRefInf`, `RfrdDocInf` och ostrukturerad information bevaras med källväg. Originalfilen behålls separat. | CSV- och camt-regressioner. |
| `sites/lib/imports.ts` | Mappad CSV tappade andra uttryckliga referenskolumner efter förhandsgranskningen. | Referenskandidater följer bankfilen till det sparade, autentiserade filunderlaget. | Typkontroll och import-/domäntester. |
| `sites/lib/banking/detail-evidence.ts` | Det separata detaljsvaret letade bara efter ett toppnivåfält. | Samma extraktor används även i detaljsvaret; kandidater och källor visas separat från fakturakopplingen. | Nästlad OCR i detaljsvar; oförändrad samlingspost och noll allokeringar. |
| `src/reconciliation.js`, `sites/lib/reconciliation-engine.js` | Flera alternativa referenser kunde inte gemensamt kontrolleras mot fakturorna. | Regelversion `verified-reference-2026-10-28.2` jämför uttryckliga kandidater och ursprunglig referens. Konflikter, ogiltig uttrycklig OCR och ofullständig extraktion spärrar automatik. | Samma belopp på flera fakturor, reglerad faktura, okänd referens, felaktig OCR och ändrade senare referenser. |
| `src/db.js` | Samma stabila bank-ID med annat datum stoppades inte generellt. | Datum, belopp och valuta måste överensstämma; hela importen återtas vid konflikt. | Atomisk rollback med flera rader och befintligt original. |
| `sites/app/dashboard.tsx` | Leverantörer låg under kundfakturornas huvudval. Bankvyn öppnade med ett filter som kunde ge tom lista trots sparade betalningar. | Fem efterfrågade huvudområden, separat diskret inställningsval och alla bankposter som standard. Fullständiga bankfält och referenskällor kan öppnas i detaljen. | Lokal desktop- och mobilgranskning med fiktiva uppgifter. |
| `sites/package.json`, `sites/package-lock.json` | Beroendegranskning hittade bland annat kritiska Next.js-problem och sårbara server-/byggberoenden. | Samordnad uppdatering av Next, React, Vinext, Vite, Cloudflare, Zod och relevanta underberoenden. Miniflare-testet använder den nya officiella V4-konverteringen. | Fullständig `npm audit`, TypeScript, produktionsbygge och riktig lokal Workerd-PDF-tolkning. |
| `.github/workflows/expand-source.yml` | En manuellt startad gammal importworkflow kunde skriva äldre arkivfiler över nuvarande kod och pusha dem. | Workflowen har tagits bort. Historiskt källarkiv finns kvar i Git. | Diffgranskning; ordinarie CI testar båda apparna och granskar beroenden på huvud- och arbetsbrancher. |
| `src/backup.js`, `scripts/backup.mjs`, `src/server.js` | JSON-registerexport var inte en komplett återställningskontrollerad SQLite-backup. | Konsistent SQLite-snapshot inklusive WAL, AES-256-GCM, separat nyckel, integritetskontroll och exklusiv återställning till en ny databas. Valbar daglig körning med återförsök. | Testad återställning av faktura/originalregister, manipulerad backup, fel nyckel, överskrivningsspärr och Stockholms dygnsgräns. |

## Referenser och matchningsbeslut

Extraktorn behandlar endast uttryckliga relevanta fältnamn och faktura-/OCR-märkta meddelanden som identitetskandidater. Bankens arkiv-ID, kontonummer, eget Bankgiro, datum och belopp omtolkas aldrig till kundens OCR. Okända strukturer finns kvar i bankoriginalet även när de inte kan tolkas säkert. Säkerhetsgränser stoppar ofullständig analys från automatisk matchning.

Giltig uttrycklig OCR-kontrollsiffra prioriteras, därefter strukturerad referens, fakturanummer och fri referenstext. Inledande nollor och betydelsebärande skiljetecken bevaras. Modulus-10-kontroll är inte bevis för att företagets avtalade längdkontroll är uppfylld. Ett fakturanummer som `0599` får användas som fakturanummer utan att påstås vara ett giltigt OCR-nummer.

Automatik kräver dessutom rätt riktning och valuta, granskningsklar faktura, bokfört underlag, entydig faktura, verifierad betalare och kontrollerat saldo. Flera kandidater får bara stödja samma faktura; okända eller motstridiga uttryckliga referenser kräver granskning. Beloppslikhet ensam är aldrig betalningsbevis. Flera fakturor i samma betalning, möjliga dubbelbetalningar, samlingsposter och återbetalningsundantag följer den befintliga konservativa hanteringen. Manuell verifiering sparas separat från bankoriginalet.

Reglernas källunderlag: [Bankgirots OCR-kontroll](https://www.bankgirot.se/tjanster/inbetalningar/bankgiro-inbetalningar/ocr-referenskontroll/) och [Enable Bankings transaktionsschema och detaljtjänst](https://enablebanking.com/docs/api/reference/).

## Funktionsstatus

| Funktion | Kod | Verifiering och driftförutsättning |
| --- | --- | --- |
| Referenskandidater och bevarade API-original | Implementerat i båda apparna | Syntetiskt testat; gamla underlag skrivs inte om till påhittade rådata. |
| Säker avstämning och revisionsspår | Implementerat | Automatiska och manuella kommandon, rollback, återimport och återtag testade. |
| Del-/överbetalning, dubbletter och flera fakturor | Implementerat | Osäkra fördelningar kräver granskning. Automatisk kvittning mellan separata kredit- och debetfakturor ingår inte. |
| Gmail OAuth, bilagor och fakturatolkning | Befintlig funktion vidareförd | Mockade integrationstester och lokal PDF/OCR. Verklig kontobehörighet krävs. |
| Kund- och leverantörsöversikt | Implementerat | Svartvit, responsiv arbetsyta. Belopp utan färdig dataladdning visas som okända. |
| Bakgrundssynkronisering | Befintlig funktion | Node behöver köras. Sites har sparad stegstatus och separata scheduleranrop; befintliga molnscheman är pausade och återaktiveras inte av kodpublicering. |
| Krypterad daglig Node-backup | Implementerat och återställningstestad | Aktiveras med separat `MG_BACKUP_KEY` och skyddad `MG_BACKUP_DIRECTORY`; servern måste vara igång. |
| Komplett D1/R2-backup av Sites | Driftåtgärd återstår | JSON-export innehåller inte alla R2-original. Säkerhetskopiering och återställning måste samordnas med Sites driftåtkomst. |
| Företagets faktiska Bankgiro-OCR när API saknar uppgiften | Externt underlag krävs | Individuell Bankgirospecifikation eller avtalad bankrapport behövs. En möjlig faktura med samma belopp räcker inte. |
| Helt obemannad produktion och nya bank-/Google-medgivanden | Ej verifierat i denna leverans | Kräver giltiga avtal, samtycken, tillgänglig OCR-dator och kontrollerad schemakörning. |

## Säkerhet och kvarvarande begränsningar

Sites bevarar befintlig åtkomstpolicy, autentisering, användaravgränsning, D1/R2, domän och runtimehemligheter. En publik webbadress innebär inte att ekonomiregistret lämnas ut utan inloggning. Inga verkliga bankbetalningar initieras och huvudkontrollen skickar inga kundmejl.

Node har en administratör; separata finfördelade organisationsroller är inte införda. SQLite-register och fakturaunderlag är inte objektkrypterade i den aktiva databasen; backup- och tokenkryptering ersätter inte skyddad dator, disk och lagring. Sites behåller den befintliga gränsen på 1,8 MB arbetsytedata; en för stor import stoppas utan tyst kapning av rådata. Fortsatt volymökning behöver flytta fler bankoriginal till separat objektlagring.

Tester använder fiktiva kunder och styrda leverantörssvar. Ett grönt bygge bevisar inte att Swedbank lämnar individuella OCR-uppgifter för företagets konto eller att ett nytt BankID-/Google-medgivande är godkänt. Nya produktionshämtningar, betalningsmatchningar och kundutskick används inte som testdata.

## Testresultat och leveransbevis

De slutliga testantal, källcommit, Sites-version och publiceringsstatus förs in i `docs/V2-PUBLICATION.md`. Arkitektur och faktiska UI-bilder finns i [V2-ARCHITECTURE.md](V2-ARCHITECTURE.md). Handhavande och driftkonfiguration finns i [V2-OPERATIONS.md](V2-OPERATIONS.md).
