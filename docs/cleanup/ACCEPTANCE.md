# Acceptansunderlag – kodstädning 2026-11-07

## Källäge och leveransgräns

Basen är verklig `main` **4c7b210a0553314c2d9ce95804b892b891f4fe36**, kontrollerad igen efter implementationens början. [PR63](https://github.com/sharbel0022/Mgeorge/pull/63) är sammanslagen och innehåller de integrerade funktionerna från PR64–69. Ingen äldre main återställdes och dessa ändringar mergades inte om.

Den här filen beskriver implementationen och verifieringsunderlaget före den nya normala integrationen. **Slutligt main-SHA, GitHub-körningar, faktisk publicering och genomförda grenåtgärder måste läsas i den nya PR:ens slutliga releasekvitto och leveransrapport.** Inget planerat remote-resultat räknas som genomfört här.

## Vad som ändras

| Område | Leverans |
| --- | --- |
| Moduler | Stabila domäningångar i `packages/`; serverns komposition använder dem. Befintlig implementation och kompatibilitetsvägar finns kvar. |
| AI | En gemensam provider-/policykärna med tunna Node-/Sites-adaptrar, konfigurerbar modell, separata godkännanden, beständiga dags-/månadsbudgetar och säker reservmodell. |
| Lokal start | `npm start`, `dev`, `setup`, `doctor`, `stop` och `build`; versionskontroll, säker första konfiguration, låsta lokala beroenden, autentiserad HTTP-beredskap och ordnad avslutning. |
| Administrativ status | `/api/admin/ai-status` under aktuell `manage_integrations` i båda miljöerna; liten statusvy i befintliga inställningar. Ingen aktivering eller providerbegäran. |
| Dokumentation | Ny svensk README, modulregister, produktions-/lokaldiagram, dataflöde och start-/AI-guider. Äldre README och säkerhetsunderlag bevaras. |
| Ekonomiska skydd | Inga förenklade valideringar, inga automatiskt godkända AI-betalningsuppgifter och inga avsiktliga finansiella produktionsskrivningar. |

[Modulernas ansvar och ingångar](../../packages/README.md) · [Arkitekturens 14 frågor](../architecture/ARCHITECTURE.md) · [Dataflöde](../architecture/data-flow.md) · [SVG](../architecture/architecture.svg) · [Mermaid](../architecture/architecture.mmd).

## Granskade fel och riktad evidens

Uppstartens oberoende granskning hittade verkliga fel vid stopp under installation, kontinuerligt droppande HTTP-svar och sparande av vissa DB_PATH-värden. Separata RED/GREEN-fall verifierar ägarskap till barnprocesser, absoluta tidsgränser, bytegränser och exakt dotenv-roundtrip. Slutlig fokussvit på rättningscommit `be943c3` gav **26/26 på Node 22.23.4 och 26/26 på Node 24.22.1**. [Rättningsrapport](reviews/startup-fixes.md) · [Oberoende omgranskning](reviews/startup-rereview.md).

AI-granskningen fångade en återöppnad reservation när granskningsmetadata för en anpassad modell ändrades. Kostnadsidentiteten är nu stabil över sådana ändringar; kanoniska och historiska nycklar spärras atomärt i SQLite/D1 med fortsatt ägarbindning. Rättningscommit `813f82d` gav **94/94 Node/D1 och 28/28 Sites**. [Första granskning](reviews/ai-initial.md) · [Oberoende omgranskning](reviews/ai-rereview.md).

Den tidigare kompletta Sites-körningen på `4e638d7` gav **5 954/5 954**, och separat produktionsbygge lyckades. Den är ett deluppgiftskvitto före senare rättning/statusvy och ersätter inte hela den samlade kandidatens obligatoriska CI. Detsamma gäller tidigare fulla Node-körningar. Alla slutliga obligatoriska grindar ska knytas till exakt PR-head/merge-checkout och därefter verklig main.

## Verklig lokal start i den samlade versionen

En ny ren checkout av `9fc922739cb3522d34a3b9e854bc98262b6f32ba` verifierades med Node 24.22.1/npm 11.9.0 utan `.env` eller `node_modules`. `npm start` installerade låsta beroenden, skapade privat konfiguration och gav HTTP 200 för hälsa och frontend. Ctrl+C frigjorde båda portarna. Omstart, `npm run stop`, `npm run dev` och bevakad omstart lyckades. Saknad AI-nyckel respektive ogiltig modell visade separata spärrkoder och appen fortsatte svara. Portkonflikt lämnade den ursprungliga lyssnaren vid liv. [Komplett fryst smoke-paket](startup-smoke/README.md) innehåller exakta kommandon, loggar, källmanifest och hashkontroll. Senare diagnosrättning ändrar endast vilken AI-ägare statusrouten kontrollerar; ordinarie startkod är samma.

## Obligatoriska slutgrindar

Node 22 och 24 fullsviter, Sites fullsvit/typer/bygge, Bankgiro-bryggan, AI-spärrar, Gmail-/OCR-återhämtning, SQLite/D1, säkerhetsacceptans, Chromium, syntetiska 1/10/100-företag och beroendeaudits ska köras med projektets befintliga CI/profiler. Överlappande fokus-/säkerhetstester räknas inte som extra unika fullsvitetester. Lokala förutsättningsfel, resursavbrott och miljöblockerad Chromium ska redovisas som sådana; de blir inte gröna genom att hänvisa till äldre CI.

Starten ska dessutom provas med faktisk ren checkout, saknad `.env`, saknad AI-nyckel, ogiltig modell, portkonflikt, Ctrl+C, `stop`, omstart och `dev`. Linux är den verifierade plattformen; portabel Windows-kod och Windows-sökvägssträngar utgör ingen genomförd Windows-processacceptans.

Den lokala fulla Chromiumprofilen byggde samtliga tre riktiga testbundlar, men Chromium kunde inte starta eftersom exekveringsmiljön avvisar dess Unix-socket (`Operation not permitted`). Inget appresultat räknas som godkänt från det försöket. [Källbundet miljökvitto](browser-local-environment.json). Den obligatoriska browseracceptansen körs i GitHub CI.

## AI-konfiguration och driftsättning

Nyckel och modell lämnas tomma och AI är avstängt i exemplet. `configured` betyder giltig lokal konfiguration; `policyStatus` visar företagets aktuella tillåtlighet. `liveVerified` är alltid false i denna läsande kontroll. Före kundöverföring behövs dokumenterade sekretess-/säkerhets-/kostnadsbeslut, exakt ägar-/organisationsbindning och separat godkänd liveverifiering. Se [AI-guiden](../integrations/openai.md).

Vid byte av reservationsidentitet ska gamla AI-konsumenter vara stoppade/avstängda tills alla konsumenter använder samma version. Den opublicerade första anpassade modellimplementationen ska inte aktiveras. Denna release gör inga kundanrop och lägger inte till produktionshemligheter. `.env` kopieras aldrig till Cloudflare.

## Grenar och återställbarhet

[Fullständig inventering](branch-inventory.md) och [maskinläsbara exakta heads](branch-inventory.json) omfattar de 80 registrerade remotegrenarna. Pågående `feature/95-saas` bevaras även om dess head är en förfader till main. Unika eller oklart godkända tips hålls kvar. Kandidat betyder inte raderad.

Före varje faktisk borttagning krävs färskt oförändrat head, inga öppna PR-/aktiva arbetsberoenden, tillåten borttagning, verifierad arkivering utanför grenarna och kontroll att den godkända koden finns i main. Manifest, återställningskvitto och faktiska resultat ska redovisas separat. Main får aldrig raderas eller skrivas om.

Den separata städningshjälpen är oberoende granskad och dess 27 fokuserade prov använder verkliga temporära Git-repositoryn och falskt läs-API. Den kräver ett uttryckligt manifest, stämmer av båda PR-sidor, aktuell main/head och skydd, skapar verifierade fjärrarkiv och ett fristående återställt bundle före borttagning samt skyddar varje deletion med exakt SHA-lease. [Svensk driftguide](../operations/branch-cleanup.md) · [Granskning](reviews/release-review.md). Den kör inte automatiskt på main eller PR.

## Produktion och dataintegritet

[Den läsande förkontrollen](production-baseline.json) avser publicerad **Site 70** och befintlig projektidentitet. Den visar en verifierad fryst backup på **490/490 original, 219 752 807 byte**, manifest_pass, kontrollerad 2026-11-07T10:18:01.106Z. Detta är inte en produktionsåterställningsövning.

Vid förkontrollen var bankanslutningen `reauth_required`, Bankgiro `SOURCE_NOT_CONFIGURED`, Gmail-schemat inte verifierat och dokumentkön hade 445 underlag för granskning/33 väntande OCR. Köstatus är en tidsbunden observation. Ingen kodmerge reparerar automatiskt externa medgivanden, schemautlösning eller optisk recall. En full bytejämförelse av produktionsdatabasen har ännu inte gjorts i denna leverans; endast faktiskt genomförda före-/efterkontroller får anges i slutkvittot.

## Alla 33 kvalitetsområden

**258,5/330 = 7,83/10; 27/33 minst 8. Inga poäng höjs.** [Samtliga 33 rader](33-assessment.md) · [kriterier och kvarstående risker](33-assessment.json). Kodstruktur och säker start är leveransförbättringar, men de skapar inget nytt bankmedgivande, optiskt facit eller kommersiellt godkännande.
