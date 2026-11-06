# Agent 5 — automatisk betalningsavstämning

Datum: 2026-11-05. Branch: `feature/95-reconciliation`. Bas:
`4ad205b84d1852ec7ed33cabd70fdadbe2f9d5c5`.

## Resultat och omfattning

Leveransen rättar tre reproducerade problem i den befintliga betalningskedjan:

1. Två oberoende, korrekt styrkta betalningar kunde blockera varandra när samma
   betalare hade flera fakturor. Node och Sites använder nu en gemensam,
   deterministisk slutbedömning av konkurrerande betalningar.
2. Sites kunde för företag utan den särskilda referenspolicyn använda en manuellt
   ändrad betalare eller referens som automatiskt betalningsbevis. Automatik kräver
   nu en individuell bankkälla med bevarade bankuppgifter. Manuella beslut och
   rättningar kan fortfarande tilldelas uttryckligen efter granskning.
3. Sites CSV-import kunde tolka en kolumn för bankens transaktions-ID som en
   fakturareferens. Kolumner för bank-ID hålls nu utanför OCR-/fakturatolkningen,
   samtidigt som originalet, kolumnpositionerna och bank-ID-fälten bevaras.

Alla ekonomiska skrivprov använder syntetiska uppgifter i isolerade lokala
databaser. Leveransen innehåller ingen produktionsmigration eller ombokning.
Förändringen tar inte bort historiska tilldelningar och ändrar inga bankoriginal.

Målet 9,5/10 är en acceptansambition. Resultaten nedan styrker den avgränsade koden
och dess regressioner; de ger ingen statistiskt uppmätt felprocent i produktion
eller ett nytt produktionsbetyg. Befintliga numeriska kvalitetspoäng behålls.

## Inventering av befintlig motor

| Del | Befintligt ansvar | Ändring i denna leverans |
| --- | --- | --- |
| `src/reconciliation.js` | Återläser bankoriginal, kontomedgivande och källspärrar; analyserar faktura/betalning; skriver under SQLite-lås. | Gemensam slutbedömning, stabil ordning och regelversion `evidence-reconciliation-2026-11-05.1`. |
| `sites/lib/reconciliation-engine.js` | Ren analys av kontrollerade fakta, referenser, betalare, belopp, datum och konflikter. | Samma slutbedömning och regelversion som Node. |
| `sites/lib/reconciliation.ts` | Projekterar arbetsytan till analysen, lär tidigare betalarkopplingar och tillämpar säkra förslag. | Håller manuella ersättningsuppgifter utanför automatiken och bevarar typad referensevidens. |
| `sites/lib/reconciliation-evidence.ts` | Återläser lagrade original, granskar källa/konto och binder analysen till aktuella uppgifter. | Manuellt granskade bankkopplingar får fortsatt aktuell original-/kontodiagnostik även när automatisk tilldelning är spärrad. |
| `src/db.js`, `sites/lib/domain.ts`, Sites lagringslager | Tillgängliga pengar, fakturasaldo, delbetalningar, återbetalningar, samlingsposter, återtag och atomisk audit. | Befintliga regler behålls; nya tester kör verkliga tilldelningar, återimport och omkörning. |
| `sites/lib/reconciliation-contract.js` och preview-adaptrar | Skrivfri förhandsgranskning med `VERIFIED`, `REVIEW`, `BLOCKED`, originalreferenser och snapshot-bindning. | Befintligt kontrakt behålls; separat från den automatiska skrivvägen. |
| `sites/lib/imports.ts` | Tolkar CSV-kolumner och bevarar bankens individuella uppgifter. | Bankreferens och externt transaktions-ID får inte bli OCR-/fakturaidentitet. |

## Beslutsprocess

Alla belopp beräknas i heltalsöre. Ett matchningspoängtal är en prioritering för
granskning; det är inte behörighet att ändra en fakturas betalningsstatus.

1. **Källa och original:** befintliga adapterkontroller kräver bevarat bankunderlag,
   oförändrade fakta, användbart konto och aktuell behörighet. Konflikter, återtag,
   otillräcklig specifikation eller saknade original spärrar nya automatiska beslut.
2. **Identitet och ekonomi:** exakt användbar referens, verifierbar betalarkoppling,
   rätt riktning/valuta, tillåtet datum och exakt återstående fakturabelopp måste
   stämma. Ledande nollor och betydelsefulla identifierartecken bevaras.
3. **Konkurrens:** den gemensamma slutbedömningen får undanta en svag korsreferens
   endast när betalningen redan har exakt en självständigt säker fakturamatchning.
   Delbetalning, överbetalning, källa som behöver granskas eller overifierat original
   ger inget sådant undantag. Verkliga dubbletter och flera säkra destinationer hålls.
4. **Beslut:** endast en entydig, kvarvarande säker matchning per betalning kan
   tilldelas automatiskt.
   Sannolika samband och beloppslikhet lämnar saldot oförändrat och visas för
   granskning. Manuellt ändrade bankuppgifter blir aldrig nya automatiska bankfakta.
5. **Commit:** befintliga SQLite-/D1-skrivgränser kontrollerar tillgängligt belopp,
   aktuell arbetsyta och behörighet. Beslut och audit sparas tillsammans.

Den nya slutbedömningen ändrar inte indata. Resultat ordnas med säkerhet, poäng,
betalnings-ID, faktura-ID och kategori som fasta sorteringsnycklar. Konkurrerande
betalnings-ID:n sparas i `competing_transaction_ids`. Ett tidigare osäkert beslut
behåller sin ursprungliga spärrorsak, exempelvis referenskonflikt eller återkallad
källbehörighet, i stället för att få en generell dubblettförklaring.

### Manuella beslut och CSV-referenser

`bank_api`, `bank_file` och `bankgiro_file` är tillåtna individuella källkategorier
för automatiken, tillsammans med de befintliga original-/kontokontrollerna. En
manuellt registrerad post eller manuellt uppdelad samlingspost måste få ett
uttryckligt tilldelningsbeslut. En manuell verifiering av helt oförändrade,
intakta bankuppgifter fungerar fortsatt. Tidigare manuella tilldelningar bevaras.

Typad bankreferensevidens finns kvar även efter en manuell verifiering. Därför kan
en rättning från 0577 till 0599 inte dölja bankens ursprungliga 0577, och en ogiltig
OCR-kontrollsiffra försvinner inte vid bekräftelse. Manuellt ersatta historiska
betalaruppgifter får heller inte lära automatiken en ny kundidentitet.

Den befintliga aktualitetskontrollen omfattar fortsatt manuellt granskade poster
med en bankkälla i sin ursprungskedja. Därmed visas ett bortkopplat konto även för
en manuell uppdelning eller rättning. Återställt medgivande tar bort just
kontospärren och skapar ingen automatisk tilldelning av de manuella uppgifterna.

I CSV betyder en header som enligt importschemat är bankreferens eller externt
transaktions-ID just detta. Värdet sparas där och i originalfilen. OCR, uttryckliga
fakturanummer och fakturareferenser i meddelanden analyseras fortfarande; verkliga
konflikter mellan dessa döljs inte.

## Testmatris och de efterfrågade exemplen

| Fall | Förväntat och verifierat beteende | Testunderlag |
| --- | --- | --- |
| 0597 jämfört med 0577 | Fel referens tilldelas inte. Två separata, exakt styrkta betalningar matchar var sin faktura även med samma betalare. | Gemensam beslutskorpus och Node/Sites batchintegration. |
| Faktura 0599, 625 SEK | Exakt individuell bankbetalning tilldelas 62500 öre en gång. Fel eller saknad referens ger inte samma beslut. | Beslutskorpus och batchintegration. |
| 2500 SEK mot 3125 SEK | Visas som delbetalning för granskning. Efter uttrycklig tilldelning återstår 625 SEK; en senare exakt styrkt betalning kan reglera resten. | Befintliga delbetalningstester och båda nya persistenssviterna. |
| Flera betalningar på samma faktura | Verkliga konkurrerande fullbetalningar hålls som möjlig dubbelbetalning. Granskade delbetalningar summeras med bibehållen historik. | Beslutskorpus, databas-/domäntester och delbetalningsintegration. |
| Samma betalare, flera fakturor | Belopp eller namn ensamt avgör inte. Distinkta exakta referenser kan matcha samtidigt utan den tidigare falska konkurrensspärren. | Framåt-/bakåtordning med lika och olika belopp i båda motorerna. |
| Samlingsinsättning, flera betalare | Ursprunglig samlingspost och kompletta individuella poster representerar ett enda penningbelopp. Ofullständiga summor, saknade barn eller motsägande underlag hålls. | Befintliga Bankgiro-, original-, preview- och integritetssviter; negativa korpusfall. |
| Överbetalning 700 SEK mot 625 SEK | Kräver granskning; uttrycklig tilldelning av 625 SEK lämnar 75 SEK disponibelt på betalningen. Överskottet reglerar inte automatiskt en annan faktura. | Båda nya persistenssviterna och befintliga Bankgirotester. |
| Återbetalning/återföring | Bevarad finansiell betydelse och rätt riktning krävs. Explicit återbetalning kan hantera en granskad kredit; återföring kan inte maskeras som vanlig inbetalning. | Node quality-cycle, Sites manual-return och Bankgiro/integritetstester. |
| Saknad OCR, fel kontrollsiffra, liknande nummer | Ingen gissning eller automatisk korrigering. `0599` och `599` är olika identiteter. | Beslutskorpus, typade referenstester och nya manuella provenienstester. |
| Bankreferens mot härledd/manuell referens | Bankens bevarade kandidater styr säkerheten. Manuella ändringar eller bankens transaktions-ID skapar ingen automatisk fakturareferens. | Proveniens- och CSV-regressioner. |
| Återkommande synk och konkurrerande skrivare | Återimport och omkörning ger inte dubbla tilldelningar. Oförändrad avstämning ger ingen extra ekonomisk audit. | Nya SQLite-/D1-tester samt befintliga verkliga tvåprocess- och återstartstester. |
| Ändrat fakturaoriginal eller bortvalt konto | Ingen automatisk tilldelning, oförändrat saldo. | Nya Sites-tester med verklig originalläsning och kontokontroll. |

De nya persistenssviterna omfattar 8 Node-fall och 10 Sites-fall. Node använder
verklig SQLite, import, `allocate` och `runReconciliation`. Sites använder SQLite
bakom D1-fixturen, lagrade originalobjekt, konto-/medgivandekontroller samt
`reconcileAndPrepare` och `writePaymentState`. Positiva bankbevisfunktioner ersätts
inte med stubbar. Fixturernas uppgifter och providerresurser är syntetiska.
Den manuella del-/överbetalningen i dessa Sites-fixturer skapas med verklig
`applyCommand` följd av fixturlagring. De momenten är inte separata prov av den
manuella HTTP-routen eller dess audit-skrivare; den automatiska fortsättningen
kör däremot den verkliga persistens- och auditvägen.

## Audit, idempotens och granskningsgräns

Node lagrar det automatiska beslutet tillsammans med tilldelningen under samma
skrivtransaktion. Sites binder beslut och audit till arbetsytans revision och
kontrollerar källa/medgivande vid skrivningen. Den nya beslutskontexten visar
konkurrerande betalnings-ID:n och behåller den egentliga spärrorsaken. Även två
annars exakta men overifierade observationer kan ge en försiktig dubblettvarning;
varningen gör dem inte säkra och ersätter inte orsaken att bankoriginal saknas.

De nya integrationstesterna jämför tilldelnings-ID:n, belopp, transaktioner,
lagrade original och audit före/efter upprepade importer och avstämningar. En ny
import kan få ett transportkvitto; samma pengar får ingen ny betalningstilldelning
eller duplicerad ekonomisk audit. Tidigare granskade delbetalningar bevaras när
en senare betalning reglerar det exakta återstående beloppet.

Den separata statiska granskningen av allokering/återbetalning och den skrivfria
förhandsgranskningen gav inget ytterligare reproducerat fel. Den certifierar inte
alla historiska återuppbyggnader: det automatiska Node-beslutet innehåller inte
en komplett fristående snapshot av originalhashar och kontomedgivande. En
historisk rekonstruktion efter senare importberikning behöver även följa lagrade
original och auditkedjan. Ingen ny full sådan återuppbyggnadsövning påstås här.

En separat slutgranskare inspekterade de ändrade matchningsreglerna, proveniens-
och CSV-skydden samt regressionerna och läste därefter uttryckligen slutdiffen
`32058aa` för dubblettvarning/kontodiagnostik. Inga ytterligare konkreta fel
rapporterades. Granskningarna var statiska och avgränsade; de ersätter inte de
exekverade slutgrindarna. En separat rapportgranskning kontrollerade nämnare,
testomfattning och källhashar; påpekade preciseringar är införda.

## False-positive- och false-negative-analys

Korpusen i `test/helpers/reconciliation-decisions.mjs` har 26 i förväg angivna
scenarier: 5 med totalt 8 förväntade tilldelningar och 21 som ska lämnas utan
automatisk tilldelning. Facit anger faktura-ID, betalnings-ID och belopp separat
från motorernas resultat. Extra eller dubbla tilldelningar räknas som false
positives; uteblivna förväntade tilldelningar räknas som false negatives.

| Motor och version | Korrekta tilldelningar | Missade tilldelningar, FN | Felaktiga tilldelningar, FP | Negativa scenarier korrekt hållna |
| --- | ---: | ---: | ---: | ---: |
| Node, bas `4ad205b` | 2/8 | 6 | 0 | 21/21 |
| Node, denna ändring | 8/8 | 0 | 0 | 21/21 |
| Sites, bas `4ad205b` | 2/8 | 6 | 0 | 21/21 |
| Sites, denna ändring | 8/8 | 0 | 0 | 21/21 |

På scenarionivå går respektive motor från 2 korrekta positiva och 3 falskt negativa
till 5 korrekta positiva och 0 falskt negativa. Det är samma delade korpus körd
genom två implementationer, inte två oberoende populationer.

Maskinläsbara resultat med regelversion, commit, källhashar, korpushash och varje
enskilt facit/utfall: [före](reconciliation-95/before.json) och
[efter](reconciliation-95/after.json). Körningarna är rena motorprov med betrodda
syntetiska adapterfakta. Originalverifiering och lagring prövas separat ovan.

Den separata Sites-provenienssviten reproducerade en otillåten extra automatisk
tilldelning i vart och ett av sina 8 negativa fall före rättningen. Alla 10 fall
passerar efteråt, inklusive de två kontrollerna för oförändrad verifiering och
bevarad manuell tilldelning. De 3 CSV-fallen reproducerade också fel före ändringen och
passerar efteråt. Dessa riktade regressioner är ingen skattning av hur ofta felen
förekommit i verkliga kunddata.

Kvarstående avsiktlig försiktighet kan ge manuellt arbete: saknad referens,
osäker kundidentitet, flera konkurrerande betalningar och del-/överbetalningar
autoallokeras inte. Testfacit betraktar dessa som korrekta granskningsbeslut.
En verksamhetsmässig recall-mätning behöver därför skilja korrekt granskning
från verkligt missade, automatiskt avgörbara betalningar.

## Verifieringskvitto

Lokal huvudsaklig runtime: Node `v24.22.1`, npm `11.9.0`. Fryst runtimecommit:
`32058aa6e9eeb75e601a52ffd85b5e9a381d187b`. Låsfilerna är oförändrade.
PR:ns faktiska checks är kvittot för den samlade Node 22-körningen; lokala
delkörningar nedan presenteras med sina verkliga begränsningar.
Det maskinläsbara [lokala verifieringskvittot](reconciliation-95/verification.json)
binder källfiler, logghashar, testantal, avvikelse, byggen och audit till denna kod.

Redan avslutade kontroller på den frysta implementationen:

- Node full isolerad svit: 1937/1937, 0 fel/skip/cancel/TODO, exit 0.
- Sites isolerad helkörning: 3751 godkända, 1 fel på filnivå i
  `banking-security.test.mjs`, exit 1. Filen hade hunnit rapportera 70 godkända
  deltester. Separat omkörning på samma Node 24 och samma kod: 130/130 godkända,
  exit 0, utan skip/cancel/TODO. Sammanlagt är 3811 distinkta Sites-fall godkända
  över dessa körningar (`3751 + 130 − 70`); den ursprungliga helkörningen är
  fortfarande underkänd och kallas inte en grön helsvit.
- `npm run check`: 173 JavaScript-filer syntaxkontrollerade.
- Sites `npm run check`: TypeScript godkänd.
- Bryggans `npm run check` och 47/47 isolerade tester: godkända.
- Sites exakta minimatchkontroll: 1 mål, 0 skrivningar, `verified`.
- Sites sekventiella produktionsbygge: godkänt, exit 0, med Cloudflare-hämtning
  avstängd.
- High-audit: inga high/critical. Node och bryggan har 0 fynd. Sites har 8 befintliga
  moderate utvecklingsfynd och 0 fynd med `--omit=dev`.
- Riktad persistens-/preview-/samtidighetskörning: 95/95.
- Riktad slutkörning av CSV/manuell proveniens/bankoriginal/integritet: 55/55.
- Separat kompatibilitetskörning på Node `v22.13.0`: 38/38 Node-fall och 206/206
  Sites-fall, inklusive hela `banking-security.test.mjs` och de nya regressions-
  och persistensfallen; 0 fel/skip/cancel/TODO. Dessa överlappar ovanstående fall.

Totalt har 5795 distinkta lokala testfall passerat över Node, Sites och bryggan,
med avbrottsbegränsningen för Sites ovan. Råantal från den separata omkörningen
adderas inte utan att de 70 överlappande fallen räknas bort. Den korta felrapporten
från helkörningen angav `test failed` för processen utan ett assertion-fel;
den exakta avbrottsorsaken är inte fastställd. Ett parallellt byggförsök avslutades
också med 137. Dessa utfall redovisas som misslyckade försök, inte betalningsbevis
eller godkända slutgrindar.

Riktade sviter överlappar helsviterna och adderas inte till ett unikt totalantal.
Före första rättningen reproducerades 11 fel av 58 nya delade motorfall; efter
rättningen passerade den kombinerade fokuserade körningen 124/124. Tidiga
heltestförsök avbröts före implementationen: en Node-körning överlappade Sites
installation och såg övergående saknad `xlsx`, och Sites-körningen var ofärdig.
De räknas inte som godkända baslinjer eller slutgrindar.

Den första helkörningen efter ändringarna upptäckte två integrationseffekter:
Node:s försiktiga dubblettutkast och Sites kontodiagnostik för manuell uppdelning.
Körningarna avbröts och räknas inte som slutgrindar. Båda befintliga felande
testernas kontroller behölls, ytterligare regressioner lades till och den
korrigerade fokuserade körningen passerade 54/54 Node och 101/101 Sites.

Två äldre förväntningar ändrades uttryckligen med rättningen: verifiering av en
manuellt skapad specifikationsrad kräver nu ett separat `match.create`, och en
giltig CSV-OCR får inte längre en falsk konflikt från bank-ID-kolumnen. Testernas
övriga original-, manipulation-, belopps-, audit- och historikkontroller behålls.

### Reproducerbara kommandon

Från repository-roten efter låst installation i root, `sites` och `bridge/bankgiro`:

```bash
npm run check
NODE_ENV=test npm run test:isolated
npm audit --audit-level=high
npm --prefix sites run check
NODE_ENV=test CLOUDFLARE_CF_FETCH_ENABLED=false WRANGLER_SEND_METRICS=false npm --prefix sites run test:isolated
node sites/scripts/minimatch-backport.mjs --check --require-target
npm --prefix sites audit --audit-level=high
npm --prefix sites audit --omit=dev --audit-level=high
CLOUDFLARE_CF_FETCH_ENABLED=false WRANGLER_SEND_METRICS=false npm --prefix sites run build
npm --prefix bridge/bankgiro run check
NODE_ENV=test npm --prefix bridge/bankgiro run test:isolated
npm --prefix bridge/bankgiro audit --omit=dev --audit-level=high
node scripts/measure-reconciliation-decisions.mjs --assert pass
```

Före-jämförelsen kör samma mätprogram och samma facit med `--source-root` mot en
ren checkout av bascommitten, med dess låsta beroenden tillgängliga. Skriptet
öppnar ingen databas eller bankanslutning.

## Återstående acceptans för målet 9,5

En produktionsbedömning kräver ett representativt, separat facit med verkligt
auktoriserade bankoriginal, aktuella konton och rätt företagskontext, inklusive
verkliga kompletta Bankgiro-specifikationer. Andelen automatiskt avgörbara fall,
felaktiga tilldelningar, onödiga granskningsstopp och synkrepetitioner behöver
mätas på det underlaget. Denna PR innehåller inga sådana produktionsobservationer.

Separat Node 22-acceptans och publiceringsstatus ska läsas från PR:ns faktiska CI.
Lokal Node 24-verifiering är inte ett påstående om att GitHub Actions redan har
passerat. Ingen merge eller driftsättning ingår i denna leverans.
