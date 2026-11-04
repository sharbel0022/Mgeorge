# Agent 6 — verifiering av SaaS-onboarding, 2026-11-04

Branch: `feature/saas-customer-onboarding-ui`.
Granskad bas: `14a042abd37fa455d08da9dfcc096ef4f603b512`.

## Leverans och aktiveringsgräns

Den nya frontendresan är implementerad och lokalt verifierad i den befintliga Sites-applikationen. Den omfattar företagsval/registrering, bank och läsbehörigheter, providerstyrd identifiering, kontoval, separat kontodata/Bankgirostatus, förnyelse/frånkoppling och betalningsöversikt med faktisk referens och evidensstatus. Designen är fortsatt svartvit.

**SaaS-resan är inte aktiverbar med enbart denna branch.** Den granskade huvudbranchen saknar företagsspecifika medlemskaps-, bank- och onboarding-API:er. [Integrationskontraktet](saas-customer-onboarding-ui.md) beskriver en föreslagen version 1-gräns och ansvar för Agents 1–5. Det är inte ett redan accepterat backendkontrakt. Befintliga ägarbundna bankendpoints används endast av den tydligt märkta äldre vyn; frontend låtsas inte att ett `companyId` ger dessa endpoints företagsisolering.

Vid ett första uttryckligt 404-svar på företagskatalogen kan den befintliga arbetsytans bankvy visas. Det gäller endast utan företagsparameter och innan SaaS-katalogen har accepterats. Andra fel döljer privata data och erbjuder inloggning eller ny läsning. En företagsspecifik URL får aldrig växla till äldre ägardata.

## Ändringens omfattning

| Del | Ansvar |
| --- | --- |
| `sites/lib/onboarding/contract.ts` | Begränsad, versionerad validering av hela svaret, nästlade företags-ID:n, tider, belopp, referenser och exakt serverstyrd redirectväg. |
| `sites/lib/onboarding/client.ts` | Privata JSON-anrop, säkra svenska fel, CSRF-/idempotenshuvuden, 20-sekundersgräns och aktuell åtgärdsbehörighet. |
| `sites/lib/onboarding/request-scope.ts` | Företags-/generationsbunden avbrytning och kontroll av sena svar. |
| `sites/components/onboarding/` | Kontrollerad kundresa och separata presentationskomponenter med native-kontroller, statusmeddelanden och modal fokus. |
| `sites/styles/saas-onboarding.css` | Svartvit responsiv layout och synligt tangentbordsfokus. |
| `sites/app/bank/page.tsx`, `sites/app/layout.tsx` | Monterar den nya resan och dess stil, med kompatibel befintlig bankvy. |
| Tester och dokumentation | 45 nya Sites-testfall, 41 isolerade Chromiumfall, syntetiska fixtures, API-överlämning och hashbundet browserkvitto. |

Inga beroenden/låsfiler, ekonomiska beräkningar, saldon, allokeringar, databas-/tenantmigrationer, providerinställningar eller scheman ändras. Ingen kunddata eller hemlighet ingår i tester eller skärmbilder.

## Lokala slutgrindar

Miljö: Linux, Node **24.22.1**, npm **11.9.0**. Kontrollernas exakta kommandon och lokala logghashar finns i [verification-results.json](saas-onboarding-browser/verification-results.json). Root- och bridgekoden har inte ändrats sedan deras fulla sviter kördes i samma session. Sites-grindarna kördes på den slutliga produktkoden efter granskningsrättningarna.

| Grind | Slutresultat |
| --- | --- |
| Root `npm ci --ignore-scripts` | Godkänd installation. |
| Root `npm run check` | 136 JavaScript-filer godkända. |
| Root `npm test` | **1 565/1 565**, inga fel, överhoppade, avbrutna eller todo. |
| Root audit på high-nivå | Godkänd; 0 sårbarheter. |
| Sites `npm run install:ci` | Godkänd; befintlig minimatchgrind tillämpad och verifierad. |
| Sites `npm run check` | Godkänd TypeScript-kontroll. |
| Sites `npm test` | **3 166/3 166**, inga fel, överhoppade, avbrutna eller todo. |
| Sites audit på high-nivå | Godkänd; **8 moderate**, 0 high/critical. Beroendeträdet är oförändrat. |
| Sites `npm run build` | Godkänt produktionsbygge, inklusive `/bank`. Befintliga verktygs-/sourcemapvarningar är inte dolda. |
| Bankgirobridge check/test/audit | **47/47** tester; syntax godkänd, audit 0 sårbarheter. |
| Isolerad Chromiumacceptans | **41/41**, 115 interceptade API-anrop, 0 JavaScriptfel, 0 externa anrop. |

Sammanlagt **4 778 godkända Node/Sites/bridgetester**. Browserfallen är en separat acceptanssvit och räknas inte in igen. Exakt GitHub-head och eventuell Node 22-CI redovisas i PR:ns leveranskvitto; lokala Node 24-resultat är inte ett påstående om en redan avslutad fjärrkörning.

## Kundresa, säkerhet och tillgänglighet

Browserprovet bygger den faktiska bankrouten och dess komponenter/CSS, inte en separat bildmodell. [Det maskinläsbara kvittot](saas-onboarding-browser/acceptance-results.json) binder produktkällor och levererade browserresurser med SHA-256. [Reproduktionsinstruktioner, täckningsmatris och sex skärmbilder](saas-onboarding-browser/README.md) finns bredvid kvittot.

- **320, 390, 768, 1024 och 1440 px:** faktisk viewport kontrollerad, inget horisontellt överflöde, läsbara konton/referenser och monokroma statusar. Alla slutbilder är visuellt granskade.
- **Tangentbord och semantik:** märkta native-fält, radio/checkbox, fieldset/legend, status- och felregioner, hopplänk, synligt fokus, modalt Tab-flöde, Escape och återgång till utlösande knapp. Detta ersätter inte manuellt prov med en riktig skärmläsare eller fysisk mobil.
- **Bankidentifiering:** endast bankens dokumenterade providerprocess kan skapa det serverbundna överlämningssvaret. UI skapar ingen BankID-URL, visar ingen dekorativ BankID-knapp och begär inte betalningsinitiering. Testet verifierar frontendens bankredirect mot en syntetisk serverväg; verklig provider/BankID är inte provad.
- **Callback och medgivande:** avbruten/misslyckad/utgången identifiering återges utan framgångspåstående. `result=connected` räcker inte; färskt företagsbundet medgivande och avslutad serverauktorisering krävs. Saknat/utgånget medgivande spärrar kontoval och synk.
- **Företagsgräns:** medlemskap läses före företagsdata. Byte av företag avmonterar vyn och ogiltigförklarar läsningar och mutationer. Sena A → B → A-svar, sena redirects, 401/403, obehörig företagsparameter och felaktiga nästlade företags-ID:n har regressionsprov. Frontendkontroller ersätter inte serverns tenantauktorisering.
- **Betalningsfakta:** AIS och Bankgiro visas med separata status- och tidsfält; detta förutsätter inte separata samtyckesresurser hos providern. Referens `0000599` behåller nollorna; saknad referens/betalare förblir saknad. Verifierad status kräver ett evidenskvitto. Första framgångsrika hämtningen, inte enbart ett accepterat jobb, visar en bekräftad betalningsöversikt.

## Granskning och rättade fynd

En oberoende slutgranskning identifierade två viktiga statusfel och ett mindre åtgärdsfel. Samtliga reproducerades före rättning:

1. Pollning kunde avbryta ett långsammare pågående statussvar. Pågående läsningar delas nu, varje anrop har en begränsad livslängd och utgången identifiering lämnar snabbpollningen. Ett sex sekunder långt svar under femsekunderspollning blir synligt.
2. Ett tillfälligt väntemeddelande kunde dölja bankens slutresultat. Meddelandet härleds nu från aktuell status; completed/cancelled/failed har var sitt browserprov.
3. Ett valt konto som inte längre stöder import kunde visa en aktiv synkknapp utan effekt. Renderad knapp använder nu samma behörighetspredikat som klickhanteringen, med begriplig förklaring.

Övriga utvecklingsregressioner fångade och rättade dialogens fokusfälla, företagsspecifik 404-fallback, upplåst UI under väntande redirect, osäker företagsregistrering, kontoacceptans utan motsvarande färsk status samt fel valuta-/datumformatering. Misslyckade tidiga utvecklingskörningar räknas inte som slutbevis. En tidsstyrd browserfixture installerade först klockan efter att pollningen startats; testet rättades och hela sviten kördes om. Skärmbildernas scrollursprung korrigerades efter visuell granskning, utan att dölja produktelement.

## Återstående integrationsarbete

1. Agents 1–5 behöver acceptera eller mappa det föreslagna kontraktet till sina verkliga företags-, provider-, medgivande-, Bankgiro- och jobbendpoints. Backend måste själv kontrollera aktuellt medlemskap/roll, Origin/CSRF, state/replay, eventuell PKCE, kontotillhörighet, revision och beständig idempotens.
2. Verklig banktäckning, tillgängliga behörigheter, separat företagsavtal och Bankgirostöd måste komma från dokumenterad provider och faktisk företagsbehörighet. Första hämtningens schemaläggning och lagringskvitto måste implementeras där.
3. Därefter behövs ett auktoriserat end-to-end-prov med riktig provider/callback och relevant hjälpmedels-/enhetsacceptans före SaaS-aktivering.

Alla **33 numeriska kvalitetspoäng behålls på 255/330 = 7,73/10; 0/33 ≥9,5**. Ingen ny Sites-publicering, produktionsskrivning, verklig bankidentifiering eller automatisk produktionshämtning ingår i denna leverans.

## GitHub-överlämning och ny kontraktsavstämning

[PR #38](https://github.com/sharbel0022/Mgeorge/pull/38) är öppnad som utkast mot `main`. Publicerad implementationscommit är `765d9e165d5ba9a773c6eb0792954d1281f2639f`, med filträd `52f199d3ec1880f3dfb87256c4ff25b57e1b99ae`. Trädet är identiskt med den lokalt verifierade implementationen. GitHub-integrationen användes för överföringen eftersom körmiljön saknade Git-skrivinloggning. Den efterföljande kvittouppdateringen ändrar endast dokumentation. Aktuellt PR-huvud och Node 22-CI redovisas i PR:ns beskrivning/Checks.

Vid slutkontrollen hade Agent 2:s Open Payments-adapter och Agent 7:s säkerhetsbranch tillkommit. Oberoende avstämning mot frysta SHA:er bekräftar att ingen av dem implementerar de företagsspecifika webbroutes som frontend behöver. [Kontraktets avslutande mappningstabell](saas-customer-onboarding-ui.md#producer-handoffs-available-at-final-review) preciserar identitet/scopes, verkligt SCA-metodval och challenge, datum/status, serverredirect samt Bankgiro-/betalningsevidens. Ett generiskt decoupled-vänteläge får endast användas när alla nödvändiga challenge-steg redan har hanterats av den dokumenterade providerintegrationen; annars krävs en fungerande SCA-sida eller att banken markeras otillgänglig tills integrationen är klar.
