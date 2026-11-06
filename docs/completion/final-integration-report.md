# MG Fakturakoll — slutförande, verifiering och release

## Levererat resultat och beslut

**PR 61 och PR 62 är normalt mergade. Slutlig main är `f3c80629d4856c2f8ecbb1ed81be391a13ac6be8`; dess Sites-kod är publicerad som version69.** Full PR-kvalitet, separat säkerhetsacceptans och separat main-CI passerade på exakt samma källträd. Native-bygge, API, riktig browser och avgränsad före-/efterjämförelse är klara. [Slutligt releasekvitto med samtliga identiteter och grindar](release-site69.md). [Site 68 är bevarad som historisk föregående release](release-site68.md).

**Kommersiell bank-/flerföretagslansering är inte godkänd. Målet 314/330 är inte uppnått. Den verifierade bedömningen är 258,5/330 = 7,83/10, 27/33 minst 8.** Verklig Swedbankauktorisation och Bankgirokälla saknas. OCR-kvalitet och ordinarie Gmail-dispatch har separata interna kvarstående krav. [Alla 33 kriterier med tidigare/nya poäng, test, produktion, risker och skäl](final-33-assessment.md), [maskinläsbart underlag](final-33-assessment.json).

PR 62 rättar Node-workerns lifecycle och harmoniserar befintliga standardrubriker. Produktdiffen omfattar sex filer. Hela PR-trädet `c1912a91e44ecaca7095dcaca1201c3904df87d7` matchar testad PR-merge och main. Sites-trädet `c2feb372a4c0ef121ffe594784684957c14ddac1` matchar rotträdet för native-commit `1df8cb96eda374f2506c81aa776263388ddb666a`. PR 62:s egen fulla CI och separata main-CI är gröna; PR 61:s tidigare kvitton används inte för ny kod.

### Slutlig verifiering

| Kontroll | Verifierat resultat |
| --- | --- |
| Full PR och separat main | Node 22/24 vardera 3 012/3012; Sites 5 820/5820; bridge 47/47; Chromium 77/77; inga fel/cancel/skip/TODO. |
| Säkerhet |377 Node+1225 Sites; oberoende kontroll av råa TAP och identiskt testat träd. Överlappande delmängd. |
| Övriga CI-grindar | Låsta installationer, syntax, TypeScript, produktionsbygge, audit och 1/10/100-företagsbenchmark passerar. Produktion0 auditfynd; Sites-utveckling8 moderate kvarstår. |
| Exakt-main restore |430 syntetiska original/185567855 byte,27 tabellgrupper,10 avvisade negativa fall; restore+acceptans3625,739 ms. Ingen produktionsrestore. |
| Release |Site 69 succeeded16:43:40.451UTC, miljörevision10, oförändrad audience/DB/R2. Inga nya migrationer iPR 62. |
| Kund-/ekonomikontroll |Alla returnerade värden lika i11 tabeller;9 kompletta och2 trunkerade celler.0 verifierat inbetalt/16000 kvar/7250 förfallet/0 att betala. |
| Drift |Senaste assisterade Gmail16:27:10.457UTC,9 nya underlag/0 dubbletter. Automatisk CI-utlöst OCR6/0 från f3c80629.415 dokument för granskning, 57 väntande OCR,2 registreringar. |

[PR-CI](ci-followup/pr/provenance.json), [main-CI](ci-followup/main/provenance.json), [security](pr62-security-ci/README.md), [restore](final-restore-f3c8062/README.md), [efterkontroll](release69-postpublication.json). Full integrerad diff mot cde9178 omfattar770 filer, inklusive syntetisk evidens och dokumentation; det är inte770 produktfixar. [Hela fillistan](final-product-changed-files.tsv), [PR 62:s231 ändrade filer](pr62-changed-files.tsv).

## Vad integrationen ändrade

| Område | Konkret ändring och berörda filer | Bevis och begränsning |
| --- | --- | --- |
| Företagsisolering | `sites/lib/company-storage.js` bevarar SQL:s exekverbara struktur när strängar, kommentarer, citerade identifierare och CTE-gränser granskas. | Verkligt reproducerade bypasser, frysta negativa fall och oberoende 28/28 efter rättning. Ingen exponerad godtycklig SQL-endpoint eller konstaterad produktionsläcka påstås. |
| Bankstatus | `sites/lib/banking/service.ts`, `store.ts`, `account-read-guard.ts` och dashboard visar saknad kontometadata, krav på återanslutning och blockerad synk korrekt. | 11 nya regressioner, 360 servicefall och 22 oberoende motprov. Statusläsningen gör inga provider- eller medgivandeskrivningar. |
| Open Payments och mTLS | Node-/Workers-transporter, applikationstokenkoordinator, cache/fence, runtimekonfiguration och migration 0025 ingår i integrationen. | Frånvarande schema/kontrollrad stänger säkert före provideranrop. Migrationen kördes i den riktiga Siten. Verklig Open Payments-konfiguration och produktauktorisation saknas. |
| OCR-parser | `src/invoice-extraction.js`, båda `invoice-details.js` och Sites `ocr-layout.js`/`ocr-summary-layout.js` hanterar avgränsade datum-/valutaalias och slutna horisontella beloppsceller. | Känd utvecklingsreplay 70→74/100 obligatoriska fält, noll falska värden och inga förlorade korrekta värden. Det är ingen ny oberoende optisk observation. |
| OCR-kö | `sites/lib/document-processing.ts` behåller ett redan accepterat kvitto vid tillfälligt original-/strömfel och återförsöker med befintliga leaser, versionsfences och väntetider. | 43 riktade återhämtningsfall och 24 oberoende gränsfall. Verklig originalkorruption godkänns inte genom denna återhämtning. |
| Gmail | `sites/lib/gmail-service.ts` skiljer aktuell `sync_eligibility` från historisk driftshälsa och stoppar korrupta låsdeadlines säkert. | 127 riktade fall och full CI. Direkt behörig hämtning fungerar; ordinarie extern timdispatch är fortfarande inte bevisad. |
| UI | `sites/app/dashboard.tsx`, Gmailvyn, layout och arbetsytesökning visar driftens begränsningar och bevarar svartvit design, dialog- och tangentbordsflöden. | 77 syntetiska Chromiumfall och kontrollerad riktig desktopbrowser efter publicering. Mobilbeviset är syntetiskt. |
| Bankgiro och avstämning | Intag, original/proveniens, inledande nollor, del-/överbetalning och flera fakturor ingår i den sammansatta integrationens testgrindar. | 47 bridgefall och fulla Node-/Sites-sviter. Ingen verifierad ny bankkälla eller kundbetalning skapades av testerna. |
| Backup och recovery | `sites/lib/backup-engine.ts`, `src/backup.js`, tokenkarantän och återställningsspärrar bevarar ägar-/företagsgränser och kräver särskild recoveryacceptans. | 430 syntetiska original, 27 tabellgrupper och tio negativa fall på exakt main. Det är inte återställning över produktion. |
| CI och utvärdering | Låsta installationer, separat source-manifest, Node 22/24, full Sites, browser, bridge och 1/10/100-företagsprestanda binds till exakta källor. | Råa misslyckanden behålls; överlappande Node-versioner och säkerhetsdelmängder räknas inte dubbelt. |

[Full fillista för PR 61](integrated-changed-files.tsv) avser diffen `cde9178c0f8e8e386329ed8feaa4201e87b5a78f` → `24390ef7e8cf6b2274c57804dc9c2d74d362ab12`: 546 filer inklusive tester, äldre integrerad evidens och dokumentation. Det är inte 546 produktfixar. Föregående PR 45–61 granskades mot GitHub. PR 45–47 och 49–55 markerades sammanfogade när deras historik integrerades genom PR 61; 48 och 56–60 var redan sammanfogade före detta slutförande.

## Integrerad Node-workerfix

Den oberoende utvärderingen gav fyra processavbrott före IPC utan tillräcklig diagnostik för att avgöra orsaken. Ett separat, deterministiskt felprov visade samtidigt en konkret felväg: `ocr.terminate()` kunde kasta innan ett redan färdigt resultat skickades. Denna reproducerade förlust är rättad utan att påstå att den förklarar de fyra historiska avbrotten.

Färdig text, confidence och hela OCR-evidensobjektet bevaras nu även när cleanup misslyckas. Endast den fasta markören `DOCUMENT_WORKER_CLEANUP_FAILED` tillkommer. IPC-sändfel avslutar barnet med felstatus. Föräldern skiljer start-, process-, sänd-, timeout- och exit-utan-resultatfel med fasta kategorier, exitkod/signal och begränsad tidsmetadata. De nya feldiagnoserna innehåller inte råa undantag, dokumentinnehåll eller credentials.

90-sekunderstimeout, heapflaggan 256 MiB, högst två samtidiga anrop, 429, språkmodellen, PSM AUTO, parser- och finansregler är oförändrade. Författarens frysta tester gick 0/12→12/12 och fem berörda filer 107/107. Oberoende parentprober gick 2/12→12/12; separata tester med faktisk barnprocess och mockad OCR gick 12/12. [Implementationskvitto](worker-lifecycle-fix.md), [oberoende review](worker-review/README.md) och [publiceringsmappning](worker-publication-mapping.json).

## OCR-kvalitet: tre skilda evidenstyper

### Rättning av standardrubriker efter det frysta provet

Det slutförda provet visade en konkret, generell lucka: `Issue date` saknades trots stöd för `Invoice date`. Den redan stödda organisationskollektorn accepterade både brittisk och amerikansk stavning, men vissa avgränsningslistor accepterade bara `organisation`. Dessa listor är nu konsekventa. Befintliga `Bill to:` och `Fakturamottagare:` får avgränsa en föregående skalär cell och en layoutcell endast med sitt ursprungliga kolon. Ingen ny partsroll härleds från ett omärkt företagsnamn.

Tre separat frysta testgrupper täcker ändringen. Den första gick 40/70→70/70. Ett efterföljande fynd om kolonlösa mottagarrubriker gick 0/4→4/4; deras ursprungliga separata rubrik-/namnform bevaras. Den sista gruppen gick 24/28→28/28 för uttryckliga skalära mottagargränser. Slutlig fokus på `100f9c3015da34f772ea0cba53d9871e978ebeab`: 574/574 Node och 464/464 Sites. Oberoende granskning passerade 120/120 efter en öppet dokumenterad korrigering av åtta felaktiga positiva orgförväntningar; tidigare råutfall och oförändrade negativa kontroller är bevarade. [Författarens exakta kvitton](../quality8/standard-field-alias-census/README.md), [oberoende review](alias-review/README.md).

Den enda tillåtna utvecklingsreplayen på mellanversion `0132d4537c5fd24e6a0af7f3cadf499a73706ed0` gav 62→66/108 normala bildfält, 61,11 % recall, noll nya felvärden och noll förlorade korrekta värden. Den gjorde 28 parseranrop och noll OCR-anrop. Sparade observationer saknar fullständiga OCR-block, så layoutförbättringen kan inte mätas genom den återspelningen. Efterföljande kolon-/siblingändringar fick ingen ny replay. **61,11 % är ett uttryckligt utvecklingsresultat på en mellanversion, inte slutversionens oberoende optiska acceptans.**

### Skilda mätningar och deras gränser

**Känd utvecklingsreplay** använder samma tolv tidigare optiska observationer i båda parserna. Den nya koden återvann fyra korrekta obligatoriska fält: 74/100 i normalgruppen, 8/20 i stressgruppen. Den gör inga nya optiska anrop och räknas inte som oberoende acceptans. [Metod, råresultat och kvarstående fältfel](ocr.md).

**Första oberoende syntetiska provet** frystes före första optiska körningen. Det innehåller 16 normal- och tre stressdokument, exakt ett workerförsök per bild och samma observation till båda parserna. Normalresultatet var 54 TP, 0 FP och 90 FN av 144 förväntade bildfält: **37,50 % recall**. Fyra workerfel ligger kvar i primärnämnaren. Inklusive metadatariktning är resultatet 70/160; detta är ett annat mått. Inga dokument blev gröna och inga var helt korrekta. Stressresultatet var 8/27. [Full rapport och originalbevis](independent-ocr-evaluation.md).

Den första korpusens avsiktligt ogiltiga organisationsnummer och EUR-dokument begränsar dess representativitet för giltiga normala SEK-underlag. Utfallet ändras eller väljs inte bort i efterhand.

**Det andra oberoende provet med giltiga SEK-underlag** hade en annan blind författare, tolv normala fakturor (sex svenska och sex engelska) samt två stressfall. Alla 14 OCR-workers slutfördes och exakt 28 parseranrop gjordes. Båda parserna gav 62 TP, 0 FP och 46 FN av 108 normala bildfält: **57,41 % recall och 100 % observerad precision**. Ingen normalfaktura var fullständig eller grön. Stress gav 10/18 = 55,56 %. Direction är separat metadata. [Fryst rapport, bilder och rådata](../quality8/independent-supported-20261106/REPORT.md), [oberoende metodkontroll](supported-ocr-independent-review.md).

Detta lilla, kontrollerade material uppskattar inte generell produktionskvalitet. Noll falskgröna tillsammans med noll gröna ger inget positivt underlag för att mäta precision bland automatiskt accepterade dokument. De två parserna använder samma bilder och får inte räknas som dubbla oberoende dokument. Den efterföljande aliasrättningen gör de nu kända fallen till utvecklingsmaterial; första utfallet 57,41 % ändras inte. Ett äldre historiskt V3-testpaket kunde inte återfinnas eller intygas som oanvänt via de kontrollerade lokatorerna och användes inte som ersättning. [Tillgänglighetsnotering](ocr-v3-availability.md).

**Schemakontroll vid 15:59 UTC:** Gmail-uppgifterna för både 15:00 och 16:00 gav `no_update` utan nytt appinvokeringskvitto; senaste lyckade hämtning låg då kvar14:28. En senare assisterad körning16:27 importerade 9 nya underlag utan dubbletter; den bevisar inte timdispatchen. [Körkvitto](assisted-gmail-followup.json). Den senaste listade periodiska OCR-körningen var 10:43, med sex behandlade och noll fel. Körningen 15:05 kom från `workflow_run` efter CI. Aktuell regelbunden leverans är inte styrkt och moln-OCR var inte längre färsk enligt appens 45-minutersgräns. [Sanerat körkvitto](schedule-followup-1600.json).

**Verklig driftprogress** visar att den ordinarie CI-utlösta moln-OCR-körningen 42254783237 på exakt f3c80629 behandlade sex dokument utan processfel. Efterstatus är 415 granskning/57 väntande/2 registreringar. [Körkvitto](final-automatic-cloud-ocr.json). Det säger inte vilka fält som är korrekta. Inga osäkra kunddokument massgodkändes för att förbättra statistik eller köantal.

## Verkliga blockerare och nästa acceptans

| Kvarstående område | Vad som faktiskt saknas | Konkret acceptans som krävs |
| --- | --- | --- |
| Swedbank | Giltigt aktuellt medgivande och verifierad företags-/kontobehörighet; senaste kontrollen gav `BANK_CONSENT_INVALID`. | Vanlig behörig återanslutning/SCA där leverantören kräver det, rätt organisationsidentitet och kontoval, sedan en begränsad read-only-hämtning med verklig providerrespons, pagination och omspelningskontroll. |
| Open Payments | Sitekonfiguration för aktivering, klient/registrering och mTLS-bindning saknas. | Godkänd produktionskund, rätt produkt/scopes/corporate-context, certifikat/nyckelbindning och callbackkonfiguration. Hemligheter ska införas via ordinarie skyddad miljöhantering. |
| Bankgiro | Ingen aktiverad och auktoriserad källa. | Open Payments Bankgiroinformation med nödvändig konto-/företagsbehörighet, eller bankens avtalade SFTP/CAMT054C-profil med verifierad hostkey, rätt konto, original och proveniens. Först därefter kan betalare/referens kopplas till en faktisk insättning och faktura. |
| Gmail-schema | Ordinarie timrun saknar korrelerat anrop och resultat i appen. | Samma externa uppgift ska visa färsk status → vanlig tillåten synk → dokumentbearbetning → efterstatus med köridentitet/tid. En manuell dispatch eller promptändring uppfyller inte detta. |
| OCR och manuellt arbete | Oberoende kvalitet, bredare representativitet och säker roll-/cellkoppling når inte dokumenterad generell acceptans. | Ett fryst representativt prov med minst 85 % recall och 98 % precision, dokumentnivå och stress separat, inga falskt säkra ekonomiska fall. Två parserkörningar på samma bild är en observation. |
| Backupens senare importer | Snapshoten verifierad 00:48 omfattar inte dagens senare original. | Nästa ordinarie snapshot ska verifiera sitt nya fullständiga manifest. RPO måste definieras för produktionsbehovet; simulerade 15 minuter är inget produktionslöfte. |
| Kommersiell SaaS | Verklig flerföretagsresa med aktiva bankmedgivanden saknas. | Verifierad organisation → bank/SCA → ägda konton → fakturaunderlag → verklig betalning → avstämning, med roller, återkallelse och isolering i faktiskt godkänd driftmiljö. |

[Aktuella leverantörskällor](provider-reference-check.md) beskriver de relevanta avtals-/APIkraven. För Bankgiroexemplet 0599/625 SEK finns ingen ny verifierad AIS–rapport–fakturarelation: inledande nollor och uttrycklig generisk referens bevaras utan uppdiktad betalningsstatus.

## Bevarande och praktiska gränser

Ingen destruktiv produktionsåterställning, massregistrering, fabricerad bankobservation eller kundmejlsändning genomfördes. Bankmedgivanden och finansiella allokeringar ändrades inte som publiceringsåtgärd. Verkliga kundoriginal användes inte som syntetiska testfixtures. De två trunkerade databascellerna innebär att före-/efterkontrollen måste beskrivas som avgränsad; den är inte en komplett bytejämförelse av alla kunduppgifter.

Den tekniska leveransen minskar konkret reproducerade risker och har faktisk driftbevisning. Den kvarstående kvalitets- och kommersiella acceptansen ska fortsätta redovisas som ouppnådd tills motsvarande bevis finns.

## Slutlig drift, bevarande och rollback

[Release69-rapporten](release-site69.md) redovisar samtliga 15 leveranspunkter, aktuella API-/UI-bevis, elva jämförda tabeller, backupens riktiga skapande-/verifieringstid och den nya exakta återställningsövningen. Ingen rollback behövdes. Site 68 finns kvar som tidigare godkänd Sites-version; Node-/GitHub-workern kräver separat normalt kodrevert vid ett faktiskt rollbackbehov. Efterföljande evidenscommits på completion-branchen förändrar ingen produkt- eller testkod och binds till den testade/publicerade produkt-mainen f3c80629.

### Sen uppföljning av timschemat

Den ordinarie uppgiften schemalagd 17:00 registrerades också som `no_update`, utan ny korrelerad appinvokering. Vid 17:01:46 låg den senaste lyckade hämtningen kvar 16:27:10.457 från den assisterade körningen och köantalen var fortfarande 415/57/2. Miljömetadata styrker inte var automationskörningen faktiskt exekverades; dispatchens grundorsak är inte fastställd. [Sanerat sent kvitto](schedule-followup-1700.json).
