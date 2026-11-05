# Agent 7 — säkerhet, dataskydd och driftsäkerhet

Datum: **2026-11-05**. Branch: `feature/95-security`. Granskningsbas:
`4ad205b84d1852ec7ed33cabd70fdadbe2f9d5c5` på `main`.

## Bedömning och leveransgräns

Den här PR:n förbättrar beständig inloggningsbegränsning, resursgränser för
inkommande förfrågningar, minimering av revisionsdata och verifieringen av
återställbarhet. Resultaten gäller koden och isolerade, syntetiska miljöer.
**Målet 9,5/10 är ännu inte styrkt.** Nyckelhantering i drift, aktuell fullständig
katastrofåterställning och organisationens dataskyddsprocess behöver separata
bevis innan en sådan bedömning eller kommersiell säkerhetsacceptans är rimlig.

Inga riktiga banker eller leverantörer har penetrationstestats. Ingen
produktionsdatabas eller originalfil har raderats, återställts eller ändrats.
Inga verkliga nyckelvärden, token eller kundunderlag har hämtats för testerna.
PR:n aktiverar inte bankanslutningar, scheman, utskick eller en ny release.

Historiska driftobservationer i [den tidigare integrationsrapporten](SAAS-MULTITENANT-BANKID-FINAL-REPORT.md)
behåller sina datum och begränsningar. De är inte nya driftbevis för denna PR.

## 1. Reproducerade brister och rättningar

### SEC95-01 — inloggningsspärren försvann vid omstart

**Allvarlighet: medelhög.** Node-serverns tidigare räknare låg i en lokal
`Map`. Fem felaktiga lösenord gav spärr i en process, men samma databas kunde
öppnas av en ny serverinstans och omedelbart tillåta nya försök. Flera instanser
hade dessutom separata budgetar. De första reproduktionerna gav 401 efter
omstart och två samtidiga 401-svar där den sista tillåtna platsen skulle delas.

`src/login-rate-limit.js` reserverar nu försöken atomärt i kontrollens SQLite-
databas. Policyn är fem försök inom 15 minuter för applikationens enda
administratörskonto. Kontrollen sker före läsning av en redan spärrad begäran;
reservationen sker före lösenordsverifieringen. Ett lyckat lösenord återställer
budgeten och den befintliga sessionsrotationen bevaras. HTTP 429 innehåller
återstående `Retry-After`; avvisade försök förlänger inte fönstret.

Lagringen omfattar bara en konstant kontoetikett, räknare och sluttid. Den
innehåller inte IP-adress, lösenord eller token, och `X-Forwarded-For` påverkar
inte budgeten. Kontospärr innebär en tillgänglighetsavvägning: en angripare kan
förbruka fem försök. Befintliga sessioner påverkas inte, men extern exponering
behöver även driftens trafikbegränsning och larm, se M2 nedan.

**Bevis:** `test/security-login-rate-limit.test.js` använder riktiga HTTP-
lyssnare och SQLite-anslutningar för omstart, konkurrerande instanser, förfalskade
forwardinghuvuden, exakt tidsgräns och lyckad inloggning. Fem nya fall, med
observerad RED/GREEN för de ursprungliga bristerna.

### SEC95-02 — storlekskontroll efter buffring av API-kroppen

**Allvarlighet: hög för tillgänglighet om stora anrop kan nå den exponerade
tjänsten; faktisk produktionspåverkan eller kapacitet har inte mätts.** Flera Sites-
vägar läste JSON/text helt innan storleken bedömdes. Företagsauktoriseringen
klonade dessutom kroppen för att välja rätt behörighet. Saknad eller falsk
`Content-Length` kunde därför kringgå en tidig resursgräns även när mutationen
senare avvisades.

`sites/lib/server.ts` begränsar nu den ursprungliga strömmen innan den kan
klonas. Faktiska byte räknas, även för UTF-8 och en felaktigt låg deklarerad
längd. Ogiltiga längdhuvuden avvisas. Läsningen startar först när en konsument
behöver kroppen; en anonym filbegäran ska inte läsas in bara för att nekas.

| Väg | Högsta kroppsstorlek | Samlad lästid från första läsning |
| --- | ---: | ---: |
| `/api/files` | 16 000 000 byte; befintlig separat filgräns kvarstår | 120 sekunder |
| `/api/state` | 1 500 000 byte | 120 sekunder |
| `/api/ocr-worker/complete` | 350 000 byte | 120 sekunder |
| Övriga muterande `/api/`-vägar och `/mcp` | 65 536 byte | 30 sekunder |

Storlek, timeout och strömfel ger fasta 413/408/400-svar. Intern feltext eller
kroppsinnehåll reflekteras inte. Auktoriseringen får inte svälja ett budgetfel
och fortsätta som om kommandot saknades.

**Bevis:** 14 nya fall i `sites/tests/security-request-budget.test.mjs` och ett
integrerat fall i `sites/tests/company-request.test.mjs` täcker strömmar utan
giltig längd, kloner, UTF-8, gränsvärden, timeout, avbrott och uteblivna
databasskrivningar. Under utvecklingen hittades också en faktisk regression:
avbruten, ännu oläst multipart i Node-fixturen gav ett asynkront streamfel.
Rättningen frigör den olästa läsarens lås utan att starta/avbryta upstream-
kodaren. Den kombinerade RBAC-/upload-/budgetsviten gav därefter 41/41.

### SEC95-03 — oanvända klientfält kopierades till revisionsloggen

**Allvarlighet: medelhög för dataskydd.** En lyckad state-mutation sparade
hela inkommande `command`. Extra fält som domänlogiken ignorerade kunde därför
bli beständiga i revisionshistoriken, exempelvis autentiseringshuvuden,
felsökningsdata och ovidkommande tokenfält i en importrad.

`sites/app/api/state/route.ts` bygger nu auditposten från accepterade
domänuppgifter och explicita projektioner per kommandotyp. Fakturor sparar
det normaliserade resultatet. Importer hänvisar till beständiga import-ID:n,
kontrollsummor, dokument-ID:n och antal; råa klientrader dupliceras inte.
Godkända granskningsanteckningar, återtagna matchningar och affärsreferenser
är fortfarande spårbara. Den separata hanteringen av `retained_conflicts` vid
avvisad bankimport är oförändrad: den är nödvändigt ekonomiskt bevismaterial.

**Bevis:** tre nya reproduktioner i `sites/tests/bank-state-integrity-q8.test.mjs`
var röda med syntetiska oanvända lösenords-/tokenfält och blev gröna efter
rättningen. Befintligt återtagande av matchning kontrollerar nu även att
anteckning och transaktionsreferens överlever. Den kombinerade bank-state-
och företagsgränssviten gav 49/49 före slutlig helverifiering.

Detta är minimering av nya auditposter, inte retroaktiv radering av historik.
Godkända affärsfält kan fortfarande innehålla personuppgifter och fritext;
behörighet, lagringstid och verksamhetens instruktioner behövs även för dem.

### SEC95-04 — backupformat som det egna recoveryverktyget avvisade

**Allvarlighet: medelhög för återställbarhet.** Sites snapshotvalidator godtog
tidigare varje 36 tecken lång följd av hextecken och bindestreck som dokument-ID.
Recoveryverktyget krävde däremot UUID-formatet 8–4–4–4–12. Producenten kunde
alltså godta en backup som konsumenten sedan inte kunde återställa.

`sites/lib/backup-engine.ts` använder nu samma strikta format som
`sites/scripts/lib/backup-recovery.mjs`. Ett avvikande ID ger
`backup_document_invalid` innan någon snapshot skrivs till R2. Det ursprungliga
underlaget lämnas kvar; en felaktig snapshot markeras inte som färdig.

**Bevis:** två nya RED/GREEN-fall med 36 hextecken respektive 36 bindestreck i
`sites/tests/backup-integrity-q8.test.mjs`. De kontrollerar misslyckad status,
uteblivet slutdatum och uteblivna objektlagringsskrivningar, samt oförändrad
arbetsyta och originalbytes. Backupgranskarens riktade körningar gav
353/353 Sites och 116/116 Node, utan fel eller överhoppade tester. Dessa fall
ingår även i slutliga helsviter och räknas inte en gång till.

Den nya Node-tabellen `login_rate_limits` kräver ingen backupformatändring:
en snapshot kopierar hela den aktuella SQLite-databasen och extra tabeller
avvisas inte av dess verifierare. En medföljande spärr behåller sin sluttid.
Sites rättning reparerar inte redan skapade snapshots med ogiltiga ID:n.

### SEC95-05 — operatörens Node-startflaggor följde med testprocesserna

**Allvarlighet: medelhög härdning av verifieringsmiljön.** Den fokuserade
acceptansrunnerns tillåtna miljölista innehöll `NODE_OPTIONS`. En operatörs
`--import`-flagga kunde därmed exekvera kod i testbarnet före den avsedda
nätverksvakten. Ingen verklig hemlighetsläcka har observerats.

`scripts/run-saas-security-acceptance.mjs` vidarebefordrar inte längre dessa
startflaggor. Ett nytt subprocessprov i `test/saas-security-runner.test.js`
använder riktig Node och kontrollerar att en syntetisk preload och syntetisk
OCR-token inte ärvs, att testläget behålls och att extern fetch stoppas.
Reproduktionen gav 0/1 före rättning; det nya och befintliga isoleringsproven
gav 4/4 efteråt. Runnern inkluderar också de nya login- och kroppstesterna.

Nätverksvakten är ett skydd mot oavsiktlig egress i betrodda tester. Den är
ingen fullständig sandbox för fientlig JavaScript, UDP, nativekod eller
godtyckliga separat startade binärer. Produktionshemligheter ska därför
fortfarande hållas utanför PR-jobb och testmiljöer.

## 2. Granskningsmatris

Här betyder syntetiskt verifierad att riktiga applikationsmoduler används med
isolerade databaser, kontrollerad objektlagring och ersatta providertransporter.
Det betyder inte att plattformens verkliga identitetsheaders, bankens tjänst
eller produktionsmiljön har provats. Testantal och versionsbindning finns i §5.

| Uppdrag / kontroll | Vad som har granskats och provats | Evidens och gräns |
| --- | --- | --- |
| 1. Autentisering och session | Lösenordshashning, slumpade sessioner, cookieflaggor, origin, utgång och återkallad session under pågående providerarbete; SEC95-01 tillför beständig försöksbudget. | `src/security.js`, `src/server.js`; `security-session-allocation`, `session-mutation-fence`, `security-login-rate-limit`. Faktisk TLS/proxy/administratörsdrift återstår. |
| 1. Auktorisering och företag | Node separerar ekonomidatabaser; Sites härleder lagringsägare från aktivt, verifierat medlemskap. Aktör, roll, företag och version följer asynkront arbete och återkontrolleras vid datagränsen. | `src/company-runtime.js`, `sites/lib/company-storage.js`; `company-api`, `company-storage`, `company-request`, `saas-company-acceptance`. Kodreview är separat från testkörningarna. |
| 2. IDOR | Annat företags original, överlappande objektnamn/ID:n, falska selectors, felaktig lagringsägare och otillåten workeråtkomst avvisas i befintliga scenarier. | Samma företags-/API-sviter; inga riktiga kundobjekt används. |
| 2. CSRF och replay | Exact origin för browsermutationer; begränsad MCP-transport; OAuth state/session/företagsbindning, engångskonsumtion, revisioner och beständiga idempotenskvitton. | `banking-security`, `mcp-security-q8`, `bank-consent-api`, `company-api`, `bankgiro-links-api`. En cookieflagga ensam räknas inte som CSRF-bevis. |
| 2. XSS och injection | Kodgranskning av utvalda Node-renderingsvägar med HTML-escaping, Sites React-rendering, parametriserade SQL-värden, begränsad intern SQL-adapter och sandboxade original-/nedladdningssvar. Befintliga CSV-exportvägar skyddar de kontrollerade formelprefixtyperna. | `public/app.js`, `public/payment-control.js`, `sites/lib/company-storage.js`, `sites/lib/imports.ts`, `src/server.js`. Ingen generell SQL-sandbox, ny dynamisk browserpenetration eller garanti för alla innehållstyper påstås. |
| 2. SSRF | Open Payments-transporten begränsar fasta HTTPS-origin, metoder, sökvägar och headers samt avvisar redirects; timeout, svarsstorlek och TLS/mTLS-krav finns. | `src/banking/openpayments-node-transport.js`, `sites/lib/banking/openpayments/http.js`; `openpayments-node-transport`, `openpayments-http`, `openpayments-transport`. Alla möjliga injicerade produktionsadaptrar är inte driftsverifierade. |
| 3. OAuth, banktoken och hemligheter | Påbörjat flöde binds till rätt aktör, session, företag och auktoriseringsversion; byte eller återkallelse av behörighet spärrar senare effekter. Token hålls i serverlagring och säkra statusprojektioner. | `banking-security`, `bank-consent-api`, `company-api`, `saas-transport-privacy`. Inga verkliga tokenvärden har inspekterats. |
| 4. Kryptering och nycklar | AES-256-GCM i Node; AES-GCM med owner-/ändamålsbunden AAD och färska noncer i Sites. Fel nyckel, manipulerad ciphertext/IV och fel kontext testas. | `src/security.js`, `sites/lib/banking/security.ts`; `banking-security`, backup- och providerhandtagstester. Formatkontroller är inte bevis för entropi, rotation eller säker nyckelförvaring; H2/M4 kvarstår. |
| 5. Audit och minimering | SEC95-03 stoppar godtyckliga oanvända klientfält i nya lyckade state-auditposter. Ekonomiska original, avvisade konflikter, revisionsskydd och nödvändiga granskningsanteckningar bevaras. | Nya privacyfall och befintliga bank-state-/Bankgiro-API-sviter. Historisk retention och fritext kräver H3. |
| 6. GDPR-flöden | Dataflöden, ändamål och kvarstående organisationella beslut kartläggs i §3. Integritetstexten i granskad källkod är uttryckligen ett utkast som behöver godkännande; aktuell publicering har inte kontrollerats. | `public/integritetspolicy.html`, `sites/lib/legal-documents.json` och tidigare integrationsrapport. Texten för intern användning fastställer inte automatiskt en kommersiell tjänsts GDPR-roller, avtal eller gallringsfrister. |
| 7. Överbelastning | SEC95-01/02 tillför beständig kontobudget och tidiga byte-/tidsgränser. Befintliga bankjobb har kvoter, Retry-After, lås och versionskontroller. | Login-/requestbudgettester, `company-bank-sync-fairness`, `company-sync-scale`, integrationsjobb. Ingen extern banklast eller uppmätt produktionskapacitet; M2 kvarstår. |
| 8. Backupintegritet | Hashar, autentiserad kryptering, ägar-/körningsbindning, saknade/utbytta objekt och referensintegritet; SEC95-04 samordnar producentens format med recoveryverktyget. | Backup-/reference-integrity-/bank-api-backup-sviter i båda miljöerna; inga äldre produktionskopior repareras här. |
| 9. Isolerad återställning | Återställning sker till nya temporära mål med syntetiska original; fel nyckel, korruption och osäkra filvägar stoppas. Fångade integrationer får inte börja användas som driftbevis. | `test/backup-disaster-recovery.test.js`, `sites/tests/backup-recovery.test.mjs`, företagsbackuper. Full produktionsmängd/offsite/RPO/RTO är H1. |
| 10. Omstart och konkurrerande jobb | Inloggningsbudget överlever ny server/DB-anslutning. Befintliga tester täcker avbrutna jobb, utgångna leaser, ersättningsarbetare, förlorade svar och mutation efter återkallad auktoritet. | Nya loginfall samt backup-, session-, integrationsjobb- och företagssynksviter. |
| 11. Dependencies och CI | Färska auditer, installerad byteverifiering, låsta Actions, minimala rättigheter och separata hemlighetsgränser; SEC95-05 begränsar testsuiternas startmiljö. | §5, `saas-security-runner`, `saas-test-isolation`, minimatchsviterna. Repo-policy kan inte härledas enbart ur workflowfiler; M3/M5 kvarstår. |
| 12. Risker och releasebeslut | Kvarstående hög-/medelrisker, ansvar och nödvändiga bevis anges nedan. Ingen ny kritisk eller hög exploatering har bekräftats av de separata granskningspassen. | §4, oberoende review och slutliga grindar. 9,5/10 och kommersiell aktivering är inte godkända. |

## 3. Databehandling och minimering

| Dataflöde | Data och avsikt | Kontroll i kod / denna PR | Kvarstående driftbeslut |
| --- | --- | --- | --- |
| Inloggning och session | Lösenordsverifiering, hashade sessionsidentifierare, aktuell aktör och företag | Befintlig lösenordshashning och sessionsrotation; ny beständig försöksbudget utan peeruppgifter | Extern TLS/proxygräns, administratörsåtkomst och incidentlarm |
| Bankmedgivande och resurser | Token/handtag, behöriga konton, generation och giltighet | Krypterad lagring och serververifierad företagskontext; befintliga replay-/återkallelsekontroller | Nyckelägarlista, rotations-/återkallelsekvitto, avtalsmässigt tillåtet omfång |
| Banktransaktioner och Bankgiro | Belopp, referenser, namn, konto och ursprungligt bevis | Företagsgränser och kontrollerad originalintegritet; rapportdata får inte fabricera en andra ekonomisk insättning | Ändamål, rättslig grund, behöriga mottagare och differentierad lagringstid |
| Gmail, fakturor och bilagor | Kontaktuppgifter, meddelanden och underlag för avstämning | Befintliga mailbox-/företags-/originalgränser; begränsad faktisk ingress | Leverantörsrelationer, underbiträden, överföringar och åtkomstgranskning |
| Audit och diagnos | Aktör, åtgärd, beslut och ekonomiska referenser | SEC95-03 minimerar nya lyckade state-händelser; råa transportfel ska använda säkra projektioner | Separata läsrättigheter, lagringstid, incidentrutin och hantering av historiskt innehåll |
| Backup och återställning | Databas, original, integritetsbevis och återställningsmetadata | Syntetiska korruptions- och isolerade restoreprov; inga produktionsmål | Oberoende kopia/nyckel, RPO/RTO, retention och återapplicering av återkallelser/raderingar |

Kodbasen är inte ett bevis på en färdig GDPR-process. För varje behandling
behöver ansvarig organisation fastställa ändamål, rollfördelning, rättslig
grund, mottagare, lagringstid och hantering av den registrerades rättigheter.
Medgivande till bankåtkomst ersätter inte den bedömningen. Lagrade original
och redovisningsbevis kan ha särskilda bevarandekrav; PR:n gissar därför inte
en generell raderingsfrist och inför ingen automatisk radering.

Säker återställning behöver också förhindra att tidigare återkallad åtkomst
eller redan verkställd gallring återaktiveras. Syntetisk restore visar kodens
beteende, medan en verklig gallrings-/offboardingprocess måste ha ett separat
verksamhetsgodkänt kvitto.

## 4. Kvarstående risker och releasegrindar

Det finns ännu ingen slutlig releaseacceptans. Nedanstående risker kan inte
stängas genom att öka testantalet. Allvarligheten gäller konsekvensen vid den
avsedda kommersiella driften; det är inte ett påstående om en konstaterad
pågående incident.

H1–H3 är operativa bevis- och acceptansluckor. Att ett produktionskvitto inte
har verifierats här visar inte att skyddet saknas, och innebär inte i sig en
demonstrerad exploaterbar High-sårbarhet.

| ID | Grad | Kvarstående risk / evidensgräns | Krav för stängning och releaseeffekt |
| --- | --- | --- | --- |
| H1 | Hög | En aktuell fullständig återställning av produktionsmängden från en oberoende kopia, med separat tillgängliga nycklar, är inte genomförd inom detta uppdrag. | Driftansvarig behöver ett auktoriserat isolerat drillkvitto med alla original, hash-/relationskontroller, avstängda integrationer och uppmätt RPO/RTO. Blockerar 9,5 och godkännande av katastrofberedskap. |
| H2 | Hög | Kodens kryptering bevisar inte verklig nyckelentropi, minsta åtkomst, oberoende escrow eller fungerande rotation/återkallelse. | Inventera nyckelägare/lagring/versioner, verifiera rotation och gammal backupåterläsning utan att exponera nycklar. Blockerar hög säkerhetsklassning av drift. |
| H3 | Hög | Samlad GDPR-retention, offboarding, raderingskvitton inklusive backup, roll-/avtalskarta och incidentövning är inte belagda som en genomförd kommersiell process. | Dataskydds-/driftansvariga måste godkänna behandlingarna och prova export, återkallelse, gallring och restorehantering. Blockerar kommersiell dataskyddsacceptans. |
| M1 | Medelhög | Aktuell extern TLS-/origin-/proxy- och direkt-originexponering är inte provad i denna isolerade kodgranskning. | Behörig driftkontroll av exakt driftsatt version och skyddad origin, inklusive certifikat och administrativa åtkomster. |
| M2 | Medelhög | Kroppsstorlek, lästid och bankjobbens budgetar ersätter inte övergripande anrops-/samtidighets-/kostnadsgränser. Kontobunden loginspärr kan förbrukas av en angripare. | Verifiera edgebegränsning, rättvis fördelning per företag, larm och kontrollerad belastning i auktoriserad testmiljö. Ingen lasttestning mot banker ingår. |
| M3 | Medelhög | GitHub-rulesets-listan var tom; klassiskt skydd för `main` kunde inte läsas eftersom integrationen svarade 403. Avsaknad av klassiskt skydd är alltså inte fastställd. | Repositoryadministratör ska visa obligatoriska kontroller/review och skydd mot kringgående. Gröna Actions visar körning, inte att mergekrav tvingas. |
| M4 | Medelhög | Äldre Node-token använder en gemensam AES-GCM-nyckel utan owner-/ändamålsbunden AAD i `encryptObject`. Riskmodellen för utbyte av ciphertext kräver skrivåtkomst till lagringen; ingen fjärrstyrd tenantbypass har visats. | Planera en versionsmärkt, bakåtkompatibel krypteringsmigrering med företags-/resursbindning, återläsning av äldre kopior och separat nyckelrotation. Befintliga databasisoleringar ska bevaras. |
| M5 | Medelhög | Sites fullständiga npm-audit har åtta paketposter som härrör från en och samma minimatch-advisory, GHSA-g3hv-75wg-m249. Utvecklingsgrafen behåller den markerade paketversionen. | Installerad, befintlig backport måste fortsätta byteverifieras. Planera kompatibel upstreamuppgradering; dölj inte auditresultatet och gör ingen automatisk nedgradering. Produktionsgrafen redovisas separat med noll fynd. |

Ingen ytterligare Critical/High har bekräftats i åtkomst-, backup- eller
supply-chain-granskningen. Det innebär inte att okända sårbarheter eller
overifierade driftkontroller är godkända. Slutlig oberoende kodreview och CI
redovisas tillsammans med de frysta testkvittona nedan.

## 5. Verifiering och reproduktion

**Slutliga lokala helsviter: 1 905 Node + 3 776 Sites + 47 brygga = 5 728
godkända tester**, med 0 fail/skip/cancel/TODO. Ökningen från basens 5 702 är
26 nya regressionsfall. [Maskinläsbart grindkvitto](security-95/gates.json)
innehåller exakta kommandon, tidsstämplar, logghashar, auditvärden och
fingeravtryck för de ändrade källfilerna.

| Lokal grind | Utfall |
| --- | --- |
| Låsta installationer i root, Sites och brygga | Godkända; beroenden och lockfiler oförändrade i PR:n |
| Root `npm run check` | 173 JavaScript-filer godkända |
| Root `npm run test:isolated` | 1 905/1 905 |
| Sites `npm run check` | Godkänd efter slutlig korrigering |
| Sites `npm run test:isolated` | 3 776/3 776 efter slutlig korrigering |
| Brygga syntax och `test:isolated` | Godkända; 47/47 |
| Minimatch `--check --require-target` | En installerad target verifierad, noll skrivningar |
| Sites `npm run build` med produktionsläge | Godkänt efter slutlig korrigering |
| Fyra separata auditgrindar vid High | Exit 0; omfattning och moderate-fynd nedan |
| Fokuserad säkerhetsacceptans | 331 Node + 767 Sites = 1 098/1 098 |
| Oberoende kodreview | READY with limits; 81 egna riktade testfall godkända |

Lokal Node-version är **24.22.1**, npm **11.9.0**, på Linux. GitHub Actions
använder Node **22** och dess resultat för publicerat PR-huvud visas separat
i PR:n. Lokal Node24-verifiering ersätter inte den kontrollen. Riktade tester,
granskarens 81 fall och den fokuserade acceptansen överlappar helsviterna och
adderas inte en gång till. [Fokuserat kvitto](security-95/focused-acceptance.json)
och [oberoende review](security-95/independent-review.md) behåller sina exakta
avgränsningar.

Det slutliga fingeravtrycket för 798 icke-dokumentfiler är
`010b3cf052e58a2913a1003cfa2e8a0c7d00f986acfeb53e839ad1bcd595c25b`.
Node-helkörningen pågick under den sista korrigeringen av enbart Sites
state-route. Node-kod, Node-tester, delade bibliotek och brygga var oförändrade.
Sites-helkörningen startades om; fokuserad acceptans, typer och bygge kördes
sedan mot slutversionen. Före-/eftermanifestens enda kodskillnad är dokumenterad
i grindkvittot, tillsammans med de tidigare försöken.

De inledande fullkörningarna var explorativa eftersom andra filer ändrades
medan ännu inte startade testfiler väntade i kön. Node gav 1 899 godkända;
Sites gav 3 756 godkända och ett suitefel från multipartregressionen som
beskrivs i SEC95-02. De ersätter inte en ny körning på fryst slutkod och
redovisas inte som slutlig grön baslinje.

Den första senare Sites-helkörningen stoppades med exit 130 efter ett
konkret kompatibilitetsfel i auditprojektionen för `bankgiro.link`: två
serververifierade originalfält hade duplicerats i loggen där det befintliga
kontraktet krävde att de utelämnades. Rättningen bevarar länken till den
beständiga relationen och dess original, och lämnar den befintliga
säkerhetsassertionen oförändrad. 57/57 relaterade API-/bank-state-fall gick
sedan igenom. Den avbrutna körningen räknas inte som en godkänd helsvit.

### Beroenden och CI

Fyra färska auditgrindar med `--audit-level=high` gav exit 0. Rootens hela
graf, Sites produktionsgraf och bryggans produktionsgraf hade noll fynd.
Sites hela graf hade åtta moderate paketposter, noll high/critical. Poster
för `minimatch`, sex `@typescript-eslint`-/`typescript-eslint`-relaterade
paket och `eslint-config-next` härrör från samma advisory; det är inte åtta
separata sårbarheter. Exakta paketnamn och auditvärden finns i JSON-kvittot.

Den befintliga minimatch-backportens installerade bytes har kontrollerats med
`--check --require-target` utan skrivning. Den särskilda granskningskörningen
gav 39/40 eftersom en direkt Node-invokering saknade npm:s `npm_execpath`.
Det kvarvarande postinstallfallet gav därefter 1/1 med faktisk npm-sökväg.
Ingen assertion eller paketfil ändrades för detta miljöfel. Den slutliga
ordinarie fullsviten kördes via npm, tillhandahöll sin egen korrekta sökväg
och passerade även båda minimatch-testfilerna.

Granskade workflows har läsrättigheter för repositorytoken, SHA-låsta
Actions, `persist-credentials: false`, låsta installationer, tidsgränser och
kontrollerad samtidighet. Ingen providerhemlighet eller privilegierad
`pull_request_target`-/`workflow_run`-kedja identifierades i PR-valideringen.
Det befintliga produktions-OCR-jobbet är separat, kräver `main` och
`MG_CLOUD_OCR_ENABLED=true` och får token först i exekveringssteget. Dess
schema och credentials ändras inte och jobbet har inte dispatchats.

## 6. Bedömningsgrund och primärkällor

- [OWASP API4:2023 — Unrestricted Resource Consumption](https://api-security.owasp.org/editions/2023/en/0xa4-unrestricted-resource-consumption/): kroppsstorlek, tidsgränser och resurs-/anropsbudgetar behöver hanteras tillsammans.
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html): kontobunden försökbegränsning och avvägningen mot tillgänglighet.
- [IMY — GDPR i fulltext](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/introduktion-till-gdpr/dataskyddsforordningen-i-fulltext/): bland annat artiklarna 5 och 32 om minimering, motståndskraft, återställning och regelbunden kontroll.
- [IMY — Säkerhetsåtgärder](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/informationssakerhet/sakerhetsatgarder/): säkerhetsåtgärder ska bedömas utifrån behandlingens risker.
- [GitHub Advisory Database — GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249): minimatch-resursförstärkning, moderate; den aktuella auditkedjans primärkälla.

Dessa källor beskriver bedömningsprinciper. De certifierar inte Mgeorge och
ersätter inte företagets dokumenterade rättsliga och operativa beslut.
