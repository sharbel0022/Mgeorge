# Agent 9 — samlad slutrapport

**Slutbedömning på verifierad kod, 2026-11-05.** Repository: `sharbel0022/Mgeorge`. Arbetsbranch: `feature/95-integration`. Samlad [PR 49](https://github.com/sharbel0022/Mgeorge/pull/49).

**Verifierat kvalitetsbetyg: 250/330, cirka 7,58/10. Full samlad CI och oberoende slutgranskning är godkända på den frysta koden. Målet minst 314/330 är inte uppnått. Kommersiell produktionslansering: NOT APPROVED.** Sju av åtta producenter har levererat; Agent 6:s nya UX-leverans saknas. De lokala förbättringarna är genomförda och verifierade, medan bank-/drift-/kundgrindar fortfarande är öppna.

| Slutkodens bindning | Verifierat värde |
| --- | --- |
| Integrationscommit | `0ce2604de16b77bf96ff76ccedab115f61a3f9ac` |
| Git-tree | `50d1ec1226d7ced62bb640707740244c4504ab4c` |
| Faktisk CI-checkout | `248bb4d1a7148e53cfbdd80aaef441dbc5efe26e` — exakt samma tree |
| Samlad CI | [42091716726](https://github.com/sharbel0022/Mgeorge/actions/runs/42091716726): alla sex jobb success |
| Säkerhetsacceptans | [42091716587](https://github.com/sharbel0022/Mgeorge/actions/runs/42091716587): success |
| Källidentitet | 1 270 filer jämförda byte för byte mot Git; samma rena och oförändrade manifest i samtliga sex huvudjobb |
| Granskning | [Oberoende kodattest](reviews/CODE-REVIEW-1918.md), rotens kontroll och separat 33-komponentsgranskning |

Den efterföljande rapportcommitten ändrar endast dokument/evidens och får egen full CI. Den slutliga PR-headens resultat binds i PR 49:s verifieringskommentar och den fristående evidensbilagan. Denna rapport certifierar den exakta frysta produktkoden och anger den ursprungliga head/tree-bindningen; den påstår inte en framtida egen commit-SHA.

## 1. Integrerade PR, revisioner och granskningsbeslut

Startbasen var `4ad205b84d1852ec7ed33cabd70fdadbe2f9d5c5`. Under arbetet mergade en annan aktör PR 48 till `bf24a3c52ffc637d1e7bbc4d4f64a1732dcd9fee`; denna main-revision ingår i integrationsarbetet. Agent 9 har inte mergat till main eller publicerat Sites.

Tabellen anger frysta delrevisioner från [producentregistret](evidence/producer-register.json), kompletterat med den sist granskade och integrerade PR 54-revisionen. Den gemensamma kodkandidaten är 0ce2604 enligt bindningen ovan. Exakta brancher, Git-träd, CI-körningar, tidigare mainhistorik och beroenden finns i [integrationsmatrisen](INTEGRATION-MATRIX.md).

| PR | Leverans | Granskad/integrerad delcommit | Verifierad delstatus |
| --- | --- | --- | --- |
| [45](https://github.com/sharbel0022/Mgeorge/pull/45) | Agent 1 — Bank | `ac1abdc5469248eba212496af4a4573864908ace` | Granskad delrevision; producentens fulla CI och säkerhets-CI gröna. |
| [46](https://github.com/sharbel0022/Mgeorge/pull/46) | Agent 2 — Bankgiro | `7d3bcb5ef533c39c9e23714e61709c924384ffb8` (kod `732bfb3f`) | Tre dokument maskerade efter grön kodrevision732b; runtime/tester byteoförändrade. Dokumenthuvud och slutlig rapportkandidat har separata CI-kvitton. |
| [47](https://github.com/sharbel0022/Mgeorge/pull/47) | Agent 8 — QA / CI | `875876ae539f5ecba1fc39d4c213197806e245ce` | Sen QA-komplettering granskad och integrerad; båda producentgrindarna gröna. |
| [50](https://github.com/sharbel0022/Mgeorge/pull/50) | Agent 4 — SaaS / medgivanden | `1619c0e3a63b922c75a7f46d493d39e68075952f` | Granskad delrevision; producentens fulla CI och säkerhets-CI gröna. |
| [51](https://github.com/sharbel0022/Mgeorge/pull/51) | Agent 5 — Avstämning | `0954777f10da8be9fb15daf3878c539b51801142` | Granskad delrevision; producentens fulla CI och säkerhets-CI gröna. |
| [52](https://github.com/sharbel0022/Mgeorge/pull/52) | Agent 3 — OCR / fakturatolkning | `eb4242f783172ac441f9092f921b04b06dc11771` | Granskad delrevision; producentens fulla CI och säkerhets-CI gröna. |
| [53](https://github.com/sharbel0022/Mgeorge/pull/53) | Agent 9 — Exakt referenssökning | `d9ca037a90ef9c9e629f62c4dcbf9cfcdeacb459` | Granskad delrevision; producentens fulla CI och säkerhets-CI gröna. |
| [54](https://github.com/sharbel0022/Mgeorge/pull/54) | Agent 7 — Säkerhet | `3db9f01305aa6830a4c2d1cc01970c06b91018c2` | Slutlig producentrevision integrerad; [full CI](https://github.com/sharbel0022/Mgeorge/actions/runs/42090903888) och [säkerhets-CI](https://github.com/sharbel0022/Mgeorge/actions/runs/42090903867) gröna. |
| [48](https://github.com/sharbel0022/Mgeorge/pull/48) | Extern main-uppdatering | `bf24a3c52ffc637d1e7bbc4d4f64a1732dcd9fee` — mergecommit | Ingår som bas; extern merge och dess driftändringar tillskrivs inte Agent 9. |
| [49](https://github.com/sharbel0022/Mgeorge/pull/49) | Agent 9 — tvetydiga bankskrivningar och samlad integration | `9a531daf4eb09a36d9212d4a38e7eef7fa251b28` — ursprunglig rättning | Gemensam kodkandidat är 0ce2604; samlad slut-CI är godkänd enligt tabellen ovan. |

**Leveranslucka:** Agent 1–5 och 7–8 har levererat, alltså **7 av 8 producenter**. Agent 6:s tidigare onboardingarbete och Agent 8:s browserprov räknas inte som en ny UX-leverans. PR 36–44 ingick redan i startmain; deras ursprungliga head- och merge-SHA finns i integrationsmatrisen och de har inte integrerats om.

Granskningen omfattade funktion, negativa testfall, originalintegritet, ekonomiska skrivningar, behörighet, migration och återhämtning. Känsliga bank-/säkerhetsöverlapp fick separata granskare. Tekniska granskningsrapporter är inte formella GitHub `APPROVED`-reviewhändelser. Runtimeöverlappar och semantiska konflikter behandlades utöver Git:s konfliktmarkeringar: bland annat Open Payments/lifecycle, callbacks, bankproveniens, SQLite-start och OCR:s byte-/teckengränser. [Granskningsloggen](REVIEW-LOG.md) redovisar reproduktioner och rättningar; korrigeringar placerades på respektive producentbranch när den fanns.

## 2. Fullständiga testresultat

[Testregistret](TEST-RESULTS.md) är den fullständiga förteckningen över producenternas headbundna Node-, Sites-, bridge-, browser- och prestandakvitton, inklusive underkända försök och miljöbegränsningar. Gröna producentgrindar visar respektive delträd. Deras testantal, säkerhetssviter, riktade körningar och en andra Node-version summeras inte till ett nytt gemensamt täckningstal.


**Samlad slutkod:** Node 22 **2152/2152**, Node 24 **2152/2152**, Sites **4128/4128**, bridge **47/47** och Chromium **46/46**. Separat säkerhetsacceptans: **332+843=1175/1175**. Alla har noll fail/cancel/skip/TODO. Backendens tre sviter omfattar 6 327 testfall; den andra Node-versionen och säkerhetsurvalet räknas inte som nya backendfall.

Låsta installationer, 224 JavaScript-syntaxkontroller, Sites typer/minimatchguard, produktionsbygge och auditgrindar passerade. Produktionsgraferna har noll fynd. Sites utvecklingsgraf har 8 moderate paketposter och inga high/critical; den befintliga mitigationen är verifierad. Den syntetiska belastningen med 1/10/100 företag gav 1 110 importer, 2 220 dubbletter, 111 förväntade upptaget-svar och 0 oväntade fel.

Sju artefakt-ZIP:ar hämtades och deras SHA-256 verifierades; 86 logg-/rapportreferenser validerades. Alla 1 270 källfiler matchade de exakta Git-bytesen. [Maskinläsbart kodkvitto](evidence/ci-code-0ce2604.json) och [testregistret](TEST-RESULTS.md) innehåller miljöer, tider, kommandon, fulla räknare, source-manifest, audit och avgränsad täckning.

| Utfört samverkansprov | Resultat och avgränsning |
| --- | --- |
| Faktura, betalning, migration, samtidighet och restore på `5414e2269913e37c58e0e0cff1bf260c31b2a35f` | **512/512** i 24 kompletta filer, Node 22.23.4; noll fail/skip/cancel/TODO. Tree `c37b15b8b97f0c86c96bda524126a828168049bd`; alla 1 260 spårade filer oförändrade före/efter. |
| Separat krypterad loginbackup/restore på samma kod | **3/3**. Räknare/sluttid bevaras, utgånget fönster öppnas och äldre snapshot får tabellen vid limiterstart. Scratchprobe, inte då ett committat regressionstest. |
| Separata bank-/HTTP-/medgivande-/SaaS-filer på samma 5414-revision | **336/336** i åtta kompletta filer. Överlappar andra sviter. |
| OCR/parser tillsammans med main | Fryst lokal syntes **1 635/1 635** i 46 filer; separat slutproducentgrupp **165/165** i sex filer. Avgränsade, överlappande lokala körningar; ingen samlad slut-CI. |
| OCR-worker tillsammans med ny ingress | **60/60** i tre kompletta filer och **2/2** genom faktisk worker/route. Dessa kompletterar den godkända samlade CI:n och summeras inte igen. |
| Sista lokala säkerhetssyntesen inför 0ce2604 | **7 Node-fall och 271 Sites-fall**, samt godkänd typkontroll enligt slutsyntesens lokala kvitto. Samlad fjärr-CI är grön; dessa lokala antal adderas inte till den. |

Det sammanhängande faktura-/betalningsprovet använder faktisk lokal HTTP, SQLite och syntetiska original. Det verifierar faktura och behållet CSV-original genom omstart och replay utan dubbel betalning, avvisar korrupt original, provar del-/överbetalningar och svaga referenser, samt konkurrens mellan separata processer. Båda motorernas batchkedjor och företag med identiska externa ID:n ingår. Migration och restore ska behålla finansiell identitet, original och audit utan att återaktivera fel företagsbehörighet eller gamla leases. [Detaljrapport](SUPPLEMENTARY-5414.md) och [maskinkvitto](evidence/supplementary-5414-result.json) anger kommandon, miljö, filer, hashbindning och begränsningar.

**5414-kvittot är från före de sena producentkompletteringarna och den sista ingressrättningen. Det tillskrivs inte ett senare head.** Den gemensamma slutgrinden ska omfatta låsta installationer, syntax, Sites typer och dependency-guard, fulla Node 22/24-, Sites- och bridge-sviter, produktionsbygge, audits, Chromium, syntetisk belastning för 1/10/100 företag samt separat säkerhetsacceptans. Run-ID:n och faktiska sluträknare redovisas ovan på exakt slutträd. Fel, timeout, ofullständig TAP, skip/TODO eller ändrade källor får inte räknas som grönt.

## 3. Produktionsstatus — separat läsande observation

Det [sanerade produktionskvittot](evidence/production-readonly.json) innehåller verktygsproveniens och respektive tid. Senaste samlade statusavläsning där är **2026-11-05 19:14:00 UTC**; andra rader gäller uttryckligt tidigare ögonblick. Det är inte en atomisk snapshot eller en ny autentiserad användaracceptans av kandidaten.

| Område | Observerat | Vad det styrker och inte styrker |
| --- | --- | --- |
| Befintlig publicering | **Sites 63**, deployment succeeded, miljörevision 10. Native source `b79213c21c955b1a23813a4cfaebeffafcb5a600`; arkiv-SHA-256 `2fa6da505429fdca2aaed7fdc3c34bb47bca8f721f9b56e15fa52a993fb634d3`. | En befintlig lyckad publicering. Exakt Sites 63 ↔ GitHub-källmotsvarighet är **inte självständigt verifierad**. Integrationskandidaten är inte driftsatt. |
| Gmail | Lyckad hämtning **18:59:26.053 UTC**, systemkörning completed **18:59:50.683 UTC**. `fetch_ready=true`, `background_ready=false`; orsakerna är `external_schedule_unverified` och `ocr_worker_unavailable`. | Aktuell anslutning/hämtning, inte verifierat externt schema eller komplett registreringskedja. |
| Moln-OCR | Extern schemakörning [42083409804](https://github.com/sharbel0022/Mgeorge/actions/runs/42083409804), worker-head `bf24a3c52ffc637d1e7bbc4d4f64a1732dcd9fee`: **6 behandlade, 0 fel**. Logg 18:23:32; tjänstens completion 18:23:31.509. Vid den nya läsningen är `cloud_worker_recent=false` och lokal worker fortsatt offline. | Ett daterat verkligt molnutfall, även när senaste kontakten inte längre räknas som färsk. Ingen oberoende fältprecision, uthållig kadens eller publicering av PR 52/kandidaten bevisas. Worker-head binder inte mottagande Siteskälla. |
| Dokumentstatus | 362 behöver granskning, 2 är registrerade i köstatistiken och 28 väntar på OCR vid statusavläsningen. | Aktuellt tillstånd. Förändringar under uppdraget kan bero på andra aktörer och samtidiga körningar; de tillskrivs inte Agent 9:s odriftsatta kod. |
| Bank | `connected=false`; senaste lyckade hämtning **08:05:14.646 UTC**. | Aktuell verklig bankanslutning är inte godkänd. Historisk framgång ersätter inte dagens behörighet. |
| Automatisk Bankgirokälla | `DISABLED`, `SOURCE_NOT_CONFIGURED`, authorization `UNKNOWN`. | Ingen verifierad fungerande automatisk källa. Ett separat manuellt rapportoriginal finns, se avsnitt 5. |
| Backup | Dagens snapshot complete, **362/362** original verifierade, `manifest_pass`, verifierad **16:55:10.290 UTC**. | Den frysta snapshotens kontrollpass. Senare original, full historisk API-proveniens och operativ produktionsrestore är inte certifierade. |

De sex slutförda OCR-resultaten kvarstår som ett daterat driftutfall och stöder P10=1. `cloud_worker_recent=false` vid 19:14 betyder samtidigt att kontinuerlig tillgänglighet eller timvis OCR-kadens inte är styrkt. Den tidigare läsningen finns kvar som [18:39-kvitto](evidence/production-readonly-1839.json).

PR 48:s mainmerge, Sites 63-publiceringen och OCR-schemakörningen utfördes av andra aktörer. Agent 9 startade inga verkliga bankhämtningar, nya medgivanden, OCR-dispatcher, finansiella mutationer, kundmeddelanden eller deploymentåtgärder. Vissa äldre vyer kan göra POST vid montering; vanlig livebrowsernavigering användes därför inte som ett påstått skrivfritt produktionsprov.

## 4. Säkerhetsstatus, migration och deployment

Kandidatens lokala säkerhetsarbete stärker företags-/rollgränser, kontroll efter await och före commit, callback-/sessionsbindning, atomisk loginbudget, requeststorlek/tid, auditminimering och originalkontroll. Okända utfall efter fjärrskrivningar får inte skapa nya medgivanden eller nya ekonomiska poster. Kända handtag och korrelation bevaras när en guardad återhämtningsskrivning kan genomföras. [Releasegrindarna](RELEASE-GATES.md) anger öppna säkerhets- och driftsvillkor.

**Den sena PR 54-syntesen är integrerad, oberoende granskad och verifierad av gemensam full CI.** OCR-ingressens bytegräns har förenats med den befintliga teckengränsen även för flerbytestecken, med verklig worker/route-reproduktion. Slutkvittot ovan avser exakt denna kombination. Producenternas gröna audits ersätter inte kandidatens egen audit. Kända moderate utvecklingsfynd ska redovisas även när en produktionsaudit passerar; inga generella säkerhets- eller dataskyddsgarantier utfärdas.

Aktuella producentdokument har dessutom maskerats där de återgav privata betalningsidentifierare, enligt projektets dokumentationsregel. Ekonomiska original och testfixtures är oförändrade. Äldre Git-versioner har inte skrivits om och kan fortfarande innehålla den tidigare texten; detta är ingen historikrensning.

**Schema och rollback:** PR 54 skapar additivt `login_rate_limits` i Nodes centrala kontrolldatabas vid serverstart. Det finns ingen ny numrerad SQL-migration och Sites D1-schema ändras inte av detta, men Node har en faktisk schemaeffekt. Befintliga rader bevaras. Kontrollbackup inkluderar budget/sluttid; separat företagsbackup omfattar inte automatiskt central loginstate. Separata krypterade prov verifierar finansiella rader respektive loginbudget.

Äldre kod kan öppna databasen med extratabellen men använder inte dess beständiga spärr. Rollback eller blandade versioner behåller därför inte det nya skyddet. En äldre snapshot saknar försök efter sin tidsgräns; budgeten är inte monoton över restore. Tabellen ska inte raderas vid rollback. Tenant-omedveten kod och gamla återställda behörigheter/leaser får inte återinföras.

**Deploymentgräns:** den befintliga identiteten, domänen, DB/R2 och hostingbindningarna bevaras. En senare tillåten publicering måste binda byggd källa och arkiv till testat Git-innehåll samt ge native deployment- och autentiserade acceptanskvitton. Main från PR 48 har redan en fail-closed OCR-trigger efter lyckad aktuell main-CI. En framtida mainmerge kan därför få faktisk driftverkan om befintliga flaggor och credentials medger det; det ska ingå i releasebeslutet. Nodes publika inloggning är fortfarande `single_administrator`, vilket inte är en färdig kommersiell fleranvändaridentitet.

## 5. Bank- och Bankgirostatus

**Verklig bankanslutning: INTE GODKÄND. Automatisk Bankgirokälla: INTE KONFIGURERAD.** Lokala provider-, callback-, konto-, lease-, kvot-, pagination- och idempotensprov ger kodbevis men ingen faktisk bankauktorisation. Verifierad företags-/kontobehörighet, korrekt providerregistrering och redirect, vald API-produkt, avtal/certifikat samt relevant SCA återstår enligt vald leverantörsmodell.

Det befintliga manuella rapportoriginalet återlästes autentiserat **18:09:39.110 UTC**: ägarbundet, intakt, komplett och oförändrat. Det innehöll en parserad rad men **noll matchade registrerade fakturor och noll allokeringar**; `automatic_eligible=false`. Detta stöder ett begränsat aktuellt import-/proveniensutfall. Det bevisar inte mottagarkonto, juridisk betalare, formell OCR, gemensam bankutfärdad insättningsidentitet eller kundrelation.

Bankens råa uppgift, fakturans avsedda referens, generiskt dokumentnummer, manuell attest och en föreslagen fakturakoppling hålls isär. Ledande nollor och originalbytes bevaras; en bristande kontrollsumma kan inte ge säker referensevidens. Förälder och detaljer i en samlingsinsättning får inte skapa dubbel ekonomi. Ett förslag ändrar inte saldot; allokering kräver sina separata bevis och behöriga skrivgränser. Kommersialisering förutsätter dessutom aktuellt underlag från ansvarig bank/leverantör och rättsligt ansvarig part, inte ett antagande från en grön testsamling.

## 6. Före/efter för samtliga 33 kriterier

Den historiska dokumenterade basen är **255/330**. Den nya verifierade matrisen använder samma fem komponenter **F + S + K + U + P**, vardera 0–2 i halva steg. Fulla delpoäng, testhänvisningar, motiv och kvarstående acceptans finns i [33-kriteriematrisen](QUALITY-REASSESSMENT.md) och [dess JSON](QUALITY-REASSESSMENT.json); [baslinjekvittot](evidence/historical-255-baseline.json) håller den äldre bedömningen separat.

| Nr | Kriterium | Före | Verifierat efter | Delta |
| --- | --- | ---: | ---: | ---: |
| 1 | Design och färger | 8 | 7 | −1 |
| 2 | Startsida | 8,5 | 7,5 | −1 |
| 3 | Navigering | 8,5 | 7,5 | −1 |
| 4 | Mobilanpassning | 8,5 | 7,5 | −1 |
| 5 | Sökning och filtrering | 7,5 | 7,5 | 0 |
| 6 | Minimal manuell hantering | 6,5 | 6 | −0,5 |
| 7 | Kundfakturor | 8 | 8 | 0 |
| 8 | Leverantörsfakturor | 8 | 8 | 0 |
| 9 | PDF-tolkning | 8 | 8 | 0 |
| 10 | Bild-OCR | 7 | 7,5 | +0,5 |
| 11 | Gmail-anslutning | 7,5 | 8,5 | +1 |
| 12 | Automatisk fakturaregistrering | 8 | 8 | 0 |
| 13 | Dubblettkontroll | 8 | 8 | 0 |
| 14 | Dokumentgranskning | 8 | 8 | 0 |
| 15 | Swedbank-anslutning | 8,5 | 7,5 | −1 |
| 16 | Automatisk bankhämtning | 8 | 7,5 | −0,5 |
| 17 | Bankgiroimport | 8,5 | 8,5 | 0 |
| 18 | Identifiera verklig betalare | 7 | 7 | 0 |
| 19 | Verklig OCR/fakturareferens | 7 | 7 | 0 |
| 20 | Automatisk betalningsmatchning | 7,5 | 7,5 | 0 |
| 21 | Delbetalningar | 8 | 8 | 0 |
| 22 | Överbetalningar | 8 | 8 | 0 |
| 23 | Flera fakturor i en betalning | 7,5 | 7,5 | 0 |
| 24 | Betalningshistorik | 8 | 8 | 0 |
| 25 | Betalningsstatus | 8 | 8 | 0 |
| 26 | Kontrollera alla betalningar | 8 | 7,5 | −0,5 |
| 27 | Automatiska mejlutkast | 8 | 8 | 0 |
| 28 | Schemalagd automatisering | 6,5 | 6,5 | 0 |
| 29 | Säkerhetskopiering | 7,5 | 8,5 | +1 |
| 30 | Säkerhet och åtkomstkontroll | 8,5 | 8 | −0,5 |
| 31 | Katastrofåterställning | 5,5 | 6,5 | +1 |
| 32 | Kodkvalitet och tester | 8,5 | 8,5 | 0 |
| 33 | Verifiering i verklig produktion | 6,5 | 5 | −1,5 |
| **Totalt** | **Av 330** | **255** | **250** | **−5** |

Höjningarna för Gmail och bild-OCR bygger på konkreta aktuella driftutfall, inte antalet tester. Säkerhetskopiering och katastrofåterställning får högre lokalt S-stöd genom krypterad backup/export/restore, **27 ägarbundna backuptabeller**, separat facit och åtta negativa klasser. Standardtestets **sju syntetiska original**, den separata syntetiska volymkörningens **362 original** och produktionens **362 verifierade backuporiginal** är tre olika underlag. Produktionsrestore är fortfarande inte gjord; P31 förblir 0. Se [återställningsevidensen](../../quality8/recovery-evidence.md) och [maskinkvittot](../../quality8/recovery-evidence.json).

Den lägre totalen beror främst på att äldre produktionspoäng inte kan återcertifieras med dagens begränsade underlag. Den är inte ett påstående att kodrättningarna försämrar funktionerna. Exempelvis stöder sex OCR-resultat P10=1 men inte en komplett bank-, OCR- och registreringskedja eller verifierad minskning av manuellt arbete i kriterium 6.

## 7. Slutligt verifierat betyg

**Slutligt verifierat betyg på den bedömda koden och den daterade produktionsbevisningen: 250/330 = 7,575757…/10, avrundat 7,58/10.** Historiska 255 är jämförelsebas. Nettoförändringen är −5 och gapet till 314 är 64 poäng. Inget område har styrkt minst 9,5.

Fulla grindar, råa artefakter, exakt tree och samtliga källbytes är kontrollerade. Den gröna körningen motiverar att den föreslagna nivån kan fastställas; den ger ingen automatisk poänghöjning. Kommersiella och operativa blockerare kan inte räknas bort med ett medelvärde eller ersättas av kodpublicering.

## 8. Exakt återstående acceptans för minst 9,5/10

Det saknas **64 poäng till 314/330**. [REMAINING-TO-95.md](REMAINING-TO-95.md) anger för **var och en av de 33 raderna** dagens nivå, avståndet till 9,5 och det konkreta underlag som återstår. Det är en acceptanslista, inte en utlovad poängbudget. Gemensamma villkor är:

1. **Ordinarie review och leveranslucka:** låt maintainer granska den färdiga PR:n och hantera Agent 6:s uteblivna nya leverans. Bevara exakta CI-grindar vid varje senare ändring. Kommersiell release kräver dessutom villkoren nedan.
2. **Verklig bank och medgivanden:** styrk aktuell leverantörsmodell, avtal/API-produkter/certifikat, registrerad callback samt företagets och kundens faktiska kontobehörighet. Genomför tillåten aktuell SCA-/bankacceptans, inklusive förnyelse, avslag och återhämtning.
3. **Faktisk Bankgiro- och betalningsevidens:** konfigurera den bank-/företags-/kontobundna källan och verifiera rapportoriginal, betalare, referens, insättningsidentitet och godkänd fakturarelation utan dubbel ekonomi eller manuellt fabricerade bankfakta.
4. **Representativ faktura- och användaracceptans:** använd godkänt originalfacit för kund-/leverantörsfakturor, PDF/bild-OCR, osäkerhet och automatisk registrering. Verifiera betalningsutfall, manuell arbetsinsats, mobil/hjälpmedel samt faktisk Gmail-/bank-/OCR-kadens på rätt publicerad revision.
5. **Operativ katastrofåterställning:** återställ en oberoende aktuell produktionsbackup med separat åtkomliga nycklar i isolerad miljö. Stäm av original, ekonomi, ägare, behörigheter och tjänstestart; mät verklig RPO/RTO och verifiera återgång. En snapshotkontroll eller lokal syntetisk övning räcker inte.
6. **Ansvar och produktionsproveniens:** slutför tillämplig juridisk, avtalsmässig, regulatorisk och dataskyddsmässig acceptans med ansvarig part. Bind Siteskälla/arkiv till testat Git-innehåll och dokumentera native deployment samt autentiserade kund-/driftflöden.

Alla 33 områden på exakt 9,5 ger **313,5/330**. För minst 314 behöver ytterligare 0,5 styrkas i något område utan att andra poäng faller. Vilket område det kan vara avgörs av nya bevis. De kritiska [releasegrindarna](RELEASE-GATES.md) måste vara stängda oavsett totalpoäng.

Den samlade kodgrinden är godkänd. Målnivån är inte styrkt och verklig bank, produktionsrestore samt full kund-/driftacceptans återstår. Beslutet avser kommersiell produktionslansering och uppfyllandet av slutmålet; det tar inte bort de daterade delresultat som redan är verifierade.

**NOT APPROVED**
