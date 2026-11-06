# Testregister — Agent 9

**Full samlad CI är godkänd på exakt slutkod 0ce2604.** PR-head, faktiskt checkout, tree, källmanifest, miljö och loggintegritet har verifierats. Äldre och riktade körningar hålls separata nedan.

## Samlad full CI på fryst slutkod

**PASS.** [Payment control checks 42091716726](https://github.com/sharbel0022/Mgeorge/actions/runs/42091716726) och [SaaS security acceptance 42091716587](https://github.com/sharbel0022/Mgeorge/actions/runs/42091716587) är båda completed/success.

| Källbindning | Verifierat värde |
| --- | --- |
| PR-head | `0ce2604de16b77bf96ff76ccedab115f61a3f9ac` |
| Git-tree | `50d1ec1226d7ced62bb640707740244c4504ab4c` |
| Faktisk GitHub PR-merge-checkout | `248bb4d1a7148e53cfbdd80aaef441dbc5efe26e` — exakt samma Git-tree |
| Källmanifest | `26a872b83111f36afde95e9f7dc2f17342f8b162865728e6d31d530ee042f94e` |
| Filer | Alla **1 270** manifestfiler är självständigt jämförda med exakta Git-bytes; sex jobb har samma rena, oförändrade manifest |
| Artefakter | Sju ZIP-digests stämmer mot GitHub; **86** logg-/rapportreferenser har rätt byteantal och SHA-256 |

Det [maskinläsbara slutkodskvittot](evidence/ci-code-0ce2604.json) innehåller alla jobbsteg, faktiska miljöer, tider, testfiler, auditvärden, täckning och artefakthashar. Faktiska TAP-slutsummor har jämförts med JSON-kvittona. GitHubs syntetiska merge-checkout skiljs från PR-head och har bevisat identiskt innehåll.

| Slutkodens svit | Godkända / körda | Kommentar |
| --- | ---: | --- |
| Node 22.23.4 | **2152/2152** | Full svit, låst installation, 224 JavaScript-filer syntaxkontrollerade och audits |
| Node 24.22.1 | **2152/2152** | Samma svit på andra Node-versionen |
| Sites på Node 24.22.1 | **4128/4128** | Full svit, låsta installationer, typer/minimatchguard, audits och produktionsbygge |
| Bankgiro SFTP-brygga | **47/47** | Syntetisk SSH/SFTP/HTTP och recovery, syntax/audits |
| Chromium | **46/46** | 41 onboardingfall och 5 företags-/workspacefall; noll externa förfrågningar |
| Separat säkerhetsacceptans | **332 Node + 843 Sites = 1175/1175** | Överlappande urval, tre företag/fyra roller och syntetiska 1/10/100-skalprov |

Alla ovanstående testkvitton har **0 fail, 0 cancelled, 0 skipped och 0 TODO**. Backendantalet över Node, Sites och bridge är **2152+4128+47=6327 fall**. Den andra Node-körningen upprepar samma svit. Säkerhetsurval och riktade prov adderas inte som nya unika backendfall. Browserfallen redovisas separat.

Alla obligatoriska installationer, syntax-/typkontroller, kontroller av installerade mitigationbytes, produktionsbygge och auditgrindar passerade. Rootens och bryggans hela dependencygrafer samt Sites produktionsgraf har **0 auditfynd**. Sites utvecklingsgraf redovisar **8 moderate paketposter**, inga high/critical; befintlig minimatch-backport är verifierad. Grön produktionsaudit är inte ett påstående att utvecklingsgrafen saknar advisories.

### Faktiskt uppmätt täckning

| Profil | Unika källor / LCOV-poster | Täckta / uppmätta unika källrader | Andel | Rå LCOV-radandel |
| --- | ---: | ---: | ---: | ---: |
| node v22.23.4 | 81/105 | 11 241/12 101 | 92.89% | 42.57% |
| node v24.22.1 | 81/105 | 11 244/12 101 | 92.92% | 42.58% |
| bridge v24.22.1 | 2/2 | 412/421 | 97.86% | 97.86% |
| sites v24.22.1 | 88/88 | 8 488/10 661 | 79.62% | 79.62% |

Unika radträffar och råa upprepade LCOV-poster har olika nämnare. Tabellen mäter **bara laddade produktionskällor**. Oimporterad kod och browserkod saknas i LCOV, och mappningen från transformerad kod till ursprungskällan är inte generellt verifierad. Ingen fullständig repotäckning eller automatisk betygshöjning påstås.

### Syntetisk belastning

| Företag | Importerade | Replay/dubbletter | Förväntat upptaget | Oväntade fel | p95 per försök |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 10 | 20 | 1 | 0 | 153.28 ms |
| 10 | 100 | 200 | 10 | 0 | 594.60 ms |
| 100 | 1000 | 2000 | 100 | 0 | 453.47 ms |

Totalt 1 110 importer, 2 220 dubbletter och 111 förväntade ACCOUNT_BUSY, med korrekt isolering och 0 oväntade fel. Detta är riktig lokal SQLite och syntetisk provider, seed 95, högst fyra parallella företagsjobb. Latens är informativ och inte en produktions-SLA; verklig banklatens, D1/R2 och distribuerad kapacitet återstår.

Efterföljande rapportcommit ändrar endast dokument/evidens och ska få egen full CI. Den slutliga PR-headens kvitto knyts i PR 49:s verifieringskommentar och den fristående evidensbilagan, så att ett dokument inte påstår sin egen framtida commit-SHA. Den här tabellen fortsätter att avse exakt 0ce2604 och dess källmanifest.

## Avgränsade producentgrindar

Samtliga nedanstående frysta head hade både Payment control checks och SaaS security acceptance gröna före integration. Säkerhetsacceptansen överlappar fullsviterna och adderas inte till deras antal. En andra Node-version är en separat körning, inte nya unika beteendefall. Tabellen omfattar de slutligt granskade PR 47-/PR 54-kompletteringarna.

| PR | Fryst head | Node | Sites | Bridge | Full körning |
| --- | --- | ---: | ---: | ---: | --- |
| [45](https://github.com/sharbel0022/Mgeorge/pull/45) | `ac1abdc54692` | 2013 | 3938 | 47 | [42085542333](https://github.com/sharbel0022/Mgeorge/actions/runs/42085542333) |
| [46](https://github.com/sharbel0022/Mgeorge/pull/46) | `732bfb3f16ab` | 1997 | 3868 | 47 | [42082127273](https://github.com/sharbel0022/Mgeorge/actions/runs/42082127273) |
| [47](https://github.com/sharbel0022/Mgeorge/pull/47) | `875876ae539f` | 2026 | 3851 | 47 | [42088065668](https://github.com/sharbel0022/Mgeorge/actions/runs/42088065668) |
| [50](https://github.com/sharbel0022/Mgeorge/pull/50) | `1619c0e3a63b` | 2003 | 3893 | 47 | [42085643991](https://github.com/sharbel0022/Mgeorge/actions/runs/42085643991) |
| [51](https://github.com/sharbel0022/Mgeorge/pull/51) | `0954777f10da` | 2035 | 3905 | 47 | [42081949245](https://github.com/sharbel0022/Mgeorge/actions/runs/42081949245) |
| [52](https://github.com/sharbel0022/Mgeorge/pull/52) | `eb4242f78317` | 2053 | 3898 | 47 | [42086208019](https://github.com/sharbel0022/Mgeorge/actions/runs/42086208019) |
| [53](https://github.com/sharbel0022/Mgeorge/pull/53) | `d9ca037a90ef` | se CI | se CI | se CI | [42082680240](https://github.com/sharbel0022/Mgeorge/actions/runs/42082680240) |
| [54](https://github.com/sharbel0022/Mgeorge/pull/54) | `3db9f01305aa` | 2004 | 3874 | 47 | [42090903888](https://github.com/sharbel0022/Mgeorge/actions/runs/42090903888) |

Den tidigare PR 47-körningen på 8a083 verifierade dessutom samma 2 023 fall på Node 24, 46 Chromiumfall (41 onboarding och5 workspace) och 1/10/100 syntetiska företag. Dess checkout 1880ac2 har exakt samma träd ed59308 som 8a083. Alla sex artefakt-ZIP:ar hämtades och kontrollerades mot GitHubs SHA-256 före läsning av kvitton. Denna tidigare mätning ersätter inte samlad slut-CI.

## Kompletterande samverkansprov

På exakt 5414e226 / träd c37b15b8 kördes 512/512 tester i 24 kompletta filer. 1 260 spårade filer kontrollerades före och efter utan ändring. Faktisk lokal HTTP, SQLite-processkonkurrens, migration/replay, båda avstämningsmotorerna, företagsisolering och backup/restore ingår. Se [separat rapport](SUPPLEMENTARY-5414.md) och [maskinkvitto](evidence/supplementary-5414-result.json).

En separat kontroll av krypterad central loginbackup/restore gav 3/3: sparad budget/sluttid bevaras, utgånget fönster öppnas korrekt och äldre snapshot får den additiva tabellen först vid limiterstart. Försök efter snapshoten följer inte med. Proben ändrade inte produktionskod och var inte ett repo-test vid den körningen.

Root körde dessutom 336/336 i åtta kompletta bank-/HTTP-/medgivande-/SaaS-filer på 5414. Detta kompletterar, men överlappar andra sviter. 5414 var före den sista UTF-8-rättningen och före sena producentkompletteringar; resultaten tillskrivs inte senare head.

PR 52:s breda lokala syntes med main gav 1 635/1 635 i 46 filer, syntax 183 filer och gröna typer. Slutproducenten gav 165/165 i sex relevanta filer. PR 54:s kompatibilitetsfix gav 60/60 i tre kompletta filer, 2/2 genom verklig worker/route samt grön typecheck. Inget av dessa lokala antal summeras med full CI.

## Bevarade underkända försök

- Basens första lokala Sites-installation avslutades 137 innan produktkod ändrades. Begränsad installationsheap/maxsockets gav senare komplett låst installation. Delvis installerade paket och module-not-found-körningar är ogiltiga miljöförsök, inte gröna produkttester.
- Ett tidigt lokalt Sites-banktest avslutades på filprocessnivå. Orsaken till varje generiskt SIGKILL/SIGABRT har inte härletts från namnet; där heap-exhaustion skrevs ut betecknas det uttryckligen som OOM. Ett senare korrekt CI-kvitto gäller sitt egna head.
- PR 47:s ursprungliga b24-körning hade Node 24-workerstartupfel och Sitesfel i npm-identitet/instrumentering. Den var inte grön. 707f-körningar avbröts av efterföljande head. 8a083:s nya sexjobbskörning blev grön efter konkreta rättningar.
- PR 45:s för stora rekursiva testmoduler gav ett explicit lokalt heapfel. Modulcache-rättningen bevarade assertions och följdes av 278/278 bankfall samt ny full CI på ac1.
- OCR-cleanup, sökning, proveniensrace och UTF-8 har separata faktiskt observerade RED-kvitton före rättning. Skapade negativa assertions är inte samma sak som att ett tidigare fel har reproducerats; båda delarna dokumenteras där RED→GREEN påstås.

## Vad slutgrinden omfattar

`payment-control-ci.yml` kör låsta installationer, rekursiv syntax, Sites typer och minimatchguard, fulla Node 22/Node 24/Sites/bridge-sviter, produktionsbygge, fulla och produktionsbegränsade npm-audits, Chromium och syntetisk prestanda. `saas-security-acceptance.yml` kör separat nätverks-/credentialisolerad acceptans på Node 22. Inga riktiga bank- eller kundanrop ingår.

TAP/JUnit-acceptans kräver minst ett test, komplett totalsumma, lika många pass som tests och noll fail/cancelled/skipped/TODO. Processfel, timeout, saknade loggar eller ändrat källmanifest under körning underkänner. Coverage avser bara laddade produktionsfiler; oimporterad kod, transformerade data-moduler och browserkod blir inte full repotäckning.

Prestandagrinden använder riktig lokal SQLite med syntetisk provider: 1/10/100 företag, tio transaktioner per företag, högst fyra samtidiga företagsjobb och seed 95. Den kräver 1 110 importer, 2 220 dubbletter och 111 förväntade ACCOUNT_BUSY. Latens/throughput är mätningar utan påhittad produktions-SLA. Verklig banklatens och D1/R2-kapacitet återstår.

High/critical-auditfynd stänger grinden. Moderate-fynd redovisas ändå. Installerade mitigationbytes granskas separat från npm-advisories; en grön produktionsaudit betyder inte att hela dev-toolchain saknar advisories.
