# SaaS-säkerhet, efterlevnad och acceptans — Agent 7

**Beslut: kommersiell flerföretagslansering är blockerad.** Denna PR levererar avgränsade säkerhetsrättningar och körbar regressionsacceptans. Den är varken ett juridiskt godkännande eller bevis för en färdig företags-, roll- eller Open Payments-integration.

Granskningsdatum enligt uppdraget: **2026-11-04**. Bas: `14a042abd37fa455d08da9dfcc096ef4f603b512`. Branch: `feature/saas-security-acceptance`. Befintligt kontrakt: [`mgeorge-integration-v1`](../README.md). [Genomförandeplan och arbetsanteckningar](security-acceptance-plan.md).

## 1. Omfattning och integrationsgräns

Den inspekterade basen har två separata runtime-miljöer. Node-installationen har en administratör och ett företagsregister. Sites lagrar arbetsytor, bankanslutningar, original och jobb med en autentiserad `owner`. `owner` är i dag användaridentitet, inte ett bevis på medlemskap i ett valbart kundföretag.

Den initiala GitHub-inventeringen returnerade inga SaaS-brancher eller öppna PR:er för den nya omgången. Företagsmedlemskap, flera behörighetsroller, den nya corporate-providern och företagsbundna consent-kontrakt kunde därför inte granskas som levererad kod. Agent 7 inför ingen konkurrerande datamodell och ändrar inga producentkontrakt. Agent 8 måste koppla acceptansen till respektive fryst producent-SHA innan full SaaS-acceptans kan godkännas.

Alla skrivningar i verifieringen gäller syntetiska data, temporära SQLite-databaser och testlagring. Inga produktionsanrop, bankhämtningar, återställningar till produktion, nyckelbyten, kundmeddelanden, schemauppdateringar eller Sites-publiceringar ingår.

## 2. Konkreta rättningar

### SEC-01 — privat information i bankens transportlogg

`sites/lib/banking/enable-banking.ts` kopierade exceptionstext till loggen efter maskering av URL:er, Bearer-värden och långa strängar. Korta tokenvärden, personidentiteter, kontouppgifter och radbrytningar kunde passera. Fem tester mot den verkliga `providerRequest`-felvägen reproducerade läckan; bara HTTP-gränsen ersattes med syntetiska fel.

Felvägen skriver nu den fasta händelsen `BANK_PROVIDER_TRANSPORT_ERROR`. Befintliga säkra klientfel och deras koder behålls. En driftutredning kan se att transporten fallerade men får inte rå providertext, bankuppgifter, personnummer eller engångskoder i applikationsloggen. Detta är en avsiktlig minskning av diagnostikens detaljnivå; felsökning ska använda godkända incidentrutiner och leverantörens korrelationsuppgifter.

**Bevis:** `sites/tests/saas-transport-privacy.test.mjs`, fem fall RED → GREEN; befintlig providerregression uppdaterad till samma sekretesskrav. Inget provider-API eller lagringsformat ändras.

### SEC-02 — för stor oautentiserad inloggningskropp

Node använde dokumentuppladdningens gräns på 22 MB även före autentisering av `/api/login`. Login begränsas nu till **8 192 byte**, kontrollerat både mot deklarerad längd och faktiskt läst ström. Gränsen rymmer det befintliga lösenordsformatet; övriga dokumentanrops storleksgräns behålls.

**Bevis:** `test/saas-login-boundary.test.js`. För stora deklarerade och chunkade anrop accepterades före rättningen och avvisas nu med 413 utan session. Positiva login-/cookiekontroller, CSRF och avvisning av tre främmande principaler ingår. De senare är negativa kontroller av dagens administratörsgräns, inte godkännande av framtida företagsroller.

### SEC-03 — multipart kringgick Sites gräns för hela anropet

`sites/app/api/files/route.ts` kontrollerade deklarerad `Content-Length` men lät `req.formData()` läsa hela strömmen. Ett autentiserat anrop med en liten giltig fil och ett stort ignorerat fält kunde därför överskrida den avsedda 16 MB-gränsen. Oberoende granskning reproducerade HTTP 200 efter drygt 17 MB lästa byte, både utan och med för låg deklarerad längd. Belastnings- eller överbelastningsangrepp mot produktion har inte utförts.

Rättningen räknar faktisk strömstorlek före multiparttolkning, avbryter vid **16 000 000 byte** och svarar 413. Den separata gränsen på **15 000 000 byte per fil** behålls. Företagsmodell, provideravtal och lagringskontrakt påverkas inte.

**Bevis:** `sites/tests/saas-upload-boundary.test.mjs`: två bypassfall RED → GREEN, avbruten ström och noll DB-/R2-skrivningar; positiv normaluppladdning och kvarvarande filgräns. Befintliga konkurrens- och integritetstester ingår också i verifieringen.

### SEC-04 — isolerad acceptanskörning och låsta CI-actions

`scripts/run-saas-security-acceptance.mjs` kör namngivna Node-/Sites-sviter, sparar TAP och ett maskinläsbart kvitto och underkänner fel, avbrott, tomma körningar, skips och TODO-fall. Kvittot skiljer regressionens utfall från kommersiell lansering. Det anger Git-SHA, smutsig arbetskopia, Node-version och testomfattning.

Testprocesserna får `NODE_ENV=test` och en tillåtelselista med grundläggande process-/runtimeinställningar; bank-, moln- och applikationshemligheter ärvs inte. `scripts/saas-test-isolation.mjs` stoppar externa `fetch`- och TCP-anslutningar samt Unix-socketanslutningar, medan loopback-fixturer fungerar. Skyddet motverkar oavsiktlig nätverksåtkomst i betrodd testkod; det är inte en operativsystemssandbox för fientlig JavaScript eller godtyckliga subprocesser. De två befintliga Workerd/PDF-fixturerna stänger dessutom uttryckligen av Miniflares hämtning av `cf.json` med `cf: false`.

Den nya workflowen `SaaS security acceptance` körs för SaaS-feature-pushar, PR mot main och manuell dispatch, med enbart `contents: read`, utan produktionshemligheter, utan sparade checkout-credentials och med 14 dagars lagring av syntetiska testartefakter. Tredjeparts-actions är låsta till verifierade fullständiga commit-SHA:er. De befintliga root-/Sites-/bridge-grindarna behålls; deras flytande action-taggar låses också.

## 3. Riskmatris

**Prioritet:** P0 blockerar kommersiell flerföretagslansering. P1 ska vara åtgärdad eller uttryckligen riskaccepterad av ansvarig före lansering. P2 är en avgränsad förbättring med dokumenterat driftansvar. Testframgång sänker inte en extern eller juridisk risk automatiskt.

| Område | Observation och kvarstående risk | Prioritet / grind | Ansvar och bevis |
| --- | --- | --- | --- |
| 1. Företagsisolering / IDOR | Sites använder owner-filter; Node är ett administratörsregister. En användare med flera företag och gemensamma medlemskap är ännu inte implementerad i basen. | P0 / G1 | Agent 1 + 8. A/B/C-ownerprov ska kompletteras med faktiska company-ID:n i alla API-/SQL-/R2-/jobbvägar. |
| 2. Roller | Servern måste avgöra medlemskap och rättighet för varje resurs och åtgärd. Klientens `role`, `owner` eller företagsval får inte vara auktoritet. Nuvarande Node nekar andra principaler än sin administratör. | P0 / G1 | Agent 1 + 8. Kräv positiv/negativ matris för samtliga levererade roller. |
| 3. OAuth state / callback | Befintlig bankstate är tidsbegränsad, engångskonsumerad och ägar-/webbläsarbunden. Ny corporate-anslutning måste dessutom binda rätt företag, bank, redirect och begärd scope. | P0 för ny integration / G2 | Agent 3 + 8. `banking-security`, `bank-api`, sessions- och callbackregressioner. |
| 4. CSRF | Befintliga mutationer kontrollerar origin; callback använder separat state/cookie. En tillåten bankretur får inte göra andra mutationer till undantag. | P1 / G2 | Agent 7 + 3. Cross-origin- och body/session-tester; nytt UI måste använda samma gräns. |
| 5. Tokenläckage | SEC-01 rättar reproducerad loggläcka. Klientfel, status, audit, export och framtida providerfel måste behålla säkra projektioner. | Rättat inom scope; P1 / G3 | Agent 7 + providerägare. Fem nya sekretessfall och befintliga provider-/MCP-tester. |
| 6. Server / certifikat | Node kräver HTTPS-origin och skyddad reverse proxy i publik drift. Sites litar på plattformens autentiseringsheaders. Ingen direkt Worker-origin eller certifikatinstallation har verifierats i detta uppdrag. | P0 / G4 | Drift + Agent 2/8. Bevisa headeröverskrivning, stängd bypass-origin, giltig certifikatkedja, mTLS/nyckelförvaring där leverantören kräver det. |
| 7. BankID-personuppgifter | Identifiering sker hos banken/provider. Applikationen ska inte samla BankID-koder eller privata behörighetsfunktioner. Returnerade identiteter kan vara personuppgifter även för företagskonton. | P1 / G3, G6 | Provider + dataskyddsansvarig. Fältinventering och minimering; SEC-01 täcker undantagstext i logg. |
| 8. Medgivandets livscykel | Befintliga kontroller omfattar giltighet, providerstatus, valda konton, generation och commit-fences. Nytt företagsscope och ny provider måste verifieras separat. | P0 / G2 | Agent 3/5 + 8. `bank-account-consent`, `bank-account-commit`, callback/replay. |
| 9. Återkallat medlemskap | Förlorad Node-session och återkallad bankbehörighet är testade; det finns ingen färdig generell CompanyMembership-gräns i basen. | P0 / G1, G2 | Agent 1/3/5. Återkallelse under body-läsning, provideranrop, kö, originalskrivning och faktisk commit. |
| 10. Webhookar | Ingen ny corporate-webhook kan godkännas utan leverantörens signerade protokoll och kontrakt. En hemlig URL eller HTTPS räcker inte som avsändarbevis. | P0 om aktiverad / G2 | Agent 2/5 + 8. Rå-byte-signatur, tidsfönster, nyckelrotation, atomisk event-dedup och företagsscope; annars håll funktionen avstängd. |
| 11. Replay | Befintlig OAuth-consumption och beständiga import-/rapportidentiteter ger lokala regressioner. Nycklar måste inkludera aktuellt företag/konto/källa där den nya modellen kräver det. | P1 / G2, G5 | Agent 3/4/5. Dubbla callbacks, identiska/ändrade original, omstart och förlorat svar ska ge högst en finansiell effekt. |
| 12. Rate limiting | Login har femförsöksgräns och nu separat liten body-budget. SEC-03 begränsar faktisk multipartstorlek. Befintliga bankspärrar bevarar Retry-After. Proxy-IP kan dela loginbudget; detta är inte en per-företagsskyddad SaaS-kvot. | P1 / G4, G5 | Drift + Agent 5. Verifiera proxytrust, användar-/företagskvoter och leverantörens bakgrundsanropsavtal. |
| 13. Bakgrundsjobb | Nuvarande owner-lås, leases, generationskontroller och kvitton är användbara byggstenar. Företagsbundet körsammanhang och återkallat medlemskap måste genomsyra nya jobb. | P0 / G5 | Agent 5 + 8. Samtidig synk, leaseförlust, omstart och återkallelse vid commit. |
| 14. R2 / databas | SQL/R2 är ownerbundna. Import-/betalningskontroller verifierar storlek och SHA-256; filnedladdning kontrollerar owner och objektets existens. En hash bevisar integritet, inte bankens auktoritet. SHA-dedup får inte skapa delad åtkomst mellan företag. | P0 / G1, G5 | Agent 1/4/8. Cross-owner originalprov och senare company-migration; bevisa lagringsregion, IAM, integritetsstatus och exportgräns. |
| 15. Kryptering / nyckelrotation | Sites AES-GCM binder owner och ändamål; Node har äldre gemensam nyckel. En driftflagga om roterad provider-nyckel är inte ett utfört rotationsprov. Ingen ny krypteringsversion införs här. | P1 / G4, G7 | Drift + Agent 1/2/8. Kontrollerad rotation, gamla data/backupnycklar, återläsning och återkallelse med kvitto. |
| 16. Backup / restore | Befintliga isolerade återställnings- och integritetstester finns. Produktionsarkiv, oberoende nyckelåtkomst, full datauppsättning och uppmätt RPO/RTO är inte verifierade här. | P0 / G7 | Drift. Isolerat produktionslikt återställningsprov och företagsspecifik export utan återaktiverade bankjobb. |
| 17. Loggar / incident | SEC-01 stoppar godtycklig transporttext. Åtkomst till loggar, larmansvar, korrelation, retention och incidentkommunikation behöver avtalas och övas. | P1 / G3, G8 | Drift + dataskydd + leverantör. Dokumenterad runbook och simulerad incident. |
| 18. Lagring / radering | Samlad företagsspecifik retention, uppsägning, rättsliga bevarandekrav och radering ur repliker/backuper är inte visade som färdig SaaS-funktion. Att återkalla consent raderar inte automatiskt lagrade data. | P0 / G6, G7 | Dataskydd/jurist + Agent 1/8. Dataförteckning, avtalade tider, spärrade jobb, export och verifierat raderingskvitto. |

## 4. Acceptansmatris och vad den kan bevisa

En syntetisk owner representerar i detta steg en avskild arbetsyta. Företag A/B/C är testetiketter. De är inte nya Company-rader eller bevis på att en användare kan välja mellan flera juridiska personer. När Agent 8 levererar de riktiga kontrakten ska samma scenarier köras mot deras offentliga API och faktiska medlemskapstabeller.

| Scenario | Nuvarande körbar evidens | Full SaaS-acceptans |
| --- | --- | --- |
| A, B och C; samma fakturanummer | Ny owner-isoleringssvit med separat lagring och positiv egenåtkomst. | Lägg samma användare i flera företag; prova både samma och olika rättigheter. |
| Flera roller | Node nekar främmande principaler; Sites har autentiserad owner. | BLOCKERAD: positiva/negativa admin-, ekonomi- och läsroller enligt Agent 1:s verkliga kontrakt. Rollnamn får inte antas av detta dokument. |
| Flera banker | A/B/C lagrar tre syntetiska bankidentiteter och återanvänder samma providerselector utan att dela ciphertext. Basens onboarding filtrerar Swedbank. | BLOCKERAD för verklig anslutning: banklistans corporate-stöd, kontotyper och särskilda SCA-flöden från Agent 2/3. |
| Flera medgivanden | Giltiga, utgångna, återkallade och generationsändrade resurser i säkerhets-/consent-sviterna. | Bind varje medgivande till company, bank, konto, scope och medlem på faktisk skrivgräns. |
| Bankgiro för A men inte B | A/B/C-fixturen importerar Bankgirodata endast till A. B/C får varken rapportpost eller originalåtkomst; alla saknar automatiska allokeringar. Befintliga source-/joined-tester kompletterar källauktoriteten. | Verifiera provider-entitlement per företag; aldrig ärva A:s berikning till B. |
| Cross-tenant / IDOR | Ändrade owner-, konto-, original- och anslutningsidentifierare avvisas i ägarbundna regressioner. | Alla nya företagsendpoints och objektvägar måste ingå i samma negativa matris. |
| Utgångna tokens / förlorad session | Node sessionsfence, providerfel och aktuellt consent. | Revalidera företagets medlemskap och medgivande under samtliga väntande steg. |
| Felaktig callback / replay | Befintlig bankstate/cookie/expiry/engångslogik samt felaktiga returparametrar. | Ny redirect/decoupled-provider, PKCE där krävt och organisationsval måste få egna verkliga kontraktsprov. |
| Samtidig synk / omstart | A:s dubbla bankarbete nekas medan B kan hålla en separat lease. Befintliga jobb- och commitprov täcker omstart och ekonomisk skrivning. | Samtidiga A/B-körningar ska vara tillåtna inom providerbudget; dubbel A/konto-körning ska stoppas. |
| Dubbletter | Identiska uppladdade byte ger separata dokument-ID/R2-objekt för A/B/C och återanvänds endast inom respektive owner. Stabil bankidentitet och rapportreplay provas i befintliga sviter. | Samma externa referens i A/B får inte bli en global dubblett eller global låsnyckel. |
| Saknat original | Owner-/originaltester och säker betalnings-/backupacceptans. | Inga nya bokningar eller automatiska godkännanden när evidensen saknas; behåll tidigare historik. |
| Osäkert matchningsförslag | `seven-agent-0599-joined`, consent-/commit- och referensevidensprov. | Ett förslag får inte ändra saldo, få grön verifieringsstatus eller använda ett annat företags faktura. |

### Körning

Efter repots låsta root-/Sites-installationer:

```sh
node scripts/run-saas-security-acceptance.mjs /tmp/mgeorge-security-evidence
```

Katalogen innehåller `node-security.tap`, `sites-security.tap` och `report.json`. Linux är CI:s verifieringsmiljö. Separata helsviter körs med `NODE_ENV=test npm run test:isolated` i respektive paket enligt `.github/workflows/payment-control-ci.yml`; fokussviten ersätter dem inte. Node-flaggorna ligger före filglobben så att spärren verkligen laddas i testprocesserna. `report.json` kan visa `regressionPassed: true` samtidigt som `commercialLaunch` är `NOT_APPROVED`. Det är avsiktligt: frånvarande producentfunktioner eller avtal blir inte godkända genom att utelämnas från en testkörning.

## 5. Regulatoriskt beslutsunderlag

### Vem tillhandahåller kontoinformationstjänsten?

Det avgörs av den faktiska tjänsten, kundrelationen, behörigheten, ansvaret och avtalen. Att en API-leverantör har tillstånd är inte i sig ett besked om Mgeorges rättsliga ställning. Den inspekterade koden visar teknisk API-användning; den visar inte ett undertecknat distributions-/ombudsavtal eller en bekräftad regulatorisk klassificering.

FI anger att kontoinformation är en betaltjänst. Den som enbart tillhandahåller sådan tjänst kan ansöka om undantag från tillståndsplikten och bli registrerad betaltjänstleverantör. Undantag betyder därför inte att vem som helst kan starta oregistrerat. [S1][S2]

Två avgränsningar i lagen är viktiga. Det tekniska undantaget i **1 kap. 6 § 3** utesluter uttryckligen AIS och betalningsinitiering: frånvaro av kundmedel ger inte i sig undantag. Samtidigt undantar **3 kap. 17 §** kontoinformationstjänster från just den ombudsanmälan som annars krävs där. Rapporten kräver därför inte generell registrering av varje AIS-ombud. Gränsöverskridande regler och frågan om ett faktiskt ombudsförhållande måste prövas för den valda modellen. [S7]

| Modell att pröva | Beslut som behövs före kundstart |
| --- | --- |
| Mgeorge tillhandahåller själv AIS. | Egen tillämplig FI-process, försäkring, organisation, kundvillkor och löpande skyldigheter. |
| Mgeorge agerar för leverantören i ett avtalat ombuds-/outsourcingupplägg. | Uttryckligt mandat, huvudmannens ansvar, kontroll och juridisk bedömning av relevant svensk/gränsöverskridande process. |
| Leverantören tillhandahåller AIS till slutkunden; Mgeorge integrerar och vidarebehandlar enligt avtal. | Kundresa, villkor och bankidentifiering måste styrka vem kunden anlitar och vilka moment Mgeorge får utföra. |

Tabellen är en arbetsmodell för leverantörens och juristens bedömning. En API-nyckel, BankID-signering eller ett marknadsföringsnamn avgör inte klassificeringen.

Open Payments uppger att dess tillstånd omfattar AIS och andra betaltjänster. Dokumentationen skiljer `corporate` från tjänstescopen `accountinformation` och den extra Bankgiroberikningen `bankgiroinformation`. Detta beskriver teknisk åtkomst, inte ett Mgeorge-specifikt avtal, kundens bankbehörighet eller täckning för varje bank/konto. För ren läsåtkomst ska betalningsinitiering inte begäras. [S3][S4]

Den befintliga adaptern använder Enable Banking. Dess villkor uppdaterade 2026-01-09 beskriver att ett separat organisations-/partneravtal kan ersätta de allmänna villkoren och att produktionsanslutningen bygger på Enable Bankings AISP-ställning. [S8] Open Payments juridiksida länkar till villkor daterade 2026-03-26; hela den avtalstexten har inte verifierats här. [S9] För båda leverantörerna krävs aktuell registerkontroll, relevant rätt att verka i Sverige och ett avtal som uttryckligen omfattar Mgeorges flera kundföretag. Leverantörens egen tillståndsuppgift är inte en oberoende registerverifiering.

### GDPR och avtal

GDPR-rollen ska bedömas för varje behandling. Ett kundföretag kan vara personuppgiftsansvarigt för sin bokförings-/avstämningsbehandling, medan Mgeorge behandlar data på dokumenterade instruktioner som biträde. Mgeorge kan samtidigt ha egna ansvariga behandlingar för exempelvis kontoadministration och säkerhet. Banken och AIS-leverantören kan ha självständiga skyldigheter; de ska inte automatiskt klassas som Mgeorges underbiträden.

Detta är en **föreslagen rollkarta som kräver avtalad bekräftelse**, inte en färdig GDPR-klassificering. Bankens uttryckliga PSD2-godkännande och en rättslig grund enligt GDPR är olika frågor. EDPB:s slutliga riktlinjer behandlar just samspelet och dataminimeringen, inklusive uppgifter om andra personer i transaktionerna. [S5]

Före lansering ska det finnas en behandlingsförteckning och en avtalsmatris som namnger juridiska parter, ändamål, personuppgiftskategorier, rättslig grund, instruktioner, underbiträden, dataplacering/överföringar, säkerhetskrav, incidentvägar och bevarandetider. Biträdesavtal ska användas där relationen faktiskt är ansvarig–biträde; självständiga ansvariga behöver i stället en korrekt beskrivning av datadelningen och respektive skyldigheter. Underbiträden kräver föregående skriftligt tillstånd enligt tillämplig avtalsmodell. Avtalet ska också hantera sekretess, kontroll, assistans vid rättighetsbegäranden och återlämning/radering när uppdraget upphör. [S6][S10]

Bankdataavtalet behöver dessutom precisera kundens företrädarbehörighet, tillåtna konton/scope, historikperiod, Bankgirotäckning, bakgrundsanropsgränser, förändrade eller återkallade rättigheter, användning för avstämning, export, uppsägning, support och incidentansvar. Kunden måste kunna förstå vilken data som faktiskt hämtas och vilka betalare/referenser som saknas. Saknat Bankgiroavtal får inte döljas bakom lyckad AIS-anslutning.

### Säkerhet, incidenter och lagring

Artikel 32 kräver riskanpassade tekniska och organisatoriska åtgärder, inklusive förmåga att återställa tillgången till data och regelbunden kontroll av skyddens effektivitet. En DPIA-bedömning ska dokumenteras; sannolik hög risk kan kräva en konsekvensbedömning enligt artikel 35. Det avgörs inte genom antalet gröna tester. [S6]

För en anmälningspliktig personuppgiftsincident ska den ansvarige underrätta tillsynsmyndigheten utan onödigt dröjsmål och, om möjligt, inom 72 timmar från vetskap. Biträdet ska underrätta den ansvarige utan onödigt dröjsmål och ska inte behandla 72 timmar som sin generella interna väntetid. Avtalade leverantörsfrister kan kräva snabbare eskalering. [S6][S11]

FI:s DORA-tillsyn omfattar digital operativ motståndskraft och rapportering av allvarliga IKT-incidenter. Vilka skyldigheter som direkt gäller Mgeorge respektive överförs genom leverantörsavtal måste bestämmas efter valet av AIS-modell. Rapporten klassar inte automatiskt en vanlig SaaS-leverantör som finansiell aktör. Begär leverantörens tillämpliga incident-, kontroll-, underleverantörs- och exitkrav. [S12]

Fastställ separata tider för bankcache, identitetsuppgifter, consent, säkerhetsloggar, bokföringsunderlag och backup. Lagringsminimering och dokumenterade rättsliga bevarandekrav ska avgöra tiderna; denna PR hittar inte på en generell lagringstid för all bankdata. Raderingsrutinen måste även ange när backupkopior gallras och hur redan verkställda raderingar återappliceras efter restore. [S6]

Leverantör, jurist och vid kvarstående tillståndsfrågor FI måste bekräfta modellen före kommersiell start. Kontrollera då även aktuella EU-övergångsregler; detta underlag förutsätter inte att framtida PSD3/PSR redan har ersatt de verifierade reglerna.

## 6. Lanseringsgrindar och godkännare

| Grind | Krav på reviewbart bevis | Beslutsägare | Status i denna PR |
| --- | --- | --- | --- |
| G1 Företag / medlemskap | Frysta producent-SHA:er, bakåtkompatibel migrering av befintliga data, A/B/C-IDOR och hela rollmatrisen genom riktiga API:er. | Agent 1 + Agent 8 | BLOCKERAD: ej levererat i granskningsbasen. |
| G2 Bankbehörighet / callback | Providerkontrakt, företags-/kontoscopad consent, SCA/redirect/PKCE där krävt, återkallelse under pågående arbete, replay och eventuella webhooksignaturer. | Agent 2/3/5 + Agent 8 | BLOCKERAD för ny SaaS-provider; basregressioner räcker inte. |
| G3 Dataminimering / loggar | Fältinventering, inga hemligheter i status/logg/audit, godkända pseudonyma korrelationsfält, verifierad loggbehörighet/retention. | Säkerhetsansvarig + dataskydd | SEC-01 rättad; organisationens driftbeslut återstår. |
| G4 Produktionsgräns / nycklar | TLS/mTLS, certifikat, origin-skydd, serverhemligheter, providerbehörigheter, secretrotation och direkt-originprov. | Drift + provider | EJ VERIFIERAD i produktion. |
| G5 Säkra jobb / ekonomiskt utfall | Samtidig synk, företags-/kontofences, kvoter, idempotens, saknad berikning/original och noll osäkra finansiella effekter. | Agent 4/5 + Agent 8 | Basprov finns; ny company-kedja återstår. |
| G6 Regulatorisk modell / avtal | Skriftligt besked om tjänsteleverantör, Mgeorges registrerings-/ombuds-/teknikroll, kundvillkor, GDPR-rollkarta, DPIA-bedömning, DPA där tillämpligt och underbiträdeslista. | Leverantör + jurist; FI vid oklarhet | BLOCKERAD: inget juridiskt klartecken lämnas. |
| G7 Lagring / återställning / avslut | Avtalad retention, lagliga undantag, export, radering, revokering, återställningsprov utan aktiverade integrationer och uppmätt RPO/RTO. | Drift + dataskydd/jurist | Syntetiska backup-/restoreprov; full kommersiell process återstår. |
| G8 Incidentberedskap | Utsedd incidentledare, larmväg, provider-/kundkontakt, bedömning av tillämplig rapporteringsskyldighet och tidsfrister samt genomförd övning. | Ledning + säkerhet/dataskydd | Dokumenteras och övas före lansering. |
| G9 Slutlig integration | Exakt integrerat SHA, alla obligatoriska CI-jobb, oberoende review, riktiga godkända bankfall och uttryckligt releasebeslut. | Agent 8 | Denna branch/PR är en delleverans. |

### Operativt minimipaket före kundstart

1. **Incident:** stoppa berörd källa/tenant utan att radera bevis; återkalla exponerade behörigheter hos rätt leverantör; säkra sekretessbegränsade loggar; fastställ tidslinje och påverkade företag/personer; bedöm notifiering enligt tillämpliga regler och avtal; dokumentera beslut och återöppningsvillkor.
2. **Nycklar:** ägare och åtkomstlista för varje nyckel; separat backupnyckel; versions-/rotationsplan; bevis för återläsning av äldre data och behörig återkallelse. Ingen blind ersättning av en nyckel som krävs för befintliga original/backuper.
3. **Uppsägning:** spärra nya jobb och väntande skrivningar; återkalla provideråtkomst; erbjud avtalad export; klassificera vad som måste bevaras och varför; radera övriga data och underbiträdeskopior enligt schema; bevara revisionskvitto utan att bevara onödigt innehåll.
4. **Återställning:** isolerat mål, egen åtkomstkontroll, avstängd extern trafik och jobb, kontroll av företagsscope/originalhashar/allokeringar, återapplicering av raderingar och revokeringar innan någon integration kan aktiveras.

## 7. Primärkällor

Källorna stödjer regel-/leverantörsfakta. Åtgärdsförslag, riskprioritering och kopplingen till den inspekterade arkitekturen är Agent 7:s tekniska bedömning. Ett publikt dokument ersätter inte kundens eller leverantörens undertecknade avtal.

- **S1:** [FI — Betaltjänster och betaltjänstombud](https://www.fi.se/sv/betalningar/sok-tillstand/betaltjanster/).
- **S2:** [FI — Tredjepartsleverantörer](https://www.fi.se/sv/betalningar/andra-betaltjanstdirektivet-psd-2/tredjepartsleverantore/).
- **S3:** [Open Payments — Company och tillståndsuppgifter](https://www.openpayments.io/company).
- **S4:** [Open Payments — Get access token och scopes](https://docs.openpayments.io/docs/get_access_token).
- **S5:** [EDPB — Guidelines 06/2020, slutlig version](https://www.edpb.europa.eu/documents/guideline/guidelines-062020-on-the-interplay-of-the-second-payment-services-directive-and_en).
- **S6:** [IMY — GDPR i fulltext, särskilt artiklarna 5, 28 och 32–35](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/introduktion-till-gdpr/dataskyddsforordningen-i-fulltext/).
- **S7:** [Riksdagen — lag (2010:751) om betaltjänster, 1 kap. 6 § och 3 kap. 17–18 §§](https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-2010751-om-betaltjanster_sfs-2010-751/).
- **S8:** [Enable Banking — Terms of Service, 2026-01-09](https://enablebanking.com/terms/).
- **S9:** [Open Payments — aktuella juridiska dokument](https://www.openpayments.io/legal).
- **S10:** [IMY — Personuppgiftsbiträdesavtal](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/personuppgiftsansvariga-och-personuppgiftsbitraden/personuppgiftsbitradesavtal/).
- **S11:** [IMY — Personuppgiftsbiträdets skyldigheter vid incident](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/personuppgiftsincidenter/personuppgiftsbitradets-skyldigheter/).
- **S12:** [FI — IKT-risker och DORA](https://www.fi.se/sv/betalningar/it-risker-dora/).

## 8. Testkvitto och överlämning

### Verifierat lokalt resultat

Linux, **Node v24.22.1**, låsta installationer utan ändrade beroenden/låsfiler. Alla testdata och bankresurser är syntetiska. Testprocessernas heap begränsades till 512 MiB och helsviterna kördes med en testfil i taget. Följande avslutade körningar har exitkod 0:

| Kontroll | Faktiskt resultat | Körning / omfattning |
| --- | --- | --- |
| Hela Node-sviten | **1 575/1 575** | `NODE_ENV=test node --import ./scripts/saas-test-isolation.mjs --test --test-concurrency=1 test/*.test.js` |
| Hela Sites-sviten | **3 145/3 145** | `NODE_ENV=test CLOUDFLARE_CF_FETCH_ENABLED=false npm run test:isolated` i `sites/` |
| Hela SFTP-bridgen | **47/47** | `NODE_ENV=test npm --prefix bridge/bankgiro run test:isolated` |
| Fokuserad säkerhetsacceptans | **92 Node +388 Sites =480/480** | `node scripts/run-saas-security-acceptance.mjs <evidence-directory>`; TAP/JSON genererat |
| Ny A/B/C-matris | **15/15** | Egen åtkomst, sex riktade cross-owner-attacker, duplicerade byte/fakturanummer, Bankgiro A, original, förlorad identitet, kryptering och samtidiga leases |
| Syntax och typer | **Godkända** | Root `npm run check` kontrollerade 140 JavaScript-filer; Sites typkontroll och bridge-syntaxkontroll exit 0 |
| Beroendegrindar | **0 high/critical** | Root 0 fynd; full Sites-audit 8 moderate; Sites `--omit=dev` 0 fynd; bridge `--omit=dev` 0 fynd |
| Installerad minimatch-mitigering | **Verifierad** | `node scripts/minimatch-backport.mjs --check --require-target`: 1 target, 0 writes |
| Sites produktionsbygge | **Godkänt** | `CLOUDFLARE_CF_FETCH_ENABLED=false npm run build`; kvarvarande verktygsvarningar om sourcemaps/dynamiska imports är inte åtgärdade här |
| CI-konfiguration | **Validerad** | YAML läsbar; alla använda actions bundna till fullständiga verifierade commit-SHA:er; preload före filglobben |

Helsviterna omfattar **4 767 tester**, med **0 fel, 0 skips, 0 avbrutna och 0 TODO**. De **34 nya testfallen** ingår i dessa totaler. Fokus-/RED/GREEN-körningarna överlappar helsviterna och adderas inte till totalen.

En separat agent gjorde statisk oberoende granskning av samtliga produktionsrättningar, testfixturer, körskript, paketkommandon, workflows och säkerhetsrapporten. **Inga bekräftade critical/important-fynd återstod i diffen.** Granskaren gjorde inga ytterligare testkörningar eller extern juridisk verifiering; testkvittona ovan är den faktiska exekveringsevidensen. Installationsavbrott, det stoppade metadataanropet och rättad npm-/flaggkontext är öppet dokumenterade i [arbetsloggen](security-acceptance-plan.md).

### Överlämning till Agent 8

Lokala resultat gäller denna PR:s kodändringar mot den angivna basen. GitHub Actions verifierar publicerade commits på Node 22 och sparar `report.json` med faktiskt Git-SHA och arbetskopiestatus. Kontrollera det senaste PR-huvudets Checks och bevarade artefakt; återanvänd inte ett tidigare grönt kvitto efter kodändringar.

Agent 8 ska koppla dessa tester till frysta producerande företags-/roll-/provider-/consent-SHA:er och komplettera de blockerade matrisraderna på den sammanslagna SaaS-koden. Godkända regressioner ger inget kommersiellt releasebeslut. Samtliga tidigare produktionspoäng behålls på **255/330 =7,73/10; 0/33 ≥9,5**.
