# MG Fakturakoll — slutlig teknisk release, Site 69

**Teknisk publicering lyckad. Kommersiell bank-/flerföretagslansering inte godkänd. Kvalitetsmål 314/330 inte uppnått.** Den konservativa bedömningen är 258,5/330 = 7,83/10; 27 av 33 kriterier når minst 8. De senare worker- och etikettfixarna får ingen extra OCR-kvalitetspoäng utan ny oberoende acceptans.

## Exakt leveranskedja

| Objekt | Verifierad identitet |
| --- | --- |
| GitHub-repository | `sharbel0022/Mgeorge` |
| PR 61 | Normalt mergad 2026-11-06 14:48:45 UTC till `24390ef7e8cf6b2274c57804dc9c2d74d362ab12`; publicerad som Site 68. |
| PR 62 | Normalt mergad 2026-11-06 16:31:38 UTC, 31 separata commits och 231 ändrade filer inklusive syntetisk evidens. |
| Slutlig produkt-main | `f3c80629d4856c2f8ecbb1ed81be391a13ac6be8` |
| PR 62-head | `70dd9c5dca6981e440bec0486e43788d2ef3f6a1` |
| Testad PR-merge-checkout | `795decf5b1601de2d1738e0a311dbc53e0840c72` |
| Samma hela träd i alla tre | `c1912a91e44ecaca7095dcaca1201c3904df87d7` |
| GitHubs `sites/` och native-repots rot | `c2feb372a4c0ef121ffe594784684957c14ddac1` |
| Native-commit | `1df8cb96eda374f2506c81aa776263388ddb666a` |
| Site | `appgprj_6adf2f7f7e848191b64192161886b528` |
| Publicerad version | **69** |
| Version-ID | `appgprj_6adf2f7f7e848191b64192161886b528~appgver_0d6484fc83648191b5acdcac9ca3bf9d` |
| Deployment | `appgdep_6aee03a49f648191a7997849a60af9c5`, **succeeded**; serverns sluttid 2026-11-06 16:43:40.451077 UTC. |
| Produktionsadress | https://mg-fakturakoll-sharbel.sharbelrasho.chatgpt.site |
| Miljö | Revision 10, samma 18 nycklar och samma befintliga public-audience, D1-/R2-bindningar och MCP-kapacitet. |

Servern återgav initialt `pending`; det utfallet ersattes inte av ett antagande. Terminal `succeeded` och rätt version/native-källa återlästes innan produktionskontrollen redovisades som klar. [Sanerat efterkvitto](release69-postpublication.json).

Det officiella native-bygget och paketflödet slutfördes med exit 0. Källroten var ren och exakt lika med GitHubs Sites-delträd. Gzip-arkivet är 18 706 037 byte, SHA-256 `557ce1a2b50dcd05d23d1ed7fa54d5f3b05a6571a5d7a67b8f4ef0e55240c5be`. Serverns normaliserade tar-arkiv är en annan representation: 48 609 280 byte, 441 filer, SHA-256 `a67486cfa036e63a9873486377823bd81c81b62a41bdf043314676992d37b0af`. [Native-proveniens](native-site69-provenance.json).

## Test- och CI-grindar på slutlig kod

| Grind | PR 62 | Separat main | Avgränsning |
| --- | ---: | ---: | --- |
| Node 22.23.4 | 3 012/3 012 | 3 012/3 012 | Samma logiska testpopulation som Node 24. |
| Node 24.22.1 | 3 012/3 012 | 3 012/3 012 | Versionen räknas inte som nya oberoende fall. |
| Sites fullsvit | 5 820/5 820 | 5 820/5 820 | Typer, låsta installationer och produktionsbygge passerar också. |
| Bankgiro bridge | 47/47 | 47/47 | Syntetisk SSH/SFTP/HTTP, felåterhämtning och idempotens. |
| Chromium | 77/77 | 77/77 | 41 onboarding, 5 arbetsyta, 31 dashboard; syntetiska API:er. |
| 1/10/100 företag | PASS | PASS | En Node-process, SQLite, fyra samtidiga företagsjobb; upp till åtta försök i konkurrensfasen. |
| Separat säkerhetsacceptans | 377 Node + 1 225 Sites, PASS | Täcks även av fullsviterna | Överlappande delmängd, inte extra oberoende testfall. |
| Produktionsaudit | 0 fynd | 0 fynd | Node, Sites och bridge. |
| Alla beroenden | Sites: 8 moderate, 0 high/critical | Samma | Övriga profiler 0; kvarstående utvecklingsberoenden redovisas öppet. |

Alla sviter har noll fail, cancelled, skipped och TODO. Källträdet var rent och oförändrat under körningarna. 8 956 svitfall återstår när Node-versionerna, omkörningen på main och säkerhetsdelmängden inte räknas dubbelt. Det är ett antal testfall, inte ett statistiskt oberoende urval.

- [PR-kvalitet 42251628527](https://github.com/sharbel0022/Mgeorge/actions/runs/42251628527), [bevarade artefakter och hashproveniens](ci-followup/pr/provenance.json).
- [Säkerhet 42251628601](https://github.com/sharbel0022/Mgeorge/actions/runs/42251628601), [oberoende kontroll](pr62-security-ci/README.md).
- [Main-kvalitet 42253201335](https://github.com/sharbel0022/Mgeorge/actions/runs/42253201335), [bevarade artefakter och hashproveniens](ci-followup/main/provenance.json).

Alla tolv kvalitets-ZIP:ars digester verifierades mot GitHub. Källmanifest, TAP, JUnit, LCOV och loggar har bevarats byteexakt; komprimeringen ändrar inte ursprungliga innehåll eller tidigare misslyckanden. Browserbilder är indexerade men dupliceras inte. Säkerhets-ZIP:en är separat verifierad. Täckningsvärden avser laddade filer; transformerad källmappning har inte oberoende verifierats.

Main-benchmarken importerade totalt 1 110 nya syntetiska transaktioner, kände igen 2 220 dubbletter och gav 111 förväntade busy-svar utan fel. Initialfasens p95 per synkförsök var cirka 126/479/468 ms för 1/10/100 företag. Dessa enstaka syntetiska mätningar är inte ett produktions-SLA eller bevis för distribuerad kapacitet.

## Vad PR 62 rättar

Sex produktfiler ändras jämfört med PR 61: `src/invoice-extraction.js`, `src/invoice-worker.js`, `src/invoice-details.js`, `sites/lib/invoice-details.js`, `sites/lib/invoice-fields.js` och `sites/lib/ocr-layout.js`. Fem test-/hjälpfiler tillkommer. [PR 62:s fullständiga fillista](pr62-changed-files.tsv), [hela integrerade produktrevisionens fillista](final-product-changed-files.tsv).

Workerfixen bevarar färdig text, confidence och OCR-evidens om cleanup kastar. Förälderns nya felkategorier och tids-/exitmetadata är begränsade; råa undantag, dokumenttext och credentials läggs inte i dessa nya feldiagnoser. Den reproducerade felvägen gick från 0/12 till 12/12. Den förklarar inte automatiskt första blindprovets fyra historiska avbrott.

Etikettfixen gör `Issue date` och de redan stödda stavningarna `Organisation`/`Organization` konsekventa mellan insamling och cell-/partsgränser. Befintliga `Bill to:`/`Fakturamottagare:` kräver sitt ursprungliga kolon när de används som cellgräns; kolonlösa separata rubriker bevaras. Ingen ny partsroll härleds från ett omärkt namn och ingen moms gissas från OCR-token `2590`. Frysta RED/GREEN-grupper, 574 Node-/464 Sites-fokusfall och 120 oberoende granskarprov är dokumenterade separat. [Aliasbevis](../quality8/standard-field-alias-census/README.md), [oberoende review](alias-review/README.md).

## Faktisk drift efter publicering

Banken är fortsatt `connected=false`, `connectionStatus=reauth_required`, `syncAllowed=false`, `BANK_RECONNECT_REQUIRED`. Senaste bekräftade banksynk är 2026-11-05 08:05:14.646 UTC. Tidigare avgränsad revalidering gav `BANK_CONSENT_INVALID`; orsaken hos leverantören är inte fastställd. Konto-usage, företagsauktorisation och ett framtida lokalt giltighetsdatum är separata bevisfrågor. Open Payments saknar fortfarande de fyra dokumenterade runtimekonfigurationsnycklarna. Ingen ny providerauktorisation eller bankacceptans påstås.

Bankgiro är `DISABLED`, `SOURCE_NOT_CONFIGURED`, auktorisation `UNKNOWN`, utan käll-ID eller jobb. Faktiskt aktiverad Bankgiroprodukt/rapportkanal och bankstyrkt kontorelation krävs. 0599/625 SEK visades i riktig browser med oförändrade inledande nollor, generisk bankrapporterad referens och **Blockerad**. Bank-OCR saknas; det finns ingen entydig registrerad faktura eller verifierad relation till en AIS-insättning. Originalets integritetsindikator ersätter inte bankauktorisation eller betalningsbevis.

En assisterad normal Gmail-hämtning importerade nio nya underlag, noll dubbletter, med senaste lyckade hämtning **16:27:10.457 UTC**. Fyra begränsade dokumentanrop efter hämtningen klassificerade kvarvarande PDF-arbete vidare till OCR; inga nya registreringar tillkom. [Sanerat körkvitto](assisted-gmail-followup.json). Detta är inte bevis för timschemat. Ordinarie tillfällen 15:00 och 16:00 gav `no_update` utan nytt korrelerat appanrop. [Schemakontroll](schedule-followup-1600.json).

Den ordinarie CI-utlösta [moln-OCR-körningen 42254783237](https://github.com/sharbel0022/Mgeorge/actions/runs/42254783237) använde exakt main `f3c80629`, kontrollerade aktuell godkänd main före credentialanvändning och slutförde **sex dokument, noll körfel**. Appens sluttid är 16:43:40.861 UTC. Efterstatus: **415 dokument behöver granskning, 57 väntar OCR, två registreringar**, inga aktiva, utgångna, uttömda eller felade jobb. [Körkvitto](final-automatic-cloud-ocr.json).

OCR-jobbet överlappade publiceringen; varje dokuments betjänande Sites-version är inte separat bunden. Det är ett driftkvitto, inte ett nytt optiskt facitprov, periodiskt cronbevis eller Gmail-dispatchbevis. Senaste periodiska OCR-körning som återlästes i schemagranskningen var 10:43 med 6/0. Konfigurationen `7/15 * * * *` och en tidigare framgång bevisar inte aktuell regelbundenhet.

## OCR-kvalitet och kvarstående arbete

Första oberoende kohorten gav 54/144 bildfält, 37,50 % recall, noll FP och fyra workeravbrott; ogiltiga organisationsnummer och EUR-underlag begränsar representativiteten. Den separata kohorten med giltiga SEK-underlag gav **62 TP / 0 FP / 46 FN av 108 normala bildfält: 57,41 % recall och 100 % observerad precision**. Alla 14 workers slutfördes, men inget av de tolv normala dokumenten var komplett eller grönt. Stress gav 10/18. Första utfallen bevaras.

SEK-provet kördes före de sista standardetikettfixarna. Den enda efterföljande utvecklingsreplayen gav 62→66/108 på en mellanversion, med noll nya optiska anrop. Slutversionen har ingen ny oberoende optisk acceptans. Inget av detta styrker minst 85 % recall/98 % precision i produktion; noll falskgröna med noll gröna är inget positivt urval för automatisk registreringsprecision. Node och Sites delar samma bildobservationer och får inte räknas dubbelt.

Det historiska V3-paketets original kunde inte återfinnas eller intygas som oanvänt. Det rekonstruerades inte för att skapa ett nytt positivt resultat. Detta gäller ett historiskt syntetiskt utvecklingspaket, inte förlust av kundoriginal.

## Kunddata, UI och säkerhet

Elva utvalda tabeller jämfördes före/efter. Alla returnerade fält, kolumnuppsättningar och radantal var oförändrade; nio tabeller var kompletta i den avgränsade läsningen. `workspaces.payload` och `bank_connections.encrypted_accounts` trunkerades. Det är **inte** en fullständig databasexport eller bytehashning av samtliga original, medgivanden och kundvärden. Inga råa kundrader publicerades i rapporten.

PR 62 innehåller inga nya migrationer. Tokenkontrolltabellerna som infördes med migration 0025 i Site 68 fanns kvar: en kontrollrad och noll tokenrader, samma returnerade kontrollvärden. Ingen befintlig recovery barrier nollställdes. Befintliga D1-/R2-bindningar, audience och miljörevision bevarades. Inga medgivanden, produktionstokens eller finansiella allokeringar ändrades som releaseåtgärd.

Den autentiserade desktopkontrollen använde den normala produktionsadressen utan bypass. Ekonomiöversikten visade 0 kr verifierat inbetalt, 16 000 kr kvar att få, 7 250 kr förfallet och 0 kr att betala. Sökning → ArrowDown → Enter → betalningsdialog → Escape återställde fokus till sökfältet. Sökningen rensades. Bankvyn visade saknad SaaS-företagsregistrering, Swedbank som behöver förnyas och frånvarande Bankgirokälla. 527 ärenden i översikten är ett bredare mått än de 415 dokumenten för granskning.

En exakt label-väntan vid återgång till översikten nådde sin deadline; nästa färska DOM-läsning bekräftade de förväntade beloppen. Inget latenslöfte eller heltäckande fysisk mobil-/skärmläsarcertifikat ges. Mobilbeviset kommer från syntetisk Chromiumacceptans. Den riktiga översikten lämnades öppen.

Säkerhetskontrollen omfattar bland annat SQL-/företagsgränser, IDOR, roller, replay, CSRF/SSRF, tillåtna original, tokenfences och återställningsspärrar inom sviternas dokumenterade omfattning. Tidigare frysta negativa SQL-fall och oberoende 1/28→28/28 ingår i integrationen; ingen faktisk kunddataläcka påstås. GDPR-avtal, retention och kommersiell driftsacceptans blir inte godkända av ett syntetiskt testresultat.

De åtta moderate utvecklingsposterna hör till en minimatch-advisory via beroendeträdet. Den befintliga, avgränsade skyddskorrigeringen verifieras av CI; ingen enkel kompatibel lockfilsuppgradering identifierades. Versions-/underhållsgapet kvarstår. [Full riskanalys](sites-development-audit-risk.md).

## Backup och exakt återställning

Den verkliga snapshoten `768fde9a-27a2-4b85-b85a-278239ec4aea` skapades 2026-11-05 23:03:21.104 UTC och verifierades 2026-11-06 00:48:58.086 UTC: **430/430 original, 185 567 855 byte, manifest_pass**. Senare importer ingår inte i detta frysta manifest. Dagens kompletta snapshot skrivs inte om av en vanlig `backup_step`; nästa ordinarie dygnssnapshot behövs för nya original.

En enda ny isolerad syntetisk återställning på exakt `f3c80629` accepterade 430 original, 430 hashkontroller och 27 tabellgrupper. Alla tio negativa fall avvisades; application-token recovery förblev spärrad, främmande ägare uteslöts och gamla worker leases ogiltigförklarades. Barnprocessen fick endast PATH/LANG/TZ/NODE_ENV=test. Återställning plus acceptans tog **3 625,739 ms**; hela drillen 12 473,298 ms och processen 12 682,838 ms. [Råresultat, miljö och källhashar](final-restore-f3c8062/README.md).

Simulerad RPO 15 minuter och dessa lokala tider är inga produktionslöften. Produktionsrestore, extern nyckelåtkomst och faktisk katastrofberedskap har inte utförts eller certifierats.

## Beslut, kvarstående krav och rollback

**Teknisk release: genomförd. Rollback: inte nödvändig.** Site 68 är kvar som tidigare verifierad Sites-version; återgång av Node-/GitHub-worker är ett separat normalt kodrevert, inte enbart en Sites-återpublicering. Ingen destruktiv DB-återställning ingår.

**Kommersiell launch och 314/330: inte godkända.** Externa bankkrav är giltig auktorisation/SCA, företags-/kontobindning, leverantörens produktionsprodukter/certifikat där de används och en verklig Bankgirokälla. Interna krav kvarstår för OCR:s representativa kvalitet, normal Gmail-dispatch, periodisk OCR-tillgänglighet, minimal manuell hantering och den fulla automatiska backupkedjan. Dessa interna områden får inte beskrivas som endast BankID- eller avtalsberoenden.

Den fullständiga [33-punktsbedömningen](final-33-assessment.md) och [maskinläsbara underlaget](final-33-assessment.json) innehåller alla tidigare och nya poäng, testbevis, produktionsbevis, risker och skäl. Slutlig evidens lagras på den beställda completion-branchen efter den produkt-main som CI och deployment verifierade. Sådana efterföljande dokumentationscommits är inte en ny produktrelease; deras oförändrade käll-/testscope jämförs separat med `f3c80629`.

### Sen uppföljning av timschemat

Den ordinarie uppgiften schemalagd 17:00 registrerades också som `no_update`, utan ny korrelerad appinvokering. Vid 17:01:46 låg den senaste lyckade hämtningen kvar 16:27:10.457 från den assisterade körningen och köantalen var fortfarande 415/57/2. Miljömetadata styrker inte var automationskörningen faktiskt exekverades; dispatchens grundorsak är inte fastställd. [Sanerat sent kvitto](schedule-followup-1700.json).
