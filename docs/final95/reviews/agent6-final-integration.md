# Agent 6 — oberoende integration och verifiering

Denna granskning avser integrationskandidaten, inte en ny publicerad version. Slutkandidatens fulla CI och slut-SHA ska läsas i [PR63](https://github.com/sharbel0022/Mgeorge/pull/63). Detta dokument ligger före den slutliga CI-körningen och påstår inte ett framtida testresultat.

## Granskade leveranser

| PR | Exakt granskad kandidat | Faktiska kontrollpunkter | Separata begränsningar |
| --- | --- | --- | --- |
| 66 | `c85f2375f97ea0191f9fbe64cd4190d869aebfaf` | Privat nyckelfil, dubbel sessionscookie, versionsbunden företagsväxling, migrationsbevarande, releasekvitton, 430 original/22 negativa restorekontroller | Betrodd förälderkatalog är en provisioneringsförutsättning. Publik Node som en enda administratör är inte verifierad fleranvändaridentitet. |
| 67 | `b2178405a684ca2cb95cf91153071c5f7736f3cb` | Bunden Gmail-deduplicering, korrelation, lease/heartbeat/kvitto, verifierad klientstatus, återhämtning och förlorad CAS | Verklig OAuth och schemadispatch kräver driftbevis. V2-testet ersätter inte legacytestet; båda vägarna körs. |
| 64 | `ce6fa6158c30b9fb64eac35d74f653be4ae9f568` | Originalhash, företag/lease, policy före request, reserverad budget, schema/ekonomi/identitetskonflikt, obligatorisk granskning | Liveprojekt, krediter och oberoende OCR-/AI-acceptans är inte verifierade. |
| 69 | `38d731c0993ad0c4708d2571a9a18a342f5eb672` | Accepterat run-ID före AI, återkontroll under tokenräkning, cachekostnad, riktig Node-restore, snäv företagsbunden statusläsning, obligatorisk central kontroll | Ingen AI-recovery-release införs. Restoremiljö förblir spärrad. |
| 65 | `9529701a11f0511c7df4beaf80cd3975c9f27e5a` | Status tål historisk flowkontext; kontoval persisterar typad medgivandespärr; fångad transport ser senare avstängning | Callback, token- och kontobehörighet förblir strikta. Inga bankavtal eller medgivanden skapas av testen. |
| 68 | `7cbcba72cd114d0ff19798ee47495cb546d07bc1` | Mottagare före import/duplicate, exakta CAMT-scheman, ägar-/käll-/registreringsbundna kvitton, atomisk giltighetskontroll med databasklockan | Manuell uttrycklig granskning bevaras. Verkliga 0599 / 625,00 SEK kräver separat rapport–AIS–fakturabevis. |

Funktion och bakåtkompatibilitet granskades mot faktiska server-/klientvägar, inklusive legacyprotokoll. Säkerhet och företagsisolering granskades vid läsning, förnyad auktorisering och atomisk skrivning. Dataintegritet granskades genom originalhash, kvitto, replay och ekonomiska spärrar. Kostnadskontroll granskades genom beständiga reservationer, tvetydiga återförsök och restore. Driftstabilitet granskades genom tidsgränser, begränsade batchar, avbrott och korrelerade resultat. Testtäckning kontrollerades i faktisk full upptäckt och den separata centrala säkerhetslistan.

## Verkliga integrationsrättningar

### Gemensamt AI-/workerprov

Aktiverad AI utan erforderliga godkännanden går genom den riktiga workern och den riktiga servern. En förlorad kvittens efter accepterad completion ska återhämtas utan ny extraktion, registrering eller providerrequest. Första körningen gav `ERR_UNSUPPORTED_RESOLVE_REQUEST` eftersom data-URL-testfixturen inte mappade den dynamiska AI-importen. Ett explicit alias rättade fixturen. Det var ett verifieringsfel i den sammansatta testvägen, inte belägg för felaktig modulupplösning i produktion.

RED: 1/1 misslyckat, tree `1c85468553e8ad01460fe3b4abd8d5c6ad53a133`. GREEN: 45/45 på tree `5ab04e052480330fa152609d642d56196b6b250b`. Med PR69:s efterföljande skydd: 65/65 på tree `ac225372f1312d2ff32ebb06a26351a777e787f6`.

### Banktesternas säkerhetsomfång

PR65 lade till testfiler i den gamla inline-listan samtidigt som PR66 flyttade listan till `scripts/lib/saas-security-scope.mjs`. Att enbart välja den nya runnerkoden tappade filerna. Den verkliga runnerns kvitto visade först RED för saknad `test/consent-reconnect-95.test.js`. Både denna och `test/openpayments-runtime-disable.test.js` krävs nu uttryckligen och finns i den centrala listan.

RED: 0/1 på tree `4f2d4c2579501badb998e339d246492bdf8f11c0`. GREEN: 40/40 på tree `aadba68e39cd39ae8b83088c3559e5974e3d179a`. Relaterad Sites-bank-/medgivandekörning: 390/390 på samma tree. Bankgiro med föregående företagsgränsändringar: 37/37 på tree `e0a75bc949fdd9be49877d2213f6940df1af91aa`.

### Sista Gmail-teständringen

Förlorad kvittens kräver fortfarande fel i legacy, där inget kvitto förhandlats. Receipt-v2 får däremot bekräfta den redan lagrade extraktionen. Deltat till `b2178405` ändrar ingen produktionskod, väntetid eller retrygräns. Båda protokollen kräver exakt ett completion-anrop; original, historik och noll registreringar kontrolleras fortsatt. Oberoende granskare läste faktisk workerAction och matchat kvitto. Båda fallen passerade i kombinationen, 2/2 på tree `2294450a4a0b89222ad9435aa26d3b36e45f25dd`.

## Oberoende AI-review med RED före fix

De ursprungliga 14 gränsfallen var röda i [42311011775](https://github.com/sharbel0022/Mgeorge/actions/runs/42311011775). Författarens rättningar återanvändes och de kvarvarande bristerna rättades separat. Ett ytterligare lagringsfel reproducerades i [42314749608](https://github.com/sharbel0022/Mgeorge/actions/runs/42314749608): 18 pass, 1 fail, ett provideradapteranrop när båda obligatoriska centrala kontrolltabellerna försvunnit. `requireControl:true` endast vid central runtime lägger detta fel i stängt läge. Positiv kontroll skapar en verklig ny företagspartition utan lokala kontrolltabeller.

Slutligt oberoende kvitto [42314974203](https://github.com/sharbel0022/Mgeorge/actions/runs/42314974203): 20/20 egna guards, 113/113 Node-relaterade, 26/26 Sites-relaterade, typkontroll PASS, noll fail/cancel/skip/TODO. Artifact 13550935100, 8 872 byte, SHA-256 `afe8236541a0841d359559f6422fa5be4274307434ef36ad57c91feebc9e06dc`. Den kompletterande säkerhetsgranskaren gav klartecken efter egen käll-, logg- och testgranskning.

## Bevisens praktiska gränser

Lokala fokuskörningar använde isolerad testmiljö, nätverksspärr och Node 24.22.1 men länkade redan installerade beroenden med identiska lockfiler. De är felsökning, inte rena fulla releasegrindar. [Rå TAP och hash-/källmetadata](../evidence/agent6-review/verification.json) finns bevarade. Det tidigare lokala avbrottet med exit 137 finns kvar i [avbrottsrecord](../local-interruption.json). Avbrutna eller ersatta CI-körningar räknas inte som godkända.

430-originalsprovet är syntetiskt och rapporterar `productionRestoreTested=false`. 1/10/100-provet kontrollerar riktig SQLite-persistens och isolering, men saknar ett numeriskt latens-SLO. Verklig identitetsingress, nyckelkatalogens provisionering, bankanslutning, Bankgiro-entitlement, distribuerad kapacitet, produktionsrestore och schemakadens förblir separata acceptanser.

Main är observerat oskyddad och har inga repository rulesets. Granskningen har inte ändrat administratörspolicy. Publik utloggad UI har inspekterats, men full autentiserad ekonomisk jämförelse saknar komplett underlag. **Inga nya produktionspoäng eller releasegodkännande följer automatiskt av dessa kod- och fixturebevis.**
