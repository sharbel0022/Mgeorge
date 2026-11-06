# Oberoende review: bankharnessens modulminne

## READY

**READY för exakt `7a5a397c6543fd762d86005369d6740448876cfe`, bas `d294fd87b04d1bf65b124be5ad3dd1bd2654fd73`. Inga kvarstående viktiga fel har verifierats inom den smala harnessändringen.**

Den oförändrade hela `banking-security.test.mjs` har körts en gång i en egen fryst git-archive-snapshot: **273/273 pass, exit 0, 0 fail/cancelled/skipped/todo**, 61,014 sekunder och **807 608 KiB max-RSS**. De temporära bankmodulernas egna kataloger var borta efter körningen. Fem riktade egna riskprov passerar också. De räknas separat från banksvitens 273.

## Exakt avgränsning och källkontroll

Produktdiffen innehåller endast `sites/tests/banking-security.test.mjs`, 17 tillagda och 3 borttagna rader. Ändringen utökar Node-importerna, ersätter data-URL-lagringen i `jsUrl` med innehållshashade `.mjs`-filer och lägger till katalogens `after`-cleanup.

Jag jämförde de frysta filerna byte för byte. Följande är oförändrat:

- Hela `compiledModule`, inklusive alla standardspecifiers, importmappningar, overrideordning, transpileinställningar och ersättningsloopar.
- Alla andra ursprungliga importstatements utanför de explicita Node-importändringarna.
- Hela suffixet från `class LocalD1 {` till EOF: fixtureimplementation, ytterligare importmappningar, alla testkroppar och assertions. Min avgränsning börjar på `c` utan föregående radbrytning och omfattar 179 425 bytes.
- Samtliga produktfiler enligt commitdiffen. Ingen produktväg ändras.

Kandidatkällan kontrollerades även efter körningarna och matchar fortfarande den frysta commitblobben. Dess SHA256 är:

```text
4bfafdbbf08c9c2eaa61c61a37b10571abf5fe23caa8cbdfcf28a43cff48efd0
```

Egna snapshots finns i `base/` och `candidate/`. Beroenden kopierades från en befintlig fysisk installation först efter att båda lockfilerna konstaterats byteidentiska. Inga beroenden installerades eller ändrades. Alla egna prober och loggar ligger utanför kandidatsnapshotens testfil.

## Bedömning av modulidentitet, isolering och cleanup

Gamla data-URL:er identifierade moduler med deras kompletta UTF-8-bytes. Den nya funktionen använder SHA256 av samma bytes inom en per-harness unik `mkdtemp`-katalog. Identiska bytes får samma fil-URL och samma ESM-namespace under körningen. Olika fixturetexter innehåller fortsatt sina ursprungliga unika `globalThis`-nycklar och får egna moduler. Importmappningen har inte ändrats.

Detta avlägsnar den upprepade inbäddningen av transitive beroendens källkod i varje förälders data-URL. Referenserna blir korta fil-URL:er. Ändringen tömmer **inte** Nodes ESM-cache och gör inget sådant anspråk.

`jsUrl` utför sin filkontroll och skrivning synkront utan en await-punkt. Samtidiga async-fixtures i samma JavaScript-isolat kan därför inte växla mellan dess `existsSync` och `writeFileSync`. Separata runnerprocesser har olika `mkdtemp`-kataloger. Befintlig fil måste ha exakt samma bytes; avvikelse kastar `Synthetic module hash collision`. Nya filer skrivs exklusivt med `wx` och mode 0600 i en katalog med mode 0700.

Cleanup registreras som en top-level `after`-hook för hela testfilen. Den tar bort just dess egen katalog efter testerna. De egna processproven kontrollerar att en sen await/import fortfarande fungerar och att katalogen sedan försvinner efter både framgång och ett avsiktligt testfel. Barnets cleanup tar inte bort föräldraharnessens separata katalog.

## Faktiska körningar

| Körning | Pass / tests | Exit | Max-RSS | Kommentar |
| --- | ---: | ---: | ---: | --- |
| Fryst full banking-security | **273 / 273** | **0** | **807 608 KiB** | Hela filen, inget testfilter eller tyst split |
| Egna riskprov, slutlig processharness | **5 / 5** | **0** | 50 024 KiB | Alla förväntningar bevarade |
| Egna riskprov, första processharness | 3 / 5 | 1 | 50 104 KiB | Två barnkörningar startade inte; råfel bevarade |
| Cleanup-barn, framgång | 2 / 2 | 0 | — | Ingår i de fem riskproven |
| Cleanup-barn, avsiktligt assertionsfel | 1 / 2 | 1, förväntat | — | Cleanup verifierad trots det avsiktliga felet; ingår i riskproven |

Banksviten kördes efter att producentens fulla körning hade avslutats. Min RSS-mätning kommer från Linux `resource.getrusage(RUSAGE_CHILDREN).ru_maxrss` för den enda Node-invokationen och dess reaped testprocess. Inga alternativa heapgränser eller ärvda `NODE_OPTIONS` användes. Ett eget `TMPDIR` användes för att entydigt följa filcleanup; det var tomt före och efter.

Exakt Node-kommando, med kandidatens rot som cwd:

```sh
NODE_ENV=test TMPDIR=/workspace/scratch/4d79ab4bea8e/reviews/bank-harness-memory-7a5a397-independent/runtime-temp /opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --import ./scripts/saas-test-isolation.mjs --experimental-strip-types --test --test-reporter=tap --test-concurrency=1 sites/tests/banking-security.test.mjs
```

`run-full-bank.py` är den sparade tunna mätwrappern. Exakta start/sluttider, kommando, miljöoverride, rålogg och RSS finns i `logs/full-bank-result.json`. Rå TAP ligger i `logs/full-bank.tap` med SHA256:

```text
1507a0a3b35bacd248f20edf7e147beeca0664664b0eb35bcdf1b7679b57d660
```

## Egna riktade riskfall

1. Identiska källbytes, inklusive Unicode och Buffer-input, får samma URL och återanvänder samma namespace, jämfört med den frysta gamla loadern. Olika bytes ger skild identitet; faktiska filbytes och 0600/0700 kontrolleras.
2. Sexton samtidigt importerade, separata fixturegrafer med flera modullager behåller sina egna objekt och värden. URL-längden växer inte med moduldjupet.
3. En redan skapad fil med avvikande bytes avvisas i stället för att användas som den begärda modulen.
4. En fristående framgångsrik testprocess kan göra en sen await/import och tar sedan bort endast sin egen modulkatalog.
5. Samma livscykel fungerar vid ett avsiktligt assertionsfel; detta barnfels exit 1 och rålogg är förväntade delar av cleanup-provet.

`loader-under-test.mjs` innehåller själva nya helperblocket byte för byte från kandidatfilen, med endast separata testimports/exports för observation. Hela riktiga banksviten använder däremot den oförändrade riktiga kandidatfilen.

## Bevarat initialt fel i den egna probeharnessen

Första egna körningen gav 3 pass / 2 fail. Barnprocesserna ärvde `NODE_TEST_CONTEXT` från förälderns `node:test`; Node svarade `run() is being called recursively within a test file. skipping running files.` De körde därför inte de avsedda child-testerna. Detta var ingen visad kandidatbugg och räknades inte som pass.

Jag sparade första källan, råloggarna och kvittot oförändrade. Endast den egna fristående barnprocessens ärvda `NODE_TEST_CONTEXT` togs bort. `NODE_ENV=test`, samma isolation-preloader, TMPDIR och alla övriga miljövärden behölls. Samtliga egna assertions är oförändrade; korrigeringsdiffen finns i `own-harness-correction.diff`. Den riktiga kandidatfilen ändrades aldrig.

## Tidigare RED och slutsatsens gränser

Roots gamla frysta rålogg visar **SIGKILL efter 221 godkända testfall**, och dess mätkvitto anger **3 009 760 KiB** max-RSS. Den tidigare kombinerade körningens avbrott efter 228 gröna bankfall finns också dokumenterat i det frysta underlaget. Kopior med oförändrade bytes finns i `baseline-evidence/`. Dessa är underkända eller avbrutna körningar, inte pass. Signalens avsändare eller exakta historiska orsak är inte självständigt bevisad enbart av RSS och SIGKILL.

Den aktuella fixen har nu ett helt genomfört eget 273-fallsresultat med samma testkroppar och väsentligt lägre uppmätt RSS, samt riktade identitets-/isolering-/cleanup-prov. Det räcker för READY på denna avgränsade kandidat. Det ersätter inte integrerad CI eller framtida granskning vid utökning av sviten.

Ingen ny optisk körning, bank/provider/live-anrop, produktändring, merge eller publicering gjordes. `review-evidence.json` samlar hela kvittot och hashmanifestet, inklusive de initiala egna felen. Fullbank och egna riskprov redovisas som separata mängder.
