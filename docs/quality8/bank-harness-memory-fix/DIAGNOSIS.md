# Banktestharness: begränsad modulladdning efter SIGKILL

## Fryst ändring och resultat

**Commit:** `7a5a397c6543fd762d86005369d6740448876cfe`.

**Bas:** `d294fd87b04d1bf65b124be5ad3dd1bd2654fd73`.

Endast `sites/tests/banking-security.test.mjs` ändras: 17 tillagda och 3 borttagna rader i loaderns importer, `jsUrl` och städning. Den fulla ofiltrerade banksviten är nu **273/273 grön**, exit 0, utan fail/skip/cancel/TODO. Max-RSS är **783 912 KB**, jämfört med root-basens avbrutna fullkörning på **3 009 760 KB**. Testtiden var 55,284 sekunder. Ingen ny temporär modulkatalog blev kvar.

Detta är implementationens verifieringskvitto. Den separata oberoende granskningen och integrationen hanteras av root; denna rapport är inget eget oberoende READY-beslut.

## Observerat fel och avgränsad orsak

Root körde två fulla bankpopulationer utan assertionsfel före filavbrottet. Den första integrerade körningen innehöll 420 gröna fall totalt och ett filfel: banken hade hunnit till 228 gröna fall och avbröts efter cirka 70,8 sekunder. Den särskilda TAP-körningen visade den faktiska signalen: **SIGKILL**, ingen normal child-exitkod, efter 221 gröna bankfall och cirka 63,9 sekunder. `resource`-kvittot rapporterade max-RSS 3 009 760 KB. Båda originalkvittona och råloggarna är kopierade utan ändring till `original/` och hashbundna i evidensmanifestet.

Det finns ingen tillgänglig cgroup-montering eller kernel-OOM-logg i granskningsmiljön. Jag påstår därför inte att en viss kernel-OOM-killer eller en exakt konfigurerad 3 GB-gräns är bevisad. SIGKILL, hög minnesförbrukning och olika stoppunkter pekade på resursproblemet; den kontrollerade loaderändringen och den fullständiga gröna körningen med cirka 74 procent lägre max-RSS ger ytterligare stöd för diagnosen.

Loadern var byteidentisk i publicerad `41aadcef`, tidigare bankkandidat `638c773`, I1-fix `e66cde` och den integrerade basen `d294fd8`. Varje fixture skapar en ny UUID-bunden global kontext och därmed en ny kompilerad ESM-graf. `compiledModule` bäddade tidigare hela beroendets base64-kod i dess import-URL. Nästa modul bäddade sedan in denna URL igen. MCP-modulen får till exempel hela den redan expanderade service-URL:en som importsträng.

Node dokumenterar att ESM-moduler löses och cachas efter URL, separat från `require.cache`: [officiell ESM-dokumentation](https://nodejs.org/api/esm.html#urls). Detta förklarar varför det inte räcker att radera fixturets globala nyckel efter testet. Slutsatsen om hur just den här harnessen växer bygger dessutom på dess källkod, mätningen nedan och före-/efterkörningarna.

### Ren kompileringsmätning

En mätning bygger endast en fixtures modulsträngar. Den importerar inte de genererade modulerna och kör inga banktester eller nätverksanrop. Samma graf mättes med den ursprungliga data-URL-transporten respektive korta virtuella fil-URL:er.

| En fixtures 13 unika moduler | Data-URL | Korta fil-URL:er |
| --- | ---: | ---: |
| Sammanlagd genererad JS-källa | 1 773 220 byte | 161 022 byte |
| Sammanlagda modul-URL:er | 2 364 676 byte | 1 417 byte |
| Enbart MCP-modulens URL | 1 517 276 byte | 109 byte |

De virtuella fil-URL:ernas exakta längd är mätningens kontrollerade värde, inte ett påstående om varje verklig tempkatalogs längd. Den viktiga skillnaden är att beroendekod inte längre kopieras in i importnycklarna.

## Minsta ändringen

`jsUrl` skriver nu modulens oförändrade UTF-8-bytes till en SHA256-adresserad `.mjs`-fil i en processunik `mkdtemp`-katalog. `pathToFileURL` ger dess korta import-URL. Identiska bytes ger samma modulidentitet inom processen, som med den gamla deterministiska data-URL:en. Olika fixture-nycklar fortsätter att ge olika modulgrafer och samma explicita importbindningar.

Om en hashfil redan finns måste dess bytes vara identiska. Annars kastas ett explicit fel. Nya filer skapas exklusivt med `wx` och mode `0600`; de skrivs aldrig tyst över. Katalogen tas bort av en normal `node:test`-after-hook när filens tester avslutats.

Detta rensar temporära diskfiler efter körningen. Det påstås inte eviktera Nodes ESM-cache efter varje test. Ändringen tar bort de stora nästlade URL-strängarna och de inbäddade beroendekopiorna; kvarvarande modulidentitet och fixtureisolering behålls.

## Kompatibilitet och bytebevis

Alla `compiledModule`- och `jsUrl`-konsumenter har inventerats: den vanliga bankfixturen, betalningsvyns TSX-graf och HTTP-MCP-routen. De tolv kompilerade källfilerna använder inte `import.meta`, `__filename`, `__dirname` eller `createRequire`; ingen av deras aktuella konsumenter kräver data-URL-format. De explicita importmappningarna och JSX-inställningarna är oförändrade.

`compiledModule` är byteoförändrad. **Hela suffixet från `class LocalD1` till EOF är byteoförändrat:** 179 426 byte, SHA256 `a270e84103371a0896d2a18fe881a2a341d5399a0f5994e39839123dc945e4d5`. Det omfattar samtliga fixtures, anropsplatser, testkroppar och assertions. Inga testnamn, populationer, expectations, tester, skip-markeringar eller tidsgränser har ändrats. Ingen svit har delats upp eller duplicerats.

Git-diffen mot den frysta basen innehåller endast testfilen. Produktträden `src`, `sites/lib`, `sites/components`, `sites/app`, `scripts` och `sites/scripts` är identiska. Arbetskopian är ren på den frysta committen. Testfilens nya SHA256 är `4bfafdbbf08c9c2eaa61c61a37b10571abf5fe23caa8cbdfcf28a43cff48efd0`.

## Exakta körningar

Node `v24.22.1` på `/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node`, `NODE_ENV=test`, samma isolationpreloader, type stripping och testkonkurrens 1 som root-basens körning. Fullkörningen har inget testnamnsfilter och ingen höjd heapgräns.

| Körning på fryst 7a5a397 | Tester | Pass/fail | Exit | Max-RSS KB | Tid s |
| --- | ---: | ---: | ---: | ---: | ---: |
| Riktade konsumenter: fixture, TSX, HTTP-MCP | 6 | 6/0 | 0 | 273 192 | 2,938 |
| Hela ofiltrerade `banking-security.test.mjs` | 273 | 273/0 | 0 | 783 912 | 55,284 |

Båda körningarna har noll skip/cancel/TODO, oförändrad källhash under körningen och noll nya tempkataloger kvar. De sex fokuserade fallen ingår i de 273 och ska inte räknas ytterligare. Ett tidigare 6/6-kompatibilitetsprov före tillägget av den explicita kollisionskontrollen är separat bevarat och räknas inte som verifiering av den slutliga committen.

Syntaxkontroll och `git diff --check` avslutade också exit 0. Inga transportavbrott inträffade. Ingen bred övrig CI, optisk körning, riktig bankkontakt, produktionsändring, poängändring eller V3-hantering har gjorts. Den andra granskarens fullkörning ska ske efter denna körnings slut för att undvika överlappande minnesbelastning; avslut meddelades direkt.

## Bevarade artefakter

`evidence.json` binder kommandon, källor, loggar, resultat och hashar. `full-bank-final.json` och `logs/full-bank-final.tap` innehåller hela slutkörningen. `byte-preservation.json`, `product-preservation.json` och `harness.diff` visar den snäva ändringen. `loader-baseline-comparison.json`, `consumer-inventory.txt`, `module-graph-measurement.json` och mätskriptet visar analysen. Alla root-RED-kvitton finns oförändrade under `original/`.
