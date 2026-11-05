# Oberoende bedömningskandidat: alla 33 områden

**Inte ett uppdaterat scorecard eller slutlig produktionspoäng.** Bedömningen gäller underlaget i `8fefb3ec9be16fcde3a32f33a24601c4f2402f79` med runtime `571073b8172ab53899a4ce3c2b717c7fe24daee2`. Endast dokumentation och den lokala responsiva testvyn skiljer dessa punkter. Bankdiagnosens separata review binds till `1ee480c1c3eaa6d6aef4116c9355b71a1e6e2bf6`; den runtimefixen finns redan i 571073b. Den faktiskt publicerade versionen vid stoppet är Site 63/main `bf24a3c`, med exakt 5 894 godkända tester. Den nya vågens fulla slut-CI, publicering och efterkontroller var fortfarande väntande.

[Maskinläsbar kandidat](assessment-independent-candidate.json) innehåller samtliga 33 kriterier, båda föreslagna poängkolumnerna, gamla utkastets värden, exakt kvarstående krav, källreferenser och SHA-256 för varje repositorykälla. `/tmp/rating8-assessment-draft.json` behandlades som ett gammalt utkast; dess påståenden om kommande hållprov, bildbredder, automation och öppna reviewfynd har ersatts där ny evidens finns. Befintliga `QUALITY-SCORECARD.md` och `PROGRESS.md` är orörda.

## Bedömning

**Målet 33/33 på minst 8 är inte uppnått, även om den granskade koden passerar kommande leveransgrindar.** Nu-kolumnen ger **20/33** områden med stöd för minst 8 inom respektive kriterium. Den villkorade kolumnen ger **25/33**. Kvar under 8 efter enbart lyckad leverans är **6, 10, 15, 16, 18, 19, 28, 33**. Summorna är 251/330 och 254,5/330, medel 7,61 respektive 7,71; de är beräknade direkt från samma tabell och är ingen genväg för kravet på varje område.

Poängen är en försiktig ordinal bedömning i halvsteg, inte testantal omräknade till kvalitet. ”Nu” betyder föreslaget stöd för faktiskt publicerad bf24/Site 63 med senare kända brister. ”Efter leverans” är endast en kandidat om exakt full CI, normal publicering och relevanta efterkontroller verkligen passerar. Kända drift- och OCR-luckor blir inte godkända av en grön byggpipeline.

### Viktigaste skillnader mot det gamla utkastet

- **6 och 28 stannar på 6,5.** Gmail 21Z är genomförd med 7 nya underlag, men 41 väntar på OCR och senaste verkliga OCR är 18:23. Äldre köprogress är historisk; den gör inte aktuell automation grön. De senaste 21Z-/21:29-observationerna är roots uttryckliga sanerade överlämning, inte nya produktionsanrop i denna granskning. [Tidigare driftkvitto](release-wave1.md), [driftgränser](operations-evidence.md).
- **10 hålls på 6,5.** Första oberoende V2 på exakt 571073b är underkänd: 100 % precision men 60 % mandatory recall, 55,56 % bild9 och 0/10 kompletta normaldokument per parser. Noll falskt grönt och 2/2 stressavståenden är bra säkerhetsutfall men räcker inte för normalflödets kvalitet. V1 förblir ett separat underkänt förstaprov. [V2](ocr-independent-holdout-v2-report.md), [V1](ocr-independent-holdout-report.md).
- **15/16 är 6,5 och 18/19 är 7.** connected=false och 21:29-kontrollen gav `BANK_ACCOUNT_SCOPE_INVALID` för sparat urval 1 konto. Säkra reasonkoder är granskade men var ännu inte publicerade. Det saknas aktuellt bankgodkännande, ny lyckad synk och de relevanta verkliga identitets-/referensbevisen. [Bankdiagnosreview](bank-scope-diagnostic-review.md), [bevisgränser](payments-evidence.md).
- **2/25 samt 3/4 får inte ärva gamla publicerade 8/8,5.** Det finns konkreta falskt gröna översiktspresentationer, tappat sökfokus och smala layoutproblem. De stängda oberoende fynden och den lokala CUA:n ger nu rimligt stöd för **villkorad 8**, efter leverans. 25/25 geometrier och 3 interaktioner är riktig lokal browserobservation; fysisk mobil och autentiserad produktionsresa har inte gjorts. [Översiktsreview](overview-evidence-independent-review.md), [fokus](search-focus-review.md), [browserkvitto](browser-wave2/README.md).
- **23 kan föreslås 8 efter leverans**, eftersom den explicita manuella vektorn nu faktiskt fungerar genom riktiga lokala API→klientflöden med atomaritet, replay och stängda oberoende fynd. Publicerad tidigare väg stannar 7,5. Automatisk C4-REVIEW får fortfarande inte exekveras. [Baselinegap](multiple-invoice-existing-path-review.md), [slutreview](manual-multiple-independent-review.md).
- **29/31 har stöd för 8 inom PLAN:s uttryckliga avgränsning.** 362/362 original är faktiskt kontrollästa. Den isolerade övningen använder riktig kod, 27 tabeller, ledger-/originalkontroller och 8 negativa fall. 3,417 s är lokal restore när paket redan finns; 15 min RPO är simulerat. Senare importer, extern kopia/nyckel och tjänsteaktivering styrks inte. [Recovery](recovery-evidence.md).

## Alla 33 rader

För kandidatkolumnen gäller de gemensamma leveransgrindarna utöver varje rads domänkrav. Full evidens och exakta begränsningar finns i JSON-raden med samma nummer.

| Nr | Område | Nu: stöd, ej slutpoäng | Villkorat efter leverans | Kvarstående krav för 8 |
| --- | --- | ---: | ---: | --- |
| 1 | Design | 8 | 8 | Ingen ny domänlucka utöver leveransgrindarna för kandidatens visuella ändringar. |
| 2 | Startsida | 7 | 8 | Publicera den granskade översiktsfixen efter exakt CI och kontrollera att den publicerade sammanfattningen visar registrerat/okänt korrekt mot samma källpolicy. |
| 3 | Navigation | 7,5 | 8 | Leverera fokusfixen och gör en avgränsad publicerad tangentbordsresa genom sökning, öppning och stängning. |
| 4 | Mobil | 7,5 | 8 | Leverera samma granskade CSS och bind publicerat träd till den lokalt verifierade kandidaten; kontrollera att ingen publiceringsskillnad påverkar de berörda vyerna. |
| 5 | Sök/filter | 8 | 8 | Behåll exakta sök-/adapterregressioner i kandidatens fulla CI; ingen ny känd söklogiklucka. |
| 6 | Minimal manuell hantering | 6,5 | 6,5 | Återställ observerad aktuell köprogress genom hela avsedd kedja, visa säker återupptagning och mät hur ett godtagbart normalunderlag faktiskt når nästa korrekta steg utan fabricerat godkännande. |
| 7 | Kundfakturor | 8 | 8 | Bevara dessa regressionsgrindar på levererad kandidat; inga nya bekräftade fel i kundfakturans register-/skapandeflöde. |
| 8 | Leverantörsfakturor | 8 | 8 | Bevara positiva manuella/korrekta textunderlag och negativa original-/riktningstester i exakt CI. |
| 9 | PDF | 8 | 8 | Kandidatens ändrade PDF/OCR-importgraf måste ingå i fulla regressionsgrindar; inga kända formatgränsfel lämnas öppna. |
| 10 | Bild-OCR | 6,5 | 6,5 | Generell fix med bibehållna säkerhetsspärrar, öppet namngiven regression på kända V1/V2 och ett nytt, före körning fryst oberoende hållprov som når minst 98 % precision/85 % recall för obligatoriska fält och det förregistrerade urvalet med alla 13 fält; stress ska avstå och dokumentnivå redovisas. |
| 11 | Gmail | 8 | 8 | Behåll separata fetch-/bakgrundsstatusar och aktuell lyckad hämtning; inget konkret nytt Gmailhämtfel är visat. |
| 12 | Automatisk registrering | 8 | 8 | Bevara positiva och negativa registreringsprov samt lost-response-/samtidighetsgrindar i full CI. |
| 13 | Dubbletter | 8 | 8 | Samma dubblett- och atomaritetskrav måste passera för den nya manuella vektorn i full CI. |
| 14 | Dokumentgranskning | 8 | 8 | Bevara korrigerings-/kontext-/originaltester samt leverera de granskade tilläggen genom slutgrindarna. |
| 15 | Swedbank | 6,5 | 6,5 | Publicera säker diagnos, härled det faktiska avvisningsskälet och få aktuell bankgodkänd anslutning med verifierad läsning av rätt valt konto, med nödvändig ägarmedverkan. |
| 16 | Automatisk bankhämtning | 6,5 | 6,5 | Efter korrekt konto-/medgivandelösning behövs en aktuell faktiskt slutförd tillåten hämtning med korrekt konto, period/fullständighet, idempotens och nästa tid. |
| 17 | Bankgiro-import | 8 | 8 | Bevara original-/format-/dedupgränser och redovisa automatisk källa som ej konfigurerad tills verklig behörig källa finns. |
| 18 | Verklig betalare | 7 | 7 | Verifiera ett relevant verkligt original med faktiskt bankstyrkt betalare och rätt konto/rapportrelation; visa det utan antaganden och behåll negativa saknat-/konfliktfall. |
| 19 | Verklig OCR/referens | 7 | 7 | Verifiera faktisk explicit bankreferens i rätt original och relation; formell OCR får bara påstås när den typen är styrkt. |
| 20 | Automatisk matchning | 8 | 8 | Bevara besluts-/skrivregressioner i exakt CI. Reell användning kräver därefter de bankfakta som 15–19 fortfarande saknar. |
| 21 | Delbetalning | 8 | 8 | Full kandidat-CI ska bevara rätt rest och all-or-nothing vid underbetalning. |
| 22 | Överbetalning | 8 | 8 | Bevara överskotts-, refund- och atomaritetsgränser i exakt CI. |
| 23 | Flera fakturor per betalning | 7,5 | 8 | Full exakt CI, normal publicering och avgränsad kontroll att granskad ingång/etiketter finns i levererad UI; ingen riktig kundallokering behöver göras som QA. |
| 24 | Historik | 8 | 8 | Leverera tydlig manuell provenance och historisk/aktuell statusseparation efter exakt CI; bevara behörighetsgrind vid kvittoläsning. |
| 25 | Betalstatus | 7 | 8 | Leverera granskad översikts-/detaljparitet med korrekt manuell historik och kontrollera publicerad visning mot samma källfakta. |
| 26 | Kontrollera alla betalningar | 8 | 8 | Bevara återupptagning, felstatus och korrekt sammanfattning i exakt CI. |
| 27 | Mejlförslag | 8 | 8 | Bevara uttryckligt godkännande och korrekt underlag i exakt CI. |
| 28 | Schemaläggning | 6,5 | 6,5 | Observera färsk OCR-schemakörning/återhämtning med faktisk köprogress och korrekt sen-/paus-/överlappstatus; bankjobb ska antingen fungera med aktuell behörighet eller vara tydligt blockerat utan falskt grönt. |
| 29 | Backup | 8 | 8 | Behåll snapshotens exakta datagräns synlig och kontrollera nästa ordinarie backup; påstå inte att senare importer ingår. |
| 30 | Säkerhet | 8,5 | 8,5 | Kandidatens nya yta behöver exakt full CI/audit och bevarade auth-/ekonomiska gränser före slutförd bedömning. |
| 31 | Katastrofåterställning | 8 | 8 | PLAN:s avgränsade övningskrav är uppfyllt; bevara källparitet eller gör en ny namngiven övning om återställningskoden ändras. |
| 32 | Kod/tester | 8,5 | 8,5 | Alla obligatoriska Node/Sites/bridge-, syntax-, typ-, audit- och bygggrindar måste passera exakt det slutliga leveransträdet; bind även main/publicering till det trädet. |
| 33 | Verklig produktionsverifiering | 7 | 7 | Exakt godkänd CI och publicering, relevanta aktuella bank/Gmail/OCR/backupobservationer och jämförelse av utvalda ekonomiska skydd före/efter; autentiserad ägarresa där den behövs. |

## Avgränsningar som ska följa med poängen

Tekniska 8 i exempelvis 7–9, 12–14, 20–22 och 24–27 betyder att respektive bevarande-, format-, policy- eller transaktionskrav har konkret stöd. De betyder inte att all bild-OCR är bra, att en verklig bankanslutning fungerar eller att riktiga kundbetalningar/utskick har gjorts. PLAN kräver inte sådana riskfyllda QA-skrivningar för att verifiera rena register- och säkerhetskontrakt. Område 6/10/15/16/18/19/28/33 bär de kvarstående normalflödes- och externa bevisluckorna. [PLAN](PLAN.md), [publicerad exakt CI](release-wave1.md), [tidigare 33-områdesbevis](../FINAL-33-AREA-QUALITY-REPORT.md).

Område 32:s nuvarande 8,5 gäller endast publicerade bf24 med exakt 5 894 prov. Det är inget godkännande av den nya vågens ännu ofullständiga fullkörning. Tidigare grön 192-fallskörning missade två senare bekräftade klientfel, vilka nu är stängda genom riktiga producent-/klientregressioner. Överlappande testantal adderas inte. [Integrationsrapport](integration-review-wave2.md), [oberoende slutreview](manual-multiple-independent-review.md).

Säkerhet 8,5 har omfattande negativa lokala/CI-bevis men är inte penetrationstest eller juridisk aktivering. Senast styrkt audit skiljer0 produktionsfynd från8 moderate utvecklingsfynd; nya slutträdet behöver egna obligatoriska grindar. [SaaS-slutrapport](../SAAS-MULTITENANT-BANKID-FINAL-REPORT.md).

Detta uppdrag läste befintliga rapporter och använde en separat läsande rimlighetskontroll. Ingen ny OCR, testsvit, bank-/Gmailåtgärd, kunddataåtkomst, ekonomisk skrivning eller publicering gjordes. Bedömningskandidaten ska granskas och uppdateras från faktiska slutkvitton innan den eventuellt används i ett riktigt scorecard.
