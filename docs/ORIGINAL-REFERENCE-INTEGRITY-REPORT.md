# Originalreferenser, samtidiga uppladdningar och avstämningskostnad

2026-11-02. Fortsättning från main `38769f2f58ef2448915a782b29c803ecc31e8a15` och Sites 54. Detta är en sanerad teknisk rapport; privata original, kunduppgifter, ursprungliga kontrollsummor och nycklar ingår inte.

**DELVIS LEVERERAD – TEKNISKT ARBETE ÅTERSTÅR.** Denna cykels granskade rättningar finns på main `cc2be7b` med godkänd exakt CI och är publicerade som Sites 55. Skrivfri efterkontroll passerar i den redovisade omfattningen. Hela engineering-målet är fortsatt delvis uppfyllt. Alla 33 kvalitetspoäng behålls på sammanlagt 255/330 = 7,73/10; 0/33 når 9,5. [Maskinläsbart leveranskvitto](ORIGINAL-REFERENCE-INTEGRITY-DELIVERY.json).

## Reproducerade fel och rättningar

| Fel | Reproduktion och rättning | Verifieringsgräns |
| --- | --- | --- |
| P2: samtidiga identiska uppladdningar skapade dubbla originalposter | Båda anropen läste frånvaro före väntan på R2 och infogade sedan varsin rad. Det gav tvetydig exakt hashkontroll. Manuell uppladdning och Gmail gör nu atomisk ägar-/hashvillkorad infogning och läser den faktiska vinnaren. Gmail binder källa, bearbetningskö och räknare till samma dokument. | 15 nya fall: 12 förväntade RED, sedan 15/15 GREEN. Befintliga och nya uppladdnings-/Gmail-/Bankgirofall 243/243. Okänt D1-utfall bevarar bytes; bara en bevisat oanvänd egen uppladdning städas. Historiska dubbletter repareras inte automatiskt. |
| P1: backup kunde certifiera saknade refererade original | SQLite integrity_check kunde vara grön trots FK-fel. Sites kunde rapportera komplett 0/0 när dokumentmetadata saknades bakom en faktura. Båda motorerna kontrollerar nu deklarerade originalreferenser och kända historikfält; Node kontrollerar även främmande nycklar. | Verkliga syntetiska databaser, krypterade arkiv och faktisk backupmotor. Node create/verify/restore avvisar skadade snapshotar innan arkiv eller nytt återställningsmål publiceras. Sites stoppar skapande och återupptagen verifiering. |
| P1: historiska original och ett motstridigt länkkvitto undgick första rättningen | Oberoende granskning hittade original som efter bilagebyte/detaljuppdatering bara fanns i audit, samt en ändrad Node Bankgiro-länks originalhash. Kända producentfält i audit, genererade specifikationsbeslut och aktiva/återtagna länkar valideras nu mot bevarade original. | Samtliga konkreta fynd fick nya RED-fall och rättades. Slutliga nya referensfall: Node 40/40, Sites 216/216; riktad backup totalt Node 88 pass/8 befintliga EPERM-skip och Sites 257/257. Giltiga äldre former och avvisad Gmail-markör bevaras. |
| P2: upprepad namnnormalisering gjorde avstämningen dyr | CPU-profil av 50 syntetiska par visade normalisering i de innersta jämförelserna. Båda rena analysmotorerna återanvänder nu exakt normalisering per full sträng inom samma anrop. | Ingen finansiell omkontroll tas bort. Ny analys läser ändrade namn, organisationer, länkar och konton på nytt. Fem bokstavligt förväntade identitets-/Unicode-/konkurrensfall per motor passerar. |

Ändrade produktmoduler: `src/backup.js`, `src/reconciliation.js`, `sites/app/api/files/route.ts`, `sites/lib/gmail-service.ts`, `sites/lib/backup-engine.ts` och `sites/lib/reconciliation-engine.js`. Inga paket, låsfiler, migrationskällor, åtkomstregler eller scheman ändrades.

## Samma syntetiska volymprov före och efter

[Runner](../scripts/measure-reconciliation-volume.mjs), [före](measurements/reconciliation-volume-before.json) och [efter](measurements/reconciliation-volume-after.json) har samma runnerhash. Den faktiskt laddade domänfilens hash är lika. Alla åtta hashjämförelser av rena analysresultat och alla fyra av allokeringsfakta stämmer; ursprunglig indata och syntetiska bankoriginal är oförändrade.

| Lokal mätning | Före | Efter |
| --- | ---: | ---: |
| Sites domänavstämning, 100 fakturor + 100 betalningar | 51 773 ms | 3 761 ms |
| Ren Node-analys, 400 + 400, median av tre prov | 732 ms | 162 ms |
| Ren Sites-analys, 400 + 400, median av tre prov | 812 ms | 175 ms |

Det fullständiga lokala 100-parsfallet blev cirka 13,8 gånger snabbare. Dess diagnostiska 20-sekundersgräns var först RED och sedan GREEN; den är inte ett tidskänsligt CI-test. Referenser, betalare och belopp är avsiktligt syntetiska och oberoende. Runnern binder fyra utvalda källfiler och använder stödimporter från samma checkout; den är inte en fullständigt fristående historisk miljö, en produktions-SLA eller ett mått på alla tvetydiga fall. D1/R2, nätverk och autentisering ingår inte i denna tidsmätning.

## Slutkontroller och granskning

- Rena installationer: root `npm ci --ignore-scripts` och Sites `npm run install:ci` passerar med aktuella CI-skript.
- Windows Node 22.16.0: **1 037 tester, 1 029 pass, 0 fail, 8 befintliga faktiska filsymlänk-EPERM-skip**. De överhoppade fallen framställs inte som körda.
- Sites: **1 845/1 845**, noll fail/skip. TypeScript och produktionsbygge passerar; root syntaxkontrollerar 104 filer.
- Rootaudit och Sites produktionsaudit: noll fynd. Full Sitesaudit: 16 moderate utvecklingsfynd, noll high/critical; aktuell high-grind passerar.
- Oberoende scoped uppladdningsreview och samlad slutreview: **READY efter rättningar**. Slutreview körde själv Node 40 referensfall, Sites 216 och 25 uppladdnings-/normaliseringsfall. Hashbunden rapport och privata reprologgar finns utanför Git.
- Exakt main-CI [41491162166](https://github.com/sharbel0022/Mgeorge/actions/runs/41491162166) på `cc2be7b0f25920c0e1cb8d1b601b5ac5a5ff3717`: båda jobb success; Linux Node **1 036/1 036** och Sites **1 845/1 845**, noll fail/skip, totalt **2 881 godkända tester**, med aktuella installationer/kontroller/audits/bygge.

## Skrivfri produktion före och efter

Före publicering: Sites 54, runtime 9 och arbetsyterevision 42. Två exakta ägarbundna betalningsläsningar är kompletta; den jämförda ekonomiska projektionen är identisk med föregående cykel. AIS räknas en gång och rapporten noll gånger; noll allokeringar och ingen automatisk behörighet. Målregistersökningen är komplett utan träff. Rapportoriginalets integritet/fullständighet passerar. Detta är avgränsade jämförelser, inte en fullständig ledgerexport.

Efter Sites 55: revision **42→42** och exakt oförändrad jämförd ekonomisk projektion, inklusive valda bankfakta, kopplingar och fakturaoriginalets kontrolluppgifter. De två exakta läsningarna och rapportkontrollen är kompletta; målregister 0 träffar. Rapportens hash/integritet är oförändrad. Den bredare referenssökningen har fortfarande `complete=false` och påstås inte vara ett fullständigt referensbevis.

Authklient, åtkomstpolicy, publik webbplats med privat arbetsyta, tre scheman och runtimeposternas redovisade metadata/värden är oförändrade; revision 9. D1-översikten med 26 tabeller och de två gamla partial-kontrollerna är oförändrade, ingen running. Backup- och bankstatus är lika. Gmailkonfiguration, kö och hämtningstid är lika; råstatus skiljer endast i arbetarheartbeat och läsningens beräknade nästa tid. Detta är ingen ny Gmail-hämtning eller färdig OCR-körning. Hemligheters dolda värden har inte exponerats; ingen fullständig R2-/databasbyteexport jämförs här.

Den fullständiga [23-stegskontrollen av bank-/fakturakedjan](MGEORGE-FINAL-ENGINEERING-REPORT.md#verkligt-betalningsfall--23-skrivfria-kontroller) beskriver de separata bevisgränserna. Den nya exakta läsningen ändrar inte dess blockerade allokeringsbeslut.

Bankstyrkt kontoalias/Bankgirokonto, gemensam insättningsidentitet, uttrycklig valuta/datum samt separat verksamhetsbeslut om fakturaregistrering, kundrelation och allokering saknas fortsatt. Inget account_details-anrop görs när den tidigare Retry-After-tiden är okänd. Gmail är anslutet men timschemat är pausat och senaste lyckade hämtning är 2026-10-29. Två historiska betalningskontroller är partial, ingen running. Befintlig backupstatus visar 195 manifestfiler; gammal complete-status omverifieras inte automatiskt mot nya regler och bevisar inte faktisk katastrofåterställning.

Webbläsaren nådde normal OpenAI-inloggning och användaren har valt att logga in. Publicerad startsida/inloggningsgräns är observerad efter Sites 55; ägarautentiserad produktionsvy är ännu inte observerad i testfliken. Inga finansiella knappar, synk-/bearbetningsjobb, fakturaregistreringar, allokeringar, kundmejl eller bankbetalningar har körts av verifieringen.

## Leverans och fortsättning

| Del | Verifierat kvitto |
| --- | --- |
| Main och exakt CI | `cc2be7b0f25920c0e1cb8d1b601b5ac5a5ff3717`, Actions41491162166 success. Tre produktcommits 07dcea4 / 4b2025f / 940a94a och ett första dokumentationskvitto; normal fast-forward-push. |
| Sites-källträd | `c8e911c6e6656d8dafcadc96b61a54fa9d992a98`, exakt lika mellan verifierad main och publiceringskällan. |
| Sites-källcommit | `7ede844f43f5a15937c2dd175fce998fa7c2f3cb`; separat typkontroll och officiellt produktionsbygge/packning passerade. Oförändrade paket-/installationsinputs återanvändes i denna redan öppnade publiceringscheckout. |
| Publicerad version | **55**, `appgprj_6adf2f7f7e848191b64192161886b528~appgver_e31b612e5ca08191ae11ebceb5e89249`. |
| Deployment | `appgdep_6ae8c8d202d88191b5f95c5a272b0c67`, **succeeded 2026-11-02T17:31:19.460444Z**, runtime9, MCP aktivt. [MG Fakturakoll](https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site). |
| Byggartefakt | 347 filer, 20 lokala katalogposter, 0 oväntade privata sökvägar och 0 QA-sökvägar. Lokalt gzip/lokalt tar/serverlagrat tar har olika digests/storlekar och redovisas separat i JSON-kvittot. Matchande källträd och filantal samt native publiceringsproveniens är verifierade; nedladdad serverfilparitet påstås inte. |
| Återgång och oförändrade inputs | Sites54 sparad; inga ändrade migrations-, DB/R2-, paket-/lock- eller runtimehemlighetsdeklarationer. Ingen destruktiv ekonomisk rollback. |

Efterföljande dokumentationscommit uppdaterar detta kvitto utan nytt produkt-/Sites-träd. Dess exakta main-SHA och CI verifieras separat vid push. GitHub-push och Sites-publicering är separata verifierade steg. Fjärrlistan innehåller fortsatt endast main; tidigare godkänd branchrensning upprepas inte.

Fortsätt från verifierad kod/maincc2be7b, exakt Actions41491162166 och Sites55 med ovanstående källa/träd. Hämta aktuellmain och jämför senare dokumentationsskillnader innan testbevis återanvänds. Återstående arbete är bank-/verksamhetsbevis, ägarinloggad UI-acceptans, representativ OCR-/volymutvärdering, godkänt Gmail-schema med faktisk lyckad körning och isolerat katastrofprov med betrodda nycklar/kopia. [Beroendeundersökningen](DEPENDENCY-COMPATIBILITY-FOLLOWUP.md) skiljer nu konfigurerade regler från installerade kapabilitetsprober; en transparent granskad backport är tekniskt möjlig men ännu inte levererad, och auditfynden hålls öppna. Ingen ny obemannad automation har skapats. Alla33≥9,5 eller fullständig slutacceptans påstås inte.
